import Foundation

/// Banknote certificate v1 (docs/protocol.md §8): what the issuer vouches
/// for about one card. Stored on the card at issuance, read with GET_CERT,
/// checked offline by anyone.
struct BanknoteCertificate: Equatable {
    static let magic = Data("NBC1".utf8)

    /// Key A of the card, compressed SEC1 (33 bytes).
    let authPublicKey: Data
    /// Key F of the card (controls its Intents account), compressed SEC1.
    let fundsPublicKey: Data
    /// Value in the token's smallest unit, unsigned 128-bit big-endian.
    let amount: [UInt8]
    let decimals: Int
    let issuedAt: Date
    /// Intents token id, e.g. "nep141:eth.omft.near".
    let tokenId: String
    /// Display symbol, e.g. "ETH".
    let symbol: String
    /// Intents/FAR contract holding the funds.
    let contractId: String
    /// Issuer public key, compressed SEC1.
    let issuerPublicKey: Data
    /// Compact r ‖ s ECDSA signature over SHA-256(signedBody).
    let signature: Data
    /// Everything before the signature.
    let signedBody: Data

    /// Parses certificate bytes. Throws if the encoding is malformed;
    /// a wrong signature is reported by `hasValidIssuerSignature` instead.
    init(decoding bytes: Data) throws {
        var reader = ByteReader(bytes)
        guard try reader.readData(Self.magic.count) == Self.magic else {
            throw ByteReaderError(description: "not a NearCash v1 certificate")
        }
        authPublicKey = try Self.readKey(&reader)
        fundsPublicKey = try Self.readKey(&reader)
        amount = try reader.read(16)
        decimals = Int(try reader.readUInt8())
        issuedAt = Date(timeIntervalSince1970: TimeInterval(try reader.readUInt64()))
        tokenId = try reader.readLengthPrefixedUTF8()
        symbol = try reader.readLengthPrefixedUTF8()
        contractId = try reader.readLengthPrefixedUTF8()
        issuerPublicKey = try Self.readKey(&reader)
        signedBody = bytes.prefix(reader.offset)
        signature = try reader.readData(64)
        try reader.expectEnd("certificate")
    }

    /// True if the issuer's signature over the body is valid.
    var hasValidIssuerSignature: Bool {
        Secp256k1.verifySHA256(compactSignature: signature, message: signedBody, publicKey: issuerPublicKey)
    }

    /// Amount for display, e.g. "0,01" with separator "," or "0.01" with ".".
    /// The UI chooses the separator; this layer knows nothing about locales.
    func formattedAmount(decimalSeparator: String) -> String {
        formatTokenAmount(amount, decimals: decimals, decimalSeparator: decimalSeparator)
    }

    private static func readKey(_ reader: inout ByteReader) throws -> Data {
        let key = try reader.readData(33)
        _ = try Secp256k1.compressedPublicKey(key) // throws if not a curve point
        return key
    }
}
