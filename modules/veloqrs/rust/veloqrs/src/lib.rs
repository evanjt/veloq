//! Veloqrs - Mobile FFI bindings for tracematch algorithms
//!
//! This crate provides:
//! - UniFFI bindings for iOS/Android
//! - SQLite persistence layer
//! - HTTP client for intervals.icu API

// Re-export algorithm types from tracematch (without UniFFI derives)
pub use tracematch::*;

// Delta+varint coordinate encoding for compact FFI transfer
pub mod coords;

// FFI-safe types with UniFFI derives
pub mod ffi_types;
pub use ffi_types::*;

// Persistence layer with SQLite storage
pub mod persistence;
pub use persistence::{
    CacheUpdate, FitOutcome, GroupSummary, PERSISTENT_ENGINE, PersistentEngineStats,
    PersistentRouteEngine, SectionDetectionHandle, with_persistent_engine,
};

// Shared process-wide async runtime for all outbound network work
pub mod runtime;

// Networking governor: the single choke point for outbound requests
pub mod governor;

// Consolidated intervals.icu networking: transport + endpoint fetchers
pub mod net;

// HTTP client for activity fetching
pub mod http;
pub use http::{ActivityFetcher, ActivityMapResult};

// FFI bindings for mobile platforms
pub mod ffi;

// Unified sections module
pub mod sections;
pub use sections::SectionSummary;

// Domain objects (UniFFI Object API)
pub mod objects;
pub use objects::{VeloqEngine, VeloqError};

// App-layer types that were moved out of tracematch (persistence/UI data containers)
pub mod types;
pub use types::*;

// Activity pattern detection via k-means clustering
pub mod patterns;

// FIT file parser for strength training exercise data
pub mod fit;

// Raster tile generation for activity heatmaps
pub mod tiles;

/// Fixtures for the process-wide engine, detection handle and suspension
/// counter. They live at the crate root because tests in several modules race
/// the same globals and have to take the same lock to stay honest.
#[cfg(test)]
pub(crate) mod test_globals {
    use crate::objects::detection::{DetectionPoll, poll_detection_once};
    use crate::persistence::persistent_engine_ffi::persistent_engine_init;
    use crate::persistence::with_persistent_engine;
    use std::sync::{Arc, Barrier, Mutex, MutexGuard};
    use std::thread::{ThreadId, current};
    use std::time::{Duration, Instant};
    use tempfile::TempDir;
    use tracematch::GpsPoint;

    /// Threads released together at a start, enough that a blind install
    /// overwrites more than once.
    pub(crate) const RACERS: usize = 4;

    /// Who holds the crate lock, so a fixture can refuse to swap the engine
    /// out from under whoever does. A second private lock in another test
    /// module let two tests own `PERSISTENT_ENGINE` at once, and the one that
    /// finished first deleted its TempDir under the other's detection worker.
    static SERIAL_HOLDER: Mutex<Option<ThreadId>> = Mutex::new(None);

