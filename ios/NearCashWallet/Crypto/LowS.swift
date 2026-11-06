import Foundation

/// The "low-s" rule of ECDSA signatures, for any curve.
///
/// An ECDSA signature (r, s) has an equally valid twin (r, n − s), where n is
/// the order of the curve. To make signatures unique, NEAR Intents accepts
/// only the twin whose s is at most n/2 (the "low-s" one), for secp256k1
/// (the card's key F) and P-256 (the refund passkey) alike. A Java Card or a
/// passkey may produce either twin, so the app normalises before submitting.
enum LowS {

    /// Returns the low-s twin of a compact signature r (32) ‖ s (32):
    /// itself if s ≤ n/2, otherwise r ‖ (n − s).
    ///
    /// - Parameters:
    ///   - order: the curve order n, 32 bytes big-endian
    ///   - halfOrder: n / 2 rounded down, 32 bytes big-endian
    static func normalize(_ compactSignature: Data, order: [UInt8], halfOrder: [UInt8]) -> Data {
        let bytes = [UInt8](compactSignature)
        precondition(bytes.count == 64 && order.count == 32 && halfOrder.count == 32, "compact signatures are 64 bytes")
        let r = Array(bytes[0..<32])
        let s = Array(bytes[32..<64])
        guard isGreater(s, than: halfOrder) else { return compactSignature }
        return Data(r + subtract(s, from: order))
    }

    /// a > b for two 32-byte big-endian numbers.
    static func isGreater(_ a: [UInt8], than b: [UInt8]) -> Bool {
        for (x, y) in zip(a, b) where x != y {
            return x > y
        }
        return false
    }

    /// minuend − subtrahend for 32-byte big-endian numbers (minuend ≥ subtrahend).
    static func subtract(_ subtrahend: [UInt8], from minuend: [UInt8]) -> [UInt8] {
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
