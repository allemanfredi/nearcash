package xyz.nektarlabs.nearcash;

import com.licel.jcardsim.smartcardio.CardSimulator;
import com.licel.jcardsim.utils.AIDUtil;
import javacard.framework.AID;

import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * A NearCash card running inside jCardSim, with one helper per protocol
 * command (docs/protocol.md §5). Tests talk to it exactly like the phone or
 * the ATM will talk to a real card: raw APDUs in, response + status word out.
 */
final class TestCard {

    static final String APPLET_AID = "F04E42414E4B01";
    static final int CLA = 0x80;

    static final int SW_OK = 0x9000;
    static final int SW_CONDITIONS_NOT_SATISFIED = 0x6985;
    static final int SW_WRONG_DATA = 0x6A80;
    static final int SW_WRONG_LENGTH = 0x6700;
    static final int SW_PIN_BLOCKED = 0x6983;

    private final CardSimulator simulator = new CardSimulator();
    private final AID aid = AIDUtil.create(APPLET_AID);

    TestCard() {
        byte[] parameters = installParameters(APPLET_AID);
        simulator.installApplet(aid, NearCashApplet.class, parameters, (short) 0, (byte) parameters.length);
        select();
    }

    /**
     * GlobalPlatform INSTALL [for install] parameters, as a real card passes
     * them to {@code Applet.install}: instance AID length + AID, then empty
     * privileges and empty application parameters. (jCardSim's short
     * {@code installApplet(aid, class)} passes an empty array instead, which
     * no real card does.)
     */
    static byte[] installParameters(String instanceAidHex) {
        byte[] aidBytes = java.util.HexFormat.of().parseHex(instanceAidHex);
        byte[] parameters = new byte[1 + aidBytes.length + 2];
        parameters[0] = (byte) aidBytes.length;
        System.arraycopy(aidBytes, 0, parameters, 1, aidBytes.length);
        // parameters[1 + aid] = 0 (no privileges), parameters[2 + aid] = 0 (no app data)
        return parameters;
    }

    /** Simulates removing the card from the field and tapping it again. */
    void powerCycle() {
        simulator.reset();
        select();
    }

    private void select() {
        // AIDUtil.select builds the standard SELECT-by-AID command bytes.
        ResponseAPDU response = simulator.transmitCommand(new CommandAPDU(AIDUtil.select(APPLET_AID)));
        assertEquals(SW_OK, response.getSW(), "SELECT must succeed");
    }

    /** Sends an arbitrary APDU as-is (used to test malformed commands). */
    ResponseAPDU sendRaw(CommandAPDU command) {
        return simulator.transmitCommand(command);
    }

    /** Sends one NearCash APDU (CLA 0x80); {@code ne} = expected response length (0 = none). */
    ResponseAPDU send(int ins, int p1, int p2, byte[] data, int ne) {
        CommandAPDU command;
        if (data == null || data.length == 0) {
            command = ne > 0 ? new CommandAPDU(CLA, ins, p1, p2, ne) : new CommandAPDU(CLA, ins, p1, p2);
        } else {
            command = ne > 0 ? new CommandAPDU(CLA, ins, p1, p2, data, ne) : new CommandAPDU(CLA, ins, p1, p2, data);
        }
        return simulator.transmitCommand(command);
    }

    // ---------------------------------------------------------------- commands

    /** INFO. Returns the parsed response; fails the test on a non-9000 status. */
    Info info() {
        ResponseAPDU response = send(0x10, 0, 0, null, 256);
        assertEquals(SW_OK, response.getSW(), "INFO");
        return Info.parse(response.getData());
    }

    ResponseAPDU generateKeys() {
        return send(0x40, 0, 0, null, 256);
    }

    /** CHIP_KEY: creates C (the first time) and answers pubC. */
    ResponseAPDU chipKey() {
        return send(0x50, 0, 0, null, 256);
    }

    /** STORE_BIRTH with the 64-byte birth signature. */
    ResponseAPDU storeBirth(byte[] birthSignature) {
        return send(0x52, 0, 0, birthSignature, 0);
    }

    /** GET_BIRTH: pubC (65) || birth signature (64) [|| keys signature]. */
    ResponseAPDU getBirth() {
        return send(0x14, 0, 0, null, 256);
    }

    /**
     * The factory step (protocol.md §9, Card preparation): CHIP_KEY, then
     * STORE_BIRTH. The card treats the birth signature as opaque bytes.
     * Returns pubC.
     */
    byte[] giveBirth(byte[] birthSignature) {
        ResponseAPDU chipKey = chipKey();
        assertEquals(SW_OK, chipKey.getSW(), "CHIP_KEY");
        assertEquals(SW_OK, storeBirth(birthSignature).getSW(), "STORE_BIRTH");
        return chipKey.getData();
    }

