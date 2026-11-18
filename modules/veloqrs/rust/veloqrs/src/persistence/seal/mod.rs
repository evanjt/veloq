//! The sealed container: one file format for everything the engine writes
//! encrypted, a record backup, a month pack of rides and the manifest that
//! lists the packs (`pack`).
//!
//! This module is the one owner of the container and of its two primitives,
//! Argon2id and AES-256-GCM, the way `remote::digest` owns SHA-256. Nothing
//! else in the engine derives a key or encrypts a byte. It works on bytes and
//! takes its randomness through [`Randomness`], so a test seals with fixed
//! bytes and the golden vectors pin the writer as well as the reader.
//!
//! ```text
//! offset  size   field
//! 0       8      magic, ASCII `VQSEALED`
//! 8       2      format version, u16 little-endian, 1
//! 10      4      header length n, u32 little-endian
//! 14      n      header, UTF-8 JSON (see `layout::Header`)
//! 14+n    rest   AES-256-GCM(DEK, payload nonce, aad = bytes 0..14+n, plaintext)
//! ```
//!
//! A random data key (DEK) seals the payload. Each wrap holds the DEK under a
//! key derived from one secret, so changing the secret rewraps the DEK and
//! re-encrypts nothing. A wrap is bound to the key id and its role as
//! associated data, and the whole header is the payload's associated data, so
//! an edit to any field fails authentication before a byte of payload is read.
//! A pack and a manifest are sealed under the DEK alone and carry no wrap: the
//! wraps live in the key file.
//!
//! Rules that hold for every later release: a reader dispatches on the version
//! and on every header field and never on a default; the version 1 reader stays
//! in the tree for good, because an archive on a server outlives every release;
//! a later version is added beside it and never changes what version 1 means.
//! The fixtures under `tests/fixtures/sealed/` hold one archive per version and
//! `sealed_vectors_from_every_version_open` fails when one stops opening.

mod aead;
mod layout;
pub mod pack;
pub mod ride_bytes;

use argon2::{Algorithm, Argon2, Params, Version};
use zeroize::Zeroizing;

use layout::{ARGON2_VERSION, KEY_ID_LEN, KEY_LEN, NONCE_LEN, SALT_LEN, TAG_LEN, WRAPPED_LEN};
pub use layout::{Cipher, Encoding, Header, KdfAlg, KdfParams, Kind, PayloadParams, Wrap, WrapBy};

pub const MAGIC: &[u8; 8] = b"VQSEALED";
pub const FORMAT_VERSION: u16 = 1;
/// Memory, passes and lanes of the Argon2id derivation a new archive asks for:
/// RFC 9106's second recommended option.
pub const KDF_M_KIB: u32 = 65_536;
pub const KDF_T: u32 = 3;
pub const KDF_P: u32 = 1;

const PREFIX_LEN: usize = MAGIC.len() + 2 + 4;
/// The largest header a reader accepts. A header holds two wraps and a few
/// short fields, so this is generous and keeps a forged length from asking for
/// a large read.
const MAX_HEADER_LEN: usize = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SealError {
    #[error("This file is not a sealed backup")]
    NotSealed,
    #[error("The sealed backup is cut short")]
    Truncated,
    #[error("Sealed backup version {0} is newer than supported version {FORMAT_VERSION}")]
    NewerVersion(u16),
    #[error("Unsupported sealed backup version {0}")]
    UnsupportedVersion(u16),
    #[error("The sealed backup header is not valid: {0}")]
    BadHeader(String),
    #[error("The sealed backup asks for {0}, which this build does not support")]
    UnsupportedParameters(String),
    /// No wrap opened under the secret, so the payload was never touched.
    #[error("The secret does not open this backup")]
    WrongSecret,
    /// The payload failed authentication: a byte changed after sealing.
    #[error("The sealed backup is damaged")]
    Damaged,
    #[error("A secret is required")]
    EmptySecret,
    #[error("The key derivation failed: {0}")]
    Derivation(String),
    #[error("No random bytes were available: {0}")]
    Random(String),
    #[error("The backup is too large to seal")]
    TooLarge,
}

