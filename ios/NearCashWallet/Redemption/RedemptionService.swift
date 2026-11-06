import Foundation

/// A verified banknote, ready to be redeemed.
struct RedeemableBanknote: Equatable {
    /// Key F, uncompressed SEC1 (65 bytes), as the card reports it.
    let fundsPublicKey: Data
    /// The card's account inside FAR: the Ethereum address of F.
    let accountId: String
    let funds: FundsLocation
    /// Smallest units, decimal digits.
    let amount: String
    let amountText: String
    let symbol: String

    /// The banknote a verified certificate describes, with the key F the card reported.
    init(certificate: BanknoteCertificate, fundsPublicKey: Data) throws {
        try self.init(
            fundsPublicKey: fundsPublicKey,
            funds: FundsLocation.of(certificate),
            amount: BigEndianInteger.decimalString(certificate.amount),
            amountText: certificate.formattedAmount(decimalSeparator: Strings.decimalSeparator),
            symbol: certificate.symbol
        )
    }

    init(fundsPublicKey: Data, funds: FundsLocation, amount: String, amountText: String, symbol: String) throws {
        self.fundsPublicKey = fundsPublicKey
        accountId = try Ethereum.address(of: fundsPublicKey)
        self.funds = funds
        self.amount = amount
        self.amountText = amountText
        self.symbol = symbol
    }
}

enum RedemptionError: Error, Equatable, CustomStringConvertible {
    /// 1Click prepared an intent other than the agreed transfer: nothing was signed.
    case unexpectedIntent(String)
    /// The quote is not for the whole banknote, or would deliver nothing.
    case unexpectedQuote(String)
    /// The card tapped for signing is not the banknote being redeemed.
    case otherCard
    /// The card is no longer a banknote that can sign (blocked PIN, other state).
    case cannotSign(String)

    var description: String {
        switch self {
        case let .unexpectedIntent(why): "1Click prepared an unexpected intent (\(why)): not signed"
        case let .unexpectedQuote(why): "unexpected quote (\(why))"
        case .otherCard: "this is not the banknote being redeemed"
        case let .cannotSign(why): "the card cannot sign (\(why))"
        }
    }
}

/// One redemption, from the quote to the end. Saved before the card signs,
/// so that an interruption (no network, the app closed) never loses it:
/// the card keeps its signature for the same digest (protocol.md §5.4), so
/// it can always be asked again and submitted.
struct Redemption: Codable, Identifiable, Hashable {
    enum Stage: String, Codable {
        /// The intent is ready; the card has not signed yet (or the app does not know).
        case awaitingSignature
        /// Signed by the card; not yet accepted by 1Click.
        case signed
        /// Accepted by 1Click: waiting for it to settle.
        case submitted
        case succeeded
        /// The money went back to the refund account inside FAR.
        case refunded
        case failed
    }

    let id: UUID
    let createdAt: Date
    /// What is redeemed.
    let banknoteAccountId: String
    let fundsPublicKey: Data
    let funds: FundsLocation
    let amount: String
    let amountText: String
    let symbol: String
    /// Where it goes.
    let destination: String
    let recipient: String
    /// Where a refund goes: the refund passkey's account inside FAR.
    let refundAccountId: String
    /// The quote.
    let depositAddress: String
    let expectedAmountOut: String
    /// What the card signs.
    let payload: String
    let digest: Data

    var stage: Stage
    /// r ‖ s ‖ v, once the card has signed.
    var signature: Data?
    var intentHash: String?
    var refundedAmount: String?
    var refundedAmountText: String?
    /// The refund has been withdrawn from the refund account.
    var refundWithdrawn = false

    var isFinished: Bool { [.succeeded, .refunded, .failed].contains(stage) }
}

/// The redemption steps that do not touch the card (docs/protocol.md §9,
/// Redemption). The card's part (SIGN_ONCE) happens in between, in the UI.
struct RedemptionService {
    let oneClick: OneClickClient

