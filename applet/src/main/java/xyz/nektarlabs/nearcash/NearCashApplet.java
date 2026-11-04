package xyz.nektarlabs.nearcash;

import javacard.framework.APDU;
import javacard.framework.Applet;
import javacard.framework.ISO7816;
import javacard.framework.ISOException;
import javacard.framework.JCSystem;
import javacard.framework.OwnerPIN;
import javacard.framework.Util;
import javacard.security.ECPrivateKey;
import javacard.security.ECPublicKey;
import javacard.security.KeyBuilder;
import javacard.security.KeyPair;
import javacard.security.Signature;

/**
 * NearCash bearer-cash applet: the card is the banknote.
 *
 * <p>Full specification: {@code docs/protocol.md}. Every constant and every
 * byte layout in this file must match that document.
 *
 * <p>The card holds two secp256k1 key pairs generated on-chip:
 * <ul>
 *   <li><b>F</b> (funds): controls the card's account on NEAR Intents. It signs
 *       exactly once (SIGN_ONCE, PIN protected); the card is marked spent in
 *       the same atomic transaction that stores the signature.</li>
 *   <li><b>A</b> (auth): answers AUTH challenges so anyone can check, offline,
 *       that the card is genuine and unspent.</li>
 * </ul>
 *
 * <p>Java Card coding rules followed here: only {@code byte} and {@code short}
 * arithmetic (no {@code int}), explicit casts on every short expression, all
 * persistent objects allocated once at install time, and temporary data kept
 * in a transient (RAM) buffer.
 */
public final class NearCashApplet extends Applet {

    // ------------------------------------------------------------------
    // Protocol constants (docs/protocol.md, sections 3–6)
    // ------------------------------------------------------------------

    static final byte PROTOCOL_VERSION = 0x01;

    static final byte CLA_NEARCASH = (byte) 0x80;

    static final byte INS_INFO = (byte) 0x10;
    static final byte INS_GET_CERT = (byte) 0x12;
    static final byte INS_AUTH = (byte) 0x20;
    static final byte INS_SIGN_ONCE = (byte) 0x30;
    static final byte INS_CHANGE_PIN = (byte) 0x32;
    static final byte INS_GENERATE_KEYS = (byte) 0x40;
    static final byte INS_STORE_CERT = (byte) 0x42;
    static final byte INS_FINALIZE = (byte) 0x44;

    static final byte STATE_EMPTY = 0x00;
    static final byte STATE_KEYS_GENERATED = 0x01;
    static final byte STATE_ISSUED = 0x02;
    static final byte STATE_SPENT = 0x03;

    static final byte PIN_TRY_LIMIT = 5;
    static final byte PIN_MIN_LENGTH = 4;
    static final byte PIN_MAX_LENGTH = 8;

    static final short MAX_CERT_LENGTH = 512;
    static final short DIGEST_LENGTH = 32;
    static final short CHALLENGE_MIN_LENGTH = 16;
    static final short CHALLENGE_MAX_LENGTH = 64;

    /** Uncompressed SEC1 public key: 0x04 || X (32) || Y (32). */
    static final short PUBLIC_KEY_LENGTH = 65;

    /** Longest DER encoding of a secp256k1 ECDSA signature. */
    static final short MAX_SIGNATURE_LENGTH = 72;

    /** ISO 7816-4 "PIN blocked" (authentication method blocked). */
    static final short SW_PIN_BLOCKED = (short) 0x6983;

    /** ISO 7816-4 "verification failed"; the low nibble carries the tries left. */
    static final short SW_PIN_WRONG_PREFIX = (short) 0x63C0;

    /**
     * Domain tag prepended to every AUTH message: ASCII "NBK-AUTH-v1".
     * It guarantees an AUTH signature can never be mistaken for any other
     * signed data.
     */
    private static final byte[] AUTH_DOMAIN_TAG = {
        0x4E, 0x42, 0x4B, 0x2D, 0x41, 0x55, 0x54, 0x48, 0x2D, 0x76, 0x31
    };

    /**
     * RAM buffer size: large enough for the AUTH message
     * (tag + 64-byte challenge + state = 76 bytes) and for one DER signature.
     */
    private static final short SCRATCH_LENGTH = 128;

    // ------------------------------------------------------------------
    // Persistent state (EEPROM). Allocated once, in the constructor.
    // ------------------------------------------------------------------

    /** Life-cycle state, see STATE_* constants. Only moves forward. */
    private byte state;

