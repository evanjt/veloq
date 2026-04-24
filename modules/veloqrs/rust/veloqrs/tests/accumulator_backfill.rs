//! Tier 2 upgrade path — `run_accumulator_backfill` seeds
//! `consensus_state_blob` for every section that carries NULL, as happens
//! on first launch after upgrading from 0.2.2 (or any pre-Tier-2 build).
//!
//! Scenario:
//! 1. Build scenario-B state (150 activities, ~70 sections). With Tier 2 inline
//!    seeding this leaves every section with a populated blob.
//! 2. Simulate a pre-Tier-2 database: NULL the blobs + clear the `schema_info`
//!    flag, close the engine.
//! 3. Call `run_accumulator_backfill` synchronously (the body of the
//!    background thread spawned during `persistent_engine_init`).
//! 4. Assert every blob is non-NULL and the flag is set.
//! 5. Re-open the engine and trigger scenario C (add 1 activity). Detection
//!    must land in the fast path (no first-touch backfill) — we assert it
//!    runs in well under the pre-Tier-2 ~1.5 s budget.

#![cfg(feature = "synthetic")]

use rusqlite::Connection;
use std::time::Instant;
use tempfile::TempDir;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentRouteEngine;

/// Build a scenario-B engine (150 activities, sections detected).
fn build_scenario_b(path: &str) -> LifecycleCorpus {
    let mut engine = PersistentRouteEngine::new(path).expect("engine");

    let cfg = LifecycleConfig {
        bucket_a_count: 60,
        bucket_b_delta_count: 90,
        bucket_d_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 4,
        ..LifecycleConfig::default()
    };
    let corpus = LifecycleCorpus::generate(&cfg);

    for activity in corpus.through_b() {
        engine
            .add_activity(
                activity.id.clone(),
                activity.gps_points.clone(),
                activity.sport_type.clone(),
            )
            .expect("add_activity");
        engine
            .update_activity_metadata(
                &activity.id,
                Some(activity.start_date_unix),
                None,
                None,
                None,
            )
            .expect("update_activity_metadata");
    }

    let handle = engine.detect_sections_background(None);
    let (sections, processed) = handle.recv().unwrap_or_default();
    engine.apply_sections(sections).expect("apply");
    engine
        .save_processed_activity_ids(&processed)
        .expect("save_processed");

    corpus
}

/// Count sections whose `consensus_state_blob` is NULL.
fn null_blob_count(path: &str) -> i64 {
    let conn = Connection::open(path).expect("open db");
    conn.query_row(
        "SELECT COUNT(*) FROM sections WHERE consensus_state_blob IS NULL",
        [],
        |row| row.get(0),
    )
    .unwrap_or(0)
}

/// Whether the backfill completion flag is present.
fn flag_set(path: &str) -> bool {
    let conn = Connection::open(path).expect("open db");
    conn.query_row(
        "SELECT value FROM schema_info WHERE key = 'accumulators_seeded_v1'",
        [],
        |row| row.get::<_, String>(0),
    )
    .is_ok()
}

/// Rewind a post-Tier-2 DB to pre-Tier-2 state: NULL every consensus_state_blob
/// and remove the backfill-done flag.
fn simulate_pre_tier2_state(path: &str) -> i64 {
    let conn = Connection::open(path).expect("open db");
    let cleared = conn
        .execute(
            "UPDATE sections SET consensus_state_blob = NULL
             WHERE consensus_state_blob IS NOT NULL",
            [],
        )
        .expect("null blobs");
    conn.execute(
        "DELETE FROM schema_info WHERE key = 'accumulators_seeded_v1'",
        [],
    )
    .expect("clear flag");
    cleared as i64
}

#[test]
fn backfill_seeds_all_null_blobs_and_sets_flag() {
    let tmp = TempDir::new().expect("tmp");
    let path_buf = tmp.path().join("backfill.db");
    let path = path_buf.to_str().unwrap().to_string();

    // Scenario B — builds a DB with sections whose blobs are populated by
    // Tier 2 inline seeding.
    build_scenario_b(&path);

    let initial_seeded = null_blob_count(&path);
    assert_eq!(
        initial_seeded, 0,
        "Tier 2 inline seeding should leave zero NULL blobs immediately after detection"
    );

    // Rewind to pre-Tier-2 state.
    let reset_count = simulate_pre_tier2_state(&path);
    assert!(
        reset_count > 0,
        "test fixture should have sections to null out"
    );
    assert_eq!(
        null_blob_count(&path),
        reset_count,
        "all blobs should be NULL after reset"
    );
    assert!(!flag_set(&path), "flag should be cleared after reset");

    // Drive the backfill body synchronously (same code path the background
    // thread runs in `spawn_accumulator_backfill`).
    let (seeded, skipped) = veloqrs::persistence::sections::run_accumulator_backfill(&path, false)
        .expect("backfill ok");

    println!(
        "[backfill test] seeded={} skipped={} reset_count={}",
        seeded, skipped, reset_count
    );
    assert!(
        seeded > 0,
        "backfill should seed at least one section (had {} NULL)",
        reset_count
    );
    assert_eq!(
        null_blob_count(&path),
        skipped as i64,
        "every non-skipped section should have a populated blob"
    );
    assert!(flag_set(&path), "backfill completion flag must be set");
}

