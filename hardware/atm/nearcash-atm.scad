// NearCash ATM — the quick-print version: an open frame around the mechanism,
// about six hours of printing on a Bambu Lab X2D (PETG, two colours),
// with a shelf on top for the iPhone that is its screen.
//
//              face (the smile)
//                  │
//   ╭─ turret ─╮   │   card path          ┌ hopper ┐
//   │ ACR39U   ├◄──┼──────────────────────┤▁▁▁▁▁▁▁▁│  ← blank cards
//   ╰────┬─────╯   │   pusher (carriage under the floor, lever on a servo)
//      servo       │
//   ═════╧═════════╧════ chassis on little legs ═════════════
//
//   1. The pusher pushes the bottom blank card out of the hopper, under the
//      gate, into the reader on the turret (the reader's slot faces the hopper).
//   2. The Raspberry Pi issues the banknote through the reader.
//   3. The pusher goes back home (its finger slides under the next card).
//   4. The turret turns 180°: the banknote, still in the reader, sticks out of
//      the smile on the front. The customer pulls it out, as at a real ATM.
//   5. Once the reader reports the card gone, the turret turns back.
// The ACR39U is a contact reader with a pocket slot: a card can only leave it
// the way it came in, so the ATM hands the reader to the customer instead of
// trying to pull the card out with printed parts.
//
// Choose `part` (OpenSCAD's Customizer, or -D part="..." as export.sh does):
// each part comes out in its printing orientation, lying on the bed.
// `part = "assembly"` shows everything in place, the hardware as ghosts. The
// test_* parts are small pieces to print first, to check the fits and your
// measurements before printing the rest.
//
// Coordinates: the turret's axis is X = 0, Y = 0; +Y goes to the back (the
// hopper), −Y to the front (the customer); Z = 0 is the table.

/* [What to show] */
part = "assembly"; // [assembly, section, chassis, legs_front, legs_back, channel_post, phone_shelf, phone_back, channel_floor, hopper, gate_0_9, gate_1_0, gate_1_1, gate_1_2, carriage, lever, turret, turret_strap, servo_clamp, face, test_fit, test_horn, test_reader]
// Assembly only: 0 = loading (slot towards the hopper), 180 = handing the banknote out.
turret_angle = 0; // [0:5:180]
// Assembly only: 0 = pusher at home, 1 = card fully in the reader.
pusher = 0; // [0:0.05:1]
show_hardware = true;
// Assembly only: show a card in the reader even with the pusher home and the turret at 0°.
card_in_reader = false;
// Assembly only: show the phone, its shelf and its back (they hide the mechanism).
show_phone = true;

/* [Measure these on your hardware] */
// How far a card goes into the ACR39U (85.6 minus what still sticks out).
card_insert_depth = 60; // [40:0.5:75]
// Height of the card's lower face above the reader's base, when inserted.
reader_slot_bottom = 6.0; // [2:0.1:10]
// MG996R: from the servo's bottom to the top face of its mounting tabs.
servo_tab_top = 29.0;
// The servo's cross horn (the one in the servo's box: the lever and the turret
// press onto it). Its arms taper, so an arm's width is taken at two places.
// Measured on a photo of our MG996R's horn, with a margin of about 0.2 mm.
horn_span = 36.0;     // tip to tip
horn_arm = 7.9;       // an arm's width 8 mm from the centre
horn_arm_tip = 4.7;   // an arm's width just before its rounded end
horn_t = 3.6;         // thickness
horn_boss_d = 14.8;   // the middle: across the curved corners between the arms
// With the horn on the servo: from the top of the servo's case to the underside
// of the horn's arms. It sets the height of the lever and of the turret.
horn_gap = 2.3;
// The servo's mounting holes (the round ends of the slots in its tabs): centre
// to centre along the servo, and across it. Measured on a photo of our MG996R.
servo_hole_span = 49.5;
servo_hole_gap = 10;
// The screws that hold each servo (four, from the servo's bag): thread
// diameter, and length under the head. They cut their own thread in the chassis.
screw_d = 2.6;
screw_len = 10;
// The ACR39U: width, length (slot to cable end) and height. They set its pocket on the turret.
reader_w = 69;
reader_l = 72.2;
reader_h = 14.5;

/* [The phone: the ATM's screen] */
// An iPhone 17 Pro, without a case: width, thickness (its body, without the
// camera plateau) and height. Use the phone's size with its case if it has one.
phone_width = 71.9;
phone_thickness = 8.75;
phone_height = 150;
// The camera plateau across the top of its back: how far it stands out, lenses
// included (13.18 mm in all, less the body), and how far down from the top it
// reaches (an estimate, on the long side). The back stops below it.
phone_bump_t = 4.5;
phone_bump_len = 55;
// The screen leans back by this much.
phone_tilt = 12;

/* [Hidden] */
$fn = 48;
eps = 0.01;
fit = 0.3;        // sliding fit
press = 0.15;     // press fit
horn_fit = 0.25;  // the servo horn in its pocket: clearance on every side
reader_fit = 0.3; // the reader in its pocket on the turret: clearance on every side

// ------------------------------------------------------------------ hardware
card_l = 85.6;  card_w = 54;  card_t = 0.76;          // ISO ID-1
reader_offset = 10;   // the reader sits 10 mm towards its slot on the turret: room for the cable boot
cable_room = 12;
servo_l = 40.7;  servo_w = 19.7;  servo_h = 37.2;     // MG996R body
servo_shaft_h = 5.7;  servo_tab_span = 54.5;  servo_tab_t = 2.5;
servo_shaft_from_end = 10.0;
servo_tab_over = (servo_tab_span - servo_l) / 2;

// ------------------------------------------------------------------ heights (Z)
// Both servos hang from the chassis, screwed on through their tabs. Above each
// servo's tabs, a stack of parts reaches the card plane Zc (the lower face of a
// card on its way): the taller stack sets Zc, and the other servo hangs a
// little lower, on spacers.
// The servos were once held by straps under them; the room the straps took
// (table_gap + strap_bar under the lower servo) stays, so that every height
// stays as the parts were printed.
table_gap = 1.0;
// The tall front posts' leg: from the table up to their collar, where the
// chassis rests. The four posts reach down to give it this length, so the
// whole ATM stands higher off the table than the servos need (by
// post_lift, worked out below). Nothing but the posts changes with it.
front_leg = 40;
strap_bar = 2.4;
lever_over_horn = 1.8;
carriage_h = 5.2;
chan_floor_t = 1.2;
platter_t = horn_t + 1.6;                               // the turret's horn pocket is in its platter
servo_above_tabs = servo_h - servo_tab_top;
stack_pusher = servo_above_tabs + horn_gap + horn_t + lever_over_horn + 1.2 + carriage_h + 0.4 + chan_floor_t;
stack_turret = servo_above_tabs + horn_gap + platter_t + reader_slot_bottom;
Zc = table_gap + strap_bar + servo_tab_top + max(stack_pusher, stack_turret);
tabs_pusher = Zc - stack_pusher;                        // top face of each servo's tabs
tabs_turret = Zc - stack_turret;
chassis_t = 2.4;
chassis_bot = max(tabs_pusher, tabs_turret);
chassis_top = chassis_bot + chassis_t;

function servo_bottom(tabs) = tabs - servo_tab_top;
function case_top(tabs) = tabs + servo_above_tabs;
horn_bot_pusher = case_top(tabs_pusher) + horn_gap;
lever_top_z = horn_bot_pusher + horn_t + lever_over_horn;
carriage_bot_z = lever_top_z + 1.2;
carriage_top_z = carriage_bot_z + carriage_h;
floor_bot_z = Zc - chan_floor_t;
platter_bot_z = case_top(tabs_turret) + horn_gap;
reader_bot_z = platter_bot_z + platter_t;
reader_top_z = reader_bot_z + reader_h;
strap_t = 2.0;
hopper_h = 12;                                          // about 12 blank cards: enough for a demo
hopper_top_z = Zc + hopper_h;
finger_h = 0.6;       // the pusher's finger stands this much above the floor: it catches one card only

// ------------------------------------------------------------------ plan (Y)
slot_y = reader_l / 2 + reader_offset;                  // the reader's slot, turret at 0°
protrusion = card_l - card_insert_depth;                // what sticks out of the reader
card_tip_y = slot_y + protrusion;
card_sweep_r = norm([card_tip_y, card_w / 2]);          // the banknote's corners when the turret turns
cradle_wall = 2.5;
platter_x = reader_w / 2 + reader_fit + cradle_wall;
platter_back_y = slot_y + 3;                            // a short shelf in front of the slot
platter_front_y = -(reader_l / 2 - reader_offset) - cable_room;
turret_sweep_r = max(norm([platter_x, platter_back_y]), norm([platter_x, platter_front_y]));
face_inner_y = platter_front_y - 1.5;                   // the face stands just in front of the turret
face_t = 1.4;
face_y = face_inner_y - face_t;

