import Foundation

/// Where a banknote's value is held inside FAR: what redeeming it moves.
struct FundsLocation: Hashable, Codable {
    /// 1Click asset id of the token, e.g. "nep141:eth-0xa0b8…eb48.omft.near".
    let tokenId: String
    /// FAR's intents contract, "intents.far": what every intent is signed for.
    let contractId: String

    /// USDC on Ethereum inside FAR: the bank's reserve token, which backs
    /// every NearCash banknote (the issuance server's NEARCASH_RESERVE_TOKEN).
    static let usdcOnFar = FundsLocation(
        tokenId: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near",
        contractId: "intents.far"
    )

    /// The placeholder funds the testnet issuer contract was deployed with,
    /// which its certificates repeat (docs/protocol.md §11, testnet deployment).
    static let testnetPlaceholder = FundsLocation(tokenId: "nep141:usdc.far.testnet", contractId: "intents.far.testnet")

    /// Where a certified banknote holds its value: what its certificate says,
    /// except for the testnet placeholder. Banknotes certified with it are
    /// funded by the issuance server in USDC on Ethereum inside FAR, so that
    /// is what redeeming them moves. An issuer contract deployed with the
    /// real token needs no exception.
    static func of(_ certificate: BanknoteCertificate) -> FundsLocation {
        let written = FundsLocation(tokenId: certificate.tokenId, contractId: certificate.contractId)
        return written == testnetPlaceholder ? usdcOnFar : written
    }
}
