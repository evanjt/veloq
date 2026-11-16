//! Scenario: an athlete holds a sealed backup written by an earlier release, on
//! a server or a drive, and expects every later release to open it.
//!
//! Expected behaviour: each version's fixture opens with its secret and its
//! recovery key, the writer still produces the fixture's bytes, and a changed
//! byte, a wrong secret or a header from another archive is refused without a
//! panic and without a byte of plaintext.

use std::path::{Path, PathBuf};

use super::*;
use crate::persistence::record_backup::read_record_zip;

/// Randomness that reads a fixed byte string in order, so a seal is repeatable.
pub(super) struct Stream {
    bytes: Vec<u8>,
    at: usize,
}

impl Stream {
    pub(super) fn new(bytes: Vec<u8>) -> Self {
        Self { bytes, at: 0 }
    }
}

impl Randomness for Stream {
    fn fill(&mut self, out: &mut [u8]) -> Result<(), SealError> {
        let end = self.at + out.len();
        assert!(end <= self.bytes.len(), "the fixed randomness ran out");
        out.copy_from_slice(&self.bytes[self.at..end]);
        self.at = end;
        Ok(())
    }
}

/// An endless run of distinct bytes, for tests that need no particular ones.
pub(super) struct Counter(pub(super) u8);

impl Randomness for Counter {
    fn fill(&mut self, out: &mut [u8]) -> Result<(), SealError> {
        for byte in out {
            self.0 = self.0.wrapping_add(1);
            *byte = self.0;
        }
        Ok(())
    }
}

pub(super) fn unhex(text: &str) -> Vec<u8> {
    let text = text.trim_end_matches('\n');
    (0..text.len())
        .step_by(2)
        .map(|at| u8::from_str_radix(&text[at..at + 2], 16).unwrap())
        .collect()
}

pub(super) fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sealed")
}

pub(super) fn read(dir: &Path, name: &str) -> Vec<u8> {
    std::fs::read(dir.join(name)).unwrap_or_else(|e| panic!("{}: {e}", dir.join(name).display()))
}

pub(super) fn text(dir: &Path, name: &str) -> String {
    String::from_utf8(read(dir, name))
        .unwrap()
        .trim_end_matches('\n')
        .to_string()
}

/// A derivation at the format's floor, so a test that seals or opens many
/// archives does not pay the production cost for each.
fn cheap_kdf() -> KdfParams {
    KdfParams {
        alg: KdfAlg::Argon2id,
        version: 19,
        m_kib: 8,
        t: 1,
        p: 1,
        salt: [7; SALT_LEN],
    }
}

pub(super) fn cheap_sealing(secret: &[u8]) -> Sealing {
    let mut rng = Counter(0);
    let dek = Dek::generate(&mut rng).unwrap();
    let key_id = random::<KEY_ID_LEN>(&mut rng).unwrap();
    let kdf = cheap_kdf();
    let wrap = wrap_dek(&dek, &key_id, WrapBy::Secret, secret, &kdf, &mut rng).unwrap();
    Sealing {
        dek,
        key_id,
        kdf,
        wraps: vec![wrap],
    }
}

fn cheap_archive(plaintext: &[u8]) -> Vec<u8> {
    seal(
        plaintext,
        Kind::Record,
        &cheap_sealing(b"1234"),
        &mut Counter(100),
    )
    .unwrap()
}

/// The archive with its header edited as JSON and the length field corrected.
pub(super) fn with_header(archive: &[u8], edit: impl FnOnce(&mut serde_json::Value)) -> Vec<u8> {
    let length = u32::from_le_bytes(archive[10..14].try_into().unwrap()) as usize;
    let body_start = PREFIX_LEN + length;
    let mut header: serde_json::Value =
        serde_json::from_slice(&archive[PREFIX_LEN..body_start]).unwrap();
    edit(&mut header);
    let json = serde_json::to_vec(&header).unwrap();
    let mut out = archive[..10].to_vec();
    out.extend_from_slice(&u32::try_from(json.len()).unwrap().to_le_bytes());
    out.extend_from_slice(&json);
    out.extend_from_slice(&archive[body_start..]);
    out
}

fn body_start(archive: &[u8]) -> usize {
    PREFIX_LEN + u32::from_le_bytes(archive[10..14].try_into().unwrap()) as usize
}

