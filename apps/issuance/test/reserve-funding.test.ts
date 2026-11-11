/**
 * `pnpm issuance:fund-reserve`: the amount it reads and the 1Click quote it
 * asks for (real money: USDC from Base into the reserve, as USDC on Ethereum).
 */
import { describe, expect, it } from 'vitest';
import { describeFundingStatus, fundingQuote, isEvmAddress, parseUsdc } from '../src/features/reserve/reserve-funding.ts';
import { USDC } from '../src/features/sales/face-value.ts';

describe('reserve funding', () => {
  it('reads USDC amounts with up to 6 decimals, and nothing else', () => {
    expect(parseUsdc('5')).toBe(5_000_000n);
    expect(parseUsdc('2.5')).toBe(2_500_000n);
    expect(parseUsdc('0.000001')).toBe(1n);
    for (const wrong of ['', '0', '0.0', '-1', '1,5', '1.0000001', '5 USDC', 'abc', '.5']) {
      expect(() => parseUsdc(wrong), wrong).toThrow();
    }
  });

  it('a refund address must be an EVM address', () => {
    expect(isEvmAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')).toBe(true);
    expect(isEvmAddress('0x1234')).toBe(false);
    expect(isEvmAddress('name.near')).toBe(false);
  });

  it('you send exactly the amount in USDC on Base; the reserve receives USDC on Ethereum inside FAR', () => {
    const deadline = new Date('2026-11-11T10:00:00Z');
    expect(fundingQuote({ amount: 5_000_000n, reserveAccountId: 'reserve.far', deadline })).toEqual({
      dry: false,
      swapType: 'EXACT_INPUT',
      slippageTolerance: 100,
      originAsset: USDC.base,
      depositType: 'ORIGIN_CHAIN',
      destinationAsset: USDC.ethereum,
      amount: '5000000',
      recipient: 'reserve.far',
      recipientType: 'CONFIDENTIAL_INTENTS',
      // No refund address: a failed conversion is refunded into the reserve itself.
      refundTo: 'reserve.far',
      refundType: 'CONFIDENTIAL_INTENTS',
      deadline: '2026-11-11T10:00:00.000Z',
    });
  });

  it('with a refund address, a failed conversion goes back there on Base', () => {
    const quote = fundingQuote({ amount: 1n, reserveAccountId: 'reserve.far', refundTo: '0xabc', deadline: new Date() });
    expect(quote).toMatchObject({ refundTo: '0xabc', refundType: 'ORIGIN_CHAIN', recipient: 'reserve.far' });
  });

  it('only SUCCESS, REFUNDED and FAILED end the wait', () => {
    const final = ['PENDING_DEPOSIT', 'KNOWN_DEPOSIT_TX', 'INCOMPLETE_DEPOSIT', 'PROCESSING', 'SUCCESS', 'REFUNDED', 'FAILED', 'SOMETHING_NEW'].filter(
      (status) => describeFundingStatus(status).final,
    );
    expect(final).toEqual(['SUCCESS', 'REFUNDED', 'FAILED']);
  });
});
