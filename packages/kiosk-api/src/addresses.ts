/**
 * Refund addresses. Giving one is optional: by default a refund goes back to
 * the address the payment came from. Customers who pay from an exchange give
 * their own address instead, and 1Click refunds it directly on the chain
 * they paid from, so a wrong address means lost money. We check it as
 * strictly as the format allows before creating a sale.
 *
 * Shared by the kiosk page (immediate feedback) and the ATM server (the
 * check that counts).
 */
import { keccak_256 } from '@noble/hashes/sha3.js';
import { base58 } from '@scure/base';
import type { AddressKind } from './payment-options.ts';

/** Why `address` can't be a refund address on this kind of chain, or null if it can. */
export function refundAddressProblem(kind: AddressKind, address: string): string | null {
  if (address.length === 0) return 'Enter an address.';
  switch (kind) {
    case 'evm':
      return evmAddressProblem(address);
    case 'solana':
      return solanaAddressProblem(address);
    case 'near':
      return nearAccountProblem(address);
  }
}

// ---------------------------------------------------------------- EVM

function evmAddressProblem(address: string): string | null {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return 'Not an address: it should be 0x and 40 hex characters.';
  // All-lowercase or all-uppercase addresses carry no checksum. Mixed case
  // must match EIP-55, which catches almost every typo.
  const hex = address.slice(2);
  const hasChecksum = hex !== hex.toLowerCase() && hex !== hex.toUpperCase();
  if (hasChecksum && toChecksumAddress(address) !== address) return 'This address has a typo (its checksum is wrong).';
  return null;
}

/** EIP-55: uppercase each hex letter whose nibble in keccak256(lowercase address) is >= 8. */
export function toChecksumAddress(address: string): string {
  const lower = address.slice(2).toLowerCase();
  const hash = keccak_256(new TextEncoder().encode(lower));
  let result = '0x';
  for (let i = 0; i < lower.length; i++) {
    const byte = hash[i >> 1]!;
    const nibble = i % 2 === 0 ? byte >> 4 : byte & 0x0f;
    result += nibble >= 8 ? lower[i]!.toUpperCase() : lower[i]!;
  }
  return result;
}

// ---------------------------------------------------------------- Solana

function solanaAddressProblem(address: string): string | null {
  // A Solana address is a 32-byte public key in base58 (32 to 44 characters).
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return 'Not a Solana address.';
  try {
    if (base58.decode(address).length !== 32) return 'Not a Solana address.';
  } catch {
    return 'Not a Solana address.';
  }
  return null;
}

// ---------------------------------------------------------------- NEAR

function nearAccountProblem(account: string): string | null {
  // Implicit accounts: 64 lowercase hex characters (ed25519 key) or an
  // Ethereum-style 0x address. Named accounts: 2–64 characters, lowercase
  // letters, digits and separators, as nearcore validates them.
  if (/^[0-9a-f]{64}$/.test(account)) return null;
  if (/^0x[0-9a-f]{40}$/.test(account)) return null;
  const named = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
  if (account.length < 2 || account.length > 64 || !named.test(account)) return 'Not a NEAR account.';
  return null;
}
