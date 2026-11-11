//! Linked browsers on a library upgraded from the last release.
//!
//! Expected behaviour: the last release's library opens with an empty device list, a
//! device added is pinned by its certificate fingerprint and only that one,
//! and a removed device is no longer pinned, so it cannot reconnect.

use super::migration_support::*;
use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::persistence::linked_devices;

const LAPTOP: &str = "sha-256 AA:BB:CC:01";
const STRANGER: &str = "sha-256 AA:BB:CC:02";

fn upgraded_release_library() -> (TempDir, Connection) {
    let release = latest_release();
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    Connection::open(&path)
        .expect("open fixture")
        .execute_batch(release.library.expect("the latest release has a library"))
        .expect("replay fixture");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("open engine");
    engine.load().expect("load");
    drop(engine);
    let conn = Connection::open(&path).expect("reopen");
    (dir, conn)
}

#[test]
fn an_upgraded_library_pins_a_linked_device_until_it_is_removed() {
    let _serial_state = super::serial_state();
    let (_dir, conn) = upgraded_release_library();

    assert!(linked_devices::list(&conn).unwrap().is_empty());
    assert!(!linked_devices::is_pinned(&conn, LAPTOP).unwrap());

    let id = linked_devices::add(&conn, "Firefox on Linux", LAPTOP, 1_700_000_000).unwrap();
    let listed = linked_devices::list(&conn).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, id);
    assert_eq!(listed[0].name, "Firefox on Linux");
    assert_eq!(listed[0].last_seen_at, None);
    assert!(linked_devices::is_pinned(&conn, LAPTOP).unwrap());
    assert!(!linked_devices::is_pinned(&conn, STRANGER).unwrap());
    assert_eq!(linked_devices::fingerprints(&conn).unwrap(), vec![LAPTOP]);

    linked_devices::touch(&conn, LAPTOP, 1_700_000_500).unwrap();
    assert_eq!(
        linked_devices::list(&conn).unwrap()[0].last_seen_at,
        Some(1_700_000_500.0)
    );

    assert!(linked_devices::remove(&conn, &id).unwrap());
    assert!(!linked_devices::is_pinned(&conn, LAPTOP).unwrap());
    assert!(linked_devices::list(&conn).unwrap().is_empty());
    assert!(linked_devices::fingerprints(&conn).unwrap().is_empty());
    assert!(!linked_devices::remove(&conn, &id).unwrap());
}

#[test]
fn linking_the_same_certificate_twice_keeps_one_device() {
    let _serial_state = super::serial_state();
    let (_dir, conn) = upgraded_release_library();

    linked_devices::add(&conn, "Old name", LAPTOP, 1).unwrap();
    linked_devices::add(&conn, "New name", LAPTOP, 2).unwrap();
    let listed = linked_devices::list(&conn).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].name, "New name");
}

#[test]
fn the_phone_identity_is_written_once_and_read_back() {
    let _serial_state = super::serial_state();
    let (_dir, conn) = upgraded_release_library();

    assert_eq!(linked_devices::identity(&conn).unwrap(), None);
    linked_devices::store_identity_if_absent(&conn, b"first").unwrap();
    linked_devices::store_identity_if_absent(&conn, b"second").unwrap();
    assert_eq!(
        linked_devices::identity(&conn).unwrap().as_deref(),
        Some(&b"first"[..])
    );
}

#[test]
fn signing_out_unlinks_every_device() {
    let _serial_state = super::serial_state();
    let (dir, conn) = upgraded_release_library();
    linked_devices::add(&conn, "Firefox on Linux", LAPTOP, 1).unwrap();
    linked_devices::store_identity_if_absent(&conn, b"phone").unwrap();
    drop(conn);

    let path = dir.path().join("routes.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("open engine");
    engine.clear().expect("clear");
    drop(engine);

    let conn = Connection::open(&path).expect("reopen");
    assert!(!linked_devices::is_pinned(&conn, LAPTOP).unwrap());
    assert!(linked_devices::list(&conn).unwrap().is_empty());
    assert_eq!(
        linked_devices::identity(&conn).unwrap().as_deref(),
        Some(&b"phone"[..])
    );
}
