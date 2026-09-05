//! A launch that changes several settings pays one durable commit, not one
//! per key. An unchanged pair is skipped inside the batch, the way a single
//! write already skips it, and a batch that cannot be written leaves the
//! stored values as they were.
//!
//! Run: `cargo test --test settings_batch_write -p veloqrs`

use std::path::PathBuf;

use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::PersistentEngine;

fn open(dir: &TempDir) -> (PathBuf, PersistentEngine) {
    let path = dir.path().join("settings.db");
    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    (path, engine)
}

fn pairs(values: &[(&str, &str)]) -> Vec<(String, String)> {
    values
        .iter()
        .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
        .collect()
}

#[test]
fn every_pair_in_a_batch_is_stored() {
    let dir = TempDir::new().unwrap();
    let (_path, engine) = open(&dir);

    let written = engine
        .set_settings(&pairs(&[
            ("theme", "dark"),
            ("units", "metric"),
            ("sport", "Ride"),
        ]))
        .expect("batch");

    assert_eq!(written, 3);
    assert_eq!(
        engine.get_setting("theme").unwrap().as_deref(),
        Some("dark")
    );
    assert_eq!(
        engine.get_setting("units").unwrap().as_deref(),
        Some("metric")
    );
    assert_eq!(
        engine.get_setting("sport").unwrap().as_deref(),
        Some("Ride")
    );
}

#[test]
fn a_pair_that_is_already_stored_is_skipped() {
    let dir = TempDir::new().unwrap();
    let (_path, engine) = open(&dir);
    engine.set_setting("theme", "dark").expect("seed");

    let written = engine
        .set_settings(&pairs(&[("theme", "dark"), ("units", "metric")]))
        .expect("batch");

    assert_eq!(written, 1, "the unchanged pair was rewritten");
    assert_eq!(
        engine.get_setting("units").unwrap().as_deref(),
        Some("metric")
    );
}

#[test]
fn a_batch_that_changes_nothing_writes_nothing() {
    let dir = TempDir::new().unwrap();
    let (_path, engine) = open(&dir);
    engine.set_setting("theme", "dark").expect("seed");

    assert_eq!(
        engine.set_settings(&pairs(&[("theme", "dark")])).unwrap(),
        0
    );
    assert_eq!(engine.set_settings(&[]).unwrap(), 0);
}

#[test]
fn the_last_value_for_a_repeated_key_is_the_one_stored() {
    let dir = TempDir::new().unwrap();
    let (_path, engine) = open(&dir);

    let written = engine
        .set_settings(&pairs(&[("theme", "dark"), ("theme", "light")]))
        .expect("batch");

    assert_eq!(written, 2);
    assert_eq!(
        engine.get_setting("theme").unwrap().as_deref(),
        Some("light")
    );
}

#[test]
fn a_batch_that_fails_leaves_none_of_its_keys_written() {
    let dir = TempDir::new().unwrap();
    let (path, engine) = open(&dir);
    Connection::open(&path)
        .expect("raw open")
        .execute(
            "CREATE TRIGGER refuse BEFORE INSERT ON settings WHEN NEW.key = 'bad'
             BEGIN SELECT RAISE(ABORT, 'refused'); END",
            [],
        )
        .expect("trigger");

    let result = engine.set_settings(&pairs(&[
        ("theme", "dark"),
        ("bad", "x"),
        ("units", "metric"),
    ]));

    assert!(
        result.is_err(),
        "the batch reported success over a refused write"
    );
    assert_eq!(engine.get_setting("theme").unwrap(), None);
    assert_eq!(engine.get_setting("units").unwrap(), None);
}
