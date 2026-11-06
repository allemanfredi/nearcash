import Foundation

/// Keccak-256: the hash of Ethereum and of NEAR Intents' "0x…" accounts.
///
/// Not SHA3-256: Keccak-256 is the original Keccak submission, which pads
/// with 0x01 where the later SHA3 standard pads with 0x06, so the two give
/// different digests. Apple's CryptoKit has neither, hence this small
/// implementation of the Keccak specification
/// (https://keccak.team/keccak_specs_summary.html). Checked in the tests
/// against published vectors and against the TypeScript implementation.
///
/// The wallet needs it for:
///  - the card's account id, the Ethereum address of key F;
///  - the ERC-191 digest the card signs to redeem;
///  - the account id of the refund passkey (P-256).
enum Keccak256 {

    /// Bytes absorbed per permutation: 1600 − 2 × 256 bits = 1088 bits.
    private static let rate = 136

    /// Round constants of the ι step, one per round (24 rounds).
    private static let roundConstants: [UInt64] = [
        0x0000_0000_0000_0001, 0x0000_0000_0000_8082, 0x8000_0000_0000_808A, 0x8000_0000_8000_8000,
        0x0000_0000_0000_808B, 0x0000_0000_8000_0001, 0x8000_0000_8000_8081, 0x8000_0000_0000_8009,
        0x0000_0000_0000_008A, 0x0000_0000_0000_0088, 0x0000_0000_8000_8009, 0x0000_0000_8000_000A,
        0x0000_0000_8000_808B, 0x8000_0000_0000_008B, 0x8000_0000_0000_8089, 0x8000_0000_0000_8003,
        0x8000_0000_0000_8002, 0x8000_0000_0000_0080, 0x0000_0000_0000_800A, 0x8000_0000_8000_000A,
        0x8000_0000_8000_8081, 0x8000_0000_0000_8080, 0x0000_0000_8000_0001, 0x8000_0000_8000_8008,
    ]

    /// Rotation offsets of the ρ step, for lane (x, y) at index x + 5y.
    private static let rotations: [UInt64] = [
        0, 1, 62, 28, 27,
        36, 44, 6, 55, 20,
        3, 10, 43, 25, 39,
        41, 45, 15, 21, 8,
        18, 2, 61, 56, 14,
    ]

    /// The 32-byte Keccak-256 digest of `data`.
    static func hash(_ data: Data) -> Data {
        // Padding "pad10*1" with the Keccak domain bit: 0x01 … 0x80 (one
        // byte 0x81 when only one byte is left in the block).
        var message = [UInt8](data)
        message.append(0x01)
        while message.count % rate != 0 { message.append(0x00) }
        message[message.count - 1] |= 0x80

        // The state: 25 lanes of 64 bits, lane (x, y) at index x + 5y.
        var state = [UInt64](repeating: 0, count: 25)
        for blockStart in stride(from: 0, to: message.count, by: rate) {
            // Absorb: XOR the block into the first rate/8 lanes, little-endian.
            for lane in 0..<(rate / 8) {
                var value: UInt64 = 0
                for byte in 0..<8 {
                    value |= UInt64(message[blockStart + lane * 8 + byte]) << (8 * UInt64(byte))
                }
                state[lane] ^= value
            }
            permute(&state)
        }

        // Squeeze: the first 32 bytes of the state, little-endian lanes.
        var digest = [UInt8]()
        digest.reserveCapacity(32)
        for lane in 0..<4 {
            for byte in 0..<8 {
                digest.append(UInt8(truncatingIfNeeded: state[lane] >> (8 * UInt64(byte))))
            }
        }
        return Data(digest)
    }

    static func hash(_ text: String) -> Data {
        hash(Data(text.utf8))
    }

    /// Keccak-f[1600]: 24 rounds of θ, ρ, π, χ, ι.
    private static func permute(_ state: inout [UInt64]) {
        for round in 0..<24 {
            // θ: XOR each lane with the parities of two neighbouring columns.
            var columnParity = [UInt64](repeating: 0, count: 5)
            for x in 0..<5 {
                columnParity[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20]
            }
            for x in 0..<5 {
                let mix = columnParity[(x + 4) % 5] ^ rotateLeft(columnParity[(x + 1) % 5], by: 1)
                for y in 0..<5 {
                    state[x + 5 * y] ^= mix
                }
            }

            // ρ and π: rotate every lane, then move lane (x, y) to (y, 2x + 3y).
            var moved = [UInt64](repeating: 0, count: 25)
            for x in 0..<5 {
                for y in 0..<5 {
                    let index = x + 5 * y
                    moved[y + 5 * ((2 * x + 3 * y) % 5)] = rotateLeft(state[index], by: rotations[index])
                }
            }

            // χ: the only non-linear step, row by row.
            for y in 0..<5 {
                for x in 0..<5 {
                    state[x + 5 * y] = moved[x + 5 * y] ^ (~moved[(x + 1) % 5 + 5 * y] & moved[(x + 2) % 5 + 5 * y])
                }
            }

            // ι: break the symmetry between rounds.
            state[0] ^= roundConstants[round]
        }
    }

    private static func rotateLeft(_ value: UInt64, by amount: UInt64) -> UInt64 {
        amount == 0 ? value : (value << amount) | (value >> (64 - amount))
    }
}
