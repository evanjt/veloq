//! What a library-wide indicator pass costs on a library recorded without
//! sensors, once every lap already has its time.
//!
//! Every pass that rewrites indicators library-wide runs the lap backfill
//! first, under the engine write lock. A lap with a time stream and no heart
//! rate or power series can never gain a sensor mean, so whether the backfill
//! keeps choosing it, and decoding its time stream, decides what every later
//! pass pays for nothing. The library here is that shape: every activity
//! carries a one-hertz time stream and no sensor series at all.
//!
//! The pass measured is `recompute_activity_indicators`, the public entry to
//! the same rewrite the regroup, the detection apply and the attach finalise
//! run, so the figure is the whole hold and not the backfill alone. The first
//! pass fills whatever the stream store left; the repeated passes after it are
//! the steady state.
//!
//! Baseline only, nothing asserts on time. Run in release, on a quiet machine:
//!   cargo test --release --features synthetic --bench strapless_backfill_cost -- --ignored --nocapture --test-threads=1

#![cfg(feature = "synthetic")]

use std::time::{Duration, Instant};

use rusqlite::Connection;
use tempfile::TempDir;
use tracematch::GpsPoint;
use tracematch::synthetic::SyntheticScenario;
use veloqrs::PersistentEngine;

/// Long enough for a ride of a few hours at one point a second.
const CORRIDOR_METERS: f64 = 20_000.0;
/// Repeated passes timed after the first, per pool size.
const REPEATS: usize = 7;

struct Built {
    engine: PersistentEngine,
    path: String,
    _dir: TempDir,
}

fn build_strapless(pool: usize) -> Built {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("strapless.db");
    let path = path.to_str().unwrap().to_string();
    let mut engine = PersistentEngine::new(&path).expect("open engine");
    let dataset = SyntheticScenario::with_activity_count(pool, CORRIDOR_METERS, 0.8).generate();
    let rows: Vec<(String, Vec<GpsPoint>, String)> = dataset
        .tracks
        .into_iter()
        .map(|(id, points)| {
            let sport = dataset
                .sport_types
                .get(&id)
                .cloned()
                .unwrap_or_else(|| "Ride".to_string());
            (id, points, sport)
        })
        .collect();
    for chunk in rows.chunks(100) {
        engine
            .add_activities_batch(chunk.to_vec())
            .expect("ingest batch");
    }
    let handle = engine.detect_sections_background();
    let (sections, _) = handle.recv().expect("the detect ran");
    engine.apply_sections(sections).expect("apply");

    // A one-hertz clock in each track's own index space, and nothing else.
    let mut ids: Vec<String> = Vec::with_capacity(rows.len());
    let mut all_times: Vec<u32> = Vec::new();
    let mut offsets: Vec<u32> = Vec::with_capacity(rows.len());
    for (id, points, _) in &rows {
        ids.push(id.clone());
        offsets.push(all_times.len() as u32);
        all_times.extend(0..points.len() as u32);
    }
    engine.set_time_streams_flat(&ids, &all_times, &offsets);

    Built {
        engine,
        path,
        _dir: dir,
    }
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).expect(sql)
}

fn timed_pass(engine: &PersistentEngine) -> Duration {
    let start = Instant::now();
    engine
        .recompute_activity_indicators()
        .expect("recompute_activity_indicators");
    start.elapsed()
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

#[test]
#[ignore = "detects a whole corpus per size; run it deliberately"]
fn repeated_library_wide_pass_on_a_strapless_library() {
    for pool in [400usize, 1200] {
        let built = build_strapless(pool);
        let conn = Connection::open(&built.path).expect("second connection");

        let first = timed_pass(&built.engine);
        let mut repeats: Vec<Duration> = (0..REPEATS).map(|_| timed_pass(&built.engine)).collect();

        let sections = count(&conn, "SELECT COUNT(*) FROM sections");
        let laps = count(&conn, "SELECT COUNT(*) FROM section_activities");
        let timed = count(
            &conn,
            "SELECT COUNT(*) FROM section_activities WHERE lap_time IS NOT NULL",
        );
        let without_hr = count(
            &conn,
            "SELECT COUNT(*) FROM section_activities WHERE avg_hr IS NULL",
        );
        let series = count(&conn, "SELECT COUNT(*) FROM activity_streams");
        let streams = count(&conn, "SELECT COUNT(*) FROM time_streams");
        let points = all_points(&conn);

        let each: Vec<String> = repeats.iter().map(|d| format!("{:.1}", ms(*d))).collect();
        repeats.sort();
        println!(
            "[strapless] pool={pool} sections={sections} laps={laps} timed={timed} \
             avg_hr_null={without_hr} sensor_series={series} time_streams={streams} \
             stream_points={points}"
        );
        println!(
            "[strapless] pool={pool} first_ms={:.1} repeat_ms=[{}] repeat_min_ms={:.1} \
             repeat_median_ms={:.1}",
            ms(first),
            each.join(", "),
            ms(repeats[0]),
            ms(repeats[REPEATS / 2])
        );
        assert_eq!(series, 0, "the library is meant to carry no sensor series");
        assert!(laps > 0, "detection found no laps at pool {pool}");
        assert_eq!(
            timed, laps,
            "every lap should hold its time after the first pass"
        );
    }
}

/// Points across every time stream, which is what a decode of all of them
/// walks.
fn all_points(conn: &Connection) -> i64 {
    count(
        conn,
        "SELECT COALESCE(SUM(g.point_count), 0) FROM gps_tracks g
         JOIN time_streams t ON t.activity_id = g.activity_id",
    )
}
