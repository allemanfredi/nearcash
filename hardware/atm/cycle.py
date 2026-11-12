"""Runs the ATM's whole cycle on the real servos, to test the mechanics: a card
goes from the hopper into the reader, the ATM "issues" the banknote, the turret
turns and the banknote comes out of the smile, then the ATM gets ready for the
next one. The issuing is not done: a sleep stands in for it. The reader is
checked, when one is connected: after each load, whether the card answers
through its contacts, so whether the stroke took it all the way in.
It runs on the Raspberry Pi, with the servos wired as for servo.py:

    pnpm atm:cycle                     # one cycle
    pnpm atm:cycle --cycles 10         # ten cycles in a row
    pnpm atm:cycle --pusher-reversed   # a pusher whose rest is 180° (see "The pusher's direction")
    pnpm atm:cycle --stroke 160        # the pusher stops 160° from home (calibration)
    pnpm atm:cycle --dry-run           # prints the steps without moving anything, on any computer
    pnpm atm:cycle --no-reader         # doesn't check the card, even with a reader connected

The steps are those of "Motion and calibration" in the assembly PDF:
  1. ready     the pusher at home, the turret at its loading angle (the reader's slot facing the hopper);
  2. load      the pusher slowly to the end of its stroke: the bottom card goes into the reader;
               with a reader connected (checked before the first cycle), the card is
               read: it answers only once its contacts touch the chip, all the way in;
  3. back      the pusher home again;
  4. issue     a sleep: the ATM would write the banknote on the card and check it;
  5. hand out  the turret to 180°: the banknote sticks out of the smile; a sleep, to pull it out;
  6. return    the turret back to its loading angle.

Rest is the pusher at home and the turret at its loading angle. The script goes
there slowly before the first cycle (from wherever the servos were left, see
servo_driver.py), ends every cycle there, and goes back there on Ctrl+C. Always
the pusher first, then the turret: at full stroke the pusher's finger is inside
the circle the banknote sweeps. A second Ctrl+C, while going back, lets the
servos go limp at once, where they are, so a jammed card can be freed by hand.
"""
import argparse
import os
import shutil
import subprocess
import sys
import time

# The servos themselves: shared with servo.py (hardware PWM when it is on, angles noted between runs).
from servo_driver import SERVOS, SOFTWARE_PULSES_NOTE, STAGGER_S, Servo, hardware_pwm_on

GPIO = {name: gpio for gpio, name in SERVOS.items()}   # {'turret': 12, 'pusher': 13}

# The end angles, as found in the calibration (each can be changed on the command line).
TURRET_IN = 0.0     # the reader's slot in line with the channel: the card goes in straight
TURRET_OUT = 180.0  # the banknote comes straight out of the smile
STROKE = 180.0      # the pusher's full stroke, in degrees from home: the card fully in the reader

# How fast each move goes: (degrees per step, seconds per step).
# Loading goes at --load-speed degrees per second, in 1° steps. Slowly: the
# card reaches the reader's slot at about 85° of the lever, where the carriage
# runs fastest. At 80°/s (180° in 2.3 s) a real ACR39U stopped the card at its
# slot, the card bowed and slipped over the pusher's finger; pushed slowly by
# hand, it went all the way in.
LOAD_SPEED = 30.0           # degrees per second: 180° in 6 s
PUSHER_BACK = (4.0, 0.025)  # 180° in about 1.1 s: nothing to carry on the way back
TURRET_TURN = (3.0, 0.030)  # 180° in about 1.8 s: the card stays in the reader, the reader's cable follows

# The card check: apps/atm/src/reader-check-cli.ts, through the ATM's own PC/SC
# code, run with Node.js. Exit 0: the card answered (all the way in); 2: in the
# reader but not answering (it stopped short); 3: no card; 1 and 4: no reader,
# or the card held by another program.
REPO = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
READER_CHECK = os.path.join(REPO, 'apps', 'atm', 'src', 'reader-check-cli.ts')
CARD_WAIT_MS = 1500   # after the load, how long the card has to show up in the reader

# The sleeps standing in for what this test doesn't use.
SEATED_S = 0.5    # at full stroke: the card settles in the reader (the reader would report it present)
ISSUE_S = 5.0     # the ATM writes the banknote on the card and checks it
TAKE_S = 8.0      # the customer pulls the banknote out of the smile (the reader would report it gone)
BETWEEN_S = 2.0   # between two cycles


class Log:
    """Prints each step with the seconds since the cycle started."""

    def __init__(self):
        self.start = time.monotonic()

    def __call__(self, text):
        print(f'  [{time.monotonic() - self.start:5.1f} s] {text}', flush=True)


def countdown(log, seconds, what):
    """A sleep that says what it stands for."""
    log(f'{what} ({seconds:g} s)')
    time.sleep(seconds)


def turn_turret(turret, pusher, target):
    """The interlock the ATM server must keep too: the turret never turns while the pusher is out."""
    if pusher.angle != 0:
        raise RuntimeError(f'the pusher must be home before the turret turns (it is at {pusher.angle:g}°)')
    turret.move(target, TURRET_TURN)


