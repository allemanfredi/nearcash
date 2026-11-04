import Foundation
import Testing
@testable import NearCashWallet

@Suite("Bytes and amounts")
struct BytesTests {
    @Test func hexRoundTrip() {
        #expect(Data(hex: "80100000")?.hex == "80100000")
        #expect(Data(hex: "ABcd")?.hex == "abcd")
        #expect(Data(hex: "abc") == nil)
        #expect(Data(hex: "zz") == nil)
    }

    @Test func decimalStringOfBigIntegers() {
        #expect(BigEndianInteger.decimalString([0x00, 0x00]) == "0")
        #expect(BigEndianInteger.decimalString([0x01, 0x00]) == "256")
        #expect(BigEndianInteger.decimalString([UInt8](repeating: 0xFF, count: 16)) == "340282366920938463463374607431768211455")
    }

    @Test func tokenAmountsDropTrailingZeros() {
        #expect(formatTokenAmount(uint128(10_000_000_000_000_000), decimals: 18, decimalSeparator: ".") == "0.01")
        #expect(formatTokenAmount(uint128(1_500_000), decimals: 6, decimalSeparator: ",") == "1,5")
        #expect(formatTokenAmount(uint128(5_000_000), decimals: 6, decimalSeparator: ".") == "5")
        #expect(formatTokenAmount(uint128(0), decimals: 6, decimalSeparator: ".") == "0")
        #expect(formatTokenAmount(uint128(42), decimals: 0, decimalSeparator: ".") == "42")
    }

    @Test func pinRules() {
        #expect(NearCashProtocol.isValidPin("1234"))
        #expect(NearCashProtocol.isValidPin("12345678"))
        #expect(!NearCashProtocol.isValidPin("123"))
        #expect(!NearCashProtocol.isValidPin("123456789"))
        #expect(!NearCashProtocol.isValidPin("12a4"))
        #expect(!NearCashProtocol.isValidPin("١٢٣٤")) // non-ASCII digits
    }

    @Test func pinTriesFromStatusWords() {
        #expect(CardError.status(command: "X", statusWord: 0x63C3).pinTriesLeft == 3)
        #expect(CardError.status(command: "X", statusWord: 0x6983).pinTriesLeft == 0)
        #expect(CardError.status(command: "X", statusWord: 0x6985).pinTriesLeft == nil)
    }

    private func uint128(_ value: UInt64) -> [UInt8] {
        [UInt8](repeating: 0, count: 8) + (0..<8).map { UInt8(truncatingIfNeeded: value >> (56 - 8 * $0)) }
    }
}

@Suite("secp256k1")
struct Secp256k1Tests {
    let fixtures = try! ProtocolFixtures.load()

    @Test func highSSignaturesAreNormalisedAndAccepted() throws {
        let der = try #require(Data(hex: fixtures.highS.derSignature))
        let message = try #require(Data(hex: fixtures.highS.message))
        let key = try #require(Data(hex: fixtures.highS.publicKey))

        // A Java Card may return high-s: libsecp256k1 alone would reject it.
        #expect(Secp256k1.verifySHA256(derSignature: der, message: message, publicKey: key))

        var tampered = message
        tampered[tampered.startIndex] ^= 0x01
        #expect(!Secp256k1.verifySHA256(derSignature: der, message: tampered, publicKey: key))
    }

    @Test func lowSMatchesTheReference() throws {
        let lowS = try #require(Data(hex: fixtures.highS.lowSCompact))
        // lowS of an already-low signature is the identity…
        #expect(Secp256k1.lowS(lowS) == lowS)
        // …and n − s of the high twin gives the reference low-s signature.
        let r = lowS.prefix(32)
        let highTwin = try #require(highSCompact(fromDER: fixtures.highS.derSignature))
        #expect(highTwin.prefix(32) == r)
        #expect(Secp256k1.lowS(highTwin) == lowS)
    }

    @Test func compressesKeys() throws {
        let uncompressed = try #require(Data(hex: fixtures.highS.publicKey))
        let compressed = try Secp256k1.compressedPublicKey(uncompressed)
        #expect(compressed.count == 33)
        #expect(compressed[0] == 0x02 || compressed[0] == 0x03)
        #expect(compressed.dropFirst() == uncompressed.dropFirst().prefix(32))
        #expect(throws: (any Error).self) { try Secp256k1.compressedPublicKey(Data(repeating: 7, count: 33)) }
    }

