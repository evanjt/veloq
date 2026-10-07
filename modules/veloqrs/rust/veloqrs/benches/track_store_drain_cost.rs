//! Whether the bulk track store keeps up with the download that feeds it.
//!
//! The bulk GPS sync fetches on its own thread and hands each result down an
//! unbounded channel to a loop that stores one activity at a time under the
//! write lock (`ffi.rs`, the storing loop of `start_fetch_and_store`). The
//! fetch is 50 in flight but paced by the process governor at 8 dispatches a
//! second, so results arrive at most one every 125 ms. If one store takes less
//! than that the channel holds a handful of results; if it takes more, every
//! result the store falls behind on waits in the channel with its parsed
//! track and series.
//!
//! Each store here makes the calls the production store makes, in its order:
//! the track, the elevation provenance, the nine wide series, the time stream
//! and the attach against the existing catalogue. Two arms: a cold login sync,
//! where the catalogue is empty and attach finds nothing, and a sync onto a
//! settled catalogue. A third times the section apply a conditioning run
//! makes every 50 stores, which is the longest hold the storing loop waits
//! behind while the fetch keeps landing.
//!
//! Baseline only, nothing asserts. Run in release, twice, on a quiet machine:
//!   cargo test --release --features synthetic --bench track_store_drain_cost -- --ignored --nocapture

#![cfg(feature = "synthetic")]

use std::time::Instant;

use tempfile::TempDir;
use tracematch::GpsPoint;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentEngine;
use veloqrs::net::types::StreamDto;

/// The fastest the governor lets results arrive, one per dispatch at 8 a second.
const ARRIVAL_INTERVAL_MS: f64 = 125.0;

/// The series a wide fetch stores beside the track, from `DEFAULT_STREAM_TYPES`
/// less the ones `gps_tracks` and `time_streams` already answer.
const WIDE_SERIES: [&str; 9] = [
    "distance",
    "velocity_smooth",
    "heartrate",
    "watts",
    "cadence",
    "grade_smooth",
    "temp",
    "w_bal",
    "ga_velocity",
];

/// A ride of a few hours at one point a second, the size the doc comment on
/// `fetch_activity_maps_into` works from.
const TARGET_POINTS: usize = 5_000;

fn corpus(new: usize) -> LifecycleCorpus {
    LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 60,
        bucket_b_delta_count: 90,
        bucket_d_delta_count: 3,
        bucket_e_delta_count: new,
        parallel_street_count: 4,
        ..LifecycleConfig::default()
    })
}

/// The activity's own track walked out and back until it reaches the target
/// length, so the corridor geometry the attach matches against is unchanged.
fn wide_track(activity: &LifecycleActivity) -> Vec<GpsPoint> {
    let passes = TARGET_POINTS.div_ceil(activity.gps_points.len().max(1));
    let mut points = activity.lapped(passes);
    points.truncate(TARGET_POINTS);
    points
}

fn wide_series(len: usize) -> Vec<StreamDto> {
    WIDE_SERIES
        .iter()
        .enumerate()
        .map(|(k, kind)| StreamDto {
            kind: (*kind).to_string(),
            data: (0..len).map(|i| Some((i * (k + 1)) as f64 * 0.1)).collect(),
            data2: None,
        })
        .collect()
}

/// One store, the calls `store_track` makes under the lock, in its order.
/// Returns the milliseconds it held the engine.
fn store_one(engine: &mut PersistentEngine, activity: &LifecycleActivity) -> f64 {
    let points = wide_track(activity);
    let len = points.len();
    let series = wide_series(len);
    let times: Vec<u32> = (0..len as u32).collect();
    let source = veloqrs::persistence::elevation_source_of(
        &points,
        veloqrs::persistence::ElevationSeries::upstream(true),
    );

    let start = Instant::now();
    let changed = engine
        .add_activity(activity.id.clone(), points, activity.sport_type.clone())
        .expect("add_activity");
    engine
        .record_elevation_state(&[(activity.id.clone(), 1)])
        .expect("record_elevation_state");
    engine
        .record_elevation_source(&[(activity.id.clone(), source)])
        .expect("record_elevation_source");
    engine
        .store_activity_streams(&activity.id, &series)
        .expect("store_activity_streams");
    engine.store_time_streams_flat(std::slice::from_ref(&activity.id), &times, &[0]);
    engine.attach_after_store(&activity.id, !changed.is_empty());
    start.elapsed().as_secs_f64() * 1000.0
}

