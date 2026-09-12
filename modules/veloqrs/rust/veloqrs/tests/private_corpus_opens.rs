//! Scenario: the athlete's own `routes.db` under the gitignored
//! `tests/fixtures/private/` is the corpus several audit items are measured
//! against, and a measurement that needs the engine's lock, cache and codec has
//! to open it with `PersistentEngine::new` rather than read it with `sqlite3`.
//!
//! Expected behaviour: a writable copy of it opens, and the tables the
//! migrations after its own version add are there afterwards.
//!
//! Skipped where the fixture is absent, which is everywhere but the owner's
//! machine. Nothing here prints a coordinate, an activity id or a section name.
//!
//! Two of these are `#[ignore]`d and red on purpose. Aligning `user_version`
//! down to `schema_info` gets the corpus past migration 026, and 032 then fails
//! on `no such table: section_intents`, because the file is genuinely at
//! migration 13: tables from 014, 015, 016, 017, 018, 021, 025, 028 and 029 are
//! all absent, so both of its version records overstate it and neither says
//! where it really sits. Which repair to make is `Q309`, and these two are its
//! acceptance test. Run them with `-- --ignored`.

use std::path::PathBuf;

use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::PersistentEngine;

#[path = "migration_support/mod.rs"]
mod migration_support;

const FIXTURE: &str = "tests/fixtures/private/routes.db";

/// The corpus as the engine must be handed it: a writable copy whose
/// `user_version` agrees with what was actually applied to it.
fn writable_copy() -> Option<(PathBuf, TempDir)> {
    let src = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(FIXTURE);
    if !src.exists() {
        eprintln!("skipped: {} is not present", src.display());
        return None;
    }
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    std::fs::copy(&src, &path).expect("copy corpus");
    migration_support::align_user_version(&path);
    Some((path, dir))
}

#[test]
#[ignore = "red until Q309 decides how to repair the corpus"]
fn the_private_corpus_opens_through_the_engine() {
    let Some((path, _dir)) = writable_copy() else {
        return;
    };

    let engine = PersistentEngine::new(path.to_str().expect("utf-8 path"));
    assert!(
        engine.is_ok(),
        "the private corpus must open through the engine: {:?}",
        engine.err()
    );
}

#[test]
#[ignore = "red until Q309 decides how to repair the corpus"]
fn opening_it_applies_the_migrations_it_was_missing() {
    let Some((path, _dir)) = writable_copy() else {
        return;
    };

    let before = {
        let conn = Connection::open(&path).expect("open copy");
        migration_support::tables_at(&conn)
    };
    assert!(
        !before.contains(&"recordings".to_string()),
        "the corpus is meant to predate 025_recordings; it already has the table"
    );

    PersistentEngine::new(path.to_str().expect("utf-8 path")).expect("engine opens the corpus");

    let conn = Connection::open(&path).expect("reopen copy");
    let after = migration_support::tables_at(&conn);
    for table in ["recordings", "job_attempts"] {
        assert!(
            after.contains(&table.to_string()),
            "{table} is missing after the engine opened the corpus"
        );
    }
    assert_eq!(
        migration_support::user_version(&conn),
        migration_support::latest_version(),
        "the corpus must land on the crate's latest migration"
    );
}

#[test]
fn aligning_never_raises_a_version() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("seeded.db");
    let conn = migration_support::seed_at_version(&path, 12);
    drop(conn);

    migration_support::align_user_version(&path);

    let conn = Connection::open(&path).expect("reopen seed");
    assert_eq!(
        migration_support::user_version(&conn),
        12,
        "a database whose two versions already agree must not move"
    );
}
