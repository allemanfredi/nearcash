# NearCash card protocol — v1

This document is the single source of truth for everything that crosses the
card boundary: commands (APDUs), card states, signed messages and the
certificate format. The Java Card applet (`applet/`) and the TypeScript client
(`packages/core/`) both implement exactly what is written here. If you change
one of them, change this document first.

## 1. The model in one paragraph

A NearCash card is a banknote. Inside the chip live two secp256k1 key pairs
that never leave it:

| Key | Purpose | How often it signs |
|-----|---------|--------------------|
| **F** (funds) | Controls the card's own account on NEAR Intents (FAR). The account id is the Ethereum-style address of F (`0x…`). | **Exactly once**, to redeem, protected by a PIN. |
| **A** (auth) | Proves "I am a genuine, unspent NearCash card" during person-to-person exchanges. | Every time someone checks the card. |

At issuance the bank has the NEAR MPC network sign a **certificate** (§11)
that binds A, F, the amount and the token. While cards circulate nothing happens on-chain. When a card signs
its redemption it marks itself **spent**, atomically, and from then on it can
never sign again.

The keys are separate on purpose: an AUTH signature can never be turned into a
redemption (A is not a key of the funds account), and F produces a single
signature in its whole life, leaving nothing to observe for side-channel
attacks.

## 2. Card requirements

The target card is the **NXP JCOP4 J3R180**. Any card works if it has:

1. Java Card **3.0.5 Classic** or later (needed for `Signature.signPreComputedHash`).
2. GlobalPlatform with **known keys** ("unfused", default keys `404142…4F`),
   otherwise the applet cannot be installed. Once it is installed they
   should be replaced (§10.1).
3. ECC over a 256-bit prime field with **custom curve parameters**
   (on-card generation of secp256k1 key pairs).
4. `Signature.ALG_ECDSA_SHA_256`, both `sign` (for A) and
   `signPreComputedHash` (for F).
5. `OwnerPIN` and atomic transactions (`JCSystem.beginTransaction`), which
   every Java Card has.
6. **Dual interface**: contact (to install the applet, §9 Card preparation) and
   ISO 14443-4 contactless (NFC, for daily use).
7. A few KB of EEPROM and ~200 bytes of RAM. Extended APDUs are **not** needed.
8. ISO ID-1 form factor (85.6 × 54 × 0.76 mm), for the ATM card dispenser.

## 3. Applet identity

| Item | Value |
|------|-------|
| Package AID | `F0 4E 42 41 4E 4B` (`F0` + ASCII `NBANK`) |
| Applet AID  | `F0 4E 42 41 4E 4B 01` |
| CLA         | `80` (proprietary) for every NearCash command |
| APDUs       | Short APDUs only (data ≤ 255 bytes, response ≤ 256 bytes) |

AIDs starting with `F` are "proprietary, not registered" (ISO 7816-5).

## 4. Card states

The state is one persistent byte. It only moves forward:

```
  EMPTY ──GENERATE_KEYS──▶ KEYS_GENERATED ──FINALIZE──▶ ISSUED ──SIGN_ONCE──▶ SPENT
  0x00                     0x01                         0x02                 0x03
```

| State | Meaning |
|-------|---------|
| `EMPTY` (0x00) | Applet installed, no keys yet. |
| `KEYS_GENERATED` (0x01) | Issuance in progress: keys exist, certificate and PIN not set yet. |
| `ISSUED` (0x02) | In circulation. Can be verified with AUTH and redeemed once. |
| `SPENT` (0x03) | Has signed its redemption. AUTH still answers, reporting `SPENT`. |

A spent card keeps answering AUTH with state `SPENT` instead of going silent:
a card that does not answer cannot be told apart from a broken or fake one,
while a signed "spent" is a definitive no.

## 5. Commands

All multi-byte integers are **big-endian**.

