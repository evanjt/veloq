//! How often a write made under the engine lock waits on SQLite's write lock
//! while a detection run writes over its own connection, and for how long.
//!
//! A write under the engine lock that finds another connection holding the
//! database write lock waits in SQLite's busy handler, up to the connection's
//! busy timeout, and every other engine call queues behind it for as long. The
//! detection worker is the in-process writer on a connection of its own: it
//! saves the regrouped routes and records the pool's integrity there, while
//! its apply goes through the engine lock.
//!
//! A probe thread stands in for a tap: one settings write every millisecond,
//! timed twice. The outer time is the whole call, which includes queueing for
//! the engine lock behind the apply. The inner time is the write alone, taken
//! once the engine lock is held, so anything over the quiet baseline is a wait
//! on another connection's write lock. Over a 550 and a 2,000-activity library
//! it times three runs: the first detect, which groups every route, the detect
//! a sync of three rides starts, and a forced re-detect.
//!
//! Baseline only, nothing asserts. Run in release:
//!   cargo test --release --features synthetic --bench worker_write_overlap -- --ignored --nocapture --test-threads=1

#![cfg(feature = "synthetic")]

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use tempfile::TempDir;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentEngine;
use veloqrs::objects::DetectionManager;
use veloqrs::objects::observer::{EngineObserver, set_observer};
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::with_persistent_engine;

/// The pause between two probe writes.
const PROBE_GAP: Duration = Duration::from_millis(1);
/// An inner write slower than this waited on another connection. The quiet
/// baseline printed beside it shows the margin.
const WAITED: Duration = Duration::from_millis(2);
const PROBE_KEY: &str = "overlapProbe";

struct Applied(AtomicUsize);

impl EngineObserver for Applied {
    fn sync_progress(&self) {}
    fn sync_settled(&self) {}
    fn activities_stored(&self) {}
    fn body_stored(&self, _kind: String, _activity_id: String) {}
    fn time_streams_stored(&self, _activity_ids: Vec<String>) {}
    fn gps_track_stored(&self, _activity_id: String) {}
    fn gps_tracks_mutated(&self, _activity_ids: Vec<String>) {}
    fn fit_parsed(&self, _activity_id: String) {}
    fn detection_applied(&self) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
    fn tiles_generated(&self) {}
    fn backfill_phase(&self, _phase: String) {}
    fn stream_backfill_phase(&self, _phase: String) {}
    fn cutover_settled(&self) {}
    fn preview_phase(&self, _phase: String) {}
    fn preview_finished(&self) {}
    fn recordings_changed(&self) {}
    fn upload_permission_refused(&self) {}
}

fn ingest(activities: &[&LifecycleActivity]) {
    with_persistent_engine(|engine| {
        for chunk in activities.chunks(50) {
            let rows = chunk
                .iter()
                .map(|a| (a.id.clone(), a.gps_points.clone(), a.sport_type.clone()))
                .collect();
            engine.add_activities_batch(rows).expect("ingest");
        }
        for a in activities {
            engine
                .update_activity_metadata(&a.id, Some(a.start_date_unix), None, None, None)
                .expect("metadata");
        }
    })
    .expect("engine installed");
}

/// Outer and inner time of one probe write, in microseconds.
fn probe_write(n: usize) -> (u128, u128) {
    let started = Instant::now();
    let inner = with_persistent_engine(|engine| {
        let held = Instant::now();
        engine
            .set_setting(PROBE_KEY, &n.to_string())
            .expect("probe write");
        held.elapsed().as_micros()
    })
    .expect("engine installed");
    (started.elapsed().as_micros(), inner)
}

fn percentile(samples: &mut [u128], q: f64) -> u128 {
    if samples.is_empty() {
        return 0;
    }
    samples.sort_unstable();
    samples[((samples.len() as f64 - 1.0) * q).round() as usize]
}

fn report(label: &str, wall: Duration, samples: &[(u128, u128)]) {
    let mut outer: Vec<u128> = samples.iter().map(|s| s.0).collect();
    let mut inner: Vec<u128> = samples.iter().map(|s| s.1).collect();
    let waited: Vec<u128> = inner
        .iter()
        .copied()
        .filter(|&us| us >= WAITED.as_micros())
        .collect();
    let waited_total: u128 = waited.iter().sum();
    println!(
        "{label}: wall {:.0} ms, {} probes; inner p50 {} us p99 {} us max {} us; \
         {} waited on another connection, {:.1} ms in total; outer p50 {} us p99 {} us max {} us",
        wall.as_secs_f64() * 1e3,
        samples.len(),
        percentile(&mut inner, 0.5),
        percentile(&mut inner, 0.99),
        percentile(&mut inner, 1.0),
        waited.len(),
        waited_total as f64 / 1e3,
        percentile(&mut outer, 0.5),
        percentile(&mut outer, 0.99),
        percentile(&mut outer, 1.0),
    );
    let mut long: Vec<u128> = waited;
    long.sort_unstable_by(|a, b| b.cmp(a));
    long.truncate(10);
    if !long.is_empty() {
        println!("  longest inner waits, us: {long:?}");
    }
}

