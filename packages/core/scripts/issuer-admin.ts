/**
 * Administration of the NearCash issuer contract (contracts/issuer).
 * Uses the keys NEAR's CLIs keep in ~/.near-credentials/<network>/<account>.json.
 *
 *   pnpm issuer:admin public-key                 issuer key wallets must trust (from MPC)
 *   pnpm issuer:admin stats                      configuration and public supply counters
 *   pnpm issuer:admin add-minter <account>       owner: authorise the issuance server's account
 *   pnpm issuer:admin remove-minter <account>    owner: revoke it (immediate)
 *   pnpm issuer:admin minter-key <account>       give that account a key limited to
 *                                                sign_certificate; prints its .env.issuance lines
 *   pnpm issuer:admin set-denominations 1,5,10,20
 *                                                owner: the banknotes on sale, in whole tokens
 *                                                (converted with the contract's decimals)
 *   pnpm issuer:admin set-daily-cap 100000       owner: the most value certified in one day,
 *                                                in whole tokens; "none" lifts it (the largest
 *                                                value the contract can hold)
 *
 * Environment: NEARCASH_ISSUER_CONTRACT (required), NEARCASH_NETWORK
 * (default testnet), NEARCASH_NEAR_RPC, NEARCASH_MPC_CONTRACT,
 * NEARCASH_CERTIFICATE_PATH (same defaults as src/mpc.ts).
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Account, JsonRpcProvider, KeyPair, type KeyPairString } from 'near-api-js';
import { DEFAULT_CERTIFICATE_PATH, MPC_SECP256K1_DOMAIN_ID, bytesToHex, parseNearSecp256k1Key } from '../src/index.ts';
import { loadIssuanceEnvironment } from './issuance-environment.ts';

loadIssuanceEnvironment();

const network = process.env.NEARCASH_NETWORK ?? 'testnet';
const rpcUrl = process.env.NEARCASH_NEAR_RPC ?? 'https://test.rpc.fastnear.com';
const mpcContractId = process.env.NEARCASH_MPC_CONTRACT ?? 'v1.signer-prod.testnet';
const path = process.env.NEARCASH_CERTIFICATE_PATH ?? DEFAULT_CERTIFICATE_PATH;
const issuerContractId = process.env.NEARCASH_ISSUER_CONTRACT;
if (!issuerContractId) {
  console.error('set NEARCASH_ISSUER_CONTRACT (e.g. in .env.issuance)');
  process.exit(1);
}

const provider = new JsonRpcProvider({ url: rpcUrl });
const GAS = 30_000_000_000_000n; // 30 Tgas, plenty for owner calls

/** The account's key from NEAR's legacy keychain (written by cargo-near / near-cli). */
function accountFromKeychain(accountId: string): Account {
  const file = join(homedir(), '.near-credentials', network, `${accountId}.json`);
  const { private_key: privateKey } = JSON.parse(readFileSync(file, 'utf8')) as { private_key: KeyPairString };
  return new Account(accountId, provider, privateKey);
}

async function owner(): Promise<Account> {
  const config = await provider.callFunction<{ owner: string }>({
    contractId: issuerContractId!,
    method: 'config',
    args: {},
  });
  return accountFromKeychain(config!.owner);
}

const [command, target] = process.argv.slice(2);

