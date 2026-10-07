//! Which activities still owe a time stream is answered from SQLite alone.
//!
//! Scenario: a sync page holds the engine write lock while the section detail
//! screen mounts and asks which activities owe a stream.
//! Expected behaviour: the answer comes from the read pool while the writer
//! still holds the engine, and it is the same answer the engine's own method
//! gives.

use std::sync::Mutex;
use std::sync::mpsc;
use std::time::Duration;

use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::objects::activities::ActivityManager;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::with_persistent_engine;

/// A hang guard, not a budget: the writer lets go as soon as the read
/// returns, so only a read that waited for the writer reaches it.
const WRITER_HOLD_LIMIT: Duration = Duration::from_secs(30);

static SERIAL: Mutex<()> = Mutex::new(());

fn track(points: usize) -> Vec<GpsPoint> {
    (0..points)
        .map(|i| GpsPoint {
            latitude: 46.0 + i as f64 * 0.0002,
            longitude: 7.0,
            elevation: None,
        })
        .collect()
}

fn seeded_engine() -> (TempDir, Vec<String>) {
    let tmp = TempDir::new().expect("tempdir");
    let path = tmp.path().join("streams.db");
    assert!(persistent_engine_init(path.to_string_lossy().into_owned()));
    with_persistent_engine(|engine| {
        for id in ["no-stream", "long-stream", "matching-stream"] {
            engine
                .add_activity(id.to_string(), track(10), "Ride".to_string())
                .expect("store");
        }
        let ids = vec!["long-stream".to_string(), "matching-stream".to_string()];
        let long: Vec<u32> = (0..13).collect();
        let matching: Vec<u32> = (0..10).collect();
        let all: Vec<u32> = long.iter().chain(matching.iter()).copied().collect();
        engine.set_time_streams_flat(&ids, &all, &[0, 13]);
    });
    let ids = ["no-stream", "long-stream", "matching-stream"]
        .map(String::from)
        .to_vec();
    (tmp, ids)
}

#[test]
fn the_answer_does_not_wait_for_the_writer_and_matches_the_engine() {
    let _serial_state = crate::serial_state();
    let _serial = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
    let (_tmp, ids) = seeded_engine();
    let from_engine =
        with_persistent_engine(|e| e.get_activities_missing_time_streams(&ids)).expect("engine");

    let (held_tx, held_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel::<()>();
    let writer = std::thread::spawn(move || {
        with_persistent_engine(|_| {
            held_tx.send(()).expect("signal the hold");
            release_rx.recv_timeout(WRITER_HOLD_LIMIT).is_ok()
        })
    });
    held_rx.recv().expect("the writer took the engine");

    let pooled = ActivityManager::new().get_missing_time_streams(ids.clone());
    let _ = release_tx.send(());
    let released = writer.join().expect("writer");

    assert_eq!(
        released,
        Some(true),
        "the export waited for the writer, which held the engine until it gave up"
    );
    let mut pooled = pooled.expect("pool");
    pooled.sort();
    let mut expected = from_engine;
    expected.sort();
    assert_eq!(pooled, expected);
    assert_eq!(
        pooled,
        vec!["long-stream".to_string(), "no-stream".to_string()]
    );
}