/// Where keys, salts and nonces come from.
pub trait Randomness {
    /// Fill `out` with random bytes.
    ///
    /// # Errors
    ///
    /// Fails when the source cannot supply them.
    fn fill(&mut self, out: &mut [u8]) -> Result<(), SealError>;
}

/// The operating system's random source.
pub struct OsRandom;

impl Randomness for OsRandom {
    fn fill(&mut self, out: &mut [u8]) -> Result<(), SealError> {
        getrandom::fill(out).map_err(|e| SealError::Random(e.to_string()))
    }
}

fn random<const N: usize>(rng: &mut dyn Randomness) -> Result<[u8; N], SealError> {
    let mut bytes = [0u8; N];
    rng.fill(&mut bytes)?;
    Ok(bytes)
}

/// The key that seals the payload, cleared from memory when it drops.
pub struct Dek(Zeroizing<[u8; KEY_LEN]>);

impl Dek {
    #[must_use]
    pub fn from_bytes(bytes: [u8; KEY_LEN]) -> Self {
        Self(Zeroizing::new(bytes))
    }

    /// A new random key.
    ///
    /// # Errors
    ///
    /// Fails when the random source does.
    pub fn generate(rng: &mut dyn Randomness) -> Result<Self, SealError> {
        random(rng).map(Self::from_bytes)
    }

    #[must_use]
    pub fn as_bytes(&self) -> &[u8; KEY_LEN] {
        &self.0
    }
}

impl Clone for Dek {
    fn clone(&self) -> Self {
        Self::from_bytes(*self.0)
    }
}

impl std::fmt::Debug for Dek {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Dek(..)")
    }
}

impl KdfParams {
    /// The cost a new archive asks for, with a fresh salt.
    ///
    /// # Errors
    ///
    /// Fails when the random source does.
    pub fn standard(rng: &mut dyn Randomness) -> Result<Self, SealError> {
        Ok(Self {
            alg: KdfAlg::Argon2id,
            version: ARGON2_VERSION,
            m_kib: KDF_M_KIB,
            t: KDF_T,
            p: KDF_P,
            salt: random::<SALT_LEN>(rng)?,
        })
    }
}

/// Everything needed to seal more payloads under one data key: the key, its id,
/// the derivation the wraps share and the wraps themselves.
#[derive(Debug, Clone)]
pub struct Sealing {
    pub dek: Dek,
    pub key_id: [u8; KEY_ID_LEN],
    pub kdf: KdfParams,
    pub wraps: Vec<Wrap>,
}

impl Sealing {
    /// A new data key with one wrap under `secret`.
    ///
    /// # Errors
    ///
    /// Fails on an empty secret or when the random source or derivation does.
    pub fn new(secret: &[u8], rng: &mut dyn Randomness) -> Result<Self, SealError> {
        let dek = Dek::generate(rng)?;
        let key_id = random::<KEY_ID_LEN>(rng)?;
        let kdf = KdfParams::standard(rng)?;
        let wrap = wrap_dek(&dek, &key_id, WrapBy::Secret, secret, &kdf, rng)?;
        Ok(Self {
            dek,
            key_id,
            kdf,
            wraps: vec![wrap],
        })
    }
}

/// The 32-byte key an Argon2id derivation gives for a secret.
fn derive_kek(secret: &[u8], kdf: &KdfParams) -> Result<Zeroizing<[u8; KEY_LEN]>, SealError> {
    if secret.is_empty() {
        return Err(SealError::EmptySecret);
    }
    let params = Params::new(kdf.m_kib, kdf.t, kdf.p, Some(KEY_LEN))
        .map_err(|e| SealError::Derivation(e.to_string()))?;
    // Lanes are computed one after another, so a phone with one free core
    // derives the same key as a desktop does, in the same time.
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut kek = Zeroizing::new([0u8; KEY_LEN]);
    argon
        .hash_password_into(secret, &kdf.salt, kek.as_mut())
        .map_err(|e| SealError::Derivation(e.to_string()))?;
    Ok(kek)
}

