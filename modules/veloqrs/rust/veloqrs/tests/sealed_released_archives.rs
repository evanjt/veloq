//! Scenario: an athlete holds a sealed backup written by an earlier release
//! and installs a later one.
//!
//! Expected behaviour: every release's archive opens with the fixed secret,
//! carries a record zip the current reader accepts, and restores into a fresh
//! library with the seeded settings and section name in place.

use std::io::Read;

use rusqlite::Connection;
use veloqrs::PersistentEngine;
use veloqrs::persistence::seal::{Kind, open};

use crate::migration_support::sealed::{SEEDED_SECTION_NAME, SEEDED_SETTINGS, secret, seed_ride};
use crate::migration_support::{SEALED_RELEASES, SealedRelease};

fn record_json(release: &SealedRelease) -> String {
    let opened = open(release.archive, secret().as_bytes())
        .unwrap_or_else(|e| panic!("{} does not open: {e}", release.name));
    assert_eq!(opened.kind, Kind::Record, "{}", release.name);
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(opened.plaintext))
        .unwrap_or_else(|e| panic!("{} holds no zip: {e}", release.name));
    let mut json = String::new();
    zip.by_name("record.json")
        .unwrap_or_else(|e| panic!("{} holds no record: {e}", release.name))
        .read_to_string(&mut json)
        .unwrap();
    json
}

fn restores(release: &SealedRelease) {
    let json = record_json(release);
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("library.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    seed_ride(&mut engine);
    engine
        .restore_record_json(&json)
        .unwrap_or_else(|e| panic!("{} does not restore: {e}", release.name));

    for (key, value) in SEEDED_SETTINGS {
        assert_eq!(
            engine.get_setting(key).unwrap().as_deref(),
            Some(value),
            "{}: setting {key}",
            release.name
        );
    }
    let named: i64 = Connection::open(&path)
        .unwrap()
        .query_row(
            "SELECT COUNT(*) FROM sections WHERE name = ?1",
            [SEEDED_SECTION_NAME],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(named, 1, "{}: the named section", release.name);
}

#[test]
fn every_released_sealed_archive_restores() {
    if cfg!(feature = "sealed-releases") {
        assert!(
            !SEALED_RELEASES.is_empty(),
            "a build that carries the sealed container has no release row to restore"
        );
    }
    for release in SEALED_RELEASES {
        restores(release);
    }
}
