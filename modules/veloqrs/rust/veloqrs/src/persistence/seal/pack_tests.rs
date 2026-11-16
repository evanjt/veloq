//! Scenario: an athlete's rides are sealed into one object per calendar month,
//! with a sealed manifest naming them, and a later release must read every
//! pack an earlier one wrote.
//!
//! Expected behaviour: each version's fixture pack and manifest open under the
//! fixed data key to the fixed rides and listing, the writer still produces the
//! fixture's bytes, and a wrong key, a changed byte, a pack of another kind or a
//! pack that contradicts the manifest naming it is refused with no rides.

use std::io::{Cursor, Write};
use std::path::Path;

use super::super::tests::{
    Counter, Stream, cheap_sealing, fixtures, read, text, unhex, with_header,
};
use super::*;
use crate::persistence::seal::{
    Encoding, KDF_M_KIB, KDF_P, KDF_T, KdfAlg, KdfParams, open_with_dek, seal,
};

fn month(text: &str) -> Month {
    text.parse().unwrap()
}

/// The key a fixture writer holds: the data key, its id and the derivation the
/// key file's wraps share. A pack carries none of the wraps.
fn fixed_sealing(dir: &Path) -> Sealing {
    Sealing {
        dek: Dek::from_bytes(unhex(&text(dir, "dek.hex")).try_into().unwrap()),
        key_id: unhex(&text(dir, "key_id.hex")).try_into().unwrap(),
        kdf: KdfParams {
            alg: KdfAlg::Argon2id,
            version: 19,
            m_kib: KDF_M_KIB,
            t: KDF_T,
            p: KDF_P,
            salt: unhex(&text(dir, "salt.hex")).try_into().unwrap(),
        },
        wraps: Vec::new(),
    }
}

#[derive(Deserialize)]
struct FixtureRide {
    key: String,
    source: String,
    start: String,
    kinds: Vec<EntryKind>,
}

fn fixture_rides(dir: &Path) -> Vec<PackRide> {
    let listed: Vec<FixtureRide> = serde_json::from_slice(&read(dir, "rides.json")).unwrap();
    listed
        .into_iter()
        .map(|ride| PackRide {
            entries: ride
                .kinds
                .iter()
                .map(|kind| RideEntry {
                    kind: *kind,
                    bytes: unhex(&text(
                        &dir.join("entries").join(&ride.key),
                        &format!("{}.hex", kind.file_name()),
                    )),
                })
                .collect(),
            key: ride.key,
            source: ride.source,
            start: ride.start,
        })
        .collect()
}

/// Every version directory under `tests/fixtures/sealed` named `pack-v<N>`
/// holds the fixed key, the randomness a writer drew, two rides, the pack and
/// the manifest they produce. A release that adds a version adds its directory
/// and never edits an older one. Only the current writer is run again: the
/// reader of every version stays in the tree.
#[test]
fn sealed_pack_vectors_from_every_version_open() {
    let mut versions = Vec::new();
    for entry in std::fs::read_dir(fixtures()).unwrap() {
        let dir = entry.unwrap().path();
        let Some(version) = dir
            .file_name()
            .and_then(|n| n.to_str())
            .and_then(|n| n.strip_prefix("pack-v"))
            .and_then(|v| v.parse::<u16>().ok())
        else {
            continue;
        };
        versions.push(version);

        let sealing = fixed_sealing(&dir);
        let rides = fixture_rides(&dir);
        let when = month(&text(&dir, "month.txt"));
        let pack_bytes = read(&dir, "pack.sealed");
        let manifest_bytes = read(&dir, "manifest.sealed");
        let listing: Vec<ManifestPack> =
            serde_json::from_slice(&read(&dir, "manifest.json")).unwrap();

        let header = crate::persistence::seal::header(&pack_bytes).unwrap();
        assert_eq!(header.kind, Kind::Pack, "v{version}");
        assert_eq!(header.payload.encoding, Encoding::PackZip, "v{version}");
        assert!(header.wraps.is_empty(), "v{version} pack carries a wrap");
        let header = crate::persistence::seal::header(&manifest_bytes).unwrap();
        assert_eq!(header.kind, Kind::Manifest, "v{version}");
        assert_eq!(
            header.payload.encoding,
            Encoding::ManifestJson,
            "v{version}"
        );

        let pack = read_pack(&pack_bytes, &sealing.dek)
            .unwrap_or_else(|e| panic!("v{version} pack does not open: {e}"));
        assert_eq!(pack.month, when, "v{version}");
        assert_eq!(pack.key_id, sealing.key_id, "v{version}");
        assert_eq!(pack.rides, rides, "v{version}");

        let manifest = read_manifest(&manifest_bytes, &sealing.dek)
            .unwrap_or_else(|e| panic!("v{version} manifest does not open: {e}"));
        assert_eq!(manifest.packs, listing, "v{version}");
        manifest.packs[0]
            .verify_pack(&pack, pack_bytes.len() as u64)
            .unwrap_or_else(|e| panic!("v{version} manifest does not name its pack: {e}"));
        assert_eq!(
            manifest.packs[0].name,
            pack_name(&sealing.key_id, when),
            "v{version}"
        );

        if version == PACK_FORMAT_VERSION {
            let nonces = unhex(&text(&dir, "nonces.hex"));
            let written = write_pack(
                when,
                &rides,
                &sealing,
                &mut Stream::new(nonces[..12].to_vec()),
            )
            .unwrap();
            assert!(
                written == pack_bytes,
                "the writer no longer produces the v{version} pack's bytes"
            );
            let written = write_manifest(
                &listing,
                &sealing,
                &mut Stream::new(nonces[12..24].to_vec()),
            )
            .unwrap();
            assert!(
                written == manifest_bytes,
                "the writer no longer produces the v{version} manifest's bytes"
            );
        }
    }
    assert!(
        versions.contains(&PACK_FORMAT_VERSION),
        "the fixture for the current pack version is missing: {versions:?}"
    );
}