/// Every version directory under `tests/fixtures/sealed` holds a fixed secret,
/// a recovery key, the randomness a writer drew, the plaintext and the archive.
/// A release that adds a version adds its directory and never edits an older
/// one. Only the current writer is run again: the reader of every version stays
/// in the tree, so every directory is opened.
#[test]
fn sealed_vectors_from_every_version_open() {
    let mut versions = Vec::new();
    for entry in std::fs::read_dir(fixtures()).unwrap() {
        let dir = entry.unwrap().path();
        let Some(name) = dir.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        let Some(version) = name.strip_prefix('v').and_then(|v| v.parse::<u16>().ok()) else {
            continue;
        };
        versions.push(version);

        let archive = read(&dir, "archive.sealed");
        let plaintext = read(&dir, "plaintext.bin");
        let secret = text(&dir, "secret.txt");
        let recovery = text(&dir, "recovery.txt");
        assert_eq!(
            u16::from_le_bytes([archive[8], archive[9]]),
            version,
            "v{version} holds an archive of another version"
        );

        for (role, by) in [("secret", secret.as_str()), ("recovery", recovery.as_str())] {
            let opened = open(&archive, by.as_bytes())
                .unwrap_or_else(|e| panic!("v{version} does not open with its {role}: {e}"));
            assert_eq!(opened.plaintext, plaintext, "v{version} {role}");
            assert_eq!(opened.kind, Kind::Record, "v{version} {role}");
            assert_eq!(
                opened.sealing.dek.as_bytes(),
                &unhex(&text(&dir, "dek.hex"))[..]
            );
        }

        // The restore path reads the record zip the seal carried, unchanged.
        let scratch = tempfile::tempdir().unwrap();
        let path = scratch.path().join("record.zip");
        std::fs::write(&path, &open(&archive, secret.as_bytes()).unwrap().plaintext).unwrap();
        let record = read_record_zip(path.to_str().unwrap()).unwrap();
        assert_eq!(record.entries.len(), 1, "v{version}");

        if version == FORMAT_VERSION {
            let dek = unhex(&text(&dir, "dek.hex"));
            let key_id = unhex(&text(&dir, "key_id.hex"));
            let salt = unhex(&text(&dir, "salt.hex"));
            let nonces = unhex(&text(&dir, "nonces.hex"));
            let mut sealing = Sealing::new(
                secret.as_bytes(),
                &mut Stream::new([dek, key_id, salt, nonces[..12].to_vec()].concat()),
            )
            .unwrap();
            sealing.wraps.push(
                wrap_dek(
                    &sealing.dek,
                    &sealing.key_id,
                    WrapBy::Recovery,
                    recovery.as_bytes(),
                    &sealing.kdf,
                    &mut Stream::new(nonces[12..24].to_vec()),
                )
                .unwrap(),
            );
            let sealed = seal(
                &plaintext,
                Kind::Record,
                &sealing,
                &mut Stream::new(nonces[24..36].to_vec()),
            )
            .unwrap();
            assert!(
                sealed == archive,
                "the writer no longer produces the v{version} fixture's bytes"
            );
        }
    }
    versions.sort_unstable();
    assert!(
        versions.contains(&FORMAT_VERSION),
        "the fixture for the current format version is missing: {versions:?}"
    );
}

