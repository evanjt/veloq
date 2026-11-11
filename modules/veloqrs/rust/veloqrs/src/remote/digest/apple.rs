//! SHA-256 and HMAC-SHA256 from CommonCrypto, which libSystem carries on every
//! Apple target, so no framework or crate is linked for them.
//!
//! The context structs are opaque to Rust and sized from the SDK headers:
//! `CC_SHA256_CTX` is `CC_LONG count[2], hash[8], wbuf[16]` in `CommonDigest.h`,
//! 26 words, and `CCHmacContext` is `uint32_t ctx[CC_HMAC_CONTEXT_SIZE]` in
//! `CommonHMAC.h`, 96 words. Both are word-aligned, so a `u32` array of that
//! length holds each one.

use std::ffi::{c_int, c_void};

const SHA256_CTX_WORDS: usize = 26;
const HMAC_CONTEXT_WORDS: usize = 96;

/// `kCCHmacAlgSHA256` in `CommonHMAC.h`.
const HMAC_ALG_SHA256: u32 = 2;

/// `CC_LONG` is a 32-bit length, so a longer part is fed in pieces.
const LONGEST_UPDATE: usize = u32::MAX as usize;

#[repr(C)]
struct Sha256Context([u32; SHA256_CTX_WORDS]);

#[repr(C)]
struct HmacContext([u32; HMAC_CONTEXT_WORDS]);

unsafe extern "C" {
    fn CC_SHA256_Init(context: *mut Sha256Context) -> c_int;
    fn CC_SHA256_Update(context: *mut Sha256Context, data: *const c_void, len: u32) -> c_int;
    fn CC_SHA256_Final(digest: *mut u8, context: *mut Sha256Context) -> c_int;
    fn CCHmacInit(context: *mut HmacContext, algorithm: u32, key: *const c_void, key_len: usize);
    fn CCHmacUpdate(context: *mut HmacContext, data: *const c_void, len: usize);
    fn CCHmacFinal(context: *mut HmacContext, mac: *mut u8);
}

pub(super) fn sha256(parts: &[&[u8]]) -> [u8; 32] {
    let mut context = Sha256Context([0; SHA256_CTX_WORDS]);
    let mut digest = [0u8; 32];
    // SAFETY: `context` is a zeroed `CC_SHA256_CTX`-sized buffer that Init
    // sets up before any use. Each Update reads only the slice it is given,
    // at most `LONGEST_UPDATE` bytes at a time. Final writes the 32-byte
    // digest into `digest`.
    unsafe {
        CC_SHA256_Init(&mut context);
        for part in parts {
            for piece in part.chunks(LONGEST_UPDATE) {
                CC_SHA256_Update(&mut context, piece.as_ptr().cast(), piece.len() as u32);
            }
        }
        CC_SHA256_Final(digest.as_mut_ptr(), &mut context);
    }
    digest
}

pub(super) fn hmac_sha256(key: &[u8], parts: &[&[u8]]) -> [u8; 32] {
    let mut context = HmacContext([0; HMAC_CONTEXT_WORDS]);
    let mut mac = [0u8; 32];
    // SAFETY: `context` is a zeroed `CCHmacContext`-sized buffer that Init sets
    // up before any use. Init and Update read only the slices they are given,
    // and an empty key is one Init accepts. Final writes the 32-byte MAC into
    // `mac`.
    unsafe {
        CCHmacInit(
            &mut context,
            HMAC_ALG_SHA256,
            key.as_ptr().cast(),
            key.len(),
        );
        for part in parts {
            CCHmacUpdate(&mut context, part.as_ptr().cast(), part.len());
        }
        CCHmacFinal(&mut context, mac.as_mut_ptr());
    }
    mac
}
