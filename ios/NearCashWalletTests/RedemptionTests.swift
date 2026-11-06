import Foundation
import Testing
@testable import NearCashWallet

/// Values computed by the TypeScript implementation
/// (packages/core/scripts/redemption-fixtures.ts): the redemption code of
/// the app must give exactly the same bytes.
struct RedemptionFixtures: Decodable {
    struct KeccakVector: Decodable { let input: String; let hash: String }
    struct Base58Vector: Decodable { let hex: String; let text: String }
    struct Card: Decodable { let fundsPublicKey: String; let accountId: String }
    struct Intent: Decodable {
        let payload: String
        let depositAddress: String
        let tokenId: String
        let amount: String
        let contractId: String
        let erc191Digest: String
        let derLowS: String
        let derHighS: String
        let recoverable: String
    }
    struct Passkey: Decodable {
        let publicKey: String
        let accountId: String
        let publicKeyText: String
        let intentsVectorKey: String
        let intentsVectorAccount: String
        let signedMessage: String
        let derHighS: String
        let compactLowS: String
        let attestationObject: String
        let credentialId: String
    }

    let keccak: [KeccakVector]
    let base58: [Base58Vector]
    let card: Card
    let intent: Intent
    let passkey: Passkey

    static func load() throws -> RedemptionFixtures {
        let url = try #require(Bundle(for: FixtureBundle.self).url(forResource: "redemption-fixtures", withExtension: "json"))
        return try JSONDecoder().decode(RedemptionFixtures.self, from: Data(contentsOf: url))
    }
}

private final class FixtureBundle {}

private func hex(_ text: String) -> Data { Data(hex: text)! }

@Suite("Encodings and hashes")
struct EncodingTests {
    let fixtures = try! RedemptionFixtures.load()

    @Test func keccakMatchesTheReference() {
        for vector in fixtures.keccak {
            #expect(Keccak256.hash(hex(vector.input)).hex == vector.hash, "input of \(vector.input.count / 2) bytes")
        }
    }

    @Test func base58MatchesTheReference() {
        for vector in fixtures.base58 {
            #expect(Base58.encode(hex(vector.hex)) == vector.text, "\(vector.hex)")
        }
    }

    @Test func base64URLHasNoPaddingOrPlusSlash() {
        #expect(Base64URL.encode(Data([0xFB, 0xFF])) == "-_8")
    }
}

@Suite("The card's redemption signature (ERC-191)")
struct CardSignatureTests {
    let fixtures = try! RedemptionFixtures.load()

    @Test func cardAccountIsTheEthereumAddressOfF() throws {
        #expect(try Ethereum.address(of: hex(fixtures.card.fundsPublicKey)) == fixtures.card.accountId)
        // The compressed key names the same account.
        let compressed = try Secp256k1.compressedPublicKey(hex(fixtures.card.fundsPublicKey))
        #expect(try Ethereum.address(of: compressed) == fixtures.card.accountId)
    }

    @Test func digestMatchesTheReference() {
        #expect(Ethereum.erc191Digest(fixtures.intent.payload).hex == fixtures.intent.erc191Digest)
    }

    @Test func highAndLowSGiveTheSameRecoverableSignature() throws {
        let digest = hex(fixtures.intent.erc191Digest)
        let key = hex(fixtures.card.fundsPublicKey)
        for der in [fixtures.intent.derHighS, fixtures.intent.derLowS] {
            let signature = try Ethereum.recoverableSignature(derSignature: hex(der), digest: digest, fundsPublicKey: key)
            #expect(signature.hex == fixtures.intent.recoverable)
        }
    }

    @Test func refusesASignatureOfAnythingElse() throws {
        var digest = hex(fixtures.intent.erc191Digest)
        digest[digest.startIndex] ^= 0x01
        #expect(throws: EthereumError.badSignature) {
            try Ethereum.recoverableSignature(
                derSignature: hex(fixtures.intent.derLowS),
                digest: digest,
                fundsPublicKey: hex(fixtures.card.fundsPublicKey)
            )
        }
    }
}

@Suite("The refund passkey (P-256, WebAuthn)")
struct PasskeyTests {
    let fixtures = try! RedemptionFixtures.load()

    @Test func accountIdMatchesNearIntents() {
        // near/intents' own test vector.
        #expect(RefundAccount.accountId(of: hex(fixtures.passkey.intentsVectorKey)) == fixtures.passkey.intentsVectorAccount)
        let account = RefundAccount(credentialID: Data([1]), publicKey: hex(fixtures.passkey.publicKey), relyingParty: "wallet.example.com")
        #expect(account.accountId == fixtures.passkey.accountId)
        #expect(account.publicKeyText == fixtures.passkey.publicKeyText)
    }