fn probe_while(done: &AtomicBool) -> Vec<(u128, u128)> {
    let mut samples = Vec::new();
    let mut n = 0;
    while !done.load(Ordering::SeqCst) {
        n += 1;
        samples.push(probe_write(n));
        thread::sleep(PROBE_GAP);
    }
    samples
}

fn detect_under_probe(label: &str, applied: &Arc<Applied>, force: bool) {
    let before = applied.0.load(Ordering::SeqCst);
    let done = Arc::new(AtomicBool::new(false));
    let prober = {
        let done = Arc::clone(&done);
        thread::spawn(move || probe_while(&done))
    };
    let started = Instant::now();
    let detection = DetectionManager::new();
    let start = if force {
        detection.force_redetect()
    } else {
        detection.start()
    };
    assert!(start.expect("start").started(), "{label}: the run started");
    let deadline = started + Duration::from_secs(600);
    while applied.0.load(Ordering::SeqCst) == before {
        assert!(Instant::now() < deadline, "{label}: the run never ended");
        thread::sleep(Duration::from_millis(5));
    }
    let wall = started.elapsed();
    done.store(true, Ordering::SeqCst);
    let samples = prober.join().expect("prober");
    assert_eq!(detection.poll().expect("poll"), "complete", "{label}");
    report(label, wall, &samples);
}

/// A pushed ride indexed by a second engine over the same file, which is what
/// the iOS notification extension does from its own process while the app may
/// be open: the extension's writes take the database write lock on a
/// connection the app's engine lock does not cover.
fn index_from_a_second_engine(path: &str, ride: &LifecycleActivity) {
    let done = Arc::new(AtomicBool::new(false));
    let prober = {
        let done = Arc::clone(&done);
        thread::spawn(move || probe_while(&done))
    };
    let started = Instant::now();
    let mut extension = PersistentEngine::new(path).expect("second engine");
    let opened = started.elapsed();
    let id = format!("{}_pushed", ride.id);
    extension
        .add_activity(id.clone(), ride.gps_points.clone(), ride.sport_type.clone())
        .expect("store the pushed ride");
    extension
        .update_activity_metadata(&id, Some(ride.start_date_unix + 86_400), None, None, None)
        .expect("metadata");
    let summary = extension.index_new_activity(&id).expect("index");
    let wall = started.elapsed();
    done.store(true, Ordering::SeqCst);
    let samples = prober.join().expect("prober");
    println!(
        "  second engine: open {:.0} ms, {} sections matched, regrouped {}",
        opened.as_secs_f64() * 1e3,
        summary.matched_sections,
        summary.regrouped
    );
    report("a pushed ride indexed by a second engine", wall, &samples);
}

/// Detect under the probe over a library of `year_expansion` plus the
/// corpus's 151 earlier activities, then a sync of three rides and a forced
/// re-detect. `RUST_LOG=info` prints the worker's own grouping times.
fn settings_writes_against_the_detection_worker(year_expansion: usize) {
    let _ = env_logger::builder().is_test(true).try_init();
    let corpus = LifecycleCorpus::generate(&LifecycleConfig {
        bucket_e_delta_count: year_expansion,
        ..LifecycleConfig::default()
    });
    let synced: Vec<&LifecycleActivity> = corpus.bucket_d_delta.iter().collect();
    let library: Vec<&LifecycleActivity> = corpus
        .through_e()
        .into_iter()
        .filter(|a| !corpus.bucket_d_delta.iter().any(|d| d.id == a.id))
        .collect();

    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("overlap.db");
    assert!(persistent_engine_init(path.to_str().unwrap().to_string()));
    let applied = Arc::new(Applied(AtomicUsize::new(0)));
    set_observer(Some(applied.clone()));

    ingest(&library);
    println!("library: {} activities", library.len());

    let quiet_started = Instant::now();
    let quiet: Vec<(u128, u128)> = (0..2_000).map(probe_write).collect();
    report("quiet", quiet_started.elapsed(), &quiet);

    detect_under_probe("first detect, full grouping", &applied, false);
    let groups = with_persistent_engine(|e| e.get_groups().len()).unwrap();
    println!("  route groups: {groups}");

    ingest(&synced);
    detect_under_probe("detect after a sync of three rides", &applied, false);

    detect_under_probe("forced re-detect", &applied, true);

    index_from_a_second_engine(path.to_str().unwrap(), &corpus.bucket_d_delta[0]);

    set_observer(None);
}

#[test]
#[ignore]
fn a_library_of_550() {
    settings_writes_against_the_detection_worker(396);
}

#[test]
#[ignore]
fn a_library_of_2000() {
    settings_writes_against_the_detection_worker(1_846);
}