sweep_margin = 4;                                       // room between the banknote's turning corners and anything fixed
chan_y0 = card_sweep_r + sweep_margin;                  // the channel starts outside the banknote's sweep
gate_t = 2.4;
gate_y0 = chan_y0 + 1;
hop_wall = 1.6;
groove = 0.8;
hop_y0 = gate_y0 + gate_t;                              // inside of the hopper
hop_y1 = hop_y0 + card_l + 1;
hop_in_x = card_w / 2 + 0.2;
finger_home_y = hop_y1 + 1;
finger_in_y = card_tip_y;                               // pushing face when the card is fully in
stroke = finger_home_y - finger_in_y;
lever_a = stroke / 2;                                   // the lever swings ±90°: stroke = 2 × arm
// The lever's pin pushes the carriage up to lever_a / 2 off its centre line,
// which twists it in its rails: like a drawer pulled by one corner, it locks
// once the friction reaches (length in the rails) / (2 × offset). At 30 mm
// (about 21 mm still in the rails at full stroke) that takes a friction of
// 0.42, above PLA on PLA. A longer carriage would make the chassis too long
// for the bed.
carriage_l = 30;
pin_offset = carriage_l / 2;
pin_d = 5;
pin_h = 4.2;
lever_x = lever_a / 2;                                  // the pin's X stays within ±lever_a/2
lever_y = (finger_home_y + finger_in_y) / 2 + pin_offset;
floor_y1 = finger_home_y + carriage_l + 3;

// The pin's slot across the carriage: its travel (±lever_a / 2), plus 2.4 mm
// at each end, so that the lever can overshoot its ends by about 2.5° (the
// horn's splines and the servo's end points are that loose).
pin_slot_half = lever_a / 2 + pin_d / 2 + 2.4;
carriage_half = pin_slot_half + 1.6;
flange_half = carriage_half + 2;
rail_in = carriage_half + fit;
rail_groove = flange_half + fit;
rail_out = rail_groove + 1.6;
leg_x = rail_out + 3;                                   // the channel's legs, just outside its rails
// The carriage's room in its rails. PETG strings, and a groove's roof sags a
// little where it prints over air: so the carriage is rail_side_play narrower
// than the rails on each side (and at its flanges' tips), and its flanges have
// rail_v_play above and below them in the grooves. The rails themselves stay
// where they were (the channel posts stand just outside them).
rail_side_play = 0.5;
rail_v_play = 0.4;
car_half = rail_in - rail_side_play;                    // the carriage's half width
car_flange_half = rail_groove - rail_side_play;         // out to its flanges' tips
flange_t = 1.4;
flange_z0 = 2.7;                                        // the flanges' underside, above the carriage's
rail_bot_z = carriage_bot_z + 1.0;                      // the rails' underside
// Room under the carriage for the horn's screw head and hub, which stand up
// through the lever's middle hole: the carriage passes right over the pusher
// servo's shaft at mid-stroke. A groove along the carriage, over the shaft's line.
screw_relief_w = 9;
screw_relief_h = 2.0;
leg_ys = [chan_y0 + 3, floor_y1 - 3];

turret_servo = [0, 0];
lever_servo = [lever_x, lever_y];

echo(str("card plane Z = ", Zc, " · stroke = ", stroke, " · lever arm = ", lever_a,
         " · footprint ", 2 * (leg_x + 5), " × ", floor_y1 - face_y, " mm · banknote sticks out ", card_tip_y + face_y, " mm"));

// ------------------------------------------------------------------ helpers

// A box from corner p0 to corner p1 with vertical edges rounded by r.
module rbox(p0, p1, r = 3) {
    hull() for (x = [p0[0] + r, p1[0] - r], y = [p0[1] + r, p1[1] - r])
        translate([x, y, p0[2]]) cylinder(r = r, h = p1[2] - p0[2]);
}

// A flat bar from p0 to p1 (X, Y), w wide, between heights z0 and z1, rounded ends.
module bar(p0, p1, w, z0, z1) {
    hull() for (p = [p0, p1]) translate([p[0], p[1], z0]) cylinder(d = w, h = z1 - z0);
}

module rrect(size, r, center = [0, 0]) {
    translate(center) offset(r = r) square([size[0] - 2 * r, size[1] - 2 * r], center = true);
}

function chord_half(r, d) = sqrt(max(r * r - d * d, 0));

// The hole for a servo's case top (shaft at s = [x, y], body along +X).
module servo_case_hole(s, z0, z1) {
    translate([s[0] - servo_shaft_from_end - fit, s[1] - servo_w / 2 - fit, z0 - 1])
        cube([servo_l + 2 * fit, servo_w + 2 * fit, z1 - z0 + 2]);
}

// A servo's four mounting holes (servo shaft at s, body along +X), in X and Y.
function servo_holes(s) = [for (i = [-1, 1], j = [-1, 1])
    [s[0] - servo_shaft_from_end + servo_l / 2 + i * servo_hole_span / 2, s[1] + j * servo_hole_gap / 2]];
screw_pilot_d = screw_d - 0.7;   // the hole a self-tapping screw cuts its thread in (1.9 mm for a 2.6 mm screw)
clamp_t = 2.0;                   // the printed plate under each tab: the screw heads press on it
clamp_w = 6.5;                   // its width, along the servo
// The slots in the servo's tabs are as wide as the rubber grommets they are
// made for, about 4.5 mm: a screw head could slip through. So each tab gets a
// printed plate under it, with a hole for each screw, that the heads press on.
module servo_clamp() {
    difference() {
        translate([-clamp_w / 2, -servo_w / 2, 0]) cube([clamp_w, servo_w, clamp_t]);
        for (j = [-1, 1]) translate([0, j * servo_hole_gap / 2, -1]) cylinder(d = screw_d + 0.5, h = clamp_t + 2);
    }
}
// The two plates under a servo's tabs, in place, and the screws (as ghosts).
module servo_clamps(s, tabs) {
    for (x = [servo_holes(s)[0][0], servo_holes(s)[2][0]]) translate([x, s[1], tabs - servo_tab_t - clamp_t]) servo_clamp();
}
function screw_tip_z(tabs) = tabs - servo_tab_t - clamp_t + screw_len;
module servo_screws(s, tabs) {
    for (h = servo_holes(s)) translate([h[0], h[1], 0]) {
        translate([0, 0, tabs - servo_tab_t - clamp_t - 1.8]) cylinder(d = 4.6, h = 1.8);   // the head
        translate([0, 0, tabs - servo_tab_t - clamp_t]) cylinder(d = screw_d, h = screw_len);
    }
}

// A cross-shaped boss around the horn pocket: the horn's shape plus 2 mm walls.
// The cross horn's outline, grown by `grow` on every side. Each arm is the hull
// of a circle at its tip and a circle at the centre, as wide as the arm would be
// there if it kept tapering as it does between 8 mm out and the tip. The middle
// is a circle across the curved corners between the arms.
horn_tip_x = horn_span / 2 - horn_arm_tip / 2;                       // the tip circle's centre
horn_arm_root = horn_arm + (horn_arm - horn_arm_tip) * 8 / (horn_tip_x - 8);
module horn_2d(grow) {
    for (a = [0, 90, 180, 270]) rotate(a) hull() {
        circle(d = horn_arm_root + 2 * grow);
        translate([horn_tip_x, 0]) circle(d = horn_arm_tip + 2 * grow);
    }
    circle(d = horn_boss_d + 2 * grow);
}

// Round the horn's pocket: the pocket's outline with 2.2 mm walls.
module horn_boss(h) {
    linear_extrude(h) horn_2d(horn_fit + 2.2);
}

// The cross horn's pocket (opening at Z = 0, going up), with clearance.
module horn_pocket(depth) {
    translate([0, 0, -eps]) linear_extrude(depth + eps) horn_2d(horn_fit);
    cylinder(d = 7, h = 50);   // the horn screw, and a screwdriver
}

// ------------------------------------------------------------------ chassis: a flat frame on four posts

// The chassis is a flat frame (fast to print); separate posts, printed lying
// down, hold it up and hold the face. Two more posts carry the channel.
post_size = 5.5;
peg_d = 3.6;
peg_len = 2.8;
// At the front, two tall posts go from the table, through the chassis, up to
// the phone's shelf: they carry the phone and hold the face. They stand
// outside the circle the banknote's corners sweep.
tall_post = 10;
tall_post_x = 80;
post_sleeve = 8;                                        // how tall the sleeves are that hold the tall posts upright
collar_h = 5;                                           // the tall posts' collar, under the sleeve
collar_z = chassis_bot - post_sleeve - collar_h;        // the collar's underside
post_lift = front_leg - collar_z;                       // how much further down the posts reach than the servos need
assert(post_lift >= 0, "front_leg is shorter than the tall posts were without any lift");
front_post_y = face_inner_y + tall_post / 2 + fit + 2.8;     // room for the chassis sleeve's front wall
face_peg_x = tall_post_x;
front_posts = [[-tall_post_x, front_post_y], [tall_post_x, front_post_y]];
// The short posts, at the back: 9 mm outside the channel's back posts, which
// stand on the chassis right above, so that each peg has its own hole.
post_x = leg_x + 9;
posts = [[-post_x, leg_ys[1]], [post_x, leg_ys[1]]];
pad_drop = 2;                                           // the channel floor's pads reach this far down, over its legs
pad_half = 4;                                           // the pads are 8 mm square
// The four channel posts hold the floor up on the chassis. Their pegs once
// slipped out of the holes (peg_d in a hole 2·press wider): now the lower
// peg has four crush ribs, a little wider than the chassis' hole, that grip
// its wall whatever the printer's tolerance; and the upper peg goes right
// through the floor's pad and clicks over its top with a split, barbed head,
// so the floor can't lift off. The holes are as the floor and the chassis
// were printed: through the pad (peg_len + 0.4 long), and chassis_t + 1 deep.
channel_post_h = floor_bot_z - pad_drop - chassis_top;
interference = 1;                                       // the checks set it to 0: the ribs press into the hole on purpose
chan_peg_d = peg_d + 2 * press + 0.25 * interference;   // across the ribs: 0.125 mm into the hole's wall on each side
chan_peg_core = peg_d - 0.2;
chan_peg_rib = 0.7;
chan_peg_len = chassis_t + 1 - 0.3;                     // the chassis hole's depth, less 0.3: the post's end seats first
pad_hole_len = peg_len + 0.4;                           // through the floor's pad
snap_shank_d = peg_d;                                   // slips into the floor's hole
snap_barb_d = peg_d + 2 * press + 0.7;                  // 0.35 mm over the hole's edge on each side
snap_slot = 1.0;                                        // the split: each half bends 0.35 mm in as the barb goes through
snap_head = 2.0;                                        // the barbed head's length, above the floor
chan_legs = [for (x = [-leg_x, leg_x], y = leg_ys) [x, y]];
module chan_peg() {
    intersection() {
        union() {
            cylinder(d = chan_peg_core, h = chan_peg_len);
            for (a = [0, 90]) rotate(a) translate([-chan_peg_d / 2, -chan_peg_rib / 2, 0]) cube([chan_peg_d, chan_peg_rib, chan_peg_len]);
        }
        // the ribs' envelope, with a 0.6 mm chamfer at the tip (Z = chan_peg_len)
        hull() {
            translate([0, 0, -eps]) cylinder(d = chan_peg_d, h = chan_peg_len - 0.6 + eps);
            translate([0, 0, chan_peg_len - eps]) cylinder(d = chan_peg_d - 1.2, h = eps);
        }
    }
}

