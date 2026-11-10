#!/usr/bin/env bash
# Runs the clearance checks of check-clearances.scad: each one must come out
# empty (nothing touches). Pass the same -D options as to export.sh to check
# your own measurements, e.g.  hardware/atm/check-clearances.sh -D card_insert_depth=58
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENSCAD="${OPENSCAD:-$(command -v openscad || echo /Applications/OpenSCAD.app/Contents/MacOS/OpenSCAD)}"
NAMES=(
  ""
  "carriage in its rails"
  "lever pin in the carriage slot"
  "lever clear of chassis and floor"
  "turret and banknote turning"
  "turret clear of the carriage"
  "hopper on the floor, hooked under its rails"
  "face on the chassis"
  "channel posts between chassis and floor"
  "gate in its slots, snapped"
  "servos through the chassis"
  "servo screws and plates clear"
  "phone in its cradle"
  "phone back in its sockets"
)
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
failed=0
for check in $(seq 1 $((${#NAMES[@]} - 1))); do
  out="$TMP/check-$check.stl"
  log="$("$OPENSCAD" --backend=manifold -D "check=$check" "$@" -o "$out" "$HERE/check-clearances.scad" 2>&1)"
  if grep -q "top level object is empty" <<<"$log" || [ ! -s "$out" ]; then
    echo "✓ ${NAMES[$check]}"
    continue
  fi
  # Parts that only rest on each other meet in faces of no volume: that's fine.
  volume="$(python3 "$HERE/stl-volume.py" "$out")"
  if python3 -c "import sys; sys.exit(0 if float(sys.argv[1]) < 0.5 else 1)" "$volume"; then
    echo "✓ ${NAMES[$check]} (touching only)"
  else
    echo "✗ ${NAMES[$check]}: they overlap by ${volume} mm³ (see hardware/atm/clash-$check.stl)"
    cp "$out" "$HERE/clash-$check.stl"
    failed=1
  fi
done
[ "$failed" = 0 ] || { echo "some parts touch: see hardware/atm/clash-*.stl"; exit 1; }

# Every part prints as one piece (test_fit is several test pieces on purpose, and
# face_brand is the face's black inlay: its lips, letters and logo are separate by nature).
# It reads stl/: run export.sh first.
for stl in "$HERE"/stl/*.stl; do
  name="$(basename "$stl" .stl)"
  [ "$name" = test_fit ] && continue
  [ "$name" = face_brand ] && continue
  pieces="$(python3 "$HERE/stl-pieces.py" "$stl")"
  if [ "$pieces" != 1 ]; then
    echo "✗ stl/$name.stl prints as $pieces separate pieces"
    failed=1
  fi
done
[ "$failed" = 0 ] && echo "✓ every part is one piece" && echo "all clear" || exit 1