    private final ECPublicKey authPublicKey;
    private final ECPrivateKey authPrivateKey;
    private final KeyPair authKeyPair;

    private final ECPublicKey fundsPublicKey;
    private final ECPrivateKey fundsPrivateKey;
    private final KeyPair fundsKeyPair;

    /** ECDSA-SHA256 signer used by A (AUTH): hashes the message itself. */
    private final Signature authSigner;

    /** ECDSA signer used by F (SIGN_ONCE): signs a precomputed 32-byte digest. */
    private final Signature fundsSigner;

    /** Holder PIN. The try counter is persistent and survives power loss. */
    private final OwnerPIN pin;

    /** Issuer certificate, opaque to the card (format: protocol.md §8). */
    private final byte[] certificate;
    private short certificateLength;

    /** The one digest F has signed, and its signature (valid only when SPENT). */
    private final byte[] spentDigest;
    private final byte[] spentSignature;
    private short spentSignatureLength;

    // ------------------------------------------------------------------
    // Transient state (RAM), cleared when the applet is deselected.
    // ------------------------------------------------------------------

    private final byte[] scratch;

    // ------------------------------------------------------------------
    // Installation
    // ------------------------------------------------------------------

    private NearCashApplet() {
        authPublicKey = (ECPublicKey) KeyBuilder.buildKey(
                KeyBuilder.TYPE_EC_FP_PUBLIC, Secp256k1.KEY_LENGTH_BITS, false);
        authPrivateKey = (ECPrivateKey) KeyBuilder.buildKey(
                KeyBuilder.TYPE_EC_FP_PRIVATE, Secp256k1.KEY_LENGTH_BITS, false);
        Secp256k1.setParameters(authPublicKey);
        Secp256k1.setParameters(authPrivateKey);
        authKeyPair = new KeyPair(authPublicKey, authPrivateKey);

        fundsPublicKey = (ECPublicKey) KeyBuilder.buildKey(
                KeyBuilder.TYPE_EC_FP_PUBLIC, Secp256k1.KEY_LENGTH_BITS, false);
        fundsPrivateKey = (ECPrivateKey) KeyBuilder.buildKey(
                KeyBuilder.TYPE_EC_FP_PRIVATE, Secp256k1.KEY_LENGTH_BITS, false);
        Secp256k1.setParameters(fundsPublicKey);
        Secp256k1.setParameters(fundsPrivateKey);
        fundsKeyPair = new KeyPair(fundsPublicKey, fundsPrivateKey);

        authSigner = Signature.getInstance(Signature.ALG_ECDSA_SHA_256, false);
        fundsSigner = Signature.getInstance(Signature.ALG_ECDSA_SHA_256, false);

        pin = new OwnerPIN(PIN_TRY_LIMIT, PIN_MAX_LENGTH);

        certificate = new byte[MAX_CERT_LENGTH];
        certificateLength = 0;

        spentDigest = new byte[DIGEST_LENGTH];
        spentSignature = new byte[MAX_SIGNATURE_LENGTH];
        spentSignatureLength = 0;

        scratch = JCSystem.makeTransientByteArray(SCRATCH_LENGTH, JCSystem.CLEAR_ON_DESELECT);

        state = STATE_EMPTY;
    }

    /** Called by the card runtime when the applet is installed. */
    public static void install(byte[] bArray, short bOffset, byte bLength) {
        // Standard install parameters: the first byte is the instance AID length.
        new NearCashApplet().register(bArray, (short) (bOffset + 1), bArray[bOffset]);
    }

    // ------------------------------------------------------------------
    // Command dispatch
    // ------------------------------------------------------------------

    public void process(APDU apdu) {
        if (selectingApplet()) {
            // SELECT answers 9000 with no data. Clients call INFO next.
            return;
        }

        byte[] buffer = apdu.getBuffer();
        if (buffer[ISO7816.OFFSET_CLA] != CLA_NEARCASH) {
            ISOException.throwIt(ISO7816.SW_CLA_NOT_SUPPORTED);
        }

        switch (buffer[ISO7816.OFFSET_INS]) {
            case INS_INFO:
                processInfo(apdu);
                break;
            case INS_GET_CERT:
                processGetCertificate(apdu);
                break;
            case INS_AUTH:
                processAuth(apdu);
                break;
            case INS_SIGN_ONCE:
                processSignOnce(apdu);
                break;
            case INS_CHANGE_PIN:
                processChangePin(apdu);
                break;
            case INS_GENERATE_KEYS:
                processGenerateKeys(apdu);
                break;
            case INS_STORE_CERT:
                processStoreCertificate(apdu);
                break;
            case INS_FINALIZE:
                processFinalize(apdu);
                break;
            default:
                ISOException.throwIt(ISO7816.SW_INS_NOT_SUPPORTED);
        }
    }

