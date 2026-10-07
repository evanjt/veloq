//! Veloqrs - Mobile FFI bindings for tracematch algorithms
//!
//! This crate provides:
//! - UniFFI bindings for iOS/Android
//! - SQLite persistence layer
//! - HTTP client for intervals.icu API

// Re-export algorithm types from tracematch (without UniFFI derives)
pub use tracematch::*;

// FFI-safe types with UniFFI derives
pub mod ffi_types;
pub use ffi_types::*;

// Persistence layer with SQLite storage
pub mod persistence;
pub use persistence::sections::{EvidenceRow, encode_evidence_row};
pub use persistence::{
    CacheUpdate, ExportPrivacyPreview, FitOutcome, GroupSummary, PERSISTENT_ENGINE,
    PersistentEngine, PersistentEngineStats, SectionDetectionHandle, mint_local_activity_id,
    with_persistent_engine,
};

// Shared process-wide async runtime for all outbound network work
pub mod runtime;

// Names for the pool and the workers, so a sampler can tell them apart
pub mod threads;

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
pub use objects::{
    FfiQuarantineReport, LibraryCoverage, RangeCoverage, VeloqEngine, VeloqError,
    take_quarantine_report,
};

// App-layer types that were moved out of tracematch (persistence/UI data containers)
pub mod types;
pub use types::*;

// Activity pattern detection via k-means clustering
pub mod patterns;

// The one three-way better/worse/same verdict every trend reads
pub mod trend;

/// The baseline, window and population behind a claim, and the floor below
/// which the claim is not drawn.
pub mod claim;

/// The absolute thresholds and polarities every surface draws a trend arrow
/// from, and the source `src/shared/format/trendTable.generated.ts` is written
/// from.
pub mod trend_table;

/// Pearson's r with the sample size and the interval that travel with it.
pub mod correlation;

/// How far a series' newest reading sits from its own baseline, in deviations.
pub mod signal;

/// The one sport taxonomy, three questions of an open sport string.
pub mod sport;

/// Figures computed from a stored stream, such as best-window vertical power.
pub mod metrics;

// FIT file parser for strength training exercise data
pub mod fit;

// Raster tile generation for activity heatmaps
pub mod tiles;

// Files written through a temp file and a rename
pub(crate) mod atomic_file;

// The Rust-owned basemap tile store: one z/x/y tree per source on disk
pub mod basemap;

// What an Android push handler with no JavaScript calls, over hand-written JNI
pub mod push;

// The enriched activity notification: one ladder and one set of templates for
// a native handler, for JavaScript and for the screen that shows the same line
pub mod notifications;

// The home-screen widget snapshot, one composer for the app and the push worker alike
pub mod widget_snapshot;
pub use notifications::FfiActivityNotification;

/// Captured log lines, for the tests that assert a path says something rather
/// than dropping silently. The logger is process-wide and the lib tests share
/// one process, so the buffer is never cleared: a test filters it for a
/// fragment only it produces.
#[cfg(test)]
pub(crate) mod test_log {
    use log::{Level, Log, Metadata, Record};
    use std::sync::{Mutex, OnceLock};

    static LINES: OnceLock<Mutex<Vec<(Level, String)>>> = OnceLock::new();

    fn lines() -> &'static Mutex<Vec<(Level, String)>> {
        LINES.get_or_init(|| Mutex::new(Vec::new()))
    }

    struct Capture;

    impl Log for Capture {
        fn enabled(&self, _: &Metadata) -> bool {
            true
        }
        fn log(&self, record: &Record) {
            lines()
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push((record.level(), record.args().to_string()));
        }
        fn flush(&self) {}
    }

    /// Install the capture. Idempotent: a second call keeps the first logger,
    /// which is what a parallel test run does.
    pub(crate) fn capturing() {
        let _ = log::set_boxed_logger(Box::new(Capture));
        log::set_max_level(log::LevelFilter::Trace);
    }

    /// Every warning captured so far carrying `fragment`.
    pub(crate) fn warnings_with(fragment: &str) -> Vec<String> {
        lines()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .filter(|(level, line)| *level <= Level::Warn && line.contains(fragment))
            .map(|(_, line)| line.clone())
            .collect()
    }

    pub(crate) fn errors_with(fragment: &str) -> Vec<String> {
        lines()
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .filter(|(level, line)| *level == Level::Error && line.contains(fragment))
            .map(|(_, line)| line.clone())
            .collect()
    }
}