fn quantile(sorted: &[f64], q: f64) -> f64 {
    let idx = ((sorted.len() as f64 - 1.0) * q).round() as usize;
    sorted[idx.min(sorted.len() - 1)]
}

fn report(label: &str, mut samples: Vec<f64>) {
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let total: f64 = samples.iter().sum();
    let mean = total / samples.len() as f64;
    // Results the channel holds when the store runs at its mean against the
    // fastest arrival, after the whole batch has landed.
    let backlog = if mean > ARRIVAL_INTERVAL_MS {
        samples.len() as f64 * (1.0 - ARRIVAL_INTERVAL_MS / mean)
    } else {
        0.0
    };
    println!(
        "{label}: {} stores, mean {mean:.1} ms, p50 {:.1}, p95 {:.1}, max {:.1}; \
         store rate {:.1}/s against 8/s arrival; backlog at the end {backlog:.0}",
        samples.len(),
        quantile(&samples, 0.5),
        quantile(&samples, 0.95),
        quantile(&samples, 1.0),
        1000.0 / mean,
    );
}

fn open(dir: &TempDir) -> PersistentEngine {
    let path = dir.path().join("drain.db");
    PersistentEngine::new(path.to_str().unwrap()).expect("open engine")
}

#[test]
#[ignore] // a few minutes in release; baseline for the track channel bound
fn track_store_drain_cost_baseline() {
    const NEW: usize = 200;
    let corpus = corpus(NEW);

    // Cold login sync: nothing stored, nothing to attach to.
    {
        let dir = TempDir::new().expect("tempdir");
        let mut engine = open(&dir);
        let samples: Vec<f64> = corpus
            .through_e()
            .into_iter()
            .map(|activity| store_one(&mut engine, activity))
            .collect();
        let first = &corpus.bucket_a[0].id;
        println!(
            "each store: {} points, {} series",
            engine.get_gps_track(first).map(|t| t.len()).unwrap_or(0),
            engine
                .load_activity_streams(first)
                .map(|s| s.len())
                .unwrap_or(0)
        );
        report("cold library, every activity", samples);
    }

    // A sync onto a settled catalogue: the attach finds sections to match.
    {
        let dir = TempDir::new().expect("tempdir");
        let mut engine = open(&dir);
        for activity in corpus.through_d() {
            store_one(&mut engine, activity);
        }
        let handle = engine.detect_sections_background();
        let (sections, _) = handle.recv().expect("the detect ran");
        engine.apply_sections(sections).expect("initial apply");
        engine.get_groups();
        println!(
            "settled catalogue: {} sections over {} activities",
            engine.get_sections().len(),
            engine.activity_count()
        );

        let samples: Vec<f64> = corpus
            .bucket_e_delta
            .iter()
            .map(|activity| store_one(&mut engine, activity))
            .collect();
        report("settled catalogue, new activities", samples);

        // The conditioning run the backfill starts every 50 stores detects off
        // the lock and applies under it. The apply is the stall the storing
        // loop sits behind while results keep arriving.
        let handle = engine.detect_sections_background();
        let (sections, _) = handle.recv().expect("the detect ran");
        let start = Instant::now();
        engine.apply_sections(sections).expect("apply");
        let apply_ms = start.elapsed().as_secs_f64() * 1000.0;
        println!(
            "conditioning apply over {} activities: {apply_ms:.1} ms, \
             {:.0} results arriving meanwhile",
            engine.activity_count(),
            apply_ms / ARRIVAL_INTERVAL_MS
        );
    }
}
