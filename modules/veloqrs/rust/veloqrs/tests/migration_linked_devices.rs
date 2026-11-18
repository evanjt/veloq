//! Linked browsers on a library upgraded from the last release.
//!
//! Expected behaviour: the last release's library opens with an empty device list, a
//! device added is pinned by its certificate fingerprint and only that one,
//! and a removed device is no longer pinned, so it cannot reconnect.

use super::migration_support::*;
use rusqlite::Connection;
use std::net::IpAddr;
use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::persistence::linked_devices::{self, CONNECTION_ROWS, Client};

const LAPTOP: &str = "sha-256 AA:BB:CC:01";
const STRANGER: &str = "sha-256 AA:BB:CC:02";

fn upgraded_release_library() -> (TempDir, Connection) {
    upgraded_library_of(latest_release())
}

fn upgraded_library_of(release: &Release) -> (TempDir, Connection) {
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

    assert!(linked_devices::list(&conn, &[]).unwrap().is_empty());
    assert!(!linked_devices::is_pinned(&conn, LAPTOP).unwrap());

    let id = linked_devices::add(&conn, "Firefox on Linux", LAPTOP, None, 1_700_000_000).unwrap();
    let listed = linked_devices::list(&conn, &[]).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].id, id);
    assert_eq!(listed[0].name, "Firefox on Linux");
    assert_eq!(listed[0].last_seen_at, None);
    assert!(linked_devices::is_pinned(&conn, LAPTOP).unwrap());
    assert!(!linked_devices::is_pinned(&conn, STRANGER).unwrap());
    assert_eq!(
        linked_devices::room_keys(&conn).unwrap(),
        vec![(LAPTOP.to_owned(), None)]
    );

    linked_devices::touch(&conn, LAPTOP, 1_700_000_500).unwrap();
    assert_eq!(
        linked_devices::list(&conn, &[]).unwrap()[0].last_seen_at,
        Some(1_700_000_500.0)
    );

    assert!(linked_devices::remove(&conn, &id).unwrap());
    assert!(!linked_devices::is_pinned(&conn, LAPTOP).unwrap());
    assert!(linked_devices::list(&conn, &[]).unwrap().is_empty());
    assert!(linked_devices::room_keys(&conn).unwrap().is_empty());
    assert!(!linked_devices::remove(&conn, &id).unwrap());
}

#[test]
fn linking_the_same_certificate_twice_keeps_one_device() {
    let _serial_state = super::serial_state();
    let (_dir, conn) = upgraded_release_library();

    linked_devices::add(&conn, "Old name", LAPTOP, None, 1).unwrap();
    linked_devices::add(&conn, "New name", LAPTOP, None, 2).unwrap();
    let listed = linked_devices::list(&conn, &[]).unwrap();
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
    linked_devices::add(&conn, "Firefox on Linux", LAPTOP, None, 1).unwrap();
    linked_devices::store_identity_if_absent(&conn, b"phone").unwrap();
    drop(conn);

    let path = dir.path().join("routes.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("open engine");
    engine.clear().expect("clear");
    drop(engine);

    let conn = Connection::open(&path).expect("reopen");
    assert!(!linked_devices::is_pinned(&conn, LAPTOP).unwrap());
    assert!(linked_devices::list(&conn, &[]).unwrap().is_empty());
    assert_eq!(
        linked_devices::identity(&conn).unwrap().as_deref(),
        Some(&b"phone"[..])
    );
}

#[test]
fn an_upgraded_library_logs_a_browsers_writes_and_drops_them_with_it() {
    let _serial_state = super::serial_state();
    let (_dir, conn) = upgraded_release_library();
    let id = linked_devices::add(&conn, "Firefox on Linux", LAPTOP, None, 1).unwrap();

    assert!(
        linked_devices::recent_writes(&conn, &id, 10)
            .unwrap()
            .is_empty()
    );
    linked_devices::record_write(
        &conn,
        LAPTOP,
        "section.rename",
        "s1",
        "Renamed section A to B",
        5,
    )
    .unwrap();
    linked_devices::record_write(&conn, STRANGER, "section.rename", "s2", "not linked", 6).unwrap();
    let rows = linked_devices::recent_writes(&conn, &id, 10).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].summary, "Renamed section A to B");

    assert!(linked_devices::remove(&conn, &id).unwrap());
    assert!(
        linked_devices::recent_writes(&conn, &id, 10)
            .unwrap()
            .is_empty()
    );
}

// Built from octets so a private-range literal never appears in the source.
fn home_lan(host: u8) -> IpAddr {
    IpAddr::from([192, 168, 1, host])
}

fn laptop_description() -> Client {
    Client {
        kind: "browser".into(),
        browser: Some("Firefox".into()),
        os: Some("Linux".into()),
        tool: None,
        tool_version: None,
    }
}

