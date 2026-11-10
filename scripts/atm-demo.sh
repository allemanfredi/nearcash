#!/usr/bin/env bash
# NearCash ATM demo in one command:
#
#   scripts/atm-demo.sh [--skip-mpc] <[user@]raspberry-address> [password]
#   pnpm atm:demo [--skip-mpc] <[user@]raspberry-address> [password]
#
#   --skip-mpc   the issuance server signs the banknotes' certificates itself,
#                with the public DEV key, instead of asking the NEAR MPC
#                network: no NEAR account, no gas, no wait. The banknotes are
#                still the issuer contract's. Demo banknotes only: the ATM
#                trusts the key because it asks the issuance server, the
#                wallet app only in its Debug builds. (Without the flag:
#                NEAR MPC, unless .env.issuance sets NEARCASH_SKIP_MPC=true.)
#
# Deploys the ATM to the Raspberry Pi and starts it there, in a tmux session
# ("nearcash") on the Pi itself: it keeps running when this computer
# disconnects. Then it opens the demo in a tmux session ("nearcash") on this
# computer:
#
#   ┌─ Raspberry Pi: its own session ───────┬─ issuance server  (here, :8790) ─┐
#   │   ATM server (:8792) / kiosk (:8791)  ├─ website            (here, :4173) ─┤
#   └───────────────────────────────────────┴──────────────────────────────────┘
#   + an "info" window: kiosk address, iPhone pairing QR code, HTTPS steps
#
# At the end it prints the command that opens the Pi's session directly:
#   ssh -t -i ~/.ssh/nearcash_atm_ed25519 <user>@<pi> tmux attach -t nearcash
#
# Who runs where, for the demo:
#   this computer  the issuance server (its keys never leave it) and the website;
#   Raspberry Pi   the ATM: the kiosk page (apps/kiosk, served by Vite over
#                  HTTPS to the iPhone) and the ATM server behind it (apps/atm,
#                  NestJS, only on the Pi), which talks to the issuance server
#                  over the LAN.
# Until the NFC reader and the cards arrive, the ATM has no cassette: the
# kiosk shows "out of service" and no sale can start.
#
# The password is used once, to install an SSH key on the Pi
# (~/.ssh/nearcash_atm_ed25519), and for sudo if the Pi asks for it. Leave it
# out and you are asked for it (hidden, never stored); given as an argument it
# stays in your shell history. Running the script again redeploys and restarts.
#
# Environment (all optional):
#   PI_USER         user when the address has none (default: pi)
#   PI_SSH_PORT     SSH port of the Pi (default: 22)
#   LAPTOP_ADDRESS  this computer's address as the Pi reaches it (default: detected)
#   NEARCASH_SESSION  tmux session name (default: nearcash)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_DIR="$ROOT/.atm-demo"   # generated here: certificate, pane scripts, info (git-ignored)
REMOTE_DIR="nearcash"        # on the Pi, inside the user's home
SESSION="${NEARCASH_SESSION:-nearcash}"   # on this computer
PI_SESSION="nearcash"                     # on the Pi: the ATM itself
KEY="$HOME/.ssh/nearcash_atm_ed25519"
ISSUANCE_PORT=8790
KIOSK_PORT=8791       # on the Pi: the page the iPhone opens
ATM_SERVER_PORT=8792  # on the Pi, localhost only: the kiosk page forwards /api to it
WEBSITE_PORT=4173

step() { printf '\n\033[1;32m▸ %s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '  \033[1;33m! %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

usage() {
  # The comment block at the top of this file, without the leading "# ".
  awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"
  exit 1
}

# Runs a command, keeping its output in a log shown only if it fails.
quietly() {
  local log="$DEMO_DIR/last-command.log"
  if ! "$@" >"$log" 2>&1; then
    cat "$log" >&2
    die "failed: $*"
  fi
}

# ============================================================== arguments

# Options anywhere; the rest are the address and the password, in this order.
SKIP_MPC=0
ARGS=()
for argument in "$@"; do
  case "$argument" in
    --skip-mpc) SKIP_MPC=1 ;;
    -h | --help) usage ;;
    -*) die "unknown option \"$argument\" (see: scripts/atm-demo.sh --help)" ;;
    *) ARGS+=("$argument") ;;
  esac
