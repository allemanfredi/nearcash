import SwiftUI

/// The redemptions started on this iPhone, the refund account, and what is
/// left to do: resume a redemption, send it again, withdraw a refund.
struct RedemptionsView: View {
    let model: RedemptionModel

    @Environment(\.dismiss) private var dismiss
    @State private var resuming: Redemption?
    @State private var withdrawing: Redemption?
    @State private var message: String?

    var body: some View {
        NavigationStack {
            List {
                Section(Strings.refundAccount) {
                    if let account = model.refundAccount {
                        Text(account.accountId)
                            .font(.footnote.monospaced())
                            .textSelection(.enabled)
                    } else {
                        Text(Strings.refundAccountNone).foregroundStyle(.secondary)
                    }
                }

                Section(Strings.redemptionsTitle) {
                    if model.redemptions.isEmpty {
                        Text(Strings.redemptionsEmpty).foregroundStyle(.secondary)
                    }
                    ForEach(model.redemptions) { redemption in
                        row(redemption)
                    }
                }

                if let message {
                    Section { Text(message).foregroundStyle(.secondary) }
                }
            }
            .navigationTitle(Strings.redemptionsTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(Strings.close) { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    Button(Strings.refreshButton) { Task { await model.refreshOpen() } }
                        .disabled(model.isBusy)
                }
            }
            .task { await model.refreshOpen() }
            .sheet(item: $resuming) { redemption in
                RedeemView(model: model, step: .pin(redemption))
            }
            .navigationDestination(item: $withdrawing) { redemption in
                RefundWithdrawView(model: model, redemption: redemption)
            }
        }
    }

    private func row(_ redemption: Redemption) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("\(redemption.amountText) \(redemption.symbol) → \(redemption.destination)")
                    .font(.headline)
                Spacer()
                Text(Strings.stage(redemption.stage))
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(redemption.stage == .succeeded ? Theme.accent : .orange)
            }
            Text(redemption.recipient)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)
            Text(redemption.createdAt, format: .dateTime.locale(Strings.locale))
                .font(.caption)
                .foregroundStyle(.secondary)

            switch redemption.stage {
            case .awaitingSignature:
                // The card may have signed already: the same digest gives the same signature back.
                Button(Strings.resumeButton) { resuming = redemption }
            case .signed:
                Button(Strings.sendAgainButton) { Task { await sendAgain(redemption) } }
                    .disabled(model.isBusy)
            case .refunded where !redemption.refundWithdrawn:
                Button(Strings.withdrawRefundButton) { withdrawing = redemption }
            default:
                EmptyView()
            }
        }
        .buttonStyle(.borderless)
        .padding(.vertical, 4)
    }

    private func sendAgain(_ redemption: Redemption) async {
        switch await model.send(redemption) {
        case let .notSent(_, reason): message = Strings.redeemNotSent(reason)
        default: message = nil
        }
    }
}

/// Withdrawing a refund from the refund account to an address of the
/// holder's: the passkey signs (Face ID), 1Click moves it.
struct RefundWithdrawView: View {
    let model: RedemptionModel
    let redemption: Redemption

    @State private var destination = Destination.all[0]
    @State private var recipient = ""
    @State private var outcome: String?
    @State private var succeeded = false

    var body: some View {
        Form {
            Section {
                Text("\(redemption.refundedAmountText ?? redemption.amountText) \(redemption.symbol)")
                    .font(.title3.bold())
            }
            Section(Strings.redeemDestination) {
                Picker(Strings.redeemDestination, selection: $destination) {
                    ForEach(Destination.all) { option in
                        Text(option.label).tag(option)
                    }
                }
                TextField(Strings.recipientPlaceholder(destination.addressKind), text: $recipient)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .font(.body.monospaced())
            }
            if let outcome {
                Section { Text(outcome).foregroundStyle(succeeded ? Theme.accent : .red) }
            }
            Section {
                Button(Strings.withdrawConfirm) { Task { await withdraw() } }
                    .disabled(recipient.isEmpty || model.isBusy || succeeded)
            }
        }
        .navigationTitle(Strings.withdrawTitle)
    }

    private func withdraw() async {
        guard destination.looksLikeAddress(recipient) else {
            outcome = Strings.redeemAddressInvalid
            return
        }
        do {
            let status = try await model.withdrawRefund(of: redemption, destination: destination, recipient: recipient)
            succeeded = status.status == "SUCCESS"
            outcome = succeeded ? Strings.withdrawDone : Strings.withdrawStatus(status.status)
        } catch RefundPasskeyError.cancelled {
            outcome = nil
        } catch {
            outcome = WalletModel.describe(error)
        }
    }
}