    /// Steps 1–2: the quote, then the transfer intent 1Click prepares for the
    /// card, checked to be exactly the agreed transfer, and its ERC-191
    /// digest. Nothing has been signed yet: a failure here costs nothing.
    func prepare(
        banknote: RedeemableBanknote,
        destination: Destination,
        recipient: String,
        refundAccountId: String,
        now: Date = Date()
    ) async throws -> Redemption {
        let swaps = destination.assetId != banknote.funds.tokenId
        let request = QuoteRequest(
            // No swap: nothing can move, so no slippage. A swap: up to 1 %.
            slippageTolerance: swaps ? 100 : 0,
            originAsset: banknote.funds.tokenId,
            destinationAsset: destination.assetId,
            amount: banknote.amount, // all of it
            recipient: recipient,
            // Never the card: once SPENT it can never move a refund again.
            refundTo: refundAccountId,
            deadline: ISO8601DateFormatter().string(from: now.addingTimeInterval(24 * 3600))
        )
        let quote = try await oneClick.quote(request).quote
        guard quote.amountIn == banknote.amount else {
            throw RedemptionError.unexpectedQuote("it takes \(quote.amountIn), the banknote holds \(banknote.amount)")
        }
        guard quote.minAmountOut != "0", !quote.minAmountOut.isEmpty else {
            throw RedemptionError.unexpectedQuote("it would deliver nothing")
        }

        let intent = try await oneClick.generateIntent(
            standard: "erc191",
            signerId: banknote.accountId,
            depositAddress: quote.depositAddress
        )
        try TransferIntentCheck.verify(payload: intent.payload, expected: ExpectedTransfer(
            contractId: banknote.funds.contractId,
            signerId: banknote.accountId,
            receiverId: quote.depositAddress,
            tokenId: banknote.funds.tokenId,
            amount: banknote.amount
        ))

        return Redemption(
            id: UUID(),
            createdAt: now,
            banknoteAccountId: banknote.accountId,
            fundsPublicKey: banknote.fundsPublicKey,
            funds: banknote.funds,
            amount: banknote.amount,
            amountText: banknote.amountText,
            symbol: banknote.symbol,
            destination: destination.label,
            recipient: recipient,
            refundAccountId: refundAccountId,
            depositAddress: quote.depositAddress,
            expectedAmountOut: quote.amountOutFormatted,
            payload: intent.payload,
            digest: Ethereum.erc191Digest(intent.payload),
            stage: .awaitingSignature
        )
    }

    /// The card's DER answer to SIGN_ONCE → r ‖ s ‖ v, checked to be F's
    /// signature of this redemption's digest.
    func attach(derSignature: Data, to redemption: Redemption) throws -> Redemption {
        var signed = redemption
        signed.signature = try Ethereum.recoverableSignature(
            derSignature: derSignature,
            digest: redemption.digest,
            fundsPublicKey: redemption.fundsPublicKey
        )
        signed.stage = .signed
        return signed
    }

    /// Step 4: 1Click executes the signed transfer.
    func submit(_ redemption: Redemption) async throws -> Redemption {
        guard let signature = redemption.signature else { return redemption }
        var submitted = redemption
        submitted.intentHash = try await oneClick.submitIntent(
            .erc191(payload: redemption.payload, signature: "secp256k1:" + Base58.encode(signature))
        )
        submitted.stage = .submitted
        return submitted
    }

    // MARK: - Refunds

    /// A withdrawal of a refund out of the refund account, before the passkey signs it.
    struct RefundWithdrawal: Equatable {
        let depositAddress: String
        let expectedAmountOut: String
        /// What the passkey signs.
        let payload: String
    }

