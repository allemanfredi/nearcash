"""Builds the ATM's assembly instructions, in English and in Italian:

    nearcash-atm-assembly-en.pdf
    nearcash-atm-assembly-it.pdf

The pictures come from the model: every assembly step is rendered from
assembly-steps.scad, the card's journey from nearcash-atm.scad, and every
part's thumbnail from its STL. So run it after export.sh, whenever the model
changes:

    python3 hardware/atm/make-instructions.py

It needs OpenSCAD (as export.sh does), Pillow (to trim the renders) and
Google Chrome, which prints each language's HTML page to PDF.
"""
import html
import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageChops

HERE = os.path.dirname(os.path.abspath(__file__))
OPENSCAD = shutil.which('openscad') or '/Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD'
CHROME = os.environ.get('CHROME', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')

# ------------------------------------------------------------------ what both languages share

# The printed parts, in the order the instructions list them:
# (STL name, how many, colour, plate in nearcash-atm.3mf).
# A part with an inlay in another colour, printed with it as one object: its card shows it front up.
INLAYS = {'face': 'face_brand'}   # the face's black ink: its lips, and the NearCash name and logo
PARTS = [
    ('chassis', 1, 'black', 8), ('servo_clamp', 4, 'black', 6),
    ('legs_front', 1, 'green', 5), ('legs_back', 1, 'green', 5), ('lever', 1, 'black', 3),
    ('carriage', 1, 'green', 7), ('channel_post', 4, 'green', 10), ('channel_floor', 1, 'green', 7),
    ('hopper', 1, 'green', 11), ('gate_1_1', 1, 'black', 12), ('turret', 1, 'green', 13),
    ('turret_strap', 1, 'black', 3), ('face', 1, 'green and black', 14), ('phone_shelf', 1, 'black', 9),
    ('phone_back', 1, 'black', 9), ('test_fit', 1, 'black', 1), ('test_reader', 1, 'black', 1), ('test_horn', 1, 'black', 4),
    ('dummy_reader', 1, 'white', 15), ('dummy_reader_lid', 1, 'white', 15),
]

# Where each assembly step is seen from: the eye (x, y, z), then the point it
# looks at, in the model's coordinates (X across, +Y to the back, Z up).
STEP_CAMERAS = [
    '260,-260,-200,10,90,20',   # 1 servos, from below
    '-330,-300,130,0,90,20',    # 2 posts
    '260,360,260,25,130,40',    # 3 lever
    '300,380,260,0,130,45',     # 4 channel
    '300,400,280,0,130,55',     # 5 hopper and gate
    '330,-300,260,0,0,50',      # 6 turret
    '-200,-480,180,0,0,45',     # 7 face
    '320,-420,300,0,0,70',      # 8 phone
    '260,460,300,0,130,55',     # 9 cards
]

# The card's journey, as export.sh renders it for images/how-it-works.png.
FRAME_STATES = [
    ['-D', 'pusher=0'], ['-D', 'pusher=0.45'], ['-D', 'pusher=1'],
    ['-D', 'pusher=0', '-D', 'card_in_reader=true'],
    ['-D', 'pusher=0', '-D', 'turret_angle=90'], ['-D', 'pusher=0', '-D', 'turret_angle=180'],
]
FRAME_CAMERA = '360,-170,280,0,55,40'

# ------------------------------------------------------------------ the words

ENGLISH = dict(
    file='nearcash-atm-assembly-en.pdf',
    lang='en',
    colours={'black': 'black', 'green': 'green', 'green and black': 'green and black', 'white': 'white'},
    plate='plate',
    parts={
        'chassis': 'Chassis', 'servo_clamp': 'Plate under a servo tab',
        'legs_front': 'Front legs (the tall posts)', 'legs_back': 'Back legs (the short posts)', 'lever': 'Lever', 'carriage': 'Carriage',
        'channel_post': 'Channel post', 'channel_floor': 'Channel floor', 'hopper': 'Hopper', 'gate_1_1': 'Gate (1.1 mm gap)',
        'turret': 'Turret', 'turret_strap': 'Reader’s strap', 'face': 'Face (the smile)', 'phone_shelf': 'Phone shelf',
        'phone_back': 'Phone back', 'test_fit': 'Fit test piece', 'test_reader': 'Reader test piece', 'test_horn': 'Horn pocket test piece',
        'dummy_reader': 'Dummy reader (until the ACR39U arrives)', 'dummy_reader_lid': 'Dummy reader’s lid',
    },
    frames=[
        'Ready: blank cards wait in the hopper; the reader’s slot faces them.',
        'The pusher, under the floor, catches only the bottom card and pushes it under the gate.',
        'The card goes all the way into the reader: the Raspberry Pi issues the banknote.',
        'The pusher goes back home. The card stays in the reader, its end sticking out.',
        'The turret turns, carrying the reader with the card inside.',
        'At 180° the banknote sticks out of the smile: the customer pulls it out.',
    ],
    measures=[
        ('card_insert_depth', 'Push a card fully into the reader and measure what sticks out. The depth is 85.6 minus that.', '60 mm'),
        ('reader_slot_bottom', 'With the reader flat on the table and a card in it, the height of the card’s lower face above the table.', '6 mm'),
        ('reader_w, reader_l, reader_h', 'The reader: width, length (slot to cable end) and height. Its pocket on the turret leaves 0.3 mm of play.', '69 · 72.2 · 14.5 mm'),
        ('horn_span, horn_arm, horn_arm_tip, horn_t, horn_boss_d', 'The cross horn (its arms taper): tip to tip, arm width 8 mm out and at the tip, thickness, the middle across the corners.', '36 · 7.9 · 4.7 · 3.6 · 14.8 mm'),
        ('horn_gap', 'With the horn on the servo: from the top of the servo’s case to the underside of the horn’s arms.', '2.3 mm'),
        ('servo_tab_top', 'From the servo’s bottom to the top face of its mounting tabs.', '29 mm'),
        ('phone_width, phone_thickness, phone_height', 'The phone (in its case, if it has one).', '71.9 · 8.75 · 150 mm'),
    ],
    steps=[
        dict(title='The servos in the chassis (seen from below)', items=[
            'Turn the chassis upside down.',
            'Push each servo up into its hole from below, shaft up. The shaft goes at the end of the hole '
            '<b>nearest the ATM’s centre line</b> (on the left, seen from the front); the servo’s body runs to the right. '
            'The front servo turns the turret, the middle one the lever.',
            'Push it until its tabs touch the chassis (the middle servo rests on two spacers).',
            'Lay a plate (<code>servo_clamp</code>) on each tab and screw the servo on: four screws from the servo’s bag, '
            'through the plate and the slot in the tab, into the holes in the chassis. They cut their own thread: tighten them '
            'until the tab is held firm, no further.',
            'Leave the servos’ cables free: they go to the breadboard and the Pi.',
        ], note='The plates are there because the slots in the tabs are as wide as the rubber grommets they are made for: a '
                'screw head could slip through. Leave the grommets and the brass eyelets out.'),
        dict(title='The legs', items=[
            'Back legs (<code>legs_back</code>): press their two pegs into the holes under the chassis, at the back, the base reaching backwards.',
            'Front legs (<code>legs_front</code>): push their two tall posts up through the front sleeves, the base reaching forwards '
            '(the holes for the face’s pegs face forward too), until the sleeves rest on the collars.',
            'Stand the chassis up: it now stands on the two legs’ bases (the middle servo stays 22 mm above the table).',
        ], note=None),
        dict(title='The lever', items=[
            'Send the middle servo to rest and leave it holding: <code>pnpm atm:servos 13 0</code> (or <code>13 180</code>, see “Preparing the servos”).',
            'Press the lever onto the middle servo’s horn, pin up, arm pointing to the back.',
            'Check its direction: going from rest to the other end of its travel, the lever must turn anticlockwise '
            'seen from above, towards the middle of the ATM, and end up pointing forward. Then send it back to rest.',
        ], note=None),
        dict(title='The channel', items=[
            'Slide the carriage into the rails under the channel floor <b>from the front</b> (the end towards the turret), '
            'finger up in the slot and towards the front: the slot is open only at that end. It must slide freely all the way.',
            'Push the four channel posts (<code>channel_post</code>) into the holes on top of the chassis, the ribbed peg down: push firmly, '
            'the ribs grip the hole.',
            'Set the floor on them, guiding the lever’s pin into the slot under the carriage, and press it down over each post '
            'until its split head clicks over the floor. To take the floor off, squeeze each head’s two halves together.',
            'Test: move the pusher to the other end in steps of 45°, and back. The carriage must follow without sticking.',
        ], note='PETG strings: before sliding the carriage in, clear any wisps of filament out of the rails with a craft knife. A little dry PTFE lubricant on the rails helps: the lever pushes the carriage off its centre line, and too much friction '
                'could lock it in its rails, like a drawer pulled by one corner.'),
        dict(title='The hopper and the gate', items=[
            'Press the hopper onto the floor: its four pegs into their holes, its outer walls down the floor’s sides, just behind the front pads, until the four fingers click under the rails.',
            'Slide the gate down the slots in the hopper’s front pillars, its engraved number towards the hopper (the back), until its two arms click under the steps on the pillars.',
            'Test with 2–3 cards: move the pusher slowly to the other end and back. Exactly one card must come out.',
        ], note='If two cards come out, use gate 1.0, then 0.9; if the card stops under the gate, use 1.2 (they are on plate 2). '
                'To change the gate, spread its two arms and pull it out by the tab. To take the hopper off, ease its fingers out from under the rails, one side at a time.'),
        dict(title='The turret and the reader', items=[
            'Send the front servo to 0° and leave it holding: <code>pnpm atm:servos 12 0</code>.',
            'Lay the ACR39U in the turret, its slot towards the hopper and its cable towards the front.',
            'Snap the reader’s strap (<code>turret_strap</code>) over it: spread its legs a little, the hooks go under the turret.',
            'Press the turret onto the front servo’s horn, the reader’s slot towards the hopper.',
            'Leave the USB cable a generous loop: the turret turns half a turn.',
            'Test: 0° → 180° → 0° in steps of 30°, watching the cable. Nothing must touch, and the cable must follow freely.',
        ], note=None),
        dict(title='The face', items=[
            'Push the face’s two pegs into the holes of the tall posts.',
        ], note=None),
        dict(title='The phone', items=[
            'Press the shelf onto the tall posts’ tops (it passes over the turret).',
            'Slide the back’s two rails into the shelf’s sockets.',
            'Put the right-angle plug in its pocket and run the cable out along its channel, to the right. The plug’s head has about 4.4 mm under the phone: check yours.',
            'Stand the phone in the groove, leaning on the back.',
        ], note='The phone sits high: a hard push at its top can tip the ATM over. '
                'Tape the four feet to the counter, or put a weight on the chassis behind the hopper.'),
        dict(title='The cards', items=[
            'Load the blank cards (up to about 12) with the chip end towards the gate: that end goes into the reader first.',
            'The chip must face the way the reader takes it: try one card by hand first.',
        ], note='Keep fingers out of the smile while the turret turns.'),
    ],
    body='''
<div class="cover">
  <div class="kicker">NearCash · the 3D-printed ATM</div>
  <h1>Assembly instructions</h1>
  <p class="lead">From the printed parts to the first banknote: what you need, what to measure, how to prepare the
  servos, how to put the ATM together in nine steps, and how to calibrate it.</p>
  <img src="{images}/atm-front.png">
  <ol class="toc">
    <li>How it works</li><li>What you need</li><li>Before printing everything</li><li>Preparing the servos</li>
    <li>Assembly, in nine steps</li><li>Motion and calibration</li><li>If something goes wrong</li>
  </ol>
  <p class="meta">Made from <code>hardware/atm/nearcash-atm.scad</code> by <code>make-instructions.py</code>.
  The pictures are the model itself: if you change a measurement, build this PDF again.</p>
</div>

<h2 class="break">1 · How it works</h2>
<p>Blank cards wait in the hopper. When a sale is paid, a carriage under the channel floor, moved by a lever on a
servo, catches the bottom card with a 0.6 mm finger (thinner than a card, so it never takes two), pushes it under the
gate and all the way into the reader. The Raspberry Pi turns the card into a banknote through the reader. The carriage
goes back, the turret turns 180° carrying the reader, and the banknote sticks out of the smile: the customer pulls it
out of the reader, as at any ATM. When the reader reports the card gone, the turret turns back.</p>
{frames}
<p>The ATM never pulls the card out itself: the ACR39U is a contact reader with a pocket slot, and printed parts can’t
grip a card firmly enough to drag it out. If a card fails its check, the turret doesn’t turn: the card stays in the
reader and the ATM is out of service until the operator takes it out.</p>

<h2 class="break">2 · What you need</h2>
<table>
  <tr><th>Part</th><th>Details</th></tr>
  <tr><td>Card reader</td><td>ACS ACR39U-U1 (contact, USB)</td></tr>
  <tr><td>Servos</td><td>2 × MG996R (180°), with their cross horns, horn screws and mounting screws (4 per servo, in its bag)</td></tr>
  <tr><td>Servo power</td><td>4 AA batteries in a holder (NiMH rechargeables: 4.8 V), or a 5 V supply of at least 3 A. It powers the servos only, never through the Pi</td></tr>
  <tr><td>Wiring</td><td>A small breadboard, 4 male–male and 3 male–female jumper wires: the servos’ signals go straight to the Pi’s pins, with no driver board</td></tr>
  <tr><td>Controller</td><td>Raspberry Pi 4 or 5 with 64-bit Raspberry Pi OS and its own power supply; it sits next to the ATM</td></tr>
  <tr><td>Cards</td><td>Blank NXP J3R180 cards (85.6 × 54 × 0.76 mm), with the applet installed</td></tr>
  <tr><td>Screen</td><td>An iPhone 17 Pro without a case, and a charging cable with a right-angle plug</td></tr>
  <tr><td>Filament</td><td>PETG Basic, about 223 g with the test pieces: 106 g green, 117 g black</td></tr>
  <tr><td>Tools</td><td>A small Phillips screwdriver (the servo and horn screws), a caliper, double-sided tape, a craft knife or fine sandpaper for burrs</td></tr>
</table>
<p>No glue and no metal in the structure: the parts fit with printed pegs and rails. The only screws are the servos’ own:
four hold each servo to the chassis, one holds each horn.</p>
<h3 class="sub">The printed parts</h3>
<div class="parts">{parts}</div>
<p class="after-parts"><code>gate_0_9</code>, <code>gate_1_0</code> and <code>gate_1_2</code> are spare gates with other gaps
(the number is engraved on the hopper side), on plate 2: print them only if 1.1 doesn’t work.</p>

<h2 class="break">3 · Before printing everything</h2>
<p>The model is parametric: everything follows the values at the top of <code>nearcash-atm.scad</code>, and the defaults
are estimates. Measure your hardware with a caliper. <code>card_insert_depth</code> matters most: what sticks out of the
reader swings round with the turret, and the channel, the hopper and the smile stand around that circle with a 4 mm margin.</p>
<table><tr><th>Value</th><th>How to measure it</th><th>Default</th></tr>{measures}</table>
<p>Check, too, that your servos are the size of the MG996R the model expects: a 40.7 × 19.7 mm body, 54.5 mm from tab to tab.</p>
<p>Then print <b>plates 1 and 4</b> (about 20 minutes) and try the three test pieces:</p>
<ul>
  <li><b><code>test_reader</code></b>: lay the reader flat on the table, put the piece against its slot and slide a card
  along its rails. The card must go into the slot without catching its edge and without lifting. If it doesn’t,
  correct <code>reader_slot_bottom</code>.</li>
  <li><b><code>test_horn</code></b> (plate 4): press a servo horn into the cross pocket: snug, with no play, since that fit
  alone holds the turret on its servo. If it is too tight or too loose, change <code>horn_fit</code>.</li>
  <li><b><code>test_fit</code></b>: push the peg into its hole (firm); slide the slice of carriage into the length of rail
  (free, without wobbling). If a fit is too tight or too loose, change <code>fit</code> (sliding) or <code>press</code> (pegs).</li>
</ul>
<p>If you changed a value, build everything again and check it:</p>
<pre>hardware/atm/export.sh                     # STLs and images
hardware/atm/check-clearances.sh           # nothing touches, at any position
python3 hardware/atm/make-3mf.py           # the Bambu Studio project
python3 hardware/atm/make-instructions.py  # these instructions</pre>
<p>Then open <code>nearcash-atm.3mf</code> in Bambu Studio and print <b>plates 3 and 5 to 14</b> (about 6½ hours in all):
every part is already on its plate, in its colour, with the right settings. No part needs supports. The channel floor
prints upside down, the face the cards slide on against the bed: the smooth plate is best for it (with glue stick: PETG sticks
too hard to bare smooth PEI), the textured one works too.</p>
<p>Plate 14, the face, is the only one in two colours: the lips round the smile and the NearCash name and logo
are black, flush in its front, which prints against the bed. The AMS takes both colours to the same nozzle and swaps them in the first three layers
only, with a small prime tower (a few minutes and about 2 g more). The project already maps both to that nozzle.</p>
<p>No reader yet? <b>Plate 15</b> (about 50 minutes, in white) is a dummy reader to try the mechanism with: the reader’s
outside, so it sits in the turret under the strap, and its slot, as high and as deep. A card slides in from the turret’s
shelf, stops where it would in the reader, and two springs at the slot’s sides hold it while the turret turns, as the
reader’s contacts do. The lid pegs onto the base. It reads nothing: run the motion alone (<code>cycle.py</code>), or a
whole sale with <code>pnpm atm:demo --dummy-reader</code>, which hands out the card blank once paid. If the
card comes out too easily or is too hard to pull, change <code>dummy_grip</code>.</p>

<h2 class="break">4 · Preparing the servos</h2>
<p>The horns go on with the servos at rest, so wire the servos before the assembly. They plug straight into the Pi:
their signal goes to two of its pins, their power comes from the batteries.</p>
<table>
  <tr><th>Servo wire</th><th>Turret (the front servo)</th><th>Pusher (the middle servo, with the lever)</th></tr>
  <tr><td>Orange (signal)</td><td>GPIO 12 (pin 32)</td><td>GPIO 13 (pin 33)</td></tr>
  <tr><td>Red (+)</td><td>the batteries’ +</td><td>the batteries’ +</td></tr>
  <tr><td>Brown (−)</td><td>the batteries’ −</td><td>the batteries’ −</td></tr>
</table>
<p class="note warn">The batteries’ − goes to a GND pin of the Pi too (pin 34): without it the servos can’t read the
signal. The batteries’ + must never touch a pin of the Pi, and the servos never take power from the Pi’s 5 V.</p>
<p>The pins are numbered from pin 1, the corner of the 40-pin header away from the USB ports. Pins 32 and 34 are on the
row along the board’s edge, pin 33 on the inner row, across from 34. On the breadboard, the batteries go on the two
rails, each servo’s red and brown wires go on them with male–male jumpers, and the orange wires and the rail’s − go to
the Pi with male–female ones. A 470–1000 µF capacitor (at least 10 V) across the rails is optional: it smooths the dip
when the servos start.</p>
<p>On the Pi, once: give pins 12 and 13 to the Pi’s hardware PWM, which makes steady pulses, then reboot
(<code>pnpm atm:demo</code> adds the same line when it prepares the Pi). The 3.5 mm audio jack shares that PWM: nothing
may play through it while the servos run.</p>
<pre>printf '[all]\\ndtoverlay=pwm-2chan,pin=12,func=4,pin2=13,func2=4\\n' | sudo tee -a /boot/firmware/config.txt
sudo reboot</pre>
<p>Then, from the repository on the Pi:</p>
<pre>pnpm atm:servos                     # both to rest (0°): the pusher first, then the turret; held till Enter
pnpm atm:servos --pusher-reversed   # the same, for a pusher whose rest is 180°
pnpm atm:servos 13 90               # one servo to an angle: GPIO 12 is the turret, 13 the pusher</pre>
<p>The script is <code>hardware/atm/servo.py</code>. With the hardware PWM the servos hold still; without it the
script says so and times the pulses in software (gpiozero): the servos twitch and miss small steps. Every move is
calm, from where the servo was left: the scripts write it down on the Pi (<code>~/.nearcash-atm-servos.json</code>),
since a servo can’t tell where it is. When it ends, the servos go limp where they are.</p>
<p><b>The pusher’s direction.</b> Run <code>pnpm atm:servos 13 0</code>, then <code>pnpm atm:servos 13 90</code>, and
watch the shaft from above.
If the shaft turns anticlockwise, its rest position is 0°. If it turns clockwise, its rest position is 180°: write it
down, because the software will have to reverse this servo (angle → 180° − angle). The turret’s direction doesn’t
matter: its rest is 0°.</p>
<p><b>The horns.</b> With each servo at rest, held there by <code>pnpm atm:servos</code>, fit its cross horn with the screw, its arms as close as possible to the
servo’s body (one along it, one across). The splines allow only some positions: take the nearest, the small error is
corrected in the calibration. The screw’s head must not stand more than 1.5 mm proud of the horn: above it sit the reader and the carriage.</p>
<p class="note">Once the horns are on, don’t turn the shafts by hand. If they moved, send the servo back to rest before
steps 3 and 6, where you press on the lever and the turret.</p>

<h2 class="break">5 · Assembly, in nine steps</h2>
<p>In every picture, the parts mounted in earlier steps are grey and the step’s new parts are in their colour.
The servos are blue, the reader and the phone dark.</p>
{steps}

<h2 class="break">6 · Motion and calibration</h2>
<p>With the reader plugged into the Pi over USB, <code>pnpm atm:reader</code> lists the readers and checks the card in
it. The ATM server doesn’t drive the servos yet (its dispenser is simulated): this is the sequence it will have to run,
with the Pi’s hardware PWM on the same two pins, and you can try it by hand with <code>pnpm atm:servos PIN ANGLE</code>.</p>
<table>
  <tr><th>Step</th><th>Turret (GPIO 12)</th><th>Pusher (GPIO 13)</th><th>Waits for</th></tr>
  <tr><td>Idle</td><td>0° (slot to the hopper)</td><td>rest (home)</td><td>a paid sale</td></tr>
  <tr><td>Load</td><td>0°</td><td>rest → other end, slowly</td><td>the reader: card present</td></tr>
  <tr><td>Back</td><td>0°</td><td>other end → rest</td><td></td></tr>
  <tr><td>Issue</td><td>0°</td><td>rest</td><td>the banknote issued and checked</td></tr>
  <tr><td>Hand out</td><td>0° → 180°</td><td>rest</td><td>the reader: card removed</td></tr>
  <tr><td>Ready</td><td>180° → 0°</td><td>rest</td><td></td></tr>
</table>
<p class="note warn">The pusher must be home before the turret turns: at full stroke its finger is inside the circle the
banknote sweeps.</p>
<p><b>Calibration.</b> Find the right angle at both ends of each servo, in small steps:</p>
<ul>
  <li>Turret, loading angle: the reader’s slot square to the channel, so the card goes in straight. The horn’s splines
  leave the turret a few degrees off at 0°: run <code>pnpm atm:servos 12 0</code> and type <code>+1</code> (and Enter)
  until the slot faces the channel; the angle it ends on is <code>--turret-in</code>. If the slot lines up only below 0°,
  refit the horn one tooth the other way and try again.</li>
  <li>Turret, hand-out angle: the banknote straight out of the smile, found the same way from 180 down
  (<code>--turret-out</code>). The servo turns 180° at most, so with a loading angle above 0° the turret turns a little
  less than half a turn: up to 10° askew the banknote still clears the smile.</li>
  <li>Pusher at full stroke: the card goes fully into the reader without pushing on its end stop. Start 20° short of the
  end and go 5° at a time.</li>
</ul>
<p><b>The whole cycle.</b> To test the mechanics, <code>pnpm atm:cycle</code> runs this sequence on the servos, with
pauses instead of the reader and the issuing: a card goes into the reader, the pusher goes home, the turret turns, you
pull the banknote out of the smile (you have 8 seconds), and the turret turns back. Put the reader in the turret first, strapped down (without it the card has no slot to go into, and the turret doesn’t carry it round), and a few blank cards in the hopper.
It starts by bringing the servos to rest, slowly from where they were left, and ends every cycle at rest: the
pusher home, the turret at its loading angle, always the pusher first. Ctrl+C stops it and brings them back to rest;
Ctrl+C a second time lets them go limp at once, where they are, to free a jammed card by hand.</p>
<pre>pnpm atm:cycle --dry-run                       # prints the steps, moves nothing
pnpm atm:cycle --stroke 160                    # one cycle, the pusher 20° short of its end
pnpm atm:cycle --stroke 175 --cycles 10        # ten in a row, once the stroke is right
pnpm atm:cycle --pusher-reversed               # for a pusher whose rest is 180°</pre>
<p>The angles found in the calibration go in as <code class="nowrap">--stroke</code>, <code class="nowrap">--turret-in</code> and
<code class="nowrap">--turret-out</code> (by default 180, 0 and 180); <code class="nowrap">--issue-seconds</code> and <code class="nowrap">--take-seconds</code>
change the pauses. The script is <code>hardware/atm/cycle.py</code>.</p>

<h2 class="break">7 · If something goes wrong</h2>
<table>
  <tr><th>What happens</th><th>What to do</th></tr>
  <tr><td>The card catches the edge of the reader’s slot</td><td>Correct <code>reader_slot_bottom</code> with <code>test_reader</code> and print the turret again.</td></tr>
  <tr><td>Two cards come out together</td><td>Use a gate with a smaller gap (1.0, then 0.9).</td></tr>
  <tr><td>The card stops under the gate</td><td>Use gate 1.2.</td></tr>
  <tr><td>The hopper moves, or the gate lifts</td><td>Check that all four of the hopper’s fingers clicked under the rails, and both of the gate’s arms under the steps on the pillars.</td></tr>
  <tr><td>The carriage is stiff in its rails</td><td>Try <code>test_fit</code> with a larger <code>fit</code>, then print the channel floor and the carriage again.</td></tr>
  <tr><td>A channel post won’t go into the chassis, or comes out by itself</td><td>Make <code>chan_peg_d</code> 0.1 mm smaller (too tight) or larger (too loose), then print plate 10 again.</td></tr>
  <tr><td>A post’s split head won’t go through the floor, breaks, or doesn’t hold the floor down</td><td>Make <code>snap_barb_d</code> 0.2 mm smaller (won’t go through, breaks) or larger (doesn’t hold), then print plate 10 again.</td></tr>
  <tr><td>The lever or the turret has play on its horn</td><td>Lower <code>horn_fit</code> (to 0.15, say) and print the lever and the turret again.</td></tr>
  <tr><td>The lever swings outwards and jams</td><td>The servo turns the other way: its rest is 180° (see “Preparing the servos”).</td></tr>
  <tr><td>The turret isn’t in line with the channel</td><td>Correct its rest angle in the calibration; if it is far off, move the horn by one spline.</td></tr>
  <tr><td>A servo doesn’t move</td><td>Check the wire from the batteries’ − to the Pi’s GND (pin 34), the signal pin (32 or 33) and the batteries.</td></tr>
  <tr><td>A servo shakes, or the Pi resets</td><td>Power the servos from the batteries or their own supply of at least 3 A, never from the Pi’s 5 V. Weak batteries make the servos shake: charge them. If a servo twitches while it holds still and the script printed
a note about the hardware PWM, turn it on (see “Preparing the servos”).</td></tr>
  <tr><td>The ATM tips over when the phone is touched</td><td>Tape the feet to the counter, or put a weight behind the hopper.</td></tr>
</table>
''',
)

ITALIAN = dict(
    file='nearcash-atm-assembly-it.pdf',
    lang='it',
    colours={'black': 'nero', 'green': 'verde', 'green and black': 'verde e nero', 'white': 'bianco'},
    plate='piatto',
    parts={
        'chassis': 'Telaio', 'servo_clamp': 'Piastrina sotto un’aletta del servo',
        'legs_front': 'Gambe davanti (i pali alti)', 'legs_back': 'Gambe dietro (i pali corti)', 'lever': 'Leva', 'carriage': 'Carrello',
        'channel_post': 'Palo del canale', 'channel_floor': 'Pavimento del canale', 'hopper': 'Tramoggia', 'gate_1_1': 'Paratia (luce 1,1 mm)',
        'turret': 'Torretta', 'turret_strap': 'Fascetta del lettore', 'face': 'Faccia (il sorriso)', 'phone_shelf': 'Mensola del telefono',
        'phone_back': 'Schienale del telefono', 'test_fit': 'Pezzo di prova degli incastri', 'test_reader': 'Pezzo di prova del lettore', 'test_horn': 'Prova della tasca della squadretta',
        'dummy_reader': 'Lettore finto (finché non arriva l’ACR39U)', 'dummy_reader_lid': 'Coperchio del lettore finto',
    },
    frames=[
        'Pronto: le carte vergini aspettano nella tramoggia; la fessura del lettore è rivolta verso di loro.',
        'Il pusher, sotto il pavimento, prende solo la carta più in basso e la spinge sotto la paratia.',
        'La carta entra fino in fondo nel lettore: il Raspberry Pi emette la banconota.',
        'Il pusher torna a casa. La carta resta nel lettore, con l’estremità che sporge.',
        'La torretta gira, portando con sé il lettore con la carta dentro.',
        'A 180° la banconota sporge dal sorriso: il cliente la sfila.',
    ],
    measures=[
        ('card_insert_depth', 'Infila una carta fino in fondo nel lettore e misura quanto sporge: la profondità è 85,6 meno quel valore.', '60 mm'),
        ('reader_slot_bottom', 'Con il lettore appoggiato sul tavolo e una carta dentro: l’altezza della faccia inferiore della carta dal tavolo.', '6 mm'),
        ('reader_w, reader_l, reader_h', 'Il lettore: larghezza, lunghezza (dalla fessura al cavo) e altezza. La sua sede sulla torretta lascia 0,3 mm di gioco.', '69 · 72,2 · 14,5 mm'),
        ('horn_span, horn_arm, horn_arm_tip, horn_t, horn_boss_d', 'La squadretta a croce (bracci rastremati): da punta a punta, larghezza del braccio a 8 mm dal centro e in punta, spessore, centro tra gli angoli.', '36 · 7,9 · 4,7 · 3,6 · 14,8 mm'),
        ('horn_gap', 'Con la squadretta montata: dalla cima della cassa del servo al lato inferiore dei bracci.', '2,3 mm'),
        ('servo_tab_top', 'Dal fondo del servo alla faccia superiore delle alette di fissaggio.', '29 mm'),
        ('phone_width, phone_thickness, phone_height', 'Il telefono (con la custodia, se ce l’ha).', '71,9 · 8,75 · 150 mm'),
    ],
    steps=[
        dict(title='I servo nel telaio (visto da sotto)', items=[
            'Capovolgi il telaio.',
            'Infila ogni servo dal basso nel suo foro, con l’albero in alto. L’albero va all’estremità del foro '
            '<b>più vicina alla linea centrale dell’ATM</b> (a sinistra, guardandolo da davanti); il corpo del servo si allunga verso destra. '
            'Il servo davanti muove la torretta, quello al centro la leva.',
            'Spingilo finché le alette toccano il telaio (il servo al centro appoggia su due distanziali).',
            'Appoggia una piastrina (<code>servo_clamp</code>) su ogni aletta e avvita il servo: quattro viti della bustina del '
            'servo, attraverso la piastrina e l’asola dell’aletta, nei fori del telaio. Si fanno da sole la filettatura: stringile '
            'finché l’aletta è ferma, non di più.',
            'Lascia liberi i cavi dei servo: vanno alla breadboard e al Pi.',
        ], note='Le piastrine servono perché le asole delle alette sono larghe come i gommini per cui sono fatte: la testa '
                'di una vite potrebbe passarci attraverso. Gommini e boccole in ottone non servono.'),
        dict(title='Le gambe', items=[
            'Gambe dietro (<code>legs_back</code>): premi i due pioli nei fori sotto il telaio, dietro, con la base rivolta all’indietro.',
            'Gambe davanti (<code>legs_front</code>): infila dal basso i due pali alti nei manicotti davanti, con la base rivolta in avanti '
            '(anche i fori per i perni della faccia guardano avanti), finché i manicotti appoggiano sui collari.',
            'Raddrizza il telaio: ora sta in piedi sulle basi delle due gambe (il servo al centro resta 22 mm sopra il tavolo).',
        ], note=None),
        dict(title='La leva', items=[
            'Manda il servo al centro a riposo e lascialo in tenuta: <code>pnpm atm:servos 13 0</code> (o <code>13 180</code>, vedi “Preparare i servo”).',
            'Premi la leva sulla squadretta del servo al centro, con il perno in alto e il braccio rivolto verso il retro.',
            'Prova il verso: andando dal riposo all’altra estremità della corsa, la leva deve girare in senso antiorario '
            'visto dall’alto, verso il centro dell’ATM, e finire rivolta in avanti. Poi rimandala a riposo.',
        ], note=None),
        dict(title='Il canale', items=[
            'Infila il carrello nelle guide sotto il pavimento del canale <b>dal davanti</b> (il lato verso la torretta), '
            'con il dito in alto nella fessura e rivolto in avanti: la fessura è aperta solo da quel lato. Deve scorrere libero per tutta la lunghezza.',
            'Spingi i quattro pali del canale (<code>channel_post</code>) nei fori sopra il telaio, con il piolo ad alette in basso: '
            'spingi deciso, le alette fanno presa nel foro.',
            'Appoggia sopra il pavimento, guidando il perno della leva nella fessura sotto il carrello, e premilo su ogni palo '
            'finché la testa divisa scatta sopra il pavimento. Per toglierlo, stringi le due metà di ogni testa.',
            'Prova: porta il pusher all’altra estremità a passi di 45°, e ritorno. Il carrello deve seguirlo senza impuntarsi.',
        ], note='Il PETG fa fili: prima di infilare il carrello, togli dalle guide ogni filo di filamento con un cutter. Un po’ di lubrificante secco al PTFE sulle guide aiuta: la leva spinge il carrello fuori dal suo asse, e troppo attrito '
                'potrebbe bloccarlo nelle guide, come un cassetto tirato per un angolo.'),
        dict(title='La tramoggia e la paratia', items=[
            'Premi la tramoggia sul pavimento: i quattro pioli nei fori, le pareti esterne lungo i fianchi del pavimento, subito dietro i cuscinetti davanti, finché le quattro linguette scattano sotto le guide.',
            'Fai scendere la paratia nelle scanalature dei montanti davanti della tramoggia, con il numero inciso verso la tramoggia (verso il retro), finché i due braccetti scattano sotto i gradini dei montanti.',
            'Prova con 2–3 carte: porta il pusher lentamente all’altra estremità, e ritorno. Deve uscire una carta sola.',
        ], note='Se escono due carte, usa la paratia 1.0, poi la 0.9; se la carta si ferma sotto la paratia, usa la 1.2 (sono sul piatto 2). '
                'Per cambiare la paratia, allarga i due braccetti e sfilala tirandola per la presa in alto. Per togliere la tramoggia, sgancia le linguette da sotto le guide, un lato alla volta.'),
        dict(title='La torretta e il lettore', items=[
            'Manda il servo davanti a 0° e lascialo in tenuta: <code>pnpm atm:servos 12 0</code>.',
            'Appoggia l’ACR39U nella torretta, con la fessura verso la tramoggia e il cavo verso il davanti.',
            'Aggancia sopra la fascetta del lettore (<code>turret_strap</code>): allarga un poco le gambe, i ganci vanno sotto la torretta.',
            'Premi la torretta sulla squadretta del servo davanti, con la fessura del lettore verso la tramoggia.',
            'Lascia al cavo USB un’ansa abbondante: la torretta fa mezzo giro.',
            'Prova: 0° → 180° → 0° a passi di 30°, guardando il cavo. Niente deve toccare, e il cavo deve seguire libero.',
        ], note=None),
        dict(title='La faccia', items=[
            'Spingi i due perni della faccia nei fori dei pali alti.',
        ], note=None),
        dict(title='Il telefono', items=[
            'Premi la mensola sulla cima dei pali alti (passa sopra la torretta).',
            'Infila le due guide dello schienale nelle prese della mensola.',
            'Metti la spina ad angolo retto nella sua tasca e fai uscire il cavo lungo il suo canale, verso destra. La testa della spina ha circa 4,4 mm sotto il telefono: controlla la tua.',
            'Appoggia il telefono nella scanalatura, contro lo schienale.',
        ], note='Il telefono sta in alto: una spinta forte in cima può ribaltare l’ATM. '
                'Fissa i quattro piedi al banco con nastro biadesivo, o metti un peso sul telaio dietro la tramoggia.'),
        dict(title='Le carte', items=[
            'Carica le carte vergini (fino a circa 12) con l’estremità del chip verso la paratia: quella entra per prima nel lettore.',
            'Il chip va rivolto come lo vuole il lettore: prova prima una carta a mano.',
        ], note='Tieni le dita fuori dal sorriso mentre la torretta gira.'),
    ],
    body='''
<div class="cover">
  <div class="kicker">NearCash · l’ATM stampato in 3D</div>
  <h1>Istruzioni di montaggio</h1>
  <p class="lead">Dai pezzi stampati alla prima banconota: cosa serve, cosa misurare, come preparare i servo, come
  montare l’ATM in nove passi e come tararlo.</p>
  <img src="{images}/atm-front.png">
  <ol class="toc">
    <li>Come funziona</li><li>Cosa serve</li><li>Prima di stampare tutto</li><li>Preparare i servo</li>
    <li>Montaggio, in nove passi</li><li>Movimenti e taratura</li><li>Se qualcosa non va</li>
  </ol>
  <p class="meta">Generato da <code>hardware/atm/nearcash-atm.scad</code> con <code>make-instructions.py</code>.
  Le immagini sono il modello stesso: se cambi una misura, rigenera questo PDF.</p>
</div>

<h2 class="break">1 · Come funziona</h2>
<p>Le carte vergini aspettano nella tramoggia. Quando una vendita è pagata, un carrello sotto il pavimento del canale,
mosso da una leva su un servo, prende la carta più in basso con un dito alto 0,6 mm (meno di una carta: non ne prende
mai due), la spinge sotto la paratia e fino in fondo nel lettore. Il Raspberry Pi trasforma la carta in banconota
attraverso il lettore. Il carrello torna indietro, la torretta gira di 180° portando con sé il lettore, e la banconota
sporge dal sorriso: il cliente la sfila dal lettore, come a un bancomat. Quando il lettore non sente più la carta, la
torretta torna indietro.</p>
{frames}
<p>L’ATM non estrae mai la carta da solo: l’ACR39U è un lettore a contatto con la fessura a tasca, e i pezzi stampati
non hanno abbastanza presa per tirarla fuori. Se una carta non passa il controllo, la torretta non gira: la carta resta
nel lettore e l’ATM va fuori servizio finché l’operatore non la toglie.</p>

<h2 class="break">2 · Cosa serve</h2>
<table>
  <tr><th>Componente</th><th>Dettagli</th></tr>
  <tr><td>Lettore di carte</td><td>ACS ACR39U-U1 (a contatto, USB)</td></tr>
  <tr><td>Servo</td><td>2 × MG996R (180°), con le loro squadrette a croce, le viti delle squadrette e le viti di fissaggio (4 per servo, nella bustina)</td></tr>
  <tr><td>Alimentazione dei servo</td><td>4 pile AA in un portapile (ricaricabili NiMH: 4,8 V), o un alimentatore da 5 V e almeno 3 A. Alimenta solo i servo, mai attraverso il Pi</td></tr>
  <tr><td>Collegamenti</td><td>Una piccola breadboard, 4 cavetti maschio–maschio e 3 maschio–femmina: i segnali dei servo vanno direttamente ai pin del Pi, senza schede driver</td></tr>
  <tr><td>Controller</td><td>Raspberry Pi 4 o 5 con Raspberry Pi OS a 64 bit e il suo alimentatore; sta accanto all’ATM</td></tr>
  <tr><td>Carte</td><td>NXP J3R180 vergini (85,6 × 54 × 0,76 mm), con l’applet già installato</td></tr>
  <tr><td>Schermo</td><td>Un iPhone 17 Pro senza custodia e un cavo con la spina ad angolo retto</td></tr>
  <tr><td>Filamento</td><td>PETG Basic, circa 223 g con i pezzi di prova: 106 g verde, 117 g nero</td></tr>
  <tr><td>Attrezzi</td><td>Cacciavite a croce piccolo (viti dei servo e delle squadrette), calibro, nastro biadesivo, cutter o carta abrasiva fine per le sbavature</td></tr>
</table>
<p>Niente colla e niente metallo nella struttura: i pezzi si incastrano con pioli e guide. Le sole viti sono quelle dei
servo: quattro fissano ogni servo al telaio, una ogni squadretta.</p>
<h3 class="sub">I pezzi stampati</h3>
<div class="parts">{parts}</div>
<p class="after-parts"><code>gate_0_9</code>, <code>gate_1_0</code> e <code>gate_1_2</code> sono paratie di ricambio con altre
luci (il numero è inciso sul lato della tramoggia), sul piatto 2: stampale solo se la 1.1 non va.</p>

<h2 class="break">3 · Prima di stampare tutto</h2>
<p>Il modello è parametrico: tutto segue i valori in cima a <code>nearcash-atm.scad</code>, e quelli predefiniti sono
stime. Misura il tuo hardware con il calibro. Conta soprattutto <code>card_insert_depth</code>: la parte della carta che
sporge dal lettore gira con la torretta, e canale, tramoggia e sorriso stanno attorno a quel cerchio con 4 mm di margine.</p>
<table><tr><th>Valore</th><th>Come misurarlo</th><th>Predefinito</th></tr>{measures}</table>
<p>Controlla anche che i servo abbiano le misure degli MG996R previsti: corpo di 40,7 × 19,7 mm, 54,5 mm da un’aletta all’altra.</p>
<p>Poi stampa i <b>piatti 1 e 4</b> (circa 20 minuti) e prova i tre pezzi di prova:</p>
<ul>
  <li><b><code>test_reader</code></b>: appoggia il lettore sul tavolo, accosta il pezzo alla fessura e fai scorrere una
  carta sulle sue guide. Deve entrare nella fessura senza urtarne il bordo e senza sollevarsi; se no, correggi
  <code>reader_slot_bottom</code>.</li>
  <li><b><code>test_horn</code></b> (piatto 4): premi la squadretta del servo nella tasca a croce: stretta, senza gioco,
  perché è solo quell’incastro a tenere la torretta sul suo servo. Se è troppo stretta o larga, cambia <code>horn_fit</code>.</li>
  <li><b><code>test_fit</code></b>: spingi il piolo nel suo foro (deciso); fai scorrere la fetta di carrello nel tratto di
  guida (libera, senza ballare). Se un incastro è troppo stretto o largo, cambia <code>fit</code> (le parti che scorrono)
  o <code>press</code> (i pioli).</li>
</ul>
<p>Se hai cambiato un valore, rigenera tutto e ricontrolla:</p>
<pre>hardware/atm/export.sh                     # STL e immagini
hardware/atm/check-clearances.sh           # niente si tocca, in nessuna posizione
python3 hardware/atm/make-3mf.py           # il progetto Bambu Studio
python3 hardware/atm/make-instructions.py  # queste istruzioni</pre>
<p>Poi apri <code>nearcash-atm.3mf</code> in Bambu Studio e stampa i <b>piatti 3 e dal 5 al 14</b> (circa 6 ore e mezza in tutto):
ogni pezzo è già sul suo piatto, nel suo colore, con le impostazioni giuste. Nessun pezzo ha bisogno di supporti. Il
pavimento del canale si stampa capovolto, con la faccia su cui scorrono le carte sul piatto: il piatto liscio è il migliore
(con la colla stick: il PETG si attacca troppo al PEI liscio nudo), va bene anche quello ruvido.</p>
<p>Il piatto 14, la faccia, è l’unico a due colori: le labbra intorno al sorriso e il nome e il logo NearCash sono
neri, a filo sul davanti, che si stampa contro il piatto. La AMS porta i due colori allo stesso ugello e li cambia solo nei primi tre strati, con una
piccola torre di spurgo (qualche minuto e circa 2 g in più). Il progetto li assegna già tutti e due a quell’ugello.</p>
<p>Il lettore non è ancora arrivato? Il <b>piatto 15</b> (circa 50 minuti, in bianco) è un lettore finto per provare la
meccanica: ha l’esterno del lettore, quindi entra nella torretta sotto la fascetta, e la sua fessura, alta e profonda uguale.
La carta scivola dentro dalla mensola della torretta, si ferma dove si fermerebbe nel lettore, e due molle ai lati della
fessura la tengono mentre la torretta gira, come fanno i contatti del lettore. Il coperchio si incastra sulla base con i
pioli. Non legge niente: fai girare solo i movimenti (<code>cycle.py</code>), oppure una vendita intera con
<code>pnpm atm:demo --dummy-reader</code>, che a pagamento avvenuto consegna la carta vuota. Se la carta esce troppo
facilmente o è troppo dura da sfilare, cambia <code>dummy_grip</code>.</p>

<h2 class="break">4 · Preparare i servo</h2>
<p>Le squadrette vanno montate con i servo in posizione di riposo, quindi collega i servo prima del montaggio. Vanno
direttamente al Pi: il segnale arriva da due suoi pin, la corrente dalle pile.</p>
<table>
  <tr><th>Filo del servo</th><th>Torretta (il servo davanti)</th><th>Pusher (il servo al centro, con la leva)</th></tr>
  <tr><td>Arancione (segnale)</td><td>GPIO 12 (pin 32)</td><td>GPIO 13 (pin 33)</td></tr>
  <tr><td>Rosso (+)</td><td>il + delle pile</td><td>il + delle pile</td></tr>
  <tr><td>Marrone (−)</td><td>il − delle pile</td><td>il − delle pile</td></tr>
</table>
<p class="note warn">Il − delle pile va anche a un pin GND del Pi (pin 34): senza questo filo i servo non capiscono il
segnale. Il + delle pile non deve mai toccare un pin del Pi, e i servo non prendono mai corrente dai 5 V del Pi.</p>
<p>I pin si contano dal pin 1, l’angolo del connettore a 40 pin lontano dalle porte USB. I pin 32 e 34 sono sulla fila
lungo il bordo della scheda, il pin 33 sulla fila interna, di fronte al 34. Sulla breadboard le pile vanno sulle due
linee di alimentazione, i fili rosso e marrone di ogni servo ci arrivano con cavetti maschio–maschio, e i fili arancioni
e il − della linea vanno al Pi con cavetti maschio–femmina. Un condensatore da 470–1000 µF (almeno 10 V) tra le due
linee è facoltativo: smorza il calo di tensione quando i servo partono.</p>
<p>Sul Pi, una volta sola: dai i pin 12 e 13 al PWM hardware del Pi, che genera impulsi stabili, poi riavvia
(<code>pnpm atm:demo</code> aggiunge la stessa riga quando prepara il Pi). La presa audio da 3,5 mm usa lo stesso PWM:
mentre i servo lavorano non deve suonare niente.</p>
<pre>printf '[all]\\ndtoverlay=pwm-2chan,pin=12,func=4,pin2=13,func2=4\\n' | sudo tee -a /boot/firmware/config.txt
sudo reboot</pre>
<p>Poi, dal repository sul Pi:</p>
<pre>pnpm atm:servos                     # tutti e due a riposo (0°): prima il pusher, poi la torretta; fino a Invio
pnpm atm:servos --pusher-reversed   # lo stesso, per un pusher che ha il riposo a 180°
pnpm atm:servos 13 90               # un servo a un angolo: GPIO 12 è la torretta, 13 il pusher</pre>
<p>Lo script è <code>hardware/atm/servo.py</code>. Con il PWM hardware i servo stanno fermi; senza, lo script lo dice
e genera gli impulsi via software (gpiozero): i servo danno dei colpetti e perdono i passi piccoli. Ogni movimento è
calmo, da dove il servo era rimasto: gli script lo annotano sul Pi (<code>~/.nearcash-atm-servos.json</code>), perché
un servo non sa dov’è. Quando finisce, i servo restano liberi dove sono.</p>
<p><b>Il verso del pusher.</b> Lancia <code>pnpm atm:servos 13 0</code>, poi <code>pnpm atm:servos 13 90</code>, e
guarda l’albero dall’alto. Se
l’albero gira in senso antiorario, la sua posizione di riposo è 0°. Se gira in senso orario, la posizione di riposo è
180°: annotalo, perché il software dovrà invertire questo servo (angolo → 180° − angolo). Per la torretta il verso non
conta: il suo riposo è 0°.</p>
<p><b>Le squadrette.</b> Con ogni servo a riposo, tenuto lì da <code>pnpm atm:servos</code>, monta la sua squadretta a croce con la vite, con i bracci allineati il
più possibile al corpo del servo (uno lungo il corpo, uno di traverso). La dentatura permette solo alcune posizioni:
scegli la più vicina, il piccolo errore si corregge nella taratura. La testa della vite non deve sporgere dalla squadretta più di 1,5 mm: sopra ci sono il lettore e il carrello.</p>
<p class="note">Dopo aver montato le squadrette non girare gli alberi a mano. Se si sono mossi, rimanda il servo a riposo
prima dei passi 3 e 6, quando premi la leva e la torretta.</p>

<h2 class="break">5 · Montaggio, in nove passi</h2>
<p>In ogni immagine, i pezzi montati nei passi precedenti sono grigi e quelli nuovi del passo sono nel loro colore.
I servo sono blu, il lettore e il telefono scuri.</p>
{steps}

<h2 class="break">6 · Movimenti e taratura</h2>
<p>Con il lettore collegato al Pi via USB, <code>pnpm atm:reader</code> elenca i lettori e controlla la carta che c’è
dentro. Il server dell’ATM per ora non muove i servo (il suo distributore è simulato): questa è la sequenza che dovrà
eseguire, con il PWM hardware del Pi sugli stessi due pin, e che puoi provare a mano con <code>pnpm atm:servos PIN ANGOLO</code>.</p>
<table>
  <tr><th>Fase</th><th>Torretta (GPIO 12)</th><th>Pusher (GPIO 13)</th><th>Aspetta</th></tr>
  <tr><td>Riposo</td><td>0° (fessura verso la tramoggia)</td><td>riposo (a casa)</td><td>una vendita pagata</td></tr>
  <tr><td>Carica</td><td>0°</td><td>riposo → altra estremità, lentamente</td><td>il lettore: carta presente</td></tr>
  <tr><td>Ritorno</td><td>0°</td><td>altra estremità → riposo</td><td></td></tr>
  <tr><td>Emissione</td><td>0°</td><td>riposo</td><td>la banconota emessa e controllata</td></tr>
  <tr><td>Consegna</td><td>0° → 180°</td><td>riposo</td><td>il lettore: carta tolta</td></tr>
  <tr><td>Pronto</td><td>180° → 0°</td><td>riposo</td><td></td></tr>
</table>
<p class="note warn">Il pusher deve essere a casa prima che la torretta giri: a fine corsa il suo dito è dentro il
cerchio che la banconota percorre.</p>
<p><b>Taratura.</b> Trova l’angolo giusto alle due estremità di ogni servo, a piccoli passi:</p>
<ul>
  <li>Torretta, angolo di carico: la fessura del lettore in squadra con il canale, così la carta entra dritta. Le
  scanalature della squadretta lasciano la torretta storta di qualche grado a 0°: lancia <code>pnpm atm:servos 12 0</code> e
  scrivi <code>+1</code> (e Invio) finché la fessura è di fronte al canale; l’angolo a cui arrivi è <code>--turret-in</code>.
  Se la fessura si allinea solo sotto 0°, rimonta la squadretta spostata di un dente dall’altra parte e riprova.</li>
  <li>Torretta, angolo di consegna: la banconota esce dritta dal sorriso, trovato allo stesso modo partendo da 180
  (<code>--turret-out</code>). Il servo gira al massimo di 180°, quindi con un angolo di carico sopra 0° la torretta fa un
  po’ meno di mezzo giro: fino a 10° di storto la banconota passa ancora dal sorriso.</li>
  <li>Pusher a fine corsa: la carta entra fino in fondo nel lettore senza spingere contro il suo fermo. Parti da 20°
  prima della fine e avanza di 5° alla volta.</li>
</ul>
<p><b>Il ciclo intero.</b> Per provare la meccanica, <code>pnpm atm:cycle</code> esegue questa sequenza sui servo, con
delle pause al posto del lettore e dell’emissione: una carta entra nel lettore, il pusher torna a casa, la torretta
gira, sfili la banconota dal sorriso (hai 8 secondi) e la torretta torna indietro. Prima metti il lettore nella torretta, con la fascetta (senza, la carta non ha una fessura in cui entrare e la torretta non la porta con sé), e qualche carta vergine nella tramoggia.
All’inizio porta i servo a riposo, con calma da dove erano rimasti, e ogni ciclo finisce a riposo: il pusher a
casa, la torretta all’angolo di carico, sempre prima il pusher. Ctrl+C lo ferma e li riporta a riposo; un secondo
Ctrl+C li lascia subito liberi dove sono, per liberare a mano una carta incastrata.</p>
<pre>pnpm atm:cycle --dry-run                       # scrive i passi, non muove niente
pnpm atm:cycle --stroke 160                    # un ciclo, il pusher 20° prima della fine
pnpm atm:cycle --stroke 175 --cycles 10        # dieci di fila, quando la corsa è giusta
pnpm atm:cycle --pusher-reversed               # per un pusher che ha il riposo a 180°</pre>
<p>Gli angoli trovati nella taratura si passano con <code class="nowrap">--stroke</code>, <code class="nowrap">--turret-in</code> e
<code class="nowrap">--turret-out</code> (di base 180, 0 e 180); <code class="nowrap">--issue-seconds</code> e <code class="nowrap">--take-seconds</code>
cambiano le pause. Lo script è <code>hardware/atm/cycle.py</code>.</p>

<h2 class="break">7 · Se qualcosa non va</h2>
<table>
  <tr><th>Cosa succede</th><th>Cosa fare</th></tr>
  <tr><td>La carta urta il bordo della fessura del lettore</td><td>Correggi <code>reader_slot_bottom</code> con <code>test_reader</code> e ristampa la torretta.</td></tr>
  <tr><td>Escono due carte insieme</td><td>Usa una paratia con la luce più piccola (1.0, poi 0.9).</td></tr>
  <tr><td>La carta si ferma sotto la paratia</td><td>Usa la paratia 1.2.</td></tr>
  <tr><td>La tramoggia si muove, o la paratia si alza</td><td>Controlla che tutte e quattro le linguette della tramoggia siano scattate sotto le guide, e i due braccetti della paratia sotto i gradini dei montanti.</td></tr>
  <tr><td>Il carrello è duro nelle guide</td><td>Prova <code>test_fit</code> con un <code>fit</code> più grande, poi ristampa il pavimento del canale e il carrello.</td></tr>
  <tr><td>Un palo del canale non entra nel telaio, o esce da solo</td><td>Rendi <code>chan_peg_d</code> più piccolo (troppo duro) o più grande (troppo lento) di 0,1 mm, poi ristampa il piatto 10.</td></tr>
  <tr><td>La testa divisa di un palo non passa nel pavimento, si rompe, o non lo tiene giù</td><td>Rendi <code>snap_barb_d</code> più piccolo (non passa, si rompe) o più grande (non tiene) di 0,2 mm, poi ristampa il piatto 10.</td></tr>
  <tr><td>La leva o la torretta hanno gioco sulla squadretta</td><td>Riduci <code>horn_fit</code> (per esempio a 0,15) e ristampa la leva e la torretta.</td></tr>
  <tr><td>La leva gira verso l’esterno e si impunta</td><td>Il servo gira al contrario: il suo riposo è 180° (vedi “Preparare i servo”).</td></tr>
  <tr><td>La torretta non è allineata al canale</td><td>Correggi il suo angolo di riposo nella taratura; se l’errore è grande, sposta la squadretta di un dente.</td></tr>
  <tr><td>Un servo non si muove</td><td>Controlla il filo dal − delle pile al GND del Pi (pin 34), il pin del segnale (32 o 33) e le pile.</td></tr>
  <tr><td>Un servo trema, o il Pi si riavvia</td><td>Alimenta i servo dalle pile o da un alimentatore a parte da almeno 3 A, mai dai 5 V del Pi. Le pile scariche fanno tremare i servo: ricaricale. Se un servo dà dei colpetti mentre sta fermo e lo script ha
scritto la nota sul PWM hardware, accendilo (vedi “Preparare i servo”).</td></tr>
  <tr><td>L’ATM si ribalta quando si tocca il telefono</td><td>Fissa i piedi al banco con nastro biadesivo, o metti un peso dietro la tramoggia.</td></tr>
</table>
''',
)

# ------------------------------------------------------------------ the page's look (both languages)

STYLE = '''
  @page { size: A4; margin: 14mm 15mm 15mm; }
  :root { --green: #00b877; --ink: #17181a; --soft: #5b6066; --line: #e3e5e8; --tint: #effaf5; }
  * { box-sizing: border-box; }
  body { font-family: Inter, -apple-system, "Helvetica Neue", Arial, sans-serif; color: var(--ink);
         font-size: 9.6pt; line-height: 1.45; margin: 0; background: white; }
  h1 { font-size: 30pt; line-height: 1.1; margin: 0 0 6pt; letter-spacing: -0.02em; }
  h2 { font-size: 16pt; margin: 0 0 8pt; padding-top: 3pt; border-top: 3pt solid var(--green); }
  h3 { font-size: 12pt; margin: 0; }
  h3.sub { margin: 5mm 0 3mm; }
  p { margin: 0 0 7pt; }
  ul { margin: 0 0 8pt; padding-left: 15pt; }
  li { margin-bottom: 2.5pt; }
  code { font-family: "SF Mono", Menlo, monospace; font-size: 8.3pt; background: #f2f3f5; padding: 0 3pt; border-radius: 3pt; }
  pre { font-family: "SF Mono", Menlo, monospace; font-size: 8pt; background: #f2f3f5; padding: 7pt 9pt;
        border-radius: 5pt; white-space: pre-wrap; margin: 0 0 8pt; break-inside: avoid; }
  table { border-collapse: collapse; width: 100%; margin: 0 0 9pt; break-inside: avoid; }
  th, td { text-align: left; vertical-align: top; padding: 3.5pt 6pt; border-bottom: 0.6pt solid var(--line); }
  th { font-size: 8pt; color: var(--soft); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  .nowrap { white-space: nowrap; }
  .break { break-before: page; }
  .cover { height: 262mm; display: flex; flex-direction: column; }
  .cover .kicker { color: var(--green); font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; font-size: 9pt; }
  .cover .lead { font-size: 12pt; color: var(--soft); max-width: 150mm; }
  .cover img { width: 100%; max-height: 125mm; object-fit: contain; margin: 10mm 0 8mm; }
  .cover .meta { margin-top: auto; color: var(--soft); font-size: 8.5pt; }
  .toc { columns: 2; column-gap: 10mm; padding-left: 14pt; margin: 0; font-size: 10.5pt; }
  .frames { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 5pt; margin: 4pt 0 10pt; }
  .frame { border: 0.6pt solid var(--line); border-radius: 6pt; padding: 4pt; break-inside: avoid; }
  .frame img { width: 100%; display: block; }
  .frame p { font-size: 8pt; margin: 3pt 2pt 1pt; }
  .frame b { color: var(--green); }
  .parts { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6pt; }
  .part { border: 0.6pt solid var(--line); border-radius: 6pt; padding: 6pt; break-inside: avoid; }
  .part img { display: block; width: 100%; height: 25mm; object-fit: contain; margin-bottom: 4pt; }
  .part b { display: block; font-size: 8.8pt; }
  .part span { display: block; color: var(--soft); font-size: 7.8pt; }
  .part code { font-size: 7.4pt; }
  .after-parts { margin-top: 6pt; }
  .step { display: grid; grid-template-columns: 57% 1fr; gap: 6mm; align-items: start;
          break-inside: avoid; padding: 0 0 6mm; margin: 0 0 6mm; border-bottom: 0.6pt solid var(--line); }
  .step img { display: block; width: 100%; max-height: 72mm; object-fit: contain; }
  .step-head { display: flex; align-items: center; gap: 7pt; margin-bottom: 5pt; }
  .badge { background: var(--green); color: white; font-weight: 700; width: 19pt; height: 19pt; border-radius: 50%;
           display: inline-flex; align-items: center; justify-content: center; font-size: 10.5pt; flex: none; }
  .step ol { margin: 0 0 5pt; padding-left: 14pt; }
  .note { background: var(--tint); border-left: 3pt solid var(--green); padding: 5pt 8pt; border-radius: 0 4pt 4pt 0;
          font-size: 8.6pt; break-inside: avoid; }
  .warn { background: #fff6e8; border-left-color: #e8930c; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; }
'''

# ------------------------------------------------------------------ rendering


def run(command):
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        sys.exit(f'{os.path.basename(command[0])} failed:\n{result.stderr[-2000:]}')


def drawn_box(image):
    """The box around what is drawn on a render's plain background."""
    background = Image.new('RGB', image.size, image.getpixel((0, 0)))
    return ImageChops.difference(image, background).getbbox()


def crop(path, box, margin):
    image = Image.open(path).convert('RGB')
    image.crop((max(0, box[0] - margin), max(0, box[1] - margin),
                min(image.width, box[2] + margin), min(image.height, box[3] + margin))).save(path)


def render(scad, out, size, camera, *options):
    run([OPENSCAD, '--backend=manifold', '-q', '--colorscheme=Tomorrow', f'--imgsize={size}',
         f'--camera={camera}', '--viewall', *options, '-o', out, scad])


def render_pictures(work):
    """Every picture the two documents use, into `work`."""
    for number, camera in enumerate(STEP_CAMERAS, start=1):
        out = os.path.join(work, f'step-{number}.png')
        render(os.path.join(HERE, 'assembly-steps.scad'), out, '1400,1050', camera, '-D', f'step={number}')
        crop(out, drawn_box(Image.open(out).convert('RGB')), 24)
    # The journey's frames share one crop, so that they line up.
    frames = [os.path.join(work, f'frame-{i}.png') for i in range(1, 7)]
    for out, state in zip(frames, FRAME_STATES):
        render(os.path.join(HERE, 'nearcash-atm.scad'), out, '1200,900', FRAME_CAMERA, '-D', 'show_phone=false', *state)
    boxes = [drawn_box(Image.open(f).convert('RGB')) for f in frames]
    union = (min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes))
    for f in frames:
        crop(f, union, 16)
    # A thumbnail of every part, lying as it prints, seen from above at an angle.
    for name, _, colour, _ in PARTS:
        # a part's main colour
        rgb = {'green': '[0.0, 0.8, 0.52]', 'white': '[0.9, 0.9, 0.9]'}.get(colour.split()[0], '[0.2, 0.2, 0.22]')
        scad = os.path.join(work, f'part-{name}.scad')
        with open(scad, 'w') as f:
            if name in INLAYS:
                # turned over about X (its print's bed side up, the name reading the right way): the inlay shows, in black
                f.write('rotate([180, 0, 0]) {\n'
                        f'  color({rgb}) import("{os.path.join(HERE, "stl", name + ".stl")}");\n'
                        f'  color([0.09, 0.09, 0.09]) import("{os.path.join(HERE, "stl", INLAYS[name] + ".stl")}");\n'
                        '}\n')
            else:
                f.write(f'color({rgb}) import("{os.path.join(HERE, "stl", name + ".stl")}");\n')
        out = os.path.join(work, f'part-{name}.png')
        render(scad, out, '600,450', '0,0,0,55,0,25,500', '--autocenter')
        crop(out, drawn_box(Image.open(out).convert('RGB')), 10)


