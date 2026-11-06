import Foundation
import Observation

/// How the card's part of a redemption ended.
enum SignOutcome: Equatable {
    /// Signed and handed to 1Click; `redemption` says where it stands.
    case done(Redemption)
    /// Signed, but 1Click could not be reached: it can be sent again later.
    case notSent(Redemption, String)
    case wrongPin(triesLeft: Int)
    case pinBlocked
    case otherCard
    /// The banknote was already redeemed with another intent.
    case alreadySpent
    case cancelled
    case failed(String)
}

/// The redemption flow (docs/protocol.md §9, Redemption) on the phone:
///   tap 1: verify the banknote → quote and intent (no tap) → tap 2: the
///   card signs once → 1Click executes it → refunds, if any, land on the
///   holder's refund passkey account inside FAR and can be withdrawn.
@MainActor
@Observable
final class RedemptionModel {

    let reader: CardReader
    let verifier: BanknoteVerifier
    let config: AppConfig
    private let store: RedemptionStore

    /// Every redemption this device knows, newest first.
    private(set) var redemptions: [Redemption] = []
    /// The refund account, once its passkey exists.
    private(set) var refundAccount: RefundAccount?
    private(set) var isBusy = false

    init(reader: CardReader, verifier: BanknoteVerifier, config: AppConfig, store: RedemptionStore = RedemptionStore()) {
        self.reader = reader
        self.verifier = verifier
        self.config = config
        self.store = store
        redemptions = store.all()
        refundAccount = RefundAccountStore.load()
    }

    /// Redemptions that still need something: a signature, sending, settling or a refund to withdraw.
    var open: [Redemption] {
        redemptions.filter { !$0.isFinished || ($0.stage == .refunded && !$0.refundWithdrawn) }
    }

    private var service: RedemptionService? {
        config.oneClickAPIKey.map { RedemptionService(oneClick: OneClickClient(apiKey: $0)) }
    }

    // MARK: - Tap 1: which banknote

    /// Reads and fully verifies the banknote to redeem.
    func readBanknote() async throws -> RedeemableBanknote {
        try await run {
            let check = try await reader.withCard(
                prompt: Strings.promptRedeemRead,
                task: { card in try await verifier.check(card) },
                successMessage: { check in check.outcome == .valid ? Strings.nfcValid : Strings.nfcInvalid }
            )
            switch check.outcome {
            case .valid:
                guard let certificate = check.certificate, let fundsKey = check.info.fundsPublicKey else {
                    throw RedemptionError.cannotSign("no certificate")
                }
                return try RedeemableBanknote(certificate: certificate, fundsPublicKey: fundsKey)
            case .spent: throw RedemptionFlowError.spent
            case let .invalid(failure): throw RedemptionFlowError.invalid(failure)
            }
        }
    }

    // MARK: - Quote and intent

    /// Creates the refund passkey the first time (iOS asks for Face ID).
    func ensureRefundAccount() async throws -> RefundAccount {
        if let refundAccount { return refundAccount }
        guard let domain = config.passkeyDomain else { throw RefundPasskeyError.notConfigured }
        let created = try await PasskeyAuthenticator(relyingParty: domain).createRefundAccount()
        try RefundAccountStore.save(created)
        refundAccount = created
        return created
    }

    /// Quote and intent for the whole banknote. Saved before the card signs anything.
    func prepare(_ banknote: RedeemableBanknote, destination: Destination, recipient: String) async throws -> Redemption {
        try await run {
            guard let service else { throw RefundPasskeyError.notConfigured }
            let refund = try await ensureRefundAccount()
            let redemption = try await service.prepare(
                banknote: banknote,
                destination: destination,
                recipient: recipient.trimmingCharacters(in: .whitespacesAndNewlines),
                refundAccountId: refund.accountId
            )
            remember(redemption)
            return redemption
        }
    }

    // MARK: - Tap 2: the card signs, once

