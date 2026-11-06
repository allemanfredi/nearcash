import SwiftUI

/// Taking over a banknote after the deal, in three short steps:
/// the PIN the giver tells you → your new PIN → confirm → one tap.
struct TakeOverView: View {
    let model: WalletModel
    /// The banknote being taken over, shown on the success screen.
    let certificate: BanknoteCertificate?
    /// Closes the whole result sheet.
    let onFinished: () -> Void

    private enum Step {
        case givenPin, newPin, confirmPin, done
    }

    @State private var step: Step = .givenPin
    @State private var givenPin = ""
    @State private var newPin = ""
    @State private var confirmPin = ""
    @State private var errorMessage: String?
    @State private var takenOver = false

    var body: some View {
        Group {
            switch step {
            case .givenPin:
                PinEntryView(
                    stepNumber: 1,
                    title: Strings.givenPinTitle,
                    subtitle: Strings.givenPinSubtitle,
                    pin: $givenPin,
                    errorMessage: errorMessage,
                    isWorking: false
                ) { advance(to: .newPin) }
            case .newPin:
                PinEntryView(
                    stepNumber: 2,
                    title: Strings.newPinTitle,
                    subtitle: Strings.newPinSubtitle,
                    pin: $newPin,
                    errorMessage: errorMessage,
                    isWorking: false
                ) {
                    if newPin == givenPin {
                        errorMessage = Strings.pinSameAsGiven
                        newPin = ""
                    } else {
                        advance(to: .confirmPin)
                    }
                }
            case .confirmPin:
                PinEntryView(
                    stepNumber: 3,
                    title: Strings.confirmPinTitle,
                    subtitle: Strings.confirmPinSubtitle,
                    pin: $confirmPin,
                    errorMessage: errorMessage,
                    isWorking: model.isBusy
                ) {
                    if confirmPin == newPin {
                        Task { await submit() }
                    } else {
                        errorMessage = Strings.pinMismatch
                        newPin = ""
                        confirmPin = ""
                        step = .newPin
                    }
                }
            case .done:
                SuccessView(certificate: certificate, onFinished: onFinished)
            }
        }
        .animation(.snappy, value: step)
        .navigationBarBackButtonHidden(step == .done)
        .sensoryFeedback(.success, trigger: takenOver)
    }

    private func advance(to next: Step) {
        errorMessage = nil
        step = next
    }

    /// One tap: verify again, then CHANGE_PIN.
    private func submit() async {
        switch await model.takeOver(givenPin: givenPin, newPin: newPin) {
        case .success:
            takenOver = true
            step = .done
        case let .wrongPin(triesLeft):
            restart(at: .givenPin, message: Strings.wrongPin(triesLeft: triesLeft))
        case .pinBlocked:
            restart(at: .givenPin, message: Strings.pinBlocked)
        case let .notValid(check):
            switch check.outcome {
            case .spent: restart(at: .givenPin, message: Strings.messageSpent)
            case let .invalid(failure): restart(at: .givenPin, message: Strings.failure(failure))
            case .valid: break // not reachable: a valid card is never reported as notValid
            }
        case .cancelled:
            confirmPin = "" // stay on the last step; the user can tap again
        case let .failed(message):
            errorMessage = message
            confirmPin = ""
        }
    }

    private func restart(at first: Step, message: String) {
        givenPin = ""
        newPin = ""
        confirmPin = ""
        errorMessage = message
        step = first
    }
}

/// The banknote is yours.
private struct SuccessView: View {
    let certificate: BanknoteCertificate?
    let onFinished: () -> Void
    @State private var appeared = false

    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            BanknoteView(
                style: .valid,
                amount: certificate?.formattedAmount(decimalSeparator: Strings.decimalSeparator),
                symbol: certificate?.symbol
            )
            .padding(.bottom, 12)
            Label(Strings.successTitle, systemImage: "checkmark.seal.fill")
                .font(.title2.bold())
                .foregroundStyle(Theme.accent)
                .symbolEffect(.bounce, value: appeared)
                .accessibilityIdentifier("takeOverSuccess")
            Text(Strings.successSubtitle)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Spacer()
            Button(Strings.done, action: onFinished)
                .buttonStyle(PrimaryButtonStyle())
                .accessibilityIdentifier("takeOverDone")
        }
        .padding(24)
        .onAppear { appeared = true }
    }
}
