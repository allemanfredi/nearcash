import type { IssuanceApi, IssuanceInfo, Sale, SaleDenomination } from '@nearcash/core';

/**
 * What the ATM asks the issuance server: quotes, payment status and
 * certificates (IssuanceApi), plus what its screen shows. The ATM holds no
 * key that creates value: everything that makes a banknote worth something
 * happens there.
 */
export interface AtmIssuanceApi extends IssuanceApi {
  saleDenominations(): Promise<SaleDenomination[]>;
  info(): Promise<IssuanceInfo>;
  /** DEVELOPMENT ONLY: pays a sale when the server simulates payments. */
  simulatePayment(saleId: string): Promise<Sale>;
}

/** Injection token of the AtmIssuanceApi. */
export const ISSUANCE = Symbol('ISSUANCE');

/** Injection token of the issuers a dispensed card must verify against (TrustedIssuer[]). */
export const TRUSTED_ISSUERS = Symbol('TRUSTED_ISSUERS');