switch (command) {
  case 'public-key': {
    const key = await provider.callFunction<string>({
      contractId: mpcContractId,
      method: 'derived_public_key',
      args: { path, predecessor: issuerContractId, domain_id: MPC_SECP256K1_DOMAIN_ID },
    });
    console.log(`issuer contract : ${issuerContractId}`);
    console.log(`MPC key (NEAR)  : ${key}`);
    console.log(`compressed hex  : ${bytesToHex(parseNearSecp256k1Key(key!))}   ← TrustedIssuers.swift`);
    break;
  }
  case 'stats': {
    const view = (method: string) => provider.callFunction({ contractId: issuerContractId, method, args: {} });
    console.log(JSON.stringify({ config: await view('config'), stats: await view('stats'), minters: await view('minters') }, null, 2));
    break;
  }
  case 'add-minter':
  case 'remove-minter': {
    if (!target) throw new Error(`usage: ${command} <account>`);
    const methodName = command === 'add-minter' ? 'add_minter' : 'remove_minter';
    await (await owner()).callFunction({ contractId: issuerContractId, methodName, args: { minter: target }, gas: GAS });
    const minters = await provider.callFunction<string[]>({ contractId: issuerContractId, method: 'minters', args: {} });
    console.log(`${methodName} ${target} done; authorised minters: ${JSON.stringify(minters)}`);
    break;
  }
  case 'minter-key': {
    if (!target) throw new Error('usage: minter-key <account>');
    // A fresh key that can only call sign_certificate on the issuer contract,
    // paying gas from a small allowance: it can never move the account's funds.
    const key = KeyPair.fromRandom('ed25519');
    await accountFromKeychain(target).addFunctionCallAccessKey({
      publicKey: key.getPublicKey(),
      contractId: issuerContractId,
      methodNames: ['sign_certificate'],
      allowance: 1_000_000_000_000_000_000_000_000n, // 1 NEAR of gas
    });
    console.log('# NEAR MPC signing — keep it secret (.env.issuance is git-ignored)');
    console.log(`NEARCASH_ISSUER_CONTRACT=${issuerContractId}`);
    console.log(`NEARCASH_ISSUANCE_ACCOUNT=${target}`);
    console.log(`NEARCASH_ISSUANCE_PRIVATE_KEY=${key.toString()}`);
    break;
  }
  case 'set-denominations': {
    if (!target) throw new Error('usage: set-denominations <amounts in whole tokens, comma-separated, e.g. 1,5,10,20>');
    const { decimals, symbol } = (await provider.callFunction<{ decimals: number; symbol: string }>({
      contractId: issuerContractId,
      method: 'config',
      args: {},
    }))!;
    const denominations = target.split(',').map((text) => toSmallestUnits(text.trim(), decimals));
    await (await owner()).callFunction({
      contractId: issuerContractId,
      methodName: 'set_denominations',
      args: { denominations: denominations.map(String) },
      gas: GAS,
    });
    const config = await provider.callFunction<{ denominations: string[] }>({ contractId: issuerContractId, method: 'config', args: {} });
    console.log(`denominations now (${symbol}, ${decimals} decimals): ${JSON.stringify(config!.denominations)}`);
    break;
  }
  case 'set-daily-cap': {
    if (!target) throw new Error('usage: set-daily-cap <amount in whole tokens, e.g. 100000, or "none">');
    const { decimals, symbol } = (await provider.callFunction<{ decimals: number; symbol: string }>({
      contractId: issuerContractId,
      method: 'config',
      args: {},
    }))!;
    // The contract always has a cap; "none" sets it to the largest u128, which no day can reach.
    const cap = target.trim() === 'none' ? 2n ** 128n - 1n : toSmallestUnits(target.trim(), decimals);
    await (await owner()).callFunction({
      contractId: issuerContractId,
      methodName: 'set_daily_value_cap',
      args: { cap: cap.toString() },
      gas: GAS,
    });
    const config = await provider.callFunction<{ daily_value_cap: string }>({ contractId: issuerContractId, method: 'config', args: {} });
    console.log(`daily value cap now ${config!.daily_value_cap} (${target === 'none' ? 'no cap' : `${target} ${symbol}`})`);
    break;
  }
  default:
    console.error(
      'commands: public-key | stats | add-minter <account> | remove-minter <account> | minter-key <account> | set-denominations <1,5,10,20> | set-daily-cap <100000>',
    );
    process.exit(1);
}

/** "1.5" tokens with 6 decimals → 1500000n. Refuses more decimals than the token has. */
function toSmallestUnits(text: string, decimals: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error(`not an amount: "${text}"`);
  const [, whole, fraction = ''] = match;
  if (fraction.length > decimals) throw new Error(`"${text}" has more than ${decimals} decimals`);
  const units = BigInt(whole! + fraction.padEnd(decimals, '0'));
  if (units === 0n) throw new Error('a banknote must be worth more than 0');
  return units;
}
