"""Builds nearcash-atm.3mf, the Bambu Studio project for the X2D: every part on
its plate, in its colour, with the print settings. Run it after export.sh:

    python3 hardware/atm/make-3mf.py            # writes hardware/atm/nearcash-atm.3mf
    python3 hardware/atm/make-3mf.py --slice    # also prints the estimated print time

It uses Bambu Studio's own command line (on macOS, the app in /Applications)
and its system profiles: Bambu Lab X2D 0.4 nozzle, 0.24mm Standard with 2
walls and 15 % infill, Bambu PETG Basic in NearCash green and in black.
"""
import json
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
STL = os.path.join(HERE, 'stl')
BAMBU = os.environ.get('BAMBU_STUDIO', '/Applications/BambuStudio.app/Contents/MacOS/BambuStudio')
PROFILES = os.environ.get('BAMBU_PROFILES', '/Applications/BambuStudio.app/Contents/Resources/profiles/BBL')

GREEN, BLACK = 1, 2   # filament slots
# The nozzle of each filament slot: both on nozzle 1, the one the AMS feeds (see PLATES).
FILAMENT_MAP = ['1', '1']
BED = (256, 256)
# The X2D's second nozzle can't reach the bed's first 20.5 mm in X (its profile's
# extruder_printable_area): a plate with two colours keeps its parts right of that.
FULL_X = (5, 254)
DUAL_NOZZLE_X = (22, 254)

# Each plate: its name, and its parts as (part, filament slot, assemble index,
# where each copy goes). Parts that share an assemble index above 0 become one
# object (a part with an inlay in another colour: the face and its black name and
# logo). A position is where the part's bounding box starts on the bed, in mm from
# the bed's corner (None: the same place as the part before, for an inlay).
# The AMS feeds only nozzle 1: every filament is mapped to it (FILAMENT_MAP below),
# and the AMS swaps them on the face's plate. Left to itself, Bambu Studio would put
# a two-colour plate's colours on two nozzles, and the printer couldn't map one.
PLATES = [
    ('Print first: test pieces', [
        ('test_fit', BLACK, 0, [(10, 10)]),
        ('test_reader', BLACK, 0, [(90, 10)]),
    ]),
    # Spare gates for the snap-on hopper of plate 11 (the 1.1 gate is on plate 12): print them only if the 1.1 gate
    # lets two cards through (then 1.0, 0.9) or stops the card (then 1.2).
    ('Spare, black: the other gates', [
        ('gate_0_9', BLACK, 0, [(90, 60)]),
        ('gate_1_0', BLACK, 0, [(90, 90)]),
        ('gate_1_2', BLACK, 0, [(90, 120)]),
    ]),
    ('Black: the lever and the reader\'s strap', [
        ('turret_strap', BLACK, 0, [(80, 40)]),
        ('lever', BLACK, 0, [(80, 70)]),
    ]),
    # The horn's pocket alone, to try the fit again (plate 1's test_fit has the same pocket).
    ('Test: the horn pocket', [
        ('test_horn', BLACK, 0, [(108, 108)]),
    ]),
    # The legs, as two pieces: the tall posts joined at the front, the short ones at the back.
    ('Green: the legs, front and back', [
        ('legs_front', GREEN, 0, [(37, 10)]),
        ('legs_back', GREEN, 0, [(71, 120)]),
    ]),
    # The plates under the servos' tabs (the servos are screwed on: no more straps).
    ('Black: the plates under the servos\' tabs', [
        ('servo_clamp', BLACK, 0, [(100, 100), (115, 100), (130, 100), (145, 100)]),
    ]),
    # The channel floor with freer rails, and the carriage with room for the horn's screw (any colour: it hides under the floor).
    ('Green: the channel floor and the carriage', [
        ('channel_floor', GREEN, 0, [(30, 60)]),
        ('carriage', GREEN, 0, [(140, 60)]),
    ]),
    # The chassis, with ribs under its bars (it bent on its legs) and holes for the servos' screws.
    ('Black: the chassis, stiffer', [
        ('chassis', BLACK, 0, [(5, 5)]),
    ]),
    # The phone holder for an iPhone 17 Pro: a deeper groove, a solid back that stops below the camera plateau.
    ('Black: the phone holder', [
        ('phone_shelf', BLACK, 0, [(40, 20)]),
        ('phone_back', BLACK, 0, [(80, 60)]),
    ]),
    # The four channel posts: a crush-rib peg into the chassis, a snap peg through the floor.
    ('Green: the channel posts, locking', [
        ('channel_post', GREEN, 0, [(110, 100 + 12 * i) for i in range(4)]),
    ]),
    # The hopper that snaps onto the channel floor, and its gate that snaps onto the hopper's pillars:
    # one colour per plate, so the AMS's single nozzle prints both.
    ('Green: the hopper, snap-on', [
        ('hopper', GREEN, 0, [(80, 80)]),
    ]),
    ('Black: the gate, snap-on', [
        ('gate_1_1', BLACK, 0, [(90, 120)]),
    ]),
    # The reader's holder (the turret), on a plate of its own, with its hub's middle open: the horn
    # pocket's ceiling prints as four short bridges, one across each arm (see hub_open_d).
    ('Green: the reader\'s holder (the turret), open hub', [
        ('turret', GREEN, 0, [(90, 89)]),
    ]),
    # The face, printed face down, with its black ink flush in its front: the lips round the
    # smile, and the NearCash name and logo in the chin. The black is in its first three layers
    # only (face_inlay_t), so the AMS swaps a few times.
    ('Green and black: the face, with black lips and the NearCash name and logo', [
        ('face', GREEN, 1, [(40, 10)]),
        ('face_brand', BLACK, 1, [None]),
    ]),
]