def document(words):
    """One language's whole document, as an HTML page that Chrome prints on A4 sheets."""
    frames = ''.join(
        f'<div class="frame"><img src="frame-{i}.png"><p><b>{i}</b> {html.escape(text)}</p></div>'
        for i, text in enumerate(words['frames'], start=1))
    parts = ''.join(
        f'<div class="part"><img src="part-{name}.png"><b>{html.escape(words["parts"][name])}</b>'
        f'<span>{qty} × · {words["colours"][colour]} · {words["plate"]} {plate}</span><code>{name}</code></div>'
        for name, qty, colour, plate in PARTS)
    measures = ''.join(
        f'<tr><td><code>{html.escape(value)}</code></td><td>{html.escape(how)}</td><td class="nowrap">{default}</td></tr>'
        for value, how, default in words['measures'])
    steps = ''.join(
        f'''<section class="step">
              <img src="step-{i}.png">
              <div>
                <div class="step-head"><span class="badge">{i}</span><h3>{step["title"]}</h3></div>
                <ol>{"".join(f"<li>{item}</li>" for item in step["items"])}</ol>
                {f'<p class="note">{step["note"]}</p>' if step["note"] else ""}
              </div>
            </section>'''
        for i, step in enumerate(words['steps'], start=1))
    body = words['body'].format(
        images=os.path.join(HERE, 'images'), frames=f'<div class="frames">{frames}</div>', parts=parts,
        measures=measures, steps=steps)
    title = words['body'].split('<h1>')[1].split('</h1>')[0]
    return (f'<!doctype html><html lang="{words["lang"]}"><head><meta charset="utf-8">'
            f'<title>NearCash ATM: {title}</title><style>{STYLE}</style></head><body>{body}</body></html>')


def main():
    for tool in (OPENSCAD, CHROME):
        if not os.path.exists(tool):
            sys.exit(f'not found: {tool}')
    for name, *_ in PARTS:
        if not os.path.exists(os.path.join(HERE, 'stl', name + '.stl')):
            sys.exit(f'missing stl/{name}.stl: run hardware/atm/export.sh first')
    work = tempfile.mkdtemp()
    try:
        render_pictures(work)
        for words in (ENGLISH, ITALIAN):
            page = os.path.join(work, f'instructions-{words["lang"]}.html')
            with open(page, 'w') as f:
                f.write(document(words))
            out = os.path.join(HERE, words['file'])
            run([CHROME, '--headless=new', '--disable-gpu', '--no-pdf-header-footer',
                 f'--print-to-pdf={out}', 'file://' + page])
            print(f'wrote {os.path.relpath(out)}')
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    main()