fn ride(key: &str, entries: &[(EntryKind, &[u8])]) -> PackRide {
    PackRide {
        key: key.to_string(),
        source: "device".to_string(),
        start: "2026-03-04T06:30:00Z".to_string(),
        entries: entries
            .iter()
            .map(|(kind, bytes)| RideEntry {
                kind: *kind,
                bytes: bytes.to_vec(),
            })
            .collect(),
    }
}

fn two_rides() -> Vec<PackRide> {
    vec![
        ride(
            "ride-one",
            &[
                (EntryKind::OriginalFit, b"first original"),
                (EntryKind::StreamsBin, b"first streams"),
            ],
        ),
        ride("ride-two", &[(EntryKind::OriginalFit, b"second original")]),
    ]
}

fn keyfile() -> Sealing {
    cheap_sealing(b"1234")
}

fn sealed_pack(rides: &[PackRide], sealing: &Sealing) -> Vec<u8> {
    write_pack(month("2026-03"), rides, sealing, &mut Counter(100)).unwrap()
}

/// A pack payload built by hand, so a test can write what the writer refuses.
fn hand_zip(index: &serde_json::Value, entries: &[(&str, &[u8])]) -> Vec<u8> {
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default();
    zip.start_file("pack.json", options).unwrap();
    zip.write_all(&serde_json::to_vec(index).unwrap()).unwrap();
    for (name, bytes) in entries {
        zip.start_file(*name, options).unwrap();
        zip.write_all(bytes).unwrap();
    }
    zip.finish().unwrap().into_inner()
}

fn index(rides: serde_json::Value) -> serde_json::Value {
    serde_json::json!({ "format": 1, "month": "2026-03", "rides": rides })
}

fn listed(key: &str, kinds: &[&str]) -> serde_json::Value {
    serde_json::json!({
        "key": key, "source": "device", "start": "2026-03-04T06:30:00Z", "kinds": kinds
    })
}

fn seal_as_pack(plaintext: &[u8], sealing: &Sealing) -> Vec<u8> {
    let mut keyless = sealing.clone();
    keyless.wraps.clear();
    seal(plaintext, Kind::Pack, &keyless, &mut Counter(50)).unwrap()
}

fn invalid(result: Result<Pack, PackError>) -> bool {
    matches!(result, Err(PackError::Invalid(_)))
}

#[test]
fn a_pack_round_trips_with_the_rides_in_the_order_written() {
    let sealing = keyfile();
    let rides = two_rides();
    let pack = read_pack(&sealed_pack(&rides, &sealing), &sealing.dek).unwrap();
    assert_eq!(pack.rides, rides);
    assert_eq!(pack.month, month("2026-03"));
    assert_eq!(pack.key_id, sealing.key_id);
}