fn wrap_aad(key_id: [u8; KEY_ID_LEN], by: WrapBy) -> Vec<u8> {
    [key_id.as_slice(), by.tag()].concat()
}

/// Seal `dek` under a key derived from `secret`.
///
/// # Errors
///
/// Fails on an empty secret or when the random source or derivation does.
pub fn wrap_dek(
    dek: &Dek,
    key_id: &[u8; KEY_ID_LEN],
    by: WrapBy,
    secret: &[u8],
    kdf: &KdfParams,
    rng: &mut dyn Randomness,
) -> Result<Wrap, SealError> {
    let kek = derive_kek(secret, kdf)?;
    let nonce = random::<NONCE_LEN>(rng)?;
    let sealed = aead::encrypt(&kek, &nonce, &wrap_aad(*key_id, by), dek.as_bytes())
        .map_err(|_| SealError::Damaged)?;
    let wrapped =
        <[u8; WRAPPED_LEN]>::try_from(sealed.as_slice()).map_err(|_| SealError::Damaged)?;
    Ok(Wrap { by, nonce, wrapped })
}

/// The same data key under a new secret for one role, which replaces that
/// role's wrap and leaves the other. The next archive sealed from the result
/// carries the new wrap, and no payload is re-encrypted.
///
/// # Errors
///
/// Fails on an empty secret or when the random source or derivation does.
pub fn rewrap(
    sealing: &Sealing,
    by: WrapBy,
    new_secret: &[u8],
    rng: &mut dyn Randomness,
) -> Result<Sealing, SealError> {
    let wrap = wrap_dek(
        &sealing.dek,
        &sealing.key_id,
        by,
        new_secret,
        &sealing.kdf,
        rng,
    )?;
    let mut next = sealing.clone();
    next.wraps.retain(|existing| existing.by != by);
    next.wraps.push(wrap);
    Ok(next)
}

/// Seal `plaintext` under the data key, with every wrap in `sealing` in the
/// header.
///
/// # Errors
///
/// Fails when the keys in `sealing` are not a valid header or the payload is
/// too long to seal.
pub fn seal(
    plaintext: &[u8],
    kind: Kind,
    sealing: &Sealing,
    rng: &mut dyn Randomness,
) -> Result<Vec<u8>, SealError> {
    let header = Header {
        kind,
        kdf: sealing.kdf.clone(),
        cipher: Cipher::Aes256Gcm,
        key_id: sealing.key_id,
        wraps: sealing.wraps.clone(),
        payload: PayloadParams {
            nonce: random::<NONCE_LEN>(rng)?,
            encoding: kind.encoding(),
        },
    };
    header.validate()?;
    let json = serde_json::to_vec(&header).map_err(|e| SealError::BadHeader(e.to_string()))?;
    let header_len = u32::try_from(json.len()).map_err(|_| SealError::TooLarge)?;
    let mut out = Vec::with_capacity(PREFIX_LEN + json.len() + plaintext.len() + TAG_LEN);
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&FORMAT_VERSION.to_le_bytes());
    out.extend_from_slice(&header_len.to_le_bytes());
    out.extend_from_slice(&json);
    let sealed = aead::encrypt(
        sealing.dek.as_bytes(),
        &header.payload.nonce,
        &out,
        plaintext,
    )
    .map_err(|_| SealError::TooLarge)?;
    out.extend_from_slice(&sealed);
    Ok(out)
}

/// A container read as far as its header: nothing here has been authenticated.
struct Parsed<'a> {
    header: Header,
    /// Bytes `0..14+n`, the payload's associated data.
    prefix: &'a [u8],
    ciphertext: &'a [u8],
}