    @Test func signaturesAreMadeLowS() throws {
        let compact = try P256Signatures.compactLowS(derSignature: hex(fixtures.passkey.derHighS))
        #expect(compact.hex == fixtures.passkey.compactLowS)
        #expect(P256Signatures.isValid(compact: compact, message: hex(fixtures.passkey.signedMessage), publicKey: hex(fixtures.passkey.publicKey)))
        #expect(!P256Signatures.isValid(compact: compact, message: Data("something else".utf8), publicKey: hex(fixtures.passkey.publicKey)))
    }

    @Test func readsTheKeyOutOfTheAttestationObject() throws {
        let extracted = try COSEPublicKey.p256Key(fromAttestationObject: hex(fixtures.passkey.attestationObject))
        #expect(extracted.credentialID.hex == fixtures.passkey.credentialId)
        #expect(extracted.publicKey.hex == fixtures.passkey.publicKey)
    }

    @Test func rejectsATruncatedAttestationObject() {
        let truncated = hex(fixtures.passkey.attestationObject).dropLast(10)
        #expect(throws: (any Error).self) { try COSEPublicKey.p256Key(fromAttestationObject: Data(truncated)) }
    }
}

@Suite("Checking 1Click's intent before signing")
struct TransferIntentCheckTests {
    let fixtures = try! RedemptionFixtures.load()

    private var expected: ExpectedTransfer {
        ExpectedTransfer(
            contractId: fixtures.intent.contractId,
            signerId: fixtures.card.accountId,
            receiverId: fixtures.intent.depositAddress,
            tokenId: fixtures.intent.tokenId,
            amount: fixtures.intent.amount
        )
    }

    /// The fixture payload with one change.
    private func tampered(_ change: (inout [String: Any]) -> Void) -> String {
        var message = try! JSONSerialization.jsonObject(with: Data(fixtures.intent.payload.utf8)) as! [String: Any]
        change(&message)
        return String(data: try! JSONSerialization.data(withJSONObject: message), encoding: .utf8)!
    }

    private func transfer(_ message: [String: Any]) -> [String: Any] {
        (message["intents"] as! [[String: Any]])[0]
    }

    @Test func acceptsTheAgreedTransfer() throws {
        try TransferIntentCheck.verify(payload: fixtures.intent.payload, expected: expected)
    }

    @Test func refusesAnythingElse() {
        let token = "imt:51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe:\(fixtures.intent.tokenId)"
        let changes: [(String, (inout [String: Any]) -> Void)] = [
            ("another contract", { $0["verifying_contract"] = "intents.near" }),
            ("another signer", { $0["signer_id"] = "0x0000000000000000000000000000000000000001" }),
            ("another receiver", { m in var t = transfer(m); t["receiver_id"] = "attacker.near"; m["intents"] = [t] }),
            ("another amount", { m in var t = transfer(m); t["tokens"] = [token: "5000001"]; m["intents"] = [t] }),
            ("another token", { m in var t = transfer(m); t["tokens"] = ["nep141:eth.omft.near": "5000000"]; m["intents"] = [t] }),
            ("two tokens", { m in var t = transfer(m); t["tokens"] = [token: "5000000", "nep141:eth.omft.near": "1"]; m["intents"] = [t] }),
            ("two intents", { m in m["intents"] = [transfer(m), transfer(m)] }),
            ("not a transfer", { m in var t = transfer(m); t["intent"] = "ft_withdraw"; m["intents"] = [t] }),
            ("an extra field", { m in var t = transfer(m); t["msg"] = "call me"; m["intents"] = [t] }),
            ("no deadline", { $0["deadline"] = nil }),
        ]
        for (label, change) in changes {
            #expect(throws: RedemptionError.self, "\(label)") {
                try TransferIntentCheck.verify(payload: tampered(change), expected: expected)
            }
        }
        #expect(throws: RedemptionError.self) { try TransferIntentCheck.verify(payload: "not json", expected: expected) }
    }

    @Test func namesFarTokensByTheirAssetId() {
        #expect(TransferIntentCheck.assetId(of: "imt:treasury:nep141:eth.omft.near") == "nep141:eth.omft.near")
        #expect(TransferIntentCheck.assetId(of: "nep141:eth.omft.near") == "nep141:eth.omft.near")
        #expect(TransferIntentCheck.assetId(of: "nep245:v2_1.omni.hot.tg:137_x") == "nep245:v2_1.omni.hot.tg:137_x")
    }
}

/// 1Click answers by path; every request is recorded.
private final class CannedOneClick: HTTPTransport, @unchecked Sendable {
    var answers: [String: (Int, String)] = [:]
    private(set) var requests: [URLRequest] = []