#[test]
fn a_pack_is_sealed_with_no_wrap_even_when_the_key_file_has_them() {
    let sealing = keyfile();
    assert!(!sealing.wraps.is_empty());
    let bytes = sealed_pack(&two_rides(), &sealing);
    assert!(
        crate::persistence::seal::header(&bytes)
            .unwrap()
            .wraps
            .is_empty()
    );
}

#[test]
fn the_writer_refuses_a_pack_of_no_rides() {
    assert!(matches!(
        write_pack(month("2026-03"), &[], &keyfile(), &mut Counter(1)),
        Err(PackError::Invalid(_))
    ));
}

#[test]
fn the_writer_refuses_rides_the_reader_could_not_place() {
    let sealing = keyfile();
    let bytes: &[u8] = b"x";
    let cases = [
        (
            "empty key",
            vec![ride("", &[(EntryKind::OriginalFit, bytes)])],
        ),
        (
            "slash in key",
            vec![ride("a/b", &[(EntryKind::OriginalFit, bytes)])],
        ),
        (
            "backslash in key",
            vec![ride("a\\b", &[(EntryKind::OriginalFit, bytes)])],
        ),
        (
            "dot key",
            vec![ride(".", &[(EntryKind::OriginalFit, bytes)])],
        ),
        (
            "dot dot key",
            vec![ride("..", &[(EntryKind::OriginalFit, bytes)])],
        ),
        (
            "control in key",
            vec![ride("a\nb", &[(EntryKind::OriginalFit, bytes)])],
        ),
        ("ride with no entry", vec![ride("alpha", &[])]),
        (
            "kind twice",
            vec![ride(
                "alpha",
                &[
                    (EntryKind::OriginalFit, bytes),
                    (EntryKind::OriginalFit, bytes),
                ],
            )],
        ),
        (
            "key twice",
            vec![
                ride("alpha", &[(EntryKind::OriginalFit, bytes)]),
                ride("alpha", &[(EntryKind::StreamsBin, bytes)]),
            ],
        ),
    ];
    for (name, rides) in cases {
        assert!(
            matches!(
                write_pack(month("2026-03"), &rides, &sealing, &mut Counter(1)),
                Err(PackError::Invalid(_))
            ),
            "{name}"
        );
    }
}

#[test]
fn already_compressed_entries_are_stored_and_the_rest_deflated() {
    let sealing = keyfile();
    let bytes = sealed_pack(&two_rides(), &sealing);
    let plaintext = open_with_dek(&bytes, sealing.dek.clone())
        .unwrap()
        .plaintext;
    let mut zip = zip::ZipArchive::new(Cursor::new(plaintext)).unwrap();
    for (name, method) in [
        ("pack.json", zip::CompressionMethod::Deflated),
        ("ride-one/original.fit", zip::CompressionMethod::Deflated),
        ("ride-one/streams.bin", zip::CompressionMethod::Stored),
        ("ride-two/original.fit", zip::CompressionMethod::Deflated),
    ] {
        assert_eq!(zip.by_name(name).unwrap().compression(), method, "{name}");
    }
}

