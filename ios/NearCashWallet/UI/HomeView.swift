import SwiftUI

/// The one screen you start from: an empty banknote and one action.
struct HomeView: View {
    @Bindable var model: WalletModel

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
                }
            }
            .padding(24)
            .animation(.default, value: model.errorMessage)
            .sheet(item: $model.presentedCheck) { check in
                ResultView(check: check, model: model)
            }
        }
    }
}
