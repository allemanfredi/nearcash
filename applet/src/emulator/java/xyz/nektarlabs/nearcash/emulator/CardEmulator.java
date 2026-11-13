package xyz.nektarlabs.nearcash.emulator;

import com.licel.jcardsim.smartcardio.CardSimulator;
import com.licel.jcardsim.utils.AIDUtil;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.bouncycastle.asn1.x9.X9ECParameters;
import org.bouncycastle.crypto.digests.SHA256Digest;
import org.bouncycastle.crypto.ec.CustomNamedCurves;
import org.bouncycastle.crypto.params.ECDomainParameters;
import org.bouncycastle.crypto.params.ECPrivateKeyParameters;
import org.bouncycastle.crypto.signers.ECDSASigner;
import org.bouncycastle.crypto.signers.HMacDSAKCalculator;
import xyz.nektarlabs.nearcash.NearCashApplet;

import java.io.IOException;
import java.io.OutputStream;
import java.math.BigInteger;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.HexFormat;

/**
 * DEVELOPMENT ONLY: the ATM's hopper, NFC reader and turret, with the real
 * NearCash applet (src/main) running in jCardSim, the Java Card simulator.
 * `pnpm local` runs the ATM server with it (NEARCASH_CASSETTE=emulator), so a
 * sale makes a real banknote on a computer: the chip's keys, the birth check,
 * the certificate, the PIN, all through the applet's own code.
 *
 * Each card in the hopper is a new simulated chip, made at "the factory": the
 * applet is installed, the chip creates its key C (CHIP_KEY) and is born with
 * the public DEV production key (STORE_BIRTH), as `pnpm card:birth --dev`
 * does to a real card. The issuance server's DEV signer (NEARCASH_SIGNER=dev)
 * trusts that key. Anyone can make chips with it: test banknotes only.
 *
 * HTTP on 127.0.0.1 (the ATM server is the only caller, the last route is
 * for `pnpm local:sale`). Bodies are hex; answers are JSON or hex:
 *
 *   GET  /reader               {"card":N}: the card in the reader, or {"card":null}
 *   POST /reader/apdu?card=N   one command APDU to card N, in the reader → the response APDU
 *                              (409 when card N is not in the reader: never write to another card)
 *   POST /load                 the pusher: the next card of the hopper into the reader → {"card":N}
 *   POST /hand-out             the turret: the card in the reader goes out to the customer → {"card":N}
 *   POST /handed-out/apdu      one command APDU to the last card handed out: the banknote the
 *                              customer now holds, to check it as the wallet app would
 *
 * Run: `./gradlew -q emulatorClasspath` prints the classpath, then
 * `java -cp <classpath> xyz.nektarlabs.nearcash.emulator.CardEmulator [port]` (default 8893).
 */
public final class CardEmulator {

    /** The applet's AID (docs/protocol.md §3). */
    private static final String APPLET_AID = "F04E42414E4B01";
    private static final int CLA = 0x80;
    private static final int INS_CHIP_KEY = 0x50;
    private static final int INS_STORE_BIRTH = 0x52;
    private static final int SW_OK = 0x9000;

    /** What the production key signs: "NBK-BIRTH-v1" ‖ compressed C (docs/protocol.md §5.8). */
    private static final byte[] BIRTH_DOMAIN_TAG = "NBK-BIRTH-v1".getBytes(StandardCharsets.US_ASCII);
    /** The public DEV production key's secret: SHA-256 of a public string (packages/core/src/dev.ts). */
    private static final String DEV_PRODUCTION_SEED =
            "NearCash DEV production key - public on purpose - never use for real cards";

    private static final X9ECParameters SECP256K1 = CustomNamedCurves.getByName("secp256k1");
    private static final ECDomainParameters CURVE =
            new ECDomainParameters(SECP256K1.getCurve(), SECP256K1.getG(), SECP256K1.getN(), SECP256K1.getH());

    /** A simulated chip and its number (1, 2, 3… in the order they leave the hopper). */
    private record Chip(int number, CardSimulator simulator) {
    }

    // The server handles one request at a time (a single dispatcher thread):
    // the ATM sends one APDU at a time, and these never change mid-command.
    private int cardsMade = 0;
    private Chip inReader = null;
    private Chip handedOut = null;

