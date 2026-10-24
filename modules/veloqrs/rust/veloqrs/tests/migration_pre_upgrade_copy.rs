//! A copy of the library is taken before a migration changes it.
//!
//! Activities refill from the server, but section names, pins, cuts and
//! recordings live only in this file. A migration that fails part way or
//! writes wrong values would otherwise leave nothing in the old shape to go
//! back to.
//!
//! Expected behaviour: an upgrade leaves `routes.db.pre-upgrade-<old>` beside
//! the library, a complete database at the old version. A fresh install and a
//! file already current write none. The copy stays until the detector cutover
//! that follows the upgrade is promoted, then the next open removes it, a later
//! upgrade replaces it, and a copy that cannot be written leaves the upgrade to
//! run without one.

use super::migration_support;

use migration_support::*;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use tempfile::TempDir;
use veloqrs::PersistentEngine;

const FIXTURE: &str = include_str!("fixtures/v12_demo.sql");
const FIXTURE_ACTIVITIES: i64 = 75;
const FIXTURE_SECTIONS: i64 = 42;

fn released_v12() -> (TempDir, PathBuf) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    let conn = Connection::open(&path).expect("open fixture database");
    conn.execute_batch(FIXTURE).expect("replay fixture");
    drop(conn);
    (dir, path)
}

fn open_engine(path: &Path) {
    drop(PersistentEngine::new(path.to_str().unwrap()).expect("open engine"));
}

fn copy_path(path: &Path, version: u32) -> PathBuf {
    PathBuf::from(format!("{}.pre-upgrade-{version}", path.display()))
}

/// Every sibling a pre-upgrade copy could have left, its WAL sidecars included.
fn copies_beside(path: &Path) -> Vec<String> {
    let stem = format!(
        "{}.pre-upgrade-",
        path.file_name().unwrap().to_string_lossy()
    );
    let mut names: Vec<String> = std::fs::read_dir(path.parent().unwrap())
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.starts_with(&stem))
        .collect();
    names.sort();
    names
}

fn count(conn: &Connection, table: &str) -> i64 {
    row_count(conn, table).unwrap_or_else(|| panic!("{table} is missing"))
}

#[test]
fn an_upgrade_from_a_released_v12_leaves_a_copy_at_v12() {
    let _serial_state = super::serial_state();
    let (_dir, path) = released_v12();

    open_engine(&path);

    let copy = copy_path(&path, 12);
    assert_eq!(
        copies_beside(&path),
        vec!["routes.db.pre-upgrade-12".to_string()]
    );
    let old = Connection::open(&copy).expect("open copy");
    assert_eq!(user_version(&old), 12, "the copy holds the old schema");
    assert_eq!(app_schema_version(&old), Some(12));
    assert_eq!(count(&old, "activities"), FIXTURE_ACTIVITIES);
    assert_eq!(count(&old, "sections"), FIXTURE_SECTIONS);

    let live = Connection::open(&path).expect("open live");
    assert_ne!(
        tables_at(&old),
        tables_at(&live),
        "the copy carries the old table set, not the migrated one"
    );
    assert_eq!(user_version(&live), latest_version());
    assert_eq!(count(&live, "activities"), FIXTURE_ACTIVITIES);
}

#[test]
fn a_fresh_install_writes_no_copy_on_either_launch() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");

    open_engine(&path);
    assert!(copies_beside(&path).is_empty());
    open_engine(&path);
    assert!(copies_beside(&path).is_empty());
}

#[test]
fn a_launch_with_nothing_to_migrate_keeps_the_copy_while_the_cutover_is_owed() {
    let _serial_state = super::serial_state();
    let (_dir, path) = released_v12();

    open_engine(&path);
    assert_eq!(copies_beside(&path).len(), 1);

    open_engine(&path);
    open_engine(&path);
    assert_eq!(
        copies_beside(&path),
        vec!["routes.db.pre-upgrade-12".to_string()],
        "the detector cutover after the upgrade still owes its switch"
    );
}

#[test]
fn an_upgrade_keeps_one_generation() {
    let _serial_state = super::serial_state();
    let (_dir, path) = released_v12();
    let older = copy_path(&path, 5);
    std::fs::write(&older, b"an earlier generation").unwrap();

    open_engine(&path);

    assert_eq!(
        copies_beside(&path),
        vec!["routes.db.pre-upgrade-12".to_string()]
    );
}

/// An upgrade that died part way leaves the file at its old recorded version
/// with some migrations applied. The copy taken before that attempt is the one
/// in the old shape, and the retry must not overwrite it with the part-migrated
/// file.
#[test]
fn a_retried_upgrade_keeps_the_copy_its_first_attempt_took() {
    let _serial_state = super::serial_state();
    let (_dir, path) = released_v12();
    let copy = copy_path(&path, 12);
    std::fs::copy(&path, &copy).unwrap();
    let first_attempt = Connection::open(&copy).unwrap();
    first_attempt
        .execute_batch("CREATE TABLE first_attempt (marker INTEGER)")
        .unwrap();
    drop(first_attempt);

    open_engine(&path);

    let kept = Connection::open(&copy).unwrap();
    assert!(
        tables_at(&kept).contains(&"first_attempt".to_string()),
        "the retry kept the earlier copy"
    );
    assert_eq!(count(&kept, "activities"), FIXTURE_ACTIVITIES);
    drop(kept);
    set_cutover_token(&path, "unified-1");
    open_engine(&path);
    assert!(
        copies_beside(&path).is_empty(),
        "and it is released once the cutover is promoted"
    );
}