    // ------------------------------------------------------------------
    // INFO — protocol.md §5.1
    // ------------------------------------------------------------------

    private void processInfo(APDU apdu) {
        byte[] buffer = apdu.getBuffer();
        short offset = 0;

        buffer[offset] = PROTOCOL_VERSION;
        offset++;
        buffer[offset] = state;
        offset++;
        buffer[offset] = pin.getTriesRemaining();
        offset++;
        offset = Util.setShort(buffer, offset, certificateLength);

        if (state != STATE_EMPTY) {
            offset = (short) (offset + authPublicKey.getW(buffer, offset));
            offset = (short) (offset + fundsPublicKey.getW(buffer, offset));
        }

        apdu.setOutgoingAndSend((short) 0, offset);
    }

    // ------------------------------------------------------------------
    // GET_CERT — protocol.md §5.2
    // ------------------------------------------------------------------

    private void processGetCertificate(APDU apdu) {
        requireState(STATE_ISSUED, STATE_SPENT);

        byte[] buffer = apdu.getBuffer();
        short offset = Util.getShort(buffer, ISO7816.OFFSET_P1);
        if (offset < 0 || offset > certificateLength) {
            ISOException.throwIt(ISO7816.SW_WRONG_P1P2);
        }

        short expected = apdu.setOutgoing(); // Le requested by the client
        short remaining = (short) (certificateLength - offset);
        short chunkLength = expected < remaining ? expected : remaining;

        apdu.setOutgoingLength(chunkLength);
        apdu.sendBytesLong(certificate, offset, chunkLength);
    }

    // ------------------------------------------------------------------
    // AUTH — protocol.md §5.3
    // ------------------------------------------------------------------

    private void processAuth(APDU apdu) {
        requireState(STATE_ISSUED, STATE_SPENT);

        short challengeLength = receiveCommandData(apdu);
        if (challengeLength < CHALLENGE_MIN_LENGTH || challengeLength > CHALLENGE_MAX_LENGTH) {
            ISOException.throwIt(ISO7816.SW_WRONG_LENGTH);
        }

        byte[] buffer = apdu.getBuffer();
        short dataOffset = apdu.getOffsetCdata();

        // message = "NBK-AUTH-v1" || challenge || state, built in RAM.
        short messageLength = Util.arrayCopyNonAtomic(
                AUTH_DOMAIN_TAG, (short) 0, scratch, (short) 0, (short) AUTH_DOMAIN_TAG.length);
        messageLength = Util.arrayCopyNonAtomic(
                buffer, dataOffset, scratch, messageLength, challengeLength);
        scratch[messageLength] = state;
        messageLength++;

        // Response = state || DER signature (ECDSA over SHA-256(message), key A).
        buffer[0] = state;
        authSigner.init(authPrivateKey, Signature.MODE_SIGN);
        short signatureLength = authSigner.sign(scratch, (short) 0, messageLength, buffer, (short) 1);

        apdu.setOutgoingAndSend((short) 0, (short) (1 + signatureLength));
    }

    // ------------------------------------------------------------------
    // SIGN_ONCE — protocol.md §5.4
    // ------------------------------------------------------------------