// What holds a servo: a pad of plate around it, with the hole for its case
// and the screws' holes, and, when the servo hangs lower than the plate, two
// spacers under its tabs. The pad goes 4 mm round the hole on every side, so
// it stays one piece around the hole and joins the bars that cross it; along
// the servo it reaches 6.6 mm beyond the tabs (where the straps' slots were).
module servo_mount(s, tabs) {
    body_x0 = s[0] - servo_shaft_from_end;
    pad_half = servo_w / 2 + fit + 4;                   // the pad's half width, across Y
    pad_x0 = body_x0 - servo_tab_over - 6.6;
    pad_x1 = body_x0 + servo_l + servo_tab_over + 6.6;
    translate([pad_x0, s[1] - pad_half, chassis_bot]) cube([pad_x1 - pad_x0, 2 * pad_half, chassis_t]);
    // The spacers are as wide as the pad: the chassis prints upside down, and
    // a spacer wider than the pad would start in mid-air.
    if (tabs < chassis_bot - eps) for (x = [body_x0 - servo_tab_over - 0.5, body_x0 + servo_l]) translate([x + 0.25, s[1] - pad_half, tabs])
        cube([servo_tab_over + 0.25, 2 * pad_half, chassis_bot - tabs + eps]);
}

// Ribs under the bars. The chassis is a thin plate (fast to print, and its top
// face sets every height above it), and on its legs it bent: a rib under each
// bar makes it a T-beam, many times stiffer. The ribs hang below the plate, so
// nothing above changes; they print upwards (the chassis prints upside down),
// and they stop short of the servos with their plates and screws, and of the
// short posts that stand under the plate.
rib_h = 12;
rib_t = 3.2;
bar_w = 8;            // the bars' width, in the plate
module chassis_ribs() {
    difference() {
        union() {
            for (b = chassis_bars()) bar(b[0], b[1], rib_t, chassis_bot - rib_h, chassis_bot + eps);
        }
        // keep clear of each servo, its tabs, the plates under them and the screw heads
        for (s = [turret_servo, lever_servo])
            translate([s[0] - servo_shaft_from_end - servo_tab_over - 3, s[1] - servo_w / 2 - 3, chassis_bot - rib_h - 1])
                cube([servo_tab_span + 6, servo_w + 6, rib_h + 1]);
        // and of the short posts under the plate
        for (p = posts) translate([p[0] - post_size / 2 - 1.5, p[1] - post_size / 2 - 1.5, chassis_bot - rib_h - 1])
            cube([post_size + 3, post_size + 3, rib_h + 1]);
        // and, below the sleeves, of the tall posts and their collars (the ribs are deeper than the sleeves)
        for (p = front_posts) translate([p[0] - tall_post / 2 - 3, p[1] - tall_post / 2 - 3, chassis_bot - rib_h - 1])
            cube([tall_post + 6, tall_post + 6, rib_h - post_sleeve + 1]);
    }
}
// The chassis' bars, as [from, to] pairs (in X, Y), bar_w wide in the plate.
// With the two side bars they make a closed ring: the back no longer hangs on
// the spine alone.
function chassis_bars() = [
    [[0, front_post_y], [0, leg_ys[1]]],                              // the spine, from the front bar to the back
    [[-leg_x, leg_ys[0]], [leg_x, leg_ys[0]]],                        // under the channel's front posts
    [[-post_x, leg_ys[1]], [post_x, leg_ys[1]]],                      // under the channel's back posts, out to the short posts
    [[-face_peg_x, front_post_y], [face_peg_x, front_post_y]],        // the front bar, between the tall posts
    [[-leg_x, leg_ys[0]], [-tall_post_x, front_post_y]],              // the two diagonals to the tall posts
    [[leg_x, leg_ys[0]], [tall_post_x, front_post_y]],
    [[-leg_x, leg_ys[0]], [-post_x, leg_ys[1]]],                      // the two side bars, from the channel's front posts
    [[leg_x, leg_ys[0]], [post_x, leg_ys[1]]],                        // to the short posts at the back
];

module chassis() {
    difference() {
        union() {
            chassis_ribs();
            servo_mount(turret_servo, tabs_turret);
            servo_mount(lever_servo, tabs_pusher);
            // the bars (see chassis_bars: the two diagonals keep the front, with the posts, the
            // shelf and the phone, from hanging on the thin plate round the turret servo)
            for (b = chassis_bars()) bar(b[0], b[1], bar_w, chassis_bot, chassis_top);
            // around each tall post, a sleeve under the plate that keeps it upright
            for (pp = front_posts) translate([pp[0] - tall_post / 2 - fit - 2.5, pp[1] - tall_post / 2 - fit - 2.5, chassis_bot - post_sleeve])
                cube([tall_post + 2 * fit + 5, tall_post + 2 * fit + 5, post_sleeve + chassis_t]);
            // round pads where the posts' and the channel floor's legs' pegs go
            for (pp = concat(posts, chan_legs)) translate([pp[0], pp[1], chassis_bot]) cylinder(d = 8, h = chassis_t);
        }
        servo_case_hole(turret_servo, tabs_turret, chassis_top);
        servo_case_hole(lever_servo, tabs_pusher, chassis_top);
        // the servos' screws, from below: through the plate and the tab, into the spacer and the pad
        for (sv = [[turret_servo, tabs_turret], [lever_servo, tabs_pusher]], h = servo_holes(sv[0]))
            translate([h[0], h[1], sv[1] - 1]) cylinder(d = screw_pilot_d, h = chassis_top - sv[1] + 2);
        // holes for the posts' and the channel posts' pegs
        for (pp = concat(posts, chan_legs))
            translate([pp[0], pp[1], chassis_bot - 1]) cylinder(d = peg_d + 2 * press, h = chassis_t + 2);
        // the tall posts go through
        for (pp = front_posts) translate([pp[0] - tall_post / 2 - fit, pp[1] - tall_post / 2 - fit, chassis_bot - post_sleeve - 1]) cube([tall_post + 2 * fit, tall_post + 2 * fit, chassis_t + post_sleeve + 2]);
    }
}

// A short post standing on the table under the chassis, at p, with its peg into the chassis.
back_post_w = 7.5;     // the short posts' width (the chassis' ribs keep post_size + 3 clear round them)
module post(p = [0, 0], size = back_post_w) {
    translate([p[0], p[1], 0]) {
        translate([-size / 2, -size / 2, -post_lift]) cube([size, size, chassis_bot + post_lift]);
        translate([0, 0, chassis_bot - eps]) cylinder(d = peg_d, h = peg_len);
    }
}

// A tall front post at p: from the table, through the chassis (which rests on
// its collar and holds it upright in a sleeve), up into the phone shelf's
// sleeve; it takes the face's peg.
module post_front(p = [0, 0]) {
    translate([p[0], p[1], 0]) difference() {
        union() {
            translate([-tall_post / 2, -tall_post / 2, -post_lift]) cube([tall_post, tall_post, shelf_z0 + post_lift]);
            // The collar the chassis's sleeve rests on. It stands out on three
            // sides only, flush with the rear (+Y) face: the front legs print
            // lying on that face, and a collar all round would hold them off the bed.
            translate([-tall_post / 2 - 1.5, -tall_post / 2 - 1.5, collar_z]) cube([tall_post + 3, tall_post + 1.5, collar_h]);
        }
        translate([0, -tall_post / 2 - 1, face_peg_z]) rotate([-90, 0, 0]) cylinder(d = 4 + 2 * press, h = tall_post / 2 + 4);
    }
}

// The upper peg: through the floor's pad, then a barbed head that clicks over
// the floor's top. Split along its length (the slot's faces are vertical when
// the post prints lying down), so its halves bend in as the barb goes through.
module snap_peg() {
    difference() {
        union() {
            cylinder(d = snap_shank_d, h = pad_hole_len + 0.1);
            // the barb: a flat face that catches the floor's top, a cone above it that leads it in.
            // Cut flat on +X, the side that lies on the bed when the post prints, 0.6 mm
            // inside the shank: there it would start in mid-air, on the shank's thin
            // underside. It catches on its other sides.
            intersection() {
                translate([0, 0, pad_hole_len + 0.1]) cylinder(d1 = snap_barb_d, d2 = snap_shank_d - 0.6, h = snap_head);
                translate([-snap_barb_d, -snap_barb_d, 0]) cube([snap_barb_d + snap_shank_d / 2 - 0.6, 2 * snap_barb_d, pad_hole_len + snap_head + 1]);
            }
        }
        translate([-snap_barb_d, -snap_slot / 2, -1.5]) cube([2 * snap_barb_d, snap_slot, pad_hole_len + snap_head + 3]);
    }
}

