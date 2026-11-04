import { originChainOf } from './origin-chain.ts';
import type { Deposit, SenderFinder } from './sender-finder.port.ts';

/** Example addresses (valid formats) that simulated payments "come from". */
export const SIMULATED_SENDERS = {
  evm: '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed', // the EIP-55 example address
  solana: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
  near: 'customer.near',
} as const;

/** DEVELOPMENT ONLY: with simulated payments, every deposit comes from an example address of its chain. */
export class SimulatedSenderFinder implements SenderFinder {
  readonly name = 'simulated senders';

  async findSender(deposit: Deposit): Promise<string | null> {
    if (deposit.transactions.length === 0) return null;
    const chain = originChainOf(deposit.originAsset);
    return chain ? SIMULATED_SENDERS[chain.kind] : null;
  }
}
