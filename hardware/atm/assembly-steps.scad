// The NearCash ATM's assembly, one step at a time, for the assembly
// instructions (make-instructions.py renders every step of this file).
//
// What earlier steps mounted is light grey; what this step adds is in the
// colour it prints in. The hardware (servos, reader, phone, cards) keeps its
// ghost colours. The servos are at rest: turret at 0°, pusher home.
include <nearcash-atm.scad>

// The model's own output is switched off (OpenSCAD keeps the last value of a variable).
part = "none";
step = 1;   // 1 to 9, as in the instructions

mounted = [0.82, 0.82, 0.84];
print_green = [0.0, 0.8, 0.52];
print_black = [0.17, 0.17, 0.19];

// A printed part mounted at step s, shown only from that step on.
module at(s, c) {
    if (step >= s) color(step == s ? c : mounted) children();
}
// Hardware, shown from step s on, in its own colours.
module hardware_at(s) {
    if (step >= s) children();
}

// Step 0 is the chassis itself: always there, always grey.
color(mounted) chassis();

// 1. Servos, from below, screwed on through their tabs, a printed plate under each tab.
hardware_at(1) { servo_ghost(turret_servo, tabs_turret); servo_ghost(lever_servo, tabs_pusher); }
at(1, print_black) { servo_clamps(turret_servo, tabs_turret); servo_clamps(lever_servo, tabs_pusher); }
hardware_at(1) color([0.75, 0.75, 0.78]) { servo_screws(turret_servo, tabs_turret); servo_screws(lever_servo, tabs_pusher); }

// 2. The legs: the back pair's pegs into the chassis, the front pair's tall posts through the front sleeves.
at(2, print_green) { legs_front(); legs_back(); }

// 3. The lever on the pusher servo's horn, pointing to the back.
at(3, print_black) lever(90);

// 4. The channel: the carriage in the floor's rails, the floor on its four posts.
at(4, print_green) { for (p = chan_legs) channel_post(p); channel_floor(); }
at(4, print_black) carriage(finger_home_y);

// 5. The hopper on the floor, the gate in its grooves.
at(5, print_green) hopper();
at(5, print_black) gate(1.1);

// 6. The turret, with the reader in it and its strap over it, on the front servo's horn.
at(6, print_green) turret();
at(6, print_black) turret_strap();
hardware_at(6) reader_ghost();

// 7. The face, on the tall posts.
at(7, print_green) face();
at(7, print_black) face_brand();

// 8. The phone's shelf on the tall posts, its back in the shelf, the phone.
at(8, print_black) { phone_shelf(); phone_back(); }
hardware_at(8) phone_ghost();

// 9. Blank cards in the hopper.
hardware_at(9) for (i = [0 : 9]) translate([0, 0, i * card_t]) card_ghost(hop_y0);
