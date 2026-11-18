//! What a tap on the heatmap pays for its under-point answer, against the 100 ms
//! a tap allows.
//!
//! The timed call is the one the map makes: `MapManager::activities_under_point`
//! on the blocking pool, read off the heatmap's shared source and a read
//! connection, with no engine lock. Its cost is the query over the bounds, the
//! decode of each track that passes, the listing, the route and section grouping
//! and one figures read per route and section group.
//!
//! The fixture is the one the engine's `six_hundred_hits` test answers: 600
//! tracks pass the tap, 250 in one route, 200 in another and 150 in none. A
//! section lies on the tap and rides 40 of the 150. The answer lists the newest
//! 500 and reads the figures of three groups. Each track is timed at two
//! densities: 12 points, the test's, and 400, which is closer to a recorded
//! ride. The decode grows with the points, so the 12-point row is a floor.
//!
//! The answer is checked before it is timed, so a fixture that stops passing the
//! tap cannot time an empty answer as a fast one.
//!
//! Desktop timings are not handset timings. The budget is the handset's tap, so
//! the figure that decides the question is the one taken on the device.
//!
//! Run in release, on a quiet machine:
//!   cargo bench -p veloqrs --bench under_point_cost

use std::path::PathBuf;
use std::time::{Duration, Instant};

use rusqlite::{Connection, params};
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::objects::MapManager;
use veloqrs::persistence::codec;
use veloqrs::{ActivityMetrics, PersistentEngine, runtime};

const TAP: (f64, f64) = (46.2, 7.35);
const ZOOM: u8 = 14;
const METRES_PER_DEGREE: f64 = 111_320.0;
/// Offset of the tracks and the section line from the tap, in metres.
const LINE_EAST_M: f64 = 3.0;
const TOTAL: usize = 600;
const ROUTE_BIG: usize = 250;
const ROUTE_SMALL: usize = 200;
const SECTION_RIDERS: usize = 40;
const DENSITIES: [u32; 2] = [12, 400];
const WARM_UP: usize = 3;
const SAMPLES: usize = 21;
const TAP_BUDGET_MS: f64 = 100.0;

fn north_of_tap(metres: f64) -> f64 {
    TAP.0 + metres / METRES_PER_DEGREE
}

fn east_of_tap(metres: f64) -> f64 {
    TAP.1 + metres / (METRES_PER_DEGREE * TAP.0.to_radians().cos())
}

/// A north-south line `east_metres` east of the tap, through its latitude.
fn passing(east_metres: f64, points: u32) -> Vec<GpsPoint> {
    let lng = east_of_tap(east_metres);
    (0..points)
        .map(|i| {
            let t = f64::from(i) / f64::from(points - 1);
            GpsPoint::new(north_of_tap(-2_000.0 + 4_000.0 * t), lng)
        })
        .collect()
}

fn metrics(id: &str, date: i64) -> ActivityMetrics {
    ActivityMetrics {
        activity_id: id.to_string(),
        name: format!("ride {id}"),
        date,
        distance: 10_000.0,
        moving_time: 1_800,
        elapsed_time: 1_900,
        elevation_gain: 0.0,
        avg_hr: None,
        avg_power: None,
        sport_type: "Ride".to_string(),
        training_load: None,
        ftp: None,
        power_zone_times: None,
        hr_zone_times: None,
    }
}

fn add_route(conn: &Connection, id: &str, members: &[String]) {
    conn.execute(
        "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type,
                                   activity_count, bounds_min_lat, bounds_max_lat,
                                   bounds_min_lng, bounds_max_lng)
         VALUES (?1, ?2, ?3, 'Ride', ?4, 46.0, 46.4, 7.0, 7.6)",
        params![
            id,
            members[0],
            serde_json::to_string(members).expect("member list"),
            members.len() as i64
        ],
    )
    .expect("route stored");
    for member in members {
        conn.execute(
            "INSERT INTO activity_matches (route_id, activity_id, match_percentage, direction)
             VALUES (?1, ?2, 95.0, 'same')",
            params![id, member],
        )
        .expect("match stored");
    }
}

