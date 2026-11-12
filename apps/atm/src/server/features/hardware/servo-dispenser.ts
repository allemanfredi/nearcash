import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { OperatorLog } from '../../common/operator-log.ts';
import type { Dispenser } from './hardware.ports.ts';

/** The lines dispense.py prints once the card is in the reader, and the moment it sticks out of the smile. */
export const LOADED_LINE = 'LOADED';
export const OUT_LINE = 'OUT';

/** One phase of dispense.py: its option, the line that means it is done, and how to tell about it. */
type Phase = {
  option: 'load' | 'hand-out';
  doneLine: string;
  done: string; // for the operator's log, when doneLine comes
  failedBefore: string; // "the servos stopped …", when the script ends before doneLine
  endedWithout: string; // "the servo script ended …", when it ends well but without doneLine
  failedAfter: string; // for the operator, when it fails after doneLine
};

const LOAD: Phase = {
  option: 'load',
  doneLine: LOADED_LINE,
  done: 'the card is in the reader, the pusher home',
  failedBefore: 'before the card was loaded',
  endedWithout: 'without loading the card',
  failedAfter: 'OPERATOR: the pusher may not be back home',
};

const HAND_OUT: Phase = {
  option: 'hand-out',
  doneLine: OUT_LINE,
  done: 'the card is out of the smile',
  failedBefore: 'before the card was out',
  endedWithout: 'without handing the card out',
  failedAfter: 'OPERATOR: the turret may not be back at rest',
};

/**
 * The dispenser on the real servos (NEARCASH_DISPENSER=servos): it starts
 * hardware/atm/dispense.py on the Pi with spawn, twice for each card. The
 * servos' code stays in Python, shared with cycle.py and servo.py
 * (servo_driver.py: the Pi's hardware PWM, the angles noted between runs);
 * the server only starts the script and reads what it prints.
 *
 *   load()      `--only load`: the pusher puts the bottom card of the hopper
 *               into the reader and comes home; resolves when the script
 *               prints LOADED (whether a card did arrive, the reader tells).
 *   dispense()  `--only hand-out`: the turret turns so the card sticks out of
 *               the smile; resolves when the script prints OUT (the kiosk
 *               then says "take it"). The script carries on by itself: it
 *               waits for the customer to take the card and turns back.
 * Each fails if the script ends before its line. Runs are chained: one
 * starts only when the one before has exited (the turret back at rest), so
 * two runs never drive the servos at once.
 */
export class ServoDispenser implements Dispenser {
  readonly name: string;
  readonly loadsCards = true;
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

  load(): Promise<void> {
    return this.run(LOAD);
  }

  dispense(): Promise<void> {
    return this.run(HAND_OUT);
  }

  /** One run of `phase`, after the run before it has exited. */
  private run(phase: Phase): Promise<void> {
    // Chained at once, so even two calls in a row run one after the other.
    const started = this.previousRun.then(() => this.start(phase));
    this.previousRun = started.then((run) => run.exited);
    return started.then((run) => run.done);
  }

  /**
   * Starts one run of the script.
   *   done    resolves when the phase's line comes, rejects if the run ends first;
   *   exited  resolves when the run is over, however it ended.
   */
  private start(phase: Phase): { done: Promise<void>; exited: Promise<void> } {
    const [program, ...options] = this.command as [string, ...string[]];
    const args = [...options, '--only', phase.option];
    let isDone = false;
    let markDone!: () => void;
    let failBeforeDone!: (error: Error) => void;
    const done = new Promise<void>((resolve, reject) => {
      markDone = resolve;
      failBeforeDone = reject;
    });
    // The last lines of stderr: why the script failed, for the screen's "failed" reason.
    const errors: string[] = [];

    const child = spawn(program, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (line.trim() === phase.doneLine) {
        isDone = true;
        this.log.log(`[servos] ${phase.done}`);
        markDone();
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
        failBeforeDone(new Error(`the servos could not be started (${program}: ${error.message})`));
        resolve();
      });
      child.on('close', (code, signal) => {
        const ending = signal ? `stopped by ${signal}` : `exit code ${code}`;
        if (code === 0) {
          // Back at rest. Ending well without its line would be a script that skipped the phase.
          if (!isDone) failBeforeDone(new Error(`the servo script ended ${phase.endedWithout}`));
        } else if (!isDone) {
          failBeforeDone(new Error(`the servos stopped ${phase.failedBefore} (${errors.at(-1) ?? ending})`));
        } else {
          this.log.log(`[servos] ${phase.failedAfter} (${errors.at(-1) ?? ending})`);
        }
        resolve();
      });
    });
    return { done, exited };
  }
}
