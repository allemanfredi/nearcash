//! NearCash issuer contract — "the ATM doesn't print money, the issuance server does".
//!
//! Banknote certificates (docs/protocol.md §8) are signed by the NEAR MPC
//! network, so the issuer key never exists in full anywhere. MPC derives a
//! key per (caller account, path): this contract is the caller, so only it
//! can obtain signatures with the NearCash issuer key.
//!
//! ```text
//! issuance server ──sign_certificate(card keys, amount, day)──▶ this contract ──sign──▶ MPC contract
//!                 ◀────────── MPC signature over SHA-256(certificate body) ◀────────────┘
//! ```
//!
//! The contract — not the issuance server — builds the certificate body, so
//! even a compromised issuance server can only issue:
//!   - for keys born inside a genuine NearCash chip: the chip's birth
//!     certificate, signed by the bank's offline production key, and the
//!     chip's signature over the keys are checked here (protocol.md §5.8),
//!   - one certificate per chip,
//!   - the configured token, symbol, decimals and funds contract,
//!   - one of the allowed denominations,
//!   - up to the daily value cap,
//!   - with an issue date rounded to the day (privacy: no time of purchase).
//! Every certificate is counted and logged (public supply).
//!
//! ATMs hold no keys at all: they sell blank cards; the issuance server funds the card
//! inside FAR and asks for its certificate only after it has seen the
//! payment itself. This contract cannot see FAR.

use near_sdk::json_types::U128;
use near_sdk::store::{IterableSet, LookupMap};
use near_sdk::{env, ext_contract, near, require, AccountId, NearToken, PanicOnDefault, Promise};

/// MPC asks for a 1 yoctoNEAR deposit per signature (near/mpc, `SIGN_DEPOSIT_YOCTONEAR`).
/// The contract pays it, so the issuance server can use a function-call access key,
/// which cannot attach deposits.
const MPC_SIGN_DEPOSIT: NearToken = NearToken::from_yoctonear(1);

/// Domain 0 of the MPC contract: ECDSA over secp256k1, the curve of the protocol.
const SECP256K1_DOMAIN_ID: u64 = 0;

/// Certificate v1 magic (protocol.md §8).
const CERTIFICATE_MAGIC: &[u8; 4] = b"NBC1";

/// What the production key signs: this tag, then the chip key C (protocol.md §5.8).
const BIRTH_DOMAIN_TAG: &[u8] = b"NBK-BIRTH-v1";

/// What the chip key C signs at GENERATE_KEYS: this tag, then A and F (protocol.md §5.8).
const KEYS_DOMAIN_TAG: &[u8] = b"NBK-KEYS-v1";

const SECONDS_PER_DAY: u64 = 86_400;
const NANOSECONDS_PER_SECOND: u64 = 1_000_000_000;

/// What to sign, in the MPC contract's format: `{"Ecdsa": "<32 bytes hex>"}`.
#[near(serializers = [json])]
pub enum Payload {
    Ecdsa(String),
}

/// MPC `sign` argument (near/mpc, `SignRequestArgs`).
#[near(serializers = [json])]
pub struct SignRequest {
    pub path: String,
    pub payload_v2: Payload,
    pub domain_id: u64,
}

#[ext_contract(mpc)]
pub trait MpcContract {
    fn sign(&mut self, request: SignRequest);
}

/// Everything that is fixed for every banknote of this issuer.
#[near(serializers = [json, borsh])]
#[derive(Clone)]
pub struct Config {
    /// Manages minters, caps and denominations. Keep its full-access key offline.
    pub owner: AccountId,
    /// v1.signer-prod.testnet on testnet, v1.signer on mainnet.
    pub mpc_contract: AccountId,
    /// Derivation path of the issuer key. Changing it changes the key.
    pub path: String,
    /// The MPC key of (this contract, path), compressed SEC1 hex. It is written
    /// into every certificate; anyone can check it against the MPC contract's
    /// `derived_public_key(path, predecessor = this contract)`.
    pub issuer_public_key: String,
    /// Intents token id of the banknotes, e.g. "nep141:usdc…".
    pub token_id: String,
    pub symbol: String,
    pub decimals: u8,
    /// The Intents/FAR contract where the funds live.
    pub funds_contract_id: String,
    /// Allowed values, in the token's smallest unit.
    pub denominations: Vec<U128>,
    /// Maximum total value certified per UTC day.
    pub daily_value_cap: U128,
    /// The bank's production key, compressed SEC1 hex: it signs the birth
    /// certificate of every chip the bank makes, on a machine kept offline.
    /// Only keys born in such a chip are certified.
    pub production_public_key: String,
}

