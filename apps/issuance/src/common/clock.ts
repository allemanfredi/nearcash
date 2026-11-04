/** The current time, injectable so tests can move it (quote deadlines, issue day). */
export interface Clock {
  now(): Date;
}

/** Injection token of the Clock. */
export const CLOCK = Symbol('CLOCK');

export const systemClock: Clock = { now: () => new Date() };