fn parse(bytes: &[u8]) -> Result<Parsed<'_>, SealError> {
    if bytes.len() < MAGIC.len() || &bytes[..MAGIC.len()] != MAGIC {
        return Err(SealError::NotSealed);
    }
    if bytes.len() < PREFIX_LEN {
        return Err(SealError::Truncated);
    }
    let version = u16::from_le_bytes([bytes[8], bytes[9]]);
    match version {
        FORMAT_VERSION => {}
        0 => return Err(SealError::UnsupportedVersion(version)),
        _ => return Err(SealError::NewerVersion(version)),
    }
    let header_len = u32::from_le_bytes([bytes[10], bytes[11], bytes[12], bytes[13]]) as usize;
    if header_len > MAX_HEADER_LEN {
        return Err(SealError::BadHeader("the header is too long".to_string()));
    }
    let body_start = PREFIX_LEN + header_len;
    if bytes.len() < body_start + TAG_LEN {
        return Err(SealError::Truncated);
    }
    let header: Header = serde_json::from_slice(&bytes[PREFIX_LEN..body_start])
        .map_err(|e| SealError::BadHeader(e.to_string()))?;
    header.validate()?;
    Ok(Parsed {
        header,
        prefix: &bytes[..body_start],
        ciphertext: &bytes[body_start..],
    })
}

/// The header of a container, read without the secret and without touching
/// the payload. This is what a listing may show.
///
/// # Errors
///
/// Fails when the bytes are not a container this build can read.
pub fn header(bytes: &[u8]) -> Result<Header, SealError> {
    parse(bytes).map(|parsed| parsed.header)
}

/// The id of the data key a container is sealed under, which groups the
/// archives of one library.
///
/// # Errors
///
/// Fails when the bytes are not a container this build can read.
pub fn key_id(bytes: &[u8]) -> Result<[u8; KEY_ID_LEN], SealError> {
    header(bytes).map(|header| header.key_id)
}

/// What an archive opens to.
#[derive(Debug)]
pub struct Opened {
    pub kind: Kind,
    pub plaintext: Vec<u8>,
    /// The data key and the header's wraps, to seal the next archive under the
    /// same key or to rewrap it.
    pub sealing: Sealing,
}

fn unwrap_dek(header: &Header, secret: &[u8]) -> Result<Dek, SealError> {
    let kek = derive_kek(secret, &header.kdf)?;
    for wrap in &header.wraps {
        let opened = aead::decrypt(
            &kek,
            &wrap.nonce,
            &wrap_aad(header.key_id, wrap.by),
            &wrap.wrapped,
        );
        let Ok(key) = opened else { continue };
        let key = Zeroizing::new(key);
        if let Ok(bytes) = <[u8; KEY_LEN]>::try_from(key.as_slice()) {
            return Ok(Dek::from_bytes(bytes));
        }
    }
    Err(SealError::WrongSecret)
}

fn open_payload(parsed: Parsed<'_>, dek: Dek) -> Result<Opened, SealError> {
    let plaintext = aead::decrypt(
        dek.as_bytes(),
        &parsed.header.payload.nonce,
        parsed.prefix,
        parsed.ciphertext,
    )
    .map_err(|_| SealError::Damaged)?;
    let header = parsed.header;
    Ok(Opened {
        kind: header.kind,
        plaintext,
        sealing: Sealing {
            dek,
            key_id: header.key_id,
            kdf: header.kdf,
            wraps: header.wraps,
        },
    })
}

/// Open a container with a secret: the PIN or the recovery key. A secret no
/// wrap opens is [`SealError::WrongSecret`] and the payload is never read.
///
/// # Errors
///
/// Fails when the bytes are not a container this build can read, when the
/// secret opens no wrap, or when the payload fails authentication.
pub fn open(bytes: &[u8], secret: &[u8]) -> Result<Opened, SealError> {
    let parsed = parse(bytes)?;
    let dek = unwrap_dek(&parsed.header, secret)?;
    open_payload(parsed, dek)
}

/// Open a container with the data key itself, which is how an automatic run
/// reads back a backup without asking for the secret.
///
/// # Errors
///
/// Fails when the bytes are not a container this build can read or the key does
/// not authenticate the payload.
pub fn open_with_dek(bytes: &[u8], dek: Dek) -> Result<Opened, SealError> {
    open_payload(parse(bytes)?, dek)
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
