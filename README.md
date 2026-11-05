# NearCash

Digital bearer cash on NFC cards. Each card **is** a banknote: its value sits
on NEAR Intents (FAR, the private variant) in an account that only the card's
chip can spend, once. Banknotes change hands like cash, offline: any phone
can check one without a server.

**The bank is trusted only while a banknote is created.** Once issued, a
banknote no longer needs the bank at all: checking it, handing it over and
redeeming it involve only the card, a phone and FAR.

## The system

![How a banknote is made, then redeemed, step by step](docs/images/sale-flow.svg)

**The banknote** (`applet/`) is an NFC Java Card (NXP JCOP4 J3R180) running
the NearCash applet. Its two keys are born in the chip and never leave it:
key **A** proves the card is genuine, key **F** owns the card's account on
FAR and signs exactly once, with the holder's PIN, to redeem it. A card goes
from blank, to issued, to spent, and never back.

**The issuance server** (`apps/issuance`) is the bank: the only place where
banknotes get their value. For each sale it asks 1Click for a quote that pays
the bank's reserve inside FAR, checks the payment itself (it never believes
an ATM), moves the banknote's value from the reserve to the card's own
account, and has the certificate signed. One payment buys exactly one card.
It also gives back what can't become a banknote (a failed swap, a payment
after the deadline, an overpayment): the money returns to the address that
paid, on the same chain and in the same token. Amounts smaller than the
network fee of sending them back are kept.

**The issuer contract** (`contracts/issuer`) is a NEAR contract that only the
issuance server may call. It writes each certificate itself and has the
**NEAR MPC network** sign it, so the issuer key never exists in one place.
It also bounds the bank: only set denominations, a daily cap, the issue date
rounded to the day, public counters, and access that can be revoked at once.

**The ATM** is a Raspberry Pi with an NFC reader, a cassette of blank cards,
a dispenser and an iPhone as its screen. It holds no key that creates value:
a stolen cassette is a stack of blank plastic.
- The **ATM server** (`apps/atm`) runs the sale: it asks the issuance server
  for the quote and the certificate, writes it with the customer's PIN on a
  blank card, verifies the card like a receiver would, and dispenses it.
- The **body** (`hardware/atm`) is 3D printed in two colours. Blank cards
  wait in a hopper; a pusher slides the bottom one into the reader, which
  sits on a turret. Once the banknote is issued, the turret turns round and
  hands it out of the ATM's smiling mouth.
- The **kiosk page** (`apps/kiosk`) is what the iPhone shows: the customer
  picks a banknote, then the network and the token to pay with (USDC, ETH or
  SOL), and chooses a PIN. The screen then shows only the QR code of the
  deposit address, which the customer scans with the phone they pay from; an
  animation confirms the deposit, and the banknote is made. Whoever pays from
  an exchange adds their own refund address, since the exchange's sending
  address isn't theirs. The Pi serves the page over HTTPS to its paired
  screen only.

**The wallet app** (`ios/`) is a native iPhone app. It checks a banknote
offline over NFC — that it is issued and unspent, that its certificate is
signed by the issuer, that the certificate belongs to this chip, and that the
chip answers a fresh challenge — and lets the receiver take it over by
changing the PIN.

**The website** (`apps/website`) explains the problem NearCash solves: money
held through apps stops when their servers are hacked, patched or switched
off.

Shared code lives in `packages/` (the card protocol, certificates, the MPC
signer, the sale flow, what the kiosk and the ATM server share). The protocol
itself is specified in [docs/protocol.md](docs/protocol.md).

## A banknote's life

1. **Sale.** The customer pays at the ATM. The money reaches the bank's
   reserve; the issuance server funds a blank card's account from it and the
   NEAR MPC network certifies the card. The banknote comes out of the ATM.
2. **Circulation.** Hand to hand, with no network at all. The receiver's
   phone checks the banknote; after the deal the giver tells the PIN and the
   receiver changes it.
3. **Redemption.** The holder's card signs one withdrawal from its own
   account, with the PIN. The card is spent from that moment.

The bank takes part only in step 1, and the issuer contract limits even
that. From step 2 on it plays no role: it is not asked to check a banknote,
it is not asked to approve a transfer or a redemption, and if it went
offline, or disappeared, banknotes already issued would keep working.
Nobody can block, freeze or switch off a banknote in someone's pocket.

Nothing public links a buyer to a banknote: the payment goes to the reserve,
the card is funded inside FAR, and the certificate carries only the day.

## Deploy the ATM

```bash
pnpm atm:demo <user>@<raspberry-address>
```

Add `--skip-mpc` for a quick demo: the issuance server then signs the
certificates itself, with the public DEV key, instead of asking the NEAR MPC
network. Only the wallet app's Debug builds accept those banknotes.

It installs what the Raspberry Pi needs, deploys the ATM server and the
kiosk page there and starts them in a tmux session on the Pi. The issuance
server and the website run on this computer. Then it opens a tmux session
here with all of them, and prints the address to open on the iPhone, its
pairing QR code and the command to reach the Pi's session. The Pi's password
is asked only the first time.

Until the NFC reader and the cards are connected to the Pi, the kiosk shows
"Out of service": the ATM never takes a payment it can't turn into a
banknote.
