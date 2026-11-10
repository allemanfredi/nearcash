"""How the ATM's scripts drive the two MG996R servos, wired straight to the
Raspberry Pi 4: the turret on GPIO 12 (pin 32), the pusher on GPIO 13 (pin 33).

The pulses come from the Pi's hardware PWM when it is on: steady to the
microsecond, so a servo holds still and follows a step of 1° (11 µs). It is on
once the Pi's config.txt (/boot/firmware/config.txt) has the line

    dtoverlay=pwm-2chan,pin=12,func=4,pin2=13,func2=4

and the Pi has rebooted; scripts/atm-pi-setup.sh adds it. Without it, the
pulses are timed in software (gpiozero): they wobble by tens of microseconds,
so a servo twitches while it holds and misses small steps.

The 3.5 mm audio jack uses the same PWM: nothing must play through it while the
servos run (the ATM never does).

A servo has no sensor: a script that starts can't know where it is. So the
scripts write down where they leave each servo (STATE_FILE, on the Pi), and the
next one starts from there: its first pulse is that angle, so the servo doesn't
move, and from there it goes where it must slowly. A servo moved by hand while
limp, or a run killed outright, makes the note wrong: then the first pulse moves
the servo at full speed, as when there is no note at all.
"""
import json
import math
import os
import sys
import time

# The servos, by GPIO number (not the header's pin number).
SERVOS = {12: 'turret', 13: 'pusher'}

# MG996R: one pulse every 20 ms; a 0.5 ms pulse is 0°, a 2.5 ms pulse is 180°.
PERIOD_S = 0.020
MIN_PULSE_S = 0.0005
MAX_PULSE_S = 0.0025

# Between starting one servo and the next: two MG996R starting together draw a
# current peak that can make the batteries' voltage dip.
STAGGER_S = 0.5

# A calm move, for going to rest or to an angle typed by hand: (degrees per step, seconds per step),
# 180° in about 1.8 s. A servo told a far angle at once goes there at full speed.
CALM = (3.0, 0.030)

# Where the scripts last left each servo: {"12": 6.0, "13": 0.0}, the servos' own angles.
STATE_FILE = os.path.expanduser('~/.nearcash-atm-servos.json')

# The hardware PWM, as Linux shows it: a folder per PWM controller in /sys/class/pwm.
PWM_OVERLAY = 'dtoverlay=pwm-2chan,pin=12,func=4,pin2=13,func2=4'
PWM_SYSFS = '/sys/class/pwm'
PWM_CONTROLLER = 'fe20c000.pwm'   # the Raspberry Pi 4's PWM controller, by its name in /sys
PWM_CHANNEL = {12: 0, 13: 1}      # with the overlay, GPIO 12 is its channel 0 and GPIO 13 its channel 1

SOFTWARE_PULSES_NOTE = (
    'note: the hardware PWM is off, so the pulses are timed in software and the servos twitch.\n'
    f'      To turn it on: add the line  {PWM_OVERLAY}  to /boot/firmware/config.txt\n'
    '      (sudo scripts/atm-pi-setup.sh does it), then reboot the Pi.')


def pulse_s(angle):
    """The pulse width, in seconds, for an angle of 0-180°."""
    return MIN_PULSE_S + (MAX_PULSE_S - MIN_PULSE_S) * angle / 180


def pwm_chip():
    """The /sys folder of the Pi 4's PWM controller, or None while the overlay is off."""
    if not os.path.isdir(PWM_SYSFS):
        return None
    for name in sorted(os.listdir(PWM_SYSFS)):
        chip = os.path.join(PWM_SYSFS, name)
        # each pwmchipN links to the device it drives, e.g. .../fe20c000.pwm
        if os.path.basename(os.path.realpath(os.path.join(chip, 'device'))) == PWM_CONTROLLER:
            return chip
    return None


def hardware_pwm_on():
    return pwm_chip() is not None


def write(path, value, wait_s=2.0):
    """Writes a value into a /sys file. Right after an export, the channel's files
    take a moment to appear and to be given to the gpio group: try again till then."""
    deadline = time.monotonic() + wait_s
    while True:
        try:
            with open(path, 'w') as f:
                f.write(str(value))
            return
        except (FileNotFoundError, PermissionError):
            if time.monotonic() > deadline:
                raise
            time.sleep(0.05)