    ResponseAPDU storeCertificateChunk(int offset, byte[] chunk) {
        return send(0x42, (offset >> 8) & 0xFF, offset & 0xFF, chunk, 0);
    }

    ResponseAPDU finalizeIssuance(int certificateLength, String pin) {
        byte[] pinBytes = ascii(pin);
        byte[] data = new byte[3 + pinBytes.length];
        data[0] = (byte) (certificateLength >> 8);
        data[1] = (byte) certificateLength;
        data[2] = (byte) pinBytes.length;
        System.arraycopy(pinBytes, 0, data, 3, pinBytes.length);
        return send(0x44, 0, 0, data, 0);
    }

    /** Reads the whole certificate with GET_CERT in chunks of {@code chunkSize} bytes. */
    byte[] readCertificate(int chunkSize) {
        int length = info().certificateLength;
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        while (out.size() < length) {
            int offset = out.size();
            ResponseAPDU response = send(0x12, (offset >> 8) & 0xFF, offset & 0xFF, null, chunkSize);
            assertEquals(SW_OK, response.getSW(), "GET_CERT at offset " + offset);
            out.writeBytes(response.getData());
        }
        return out.toByteArray();
    }

    ResponseAPDU auth(byte[] challenge) {
        return send(0x20, 0, 0, challenge, 256);
    }

    ResponseAPDU signOnce(String pin, byte[] digest) {
        byte[] pinBytes = ascii(pin);
        byte[] data = new byte[1 + pinBytes.length + digest.length];
        data[0] = (byte) pinBytes.length;
        System.arraycopy(pinBytes, 0, data, 1, pinBytes.length);
        System.arraycopy(digest, 0, data, 1 + pinBytes.length, digest.length);
        return send(0x30, 0, 0, data, 256);
    }

    ResponseAPDU changePin(String oldPin, String newPin) {
        byte[] oldBytes = ascii(oldPin);
        byte[] newBytes = ascii(newPin);
        byte[] data = new byte[1 + oldBytes.length + 1 + newBytes.length];
        data[0] = (byte) oldBytes.length;
        System.arraycopy(oldBytes, 0, data, 1, oldBytes.length);
        data[1 + oldBytes.length] = (byte) newBytes.length;
        System.arraycopy(newBytes, 0, data, 2 + oldBytes.length, newBytes.length);
        return send(0x32, 0, 0, data, 0);
    }

    /**
     * Runs the full issuance sequence of protocol.md §9 with an arbitrary
     * certificate blob (the card treats it as opaque bytes).
     */
    Info issue(byte[] certificate, String pin) {
        assertEquals(SW_OK, generateKeys().getSW(), "GENERATE_KEYS");
        for (int offset = 0; offset < certificate.length; offset += 200) {
            byte[] chunk = Arrays.copyOfRange(certificate, offset, Math.min(certificate.length, offset + 200));
            assertEquals(SW_OK, storeCertificateChunk(offset, chunk).getSW(), "STORE_CERT at " + offset);
        }
        assertEquals(SW_OK, finalizeIssuance(certificate.length, pin).getSW(), "FINALIZE");
        return info();
    }

    static byte[] ascii(String text) {
        return text.getBytes(StandardCharsets.US_ASCII);
    }

    // ---------------------------------------------------------------- INFO model

    /** Parsed INFO response (protocol.md §5.1). */
    static final class Info {
        final int version;
        final int state;
        final int pinTriesRemaining;
        final int certificateLength;
        final byte[] authPublicKey;   // null while EMPTY
        final byte[] fundsPublicKey;  // null while EMPTY

        private Info(int version, int state, int tries, int certLength, byte[] pubA, byte[] pubF) {
            this.version = version;
            this.state = state;
            this.pinTriesRemaining = tries;
            this.certificateLength = certLength;
            this.authPublicKey = pubA;
            this.fundsPublicKey = pubF;
        }

        static Info parse(byte[] data) {
            int version = data[0] & 0xFF;
            int state = data[1] & 0xFF;
            int tries = data[2] & 0xFF;
            int certLength = ((data[3] & 0xFF) << 8) | (data[4] & 0xFF);
            if (data.length == 5) {
                return new Info(version, state, tries, certLength, null, null);
            }
            assertEquals(5 + 65 + 65, data.length, "INFO length with keys");
            return new Info(version, state, tries, certLength,
                    Arrays.copyOfRange(data, 5, 70), Arrays.copyOfRange(data, 70, 135));
        }
    }
}