    public static void main(String[] args) throws IOException {
        int port = args.length > 0 ? Integer.parseInt(args[0]) : 8893;
        new CardEmulator().serve(port);
    }

    private void serve(int port) throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        server.createContext("/", this::handle);
        server.start();
        System.out.println("NearCash card emulator on http://127.0.0.1:" + port
                + " (the NearCash applet in jCardSim; cards born with the public DEV production key)");
    }

    private void handle(HttpExchange exchange) throws IOException {
        try {
            String route = exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath();
            switch (route) {
                case "GET /reader" -> reply(exchange, 200, cardJson(inReader));
                case "POST /reader/apdu" -> {
                    int wanted = cardNumber(exchange.getRequestURI().getQuery());
                    if (inReader == null || inReader.number() != wanted) {
                        reply(exchange, 409, "card " + wanted + " is not in the reader");
                        return;
                    }
                    reply(exchange, 200, transmitHex(inReader, readBody(exchange)));
                }
                case "POST /load" -> {
                    if (inReader != null) {
                        reply(exchange, 409, "the reader already holds card " + inReader.number());
                        return;
                    }
                    inReader = manufacture(++cardsMade);
                    System.out.println("card " + inReader.number() + " loaded into the reader (blank, born)");
                    reply(exchange, 200, cardJson(inReader));
                }
                case "POST /hand-out" -> {
                    if (inReader == null) {
                        reply(exchange, 409, "the reader is empty: nothing to hand out");
                        return;
                    }
                    handedOut = inReader;
                    inReader = null;
                    // Out of the reader: the chip loses power, as when the customer pulls it out.
                    handedOut.simulator().reset();
                    System.out.println("card " + handedOut.number() + " handed out");
                    reply(exchange, 200, cardJson(handedOut));
                }
                case "POST /handed-out/apdu" -> {
                    if (handedOut == null) {
                        reply(exchange, 409, "no card was handed out yet");
                        return;
                    }
                    reply(exchange, 200, transmitHex(handedOut, readBody(exchange)));
                }
                default -> reply(exchange, 404, "unknown route: " + route);
            }
        } catch (RuntimeException error) {
            // A malformed request (bad hex, no card number), or a factory step that failed.
            reply(exchange, 400, String.valueOf(error.getMessage()));
        } finally {
            exchange.close();
        }
    }

    // ------------------------------------------------------------------ the factory

    /**
     * A new blank chip, as the bank's factory makes it: the applet installed
     * (state EMPTY), then born (CHIP_KEY, STORE_BIRTH with the DEV production
     * key). Then it is powered off, until it reaches the reader.
     */
    private static Chip manufacture(int number) {
        CardSimulator simulator = new CardSimulator();
        byte[] parameters = installParameters(APPLET_AID);
        simulator.installApplet(AIDUtil.create(APPLET_AID), NearCashApplet.class, parameters, (short) 0,
                (byte) parameters.length);
        Chip chip = new Chip(number, simulator);

        expectOk(transmit(chip, AIDUtil.select(APPLET_AID)), "SELECT");
        byte[] chipKey = expectOk(transmit(chip, new byte[] {(byte) CLA, INS_CHIP_KEY, 0, 0, 0}), "CHIP_KEY");
        byte[] birthSignature = signBirth(compress(chipKey));
        byte[] storeBirth = new byte[5 + birthSignature.length];
        storeBirth[0] = (byte) CLA;
        storeBirth[1] = INS_STORE_BIRTH;
        storeBirth[4] = (byte) birthSignature.length;
        System.arraycopy(birthSignature, 0, storeBirth, 5, birthSignature.length);
        expectOk(transmit(chip, storeBirth), "STORE_BIRTH");

        simulator.reset();
        return chip;
    }

    /**
     * GlobalPlatform INSTALL [for install] parameters, as a real card passes
     * them to Applet.install: the instance AID (length, bytes), then no
     * privileges and no application parameters. (As in the applet's tests.)
     */
    private static byte[] installParameters(String instanceAidHex) {
        byte[] aid = HexFormat.of().parseHex(instanceAidHex);
        byte[] parameters = new byte[1 + aid.length + 2];
        parameters[0] = (byte) aid.length;
        System.arraycopy(aid, 0, parameters, 1, aid.length);
        return parameters;
    }

    /**
     * The production key's signature over the birth message: SHA-256 of it,
     * signed with deterministic ECDSA (RFC 6979), compact r ‖ s with low s,
     * as packages/core/src/birth.ts signBirth makes it.
     */
    private static byte[] signBirth(byte[] compressedChipKey) {
        BigInteger secret = new BigInteger(1, sha256(DEV_PRODUCTION_SEED.getBytes(StandardCharsets.UTF_8)));
        ECDSASigner signer = new ECDSASigner(new HMacDSAKCalculator(new SHA256Digest()));
        signer.init(true, new ECPrivateKeyParameters(secret, CURVE));
        byte[] message = new byte[BIRTH_DOMAIN_TAG.length + compressedChipKey.length];
        System.arraycopy(BIRTH_DOMAIN_TAG, 0, message, 0, BIRTH_DOMAIN_TAG.length);
        System.arraycopy(compressedChipKey, 0, message, BIRTH_DOMAIN_TAG.length, compressedChipKey.length);
        BigInteger[] signature = signer.generateSignature(sha256(message));
        BigInteger r = signature[0];
        BigInteger s = signature[1];
        if (s.compareTo(CURVE.getN().shiftRight(1)) > 0) s = CURVE.getN().subtract(s); // low s
        byte[] compact = new byte[64];
        System.arraycopy(unsigned32(r), 0, compact, 0, 32);
        System.arraycopy(unsigned32(s), 0, compact, 32, 32);
        return compact;
    }

    /** Uncompressed SEC1 (04 ‖ X ‖ Y, 65 bytes) → compressed (02/03 ‖ X, 33 bytes). */
    private static byte[] compress(byte[] uncompressed) {
        if (uncompressed.length != 65 || uncompressed[0] != 0x04) {
            throw new IllegalStateException("CHIP_KEY did not answer an uncompressed public key");
        }
        byte[] compressed = new byte[33];
        compressed[0] = (byte) ((uncompressed[64] & 1) == 0 ? 0x02 : 0x03);
        System.arraycopy(uncompressed, 1, compressed, 1, 32);
        return compressed;
    }

    /** A 256-bit number on exactly 32 bytes, big-endian. */
    private static byte[] unsigned32(BigInteger value) {
        byte[] bytes = value.toByteArray(); // may carry a leading 0, or be shorter
        byte[] out = new byte[32];
        int length = Math.min(bytes.length, 32);
        System.arraycopy(bytes, bytes.length - length, out, 32 - length, length);
        return out;
    }

    private static byte[] sha256(byte[] data) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(data);
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    // ------------------------------------------------------------------ APDUs and HTTP

    /** One command APDU to the chip; the response with its status word. */
    private static byte[] transmit(Chip chip, byte[] command) {
        return chip.simulator().transmitCommand(command);
    }

    private static String transmitHex(Chip chip, String commandHex) {
        return HexFormat.of().formatHex(transmit(chip, HexFormat.of().parseHex(commandHex.trim())));
    }

    /** The response's data, when its status word is 9000; otherwise the factory step failed. */
    private static byte[] expectOk(byte[] response, String command) {
        int sw = ((response[response.length - 2] & 0xFF) << 8) | (response[response.length - 1] & 0xFF);
        if (sw != SW_OK) throw new IllegalStateException(command + " failed at the factory: " + Integer.toHexString(sw));
        return Arrays.copyOf(response, response.length - 2);
    }

    /** "card=7" → 7. */
    private static int cardNumber(String query) {
        if (query == null || !query.startsWith("card=")) throw new IllegalArgumentException("missing ?card=<number>");
        return Integer.parseInt(query.substring("card=".length()));
    }

    private static String cardJson(Chip chip) {
        return "{\"card\":" + (chip == null ? "null" : chip.number()) + "}";
    }

    private static String readBody(HttpExchange exchange) throws IOException {
        return new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.US_ASCII);
    }

    private static void reply(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", body.startsWith("{") ? "application/json" : "text/plain");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(bytes);
        }
    }
}