/// Fixtures for the process-wide engine, detection handle and suspension
/// counter. They live at the crate root because tests in several modules race
/// the same globals and have to take the same lock to stay honest.
#[cfg(test)]
pub(crate) mod test_globals {
    use crate::objects::detection::{DetectionPoll, poll_detection_once};
    use crate::persistence::persistent_engine_ffi::persistent_engine_init;
    use crate::persistence::with_persistent_engine;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::{
        Arc, Barrier, Condvar, Mutex, MutexGuard, RwLock, RwLockReadGuard, RwLockWriteGuard,
    };
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
    static DETECTION_WORKERS: (Mutex<usize>, Condvar) = (Mutex::new(0), Condvar::new());

    static DETECTION_WORKERS_HELD: (Mutex<bool>, Condvar) = (Mutex::new(false), Condvar::new());

    pub(crate) struct DetectionWorkerGuard;

    impl DetectionWorkerGuard {
        /// Called first thing on the worker's own thread: wait there while a
        /// test holds detection workers, so the run can neither end nor free
        /// the slot until the test lets go.
        pub(crate) fn running(self) -> Self {
            let held = DETECTION_WORKERS_HELD
                .0
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            drop(
                DETECTION_WORKERS_HELD
                    .1
                    .wait_while(held, |held| *held)
                    .unwrap_or_else(|error| error.into_inner()),
            );
            self
        }
    }

    /// Lets detection workers run again when dropped, so a test that panics
    /// inside the hold does not leave the next test's workers waiting.
    pub(crate) struct DetectionWorkerHold;

    impl Drop for DetectionWorkerHold {
        fn drop(&mut self) {
            *DETECTION_WORKERS_HELD
                .0
                .lock()
                .unwrap_or_else(|error| error.into_inner()) = false;
            DETECTION_WORKERS_HELD.1.notify_all();
        }
    }

    /// Keep every detection worker spawned from now on at its start until the
    /// returned hold is dropped. A race of starts is then decided by the slot
    /// alone: a racer the scheduler kept back past the winner's whole run
    /// would otherwise find the slot free again and legitimately win too.
    pub(crate) fn hold_detection_workers() -> DetectionWorkerHold {
        *DETECTION_WORKERS_HELD
            .0
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = true;
        DetectionWorkerHold
    }

    pub(crate) fn detection_worker_started() -> DetectionWorkerGuard {
        let mut active = DETECTION_WORKERS
            .0
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        *active += 1;
        DetectionWorkerGuard
    }

    impl Drop for DetectionWorkerGuard {
        fn drop(&mut self) {
            let mut active = DETECTION_WORKERS
                .0
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            *active -= 1;
            DETECTION_WORKERS.1.notify_all();
        }
    }

    /// Wait until every detection worker has exited, which is after it has
    /// settled its run and is finished with the engine.
    pub(crate) fn wait_for_detection_workers() {
        let active = DETECTION_WORKERS
            .0
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let (active, wait) = DETECTION_WORKERS
            .1
            .wait_timeout_while(active, Duration::from_secs(120), |count| *count > 0)
            .unwrap_or_else(|error| error.into_inner());
        assert!(!wait.timed_out(), "a detection worker did not finish");
        drop(active);
        crate::objects::observer::flush();
    }

    /// The crate lock plus the record of who holds it.
    pub(crate) struct SerialGuard(
        #[allow(dead_code)] MutexGuard<'static, ()>,
        #[allow(dead_code)] RwLockWriteGuard<'static, ()>,
    );

    /// Whether `governor::pause` records a wait instead of sleeping it.
    static PAUSES_RECORDED: AtomicBool = AtomicBool::new(false);
    static PAUSED_NANOS: AtomicU64 = AtomicU64::new(0);

