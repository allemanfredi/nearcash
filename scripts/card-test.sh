#!/usr/bin/env bash
# Tests a real NearCash card, in one command: writes the applet on it, runs a
# banknote's whole life on it, and resets it so it can be used again.
#
#   pnpm test:card [--keep | --delete] [--cap <file>]     on the Raspberry Pi, where the reader is
#   pnpm test:card --info                                 only reads the card's GlobalPlatform data
#   pnpm card:reset [--yes] [--cap <file>]                only resets the card (after a real test)
#
#   (no option)  at the end the card is reset: the applet is deleted and
#                installed again, so the card is blank (EMPTY, never born),
#                ready for another test, or for pnpm card:birth and the ATM.
#                The reset happens even when the test fails or the script is
#                stopped (Ctrl-C) once the applet is on the card, and the
#                script then checks that the card is blank.
#   --keep       leaves the test banknote on the card (SPENT), to look at it
#                with pnpm atm:reader. Run pnpm test:card again to reset it.
#   --delete     at the end deletes the applet instead of reinstalling it.
#   --cap <file> uses a .cap built elsewhere instead of building it.
#   --info       reads the card's data (CPLC, key version) WITHOUT
#                authenticating: safe on a card that refused its keys, to find
#                out which ones it expects. Changes nothing.
#   --reset      (pnpm card:reset) only resets the card, without testing it:
#                after a real test on the ATM the card goes back to blank
#                (EMPTY, never born), ready for pnpm card:birth and another
#                test. It reads the card's state first: a card that holds a
#                banknote (KEYS_GENERATED or ISSUED) is reset only once you
#                type RESET, since its keys go and any funds sent to its
#                account with them (redeem it first). A SPENT or blank card,
#                or one without the applet, is reset straight away.
#   --yes        with --reset: no question, even for a card with a banknote.
#
# On the Pi it:
#   1. downloads the Java Card tools at pinned versions, checked, into
#      applet/.javacard (git-ignored): GlobalPlatformPro (gp.jar), and to
#      build the applet, ant-javacard and Oracle's Java Card SDK. It installs
#      Java if it is missing;
#   2. builds the applet's .cap (applet: ./gradlew cap), unless --cap gives one;
#   3. stops the ATM server if it runs: it would talk to the card at the same time;
#   4. writes the applet on the card in the reader: deletes any NearCash
#      applet already on it (with everything it holds: keys, certificate, PIN),
#      then installs the .cap;
#   5. tests the card: apps/atm/src/card-test-cli.ts, the whole life of a
#      banknote with the public DEV keys (birth, keys, certificate, AUTH, PIN,
#      SIGN_ONCE as NEAR Intents checks it, SPENT);
#   6. resets it, and checks it is blank.
# The Pi needs the whole repository, applet/ included (pnpm atm:demo copies
# everything but applet/), and its dependencies (pnpm install).
#
# Resetting works while the card keeps its default GlobalPlatform keys
# (docs/protocol.md §10.1): with them anyone can delete and reinstall the
# applet. A card whose keys were changed (gp --lock) can no longer be reset.
# A reset deletes the keys: funds sent to a card's account are lost with them
# (the test uses DEV keys and moves no money).
#
# ⚠ Writing the applet uses the card's GlobalPlatform keys. If the card
# refuses them (an authentication error), the script stops: do NOT run it
# again on that card. A card counts failed authentications and locks itself
# for good after a few.
#
# Put the card in the reader before or while it runs (it waits up to 60 s).
#
# Environment (all optional):
#   NEARCASH_READER  part of the reader's name, when there are several
#   NEARCASH_GP_KEY  the card's GlobalPlatform key, when it is not the default
#                    404142…4F: its seller gives it; passed to gp --key, so a
#                    diversified one is written emv:<master> or visa2:<master>
#   NEARCASH_GP_KEY_ENC, NEARCASH_GP_KEY_MAC, NEARCASH_GP_KEY_DEK
#                    the card's three keys, when its seller gives them apart
#                    (Kenc, Kmac, Kdek): passed to gp --key-enc, --key-mac, --key-dek
#   NEARCASH_GP_DEBUG=1  gp shows its exchange with the card (gp -d). After a
#                    refused key, scripts/gp-key-check.mjs reads that output and
#                    finds offline which key the card uses, without a new attempt.
#   JAVA_HOME        the JDK to build with (found by itself otherwise)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS="$ROOT/applet/.javacard"
BUILT_CAP="$ROOT/applet/build/cap/nearcash.cap"
PACKAGE_AID="F04E42414E4B"       # docs/protocol.md §3: the applet is F04E42414E4B01