def go_to_rest(turret, pusher, args, log):
    """From wherever the servos are, slowly: the pusher home, then the turret to its loading angle."""
    if pusher.angle != 0:
        log(f'to rest: pusher {pusher.angle:g}° → 0° (home)')
        pusher.move(0, PUSHER_BACK)
    if turret.angle != args.turret_in:
        log(f'to rest: turret {turret.angle:g}° → {args.turret_in:g}° (loading)')
        turn_turret(turret, pusher, args.turret_in)


def node_binary():
    """A Node.js 22.18 or later, which runs the TypeScript directly, or None. pnpm atm:demo installs
    one in /usr/local; a shell with nvm may put an older one first on the PATH."""
    check = 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 18) ? 0 : 1)'
    for candidate in (shutil.which('node'), '/usr/local/bin/node'):
        if candidate and os.path.exists(candidate):
            if subprocess.run([candidate, '-e', check], capture_output=True).returncode == 0:
                return candidate
    return None


def reader_check(node, *options):
    """Runs reader-check-cli.ts: (its exit code, its line)."""
    try:
        result = subprocess.run([node, READER_CHECK, *options], capture_output=True, text=True, timeout=20, cwd=REPO)
    except subprocess.TimeoutExpired:
        return 1, 'the reader check did not answer'
    lines = (result.stdout.strip() or result.stderr.strip()).splitlines()
    return result.returncode, lines[-1] if lines else f'exit {result.returncode}'


def find_reader(args):
    """Before the first cycle: the Node.js that checks the card, when a reader is connected; else None."""
    if args.dry_run or args.no_reader:
        return None
    node = node_binary()
    if node is None:
        print('no Node.js 22.18 or later: the card will not be checked (pnpm atm:demo installs it)')
        return None
    if not os.path.exists(READER_CHECK):
        print(f'{READER_CHECK} is missing: the card will not be checked')
        return None
    code, message = reader_check(node, '--reader')
    if code != 0:
        print(f'no reader ({message}): the card will not be checked')
        return None
    print(f'reader: {message}. After each load the card is read, to check it went all the way in.')
    return node


def check_card(args, log):
    """After a load, with a reader: is the card read? Noted in args.card_results for the summary."""
    if args.reader_node is None:
        return
    code, message = reader_check(args.reader_node, '--card', '--wait', str(CARD_WAIT_MS))
    if code in (1, 4):
        # No reader any more, or the card held by another program: nothing said about the stroke.
        log('? ' + message)
        return
    log(('✔ ' if code == 0 else '✘ ') + message)
    args.card_results.append(code == 0)


def card_summary(args):
    """After the last cycle: how many loads put the card where the reader reads it."""
    results = args.card_results
    if not results:
        return
    print(f'card read after {sum(results)} of {len(results)} loads')
    if not all(results):
        print('  a card not read stopped short of the reader\'s contacts: slower (--load-speed), the stroke (--stroke),\n'
              '  the gate with its tongue, or a shim behind the reader (see the assembly PDF)')


def cycle(turret, pusher, args):
    """One banknote, from the hopper to the customer's hand; it starts and ends at rest."""
    log = Log()
    log(f'ready: pusher at home, turret at {args.turret_in:g}°')

    log(f'load: pusher 0° → {args.stroke:g}°, slowly')
    pusher.move(args.stroke, load_step(args))
    countdown(log, SEATED_S, 'the card settles in the reader')
    check_card(args, log)

    log(f'back: pusher {args.stroke:g}° → 0°')
    pusher.move(0, PUSHER_BACK)

    countdown(log, args.issue_seconds, 'issue: writing the banknote on the card and checking it')

    log(f'hand out: turret {args.turret_in:g}° → {args.turret_out:g}°')
    turn_turret(turret, pusher, args.turret_out)
    countdown(log, args.take_seconds, 'take the banknote out of the smile')

    log(f'return: turret {args.turret_out:g}° → {args.turret_in:g}°')
    turn_turret(turret, pusher, args.turret_in)
    log('done: at rest')


def angle(text):
    """An angle from the command line, 0-180."""
    value = float(text)
    if not 0 <= value <= 180:
        raise argparse.ArgumentTypeError(f'{value:g}° is outside 0-180')
    return value


def seconds(text):
    """A duration from the command line, not negative."""
    value = float(text)
    if value < 0:
        raise argparse.ArgumentTypeError('a duration cannot be negative')
    return value


def speed(text):
    """A speed from the command line, degrees per second: 1 to 180."""
    value = float(text)
    if not 1 <= value <= 180:
        raise argparse.ArgumentTypeError(f'{value:g}°/s is outside 1-180')
    return value


def load_step(args):
    """The pusher's loading move as (degrees per step, seconds per step): 1° steps at --load-speed."""
    return (1.0, 1.0 / args.load_speed)


