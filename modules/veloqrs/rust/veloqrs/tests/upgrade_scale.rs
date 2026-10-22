//! Scenario: a schema 12 library of thousands of activities, opened by the
//! current build, then cut over.
//! Expected behaviour: the seed is a real v12 file whose rows all survive the
//! open. The report test prints wall time, peak resident memory and file sizes
//! for the sizes in `UPGRADE_SCALE_SIZES`, and is ignored by default because a
//! duration is only meaningful on the build kind and machine it names.
//!
//!     UPGRADE_SCALE_SIZES=1000,5000,10000 cargo test -p veloqrs --release \
//!         --test migration upgrade_scale::report -- --ignored --nocapture
//!
//! The tracks are synthetic: loops through a few hundred shared corridors so
//! detection finds sections to cut. They are not a stand-in for a real library's
//! shape, only for its row counts and blob sizes.

use super::migration_support::{app_schema_version, row_count, seed_at_version, user_version};
use rusqlite::{Connection, params};
use std::path::Path;
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::persistence::codec;

const POINTS_PER_TRACK: usize = 400;
const CORRIDORS: u64 = 60;
const NAMED_SECTIONS: usize = 40;
const STRENGTH_SESSIONS: usize = 150;

/// xorshift, so a seed is the same bytes on every machine and run.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64
    }
}

fn track(corridor: u64, rng: &mut Rng) -> Vec<GpsPoint> {
    let lat0 = 46.0 + (corridor / 8) as f64 * 0.02;
    let lng0 = 7.0 + (corridor % 8) as f64 * 0.03;
    (0..POINTS_PER_TRACK)
        .map(|i| {
            let t = i as f64 / POINTS_PER_TRACK as f64;
            GpsPoint {
                latitude: lat0 + t * 0.012 + (rng.unit() - 0.5) * 0.000_02,
                longitude: lng0
                    + (t * std::f64::consts::TAU).sin() * 0.004
                    + (rng.unit() - 0.5) * 0.000_02,
                elevation: None,
            }
        })
        .collect()
}

/// A schema 12 file holding `n` rides with tracks, time streams and metrics,
/// plus named auto sections, a pinned custom section and strength sets. A
/// recording queue is absent on purpose: schema 12 has no such table.
pub fn seed_v12_library(path: &Path, n: usize) {
    let mut conn: Connection = seed_at_version(path, 12);
    let tx = conn.transaction().expect("seed transaction");
    let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
    let base = 1_600_000_000_i64;
    for i in 0..n {
        let id = format!("seed-{i}");
        let corridor = rng.next() % CORRIDORS;
        let points = track(corridor, &mut rng);
        let (min_lat, max_lat, min_lng, max_lng) =
            points
                .iter()
                .fold((f64::MAX, f64::MIN, f64::MAX, f64::MIN), |a, p| {
                    (
                        a.0.min(p.latitude),
                        a.1.max(p.latitude),
                        a.2.min(p.longitude),
                        a.3.max(p.longitude),
                    )
                });
        let date = base + i as i64 * 6 * 3600;
        tx.execute(
            "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng,
                                    start_date, name, distance_meters, duration_secs)
             VALUES (?1, 'Ride', ?2, ?3, ?4, ?5, ?6, ?7, 20000, 3000)",
            params![
                id,
                min_lat,
                max_lat,
                min_lng,
                max_lng,
                date,
                format!("Ride {i}")
            ],
        )
        .unwrap();
        tx.execute(
            "INSERT INTO gps_tracks (activity_id, track_data, point_count) VALUES (?1, ?2, ?3)",
            params![
                id,
                codec::serialize_track_points(&points),
                points.len() as i64
            ],
        )
        .unwrap();
        let times: Vec<u32> = (0..points.len() as u32).map(|t| t * 7).collect();
        tx.execute(
            "INSERT INTO time_streams (activity_id, times, point_count) VALUES (?1, ?2, ?3)",
            params![id, codec::serialize(&times).unwrap(), times.len() as i64],
        )
        .unwrap();
        tx.execute(
            "INSERT INTO activity_metrics (activity_id, name, date, distance, moving_time,
                                           elapsed_time, elevation_gain, sport_type)
             VALUES (?1, ?2, ?3, 20000, 3000, 3100, 250, 'Ride')",
            params![id, format!("Ride {i}"), date],
        )
        .unwrap();
        tx.execute(
            "INSERT INTO processed_activities (activity_id) VALUES (?1)",
            params![id],
        )
        .unwrap();
    }
    for s in 0..NAMED_SECTIONS {
        let rep = format!("seed-{}", s % n.max(1));
        let polyline =
            r#"[{"latitude":46.0,"longitude":7.0},{"latitude":46.001,"longitude":7.001}]"#;
        tx.execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                                   distance_meters, representative_activity_id, is_user_defined)
             VALUES (?1, ?2, ?3, 'Ride', ?4, 150, ?5, ?6)",
            params![
                format!("sec-{s}"),
                if s == 0 { "custom" } else { "auto" },
                format!("Named {s}"),
                polyline,
                rep,
                i64::from(s == 0),
            ],
        )
        .unwrap();
    }
    for session in 0..STRENGTH_SESSIONS.min(n) {
        for set in 0..6 {
            tx.execute(
                "INSERT INTO exercise_sets (activity_id, set_order, exercise_category, set_type,
                                            repetitions, weight_kg)
                 VALUES (?1, ?2, 1, 1, 8, 40)",
                params![format!("seed-{session}"), set],
            )
            .unwrap();
        }
    }
    tx.commit().expect("commit seed");
}

