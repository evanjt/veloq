//! What the launch re-fetch costs after the download, which `I124` measured cheap.
//!
//! `sync_activity_window` (`objects/sync.rs:1153-1183`) does three things under the write lock:
//! one `local_ids_for_intervals_ids` read over every id the page carried, then one
//! `upsert_activity_bodies` and one `set_activity_metrics` in a second hold. Every launch pays
//! all three for the whole history, and every screen read waits behind the second hold.
//!
//! `I124` measured the wire: 1,597 records, 692 B median body, 421 B to 1,930 B. Those are the
//! shapes generated here. The rows are synthetic, so what this measures is the write path and
//! the transaction shape, not the content.
//!
//! There is no contention in this bench, so the hold time reported is the work itself. On a
//! device it is a floor: a reader arriving mid-hold waits at least this long.
//!
//! Ignored by default. Run in release, twice, on a quiet machine:
//!   cargo test --release -p veloqrs --bench activity_upsert_cost -- --ignored --nocapture

use std::time::{Duration, Instant};

use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::{ActivityMetrics, PersistentEngine};

/// The library sizes `I124` names: a launch window, a year, and the whole history.
const SIZES: [usize; 3] = [100, 400, 1600];

/// `I124`'s median per-record body on the real API.
const MEDIAN_BODY_BYTES: usize = 692;

fn body(n: usize) -> String {
    // A JSON-shaped payload of the measured size, so the row is written and
    // read as one string rather than as a number.
    let filler = "x".repeat(MEDIAN_BODY_BYTES.saturating_sub(64));
    format!(r#"{{"id":"a{n}","type":"Ride","icu_training_load":42,"raw":"{filler}"}}"#)
}

fn rows(count: usize) -> (Vec<(String, i64, String)>, Vec<ActivityMetrics>) {
    let base = 1_700_000_000_i64;
    let mut bodies = Vec::with_capacity(count);
    let mut metrics = Vec::with_capacity(count);
    for n in 0..count {
        let id = format!("a{n}");
        let date = base - (n as i64) * 86_400;
        bodies.push((id.clone(), date, body(n)));
        metrics.push(ActivityMetrics {
            activity_id: id,
            name: format!("Ride {n}"),
            date,
            distance: 42_000.0,
            moving_time: 5_400,
            elapsed_time: 5_700,
            elevation_gain: 620.0,
            avg_hr: Some(146),
            avg_power: Some(212),
            sport_type: "Ride".to_string(),
            training_load: Some(78.0),
            // Present on most real rides, and it costs a second prepared
            // statement per row against `ftp_history`.
            ftp: Some(265),
            power_zone_times: Some(vec![600, 900, 1200, 900, 600, 300, 120]),
            hr_zone_times: Some(vec![600, 1200, 1800, 900, 300]),
        })
    }
    (bodies, metrics)
}

/// Two fixes is enough to make the row real. The track is not what is being
/// measured, and a full one per activity would dominate the setup.
fn track() -> Vec<GpsPoint> {
    vec![
        GpsPoint {
            latitude: 46.52,
            longitude: 6.63,
            elevation: Some(400.0),
        },
        GpsPoint {
            latitude: 46.53,
            longitude: 6.64,
            elevation: Some(410.0),
        },
    ]
}

fn engine() -> (PersistentEngine, TempDir) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("upsert.db");
    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("open engine");
    (engine, dir)
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

#[test]
#[ignore]
fn activity_upsert_by_library_size() {
    println!(
        "{:<8} {:>12} {:>12} {:>12} {:>12} {:>10}",
        "rows", "id lookup", "bodies", "metrics", "hold", "per row"
    );
    for size in SIZES {
        let (mut engine, _dir) = engine();
        let (bodies, metrics) = rows(size);
        let ids: Vec<String> = bodies.iter().map(|(id, _, _)| id.clone()).collect();

        // `local_ids_for_intervals_ids` probes `activities.intervals_id`, so the
        // table has to hold the library the lookup is against. Against an empty
        // one it resolves nothing and measures nothing.
        for id in &ids {
            engine
                .add_activity(id.clone(), track(), "Ride".to_string())
                .expect("seed activity");
        }

        // The first pass is an insert, which is not what a launch does. Every
        // launch after the first rewrites rows that are already there, so the
        // upsert path is measured on the second pass.
        engine.upsert_activity_bodies(&bodies).expect("seed bodies");
        engine
            .set_activity_metrics(metrics.clone())
            .expect("seed metrics");

        let t0 = Instant::now();
        let found = engine.local_ids_for_intervals_ids(&ids);
        let lookup = t0.elapsed();

        let t1 = Instant::now();
        engine.upsert_activity_bodies(&bodies).expect("bodies");
        let body_write = t1.elapsed();

        let t2 = Instant::now();
        engine.set_activity_metrics(metrics).expect("metrics");
        let metric_write = t2.elapsed();

        let hold = body_write + metric_write;
        println!(
            "{size:<8} {:>10.1}ms {:>10.1}ms {:>10.1}ms {:>10.1}ms {:>8.3}ms   ({} ids resolved)",
            ms(lookup),
            ms(body_write),
            ms(metric_write),
            ms(hold),
            ms(hold) / size as f64,
            found.len()
        );
    }
}