    /// The crate lock plus the record of who holds it.
    pub(crate) struct SerialGuard(#[allow(dead_code)] MutexGuard<'static, ()>);

    impl Drop for SerialGuard {
        fn drop(&mut self) {
            *SERIAL_HOLDER.lock().unwrap_or_else(|e| e.into_inner()) = None;
        }
    }

    /// One lock for the whole crate: the engine, the detection handle and the
    /// suspension counter are process-wide, so these tests run one at a time.
    /// Every test that points `PERSISTENT_ENGINE` at its own database takes
    /// this one, never a private mutex of its own.
    pub(crate) fn serial_global_state() -> SerialGuard {
        static SERIAL: Mutex<()> = Mutex::new(());
        let guard = SERIAL.lock().unwrap_or_else(|e| e.into_inner());
        *SERIAL_HOLDER.lock().unwrap_or_else(|e| e.into_inner()) = Some(current().id());
        SerialGuard(guard)
    }

    fn assert_serial_held() {
        let holder = *SERIAL_HOLDER.lock().unwrap_or_else(|e| e.into_inner());
        assert_eq!(
            holder,
            Some(current().id()),
            "a fixture pointed the process-wide engine at a new database without \
             holding serial_global_state(). Another test's engine, detection handle \
             and TempDir are live while this one runs, and whichever finishes first \
             deletes the database the other is still writing to."
        );
    }

    /// Point the process-wide engine at an empty database in a fresh TempDir.
    /// The directory lives as long as the returned handle, so the caller has
    /// to hold it for the whole test.
    pub(crate) fn init_global_engine(file_name: &str) -> TempDir {
        assert_serial_held();
        let tmp = TempDir::new().expect("tempdir");
        let db_path = tmp.path().join(file_name);
        assert!(
            persistent_engine_init(db_path.to_string_lossy().into_owned()),
            "the fixture database must open"
        );
        tmp
    }

    fn track(seed: f64) -> Vec<GpsPoint> {
        (0..8)
            .map(|i| GpsPoint::new(46.2 + seed + f64::from(i) * 0.001, 7.35 + seed))
            .collect()
    }

    /// A global engine holding unprocessed activities, so a start reaches the
    /// spawn rather than the no-new-activities short circuit.
    pub(crate) fn seeded_global_engine() -> TempDir {
        let tmp = init_global_engine("detection.db");
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
        tmp
    }

    pub(crate) fn clear_detection_handle() {
        *crate::persistence::persistent_engine_ffi::SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = None;
    }

    /// Drive the winning run to its end so the worker is finished with the
    /// database before the fixture directory goes away.
    pub(crate) fn drain_detection() {
        let deadline = Instant::now() + Duration::from_secs(120);
        loop {
            match poll_detection_once() {
                Ok(DetectionPoll::Idle) => return,
                Ok(_) => std::thread::sleep(Duration::from_millis(25)),
                Err(e) => panic!("drain failed: {:?}", e),
            }
            assert!(Instant::now() < deadline, "detection never went idle");
        }
    }

    /// Run `start` on `RACERS` threads released together and report how many
    /// claimed to have started.
    pub(crate) fn race<F>(start: F) -> usize
    where
        F: Fn() -> bool + Send + Sync + 'static,
    {
        let barrier = Arc::new(Barrier::new(RACERS));
        let start = Arc::new(start);
        let racers: Vec<_> = (0..RACERS)
            .map(|_| {
                let barrier = Arc::clone(&barrier);
                let start = Arc::clone(&start);
                std::thread::spawn(move || {
                    barrier.wait();
                    start()
                })
            })
            .collect();
        racers
            .into_iter()
            .map(|r| r.join().expect("racer thread"))
            .filter(|started| *started)
            .count()
    }
}

/// Helper to calculate elapsed milliseconds from an Instant
#[inline]
pub(crate) fn elapsed_ms(start: std::time::Instant) -> u64 {
    start.elapsed().as_millis() as u64
}

/// Calendar-day difference in UTC. Returns 0 for same UTC day, 1 for adjacent days, etc.
/// Uses div_euclid to correctly handle negative timestamps (pre-epoch).
#[inline]
pub(crate) fn calendar_days_between(earlier: i64, later: i64) -> u32 {
    let day_earlier = earlier.div_euclid(86400);
    let day_later = later.div_euclid(86400);
    (day_later - day_earlier).max(0) as u32
}

uniffi::setup_scaffolding!();

/// Initialize logging for Android
#[cfg(target_os = "android")]
pub(crate) fn init_logging() {
    use android_logger::Config;
    use log::LevelFilter;

    android_logger::init_once(
        Config::default()
            .with_max_level(LevelFilter::Debug)
            .with_tag("veloqrs"),
    );
}

/// Initialize logging for iOS (Apple unified logging / os_log)
#[cfg(target_os = "ios")]
pub(crate) fn init_logging() {
    use log::LevelFilter;

    oslog::OsLogger::new("com.veloq.app.rust")
        .level_filter(LevelFilter::Debug)
        .init()
        .ok(); // ok() ignores AlreadyInitialized error on repeated calls
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) fn init_logging() {
    // No-op on other platforms (desktop, tests)
}
