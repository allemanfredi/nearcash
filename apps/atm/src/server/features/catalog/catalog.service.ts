import { formatAmount } from '@nearcash/core';
import { Inject, Injectable } from '@nestjs/common';
import { type Setup, PAYMENT_OPTIONS } from '@nearcash/kiosk-api';
import { CASSETTE, type Cassette } from '../hardware/hardware.ports.ts';
import { type AtmIssuanceApi, ISSUANCE } from '../issuance/issuance.port.ts';

/** "10000.5" → "10,000.5": commas between thousands of the whole part, as the screen (English) writes them. */
export function groupThousands(amount: string): string {
  const [whole, fraction] = amount.split('.');
  const grouped = whole!.replace(/\B(?=(\d{3})+$)/g, ',');
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

/** How long the banknotes on sale are cached (the issuer contract rarely changes). */
const CACHE_MS = 60_000;

/**
 * What the screen offers: the banknotes on sale and the ways to pay for
 * them, or why the ATM is out of service.
 */
@Injectable()
export class CatalogService {
  private cached: { value: Omit<Setup, 'outOfService'>; readAt: number } | undefined;

  constructor(
    @Inject(ISSUANCE) private readonly issuance: AtmIssuanceApi,
    @Inject(CASSETTE) private readonly cassette: Cassette,
  ) {}

  async setup(): Promise<Setup> {
    // Asked every time (never cached): a reader can be connected or a cassette run out.
    const outOfService = await this.cassette.unavailableReason();
    return { ...(await this.catalog()), outOfService };
  }

  private async catalog(): Promise<Omit<Setup, 'outOfService'>> {
    if (this.cached && Date.now() - this.cached.readAt < CACHE_MS) return this.cached.value;
    const [banknotes, info] = await Promise.all([this.issuance.saleDenominations(), this.issuance.info()]);
    const value = {
      banknotes: banknotes.map((banknote) => {
        const value = groupThousands(formatAmount(banknote.amount, banknote.decimals));
        return { amount: banknote.amount.toString(), value, symbol: banknote.symbol, label: `${value} ${banknote.symbol}` };
      }),
      paymentOptions: PAYMENT_OPTIONS,
      simulatedPayments: info.simulatedPayments,
    };
    this.cached = { value, readAt: Date.now() };
    return value;
  }
}