| Name | CLA INS P1 P2 | Command data | Response data | Allowed in |
|------|---------------|--------------|---------------|------------|
| INFO | `80 10 00 00` | — | see 5.1 | any state |
| GET_CERT | `80 12 offH offL` | — (Le = chunk size) | certificate bytes from `offset` | ISSUED, SPENT |
| AUTH | `80 20 00 00` | challenge (16–64 bytes) | `state` (1) ‖ DER signature by A | ISSUED, SPENT |
| SIGN_ONCE | `80 30 00 00` | `pinLen` (1) ‖ PIN ‖ digest (32) | DER signature by F | ISSUED; SPENT (re-read only) |
| CHANGE_PIN | `80 32 00 00` | `oldLen` (1) ‖ old PIN ‖ `newLen` (1) ‖ new PIN | — | ISSUED |
| GENERATE_KEYS | `80 40 00 00` | — | pubA (65) ‖ pubF (65) | EMPTY |
| STORE_CERT | `80 42 offH offL` | certificate chunk | — | KEYS_GENERATED |
| FINALIZE | `80 44 00 00` | `certLen` (2) ‖ `pinLen` (1) ‖ PIN | — | KEYS_GENERATED |

Public keys are always **uncompressed SEC1** on the wire: `04 ‖ X (32) ‖ Y (32)`.

### 5.1 INFO

```
version (1) = 0x01
state   (1)
pinTriesRemaining (1)
certLength (2)              0 until FINALIZE
pubA (65) ‖ pubF (65)       present only when state ≠ EMPTY
```

### 5.2 GET_CERT

P1‖P2 is the byte offset into the certificate. The card returns
`min(Le, certLength − offset)` bytes. Clients read in chunks until they have
`certLength` bytes (from INFO).

### 5.3 AUTH

The verifier sends a fresh random challenge (we use 32 bytes). The card signs

```
message = "NBK-AUTH-v1" (11 ASCII bytes) ‖ challenge ‖ state (1)
```

with **A**, using ECDSA over SHA-256(message), and answers
`state ‖ DER(signature)`. The state is inside the signed message, so nobody in
the middle can turn `SPENT` into `ISSUED`.

The domain tag `NBK-AUTH-v1` makes an AUTH signature impossible to confuse
with any other signed data. The card does **not** normalise `s`, so verifiers
must accept high-s signatures.

### 5.4 SIGN_ONCE

Command data: `pinLen ‖ PIN ‖ digest`, where `digest` is the 32-byte hash to
sign. For NEAR Intents it is the ERC-191 hash of the intent JSON (section 7).

Card behaviour, in this order:

1. The state must be `ISSUED` or `SPENT`, otherwise `6985`.
2. Check the PIN (wrong PIN → `63Cx`, blocked → `6983`).
3. If the card is `SPENT`: when the digest is the one already signed, return
   the **stored** signature again; otherwise `6985`. This makes the command
   safe to repeat if the card loses power while answering.
4. If the card is `ISSUED`: compute the signature in RAM, then in **one
   atomic transaction** store digest, signature and `state = SPENT`, then
   answer with the signature.

Because of step 4 the card is marked spent the instant it signs, not when the
redemption lands on-chain: nobody can sign a redemption, keep it, and hand the
card over as if it were still good.

The signature is DER, produced by `signPreComputedHash` (no extra hashing),
and may be high-s. The host converts it to Intents' format (section 7).

### 5.5 CHANGE_PIN

Used by the receiver right after an exchange: the previous holder tells the
current PIN, the receiver replaces it. Wrong old PIN → `63Cx`.

### 5.6 Issuance: GENERATE_KEYS, STORE_CERT, FINALIZE

- **GENERATE_KEYS** creates A and F on the card. Allowed once (state `EMPTY`).
- **STORE_CERT** writes a certificate chunk at offset P1‖P2 (max total 512 bytes).
- **FINALIZE** sets the certificate length and the holder's first PIN, and
  moves the card to `ISSUED`. After this the certificate is read-only forever.

These commands are not authenticated: a blank card has nothing to protect, and
a certificate is only trusted if the issuer's signature on it is valid.

### 5.7 PIN rules

- 4 to 8 ASCII digits (`'0'`–`'9'`).
- 5 wrong attempts block the PIN for good. A blocked card can no longer be
  redeemed (its value is lost), but it cannot be stolen either.
- Hackathon limitation: the PIN travels in clear over NFC (no secure channel).

## 6. Status words