#[test]
fn a_wrong_secret_is_refused_at_the_wrap_and_returns_no_plaintext() {
    let dir = fixtures().join("v1");
    let archive = read(&dir, "archive.sealed");
    assert_eq!(
        open(&archive, b"wrong").unwrap_err(),
        SealError::WrongSecret
    );
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_wrong_secret_fails_before_the_payload_is_read() {
    let mut archive = cheap_archive(b"payload");
    let last = archive.len() - 1;
    archive[last] ^= 1;
    assert_eq!(
        open(&archive, b"wrong").unwrap_err(),
        SealError::WrongSecret,
        "a damaged payload is not reached under a wrong secret"
    );
    assert_eq!(open(&archive, b"1234").unwrap_err(), SealError::Damaged);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_flipped_byte_anywhere_fails_and_never_opens() {
    let archive = cheap_archive(b"a small record zip");
    let start = body_start(&archive);
    for at in 0..archive.len() {
        let mut changed = archive.clone();
        changed[at] ^= 0x01;
        let err = open(&changed, b"1234").expect_err(&format!("byte {at} changed and opened"));
        if at >= start {
            assert_eq!(err, SealError::Damaged, "ciphertext byte {at}");
        }
    }
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_flipped_header_byte_fails_payload_authentication_under_the_data_key() {
    let sealing = cheap_sealing(b"1234");
    let archive = seal(b"payload", Kind::Record, &sealing, &mut Counter(100)).unwrap();
    for at in 0..body_start(&archive) {
        let mut changed = archive.clone();
        changed[at] ^= 0x01;
        assert!(
            open_with_dek(&changed, sealing.dek.clone()).is_err(),
            "header byte {at}"
        );
    }
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_header_moved_between_archives_fails_authentication() {
    let sealing = cheap_sealing(b"1234");
    let first = seal(b"first payload", Kind::Record, &sealing, &mut Counter(100)).unwrap();
    let second = seal(b"second payload", Kind::Record, &sealing, &mut Counter(200)).unwrap();
    let mut spliced = first[..body_start(&first)].to_vec();
    spliced.extend_from_slice(&second[body_start(&second)..]);
    assert_eq!(
        open_with_dek(&spliced, sealing.dek.clone()).unwrap_err(),
        SealError::Damaged
    );
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_header_with_an_unknown_or_a_missing_field_is_refused() {
    let archive = cheap_archive(b"payload");

    let extra = with_header(&archive, |h| {
        h["compression"] = "none".into();
    });
    assert!(matches!(
        open(&extra, b"1234"),
        Err(SealError::BadHeader(_))
    ));
    let nested = with_header(&archive, |h| {
        h["kdf"]["parallel"] = true.into();
    });
    assert!(matches!(
        open(&nested, b"1234"),
        Err(SealError::BadHeader(_))
    ));

    for field in ["kind", "kdf", "cipher", "key_id", "wraps", "payload"] {
        let removed = with_header(&archive, |h| {
            h.as_object_mut().unwrap().remove(field);
        });
        assert!(
            matches!(open(&removed, b"1234"), Err(SealError::BadHeader(_))),
            "{field}"
        );
    }
    for (parent, field) in [
        ("kdf", "alg"),
        ("kdf", "version"),
        ("kdf", "m_kib"),
        ("kdf", "t"),
        ("kdf", "p"),
        ("kdf", "salt"),
        ("payload", "nonce"),
        ("payload", "encoding"),
    ] {
        let removed = with_header(&archive, |h| {
            h[parent].as_object_mut().unwrap().remove(field);
        });
        assert!(
            matches!(open(&removed, b"1234"), Err(SealError::BadHeader(_))),
            "{parent}.{field}"
        );
    }
    for field in ["by", "nonce", "wrapped"] {
        let removed = with_header(&archive, |h| {
            h["wraps"][0].as_object_mut().unwrap().remove(field);
        });
        assert!(
            matches!(open(&removed, b"1234"), Err(SealError::BadHeader(_))),
            "wraps[0].{field}"
        );
    }
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn header_values_the_format_does_not_define_are_refused() {
    let archive = cheap_archive(b"payload");
    let cases = [
        ("kind", "/kind", serde_json::json!("ride")),
        ("cipher", "/cipher", serde_json::json!("chacha20")),
        ("alg", "/kdf/alg", serde_json::json!("pbkdf2")),
        ("encoding", "/payload/encoding", serde_json::json!("tar")),
        ("by", "/wraps/0/by", serde_json::json!("admin")),
        ("salt length", "/kdf/salt", serde_json::json!("AAAA")),
        (
            "salt encoding",
            "/kdf/salt",
            serde_json::json!("not base64!!!!!!!!!!!!!!"),
        ),
        ("key id as number", "/key_id", serde_json::json!(7)),
        ("no wraps", "/wraps", serde_json::json!([])),
    ];
    for (name, pointer, value) in cases {
        let changed = with_header(&archive, |h| *h.pointer_mut(pointer).unwrap() = value);
        assert!(
            matches!(open(&changed, b"1234"), Err(SealError::BadHeader(_))),
            "{name}"
        );
    }
    let twice = with_header(&archive, |h| {
        let wrap = h["wraps"][0].clone();
        h["wraps"].as_array_mut().unwrap().push(wrap);
    });
    assert!(
        matches!(open(&twice, b"1234"), Err(SealError::BadHeader(_))),
        "a role wrapped twice"
    );
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_forged_header_cannot_ask_for_a_derivation_the_phone_cannot_afford() {
    let archive = cheap_archive(b"payload");
    for (name, field, value) in [
        ("memory", "m_kib", 4_194_304),
        ("passes", "t", 1_000_000),
        ("lanes", "p", 255),
        ("no passes", "t", 0),
        ("memory below lanes", "m_kib", 1),
        ("argon2 version", "version", 16),
    ] {
        let changed = with_header(&archive, |h| h["kdf"][field] = value.into());
        assert!(
            matches!(
                open(&changed, b"1234"),
                Err(SealError::UnsupportedParameters(_))
            ),
            "{name}"
        );
    }
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_newer_or_unknown_version_is_refused_with_its_wording() {
    let archive = cheap_archive(b"payload");
    let mut newer = archive.clone();
    newer[8] = 2;
    let err = open(&newer, b"1234").unwrap_err();
    assert_eq!(err, SealError::NewerVersion(2));
    assert_eq!(
        err.to_string(),
        "Sealed backup version 2 is newer than supported version 1"
    );
    assert_eq!(
        header(&newer).unwrap_err(),
        SealError::NewerVersion(2),
        "a listing refuses it too"
    );
    let mut zero = archive;
    zero[8] = 0;
    assert_eq!(
        open(&zero, b"1234").unwrap_err(),
        SealError::UnsupportedVersion(0)
    );
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_file_that_is_not_a_complete_container_is_refused_at_every_length() {
    let archive = cheap_archive(b"payload");
    assert_eq!(open(b"", b"1234").unwrap_err(), SealError::NotSealed);
    assert_eq!(
        open(b"PK\x03\x04 a plain zip", b"1234").unwrap_err(),
        SealError::NotSealed
    );
    for cut in 8..archive.len() {
        assert!(
            open(&archive[..cut], b"1234").is_err(),
            "{cut} of {} bytes opened",
            archive.len()
        );
    }
    let mut long = archive.clone();
    long[10..14].copy_from_slice(&u32::MAX.to_le_bytes());
    assert!(matches!(open(&long, b"1234"), Err(SealError::BadHeader(_))));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn an_empty_plaintext_round_trips() {
    let archive = cheap_archive(b"");
    assert_eq!(archive.len(), body_start(&archive) + TAG_LEN);
    assert_eq!(open(&archive, b"1234").unwrap().plaintext, Vec::<u8>::new());
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn opening_the_same_bytes_twice_gives_the_same_plaintext() {
    let plaintext = (0..=255u8).cycle().take(100_000).collect::<Vec<_>>();
    let archive = cheap_archive(&plaintext);
    let first = open(&archive, b"1234").unwrap();
    let second = open(&archive, b"1234").unwrap();
    assert_eq!(first.plaintext, plaintext);
    assert_eq!(first.plaintext, second.plaintext);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn an_empty_secret_is_refused_to_wrap_and_to_open() {
    let mut rng = Counter(0);
    let sealing = cheap_sealing(b"1234");
    assert_eq!(
        wrap_dek(
            &sealing.dek,
            &sealing.key_id,
            WrapBy::Secret,
            b"",
            &sealing.kdf,
            &mut rng
        )
        .unwrap_err(),
        SealError::EmptySecret
    );
    assert_eq!(
        open(&cheap_archive(b"x"), b"").unwrap_err(),
        SealError::EmptySecret
    );
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_listing_reads_the_header_without_a_secret_and_groups_by_key_id() {
    let sealing = cheap_sealing(b"1234");
    let first = seal(b"one", Kind::Record, &sealing, &mut Counter(10)).unwrap();
    let second = seal(b"two", Kind::Record, &sealing, &mut Counter(20)).unwrap();
    let other = seal(
        b"three",
        Kind::Record,
        &cheap_sealing_other(),
        &mut Counter(30),
    )
    .unwrap();
    assert_eq!(key_id(&first).unwrap(), sealing.key_id);
    assert_eq!(key_id(&first).unwrap(), key_id(&second).unwrap());
    assert_ne!(key_id(&first).unwrap(), key_id(&other).unwrap());
    let parsed = header(&first).unwrap();
    assert_eq!(parsed.kind, Kind::Record);
    assert_eq!(parsed.wraps.len(), 1);
    assert_ne!(
        parsed.payload.nonce,
        header(&second).unwrap().payload.nonce,
        "each archive draws its own payload nonce"
    );
}

fn cheap_sealing_other() -> Sealing {
    let mut sealing = cheap_sealing(b"1234");
    sealing.key_id = [9; KEY_ID_LEN];
    sealing
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn changing_the_secret_rewraps_the_key_and_leaves_the_data_alone() {
    let mut rng = Counter(50);
    let mut sealing = cheap_sealing(b"1234");
    let recovery = wrap_dek(
        &sealing.dek,
        &sealing.key_id,
        WrapBy::Recovery,
        b"recovery-key",
        &sealing.kdf,
        &mut rng,
    )
    .unwrap();
    sealing.wraps.push(recovery);
    let before = seal(b"payload", Kind::Record, &sealing, &mut rng).unwrap();

    let changed = rewrap(&sealing, WrapBy::Secret, b"98765", &mut rng).unwrap();
    assert_eq!(changed.dek.as_bytes(), sealing.dek.as_bytes());
    assert_eq!(changed.key_id, sealing.key_id);
    assert_eq!(changed.wraps.len(), 2);
    let after = seal(b"payload", Kind::Record, &changed, &mut rng).unwrap();

    assert_eq!(open(&after, b"98765").unwrap().plaintext, b"payload");
    assert_eq!(open(&after, b"recovery-key").unwrap().plaintext, b"payload");
    assert_eq!(
        open(&after, b"1234").unwrap_err(),
        SealError::WrongSecret,
        "the old secret does not open an archive sealed after the change"
    );
    assert_eq!(
        open(&before, b"1234").unwrap().plaintext,
        b"payload",
        "an archive sealed before the change keeps its own wraps"
    );
    assert_eq!(open(&before, b"98765").unwrap_err(), SealError::WrongSecret);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn an_opened_archive_carries_the_key_to_seal_the_next_one() {
    let archive = cheap_archive(b"payload");
    let opened = open(&archive, b"1234").unwrap();
    let next = seal(b"newer", Kind::Record, &opened.sealing, &mut Counter(77)).unwrap();
    assert_eq!(key_id(&next).unwrap(), key_id(&archive).unwrap());
    assert_eq!(open(&next, b"1234").unwrap().plaintext, b"newer");
    assert_eq!(
        open_with_dek(&archive, opened.sealing.dek.clone())
            .unwrap()
            .plaintext,
        b"payload"
    );
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_operating_system_randomness_gives_each_archive_its_own_nonces_and_key() {
    let mut rng = OsRandom;
    let first = Sealing::new(b"1234", &mut rng).unwrap();
    let second = Sealing::new(b"1234", &mut rng).unwrap();
    assert_ne!(first.dek.as_bytes(), second.dek.as_bytes());
    assert_ne!(first.key_id, second.key_id);
    assert_ne!(first.kdf.salt, second.kdf.salt);
    assert_ne!(first.wraps[0].nonce, second.wraps[0].nonce);
    let archive = seal(b"payload", Kind::Record, &first, &mut rng).unwrap();
    assert_eq!(open(&archive, b"1234").unwrap().plaintext, b"payload");
}

/// The key an independent Argon2id implementation derives for the same
/// secret, salt and cost, so a change of crate or of its defaults moves it.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_derivation_matches_an_independent_argon2id() {
    let kdf = KdfParams {
        alg: KdfAlg::Argon2id,
        version: 19,
        m_kib: KDF_M_KIB,
        t: KDF_T,
        p: KDF_P,
        salt: [0x02; SALT_LEN],
    };
    let kek = derive_kek(b"password", &kdf).unwrap();
    assert_eq!(
        kek.as_slice(),
        unhex("fe525ab59ed3b936920e320c0c812a4721c7e8213b4bd4b960c9f15b409c9540")
    );
}
