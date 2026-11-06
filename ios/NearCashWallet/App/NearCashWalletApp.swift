import SwiftUI

/// NearCash Wallet: check a banknote and take it over (fully native,
/// offline), or redeem it to an address of yours (online, through 1Click).
@main
struct NearCashWalletApp: App {
    @State private var model = WalletModel.makeDefault()
    @State private var redemptions = RedemptionModel(
        reader: NFCCardReader(),
        verifier: BanknoteVerifier(trustedIssuers: TrustedIssuers.all),
        config: .current
    )

    var body: some Scene {
        WindowGroup {
            HomeView(model: model, redemptions: redemptions)
                .tint(Theme.accent)
        }
    }
}
