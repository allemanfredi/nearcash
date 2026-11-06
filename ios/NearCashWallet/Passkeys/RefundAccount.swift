import CryptoKit
import Foundation
import Security

/// The holder's refund account inside FAR, controlled by a passkey.
///
/// A redemption is a 1Click quote paid by the card's one signature. If it
/// fails, 1Click refunds the money, and the refund can never go back to the
/// card (it can no longer sign: the money would be stuck for good). It goes
/// to this account instead: an account inside FAR whose key is a passkey of
/// the app, kept by iOS in the iCloud Keychain, synced to the holder's other
/// devices and used with Face ID. From there the app can withdraw it.
///
/// The account needs no registration: NEAR Intents derives it from the
/// passkey's P-256 public key (near/intents, PublicKey::to_implicit_account_id):
///   "0x" ‖ hex(keccak256("p256" ‖ X ‖ Y)[12..32])
struct RefundAccount: Codable, Equatable {
    /// The passkey's id, to ask iOS for that passkey and no other.
    let credentialID: Data
    /// X (32) ‖ Y (32).
    let publicKey: Data
    /// The domain the passkey belongs to (its WebAuthn relying party).
    let relyingParty: String

    /// The account id inside FAR, e.g. "0x3602b546…4d50".
    var accountId: String {
        Self.accountId(of: publicKey)
    }

    /// "p256:" ‖ base58(X ‖ Y): how NEAR Intents writes the key.
    var publicKeyText: String {
        "p256:" + Base58.encode(publicKey)
    }

    static func accountId(of publicKey: Data) -> String {
        "0x" + Keccak256.hash(Data("p256".utf8) + publicKey).suffix(20).hex
    }
}

/// Keeps the refund account's public data (never a secret: the private key
/// lives in the passkey, which iOS keeps). Stored as a synchronizable
/// Keychain item, so it reaches the holder's other devices together with
/// the passkey itself: the app needs the public key to name the account,
/// and an assertion does not return it.
enum RefundAccountStore {
    private static let service = "xyz.nektarlabs.nearcash.refund-account"
    private static let account = "default"

    static func load() -> RefundAccount? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else {
            return nil
        }
        return try? JSONDecoder().decode(RefundAccount.self, from: data)
    }

    static func save(_ refundAccount: RefundAccount) throws {
        let data = try JSONEncoder().encode(refundAccount)
        let match: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: kSecAttrSynchronizableAny,
        ]
        SecItemDelete(match as CFDictionary)

        var item = match
        item[kSecAttrSynchronizable as String] = true
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        item[kSecValueData as String] = data
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else { throw RefundPasskeyError.keychain(status) }
    }
}

/// P-256 signature helpers for the passkey.
enum P256Signatures {

    /// Curve order n of P-256, big-endian.
    static let order: [UInt8] = [
        0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
        0xBC, 0xE6, 0xFA, 0xAD, 0xA7, 0x17, 0x9E, 0x84, 0xF3, 0xB9, 0xCA, 0xC2, 0xFC, 0x63, 0x25, 0x51,
    ]

    /// n / 2 rounded down, big-endian.
    static let halfOrder: [UInt8] = [
        0x7F, 0xFF, 0xFF, 0xFF, 0x80, 0x00, 0x00, 0x00, 0x7F, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
        0xDE, 0x73, 0x7D, 0x56, 0xD3, 0x8B, 0xCF, 0x42, 0x79, 0xDC, 0xE5, 0x61, 0x7E, 0x31, 0x92, 0xA8,
    ]

    /// A WebAuthn assertion signature (DER) as NEAR Intents takes it:
    /// r (32) ‖ s (32), low-s (Intents rejects the high-s twin).
    static func compactLowS(derSignature: Data) throws -> Data {
        let compact = try P256.Signing.ECDSASignature(derRepresentation: derSignature).rawRepresentation
        return LowS.normalize(compact, order: order, halfOrder: halfOrder)
    }

    /// True if `compact` (r ‖ s) is `publicKey`'s signature of SHA-256(message).
    static func isValid(compact: Data, message: Data, publicKey: Data) -> Bool {
        guard let key = try? P256.Signing.PublicKey(rawRepresentation: publicKey),
              let signature = try? P256.Signing.ECDSASignature(rawRepresentation: compact) else {
            return false
        }
        return key.isValidSignature(signature, for: message)
    }
}

enum RefundPasskeyError: Error, Equatable, CustomStringConvertible {
    /// No domain for the passkey is configured (Secrets.xcconfig).
    case notConfigured
    case cancelled
    /// iOS refused, e.g. the domain is not associated with the app.
    case failed(String)
    case keychain(OSStatus)
    /// The assertion is not what Intents can verify.
    case badAssertion(String)

    var description: String {
        switch self {
        case .notConfigured: "no passkey domain configured"
        case .cancelled: "cancelled"
        case let .failed(reason): "passkey: \(reason)"
        case let .keychain(status): "keychain error \(status)"
        case let .badAssertion(reason): "passkey assertion: \(reason)"
        }
    }
}