/// Public supply counters.
#[near(serializers = [json, borsh])]
#[derive(Clone, Default)]
pub struct Stats {
    pub certificates: u64,
    pub total_value: U128,
    /// UTC day number (days since 1970-01-01) the daily counter refers to.
    pub day: u64,
    pub day_value: U128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct IssuerContract {
    config: Config,
    /// Accounts allowed to request certificates ("minters"): the issuance server(s). Never ATMs.
    minters: IterableSet<AccountId>,
    stats: Stats,
    /// Every chip certified so far (compressed C) → SHA-256(A ‖ F ‖ amount):
    /// one certificate per chip; the very same request again is a retry.
    certified_chips: LookupMap<Vec<u8>, [u8; 32]>,
}

/// The state before birth certificates (deployed 2026-11-03), read once by `migrate`.
#[near(serializers = [borsh])]
pub struct IssuerContractV1 {
    config: ConfigV1,
    minters: IterableSet<AccountId>,
    stats: Stats,
}

/// `Config` before birth certificates: without `production_public_key`.
#[near(serializers = [borsh])]
pub struct ConfigV1 {
    pub owner: AccountId,
    pub mpc_contract: AccountId,
    pub path: String,
    pub issuer_public_key: String,
    pub token_id: String,
    pub symbol: String,
    pub decimals: u8,
    pub funds_contract_id: String,
    pub denominations: Vec<U128>,
    pub daily_value_cap: U128,
}

#[near]
impl IssuerContract {
    #[init]
    pub fn new(config: Config) -> Self {
        validate_config(&config);
        Self { config, minters: IterableSet::new(b"m"), stats: Stats::default(), certified_chips: LookupMap::new(b"c") }
    }

    /// Upgrades a contract deployed before birth certificates: deploy the new
    /// code to the same account, then call this once, as the contract account
    /// itself. Minters and counters are kept.
    #[private]
    #[init(ignore_state)]
    pub fn migrate(production_public_key: String) -> Self {
        let old: IssuerContractV1 = env::state_read().unwrap_or_else(|| env::panic_str("no state to migrate"));
        let c = old.config;
        let config = Config {
            owner: c.owner,
            mpc_contract: c.mpc_contract,
            path: c.path,
            issuer_public_key: c.issuer_public_key,
            token_id: c.token_id,
            symbol: c.symbol,
            decimals: c.decimals,
            funds_contract_id: c.funds_contract_id,
            denominations: c.denominations,
            daily_value_cap: c.daily_value_cap,
            production_public_key,
        };
        validate_config(&config);
        env::log_str("migrated: birth certificates required from now on");
        Self { config, minters: old.minters, stats: old.stats, certified_chips: LookupMap::new(b"c") }
    }

    // ------------------------------------------------------------------ owner

    /// Owner only: allows `minter` to request certificates.
    pub fn add_minter(&mut self, minter: AccountId) {
        self.assert_owner();
        self.minters.insert(minter.clone());
        env::log_str(&format!("minter authorised: {minter}"));
    }

    /// Owner only: revokes `minter`. Immediate.
    pub fn remove_minter(&mut self, minter: AccountId) {
        self.assert_owner();
        self.minters.remove(&minter);
        env::log_str(&format!("minter revoked: {minter}"));
    }

    /// Owner only: changes the maximum value certified per day.
    pub fn set_daily_value_cap(&mut self, cap: U128) {
        self.assert_owner();
        self.config.daily_value_cap = cap;
        env::log_str(&format!("daily value cap set to {}", cap.0));
    }