| SW | Meaning |
|----|---------|
| `9000` | OK |
| `6700` | Wrong length |
| `6A80` | Wrong data (e.g. invalid PIN format, inconsistent lengths) |
| `6A84` | Not enough memory (certificate larger than 512 bytes) |
| `6B00` | Wrong P1/P2 (offset out of range) |
| `6985` | Not allowed in the current state (read INFO), or card already spent with a different digest |
| `63Cx` | Wrong PIN, `x` attempts left |
| `6983` | PIN blocked |
| `6D00` | Unknown INS |
| `6E00` | Unknown CLA |

## 7. Redemption signature for NEAR Intents (ERC-191)

Verified in the `near/intents` sources (`crates/signatures/erc191`,
`crates/crypto/src/secp256k1.rs`):

- digest = `keccak256("\x19Ethereum Signed Message:\n" ‖ len(message) ‖ message)`,
  where `len` is the decimal ASCII length in bytes, without padding;
- the contract **rejects high-s** signatures (malleability check), so the host
  normalises `s → n − s` when needed and flips the recovery bit;
- the signature is 65 bytes: `r (32) ‖ s (32) ‖ recoveryId (1)`.

In the intent submitted to 1Click the 65 bytes are written
`"secp256k1:" ‖ base58(r ‖ s ‖ recoveryId)`, next to `"standard": "erc191"`
and the intent JSON as `payload` (1Click's MultiPayloadErc191; accepted by
submit-intent on 2026-11-06, with an empty test account). The intent JSON
1Click prepares for the card is in §9, Redemption.

The card's account id is the Ethereum address of F:
`"0x" ‖ hex(keccak256(X ‖ Y)[12..32])`, lowercase.

## 8. Certificate v1

Built by the ATM, **signed by the NEAR MPC network** (§11), stored on the
card at issuance, read by anyone with GET_CERT. The card treats it as opaque
bytes.

| Offset | Length | Field |
|--------|--------|-------|
| 0 | 4 | magic `NBC1` (`4E 42 43 31`) |
| 4 | 33 | pubA, compressed SEC1 |
| 37 | 33 | pubF, compressed SEC1 |
| 70 | 16 | amount, unsigned 128-bit, in the token's smallest unit |
| 86 | 1 | decimals of the token |
| 87 | 8 | issuedAt, unsigned 64-bit, Unix seconds: always 00:00 UTC of the issue day, never the time of purchase |
| 95 | 1 + n | tokenId, length-prefixed UTF-8 (e.g. `nep141:eth.omft.near`) |
| … | 1 + n | symbol, length-prefixed UTF-8 (e.g. `ETH`), for display |
| … | 1 + n | contractId, length-prefixed UTF-8: the Intents/FAR contract holding the funds |
| … | 33 | issuer public key, compressed SEC1: the MPC key of the issuer contract (§11) |
| … | 64 | issuer signature: compact `r ‖ s` (low-s), ECDSA secp256k1 over SHA-256 of **all preceding bytes**, produced by the NEAR MPC network |

A verifier trusts a certificate only if the issuer public key is in its list
of trusted issuers **and** the signature is valid **and** pubA/pubF match the
keys the card itself reports in INFO.

## 9. Flows

**Card preparation: operators, before the ATM**

The ATM never installs code: it only speaks the commands of §5. Cards reach
its cassette already prepared by an operator, with a contact reader and
GlobalPlatformPro (the `gp` tool, which uses the GlobalPlatform keys of §2):
1. Wipe the card: delete everything on it. A card on which the default keys
   do not work (someone changed them) is discarded.
2. Install the applet (§3). The card is now `EMPTY`.
3. Lock the card's code (TODO, §10.1).
4. Put it in the ATM's cassette.

**Issuance: the ATM sells, the issuance server creates value (§12)**

The ATM's cassette holds **blank** cards (state `EMPTY`, prepared as above):
no funds, no certificate. Value is created only by the issuance server, after it has seen the payment.
1. The user picks a denomination, the network and token to pay with, and a
   PIN. The **issuance server** makes a 1Click quote whose recipient is the
   bank's reserve inside FAR (confidential); the display shows the deposit
   address as a QR code.