fn count(path: &Path, table: &str) -> i64 {
    row_count(&Connection::open(path).unwrap(), table).unwrap_or(-1)
}

#[test]
fn the_seed_is_a_schema_12_library_and_the_open_keeps_every_row() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    seed_v12_library(&path, 60);

    let seeded = Connection::open(&path).unwrap();
    assert_eq!(user_version(&seeded), 12);
    assert_eq!(app_schema_version(&seeded), Some(12));
    assert_eq!(row_count(&seeded, "gps_tracks"), Some(60));
    assert_eq!(row_count(&seeded, "time_streams"), Some(60));
    assert_eq!(row_count(&seeded, "sections"), Some(NAMED_SECTIONS as i64));
    drop(seeded);

    drop(veloqrs::PersistentEngine::new(path.to_str().unwrap()).expect("open engine"));

    assert_eq!(count(&path, "activities"), 60);
    assert_eq!(count(&path, "gps_tracks"), 60);
    assert_eq!(count(&path, "time_streams"), 60);
    assert_eq!(
        count(&path, "exercise_sets"),
        6 * 60.min(STRENGTH_SESSIONS) as i64
    );
    // A name moves from its section row to a named intent, so the athlete's
    // names are counted there, plus the custom section that keeps its row.
    let c = Connection::open(&path).unwrap();
    let named: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM section_intents WHERE kind = 'named'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let custom: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM sections WHERE section_type = 'custom'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        named + custom,
        NAMED_SECTIONS as i64,
        "named: {named}, custom: {custom}"
    );
}

fn peak_rss_kb() -> u64 {
    std::fs::read_to_string("/proc/self/status")
        .ok()
        .and_then(|s| {
            s.lines()
                .find(|l| l.starts_with("VmHWM:"))
                .and_then(|l| l.split_whitespace().nth(1)?.parse().ok())
        })
        .unwrap_or(0)
}

fn size_kb(path: &str) -> u64 {
    ["", "-wal"]
        .iter()
        .filter_map(|s| std::fs::metadata(format!("{path}{s}")).ok())
        .map(|m| m.len() / 1024)
        .sum()
}

/// Run each size in its own process, since the peak is a high-water mark.
#[test]
#[ignore = "a measurement, not a regression: run by hand on the build kind being reported"]
fn report() {
    let _serial_state = super::serial_state();
    let sizes = std::env::var("UPGRADE_SCALE_SIZES").unwrap_or_else(|_| "1000".into());
    for n in sizes
        .split(',')
        .filter_map(|s| s.trim().parse::<usize>().ok())
    {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("routes.db");
        let p = path.to_str().unwrap();
        let t = std::time::Instant::now();
        seed_v12_library(&path, n);
        let seed_ms = t.elapsed().as_millis();
        let before_kb = size_kb(p);
        let rss_before = peak_rss_kb();

        let t = std::time::Instant::now();
        assert!(veloqrs::persistence::persistent_engine_ffi::persistent_engine_init(p.to_string()));
        let open_ms = t.elapsed().as_millis();
        let rss_open = peak_rss_kb();
        let owed = veloqrs::ffi::is_cutover_pending();
        // The cutover is held until every track has had its elevation fetched,
        // which is a network run, so it is not part of what is timed here.
        Connection::open(&path)
            .unwrap()
            .execute(
                "UPDATE gps_tracks SET elevation_state = ?",
                [i64::from(veloqrs::persistence::ELEVATION_STATE_FETCHED)],
            )
            .unwrap();

        let t = std::time::Instant::now();
        let (mut resumes, mut cutover_ms) = (0u32, 0u128);
        if owed {
            while {
                let started = veloqrs::ffi::start_detector_cutover();
                assert_eq!(started, veloqrs::objects::FfiStartOutcome::Started);
                while veloqrs::ffi::get_cutover_progress().running {
                    std::thread::sleep(std::time::Duration::from_millis(20));
                }
                veloqrs::ffi::get_cutover_progress().phase != "complete" && {
                    resumes += 1;
                    resumes < 20
                }
            } {}
            cutover_ms = t.elapsed().as_millis();
        }
        let phase = veloqrs::ffi::get_cutover_progress().phase;
        let after_kb = size_kb(p);
        let copy_kb = size_kb(&format!("{p}.pre-upgrade-12"));
        println!(
            "upgrade_scale n={n} seed_ms={seed_ms} open_ms={open_ms} db_before_kb={before_kb} \
             db_after_kb={after_kb} pre_upgrade_copy_kb={copy_kb} \
             rss_hwm_kb_before={rss_before} rss_hwm_kb_open={rss_open} \
             cutover_owed={owed} cutover_ms={cutover_ms} cutover_resumes={resumes} \
             cutover_phase={phase} rss_hwm_kb_after={}",
            peak_rss_kb()
        );
    }
}
