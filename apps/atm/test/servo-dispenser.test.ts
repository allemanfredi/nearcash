/**
 * The servo dispenser (NEARCASH_DISPENSER=servos) and its configuration. The
 * runs here are small Node scripts that speak as hardware/atm/dispense.py
 * does (a line per step, OUT when the card is out, the exit code), so no
 * servo and no Python are needed. dispense.py itself: `--dry-run` prints its
 * steps on any computer.
 */
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { atmConfigFromEnvironment } from '../src/server/config/atm-config.ts';
import { ServoDispenser } from '../src/server/features/hardware/servo-dispenser.ts';
import { RecordingLog, waitUntil } from './fakes.ts';

/** A dispenser whose "dispense.py" is this JavaScript, run by Node. */
function dispenserRunning(script: string) {
  const log = new RecordingLog();
  return { dispenser: new ServoDispenser([process.execPath, '-e', script], log), log };
}

describe('the servo dispenser', () => {
  it('is done when the card is out; the script goes on to rest by itself', async () => {
    const { dispenser, log } = dispenserRunning(`
      console.log('load: pusher 0° → 180°, slowly');
      console.log('OUT');
      setTimeout(() => console.log('done: at rest'), 100);
    `);
    await dispenser.dispense();
    expect(log.includes('load: pusher')).toBe(true);
    expect(log.includes('the card is out of the smile')).toBe(true);
    expect(log.includes('done: at rest')).toBe(false); // the turret is still turning back
    await waitUntil(() => log.includes('done: at rest'));
  });

  it('runs one card at a time: the next run starts once the previous one is at rest', async () => {
    const { dispenser, log } = dispenserRunning(`
      console.log('begin');
      console.log('OUT');
      setTimeout(() => console.log('at rest'), 100);
    `);
    await Promise.all([dispenser.dispense(), dispenser.dispense()]);
    const lines = log.lines.filter((line) => /begin|at rest/.test(line));
    expect(lines).toEqual(['[servos] begin', '[servos] at rest', '[servos] begin']);
  });

  it('fails with the script’s reason when it stops before the card is out', async () => {
    const { dispenser } = dispenserRunning(`
      console.error('the servos could not hand the card out: no hardware PWM');
      process.exit(1);
    `);
    await expect(dispenser.dispense()).rejects.toThrow(/before the card was out \(the servos could not.*no hardware PWM\)/);
  });

  it('fails when the script ends without handing the card out', async () => {
    const { dispenser } = dispenserRunning(`console.log('done: at rest');`);
    await expect(dispenser.dispense()).rejects.toThrow(/without handing the card out/);
  });

  it('fails when the program can’t be started (no python3)', async () => {
    const dispenser = new ServoDispenser(['/nonexistent/python3', 'dispense.py'], new RecordingLog());
    await expect(dispenser.dispense()).rejects.toThrow(/could not be started/);
  });

  it('a failure after the card is out is for the operator only: the customer has the card', async () => {
    const { dispenser, log } = dispenserRunning(`
      console.log('OUT');
      setTimeout(() => { console.error('stopped: back to rest, the pusher first'); process.exit(1); }, 50);
    `);
    await dispenser.dispense();
    await waitUntil(() => log.includes('OPERATOR: the turret may not be back at rest'));
  });

  it('a failed run doesn’t stop the next one', async () => {
    // The first run leaves a marker file and fails; the second finds it and hands the card out.
    const marker = JSON.stringify(join(mkdtempSync(join(tmpdir(), 'nearcash-servos-')), 'first-run'));
    const { dispenser } = dispenserRunning(`
      const fs = require('node:fs');
      if (!fs.existsSync(${marker})) { fs.writeFileSync(${marker}, ''); process.exit(1); }
      console.log('OUT');
    `);
    await expect(dispenser.dispense()).rejects.toThrow(/before the card was out/);
    await dispenser.dispense();
  });
});

describe('dispenser configuration', () => {
  it('servos: python3 runs hardware/atm/dispense.py with the calibration options', () => {
    const config = atmConfigFromEnvironment({
      NEARCASH_CASSETTE: 'dummy',
      NEARCASH_DISPENSER: 'servos',
      NEARCASH_SERVO_OPTIONS: '  --pusher-reversed   --stroke 160 ',
    });
    expect(config.dispenser.kind).toBe('servos');
    const command = config.dispenser.kind === 'servos' ? config.dispenser.command : [];
    expect(command[0]).toBe('python3');
    expect(command[1]).toMatch(/hardware\/atm\/dispense\.py$/);
    expect(existsSync(command[1]!)).toBe(true); // the path points at the real script
    expect(command.slice(2)).toEqual(['--pusher-reversed', '--stroke', '160']);
  });

  it('sim by default, also with the dummy reader (the sale runs, nothing moves)', () => {
    expect(atmConfigFromEnvironment({}).dispenser).toEqual({ kind: 'sim' });
    expect(atmConfigFromEnvironment({ NEARCASH_CASSETTE: 'dummy' }).dispenser).toEqual({ kind: 'sim' });
  });

  it('refuses the servos without the dummy reader, and unknown dispensers', () => {
    expect(() => atmConfigFromEnvironment({ NEARCASH_CASSETTE: 'pcsc', NEARCASH_DISPENSER: 'servos' })).toThrow(
      /servos works only with NEARCASH_CASSETTE=dummy/,
    );
    expect(() => atmConfigFromEnvironment({ NEARCASH_DISPENSER: 'servos' })).toThrow(/only with NEARCASH_CASSETTE=dummy/);
    expect(() => atmConfigFromEnvironment({ NEARCASH_DISPENSER: 'motor' })).toThrow(/must be "servos"/);
  });
});
