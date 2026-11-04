import { describe, expect, it } from 'vitest';
import { PAYMENT_OPTIONS, findPaymentOption, optionsOnNetwork, paymentNetworks } from '../src/payment-options.ts';

describe('payment options as two choices: network, then token', () => {
  it('lists each network once, in the order of the list', () => {
    expect(paymentNetworks(PAYMENT_OPTIONS)).toEqual(['Base', 'Arbitrum', 'Ethereum', 'Solana', 'NEAR']);
  });

  it('lists the tokens of one network', () => {
    expect(optionsOnNetwork(PAYMENT_OPTIONS, 'Ethereum').map((option) => option.token)).toEqual(['USDC', 'ETH']);
    expect(optionsOnNetwork(PAYMENT_OPTIONS, 'Solana').map((option) => option.token)).toEqual(['USDC', 'SOL']);
    expect(optionsOnNetwork(PAYMENT_OPTIONS, 'Base').map((option) => option.token)).toEqual(['USDC']);
    expect(optionsOnNetwork(PAYMENT_OPTIONS, 'Dogecoin')).toEqual([]);
  });

  it('every option has a unique id', () => {
    const ids = PAYMENT_OPTIONS.map((option) => option.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(findPaymentOption('sol-solana')?.network).toBe('Solana');
  });
});
