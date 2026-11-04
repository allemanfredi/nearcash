import CoreNFC
import Foundation

/// Reads NearCash cards with the iPhone's NFC (Core NFC, ISO 7816 tags).
///
/// iOS reports an ISO 7816 card only if it answers SELECT for one of the
/// AIDs listed in Info.plist, so only NearCash cards ever reach the app.
///
/// One `withCard` call = one system NFC sheet:
///   begin session → card detected → connect → run the task → close the
///   sheet with a success or error message.
@MainActor
final class NFCCardReader: NSObject, CardReader {

    private var session: NFCTagReaderSession?
    /// Resumed when a card is connected, or when the session ends first.
    private var pendingConnection: CheckedContinuation<NFCISO7816Tag, Error>?

    func withCard<T>(
        prompt: String,
        task: (NearCashCard) async throws -> T,
        successMessage: (T) -> String
    ) async throws -> T {
        guard NFCTagReaderSession.readingAvailable else { throw ReaderError.nfcUnavailable }

        let tag = try await connect(prompt: prompt)
        do {
            let result = try await task(NearCashCard(transport: NFCTransport(tag: tag)))
            session?.alertMessage = successMessage(result)
            session?.invalidate()
            return result
        } catch {
            session?.invalidate(errorMessage: Strings.nfcSheetError)
            throw error
        }
    }

    /// Opens the NFC sheet and waits until a NearCash card is connected.
    private func connect(prompt: String) async throws -> NFCISO7816Tag {
        try await withCheckedThrowingContinuation { continuation in
            guard let newSession = NFCTagReaderSession(pollingOption: .iso14443, delegate: self, queue: .main) else {
                continuation.resume(throwing: ReaderError.nfcUnavailable)
                return
            }
            pendingConnection = continuation
            session = newSession
            newSession.alertMessage = prompt
            newSession.begin()
        }
    }

    private func finishConnecting(with result: Result<NFCISO7816Tag, Error>) {
        pendingConnection?.resume(with: result)
        pendingConnection = nil
    }

    private func handleDetected(_ tags: [NFCTag], in session: NFCTagReaderSession) {
        guard tags.count == 1, let detected = tags.first, case let .iso7816(card) = detected else {
            session.alertMessage = Strings.nfcOneCardOnly
            session.restartPolling()
            return
        }
        session.connect(to: detected) { [weak self] error in
            Task { @MainActor in
                if error != nil {
                    // The invalidation callback rejects the pending connection.
                    session.invalidate(errorMessage: Strings.nfcConnectionLost)
                } else {
                    self?.finishConnecting(with: .success(card))
                }
            }
        }
    }

    private func handleInvalidation(_ error: Error) {
        // Also called after our own invalidate(); then nothing is pending.
        let cancelled = (error as? NFCReaderError)?.code == .readerSessionInvalidationErrorUserCanceled
        finishConnecting(with: .failure(cancelled ? ReaderError.cancelled : ReaderError.connectionLost))
        session = nil
    }
}

// The session delivers callbacks on the main queue (see `connect`); we hop
// to the main actor explicitly so the code stays correct regardless.
extension NFCCardReader: NFCTagReaderSessionDelegate {
    nonisolated func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) {}

    nonisolated func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
        Task { @MainActor in self.handleDetected(tags, in: session) }
    }

    nonisolated func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
        Task { @MainActor in self.handleInvalidation(error) }
    }
}

/// Sends APDUs to a connected ISO 7816 card.
private struct NFCTransport: CardTransport {
    let tag: NFCISO7816Tag

    func transmit(_ command: Data) async throws -> Data {
        guard let apdu = NFCISO7816APDU(data: command) else {
            throw CardError.malformedResponse(command: "APDU", reason: "cannot be encoded for Core NFC")
        }
        let (response, sw1, sw2) = try await tag.sendCommand(apdu: apdu)
        return response + Data([sw1, sw2])
    }
}
