#!/usr/bin/env bash
# Prepares a Raspberry Pi to run the NearCash ATM (server and kiosk page). Runs ON the Pi,
# as root; scripts/atm-demo.sh copies it there and runs it. Safe to run again:
# every step checks first and only changes what is missing.
#
#   - Node.js >= 22.18 (official build from nodejs.org, checksum verified),
#   - pnpm through Corepack (the version pinned in package.json),
#   - rsync (to receive the code), tmux (the ATM runs in a session on the Pi)
#     and Avahi (so the iPhone finds the Pi as <hostname>.local),
#   - pcscd and the CCID driver, for the NFC reader (PC/SC); PN533-based
#     readers (ACR122U) also need the kernel's own NFC driver kept away.
#
#   atm-pi-setup.sh           install what is missing (as root)
#   atm-pi-setup.sh --check   exit 0 if nothing is missing (any user, changes nothing)
set -euo pipefail

NODE_VERSION=22.21.1   # same as the development machines
# Keeps Linux's own NFC driver off PN533-based readers (ACR122U): it would
# take the reader before pcscd. Harmless for other readers.
NFC_BLACKLIST=/etc/modprobe.d/nearcash-nfc-reader.conf

log() { printf '  [pi] %s\n' "$*"; }

node_is_recent_enough() {
  command -v node >/dev/null || return 1
  node -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    process.exit(major > 22 || (major === 22 && minor >= 18) ? 0 : 1);
  '
}

# System packages that are missing, as apt package names. Paths, not
# `command -v`, for daemons: /usr/sbin is not in a normal user's PATH.
missing_packages() {
  local missing=""
  command -v curl >/dev/null || missing="$missing curl"
  command -v xz >/dev/null || missing="$missing xz-utils"
  command -v rsync >/dev/null || missing="$missing rsync"
  command -v tmux >/dev/null || missing="$missing tmux"
  [ -x /usr/sbin/avahi-daemon ] || missing="$missing avahi-daemon"
  # The NFC reader: the PC/SC daemon, its library (loaded by pcsc-mini) and
  # the CCID driver most USB readers use.
  [ -x /usr/sbin/pcscd ] || missing="$missing pcscd"
  ls /usr/lib/*/libpcsclite.so.1 >/dev/null 2>&1 || missing="$missing libpcsclite1"
  [ -d /usr/lib/pcsc/drivers/ifd-ccid.bundle ] || missing="$missing libccid"
  printf '%s' "$missing"
}

if [ "${1:-}" = "--check" ]; then
  [ -z "$(missing_packages)" ] && node_is_recent_enough && command -v pnpm >/dev/null && [ -f "$NFC_BLACKLIST" ]
  exit
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "run me as root (sudo)" >&2
  exit 1
fi

# ---------------------------------------------------------------- system packages
# Only touch apt when something is actually missing (apt-get update is slow on a Pi).
missing="$(missing_packages)"
if [ -n "$missing" ]; then
  log "installing:$missing"
  apt-get update -qq
  # shellcheck disable=SC2086 # the list is meant to split into words
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq $missing >/dev/null
fi
systemctl enable --now avahi-daemon >/dev/null 2>&1 || log "warning: avahi-daemon not running: use the IP address instead of <hostname>.local"

# ---------------------------------------------------------------- NFC reader (PC/SC)
if [ ! -f "$NFC_BLACKLIST" ]; then
  log "keeping the kernel's NFC driver off the reader ($NFC_BLACKLIST)"
  printf '%s\n' '# Written by NearCash atm-pi-setup.sh: pcscd drives the NFC reader.' \
    'blacklist pn533_usb' 'blacklist pn533' 'blacklist nfc' > "$NFC_BLACKLIST"
  # Unload them now if a reader is already plugged in (otherwise: next boot).
  modprobe -r pn533_usb pn533 nfc 2>/dev/null || true
fi
systemctl enable --now pcscd.socket >/dev/null 2>&1 || log "warning: pcscd not running: the ATM will say the PC/SC service is not available"

# ---------------------------------------------------------------- Node.js
if node_is_recent_enough; then
  log "Node.js $(node -v) already installed"
else
  case "$(uname -m)" in
    aarch64 | arm64) arch=arm64 ;;
    armv7l) arch=armv7l ;;
    x86_64) arch=x64 ;;
    *) echo "unsupported CPU: $(uname -m)" >&2; exit 1 ;;
  esac
  file="node-v${NODE_VERSION}-linux-${arch}.tar.xz"
  log "installing Node.js ${NODE_VERSION} (${arch}) into /usr/local"
  workdir="$(mktemp -d)"
  trap 'rm -rf "$workdir"' EXIT
  curl -fsSL -o "$workdir/$file" "https://nodejs.org/dist/v${NODE_VERSION}/${file}"
  curl -fsSL -o "$workdir/SHASUMS256.txt" "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"
  # Refuse a download whose checksum doesn't match the official list.
  (cd "$workdir" && grep " ${file}\$" SHASUMS256.txt | sha256sum -c --quiet -)
  tar -xJf "$workdir/$file" -C /usr/local --strip-components=1 --no-same-owner
  log "Node.js $(node -v) installed"
fi

# ---------------------------------------------------------------- pnpm
# Corepack ships with Node and runs the exact pnpm version of package.json.
if ! command -v pnpm >/dev/null; then
  log "enabling pnpm (Corepack)"
  corepack enable
fi
log "ready"
