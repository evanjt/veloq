//! AES-256-GCM from CommonCrypto's one-shot GCM calls, which libSystem carries
//! on every Apple target, so no framework or crate is linked for it.
//!
//! The declarations follow `CommonCryptorSPI.h`: both calls take the algorithm,
//! the key, the nonce, the associated data and the input, then the output and
//! the tag, which decryption reads and encryption writes.

use std::ffi::c_void;

use super::super::layout::{KEY_LEN, NONCE_LEN, TAG_LEN};
use super::Failed;

/// `kCCAlgorithmAES` in `CommonCryptor.h`.
const ALGORITHM_AES: u32 = 0;
/// `kCCSuccess`.
const SUCCESS: i32 = 0;

unsafe extern "C" {
    fn CCCryptorGCMOneshotEncrypt(
        algorithm: u32,
        key: *const c_void,
        key_len: usize,
        iv: *const c_void,
        iv_len: usize,
        aad: *const c_void,
        aad_len: usize,
        data_in: *const c_void,
        data_in_len: usize,
        data_out: *mut c_void,
        tag_out: *mut c_void,
        tag_len: usize,
    ) -> i32;
    fn CCCryptorGCMOneshotDecrypt(
        algorithm: u32,
        key: *const c_void,
        key_len: usize,
        iv: *const c_void,
        iv_len: usize,
        aad: *const c_void,
        aad_len: usize,
        data_in: *const c_void,
        data_in_len: usize,
        data_out: *mut c_void,
        tag_in: *const c_void,
        tag_len: usize,
    ) -> i32;
}

pub(super) fn encrypt(
    key: &[u8; KEY_LEN],
    nonce: &[u8; NONCE_LEN],
    aad: &[u8],
    message: &[u8],
) -> Result<Vec<u8>, Failed> {
    let mut out = vec![0u8; message.len() + TAG_LEN];
    let (body, tag) = out.split_at_mut(message.len());
    // SAFETY: every pointer is to a live slice of the length passed beside it.
    // `body` holds `message.len()` bytes and `tag` holds `TAG_LEN`, which is what
    // the call writes. An empty slice's pointer is non-null and never read.
    let status = unsafe {
        CCCryptorGCMOneshotEncrypt(
            ALGORITHM_AES,
            key.as_ptr().cast(),
            key.len(),
            nonce.as_ptr().cast(),
            nonce.len(),
            aad.as_ptr().cast(),
            aad.len(),
            message.as_ptr().cast(),
            message.len(),
            body.as_mut_ptr().cast(),
            tag.as_mut_ptr().cast(),
            TAG_LEN,
        )
    };
    if status == SUCCESS {
        Ok(out)
    } else {
        Err(Failed)
    }
}

pub(super) fn decrypt(
    key: &[u8; KEY_LEN],
    nonce: &[u8; NONCE_LEN],
    aad: &[u8],
    sealed: &[u8],
) -> Result<Vec<u8>, Failed> {
    let (body, tag) = sealed.split_at(sealed.len() - TAG_LEN);
    let mut out = vec![0u8; body.len()];
    // SAFETY: every pointer is to a live slice of the length passed beside it.
    // `out` holds `body.len()` bytes, which is what the call writes, and `tag`
    // is `TAG_LEN` bytes, which is what it reads.
    let status = unsafe {
        CCCryptorGCMOneshotDecrypt(
            ALGORITHM_AES,
            key.as_ptr().cast(),
            key.len(),
            nonce.as_ptr().cast(),
            nonce.len(),
            aad.as_ptr().cast(),
            aad.len(),
            body.as_ptr().cast(),
            body.len(),
            out.as_mut_ptr().cast(),
            tag.as_ptr().cast(),
            TAG_LEN,
        )
    };
    if status == SUCCESS {
        Ok(out)
    } else {
        // A failed call may have written unauthenticated bytes.
        out.fill(0);
        Err(Failed)
    }
}
