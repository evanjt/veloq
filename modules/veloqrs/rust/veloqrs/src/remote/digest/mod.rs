//! SHA-256 and HMAC-SHA256 for the remote link: the pairing proof, the room a
//! linked pair meets in, and the certificate fingerprint.
//!
//! This module is the one owner of the two primitives. Apple targets take them
//! from CommonCrypto, which libSystem carries, so an Apple build holds no hash
//! or MAC crate of its own. Other targets take them from the `sha2` and `hmac`
//! crates. The two implementations are held to the same known-answer tests in
//! `tests.rs`, and that shared test is what makes them one primitive.
//!
//! Each function takes its message as parts, fed in order: the result is the
//! digest of their concatenation, so a caller frames its own fields.

#[cfg(target_vendor = "apple")]
mod apple;
#[cfg(not(target_vendor = "apple"))]
mod rust;

#[cfg(target_vendor = "apple")]
use apple as imp;
#[cfg(not(target_vendor = "apple"))]
use rust as imp;

/// SHA-256 of the parts, fed in order as one message.
pub fn sha256(parts: &[&[u8]]) -> [u8; 32] {
    imp::sha256(parts)
}

/// SHA-256 of a message that arrives in pieces, for a file too large to hold
/// whole. The digest is that of the pieces fed in order, joined.
pub struct Sha256Stream(imp::Stream);

impl Sha256Stream {
    pub fn new() -> Self {
        Self(imp::Stream::new())
    }

    pub fn update(&mut self, bytes: &[u8]) {
        self.0.update(bytes);
    }

    pub fn finish(self) -> [u8; 32] {
        self.0.finish()
    }
}

impl Default for Sha256Stream {
    fn default() -> Self {
        Self::new()
    }
}

/// HMAC-SHA256 under `key` over the parts, fed in order as one message.
pub fn hmac_sha256(key: &[u8], parts: &[&[u8]]) -> [u8; 32] {
    imp::hmac_sha256(key, parts)
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
