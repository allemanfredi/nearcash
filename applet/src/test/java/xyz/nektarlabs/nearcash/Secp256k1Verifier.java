package xyz.nektarlabs.nearcash;

import org.bouncycastle.asn1.ASN1Integer;
import org.bouncycastle.asn1.ASN1Sequence;
import org.bouncycastle.asn1.x9.X9ECParameters;
import org.bouncycastle.crypto.ec.CustomNamedCurves;
import org.bouncycastle.crypto.params.ECDomainParameters;
import org.bouncycastle.crypto.params.ECPublicKeyParameters;
import org.bouncycastle.crypto.signers.ECDSASigner;
import org.bouncycastle.math.ec.ECPoint;

import java.math.BigInteger;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * Independent secp256k1 ECDSA verification for tests, using BouncyCastle
 * (the JDK no longer ships secp256k1). Using a different implementation from
 * the one inside jCardSim means a passing test really proves the card's
 * signatures are standard ones.
 */
final class Secp256k1Verifier {

    private static final X9ECParameters CURVE = CustomNamedCurves.getByName("secp256k1");
    private static final ECDomainParameters DOMAIN = new ECDomainParameters(
            CURVE.getCurve(), CURVE.getG(), CURVE.getN(), CURVE.getH());

    private Secp256k1Verifier() {
    }

    /** Decodes an uncompressed SEC1 key and checks it is a valid point on secp256k1. */
    static ECPoint decodePublicKey(byte[] uncompressed) {
        ECPoint point = CURVE.getCurve().decodePoint(uncompressed);
        if (!point.isValid()) {
            throw new IllegalArgumentException("not a valid secp256k1 point");
        }
        return point;
    }

    /** Verifies a DER signature over a 32-byte digest (no hashing). */
    static boolean verifyDigest(byte[] publicKey, byte[] digest, byte[] derSignature) {
        BigInteger[] rs = decodeDer(derSignature);
        ECDSASigner verifier = new ECDSASigner();
        verifier.init(false, new ECPublicKeyParameters(decodePublicKey(publicKey), DOMAIN));
        return verifier.verifySignature(digest, rs[0], rs[1]);
    }

    /** Verifies a DER signature over SHA-256(message). */
    static boolean verifyMessage(byte[] publicKey, byte[] message, byte[] derSignature) {
        return verifyDigest(publicKey, sha256(message), derSignature);
    }

    static byte[] sha256(byte[] data) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(data);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static BigInteger[] decodeDer(byte[] der) {
        ASN1Sequence sequence = ASN1Sequence.getInstance(der);
        BigInteger r = ASN1Integer.getInstance(sequence.getObjectAt(0)).getPositiveValue();
        BigInteger s = ASN1Integer.getInstance(sequence.getObjectAt(1)).getPositiveValue();
        return new BigInteger[] {r, s};
    }
}
