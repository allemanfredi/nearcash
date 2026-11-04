package xyz.nektarlabs.nearcash;

import javacard.security.ECKey;
import javacard.security.KeyBuilder;

/**
 * Domain parameters of the secp256k1 curve (SEC 2, section 2.4.1).
 *
 * Java Card has no built-in "named curve" for secp256k1, so every EC key
 * object must be configured with these parameters before a key pair is
 * generated on it. The values below are the standard ones used by Bitcoin
 * and Ethereum; do not change them.
 *
 * Curve equation: y^2 = x^3 + a*x + b over the prime field F_p, with a = 0, b = 7.
 */
final class Secp256k1 {

    /** Key size in bits, as expected by {@link KeyBuilder}. */
    static final short KEY_LENGTH_BITS = KeyBuilder.LENGTH_EC_FP_256;

    /** Field prime p = 2^256 - 2^32 - 977. */
    private static final byte[] P = {
        (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF,
        (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF,
        (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF,
        (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFE, (byte) 0xFF, (byte) 0xFF, (byte) 0xFC, (byte) 0x2F
    };

    /** Coefficient a = 0 (32 zero bytes: some cards require the full field length). */
    private static final byte[] A = {
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
    };

    /** Coefficient b = 7. */
    private static final byte[] B = {
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x07
    };

    /** Generator point G, uncompressed SEC1 encoding: 0x04 || Gx || Gy. */
    private static final byte[] G = {
        0x04,
        // Gx
        (byte) 0x79, (byte) 0xBE, (byte) 0x66, (byte) 0x7E, (byte) 0xF9, (byte) 0xDC, (byte) 0xBB, (byte) 0xAC,
        (byte) 0x55, (byte) 0xA0, (byte) 0x62, (byte) 0x95, (byte) 0xCE, (byte) 0x87, (byte) 0x0B, (byte) 0x07,
        (byte) 0x02, (byte) 0x9B, (byte) 0xFC, (byte) 0xDB, (byte) 0x2D, (byte) 0xCE, (byte) 0x28, (byte) 0xD9,
        (byte) 0x59, (byte) 0xF2, (byte) 0x81, (byte) 0x5B, (byte) 0x16, (byte) 0xF8, (byte) 0x17, (byte) 0x98,
        // Gy
        (byte) 0x48, (byte) 0x3A, (byte) 0xDA, (byte) 0x77, (byte) 0x26, (byte) 0xA3, (byte) 0xC4, (byte) 0x65,
        (byte) 0x5D, (byte) 0xA4, (byte) 0xFB, (byte) 0xFC, (byte) 0x0E, (byte) 0x11, (byte) 0x08, (byte) 0xA8,
        (byte) 0xFD, (byte) 0x17, (byte) 0xB4, (byte) 0x48, (byte) 0xA6, (byte) 0x85, (byte) 0x54, (byte) 0x19,
        (byte) 0x9C, (byte) 0x47, (byte) 0xD0, (byte) 0x8F, (byte) 0xFB, (byte) 0x10, (byte) 0xD4, (byte) 0xB8
    };

    /** Order n of the generator G. */
    private static final byte[] N = {
        (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF,
        (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFF, (byte) 0xFE,
        (byte) 0xBA, (byte) 0xAE, (byte) 0xDC, (byte) 0xE6, (byte) 0xAF, (byte) 0x48, (byte) 0xA0, (byte) 0x3B,
        (byte) 0xBF, (byte) 0xD2, (byte) 0x5E, (byte) 0x8C, (byte) 0xD0, (byte) 0x36, (byte) 0x41, (byte) 0x41
    };

    /** Cofactor h = 1. */
    private static final short COFACTOR = 1;

    private Secp256k1() {
        // Static helper, never instantiated.
    }

    /**
     * Configures an EC key object (public or private) with the secp256k1
     * domain parameters. Must be called before generating a key pair on it.
     */
    static void setParameters(ECKey key) {
        key.setFieldFP(P, (short) 0, (short) P.length);
        key.setA(A, (short) 0, (short) A.length);
        key.setB(B, (short) 0, (short) B.length);
        key.setG(G, (short) 0, (short) G.length);
        key.setR(N, (short) 0, (short) N.length);
        key.setK(COFACTOR);
    }
}
