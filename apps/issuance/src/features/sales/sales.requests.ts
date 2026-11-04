/**
 * The JSON bodies of the sales API, checked and turned into domain values.
 * Anything malformed is an invalid-request error (400), before any service
 * runs.
 */
import { type CardPublicKeys, hexToBytes } from '@nearcash/core';
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

/** POST /sales/:id/issue: {authPublicKey, fundsPublicKey}, hex. */
export function parseCardKeys(body: Body): CardPublicKeys {
  try {
    return { authPublicKey: hexToBytes(String(body?.authPublicKey)), fundsPublicKey: hexToBytes(String(body?.fundsPublicKey)) };
  } catch {
    throw new DomainError('invalid-request', 'keys must be hex');
  }
}
