// Clearance checks for the NearCash ATM: every check is the intersection of
// two things that must never touch. An empty result (or one of no volume,
// where parts only rest on each other) means the check passes.
// Run them all with check-clearances.sh.
include <nearcash-atm.scad>

// The model's own output is switched off (OpenSCAD keeps the last value of a variable).
part = "none";
check = 0;
interference = 0;   // the channel posts' crush ribs press into their holes on purpose: check them at the hole's size

// Lever angle for a carriage whose finger is at y (y = ys + A·sin θ).
function lever_angle_at(y) = asin(max(-1, min(1, (y + pin_offset - lever_y) / lever_a)));
finger_positions = [for (i = [0 : 8]) finger_home_y - i * stroke / 8];

// Everything that turns with the turret, with the banknote in the reader.
module turret_with_banknote(angle) {
    rotate([0, 0, angle]) {
        turret();
        turret_strap();
        translate([0, reader_offset, reader_bot_z]) linear_extrude(reader_h) offset(r = 7) square([reader_w - 14, reader_l - 14], center = true);
        translate([-card_w / 2, slot_y - card_insert_depth, Zc]) cube([card_w, card_l, card_t]);
    }
}

module servo_bodies() {
    for (sv = [[turret_servo, tabs_turret], [lever_servo, tabs_pusher]])
        translate([sv[0][0] - servo_shaft_from_end, sv[0][1] - servo_w / 2, servo_bottom(sv[1])]) cube([servo_l, servo_w, servo_h]);
}

if (check == 1)   // the carriage runs free in its rails
    for (y = finger_positions) intersection() { carriage(y); channel_floor(); }
if (check == 2)   // the lever's pin stays in the carriage's slot, without touching
    for (y = finger_positions) intersection() { carriage(y); lever(lever_angle_at(y)); }
if (check == 3)   // the lever swings clear of the chassis, the floor and the posts
    for (a = [90 : -15 : -90]) intersection() { lever(a); union() { chassis(); channel_floor(); for (p = chan_legs) channel_post(p); } }
module fixed_parts() {
    face(); channel_floor(); hopper(); gate(1.1); chassis();
    legs_front(); legs_back();
    for (p = chan_legs) channel_post(p);
    phone_shelf(); phone_back(); phone_ghost();
}
if (check == 4)   // the turret and the banknote turn clear of everything fixed
    for (a = [0 : 10 : 180]) intersection() { turret_with_banknote(a); fixed_parts(); }
if (check == 5)   // the turret, at the loading position, clear of the carriage pushing the card in
    intersection() { turret_with_banknote(0); carriage(finger_in_y); }
if (check == 6)   // the hopper sits on the floor, its fingers round the floor's sides and under its rails, clear of the channel posts, the carriage and the lever
    intersection() {
        hopper();
        union() { channel_floor(); for (p = chan_legs) channel_post(p); for (y = finger_positions) carriage(y); for (a = [90 : -15 : -90]) lever(a); }
    }
if (check == 7)   // the face's pegs in the tall posts, all the posts in the chassis, the shelf on the tall posts
    union() {
        intersection() { face(); legs_front(); }
        intersection() { chassis(); union() { legs_front(); legs_back(); } }
        intersection() { phone_shelf(); legs_front(); }
    }
if (check == 8)   // the channel posts between the chassis and the floor, their pegs in the holes, clear of the back legs
    for (p = chan_legs) intersection() { channel_post(p); union() { channel_floor(); chassis(); legs_back(); } }
if (check == 9)   // every gate in the pillars' slots, its arms snapped under the steps
    for (g = [0.9, 1.0, 1.1, 1.2]) intersection() { gate(g); union() { hopper(); channel_floor(); } }
if (check == 10)  // the servos go through the chassis without touching it, nor the lever or the turret
    intersection() { servo_bodies(); union() { chassis(); lever(90); lever(-90); turret(); } }
if (check == 11)  // the servos' screws and plates clear of the lever and the turret at every angle, and of the face and the floor
    intersection() {
        union() { for (sv = [[turret_servo, tabs_turret], [lever_servo, tabs_pusher]]) { servo_clamps(sv[0], sv[1]); servo_screws(sv[0], sv[1]); } }
        union() { for (a = [90 : -15 : -90]) lever(a); for (a = [0 : 15 : 180]) rotate([0, 0, a]) turret(); face(); channel_floor(); }
    }
if (check == 12)  // the phone sits on its shelf and against its back without being squeezed
    intersection() { phone_ghost(); union() { phone_shelf(); phone_back(); face(); legs_front(); } }
if (check == 13)  // the back's rails in the shelf's sockets
    intersection() { phone_back(); phone_shelf(); }
if (check == 14)  // the dummy reader sits in the turret's pocket, under the strap, its lid on its pegs
    union() {
        intersection() { union() { dummy_reader(); dummy_reader_lid(); } union() { turret(); turret_strap(); } }
        intersection() { dummy_reader(); dummy_reader_lid(); }
    }
if (check == 15)  // a card slides into the dummy reader all the way to its end without touching it (springs aside: grip 0)
    for (d = [0 : 10 : card_insert_depth]) intersection() {
        translate([-card_w / 2, slot_y - d, Zc]) cube([card_w, card_l, card_t]);
        union() { dummy_reader(grip = 0); dummy_reader_lid(); }
    }
