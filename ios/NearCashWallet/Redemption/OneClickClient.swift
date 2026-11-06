import Foundation

/// The 1Click API (https://1click.chaindefuser.com), the only way to move
/// funds inside FAR: FAR takes no direct token transfers. A movement is a
/// quote whose deposit address is funded by a signed transfer intent:
///   quote → generate-intent → sign → submit-intent → status.
///
/// Confidential (FAR) quotes need a 1Click partner key, sent in
/// `X-API-Key`. The wallet has its own key (Secrets.xcconfig), not the
/// bank's: it only identifies the app to 1Click and cannot move anyone's
/// funds, since every movement needs a signature from the account it spends.
struct OneClickClient {
    static let baseURL = URL(string: "https://1click.chaindefuser.com")!

    let apiKey: String
    var http: HTTPTransport = URLSessionTransport()

    // MARK: - Endpoints

    /// POST /v0/quote. Real quotes (`dry: false`) come with a deposit address.
    func quote(_ request: QuoteRequest) async throws -> QuoteResponse {
        try await call("POST", "/v0/quote", body: request)
    }

    /// POST /v0/generate-intent: 1Click writes the transfer intent that pays
    /// the quote's deposit address, for the given signer and standard.
    func generateIntent(standard: String, signerId: String, depositAddress: String) async throws -> GeneratedIntent {
        struct Body: Encodable {
            let type = "swap_transfer"
            let standard: String
            let signerId: String
            let depositAddress: String
        }
        let answer: GenerateIntentResponse = try await call(
            "POST", "/v0/generate-intent",
            body: Body(standard: standard, signerId: signerId, depositAddress: depositAddress)
        )
        guard answer.intent.standard == standard else {
            throw OneClickError.unexpectedAnswer("1Click prepared a \(answer.intent.standard) intent, not \(standard)")
        }
        return answer.intent
    }

    /// POST /v0/submit-intent: 1Click executes the signed intent. Returns its hash.
    func submitIntent(_ signedData: SignedIntent) async throws -> String {
        struct Body: Encodable {
            let type = "swap_transfer"
            let signedData: SignedIntent
        }
        struct Answer: Decodable { let intentHash: String }
        let answer: Answer = try await call("POST", "/v0/submit-intent", body: Body(signedData: signedData))
        return answer.intentHash
    }