# The tools, pinned: a release and its SHA-256; a commit for the SDKs.
GP_URL="https://github.com/martinpaljak/GlobalPlatformPro/releases/download/v25.10.20/gp.jar"
GP_SHA256="c88e0c5093032ec4571571f5397b6174e56bf632667950fa5bb716338534b122"
ANT_JAVACARD_URL="https://github.com/martinpaljak/ant-javacard/releases/download/v26.05.15/ant-javacard.jar"
ANT_JAVACARD_SHA256="14f5e25c07b184e4ec02ee148892c2ea7ad5d7e9db8b91109524df8f7d000589"
SDKS_REPO="https://github.com/martinpaljak/oracle_javacard_sdks.git"
SDKS_COMMIT="700ec80afdda210a0e62fb6a151a9cddc1acd244"

step() { printf '\n\033[1;32m▸ %s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '  \033[1;33m! %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

usage() {
  # The comment block at the top of this file, without the leading "# ".
  awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"
  exit 1
}

# ============================================================== arguments

AT_THE_END="reset"
INFO=0
RESET_ONLY=0    # --reset: no test, only the reset
YES=0           # --yes: no question before resetting a card with a banknote
CAP=""          # --cap <file>: a .cap already built elsewhere
while [ $# -gt 0 ]; do
  case "$1" in
    --keep) AT_THE_END="keep" ;;
    --info) INFO=1 ;;
    --delete) AT_THE_END="delete" ;;
    --reset) RESET_ONLY=1 ;;
    --yes) YES=1 ;;
    --cap) [ $# -ge 2 ] || usage; CAP="$2"; shift ;;
    -h | --help) usage ;;
    -*) die "unknown option \"$1\" (see: pnpm test:card --help)" ;;
    *) usage ;;
  esac
  shift
done
if [ "$RESET_ONLY" = 1 ]; then
  [ "$INFO" = 0 ] && [ "$AT_THE_END" = "reset" ] || die "--reset goes alone (with --yes or --cap): it neither tests nor reads the card's data"
elif [ "$YES" = 1 ]; then
  die "--yes goes with --reset (pnpm card:reset --yes)"
fi

# ============================================================== tools

sha256_of() {
  if command -v shasum >/dev/null; then shasum -a 256 "$1" | awk '{ print $1 }'; else sha256sum "$1" | awk '{ print $1 }'; fi
}

# Downloads $1 into $2 unless it is already there, and checks its SHA-256 ($3).
fetch() {
  local url="$1" file="$2" expected="$3"
  if [ -f "$file" ] && [ "$(sha256_of "$file")" = "$expected" ]; then
    info "$(basename "$file"): already here"
    return
  fi
  curl -fsSL --retry 2 -o "$file.part" "$url" || die "could not download $url"
  [ "$(sha256_of "$file.part")" = "$expected" ] || { rm -f "$file.part"; die "$(basename "$file") does not have the expected SHA-256: not used"; }
  mv "$file.part" "$file"
  info "downloaded $(basename "$file")"
}

# Only the SDKs asked for ($@), at the pinned commit (git checks the content by its hash).
fetch_sdks() {
  local kit missing=0
  for kit in "$@"; do [ -d "$TOOLS/sdks/$kit" ] || missing=1; done
  if [ "$(git -C "$TOOLS/sdks" rev-parse HEAD 2>/dev/null)" = "$SDKS_COMMIT" ] && [ "$missing" = 0 ]; then
    info "Java Card SDK ($*): already here"
    return
  fi
  rm -rf "$TOOLS/sdks"
  git clone -q --filter=blob:none --no-checkout --sparse "$SDKS_REPO" "$TOOLS/sdks" || die "could not download the Java Card SDK"
  git -C "$TOOLS/sdks" sparse-checkout set "$@"
  git -C "$TOOLS/sdks" checkout -q "$SDKS_COMMIT"
  info "downloaded the Java Card SDK ($*)"
}

# Installs Debian packages ($@) with sudo, on the Pi; elsewhere says what is missing.
install_packages() {
  command -v apt-get >/dev/null || die "missing: $* (install it, then run again)"
  info "installing $* (sudo may ask for this computer's password)"
  sudo apt-get update -qq && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >/dev/null \
    || die "could not install $*"
}

