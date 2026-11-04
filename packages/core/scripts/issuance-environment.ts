/**
 * Loads the issuance server's configuration — <repository root>/.env.issuance,
 * see .env.issuance.example — into process.env, if the file exists. Variables already
 * set in the environment are kept.
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function loadIssuanceEnvironment(): void {
  const file = resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env.issuance');
  if (existsSync(file)) process.loadEnvFile(file);
}
