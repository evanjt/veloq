//! Known answers for both platform implementations: Apple targets run these
//! against CommonCrypto and every other target against the `aes-gcm` crate.

use super::*;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

// NIST GCM test case 16 is AES-256 with 12-byte nonce and aad; this one is the
// all-zero key, nonce and empty message case (test case 13).
#[test]
fn all_zero_key_and_empty_message_gives_the_published_tag() {
    let sealed = encrypt(&[0; KEY_LEN], &[0; NONCE_LEN], &[], &[]).unwrap();
    assert_eq!(hex(&sealed), "530f8afbc74536b9a963b4f1c4cb738b");
}

#[test]
fn all_zero_key_and_one_zero_block_gives_the_published_answer() {
    let sealed = encrypt(&[0; KEY_LEN], &[0; NONCE_LEN], &[], &[0; 16]).unwrap();
    assert_eq!(
        hex(&sealed),
        "cea7403d4d606b6e074ec5d3baf39d18d0d1c8a799996bf0265b98b5d48ab919"
    );
}

#[test]
fn round_trips_with_associated_data() {
    let key = [7u8; KEY_LEN];
    let nonce = [9u8; NONCE_LEN];
    let sealed = encrypt(&key, &nonce, b"header", b"payload").unwrap();
    assert_eq!(sealed.len(), 7 + TAG_LEN);
    assert_eq!(
        decrypt(&key, &nonce, b"header", &sealed).unwrap(),
        b"payload"
    );
}

#[test]
fn a_changed_byte_in_any_input_is_refused() {
    let key = [7u8; KEY_LEN];
    let nonce = [9u8; NONCE_LEN];
    let sealed = encrypt(&key, &nonce, b"header", b"payload").unwrap();
    assert_eq!(decrypt(&key, &nonce, b"headeR", &sealed), Err(Failed));
    assert_eq!(
        decrypt(&[8u8; KEY_LEN], &nonce, b"header", &sealed),
        Err(Failed)
    );
    assert_eq!(
        decrypt(&key, &[1u8; NONCE_LEN], b"header", &sealed),
        Err(Failed)
    );
    for at in [0, 6, 7, sealed.len() - 1] {
        let mut bad = sealed.clone();
        bad[at] ^= 1;
        assert_eq!(decrypt(&key, &nonce, b"header", &bad), Err(Failed));
    }
}

#[test]
fn input_shorter_than_a_tag_is_refused() {
    assert_eq!(
        decrypt(&[0; KEY_LEN], &[0; NONCE_LEN], &[], &[0; TAG_LEN - 1]),
        Err(Failed)
    );
}