# The home of a JDK (with javac) of version 17 or later, and its version: "<home> <major>".
# A JDK 17 first: Oracle's SDK 3.0.5u4 runs on it, the simplest build.
find_jdk() {
  local home major candidates=()
  [ -n "${JAVA_HOME:-}" ] && candidates+=("$JAVA_HOME")
  [ -x /usr/libexec/java_home ] && candidates+=("$(/usr/libexec/java_home -v 17 2>/dev/null || true)")
  candidates+=(/opt/homebrew/opt/openjdk@17 /usr/local/opt/openjdk@17 /usr/lib/jvm/java-17-openjdk-*)
  command -v javac >/dev/null && candidates+=("$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")")
  candidates+=(/usr/lib/jvm/*)
  for home in "${candidates[@]}"; do
    [ -n "$home" ] && [ -x "$home/bin/javac" ] || continue
    major="$("$home/bin/java" -version 2>&1 | sed -n 's/.*version "\([0-9]*\).*/\1/p' | head -1)"
    [ -n "$major" ] && [ "$major" -ge 17 ] && { printf '%s %s' "$home" "$major"; return; }
  done
  return 1
}

# Builds the .cap into $BUILT_CAP.
build_cap() {
  step "Building the applet's .cap"
  [ -d "$ROOT/applet/src" ] || die "the applet's sources are not here ($ROOT/applet): copy the whole repository, applet/ included"
  local jdk
  if ! jdk="$(find_jdk)"; then
    install_packages default-jdk-headless
    jdk="$(find_jdk)" || die "no JDK 17 or later found"
  fi
  local home="${jdk% *}" major="${jdk##* }" gradle_options=()
  if [ "$major" = 17 ]; then
    fetch_sdks jc305u4_kit                     # Java Card 3.0.5, as the JCOP4 J3R180
  else
    fetch_sdks jc320v26.0_kit                  # runs on any newer JDK, builds for 3.0.5
    gradle_options=(-PjavacardKit=jc320v26.0_kit -PjavacardTarget=3.0.5)
  fi
  fetch "$ANT_JAVACARD_URL" "$TOOLS/ant-javacard.jar" "$ANT_JAVACARD_SHA256"
  info "JDK $major: $home"
  (cd "$ROOT/applet" && JAVA_HOME="$home" sh ./gradlew -q cap ${gradle_options[@]+"${gradle_options[@]}"}) || die "the .cap did not build"
  info "$(basename "$BUILT_CAP"), $(wc -c <"$BUILT_CAP" | tr -d ' ') bytes"
}

# ============================================================== the card, in the reader here

step "Tools"
mkdir -p "$TOOLS"
command -v curl >/dev/null || install_packages curl
# Node.js 22.18 or later: the card test is TypeScript that Node runs directly.
# pnpm atm:demo installs it in /usr/local; a shell with nvm may put an older
# one first on the PATH.
find_node() {
  local candidate
  for candidate in "$(command -v node 2>/dev/null || true)" /usr/local/bin/node; do
    [ -n "$candidate" ] && [ -x "$candidate" ] || continue
    "$candidate" -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 18) ? 0 : 1)' \
      && { printf '%s' "$candidate"; return; }
  done
  return 1
}
NODE="$(find_node)" || die "Node.js 22.18 or later is needed (this shell has $(node -v 2>/dev/null || echo none)):
  sudo bash scripts/atm-pi-setup.sh installs it in /usr/local (with nvm: nvm install 22)"
info "Node.js $("$NODE" -v): $NODE"
command -v git >/dev/null || [ -n "$CAP" ] || install_packages git
fetch "$GP_URL" "$TOOLS/gp.jar" "$GP_SHA256"
# Java for gp: the one on the PATH if it works (macOS has a stub that doesn't),
# else a JDK found on this computer, else installed (on the Pi).
if java -version >/dev/null 2>&1; then
  JAVA="java"
elif jdk="$(find_jdk)"; then
  JAVA="${jdk% *}/bin/java"
else
  install_packages default-jre-headless
  JAVA="java"
fi
info "Java: $("$JAVA" -version 2>&1 | head -1)"
# The card test's dependencies (as pnpm atm:demo installs them on the Pi).
if [ ! -d "$ROOT/apps/atm/node_modules/pcsc-mini" ]; then
  info "installing the ATM's dependencies"
  (cd "$ROOT" && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile --prod --filter '@nearcash/atm...' >/dev/null) \
    || die "pnpm install failed"
