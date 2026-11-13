/**
 * Runs the applet's Gradle (applet/gradlew) with a Java 17 or later, found
 * on its own, so nobody has to set JAVA_HOME first:
 *
 *   node scripts/gradle.mjs test      what `pnpm applet:test` runs
 *
 * Where it looks: JAVA_HOME, then macOS's java_home and Homebrew's usual
 * places, then the `java` on the PATH (on a Mac without a JDK, that one is
 * only a stub that asks to install Java). `pnpm local` uses findJava too,
 * for the card emulator.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APPLET_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'applet');

/** Shown when no Java 17+ is found. */
export const NO_JAVA_MESSAGE =
  'Java 17 or later is needed (Gradle, jCardSim), and none was found.\n' +
  'Install one (macOS: `brew install openjdk@17`; Debian/Ubuntu: `apt install openjdk-17-jdk`),\n' +
  'or set JAVA_HOME to it, then run the command again.';

/**
 * A Java 17+: { home, bin, version }, home undefined for the PATH's `java`;
 * undefined if there is none.
 */
export function findJava() {
  const homes = [process.env.JAVA_HOME];
  if (process.platform === 'darwin') {
    const found = spawnSync('/usr/libexec/java_home', ['-v', '17+'], { encoding: 'utf8' });
    if (found.status === 0) homes.push(found.stdout.trim());
    for (const prefix of ['/opt/homebrew/opt', '/usr/local/opt']) {
      for (const formula of ['openjdk@17', 'openjdk@21', 'openjdk']) homes.push(`${prefix}/${formula}/libexec/openjdk.jdk/Contents/Home`);
    }
  }
  const candidates = [
    ...homes.filter((home) => home && existsSync(join(home, 'bin', 'java'))).map((home) => ({ home, bin: join(home, 'bin', 'java') })),
    { home: undefined, bin: 'java' }, // the PATH's
  ];
  for (const candidate of candidates) {
    const version = javaVersion(candidate.bin);
    if (version !== undefined && version >= 17) return { ...candidate, version };
  }
  return undefined;
}

/** The environment Gradle runs in: JAVA_HOME pointing at the Java found. */
export function gradleEnvironment(java) {
  return { ...process.env, ...(java.home ? { JAVA_HOME: java.home } : {}) };
}

/** The wrapper to call, from the applet folder. */
export const GRADLEW = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';

/** The major version of a `java` (17, 21…), or undefined when it doesn't run. */
function javaVersion(bin) {
  const run = spawnSync(bin, ['-version'], { encoding: 'utf8' });
  if (run.status !== 0) return undefined;
  // e.g. openjdk version "17.0.18" 2026-01-20, or "1.8.0_402" for Java 8.
  const match = /version "(\d+)(?:\.(\d+))?/.exec(run.stderr);
  if (!match) return undefined;
  const major = Number(match[1]);
  return major === 1 ? Number(match[2]) : major;
}

/** Run as a script: ./gradlew <arguments> in applet/, with the Java found. */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const java = findJava();
  if (!java) {
    console.error(NO_JAVA_MESSAGE);
    process.exit(1);
  }
  const run = spawnSync(GRADLEW, process.argv.slice(2), { cwd: APPLET_FOLDER, env: gradleEnvironment(java), stdio: 'inherit' });
  process.exit(run.status ?? 1);
}
