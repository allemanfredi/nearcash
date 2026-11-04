import Foundation

/// Where the app gets a card from. One "tap" = one call to `withCard`:
/// wait for a card, run `task` with it, release it.
///
/// - `NFCCardReader`: the iPhone's NFC, the only reader (real cards). In the
///   iOS Simulator, which has no NFC, every tap ends in `nfcUnavailable`.
@MainActor
protocol CardReader: AnyObject {
    /// - Parameters:
    ///   - prompt: what to tell the user while waiting for the card
    ///   - task: the protocol work to do with the card
    ///   - successMessage: shown in the system NFC sheet when `task` succeeds
    func withCard<T>(
        prompt: String,
        task: (NearCashCard) async throws -> T,
        successMessage: (T) -> String
    ) async throws -> T
}

enum ReaderError: Error, Equatable {
    /// This device has no NFC reader (e.g. the Simulator, iPad).
    case nfcUnavailable
    /// The user closed the NFC sheet: not an error worth showing.
    case cancelled
    /// The card left the field or the NFC session ended unexpectedly.
    case connectionLost
}