def stl_bounds(path):
    """The bounding box of an ASCII or binary STL: ((min x, y, z), (max x, y, z))."""
    import struct
    with open(path, 'rb') as f:
        data = f.read()
    points = []
    if data[:5] == b'solid' and b'facet' in data[:400]:
        for line in data.decode().splitlines():
            parts = line.split()
            if parts and parts[0] == 'vertex':
                points.append(tuple(float(c) for c in parts[1:4]))
    else:
        count = struct.unpack('<I', data[80:84])[0]
        for i in range(count):
            base = 84 + 50 * i + 12
            points += [struct.unpack('<3f', data[base + 12 * k: base + 12 * k + 12]) for k in range(3)]
    return tuple(min(p[i] for p in points) for i in range(3)), tuple(max(p[i] for p in points) for i in range(3))


def placements(parts, x_range):
    """The assemble-list objects of one plate, checked: on the bed, nothing overlapping."""
    objects, boxes, previous = [], [], None
    for part, slot, index, corners in parts:
        path = os.path.join(STL, part + '.stl')
        if not os.path.exists(path):
            sys.exit(f'missing {path}: run hardware/atm/export.sh first')
        lo, hi = stl_bounds(path)
        xs, ys = [], []
        for corner in corners:
            if corner is None:                  # same place as the part before (an inlay in its part)
                xs.append(previous[0]); ys.append(previous[1])
                continue
            x0, y0 = corner
            xs.append(x0 - lo[0]); ys.append(y0 - lo[1])
            box = (x0, y0, x0 + hi[0] - lo[0], y0 + hi[1] - lo[1])
            if box[0] < x_range[0] or box[1] < 5 or box[2] > x_range[1] or box[3] > BED[1] - 5:
                sys.exit(f'{part} at {corner} is off the bed: {box}')
            for other_part, other in boxes:
                if box[0] < other[2] + 2 and other[0] < box[2] + 2 and box[1] < other[3] + 2 and other[1] < box[3] + 2:
                    sys.exit(f'{part} at {corner} overlaps {other_part}')
            boxes.append((part, box))
        previous = (xs[-1], ys[-1])
        # One entry per copy: with "count" above 1 the CLI makes the copies but leaves them off the plate.
        for x, y in zip(xs, ys):
            objects.append({'path': path, 'count': 1, 'filaments': [slot], 'assemble_index': [index],
                            'pos_x': [x], 'pos_y': [y], 'pos_z': [-lo[2]]})
    return objects


def resolved(kind, name):
    """A system profile with its whole "inherits" chain merged in."""
    with open(os.path.join(PROFILES, kind, name + '.json')) as f:
        data = json.load(f)
    parent = data.get('inherits')
    merged = resolved(kind, parent) if parent else {}
    merged.update(data)
    return merged


def user_preset(kind, system_name, name, overrides, path, variants=None):
    """A preset that inherits a system profile (how the CLI accepts presets).
    `variants`: the printer's extruder variants. A filament's per-variant values
    come for all of them, but its variant list may name only the first one: then
    the X2D's second (Bowden) nozzle finds no settings, so the list is completed."""
    data = resolved(kind, system_name)
    if variants and len(data.get('filament_extruder_variant', [])) < len(variants) == len(data.get('nozzle_temperature', [])):
        data['filament_extruder_variant'] = variants
    data.update({'inherits': system_name, 'name': name, 'from': 'User', 'is_custom_defined': '0'})
    data.update(overrides)
    with open(path, 'w') as f:
        json.dump(data, f, indent=1)
    return path