    /// GET /v0/status: where the movement of a deposit address stands.
    func status(depositAddress: String) async throws -> SwapStatus {
        var components = URLComponents(url: Self.baseURL.appending(path: "/v0/status"), resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "depositAddress", value: depositAddress)]
        return try await send(URLRequest(url: components.url!))
    }

    // MARK: - Plumbing

    private func call<Body: Encodable, Answer: Decodable>(_ method: String, _ path: String, body: Body) async throws -> Answer {
        var request = URLRequest(url: Self.baseURL.appending(path: path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return try await send(request)
    }

    private func send<Answer: Decodable>(_ request: URLRequest) async throws -> Answer {
        var request = request
        request.setValue(apiKey, forHTTPHeaderField: "X-API-Key")
        request.timeoutInterval = 30
        let (data, status) = try await http.send(request)
        guard (200..<300).contains(status) else {
            // 1Click explains its refusals in "message" ("tokenOut is not valid", …).
            let message = (try? JSONDecoder().decode(ErrorAnswer.self, from: data))?.message
            throw OneClickError.refused(status: status, message: message ?? "no details")
        }
        do {
            return try JSONDecoder().decode(Answer.self, from: data)
        } catch {
            throw OneClickError.unexpectedAnswer("\(Answer.self): \(error)")
        }
    }

    private struct ErrorAnswer: Decodable { let message: String? }
}

enum OneClickError: Error, Equatable, CustomStringConvertible {
    /// 1Click answered with an HTTP error.
    case refused(status: Int, message: String)
    /// 1Click answered something the app does not understand.
    case unexpectedAnswer(String)

    var description: String {
        switch self {
        case let .refused(status, message): "1Click \(status): \(message)"
        case let .unexpectedAnswer(what): "1Click: unexpected answer (\(what))"
        }
    }
}

// MARK: - HTTP

/// Sends one HTTP request. URLSession in the app; canned answers in tests.
protocol HTTPTransport: Sendable {
    func send(_ request: URLRequest) async throws -> (Data, Int)
}

struct URLSessionTransport: HTTPTransport {
    func send(_ request: URLRequest) async throws -> (Data, Int) {
        let (data, response) = try await URLSession.shared.data(for: request)
        return (data, (response as? HTTPURLResponse)?.statusCode ?? 0)
    }
}

// MARK: - Messages

/// What a quote asks for. Field names are 1Click's.
struct QuoteRequest: Encodable, Equatable {
    var dry = false
    /// EXACT_INPUT: `amount` is what leaves the origin account, all of it.
    var swapType = "EXACT_INPUT"
    /// Basis points: 0 when nothing is swapped, 100 (1 %) otherwise.
    let slippageTolerance: Int
    let originAsset: String
    /// CONFIDENTIAL_INTENTS: paid from an account inside FAR.
    var depositType = "CONFIDENTIAL_INTENTS"
    let destinationAsset: String
    /// Smallest units, decimal digits.
    let amount: String
    let recipient: String
    /// DESTINATION_CHAIN: delivered to `recipient` on the destination asset's chain.
    var recipientType = "DESTINATION_CHAIN"
    /// Never the card's account: a refund there could never move again.
    let refundTo: String
    /// CONFIDENTIAL_INTENTS: a refund stays inside FAR, on `refundTo`.
    var refundType = "CONFIDENTIAL_INTENTS"
    /// ISO 8601. 1Click keeps a confidential quote open for days anyway.
    let deadline: String
}

struct QuoteResponse: Decodable {
    struct Quote: Decodable {
        /// The FAR account the transfer intent must pay.
        let depositAddress: String
        let amountIn: String
        let amountOut: String
        let amountOutFormatted: String
        let minAmountOut: String
        let deadline: String?
        /// Seconds 1Click expects the movement to take.
        let timeEstimate: Int?
    }

    let quote: Quote
}

struct GeneratedIntent: Decodable {
    let standard: String
    /// The intent as a JSON string: exactly what gets signed.
    let payload: String
}

private struct GenerateIntentResponse: Decodable {
    let intent: GeneratedIntent
}

/// A signed intent, in one of the two standards the wallet signs with.
enum SignedIntent: Encodable, Equatable {
    /// The card's key F (secp256k1): signature = "secp256k1:" ‖ base58(r ‖ s ‖ v).
    case erc191(payload: String, signature: String)
    /// The refund passkey (P-256), as a WebAuthn assertion.
    case webauthn(WebAuthnSignedIntent)

    func encode(to encoder: Encoder) throws {
        switch self {
        case let .erc191(payload, signature):
            var container = encoder.container(keyedBy: ERC191Keys.self)
            try container.encode("erc191", forKey: .standard)
            try container.encode(payload, forKey: .payload)
            try container.encode(signature, forKey: .signature)
        case let .webauthn(signed):
            try signed.encode(to: encoder)
        }
    }

    private enum ERC191Keys: String, CodingKey { case standard, payload, signature }
}

/// NEAR Intents' WebAuthn payload (MultiPayloadWebauthnP256).
struct WebAuthnSignedIntent: Encodable, Equatable {
    var standard = "webauthn"
    let payload: String
    /// "p256:" ‖ base58(X ‖ Y).
    let publicKey: String
    /// "p256:" ‖ base58(r ‖ s), low-s.
    let signature: String
    /// Exactly the bytes the authenticator signed, as text.
    let clientDataJSON: String
    /// Base64url, no padding.
    let authenticatorData: String

    private enum CodingKeys: String, CodingKey {
        case standard, payload, signature
        case publicKey = "public_key"
        case clientDataJSON = "client_data_json"
        case authenticatorData = "authenticator_data"
    }
}

/// GET /v0/status, the fields the wallet uses.
struct SwapStatus: Decodable, Equatable {
    struct Details: Decodable, Equatable {
        let amountOutFormatted: String?
        /// Smallest units of the origin asset sent back to `refundTo`.
        let refundedAmount: String?
        let refundedAmountFormatted: String?
    }

    /// PENDING_DEPOSIT, KNOWN_DEPOSIT_TX, PROCESSING, INCOMPLETE_DEPOSIT, SUCCESS, REFUNDED, FAILED.
    let status: String
    let swapDetails: Details?

    /// True once nothing will change any more.
    var isFinal: Bool { ["SUCCESS", "REFUNDED", "FAILED"].contains(status) }
}
