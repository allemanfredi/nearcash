import Foundation
import P256K

/// The few secp256k1 operations the wallet needs, on top of libsecp256k1
/// (Bitcoin Core's library, through the P256K package). Apple's CryptoKit
/// has no secp256k1, and the NearCash protocol uses it for key A and for
/// the issuer key.
enum Secp256k1 {

    /// Curve order n, big-endian.
    private static let order: [UInt8] = [
        0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFE,
        0xBA, 0xAE, 0xDC, 0xE6, 0xAF, 0x48, 0xA0, 0x3B, 0xBF, 0xD2, 0x5E, 0x8C, 0xD0, 0x36, 0x41, 0x41,
    ]

    /// n / 2 (rounded down), big-endian: the largest "low" s value.
    private static let halfOrder: [UInt8] = [
        0x7F, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
        0x5D, 0x57, 0x6E, 0x73, 0x57, 0xA4, 0x50, 0x1D, 0xDF, 0xE9, 0x2F, 0x46, 0x68, 0x1B, 0x20, 0xA0,
    ]

    /// 33-byte compressed form of a valid secp256k1 key given as 33 or 65 bytes.
    /// Throws if the bytes are not a point on the curve.
    static func compressedPublicKey(_ key: Data) throws -> Data {
        _ = try parsePublicKey(key) // validates the point
        if key.count == 33 { return key }
        let bytes = [UInt8](key) // 0x04 ‖ X (32) ‖ Y (32)
        let prefix: UInt8 = bytes[64] & 1 == 0 ? 0x02 : 0x03 // parity of Y
        return Data([prefix] + bytes[1...32])
    }

    /// Verifies an ECDSA signature over SHA-256(message), DER encoded.
    /// Accepts high-s signatures, which a Java Card may produce: they are
    /// normalised first, because libsecp256k1 only verifies low-s ones.
    static func verifySHA256(derSignature: Data, message: Data, publicKey: Data) -> Bool {
        guard let parsed = try? P256K.Signing.ECDSASignature(derRepresentation: derSignature) else {
            return false
        }
        return verifySHA256(compactSignature: parsed.compactRepresentation, message: message, publicKey: publicKey)
    }

    /// Verifies an ECDSA signature over SHA-256(message), compact r ‖ s (64 bytes).
    static func verifySHA256(compactSignature: Data, message: Data, publicKey: Data) -> Bool {
        guard compactSignature.count == 64,
              let key = try? parsePublicKey(publicKey),
              let signature = try? P256K.Signing.ECDSASignature(compactRepresentation: lowS(compactSignature)) else {
            return false
        }
        return key.isValidSignature(signature, for: message) // hashes message with SHA-256
    }

    /// Returns the low-s twin of a compact signature: if s > n/2, s becomes n − s.
    /// Both forms are equally valid ECDSA signatures; libsecp256k1 accepts only the low one.
    static func lowS(_ compactSignature: Data) -> Data {
        let bytes = [UInt8](compactSignature)
        let r = Array(bytes[0..<32])
        let s = Array(bytes[32..<64])
        guard isGreater(s, than: halfOrder) else { return compactSignature }
        return Data(r + subtract(s, from: order))
    }

    // MARK: - Internals

    private static func parsePublicKey(_ key: Data) throws -> P256K.Signing.PublicKey {
        switch key.count {
        case 33: return try P256K.Signing.PublicKey(dataRepresentation: key, format: .compressed)
        case 65: return try P256K.Signing.PublicKey(dataRepresentation: key, format: .uncompressed)
        default: throw CardError.malformedResponse(command: "public key", reason: "\(key.count) bytes")
        }
    }

    /// a > b for two 32-byte big-endian numbers.
    private static func isGreater(_ a: [UInt8], than b: [UInt8]) -> Bool {
        for (x, y) in zip(a, b) where x != y {
            return x > y
        }
        return false
    }

    /// minuend − subtrahend for 32-byte big-endian numbers (minuend ≥ subtrahend).
    private static func subtract(_ subtrahend: [UInt8], from minuend: [UInt8]) -> [UInt8] {
        var result = [UInt8](repeating: 0, count: 32)
        var borrow = 0
        for index in stride(from: 31, through: 0, by: -1) {
            var difference = Int(minuend[index]) - Int(subtrahend[index]) - borrow
            borrow = difference < 0 ? 1 : 0
            if difference < 0 { difference += 256 }
            result[index] = UInt8(difference)
        }
        return result
    }
}
