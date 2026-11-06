import Foundation
import P256K

/// Ethereum-style helpers for the card's funds key F on FAR (docs/protocol.md §7).
/// The same rules as the TypeScript client (packages/core/src/eth.ts):
///  - the card's account id is the Ethereum address of F;
///  - the redemption is an ERC-191 signature of the transfer intent;
///  - FAR accepts only low-s signatures, as 65 bytes r ‖ s ‖ recoveryId.
enum Ethereum {

    /// Lowercase "0x…" address of a secp256k1 public key (33 or 65 bytes):
    /// the last 20 bytes of keccak256(X ‖ Y).
    static func address(of publicKey: Data) throws -> String {
        let key = try P256K.Signing.PublicKey(
            dataRepresentation: try Secp256k1.compressedPublicKey(publicKey),
            format: .compressed
        )
        let uncompressed = key.uncompressedRepresentation // 0x04 ‖ X ‖ Y
        return "0x" + Keccak256.hash(uncompressed.dropFirst()).suffix(20).hex
    }

    /// ERC-191 ("personal_sign") digest of a message:
    /// keccak256("\u{19}Ethereum Signed Message:\n" ‖ decimal length ‖ message).
    static func erc191Digest(_ message: String) -> Data {
        let bytes = Data(message.utf8)
        var prefixed = Data("\u{19}Ethereum Signed Message:\n\(bytes.count)".utf8)
        prefixed.append(bytes)
        return Keccak256.hash(prefixed)
    }

    /// Turns the card's SIGN_ONCE answer (DER, possibly high-s) into the
    /// 65-byte r ‖ s ‖ recoveryId form FAR accepts:
    ///  1. low-s: if s > n/2, s becomes n − s (an equally valid signature);
    ///  2. the recovery id (0 or 1) that gives back the card's key F.
    /// Throws if the signature is not F's signature of `digest`: the card
    /// signs only once, so a wrong answer must never be submitted.
    static func recoverableSignature(derSignature: Data, digest: Data, fundsPublicKey: Data) throws -> Data {
        guard digest.count == 32 else { throw EthereumError.badDigest }
        guard let parsed = try? P256K.Signing.ECDSASignature(derRepresentation: derSignature) else {
            throw EthereumError.badSignature
        }
        let compact = Secp256k1.lowS(parsed.compactRepresentation)

        // Check the signature first: recovery only makes sense for a valid
        // one (and P256K stops the app if recovery is given garbage).
        let expectedKey = try Secp256k1.compressedPublicKey(fundsPublicKey)
        let signingKey = try P256K.Signing.PublicKey(dataRepresentation: expectedKey, format: .compressed)
        let signature = try P256K.Signing.ECDSASignature(compactRepresentation: compact)
        guard signingKey.isValidSignature(signature, for: HashDigest([UInt8](digest))) else {
            throw EthereumError.badSignature
        }

        // Recovery ids 2 and 3 exist only when r ≥ n (probability ~2^-128).
        for recoveryId in [Int32(0), 1] {
            let recoverable = try P256K.Recovery.ECDSASignature(compactRepresentation: compact, recoveryId: recoveryId)
            let recovered = P256K.Recovery.PublicKey(HashDigest([UInt8](digest)), signature: recoverable, format: .compressed)
            if recovered.dataRepresentation == expectedKey {
                return compact + Data([UInt8(recoveryId)])
            }
        }
        throw EthereumError.badSignature
    }
}

enum EthereumError: Error, Equatable {
    case badDigest
    /// The card's answer is not F's signature of the digest.
    case badSignature
}
