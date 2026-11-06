import Foundation

/// Parsed INFO response (protocol.md §5.1).
struct CardInfo: Equatable {
    let version: UInt8
    /// Raw state byte; see `state` for the typed value.
    let rawState: UInt8
    let pinTriesRemaining: Int
    let certificateLength: Int
    /// Uncompressed SEC1 keys; nil while the card is EMPTY.
    let authPublicKey: Data?
    let fundsPublicKey: Data?

    /// Nil for a state byte this app does not know.
    var state: CardState? { CardState(rawValue: rawState) }
}

/// AUTH response (protocol.md §5.3).
struct AuthResponse: Equatable {
    /// State byte the card signed together with the challenge.
    let rawState: UInt8
    /// DER ECDSA signature by key A over SHA-256(tag ‖ challenge ‖ state). May be high-s.
    let signature: Data
}

/// Client for the NearCash applet: one method per command the wallet needs
/// (protocol.md §5): checking, taking over and redeeming a banknote. Every call sends real APDUs through a `CardTransport`,
/// so the same code drives an NFC card or the tests' recorded transcripts.
///
/// The byte layout of every APDU is identical to the TypeScript client
/// (packages/core/src/card.ts); the replay tests rely on it.
struct NearCashCard {
    let transport: CardTransport

    /// SELECT the NearCash applet. Must be the first command after every tap.
    func select() async throws {
        let apdu = APDU.command(cla: 0x00, ins: 0xA4, p1: 0x04, p2: 0x00, data: NearCashProtocol.appletAID)
        _ = try await exchange("SELECT", apdu)
    }

    /// INFO: version, state, PIN tries, certificate length, public keys.
    func info() async throws -> CardInfo {
        let data = try await command("INFO", .info, expectedLength: 256)
        do {
            var reader = ByteReader(data)
            let version = try reader.readUInt8()
            let state = try reader.readUInt8()
            let tries = Int(try reader.readUInt8())
            let certificateLength = try reader.readUInt16()
            var authKey: Data?
            var fundsKey: Data?
            if reader.remaining > 0 {
                authKey = try reader.readData(NearCashProtocol.publicKeyLength)
                fundsKey = try reader.readData(NearCashProtocol.publicKeyLength)
            }
            try reader.expectEnd("INFO")
            return CardInfo(
                version: version,
                rawState: state,
                pinTriesRemaining: tries,
                certificateLength: certificateLength,
                authPublicKey: authKey,
                fundsPublicKey: fundsKey
            )
        } catch let error as ByteReaderError {
            throw CardError.malformedResponse(command: "INFO", reason: error.description)
        }
    }

    /// GET_CERT in chunks until `length` bytes have been read.
    func readCertificate(length: Int) async throws -> Data {
        var certificate = Data()
        while certificate.count < length {
            let offset = certificate.count
            let chunk = try await command(
                "GET_CERT",
                .getCertificate,
                p1: UInt8(offset >> 8),
                p2: UInt8(offset & 0xFF),
                expectedLength: min(NearCashProtocol.maxReadChunk, length - offset)
            )
            guard !chunk.isEmpty else {
                throw CardError.malformedResponse(command: "GET_CERT", reason: "no data at offset \(offset)")
            }
            certificate.append(chunk)
        }
        return certificate
    }

    /// AUTH: the card signs `challenge` and its state with key A.
    func auth(challenge: Data) async throws -> AuthResponse {
        let data = try await command("AUTH", .auth, data: challenge, expectedLength: 256)
        guard let state = data.first, data.count > 1 else {
            throw CardError.malformedResponse(command: "AUTH", reason: "too short")
        }
        return AuthResponse(rawState: state, signature: data.dropFirst())
    }

    /// CHANGE_PIN: replace the holder PIN (done by the receiver after an exchange).
    func changePin(from oldPin: String, to newPin: String) async throws {
        precondition(NearCashProtocol.isValidPin(oldPin) && NearCashProtocol.isValidPin(newPin), "PINs must be 4–8 digits")
        var data = Data([UInt8(oldPin.utf8.count)])
        data.append(contentsOf: oldPin.utf8)
        data.append(UInt8(newPin.utf8.count))
        data.append(contentsOf: newPin.utf8)
        _ = try await command("CHANGE_PIN", .changePin, data: data)
    }

    /// SIGN_ONCE (protocol.md §5.4): the card signs `digest` with key F and
    /// becomes SPENT in the same atomic step. On a card that is already SPENT
    /// only the very same digest is answered, with the stored signature:
    /// this is how an interrupted redemption is resumed.
    ///
    /// - Returns: the DER signature, possibly high-s.
    func signOnce(pin: String, digest: Data) async throws -> Data {
        precondition(NearCashProtocol.isValidPin(pin), "PIN must be 4–8 digits")
        precondition(digest.count == 32, "SIGN_ONCE signs a 32-byte digest")
        var data = Data([UInt8(pin.utf8.count)])
        data.append(contentsOf: pin.utf8)
        data.append(digest)
        return try await command("SIGN_ONCE", .signOnce, data: data, expectedLength: 256)
    }

    // MARK: - Plumbing

    private func command(
        _ name: String,
        _ instruction: Instruction,
        p1: UInt8 = 0,
        p2: UInt8 = 0,
        data: Data = Data(),
        expectedLength: Int? = nil
    ) async throws -> Data {
        let apdu = APDU.command(
            cla: NearCashProtocol.cla,
            ins: instruction.rawValue,
            p1: p1,
            p2: p2,
            data: data,
            expectedLength: expectedLength
        )
        return try await exchange(name, apdu)
    }

    /// Sends an APDU, checks the status word, strips it from the answer.
    private func exchange(_ name: String, _ apdu: Data) async throws -> Data {
        let response = try await transport.transmit(apdu)
        guard response.count >= 2 else {
            throw CardError.malformedResponse(command: name, reason: "shorter than a status word")
        }
        let statusWord = UInt16(response[response.endIndex - 2]) << 8 | UInt16(response[response.endIndex - 1])
        guard statusWord == StatusWord.ok else {
            throw CardError.status(command: name, statusWord: statusWord)
        }
        return Data(response.dropLast(2))
    }
}
