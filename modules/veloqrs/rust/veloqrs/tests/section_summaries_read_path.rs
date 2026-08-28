//! Read-path benchmark for `get_section_summaries` (B4 Phase 3).
//!
//! The Routes list calls `get_section_summaries` on every open, so it must be a
//! cheap, pure column read (<=30ms). This measures it two ways:
//!
//! - VELOQ_DB set -> the real device export (local only, never committed). This
//!   is the authoritative number the brief asks for; it skips cleanly when the
//!   env var is unset or the file is absent.
//! - otherwise -> a synthetic DB (many sections, many junction rows) so the
//!   before/after of the denormalisation is visible in CI with no private data.
//!
//! Run: `cargo test -p veloqrs --features synthetic --test section_summaries_read_path -- --nocapture`

#![cfg(feature = "synthetic")]

use rusqlite::{Connection, params};
use std::time::Instant;
use tempfile::TempDir;
use veloqrs::PersistentRouteEngine;

/// Synthetic scale: enough sections and junction rows that an O(junction)
/// aggregation is measurable, without being slow to build.
const SECTIONS: usize = 250;
const ACTIVITIES_PER_SECTION: usize = 20;

fn seed_synthetic(path: &str) {
    let conn = Connection::open(path).expect("open for seed");
    let tx = conn.unchecked_transaction().expect("tx");
    let sports = ["Ride", "Run", "Hike", "Walk", "Swim"];
    for s in 0..SECTIONS {
        let sport = sports[s % sports.len()];
        let sid = format!("sec_bench_{s}");
        let poly = format!(
            "[{{\"latitude\":46.2,\"longitude\":7.3}},{{\"latitude\":46.21,\"longitude\":7.31}}]"
        );
        tx.execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                distance_meters, is_user_defined, version, created_at,
                bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
             VALUES (?, 'auto', ?, ?, ?, 3000.0, 0, 1, '2026-01-01T00:00:00Z',
                46.2, 46.21, 7.3, 7.31)",
            params![sid, format!("Section {s}"), sport, poly],
        )
        .expect("insert section");
        for a in 0..ACTIVITIES_PER_SECTION {
            let aid = format!("act_{s}_{a}");
            tx.execute(
                "INSERT OR IGNORE INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng)
                 VALUES (?, ?, 46.2, 46.21, 7.3, 7.31)",
                params![aid, sport],
            )
            .expect("insert activity");
            tx.execute(
                "INSERT OR IGNORE INTO activity_metrics (activity_id, name, date, distance,
                    moving_time, elapsed_time, elevation_gain, sport_type)
                 VALUES (?, ?, 1735689600, 3000.0, 600, 600, 10.0, ?)",
                params![aid, aid, sport],
            )
            .expect("insert metrics");
            tx.execute(
                "INSERT INTO section_activities (section_id, activity_id, direction,
                    start_index, end_index, distance_meters, lap_time, lap_pace)
                 VALUES (?, ?, 'same', 0, 100, 3000.0, 600.0, 5.0)",
                params![sid, aid],
            )
            .expect("insert junction");
        }
    }
    tx.commit().expect("commit seed");
}

fn median_ms(engine: &mut PersistentRouteEngine, iterations: u32) -> f64 {
    let mut samples: Vec<f64> = Vec::new();
    for _ in 0..iterations {
        let start = Instant::now();
        let summaries = engine.get_section_summaries();
        let elapsed = start.elapsed().as_secs_f64() * 1000.0;
        assert!(!summaries.is_empty(), "benchmark DB produced no summaries");
        samples.push(elapsed);
    }
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
    samples[samples.len() / 2]
}

#[test]
fn get_section_summaries_is_a_fast_column_read() {
    let (mut engine, _dir, label) = match std::env::var("VELOQ_DB") {
        Ok(p) if std::path::Path::new(&p).exists() => {
            let mut e = PersistentRouteEngine::new(&p).expect("open device DB");
            e.load().expect("load device DB");
            (e, None, format!("VELOQ_DB {p}"))
        }
        _ => {
            let dir = TempDir::new().expect("tempdir");
            let path = dir.path().join("bench.db");
            let path_str = path.to_str().unwrap().to_string();
            {
                let _e = PersistentRouteEngine::new(&path_str).expect("migrate");
            }
            seed_synthetic(&path_str);
            let mut e = PersistentRouteEngine::new(&path_str).expect("reopen");
            e.load().expect("load synthetic DB");
            (
                e,
                Some(dir),
                format!("synthetic {SECTIONS}x{ACTIVITIES_PER_SECTION}"),
            )
        }
    };

    let count = engine.get_section_summaries().len();
    // Warm any lazily-built caches, then measure a steady-state median.
    let _ = median_ms(&mut engine, 3);
    let median = median_ms(&mut engine, 15);
    println!(
        "[read-path] get_section_summaries: {median:.2}ms median over {count} sections ({label})"
    );

    assert!(
        median <= 30.0,
        "get_section_summaries took {median:.2}ms over {count} sections ({label}) — read path exceeds the 30ms budget"
    );
}

/// The denormalised visit_count column must equal the junction reality: the seed
/// inserts drive it up via the AFTER INSERT trigger, and remove_activity brings it
/// back down (the FK cascade fires no trigger, so remove_activity recomputes it).
#[test]
fn visit_count_column_tracks_the_junction() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("vc.db");
    let path_str = path.to_str().unwrap().to_string();
    {
        let _e = PersistentRouteEngine::new(&path_str).expect("migrate");
    }
    seed_synthetic(&path_str);
    let mut engine = PersistentRouteEngine::new(&path_str).expect("reopen");
    engine.load().expect("load");

    let summaries = engine.get_section_summaries();
    assert!(
        summaries
            .iter()
            .all(|s| s.visit_count == ACTIVITIES_PER_SECTION as u32),
        "visit_count column must equal the seeded junction count (trigger did not maintain it)"
    );

    let sid = "sec_bench_0";
    let before = summaries.iter().find(|s| s.id == sid).unwrap().visit_count;
    engine.remove_activity("act_0_0").expect("remove_activity");
    let after = engine
        .get_section_summaries()
        .into_iter()
        .find(|s| s.id == sid)
        .map(|s| s.visit_count)
        .unwrap_or(0);
    assert_eq!(
        after,
        before - 1,
        "remove_activity must decrement the affected section's visit_count"
    );
}

/// `get_sections` decodes one polyline blob per row. On the same fixture it
/// stays inside a budget a list screen can afford, and the number is the
/// one the module documentation cites.
#[test]
fn get_sections_reads_the_fixture_inside_its_budget() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("sections_bench.db");
    let path_str = path.to_str().unwrap().to_string();
    {
        let _engine = PersistentRouteEngine::new(&path_str).expect("create schema");
    }
    seed_synthetic(&path_str);
    let mut engine = PersistentRouteEngine::new(&path_str).expect("open");
    engine.load().expect("load");
    let mut samples = Vec::new();
    for _ in 0..5 {
        let start = Instant::now();
        let sections = engine.get_sections();
        let elapsed = start.elapsed().as_secs_f64() * 1000.0;
        assert_eq!(sections.len(), SECTIONS);
        samples.push(elapsed);
    }
    samples.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let median = samples[samples.len() / 2];
    assert!(median <= 300.0, "get_sections median {median:.1} ms over 300 ms");
}
