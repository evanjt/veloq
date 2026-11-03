//! What `get_retired_map` costs on a library holding hundreds of retired
//! sections over a current catalogue on the same ground.
//!
//! The read is a synchronous export, so its budget is the 100 ms tap-or-mount
//! ceiling. It builds every retired line and every catalogue line and reads
//! the ground pairs a background level stored. The level compares each pair
//! whose boxes meet, and after a re-cut the retired and current sections lie
//! on the same ground by construction, so it is timed apart as `level`.
//!
//! The library is synthetic: `RETIRED` retired sections and as many current
//! ones, laid along corridors so each retired line shares ground with a few
//! current ones (`sparse`) or with every line in its corridor (`dense`, the
//! worst case a long shared road produces). When `VELOQ_DEVICE_DB` names a
//! routes.db its own retired read is timed as well.
//!
//! Level is the background fill from an empty table, read is the first call
//! after the engine opens on a level table, cached is the second. Nothing
//! asserts, it prints a table.
//!
//!     cargo bench -p veloqrs --bench retired_map_cost

use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use rusqlite::{Connection, params};
use tempfile::TempDir;
use veloqrs::persistence::codec;
use veloqrs::{GpsPoint, PersistentEngine};

const RETIRED: usize = 300;
const SAMPLES: usize = 7;
/// The mount budget the read is held to.
const MOUNT_BUDGET_MS: f64 = 100.0;

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

/// A straight east-west line of `points` fixes 25 m apart, starting `start_m`
/// east of the corridor's origin on the corridor at `row`.
fn line(row: usize, start_m: f64, points: usize) -> Vec<GpsPoint> {
    let lat = 46.0 + row as f64 * 0.002;
    let lng_per_m = 1.0 / (111_320.0 * lat.to_radians().cos());
    (0..points)
        .map(|i| GpsPoint {
            latitude: lat,
            longitude: 7.0 + (start_m + i as f64 * 25.0) * lng_per_m,
            elevation: None,
        })
        .collect()
}

fn insert_current(conn: &Connection, id: &str, line: &[GpsPoint]) {
    let b = veloqrs::geo_utils::compute_bounds(line);
    conn.execute(
        "INSERT INTO sections
             (id, section_type, name, sport_type, polyline_blob, distance_meters,
              geometry_source, created_at, is_user_defined,
              bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
         VALUES (?, 'auto', ?, 'Ride', ?, 1000.0, 'exact',
                 '2026-01-01T00:00:00Z', 0, ?, ?, ?, ?)",
        params![
            id,
            format!("Name of {id}"),
            codec::serialize_track_points(line),
            b.min_lat,
            b.max_lat,
            b.min_lng,
            b.max_lng,
        ],
    )
    .expect("insert the section");
}

fn insert_retired(conn: &Connection, id: &str, line: &[GpsPoint]) {
    conn.execute(
        "INSERT INTO section_geometry (section_id, version, source, blob, milestone, created_at)
         VALUES (?, 1, 'consensus', ?, 0, '2026-01-01 00:00:00')",
        params![id, codec::encode_polyline(line)],
    )
    .expect("the archived line");
    conn.execute(
        "INSERT INTO section_history (section_id, at, kind, details, geometry_version)
         VALUES (?, '2026-02-01 00:00:00', 'dissolved', '{}', 1)",
        [id],
    )
    .expect("the departure");
}

/// `corridors` corridors holding `RETIRED / corridors` retired lines and as
/// many current ones, each current line shifted `shift_m` along the corridor
/// from its retired twin. Lines are 40 fixes (1 km) long, so a corridor of
/// 300 polylines spaced 20 m apart lets every one meet every other.
fn synthetic(dir: &Path, corridors: usize, spacing_m: f64, shift_m: f64) -> PathBuf {
    let path = dir.join("routes.db");
    drop(PersistentEngine::new(path.to_str().unwrap()).expect("engine"));
    let conn = Connection::open(&path).expect("open");
    let per = RETIRED / corridors;
    for c in 0..corridors {
        for k in 0..per {
            let at = k as f64 * spacing_m;
            insert_retired(&conn, &format!("old_{c}_{k}"), &line(c, at, 40));
            insert_current(&conn, &format!("new_{c}_{k}"), &line(c, at + shift_m, 40));
        }
    }
    path
}

fn median(mut xs: Vec<Duration>) -> Duration {
    xs.sort();
    xs[xs.len() / 2]
}

/// Empty the stored ground pairs, so the next level measures every line.
fn forget_level(path: &Path) {
    Connection::open(path)
        .expect("open")
        .execute_batch("DELETE FROM retired_ground_pairs; DELETE FROM retired_ground_lines;")
        .expect("empty the stored pairs");
}

fn measure(label: &str, path: &Path) {
    let mut level = Vec::new();
    let mut cold = Vec::new();
    let mut cached = Vec::new();
    let mut shape = (0, 0, 0);
    for _ in 0..SAMPLES {
        forget_level(path);
        let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
        let at = Instant::now();
        engine.level_retired_pairs().expect("level");
        level.push(at.elapsed());
        drop(engine);
        let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
        let at = Instant::now();
        let data = engine.retired_map_data();
        cold.push(at.elapsed());
        assert!(!data.pairs_pending, "the level left pairs owed");
        shape = (data.retired.len(), data.current.len(), data.pairs.len());
        let at = Instant::now();
        std::hint::black_box(engine.retired_map_data());
        cached.push(at.elapsed());
    }
    let cold = median(cold);
    println!(
        "{label}: {} retired, {} current, {} pairs",
        shape.0, shape.1, shape.2
    );
    println!(
        "  read {:>9.2} ms ({:.1}x the {MOUNT_BUDGET_MS} ms mount budget)   cached {:>9.2?}   level {:>9.2?}",
        ms(cold),
        ms(cold) / MOUNT_BUDGET_MS,
        median(cached),
        median(level)
    );
}

fn main() {
    let dir = TempDir::new().expect("tempdir");

    let sparse = dir.path().join("sparse");
    std::fs::create_dir(&sparse).unwrap();
    measure(
        "sparse (30 corridors, lines 1 km apart)",
        &synthetic(&sparse, 30, 1_000.0, 30.0),
    );

    let apart = dir.path().join("apart");
    std::fs::create_dir(&apart).unwrap();
    measure(
        "apart (30 corridors, lines 5 km apart, no box meets)",
        &synthetic(&apart, 30, 5_000.0, 30.0),
    );

    let dense = dir.path().join("dense");
    std::fs::create_dir(&dense).unwrap();
    measure(
        "dense (1 corridor, lines 20 m apart)",
        &synthetic(&dense, 1, 20.0, 30.0),
    );

    if let Ok(p) = std::env::var("VELOQ_DEVICE_DB") {
        let copy = dir.path().join("device");
        std::fs::create_dir(&copy).unwrap();
        let dst = copy.join("routes.db");
        if std::fs::copy(&p, &dst).is_ok() {
            for suffix in ["-wal", "-shm"] {
                let from = format!("{p}{suffix}");
                if Path::new(&from).exists() {
                    std::fs::copy(&from, copy.join(format!("routes.db{suffix}"))).ok();
                }
            }
            measure("device library", &dst);
        }
    }
}
