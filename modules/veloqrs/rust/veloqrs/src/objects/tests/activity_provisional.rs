use std::sync::atomic::Ordering;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use super::*;
use crate::test_globals::{
    init_global_engine, returns_while_locked, serial_global_state, wait_out_any_lock,
};

const ID: &str = "local-recording-r1";

fn body() -> crate::FfiActivityBody {
    crate::FfiActivityBody {
        activity_id: ID.into(),
        date: 1000.0,
        raw: r#"{"id":"local-recording-r1","name":"Ride","type":"Ride","distance":50,"moving_time":30,"elapsed_time":30}"#.into(),
    }
}

#[test]
fn test_save_provisional_busy_writer_does_not_hold_engine_lock() {
    let _serial = serial_global_state();
    let dir = init_global_engine("provisional_busy.db");
    let db = rusqlite::Connection::open(dir.path().join("provisional_busy.db")).unwrap();
    db.execute_batch("BEGIN IMMEDIATE").unwrap();
    wait_out_any_lock();
    let install = crate::persistence::engine_install();
    let refused_before = PROVISIONAL_BUSY_RETRIES.load(Ordering::SeqCst);
    let (saved_tx, saved_rx) = mpsc::channel();
    let save = std::thread::spawn(move || {
        saved_tx
            .send(save_provisional_for(
                install,
                ID,
                vec![46.0, 7.0, 46.001, 7.001],
                &body(),
            ))
            .unwrap();
    });
    let deadline = Instant::now() + Duration::from_secs(30);
    while PROVISIONAL_BUSY_RETRIES.load(Ordering::SeqCst) == refused_before {
        assert!(
            Instant::now() < deadline,
            "the save never met the held lock"
        );
        std::thread::sleep(Duration::from_millis(1));
    }
    assert!(matches!(
        saved_rx.try_recv(),
        Err(mpsc::TryRecvError::Empty)
    ));
    let prompt = returns_while_locked("a library read while the save retries", || {
        with_engine(|engine| engine.has_activity(ID))
    });
    db.execute_batch("ROLLBACK").unwrap();
    save.join().unwrap();
    assert!(!prompt.unwrap());
    assert!(saved_rx.recv().unwrap().is_ok());
    crate::with_persistent_engine(|engine| {
        let timeout: i64 = engine
            .db
            .query_row("PRAGMA busy_timeout", [], |row| row.get(0))
            .unwrap();
        assert_eq!(timeout, 5000);
    });
}