// A post between the chassis and the channel floor, at p: the crush-rib peg into
// the chassis, the snap peg up through the floor.
module channel_post(p = [0, 0]) {
    translate([p[0], p[1], chassis_top]) {
        translate([-3, -3, 0]) cube([6, 6, channel_post_h]);
        translate([0, 0, eps]) mirror([0, 0, 1]) chan_peg();
        translate([0, 0, channel_post_h - eps]) snap_peg();
    }
}

// The legs: two pieces, each a pair of posts joined by a wide base bar on the
// table and two diagonal braces (four separate posts on small feet rocked).
// At the front the two tall posts, at the back the two short ones. Each prints
// lying on one face, so its base reaches out from that face only: forwards at
// the front (a customer pulling the banknote), backwards at the back (a push on
// the phone), and sideways beyond the posts.
leg_base_h = 5;        // the base bars' thickness
leg_side = 6;          // how far each base reaches beyond its posts, sideways
front_foot = 20;       // how far the front base reaches forward of the tall posts
back_foot = 25;        // how far the back base reaches behind the short posts
brace_w = 6;
brace_top_z = collar_z - 6;                             // the braces stay under the collars and the chassis' ribs
// A brace: a strip brace_w wide in the X-Z plane, from p0 to p1 (each [x, z]), from y0 to y1.
module brace(p0, p1, y0, y1) {
    hull() for (p = [p0, p1]) translate([p[0] - brace_w / 2, y0, p[1] - brace_w / 2]) cube([brace_w, y1 - y0, brace_w]);
}
module legs_front() {
    y1 = front_post_y + tall_post / 2;                  // the posts' rear face, which prints on the bed
    x1 = tall_post_x + tall_post / 2 + leg_side;
    for (pp = front_posts) post_front(pp);
    translate([-x1, y1 - tall_post - front_foot, -post_lift]) cube([2 * x1, tall_post + front_foot, leg_base_h]);
    for (s = [-1, 1]) brace([s * (tall_post_x - tall_post / 2), brace_top_z], [s * (tall_post_x - tall_post / 2 - 35), -post_lift + leg_base_h],
                            y1 - tall_post, y1);
}
module legs_back() {
    y0 = leg_ys[1] - back_post_w / 2;                   // the posts' front face, which prints on the bed
    x1 = post_x + back_post_w / 2 + leg_side;
    for (p = posts) post(p);
    translate([-x1, y0, -post_lift]) cube([2 * x1, back_post_w + back_foot, leg_base_h]);
    for (s = [-1, 1]) brace([s * (post_x - back_post_w / 2), brace_top_z], [s * (post_x - back_post_w / 2 - 30), -post_lift + leg_base_h],
                            y0, y0 + back_post_w);
}


// ------------------------------------------------------------------ channel floor: the card's path and the pusher's rails

// A length of rail (both sides), as under the channel floor, from y0 to y1.
module rails(y0, y1) {
    for (s = [-1, 1]) mirror([s < 0 ? 1 : 0, 0, 0])
        difference() {
            translate([rail_in, y0, rail_bot_z]) cube([rail_out - rail_in, y1 - y0, floor_bot_z - rail_bot_z + eps]);
            // the groove the carriage's flanges slide in
            translate([rail_in - eps, y0 - 1, carriage_bot_z + flange_z0 - rail_v_play]) cube([rail_groove - rail_in + eps, y1 - y0 + 2, flange_t + 2 * rail_v_play]);
        }
}

module channel_floor() {
    window_x = [8, card_w / 2 - 4];                    // the windows between the floor's strips (each side)
    window_y = [hop_y0 + 4, floor_y1 - 4];
    ties = [hop_y0 + card_l / 2, hop_y1 + 2];          // cross ties that keep the strips together
    difference() {
        union() {
            // the floor the cards slide on, with pads over the posts
            translate([-rail_out, chan_y0, floor_bot_z]) cube([2 * rail_out, floor_y1 - chan_y0, chan_floor_t]);
            for (x = [-leg_x, leg_x], y = leg_ys) translate([x - pad_half, y - pad_half, floor_bot_z - pad_drop]) cube([2 * pad_half, 2 * pad_half, chan_floor_t + pad_drop]);
            rails(chan_y0, floor_y1);
        }
        // windows: a card is stiff, three strips carry it
        for (sx = [-1, 1]) difference() {
            translate([sx < 0 ? -window_x[1] : window_x[0], window_y[0], floor_bot_z - 1]) cube([window_x[1] - window_x[0], window_y[1] - window_y[0], chan_floor_t + 2]);
            for (y = ties) translate([-50, y - 3, floor_bot_z - 2]) cube([100, 6, chan_floor_t + 4]);
        }
        // the slot the pusher's finger runs in (open towards the turret)
        translate([-3.5, chan_y0 - 1, floor_bot_z - 1]) cube([7, finger_home_y + 4.5 - chan_y0 + 1, chan_floor_t + 2]);
        // holes for the hopper's pegs and the channel posts' pegs (through the pads)
        for (x = [-1, 1], y = [hop_y0 + 12, hop_y1 - 12]) translate([x * (hop_in_x + hop_wall / 2), y, Zc - 1.6])
            cylinder(d = 2.4 + 2 * press, h = 3);
        for (p = chan_legs) translate([p[0], p[1], floor_bot_z - pad_drop - eps]) cylinder(d = peg_d + 2 * press, h = peg_len + 0.4);
        // a 0.6 mm chamfer on the edge the card leaves the floor by, across its path
        translate([0, chan_y0, Zc]) rotate([45, 0, 0]) cube([card_w + 2, 0.85, 0.85], center = true);
    }
}

// ------------------------------------------------------------------ hopper: the card holder

// The hopper once stood on the floor on four pegs 1 mm long (the carriage runs
// just under the floor: they can't reach deeper), its walls 1.6 mm thin, and
// the gate sat in grooves 0.8 mm deep with nothing holding it down: a card
// rubbing under the gate lifted it out, and the hopper wobbled. Now, on the
// same floor:
//  · each side of the hopper is a closed box (an inner wall, an outer wall, a
//    top, a flange on the floor), stiff where the thin wall bent;
//  · the outer walls come down outside the floor's sides, between the pads
//    over the channel posts: the front pads stop the hopper going forward with
//    the cards, and four snap fingers hook under the floor's rails;
//  · two pillars at the front hold the gate in slots 2 mm deep, and the gate's
//    two arms snap under a step on the pillars' outer faces: a card can't lift it.
hop_side_t = 2.4;                                       // the inner walls: the cards' sides
hop_top_t = 1.6;                                        // the boxes' top (on the bed as the hopper prints)
hop_flange_t = 1.6;                                     // the boxes' bottom, lying on the floor
hop_back_t = 2.4;                                       // the back wall
hop_cap_t = 2;                                          // the wall that closes each box at the front
hop_back_y = hop_y1 + hop_back_t;
// The outer walls and their snap fingers.
clip_gap = 0.2;                                         // between the outer walls and the floor's sides
clip_t = 1.8;
clip_x0 = rail_out + clip_gap;                          // the outer walls' inner face
clip_x1 = clip_x0 + clip_t;
clip_y0 = leg_ys[0] + pad_half + 0.3;                   // 0.3 mm behind the front pads, which stop the hopper going forward
clip_skirt_z = rail_bot_z + 0.5;                        // how far down the floor's sides the outer walls reach
hook_depth = 0.8;                                       // how far each finger's hook reaches in under the rail
hook_play = 0.2;                                        // between the hook and the rail's underside
hook_z = rail_bot_z - hook_play;                        // the hook's catching face
finger_w = 10;
finger_slit = 1;                                        // the cut each side of a finger, so that it can bend
// The fingers join the outer wall 6 mm above the floor: 13 mm of finger bends
// the hook's 0.8 mm without straining the PETG (about 1.2 %).
finger_root_z = Zc + 6;
finger_ys = [clip_y0 + 5, hop_y1 - 4 - finger_w];       // where each side's two fingers start
// The front pillars and the gate's snap.
pillar_x1 = hop_in_x + 5;                               // the pillars' outer face
pillar_y0 = gate_y0 - 0.15 - 3;                         // 3 mm of pillar in front of the gate's slot
slot_depth = 2;                                         // how far the gate goes into each pillar
catch_z = hopper_top_z - 8;                             // the underside of the step the gate's arms snap under
catch_depth = 0.8;                                      // how deep the step is
arm_gap = 0.2;                                          // between the gate's arms and the pillars
arm_t = 2;
arm_barb = arm_gap + catch_depth - 0.2;                 // each arm's barb: 0.2 mm short of the step's floor
// The pillars reach in front of the floor's edge, off to the sides of the card:
// they must stay out of the circle the banknote's corners sweep (with its margin).
assert(norm([hop_in_x, pillar_y0]) >= card_sweep_r + sweep_margin, "the hopper's pillars reach into the banknote's sweep");

