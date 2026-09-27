//! What a pooled insights read would cost, measured rather than assumed.
//!
//! The engine path answers the activity patterns from `activity_metrics` held
//! in memory. A pooled read has no memory tier, so it would load every metrics
//! row per call. `insights_data` is a tab mount, whose budget is 100 ms, and
//! the engine path measured 27.8 ms on a 490-activity library. This
//! says what the load adds on a library of the size the field reports.
//!
//! Run: `cargo test --test insights_pool_cost -p veloqrs -- --nocapture`

use std::collections::HashMap;
use std::time::Instant;

use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::types::ActivityMetrics;

/// The largest library the field reports: 1,598 activities.
const LIBRARY: usize = 1_598;

fn metrics(i: usize) -> ActivityMetrics {
    ActivityMetrics {
        activity_id: format!("a{i}"),
        name: format!("Ride {i}"),
        date: 1_700_000_000 + i as i64 * 3_600,
        distance: 30_000.0,
        moving_time: 3_600,
        elapsed_time: 3_800,
        elevation_gain: 400.0,
        avg_hr: Some(140),
        avg_power: Some(200),
        sport_type: "Ride".to_string(),
        training_load: Some(80.0),
        ftp: Some(250),
        power_zone_times: None,
        hr_zone_times: None,
    }
}

#[test]
fn a_pooled_metrics_load_is_inside_the_mount_budget() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("insights_cost.db");
    let mut engine = PersistentEngine::new(path.to_str().expect("utf-8")).expect("engine");
    engine
        .set_activity_metrics((0..LIBRARY).map(metrics).collect())
        .expect("metrics");
    drop(engine);
    // Read the way a pooled caller does: its own connection on the same file,
    // with nothing the engine holds in memory.
    let conn = rusqlite::Connection::open(path.to_str().expect("utf-8")).expect("open");

    // The read a pooled `insights_data` would have to make before it can
    // compute anything: every metrics row, as the memory tier holds them.
    let started = Instant::now();
    let loaded: HashMap<String, ActivityMetrics> = {
        let mut stmt = conn
            .prepare(
                "SELECT activity_id, name, date, distance, moving_time, elapsed_time,
                        elevation_gain, avg_hr, avg_power, sport_type,
                        training_load, ftp, power_zone_times, hr_zone_times
                 FROM activity_metrics",
            )
            .expect("prepare");
        stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                ActivityMetrics {
                    activity_id: row.get(0)?,
                    name: row.get(1)?,
                    date: row.get(2)?,
                    distance: row.get(3)?,
                    moving_time: row.get(4)?,
                    elapsed_time: row.get(5)?,
                    elevation_gain: row.get(6)?,
                    avg_hr: row.get(7)?,
                    avg_power: row.get(8)?,
                    sport_type: row.get(9)?,
                    training_load: row.get(10)?,
                    ftp: row.get(11)?,
                    // Parsed the way the engine parses them, so the figure
                    // covers the JSON the rows actually carry.
                    power_zone_times: row
                        .get::<_, Option<String>>(12)?
                        .and_then(|raw| serde_json::from_str(&raw).ok()),
                    hr_zone_times: row
                        .get::<_, Option<String>>(13)?
                        .and_then(|raw| serde_json::from_str(&raw).ok()),
                },
            ))
        })
        .expect("query")
        .flatten()
        .collect()
    };
    let load = started.elapsed();

    assert_eq!(loaded.len(), LIBRARY, "every row came back");
    println!("pooled metrics load for {LIBRARY} activities: {load:?}");

    // Generous: this is a shared box and the figure is worth having, not
    // worth failing a suite on. A regression of an order of magnitude is what
    // this catches.
    assert!(
        load.as_millis() < 500,
        "loading {LIBRARY} metrics rows took {load:?}, which no mount budget survives"
    );
}
