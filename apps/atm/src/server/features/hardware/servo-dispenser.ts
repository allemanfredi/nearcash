import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { OperatorLog } from '../../common/operator-log.ts';
import type { Dispenser } from './hardware.ports.ts';

/** The line dispense.py prints the moment the card sticks out of the smile. */
export const OUT_LINE = 'OUT';

/**
 * The dispenser on the real servos (NEARCASH_DISPENSER=servos): for each card
 * it starts hardware/atm/dispense.py on the Pi with spawn. The servos' code
 * stays in Python, shared with cycle.py and servo.py (servo_driver.py: the
 * Pi's hardware PWM, the angles noted between runs); the server only starts
 * the script and reads what it prints.
 *
 * The script loads a card from the hopper into the reader, turns the turret
 * so the card sticks out of the smile, waits for the customer to take it and
 * turns back. dispense() resolves when it prints OUT (the kiosk then says
 * "take it"), and fails if the script ends before that. The script carries on
 * by itself until the turret is back at rest; the next dispense() waits for
 * it, so two runs never drive the servos at once.
 *
 * It loads the card at hand-out time, so for now it goes only with the dummy
 * reader (see AtmConfig): with the NFC reader, the card must be on the reader
 * before the sale.
 */
export class ServoDispenser implements Dispenser {
  readonly name: string;
  /** The program and its arguments: python3, dispense.py and the calibration options. */
  private readonly command: readonly string[];
  private readonly log: OperatorLog;
  /** Resolves when the previous run has exited (it never rejects). */
  private previousRun: Promise<void> = Promise.resolve();

  constructor(command: readonly string[], log: OperatorLog) {
    if (command.length === 0) throw new Error('the servo dispenser needs a command to run');
    this.command = command;
    this.log = log;
    const options = command.slice(2).join(' ');
    this.name = `servos (${command[1] ?? command[0]}${options ? ` ${options}` : ''})`;
  }

  dispense(): Promise<void> {
    // Chained at once, so even two calls in a row run one after the other.
    const run = this.previousRun.then(() => this.start());
    this.previousRun = run.then((started) => started.exited);
    return run.then((started) => started.cardOut);
  }

  /**
   * Starts one run of the script.
   *   cardOut  resolves when the card is out, rejects if the run ends first;
   *   exited   resolves when the run is over, however it ended.
   */
  private start(): { cardOut: Promise<void>; exited: Promise<void> } {
    const [program, ...args] = this.command as [string, ...string[]];
    let cardIsOut = false;
    let markOut!: () => void;
    let failBeforeOut!: (error: Error) => void;
    const cardOut = new Promise<void>((resolve, reject) => {
      markOut = resolve;
      failBeforeOut = reject;
    });
    // The last lines of stderr: why the script failed, for the screen's "failed" reason.
    const errors: string[] = [];

    const child = spawn(program, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (line.trim() === OUT_LINE) {
        cardIsOut = true;
        this.log.log('[servos] the card is out of the smile');
        markOut();
      } else if (line.trim() !== '') {
        this.log.log(`[servos] ${line.trim()}`);
      }
    });
    createInterface({ input: child.stderr }).on('line', (line) => {
      if (line.trim() === '') return;
      this.log.log(`[servos] ${line.trim()}`);
      errors.push(line.trim());
      if (errors.length > 3) errors.shift();
    });

    const exited = new Promise<void>((resolve) => {
      // The program could not be started at all (e.g. no python3): 'close' may not follow.
      child.on('error', (error) => {
        failBeforeOut(new Error(`the servos could not be started (${program}: ${error.message})`));
        resolve();
      });
      child.on('close', (code, signal) => {
        const ending = signal ? `stopped by ${signal}` : `exit code ${code}`;
        if (code === 0) {
          // Back at rest. Ending well without OUT would be a script that skipped the hand-out.
          if (!cardIsOut) failBeforeOut(new Error('the servo script ended without handing the card out'));
        } else if (!cardIsOut) {
          failBeforeOut(new Error(`the servos stopped before the card was out (${errors.at(-1) ?? ending})`));
        } else {
          this.log.log(`[servos] OPERATOR: the turret may not be back at rest (${errors.at(-1) ?? ending})`);
        }
        resolve();
      });
    });
    return { cardOut, exited };
  }
}