// One snap finger on the +X side, from y = 0 to finger_w: a strip of outer
// wall that hangs free between two slits, with a hook at its end. The hook's
// flat top catches under the rail; the 45° ramp below it spreads the finger
// as the hopper is pressed down over the floor's edge.
module snap_finger() {
    tip = 0.4;                                          // the hook's flat tip, so that it isn't a knife edge
    translate([clip_x0, 0, hook_z - hook_depth - tip]) cube([clip_t, finger_w, finger_root_z - (hook_z - hook_depth - tip) + eps]);
    translate([0, finger_w, 0]) rotate([90, 0, 0]) linear_extrude(finger_w) polygon([
        [clip_x0 + eps, hook_z - hook_depth - tip], [clip_x0 - hook_depth, hook_z - tip],
        [clip_x0 - hook_depth, hook_z], [clip_x0 + eps, hook_z]]);
}

// The hopper's +X side: the pillar, the inner wall, the box and the outer wall with its fingers.
module hopper_side() {
    difference() {
        union() {
            // the inner wall, from the pillar to the back wall
            translate([hop_in_x, pillar_y0, Zc]) cube([hop_side_t, hop_back_y - pillar_y0, hopper_h]);
            // the pillar, in front of the box
            translate([hop_in_x, pillar_y0, Zc]) cube([pillar_x1 - hop_in_x, clip_y0 - pillar_y0, hopper_h]);
            // the box: its front cap, its top, its flange on the floor and its outer wall down the floor's side
            translate([hop_in_x, clip_y0, Zc]) cube([clip_x1 - hop_in_x, hop_cap_t, hopper_h]);
            translate([hop_in_x, clip_y0, hopper_top_z - hop_top_t]) cube([clip_x1 - hop_in_x, hop_back_y - clip_y0, hop_top_t]);
            translate([hop_in_x, clip_y0, Zc]) cube([clip_x0 - hop_in_x + eps, hop_back_y - clip_y0, hop_flange_t]);
            translate([clip_x0, clip_y0, clip_skirt_z]) cube([clip_t, hop_back_y - clip_y0, hopper_top_z - clip_skirt_z]);
        }
        // room for each finger: the slits through the outer wall, and 0.6 mm
        // off the flange's edge, so that the finger hangs only from above
        for (y = finger_ys) translate([clip_x0 - 0.6, y - finger_slit, clip_skirt_z - 1])
            cube([clip_t + 0.6 + 1, finger_w + 2 * finger_slit, finger_root_z - clip_skirt_z + 1]);
        // the gate's slot
        translate([hop_in_x - eps, gate_y0 - 0.15, Zc - 1]) cube([slot_depth + eps, gate_t + 0.3, hopper_h + 2]);
        // the step on the pillar's outer face: the gate's arm snaps under it
        translate([pillar_x1 - catch_depth, gate_y0 - 0.6, Zc - 1]) cube([catch_depth + 1, gate_t + 1.2, catch_z - Zc + 1]);
    }
    for (y = finger_ys) translate([0, y, 0]) snap_finger();
}

module hopper() {
    difference() {
        union() {
            for (s = [-1, 1]) mirror([s < 0 ? 1 : 0, 0, 0]) hopper_side();
            // the back wall, across both boxes
            translate([-clip_x1, hop_y1, Zc]) cube([2 * clip_x1, hop_back_t, hopper_h]);
            // pegs into the floor's holes: they place the hopper (the fingers and the pads hold it)
            for (x = [-1, 1], y = [hop_y0 + 12, hop_y1 - 12])
                translate([x * (hop_in_x + hop_wall / 2), y, Zc - 1.0]) cylinder(d = 2.4, h = 1.0 + eps);   // shorter than the floor is thick: nothing pokes into the carriage's way
        }
        // the finger's way under the back wall
        translate([-4, hop_y1 - 1, Zc - 1]) cube([8, hop_back_t + 2, 1 + finger_h + 1.0]);
        // a window through the right box: how many blank cards are left
        hull() for (z = [Zc + 6, hopper_top_z - 5]) translate([hop_in_x - 1, hop_y0 + card_l / 2, z]) rotate([0, 90, 0]) cylinder(d = 6, h = clip_x1 - hop_in_x + 2);
    }
}

// The gate: lets exactly one card through. Print a few gaps and keep the one
// that works. Its edges slide down the pillars' slots; a bar rests on the
// pillars' tops, and an arm down each pillar's outer face snaps under the
// step there. To take it out, spread the two arms and pull the tab.
module gate(gap) {
    body_half = hop_in_x + slot_depth - fit;
    arm_x0 = pillar_x1 + arm_gap;                       // the arms' inner face
    arm_x1 = arm_x0 + arm_t;
    tip = 0.4;                                          // the barb's flat tip
    difference() {
        union() {
            translate([-body_half, gate_y0, Zc + gap]) cube([2 * body_half, gate_t, hopper_h - gap]);
            // the bar on the pillars' tops, and a tab to pull it out
            translate([-arm_x1, gate_y0, hopper_top_z]) cube([2 * arm_x1, gate_t, 3]);
            translate([-8, gate_y0, hopper_top_z]) cube([16, gate_t, 8]);
            // the arms, each with a barb at its end: a flat top under the
            // step, a 45° ramp below it that spreads the arm on the way down
            for (s = [-1, 1]) mirror([s < 0 ? 1 : 0, 0, 0]) {
                translate([arm_x0, gate_y0, catch_z - 0.1 - tip - arm_barb]) cube([arm_t, gate_t, hopper_top_z - (catch_z - 0.1 - tip - arm_barb) + eps]);
                translate([0, gate_y0 + gate_t, 0]) rotate([90, 0, 0]) linear_extrude(gate_t) polygon([
                    [arm_x0 + eps, catch_z - 0.1 - tip - arm_barb], [arm_x0 - arm_barb, catch_z - 0.1 - tip],
                    [arm_x0 - arm_barb, catch_z - 0.1], [arm_x0 + eps, catch_z - 0.1]]);
            }
        }
        // A 0.6 mm chamfer on the bottom edge of the exit side. The gate prints
        // lying on that side, so the chamfer also takes the first layer's
        // squish, which would otherwise narrow the gap. The hopper side's
        // edge, which holds back the second card, stays sharp.
        translate([0, gate_y0, Zc + gap]) rotate([45, 0, 0]) cube([2 * body_half + 2, 0.85, 0.85], center = true);
        // The gap, engraved 0.6 mm into the hopper side (on top as it prints),
        // readable from behind the ATM.
        // (str(1.0) is "1" in OpenSCAD: the ".0" is added by hand)
        label = gap == floor(gap) ? str(gap, ".0") : str(gap);
        translate([0, gate_y0 + gate_t, hopper_top_z + 4.5]) rotate([90, 0, 0]) mirror([1, 0, 0])
            linear_extrude(1.2, center = true) text(label, size = 4, font = "Liberation Sans:style=Bold", halign = "center", valign = "center");
    }
}

// ------------------------------------------------------------------ pusher: carriage and lever

// The carriage at finger position y (the finger's pushing face).
module carriage(y = finger_home_y) {
    translate([0, y, 0]) difference() {
        union() {
            translate([-car_half, 0, carriage_bot_z]) cube([2 * car_half, carriage_l, carriage_h]);
            // flanges riding in the rails' grooves
            translate([-car_flange_half, 0, carriage_bot_z + flange_z0]) cube([2 * car_flange_half, carriage_l, flange_t]);
            // the finger: a vertical face pushes the card, a ramp slides under the next one
            translate([-2.5, 0, carriage_top_z - eps]) rotate([90, 0, 90]) linear_extrude(5)
                polygon([[0, 0], [0, Zc + finger_h - carriage_top_z], [0.8, Zc + finger_h - carriage_top_z], [3.5, 0]]);
        }
        // the slot the lever's pin slides in
        translate([-pin_slot_half, pin_offset - (pin_d + 0.6) / 2, carriage_bot_z - 1])
            cube([2 * pin_slot_half, pin_d + 0.6, 1 + 4.2]);
        // room for the horn's screw head, along the line of the pusher servo's shaft
        translate([lever_x - screw_relief_w / 2, -1, carriage_bot_z - 1]) cube([screw_relief_w, carriage_l + 2, 1 + screw_relief_h]);
    }
}

// The lever on the pusher servo's horn. With θ = `angle`, the pin is at
// shaft + A·(−cos θ, sin θ): 90 is home (pin to the back), −90 is the card
// fully in, and in between the pin swings through the carriage's slot.
module lever(angle = 90) {
    plate_h = lever_top_z - horn_bot_pusher;
    translate([lever_servo[0], lever_servo[1], 0]) rotate([0, 0, 90 - angle])
        difference() {
            union() {
                translate([0, 0, horn_bot_pusher]) horn_boss(plate_h);
                hull() {
                    translate([0, 0, horn_bot_pusher]) cylinder(d = 12, h = plate_h);
                    translate([0, lever_a, horn_bot_pusher]) cylinder(d = 9, h = plate_h);
                }
                // the pin: 3.5 mm into the carriage's slot, 0.7 mm under its ceiling
                translate([0, lever_a, lever_top_z - eps]) cylinder(d = pin_d, h = pin_h);
                translate([0, lever_a, lever_top_z + pin_h - eps]) cylinder(d1 = pin_d, d2 = pin_d - 1, h = 0.5);
            }
            translate([0, 0, horn_bot_pusher]) horn_pocket(horn_t + 0.2);
        }
}

// ------------------------------------------------------------------ turret: the reader's cradle, right on the servo horn

// The hub's middle is open, right through the platter, as wide as the horn's
// middle. The turret prints with the horn pocket on the bed, so the pocket's
// ceiling is a bridge. Over the whole cross the slicer ran that bridge one way,
// up to 27 mm along two of the arms and round the screw hole, and it sagged
// into strings. With the middle open, each arm's ceiling is a bridge of its
// own, which the slicer runs across the arm (9 mm at most). The horn still
// presses up against the four arms' ceilings, the pocket's sides that grip it
// are unchanged, the reader lies across the opening, and the horn's screw can
// be reached through it.
hub_open_d = horn_boss_d + 2 * horn_fit;