    func send(_ request: URLRequest) async throws -> (Data, Int) {
        requests.append(request)
        let (status, body) = answers[request.url!.path] ?? (404, #"{"message":"no canned answer"}"#)
        return (Data(body.utf8), status)
    }

    func body(of path: String) throws -> [String: Any] {
        let request = try #require(requests.last { $0.url!.path == path })
        return try #require(try JSONSerialization.jsonObject(with: request.httpBody ?? Data()) as? [String: Any])
    }
}

@Suite("Redemption service")
struct RedemptionServiceTests {
    let fixtures = try! RedemptionFixtures.load()
    let refundAccount = "0x2288bcfb5297990d6f1a195f6e00ed29b682285d"

    private func banknote() throws -> RedeemableBanknote {
        try RedeemableBanknote(
            fundsPublicKey: hex(fixtures.card.fundsPublicKey),
            funds: .usdcOnFar,
            amount: fixtures.intent.amount,
            amountText: "5",
            symbol: "USDC"
        )
    }

    private func oneClick(payload: String? = nil, amountIn: String? = nil) -> CannedOneClick {
        let canned = CannedOneClick()
        let quote: [String: Any] = ["quote": [
            "depositAddress": fixtures.intent.depositAddress,
            "amountIn": amountIn ?? fixtures.intent.amount,
            "amountOut": "4400000",
            "amountOutFormatted": "4.4",
            "minAmountOut": "4400000",
            "deadline": "2026-11-09T09:50:01.000Z",
            "timeEstimate": 17,
        ]]
        let intent: [String: Any] = ["intent": ["standard": "erc191", "payload": payload ?? fixtures.intent.payload]]
        canned.answers["/v0/quote"] = (201, String(data: try! JSONSerialization.data(withJSONObject: quote), encoding: .utf8)!)
        canned.answers["/v0/generate-intent"] = (201, String(data: try! JSONSerialization.data(withJSONObject: intent), encoding: .utf8)!)
        canned.answers["/v0/submit-intent"] = (201, #"{"intentHash":"hash1"}"#)
        canned.answers["/v0/status"] = (200, #"{"status":"REFUNDED","swapDetails":{"refundedAmount":"5000000","refundedAmountFormatted":"5"}}"#)
        return canned
    }

    private func service(_ canned: CannedOneClick) -> RedemptionService {
        RedemptionService(oneClick: OneClickClient(apiKey: "test-key", http: canned))
    }

    @Test func preparesTheWholeBanknoteWithRefundsToThePasskeyAccount() async throws {
        let canned = oneClick()
        let usdcOnEthereum = Destination.all.first { $0.id == "usdc-ethereum" }!
        let redemption = try await service(canned).prepare(
            banknote: try banknote(),
            destination: usdcOnEthereum,
            recipient: "0x6ce60854d8d676423bbcd5a30dbcb01eca0fb0a4",
            refundAccountId: refundAccount
        )

        let quote = try canned.body(of: "/v0/quote")
        #expect(quote["amount"] as? String == fixtures.intent.amount)
        #expect(quote["swapType"] as? String == "EXACT_INPUT")
        #expect(quote["slippageTolerance"] as? Int == 0) // same token: nothing is swapped
        #expect(quote["depositType"] as? String == "CONFIDENTIAL_INTENTS")
        #expect(quote["refundTo"] as? String == refundAccount) // never the card
        #expect(quote["refundType"] as? String == "CONFIDENTIAL_INTENTS")
        #expect(quote["recipientType"] as? String == "DESTINATION_CHAIN")
        #expect(canned.requests.allSatisfy { $0.value(forHTTPHeaderField: "X-API-Key") == "test-key" })

        let generate = try canned.body(of: "/v0/generate-intent")
        #expect(generate["standard"] as? String == "erc191")
        #expect(generate["signerId"] as? String == fixtures.card.accountId)

        #expect(redemption.digest.hex == fixtures.intent.erc191Digest)
        #expect(redemption.stage == .awaitingSignature)
        #expect(redemption.refundAccountId == refundAccount)
    }

    @Test func swapsAllowSomeSlippage() async throws {
        let canned = oneClick()
        _ = try await service(canned).prepare(
            banknote: try banknote(),
            destination: Destination.all.first { $0.id == "usdc-base" }!,
            recipient: "0x6ce60854d8d676423bbcd5a30dbcb01eca0fb0a4",
            refundAccountId: refundAccount
        )
        #expect(try canned.body(of: "/v0/quote")["slippageTolerance"] as? Int == 100)
    }

    @Test func refusesAQuoteForLessThanTheBanknote() async throws {
        await #expect(throws: RedemptionError.self) {
            try await service(oneClick(amountIn: "4000000")).prepare(
                banknote: try banknote(),
                destination: Destination.all[0],
                recipient: "0x6ce60854d8d676423bbcd5a30dbcb01eca0fb0a4",
                refundAccountId: refundAccount
            )
        }
    }

    @Test func refusesAnIntentThatPaysSomeoneElse() async throws {
        let other = fixtures.intent.payload.replacingOccurrences(of: fixtures.intent.depositAddress, with: "attacker.near")
        await #expect(throws: RedemptionError.self) {
            try await service(oneClick(payload: other)).prepare(
                banknote: try banknote(),
                destination: Destination.all[0],
                recipient: "0x6ce60854d8d676423bbcd5a30dbcb01eca0fb0a4",
                refundAccountId: refundAccount
            )
        }
    }