#[test]
fn a_wrong_data_key_opens_no_rides() {
    let sealing = keyfile();
    let bytes = sealed_pack(&two_rides(), &sealing);
    let wrong = Dek::from_bytes([9; 32]);
    assert_eq!(
        read_pack(&bytes, &wrong).unwrap_err(),
        PackError::Seal(SealError::Damaged)
    );
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_flipped_byte_anywhere_fails_authentication_and_yields_no_partial_pack() {
    let sealing = keyfile();
    let bytes = sealed_pack(
        &[ride("ride-one", &[(EntryKind::OriginalFit, b"abc")])],
        &sealing,
    );
    for at in 0..bytes.len() {
        let mut changed = bytes.clone();
        changed[at] ^= 0x01;
        assert!(
            read_pack(&changed, &sealing.dek).is_err(),
            "byte {at} changed and the pack opened"
        );
    }
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_pack_read_as_the_wrong_kind_is_refused_by_kind_before_the_payload_is_read() {
    let sealing = keyfile();
    let mut record = seal(b"a record zip", Kind::Record, &sealing, &mut Counter(7)).unwrap();
    let last = record.len() - 1;
    record[last] ^= 1;
    assert_eq!(
        read_pack(&record, &sealing.dek).unwrap_err(),
        PackError::WrongKind(Kind::Record),
        "a damaged record is not authenticated, so it never reaches the payload"
    );
    assert_eq!(
        read_manifest(&record, &sealing.dek).unwrap_err(),
        PackError::WrongKind(Kind::Record)
    );

    let pack = sealed_pack(&two_rides(), &sealing);
    assert_eq!(
        read_manifest(&pack, &sealing.dek).unwrap_err(),
        PackError::WrongKind(Kind::Pack)
    );
    let manifest = write_manifest(&[], &sealing, &mut Counter(8)).unwrap();
    assert_eq!(
        read_pack(&manifest, &sealing.dek).unwrap_err(),
        PackError::WrongKind(Kind::Manifest)
    );
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_header_pairing_a_kind_with_another_encoding_or_carrying_wraps_is_refused() {
    let sealing = keyfile();
    let pack = sealed_pack(&two_rides(), &sealing);
    let swapped = with_header(&pack, |h| h["payload"]["encoding"] = "record-zip".into());
    assert!(matches!(
        crate::persistence::seal::header(&swapped),
        Err(SealError::BadHeader(_))
    ));
    let wrapped = with_header(&pack, |h| {
        h["wraps"] = serde_json::json!([{
            "by": "secret",
            "nonce": "AAAAAAAAAAAAAAAA",
            "wrapped": "A".repeat(64),
        }]);
    });
    assert!(matches!(
        crate::persistence::seal::header(&wrapped),
        Err(SealError::BadHeader(_))
    ));
    let record = seal(b"x", Kind::Record, &sealing, &mut Counter(1)).unwrap();
    let as_pack = with_header(&record, |h| h["payload"]["encoding"] = "pack-zip".into());
    assert!(matches!(
        crate::persistence::seal::header(&as_pack),
        Err(SealError::BadHeader(_))
    ));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_reader_refuses_a_pack_whose_index_and_entries_disagree() {
    let sealing = keyfile();
    let open = |plain: Vec<u8>| read_pack(&seal_as_pack(&plain, &sealing), &sealing.dek);

    let good = hand_zip(
        &index(serde_json::json!([listed("ride-one", &["original.fit"])])),
        &[("ride-one/original.fit", b"abc")],
    );
    assert!(open(good).is_ok());

    let missing = hand_zip(
        &index(serde_json::json!([listed(
            "ride-one",
            &["original.fit", "streams.bin"]
        )])),
        &[("ride-one/original.fit", b"abc")],
    );
    assert!(invalid(open(missing)), "a listed entry with no file");

    let unlisted = hand_zip(
        &index(serde_json::json!([listed("ride-one", &["original.fit"])])),
        &[
            ("ride-one/original.fit", b"abc"),
            ("ride-one/streams.bin", b"x"),
        ],
    );
    assert!(invalid(open(unlisted)), "a file the index does not list");

    let stray = hand_zip(
        &index(serde_json::json!([listed("ride-one", &["original.fit"])])),
        &[
            ("ride-one/original.fit", b"abc"),
            ("other/original.fit", b"x"),
        ],
    );
    assert!(invalid(open(stray)), "a file for a ride the index lacks");

    let twice = hand_zip(
        &index(serde_json::json!([
            listed("ride-one", &["original.fit"]),
            listed("ride-one", &["streams.bin"]),
        ])),
        &[
            ("ride-one/original.fit", b"abc"),
            ("ride-one/streams.bin", b"x"),
        ],
    );
    assert!(invalid(open(twice)), "a ride key listed twice");

    let no_rides = hand_zip(&index(serde_json::json!([])), &[]);
    assert!(invalid(open(no_rides)), "a pack of no rides");

    let escaping = hand_zip(
        &index(serde_json::json!([listed("../up", &["original.fit"])])),
        &[("../up/original.fit", b"abc")],
    );
    assert!(invalid(open(escaping)), "a key that climbs out");
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_reader_refuses_an_index_it_does_not_define() {
    let sealing = keyfile();
    let open = |value: serde_json::Value| {
        let plain = hand_zip(&value, &[("ride-one/original.fit", b"abc")]);
        read_pack(&seal_as_pack(&plain, &sealing), &sealing.dek)
    };
    let rides = serde_json::json!([listed("ride-one", &["original.fit"])]);
    assert!(open(index(rides.clone())).is_ok());

    for (name, value) in [
        (
            "newer format",
            serde_json::json!({"format": 2, "month": "2026-03", "rides": rides}),
        ),
        (
            "format zero",
            serde_json::json!({"format": 0, "month": "2026-03", "rides": rides}),
        ),
        (
            "bad month",
            serde_json::json!({"format": 1, "month": "2026-13", "rides": rides}),
        ),
        (
            "unknown field",
            serde_json::json!({"format": 1, "month": "2026-03", "rides": rides, "extra": 1}),
        ),
        (
            "missing month",
            serde_json::json!({"format": 1, "rides": rides}),
        ),
        (
            "unknown kind",
            index(serde_json::json!([listed("ride-one", &["original.tcx"])])),
        ),
    ] {
        assert!(invalid(open(value)), "{name}");
    }

    let not_a_zip = seal_as_pack(b"plain bytes", &sealing);
    assert!(invalid(read_pack(&not_a_zip, &sealing.dek)));
}

#[test]
fn a_manifest_round_trips_and_may_list_no_packs() {
    let sealing = keyfile();
    let empty = write_manifest(&[], &sealing, &mut Counter(3)).unwrap();
    assert_eq!(
        read_manifest(&empty, &sealing.dek).unwrap().packs,
        Vec::new()
    );

    let packs = vec![
        ManifestPack::new(
            &sealing.key_id,
            month("2026-02"),
            vec!["a".into(), "b".into()],
            900,
        ),
        ManifestPack::new(&sealing.key_id, month("2026-03"), vec!["c".into()], 400),
    ];
    let bytes = write_manifest(&packs, &sealing, &mut Counter(4)).unwrap();
    let manifest = read_manifest(&bytes, &sealing.dek).unwrap();
    assert_eq!(manifest.packs, packs);
    assert_eq!(manifest.key_id, sealing.key_id);
    assert_eq!(packs[0].rides, 2);
}

#[test]
fn a_wrong_data_key_opens_no_manifest() {
    let sealing = keyfile();
    let bytes = write_manifest(&[], &sealing, &mut Counter(4)).unwrap();
    assert_eq!(
        read_manifest(&bytes, &Dek::from_bytes([9; 32])).unwrap_err(),
        PackError::Seal(SealError::Damaged)
    );
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_manifest_writer_and_reader_refuse_a_listing_that_contradicts_itself() {
    let sealing = keyfile();
    let id = sealing.key_id;
    let entry = |m: &str, keys: &[&str]| {
        ManifestPack::new(
            &id,
            month(m),
            keys.iter().map(|k| (*k).to_string()).collect(),
            100,
        )
    };
    let mut other_month = entry("2026-03", &["a"]);
    other_month.month = month("2026-04");
    let mut other_key = entry("2026-03", &["a"]);
    other_key.name = pack_name(&[1; 8], month("2026-03"));
    let mut miscounted = entry("2026-03", &["a", "b"]);
    miscounted.rides = 3;
    let mut no_rides = entry("2026-03", &[]);
    no_rides.rides = 0;

    let cases = [
        ("name that denies the month", vec![other_month]),
        ("name of another key", vec![other_key]),
        ("ride count that is not the keys", vec![miscounted]),
        ("pack of no rides", vec![no_rides]),
        (
            "month listed twice",
            vec![entry("2026-03", &["a"]), entry("2026-03", &["b"])],
        ),
        (
            "ride key in two packs",
            vec![entry("2026-03", &["a"]), entry("2026-04", &["a"])],
        ),
        ("bad ride key", vec![entry("2026-03", &["a/b"])]),
    ];
    for (name, packs) in cases {
        assert!(
            matches!(
                write_manifest(&packs, &sealing, &mut Counter(4)),
                Err(PackError::Invalid(_))
            ),
            "writer: {name}"
        );
        let json = serde_json::to_vec(&serde_json::json!({"format": 1, "packs": packs})).unwrap();
        let mut keyless = sealing.clone();
        keyless.wraps.clear();
        let bytes = seal(&json, Kind::Manifest, &keyless, &mut Counter(5)).unwrap();
        assert!(
            matches!(
                read_manifest(&bytes, &sealing.dek),
                Err(PackError::Invalid(_))
            ),
            "reader: {name}"
        );
    }
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_reader_refuses_a_manifest_it_does_not_define() {
    let sealing = keyfile();
    let mut keyless = sealing.clone();
    keyless.wraps.clear();
    for (name, json) in [
        (
            "newer format",
            serde_json::json!({"format": 2, "packs": []}),
        ),
        (
            "unknown field",
            serde_json::json!({"format": 1, "packs": [], "extra": 1}),
        ),
        ("no format", serde_json::json!({"packs": []})),
    ] {
        let bytes = seal(
            &serde_json::to_vec(&json).unwrap(),
            Kind::Manifest,
            &keyless,
            &mut Counter(5),
        )
        .unwrap();
        assert!(
            matches!(
                read_manifest(&bytes, &sealing.dek),
                Err(PackError::Invalid(_))
            ),
            "{name}"
        );
    }
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_manifest_naming_a_pack_the_pack_itself_denies_is_refused() {
    let sealing = keyfile();
    let rides = two_rides();
    let bytes = sealed_pack(&rides, &sealing);
    let pack = read_pack(&bytes, &sealing.dek).unwrap();
    let keys = vec!["ride-one".to_string(), "ride-two".to_string()];
    let honest = ManifestPack::new(
        &sealing.key_id,
        month("2026-03"),
        keys.clone(),
        bytes.len() as u64,
    );
    honest.verify_pack(&pack, bytes.len() as u64).unwrap();

    let wrong_month = ManifestPack::new(
        &sealing.key_id,
        month("2026-04"),
        keys.clone(),
        bytes.len() as u64,
    );
    let wrong_keys = ManifestPack::new(
        &sealing.key_id,
        month("2026-03"),
        vec!["ride-two".into(), "ride-one".into()],
        bytes.len() as u64,
    );
    let fewer_keys = ManifestPack::new(
        &sealing.key_id,
        month("2026-03"),
        vec!["ride-one".into()],
        bytes.len() as u64,
    );
    let wrong_key_id = ManifestPack::new(&[2; 8], month("2026-03"), keys, bytes.len() as u64);
    for (name, listing) in [
        ("month", wrong_month),
        ("ride keys in another order", wrong_keys),
        ("fewer ride keys", fewer_keys),
        ("key id", wrong_key_id),
    ] {
        assert!(
            matches!(
                listing.verify_pack(&pack, bytes.len() as u64),
                Err(PackError::Invalid(_))
            ),
            "{name}"
        );
    }
    assert!(
        matches!(
            honest.verify_pack(&pack, bytes.len() as u64 + 1),
            Err(PackError::Invalid(_))
        ),
        "byte length"
    );
}

#[test]
fn object_names_are_distinct_from_a_record_zips_and_follow_the_key_id() {
    let id = [0x10, 0x15, 0x1a, 0x1f, 0x24, 0x29, 0x2e, 0x33];
    assert_eq!(
        pack_name(&id, month("2026-03")),
        "veloq-pack-cakruhzefexdg-2026-03.sealed"
    );
    assert_eq!(
        manifest_name(&id),
        "veloq-packs-cakruhzefexdg.manifest.sealed"
    );
    let other = [0u8; 8];
    assert_eq!(
        manifest_name(&other),
        "veloq-packs-aaaaaaaaaaaaa.manifest.sealed"
    );
}

#[test]
fn a_month_is_four_digit_year_dash_two_digit_month() {
    assert_eq!(String::from(month("2026-03")), "2026-03");
    assert!(month("2026-03") < month("2026-12"));
    assert!(month("2025-12") < month("2026-01"));
    for bad in [
        "",
        "2026-3",
        "26-03",
        "2026-13",
        "2026-00",
        " 2026-03",
        "2026-03 ",
        "2026/03",
        "2026-03-01",
        "20260-3",
        "+026-03",
        "2026-+3",
        "abcd-ef",
    ] {
        assert!(bad.parse::<Month>().is_err(), "{bad:?}");
    }
}

#[test]
fn a_zip_entry_is_read_back_whole_whatever_its_size() {
    let sealing = keyfile();
    let big = vec![7u8; 300_000];
    let rides = [ride(
        "ride-one",
        &[(EntryKind::StreamsBin, &big), (EntryKind::OriginalFit, &[])],
    )];
    let pack = read_pack(&sealed_pack(&rides, &sealing), &sealing.dek).unwrap();
    assert_eq!(pack.rides[0].entries[0].bytes, big);
    assert!(pack.rides[0].entries[1].bytes.is_empty());
}