done
[ "${#ARGS[@]}" -ge 1 ] && [ "${#ARGS[@]}" -le 2 ] || usage
ADDRESS="${ARGS[0]}"
# The user is what comes before the first "@", the host what comes after the
# last one: "ale@192.168.1.129" and a repeated "ale@ale@192.168.1.129" both
# mean user ale on 192.168.1.129. (ssh itself splits at the last "@", so a
# repeated user would otherwise log in as the user "ale@ale".)
case "$ADDRESS" in
  *@*) PI_USER="${ADDRESS%%@*}"; PI_HOST="${ADDRESS##*@}" ;;
  *) PI_USER="${PI_USER:-pi}"; PI_HOST="$ADDRESS" ;;
esac
[ -n "$PI_USER" ] && [ -n "$PI_HOST" ] || die "the address must be user@host (e.g. ale@192.168.1.129), not \"$ADDRESS\""
TARGET="$PI_USER@$PI_HOST"
PI_SSH_PORT="${PI_SSH_PORT:-22}"
PASSWORD="${ARGS[1]:-}"

ask_password() {
  [ -n "$PASSWORD" ] && return
  [ -t 0 ] || die "the Pi needs a password: pass it as the second argument"
  read -r -s -p "  password for $TARGET: " PASSWORD
  echo
  [ -n "$PASSWORD" ] || die "no password given"
}

mkdir -p "$DEMO_DIR"
chmod 700 "$DEMO_DIR"

# ============================================================== this computer

step "Checking this computer"
for tool in node pnpm ssh ssh-keygen rsync tmux openssl lsof awk; do
  command -v "$tool" >/dev/null || die "missing \"$tool\" on this computer"
done

# The issuance server runs here, with its configuration. The ATM gets the
# first ATM token of .env.issuance (NEARCASH_ATM_TOKENS=name:token,...).
[ -f "$ROOT/.env.issuance" ] || die ".env.issuance is missing: the issuance server runs on this computer (template: .env.issuance.example)"
ATM_TOKEN="$(sed -n 's/^NEARCASH_ATM_TOKENS=//p' "$ROOT/.env.issuance" | tail -1 | tr -d "\"' " | cut -d, -f1 | cut -d: -f2-)"
[ -n "$ATM_TOKEN" ] || die "NEARCASH_ATM_TOKENS in .env.issuance has no token (format: name:token)"
info "issuance server configuration: .env.issuance"
# Who signs the certificates. --skip-mpc wins over .env.issuance; without it
# the file decides (NEARCASH_SKIP_MPC, false by default).
if [ "$SKIP_MPC" = 0 ]; then
  case "$(sed -n 's/^NEARCASH_SKIP_MPC=//p' "$ROOT/.env.issuance" | tail -1 | tr -d "\"' " | tr '[:upper:]' '[:lower:]')" in
    true | 1) SKIP_MPC=1 ;;
  esac
fi
if [ "$SKIP_MPC" = 1 ]; then
  CERTIFICATES="signed by the issuance server with the public DEV key (MPC skipped): demo banknotes"
  warn "MPC skipped: the issuance server signs the certificates itself (public DEV key)."
  warn "Only the wallet app's Debug builds accept these banknotes."
else
  CERTIFICATES="signed by the NEAR MPC network, through the issuer contract"
  info "certificates: NEAR MPC (add --skip-mpc to sign them on this computer, for a demo)"
fi

# A previous run of the demo: stop it, so its ports are free again.
if tmux has-session -t "$SESSION" 2>/dev/null; then
  tmux kill-session -t "$SESSION"
  info "stopped the previous \"$SESSION\" session"
fi
for port in "$ISSUANCE_PORT" "$WEBSITE_PORT"; do
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    lsof -nP -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1 || break
    sleep 0.5
  done
  pid="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1 || true)"
  [ -z "$pid" ] || die "port $port is in use by $(ps -p "$pid" -o comm= | xargs basename) (PID $pid): stop it and run again"
done
info "ports $ISSUANCE_PORT, $WEBSITE_PORT free"

# ============================================================== SSH

