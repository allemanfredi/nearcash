import Foundation

/// Where a holder can receive a redeemed banknote: a token on a chain, as
/// 1Click names it. The same list the ATM accepts payments in
/// (packages/kiosk-api/src/payment-options.ts), checked against the live
/// 1Click token list on 2026-11-04.
///
/// USDC on Ethereum is the banknotes' own token: choosing it swaps nothing,
/// it only withdraws (1Click charges the Ethereum withdrawal fee).
struct Destination: Identifiable, Hashable {
    enum AddressKind: Hashable { case evm, solana, near }

    let id: String
    /// 1Click asset id.
    let assetId: String
    let token: String
    let network: String
    let addressKind: AddressKind

    var label: String { "\(token) · \(network)" }

    static let all: [Destination] = [
        Destination(id: "usdc-ethereum", assetId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", token: "USDC", network: "Ethereum", addressKind: .evm),
        Destination(id: "usdc-base", assetId: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", token: "USDC", network: "Base", addressKind: .evm),
        Destination(id: "usdc-arbitrum", assetId: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", token: "USDC", network: "Arbitrum", addressKind: .evm),
        Destination(id: "usdc-solana", assetId: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", token: "USDC", network: "Solana", addressKind: .solana),
        Destination(id: "usdc-near", assetId: "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1", token: "USDC", network: "NEAR", addressKind: .near),
        Destination(id: "eth-ethereum", assetId: "nep141:eth.omft.near", token: "ETH", network: "Ethereum", addressKind: .evm),
        Destination(id: "sol-solana", assetId: "nep141:sol.omft.near", token: "SOL", network: "Solana", addressKind: .solana),
    ]

    /// A rough format check before asking 1Click, which checks the address for real.
    func looksLikeAddress(_ text: String) -> Bool {
        let address = text.trimmingCharacters(in: .whitespacesAndNewlines)
        switch addressKind {
        case .evm:
            return address.count == 42 && address.hasPrefix("0x") && Data(hex: String(address.dropFirst(2))) != nil
        case .solana:
            let base58 = CharacterSet(charactersIn: "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz")
            return (32...44).contains(address.count) && address.unicodeScalars.allSatisfy(base58.contains)
        case .near:
            let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyz0123456789-_.")
            return (2...64).contains(address.count) && address.unicodeScalars.allSatisfy(allowed.contains)
        }
    }
}