module turret() {
    rib = 2.4;                                          // ribs on the bed, under the reader
    wall_x0 = reader_w / 2 + reader_fit;                // the cradle's side walls, outside the reader
    end_y = -reader_l / 2 + reader_offset;              // the reader's cable end
    difference() {
        union() {
            // the hub on the horn: its top carries the reader's middle
            translate([0, 0, platter_bot_z]) horn_boss(platter_t);
            // ribs joining the hub, the side walls and the slot wall
            translate([-platter_x, -3, platter_bot_z]) cube([2 * platter_x, 6, rib]);
            translate([-3, 0, platter_bot_z]) cube([6, slot_y + 1, rib]);
            for (sx = [-1, 1]) translate([sx < 0 ? -platter_x : wall_x0, end_y - cradle_wall, platter_bot_z]) cube([cradle_wall, platter_back_y - end_y + cradle_wall, rib]);
            // short guides on both sides, from the bed up: they keep the reader centred
            for (sx = [-1, 1], y = [end_y, slot_y - 14]) translate([sx < 0 ? -platter_x : wall_x0, y, platter_bot_z])
                cube([cradle_wall, 14, platter_t + 4]);
            // under the reader's cable-end corners: columns, and the stops that take the push of a card going in
            for (sx = [-1, 1]) translate([sx < 0 ? -wall_x0 : wall_x0 - 8, end_y, platter_bot_z]) cube([8, 8, platter_t]);
            for (sx = [-1, 1]) translate([sx < 0 ? -platter_x : wall_x0 - 8, end_y - reader_fit - cradle_wall, platter_bot_z]) cube([cradle_wall + 8, cradle_wall, platter_t + 7]);
            // under the slot end: two columns at the reader's corners, and the card's shelf on top
            for (sx = [-1, 1]) translate([sx < 0 ? -platter_x : wall_x0 - 6, slot_y - 6, platter_bot_z]) cube([cradle_wall + 6, 6, platter_t]);
            translate([-shelf_half, slot_y - 3, platter_bot_z]) cube([2 * shelf_half, platter_back_y - slot_y + 3, platter_t]);
            slot_stop();
        }
        // lead-in chamfer on the shelf, where the card arrives
        translate([-shelf_half - 1, platter_back_y, Zc - 0.2]) rotate([45, 0, 0]) cube([2 * shelf_half + 2, 2, 2]);
        translate([0, 0, platter_bot_z]) horn_pocket(horn_t + 0.2);
        translate([0, 0, platter_bot_z - eps]) cylinder(d = hub_open_d, h = platter_t + 2 * eps);   // the open middle (see hub_open_d)
    }
}

// The wall under the reader's slot: its top is the shelf the card slides on,
// 0.2 mm under the card plane, a little wider than a card; it is also the
// stop that keeps the reader from sliding out towards the hopper.
shelf_half = card_w / 2 + 3;
module slot_stop() {
    translate([-shelf_half, slot_y + reader_fit, reader_bot_z - eps]) cube([2 * shelf_half, platter_back_y - slot_y - reader_fit, Zc - 0.2 - reader_bot_z]);
}

// Over the reader: keeps it down when the customer pulls the banknote out.
turret_strap_w = 8;
module turret_strap() {
    w = turret_strap_w;
    inner = 2 * (platter_x + 0.3);
    translate([0, reader_offset, 0]) {
        translate([-inner / 2 - 2.4, -w / 2, reader_top_z + 0.2]) cube([inner + 4.8, w, strap_t]);
        for (s = [-1, 1]) translate([s < 0 ? -inner / 2 - 2.4 : inner / 2, -w / 2, platter_bot_z - 1.4])
            cube([2.4, w, reader_top_z + 0.2 + strap_t - platter_bot_z + 1.4]);
        // hooks under the platter
        for (s = [-1, 1]) translate([s < 0 ? -inner / 2 : inner / 2 - 1.2, -w / 2, platter_bot_z - 1.4]) cube([1.2, w, 1.4]);
    }
}

// ------------------------------------------------------------------ the phone: shelf and back

turret_top_z = reader_top_z + 0.2 + strap_t;
shelf_z0 = turret_top_z + 3;                            // the shelf passes over the turret
shelf_h = 10;
shelf_top = shelf_z0 + shelf_h;
shelf_y0 = face_inner_y + 0.3;                          // just behind the face
shelf_d = 24;
phone_shelf_half = tall_post_x + tall_post / 2 + 2;
phone_play = 0.5;      // between the phone and the groove, or the back's side lips, on each side
phone_groove = 5;      // how deep the phone's bottom stands in the shelf
rail_w = 9;
rail_t = 6;
rail_xs = [-(phone_width / 2 - 8), phone_width / 2 - 8];
rail_fit = 0.4;        // the back's rails in their sockets, on each side: PETG strings, so not tight
// The back's front face, at the shelf's top. In front of it the groove: the
// phone leans back, so at the groove's floor its back is phone_groove·tan(tilt)
// further forward, and its front edge a thickness/cos(tilt) further still.
groove_d = phone_groove * tan(phone_tilt) + phone_thickness / cos(phone_tilt) + 2 * phone_play;
rail_y = shelf_y0 + 1.5 + groove_d;                     // 1.5 mm: the shelf's front lip
socket_depth = 8;
// The back holds the phone up to below its camera plateau, 5 mm short of it.
back_len = socket_depth + phone_height - phone_bump_len - phone_groove - 5;

// The shelf the phone stands on, from post to post. Its two sleeves fit over
// the tall posts' tops (a joint that doesn't rock: the phone leans back, so
// its weight sits behind the posts). The phone stands in a groove, its
// charging plug in a pocket under it.
shelf_sleeve = 9;
plug_room = 4.4;       // under the phone's bottom, for a right-angle plug's head
assert(shelf_top - phone_groove - plug_room >= shelf_z0 + 0.6, "the plug's pocket would go through the shelf");
module phone_shelf() {
    sleeve_out = tall_post + 2 * fit + 5;
    difference() {
        union() {
            translate([-phone_shelf_half, shelf_y0, shelf_z0]) cube([2 * phone_shelf_half, shelf_d, shelf_h]);
            for (pp = front_posts) translate([pp[0] - sleeve_out / 2, pp[1] - sleeve_out / 2, shelf_z0 - shelf_sleeve]) cube([sleeve_out, sleeve_out, shelf_sleeve + eps]);
        }
        // the tall posts' tops
        for (pp = front_posts) translate([pp[0] - tall_post / 2 - fit, pp[1] - tall_post / 2 - fit, shelf_z0 - shelf_sleeve - 1]) cube([tall_post + 2 * fit, tall_post + 2 * fit, shelf_sleeve + 1]);
        // the groove the phone stands in, with a 1 mm chamfer along its front edge
        translate([-(phone_width / 2 + phone_play), shelf_y0 + 1.5, shelf_top - phone_groove]) cube([phone_width + 2 * phone_play, groove_d, phone_groove + 1]);
        translate([-(phone_width / 2 + phone_play), shelf_y0 + 1.5, shelf_top]) rotate([45, 0, 0]) cube([phone_width + 2 * phone_play, 1.4, 1.4], center = false);
        // sockets for the back's rails, leaning back, each with a flared mouth
        for (x = rail_xs) translate([x, rail_y, shelf_top]) rotate([-phone_tilt, 0, 0]) {
            translate([-rail_w / 2 - rail_fit, -rail_fit, -socket_depth]) cube([rail_w + 2 * rail_fit, rail_t + 2 * rail_fit, socket_depth + 2]);
            hull() {
                translate([-rail_w / 2 - rail_fit, -rail_fit, -1.2]) cube([rail_w + 2 * rail_fit, rail_t + 2 * rail_fit, eps]);
                translate([-rail_w / 2 - rail_fit - 1, -rail_fit - 1, 0]) cube([rail_w + 2 * rail_fit + 2, rail_t + 2 * rail_fit + 2, 1]);
            }
        }
        // a pocket for the charging plug (use a cable with a right-angle plug), and a groove to the side for its cable
        translate([-10, shelf_y0 + 1.5, shelf_top - phone_groove - plug_room]) cube([20, groove_d, phone_groove + plug_room + 1]);
        translate([0, rail_y - groove_d / 2 - 3.5, shelf_top - phone_groove - plug_room]) cube([phone_shelf_half + 1, 7, 6]);
        // dark pockets behind the face's eyes, kept 0.6 mm under the shelf's
        // top (the eyes sit so high that a round pocket would break through it)
        for (sx = [-1, 1]) intersection() {
            translate([sx * eye_x, shelf_y0 - 1, eye_z]) rotate([-90, 0, 0]) cylinder(d = 10, h = 7);
            translate([-500, -500, 0]) cube([1000, 1000, shelf_top - 0.6]);
        }
    }
}