    private void processSignOnce(APDU apdu) {
        // 1. Only an issued card can sign; a spent card can only re-read.
        requireState(STATE_ISSUED, STATE_SPENT);

        // Command data: pinLen (1) || PIN || digest (32)
        short dataLength = receiveCommandData(apdu);
        byte[] buffer = apdu.getBuffer();
        short dataOffset = apdu.getOffsetCdata();

        if (dataLength < 1) {
            ISOException.throwIt(ISO7816.SW_WRONG_LENGTH);
        }
        byte pinLength = buffer[dataOffset];
        short pinOffset = (short) (dataOffset + 1);
        requireValidPinFormat(buffer, pinOffset, pinLength);
        if (dataLength != (short) (1 + pinLength + DIGEST_LENGTH)) {
            ISOException.throwIt(ISO7816.SW_WRONG_LENGTH);
        }
        short digestOffset = (short) (pinOffset + pinLength);

        // 2. Check the PIN (throws 63Cx or 6983 on failure).
        checkPin(buffer, pinOffset, pinLength);

        // 3. Already spent: only the exact same digest gets its stored
        //    signature back. This makes the command safe to repeat if the
        //    card lost power while answering the first time.
        if (state == STATE_SPENT) {
            if (Util.arrayCompare(buffer, digestOffset, spentDigest, (short) 0, DIGEST_LENGTH) != 0) {
                ISOException.throwIt(ISO7816.SW_CONDITIONS_NOT_SATISFIED);
            }
            Util.arrayCopyNonAtomic(spentSignature, (short) 0, buffer, (short) 0, spentSignatureLength);
            apdu.setOutgoingAndSend((short) 0, spentSignatureLength);
            return;
        }

        // 4. Issued: sign in RAM first. If power is lost here nothing has
        //    been stored and nothing has left the card, so the card is still
        //    ISSUED and the command can simply be repeated.
        fundsSigner.init(fundsPrivateKey, Signature.MODE_SIGN);
        short signatureLength = fundsSigner.signPreComputedHash(
                buffer, digestOffset, DIGEST_LENGTH, scratch, (short) 0);

        // Then persist digest + signature + SPENT in ONE atomic transaction:
        // after the commit the card can never produce another signature.
        JCSystem.beginTransaction();
        Util.arrayCopy(buffer, digestOffset, spentDigest, (short) 0, DIGEST_LENGTH);
        Util.arrayCopy(scratch, (short) 0, spentSignature, (short) 0, signatureLength);
        spentSignatureLength = signatureLength;
        state = STATE_SPENT;
        JCSystem.commitTransaction();

        // Only now does the signature leave the card.
        Util.arrayCopyNonAtomic(scratch, (short) 0, buffer, (short) 0, signatureLength);
        apdu.setOutgoingAndSend((short) 0, signatureLength);
    }

    // ------------------------------------------------------------------
    // CHANGE_PIN — protocol.md §5.5
    // ------------------------------------------------------------------

    private void processChangePin(APDU apdu) {
        requireState(STATE_ISSUED, STATE_ISSUED);

        // Command data: oldLen (1) || old PIN || newLen (1) || new PIN
        short dataLength = receiveCommandData(apdu);
        byte[] buffer = apdu.getBuffer();
        short dataOffset = apdu.getOffsetCdata();

        if (dataLength < 1) {
            ISOException.throwIt(ISO7816.SW_WRONG_LENGTH);
        }
        byte oldLength = buffer[dataOffset];
        short oldOffset = (short) (dataOffset + 1);
        requireValidPinFormat(buffer, oldOffset, oldLength);

        short newLengthOffset = (short) (oldOffset + oldLength);
        if (dataLength < (short) (1 + oldLength + 1)) {
            ISOException.throwIt(ISO7816.SW_WRONG_LENGTH);
        }
        byte newLength = buffer[newLengthOffset];
        short newOffset = (short) (newLengthOffset + 1);
        requireValidPinFormat(buffer, newOffset, newLength);

        if (dataLength != (short) (1 + oldLength + 1 + newLength)) {
            ISOException.throwIt(ISO7816.SW_WRONG_LENGTH);
        }

        checkPin(buffer, oldOffset, oldLength);
        // OwnerPIN.update stores the new PIN and resets the try counter.
        pin.update(buffer, newOffset, newLength);
    }

    // ------------------------------------------------------------------
    // Issuance — protocol.md §5.6
    // ------------------------------------------------------------------

    private void processGenerateKeys(APDU apdu) {
        requireState(STATE_EMPTY, STATE_EMPTY);

        // If power is lost before the state change below, the card is still
        // EMPTY and both pairs are simply generated again. No funds can be
        // attached to a key before this command has fully completed.
        authKeyPair.genKeyPair();
        fundsKeyPair.genKeyPair();
        state = STATE_KEYS_GENERATED;

        // Response: pubA (65) || pubF (65)
        byte[] buffer = apdu.getBuffer();
        short offset = authPublicKey.getW(buffer, (short) 0);
        offset = (short) (offset + fundsPublicKey.getW(buffer, offset));
        apdu.setOutgoingAndSend((short) 0, offset);
    }

