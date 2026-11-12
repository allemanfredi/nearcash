import type { OperatorLog } from '../../common/operator-log.ts';
import type { Dispenser } from './hardware.ports.ts';

/** Without the servos: nothing moves, loading and dispensing are only logged (an operator puts the card on the reader). */
export class SimulatedDispenser implements Dispenser {
  readonly name = 'simulated dispenser';
  readonly loadsCards = false;
  private readonly log: OperatorLog;

  constructor(log: OperatorLog) {
    this.log = log;
  }

  async load(): Promise<void> {
    this.log.log('[dispenser] next card into the reader (simulated: an operator puts it there)');
  }

  async dispense(): Promise<void> {
    this.log.log('[dispenser] banknote pushed to the tray (simulated)');
  }
}
