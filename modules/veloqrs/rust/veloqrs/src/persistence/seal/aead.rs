//! AES-256-GCM for the sealed container: the data-key wraps and the payload.
//!
//! This module is the one owner of the cipher. Apple targets take it from
//! CommonCrypto, which libSystem carries, so an Apple build holds no cipher
//! crate of its own. Other targets take it from the `aes-gcm` crate. The two
//! implementations are held to the same known-answer tests in `aead_tests.rs`.
//!
//! The nonce is 12 bytes and the tag is 16, appended to the ciphertext.

use super::layout::{KEY_LEN, NONCE_LEN, TAG_LEN};

#[cfg(target_vendor = "apple")]
mod apple;
#[cfg(not(target_vendor = "apple"))]
mod rust;

#[cfg(target_vendor = "apple")]
use apple as imp;
#[cfg(not(target_vendor = "apple"))]
use rust as imp;

/// The input did not authenticate, or could not be processed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct Failed;

/// Ciphertext followed by the 16-byte tag, authenticating `aad` as well.
pub(super) fn encrypt(
    key: &[u8; KEY_LEN],
    nonce: &[u8; NONCE_LEN],
    aad: &[u8],
    message: &[u8],
) -> Result<Vec<u8>, Failed> {
    imp::encrypt(key, nonce, aad, message)
}

/// The message from ciphertext followed by its tag. Nothing is returned unless
/// the tag authenticates the ciphertext and `aad`.
pub(super) fn decrypt(
    key: &[u8; KEY_LEN],
    nonce: &[u8; NONCE_LEN],
    aad: &[u8],
    sealed: &[u8],
) -> Result<Vec<u8>, Failed> {
    if sealed.len() < TAG_LEN {
        return Err(Failed);
    }
    imp::decrypt(key, nonce, aad, sealed)
}

#[cfg(test)]
#[path = "aead_tests.rs"]
mod tests;
