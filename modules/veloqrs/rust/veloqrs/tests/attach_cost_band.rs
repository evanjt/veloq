//! Scenario: a sync attaches each downloaded activity to the stored catalogue
//! one at a time, on the private corpus.
//! Expected behaviour: the per-activity median and p95 stay inside a band of
//! the baseline recorded beside the corpus. There is no absolute ceiling, a
//! slowdown fails the band and the baseline moves only on a rebase that gives
//! its reason.
//!
//! Run: `cargo test --release -p veloqrs --features real-corpus --test attach_cost_band -- --nocapture`
//! Rebase: set `TRACEMATCH_BITWISE_REBASE` to the reason, after reading the report.

#![cfg(feature = "real-corpus")]

mod cost_band_support;

use std::time::Instant;

use cost_band_support::{Band, corpus, judge, median_and_p95};
use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::persistence::WorkerPoll;

const CORPUS: &str = "fullcorpus";
const BASELINE: &str = "_attach_baseline.txt";
const ATTACHED: usize = 20;

/// Microseconds, because an attach is a few milliseconds and a millisecond
/// floor would hide a threefold slowdown.
const BAND: Band = Band {
    time_factor: 1.5,
    time_floor_ms: 5_000,
    bytes_factor: 1.2,
    bytes_floor: 0,
};

#[test]
fn attaching_one_activity_stays_inside_its_band() {
    let (tracks, starts, _) = corpus::load_tracks(CORPUS, 1000);
    let points: usize = tracks.iter().map(|(_, t)| t.len()).sum();
    let shape = format!("C {} {points}", tracks.len());
    let split = tracks.len() - ATTACHED;

    let dir = TempDir::new().expect("tempdir");
    let mut engine =
        PersistentEngine::new(dir.path().join("attach.db").to_str().unwrap()).expect("engine");
    let add = |engine: &mut PersistentEngine, id: &str, track: &[tracematch::GpsPoint]| {
        engine
            .add_activity(id.to_string(), track.to_vec(), "Ride".to_string())
            .expect("add_activity");
        engine
            .update_activity_metadata(id, starts.get(id).copied(), None, None, None)
            .expect("update_activity_metadata");
    };

    for (id, track) in &tracks[..split] {
        add(&mut engine, id, track);
    }
    let handle = engine.detect_sections_background();
    let (main, cache) = handle.recv_state_with_cache();
    let WorkerPoll::Ready((sections, processed)) = main else {
        panic!("the cold detect did not finish");
    };
    engine
        .apply_sections_with_cache(sections, cache)
        .expect("apply");
    engine
        .save_processed_activity_ids(&processed)
        .expect("processed");
    engine.get_groups();

    let mut attach_us: Vec<u64> = Vec::with_capacity(ATTACHED);
    for (id, track) in &tracks[split..] {
        add(&mut engine, id, track);
        let t = Instant::now();
        engine.attach_new_activities(std::slice::from_ref(id));
        attach_us.push(t.elapsed().as_micros() as u64);
    }
    let (median, p95) = median_and_p95(&attach_us);
    println!("attach over {split} stored: median {median} us, p95 {p95} us");

    judge(
        &corpus::dir(CORPUS).join(BASELINE),
        &shape,
        &[
            ("perf_attach_median_us", median),
            ("perf_attach_p95_us", p95),
        ],
        &BAND,
    );
}
