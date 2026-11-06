# NearCash

Digital bearer cash on NFC cards. Each card **is** a banknote: its value sits
on NEAR Intents (FAR, the private variant) in an account that only the card's
chip can spend, once. Banknotes change hands like cash, offline: any phone
can check one without a server.

**The bank is trusted only to make banknotes:** it prepares the cards
(installs the applet on each blank chip) and issues them (funds each card and
has it certified). Once issued, a banknote no longer needs the bank at all:
checking it, handing it over and redeeming it involve only the card, a phone
and FAR. Handing a banknote over is as private and confidential as paying in
cash: two people, offline, and nothing recorded on a server or on-chain.

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
**NEAR MPC network** sign it. That signature is what makes a banknote, and
MPC changes how its key is kept: the key is split among the network's
independent nodes, a signature needs many of them to agree, and no node,
server or person ever holds it whole. There is no key file to steal and no
employee who could leak it: forging banknotes would mean compromising enough
of those nodes at the same time, far harder than breaking into one bank
server. Breaking into the issuance server gives only what the contract
allows, because it also bounds the bank: only set denominations, a daily cap,
the issue date rounded to the day, public counters, and access that can be
revoked at once, without changing the key in any wallet.

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
changing the PIN. It also redeems a banknote: the holder picks a token, a
chain and an address, the card signs once, and 1Click delivers the value
there. If the delivery fails, the value goes back not to the card, which can
no longer sign, but to the holder's refund account inside FAR, held by a
passkey of the app (iCloud Keychain, Face ID), from which the app withdraws it.

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
3. **Redemption.** With the PIN, the card signs once to send its value to an
   address of the holder's, in the token and on the chain they choose. The
   card is spent from that moment. If the delivery fails, the value lands in
   the holder's refund account inside FAR, held by a passkey of the wallet
   app, never back on the card.

The bank takes part only in making the banknote: it prepares the blank cards
before they go into an ATM, and it issues them in step 1, which the issuer
contract limits. From step 2 on it plays no role: it is not asked to check a banknote,
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