step "Connecting to the Pi as user \"$PI_USER\" on $PI_HOST (SSH port $PI_SSH_PORT)"
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
if [ ! -f "$KEY" ]; then
  ssh-keygen -q -t ed25519 -N '' -C "nearcash-atm-demo" -f "$KEY"
  info "created the SSH key ~/.ssh/nearcash_atm_ed25519"
fi

# One shared connection for all the setup commands (fast, one login).
CONTROL_DIR="$(mktemp -d /tmp/ncssh.XXXXXX)"   # short path: socket names are limited to ~100 characters
close_ssh() {
  ssh -o ControlPath="$CONTROL_DIR/master" -O exit "$TARGET" >/dev/null 2>&1 || true
  rm -rf "$CONTROL_DIR"
}
trap close_ssh EXIT
SSH_BASE=(-p "$PI_SSH_PORT" -i "$KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -o ServerAliveInterval=15)
SSH_SHARED=("${SSH_BASE[@]}" -o ControlMaster=auto -o "ControlPath=$CONTROL_DIR/master" -o ControlPersist=120)
pi() { ssh "${SSH_SHARED[@]}" "$TARGET" "$@"; }
RSYNC_SSH="ssh $(printf '%q ' "${SSH_SHARED[@]}")"

# First a try with the key only (no password prompt). Its error tells a
# network problem apart from a missing key, so a password is never asked
# for — or blamed — when the Pi simply can't be reached.
if probe="$(ssh "${SSH_BASE[@]}" -o BatchMode=yes "$TARGET" true 2>&1)"; then
  info "logged in with the SSH key"
else
  case "$probe" in
    *"No route to host"* | *"Network is unreachable"* | *"timed out"* | *"Connection refused"* | *"Could not resolve"*)
      die "cannot reach $PI_HOST on port $PI_SSH_PORT (${probe##*: })
  - is the Pi on, with SSH enabled, on this computer's network? (ping $PI_HOST)
  - macOS: the app you run this script from needs Local Network access
    (System Settings → Privacy & Security → Local Network). A terminal inside
    VS Code or Cursor may lack it while Terminal or iTerm has it.
  - has its address changed? Try $PI_USER@raspberrypi.local (or its new IP)."
      ;;
  esac
  # First time: log in with the password (handed to ssh by a tiny askpass
  # helper, so no extra tool is needed) and install the key.
  ask_password
  askpass="$CONTROL_DIR/askpass"
  printf '#!/bin/sh\nprintf "%%s\\n" "$NEARCASH_PI_PASSWORD"\n' >"$askpass"
  chmod 700 "$askpass"
  public_key="$(cat "$KEY.pub")"
  NEARCASH_PI_PASSWORD="$PASSWORD" SSH_ASKPASS="$askpass" SSH_ASKPASS_REQUIRE=force \
    ssh -p "$PI_SSH_PORT" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 \
      -o PubkeyAuthentication=no -o PreferredAuthentications=password,keyboard-interactive \
      -o NumberOfPasswordPrompts=1 "$TARGET" \
      "umask 077 && mkdir -p ~/.ssh && touch ~/.ssh/authorized_keys && (grep -qxF '$public_key' ~/.ssh/authorized_keys || echo '$public_key' >> ~/.ssh/authorized_keys)" \
      </dev/null || die "could not log in as \"$PI_USER\" on $PI_HOST with that password (check it with: ssh -p $PI_SSH_PORT $TARGET)"
  ssh "${SSH_BASE[@]}" -o BatchMode=yes "$TARGET" true || die "the SSH key was installed but the Pi does not accept it"
  info "SSH key installed: next time no password is needed"
fi

PI_HOSTNAME="$(pi hostname)"
PI_HOME="$(pi 'printf %s "$HOME"')"
case "$PI_HOST" in
  *[!0-9.]*) PI_ADDRESS="$(pi 'hostname -I 2>/dev/null' | awk '{ print $1 }')" ;;   # a name: ask the Pi
  *) PI_ADDRESS="$PI_HOST" ;;                                                      # already an IPv4 address
esac
[ -n "$PI_ADDRESS" ] || die "could not find the Pi's IP address: pass the IP instead of the name"
# How the Pi reaches this computer: the address its SSH connection comes from.
LAPTOP_ADDRESS="${LAPTOP_ADDRESS:-$(pi 'printf %s "${SSH_CONNECTION%% *}"')}"
info "Pi: $PI_HOSTNAME ($PI_ADDRESS) · this computer, as the Pi sees it: $LAPTOP_ADDRESS"

