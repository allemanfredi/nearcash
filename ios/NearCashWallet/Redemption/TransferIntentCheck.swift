import Foundation

/// The transfer an account agreed to sign: pay the quote's deposit address
/// that much of that token, inside FAR.
struct ExpectedTransfer: Equatable {
    /// FAR's intents contract: what the intent must be signed for.
    let contractId: String
    /// The account that signs (and pays): the card, or the refund passkey.
    let signerId: String
    /// The quote's deposit address.
    let receiverId: String
    /// 1Click asset id, e.g. "nep141:eth-0xa0b8…eb48.omft.near".
    let tokenId: String
    /// Smallest units, decimal digits.
    let amount: String
}

/// Checks the intent 1Click prepared before anything signs it. The card
/// signs only once, and 1Click is an outside service: without this check an
/// error (or an attack) there could make the card spend its one signature on
/// a transfer of anything to anyone. The intent must be, exactly:
///   for FAR's contract, signed as the expected account,
///   one "transfer" of the agreed amount of the agreed token to the deposit address.
/// The same rules as the issuance server's check of the reserve's payments
/// (apps/issuance/src/features/reserve/reserve-payment.ts).
enum TransferIntentCheck {

    static func verify(payload: String, expected: ExpectedTransfer) throws {
        guard let object = try? JSONSerialization.jsonObject(with: Data(payload.utf8)),
              let message = object as? [String: Any] else {
            throw refusal("it is not a JSON object")
        }
        guard message["verifying_contract"] as? String == expected.contractId else {
            throw refusal("it is for \(message["verifying_contract"] ?? "no contract"), not \(expected.contractId)")
        }
        guard message["signer_id"] as? String == expected.signerId else {
            throw refusal("it is signed as \(message["signer_id"] ?? "nobody"), not \(expected.signerId)")
        }
        guard message["deadline"] is String, message["nonce"] is String else {
            throw refusal("it has no deadline or nonce")
        }
        let allowedTop: Set<String> = ["verifying_contract", "signer_id", "deadline", "nonce", "intents"]
        guard Set(message.keys).isSubset(of: allowedTop) else {
            throw refusal("it has unexpected fields")
        }

        guard let intents = message["intents"] as? [[String: Any]], intents.count == 1, let transfer = intents.first else {
            throw refusal("it is not exactly one intent")
        }
        let allowedInTransfer: Set<String> = ["intent", "receiver_id", "tokens", "memo"]
        guard transfer["intent"] as? String == "transfer", Set(transfer.keys).isSubset(of: allowedInTransfer) else {
            throw refusal("it is not a plain transfer")
        }
        guard transfer["receiver_id"] as? String == expected.receiverId else {
            throw refusal("it pays \(transfer["receiver_id"] ?? "nobody"), not the quote's deposit address")
        }
        guard let tokens = transfer["tokens"] as? [String: Any], tokens.count == 1, let moved = tokens.first else {
            throw refusal("it does not move exactly one token")
        }
        guard assetId(of: moved.key) == expected.tokenId else {
            throw refusal("it moves \(moved.key), not \(expected.tokenId)")
        }
        guard moved.value as? String == expected.amount else {
            throw refusal("it moves \(moved.value), not \(expected.amount)")
        }
    }

    /// Inside FAR a token is named "imt:<FAR's treasury account>:<asset id>",
    /// while 1Click's quotes name it by the asset id alone: the asset id of either form.
    static func assetId(of farTokenId: String) -> String {
        let parts = farTokenId.split(separator: ":", maxSplits: 2, omittingEmptySubsequences: false)
        if parts.count == 3, parts[0] == "imt" { return String(parts[2]) }
        return farTokenId
    }

    private static func refusal(_ why: String) -> RedemptionError {
        .unexpectedIntent(why)
    }
}
