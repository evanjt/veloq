//! Spent pairing secrets on a library upgraded from the last release.
//!
//! Expected behaviour: the last release's library opens with no spent secret.
//! A secret recorded as spent stays spent when the library is opened again,
//! and a second record of it is refused. A spent secret is removed once its
//! invitation has expired, when a later secret is recorded.

use super::migration_support::*;
use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::persistence::linked_devices;

const FIRST: [u8; 32] = [1u8; 32];
const SECOND: [u8; 32] = [2u8; 32];
const THIRD: [u8; 32] = [3u8; 32];

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
fn an_upgraded_library_refuses_a_secret_recorded_as_spent_the_second_time() {
    let _serial_state = super::serial_state();
    let (_dir, conn) = upgraded_release_library();

    assert!(!linked_devices::secret_spent(&conn, &FIRST).unwrap());
    assert!(linked_devices::spend_secret(&conn, &FIRST, 1_700_000_120, 1_700_000_000).unwrap());
    assert!(linked_devices::secret_spent(&conn, &FIRST).unwrap());
    assert!(!linked_devices::spend_secret(&conn, &FIRST, 1_700_000_120, 1_700_000_010).unwrap());
    assert!(!linked_devices::secret_spent(&conn, &SECOND).unwrap());
}

#[test]
fn a_spent_secret_is_still_spent_after_the_library_is_opened_again() {
    let _serial_state = super::serial_state();
    let (dir, conn) = upgraded_release_library();
    linked_devices::spend_secret(&conn, &FIRST, 1_700_000_120, 1_700_000_000).unwrap();
    drop(conn);

    let reopened = Connection::open(dir.path().join("routes.db")).expect("reopen");
    assert!(linked_devices::secret_spent(&reopened, &FIRST).unwrap());
    assert!(
        !linked_devices::spend_secret(&reopened, &FIRST, 1_700_000_120, 1_700_000_050).unwrap()
    );
}

#[test]
fn a_spent_secret_is_removed_only_after_its_invitation_has_expired() {
    let _serial_state = super::serial_state();
    let (_dir, conn) = upgraded_release_library();
    linked_devices::spend_secret(&conn, &FIRST, 1_700_000_120, 1_700_000_000).unwrap();

    // At the expiry second the invitation is still open, so its secret stays.
    assert!(linked_devices::spend_secret(&conn, &SECOND, 1_700_000_500, 1_700_000_120).unwrap());
    assert!(linked_devices::secret_spent(&conn, &FIRST).unwrap());

    // One second later it is past its expiry and the next record removes it.
    assert!(linked_devices::spend_secret(&conn, &THIRD, 1_700_000_500, 1_700_000_121).unwrap());
    assert!(!linked_devices::secret_spent(&conn, &FIRST).unwrap());
    assert!(linked_devices::secret_spent(&conn, &SECOND).unwrap());
}
