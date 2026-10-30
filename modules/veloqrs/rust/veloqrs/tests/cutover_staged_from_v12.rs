//! The staged upgrade over a database a released 0.3.8 build wrote.
//!
//! Scenario: an athlete with a catalogue they have touched upgrades. The
//! newest rides get their elevation first and the cutover cuts over them, the
//! app is killed between passes, a ride is recorded, and the older rides
//! arrive over two more passes.
//!
//! Expected behaviour: nothing the athlete took hold of changes, every section
//! of the first cut keeps its id and number to the end, no cut reads a track
//! whose elevation is unknown, and the final catalogue is the one a cold cut
//! of the fully elevated library gives.

use httpmock::prelude::*;
use rusqlite::Connection;
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::governor::{AuthMethod, Governor, NoopPolicy};
use veloqrs::net::Transport;
use veloqrs::net::elevation_backfill::{BackfillRun, run_elevation_backfill};
use veloqrs::persistence::persistent_engine_ffi::{
    SECTION_DETECTION_HANDLE, persistent_engine_init_without_owed_work,
};
use veloqrs::persistence::with_persistent_engine;

const FIXTURE: &str = include_str!("fixtures/v12_demo.sql");
const ATHLETE: &str = "i1";
const DAY: i64 = 86_400;
const NEWEST: i64 = 1_700_000_000;
const SLICE_RIDES: usize = 25;
const UNKNOWN: i64 = 0;

/// What the athlete did to the library before the upgrade finished.
struct Touched {
    renamed: String,
    pinned: String,
    hidden: String,
    accepted: String,
    custom: String,
}

impl Touched {
    fn all(&self) -> [&String; 5] {
        [
            &self.renamed,
            &self.pinned,
            &self.hidden,
            &self.accepted,
            &self.custom,
        ]
    }
}

fn open(path: &Path) {
    assert!(persistent_engine_init_without_owed_work(
        path.to_str().unwrap().to_string()
    ));
}

fn live_session() {
    veloqrs::objects::set_credentials_from_native("api_key", "k", ATHLETE)
        .expect("api_key is a known auth method");
}

