import type { CardFunding, Nep413Payload, Reserve, SignedNep413 } from './reserve.port.ts';

/**
 * DEVELOPMENT ONLY: an in-memory ledger standing in for the FAR reserve.
 */
export class SimulatedReserve implements Reserve {
  readonly name = 'simulated reserve';
  /** Balance of the reserve per token. */
  readonly balances = new Map<string, bigint>();
  /** What each card account received. */
  readonly cards = new Map<string, bigint>();
  private counter = 0;

  constructor(initial: Record<string, bigint> = {}) {
    for (const [tokenId, amount] of Object.entries(initial)) this.balances.set(tokenId, amount);
  }

  async fundCard(funding: CardFunding): Promise<string> {
    const balance = this.balances.get(funding.tokenId) ?? 0n;
    if (balance < funding.amount) throw new Error('simulated reserve: insufficient balance');
    this.balances.set(funding.tokenId, balance - funding.amount);
    this.cards.set(funding.cardAccountId, (this.cards.get(funding.cardAccountId) ?? 0n) + funding.amount);
    this.counter += 1;
    return `sim-transfer-${this.counter}`;
  }

  /** No key: a recognisable placeholder signature (only simulated payments ever see it). */
  async signIntent(payload: Nep413Payload): Promise<SignedNep413> {
    return { standard: 'nep413', payload, public_key: 'ed25519:simulated-reserve', signature: 'ed25519:simulated' };
  }
}
