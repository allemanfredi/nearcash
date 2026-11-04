/**
 * A broken rule of the issuance domain. Services throw these without knowing
 * about HTTP; the presentation layer (HttpErrorFilter) turns each kind into a
 * status code.
 */
export type DomainErrorKind =
  | 'invalid-request' // the caller asked for something malformed or not allowed
  | 'not-found' // no such sale
  | 'payment-required' // the payment is not confirmed: no banknote
  | 'conflict' // e.g. this payment already belongs to another card
  | 'needs-operator'; // a state only a person may resolve (interrupted funding)

export class DomainError extends Error {
  readonly kind: DomainErrorKind;

  constructor(kind: DomainErrorKind, message: string) {
    super(message);
    this.name = 'DomainError';
    this.kind = kind;
  }
}
