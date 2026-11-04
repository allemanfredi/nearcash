package xyz.nektarlabs.nearcash;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Behavioural tests of the applet against docs/protocol.md, run in jCardSim.
 * Each nested class covers one stage of the card's life.
 */
class NearCashAppletTest {

    private static final int STATE_EMPTY = 0x00;
    private static final int STATE_KEYS_GENERATED = 0x01;
    private static final int STATE_ISSUED = 0x02;
    private static final int STATE_SPENT = 0x03;

    private static final String PIN = "1234";
    private static final byte[] AUTH_TAG = "NBK-AUTH-v1".getBytes(StandardCharsets.US_ASCII);

    private static final SecureRandom RANDOM = new SecureRandom();

    private TestCard card;

    @BeforeEach
    void installFreshCard() {
        card = new TestCard();
    }

    private static byte[] randomBytes(int length) {
        byte[] bytes = new byte[length];
        RANDOM.nextBytes(bytes);
        return bytes;
    }

    /** The AUTH message the card is expected to sign (protocol.md §5.3). */
    private static byte[] authMessage(byte[] challenge, int state) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.writeBytes(AUTH_TAG);
        out.writeBytes(challenge);
        out.write(state);
        return out.toByteArray();
    }

    @Nested
    @DisplayName("A fresh card (EMPTY)")
    class FreshCard {

        @Test
        void infoReportsEmptyStateAndNoKeys() {
            TestCard.Info info = card.info();
            assertEquals(1, info.version);
            assertEquals(STATE_EMPTY, info.state);
            assertEquals(5, info.pinTriesRemaining);
            assertEquals(0, info.certificateLength);
            assertNull(info.authPublicKey);
            assertNull(info.fundsPublicKey);
        }

        @Test
        void refusesEveryCirculationCommand() {
            assertEquals(TestCard.SW_CONDITIONS_NOT_SATISFIED, card.auth(randomBytes(32)).getSW());
            assertEquals(TestCard.SW_CONDITIONS_NOT_SATISFIED, card.signOnce(PIN, randomBytes(32)).getSW());
            assertEquals(TestCard.SW_CONDITIONS_NOT_SATISFIED, card.send(0x12, 0, 0, null, 100).getSW());
            assertEquals(TestCard.SW_CONDITIONS_NOT_SATISFIED, card.changePin(PIN, "5678").getSW());
        }

        @Test
        void rejectsUnknownClassAndInstruction() {
            ResponseAPDU wrongClass = card.sendRaw(new CommandAPDU(0x00, 0x10, 0, 0, 256));
            assertEquals(0x6E00, wrongClass.getSW());
            assertEquals(0x6D00, card.send(0x98, 0, 0, null, 0).getSW());
        }
    }

    @Nested
    @DisplayName("Issuance (GENERATE_KEYS, STORE_CERT, FINALIZE)")
    class Issuance {

        @Test
        void generatesTwoDistinctValidSecp256k1KeysOnlyOnce() {
            ResponseAPDU response = card.generateKeys();
            assertEquals(TestCard.SW_OK, response.getSW());
            byte[] data = response.getData();
            assertEquals(130, data.length);

            byte[] pubA = Arrays.copyOfRange(data, 0, 65);
            byte[] pubF = Arrays.copyOfRange(data, 65, 130);
            assertEquals(0x04, pubA[0], "uncompressed SEC1 encoding");
            assertEquals(0x04, pubF[0], "uncompressed SEC1 encoding");
            assertFalse(Arrays.equals(pubA, pubF), "A and F must be different keys");

            // Throws if a key is not a point on secp256k1: proves the curve
            // parameters in Secp256k1.java are right.
            assertNotNull(Secp256k1Verifier.decodePublicKey(pubA));
            assertNotNull(Secp256k1Verifier.decodePublicKey(pubF));

            TestCard.Info info = card.info();
            assertEquals(STATE_KEYS_GENERATED, info.state);
            assertArrayEquals(pubA, info.authPublicKey);
            assertArrayEquals(pubF, info.fundsPublicKey);

            assertEquals(TestCard.SW_CONDITIONS_NOT_SATISFIED, card.generateKeys().getSW(),
                    "keys can be generated only once");
        }

        @Test
        void storesCertificateAndReturnsItInChunks() {
            byte[] certificate = randomBytes(300);
            TestCard.Info info = card.issue(certificate, PIN);

            assertEquals(STATE_ISSUED, info.state);
            assertEquals(300, info.certificateLength);
            assertArrayEquals(certificate, card.readCertificate(100));
            assertArrayEquals(certificate, card.readCertificate(256));
        }

        @Test
        void certificateAndKeysAreFrozenAfterFinalize() {
            card.issue(randomBytes(150), PIN);
            assertEquals(TestCard.SW_CONDITIONS_NOT_SATISFIED, card.storeCertificateChunk(0, randomBytes(10)).getSW());
            assertEquals(TestCard.SW_CONDITIONS_NOT_SATISFIED, card.finalizeIssuance(150, PIN).getSW());
            assertEquals(TestCard.SW_CONDITIONS_NOT_SATISFIED, card.generateKeys().getSW());
        }

        @Test
        void rejectsInvalidPinsAtFinalize() {
            card.generateKeys();
            card.storeCertificateChunk(0, randomBytes(100));
            assertEquals(TestCard.SW_WRONG_DATA, card.finalizeIssuance(100, "123").getSW(), "too short");
            assertEquals(TestCard.SW_WRONG_DATA, card.finalizeIssuance(100, "123456789").getSW(), "too long");
            assertEquals(TestCard.SW_WRONG_DATA, card.finalizeIssuance(100, "12a4").getSW(), "not digits");
            assertEquals(STATE_KEYS_GENERATED, card.info().state, "a failed FINALIZE changes nothing");
        }

        @Test
        void rejectsCertificateLargerThan512Bytes() {
            card.generateKeys();
            assertEquals(0x6A84, card.storeCertificateChunk(400, randomBytes(200)).getSW());
            assertEquals(TestCard.SW_WRONG_DATA, card.finalizeIssuance(513, PIN).getSW());
        }
    }

    @Nested
    @DisplayName("Circulation (AUTH)")
    class Circulation {

        private TestCard.Info info;

        @BeforeEach
        void issue() {
            info = card.issue(randomBytes(200), PIN);
        }

        @Test
        void authSignsChallengeAndStateWithKeyA() {
            byte[] challenge = randomBytes(32);
            ResponseAPDU response = card.auth(challenge);
            assertEquals(TestCard.SW_OK, response.getSW());

            byte[] data = response.getData();
            assertEquals(STATE_ISSUED, data[0]);
            byte[] signature = Arrays.copyOfRange(data, 1, data.length);

            byte[] message = authMessage(challenge, STATE_ISSUED);
            assertTrue(Secp256k1Verifier.verifyMessage(info.authPublicKey, message, signature),
                    "AUTH must verify with key A");
            assertFalse(Secp256k1Verifier.verifyMessage(info.fundsPublicKey, message, signature),
                    "AUTH must NOT verify with key F");
            assertFalse(Secp256k1Verifier.verifyMessage(info.authPublicKey, authMessage(challenge, STATE_SPENT), signature),
                    "the state byte is covered by the signature");
        }

        @Test
        void authRejectsChallengesOutsideBounds() {
            assertEquals(TestCard.SW_WRONG_LENGTH, card.auth(randomBytes(15)).getSW());
            assertEquals(TestCard.SW_WRONG_LENGTH, card.auth(randomBytes(65)).getSW());
            assertEquals(TestCard.SW_OK, card.auth(randomBytes(16)).getSW());
            assertEquals(TestCard.SW_OK, card.auth(randomBytes(64)).getSW());
        }

        @Test
        void stateSurvivesPowerLoss() {
            card.powerCycle();
            assertEquals(STATE_ISSUED, card.info().state);
        }
    }

    @Nested
    @DisplayName("Redemption (SIGN_ONCE)")
    class Redemption {

        private TestCard.Info info;

        @BeforeEach
        void issue() {
            info = card.issue(randomBytes(200), PIN);
        }

        @Test
        void signsDigestWithKeyFAndBecomesSpent() {
            byte[] digest = randomBytes(32);
            ResponseAPDU response = card.signOnce(PIN, digest);
            assertEquals(TestCard.SW_OK, response.getSW());

            byte[] signature = response.getData();
            assertTrue(Secp256k1Verifier.verifyDigest(info.fundsPublicKey, digest, signature),
                    "SIGN_ONCE must be a plain ECDSA signature of the digest with key F");
            assertFalse(Secp256k1Verifier.verifyDigest(info.authPublicKey, digest, signature));

            assertEquals(STATE_SPENT, card.info().state);

            byte[] authData = card.auth(randomBytes(32)).getData();
            assertEquals(STATE_SPENT, authData[0], "a spent card says so in AUTH");
        }

        @Test
        void repeatingTheSameDigestReturnsTheStoredSignature() {
            byte[] digest = randomBytes(32);
            byte[] first = card.signOnce(PIN, digest).getData();

            // Same digest again, also after a power cycle (lost answer case).
            assertArrayEquals(first, card.signOnce(PIN, digest).getData());
            card.powerCycle();
            ResponseAPDU again = card.signOnce(PIN, digest);
            assertEquals(TestCard.SW_OK, again.getSW());
            assertArrayEquals(first, again.getData());
        }

        @Test
        void neverSignsASecondDigest() {
            card.signOnce(PIN, randomBytes(32));
            assertEquals(TestCard.SW_CONDITIONS_NOT_SATISFIED, card.signOnce(PIN, randomBytes(32)).getSW());
        }

        @Test
        void wrongPinsCountDownAndThenBlock() {
            byte[] digest = randomBytes(32);
            assertEquals(0x63C4, card.signOnce("0000", digest).getSW());
            assertEquals(0x63C3, card.signOnce("0000", digest).getSW());
            assertEquals(0x63C2, card.signOnce("0000", digest).getSW());
            assertEquals(0x63C1, card.signOnce("0000", digest).getSW());
            assertEquals(TestCard.SW_PIN_BLOCKED, card.signOnce("0000", digest).getSW());

            // Even the right PIN no longer works, and the card did not sign.
            assertEquals(TestCard.SW_PIN_BLOCKED, card.signOnce(PIN, digest).getSW());
            TestCard.Info after = card.info();
            assertEquals(0, after.pinTriesRemaining);
            assertEquals(STATE_ISSUED, after.state);
        }

        @Test
        void aCorrectPinResetsTheCounter() {
            byte[] digest = randomBytes(32);
            assertEquals(0x63C4, card.signOnce("9999", digest).getSW());
            assertEquals(TestCard.SW_OK, card.signOnce(PIN, digest).getSW());
            assertEquals(5, card.info().pinTriesRemaining);
        }

        @Test
        void rejectsMalformedRequests() {
            assertEquals(TestCard.SW_WRONG_LENGTH, card.signOnce(PIN, randomBytes(31)).getSW());
            assertEquals(TestCard.SW_WRONG_DATA, card.signOnce("12", randomBytes(32)).getSW());
            assertEquals(STATE_ISSUED, card.info().state);
            assertEquals(5, card.info().pinTriesRemaining, "malformed requests cost no PIN attempt");
        }
    }

    @Nested
    @DisplayName("Handover (CHANGE_PIN)")
    class Handover {

        @BeforeEach
        void issue() {
            card.issue(randomBytes(200), PIN);
        }

        @Test
        void newHolderReplacesThePin() {
            assertEquals(0x63C4, card.changePin("0000", "5678").getSW(), "wrong old PIN");
            assertEquals(TestCard.SW_OK, card.changePin(PIN, "5678").getSW());
            assertEquals(5, card.info().pinTriesRemaining, "update resets the counter");

            byte[] digest = randomBytes(32);
            assertEquals(0x63C4, card.signOnce(PIN, digest).getSW(), "old PIN no longer works");
            assertEquals(TestCard.SW_OK, card.signOnce("5678", digest).getSW());
        }

        @Test
        void acceptsPinsFromFourToEightDigits() {
            assertEquals(TestCard.SW_OK, card.changePin(PIN, "87654321").getSW());
            assertEquals(TestCard.SW_OK, card.changePin("87654321", "0000").getSW());
            assertEquals(TestCard.SW_WRONG_DATA, card.changePin("0000", "000").getSW());
        }

        @Test
        void notAllowedOnceSpent() {
            card.signOnce(PIN, randomBytes(32));
            assertEquals(TestCard.SW_CONDITIONS_NOT_SATISFIED, card.changePin(PIN, "5678").getSW());
        }
    }
}
