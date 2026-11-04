import Foundation
import Testing
@testable import NearCashWallet

/// Fixtures recorded from the applet (running in jCardSim) on 2026-11-03.
/// They tie the Swift implementation to the card and to the TypeScript one.
/// Record them again from a real J3R180 once the cards are here.
struct ProtocolFixtures: Decodable {
    struct Exchange: Decodable {
        let command: String
        let response: String
    }

    struct Transcript: Decodable {
        let exchanges: [Exchange]
    }

    struct CertificateFixture: Decodable {
        let hex: String
        let amountText: String
        let decimals: Int
        let symbol: String
        let tokenId: String
        let contractId: String
    }

    struct HighSFixture: Decodable {
        let publicKey: String
        let message: String
        let derSignature: String
        let lowSCompact: String
    }

    let devIssuerPublicKey: String
    let fixedChallenge: String
    let certificate: CertificateFixture
    let validCard: Transcript
    let spentCard: Transcript
    let highS: HighSFixture

    static func load() throws -> ProtocolFixtures {
        let url = try #require(Bundle(for: BundleToken.self).url(forResource: "protocol-fixtures", withExtension: "json"))
        return try JSONDecoder().decode(ProtocolFixtures.self, from: Data(contentsOf: url))
    }
}

private final class BundleToken {}

/// Plays back a recorded card session. Every command must match the
/// recording byte for byte and in order, so these tests also prove the
/// Swift client builds exactly the same APDUs as the TypeScript one.
actor ReplayTransport: CardTransport {
    enum ReplayError: Error, CustomStringConvertible {
        case unexpected(command: String)
        case mismatch(expected: String, actual: String)

        var description: String {
            switch self {
            case let .unexpected(command): "unexpected extra command \(command)"
            case let .mismatch(expected, actual): "expected \(expected), got \(actual)"
            }
        }
    }

    private var remaining: [ProtocolFixtures.Exchange]

    init(_ transcript: ProtocolFixtures.Transcript, tamper: ((inout [ProtocolFixtures.Exchange]) -> Void)? = nil) {
        var exchanges = transcript.exchanges
        tamper?(&exchanges)
        remaining = exchanges
    }

    func transmit(_ command: Data) async throws -> Data {
        guard !remaining.isEmpty else { throw ReplayError.unexpected(command: command.hex) }
        let next = remaining.removeFirst()
        guard next.command == command.hex else {
            throw ReplayError.mismatch(expected: next.command, actual: command.hex)
        }
        return Data(hex: next.response)!
    }
}