    /// Minimal DER → compact r ‖ s (32-byte big-endian each), for the test only.
    private func highSCompact(fromDER hex: String) -> Data? {
        guard let der = Data(hex: hex).map({ [UInt8]($0) }), der.count > 8, der[0] == 0x30 else { return nil }
        var index = 2
        func integer() -> [UInt8]? {
            guard der[index] == 0x02 else { return nil }
            let length = Int(der[index + 1])
            let value = Array(der[(index + 2)..<(index + 2 + length)])
            index += 2 + length
            let trimmed = Array(value.drop { $0 == 0 })
            return [UInt8](repeating: 0, count: 32 - trimmed.count) + trimmed
        }
        guard let r = integer(), let s = integer() else { return nil }
        return Data(r + s)
    }
}

@Suite("Certificate v1")
struct CertificateTests {
    let fixtures = try! ProtocolFixtures.load()

    @Test func decodesEveryField() throws {
        let certificate = try BanknoteCertificate(decoding: try #require(Data(hex: fixtures.certificate.hex)))
        #expect(certificate.formattedAmount(decimalSeparator: ".") == fixtures.certificate.amountText)
        #expect(certificate.decimals == fixtures.certificate.decimals)
        #expect(certificate.symbol == fixtures.certificate.symbol)
        #expect(certificate.tokenId == fixtures.certificate.tokenId)
        #expect(certificate.contractId == fixtures.certificate.contractId)
        #expect(certificate.issuerPublicKey.hex == fixtures.devIssuerPublicKey)
        #expect(certificate.hasValidIssuerSignature)
    }

    @Test func detectsTampering() throws {
        var bytes = try #require(Data(hex: fixtures.certificate.hex))
        bytes[bytes.startIndex + 85] ^= 0x01 // last byte of the 16-byte amount
        #expect(try !BanknoteCertificate(decoding: bytes).hasValidIssuerSignature)
    }

    @Test func rejectsMalformedBytes() throws {
        let bytes = try #require(Data(hex: fixtures.certificate.hex))
        var badMagic = bytes
        badMagic[badMagic.startIndex] = 0
        #expect(throws: (any Error).self) { try BanknoteCertificate(decoding: badMagic) }
        #expect(throws: (any Error).self) { try BanknoteCertificate(decoding: bytes.prefix(100)) }
    }

    @Test func devIssuerMatchesTypeScript() {
        #expect(TrustedIssuers.development.publicKey.hex == fixtures.devIssuerPublicKey)
    }
}

@Suite("Banknote verification (replayed from the real applet)")
struct VerifierReplayTests {
    let fixtures = try! ProtocolFixtures.load()

    private func verifier(trusting issuers: [TrustedIssuer] = [TrustedIssuers.development]) -> BanknoteVerifier {
        var verifier = BanknoteVerifier(trustedIssuers: issuers)
        let challenge = Data(hex: fixtures.fixedChallenge)!
        verifier.makeChallenge = { challenge } // the challenge used when recording
        return verifier
    }

    @Test func validBanknote() async throws {
        let card = NearCashCard(transport: ReplayTransport(fixtures.validCard))
        let check = try await verifier().check(card)
        #expect(check.outcome == .valid)
        #expect(check.issuer == TrustedIssuers.development)
        #expect(check.certificate?.formattedAmount(decimalSeparator: ".") == "0.01")
        #expect(check.info.pinTriesRemaining == 5)
    }

    @Test func spentBanknote() async throws {
        let card = NearCashCard(transport: ReplayTransport(fixtures.spentCard))
        #expect(try await verifier().check(card).outcome == .spent)
    }

    @Test func untrustedIssuer() async throws {
        let card = NearCashCard(transport: ReplayTransport(fixtures.validCard))
        #expect(try await verifier(trusting: []).check(card).outcome == .invalid(.untrustedIssuer))
    }

    @Test func forgedAuthSignature() async throws {
        // Flip one byte inside the AUTH signature (last exchange).
        let transport = ReplayTransport(fixtures.validCard) { exchanges in
            var response = Data(hex: exchanges[exchanges.count - 1].response)!
            response[response.startIndex + 10] ^= 0x01
            exchanges[exchanges.count - 1] = .init(command: exchanges[exchanges.count - 1].command, response: response.hex)
        }
        let check = try await verifier().check(NearCashCard(transport: transport))
        #expect(check.outcome == .invalid(.badAuthSignature))
    }

    @Test func certificateFromAnotherCard() async throws {
        // INFO of the spent card + certificate of the valid one: keys do not match.
        let transport = ReplayTransport(fixtures.validCard) { exchanges in
            exchanges[1] = fixtures.spentCard.exchanges[1]
        }
        let check = try await verifier().check(NearCashCard(transport: transport))
        #expect(check.outcome == .invalid(.keyMismatch))
    }
}