# ============================================================== the Pi

step "Preparing the Pi (Node.js, pnpm, mDNS)"
pi "cat > /tmp/nearcash-pi-setup.sh" <"$ROOT/scripts/atm-pi-setup.sh"
# Already set up (a redeploy): nothing to install, no sudo needed.
if pi "bash /tmp/nearcash-pi-setup.sh --check"; then
  info "Node.js $(pi 'node -v'), pnpm and the tools are already there"
elif pi "sudo -n true" 2>/dev/null; then
  pi "sudo bash /tmp/nearcash-pi-setup.sh"
else
  ask_password
  printf '%s\n' "$PASSWORD" | pi "sudo -S -p '' bash /tmp/nearcash-pi-setup.sh"
fi

# ============================================================== build here

step "Building on this computer"
cd "$ROOT"
quietly pnpm install --frozen-lockfile
quietly pnpm issuance:build
info "issuance server → apps/issuance/dist"
quietly pnpm atm:build
info "ATM server → apps/atm/dist"
quietly pnpm kiosk:build
info "kiosk page → apps/kiosk/dist"
quietly pnpm website:build
info "website → apps/website/dist"

# ============================================================== deploy

step "Copying the ATM to the Pi (~/$REMOTE_DIR)"
# The workspace without what the Pi doesn't run. Never copied: secrets
# (.env*, the issuance server's sales), the iOS app, the applet, the contract.
# The builds (apps/atm/dist, apps/kiosk/dist) are copied: the Pi builds nothing.
# Excluded paths are also kept on the Pi by --delete: its .env.atm, its
# certificate (.atm-tls) and the session's scripts (.atm-run) survive a redeploy.
quietly rsync -az --delete -e "$RSYNC_SSH" \
  --exclude=node_modules/ --exclude=.git/ --exclude=.atm-demo/ --exclude=/.atm-tls/ --exclude=/.atm-run/ \
  --exclude=/ios/ --exclude=/applet/ --exclude=/contracts/ --exclude=/apps/website/dist/ \
  --exclude='.env*' --exclude='issuance-sales.json*' --exclude='issuance-refunds.json*' --exclude='*.secret.json' --exclude=.DS_Store \
  "$ROOT/" "$TARGET:$REMOTE_DIR/"
info "code copied"
# Only the ATM server and the kiosk page, and what they need to run, without
# development tools.
pi "cd ~/$REMOTE_DIR && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile --prod --filter '@nearcash/atm...' --filter '@nearcash/kiosk...'" \
  >"$DEMO_DIR/last-command.log" 2>&1 || { cat "$DEMO_DIR/last-command.log" >&2; die "pnpm install failed on the Pi"; }
info "dependencies installed on the Pi"

# ============================================================== HTTPS

step "HTTPS for the kiosk page (the pairing key never crosses the Wi-Fi in clear)"
CA_FILE=""
# mkcert makes the local certificate authority and the certificate. Installed
# with Homebrew when missing (a one-time development tool on this computer).
if ! command -v mkcert >/dev/null && command -v brew >/dev/null; then
  info "installing mkcert with Homebrew (once)"
  quietly brew install mkcert
fi
if command -v mkcert >/dev/null; then
  # A certificate for every name the iPhone may use, from this computer's
  # local CA (created by mkcert on first use; it never leaves this computer).
  quietly mkcert -cert-file "$DEMO_DIR/atm.pem" -key-file "$DEMO_DIR/atm-key.pem" \
    "$PI_HOSTNAME.local" "$PI_ADDRESS" localhost 127.0.0.1
  pi "mkdir -p ~/$REMOTE_DIR/.atm-tls && chmod 700 ~/$REMOTE_DIR/.atm-tls"
  quietly rsync -a -e "$RSYNC_SSH" "$DEMO_DIR/atm.pem" "$DEMO_DIR/atm-key.pem" "$TARGET:$REMOTE_DIR/.atm-tls/"
  SCHEME=https
  CA_FILE="$(mkcert -CAROOT)/rootCA.pem"
  info "certificate for $PI_HOSTNAME.local and $PI_ADDRESS"
