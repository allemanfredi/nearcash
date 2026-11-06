import SwiftUI

/// Redeeming a banknote: read it → where to receive it → the quote →
/// the PIN and one more tap → the outcome. Also resumes a redemption that
/// was interrupted after its intent was prepared (`start: .pin(…)`).
struct RedeemView: View {
    enum Step: Equatable {
        case start
        case details(RedeemableBanknote)
        case review(Redemption)
        case pin(Redemption)
        case finished(Redemption, note: String?)
    }

    let model: RedemptionModel
    @State var step: Step = .start

    @Environment(\.dismiss) private var dismiss
    @State private var destination = Destination.all[0]
    @State private var recipient = ""
    @State private var pin = ""
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Group {
                switch step {
                case .start: startStep
                case let .details(banknote): detailsStep(banknote)
                case let .review(redemption): reviewStep(redemption)
                case let .pin(redemption): pinStep(redemption)
                case let .finished(redemption, note): finishedStep(redemption, note: note)
                }
            }
            .navigationTitle(Strings.redeemTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(Strings.close) { dismiss() }.disabled(model.isBusy)
                }
            }
            .animation(.snappy, value: step)
        }
        .interactiveDismissDisabled(model.isBusy)
    }

    // MARK: - Steps

    private var startStep: some View {
        VStack(spacing: 28) {
            Spacer(minLength: 0)
            BanknoteView(style: .placeholder, isReading: model.isBusy)
            Text(Strings.redeemIntro)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            errorLine
            Spacer(minLength: 0)
            Button {
                Task { await readBanknote() }
            } label: {
                Label(Strings.redeemReadButton, systemImage: "wave.3.right")
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(model.isBusy)
        }
        .padding(24)
    }

    private func detailsStep(_ banknote: RedeemableBanknote) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                BanknoteView(style: .valid, amount: banknote.amountText, symbol: banknote.symbol)

                Text(Strings.redeemDestination).font(.headline)
                Picker(Strings.redeemDestination, selection: $destination) {
                    ForEach(Destination.all) { option in
                        Text(option.label).tag(option)
                    }
                }
                .pickerStyle(.menu)

                Text(Strings.redeemRecipient).font(.headline)
                TextField(Strings.recipientPlaceholder(destination.addressKind), text: $recipient)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.body.monospaced())
                    .padding(12)
                    .background(Color(.secondarySystemBackground), in: .rect(cornerRadius: 12))

                errorLine
            }
            .padding(24)
        }
        .safeAreaInset(edge: .bottom) {
            Button {
                Task { await prepare(banknote) }
            } label: {
                if model.isBusy { ProgressView().tint(Theme.onAccent) } else { Text(Strings.redeemQuoteButton) }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(recipient.isEmpty || model.isBusy)
            .padding(24)
        }
    }

    private func reviewStep(_ redemption: Redemption) -> some View {
        ScrollView {
            VStack(spacing: 20) {
                BanknoteView(style: .valid, amount: redemption.amountText, symbol: redemption.symbol)
                Label(Strings.redeemYouReceive(redemption.expectedAmountOut, redemption.destination), systemImage: "arrow.down.circle.fill")
                    .font(.title3.bold())
                    .foregroundStyle(Theme.accent)
                    .multilineTextAlignment(.center)
                Text(redemption.recipient)
                    .font(.footnote.monospaced())
                    .foregroundStyle(.secondary)
                    .textSelection(.enabled)
                Text(Strings.redeemRefundNote)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(24)
        }
        .safeAreaInset(edge: .bottom) {
            Button(Strings.continueButton) {
                errorMessage = nil
                step = .pin(redemption)
            }
            .buttonStyle(PrimaryButtonStyle())
            .padding(24)
        }
    }

    private func pinStep(_ redemption: Redemption) -> some View {
        PinEntryView(
            stepNumber: 3,
            totalSteps: 3,
            title: Strings.redeemPinTitle,
            subtitle: Strings.redeemPinSubtitle,
            pin: $pin,
            errorMessage: errorMessage,
            isWorking: model.isBusy
        ) {
            Task { await sign(redemption) }
        }
    }

    private func finishedStep(_ redemption: Redemption, note: String?) -> some View {
        VStack(spacing: 20) {
            Spacer()
            Label(title(of: redemption), systemImage: symbol(of: redemption))
                .font(.title2.bold())
                .foregroundStyle(redemption.stage == .succeeded ? Theme.accent : .orange)
                .multilineTextAlignment(.center)
            Text(note ?? detail(of: redemption))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Spacer()
            Button(Strings.done) { dismiss() }
                .buttonStyle(PrimaryButtonStyle())
        }
        .padding(24)
        .sensoryFeedback(.success, trigger: redemption.stage == .succeeded)
    }

    @ViewBuilder
    private var errorLine: some View {
        if let errorMessage {
            Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                .font(.footnote)
                .foregroundStyle(.red)
        }
    }

    // MARK: - Actions

    private func readBanknote() async {
        errorMessage = nil
        do {
            step = .details(try await model.readBanknote())
        } catch ReaderError.cancelled {
            // nothing to say
        } catch RedemptionFlowError.spent {
            errorMessage = Strings.messageSpent
        } catch let RedemptionFlowError.invalid(failure) {
            errorMessage = Strings.failure(failure)
        } catch {
            errorMessage = WalletModel.describe(error)
        }
    }

    private func prepare(_ banknote: RedeemableBanknote) async {
        errorMessage = nil
        guard destination.looksLikeAddress(recipient) else {
            errorMessage = Strings.redeemAddressInvalid
            return
        }
        do {
            step = .review(try await model.prepare(banknote, destination: destination, recipient: recipient))
        } catch RefundPasskeyError.cancelled {
            // the passkey sheet was closed
        } catch RefundPasskeyError.notConfigured {
            errorMessage = Strings.redeemNotConfigured
        } catch {
            errorMessage = WalletModel.describe(error)
        }
    }

    private func sign(_ redemption: Redemption) async {
        errorMessage = nil
        let outcome = await model.sign(redemption, pin: pin)
        switch outcome {
        case let .done(updated):
            pin = ""
            step = .finished(updated, note: nil)
        case let .notSent(updated, reason):
            pin = ""
            step = .finished(updated, note: Strings.redeemNotSent(reason))
        case let .wrongPin(triesLeft):
            pin = ""
            errorMessage = Strings.wrongPin(triesLeft: triesLeft)
        case .pinBlocked:
            pin = ""
            errorMessage = Strings.pinBlocked
        case .otherCard:
            errorMessage = Strings.redeemOtherCard
        case .alreadySpent:
            pin = ""
            errorMessage = Strings.redeemAlreadySpent
        case .cancelled:
            break // stay here: the holder can tap again
        case let .failed(message):
            errorMessage = message
        }
    }

    // MARK: - Texts

    private func title(of redemption: Redemption) -> String {
        switch redemption.stage {
        case .succeeded: Strings.redeemSucceeded
        case .refunded: Strings.redeemRefunded
        case .failed: Strings.redeemFailed
        default: Strings.redeemPending
        }
    }

    private func detail(of redemption: Redemption) -> String {
        switch redemption.stage {
        case .succeeded: Strings.redeemSucceededDetail(redemption.destination, redemption.recipient)
        case .refunded: Strings.redeemRefundedDetail
        case .failed: Strings.redeemFailedDetail
        default: Strings.redeemPendingDetail
        }
    }

    private func symbol(of redemption: Redemption) -> String {
        switch redemption.stage {
        case .succeeded: "checkmark.seal.fill"
        case .refunded: "arrow.uturn.backward.circle.fill"
        case .failed: "exclamationmark.triangle.fill"
        default: "clock.fill"
        }
    }
}