    /// Owner only: replaces the allowed denominations.
    pub fn set_denominations(&mut self, denominations: Vec<U128>) {
        self.assert_owner();
        require!(!denominations.is_empty() && denominations.iter().all(|d| d.0 > 0), "denominations must be positive");
        self.config.denominations = denominations;
    }

    /// Owner only: replaces the production key, e.g. if it leaked. Chips born
    /// with the old key can then no longer be certified.
    pub fn set_production_key(&mut self, production_public_key: String) {
        self.assert_owner();
        parse_compressed_key(&production_public_key, "production_public_key");
        env::log_str(&format!("production key set to {production_public_key}"));
        self.config.production_public_key = production_public_key;
    }

    // ------------------------------------------------------------------ views

    pub fn config(&self) -> Config {
        self.config.clone()
    }

    pub fn stats(&self) -> Stats {
        self.stats.clone()
    }

    pub fn minters(&self) -> Vec<AccountId> {
        self.minters.iter().cloned().collect()
    }

    pub fn is_minter(&self, account: AccountId) -> bool {
        self.minters.contains(&account)
    }

    /// True if the chip (compressed C, hex) already has a certificate.
    pub fn is_chip_certified(&self, chip_public_key: String) -> bool {
        self.certified_chips.contains_key(&parse_compressed_key(&chip_public_key, "chip_public_key"))
    }

    // ------------------------------------------------------------------ minting

    /// Minters only: has the MPC network sign the certificate of one card.
    ///
    /// The contract builds the certificate body itself from the card's keys
    /// (compressed SEC1 hex), one allowed `amount`, the configured token and
    /// `issued_at` (Unix seconds at 00:00 UTC of today or yesterday). The
    /// transaction result is MPC's signature over SHA-256 of that body.
    ///
    /// The keys must come from a chip the bank made (protocol.md §5.8): the
    /// production key signed the chip key C (`birth_signature`), and C signed
    /// A and F (`keys_signature`), both compact r ‖ s hex. One certificate per
    /// chip; the very same request again (a retry) is allowed, counted once.
    ///
    /// The certificate covers the card's own keys, so the signature is valid
    /// for that one chip only. Call it only after the card has been funded.
    ///
    /// TODO: Once FAR supports contract deployment and MPC is available on FAR,
    /// deploy issuance there to make it straightforward to verify the card's
    /// backing directly before signing, instead of trusting the issuance server.
    #[allow(clippy::too_many_arguments)]
    pub fn sign_certificate(
        &mut self,
        auth_public_key: String,
        funds_public_key: String,
        amount: U128,
        issued_at: u64,
        chip_public_key: String,
        birth_signature: String,
        keys_signature: String,
    ) -> Promise {
        let minter = env::predecessor_account_id();
        require!(self.minters.contains(&minter), "only an authorised minter can request certificates");

        let auth_key = parse_compressed_key(&auth_public_key, "auth_public_key");
        let funds_key = parse_compressed_key(&funds_public_key, "funds_public_key");
        require!(auth_key != funds_key, "the two card keys must differ");
        require!(self.config.denominations.contains(&amount), "amount is not an allowed denomination");

        // The chip's birth: made by the bank, and the keys were born inside it.
        let chip_key = parse_compressed_key(&chip_public_key, "chip_public_key");
        let production_key = parse_compressed_key(&self.config.production_public_key, "production_public_key");
        require!(
            signed_by(&birth_message(&chip_key), &parse_signature(&birth_signature, "birth_signature"), &production_key),
            "the chip has no valid birth certificate: the bank did not make it"
        );
        require!(
            signed_by(&keys_message(&auth_key, &funds_key), &parse_signature(&keys_signature, "keys_signature"), &chip_key),
            "the chip did not sign these keys: they were not born inside it"
        );

        let today = env::block_timestamp() / NANOSECONDS_PER_SECOND / SECONDS_PER_DAY;
        require!(
            issued_at % SECONDS_PER_DAY == 0 && (issued_at / SECONDS_PER_DAY == today || issued_at / SECONDS_PER_DAY + 1 == today),
            "issued_at must be 00:00 UTC of today or yesterday"
        );

        // One certificate per chip. The same keys and amount again is a retry
        // (e.g. the issuance server stopped before saving the answer): signed
        // again, not counted twice.
        let request = env::sha256_array([auth_key.as_slice(), funds_key.as_slice(), &amount.0.to_be_bytes()].concat());
        match self.certified_chips.get(&chip_key) {
            Some(previous) => require!(*previous == request, "this chip already has a certificate for other keys or another amount"),
            None => {
                self.certified_chips.insert(chip_key, request);
                self.count(today, amount.0);
            }
        }

        let body = self.certificate_body(&auth_key, &funds_key, amount.0, issued_at);
        let hash = to_hex(&env::sha256(&body));

        // Public audit trail: which minter had which certificate signed.
        env::log_str(&format!("certificate {hash} for {} requested by {minter}", amount.0));

        mpc::ext(self.config.mpc_contract.clone()).with_attached_deposit(MPC_SIGN_DEPOSIT).sign(SignRequest {
            path: self.config.path.clone(),
            payload_v2: Payload::Ecdsa(hash),
            domain_id: SECP256K1_DOMAIN_ID,
        })
    }