def add_calibration_options(parser):
    """The calibration and --dry-run, shared with dispense.py (which the ATM server runs for each card)."""
    parser.add_argument('--stroke', type=angle, default=STROKE, help=f'the pusher\'s full stroke, degrees from home (default {STROKE:g})')
    parser.add_argument('--load-speed', type=speed, default=LOAD_SPEED,
                        help=f'how fast the pusher loads a card, degrees per second (default {LOAD_SPEED:g}): slower if the card stops at the reader\'s slot')
    parser.add_argument('--pusher-reversed', action='store_true', help='the pusher\'s rest is 180° (its shaft turns clockwise from 0° to 90°)')
    parser.add_argument('--turret-in', type=angle, default=TURRET_IN, help=f'the turret\'s loading angle (default {TURRET_IN:g})')
    parser.add_argument('--turret-out', type=angle, default=TURRET_OUT, help=f'the turret\'s hand-out angle (default {TURRET_OUT:g})')
    parser.add_argument('--dry-run', action='store_true', help='print the steps without moving the servos')


def check_calibration(parser, args):
    """Refuses a turn too short for the banknote to clear the smile (parser.error exits)."""
    # The servo turns 180° at most: with a loading angle above 0° the turret turns less than half a turn.
    # check-clearances.sh passes with the banknote at 170°: up to 10° askew it still clears the smile.
    turn = abs(args.turret_out - args.turret_in)
    if turn < 170:
        parser.error(f'the turret would turn only {turn:g}°: the banknote would hit the smile (170° at least)')
    if turn != 180:
        print(f'note: the turret turns {turn:g}°, not 180°: the banknote comes out {180 - turn:g}° askew')


def open_servos(args):
    """Both servos, each where it was left (it doesn't move) or, the first time, at rest: (turret, pusher).
    The pusher first: two MG996R starting together can make the batteries' voltage dip."""
    if not args.dry_run and not hardware_pwm_on():
        print(SOFTWARE_PULSES_NOTE, file=sys.stderr)
    pusher = Servo(GPIO['pusher'], 0, reversed_=args.pusher_reversed, dry_run=args.dry_run)
    try:
        time.sleep(STAGGER_S)
        turret = Servo(GPIO['turret'], args.turret_in, dry_run=args.dry_run)
        time.sleep(STAGGER_S)
    except BaseException:
        # Ctrl+C or an error before the turret started: the pusher, already started, goes limp (noted).
        pusher.release()
        raise
    for servo in (pusher, turret):
        if not args.dry_run and not servo.started_where_left:
            print(f'note: where the {servo.name} was is not known (first run): it went straight to rest', flush=True)
    return turret, pusher


def release_servos(turret, pusher, args):
    """Lets the servos that were opened go limp where they are, their angles noted for the next run."""
    for servo in (pusher, turret):
        if servo is not None:
            servo.release()
    if pusher is not None and turret is not None and not args.dry_run:
        print(f'pusher left at {pusher.angle:g}°, turret at {turret.angle:g}°', flush=True)


def parse_args():
    parser = argparse.ArgumentParser(description='Runs the ATM cycle on the real servos (the reader and the issuing are sleeps).')
    parser.add_argument('--cycles', type=int, default=1, help='how many cycles in a row (default 1)')
    add_calibration_options(parser)
    parser.add_argument('--issue-seconds', type=seconds, default=ISSUE_S, help=f'the sleep standing in for the issuing (default {ISSUE_S:g})')
    parser.add_argument('--take-seconds', type=seconds, default=TAKE_S, help=f'the time to pull the banknote out (default {TAKE_S:g})')
    parser.add_argument('--no-reader', action='store_true', help='don\'t check the card, even with a reader connected')
    args = parser.parse_args()
    if args.cycles < 1:
        parser.error('--cycles must be 1 or more')
    check_calibration(parser, args)
    return args


def main():
    args = parse_args()
    args.reader_node = find_reader(args)
    args.card_results = []

    turret = pusher = None
    try:
        turret, pusher = open_servos(args)
        go_to_rest(turret, pusher, args, Log())

        for n in range(1, args.cycles + 1):
            print(f'cycle {n} of {args.cycles}' + (' (dry run: no servo moves)' if args.dry_run else ''))
            cycle(turret, pusher, args)
            if n < args.cycles:
                time.sleep(BETWEEN_S)
        card_summary(args)
    except KeyboardInterrupt:
        if turret is None or pusher is None:
            print('\nstopped before both servos had started')
        else:
            print('\nstopping: back to rest, the pusher first (Ctrl+C again: the servos go limp at once, where they are)')
            try:
                go_to_rest(turret, pusher, args, Log())
                print('at rest. If a card is still in the reader or under the gate, take it out before the next run.')
            except KeyboardInterrupt:
                print('\nlet go: the servos are limp where they are. The next run starts from there and goes to rest first.')
    finally:
        # Limp at rest (or where a second Ctrl+C or an error left them), the angle noted for the next run.
        release_servos(turret, pusher, args)


if __name__ == '__main__':
    main()
