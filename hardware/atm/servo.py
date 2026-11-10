"""Moves the ATM's two servos by hand: to fit their horns, to find the pusher's
direction and to calibrate. It runs on the Raspberry Pi, with the servos wired
straight to its pins (see "Preparing the servos" in the assembly PDF):

    pnpm atm:servos                     # both servos to rest (0°), held there until you press Enter
    pnpm atm:servos --pusher-reversed   # the same, for a pusher whose rest is 180°
    pnpm atm:servos 13 90               # one servo to an angle (0-180), held the same way

GPIO 12 is the turret, GPIO 13 the pusher (the lever). To rest, the pusher
always goes first, then the turret: at full stroke the pusher's finger is inside
the circle the banknote sweeps. With one servo, while it holds you can move it,
for the calibration: type +1 or -2 (and Enter) to nudge it by so many degrees,
or 7 to send it to 7°; Enter alone lets go, and the script prints the angle it
ended on. The angles here are the servos' own, never reversed.

Every move is calm (servo_driver.CALM), from where the servo was left: the
scripts note it between runs (see servo_driver.py). A servo holds its angle only
while this script runs: when it ends, the pulses stop and the servo goes limp
where it is.
"""
import sys
import time

# The servos themselves: shared with cycle.py (hardware PWM when it is on, angles noted between runs).
from servo_driver import SERVOS, SOFTWARE_PULSES_NOTE, STAGGER_S, Servo, hardware_pwm_on

TURRET, PUSHER = 12, 13

USAGE = ('usage: pnpm atm:servos [--pusher-reversed]   both servos to rest: the pusher (0°, or 180° if reversed), then the turret (0°)\n'
         '       pnpm atm:servos PIN ANGLE             one servo (PIN 12: turret, 13: pusher) to ANGLE (0-180)')


def targets(args):
    """Which servos to move, to what angle and in which order: [(gpio, angle), ...]."""
    if not args or args == ['--pusher-reversed']:
        pusher_rest = 180.0 if args else 0.0
        return [(PUSHER, pusher_rest), (TURRET, 0.0)]   # the pusher home first
    if len(args) != 2:
        sys.exit(USAGE)
    try:
        pin, angle = int(args[0]), float(args[1])
    except ValueError:
        sys.exit(f'not a number: {" ".join(args)}\n{USAGE}')
    if pin not in SERVOS:
        sys.exit(f'there is no servo on GPIO {pin}\n{USAGE}')
    if not 0 <= angle <= 180:
        sys.exit(f'{angle:g}° is outside 0-180\n{USAGE}')
    return [(pin, angle)]


def main():
    moves = targets(sys.argv[1:])
    if not hardware_pwm_on():
        print(SOFTWARE_PULSES_NOTE, file=sys.stderr)

    servos = []
    try:
        for pin, angle in moves:
            # It starts where it was left (no move), or, the first time, right at `angle`.
            servo = Servo(pin, angle)
            servos.append(servo)
            if servo.angle != angle:
                print(f'GPIO {pin} ({servo.name}): {servo.angle:g}° → {angle:g}°')
                servo.move(angle)
            print(f'GPIO {pin} ({servo.name}): {angle:g}°')
            time.sleep(STAGGER_S)   # two MG996R starting together can make the batteries' voltage dip

        if len(servos) == 1:
            adjust(servos[0])
        else:
            input('Holding: press Enter to let go. ')
    except (KeyboardInterrupt, EOFError):
        print()
    finally:
        for servo in servos:
            servo.release()   # its angle noted for the next run


def adjust(servo):
    """Holds one servo and moves it as typed: +N / -N nudge it, a plain number is an angle; Enter alone ends."""
    print('Holding. Type +1 or -1 (or any +N / -N) to nudge it, or an angle such as 7; Enter alone lets go.')
    while True:
        line = input(f'{servo.name} at {servo.angle:g}°> ').strip()
        if not line:
            break
        try:
            value = float(line)
        except ValueError:
            print(f'not a number: {line}')
            continue
        # a sign means a nudge from here; no sign, an angle
        target = servo.angle + value if line[0] in '+-' else value
        if not 0 <= target <= 180:
            print(f'{target:g}° is outside 0-180: the servo stays at {servo.angle:g}°')
            continue
        servo.move(target)
    print(f'{servo.name} ended at {servo.angle:g}°')


if __name__ == '__main__':
    main()
