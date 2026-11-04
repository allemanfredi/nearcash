import SwiftUI

/// NearCash Wallet: verify a banknote, take it over. Fully native, offline.
@main
struct NearCashWalletApp: App {
    @State private var model = WalletModel.makeDefault()

    var body: some Scene {
        WindowGroup {
            HomeView(model: model)
                .tint(Theme.accent)
        }
    }
}
