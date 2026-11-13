# NearCash: notes for coding agents

NearCash makes offline bearer banknotes: NFC Java Cards backed by USDC on
NEAR Intents (FAR) and certified by the NEAR MPC network. Start with
[README.md](README.md). It explains every component, and its section
"Run it on a computer" is how to run the project. The card protocol is
specified in [docs/protocol.md](docs/protocol.md).

## Run it and check it works

Needs Node.js ≥ 22.18, pnpm 10 (`corepack enable`) and Java ≥ 17 (for the
card emulator; `pnpm local` finds it through `JAVA_HOME`, the PATH or
Homebrew).

1. `pnpm install`. Its warning "Ignored build scripts" is expected:
   nothing needs those scripts. Don't run `pnpm approve-builds`.
2. `pnpm test`, then `pnpm typecheck`: every TypeScript package. No
   hardware or network needed.
3. `pnpm local` starts the card emulator (the real applet in jCardSim), the
   issuance server, the ATM server and the kiosk page. It keeps running:
   start it in the background and wait for the line `NearCash is running`
   (the first run builds the emulator with Gradle: up to a few minutes).
   Its output is prefixed `[emulator]`, `[issuance]`, `[atm]` and `[kiosk]`.
4. `pnpm local:sale` buys a banknote through the kiosk API, as the ATM's
   screen does, and prints each stage, from `awaiting_payment` to
   `dispensed`. Then it checks the banknote handed out with the wallet's
   own check, and changes its PIN as a new holder would. It exits 0 when
   every step passes (about 15 s) and can be run again for the next card.
5. Stop `pnpm local` with Ctrl-C (SIGINT): it stops the four programs.

Every step of the sale is real code on a real applet. Only these are
stood in for: the card (jCardSim), payments and the reserve (simulated),
and NEAR MPC (a public DEV key signs). See the README.

The other parts:

- **The card's applet:** `pnpm applet:test` (it finds Java 17+ as
  `pnpm local` does).
- **The issuer contract:** `cargo test` in `contracts/issuer`.
- **The iOS wallet:** macOS only, see the README's table.

## Don't

- Don't create, edit or print `.env.issuance`, `.env.atm` or
  `ios/Secrets.xcconfig`: they can hold real keys. `pnpm local` needs none
  of them.
- Don't run the commands that need the ATM's hardware or real accounts:
  - the Raspberry Pi and the NFC reader: `pnpm atm:demo`, `pnpm atm:reader`,
    `pnpm atm:servos`, `pnpm atm:cycle`;
  - commands that write real cards: `pnpm test:card`, `pnpm card:reset`,
    `pnpm card:birth`;
  - real money or NEAR accounts: `pnpm issuance:check`,
    `pnpm issuance:fund-reserve`, `pnpm issuer:admin`, `pnpm test:mpc-live`.

## Where things are

| Path | What | Built with |
| --- | --- | --- |
| `applet/` | the Java Card applet on each banknote | Gradle, jCardSim for tests |
| `contracts/issuer/` | the NEAR contract that has certificates signed by MPC | Rust, near-sdk |
| `apps/issuance/` | the issuance server: quotes, payments, the reserve, certificates, refunds | NestJS |
| `apps/atm/` | the ATM server on the Raspberry Pi: the sale, the reader, the servos | NestJS |
| `apps/kiosk/` | the ATM's screen, shown on an iPhone | React, Vite |
| `apps/website/` | the public site | React, Vite |
| `packages/core/` | the card protocol, certificates, the MPC signer, the sale flow | TypeScript |
| `packages/kiosk-api/` | the API between the kiosk page and the ATM server | TypeScript |
| `ios/` | the wallet app: checks, takes over and redeems banknotes | SwiftUI, XcodeGen |
| `hardware/atm/` | the 3D-printed ATM and its servo scripts | OpenSCAD, Python |
| `scripts/` | deploy, real-card tests, and `pnpm local` | bash, Node.js |
| `applet/src/emulator/` | the card emulator for `pnpm local`: hopper, reader and turret | Java, jCardSim |