else
  SCHEME=http
  warn "mkcert not available (no Homebrew): the kiosk runs on plain HTTP, so the pairing key"
  warn "crosses the Wi-Fi in clear. Install mkcert and run this again."
fi

# ============================================================== ATM configuration

step "Configuring the ATM (~/$REMOTE_DIR/.env.atm on the Pi)"
# Keep the pairing key of a previous run: the iPhone stays paired. A new key
# means the iPhone must pair again (the pairing QR image opens by itself).
KIOSK_KEY="$(pi "sed -n 's/^NEARCASH_KIOSK_KEY=//p' ~/$REMOTE_DIR/.env.atm 2>/dev/null" || true)"
NEW_KIOSK_KEY=0
if [ -z "$KIOSK_KEY" ]; then
  KIOSK_KEY="$(openssl rand -hex 24)"
  NEW_KIOSK_KEY=1
fi
{
  echo "# Written by scripts/atm-demo.sh on $(date '+%Y-%m-%d %H:%M'): run it again to update."
  echo "# ATM server (apps/atm)"
  echo "NEARCASH_ISSUANCE_URL=http://$LAPTOP_ADDRESS:$ISSUANCE_PORT"
  echo "NEARCASH_ATM_TOKEN=$ATM_TOKEN"
  echo "NEARCASH_ATM_HOST=127.0.0.1"
  echo "NEARCASH_ATM_PORT=$ATM_SERVER_PORT"
  echo "NEARCASH_KIOSK_KEY=$KIOSK_KEY"
  echo "NEARCASH_CASSETTE=pcsc   # the NFC reader; out of service until a blank card is on it"
  echo "NEARCASH_DISPENSER=sim"
  echo "# kiosk page (apps/kiosk)"
  echo "NEARCASH_KIOSK_HOST=0.0.0.0"
  echo "NEARCASH_KIOSK_PORT=$KIOSK_PORT"
  echo "NEARCASH_ATM_SERVER_URL=http://127.0.0.1:$ATM_SERVER_PORT"
  if [ "$SCHEME" = https ]; then
    echo "NEARCASH_KIOSK_TLS_CERT=$PI_HOME/$REMOTE_DIR/.atm-tls/atm.pem"
    echo "NEARCASH_KIOSK_TLS_KEY=$PI_HOME/$REMOTE_DIR/.atm-tls/atm-key.pem"
  fi
} | pi "umask 077 && cat > ~/$REMOTE_DIR/.env.atm"
info "issuance server at $LAPTOP_ADDRESS, kiosk on $SCHEME://$PI_ADDRESS:$KIOSK_PORT"

# ============================================================== the ATM's session on the Pi

# Each service runs in a small generated script: the service, and when it
# stops, a prompt to start it again (so a crash doesn't close its pane).
#   loop_script <file> <directory> <name> <command> [message when it stops]
loop_script() {
  local stopped="${5:-— $3 stopped.   Enter: start it again   ·   Ctrl-C: close this pane}"
  cat >"$1" <<EOF
#!/usr/bin/env bash
# Generated by scripts/atm-demo.sh: the $3 pane.
cd $(printf %q "$2")
# Ctrl-C stops the service, not this loop. (A trap, not an ignore: the
# service still gets the normal Ctrl-C behaviour.)
trap ':' INT
while :; do
  $4
  echo
  echo "$stopped"
  read -r _ || exit 0
done
EOF
  chmod 700 "$1"
}

# The kiosk by the Pi's IP on the local network, not by <hostname>.local: an iPhone
# doesn't always find a .local name (some routers block mDNS), an IP always works.
# The certificate covers both. Give the Pi a fixed IP in the router: the iPhone's
# Home Screen icon keeps this address.
KIOSK_URL="$SCHEME://$PI_ADDRESS:$KIOSK_PORT"
PAIRING_URL="$KIOSK_URL/#key=$KIOSK_KEY"
PORT_OPTION=""
[ "$PI_SSH_PORT" = 22 ] || PORT_OPTION="-p $PI_SSH_PORT "
# The command that opens the Pi's session from any terminal of this computer.
CONNECT_COMMAND="ssh -t -i ~/.ssh/nearcash_atm_ed25519 ${PORT_OPTION}$TARGET tmux attach -t $PI_SESSION"

