import Foundation

/// Text encodings of bytes used by NEAR Intents and WebAuthn.
enum Base58 {

    /// The Bitcoin alphabet, which NEAR uses: no 0, O, I or l.
    private static let alphabet = Array("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")

    /// Base58 of `data`: NEAR's "secp256k1:…" and "p256:…" keys and signatures.
    static func encode(_ data: Data) -> String {
        let bytes = [UInt8](data)
        // Each leading zero byte is written as a leading "1".
        let leadingZeros = bytes.prefix { $0 == 0 }.count

        // Convert base 256 → base 58, least significant digit first.
        var digits = [Int]()
        for byte in bytes {
            var carry = Int(byte)
            for index in digits.indices {
                carry += digits[index] << 8
                digits[index] = carry % 58
                carry /= 58
            }
            while carry > 0 {
                digits.append(carry % 58)
                carry /= 58
            }
        }

        let ones = String(repeating: "1", count: leadingZeros)
        return ones + String(digits.reversed().map { alphabet[$0] })
    }
}

enum Base64URL {

    /// Base64url without padding (RFC 4648 §5), as WebAuthn writes its challenges.
    static func encode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
