//! Scenario: a regroup that puts every route in scope, a first grouping and a
//! strictness change, measured on the private corpus.
//! Expected behaviour: a report of how far the process's resident memory and
//! the live heap rise while the match percentages are measured, read at each
//! phase boundary the regroup logs. This is a measuring instrument: it asserts
//! only that the regroup ran at full scope.
//!
//! Run: `cargo test --release -p veloqrs --features real-corpus --test match_measurement_residency -- --nocapture`
//!
//! Nothing here prints a coordinate, an activity id or a corpus directory.

#![cfg(feature = "real-corpus")]

mod cost_band_support;

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering::Relaxed};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use cost_band_support::{baseline, corpus};
use tempfile::TempDir;
use veloqrs::PersistentEngine;

const CORPUS: &str = "fullcorpus";

/// Resident set of this process, in bytes, from the kernel.
fn rss_bytes() -> u64 {
    let status = std::fs::read_to_string("/proc/self/status").unwrap_or_default();
    status
        .lines()
        .find_map(|l| l.strip_prefix("VmRSS:"))
        .and_then(|v| v.trim().trim_end_matches("kB").trim().parse::<u64>().ok())
        .map(|kb| kb * 1024)
        .unwrap_or(0)
}

fn mib(bytes: u64) -> f64 {
    bytes as f64 / (1024.0 * 1024.0)
}

/// Samples the resident set on its own thread and keeps the highest reading.
struct RssSampler {
    stop: Arc<AtomicBool>,
    peak: Arc<AtomicU64>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl RssSampler {
    fn start() -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let peak = Arc::new(AtomicU64::new(rss_bytes()));
        let handle = {
            let (stop, peak) = (Arc::clone(&stop), Arc::clone(&peak));
            std::thread::spawn(move || {
                while !stop.load(Relaxed) {
                    peak.fetch_max(rss_bytes(), Relaxed);
                    std::thread::sleep(Duration::from_millis(1));
                }
            })
        };
        Self {
            stop,
            peak,
            handle: Some(handle),
        }
    }

    fn finish(mut self) -> u64 {
        self.stop.store(true, Relaxed);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
        self.peak.load(Relaxed)
    }
}

/// Records every `[PERF]` log line with the resident set and the live heap
/// peak at the moment it was written, so each phase boundary has a reading.
struct PhaseLog {
    started: Instant,
    rows: Mutex<Vec<(u128, u64, u64, String)>>,
}

impl log::Log for PhaseLog {
    fn enabled(&self, _: &log::Metadata) -> bool {
        true
    }
    fn log(&self, record: &log::Record) {
        let text = record.args().to_string();
        if text.contains("PERF") || text.contains("Phase") {
            self.rows.lock().unwrap().push((
                self.started.elapsed().as_millis(),
                rss_bytes(),
                baseline::peak_bytes(),
                text,
            ));
        }
    }
    fn flush(&self) {}
}

static PHASES: std::sync::OnceLock<&'static PhaseLog> = std::sync::OnceLock::new();

fn install_phase_log() -> &'static PhaseLog {
    PHASES.get_or_init(|| {
        let leaked: &'static PhaseLog = Box::leak(Box::new(PhaseLog {
            started: Instant::now(),
            rows: Mutex::new(Vec::new()),
        }));
        log::set_logger(leaked).expect("logger");
        log::set_max_level(log::LevelFilter::Info);
        leaked
    })
}

fn report(label: &str, phases: &PhaseLog, rss_before: u64, rss_peak: u64, heap_rise: u64) {
    println!("\n== {label} ==");
    println!("rss before          {:>8.1} MiB", mib(rss_before));
    println!("rss peak            {:>8.1} MiB", mib(rss_peak));
    println!(
        "rss rise            {:>8.1} MiB",
        mib(rss_peak.saturating_sub(rss_before))
    );
    println!("live heap rise      {:>8.1} MiB", mib(heap_rise));
    println!("phase boundaries (ms, rss MiB, heap peak MiB):");
    let rows = std::mem::take(&mut *phases.rows.lock().unwrap());
    for (ms, rss, heap, text) in rows {
        println!("  {ms:>7}  {:>8.1}  {:>8.1}  {text}", mib(rss), mib(heap));
    }
}

/// Settle the allocator and the kernel's view of it before a reading: the
/// pages the corpus load freed go back to the kernel, so the resident set
/// that follows is the regroup's own and not a reuse of what was retained.
fn quiesce() {
    // SAFETY: malloc_trim takes no pointer and touches only the allocator's
    // free lists.
    unsafe {
        libc::malloc_trim(0);
    }
    std::thread::sleep(Duration::from_millis(200));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn full_scope_regroup_residency_on_the_private_corpus() {
    let phases = install_phase_log();

    let (tracks, starts, _) = corpus::load_tracks(CORPUS, 1000);
    let activities = tracks.len();
    let points: usize = tracks.iter().map(|(_, t)| t.len()).sum();

    let dir = TempDir::new().expect("tempdir");
    let mut engine =
        PersistentEngine::new(dir.path().join("residency.db").to_str().unwrap()).expect("engine");
    for (id, track) in &tracks {
        engine
            .add_activity(id.clone(), track.clone(), "Ride".to_string())
            .expect("add_activity");
        engine
            .update_activity_metadata(id, starts.get(id).copied(), None, None, None)
            .expect("update_activity_metadata");
    }
    drop(tracks);
    println!(
        "corpus: {activities} activities, {points} points, {:.0} points a track",
        points as f64 / activities as f64
    );
    phases.rows.lock().unwrap().clear();

    // The first grouping: every group is owed, so the whole library is in scope.
    assert!(engine.groups_are_dirty(), "a fresh library owes a grouping");
    quiesce();
    let rss_before = rss_bytes();
    let sampler = RssSampler::start();
    let window = baseline::anchor_peak();
    let group_count = engine.get_groups().len();
    let heap_rise = window.rise_bytes();
    drop(window);
    let rss_peak = sampler.finish();
    let groups = engine.get_groups().to_vec();
    let with_members = groups.iter().filter(|g| g.activity_ids.len() >= 2).count();
    let largest = groups
        .iter()
        .map(|g| g.activity_ids.len())
        .max()
        .unwrap_or(0);
    println!(
        "groups: {group_count}, {with_members} with two or more members, largest {largest} members"
    );
    report("first grouping", phases, rss_before, rss_peak, heap_rise);
    assert!(group_count > 0);

    // A strictness change: the rule stamp differs, so no previous group counts
    // and every group is owed again.
    let (min_pct, endpoint) = engine.match_strictness();
    engine.set_match_strictness(min_pct + 1.0, endpoint);
    assert!(
        engine.groups_are_dirty(),
        "a strictness change owes a regroup"
    );
    quiesce();
    let rss_before = rss_bytes();
    let sampler = RssSampler::start();
    let window = baseline::anchor_peak();
    let regrouped = engine.get_groups().len();
    let heap_rise = window.rise_bytes();
    drop(window);
    let rss_peak = sampler.finish();
    report("strictness change", phases, rss_before, rss_peak, heap_rise);
    assert!(regrouped > 0);
}
