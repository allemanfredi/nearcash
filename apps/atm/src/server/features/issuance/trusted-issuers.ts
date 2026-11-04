import { type HttpIssuanceClient, type TrustedIssuer, hexToBytes } from '@nearcash/core';
import type { OperatorLog } from '../../common/operator-log.ts';

/**
 * The issuers a dispensed card must verify against. A production ATM has
 * the key configured; asking the issuance server is a development
 * convenience. Then the ATM may boot before the server is reachable (in a
 * demo it runs on a laptop), so it retries until it answers.
 */
export async function trustedIssuers(
  configuredKey: string | undefined,
  issuance: HttpIssuanceClient,
  log: OperatorLog,
  retryMs = 2_000,
): Promise<TrustedIssuer[]> {
  if (configuredKey) return [{ name: 'configured issuer', publicKey: hexToBytes(configuredKey) }];
  for (let attempt = 1; ; attempt++) {
    try {
      return [await issuance.issuer()];
    } catch (error) {
      if (attempt === 1) log.log(`waiting for the issuance server at ${issuance.baseUrl}…`);
      if (attempt % 10 === 0) log.log(`  still waiting (${error instanceof Error ? error.message : String(error)})`);
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }
}