    // ------------------------------------------------------------------ internals

    /// Updates the supply counters, enforcing the daily value cap. Counted
    /// before the MPC call: a failed signature still "uses" cap, the safe side.
    fn count(&mut self, today: u64, amount: u128) {
        if self.stats.day != today {
            self.stats.day = today;
            self.stats.day_value = U128(0);
        }
        let day_value = self.stats.day_value.0.checked_add(amount).expect("overflow");
        require!(day_value <= self.config.daily_value_cap.0, "daily value cap reached");
        self.stats.day_value = U128(day_value);
        self.stats.total_value = U128(self.stats.total_value.0.checked_add(amount).expect("overflow"));
        self.stats.certificates += 1;
    }

    /// The certificate body, byte for byte as protocol.md §8 and
    /// packages/core/src/certificate.ts (encodeCertificateBody) lay it out.
    fn certificate_body(&self, auth_key: &[u8], funds_key: &[u8], amount: u128, issued_at: u64) -> Vec<u8> {
        let mut body = Vec::with_capacity(256);
        body.extend_from_slice(CERTIFICATE_MAGIC);
        body.extend_from_slice(auth_key);
        body.extend_from_slice(funds_key);
        body.extend_from_slice(&amount.to_be_bytes());
        body.push(self.config.decimals);
        body.extend_from_slice(&issued_at.to_be_bytes());
        push_length_prefixed(&mut body, &self.config.token_id);
        push_length_prefixed(&mut body, &self.config.symbol);
        push_length_prefixed(&mut body, &self.config.funds_contract_id);
        body.extend_from_slice(&parse_compressed_key(&self.config.issuer_public_key, "issuer_public_key"));
        body
    }

