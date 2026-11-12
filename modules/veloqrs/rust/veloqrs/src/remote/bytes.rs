//! How a byte field crosses the link: as one base64 string.
//!
//! `serde_json` writes a `Vec<u8>` as an array of numbers, three to four times
//! the bytes, so every byte field of a record the link carries names this
//! module with `#[serde(with = "crate::remote::bytes")]`, or its `option`
//! form for an `Option<Vec<u8>>`. The browser decodes with one helper.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// Write `bytes` as a padded base64 string.
pub fn serialize<S: Serializer>(bytes: &[u8], serializer: S) -> Result<S::Ok, S::Error> {
    STANDARD.encode(bytes).serialize(serializer)
}

/// Read a padded base64 string back into bytes.
pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<u8>, D::Error> {
    let text = String::deserialize(deserializer)?;
    STANDARD.decode(text).map_err(serde::de::Error::custom)
}

/// The same for a field that may be absent: `null` when it is.
pub mod option {
    use super::{Deserialize, Deserializer, STANDARD, Serialize, Serializer};
    use base64::Engine as _;

    /// Write `bytes` as a base64 string, or `null`.
    pub fn serialize<S: Serializer>(
        bytes: &Option<Vec<u8>>,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        bytes
            .as_ref()
            .map(|bytes| STANDARD.encode(bytes))
            .serialize(serializer)
    }

    /// Read a base64 string or `null` back.
    pub fn deserialize<'de, D: Deserializer<'de>>(
        deserializer: D,
    ) -> Result<Option<Vec<u8>>, D::Error> {
        Option::<String>::deserialize(deserializer)?
            .map(|text| STANDARD.decode(text).map_err(serde::de::Error::custom))
            .transpose()
    }
}

#[cfg(test)]
#[path = "tests/bytes.rs"]
mod tests;
