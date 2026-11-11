//! SHA-256 and HMAC-SHA256 from the `sha2` and `hmac` crates, for every target
//! except Apple.

use hmac::{Hmac, KeyInit, Mac};
use sha2::{Digest, Sha256};

pub(super) fn sha256(parts: &[&[u8]]) -> [u8; 32] {
    let mut hash = Sha256::new();
    for part in parts {
        hash.update(part);
    }
    hash.finalize().into()
}

pub(super) fn hmac_sha256(key: &[u8], parts: &[&[u8]]) -> [u8; 32] {
    let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(key).expect("any key length");
    for part in parts {
        mac.update(part);
    }
    mac.finalize().into_bytes().into()
}