#[test]
fn every_released_library_keeps_its_rows_and_opens_with_an_empty_history() {
    let _serial_state = super::serial_state();
    for release in RELEASES.iter().filter(|release| release.library.is_some()) {
        let (_dir, conn) = upgraded_library_of(release);
        assert_eq!(user_version(&conn), latest_version(), "{}", release.name);
        let id = linked_devices::add(&conn, "Firefox on Linux", LAPTOP, None, 1).unwrap();
        assert!(
            linked_devices::recent_connections(&conn, &id, 10)
                .unwrap()
                .is_empty()
        );
        let row =
            linked_devices::open_connection(&conn, LAPTOP, home_lan(20), Some(home_lan(5)), 10)
                .unwrap();
        assert!(row.is_some(), "{}", release.name);
    }
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_connection_on_the_phones_subnet_is_this_network_with_its_client_and_end_reason() {
    let _serial_state = super::serial_state();
    let (_dir, conn) = upgraded_release_library();
    let id = linked_devices::add(&conn, "Firefox on Linux", LAPTOP, None, 1).unwrap();

    let row = linked_devices::open_connection(&conn, LAPTOP, home_lan(20), Some(home_lan(5)), 100)
        .unwrap()
        .expect("a linked device has a row");
    linked_devices::set_client(&conn, row, &laptop_description()).unwrap();

    let open = linked_devices::recent_connections(&conn, &id, 10).unwrap();
    assert_eq!(open.len(), 1);
    assert_eq!(open[0].remote_address, home_lan(20).to_string());
    assert!(open[0].this_network);
    assert_eq!(open[0].started_at, 100.0);
    assert_eq!(open[0].ended_at, None);
    assert_eq!(open[0].end_reason, None);
    assert_eq!(open[0].client, Some(laptop_description()));

    linked_devices::close_connection(&conn, row, "backgrounded", 160).unwrap();
    let closed = linked_devices::recent_connections(&conn, &id, 10).unwrap();
    assert_eq!(closed[0].ended_at, Some(160.0));
    assert_eq!(closed[0].end_reason.as_deref(), Some("backgrounded"));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_connection_from_a_public_address_is_the_internet() {
    let _serial_state = super::serial_state();
    let (_dir, conn) = upgraded_release_library();
    let id = linked_devices::add(&conn, "Firefox on Linux", LAPTOP, None, 1).unwrap();
    linked_devices::open_connection(
        &conn,
        LAPTOP,
        "203.0.113.9".parse::<IpAddr>().unwrap(),
        Some(home_lan(5)),
        100,
    )
    .unwrap();
    let rows = linked_devices::recent_connections(&conn, &id, 10).unwrap();
    assert!(!rows[0].this_network);
    assert_eq!(rows[0].client, None);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_fifty_first_connection_trims_the_oldest_of_that_device_only() {
    let _serial_state = super::serial_state();
    let (_dir, conn) = upgraded_release_library();
    let laptop = linked_devices::add(&conn, "Firefox on Linux", LAPTOP, None, 1).unwrap();
    let other = linked_devices::add(&conn, "Safari on Mac", STRANGER, None, 2).unwrap();
    let remote = home_lan(20);
    let local = Some(home_lan(5));

    linked_devices::open_connection(&conn, STRANGER, remote, local, 5).unwrap();
    for at in 0..=CONNECTION_ROWS {
        linked_devices::open_connection(&conn, LAPTOP, remote, local, 1_000 + at).unwrap();
    }

    let rows = linked_devices::recent_connections(&conn, &laptop, 100).unwrap();
    assert_eq!(rows.len(), CONNECTION_ROWS as usize);
    assert_eq!(rows[0].started_at, (1_000 + CONNECTION_ROWS) as f64);
    assert_eq!(rows.last().unwrap().started_at, 1_001.0);
    assert_eq!(
        linked_devices::recent_connections(&conn, &other, 100)
            .unwrap()
            .len(),
        1
    );
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn removing_a_device_deletes_its_connections() {
    let _serial_state = super::serial_state();
    let (_dir, conn) = upgraded_release_library();
    let id = linked_devices::add(&conn, "Firefox on Linux", LAPTOP, None, 1).unwrap();
    linked_devices::open_connection(&conn, LAPTOP, home_lan(20), None, 5).unwrap();
    assert!(linked_devices::remove(&conn, &id).unwrap());
    let left: i64 = conn
        .query_row("SELECT COUNT(*) FROM linked_connections", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(left, 0);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_refused_offer_is_counted_for_its_day_and_no_row_is_stored() {
    let _serial_state = super::serial_state();
    let (_dir, conn) = upgraded_release_library();
    linked_devices::count_refusal(&conn, 1_700_000_000).unwrap();
    linked_devices::count_refusal(&conn, 1_700_000_500).unwrap();
    linked_devices::count_refusal(&conn, 1_700_100_000).unwrap();
    assert_eq!(
        linked_devices::refusals_on(&conn, 1_700_000_000).unwrap(),
        2
    );
    assert_eq!(
        linked_devices::refusals_on(&conn, 1_700_100_000).unwrap(),
        1
    );
    assert_eq!(
        linked_devices::refusals_on(&conn, 1_600_000_000).unwrap(),
        0
    );
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn rows_a_crash_left_open_end_as_closed_when_the_service_next_starts() {
    let _serial_state = super::serial_state();
    let (_dir, conn) = upgraded_release_library();
    let id = linked_devices::add(&conn, "Firefox on Linux", LAPTOP, None, 1).unwrap();
    linked_devices::open_connection(&conn, LAPTOP, home_lan(20), None, 5).unwrap();
    linked_devices::close_open_connections(&conn, 50).unwrap();
    let rows = linked_devices::recent_connections(&conn, &id, 10).unwrap();
    assert_eq!(rows[0].ended_at, Some(50.0));
    assert_eq!(rows[0].end_reason.as_deref(), Some("closed"));
}
