import type { OperatorLog } from '../../common/operator-log.ts';
import type { Dispenser } from './hardware.ports.ts';

/** Until the dispenser motor is wired: nothing moves, the dispense is only logged. */
export class SimulatedDispenser implements Dispenser {
  readonly name = 'simulated dispenser';
  private readonly log: OperatorLog;

  constructor(log: OperatorLog) {
    this.log = log;
  }

  async dispense(): Promise<void> {
    this.log.log('[dispenser] banknote pushed to the tray (simulated)');
  }
}
