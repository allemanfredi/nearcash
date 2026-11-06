import Foundation

/// Gets a new passkey's P-256 public key out of its WebAuthn attestation object.
///
/// attestationObject (CBOR map) → "authData" bytes:
///   rpIdHash (32) ‖ flags (1) ‖ signCount (4) ‖
///   attested credential data, present when flag AT (0x40) is set:
///     aaguid (16) ‖ credentialIdLength (2) ‖ credentialId ‖ credentialPublicKey (COSE map)
/// (https://w3c.github.io/webauthn/#sctn-attested-credential-data)
///
/// The COSE map of an ES256 key (RFC 9053):
///   1 (kty) = 2 (EC2), 3 (alg) = -7 (ES256), -1 (crv) = 1 (P-256),
///   -2 = x (32 bytes), -3 = y (32 bytes).
enum COSEPublicKey {

    struct Extracted: Equatable {
        let credentialID: Data
        /// X (32) ‖ Y (32): how NEAR Intents names a P-256 key ("p256:" ‖ base58).
        let publicKey: Data
    }

    static func p256Key(fromAttestationObject attestationObject: Data) throws -> Extracted {
        var reader = CBORReader(attestationObject)
        guard case let .bytes(authData)? = try reader.read()[.text("authData")] else {
            throw CBORError(description: "attestation object without authData")
        }
        let bytes = [UInt8](authData)
        guard bytes.count > 55, bytes[32] & 0x40 != 0 else {
            throw CBORError(description: "authData carries no credential")
        }
        let idLength = Int(bytes[53]) << 8 | Int(bytes[54])
        let keyStart = 55 + idLength
        guard keyStart < bytes.count else { throw CBORError(description: "authData truncated") }
        let credentialID = Data(bytes[55..<keyStart])

        var keyReader = CBORReader(authData, offset: keyStart)
        let key = try keyReader.read()
        guard key[.unsigned(1)] == .unsigned(2),      // EC2
              key[.unsigned(3)] == .negative(-7),     // ES256
              key[.negative(-1)] == .unsigned(1),     // P-256
              case let .bytes(x)? = key[.negative(-2)], x.count == 32,
              case let .bytes(y)? = key[.negative(-3)], y.count == 32 else {
            throw CBORError(description: "the passkey is not an ES256 (P-256) key")
        }
        return Extracted(credentialID: credentialID, publicKey: x + y)
    }
}
