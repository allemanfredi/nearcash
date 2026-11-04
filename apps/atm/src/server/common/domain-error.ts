/**
 * A broken rule of the ATM (one sale at a time, a valid refund address…).
 * Services throw these without knowing about HTTP; HttpErrorFilter turns
 * each kind into a status code for the kiosk page.
 */
export type DomainErrorKind =
  | 'invalid-request' // the screen sent something malformed or not allowed
  | 'not-found' // no sale in progress, or a feature this ATM doesn't have
  | 'conflict' // e.g. a sale is already in progress
  | 'unavailable'; // the ATM can't sell now (e.g. no card reader): out of service

export class DomainError extends Error {
  readonly kind: DomainErrorKind;

  constructor(kind: DomainErrorKind, message: string) {
    super(message);
    this.name = 'DomainError';
    this.kind = kind;
  }
}
