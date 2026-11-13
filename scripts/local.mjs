/**
 * Runs NearCash's sale system on this computer, with no hardware, no keys
 * and no money, every step of a sale done for real:
 *
 *   pnpm local
 *
 * Then open the kiosk page it prints, or run `pnpm local:sale` in another
 * terminal to buy a banknote and check it without a browser. Ctrl-C stops
 * everything.
 *
 * It starts four programs, the last three as they run in production:
 *   - the card emulator (applet/src/emulator): the ATM's hopper, NFC reader
 *     and turret, with the real NearCash applet running in jCardSim. Its
 *     cards are born with the public DEV production key. Needs Java 17+;
 *   - the issuance server, with its DEV signer: it checks each chip's birth,
 *     funds the card and signs the certificate with the public DEV issuer
 *     key (the NEAR MPC network is not asked). Payments and the reserve are
 *     simulated: no 1Click, no FAR, no money. It sells one test banknote,
 *     0.01 ETH;
 *   - the ATM server, with the card emulator as its cassette and dispenser;
 *   - the kiosk page, the ATM's screen.
 *
 * Every setting is given here explicitly, so a .env.issuance or .env.atm with
 * real keys on this computer is never read for them. The sales are kept in a
 * fresh temporary folder, deleted when it stops: each run starts empty. The ports are not the
 * production ones (8790, 8792, 8791), so a real server running on this
 * computer is never reached by mistake. No network is needed, except the
 * first time, for Gradle and jCardSim.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APPLET_FOLDER, GRADLEW, NO_JAVA_MESSAGE, findJava, gradleEnvironment } from './gradle.mjs';

const REPOSITORY = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const PORTS = { emulator: 8893, issuance: 8890, atm: 8892, kiosk: 5190 };
export const KIOSK_URL = `http://127.0.0.1:${PORTS.kiosk}`;
export const EMULATOR_URL = `http://127.0.0.1:${PORTS.emulator}`;

/** The ATM's token at the issuance server: any string, both sides get the same one. */
const ATM_TOKEN = 'local-atm-token';
/** How long a program may take to start (the first run compiles everything). */
const START_TIMEOUT_MS = 180_000;
/** jCardSim's debug lines, printed for every key pair a chip makes: noise here. */
const EMULATOR_NOISE = /^getInstance of assymetric algo/;

/**
 * True once everything is being stopped: the programs' last lines are then
 * left out (pnpm reports a program stopped by a signal as a failure, which
 * here it isn't).
 */
let stopping = false;

/** Only run when started as a script (local-sale.mjs imports the addresses). */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}