#[test]
fn a_copy_that_cannot_be_written_does_not_block_the_upgrade() {
    let _serial_state = super::serial_state();
    let (_dir, path) = released_v12();
    // A directory where the copy would go makes the write fail the way a full
    // disk does: the destination cannot be opened as a database.
    std::fs::create_dir(copy_path(&path, 12)).unwrap();

    open_engine(&path);

    let live = Connection::open(&path).expect("open live");
    assert_eq!(user_version(&live), latest_version());
    assert_eq!(count(&live, "activities"), FIXTURE_ACTIVITIES);
    drop(live);

    // Nothing was copied, so the next launch has nothing of its own to remove.
    open_engine(&path);
    assert!(copy_path(&path, 12).is_dir());
}

#[test]
fn a_file_from_before_version_tracking_is_copied_as_version_zero() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let seed = seed_at_version(&path, 1);
    seed.execute("DROP TABLE schema_info", []).unwrap();
    drop(seed);

    open_engine(&path);

    assert_eq!(
        copies_beside(&path),
        vec!["routes.db.pre-upgrade-0".to_string()]
    );
    let old = Connection::open(copy_path(&path, 0)).unwrap();
    assert_eq!(user_version(&old), 1);
    assert_eq!(app_schema_version(&old), None);
}

#[test]
fn a_file_newer_than_this_build_is_refused_without_a_copy() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let seed = seed_at_version(&path, latest_version());
    stamp_app_schema_version(&seed, 9_999);
    drop(seed);

    assert!(PersistentEngine::new(path.to_str().unwrap()).is_err());
    assert!(copies_beside(&path).is_empty());
}

/// A library that failed to open is replaced by a fresh one, and the copy is
/// then the only record of what the athlete had. A fresh file never removes it.
#[test]
fn a_fresh_library_beside_a_copy_leaves_the_copy_alone() {
    let _serial_state = super::serial_state();
    let (_dir, path) = released_v12();
    open_engine(&path);
    for suffix in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
    }

    open_engine(&path);
    open_engine(&path);

    assert_eq!(
        copies_beside(&path),
        vec!["routes.db.pre-upgrade-12".to_string()]
    );
}

#[test]
fn a_truncated_copy_left_at_the_copy_path_is_replaced() {
    let _serial_state = super::serial_state();
    let (_dir, path) = released_v12();
    let whole = std::fs::read(&path).unwrap();
    std::fs::write(copy_path(&path, 12), &whole[..whole.len() / 2]).unwrap();

    open_engine(&path);

    let copy = Connection::open(copy_path(&path, 12)).expect("open copy");
    assert_eq!(
        user_version(&copy),
        12,
        "the replacement holds the old schema"
    );
    assert_eq!(count(&copy, "activities"), FIXTURE_ACTIVITIES);
    assert_eq!(count(&copy, "sections"), FIXTURE_SECTIONS);
}

#[test]
fn a_partial_copy_a_killed_upgrade_left_behind_is_deleted_by_the_next_upgrade() {
    let _serial_state = super::serial_state();
    let (_dir, path) = released_v12();
    let partial = PathBuf::from(format!("{}.partial", copy_path(&path, 12).display()));
    std::fs::write(&partial, b"cut off mid-copy").unwrap();

    open_engine(&path);

    assert!(!partial.exists(), "the temporary name is gone");
    assert_eq!(
        copies_beside(&path),
        vec!["routes.db.pre-upgrade-12".to_string()]
    );
}

/// Writes the detector cutover token the way a cutover at that stage leaves it.
fn set_cutover_token(path: &Path, token: &str) {
    let live = Connection::open(path).expect("open live");
    live.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('__detector_cutover', ?1)",
        [token],
    )
    .unwrap();
}

#[test]
fn a_copy_is_kept_while_the_cutover_is_in_flight() {
    let _serial_state = super::serial_state();
    let (_dir, path) = released_v12();
    open_engine(&path);
    set_cutover_token(&path, "unified-1-inflight");

    open_engine(&path);

    assert_eq!(
        copies_beside(&path),
        vec!["routes.db.pre-upgrade-12".to_string()],
        "a cutover that has not been promoted still has its old catalogue to fall back to"
    );
}

#[test]
fn a_settled_cutover_releases_the_copy_on_the_next_open() {
    let _serial_state = super::serial_state();
    let (_dir, path) = released_v12();
    open_engine(&path);
    set_cutover_token(&path, "unified-1");

    open_engine(&path);

    assert!(
        copies_beside(&path).is_empty(),
        "a settled cutover no longer owes the copy"
    );
}