    /// Quote and intent to send a refund from the refund account to the
    /// holder's chain, like a redemption but signed by the passkey (WebAuthn).
    /// A failure of this one goes back to the refund account again, which
    /// (unlike the card) can sign as many times as needed.
    func prepareRefundWithdrawal(
        of redemption: Redemption,
        destination: Destination,
        recipient: String,
        refundAccountId: String,
        now: Date = Date()
    ) async throws -> RefundWithdrawal {
        guard redemption.stage == .refunded, let amount = redemption.refundedAmount, amount != "0" else {
            throw RedemptionError.unexpectedQuote("there is no refund to withdraw")
        }
        let quote = try await oneClick.quote(QuoteRequest(
            slippageTolerance: destination.assetId != redemption.funds.tokenId ? 100 : 0,
            originAsset: redemption.funds.tokenId,
            destinationAsset: destination.assetId,
            amount: amount,
            recipient: recipient,
            refundTo: refundAccountId,
            deadline: ISO8601DateFormatter().string(from: now.addingTimeInterval(24 * 3600))
        )).quote
        guard quote.amountIn == amount, quote.minAmountOut != "0" else {
            throw RedemptionError.unexpectedQuote("it does not take the whole refund")
        }
        let intent = try await oneClick.generateIntent(
            standard: "webauthn",
            signerId: refundAccountId,
            depositAddress: quote.depositAddress
        )
        try TransferIntentCheck.verify(payload: intent.payload, expected: ExpectedTransfer(
            contractId: redemption.funds.contractId,
            signerId: refundAccountId,
            receiverId: quote.depositAddress,
            tokenId: redemption.funds.tokenId,
            amount: amount
        ))
        return RefundWithdrawal(depositAddress: quote.depositAddress, expectedAmountOut: quote.amountOutFormatted, payload: intent.payload)
    }

    /// Submits the passkey-signed withdrawal; returns 1Click's final status
    /// (or the last one seen when `timeout` runs out).
    func submitRefundWithdrawal(_ signed: WebAuthnSignedIntent, depositAddress: String, timeout: Duration = .seconds(120)) async throws -> SwapStatus {
        _ = try await oneClick.submitIntent(.webauthn(signed))
        return try await waitForFinalStatus(depositAddress: depositAddress, timeout: timeout)
    }

    /// Polls 1Click every 3 s until the movement is final or `timeout` runs out.
    func waitForFinalStatus(depositAddress: String, timeout: Duration) async throws -> SwapStatus {
        let clock = ContinuousClock()
        let end = clock.now.advanced(by: timeout)
        while true {
            let status = try await oneClick.status(depositAddress: depositAddress)
            if status.isFinal || clock.now >= end { return status }
            try await Task.sleep(for: .seconds(3))
        }
    }

    /// Asks 1Click where the redemption stands, and records it.
    func refresh(_ redemption: Redemption) async throws -> Redemption {
        let status = try await oneClick.status(depositAddress: redemption.depositAddress)
        var updated = redemption
        switch status.status {
        case "SUCCESS": updated.stage = .succeeded
        case "REFUNDED":
            updated.stage = .refunded
            updated.refundedAmount = status.swapDetails?.refundedAmount
            updated.refundedAmountText = status.swapDetails?.refundedAmountFormatted
        case "FAILED": updated.stage = .failed
        default: break // still moving
        }
        return updated
    }
}

/// The redemptions this device has started, kept until they are finished
/// (and, for a refund, withdrawn). Plain JSON in UserDefaults: nothing in it
/// is secret (the card's signature only pays the agreed deposit address).
/// UserDefaults is thread-safe, so the store needs no actor.
final class RedemptionStore {
    private let defaults: UserDefaults
    private let key = "nearcash.redemptions.v1"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func all() -> [Redemption] {
        guard let data = defaults.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode([Redemption].self, from: data)) ?? []
    }

    func save(_ redemption: Redemption) {
        var list = all().filter { $0.id != redemption.id }
        list.append(redemption)
        list.sort { $0.createdAt > $1.createdAt }
        if let data = try? JSONEncoder().encode(list) {
            defaults.set(data, forKey: key)
        }
    }
}
