import Foundation

/// The smallest CBOR reader (RFC 8949) that gets a passkey's public key out
/// of a WebAuthn attestation object. iOS hands the new passkey's key over
/// only inside that object: a CBOR map whose "authData" bytes end with the
/// key as a COSE map (see `COSEPublicKey`).
///
/// Only what attestation objects use is supported: unsigned and negative
/// integers, byte and text strings, arrays, maps and simple values, all with
/// definite lengths. Anything else is rejected, never guessed.
indirect enum CBORValue: Equatable {
    case unsigned(UInt64)
    case negative(Int64)          // the value itself, e.g. -7
    case bytes(Data)
    case text(String)
    case array([CBORValue])
    case map([(CBORValue, CBORValue)])
    case simple(UInt8)            // false (20), true (21), null (22)…

    static func == (lhs: CBORValue, rhs: CBORValue) -> Bool {
        switch (lhs, rhs) {
        case let (.unsigned(a), .unsigned(b)): a == b
        case let (.negative(a), .negative(b)): a == b
        case let (.bytes(a), .bytes(b)): a == b
        case let (.text(a), .text(b)): a == b
        case let (.array(a), .array(b)): a == b
        case let (.map(a), .map(b)): a.count == b.count && zip(a, b).allSatisfy { $0.0 == $1.0 && $0.1 == $1.1 }
        case let (.simple(a), .simple(b)): a == b
        default: false
        }
    }

    /// The value stored under `key` in a map, or nil.
    subscript(key: CBORValue) -> CBORValue? {
        guard case let .map(entries) = self else { return nil }
        return entries.first { $0.0 == key }?.1
    }
}

struct CBORError: Error, CustomStringConvertible {
    let description: String
}

struct CBORReader {
    private let bytes: [UInt8]
    /// Where the next item starts: after `read()`, where the item ended.
    private(set) var offset: Int

    init(_ data: Data, offset: Int = 0) {
        bytes = [UInt8](data)
        self.offset = offset
    }

    /// Reads one complete item (with everything nested in it).
    mutating func read() throws -> CBORValue {
        let initial = try byte()
        let majorType = initial >> 5
        let argument = try readArgument(initial & 0x1F)

        switch majorType {
        case 0:
            return .unsigned(argument)
        case 1:
            guard argument < UInt64(Int64.max) else { throw CBORError(description: "negative integer too large") }
            return .negative(-1 - Int64(argument))
        case 2:
            return .bytes(Data(try take(argument)))
        case 3:
            guard let text = String(bytes: try take(argument), encoding: .utf8) else {
                throw CBORError(description: "text string is not UTF-8")
            }
            return .text(text)
        case 4:
            var elements = [CBORValue]()
            for _ in 0..<(try count(argument)) {
                elements.append(try read())
            }
            return .array(elements)
        case 5:
            var entries = [(CBORValue, CBORValue)]()
            for _ in 0..<(try count(argument)) {
                let key = try read()
                entries.append((key, try read()))
            }
            return .map(entries)
        case 7:
            guard argument < 24 else { throw CBORError(description: "floats are not supported") }
            return .simple(UInt8(argument))
        default:
            throw CBORError(description: "major type \(majorType) (tags) is not supported")
        }
    }

    // MARK: - Internals

    private mutating func byte() throws -> UInt8 {
        guard offset < bytes.count else { throw CBORError(description: "truncated at \(offset)") }
        defer { offset += 1 }
        return bytes[offset]
    }

    private mutating func take(_ length: UInt64) throws -> [UInt8] {
        guard length <= UInt64(bytes.count - offset) else { throw CBORError(description: "truncated at \(offset)") }
        defer { offset += Int(length) }
        return Array(bytes[offset..<offset + Int(length)])
    }

    /// The item's argument: in the initial byte up to 23, then in 1, 2, 4 or 8 bytes.
    private mutating func readArgument(_ additional: UInt8) throws -> UInt64 {
        switch additional {
        case 0..<24: return UInt64(additional)
        case 24: return UInt64(try byte())
        case 25: return try take(2).reduce(0) { $0 << 8 | UInt64($1) }
        case 26: return try take(4).reduce(0) { $0 << 8 | UInt64($1) }
        case 27: return try take(8).reduce(0) { $0 << 8 | UInt64($1) }
        default: throw CBORError(description: "indefinite lengths are not supported")
        }
    }

    /// An element count, bounded by the bytes left (each element takes at least one).
    private func count(_ argument: UInt64) throws -> Int {
        guard argument <= UInt64(bytes.count - offset) else { throw CBORError(description: "count \(argument) too large") }
        return Int(argument)
    }
}
