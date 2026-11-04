import Foundation

/// Constants of the NearCash card protocol. They mirror docs/protocol.md and
/// the applet (applet/src/main/java/.../NearCashApplet.java) exactly.
enum NearCashProtocol {

    /// Applet AID (protocol.md §3). Also listed in Info.plist, otherwise iOS
    /// would not report the card to the app.
    static let appletAID = Data([0xF0, 0x4E, 0x42, 0x41, 0x4E, 0x4B, 0x01])

    /// Proprietary class byte used by every NearCash command.
    static let cla: UInt8 = 0x80

    /// Prefix of every AUTH message (protocol.md §5.3).
    static let authDomainTag = Data("NBK-AUTH-v1".utf8)

    /// We always send 32-byte AUTH challenges (the card accepts 16–64).
    static let challengeLength = 32

    /// Uncompressed SEC1 public key, as the card sends keys: 0x04 ‖ X ‖ Y.
    static let publicKeyLength = 65

    /// Largest GET_CERT chunk we ask for (short APDU, Le ≤ 256).
    static let maxReadChunk = 255

    static let pinLengths = 4...8

    /// True if `pin` is 4–8 ASCII digits, the only PINs the card accepts.
    static func isValidPin(_ pin: String) -> Bool {
        pinLengths.contains(pin.count) && pin.unicodeScalars.allSatisfy { ("0"..."9").contains($0) }
    }
}

/// Instruction bytes (protocol.md §5). Only the commands the wallet uses.
enum Instruction: UInt8 {
    case info = 0x10
    case getCertificate = 0x12
    case auth = 0x20
    case changePin = 0x32
}

/// Card life-cycle states (protocol.md §4). They only move forward.
enum CardState: UInt8 {
    case empty = 0x00
    case keysGenerated = 0x01
    case issued = 0x02
    case spent = 0x03
}

/// Status words the card can return (protocol.md §6).
enum StatusWord {
    static let ok: UInt16 = 0x9000
    static let conditionsNotSatisfied: UInt16 = 0x6985
    static let pinBlocked: UInt16 = 0x6983
}