    fn assert_owner(&self) {
        require!(env::predecessor_account_id() == self.config.owner, "only the owner can do this");
    }
}

fn validate_config(config: &Config) {
    parse_compressed_key(&config.issuer_public_key, "issuer_public_key");
    parse_compressed_key(&config.production_public_key, "production_public_key");
    for (name, text) in [("token_id", &config.token_id), ("symbol", &config.symbol), ("funds_contract_id", &config.funds_contract_id)] {
        require!(!text.is_empty() && text.len() <= 255, format!("{name} must be 1–255 bytes"));
    }
    require!(
        !config.denominations.is_empty() && config.denominations.iter().all(|d| d.0 > 0),
        "denominations must be positive"
    );
}

/// 33-byte compressed SEC1 key from 66 lowercase hex digits (prefix 02 or 03).
/// Whether it is a point on the curve is checked by every wallet.
fn parse_compressed_key(hex: &str, name: &str) -> Vec<u8> {
    let bytes = from_hex(hex).unwrap_or_else(|| env::panic_str(&format!("{name} must be lowercase hex")));
    require!(bytes.len() == 33 && (bytes[0] == 0x02 || bytes[0] == 0x03), format!("{name} must be a compressed secp256k1 key"));
    bytes
}

/// 64-byte compact r ‖ s signature from 128 lowercase hex digits.
fn parse_signature(hex: &str, name: &str) -> [u8; 64] {
    let bytes = from_hex(hex).unwrap_or_else(|| env::panic_str(&format!("{name} must be lowercase hex")));
    bytes.try_into().unwrap_or_else(|_| env::panic_str(&format!("{name} must be a 64-byte r ‖ s signature")))
}

/// "NBK-BIRTH-v1" ‖ compressed C: what the production key signs.
fn birth_message(chip_key: &[u8]) -> Vec<u8> {
    [BIRTH_DOMAIN_TAG, chip_key].concat()
}

/// "NBK-KEYS-v1" ‖ compressed A ‖ compressed F: what the chip key signs.
fn keys_message(auth_key: &[u8], funds_key: &[u8]) -> Vec<u8> {
    [KEYS_DOMAIN_TAG, auth_key, funds_key].concat()
}

/// True if `signature` is an ECDSA secp256k1 signature of SHA-256(`message`)
/// by the compressed `key`. NEAR's ecrecover gives the signer's key for a
/// recovery id; the signature does not carry one, so both are tried.
fn signed_by(message: &[u8], signature: &[u8; 64], key: &[u8]) -> bool {
    let hash = env::sha256(message);
    (0u8..=1).any(|recovery_id| {
        // malleability_flag false: a high-s signature is as good as its low-s twin here.
        env::ecrecover(&hash, signature, recovery_id, false).is_some_and(|xy| compress(&xy) == key)
    })
}

/// Compressed SEC1 form of an uncompressed X ‖ Y key: 02/03 (parity of Y) ‖ X.
fn compress(xy: &[u8; 64]) -> Vec<u8> {
    let mut key = Vec::with_capacity(33);
    key.push(0x02 | (xy[63] & 1));
    key.extend_from_slice(&xy[..32]);
    key
}

fn push_length_prefixed(body: &mut Vec<u8>, text: &str) {
    body.push(text.len() as u8); // validated ≤ 255 in validate_config
    body.extend_from_slice(text.as_bytes());
}

fn to_hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    bytes.iter().flat_map(|b| [DIGITS[(b >> 4) as usize] as char, DIGITS[(b & 0x0f) as usize] as char]).collect()
}