    /// The card signs the redemption's digest (SIGN_ONCE), then 1Click gets it.
    /// Also resumes an interrupted redemption: on a SPENT card the same
    /// digest gives back the same signature.
    func sign(_ redemption: Redemption, pin: String) async -> SignOutcome {
        guard let service else { return .failed(Strings.redeemNotConfigured) }
        guard !isBusy else { return .failed(Strings.nfcSheetError) }
        isBusy = true
        defer { isBusy = false }

        let signed: Redemption
        do {
            let der = try await reader.withCard(
                prompt: Strings.promptRedeemSign,
                task: { card -> Data in
                    try await card.select()
                    let info = try await card.info()
                    guard info.fundsPublicKey == redemption.fundsPublicKey else { throw RedemptionError.otherCard }
                    guard info.state == .issued || info.state == .spent else {
                        throw RedemptionError.cannotSign("state \(info.rawState)")
                    }
                    return try await card.signOnce(pin: pin, digest: redemption.digest)
                },
                successMessage: { _ in Strings.nfcRedeemSigned }
            )
            signed = try service.attach(derSignature: der, to: redemption)
            remember(signed)
        } catch ReaderError.cancelled {
            return .cancelled
        } catch RedemptionError.otherCard {
            return .otherCard
        } catch let error as CardError where error.pinTriesLeft != nil {
            return error.pinTriesLeft == 0 ? .pinBlocked : .wrongPin(triesLeft: error.pinTriesLeft!)
        } catch CardError.status(_, StatusWord.conditionsNotSatisfied) {
            // A SPENT card answers only the digest it signed: this is another redemption.
            return .alreadySpent
        } catch {
            return .failed(WalletModel.describe(error))
        }

        return await send(signed)
    }

    /// Sends a signed redemption to 1Click and waits (a little) for it to settle.
    func send(_ redemption: Redemption) async -> SignOutcome {
        guard let service else { return .failed(Strings.redeemNotConfigured) }
        var current = redemption
        do {
            if current.stage == .signed {
                current = try await service.submit(current)
                remember(current)
            }
            let status = try await service.waitForFinalStatus(depositAddress: current.depositAddress, timeout: .seconds(90))
            if status.isFinal {
                current = try await service.refresh(current)
                remember(current)
            }
            return .done(current)
        } catch {
            return .notSent(current, WalletModel.describe(error))
        }
    }

    /// Asks 1Click about every redemption still moving.
    func refreshOpen() async {
        guard let service else { return }
        for redemption in redemptions where redemption.stage == .submitted {
            if let updated = try? await service.refresh(redemption) { remember(updated) }
        }
    }

    // MARK: - Refunds

    /// Withdraws a refund from the refund account: quote, intent, passkey
    /// signature (Face ID), 1Click. Returns the final status.
    func withdrawRefund(of redemption: Redemption, destination: Destination, recipient: String) async throws -> SwapStatus {
        try await run {
            guard let service, let refundAccount else { throw RefundPasskeyError.notConfigured }
            let withdrawal = try await service.prepareRefundWithdrawal(
                of: redemption,
                destination: destination,
                recipient: recipient.trimmingCharacters(in: .whitespacesAndNewlines),
                refundAccountId: refundAccount.accountId
            )
            let signed = try await PasskeyAuthenticator(relyingParty: refundAccount.relyingParty)
                .sign(payload: withdrawal.payload, with: refundAccount)
            let status = try await service.submitRefundWithdrawal(signed, depositAddress: withdrawal.depositAddress)
            if status.status == "SUCCESS" {
                var withdrawn = redemption
                withdrawn.refundWithdrawn = true
                remember(withdrawn)
            }
            return status
        }
    }

    // MARK: - Plumbing

    private func remember(_ redemption: Redemption) {
        store.save(redemption)
        redemptions = store.all()
    }

    /// Runs `work` with `isBusy` set, one operation at a time.
    private func run<T>(_ work: () async throws -> T) async throws -> T {
        guard !isBusy else { throw RedemptionFlowError.busy }
        isBusy = true
        defer { isBusy = false }
        return try await work()
    }
}

enum RedemptionFlowError: Error, Equatable {
    case busy
    case spent
    case invalid(BanknoteCheck.Failure)
}
