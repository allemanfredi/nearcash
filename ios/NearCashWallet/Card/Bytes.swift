import Foundation

// Small, explicit helpers for the byte-level work of the protocol.
// Everything in the NearCash protocol is big-endian (docs/protocol.md §5).

extension Data {
    /// Parses an even-length hex string ("80100000"), any case. Nil if malformed.
    init?(hex: String) {
        let digits = Array(hex.utf8)
        guard digits.count % 2 == 0 else { return nil }
        var bytes = [UInt8]()
        bytes.reserveCapacity(digits.count / 2)
        for index in stride(from: 0, to: digits.count, by: 2) {
            guard let high = Self.nibble(digits[index]), let low = Self.nibble(digits[index + 1]) else {
                return nil
            }
            bytes.append(high << 4 | low)
        }
        self.init(bytes)
    }

    /// Lowercase hex encoding.
    var hex: String {
        map { String(format: "%02x", $0) }.joined()
    }

    private static func nibble(_ character: UInt8) -> UInt8? {
        switch character {
        case UInt8(ascii: "0")...UInt8(ascii: "9"): return character - UInt8(ascii: "0")
        case UInt8(ascii: "a")...UInt8(ascii: "f"): return character - UInt8(ascii: "a") + 10
        case UInt8(ascii: "A")...UInt8(ascii: "F"): return character - UInt8(ascii: "A") + 10
        default: return nil
        }
    }
}

/// A field ran past the end of the data, or trailing bytes were left over.
struct ByteReaderError: Error, CustomStringConvertible {
    let description: String
}

/// Reads big-endian fields front to back, failing loudly on truncation.
/// Used to parse card responses and certificates.
struct ByteReader {
    private let bytes: [UInt8]
    private(set) var offset = 0

    init(_ data: Data) {
        bytes = [UInt8](data)
    }

    var remaining: Int { bytes.count - offset }

    mutating func read(_ count: Int) throws -> [UInt8] {
        guard count <= remaining else {
            throw ByteReaderError(description: "need \(count) bytes at offset \(offset), only \(remaining) left")
        }
        defer { offset += count }
        return Array(bytes[offset..<offset + count])
    }

    mutating func readData(_ count: Int) throws -> Data {
        Data(try read(count))
    }

    mutating func readUInt8() throws -> UInt8 {
        try read(1)[0]
    }

    mutating func readUInt16() throws -> Int {
        let value = try read(2)
        return Int(value[0]) << 8 | Int(value[1])
    }

    mutating func readUInt64() throws -> UInt64 {
        try read(8).reduce(0) { $0 << 8 | UInt64($1) }
    }

    /// One length byte, then that many bytes of strict UTF-8.
    mutating func readLengthPrefixedUTF8() throws -> String {
        let length = Int(try readUInt8())
        guard let text = String(bytes: try read(length), encoding: .utf8) else {
            throw ByteReaderError(description: "invalid UTF-8 at offset \(offset - length)")
        }
        return text
    }

    func expectEnd(_ what: String) throws {
        guard remaining == 0 else {
            throw ByteReaderError(description: "\(what): \(remaining) unexpected trailing bytes")
        }
    }
}

/// Unsigned big-endian integers of any width (amounts are 128-bit, and
/// UInt128 is not available before iOS 18).
enum BigEndianInteger {

    /// Decimal digits of the number, e.g. [0x01, 0x00] → "256".
    static func decimalString(_ bytes: [UInt8]) -> String {
        var number = Array(bytes.drop { $0 == 0 })
        guard !number.isEmpty else { return "0" }

        // Long division by 10, collecting remainders: the least significant digit comes first.
        var digits = [Character]()
        while !number.isEmpty {
            var remainder = 0
            var quotient = [UInt8]()
            quotient.reserveCapacity(number.count)
            for byte in number {
                let current = remainder << 8 | Int(byte)
                let digit = UInt8(current / 10)
                remainder = current % 10
                if !quotient.isEmpty || digit != 0 { quotient.append(digit) }
            }
            digits.append(Character(String(remainder)))
            number = quotient
        }
        return String(digits.reversed())
    }
}

/// Formats a token amount stored in its smallest unit:
/// 10_000_000_000_000_000 with 18 decimals → "0.01". Trailing zeros are dropped.
func formatTokenAmount(_ amount: [UInt8], decimals: Int, decimalSeparator: String) -> String {
    let digits = BigEndianInteger.decimalString(amount)
    guard decimals > 0 else { return digits }

    let padded = String(repeating: "0", count: max(0, decimals + 1 - digits.count)) + digits
    let whole = padded.dropLast(decimals)
    let fraction = padded.suffix(decimals).replacingOccurrences(of: "0+$", with: "", options: .regularExpression)
    return fraction.isEmpty ? String(whole) : "\(whole)\(decimalSeparator)\(fraction)"
}