fn from_hex(text: &str) -> Option<Vec<u8>> {
    fn nibble(c: u8) -> Option<u8> {
        match c {
            b'0'..=b'9' => Some(c - b'0'),
            b'a'..=b'f' => Some(c - b'a' + 10),
            _ => None,
        }
    }
    let digits = text.as_bytes();
    if digits.len() % 2 != 0 {
        return None;
    }
    digits.chunks(2).map(|pair| Some(nibble(pair[0])? << 4 | nibble(pair[1])?)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::{get_logs, VMContextBuilder};
    use near_sdk::testing_env;

    // Keys of the shared test vector: G, 2G and 3G of secp256k1.
    const KEY_G: &str = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
    const KEY_2G: &str = "02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5";
    const KEY_3G: &str = "03f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";

    // The shared birth vector (packages/core/test/birth.test.ts): the test
    // production key gave birth to two chips; each signed A = G and F = 2G.
    const PRODUCTION_KEY: &str = "03b55236f472a641ea4ab4ab08eb13975bfc8e5c0ddd5f7c6071c87bcdadf60d1b";

    /// A born chip: C, its birth signature, and its signature over A = G, F = 2G.
    struct Chip {
        key: &'static str,
        birth: &'static str,
        keys: &'static str,
    }
    const CHIP_1: Chip = Chip {
        key: "03ea3ac40b638d319b2ca804024fc12321513e5d2bfc681183a0750a3f86e35813",
        birth: "2c2efd03aa3c7ce51cb4807c4de63460ef8981cfaaaa183b09c6e55e0679d855127c8340a4e3f52d96c44eab73012c1301c158a39c1f02977889339d2e58cd99",
        keys: "2116ad0b93f2e1f1e84c4f84cccedf0843311e103ae4a93b4909fbf28278182053d93edd3d8cdeb213403184b82f12e69f305dcd84bf802f6211ab73221c9a5d",
    };
    const CHIP_2: Chip = Chip {
        key: "023886b63861ee55717fef72a630b3a302c7076e75300c6adb59935d228eab94dd",
        birth: "896f14d4e6cad071048162ff2f029885ddb57cfde3a7226b212a6a43be542c645422853995bf4c1759ac43f8fe0929a8fe2cdc4e05a6508d1c167f6ca99d3909",
        keys: "3a7e000cc9cb6fd5c9a05e54c013e37844e0b0c476075089a5525d4cd54e42ed3ac519c53dce00f2e7422c4e5dd7d3864d8bd266d3deaa70e920ec3e6c67fdbf",
    };
    /// 2026-11-03 00:00 UTC.
    const DAY: u64 = 1_793_664_000;
    const TEN_USDC: u128 = 10_000_000;

    fn account(name: &str) -> AccountId {
        name.parse().unwrap()
    }

    /// Runs the next calls as `caller`, at `seconds` (Unix time).
    fn as_caller_at(caller: &str, seconds: u64) {
        testing_env!(VMContextBuilder::new()
            .predecessor_account_id(account(caller))
            .block_timestamp(seconds * NANOSECONDS_PER_SECOND)
            .build());
    }

    fn as_caller(caller: &str) {
        as_caller_at(caller, DAY + 3_600);
    }

    fn config() -> Config {
        Config {
            owner: account("owner.testnet"),
            mpc_contract: account("v1.signer-prod.testnet"),
            path: "nearcash-certificates-v1".into(),
            issuer_public_key: KEY_3G.into(),
            token_id: "nep141:usdc.testnet".into(),
            symbol: "USDC".into(),
            decimals: 6,
            funds_contract_id: "intents.far".into(),
            denominations: vec![U128(TEN_USDC), U128(20_000_000)],
            daily_value_cap: U128(30_000_000),
            production_public_key: PRODUCTION_KEY.into(),
        }
    }

    fn contract() -> IssuerContract {
        as_caller("owner.testnet");
        let mut issuer = IssuerContract::new(config());
        issuer.add_minter(account("mint.testnet"));
        issuer
    }

    /// Asks a certificate for A = G, F = 2G, born in `chip`.
    fn mint_with(issuer: &mut IssuerContract, chip: &Chip, amount: u128, issued_at: u64) -> Promise {
        issuer.sign_certificate(
            KEY_G.into(),
            KEY_2G.into(),
            U128(amount),
            issued_at,
            chip.key.into(),
            chip.birth.into(),
            chip.keys.into(),
        )
    }

    fn mint(issuer: &mut IssuerContract, amount: u128, issued_at: u64) -> Promise {
        mint_with(issuer, &CHIP_1, amount, issued_at)
    }

    #[test]
    fn body_matches_the_typescript_encoder() {
        // Same fields as the vector printed by packages/core (encodeCertificateBody).
        let issuer = contract();
        let body = issuer.certificate_body(&from_hex(KEY_G).unwrap(), &from_hex(KEY_2G).unwrap(), TEN_USDC, DAY);
        assert_eq!(to_hex(&env::sha256(&body)), "9fa4aaacb17a7e39c26ce4a0613484a581fa1a2658368b700468824a4ec2ab96");
    }

    #[test]
    fn mint_gets_a_certificate_and_it_is_counted() {
        let mut issuer = contract();
        as_caller("mint.testnet");
        let _promise = mint(&mut issuer, TEN_USDC, DAY);
        assert!(get_logs().iter().any(|log| log.contains("9fa4aaacb17a7e39c26ce4a0613484a581fa1a2658368b700468824a4ec2ab96")));
        let stats = issuer.stats();
        assert_eq!((stats.certificates, stats.total_value.0, stats.day_value.0), (1, TEN_USDC, TEN_USDC));
    }

    #[test]
    #[should_panic(expected = "only an authorised minter")]
    fn atms_and_strangers_cannot_mint() {
        let mut issuer = contract();
        as_caller("atm-1.testnet");
        let _ = mint(&mut issuer, TEN_USDC, DAY);
    }

    #[test]
    #[should_panic(expected = "not an allowed denomination")]
    fn only_allowed_denominations() {
        let mut issuer = contract();
        as_caller("mint.testnet");
        let _ = mint(&mut issuer, 1_000_000_000, DAY);
    }

    #[test]
    #[should_panic(expected = "daily value cap reached")]
    fn daily_cap_limits_a_compromised_mint() {
        let mut issuer = contract();
        as_caller("mint.testnet");
        let _ = mint_with(&mut issuer, &CHIP_1, 20_000_000, DAY);
        let _ = mint_with(&mut issuer, &CHIP_2, 20_000_000, DAY); // 40 > cap of 30
    }

    #[test]
    fn the_daily_cap_resets_the_next_day() {
        let mut issuer = contract();
        as_caller("mint.testnet");
        let _ = mint_with(&mut issuer, &CHIP_1, 20_000_000, DAY);
        as_caller_at("mint.testnet", DAY + SECONDS_PER_DAY + 60);
        let _ = mint_with(&mut issuer, &CHIP_2, 20_000_000, DAY + SECONDS_PER_DAY);
        assert_eq!(issuer.stats().day_value.0, 20_000_000);
        assert_eq!(issuer.stats().total_value.0, 40_000_000);
    }

    // ------------------------------------------------------------------ birth certificates

    #[test]
    fn a_born_chip_is_certified_once_and_recorded() {
        let mut issuer = contract();
        as_caller("mint.testnet");
        assert!(!issuer.is_chip_certified(CHIP_1.key.into()));
        let _ = mint(&mut issuer, TEN_USDC, DAY);
        assert!(issuer.is_chip_certified(CHIP_1.key.into()));
    }

    #[test]
    fn the_same_request_again_is_a_retry_counted_once() {
        let mut issuer = contract();
        as_caller("mint.testnet");
        let _ = mint(&mut issuer, TEN_USDC, DAY);
        let _ = mint(&mut issuer, TEN_USDC, DAY);
        assert_eq!((issuer.stats().certificates, issuer.stats().total_value.0), (1, TEN_USDC));
    }

    #[test]
    #[should_panic(expected = "already has a certificate")]
    fn a_chip_never_gets_a_second_certificate_for_another_amount() {
        let mut issuer = contract();
        as_caller("mint.testnet");
        let _ = mint(&mut issuer, TEN_USDC, DAY);
        let _ = mint(&mut issuer, 20_000_000, DAY);
    }

    #[test]
    #[should_panic(expected = "no valid birth certificate")]
    fn a_chip_the_bank_did_not_make_is_refused() {
        let mut issuer = contract();
        as_caller("mint.testnet");
        // Chip 1's key with chip 2's birth signature: not signed for this chip.
        let forged = Chip { key: CHIP_1.key, birth: CHIP_2.birth, keys: CHIP_1.keys };
        let _ = mint_with(&mut issuer, &forged, TEN_USDC, DAY);
    }

    #[test]
    #[should_panic(expected = "did not sign these keys")]
    fn keys_born_outside_the_chip_are_refused() {
        let mut issuer = contract();
        as_caller("mint.testnet");
        // A genuine birth, but A and F swapped: the chip signed G, 2G in that order.
        let _ = issuer.sign_certificate(
            KEY_2G.into(),
            KEY_G.into(),
            U128(TEN_USDC),
            DAY,
            CHIP_1.key.into(),
            CHIP_1.birth.into(),
            CHIP_1.keys.into(),
        );
    }

    #[test]
    #[should_panic(expected = "no valid birth certificate")]
    fn another_production_key_gives_birth_to_nothing() {
        let mut issuer = contract();
        issuer.set_production_key(KEY_3G.into());
        as_caller("mint.testnet");
        let _ = mint(&mut issuer, TEN_USDC, DAY);
    }

    #[test]
    #[should_panic(expected = "only the owner")]
    fn only_the_owner_sets_the_production_key() {
        let mut issuer = contract();
        as_caller("mint.testnet");
        issuer.set_production_key(KEY_3G.into());
    }

    #[test]
    fn migrate_keeps_minters_and_counters_and_requires_birth() {
        // A contract as deployed before birth certificates, with one minter and one certificate.
        as_caller("issuer.testnet");
        let c = config();
        let mut minters = IterableSet::new(b"m");
        minters.insert(account("mint.testnet"));
        minters.flush(); // the old contract's storage, written as its own calls would have
        let old = IssuerContractV1 {
            config: ConfigV1 {
                owner: c.owner,
                mpc_contract: c.mpc_contract,
                path: c.path,
                issuer_public_key: c.issuer_public_key,
                token_id: c.token_id,
                symbol: c.symbol,
                decimals: c.decimals,
                funds_contract_id: c.funds_contract_id,
                denominations: c.denominations,
                daily_value_cap: c.daily_value_cap,
            },
            minters,
            stats: Stats { certificates: 1, total_value: U128(TEN_USDC), day: 0, day_value: U128(0) },
        };
        env::state_write(&old);

        let mut issuer = IssuerContract::migrate(PRODUCTION_KEY.into());
        assert_eq!(issuer.config().production_public_key, PRODUCTION_KEY);
        assert!(issuer.is_minter(account("mint.testnet")));
        assert_eq!(issuer.stats().certificates, 1);

        as_caller("mint.testnet");
        let _ = mint(&mut issuer, TEN_USDC, DAY);
        assert_eq!(issuer.stats().certificates, 2);
    }

    #[test]
    #[should_panic(expected = "issued_at must be 00:00 UTC")]
    fn issue_date_is_rounded_to_the_day() {
        let mut issuer = contract();
        as_caller("mint.testnet");
        let _ = mint(&mut issuer, TEN_USDC, DAY + 3_600); // carries the hour of purchase
    }

    #[test]
    #[should_panic(expected = "issued_at must be 00:00 UTC")]
    fn cannot_backdate_by_more_than_a_day() {
        let mut issuer = contract();
        as_caller("mint.testnet");
        let _ = mint(&mut issuer, TEN_USDC, DAY - 2 * SECONDS_PER_DAY);
    }

    #[test]
    #[should_panic(expected = "must be a compressed secp256k1 key")]
    fn rejects_malformed_keys() {
        let mut issuer = contract();
        as_caller("mint.testnet");
        let _ = issuer.sign_certificate(
            "04abcd".into(),
            KEY_2G.into(),
            U128(TEN_USDC),
            DAY,
            CHIP_1.key.into(),
            CHIP_1.birth.into(),
            CHIP_1.keys.into(),
        );
    }

    #[test]
    #[should_panic(expected = "only the owner")]
    fn only_the_owner_manages_minters() {
        let mut issuer = contract();
        as_caller("mint.testnet");
        issuer.add_minter(account("mint-2.testnet"));
    }

    #[test]
    #[should_panic(expected = "only an authorised minter")]
    fn revoked_minters_stop_immediately() {
        let mut issuer = contract();
        issuer.remove_minter(account("mint.testnet"));
        as_caller("mint.testnet");
        let _ = mint(&mut issuer, TEN_USDC, DAY);
    }

    #[test]
    fn sign_request_matches_the_mpc_wire_format() {
        let request = SignRequest {
            path: "nearcash-certificates-v1".into(),
            payload_v2: Payload::Ecdsa("ab".repeat(32)),
            domain_id: SECP256K1_DOMAIN_ID,
        };
        assert_eq!(
            near_sdk::serde_json::to_string(&request).unwrap(),
            format!(r#"{{"path":"nearcash-certificates-v1","payload_v2":{{"Ecdsa":"{}"}},"domain_id":0}}"#, "ab".repeat(32))
        );
    }
}