fn drain_detection() {
    let deadline = Instant::now() + Duration::from_secs(120);
    while SECTION_DETECTION_HANDLE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_some()
        || veloqrs::persistence::cutover::cutover_running()
    {
        assert!(Instant::now() < deadline, "detection never went idle");
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn transport(base: String) -> Transport {
    let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
    Transport::with_governor(base, AuthMethod::ApiKey("k"), gov).expect("transport")
}

fn ride_ids(path: &Path) -> Vec<String> {
    let conn = Connection::open(path).expect("open");
    let mut stmt = conn
        .prepare("SELECT id FROM activities ORDER BY id")
        .unwrap();
    stmt.query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

/// The upstream answer for a ride: its own line with a steady grade.
fn elevated_streams(track: &[GpsPoint]) -> serde_json::Value {
    let lats: Vec<f64> = track.iter().map(|p| p.latitude).collect();
    let lngs: Vec<f64> = track.iter().map(|p| p.longitude).collect();
    let alts: Vec<f64> = (0..track.len()).map(|i| 100.0 + i as f64 * 0.5).collect();
    json!([
        {"type": "latlng", "data": lats, "data2": lngs},
        {"type": "fixed_altitude", "data": alts}
    ])
}

/// Answers the rides in `answer` and refuses every other, so a pass leaves
/// them unknown.
fn upstream(tracks: &BTreeMap<String, Vec<GpsPoint>>, answer: &BTreeSet<String>) -> MockServer {
    let server = MockServer::start();
    for (id, track) in tracks {
        let path = format!("/activity/{id}/streams.json");
        if answer.contains(id) {
            let body = elevated_streams(track);
            server.mock(|when, then| {
                when.path(path);
                then.status(200).json_body(body);
            });
        } else {
            server.mock(|when, then| {
                when.path(path);
                then.status(503);
            });
        }
    }
    server
}

fn pass(tracks: &BTreeMap<String, Vec<GpsPoint>>, answer: &BTreeSet<String>) {
    live_session();
    let server = upstream(tracks, answer);
    let run = run_elevation_backfill(&transport(server.base_url()), ATHLETE);
    assert!(matches!(run, BackfillRun::Finished(_)), "got {run:?}");
    drain_detection();
}

/// The fixture with its rides dated so a newest slice exists, migrated and
/// left with the cutover still owed. Returns the rides' tracks.
fn seed(path: &Path) -> BTreeMap<String, Vec<GpsPoint>> {
    let conn = Connection::open(path).expect("open fixture database");
    // Demo rides are never owed an elevation fetch, so the fixture's ids are
    // renamed to the shape an upstream ride has.
    conn.execute_batch(&FIXTURE.replace("demo-", "ride-"))
        .expect("replay fixture");
    drop(conn);
    open(path);
    let ids = ride_ids(path);
    with_persistent_engine(|e| {
        for (i, id) in ids.iter().enumerate() {
            let date = if i < SLICE_RIDES {
                NEWEST - i as i64 * 2 * DAY
            } else {
                NEWEST - 200 * DAY - i as i64 * DAY
            };
            e.update_activity_metadata(id, Some(date), Some("ride"), Some(12_345.0), Some(3_600))
                .expect("metadata");
        }
        ids.iter()
            .filter_map(|id| e.get_gps_track(id).map(|t| (id.clone(), t)))
            .collect()
    })
    .expect("engine")
}

fn auto_ids(path: &Path) -> Vec<String> {
    let conn = Connection::open(path).expect("open");
    let mut stmt = conn
        .prepare("SELECT id FROM sections WHERE is_user_defined = 0 AND disabled = 0 ORDER BY id")
        .unwrap();
    stmt.query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

/// Hands the athlete's six kinds of ownership to six sections of the catalogue.
fn touch(path: &Path, tracks: &BTreeMap<String, Vec<GpsPoint>>) -> Touched {
    let auto = auto_ids(path);
    assert!(auto.len() >= 4, "the fixture holds too few sections");
    let touched = Touched {
        renamed: auto[0].clone(),
        pinned: auto[1].clone(),
        hidden: auto[2].clone(),
        accepted: auto[3].clone(),
        custom: String::new(),
    };
    let (source, line) = tracks.iter().next().unwrap();
    let custom = with_persistent_engine(|e| {
        e.set_section_name(&touched.renamed, Some("Morning loop"))
            .expect("rename");
        assert!(
            e.pin_section_geometry(&touched.pinned, 1).expect("pin"),
            "the pinned section has no geometry version to pin"
        );
        e.disable_section(&touched.hidden).expect("hide");
        e.accept_section(&touched.accepted).expect("accept");
        e.create_section(veloqrs::sections::CreateSectionParams {
            sport_type: "Ride".into(),
            polyline: line[..10].to_vec(),
            distance_meters: 500.0,
            name: Some("My climb".into()),
            source_activity_id: Some(source.clone()),
            start_index: Some(0),
            end_index: Some(9),
        })
        .expect("custom")
    })
    .expect("engine");
    Touched { custom, ..touched }
}

/// A section's row as the athlete sees it, with the members it holds.
fn section_row(conn: &Connection, id: &str) -> Row {
    conn.query_row(
        "SELECT name, is_user_defined, disabled, distance_meters FROM sections WHERE id = ?",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
    )
    .ok()
}

fn numbers(conn: &Connection) -> BTreeMap<String, i64> {
    let mut stmt = conn
        .prepare("SELECT section_id, number FROM section_numbers")
        .unwrap();
    stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

fn pin_of(id: &str) -> Option<i64> {
    with_persistent_engine(|e| e.pinned_section_version(id)).expect("engine")
}

/// Every auto section's members, id by id.
fn members(conn: &Connection) -> BTreeMap<String, BTreeSet<String>> {
    let mut stmt = conn
        .prepare(
            "SELECT sa.section_id, sa.activity_id FROM section_activities sa
               JOIN sections s ON s.id = sa.section_id
              WHERE s.is_user_defined = 0 AND s.disabled = 0",
        )
        .unwrap();
    let mut out: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for row in stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .unwrap()
    {
        let (s, a) = row.unwrap();
        out.entry(s).or_default().insert(a);
    }
    out
}

fn unknown_rides(conn: &Connection) -> BTreeSet<String> {
    let mut stmt = conn
        .prepare("SELECT activity_id FROM gps_tracks WHERE elevation_state = ?")
        .unwrap();
    stmt.query_map([UNKNOWN], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

type Row = Option<(Option<String>, i64, i64, f64)>;

struct Before {
    rows: BTreeMap<String, Row>,
    pins: BTreeMap<String, Option<i64>>,
}

fn role(touched: &Touched, id: &str) -> &'static str {
    let roles = ["renamed", "pinned", "hidden", "accepted", "custom"];
    touched
        .all()
        .iter()
        .position(|t| t.as_str() == id)
        .map_or("none", |i| roles[i])
}

fn check_touched(path: &Path, touched: &Touched, before: &Before, stage: &str) {
    let conn = Connection::open(path).expect("open");
    for id in touched.all() {
        assert_eq!(
            &section_row(&conn, id),
            &before.rows[id],
            "{stage}: the athlete's section {id} ({}) changed",
            role(touched, id)
        );
        assert_eq!(
            &pin_of(id),
            &before.pins[id],
            "{stage}: the pin on {id} changed"
        );
    }
}

/// The catalogue as a cut left it: auto sections with the rides they hold.
fn catalogue(path: &Path, touched: &Touched) -> BTreeMap<String, BTreeSet<String>> {
    let conn = Connection::open(path).expect("open");
    let mut all = members(&conn);
    for id in touched.all() {
        all.remove(id);
    }
    all
}

/// An ordinary detect and apply, as a sync tail or a launch would run.
fn ordinary_detect() {
    with_persistent_engine(|e| {
        let handle = e.detect_sections_background();
        let (main, cache) = handle.recv_with_cache();
        let (sections, _) = main.expect("detect");
        e.apply_sections_with_cache(sections, cache).expect("apply");
    })
    .expect("engine");
    drain_detection();
}

#[test]
fn a_staged_upgrade_keeps_what_the_athlete_owns_and_ends_on_the_whole_cut() {
    staged_upgrade(false, false);
}

#[test]
fn an_ordinary_detect_between_the_slice_and_the_second_pass_does_not_change_the_end() {
    staged_upgrade(true, false);
}

#[test]
fn an_ordinary_detect_between_the_second_pass_and_the_drain_does_not_change_the_end() {
    staged_upgrade(false, true);
}

fn staged_upgrade(detect_before_second: bool, detect_after_second: bool) {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let tracks = seed(&path);
    let ids: Vec<String> = tracks.keys().cloned().collect();
    assert!(ids.len() > SLICE_RIDES + 10, "too few rides to stage");
    let touched = touch(&path, &tracks);
    assert!(veloqrs::ffi::is_cutover_pending());

    let before = {
        let conn = Connection::open(&path).unwrap();
        Before {
            rows: touched
                .all()
                .into_iter()
                .map(|id| (id.clone(), section_row(&conn, id)))
                .collect(),
            pins: touched
                .all()
                .into_iter()
                .map(|id| (id.clone(), pin_of(id)))
                .collect(),
        }
    };

    // The newest slice lands, the cutover promotes, the rest is refused.
    let slice: BTreeSet<String> = ids
        .iter()
        .filter(|id| {
            let conn = Connection::open(&path).unwrap();
            conn.query_row(
                "SELECT start_date FROM activities WHERE id = ?",
                [id],
                |r| r.get::<_, i64>(0),
            )
            .unwrap()
                > NEWEST - 90 * DAY
        })
        .cloned()
        .collect();
    assert_eq!(slice.len(), SLICE_RIDES);
    pass(&tracks, &slice);

    assert!(
        !veloqrs::ffi::is_cutover_pending(),
        "the cutover did not promote on the decided slice"
    );
    check_touched(&path, &touched, &before, "after the first cut");
    let first = catalogue(&path, &touched);
    assert!(!first.is_empty(), "the first cut made no section");
    let first_numbers = numbers(&Connection::open(&path).unwrap());
    {
        let conn = Connection::open(&path).unwrap();
        let unknown = unknown_rides(&conn);
        for (section, held) in &first {
            let bad: Vec<_> = held.intersection(&unknown).collect();
            assert!(
                bad.is_empty(),
                "{section} was cut from unknown tracks {bad:?}"
            );
        }
    }

    // Killed, reopened, and a ride recorded.
    open(&path);
    let line: Vec<GpsPoint> = tracks[&ids[0]]
        .iter()
        .map(|p| GpsPoint::with_elevation(p.latitude, p.longitude, 120.0))
        .collect();
    with_persistent_engine(|e| {
        e.add_activity("recorded-1".into(), line.clone(), "Ride".into())
            .expect("store");
        e.update_activity_metadata("recorded-1", Some(NEWEST + DAY), Some("ride"), None, None)
            .expect("metadata");
        let handle = e.detect_sections_background();
        let (main, cache) = handle.recv_with_cache();
        let (sections, _) = main.expect("detect");
        e.apply_sections_with_cache(sections, cache).expect("apply");
    })
    .expect("engine");
    drain_detection();
    check_touched(&path, &touched, &before, "after the recorded ride");

    // The rest lands over two passes with a reopen between.
    let rest: Vec<String> = ids
        .iter()
        .filter(|id| !slice.contains(*id))
        .cloned()
        .collect();
    let half = rest.len() / 2;
    let second: BTreeSet<String> = slice
        .iter()
        .cloned()
        .chain(rest[..half].iter().cloned())
        .collect();
    if detect_before_second {
        ordinary_detect();
    }
    pass(&tracks, &second);
    if detect_after_second {
        ordinary_detect();
    }
    check_touched(&path, &touched, &before, "after the second pass");
    open(&path);
    let all: BTreeSet<String> = ids.iter().cloned().collect();
    pass(&tracks, &all);
    check_touched(&path, &touched, &before, "after the drain");

    let conn = Connection::open(&path).unwrap();
    assert!(unknown_rides(&conn).is_empty(), "rides are still unknown");
    let live = numbers(&conn);
    for (section, held) in &first {
        // A section of the first cut is still there, with its number, unless a
        // later cut folded it into a longer one that kept its place.
        if auto_ids(&path).contains(section) {
            assert_eq!(
                live.get(section),
                first_numbers.get(section),
                "{section} lost its number"
            );
        } else {
            let successor = members(&conn).values().any(|later| held.is_subset(later));
            assert!(
                successor,
                "{section} left the catalogue with nothing in its place: held {held:?} now {:?}",
                members(&conn)
            );
        }
    }
    let staged = catalogue(&path, &touched);
    drop(conn);

    // A cold cut of the same library, fully elevated from the start.
    let cold_dir = TempDir::new().unwrap();
    let cold_path = cold_dir.path().join("routes.db");
    let cold_tracks = seed(&cold_path);
    let cold_touched = touch(&cold_path, &cold_tracks);
    assert_eq!(
        cold_touched.all()[..4],
        touched.all()[..4],
        "the same sections were touched"
    );
    with_persistent_engine(|e| {
        e.add_activity("recorded-1".into(), line.clone(), "Ride".into())
            .expect("store");
        e.update_activity_metadata("recorded-1", Some(NEWEST + DAY), Some("ride"), None, None)
            .expect("metadata");
    })
    .expect("engine");
    let cold_all: BTreeSet<String> = cold_tracks.keys().cloned().collect();
    pass(&cold_tracks, &cold_all);
    let cold = catalogue(&cold_path, &touched);

    let sizes = |c: &BTreeMap<String, BTreeSet<String>>| -> BTreeMap<String, usize> {
        c.iter().map(|(id, m)| (id.clone(), m.len())).collect()
    };
    assert!(
        staged == cold,
        "the staged catalogue is not the cold one, section for section\n\
         staged (id: members): {:?}\ncold: {:?}",
        sizes(&staged),
        sizes(&cold)
    );
}
