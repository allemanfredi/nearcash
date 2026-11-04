import Foundation

/// How bytes reach a card. The protocol code only needs "send this APDU,
/// give me the answer": Core NFC on the iPhone, a recorded transcript in
/// the tests.
protocol CardTransport {
    /// Sends one command APDU and returns the full response:
    /// response data followed by the status bytes SW1 SW2.
    func transmit(_ command: Data) async throws -> Data
}

/// Encodes short ISO 7816-4 APDUs: CLA INS P1 P2 [Lc data] [Le].
enum APDU {
    /// - Parameter expectedLength: Le, 1–256 (256 is encoded as 0x00). Nil when the command returns no data.
    static func command(
        cla: UInt8,
        ins: UInt8,
        p1: UInt8 = 0,
        p2: UInt8 = 0,
        data: Data = Data(),
        expectedLength: Int? = nil
    ) -> Data {
        precondition(data.count <= 255, "short APDU data must be ≤ 255 bytes")
        var apdu = Data([cla, ins, p1, p2])
        if !data.isEmpty {
            apdu.append(UInt8(data.count))
            apdu.append(data)
        }
        if let expectedLength {
            precondition((1...256).contains(expectedLength), "Le must be 1–256")
            apdu.append(expectedLength == 256 ? 0x00 : UInt8(expectedLength))
        }
        return apdu
    }
}
