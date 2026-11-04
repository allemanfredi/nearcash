/**
 * @nearcash/kiosk-api — the contract between the ATM's kiosk page
 * (apps/kiosk, React) and the ATM server (apps/atm, NestJS): the API's
 * types, the refund-address rules both apply, and what can be paid with.
 */
export * from './api.ts';
export * from './addresses.ts';
export * from './payment-options.ts';