    /// Excludes tests that need the real clock from tests that hold the crate
    /// lock, which run with the clock's waits recorded and not slept.
    fn clock_mode() -> &'static RwLock<()> {
        static MODE: RwLock<()> = RwLock::new(());
        &MODE
    }

    /// Held by a test that asserts on the pace or the retry ladder it really
    /// waits, so no crate-lock test turns its sleeps into records meanwhile.
    pub(crate) fn real_clock() -> RwLockReadGuard<'static, ()> {
        clock_mode().read().unwrap_or_else(|e| e.into_inner())
    }

    /// Takes the wait for the recorder when a crate-lock test is running and
    /// reports whether it did.
    pub(crate) fn record_pause(wait: Duration) -> bool {
        if !PAUSES_RECORDED.load(Ordering::SeqCst) {
            return false;
        }
        PAUSED_NANOS.fetch_add(wait.as_nanos() as u64, Ordering::SeqCst);
        true
    }

    /// The total of every wait recorded since the crate lock was taken.
    pub(crate) fn recorded_pause() -> Duration {
        Duration::from_nanos(PAUSED_NANOS.load(Ordering::SeqCst))
    }

    impl Drop for SerialGuard {
        fn drop(&mut self) {
            PAUSES_RECORDED.store(false, Ordering::SeqCst);
            wait_for_detection_workers();
            crate::http::reset_download_queue();
            crate::net::connectivity::reset();
            crate::net::elevation_backfill::reset_pause();
            crate::objects::clear_test_credentials();
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
        let mode = clock_mode().write().unwrap_or_else(|e| e.into_inner());
        PAUSED_NANOS.store(0, Ordering::SeqCst);
        PAUSES_RECORDED.store(true, Ordering::SeqCst);
        drain_backfill();
        wait_for_detection_workers();
        clear_detection_handle();
        crate::http::reset_download_queue();
        crate::net::connectivity::reset();
        crate::net::elevation_backfill::reset_pause();
        crate::objects::clear_test_credentials();
        *SERIAL_HOLDER.lock().unwrap_or_else(|e| e.into_inner()) = Some(current().id());
        SerialGuard(guard, mode)
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
        // A driver from an earlier run polls the same slot every 250 ms and
        // applies whatever it finds. Emptying the slot is what ends it, but it
        // ends on its own next tick, and a run installed before then is one the
        // driver takes: it applies the result, records the outcome and leaves
        // this test's `last_outcome` reading complete before anything of its
        // own has polled. So the reset is not done until every driver has gone,
        // and no test has to remember to ask.
        wait_for_slot_drivers();
        // The outcome is the other half of "no run has happened here", and it
        // is a process-wide atomic. Leaving it standing let whichever test
        // cargo happened to run first decide whether the next one saw idle.
        crate::objects::detection::reset_last_outcome();
        // And the attempt key is the third: emptying the slot without settling
        // it leaves the next start reading `InFlight` for a run that is gone.
        // In production only the poll empties the slot and it settles the key
        // in the same breath; this helper is the one place that does not.
        crate::objects::detection::settle_detect(crate::persistence::attempts::Release::Done);
    }

    /// Wait until no detached driver is polling the shared detection slot.
    ///
    /// Three production paths spawn a thread that polls the slot and none of
    /// them is joined, so one from an earlier test is still running when the
    /// next starts and takes that run's completion. A test that has to be the
    /// only poller calls this after clearing the handle.
    pub(crate) fn wait_for_slot_drivers() {
        let deadline = Instant::now() + Duration::from_secs(60);
        while crate::objects::detection::slot_drivers() > 0 {
            assert!(
                Instant::now() < deadline,
                "a detached driver is still polling the detection slot after 60s"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
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

    /// Wait for a detached elevation pass to release its slot. The pass holds
    /// detection suspended for its whole life, and the counter is
    /// process-wide, so a test that started one and returned early would
    /// leave every start in the next test refused.
    pub(crate) fn drain_backfill() {
        let deadline = Instant::now() + Duration::from_secs(120);
        while crate::net::elevation_backfill::pass_running() {
            std::thread::sleep(Duration::from_millis(25));
            assert!(
                Instant::now() < deadline,
                "the backfill pass never finished"
            );
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

    /// How long a writer holding the engine waits for the read before it lets
    /// go. It is a hang guard and the only deadline: the writer is released
    /// when the read returns, so a read slowed by a busy machine still passes,
    /// and a read that waited for the writer returns only once this runs out.
    const WRITER_HOLD_LIMIT: Duration = Duration::from_secs(30);

    /// Run `read` while another thread holds the engine for writing, and
    /// return what it read. Fails when the read could not finish until the
    /// writer let go.
    pub(crate) fn read_while_writer_holds<T>(read: impl FnOnce() -> T) -> T {
        read_while_writer_holds_up_to(WRITER_HOLD_LIMIT, read)
    }

    /// Lets the writer go when dropped, so a read that panics does not leave
    /// the engine held for the next test.
    struct Release(std::sync::mpsc::Sender<()>);

    impl Drop for Release {
        fn drop(&mut self) {
            let _ = self.0.send(());
        }
    }

    fn read_while_writer_holds_up_to<T>(limit: Duration, read: impl FnOnce() -> T) -> T {
        let (held_tx, held_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let writer = std::thread::spawn(move || {
            with_persistent_engine(|_| {
                held_tx.send(()).expect("signal the hold");
                release_rx.recv_timeout(limit).is_ok()
            })
        });
        held_rx.recv().expect("the writer took the engine");
        let release = Release(release_tx);
        let result = read();
        drop(release);
        let released = writer.join().expect("writer");
        assert_eq!(
            released,
            Some(true),
            "the read waited for the writer, which held the engine until it gave up after {limit:?}"
        );
        result
    }

    /// Make the engine's connection wait on SQLite's write lock for an hour.
    ///
    /// A test that holds the lock on a connection of its own until its read
    /// returns can then tell a read that never waited on the lock from one
    /// that waited and gave up when the five-second busy timeout ran out:
    /// the second now waits for as long as the lock is held, and fails at
    /// [`returns_while_locked`]'s hang guard. Production code that sets its
    /// own timeout for a statement restores five seconds after it, which is
    /// what the engine opens with.
    pub(crate) fn wait_out_any_lock() {
        with_persistent_engine(|engine| engine.db.busy_timeout(Duration::from_secs(3600)))
            .expect("engine")
            .expect("busy timeout");
    }

    /// Run `read` while the caller holds SQLite's write lock, and hand back
    /// what it returned. The caller lets go once this returns, so a read
    /// slowed by a busy machine still passes, and only a read that waited on
    /// the lock fails, after [`WRITER_HOLD_LIMIT`]. Call
    /// [`wait_out_any_lock`] first, or a read that waited out the busy
    /// timeout passes too.
    pub(crate) fn returns_while_locked<T: Send + 'static>(
        what: &str,
        read: impl FnOnce() -> T + Send + 'static,
    ) -> T {
        returns_within(WRITER_HOLD_LIMIT, what, read)
    }

    /// Run `body` on its own thread and hand back what it returns, failing if
    /// it is still running after `guard`. The guard is a hang detector, set
    /// below the wait the test exists to rule out, never against how fast the
    /// body should be: a body slowed by a busy machine still passes. The
    /// body's own panic comes through unchanged.
    pub(crate) fn returns_within<T: Send + 'static>(
        guard: Duration,
        what: &str,
        body: impl FnOnce() -> T + Send + 'static,
    ) -> T {
        let (tx, rx) = std::sync::mpsc::channel();
        let runner = std::thread::spawn(move || {
            let _ = tx.send(body());
        });
        match rx.recv_timeout(guard) {
            Ok(value) => {
                runner.join().expect("runner");
                value
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                std::panic::resume_unwind(runner.join().expect_err("the body panicked"))
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                panic!("{what} was still running after {guard:?}")
            }
        }
    }

    /// Scenario: a read that takes the engine lock, and one that never does
    /// but is slow because the machine is busy.
    ///
    /// Expected behaviour: the first is caught waiting for the writer, the
    /// second is not, whatever the load.
    #[test]
    fn a_read_that_takes_the_engine_is_caught_waiting_for_the_writer() {
        let _serial = serial_global_state();
        let _tmp = init_global_engine("read_takes_the_engine.db");
        let caught = std::panic::catch_unwind(|| {
            read_while_writer_holds_up_to(Duration::from_millis(500), || {
                with_persistent_engine(|_| ())
            })
        });
        assert!(caught.is_err(), "a read behind the writer passed");
    }

    #[test]
    fn a_slow_read_that_never_takes_the_engine_is_not_a_wait() {
        let _serial = serial_global_state();
        let _tmp = init_global_engine("slow_read_under_load.db");
        let answer = read_while_writer_holds(|| {
            std::thread::sleep(Duration::from_millis(150));
            7
        });
        assert_eq!(answer, 7);
    }
}

#[cfg(test)]
#[path = "tests/global_state.rs"]
mod global_state_tests;

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

pub(crate) fn ffi_refuse_on_panic<T>(
    boundary: &'static str,
    refusal: T,
    call: impl FnOnce() -> T,
) -> T {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(call)) {
        Ok(answer) => answer,
        Err(_) => {
            log::error!("[ffi] {boundary} panicked");
            refusal
        }
    }
}

#[cfg(test)]
mod ffi_panic_tests {
    use super::ffi_refuse_on_panic;
    use super::test_log;

    #[test]
    fn test_ffi_refusal_recovers_from_panic_and_accepts_next_call() {
        test_log::capturing();
        assert!(!ffi_refuse_on_panic("push prepare", false, || panic!(
            "engine panic"
        )));
        assert!(ffi_refuse_on_panic("push prepare", false, || true));
        assert!(
            ffi_refuse_on_panic("tile fetch", std::ptr::null_mut::<u8>(), || {
                panic!("tile panic")
            })
            .is_null()
        );
        assert_eq!(
            test_log::errors_with("[ffi] push prepare panicked").len(),
            1
        );
        assert_eq!(test_log::errors_with("[ffi] tile fetch panicked").len(), 1);
    }
}

/// Seven call sites reach for the logger and only the first one may set it.
#[cfg(any(target_os = "android", target_os = "ios"))]
static LOGGING_INIT: std::sync::Once = std::sync::Once::new();

/// A debug build keeps the running commentary; a device gets `Warn` and above.
///
/// The device half is not a choice about noise, it is what every build is: the
/// `.so` is compiled `--release` for every APK variant, so `debug_assertions`
/// is off on a handset whatever the app was built as. Nothing is compiled out,
/// either. The `log` crate drops a level at compile time only under its
/// `release_max_level_*` features and this crate sets none, so every `info!`
/// is in the binary and filtered at runtime. What that means in practice: a
/// line that says why a job refused to start has to be `warn!`, or nobody with
/// the phone in hand can read it. `scripts/lint-decline-visible.mjs` holds the
/// sites that answer that question to it.
#[cfg(any(target_os = "android", target_os = "ios"))]
fn log_level() -> log::LevelFilter {
    if cfg!(debug_assertions) {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Warn
    }
}

/// Initialise logging for Android
#[cfg(target_os = "android")]
pub(crate) fn init_logging() {
    use android_logger::Config;

    LOGGING_INIT.call_once(|| {
        android_logger::init_once(
            Config::default()
                .with_max_level(log_level())
                .with_tag("veloqrs"),
        );
    });
}

/// Initialise logging for iOS (Apple unified logging / os_log)
#[cfg(target_os = "ios")]
pub(crate) fn init_logging() {
    LOGGING_INIT.call_once(|| {
        oslog::OsLogger::new("com.veloq.app.rust")
            .level_filter(log_level())
            .init()
            .ok();
    });
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub(crate) fn init_logging() {
    // No-op on other platforms (desktop, tests)
}
