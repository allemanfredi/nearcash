/**
 * Starts the ATM server (on the Raspberry Pi, or locally for development):
 *
 *   pnpm atm:start
 *
 * It answers the kiosk API (packages/kiosk-api) for the page on the iPhone
 * (apps/kiosk, whose server forwards /api here), talks to the issuance
 * server and drives the cassette and the dispenser. Configuration:
 * config/atm-config.ts, .env.atm.example.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.ts';
import { QuietLogger } from './common/quiet-logger.ts';
import { type AtmConfig, atmConfigFromEnvironment, loadAtmEnvironment } from './config/atm-config.ts';
import { CASSETTE, type Cassette, DISPENSER, type Dispenser } from './features/hardware/hardware.ports.ts';
import { TRUSTED_ISSUERS } from './features/issuance/issuance.port.ts';

let config: AtmConfig;
try {
  config = atmConfigFromEnvironment(loadAtmEnvironment());
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

// Waits for the issuance server first (the issuers to trust come from it).
const app = await NestFactory.create(AppModule.forRoot(config), { logger: new QuietLogger() });
await app.listen(config.http.port, config.http.host);

const [issuer] = app.get<{ name: string }[]>(TRUSTED_ISSUERS);
console.log(`NearCash ATM server on http://${config.http.host}:${config.http.port} (the kiosk page forwards /api here)`);
console.log(
  `  issuance ${config.issuance.url}, issuer ${issuer?.name}, ${app.get<Cassette>(CASSETTE).name}, ${app.get<Dispenser>(DISPENSER).name}`,
);
const outOfService = await app.get<Cassette>(CASSETTE).unavailableReason();
if (outOfService) console.warn(`⚠ out of service: ${outOfService} (the kiosk says so, no sale can start)`);
console.log(
  config.kioskKey
    ? '  kiosk key set: only the paired screen may use the API'
    : '  no kiosk key: any screen may use the API (development only)',
);