#[test]
fn backfill_is_idempotent_when_flag_already_set() {
    let tmp = TempDir::new().expect("tmp");
    let path_buf = tmp.path().join("backfill_idempotent.db");
    let path = path_buf.to_str().unwrap().to_string();

    build_scenario_b(&path);

    // First run: with no NULL blobs, backfill is a quick flag-set.
    let (seeded1, skipped1) =
        veloqrs::persistence::sections::run_accumulator_backfill(&path, false).expect("first run");
    println!(
        "[idempotent] first run: seeded={} skipped={}",
        seeded1, skipped1
    );
    assert!(flag_set(&path));

    // Second run: should short-circuit on the flag without touching the DB.
    let (seeded2, skipped2) =
        veloqrs::persistence::sections::run_accumulator_backfill(&path, false).expect("second run");
    assert_eq!(seeded2, 0);
    assert_eq!(skipped2, 0);
}

#[test]
fn post_backfill_incremental_add_stays_in_fast_path() {
    // The whole point of the upgrade-path backfill: the first post-upgrade
    // incremental add must NOT hit the expensive trace-extraction branch.
    // Reproduce scenario C (+1 activity on top of 150) and assert detection
    // completes in well under the 1.5 s pre-Tier-2 cost.

    let tmp = TempDir::new().expect("tmp");
    let path_buf = tmp.path().join("post_backfill.db");
    let path = path_buf.to_str().unwrap().to_string();

    let corpus = build_scenario_b(&path);

    // Simulate upgrade: clear blobs + flag.
    let before = simulate_pre_tier2_state(&path);
    // Seed them back via the upgrade-path backfill.
    let (seeded, skipped) =
        veloqrs::persistence::sections::run_accumulator_backfill(&path, false)
            .expect("backfill ok");
    let remaining_null = null_blob_count(&path);
    println!(
        "[post_backfill] before={} seeded={} skipped={} still_null={}",
        before, seeded, skipped, remaining_null
    );
    // Must seed the vast majority; a handful of sections whose traces don't
    // cleanly project onto the polyline is acceptable and falls through to
    // the normal incremental backfill branch later.
    assert!(
        (seeded as i64) >= before * 9 / 10,
        "backfill should seed at least 90% of NULL sections, got {} of {}",
        seeded,
        before
    );

    // Re-open the engine (fresh load picks up blobs from disk).
    let mut engine = PersistentRouteEngine::new(&path).expect("engine");

    // Ingest the single new activity (scenario C's +1).
    let new_activity = &corpus.bucket_c_single;
    engine
        .add_activity(
            new_activity.id.clone(),
            new_activity.gps_points.clone(),
            new_activity.sport_type.clone(),
        )
        .expect("add_activity");
    engine
        .update_activity_metadata(
            &new_activity.id,
            Some(new_activity.start_date_unix),
            None,
            None,
            None,
        )
        .expect("update_activity_metadata");

    // Detect + time.
    let detect_start = Instant::now();
    let handle = engine.detect_sections_background(None);
    let (sections, _processed) = handle.recv().unwrap_or_default();
    engine.apply_sections(sections).expect("apply");
    let elapsed_ms = detect_start.elapsed().as_millis();

    println!(
        "[post_backfill fast-path] scenario C detect+apply = {} ms",
        elapsed_ms
    );

    // The pre-Tier-2 baseline for scenario C was 1591 ms. After Tier 2
    // + upgrade-path backfill, both the inline-seeded and the backfill-
    // seeded paths should land well under 800 ms on the reference build.
    // Keep the assertion loose so a slow CI host doesn't flake: the
    // important property is "not the old 1.5 s", not an exact speed.
    assert!(
        elapsed_ms < 800,
        "scenario C after upgrade-path backfill should stay under 800ms, got {}ms",
        elapsed_ms
    );
}
