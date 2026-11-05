import type { OneClickClient } from '../payments/one-click.client.ts';
import type { Nep413Payload, Reserve, SignedNep413 } from './reserve.port.ts';

/**
 * How the FAR reserve pays a 1Click quote. FAR takes no direct token
 * transfers: 1Click prepares a transfer intent to the quote's deposit
 * address (generate-intent), the reserve signs it (NEP-413) and 1Click
 * submits it (submit-intent). Used to fund cards (far.reserve.ts) and to
 * send refunds back (refunds/one-click-refund-sender.ts).
 */

/** What the reserve agreed to pay: the quote's deposit address, the token and the amount. */
export type ReservePayment = {
  depositAddress: string;
  /** 1Click asset id, e.g. "nep141:eth-0xa0b8…eb48.omft.near" (USDC on Ethereum). */
  tokenId: string;
  amount: bigint;
};

/** The reserve's account inside FAR, and FAR's contract (what every intent is signed for). */
export type ReserveAccount = { reserveAccountId: string; contractId: string };

type GeneratedIntent = { intent?: { standard?: string; payload?: Nep413Payload } };

/**
 * Steps 1–2: 1Click prepares the intent, the reserve checks it and signs it.
 * Nothing has moved yet: a failure here can simply be tried again.
 */
export async function signReservePayment(
  client: OneClickClient,
  reserve: Reserve,
  account: ReserveAccount,
  payment: ReservePayment,
): Promise<SignedNep413> {
  const { intent } = await client.call<GeneratedIntent>('POST', '/v0/generate-intent', {
    type: 'swap_transfer',
    standard: 'nep413',
    signerId: account.reserveAccountId,
    depositAddress: payment.depositAddress,
  });
  if (intent?.standard !== 'nep413' || !intent.payload) throw new Error('1Click did not prepare a NEP-413 intent');
  checkReservePayment(intent.payload, account, payment);
  return reserve.signIntent(intent.payload);
}

/** Step 3: 1Click executes the signed intent. From here the money may move. Returns the intent hash. */
export async function submitReservePayment(client: OneClickClient, signed: SignedNep413): Promise<string> {
  const { intentHash } = await client.call<{ intentHash: string }>('POST', '/v0/submit-intent', {
    type: 'swap_transfer',
    signedData: signed,
  });
  return intentHash;
}

/**
 * The reserve signs only the transfer it agreed to. Its signature spends its
 * money, and the intent comes from an outside service: without this check an
 * error (or an attack) at 1Click could have the reserve sign a transfer of
 * anything to anyone. The intent must be, exactly:
 *   for FAR's contract, signed by the reserve's account,
 *   one "transfer" of the agreed amount of the agreed token to the quote's deposit address.
 * Throws otherwise.
 */
export function checkReservePayment(payload: Nep413Payload, account: ReserveAccount, payment: ReservePayment): void {
  const refuse = (why: string): never => {
    throw new Error(`1Click prepared an unexpected intent for the reserve (${why}): not signed`);
  };
  if (payload.recipient !== account.contractId) refuse(`it is for ${payload.recipient}, not ${account.contractId}`);
  let message: { signer_id?: unknown; intents?: unknown };
  try {
    message = JSON.parse(payload.message) as typeof message;
  } catch {
    return refuse('its message is not JSON');
  }
  if (message.signer_id !== account.reserveAccountId) refuse(`it is signed as ${String(message.signer_id)}`);
  if (!Array.isArray(message.intents) || message.intents.length !== 1) refuse('it is not exactly one intent');
  const transfer = (message.intents as Record<string, unknown>[])[0]!;
  const unexpected = Object.keys(transfer).filter((key) => !['intent', 'receiver_id', 'tokens', 'memo'].includes(key));
  if (transfer.intent !== 'transfer' || unexpected.length > 0) refuse('it is not a plain transfer');
  if (transfer.receiver_id !== payment.depositAddress) refuse(`it pays ${String(transfer.receiver_id)}, not the quote's deposit address`);
  const tokens = Object.entries((transfer.tokens ?? {}) as Record<string, unknown>);
  if (tokens.length !== 1) refuse('it moves more than one token');
  const [token, amount] = tokens[0]!;
  if (assetIdOf(token) !== payment.tokenId) refuse(`it moves ${token}, not ${payment.tokenId}`);
  if (amount !== payment.amount.toString()) refuse(`it moves ${String(amount)}, not ${payment.amount}`);
}

/**
 * Inside FAR a token is held as "imt:<FAR's treasury account>:<asset id>"
 * (seen in the intents 1Click prepares), while 1Click's quotes name it by the
 * asset id alone: this gives the asset id of either form.
 */
export function assetIdOf(farTokenId: string): string {
  return /^imt:[^:]+:(.+)$/.exec(farTokenId)?.[1] ?? farTokenId;
}