step "Starting the ATM on the Pi (tmux session \"$PI_SESSION\" there)"
PI_RUN="$DEMO_DIR/pi"   # scripts for the Pi, copied to ~/nearcash/.atm-run
rm -rf "$PI_RUN"
mkdir -p "$PI_RUN"
loop_script "$PI_RUN/atm-server.sh" "$PI_HOME/$REMOTE_DIR" "ATM server" "node apps/atm/dist/server/main.js"
loop_script "$PI_RUN/kiosk.sh" "$PI_HOME/$REMOTE_DIR/apps/kiosk" "kiosk page" "node node_modules/vite/bin/vite.js preview"
# (Re)starts the session. The tmux server keeps it alive after SSH closes.
# The pkill patterns are anchored on "node …", so they never match this
# script's own command line.
cat >"$PI_RUN/start-session.sh" <<EOF
#!/usr/bin/env bash
# Generated by scripts/atm-demo.sh: (re)starts the ATM's tmux session on the Pi.
set -euo pipefail
cd $(printf %q "$PI_HOME/$REMOTE_DIR")
tmux kill-session -t $PI_SESSION 2>/dev/null || true
pkill -f '^node apps/atm/dist/server/main.js' || true
pkill -f '^node node_modules/vite/bin/vite.js preview' || true
tmux new-session -d -s $PI_SESSION -n atm -x 200 -y 50 .atm-run/atm-server.sh
tmux set-option -t $PI_SESSION mouse on
tmux set-option -t $PI_SESSION remain-on-exit on
tmux set-option -t $PI_SESSION pane-border-status top
tmux set-option -t $PI_SESSION pane-border-format ' #{?pane_active,#[bold],}#{@label} '
atm="\$(tmux display-message -p -t $PI_SESSION:atm '#{pane_id}')"
kiosk="\$(tmux split-window -v -P -F '#{pane_id}' -t "\$atm" .atm-run/kiosk.sh)"
tmux set-option -p -t "\$atm" @label 'ATM server · 127.0.0.1:$ATM_SERVER_PORT (this Pi only)'
tmux set-option -p -t "\$kiosk" @label 'kiosk page · $KIOSK_URL'
tmux select-pane -t "\$atm"
EOF
pi "mkdir -p ~/$REMOTE_DIR/.atm-run && chmod 700 ~/$REMOTE_DIR/.atm-run"
quietly rsync -a --delete -e "$RSYNC_SSH" "$PI_RUN/" "$TARGET:$REMOTE_DIR/.atm-run/"
pi "bash ~/$REMOTE_DIR/.atm-run/start-session.sh"
info "ATM server and kiosk page running in the Pi's session \"$PI_SESSION\""

# ============================================================== this computer's panes

LOCAL_RUN="$DEMO_DIR/panes"
rm -rf "$LOCAL_RUN"
mkdir -p "$LOCAL_RUN"
# The Pi's session, inside a pane here. TERM is set to one every Pi knows
# (this tmux's own terminal type may have no terminfo entry there).
loop_script "$LOCAL_RUN/raspberry.sh" "$ROOT" "Raspberry Pi" \
  "ssh -t $(printf '%q ' "${SSH_BASE[@]}") $(printf %q "$TARGET") $(printf %q "TERM=xterm-256color tmux attach -t $PI_SESSION")" \
  "— disconnected from the Pi (the ATM keeps running there).   Enter: reconnect"
# NEARCASH_SKIP_MPC is set explicitly either way, so the pane does what this
# run says (variables set here win over .env.issuance).
SKIP_MPC_VALUE=false
[ "$SKIP_MPC" = 1 ] && SKIP_MPC_VALUE=true
loop_script "$LOCAL_RUN/issuance.sh" "$ROOT" "issuance server" \
  "NEARCASH_ISSUANCE_HOST=0.0.0.0 NEARCASH_ISSUANCE_PORT=$ISSUANCE_PORT NEARCASH_SKIP_MPC=$SKIP_MPC_VALUE node apps/issuance/dist/main.js"
