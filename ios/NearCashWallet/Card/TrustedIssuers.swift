import Foundation

/// An issuer (an ATM) whose banknotes the app accepts.
struct TrustedIssuer: Equatable, Hashable {
    let name: String
    /// Compressed SEC1 public key (33 bytes).
    let publicKey: Data
}

enum TrustedIssuers {

    /// Issuers accepted in every build.
    ///
    /// NearCash certificates are signed by the NEAR MPC network: the key is
    /// the one MPC derives for our issuer contract, so it exists nowhere in
    /// full. Print it with `pnpm issuer:admin public-key`.
    static let production: [TrustedIssuer] = [
        TrustedIssuer(
            name: "NearCash · NEAR MPC (testnet)",
            // derived_public_key(path: "nearbank-certificates-v1",
            //                    predecessor: "nearbank-issuer-56b0c6.testnet") on v1.signer-prod.testnet
            // (on-chain names from before the rename: changing them changes this key)
            publicKey: Data(hex: "03e38503df708b9f40ee5a6f7669732229bf1feafe4492ccac028e7e2b778337f8")!
        ),
    ]

    #if DEBUG
    /// DEVELOPMENT ONLY: the public DEV issuer of packages/core/src/dev.ts.
    /// Its secret is derived from a public string, so anyone can forge
    /// certificates with it. It is compiled into Debug builds only.
    static let development = TrustedIssuer(
        name: "NearCash DEV (non sicuro)",
        publicKey: Data(hex: "02ad39122fd36f3fa5a3ff43f7bd82608e88b4343c1a0f4405b66ecc0d4d47bf8c")!
    )

    static let all: [TrustedIssuer] = production + [development]
    #else
    static let all: [TrustedIssuer] = production
    #endif
}