class HardwareServo:
    """A servo on one of the Pi's hardware PWM channels. Same use as gpiozero's
    AngularServo: set .angle (0-180) to move it, close() to let it go limp."""

    def __init__(self, chip, gpio, angle):
        self.chip = chip
        self.channel = PWM_CHANNEL[gpio]
        self.folder = os.path.join(chip, f'pwm{self.channel}')
        if not os.path.isdir(self.folder):
            write(os.path.join(chip, 'export'), self.channel)
        # The duty cycle may never be longer than the period: clear it before setting the period.
        write(os.path.join(self.folder, 'duty_cycle'), 0)
        write(os.path.join(self.folder, 'period'), round(PERIOD_S * 1e9))
        self.angle = angle
        write(os.path.join(self.folder, 'enable'), 1)

    @property
    def angle(self):
        return self._angle

    @angle.setter
    def angle(self, value):
        self._angle = value
        write(os.path.join(self.folder, 'duty_cycle'), round(pulse_s(value) * 1e9))   # nanoseconds

    def close(self):
        """Stops the pulses (the servo goes limp where it is) and gives the channel back."""
        write(os.path.join(self.folder, 'enable'), 0)
        write(os.path.join(self.chip, 'unexport'), self.channel)


def open_device(gpio, angle):
    """The servo on `gpio`, its very first pulse already at `angle`: on the
    hardware PWM when it is on, otherwise on gpiozero's software pulses."""
    chip = pwm_chip()
    if chip:
        return HardwareServo(chip, gpio, angle)
    try:
        from gpiozero import AngularServo
    except ImportError:
        sys.exit('neither the hardware PWM nor gpiozero is available: run this on the Raspberry Pi '
                 f'(and see {__file__} to turn the hardware PWM on)')
    # initial_angle makes the very first pulse this angle (without it, gpiozero would go to 0° first).
    return AngularServo(gpio, initial_angle=angle, min_angle=0, max_angle=180,
                        min_pulse_width=MIN_PULSE_S, max_pulse_width=MAX_PULSE_S)


def last_angles():
    """{gpio: angle} where the scripts last left the servos, in the servos' own angles ({} before the first run)."""
    try:
        with open(STATE_FILE) as f:
            saved = json.load(f)
        angles = {int(gpio): float(angle) for gpio, angle in saved.items()}
    except (OSError, ValueError, AttributeError):
        return {}
    return {gpio: angle for gpio, angle in angles.items() if 0 <= angle <= 180}


def remember(gpio, angle):
    """Notes where a servo is now. The file is written whole, then renamed: never half a file."""
    angles = last_angles()
    angles[gpio] = angle
    temporary = STATE_FILE + '.tmp'
    with open(temporary, 'w') as f:
        json.dump({str(g): a for g, a in sorted(angles.items())}, f)
    os.replace(temporary, STATE_FILE)


class Servo:
    """A servo whose angle is always known, used by servo.py and cycle.py.

    It starts where the scripts last left it (its first pulse is that angle: it
    doesn't move), or at `start` when that isn't known (then the first pulse sends
    it there at full speed). The angles are the script's: for a reversed servo the
    script's a is the servo's 180 - a, so that 0 is always home. With dry_run
    there is no servo and nothing is noted: only the angle and the waiting.
    """

    def __init__(self, gpio, start, reversed_=False, dry_run=False):
        self.gpio = gpio
        self.name = SERVOS[gpio]
        self.reversed = reversed_
        self.dry_run = dry_run
        last = None if dry_run else last_angles().get(gpio)
        self.started_where_left = last is not None
        self.angle = self.from_servo(last) if self.started_where_left else start
        self.device = None if dry_run else open_device(gpio, self.to_servo(self.angle))

    def to_servo(self, angle):
        """The servo's own angle for the script's angle."""
        return 180 - angle if self.reversed else angle

    def from_servo(self, angle):
        """The script's angle for the servo's own angle (the same flip, back)."""
        return 180 - angle if self.reversed else angle

    def set(self, angle):
        """Sends the servo to `angle` at once (at full speed if it is far: for small nudges)."""
        self.angle = angle
        if self.device is not None:
            self.device.angle = self.to_servo(angle)

    def move(self, target, speed=CALM):
        """Goes to `target` in steps, speed = (degrees per step, seconds per step), and waits till it's there.
        Interrupted (Ctrl+C), self.angle is still where the servo is, to within a step."""
        degrees, seconds = speed
        while self.angle != target:
            remaining = target - self.angle
            # a full step towards the target, or the last bit: then the angle is exactly the target
            self.set(target if abs(remaining) <= degrees else self.angle + math.copysign(degrees, remaining))
            time.sleep(seconds)
        self.note()

    def note(self):
        """Writes down where the servo is, for the next run."""
        if not self.dry_run:
            remember(self.gpio, self.to_servo(self.angle))

    def release(self):
        """Notes where the servo is, then stops its pulses: it goes limp there."""
        self.note()
        if self.device is not None:
            self.device.close()
