//! The byte layout and header of a sealed container, version 1.
//!
//! The header is UTF-8 JSON written by `serde_json` in the field order below.
//! Every field is required and an unknown one is refused, so a reader never
//! dispatches on a default. The bytes the header was read from, not a
//! re-serialisation of them, are what authenticates the payload.

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde::{Deserialize, Serialize};

use super::SealError;

pub const KEY_ID_LEN: usize = 8;
pub const SALT_LEN: usize = 16;
pub const NONCE_LEN: usize = 12;
pub const KEY_LEN: usize = 32;
pub const TAG_LEN: usize = 16;
/// A wrapped data key: the key and the tag.
pub const WRAPPED_LEN: usize = KEY_LEN + TAG_LEN;

/// The Argon2 version number the format names: 0x13, which is 19.
pub const ARGON2_VERSION: u32 = 19;
/// Cost bounds a reader accepts. The header is read before anything in it is
/// authenticated, so these keep a forged header from asking for a derivation
/// the phone cannot afford.
pub const MAX_M_KIB: u32 = 262_144;
pub const MAX_T: u32 = 16;
pub const MAX_P: u32 = 4;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    /// The record backup.
    Record,
    /// One calendar month of rides, sealed under the data key alone.
    Pack,
    /// The listing of a destination's packs, sealed under the data key alone.
    Manifest,
}

impl Kind {
    /// The one payload encoding this kind carries.
    #[must_use]
    pub fn encoding(self) -> Encoding {
        match self {
            Kind::Record => Encoding::RecordZip,
            Kind::Pack => Encoding::PackZip,
            Kind::Manifest => Encoding::ManifestJson,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum KdfAlg {
    #[serde(rename = "argon2id")]
    Argon2id,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Cipher {
    #[serde(rename = "aes-256-gcm")]
    Aes256Gcm,
}

/// Which secret opens a wrap.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WrapBy {
    Secret,
    Recovery,
}

impl WrapBy {
    /// The bytes that bind a wrap to its role, as the associated data names it.
    #[must_use]
    pub fn tag(self) -> &'static [u8] {
        match self {
            WrapBy::Secret => b"secret",
            WrapBy::Recovery => b"recovery",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Encoding {
    /// The plaintext is the record zip `write_record_zip` makes.
    #[serde(rename = "record-zip")]
    RecordZip,
    /// The plaintext is the zip `pack::write_pack` makes.
    #[serde(rename = "pack-zip")]
    PackZip,
    /// The plaintext is the JSON `pack::write_manifest` makes.
    #[serde(rename = "manifest-json")]
    ManifestJson,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KdfParams {
    pub alg: KdfAlg,
    pub version: u32,
    pub m_kib: u32,
    pub t: u32,
    pub p: u32,
    #[serde(with = "b64")]
    pub salt: [u8; SALT_LEN],
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Wrap {
    pub by: WrapBy,
    #[serde(with = "b64")]
    pub nonce: [u8; NONCE_LEN],
    #[serde(with = "b64")]
    pub wrapped: [u8; WRAPPED_LEN],
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PayloadParams {
    #[serde(with = "b64")]
    pub nonce: [u8; NONCE_LEN],
    pub encoding: Encoding,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Header {
    pub kind: Kind,
    pub kdf: KdfParams,
    pub cipher: Cipher,
    #[serde(with = "b64")]
    pub key_id: [u8; KEY_ID_LEN],
    pub wraps: Vec<Wrap>,
    pub payload: PayloadParams,
}

impl Header {
    /// Refuse a header whose values the format does not define.
    ///
    /// # Errors
    ///
    /// Fails on an Argon2 version or cost outside the format, an encoding the
    /// kind does not carry, an empty list of wraps on a record, any wrap on a
    /// pack or a manifest (the wraps live in the key file), or a role wrapped
    /// twice.
    pub fn validate(&self) -> Result<(), SealError> {
        let kdf = &self.kdf;
        if kdf.version != ARGON2_VERSION {
            return Err(SealError::UnsupportedParameters(format!(
                "Argon2 version {}",
                kdf.version
            )));
        }
        let in_bounds = (1..=MAX_P).contains(&kdf.p)
            && (1..=MAX_T).contains(&kdf.t)
            && (8 * kdf.p..=MAX_M_KIB).contains(&kdf.m_kib);
        if !in_bounds {
            return Err(SealError::UnsupportedParameters(format!(
                "Argon2 cost m={} KiB, t={}, p={}",
                kdf.m_kib, kdf.t, kdf.p
            )));
        }
        if self.payload.encoding != self.kind.encoding() {
            return Err(SealError::BadHeader(
                "the encoding does not belong to the kind".to_string(),
            ));
        }
        match (self.kind, self.wraps.is_empty()) {
            (Kind::Record, true) => {
                return Err(SealError::BadHeader("no key wraps".to_string()));
            }
            (Kind::Pack | Kind::Manifest, false) => {
                return Err(SealError::BadHeader(
                    "a pack or a manifest carries no key wraps".to_string(),
                ));
            }
            _ => {}
        }
        let mut roles = Vec::new();
        for wrap in &self.wraps {
            if roles.contains(&wrap.by) {
                return Err(SealError::BadHeader("a role is wrapped twice".to_string()));
            }
            roles.push(wrap.by);
        }
        Ok(())
    }
}

/// Fixed-size byte fields as standard base64 with padding.
mod b64 {
    use super::{Deserialize, Engine, STANDARD};
    use serde::{Deserializer, Serializer, de::Error};

    pub fn serialize<S: Serializer, const N: usize>(
        bytes: &[u8; N],
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&STANDARD.encode(bytes))
    }

    pub fn deserialize<'de, D: Deserializer<'de>, const N: usize>(
        deserializer: D,
    ) -> Result<[u8; N], D::Error> {
        let text = String::deserialize(deserializer)?;
        let bytes = STANDARD
            .decode(text.as_bytes())
            .map_err(|_| D::Error::custom("not standard base64"))?;
        <[u8; N]>::try_from(bytes.as_slice())
            .map_err(|_| D::Error::custom(format!("expected {N} bytes, found {}", bytes.len())))
    }
}