// The back the phone leans on, printed flat on its rear face. In flat
// coordinates: X across, Y along it (0 at the rails' ends, deep in the shelf's
// sockets), Z from the rear face (on the bed) to the face the phone leans on,
// at Z = rail_t. It is a solid plate behind two rails (the phone leans on the
// rails, which go into the shelf's sockets), with a lip along each side that
// keeps the phone centred. Plate and lips start above the shelf (the back
// leans back, so its rear sinks a little towards the shelf's top).
back_plate_t = 3;
back_lip_t = 2.4;
back_lip_h = 4;        // how far the lips stand out in front of the rails, towards the phone
back_half = phone_width / 2 + phone_play + back_lip_t;
back_plate_y0 = socket_depth + rail_t * tan(phone_tilt) + 1;
module phone_back_flat() {
    for (x = rail_xs) translate([x - rail_w / 2, 0, 0]) cube([rail_w, back_len, rail_t]);
    translate([-back_half, back_plate_y0, 0]) cube([2 * back_half, back_len - back_plate_y0, back_plate_t]);
    for (s = [-1, 1]) translate([s < 0 ? -back_half : back_half - back_lip_t, back_plate_y0, 0])
        cube([back_lip_t, back_len - back_plate_y0, rail_t + back_lip_h]);
}

// The back in place: its rails in the shelf's sockets, leaning back. (The
// flat back's Z runs from its rear face; in place, distance in front of the
// rear means towards the phone, hence the flip.)
module phone_back() {
    translate([0, rail_y, shelf_top]) rotate([-phone_tilt, 0, 0]) translate([0, 0, -socket_depth])
        rotate([90, 0, 0]) mirror([0, 0, 1]) translate([0, 0, rail_t]) mirror([0, 0, 1]) phone_back_flat();
}

// ------------------------------------------------------------------ face: the smile

// What must pass through the face when the turret turns (in the face's plane, X and Z):
// the turret itself, and the banknote's corners at the card plane.
mouth_z0 = platter_bot_z - 1.5;
mouth_z1 = reader_top_z + strap_t + 1.5;
mouth_half = chord_half(turret_sweep_r + 1, -face_inner_y) + 2;
slit_half = chord_half(card_sweep_r + sweep_margin, -face_inner_y) + 1;
slit_z0 = Zc - 2;

// The grin: a "D" lying on its back, flat on top with a smiling lower edge
// z = bottom + k·x² that passes under the slit's ends and under the turret.
grin_half = slit_half + 4;
grin_top = mouth_z1 + 1;
grin_r2 = pow(mouth_half / slit_half, 2);
grin_bottom = min(mouth_z0 - 3, (mouth_z0 - 0.5 - (slit_z0 - 2) * grin_r2) / (1 - grin_r2));
grin_k = (slit_z0 - 2 - grin_bottom) / (slit_half * slit_half);
face_half = max(grin_half + 5, tall_post_x + tall_post / 2 + 3);
face_peg_z = min(max(12, grin_bottom - 8), chassis_bot - post_sleeve - 9);   // into the tall posts, under their collar
face_bot_z = face_peg_z - 6;
face_top_z = shelf_top + 1;                             // it hides the shelf
assert(grin_bottom >= face_bot_z + 3, "the grin doesn't fit the face");

module grin_2d() {
    corner = 8;
    steps = 24;
    hull() {
        polygon(concat(
            [for (i = [0 : steps]) let (x = -grin_half + corner + i * (2 * (grin_half - corner) / steps)) [x, grin_bottom + grin_k * x * x]],
            [[grin_half - corner, grin_top - corner], [-grin_half + corner, grin_top - corner]]));
        for (sx = [-1, 1]) translate([sx * (grin_half - corner), grin_top - corner]) circle(r = corner);
    }
}

eye_x = grin_half - 22;
eye_z = (grin_top + face_top_z) / 2 + 0.5;

// The face is green, its eyes are holes, and its black ink is flush in its front: the
// lips round the grin, and the NearCash name and logo in the chin under the smile.
// The face prints face down, so the ink is its first three layers, on the bed.
// (The lips used to be a groove instead: the green over it printed in mid-air, 0.6 mm
// above the bed, a 2.6 mm ledge held on one side only, and came out ragged and stringy.)
face_inlay_t = 0.6;   // the black ink's depth: the first 3 layers (0.2 + 0.24 + 0.24 mm)
lips_w = 2.6;         // the lips: a black band round the grin
module lips_2d() {
    difference() {
        offset(r = lips_w) grin_2d();
        grin_2d();
    }
}

// ---- the NearCash name and logo, in black, flush in the face's chin
// The logo is the website's mark (apps/website/public/favicon.svg, drawn on a 64-unit
// square): a card outline and three NFC waves, in dark ink on NearCash green. Only the
// ink is drawn here, the face being the green. At 25 mm for the 64 units its thinnest
// line is 1 mm and its narrowest gap 0.55 mm: what a 0.4 mm nozzle still prints.
brand_unit = 25 / 64;
brand_font = "Liberation Sans:style=Bold";   // it comes with OpenSCAD: the same on every computer
brand_text = "NearCash";
brand_text_size = 9;
brand_text_metrics = textmetrics(brand_text, size = brand_text_size, font = brand_font);
brand_logo_w = (42 + 3) * brand_unit;        // the card, 42 units, and its 3-unit line
brand_logo_h = (27 + 3) * brand_unit;
brand_gap = 3.5;                             // between the logo and the name
brand_w = brand_logo_w + brand_gap + brand_text_metrics.size[0];
brand_h = max(brand_logo_h, brand_text_metrics.size[1]);
// The chin: from tab to tab, from the bottom of the tabs up to the grin. Its brand sits
// halfway between the chin's lower edge and the lips under the grin.
chin_z0 = face_peg_z - 11 / 2;
brand_z = (chin_z0 + grin_bottom - lips_w) / 2;
assert(brand_z + brand_h / 2 + 1 <= grin_bottom - lips_w, "the name and logo reach the lips");
assert(brand_w / 2 + 2 <= face_peg_x - 11 / 2, "the name and logo reach the face's tabs");

// One NFC wave of the logo, in its units: an arc bulging right, from the SVG's path
// "M end_x … a r r 0 0 1 0 2·half_chord" (both ends at end_x, the card's middle height),
// a line of width `line` with round ends.
module nfc_wave_2d(end_x, r, half_chord, line) {
    centre_x = end_x - sqrt(r * r - half_chord * half_chord);
    angle = asin(half_chord / r);
    translate([centre_x, 0]) {
        intersection() {
            difference() { circle(r = r + line / 2); circle(r = r - line / 2); }
            polygon([[0, 0], [3 * r * cos(angle), -3 * r * sin(angle)], [3 * r * cos(angle), 3 * r * sin(angle)]]);
        }
        for (s = [-1, 1]) translate([r * cos(angle), s * half_chord]) circle(d = line);
    }
}

// The logo's ink, centred on the card (the SVG's point 32, 32).
module brand_logo_2d() {
    scale(brand_unit) {
        // the card: 42 × 27 units with corners of 5, a 3-unit line on its outline
        difference() {
            offset(r = 5 + 3 / 2) square([42 - 2 * 5, 27 - 2 * 5], center = true);
            offset(r = 5 - 3 / 2) square([42 - 2 * 5, 27 - 2 * 5], center = true);
        }
        // the three waves (the SVG's ends at x = 28, 32.5 and 37: here 32 less), 2.6-unit lines
        nfc_wave_2d(28 - 32, 6, 9 / 2, 2.6);
        nfc_wave_2d(32.5 - 32, 10.5, 15 / 2, 2.6);
        nfc_wave_2d(37 - 32, 14.5, 20.4 / 2, 2.6);
    }
}

// The logo, then the name, centred on the chin, in the face's plane (X across, Z up).
module brand_2d() {
    translate([-brand_w / 2, brand_z]) {
        translate([brand_logo_w / 2, 0]) brand_logo_2d();
        translate([brand_logo_w + brand_gap, 0]) text(brand_text, size = brand_text_size, font = brand_font, valign = "center");
    }
}

// All of the face's black ink, in the face's plane: the lips and the brand. The eyes
// dip a little into the upper lip, so they are cut out of the ink too: their holes stay
// open all the way through, with no black film in the first layers.
module face_ink_2d() {
    difference() {
        union() {
            lips_2d();
            brand_2d();
        }
        eyes_2d();
    }
}

// The black inlay (the part is still called face_brand): the lips, the name and the
// logo, face_inlay_t deep into the face's front.
module face_brand() {
    translate([0, face_y + face_inlay_t, 0]) rotate([90, 0, 0]) linear_extrude(face_inlay_t) face_ink_2d();
}

module eyes_2d() {
    for (sx = [-1, 1]) translate([sx * eye_x, eye_z]) circle(d = 9);
}

module face_outline_2d() {
    // a frame around the grin, the band with the eyes, and tabs down to the posts
    offset(r = 6) grin_2d();
    hull() for (sx = [-1, 1], z = [grin_top - 4, face_top_z - 5]) translate([sx * (face_half - 5), z]) circle(r = 5);
    for (sx = [-1, 1]) hull() {
        translate([sx * face_peg_x, face_peg_z]) circle(d = 11);
        translate([sx * face_peg_x, grin_bottom + grin_k * face_peg_x * face_peg_x]) circle(d = 11);
    }
    // the chin, from tab to tab and up round the grin's frame (face() cuts the grin out
    // again): it carries the name and logo, and hides the legs' braces behind it
    hull() {
        for (sx = [-1, 1]) translate([sx * face_peg_x, face_peg_z]) circle(d = 11);
        offset(r = 6) grin_2d();
    }
}

module face() {
    difference() {
        union() {
            translate([0, face_inner_y, 0]) rotate([90, 0, 0]) linear_extrude(face_t) face_outline_2d();
            // pegs into the tall posts
            for (x = [-face_peg_x, face_peg_x]) translate([x, face_inner_y - eps, face_peg_z]) rotate([-90, 0, 0]) cylinder(d = 4, h = front_post_y - tall_post / 2 - face_inner_y + 4);
        }
        translate([0, face_inner_y + 1, 0]) rotate([90, 0, 0]) linear_extrude(face_t + 2) union() { grin_2d(); eyes_2d(); }
        // the black inlay's place (lips, name and logo), open in front: the inlay prints
        // in it, in the same object, so the green above it rests on the black
        translate([0, face_y + face_inlay_t, 0]) rotate([90, 0, 0]) linear_extrude(face_inlay_t + 1) face_ink_2d();
    }
}