2. The user pays. The **issuance server** reads `SUCCESS` from 1Click itself.
3. The ATM takes a blank card: SELECT, GENERATE_KEYS → A, F.
4. The issuance server transfers the value from the reserve to the card's own account
   inside FAR (the Ethereum address of F) and has the NEAR MPC network sign
   the certificate (§11). One payment buys exactly one card. The transfer is
   a 1Click quote from FAR to FAR (the same token, the card as recipient,
   no fee): 1Click prepares the transfer intent, the reserve checks that it
   is exactly that transfer and signs it (NEP-413), 1Click executes it, and
   the issuance server waits for `SUCCESS`.
5. The ATM: STORE_CERT in chunks, FINALIZE with the holder's PIN, then
   verifies the card exactly as a receiver would (below), and dispenses it.

Refunds (a failed swap, a payment after the deadline, what was paid beyond
the quote) never go to a card. If the user gave a refund address, 1Click
refunds it directly; otherwise they go to the reserve, and the issuance
server sends them back to the address that paid (§12).

A card taken before step 5 is worthless: wallets reject `EMPTY` and
`KEYS_GENERATED` cards.

**Exchange (phone, offline)**
1. SELECT, INFO: the state must be `ISSUED`.
2. GET_CERT, check the issuer signature against the trusted issuers.
3. Check that pubA and pubF in the certificate equal the ones in INFO.
4. AUTH with a fresh random challenge, check the signature with A and that the signed state is `ISSUED`.
5. After the deal: the giver tells the PIN, the receiver runs CHANGE_PIN.

**Redemption (phone): straight to the holder's chain, refunds to a passkey account inside FAR**

