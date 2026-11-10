#!/usr/bin/env bash
# Exports every part of the NearCash ATM as an STL, in its printing
# orientation, into hardware/atm/stl/, and renders the preview images into
# hardware/atm/images/. Needs OpenSCAD 2025 or later (the Manifold backend).
#
#   hardware/atm/export.sh                         # all parts
#   hardware/atm/export.sh -D card_insert_depth=58 # with your own measurements
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODEL="$HERE/nearcash-atm.scad"
OPENSCAD="${OPENSCAD:-$(command -v openscad || echo /Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD)}"
[ -x "$OPENSCAD" ] || { echo "OpenSCAD not found: brew install --cask openscad@snapshot" >&2; exit 1; }

PARTS=(
  chassis legs_front legs_back channel_post channel_floor hopper gate_0_9 gate_1_0 gate_1_1 gate_1_2
  phone_shelf phone_back
  carriage lever turret turret_strap servo_clamp
  face face_brand test_fit test_horn test_reader
)

mkdir -p "$HERE/stl" "$HERE/images"
for part in "${PARTS[@]}"; do
  "$OPENSCAD" --backend=manifold -q -D "part=\"$part\"" "$@" -o "$HERE/stl/$part.stl" "$MODEL"
  echo "stl/$part.stl"
done

# Previews: handing the banknote out, a card on its way, a section, and the
# card's whole journey in six steps (without the phone, which would hide it).
# Each call gives its own --imgsize: OpenSCAD refuses the option twice.
render() { "$OPENSCAD" --backend=manifold -q --colorscheme=Tomorrow "$@" "$MODEL"; }
render -D 'turret_angle=180' --camera=-260,-480,300,0,40,90 --viewall --imgsize=2400,1800 -o "$HERE/images/atm-front.png"
render -D 'pusher=0.6' --camera=320,330,260,0,70,40 --viewall --imgsize=2400,1800 -o "$HERE/images/atm-back.png"
render -D 'part="section"' -D 'pusher=0.6' --camera=500,80,40,0,80,40 --viewall --projection=ortho --imgsize=1400,1000 -o "$HERE/images/atm-section.png"
FRAMES="$(mktemp -d)"
step=1
for state in "-D pusher=0" "-D pusher=0.45" "-D pusher=1" "-D pusher=0 -D card_in_reader=true" "-D pusher=0 -D turret_angle=90" "-D pusher=0 -D turret_angle=180"; do
  # shellcheck disable=SC2086 # each state is several -D options
  "$OPENSCAD" --backend=manifold -q --imgsize=1200,900 --colorscheme=Tomorrow --camera=360,-170,280,0,55,40 --viewall -D show_phone=false $state "$@" -o "$FRAMES/frame-$step.png" "$MODEL"
  step=$((step + 1))
done
if python3 -c "import PIL" 2>/dev/null; then
  python3 "$HERE/crop.py" "$HERE/images/atm-front.png" "$HERE/images/atm-back.png"
  python3 "$HERE/sequence.py" "$FRAMES" "$HERE/images/how-it-works.png"
else
  echo "(images not cropped and how-it-works.png not updated: they need Pillow, pip install pillow)"
fi
rm -rf "$FRAMES"
echo "images/atm-front.png images/atm-back.png images/atm-section.png images/how-it-works.png"
