import Foundation

/// Every user-facing text, in one place (English). To translate the app,
/// translate this file (or move it to a String Catalog).
enum Strings {
    /// Dates and numbers follow the language of the texts, whatever the device region.
    static let locale = Locale(identifier: "en_US")
    static let decimalSeparator = locale.decimalSeparator ?? "."

    // Home
    static let homeTitle = "Check a banknote"
    static let homeSubtitle = "Hold the card near the top of the iPhone. It works offline too."
    static let verifyButton = "Check banknote"

    // NFC sheet
    static let promptVerify = "Hold the banknote near the top of the iPhone"
    static let promptTakeOver = "Hold the banknote near the iPhone again to take it over"
    static let nfcOneCardOnly = "Hold just one NearCash banknote"
    static let nfcConnectionLost = "Connection lost, try again"
    static let nfcSheetError = "Something went wrong"
    static let nfcValid = "Valid banknote"
    static let nfcSpent = "Banknote already spent"
    static let nfcInvalid = "Invalid banknote"
    static let nfcTakenOver = "The banknote is yours"

    // Result
    static let statusValid = "Valid banknote"
    static let statusSpent = "Already spent"
    static let statusInvalid = "Not valid"
    static let messageValid = "Genuine and never redeemed. You can accept it."
    static let issuer = "Issuer"
    static let issuedAt = "Issued on"
    static let pinTries = "PIN attempts"
    static let takeOverButton = "Take it over"
    static let close = "Close"
    static let stampSpent = "SPENT"
    static let stampInvalid = "INVALID"

    static func failure(_ failure: BanknoteCheck.Failure) -> String {
        switch failure {
        case .notIssued: "This card is not an issued banknote."
        case .malformedCertificate: "The banknote's certificate cannot be read."
        case .untrustedIssuer: "Issued by an unknown issuer: do not accept it."
        case .badCertificateSignature: "The certificate has been altered: do not accept it."
        case .keyMismatch: "The certificate belongs to another card: possibly a fake."
        case .badAuthSignature: "The card failed the authenticity check: possibly a fake."
        case .stateMismatch: "The card gave inconsistent answers: do not accept it."
        }
    }

    static let messageSpent = "This banknote has already been redeemed and is worth nothing."

    // Take over (CHANGE_PIN)
    static let givenPinTitle = "PIN you were given"
    static let givenPinSubtitle = "Enter the PIN the person giving you the banknote told you."
    static let newPinTitle = "New PIN"
    static let newPinSubtitle = "Choose 4–8 digits. From now on only you can redeem it."
    static let confirmPinTitle = "Confirm the PIN"
    static let confirmPinSubtitle = "Enter the new PIN again."
    static let continueButton = "Continue"
    static func step(_ number: Int, of total: Int) -> String { "Step \(number) of \(total)" }
    static let pinMismatch = "The two PINs do not match. Try again."
    static let pinSameAsGiven = "The new PIN must differ from the one you were given."
    static func wrongPin(triesLeft: Int) -> String {
        "Wrong PIN. Attempts left: \(triesLeft)."
    }
    static let pinBlocked = "PIN blocked: this banknote can no longer be redeemed."
    static let successTitle = "The banknote is yours"
    static let successSubtitle = "You changed the PIN: now only you can redeem it."
    static let done = "Done"
    static func pinDigitsEntered(_ count: Int) -> String { "\(count) digits entered" }
    static let pinDelete = "Delete"

    // Redemption
    static let redeemButton = "Redeem a banknote"
    static let redeemTitle = "Redeem"
    static let redeemIntro = "The banknote sends its value to an address of yours, on the network you choose. It signs only once: from then on it is worth nothing."
    static let redeemReadButton = "Read the banknote"
    static let promptRedeemRead = "Hold the banknote to redeem near the iPhone"
    static let promptRedeemSign = "Hold the banknote near the iPhone again: it signs the redemption"
    static let nfcRedeemSigned = "Redemption signed"
    static let redeemDestination = "Where you receive it"
    static let redeemRecipient = "Your address"
    static func recipientPlaceholder(_ kind: Destination.AddressKind) -> String {
        switch kind {
        case .evm: "0x…"
        case .solana: "Solana address"
        case .near: "account.near"
        }
    }
    static let redeemAddressInvalid = "This address does not look valid for the chosen network."
    static let redeemQuoteButton = "Get a quote"
    static func redeemYouReceive(_ amount: String, _ destination: String) -> String {
        "You receive about \(amount) \(destination)"
    }
    static let redeemRefundNote = "If anything goes wrong, the value goes back to your refund account inside FAR, protected by your passkey: never to the banknote."
    static let redeemPinTitle = "Banknote PIN"
    static let redeemPinSubtitle = "With the PIN the banknote signs the redemption. Afterwards it can never sign again."
    static let redeemSucceeded = "Redemption complete"
    static func redeemSucceededDetail(_ destination: String, _ recipient: String) -> String {
        "The value was sent to \(recipient) (\(destination))."
    }
    static let redeemRefunded = "Redemption failed: value refunded"
    static let redeemRefundedDetail = "The value is in your refund account inside FAR. You can withdraw it from Redemptions."
    static let redeemFailed = "Redemption failed"
    static let redeemFailedDetail = "1Click could not complete it. Check its status from Redemptions."
    static let redeemPending = "Redemption in progress"
    static let redeemPendingDetail = "1Click is carrying it out. Its status updates from Redemptions."
    static func redeemNotSent(_ reason: String) -> String {
        "Signed but not sent: \(reason). Try again from Redemptions: the banknote has already signed."
    }
    static let redeemOtherCard = "This is not the banknote you are redeeming."
    static let redeemAlreadySpent = "This banknote has already been redeemed by another redemption."
    static let redeemNotConfigured = "Redemption is not set up in this build (1Click key or passkey domain missing)."
    static let passkeyName = "NearCash · refund account"

    // Redemptions list and refunds
    static let redemptionsTitle = "Redemptions"
    static let redemptionsEmpty = "No redemptions on this iPhone."
    static let refundAccount = "Refund account (FAR)"
    static let refundAccountNone = "Created with a passkey at your first redemption."
    static let resumeButton = "Resume"
    static let sendAgainButton = "Send again"
    static let refreshButton = "Refresh"
    static let withdrawRefundButton = "Withdraw the refund"
    static let withdrawTitle = "Withdraw the refund"
    static let withdrawConfirm = "Withdraw with the passkey"
    static let withdrawDone = "Refund withdrawn"
    static func withdrawStatus(_ status: String) -> String { "Withdrawal: \(status)" }
    static func stage(_ stage: Redemption.Stage) -> String {
        switch stage {
        case .awaitingSignature: "To sign"
        case .signed: "Signed, to send"
        case .submitted: "In progress"
        case .succeeded: "Complete"
        case .refunded: "Refunded"
        case .failed: "Failed"
        }
    }

    // Errors
    static let nfcUnavailable = "This device cannot read NFC cards."
    static let connectionLost = "The banknote moved away. Try again, holding it still."
    static func generic(_ error: Error) -> String {
        "Error: \(error)"
    }
}