fi

if [ "$INFO" = 1 ]; then
  :   # only reading the card: no .cap
elif [ -n "$CAP" ]; then
  [ -f "$CAP" ] || die "$CAP: no such .cap"
  info "the .cap: $CAP (built elsewhere)"
  CAP="$(cd "$(dirname "$CAP")" && pwd)/$(basename "$CAP")"
else
  build_cap
  CAP="$BUILT_CAP"
fi

# The ATM server holds the reader: two programs talking to the card at once
# would break the GlobalPlatform session.
if command -v tmux >/dev/null && tmux has-session -t nearcash 2>/dev/null; then
  tmux kill-session -t nearcash
  warn "stopped the ATM server (it uses the reader): pnpm atm:demo starts it again"
fi

# GlobalPlatformPro, on the chosen reader. Every call opens its own
# authenticated session with the card's default keys.
GP_READER=()
[ -n "${NEARCASH_READER:-}" ] && GP_READER=(-r "$NEARCASH_READER")
# The card's key: gp's default (404142…4F) unless NEARCASH_GP_KEY gives another.
GP_KEY=()
[ -n "${NEARCASH_GP_KEY:-}" ] && GP_KEY=(--key "$NEARCASH_GP_KEY")
if [ -n "${NEARCASH_GP_KEY_ENC:-}${NEARCASH_GP_KEY_MAC:-}${NEARCASH_GP_KEY_DEK:-}" ]; then
  [ -n "${NEARCASH_GP_KEY_ENC:-}" ] && [ -n "${NEARCASH_GP_KEY_MAC:-}" ] && [ -n "${NEARCASH_GP_KEY_DEK:-}" ] \
    || die "give all three keys: NEARCASH_GP_KEY_ENC, NEARCASH_GP_KEY_MAC and NEARCASH_GP_KEY_DEK"
  [ -z "${NEARCASH_GP_KEY:-}" ] || die "give either NEARCASH_GP_KEY or the three NEARCASH_GP_KEY_ENC/MAC/DEK, not both"
  GP_KEY=(--key-enc "$NEARCASH_GP_KEY_ENC" --key-mac "$NEARCASH_GP_KEY_MAC" --key-dek "$NEARCASH_GP_KEY_DEK")
fi
GP_DEBUG=()
[ "${NEARCASH_GP_DEBUG:-}" = 1 ] && GP_DEBUG=(-d)
# Runs gp; on an authentication failure stops at once (never retries: the card
# would count it), on any other failure stops with gp's output.
gp() {
  local output
  if output="$("$JAVA" -jar "$TOOLS/gp.jar" ${GP_READER[@]+"${GP_READER[@]}"} ${GP_KEY[@]+"${GP_KEY[@]}"} ${GP_DEBUG[@]+"${GP_DEBUG[@]}"} "$@" 2>&1)"; then
    printf '%s\n' "$output"
    return
  fi
  printf '%s\n' "$output" | sed 's/^/    /' >&2
  case "$output" in
    *[Cc]ryptogram* | *RE-TRY* | *[Aa]uthenticat* | *6982*)
      APPLET_ON_CARD=0   # nothing to reset: never touch this card again
      die "the card refused the GlobalPlatform key. Do NOT try again with the same key: the card counts failed
  attempts and locks itself for good. pnpm test:card --info reads its data without authenticating; with the
  key from its seller: NEARCASH_GP_KEY=<key> pnpm test:card. With NEARCASH_GP_DEBUG=1, this output goes to
  node scripts/gp-key-check.mjs, which finds the card's key offline." ;;
    *) die "gp $* failed" ;;
  esac
}

# The reset: delete the applet and install it again, then check the card is blank.
reset_card() {
  step "Resetting the card"
  gp --uninstall "$CAP" >/dev/null
  gp --install "$CAP" >/dev/null
  APPLET_ON_CARD=0
  info "the applet was deleted and installed again"
  "$NODE" "$ROOT/apps/atm/src/card-test-cli.ts" --blank || die "the card is not blank after the reset"
}

# Once the applet is on the card, the card is reset whatever happens next
# (unless --keep): a failed test, an error, Ctrl-C.
APPLET_ON_CARD=0
reset_on_exit() {
  local status=$?
  if [ "$APPLET_ON_CARD" = 1 ] && [ "$AT_THE_END" = "reset" ]; then
    trap - EXIT INT TERM
    warn "stopped before the end: resetting the card anyway"
    reset_card || true
  fi
  exit "$status"
}
trap reset_on_exit EXIT
trap 'exit 130' INT TERM

