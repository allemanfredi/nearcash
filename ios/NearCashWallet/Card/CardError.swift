import Foundation

/// Something went wrong while talking to the card.
enum CardError: Error, Equatable {
    /// The card answered with a status word other than 9000.
    case status(command: String, statusWord: UInt16)
    /// The card's answer does not have the expected shape.
    case malformedResponse(command: String, reason: String)

    /// Attempts left after a wrong PIN (SW 63Cx), 0 when blocked, otherwise nil.
    var pinTriesLeft: Int? {
        guard case let .status(_, statusWord) = self else { return nil }
        if statusWord & 0xFFF0 == 0x63C0 { return Int(statusWord & 0x000F) }
        if statusWord == StatusWord.pinBlocked { return 0 }
        return nil
    }
}

extension CardError: CustomStringConvertible {
    var description: String {
        switch self {
        case let .status(command, statusWord):
            return "\(command) failed with SW \(String(format: "%04X", statusWord))"
        case let .malformedResponse(command, reason):
            return "\(command): malformed response (\(reason))"
        }
    }
}