fn add_section(conn: &Connection, id: &str, name: &str, line: &[GpsPoint], members: &[String]) {
    let bounds = tracematch::geo_utils::compute_bounds(line);
    conn.execute(
        "INSERT INTO sections
             (id, section_type, name, sport_type, polyline_blob, distance_meters, visit_count,
              representative_activity_id, rep_start_index, rep_end_index,
              geometry_source, created_at, is_user_defined,
              bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
         VALUES (?, 'auto', ?, 'Ride', ?, 1200.0, ?, ?, 0, 12, 'exact',
                 '2026-01-01T00:00:00Z', 0, ?, ?, ?, ?)",
        params![
            id,
            name,
            codec::serialize_track_points(line),
            members.len() as i64,
            members[0],
            bounds.min_lat,
            bounds.max_lat,
            bounds.min_lng,
            bounds.max_lng,
        ],
    )
    .expect("section stored");
    for member in members {
        conn.execute(
            "INSERT INTO section_activities
                 (section_id, activity_id, direction, start_index, end_index, distance_meters)
             VALUES (?1, ?2, 'same', 0, 10, 1200.0)",
            params![id, member],
        )
        .expect("section member stored");
    }
}

/// The fixture on disk. The engine stays open for the timing, as it does while
/// the app runs, and the directory lives as long as the engine.
struct Fixture {
    _dir: TempDir,
    _engine: PersistentEngine,
}

fn build(points_per_track: u32) -> Fixture {
    let dir = TempDir::new().expect("tempdir");
    let db: PathBuf = dir.path().join("routes.db");
    let tiles = dir.path().join("tiles");
    std::fs::create_dir_all(&tiles).expect("tiles directory");

    let mut engine = PersistentEngine::new(db.to_str().expect("utf-8 path")).expect("engine");
    // Before any activity is stored, so no tile pass is started by the add.
    engine.set_heatmap_tiles_path(tiles.to_string_lossy().into_owned());

    let mut batch = Vec::with_capacity(TOTAL);
    let mut all_metrics = Vec::with_capacity(TOTAL);
    let mut members: [Vec<String>; 3] = Default::default();
    for i in 0..TOTAL {
        let bucket = match i % 12 {
            0..=4 => 0,
            5..=8 => 1,
            _ => 2,
        };
        let id = format!("a{i}");
        let date = 1_700_000_000 + i as i64 * 60;
        batch.push((
            id.clone(),
            passing(LINE_EAST_M, points_per_track),
            "Ride".to_string(),
        ));
        all_metrics.push(metrics(&id, date));
        members[bucket].push(id);
    }
    assert_eq!(members[0].len(), ROUTE_BIG);
    assert_eq!(members[1].len(), ROUTE_SMALL);
    engine
        .add_activities_batch(batch)
        .expect("activities stored");
    engine
        .set_activity_metrics(all_metrics)
        .expect("metrics stored");

    let conn = Connection::open(&db).expect("second connection to the same file");
    add_route(&conn, "big", &members[0]);
    add_route(&conn, "small", &members[1]);
    conn.execute(
        "INSERT INTO route_names (route_id, custom_name) VALUES ('big', 'Lake loop')",
        [],
    )
    .expect("route name stored");
    conn.execute(
        "INSERT INTO route_numbers (route_id, number) VALUES ('small', 7)",
        [],
    )
    .expect("route number stored");
    add_section(
        &conn,
        "climb",
        "The climb",
        &passing(LINE_EAST_M, 40),
        &members[2][..SECTION_RIDERS],
    );
    drop(conn);

    Fixture {
        _dir: dir,
        _engine: engine,
    }
}

fn answer(manager: &MapManager) -> veloqrs::FfiActivitiesUnderPoint {
    runtime::block_on(manager.activities_under_point(TAP.0, TAP.1, ZOOM)).expect("an answer")
}

/// The fixture's answer, checked before anything is timed: every track passes
/// the tap, the listing is capped, and the route, section and no-route groups
/// are all present.
fn check_shape(found: &veloqrs::FfiActivitiesUnderPoint) {
    assert_eq!(found.total as usize, TOTAL, "every track passes the tap");
    assert!(found.truncated, "600 hits list 500");
    let counts: Vec<u32> = found.groups.iter().map(|g| g.count).collect();
    assert_eq!(
        counts,
        [
            ROUTE_BIG as u32,
            ROUTE_SMALL as u32,
            SECTION_RIDERS as u32,
            (TOTAL - ROUTE_BIG - ROUTE_SMALL) as u32
        ],
        "two routes, the section, then the activities in no route"
    );
}

struct Timing {
    min: Duration,
    median: Duration,
    p95: Duration,
    max: Duration,
}

fn timing_of(mut samples: Vec<Duration>) -> Timing {
    samples.sort_unstable();
    let last = samples.len() - 1;
    let p95 = (samples.len() as f64 * 0.95).ceil() as usize - 1;
    Timing {
        min: samples[0],
        median: samples[last / 2],
        p95: samples[p95.min(last)],
        max: samples[last],
    }
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

fn main() {
    println!("under-point answer over the 600-hit fixture, zoom {ZOOM}, release host");
    println!(
        "{:>14} {:>10} {:>10} {:>10} {:>10}   against {TAP_BUDGET_MS} ms tap",
        "points/track", "min ms", "median ms", "p95 ms", "max ms"
    );
    for points in DENSITIES {
        let fixture = build(points);
        let manager = MapManager::new();

        let first = answer(&manager);
        check_shape(&first);
        let groups = first.groups.len();

        let mut samples = Vec::with_capacity(SAMPLES);
        for i in 0..WARM_UP + SAMPLES {
            let started = Instant::now();
            let found = answer(&manager);
            let elapsed = started.elapsed();
            std::hint::black_box(&found);
            if i >= WARM_UP {
                samples.push(elapsed);
            }
        }
        let t = timing_of(samples);
        let verdict = if ms(t.p95) <= TAP_BUDGET_MS {
            "inside"
        } else {
            "over"
        };
        println!(
            "{points:>14} {:>10.2} {:>10.2} {:>10.2} {:>10.2}   {verdict}, {groups} groups",
            ms(t.min),
            ms(t.median),
            ms(t.p95),
            ms(t.max),
        );
        drop(fixture);
    }
}
