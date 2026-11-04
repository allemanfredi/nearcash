/**
 * What the operator reads in the ATM's log: each sale, and anything a
 * person must resolve (lines starting with "OPERATOR:"). Nest's Logger fits
 * it; tests capture the lines instead.
 */
export interface OperatorLog {
  log(message: string): void;
}

/** Injection token of the OperatorLog. */
export const OPERATOR_LOG = Symbol('OPERATOR_LOG');