The holder picks a token, a chain and an address of theirs; the card's one
signature pays a 1Click quote that delivers there. If that delivery fails,
1Click refunds the value, and the refund can never go back to the card: it
can no longer sign, so the money would be stuck for good (§10). It goes to
the holder's **refund account** instead: an account inside FAR whose key is
a passkey of the wallet app (P-256, kept by iOS in the iCloud Keychain and
used with Face ID). NEAR Intents derives the account from the key, with no
registration: `"0x" ‖ hex(keccak256("p256" ‖ X ‖ Y)[12..32])`. From there the
app withdraws a refund with the passkey (a WebAuthn-signed transfer intent),
as many times as needed. Like every movement on FAR it goes through 1Click:
1. Tap 1: the app checks the banknote as a receiver would (above) and reads F.
2. A 1Click quote: `EXACT_INPUT` of the certificate's whole amount, from the
   card's token inside FAR (`depositType` `CONFIDENTIAL_INTENTS`) to the
   chosen token on its chain (`recipientType` `DESTINATION_CHAIN`); slippage
   0 when the token is the same (a plain withdrawal), 1 % for a swap;
   `refundTo` the refund account (`refundType` `CONFIDENTIAL_INTENTS`).
   1Click prepares the transfer intent that pays the quote's deposit address
   (generate-intent, standard `erc191`, signer: the card's account).
3. The app checks that the intent is exactly that transfer: for
   `intents.far`, signed as the card's account, one `transfer` of that
   amount of that token to the deposit address, nothing else. The card signs
   only once, and a wrong intent would use up its one signature. The app
   saves the redemption, then computes the ERC-191 digest (§7).
4. Tap 2: SIGN_ONCE(PIN, digest) → DER signature; the card is now `SPENT`.
   The app converts it to `r ‖ s ‖ v` with low-s and checks that it
   recovers F.
5. submit-intent with `{"standard": "erc191", "payload": <the intent>,
   "signature": "secp256k1:<base58 of the 65 bytes>"}`, then `/v0/status`
   until `SUCCESS` or `REFUNDED`.

The intent 1Click prepares for the card (seen live on 2026-11-06), which the
card signs as an ERC-191 message:

```json
{"verifying_contract": "intents.far", "signer_id": "0x<card's account>",
 "deadline": "2026-11-09T09:50:01.000Z", "nonce": "<base64>",
 "intents": [{"intent": "transfer", "receiver_id": "<the quote's deposit address>",
   "tokens": {"imt:<FAR's treasury>:nep141:eth-0xa0b8…eb48.omft.near": "5000000"}}]}
```

An interrupted redemption resumes from the saved intent: the same digest
gets the same signature back from the card (§5.4).

The app talks to 1Click directly, with a 1Click partner key of its own
(confidential quotes need one), not the bank's: the key identifies the app
and moves no funds. The bank plays no part in a redemption. The ATM does not
redeem yet.

## 10. Known limitations (to declare)

- **Trust is at creation only.** The issuance server is trusted to fund a card
  before asking for its certificate (the contract cannot see FAR). The contract
  limits a compromised issuance server: allowed denominations only, a daily value cap,
  public counters, immediate revocation. ATMs hold no keys and cannot create value.
  **TODO:** Once FAR supports contract deployment and MPC is available on FAR,
  deploy issuance there to make it straightforward to verify the card's backing
  directly before signing, instead of trusting the issuance server.
- The FAR operator can technically freeze accounts; NearCash never needs to.
  Recommended: the freeze role on a time-locked multisig (own FAR instance).

- PIN in clear over NFC; no secure channel.
- A malicious inspector can block the PIN on purpose (value destroyed, not stolen).
- Relay attack: an offline verifier talks NFC to an object that might relay to
  a card elsewhere. Acceptable for low denominations.
- If key A were ever extracted from a chip, fake cards could pass AUTH; funds
  of other cards stay safe. Keep denominations below the cost of a chip attack.
- **What can go wrong in a redemption (§9).** Redeeming spends the card's
  only signature: from then on nothing left in the card's account can ever
  move again.
  - A refund back to the card would lock the funds for good. So refunds go
    to the holder's refund account, held by a passkey, which can sign again.
  - A refund to the bank's reserve would need the bank to give it back,
    bringing the bank back after issuance: excluded.
  - A refund to the recipient address itself (as a FAR account of the same
    key) would be lost when that address is an exchange's: excluded.
  - A swap can fail (price, liquidity), and so can a withdrawal (a recipient
    the token blocks, such as a blacklisted USDC address); both end as a
    refund to the refund account. Both also cost the destination chain's
    fee: a withdrawal of USDC to Ethereum cost 0.6 USDC on 2026-11-06, 12 %
    of a 5 USDC banknote.
  - The signed intent has a deadline (1Click kept confidential quotes open
    for 3 days on 2026-11-06): if nobody submits it in time nothing moves,
    but the card is already `SPENT`. The app saves the intent and the card
    keeps the signature for the same digest (§5.4), so it can be submitted
    again.
  - The refund account is only as safe as the passkey: it lives in the
    holder's iCloud Keychain and syncs to their other devices. Changing the
    passkey's domain means a new passkey and a new refund account.
  - The wallet's 1Click partner key ships inside the app, so anyone can read
    it and use the app's 1Click quota. It moves no funds: every movement
    needs the signature of the account it spends.
- Cards keep the default GlobalPlatform keys: what that allows, and the TODO
  to lock them, are in §10.1.
- Refunds without a refund address go back to the address that paid. Paid
  from an exchange, that address is the exchange's, so the user must give
  their own. Refunds smaller than the network fee of sending them back are
  kept by the bank.

### 10.1 Changing the card's code (GlobalPlatform)

Installing the applet needs the card's GlobalPlatform keys (§2). Today they
stay the default ones afterwards, so anyone with a reader can delete the
applet or load another one. What that allows, case by case:

- **Deleting the applet (a "reset").** The holder has no reason to: it
  destroys their own money. Someone holding the card for a moment (for
  example while checking it before accepting it) could do it as vandalism.
  A and F are deleted with the applet, so the funds stay locked in F's account
  for good: the value is destroyed, not stolen, like a PIN blocked on purpose (§10).
- **Keeping the certificate, replacing the applet.** It does not work. The
  certificate is public: anyone reads it with GET_CERT, so keeping it gives
  nothing. What counts are the private keys A and F, which live inside the
  applet and are deleted with it. A new applet can show the old certificate
  and the old pubA and pubF, but it cannot sign AUTH with A, and the check
  rejects it (§9, Exchange, step 4).
- **A code hash in the certificate.** It would not help: a card cannot prove
  which code it runs. The hash would be reported by the code itself, and a
  fake applet would report the hash of the genuine one. GlobalPlatform gives
  no way for a card to sign the hash of its installed code, so neither the
  issuance server nor a receiver could check it. pubA already plays this
  role: only the applet that generated A can answer AUTH.
- **A fake applet before issuance.** A blank card whose applet uses keys the
  attacker knows, or never becomes `SPENT`, would be certified like a genuine
  one, and neither pubA nor a code hash would stop it. Operators prevent it:
  before a card goes into an ATM's cassette, they wipe it (delete everything
  on it) and install the applet themselves (§9, Card preparation). A card on
  which the default keys do not work (someone changed them) is discarded.