    @Test func submitsTheCardSignatureAndFollowsTheRefund() async throws {
        let canned = oneClick()
        let service = service(canned)
        let prepared = try await service.prepare(
            banknote: try banknote(),
            destination: Destination.all[0],
            recipient: "0x6ce60854d8d676423bbcd5a30dbcb01eca0fb0a4",
            refundAccountId: refundAccount
        )
        let signed = try service.attach(derSignature: hex(fixtures.intent.derHighS), to: prepared)
        #expect(signed.stage == .signed)
        #expect(signed.signature?.hex == fixtures.intent.recoverable)

        let submitted = try await service.submit(signed)
        #expect(submitted.stage == .submitted)
        #expect(submitted.intentHash == "hash1")
        let signedData = try #require(try canned.body(of: "/v0/submit-intent")["signedData"] as? [String: Any])
        #expect(signedData["standard"] as? String == "erc191")
        #expect(signedData["payload"] as? String == fixtures.intent.payload)
        #expect(signedData["signature"] as? String == "secp256k1:" + Base58.encode(hex(fixtures.intent.recoverable)))

        let refunded = try await service.refresh(submitted)
        #expect(refunded.stage == .refunded)
        #expect(refunded.refundedAmount == "5000000")
    }

    @Test func aSignatureOfAnotherDigestIsNeverAttached() async throws {
        let prepared = try await service(oneClick()).prepare(
            banknote: try banknote(),
            destination: Destination.all[0],
            recipient: "0x6ce60854d8d676423bbcd5a30dbcb01eca0fb0a4",
            refundAccountId: refundAccount
        )
        var other = prepared
        other = Redemption(
            id: other.id, createdAt: other.createdAt, banknoteAccountId: other.banknoteAccountId,
            fundsPublicKey: other.fundsPublicKey, funds: other.funds, amount: other.amount,
            amountText: other.amountText, symbol: other.symbol, destination: other.destination,
            recipient: other.recipient, refundAccountId: other.refundAccountId,
            depositAddress: other.depositAddress, expectedAmountOut: other.expectedAmountOut,
            payload: other.payload, digest: Data(repeating: 7, count: 32), stage: .awaitingSignature
        )
        #expect(throws: EthereumError.badSignature) {
            try service(oneClick()).attach(derSignature: hex(fixtures.intent.derLowS), to: other)
        }
    }
}

@Suite("Where a banknote's funds are")
struct FundsLocationTests {
    @Test func testnetPlaceholderMeansUSDCOnFar() throws {
        let fixtures = try ProtocolFixtures.load()
        let certificate = try BanknoteCertificate(decoding: hex(fixtures.certificate.hex))
        // A certificate with real funds keeps them…
        #expect(FundsLocation.of(certificate) == FundsLocation(tokenId: certificate.tokenId, contractId: certificate.contractId))
        // …the testnet placeholder is not a token: those banknotes hold USDC on Ethereum in FAR.
        #expect(FundsLocation.testnetPlaceholder != FundsLocation.usdcOnFar)
        #expect(FundsLocation.usdcOnFar.contractId == "intents.far")
    }

    @Test func addressesAreRoughlyChecked() {
        let evm = Destination.all.first { $0.addressKind == .evm }!
        #expect(evm.looksLikeAddress("0x6ce60854d8d676423bbcd5a30dbcb01eca0fb0a4"))
        #expect(!evm.looksLikeAddress("0x6ce6"))
        let solana = Destination.all.first { $0.addressKind == .solana }!
        #expect(solana.looksLikeAddress("7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV"))
        #expect(!solana.looksLikeAddress("0x6ce60854d8d676423bbcd5a30dbcb01eca0fb0a4"))
        let near = Destination.all.first { $0.addressKind == .near }!
        #expect(near.looksLikeAddress("alice.near"))
        #expect(!near.looksLikeAddress("Alice Near"))
    }
}
