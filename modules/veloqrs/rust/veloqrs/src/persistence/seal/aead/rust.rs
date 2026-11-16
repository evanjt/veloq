//! AES-256-GCM from the `aes-gcm` crate.

use aes_gcm::aead::{Aead, Payload};
use aes_gcm::{Aes256Gcm, Key, KeyInit};

use super::super::layout::{KEY_LEN, NONCE_LEN};
use super::Failed;

fn cipher(key: &[u8; KEY_LEN]) -> Aes256Gcm {
    Aes256Gcm::new(&Key::<Aes256Gcm>::from(*key))
}

pub(super) fn encrypt(
    key: &[u8; KEY_LEN],
    nonce: &[u8; NONCE_LEN],
    aad: &[u8],
    message: &[u8],
) -> Result<Vec<u8>, Failed> {
    cipher(key)
        .encrypt(&(*nonce).into(), Payload { msg: message, aad })
        .map_err(|_| Failed)
}

pub(super) fn decrypt(
    key: &[u8; KEY_LEN],
    nonce: &[u8; NONCE_LEN],
    aad: &[u8],
    sealed: &[u8],
) -> Result<Vec<u8>, Failed> {
    cipher(key)
        .decrypt(&(*nonce).into(), Payload { msg: sealed, aad })
        .map_err(|_| Failed)
}