    private void processStoreCertificate(APDU apdu) {
        requireState(STATE_KEYS_GENERATED, STATE_KEYS_GENERATED);

        byte[] buffer = apdu.getBuffer();
        short offset = Util.getShort(buffer, ISO7816.OFFSET_P1);
        if (offset < 0 || offset >= MAX_CERT_LENGTH) {
            ISOException.throwIt(ISO7816.SW_WRONG_P1P2);
        }

        short chunkLength = receiveCommandData(apdu);
        if (chunkLength > (short) (MAX_CERT_LENGTH - offset)) {
            ISOException.throwIt(ISO7816.SW_FILE_FULL);
        }

        // arrayCopy (not NonAtomic) so a chunk is either fully written or not at all.
        Util.arrayCopy(buffer, apdu.getOffsetCdata(), certificate, offset, chunkLength);
    }

    private void processFinalize(APDU apdu) {
        requireState(STATE_KEYS_GENERATED, STATE_KEYS_GENERATED);

        // Command data: certLen (2) || pinLen (1) || PIN
        short dataLength = receiveCommandData(apdu);
        byte[] buffer = apdu.getBuffer();
        short dataOffset = apdu.getOffsetCdata();

        if (dataLength < 3) {
            ISOException.throwIt(ISO7816.SW_WRONG_LENGTH);
        }
        short newCertificateLength = Util.getShort(buffer, dataOffset);
        if (newCertificateLength <= 0 || newCertificateLength > MAX_CERT_LENGTH) {
            ISOException.throwIt(ISO7816.SW_WRONG_DATA);
        }

        byte pinLength = buffer[(short) (dataOffset + 2)];
        short pinOffset = (short) (dataOffset + 3);
        requireValidPinFormat(buffer, pinOffset, pinLength);
        if (dataLength != (short) (3 + pinLength)) {
            ISOException.throwIt(ISO7816.SW_WRONG_LENGTH);
        }

        // Set the PIN first: if power is lost before the commit below, the
        // card is still KEYS_GENERATED and FINALIZE can be repeated.
        pin.update(buffer, pinOffset, pinLength);

        JCSystem.beginTransaction();
        certificateLength = newCertificateLength;
        state = STATE_ISSUED;
        JCSystem.commitTransaction();
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /**
     * Throws 6985 unless the current state is one of the two given states.
     * Pass the same state twice when only one state is allowed.
     */
    private void requireState(byte allowed1, byte allowed2) {
        if (state != allowed1 && state != allowed2) {
            ISOException.throwIt(ISO7816.SW_CONDITIONS_NOT_SATISFIED);
        }
    }

    /**
     * Receives the whole command data field into the APDU buffer and returns
     * its length. Loops because, depending on the transport, the first
     * receive call may deliver only part of the data.
     */
    private static short receiveCommandData(APDU apdu) {
        // setIncomingAndReceive must come first: getIncomingLength and
        // getOffsetCdata throw APDUException.ILLEGAL_USE until it is called.
        short received = apdu.setIncomingAndReceive();
        short total = apdu.getIncomingLength();
        short writeOffset = (short) (apdu.getOffsetCdata() + received);
        while (received < total) {
            short chunk = apdu.receiveBytes(writeOffset);
            writeOffset = (short) (writeOffset + chunk);
            received = (short) (received + chunk);
        }
        return total;
    }

    /** Throws 6A80 unless the PIN is 4–8 ASCII digits. */
    private static void requireValidPinFormat(byte[] buffer, short offset, byte length) {
        if (length < PIN_MIN_LENGTH || length > PIN_MAX_LENGTH) {
            ISOException.throwIt(ISO7816.SW_WRONG_DATA);
        }
        for (short i = 0; i < length; i++) {
            byte digit = buffer[(short) (offset + i)];
            if (digit < (byte) '0' || digit > (byte) '9') {
                ISOException.throwIt(ISO7816.SW_WRONG_DATA);
            }
        }
    }

    /**
     * Verifies the holder PIN. Throws 6983 if it is blocked, or 63Cx (x =
     * tries left) if it is wrong. OwnerPIN decrements its persistent try
     * counter before comparing, so pulling the card mid-check does not give
     * an attacker a free attempt.
     */
    private void checkPin(byte[] buffer, short offset, byte length) {
        if (pin.getTriesRemaining() == 0) {
            ISOException.throwIt(SW_PIN_BLOCKED);
        }
        if (!pin.check(buffer, offset, length)) {
            short triesLeft = pin.getTriesRemaining();
            if (triesLeft == 0) {
                ISOException.throwIt(SW_PIN_BLOCKED);
            }
            ISOException.throwIt((short) (SW_PIN_WRONG_PREFIX | triesLeft));
        }
    }
}
