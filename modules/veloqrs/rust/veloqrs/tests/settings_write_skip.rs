//! Scenario: a store persists on launch what it just read, so most settings
//! writes carry the value already stored.
//! Expected behaviour: an unchanged value costs a read, not a durable commit.
//! The rollback journal is kept on purpose and `synchronous` is SQLite's
//! default, so every real write is a journal write, an fsync, a database write
//! and a second fsync, about 20 ms on the device this was measured on.

mod migration_support;

use migration_support::{latest_version, seed_at_version};
use rusqlite::{Connection, params};
use tempfile::TempDir;
use veloqrs::PersistentEngine;

const KEY: &str = "veloq-insights-fingerprint";

fn engine() -> (PersistentEngine, TempDir, std::path::PathBuf) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("settings.db");
    drop(seed_at_version(&path, latest_version()));
    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    (engine, dir, path)
}

fn open(path: &std::path::Path) -> Connection {
    Connection::open(path).expect("open")
}

/// `updated_at` is the witness: it is rewritten by every upsert, so a stamp
/// that has not moved is a commit that did not happen.
fn stamp(path: &std::path::Path, key: &str) -> i64 {
    open(path)
        .query_row(
            "SELECT updated_at FROM settings WHERE key = ?",
            params![key],
            |row| row.get(0),
        )
        .expect("the settings row")
}

fn backdate(path: &std::path::Path, key: &str) {
    let conn = open(path);
    conn.execute(
        "UPDATE settings SET updated_at = 1 WHERE key = ?",
        params![key],
    )
    .expect("backdate");
}

#[test]
fn writing_the_same_value_again_does_not_commit() {
    let (engine, _dir, path) = engine();
    engine.set_setting(KEY, "abc123").expect("first write");
    backdate(&path, KEY);

    engine.set_setting(KEY, "abc123").expect("repeat write");

    assert_eq!(
        stamp(&path, KEY),
        1,
        "an unchanged value must not cost a durable commit"
    );
}

#[test]
fn writing_a_different_value_commits() {
    let (engine, _dir, path) = engine();
    engine.set_setting(KEY, "abc123").expect("first write");
    backdate(&path, KEY);

    engine.set_setting(KEY, "def456").expect("second write");

    assert!(stamp(&path, KEY) > 1, "a changed value has to be written");
    assert_eq!(
        engine.get_setting(KEY).expect("read"),
        Some("def456".to_string())
    );
}

#[test]
fn a_first_write_of_a_key_commits() {
    let (engine, _dir, path) = engine();

    engine.set_setting(KEY, "abc123").expect("first write");

    assert_eq!(
        engine.get_setting(KEY).expect("read"),
        Some("abc123".to_string())
    );
}

/// An empty string is a value, not an absent key, so writing it over a stored
/// one is a change and writing it twice is not.
#[test]
fn an_empty_value_is_a_value() {
    let (engine, _dir, path) = engine();
    engine.set_setting(KEY, "abc123").expect("first write");

    engine.set_setting(KEY, "").expect("clear it");
    assert_eq!(engine.get_setting(KEY).expect("read"), Some(String::new()));

    backdate(&path, KEY);
    engine.set_setting(KEY, "").expect("clear it again");
    assert_eq!(stamp(&path, KEY), 1);
}

/// A deleted key is not an unchanged one: the next write of the same value has
/// to put the row back.
#[test]
fn a_deleted_key_is_written_again() {
    let (engine, _dir, path) = engine();
    engine.set_setting(KEY, "abc123").expect("first write");
    engine.delete_setting(KEY).expect("delete");

    engine.set_setting(KEY, "abc123").expect("write it back");

    assert_eq!(
        engine.get_setting(KEY).expect("read"),
        Some("abc123".to_string())
    );
}
