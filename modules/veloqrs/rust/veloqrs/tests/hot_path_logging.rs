//! Scenario: the engine's read paths log a line per section and a line per
//! call, and every line is a write to the platform log from inside the lock
//! hold it describes. On a real library that is thousands of lines in the
//! seconds after launch, paid for on the JS thread.
//!
//! Expected behaviour: a per-call or per-section line is `trace`, so it is
//! there for someone debugging and costs nothing otherwise. These assertions
//! are about the level, not about the wording.

#![cfg(feature = "synthetic")]

use log::{Level, Log, Metadata, Record};
use std::sync::{Mutex, OnceLock};
use tempfile::TempDir;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::{ActivityMetrics, PersistentEngine};

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

fn start_capturing() {
    let _ = log::set_boxed_logger(Box::new(Capture));
    log::set_max_level(log::LevelFilter::Trace);
    lines().lock().unwrap_or_else(|e| e.into_inner()).clear();
}

/// Every captured line at `Info` or louder, which is what reaches the device
/// log on a release build.
fn loud() -> Vec<String> {
    lines()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .filter(|(level, _)| *level <= Level::Info)
        .map(|(_, line)| line.clone())
        .collect()
}

fn captured_with(fragment: &str) -> Vec<(Level, String)> {
    lines()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .filter(|(_, line)| line.contains(fragment))
        .cloned()
        .collect()
}

fn engine_with_sections(dir: &TempDir) -> (PersistentEngine, String) {
    let corpus = LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 30,
        bucket_b_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 0,
        ..LifecycleConfig::default()
    });
    let path = dir.path().join("logging.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    let mut metrics = Vec::new();
    let mut ids = Vec::new();
    let mut times: Vec<u32> = Vec::new();
    let mut offsets = Vec::new();
    for a in corpus.through_a() {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .unwrap();
        engine
            .update_activity_metadata(&a.id, Some(a.start_date_unix), None, None, None)
            .unwrap();
        let n = a.gps_points.len() as u32;
        offsets.push(times.len() as u32);
        times.extend(0..n);
        ids.push(a.id.clone());
        metrics.push(ActivityMetrics {
            activity_id: a.id.clone(),
            name: a.id.clone(),
            date: a.start_date_unix,
            distance: 1000.0,
            moving_time: n,
            elapsed_time: n,
            elevation_gain: 0.0,
            avg_hr: None,
            avg_power: None,
            sport_type: a.sport_type.clone(),
            training_load: None,
            ftp: None,
            power_zone_times: None,
            hr_zone_times: None,
        });
    }
    offsets.push(times.len() as u32);
    engine.set_activity_metrics(metrics).unwrap();
    engine.set_time_streams_flat(&ids, &times, &offsets);
    let handle = engine.detect_sections_background();
    let (sections, _) = handle.recv().unwrap_or_default();
    engine.apply_sections(sections).unwrap();

    let section = engine
        .get_sections_by_type(None)
        .into_iter()
        .filter(|s| !s.is_user_defined)
        .max_by_key(|s| s.activity_ids.len())
        .expect("an auto section from 30 overlapping tracks");
    (engine, section.id)
}

#[test]
fn the_performance_read_is_silent_at_info_on_both_the_cold_and_the_cached_call() {
    let dir = TempDir::new().unwrap();
    let (mut engine, section_id) = engine_with_sections(&dir);

    start_capturing();
    engine.get_section_performances(&section_id);
    let cold = loud();
    assert!(
        cold.is_empty(),
        "the cold performance read logged {} lines at info or louder: {:?}",
        cold.len(),
        cold
    );

    start_capturing();
    engine.get_section_performances(&section_id);
    let cached = loud();
    assert!(
        cached.is_empty(),
        "the cached performance read logged {} lines at info or louder: {:?}",
        cached.len(),
        cached
    );

    // The lines are kept, just quieter: a trace log still explains the call.
    assert!(
        captured_with("[PERF] get_section_performances")
            .iter()
            .all(|(level, _)| *level == Level::Trace),
        "the per-call line must be trace, not merely deleted"
    );
}

#[test]
fn the_summaries_read_is_silent_at_info() {
    let dir = TempDir::new().unwrap();
    let (engine, _) = engine_with_sections(&dir);

    start_capturing();
    let summaries = engine.get_section_summaries();
    assert!(!summaries.is_empty(), "the fixture produced no summaries");

    let loud = loud();
    assert!(
        loud.is_empty(),
        "the summaries read logged {} lines at info or louder: {:?}",
        loud.len(),
        loud
    );
}