if [ "$INFO" = 1 ]; then
  step "Reading the card's data (no authentication)"
  "$NODE" "$ROOT/apps/atm/src/card-test-cli.ts" --wait || die "no card in the reader within a minute"
  # gp --info only reads (SELECT, GET DATA): it never opens a secure channel.
  "$JAVA" -jar "$TOOLS/gp.jar" ${GP_READER[@]+"${GP_READER[@]}"} --info
  exit 0
fi

# Asks before wiping a card that holds a banknote ($1, its state): its keys go,
# and any funds sent to its account with them. Stops unless RESET is typed.
confirm_wipe() {
  warn "the card holds a banknote ($1): resetting it deletes its keys, and any funds sent to its"
  warn "account are lost with them. If it holds money, redeem it first (the NearCash wallet)."
  if [ "$YES" = 1 ]; then
    info "--yes: resetting it anyway"
    return
  fi
  [ -t 0 ] || die "not reset: a card with a banknote is reset only in a terminal (to answer) or with --yes"
  local answer
  read -r -p "  type RESET to wipe it, anything else to stop: " answer
  [ "$answer" = "RESET" ] || die "not reset: the card is unchanged"
}

if [ "$RESET_ONLY" = 1 ]; then
  step "Reading the card"
  info "put the card in the reader (chip first, contacts up), if it isn't there"
  "$NODE" "$ROOT/apps/atm/src/card-test-cli.ts" --wait || die "no card in the reader within a minute"
  # The state through the applet, as the ATM reads it: no GlobalPlatform key used yet.
  STATE_OUTPUT="$("$NODE" "$ROOT/apps/atm/src/card-test-cli.ts" --state)" || die "could not read the card's state"
  STATE="$(sed -n 's/^state: //p' <<<"$STATE_OUTPUT")"
  [ -n "$STATE" ] || die "could not read the card's state"
  case "$STATE" in
    NONE) info "no NearCash applet on the card: it will be installed, blank" ;;
    EMPTY | SPENT) info "the card is $STATE: nothing on it is worth keeping" ;;
    *) confirm_wipe "$STATE" ;;
  esac
  if [ "$STATE" = "NONE" ]; then
    gp --install "$CAP" >/dev/null
    info "applet installed: package $PACKAGE_AID, applet ${PACKAGE_AID}01"
    "$NODE" "$ROOT/apps/atm/src/card-test-cli.ts" --blank || die "the card is not blank after the install"
  else
    reset_card
  fi
  printf '\n\033[1;32m✔ the card is blank (EMPTY, never born): pnpm card:birth makes it ready for the ATM\033[0m\n'
  exit 0
fi

step "Writing the applet on the card"
info "put the card in the reader (chip first, contacts up), if it isn't there"
# Waiting is done without talking to the card: gp authenticates on every call,
# and the card counts the failed ones. Then a single gp call checks the keys.
"$NODE" "$ROOT/apps/atm/src/card-test-cli.ts" --wait || die "no card in the reader within a minute"
# (an assignment, not a pipe: if gp stops on a refused key, the script stops too)
CARD_CONTENT="$(gp --list)"
if grep -q "$PACKAGE_AID" <<<"$CARD_CONTENT"; then
  gp --uninstall "$CAP" >/dev/null
  info "deleted the NearCash applet that was on the card"
fi
APPLET_ON_CARD=1
gp --install "$CAP" >/dev/null
info "applet installed: package $PACKAGE_AID, applet ${PACKAGE_AID}01"

step "Testing the card"
TEST_OK=1
"$NODE" "$ROOT/apps/atm/src/card-test-cli.ts" || TEST_OK=0

case "$AT_THE_END" in
  reset) reset_card ;;
  delete)
    step "Deleting the applet"
    gp --uninstall "$CAP" >/dev/null
    APPLET_ON_CARD=0
    info "the card has no NearCash applet any more"
    ;;
  keep)
    APPLET_ON_CARD=0
    info "the test banknote stays on the card (SPENT): pnpm atm:reader shows it; pnpm test:card again resets it"
    ;;
esac

[ "$TEST_OK" = 1 ] || die "the card failed the test (see the step marked ✘ above)"
printf '\n\033[1;32m✔ the card works\033[0m\n'