// ------------------------------------------------------------------ test pieces: print these first

// The servo horn's pocket alone, as on the lever and the turret (press the
// horn in: snug, no play). It prints in a few minutes: use it to try a new
// horn_fit, or a horn of another shape, before printing the lever and turret.
module test_horn() {
    difference() {
        horn_boss(horn_t + 1.2);
        horn_pocket(horn_t + 0.2);
    }
}

// The other fits, in one small piece: a peg and its hole (press fit, as the
// legs and pegs), a length of rail with a slice of carriage in it (it must
// slide freely but not wobble). The horn's pocket is test_horn, on its own.
module test_fit() {
    translate([horn_span / 2 + 10, -8, 0]) difference() {
        cube([10, 16, 6]);
        translate([5, 4, 6 - 4]) cylinder(d = 3.6 + 2 * press, h = 5);
    }
    translate([horn_span / 2 + 15, 11, 0]) cylinder(d = 3.6, h = 5);
    // the rail sample, upside down as in the channel floor's print, and the carriage slice
    translate([0, 40, 0]) {
        on_bed_flipped(Zc) intersection() {
            union() { translate([-rail_out, 0, floor_bot_z]) cube([2 * rail_out, 12, chan_floor_t]); rails(0, 12); }
            translate([-100, 0, 0]) cube([200, 12, 200]);
        }
        translate([0, 18, 0]) on_bed(carriage_bot_z) intersection() {
            carriage(0);
            translate([-100, 0, 0]) cube([200, 6, carriage_top_z]);   // without the finger, which needs the floor's slot
        }
    }
}

// The reader's height: with the ACR39U flat on the table, put this piece
// against its slot and slide a card along its two rails. It must go in
// without catching the slot's edge and without lifting: if not, change
// reader_slot_bottom (the rails are that high, minus the 0.2 mm the shelf on
// the turret keeps under the card).
module test_reader() {
    len = 30;
    h = reader_slot_bottom - 0.2;
    // two rails the card's edges slide on, joined at the far end, with guides on the outside
    for (sx = [-1, 1]) translate([sx < 0 ? -card_w / 2 - 2 : card_w / 2 - 6, 0, 0]) {
        cube([8, len, h]);
        translate([sx < 0 ? 0 : 6, 6, h - eps]) cube([2, len - 6, 2]);
    }
    translate([-card_w / 2 - 2, len - 4, 0]) cube([card_w + 4, 4, h - 1]);
    translate([0, len - 2, h - 1 - eps]) linear_extrude(0.6) text(str(reader_slot_bottom), size = 3, halign = "center", valign = "center", font = "Liberation Sans:style=Bold");
}

// ------------------------------------------------------------------ ghosts (not printed)

module reader_ghost() {
    color([0.1, 0.1, 0.1, 0.85]) translate([0, reader_offset, reader_bot_z])
        linear_extrude(reader_h) rrect([reader_w, reader_l], 7);
}

module card_ghost(y_lead) {   // y_lead: the card's leading edge (the chip's end), moving towards −Y
    color([0.0, 0.92, 0.59]) translate([-card_w / 2, y_lead, Zc]) cube([card_w, card_l, card_t]);
}

// The phone in its shelf's groove, leaning on its back.
module phone_ghost() {
    // its back 0.4 mm in front of the back's plane, its bottom 0.2 mm above the groove's floor
    color([0.05, 0.05, 0.08, 0.9]) translate([0, rail_y - 0.4 - (phone_groove - 0.2) * tan(phone_tilt), shelf_top - phone_groove + 0.2]) rotate([-phone_tilt, 0, 0])
        translate([-phone_width / 2, -phone_thickness, 0]) {
            cube([phone_width, phone_thickness, phone_height]);
            // the camera plateau across the top of its back
            translate([1, phone_thickness, phone_height - phone_bump_len]) cube([phone_width - 2, phone_bump_t, phone_bump_len]);
        }
}

module servo_ghost(s, tabs) {
    color([0.15, 0.25, 0.9, 0.6]) {
        translate([s[0] - servo_shaft_from_end, s[1] - servo_w / 2, servo_bottom(tabs)]) cube([servo_l, servo_w, servo_h]);
        translate([s[0] - servo_shaft_from_end - servo_tab_over, s[1] - servo_w / 2, tabs - servo_tab_t]) cube([servo_tab_span, servo_w, servo_tab_t]);
        translate([s[0], s[1], case_top(tabs)]) cylinder(d = 6, h = servo_shaft_h);
    }
}

// ------------------------------------------------------------------ assembly

green = [0.0, 0.85, 0.55];
dark = [0.12, 0.12, 0.13];

module assembly() {
    finger_y = finger_home_y - pusher * stroke;                        // the carriage moves straight
    lever_angle = asin(max(-1, min(1, (finger_y + pin_offset - lever_y) / lever_a)));   // y = ys + A·sin θ
    color(dark) chassis();
    color(green) { legs_front(); legs_back(); }
    color(green) for (p = chan_legs) channel_post(p);
    if (show_phone) {
        color(dark) phone_shelf();
        color(dark) phone_back();
        if (show_hardware) phone_ghost();
    }
    color(dark) { servo_clamps(turret_servo, tabs_turret); servo_clamps(lever_servo, tabs_pusher); }
    color(dark) channel_floor();
    color(green) hopper();
    color(dark) gate(1.1);
    color([0.9, 0.9, 0.9]) carriage(finger_y);
    color([0.95, 0.6, 0.1]) lever(lever_angle);
    color(green) face();
    color(dark) face_brand();
    rotate([0, 0, turret_angle]) {
        color(green) turret();
        color(dark) turret_strap();
        if (show_hardware) reader_ghost();
        if (show_hardware && (pusher == 1 || turret_angle > 0 || card_in_reader)) card_ghost(slot_y - card_insert_depth);
    }
    if (show_hardware) {
        for (i = [0 : 9]) translate([0, 0, i * card_t]) card_ghost(i == 0 && pusher > 0 && pusher < 1 ? hop_y0 - pusher * stroke : hop_y0);
        servo_ghost(turret_servo, tabs_turret);
        servo_ghost(lever_servo, tabs_pusher);
    }
}

// ------------------------------------------------------------------ print orientation

// Puts a part on the bed: moved down so its lowest point, z_low, is at Z = 0.
module on_bed(z_low) { translate([0, 0, -z_low]) children(); }

// Turns a part upside down onto the bed: its highest point, z_top, goes to Z = 0.
module on_bed_flipped(z_top) { translate([0, 0, z_top]) rotate([180, 0, 0]) children(); }

module gate_on_bed(gap) { rotate([90, 0, 0]) translate([0, -gate_y0, -Zc]) gate(gap); }
module face_on_bed() { rotate([90, 0, 0]) translate([0, -face_y, 0]) children(); }

if (part == "assembly") assembly();
else if (part == "section") intersection() {                                        // cut at X = 0, to look inside
    assembly();
    translate([-500, -500, -10]) cube([500, 1000, 600]);
}
else if (part == "chassis") on_bed_flipped(chassis_top) chassis();                  // upside down: the servo pad up
else if (part == "legs_front") rotate([-90, 0, 0]) translate([0, -(front_post_y + tall_post / 2), 0]) legs_front();   // lying on its rear face
else if (part == "legs_back") rotate([90, 0, 0]) translate([0, -(leg_ys[1] - back_post_w / 2), 0]) legs_back();       // lying on its front face
else if (part == "channel_post") translate([0, 0, 3]) rotate([0, 90, 0]) translate([0, 0, -chassis_top]) channel_post();   // lying down, the snap's slot upright (print four)
else if (part == "phone_shelf") on_bed_flipped(shelf_top) phone_shelf();          // upside down: the sleeves up
else if (part == "phone_back") phone_back_flat();                                   // flat
else if (part == "channel_floor") on_bed_flipped(Zc) channel_floor();               // upside down: the card's floor on the bed, smooth
else if (part == "hopper") on_bed_flipped(hopper_top_z) hopper();                   // upside down: pegs up
else if (part == "gate_0_9") gate_on_bed(0.9);
else if (part == "gate_1_0") gate_on_bed(1.0);
else if (part == "gate_1_1") gate_on_bed(1.1);
else if (part == "gate_1_2") gate_on_bed(1.2);
else if (part == "carriage") on_bed(carriage_bot_z) carriage(0);                    // pin slot on the bed side
else if (part == "lever") on_bed(horn_bot_pusher) translate(-[lever_servo[0], lever_servo[1], 0]) lever(90);   // horn pocket on the bed side
else if (part == "turret") on_bed(platter_bot_z) turret();                          // horn pocket on the bed side
else if (part == "turret_strap") translate([0, 0, turret_strap_w / 2]) rotate([90, 0, 0]) translate([0, -reader_offset, 0]) turret_strap();   // on its side
else if (part == "servo_clamp") servo_clamp();                                  // flat (print four: one under each servo tab)
else if (part == "face") face_on_bed() face();                                      // face down
else if (part == "face_brand") face_on_bed() face_brand();                          // the face's black inlay, in its place
else if (part == "test_fit") test_fit();
else if (part == "test_horn") test_horn();                                      // pocket on the bed side
else if (part == "test_reader") test_reader();