- **A second applet after issuance.** Loaded next to ours, it would exploit a
  bug in the Java Card virtual machine to get past the firewall and read F.
  The attacker then redeems the funds while the card still answers `ISSUED`,
  and spends the card in person: a double spend. Only blocking code loading
  stops it.

**TODO: lock the card's code.** After installing the applet, operators replace
the keys with random ones that are thrown away (`gp --lock`). From then on
nobody, not even the bank, can load or delete code: this closes the second
applet and the reset. Spent cards can then no longer be recycled by
reinstalling the applet: add a RESET command (SPENT → EMPTY, PIN required,
sent only after FAR confirms the redemption) to reuse them.

## 11. Issuer key: NEAR MPC (chain signatures)

The certificate signature comes from the NEAR MPC network, so the issuer key
never exists in full anywhere: no ATM, server or person holds it.

**Why MPC.** The issuer key is the key that makes banknotes: whoever can sign
with it prints money. Kept on a server (like the DEV key below), breaking into
that one machine would be enough to forge banknotes without limit, and the
only cure would be a new key in every wallet, which makes every banknote
already issued suspect. With MPC:
- The key is split among the network's independent nodes. A signature needs
  a threshold of them to cooperate, and no node ever sees the whole key. To
  forge banknotes an attacker would have to compromise that many nodes at the
  same time, each run by a different operator on its own infrastructure: far
  harder than breaking into one bank server.
- There is nothing to steal at the bank: no key file, no backup, no laptop,
  no employee who knows it. For certificates the issuance server holds only a
  function-call key that can call `sign_certificate`.
- Breaking into the issuance server gives only what the issuer contract
  allows: the allowed denominations, up to the daily cap, in public counters.
  Removing the minter stops it at once, and the issuer key, and so every
  wallet, stays as it is.
- The issuer key is public and checkable: anyone can recompute it from MPC's
  root key (below).

```
issuance server ──sign_certificate(card keys, amount, day)──▶ issuer contract ──sign(request, 1 yocto)──▶ MPC contract
                ◀──────────────── MPC signature (big_r, s, recovery_id) ◀──────────────────────┘
```

- **Issuer contract** (`contracts/issuer`): the only account that can obtain
  signatures with the NearCash key. It accepts `sign_certificate` only from
  the minters its owner has authorised (`add_minter` / `remove_minter`) — the
  issuance server's NEAR accounts — and
  **builds the certificate body itself** from the card keys, the amount and
  the day, with its configured token, symbol, decimals, funds contract and
  issuer key. It enforces the allowed denominations, a daily value cap and
  `issued_at` = 00:00 UTC of today or yesterday; keeps public counters
  (`stats`); pays MPC's 1 yoctoNEAR deposit; logs every certificate hash.
- **MPC request** (near/mpc `SignRequestArgs`):
  `{"path": "<contract path>", "payload_v2": {"Ecdsa": "<hash hex>"}, "domain_id": 0}`
  on `v1.signer-prod.testnet` (testnet) / `v1.signer` (mainnet). Domain 0 is
  ECDSA over secp256k1.
- **MPC answer**: `{"scheme": "Secp256k1", "big_r": {"affine_point": "<33 bytes>"},
  "s": {"scalar": "<32 bytes>"}, "recovery_id": n}`. The certificate stores
  `r = x(big_r)` and `s`, normalised to low-s.
