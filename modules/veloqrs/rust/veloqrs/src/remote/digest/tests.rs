//! Known answers for both platform implementations. Apple targets run these
//! against CommonCrypto and every other target against the `sha2` and `hmac`
//! crates, so the two cannot drift apart unnoticed.

use super::*;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[test]
fn sha256_of_abc_is_the_fips_180_4_vector() {
    assert_eq!(
        hex(&sha256(&[b"abc"])),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}

#[test]
fn sha256_of_the_empty_message_is_the_fips_180_4_vector() {
    assert_eq!(
        hex(&sha256(&[])),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
}

#[test]
fn sha256_of_a_two_block_message_is_the_fips_180_4_vector() {
    assert_eq!(
        hex(&sha256(&[
            b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"
        ])),
        "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
    );
}

#[test]
fn sha256_of_parts_is_the_digest_of_their_concatenation() {
    assert_eq!(sha256(&[b"ab", b"c"]), sha256(&[b"abc"]));
    assert_eq!(sha256(&[b"", b"abc", b""]), sha256(&[b"abc"]));
}

#[test]
fn hmac_sha256_passes_rfc_4231_case_1() {
    let key = [0x0bu8; 20];
    assert_eq!(
        hex(&hmac_sha256(&key, &[b"Hi There"])),
        "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
    );
}

#[test]
fn hmac_sha256_passes_rfc_4231_case_2() {
    assert_eq!(
        hex(&hmac_sha256(b"Jefe", &[b"what do ya want for nothing?"])),
        "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
    );
}

#[test]
fn hmac_sha256_passes_rfc_4231_case_6_with_a_key_longer_than_a_block() {
    let key = [0xaau8; 131];
    assert_eq!(
        hex(&hmac_sha256(
            &key,
            &[b"Test Using Larger Than Block-Size Key - Hash Key First"]
        )),
        "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54"
    );
}

#[test]
fn hmac_sha256_over_parts_is_the_mac_of_their_concatenation() {
    let key = [0x0bu8; 20];
    assert_eq!(
        hmac_sha256(&key, &[b"Hi ", b"", b"There"]),
        hmac_sha256(&key, &[b"Hi There"])
    );
}