async function main(args) {
  if (args.length > 0) {
    console.error(`unknown option: ${args.join(' ')}\nusage: pnpm local`);
    process.exit(2);
  }

  for (const [name, port] of Object.entries(PORTS)) {
    if (!(await isPortFree(port))) {
      console.error(`port ${port} (${name}) is in use: is \`pnpm local\` already running? Stop it first.`);
      process.exit(1);
    }
  }

  const java = findJava();
  if (!java) {
    console.error(`The card emulator: ${NO_JAVA_MESSAGE}`);
    process.exit(1);
  }

  console.log(`Building the card emulator with Gradle (Java ${java.version}, the first run downloads Gradle and jCardSim)…`);
  const classpath = emulatorClasspath(java);

  const dataFolder = mkdtempSync(join(tmpdir(), 'nearcash-local-'));
  const issuanceEnv = {
    // The DEV signer: the public DEV issuer key signs, the public DEV production key gives birth. No NEAR at all.
    NEARCASH_SIGNER: 'dev',
    NEARCASH_SKIP_MPC: 'false',
    NEARCASH_SKIP_BIRTH: 'false', // every chip's birth is checked
    NEARCASH_ISSUER_CONTRACT: '',
    NEARCASH_ISSUANCE_ACCOUNT: '',
    NEARCASH_ISSUANCE_PRIVATE_KEY: '',
    // No account, no key, no money: payments and the reserve are simulated.
    NEARCASH_PAYMENTS: 'simulated',
    NEARCASH_RESERVE: 'simulated',
    NEARCASH_RESERVE_ACCOUNT: '',
    NEARCASH_RESERVE_PRIVATE_KEY: '',
    NEARCASH_RESERVE_TOKEN: '',
    NEARCASH_1CLICK_API_KEY: '',
    NEARCASH_ATM_TOKENS: `local-atm:${ATM_TOKEN}`,
    NEARCASH_ISSUANCE_HOST: '127.0.0.1',
    NEARCASH_ISSUANCE_PORT: String(PORTS.issuance),
    NEARCASH_ISSUANCE_STORE: join(dataFolder, 'issuance-sales.json'),
    NEARCASH_REFUNDS_STORE: join(dataFolder, 'issuance-refunds.json'),
  };
  const atmEnv = {
    NEARCASH_ISSUANCE_URL: `http://127.0.0.1:${PORTS.issuance}`,
    NEARCASH_ATM_TOKEN: ATM_TOKEN,
    NEARCASH_TRUSTED_ISSUER: '', // asked to the issuance server: the DEV issuer key
    NEARCASH_ATM_HOST: '127.0.0.1',
    NEARCASH_ATM_PORT: String(PORTS.atm),
    NEARCASH_KIOSK_KEY: '', // no pairing: only this computer reaches the page
    NEARCASH_CASSETTE: 'emulator',
    NEARCASH_DISPENSER: 'emulator',
    NEARCASH_CARD_EMULATOR_URL: EMULATOR_URL,
    NEARCASH_READER: '',
    NEARCASH_SKIP_BIRTH: 'false',
    NEARCASH_SERVO_OPTIONS: '',
  };
  const kioskEnv = { NEARCASH_ATM_SERVER_URL: `http://127.0.0.1:${PORTS.atm}` };

  const programs = [];
  /**
   * Stops every program started so far and waits for them to end (5 s at
   * most), deletes this run's sales, then exits with `code`: 0 for Ctrl-C,
   * 1 when a program failed.
   */
  const stopAll = async (code) => {
    if (stopping) return;
    stopping = true;
    for (const program of programs) program.stop();
    const allEnded = Promise.all(programs.map((program) => program.ended));
    await Promise.race([allEnded, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    rmSync(dataFolder, { recursive: true, force: true }); // the temporary folder made above, nothing else
    process.exit(code);
  };
  process.on('SIGINT', () => stopAll(0));
  process.on('SIGTERM', () => stopAll(0));

  /** Starts one program; if it ends by itself, everything stops. */
  const start = (label, command, commandArgs, env, hide) => {
    const program = startProgram(label, command, commandArgs, env, hide);
    program.child.on('exit', (code, signal) => {
      if (stopping) return;
      console.error(`\n✘ ${label} stopped (${signal ?? `exit code ${code}`}): stopping everything.`);
      stopAll(1);
    });
    programs.push(program);
  };

  console.log(`\nNearCash, local run: sales kept in ${dataFolder}\n`);
  try {
    // In order: the ATM server needs the emulator's reader and asks the issuance server which issuer to trust.
    start('emulator', java.bin, ['-cp', classpath, 'xyz.nektarlabs.nearcash.emulator.CardEmulator', String(PORTS.emulator)], {}, EMULATOR_NOISE);
    await waitUntilAnswering(`${EMULATOR_URL}/reader`, 'the card emulator');
    start('issuance', 'pnpm', ['--filter', '@nearcash/issuance', 'start'], issuanceEnv);
    await waitUntilAnswering(`http://127.0.0.1:${PORTS.issuance}/info`, 'the issuance server');
    start('atm', 'pnpm', ['--filter', '@nearcash/atm', 'start'], atmEnv);
    await waitUntilAnswering(`http://127.0.0.1:${PORTS.atm}/api/setup`, 'the ATM server');
    start('kiosk', 'pnpm', ['--filter', '@nearcash/kiosk', 'dev', '--host', '127.0.0.1', '--port', String(PORTS.kiosk), '--strictPort'], kioskEnv);
    await waitUntilAnswering(`${KIOSK_URL}/api/setup`, 'the kiosk page');
  } catch (error) {
    console.error(`\n✘ ${error instanceof Error ? error.message : error}`);
    stopAll(1);
    return;
  }

  console.log(
    [
      '',
      '──────────────────────────────────────────────────────────────',
      ` ✔ NearCash is running. Kiosk page (the ATM's screen): ${KIOSK_URL}`,
      '   Buy the banknote, choose a PIN, press "Simulate the payment".',
      '   Without a browser: `pnpm local:sale` in another terminal.',
      '   Ctrl-C stops everything.',
      '──────────────────────────────────────────────────────────────',
      '',
    ].join('\n'),
  );
}

/** Compiles the card emulator (with the applet) and returns the classpath to run it with. */
function emulatorClasspath(java) {
  const build = spawnSync(GRADLEW, ['--quiet', 'emulatorClasspath'], {
    cwd: APPLET_FOLDER,
    env: gradleEnvironment(java),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const classpath = build.stdout?.trim().split('\n').pop();
  if (build.status !== 0 || !classpath) {
    console.error('✘ Gradle could not build the card emulator (applet/, task emulatorClasspath): see above.');
    process.exit(1);
  }
  return classpath;
}

/**
 * Starts a program from the repository root, its output prefixed with the
 * label (lines matching `hide` are left out). In its own process group, so
 * stopping it stops what it started (pnpm's node, vite) too.
 */
function startProgram(label, command, commandArgs, env, hide) {
  const child = spawn(command, commandArgs, {
    cwd: REPOSITORY,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  const prefix = `[${label}]`.padEnd(11);
  for (const stream of [child.stdout, child.stderr]) {
    let pending = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      const lines = (pending + chunk).split('\n');
      pending = lines.pop() ?? '';
      if (stopping) return;
      for (const line of lines) if (!hide?.test(line)) console.log(prefix + line);
    });
  }
  const stop = () => {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // Already gone.
    }
  };
  /** Resolves once the program has ended (at once if it already has). */
  const ended = new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once('exit', resolve);
  });
  return { child, stop, ended };
}

/** Resolves once the URL gives any HTTP answer (even 401: the server is up). */
async function waitUntilAnswering(url, what) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(2_000) });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`${what} did not start within ${START_TIMEOUT_MS / 1000} s (${url})`);
}

/** True when nothing listens on the port (on 127.0.0.1). */
function isPortFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}
