import Foundation
import Security

/// Outcome of the receiver's check on one card.
struct BanknoteCheck: Identifiable, Equatable {

    /// Why a card was rejected.
    enum Failure: Equatable {
        case notIssued              // blank card, or issuance never finished
        case malformedCertificate
        case untrustedIssuer
        case badCertificateSignature
        case keyMismatch            // the certificate describes another chip
        case badAuthSignature       // the chip could not prove it holds key A
        case stateMismatch          // signed state differs from INFO
    }

    enum Outcome: Equatable {
        case valid
        case spent
        case invalid(Failure)
    }

    let id = UUID()
    let outcome: Outcome
    let info: CardInfo
    let certificate: BanknoteCertificate?
    let issuer: TrustedIssuer?

    static func == (lhs: Self, rhs: Self) -> Bool { lhs.id == rhs.id }
}

/// The receiver's check (docs/protocol.md §9, "Exchange"): is the card in
/// my hand a genuine, unspent NearCash banknote, and what is it worth?
/// Fully offline: no network call. Mirrors packages/core/src/verify.ts.
struct BanknoteVerifier {
    let trustedIssuers: [TrustedIssuer]

    /// Source of AUTH challenges. Random in the app; fixed in replay tests.
    var makeChallenge: () -> Data = BanknoteVerifier.randomChallenge

    /// Runs on a card that has just been tapped:
    ///  1. SELECT + INFO: the card must be ISSUED (or SPENT, reported as such);
    ///  2. GET_CERT, and the issuer must be trusted and its signature valid;
    ///  3. the keys in the certificate must be the keys inside this chip;
    ///  4. AUTH with a fresh challenge, verified with key A.
    /// The card is valid only if every step passes.
    func check(_ card: NearCashCard) async throws -> BanknoteCheck {
        try await card.select()
        let info = try await card.info()

        guard info.state == .issued || info.state == .spent else {
            return BanknoteCheck(outcome: .invalid(.notIssued), info: info, certificate: nil, issuer: nil)
        }

        // 2. Certificate: well-formed, from a trusted issuer, correctly signed.
        let certificate: BanknoteCertificate
        do {
            certificate = try BanknoteCertificate(decoding: try await card.readCertificate(length: info.certificateLength))
        } catch is ByteReaderError {
            return BanknoteCheck(outcome: .invalid(.malformedCertificate), info: info, certificate: nil, issuer: nil)
        }
        func result(_ outcome: BanknoteCheck.Outcome, issuer: TrustedIssuer? = nil) -> BanknoteCheck {
            BanknoteCheck(outcome: outcome, info: info, certificate: certificate, issuer: issuer)
        }

        guard let issuer = trustedIssuers.first(where: { $0.publicKey == certificate.issuerPublicKey }) else {
            return result(.invalid(.untrustedIssuer))
        }
        guard certificate.hasValidIssuerSignature else {
            return result(.invalid(.badCertificateSignature))
        }

        // 3. The certificate must describe this very chip.
        guard let authKey = info.authPublicKey,
              let fundsKey = info.fundsPublicKey,
              (try? Secp256k1.compressedPublicKey(authKey)) == certificate.authPublicKey,
              (try? Secp256k1.compressedPublicKey(fundsKey)) == certificate.fundsPublicKey else {
            return result(.invalid(.keyMismatch), issuer: issuer)
        }

        // 4. Proof of possession of key A over a fresh challenge. Without it, a
        //    copy of the certificate on a fake card would pass steps 1–3.
        let challenge = makeChallenge()
        let auth = try await card.auth(challenge: challenge)
        var message = NearCashProtocol.authDomainTag
        message.append(challenge)
        message.append(auth.rawState)
        guard Secp256k1.verifySHA256(derSignature: auth.signature, message: message, publicKey: certificate.authPublicKey) else {
            return result(.invalid(.badAuthSignature), issuer: issuer)
        }
        guard auth.rawState == info.rawState else {
            return result(.invalid(.stateMismatch), issuer: issuer)
        }
        return result(auth.rawState == CardState.spent.rawValue ? .spent : .valid, issuer: issuer)
    }

    /// 32 bytes from the system's cryptographically secure generator.
    static func randomChallenge() -> Data {
        var bytes = [UInt8](repeating: 0, count: NearCashProtocol.challengeLength)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        precondition(status == errSecSuccess, "the system random generator failed")
        return Data(bytes)
    }
}
