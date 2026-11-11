/**
 * The JSON bodies of the sales API, checked and turned into domain values.
 * Anything malformed is an invalid-request error (400), before any service
 * runs.
 */
import { type BirthProof, type CardPublicKeys, hexToBytes } from '@nearcash/core';
import { DomainError } from '../../common/domain-error.ts';
import type { CreateSaleRequest } from './sales.service.ts';

type Body = Record<string, unknown> | undefined;

/** POST /sales: {amount, originAsset, refundTo?}; amount in the token's smallest unit. */
export function parseCreateSale(body: Body): CreateSaleRequest {
  let amount: bigint;
  try {
    amount = BigInt(String(body?.amount));
  } catch {
    throw new DomainError('invalid-request', 'amount must be an integer (smallest unit)');
  }
  const refundTo = body?.refundTo === undefined || body.refundTo === null ? '' : String(body.refundTo).trim();
  return { amount, originAsset: String(body?.originAsset ?? ''), ...(refundTo ? { refundTo } : {}) };
}

/**
 * POST /sales/:id/issue: {authPublicKey, fundsPublicKey, birth?}, hex;
 * birth = {chipPublicKey, birthSignature, keysSignature} (protocol.md §5.8).
 */
export function parseIssueRequest(body: Body): { keys: CardPublicKeys; birth?: BirthProof } {
  let keys: CardPublicKeys;
  try {
    keys = { authPublicKey: hexToBytes(String(body?.authPublicKey)), fundsPublicKey: hexToBytes(String(body?.fundsPublicKey)) };
  } catch {
    throw new DomainError('invalid-request', 'keys must be hex');
  }
  const birth = body?.birth as Record<string, unknown> | undefined | null;
  if (birth === undefined || birth === null) return { keys };
  try {
    return {
      keys,
      birth: {
        chipPublicKey: hexToBytes(String(birth.chipPublicKey)),
        birthSignature: hexToBytes(String(birth.birthSignature)),
        keysSignature: hexToBytes(String(birth.keysSignature)),
      },
    };
  } catch {
    throw new DomainError('invalid-request', 'birth must be {chipPublicKey, birthSignature, keysSignature}, hex');
  }
}
