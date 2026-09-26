//! What the first feed read after an indicator version bump pays, measured
//! rather than estimated.
//!
//! `get_activity_indicators` checks the stored algorithm version and, when it is
//! behind, backfills lap times and rewrites the whole `activity_indicators`
//! table before it answers. The feed calls it from inside a render memo, so the
//! first paint after such a build waits for the pass under the engine's lock.
//! Nobody knew how long that was, and the read is on the launch path where the
//! budget is 200 ms once.
//!
//! The synthetic lifecycle corpus stands in for a real library because the
//! private one cannot be opened by the engine at all. The numbers therefore
//! scale with a detected section set rather than with an athlete's own history,
//! and they are desktop numbers, so what they establish is the shape and the
//! order of magnitude, not a phone budget.
//!
//! Ignored by default: it detects a whole corpus per size and takes minutes.
//! Run: `cargo test --test indicator_recompute_cost -p veloqrs --features synthetic -- --ignored --nocapture`

#![cfg(feature = "synthetic")]

use std::path::Path;
use std::time::Instant;

use rusqlite::Connection;
use tempfile::TempDir;
use tracematch::SectionConfig;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentEngine;

/// Pool sizes to measure. `bucket_a_count` is what the corpus scales on, and
/// the feed's own measured library is 490 activities.
const SIZES: &[usize] = &[24, 120, 480];

fn corpus(bucket_a: usize) -> Vec<LifecycleActivity> {
    LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: bucket_a,
        bucket_b_delta_count: 0,
        bucket_d_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 0,
        ..LifecycleConfig::default()
    })
    .through_a()
    .into_iter()
    .cloned()
    .collect()
}

fn open(dir: &TempDir) -> PersistentEngine {
    let mut engine = PersistentEngine::new(db_path(dir).to_str().expect("utf8")).expect("engine");
    engine.load().expect("load");
    engine.set_section_config(SectionConfig::default());
    engine
}

fn db_path(dir: &TempDir) -> std::path::PathBuf {
    dir.path().join("indicators.db")
}

/// Distance and duration are not decoration here. `compute_section_indicators`
/// falls back to `duration_secs * (portion distance / activity distance)` when a
/// portion has no `lap_time`, and the synthetic corpus has no time streams, so
/// an activity without them contributes no comparable effort and the pass
/// rewrites an empty table. Filling them is what makes the measurement the
/// recompute rather than the DELETE.
fn ingest(engine: &mut PersistentEngine, activities: &[LifecycleActivity]) {
    for a in activities {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .expect("add_activity");
        let metres = track_metres(&a.gps_points);
        // A shade under 20 km/h, varied per activity so two traversals of one
        // section are not identical and a PR and a trend both have something to
        // find.
        let seconds = (metres / 5.5) as i64 + (a.id.len() as i64 % 17);
        engine
            .update_activity_metadata(
                &a.id,
                Some(a.start_date_unix),
                None,
                Some(metres),
                Some(seconds.max(1)),
            )
            .expect("update_activity_metadata");
    }
}

fn track_metres(points: &[tracematch::GpsPoint]) -> f64 {
    points
        .windows(2)
        .map(|pair| {
            let (a, b) = (&pair[0], &pair[1]);
            let mean_lat = (a.latitude + b.latitude).to_radians() / 2.0;
            let dy = (b.latitude - a.latitude).to_radians() * 6_371_000.0;
            let dx = (b.longitude - a.longitude).to_radians() * 6_371_000.0 * mean_lat.cos();
            (dx * dx + dy * dy).sqrt()
        })
        .sum()
}

fn detect(engine: &mut PersistentEngine) {
    let handle = engine.detect_sections_background();
    let (main, cache_update) = handle.recv_with_cache();
    let (sections, processed) = main.unwrap_or_default();
    engine
        .apply_sections_with_cache(sections, cache_update)
        .expect("apply_sections_with_cache");
    engine
        .save_processed_activity_ids(&processed)
        .expect("save_processed_activity_ids");
}

fn one(path: &Path, sql: &str) -> i64 {
    Connection::open(path)
        .expect("open")
        .query_row(sql, [], |r| r.get::<_, i64>(0))
        .unwrap_or(0)
}

/// Put the stored version behind the code's, which is what a build that bumps
/// `INDICATOR_ALGORITHM_VERSION` leaves behind on every installed device.
fn make_version_stale(path: &Path) {
    Connection::open(path)
        .expect("open")
        .execute(
            "INSERT OR REPLACE INTO schema_info (key, value) VALUES ('indicator_version', '0')",
            [],
        )
        .expect("stamp");
}

fn first_activity_id(path: &Path) -> String {
    Connection::open(path)
        .expect("open")
        .query_row("SELECT id FROM activities LIMIT 1", [], |r| r.get(0))
        .expect("an activity")
}

#[test]
#[ignore = "detects a whole corpus per size; run it deliberately"]
fn the_version_check_inside_the_feeds_first_indicator_read() {
    println!(
        "activities  sections  portions  indicators  stale_read_ms  current_read_ms  recompute_ms"
    );
    for &bucket_a in SIZES {
        let dir = TempDir::new().expect("tempdir");
        let pool = corpus(bucket_a);
        let activities = pool.len();
        let mut engine = open(&dir);
        ingest(&mut engine, &pool);
        detect(&mut engine);

        let path = db_path(&dir);
        let sections = one(&path, "SELECT COUNT(*) FROM sections");
        let portions = one(&path, "SELECT COUNT(*) FROM section_activities");
        let id = first_activity_id(&path);

        // Warm the read once at the current version, so the stale run measures
        // the recompute rather than the first touch of the table.
        engine.get_activity_indicators(std::slice::from_ref(&id));

        make_version_stale(&path);
        let stale_start = Instant::now();
        let rows = engine.get_activity_indicators(std::slice::from_ref(&id));
        let stale_ms = stale_start.elapsed().as_secs_f64() * 1000.0;

        let current_start = Instant::now();
        let again = engine.get_activity_indicators(std::slice::from_ref(&id));
        let current_ms = current_start.elapsed().as_secs_f64() * 1000.0;

        let indicators = one(&path, "SELECT COUNT(*) FROM activity_indicators");
        println!(
            "{activities:10}  {sections:8}  {portions:8}  {indicators:10}  {stale_ms:13.1}  \
             {current_ms:15.1}  {:12.1}",
            stale_ms - current_ms
        );

        assert_eq!(rows.len(), again.len(), "the same rows either way");
        assert!(
            indicators > 0,
            "the pass wrote no indicators at {activities} activities, so the number above is              the rewrite of an empty table rather than the recompute"
        );
        assert!(
            stale_ms > current_ms,
            "a stale read should cost more than a current one at {activities} activities, \
             got {stale_ms:.1} ms against {current_ms:.1} ms"
        );
    }
}
