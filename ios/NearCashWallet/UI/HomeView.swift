import SwiftUI

/// The screen you start from: an empty banknote, checking one (offline),
/// redeeming one, and the redemptions started on this iPhone.
struct HomeView: View {
    @Bindable var model: WalletModel
    let redemptions: RedemptionModel

    @State private var isRedeeming = false
    @State private var isShowingRedemptions = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 32) {
                Spacer(minLength: 0)

                BanknoteView(style: .placeholder, isReading: model.isBusy)
                    .padding(.horizontal, 8)

                VStack(spacing: 10) {
                    Text(Strings.homeTitle)
                        .font(.title.bold())
                    Text(Strings.homeSubtitle)
                        .font(.body)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }

                Spacer(minLength: 0)

                VStack(spacing: 16) {
                    if let errorMessage = model.errorMessage {
                        Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                            .font(.subheadline)
                            .foregroundStyle(.red)
                            .multilineTextAlignment(.center)
                            .accessibilityIdentifier("homeError")
                            .transition(.opacity)
                    }

                    Button {
                        Task { await model.verify() }
                    } label: {
                        Label(Strings.verifyButton, systemImage: "wave.3.right")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(model.isBusy)
                    .accessibilityIdentifier("verifyButton")

                    Button(Strings.redeemButton) { isRedeeming = true }
                        .buttonStyle(SecondaryButtonStyle())
                        .disabled(model.isBusy || !redemptions.config.canRedeem)
                        .accessibilityIdentifier("redeemButton")
                    if !redemptions.config.canRedeem {
                        Text(Strings.redeemNotConfigured)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                }
            }
            .padding(24)
            .animation(.default, value: model.errorMessage)
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        isShowingRedemptions = true
                    } label: {
                        Label(Strings.redemptionsTitle, systemImage: "clock.arrow.circlepath")
                    }
                    // A dot when something is left to do (a redemption to finish, a refund to withdraw).
                    .overlay(alignment: .topTrailing) {
                        if !redemptions.open.isEmpty {
                            Circle().fill(.orange).frame(width: 8, height: 8)
                        }
                    }
                    .accessibilityIdentifier("redemptionsButton")
                }
            }
            .sheet(item: $model.presentedCheck) { check in
                ResultView(check: check, model: model)
            }
            .sheet(isPresented: $isRedeeming) {
                RedeemView(model: redemptions)
            }
            .sheet(isPresented: $isShowingRedemptions) {
                RedemptionsView(model: redemptions)
            }
        }
    }
}
