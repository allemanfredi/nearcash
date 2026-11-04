/**
 * Starts the issuance server (configuration: config/issuance-config.ts and
 * .env.issuance.example):
 *
 *   pnpm issuance:start
 *
 * Its HTTP API, for ATMs (Authorization: Bearer <ATM token>):
 *   GET  /issuer                    issuer name and public key (what wallets trust)
 *   GET  /denominations             allowed banknotes
 *   GET  /info                      {simulatedPayments}
 *   POST /sales                     {amount, originAsset, refundTo?} → sale with deposit address
 *   GET  /sales/:id                 sale, payment status refreshed
 *   POST /sales/:id/issue           {authPublicKey, fundsPublicKey} (hex) → {certificate} (hex)
 *   POST /dev/sales/:id/pay|refund  development only, with simulated payments ({excess?} on pay)
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.ts';
import { QuietLogger } from './common/quiet-logger.ts';
import { type IssuanceConfig, issuanceConfigFromEnvironment, loadIssuanceEnvironment } from './config/issuance-config.ts';
import { CERTIFICATE_AUTHORITY, type CertificateAuthority } from './features/certificates/certificate-authority.port.ts';
import { PAYMENT_GATEWAY, type PaymentGateway } from './features/payments/payment-gateway.port.ts';
import { REFUND_SENDER, type RefundSender } from './features/refunds/refund-sender.port.ts';
import { SENDER_FINDER, type SenderFinder } from './features/refunds/sender-finder.port.ts';
import { RESERVE, type Reserve } from './features/reserve/reserve.port.ts';

let config: IssuanceConfig;
try {
  config = issuanceConfigFromEnvironment(loadIssuanceEnvironment());
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const app = await NestFactory.create(AppModule.forRoot(config), { logger: new QuietLogger() });
await app.listen(config.http.port, config.http.host);

console.log(`NearCash issuance server on http://${config.http.host}:${config.http.port}`);
console.log(`  certificates: ${app.get<CertificateAuthority>(CERTIFICATE_AUTHORITY).signer.name}`);
console.log(`  payments:     ${app.get<PaymentGateway>(PAYMENT_GATEWAY).name}`);
console.log(`  reserve:      ${app.get<Reserve>(RESERVE).name}`);
console.log(
  `  refunds:      back to the sender (who paid: ${app.get<SenderFinder>(SENDER_FINDER).name}; ` +
    `sent by: ${app.get<RefundSender>(REFUND_SENDER).name}; every ${config.refunds.sweepSeconds}s)`,
);
console.log(`  ATMs:         ${[...config.atmTokens.values()].join(', ')}`);
if (config.certificates.kind === 'dev') console.warn('⚠ signing with the public DEV key: test banknotes only');
