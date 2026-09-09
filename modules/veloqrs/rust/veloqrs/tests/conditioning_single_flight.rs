//! Conditioning starts are single-flight.
//!
//! Scenario: several ingest threads reach the conditioning cadence at the same
//! instant. Only one detection worker may exist, because each worker opens its
//! own connection and rewrites `route_groups` wholesale while holding the full
//! track pool resident.
//!
//! Runs against the process-global engine, exactly like production.

use std::sync::{Arc, Barrier};
use std::time::{Duration, Instant};
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::persistence::persistent_engine_ffi::{
    SECTION_DETECTION_HANDLE, persistent_engine_init,
};
use veloqrs::persistence::sections::conditioning::try_start_conditioning;
use veloqrs::persistence::sections::detection_workers_started;
use veloqrs::persistence::with_persistent_engine;

const RACERS: usize = 4;

fn track(seed: f64) -> Vec<GpsPoint> {
    (0..8)
        .map(|i| GpsPoint::new(46.2 + seed + f64::from(i) * 0.001, 7.35 + seed))
        .collect()
}

fn seeded_engine() -> TempDir {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    assert!(persistent_engine_init(
        path.to_str().expect("utf-8 path").to_string()
    ));
    with_persistent_engine(|engine| {
        for i in 0..6 {
            let id = format!("a{}", i);
            engine
                .add_activity(id.clone(), track(f64::from(i) * 0.05), "Ride".into())
                .expect("add activity");
            engine
                .update_activity_metadata(
                    &id,
                    Some(1_700_000_000 - i64::from(i) * 86_400),
                    Some("ride"),
                    Some(12_345.0),
                    Some(3_600),
                )
                .expect("metadata");
        }
    })
    .expect("engine");
    dir
}

/// Wait for the winning run to apply and release the slot, so the worker is
/// finished with the database before the temp directory goes away.
fn drain_detection() {
    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        let busy = SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_some();
        if !busy {
            return;
        }
        assert!(Instant::now() < deadline, "detection never went idle");
        std::thread::sleep(Duration::from_millis(50));
    }
}

#[test]
fn concurrent_conditioning_starts_spawn_exactly_one_worker() {
    let _dir = seeded_engine();
    let before = detection_workers_started();

    let barrier = Arc::new(Barrier::new(RACERS));
    let racers: Vec<_> = (0..RACERS)
        .map(|_| {
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                barrier.wait();
                try_start_conditioning()
            })
        })
        .collect();

    let won = racers
        .into_iter()
        .map(|r| r.join().expect("racer thread"))
        .filter(|started| *started)
        .count();

    assert_eq!(won, 1, "exactly one start may win the race");
    assert_eq!(
        detection_workers_started() - before,
        1,
        "a losing start must not leave an orphan worker behind"
    );

    drain_detection();
}
