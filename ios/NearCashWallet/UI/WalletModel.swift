import Foundation
import Observation

/// Outcome of taking over a banknote (verify + CHANGE_PIN in one tap).
enum TakeOverResult: Equatable {
    case success(BanknoteCheck)
    case wrongPin(triesLeft: Int)
    case pinBlocked
    /// The card is not (or no longer) a valid banknote: nothing was changed.
    case notValid(BanknoteCheck)
    case cancelled
    case failed(String)
}

/// App state and the two user actions. Views stay thin: everything that
/// touches the card goes through here.
@MainActor
@Observable
final class WalletModel {

    let reader: CardReader
    let verifier: BanknoteVerifier

    /// True while a card operation is in progress.
    private(set) var isBusy = false
    /// The last check, presented as a sheet.
    var presentedCheck: BanknoteCheck?
    /// Shown on the home screen when a verification fails to complete.
    var errorMessage: String?

    init(reader: CardReader, verifier: BanknoteVerifier) {
        self.reader = reader
        self.verifier = verifier
    }

    /// The app's default wiring: the iPhone's NFC reader and the trusted issuers.
    static func makeDefault() -> WalletModel {
        WalletModel(reader: NFCCardReader(), verifier: BanknoteVerifier(trustedIssuers: TrustedIssuers.all))
    }

    // MARK: - Verify

    func verify() async {
        guard !isBusy else { return }
        isBusy = true
        errorMessage = nil
        defer { isBusy = false }

        do {
            presentedCheck = try await reader.withCard(
                prompt: Strings.promptVerify,
                task: { card in try await verifier.check(card) },
                successMessage: Self.sheetMessage(for:)
            )
        } catch ReaderError.cancelled {
            // The user closed the NFC sheet: nothing to report.
        } catch {
            errorMessage = Self.describe(error)
        }
    }

    // MARK: - Take over

    /// Verifies the card again and, only if it is valid, replaces the giver's
    /// PIN with the receiver's. Both happen during the same tap, so nobody can
    /// swap the card in between.
    func takeOver(givenPin: String, newPin: String) async -> TakeOverResult {
        guard !isBusy else { return .failed(Strings.nfcSheetError) }
        isBusy = true
        defer { isBusy = false }

        do {
            return try await reader.withCard(
                prompt: Strings.promptTakeOver,
                task: { card -> TakeOverResult in
                    let check = try await verifier.check(card)
                    guard check.outcome == .valid else { return .notValid(check) }
                    try await card.changePin(from: givenPin, to: newPin)
                    // CHANGE_PIN resets the try counter: show the card as it is now.
                    let updated = BanknoteCheck(
                        outcome: .valid,
                        info: try await card.info(),
                        certificate: check.certificate,
                        issuer: check.issuer
                    )
                    return .success(updated)
                },
                successMessage: { result in
                    if case .success = result { return Strings.nfcTakenOver }
                    return Strings.nfcInvalid
                }
            )
        } catch ReaderError.cancelled {
            return .cancelled
        } catch let error as CardError where error.pinTriesLeft != nil {
            return error.pinTriesLeft == 0 ? .pinBlocked : .wrongPin(triesLeft: error.pinTriesLeft!)
        } catch {
            return .failed(Self.describe(error))
        }
    }

    // MARK: - Messages

    private static func sheetMessage(for check: BanknoteCheck) -> String {
        switch check.outcome {
        case .valid: Strings.nfcValid
        case .spent: Strings.nfcSpent
        case .invalid: Strings.nfcInvalid
        }
    }

    static func describe(_ error: Error) -> String {
        switch error {
        case ReaderError.nfcUnavailable: Strings.nfcUnavailable
        case ReaderError.connectionLost: Strings.connectionLost
        default: Strings.generic(error)
        }
    }
}