def main():
    slice_it = '--slice' in sys.argv
    work = tempfile.mkdtemp()
    machine = user_preset('machine', 'Bambu Lab X2D 0.4 nozzle', 'NearCash X2D 0.4', {'printer_settings_id': 'NearCash X2D 0.4'}, f'{work}/machine.json')
    process = user_preset('process', '0.24mm Standard @BBL X2D', 'NearCash ATM 0.24mm',
                          {'print_settings_id': 'NearCash ATM 0.24mm', 'wall_loops': '2', 'sparse_infill_density': '15%',
                           # every filament on the nozzle the AMS feeds, whatever Bambu Studio would choose
                           'filament_map_mode': 'Manual', 'filament_map': FILAMENT_MAP,
                           # the prime tower of a two-colour plate (the face's): behind the parts, where both nozzles reach.
                           # Its position is a list with one value per plate: a plate without one gets
                           # the tower at the bed's edge, where the second nozzle can't reach.
                           'prime_tower_width': '35', 'wipe_tower_x': ['190'] * len(PLATES), 'wipe_tower_y': ['205'] * len(PLATES),
                           # PETG doesn't print on the Cool Plate: the textured PEI plate needs no glue
                           'curr_bed_type': 'Textured PEI Plate',
                           # travel moves go round holes and grooves instead of across them: fewer PETG strings inside
                           'reduce_crossing_wall': '1'},
                          f'{work}/process.json')
    variants = resolved('machine', 'Bambu Lab X2D 0.4 nozzle')['printer_extruder_variant']
    filaments = [
        user_preset('filament', 'Bambu PETG Basic @BBL X2D 0.4 nozzle', 'NearCash green PETG',
                    {'filament_settings_id': ['NearCash green PETG'], 'filament_colour': ['#00EC97']}, f'{work}/green.json', variants),
        user_preset('filament', 'Bambu PETG Basic @BBL X2D 0.4 nozzle', 'NearCash black PETG',
                    {'filament_settings_id': ['NearCash black PETG'], 'filament_colour': ['#161616']}, f'{work}/black.json', variants),
    ]

    assemble = {'plates': []}
    for plate_name, parts in PLATES:
        two_colours = len({slot for _, slot, _, _ in parts}) > 1
        objects = placements(parts, DUAL_NOZZLE_X if two_colours else FULL_X)
        # Each plate maps its filaments itself (the project's filament_map is not enough):
        # every filament on nozzle 1, the one the AMS feeds.
        plate_params = {'filament_map_mode': 'Manual', 'filament_maps': ' '.join(FILAMENT_MAP)}
        assemble['plates'].append({'plate_name': plate_name, 'need_arrange': False, 'plate_params': plate_params, 'objects': objects})
    assemble_path = f'{work}/assemble.json'
    with open(assemble_path, 'w') as f:
        json.dump(assemble, f, indent=1)

    # The project is written into --outputdir, under the name given to --export-3mf.
    out = os.path.join(HERE, 'nearcash-atm.3mf')
    command = [BAMBU, '--debug', '3', '--load-assemble-list', assemble_path,
               '--load-settings', f'{machine};{process}', '--load-filaments', ';'.join(filaments),
               '--outputdir', work, '--export-3mf', os.path.basename(out)]
    if slice_it:
        command[1:1] = ['--slice', '0']
    if os.path.exists(out):
        os.remove(out)
    # Bambu Studio's log (with --debug 3): the slicing results are in it.
    proc = subprocess.run(command, capture_output=True, text=True)
    log = proc.stdout + proc.stderr
    if os.path.exists(os.path.join(work, os.path.basename(out))):
        os.replace(os.path.join(work, os.path.basename(out)), out)
    # e.g. "plate_id=1 return_code=0, error_message=Success., ... pring_time_s=3794.77, filament_usage_g=32.6"
    # (older Bambu Studio versions put a comma after the plate id)
    results = re.findall(r'plate_id=(\d+),? return_code=(-?\d+), error_message=([^,]*),.*?pring_time_s=([\d.]+), filament_usage_g=([\d.]+)', log)
    errors = re.findall(r'\[error\]\s+(.*)', log)
    if not os.path.exists(out):
        sys.exit('Bambu Studio did not write the project:\n' + '\n'.join(errors[-5:]))
    print(f'wrote {os.path.relpath(out)}')
    total_s = total_g = 0
    for plate, code, message, seconds, grams in results:
        name = PLATES[int(plate)][0]
        print(f'  plate {int(plate) + 1}, {name}: {float(seconds) / 60:.0f} min, {float(grams):.0f} g ({message})')
        if not name.startswith(('Print first', 'Test', 'Spare')):   # the test pieces and the spares aren't part of the ATM
            total_s += float(seconds)
            total_g += float(grams)
    if results:
        print(f'  the ATM (without the test pieces and the spares): {total_s / 60:.0f} min, {total_g:.0f} g')


if __name__ == '__main__':
    main()
