import { findEvmSender } from './evm-sender.ts';
import { findNearSender } from './near-sender.ts';
import { originChainOf } from './origin-chain.ts';
import type { Deposit, SenderFinder } from './sender-finder.port.ts';
import { findSolanaSender } from './solana-sender.ts';

/** Where to read each origin chain (mainnet: 1Click only runs there). */
export type ChainRpcUrls = {
  base: string;
  arbitrum: string;
  ethereum: string;
  solana: string;
  near: string;
  /** NearBlocks API: tells a NEAR transaction's signer from its hash. */
  nearIndexer: string;
};

/** Finds the sender on the deposit's own chain, picked from its asset id. */
export class ChainSenderFinder implements SenderFinder {
  readonly name = 'origin chains (JSON-RPC)';
  private readonly rpc: ChainRpcUrls;

  constructor(rpc: ChainRpcUrls) {
    this.rpc = rpc;
  }

  async findSender(deposit: Deposit): Promise<string | null> {
    const chain = originChainOf(deposit.originAsset);
    if (!chain || deposit.transactions.length === 0) return null;
    switch (chain.kind) {
      case 'evm':
        return findEvmSender(this.rpc[chain.chain], chain.token, deposit.depositAddress, deposit.transactions);
      case 'solana':
        return findSolanaSender(this.rpc.solana, chain.native, deposit.depositAddress, deposit.transactions);
      case 'near':
        return findNearSender(this.rpc.near, this.rpc.nearIndexer, chain.token, deposit.depositAddress, deposit.transactions);
    }
  }
}