- **Issuer public key** = MPC's key for (issuer contract, path):
  `G·tweak + root`, with `tweak = sha3_256("near-mpc-recovery v0.1.0 epsilon derivation:" ‖ contract ‖ "," ‖ path)`.
  Anyone can recompute it offline from MPC's root key, or read it with the
  `derived_public_key` view. Wallets have it built in.
- **Revocation**: removing a minter stops it immediately, without updating
  any wallet.

Testnet deployment (2026-11-03): issuer contract `nearbank-issuer-56b0c6.testnet`,
path `nearbank-certificates-v1`, minter `nearbank-mint-56b0c6.testnet`, issuer key
`03e38503df708b9f40ee5a6f7669732229bf1feafe4492ccac028e7e2b778337f8`;
5 / 10 / 20 USDC (placeholder token ids, to replace with FAR's), cap 1000 USDC a day.
These testnet accounts were created before the project was renamed NearCash and keep their on-chain names: renaming them means a new issuer key (redeploy + new key in the wallets).

**Demos without MPC** (`NEARCASH_SKIP_MPC=true`, `pnpm atm:demo --skip-mpc`):
the issuance server still reads the banknotes (token, denominations) from the
issuer contract, but builds and signs each certificate itself with the
public DEV key (`packages/core/src/dev.ts`) instead of calling
`sign_certificate`. The daily cap and the public counters are skipped with
it. The ATM trusts that key because it asks the issuance server
(`GET /issuer`); the wallet app trusts it only in Debug builds. Anyone can
forge certificates with the DEV key: demo banknotes only.

## 12. Issuance server and ATM: "the ATM doesn't print money"

| | Issuance server (`apps/issuance`, one, protected) | ATM (`apps/atm` + `apps/kiosk`, many, in the street) |
|---|---|---|
| Keys | Function-call key that can only call `sign_certificate`; the FAR reserve key | **None** |
| Makes the 1Click quote | Yes, recipient = bank reserve; refunds to the user's address if given, else to the reserve | No |
| Decides a sale is paid | Yes, reading 1Click itself | No |
| Funds the card | Yes, reserve → card inside FAR | No |
| Certificate | Asks the issuer contract (MPC signs) | Writes it on the card, with the PIN |
| Refunds that reach the reserve | Sends them back to the address that paid | No |

Issuance rules (apps/issuance/src/features/sales/sales.service.ts, each covered by a test):
1. A card is funded and certified only after the issuance server has read `SUCCESS` for
   its own quote. ATMs are never believed.
2. One payment buys one card: the first card presented is bound to the sale;
   another card is refused; the same card gets the same certificate back.
3. A card is never funded twice: an interrupted transfer stops the sale for a
   manual check.
4. Sales are persisted (one payment = one card survives restarts).

Refund rules (apps/issuance/src/features/refunds/refunds.service.ts, each
covered by a test). Without a refund address from the user, 1Click refunds
into the reserve, and:
1. Only those sales: a refund address given by the user is refunded by
   1Click directly, never by the bank.
2. A refund goes back only to the address that paid, read from the deposit
   transactions on the origin chain, in the asset that was paid. If that
   address can't be told for sure, an operator decides.
3. Each refund is sent at most once: the attempt is recorded before it
   starts; one with an unknown outcome stops for a manual check.
4. A refund smaller than the network fee of sending it back is kept, and
   recorded as kept.
The return is a 1Click quote paid from the reserve inside FAR: 1Click
prepares the transfer intent, the reserve signs it (NEP-413). Before signing
anything, the reserve checks that the intent is exactly the agreed transfer
(one `transfer`, the agreed token and amount, to the quote's deposit address,
for `intents.far`): its signature spends its money, and the intent comes from
an outside service.

What an attack gets:
- **Stolen cassette**: blank plastic. Nothing to freeze.
- **Tampered ATM**: cannot fake a 1Click `SUCCESS`; at most it redirects one
  paying customer's sale, which the customer sees immediately.
- **Compromised issuance server**: bounded by the contract (denominations, daily cap),
  visible in the public counters, revocable at once.

Privacy: the payment goes to the reserve, not to a card; funding happens
inside FAR; the certificate carries only the day. Nothing public links a
buyer to a banknote.
