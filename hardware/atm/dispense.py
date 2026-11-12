"""Hands one card out of the ATM on the real servos: what the ATM server
(apps/atm, NEARCASH_DISPENSER=servos) runs for each sale while the printed
dummy reader stands in for the ACR39U (`pnpm atm:demo --dummy-reader`).

    python3 hardware/atm/dispense.py                      # one card, default calibration
    python3 hardware/atm/dispense.py --pusher-reversed    # the calibration options are cycle.py's
    python3 hardware/atm/dispense.py --dry-run            # prints the steps without moving anything

The steps are cycle.py's, without the pause for the issuing: with the dummy
reader nothing is written on the card.
  1. load      the pusher slowly to the end of its stroke: the bottom card goes into the reader;
  2. back      the pusher home again;
  3. hand out  the turret to its hand-out angle: the card sticks out of the smile;
  4. take      a pause for the customer to pull it out (the dummy can't tell when it's gone);
  5. return    the turret back to its loading angle: at rest, ready for the next card.

What the ATM server reads (it starts this script with spawn):
  stdout  one line per step, for the operator's log, and the line OUT the
          moment the card sticks out of the smile: the kiosk then says "take it";
  stderr  why it failed, if it did;
  exit    0 when the servos are back at rest after the card went out; 1 when
          it stopped or failed (2: wrong options, nothing moved).
SIGTERM (the server stopping it) and Ctrl+C take the servos back to rest first,
as in cycle.py; a second one lets them go limp at once.

Only one run drives the servos at a time: a run waits (up to LOCK_WAIT_S) for
the one before it, e.g. one left going by an ATM server that was restarted.
"""
import argparse
import fcntl
import os
import signal
import sys
import time

from cycle import (PUSHER_BACK, SEATED_S, Log, add_calibration_options, check_calibration, countdown,
                   go_to_rest, load_step, open_servos, release_servos, seconds, turn_turret)

# The line that tells the ATM server the card is out (apps/atm/src/server/features/hardware/servo-dispenser.ts).
OUT_LINE = 'OUT'

# How long the card stays out of the smile before the turret turns back. A card
# not taken by then goes back in with the turret: take it out of the reader
# before the next sale, or the next card jams behind it.
TAKE_S = 15.0

# Held while the servos move, so two runs never drive them at once.
LOCK_FILE = os.path.expanduser('~/.nearcash-atm-servos.lock')
LOCK_WAIT_S = 60.0


def hold_the_servos(log):
    """Waits until no other run holds the servos, then holds them until this process ends."""
    lock = open(LOCK_FILE, 'w')
    give_up_at = time.monotonic() + LOCK_WAIT_S
    waiting = False
    while True:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return lock   # kept open: closing it (or exiting) lets the next run go
        except BlockingIOError:
            if time.monotonic() > give_up_at:
                raise RuntimeError(f'another run has been driving the servos for over {LOCK_WAIT_S:g} s')
            if not waiting:
                log('waiting for the previous run to put the servos at rest')
                waiting = True
            time.sleep(0.2)


def stop_on_sigterm(signum, frame):
    """SIGTERM behaves as Ctrl+C: back to rest before exiting."""
    raise KeyboardInterrupt


def hand_out(turret, pusher, args, log):
    """One card from the hopper to the customer's hand, from rest to rest."""
    log(f'load: pusher 0° → {args.stroke:g}°, slowly')
    pusher.move(args.stroke, load_step(args))
    countdown(log, SEATED_S, 'the card settles in the reader')

    log(f'back: pusher {args.stroke:g}° → 0°')
    pusher.move(0, PUSHER_BACK)

    log(f'hand out: turret {args.turret_in:g}° → {args.turret_out:g}°')
    turn_turret(turret, pusher, args.turret_out)
    print(OUT_LINE, flush=True)
    countdown(log, args.take_seconds, 'take the card out of the smile')

    log(f'return: turret {args.turret_out:g}° → {args.turret_in:g}°')
    turn_turret(turret, pusher, args.turret_in)
    log('done: at rest')


def parse_args():
    parser = argparse.ArgumentParser(description='Hands one card out on the real servos (for the ATM server, with the dummy reader).')
    add_calibration_options(parser)
    parser.add_argument('--take-seconds', type=seconds, default=TAKE_S, help=f'how long the card stays out before the turret turns back (default {TAKE_S:g})')
    args = parser.parse_args()
    check_calibration(parser, args)
    return args


def main():
    args = parse_args()
    signal.signal(signal.SIGTERM, stop_on_sigterm)
    log = Log()
    turret = pusher = None
    try:
        lock = None if args.dry_run else hold_the_servos(log)   # held until main() returns
        turret, pusher = open_servos(args)
        go_to_rest(turret, pusher, args, log)
        hand_out(turret, pusher, args, log)
        return 0
    except KeyboardInterrupt:
        if turret is None or pusher is None:
            print('stopped before both servos had started', file=sys.stderr, flush=True)
            return 1
        print('stopped: back to rest, the pusher first', file=sys.stderr, flush=True)
        try:
            go_to_rest(turret, pusher, args, log)
        except KeyboardInterrupt:
            print('let go: the servos are limp where they are', file=sys.stderr, flush=True)
        return 1
    except Exception as error:   # a servo that can't be driven (no PWM, no permission…): say why, in one line
        print(f'the servos could not hand the card out: {error}', file=sys.stderr, flush=True)
        return 1
    finally:
        release_servos(turret, pusher, args)


if __name__ == '__main__':
    sys.exit(main())