loop_script "$LOCAL_RUN/website.sh" "$ROOT" "website" \
  "pnpm --filter @nearcash/website exec vite preview --host 0.0.0.0 --port $WEBSITE_PORT --strictPort"

# The info window: addresses, the pairing QR code, the iPhone steps.
{
  echo "NearCash ATM demo"
  echo
  echo "  Kiosk (iPhone)     $KIOSK_URL    or    $SCHEME://$PI_HOSTNAME.local:$KIOSK_PORT"
  echo "  Website            http://localhost:$WEBSITE_PORT    ·    http://$LAPTOP_ADDRESS:$WEBSITE_PORT"
  echo "  Issuance server    http://$LAPTOP_ADDRESS:$ISSUANCE_PORT   (configuration: .env.issuance)"
  echo "  Certificates       $CERTIFICATES"
  echo
  echo "The Pi's session, directly (ATM server and kiosk page; Ctrl-b d leaves it running):"
  echo "  $CONNECT_COMMAND"
  echo
  echo "On the iPhone, once:"
  if [ -n "$CA_FILE" ]; then
    echo "  1. Trust this computer's certificate authority: AirDrop"
    echo "       $CA_FILE"
    echo "     to the iPhone, install it (Settings → General → VPN & Device Management),"
    echo "     then turn it on (Settings → General → About → Certificate Trust Settings)."
  else
    echo "  1. (No HTTPS: install mkcert and run the script again, so the pairing key is encrypted.)"
  fi
  echo "  2. Pair the screen: scan the pairing QR code with the Camera app. It scans best"
  echo "     as an image:   open .atm-demo/pairing-qr.png"
  echo "     (it is also drawn below, and in the tmux session's window \"info\": Ctrl-b 1; the"
  echo "     terminal needs about 90 × 45 for it, Cmd - makes the font smaller), or open"
  echo "       $PAIRING_URL"
  echo "  3. On the page the QR code opened: Share → Add to Home Screen (its address keeps the"
  echo "     key, so the Home Screen app pairs itself), open it from there (full screen), and lock"
  echo "     it with Guided Access (Settings → Accessibility → Guided Access). Turn off Auto-Lock."
  echo
  echo "tmux: Ctrl-b and an arrow moves between panes · Ctrl-b 0 / 1 switches windows ·"
  echo "      Ctrl-b d leaves (everything keeps running) · tmux attach -t $SESSION comes back ·"
  echo "      tmux kill-session -t $SESSION stops this computer's part (the Pi keeps its own)."
  echo "      In the Raspberry Pi pane, the Pi's tmux takes Ctrl-b twice (Ctrl-b Ctrl-b o: its other pane)."
  echo "No NFC reader yet: the kiosk shows \"Out of service\" and no sale can start."
  echo "macOS may ask once whether node can accept incoming connections: allow it (the Pi calls the issuance server)."
  echo "The issuance server listens on the LAN for the Pi: use a network you trust."
} >"$DEMO_DIR/info.txt"
chmod 600 "$DEMO_DIR/info.txt"
# The QR code of the pairing address, twice (qrcode is a dependency of apps/kiosk):
#   pairing-qr.png   an image (large modules, white quiet zone): it always scans
#   pairing-qr.txt   for the terminal. Each module is two blank cells painted with a
#                    background colour (256-colour black 16 and white 231): a background
#                    fills the whole cell, the space between lines included, so the
#                    modules are solid squares whatever the font. Block characters
#                    (▀ ▄ █) leave gaps between the lines, and the iPhone's camera
#                    doesn't find the code. It needs a window (size + 8) × 2 columns
#                    wide and size + 8 lines high: about 90 × 45 for this address.
(cd "$ROOT/apps/kiosk" && node -e '
  const QRCode = require("qrcode");
  const [url, imageFile] = process.argv.slice(1);
  QRCode.toFile(imageFile, url, { width: 720, margin: 4 }, (error) => {
    if (error) throw error;
  });
  const { modules } = QRCode.create(url, { errorCorrectionLevel: "M" });
  const quiet = 4;                       // the standard light margin round the code, in modules
  const dark = "\x1b[48;5;16m  ";        // a dark module: two cells on a black background
  const light = "\x1b[48;5;231m  ";      // a light module: two cells on a white background
  const lines = [];
  for (let row = -quiet; row < modules.size + quiet; row++) {
    let line = "";
    for (let column = -quiet; column < modules.size + quiet; column++) {
      const inside = row >= 0 && column >= 0 && row < modules.size && column < modules.size;
      line += inside && modules.get(row, column) ? dark : light;
    }
    lines.push(line + "\x1b[0m");
  }
  process.stdout.write(lines.join("\n") + "\n");
' "$PAIRING_URL" "$DEMO_DIR/pairing-qr.png") >"$DEMO_DIR/pairing-qr.txt"
chmod 600 "$DEMO_DIR/pairing-qr.txt" "$DEMO_DIR/pairing-qr.png"
cat >"$LOCAL_RUN/info.sh" <<EOF
#!/usr/bin/env bash
# Generated by scripts/atm-demo.sh: the info window of the tmux session.
cd $(printf %q "$ROOT")
cat .atm-demo/info.txt
echo
cat .atm-demo/pairing-qr.txt
exec "\${SHELL:-bash}"
EOF
chmod 700 "$LOCAL_RUN/info.sh"

# ============================================================== this computer's session

step "Starting the tmux session \"$SESSION\" here"
COLUMNS_NOW="$(tput cols 2>/dev/null || echo 200)"
LINES_NOW="$(tput lines 2>/dev/null || echo 50)"
tmux new-session -d -s "$SESSION" -n demo -x "$COLUMNS_NOW" -y "$LINES_NOW" "$LOCAL_RUN/raspberry.sh"
tmux set-option -t "$SESSION" mouse on                # click a pane, scroll its history
tmux set-option -t "$SESSION" remain-on-exit on       # a pane that ends stays readable
tmux set-option -t "$SESSION" pane-border-status top
# Each pane shows its @label (programs can't overwrite it, unlike the pane title).
tmux set-option -t "$SESSION" pane-border-format ' #{?pane_active,#[bold],}#{@label} '

pi_pane="$(tmux display-message -p -t "$SESSION:demo" '#{pane_id}')"
issuance_pane="$(tmux split-window -h -l 40% -P -F '#{pane_id}' -t "$pi_pane" "$LOCAL_RUN/issuance.sh")"
website_pane="$(tmux split-window -v -P -F '#{pane_id}' -t "$issuance_pane" "$LOCAL_RUN/website.sh")"
tmux set-option -p -t "$pi_pane" @label "Raspberry Pi $PI_HOSTNAME · its session \"$PI_SESSION\": ATM server and kiosk page"
tmux set-option -p -t "$issuance_pane" @label "issuance server · :$ISSUANCE_PORT"
tmux set-option -p -t "$website_pane" @label "website · http://localhost:$WEBSITE_PORT"
tmux new-window -d -t "$SESSION" -n info "$LOCAL_RUN/info.sh"
tmux select-window -t "$SESSION:demo"
tmux select-pane -t "$pi_pane"

# The same text as the info window, with the pairing QR code under it.
cat "$DEMO_DIR/info.txt"
echo
cat "$DEMO_DIR/pairing-qr.txt"
close_ssh
trap - EXIT

# The last lines on screen: how to reach the Pi's session directly.
printf '\n\033[1;32m▸ Ready.\033[0m The Pi'"'"'s session, from any terminal of this computer:\n  %s\n' "$CONNECT_COMMAND"

# A new pairing key: show the pairing QR image straight away (macOS Preview).
if [ "$NEW_KIOSK_KEY" = 1 ] && command -v open >/dev/null; then
  echo "  (new pairing key: the pairing QR image opens now, scan it with the iPhone)"
  open "$DEMO_DIR/pairing-qr.png" || true
fi

if [ -n "${TMUX:-}" ]; then
  tmux switch-client -t "$SESSION"
elif [ -t 0 ] && [ -t 1 ]; then
  echo "  (opening this computer's session \"$SESSION\" in 3 seconds; Ctrl-b 1 shows the pairing QR code,"
  echo "   Ctrl-b d brings you back here)"
  sleep 3
  exec tmux attach -t "$SESSION"
else
  echo
  echo "This computer's session: tmux attach -t $SESSION"
fi
