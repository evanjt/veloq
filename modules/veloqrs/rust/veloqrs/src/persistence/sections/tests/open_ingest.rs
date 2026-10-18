//! A download's conditioning runs replay the whole ingest from where it began.
//!
//! A backfill stores its rides in the order the download finishes them, with
//! the newest the feed shows first, and a conditioning run fires every few
//! dozen stores. Each run applies every ride of the ingest stored so far, in
//! date order, to the registry as it stood before the ingest, so the view the
//! last run leaves is the view one detect of the same rides leaves. A run's
//! view is provisional until the download has ended and every stored ride has
//! been detected: the next run supersedes its ids and its ledger rows.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::Arc;

use tempfile::TempDir;
use tracematch::{Direction, FrequentSection, GpsPoint, SectionPortion};

use crate::persistence::{PersistentEngine, codec};

/// A line of `n` points running north from `lat`, about 11 m apart.
fn line_at(lat: f64, n: u32) -> Vec<GpsPoint> {
    (0..n)
        .map(|i| GpsPoint::new(lat + f64::from(i) * 0.000_1, 7.0))
        .collect()
}

/// The corridor the seed cuts long.
fn long_line() -> Vec<GpsPoint> {
    line_at(46.0, 40)
}

/// Its first half, the re-cut the ingest's latest corridor ride proposes.
fn short_line() -> Vec<GpsPoint> {
    line_at(46.0, 20)
}

/// Ground the ingest forms a new section on.
fn elsewhere() -> Vec<GpsPoint> {
    line_at(46.5, 40)
}

/// Ground no cut covers: a ride there arrives and rides nothing.
fn nowhere() -> Vec<GpsPoint> {
    line_at(47.0, 40)
}

/// A raw detection cut on `line`, each member passing the whole of it.
fn cut(line: Vec<GpsPoint>, members: &[&str]) -> FrequentSection {
    let distance = tracematch::matching::calculate_route_distance(&line);
    let end = (line.len() - 1) as u32;
    FrequentSection {
        id: "raw".to_string(),
        name: None,
        sport_type: "Ride".to_string(),
        distance_meters: distance,
        point_density: vec![members.len() as u32; line.len()],
        representative_activity_id: members[0].to_string(),
        representative_range: Some((0, end)),
        polyline: line,
        activity_ids: members.iter().map(|m| m.to_string()).collect(),
        visit_count: members.len() as u32,
        activity_portions: members
            .iter()
            .map(|m| SectionPortion {
                activity_id: m.to_string(),
                start_index: 0,
                end_index: end,
                distance_meters: distance,
                direction: Direction::Same,
            })
            .collect(),
        activity_traces: HashMap::new(),
        confidence: 0.9,
        observation_count: members.len() as u32,
        average_spread: 4.0,
        scale: None,
        is_user_defined: false,
        stability: 1.0,
        elevation_gain_m: None,
        avg_grade_percent: None,
        version: 0,
        updated_at: None,
        created_at: None,
        enrichment: Default::default(),
        rank: None,
    }
}

/// Midnight UTC on a day of 2026, as the store keeps a start date.
const fn day(n: i64) -> i64 {
    1_767_225_600 + n * 86_400
}

const SEED: [&str; 2] = ["seed-1", "seed-2"];

/// The ingest's rides, each with its date and track. In date order: the two
/// rides that form the new section, three that ride nothing, and last the one
/// ride that proposes cutting the corridor short. One sync per ride would have
/// shown that re-cut once, so it waits.
fn ride(id: &str) -> (i64, Vec<GpsPoint>) {
    match id {
        "away-1" => (day(5), elsewhere()),
        "away-2" => (day(6), elsewhere()),
        "idle-1" => (day(10), nowhere()),
        "idle-2" => (day(11), nowhere()),
        "idle-3" => (day(12), nowhere()),
        "corridor" => (day(13), long_line()),
        "after" => (day(14), nowhere()),
        other => panic!("no ride {other}"),
    }
}

/// The download's order: the newest two the feed shows first, then the rest
/// as the sync listed them. Each chunk is stored before one conditioning run.
const CHUNKS: [&[&str]; 3] = [
    &["corridor", "idle-3"],
    &["away-1", "away-2"],
    &["idle-1", "idle-2"],
];

/// What detection cuts once `stored` are in the pool: the corridor cut short
/// with its one new rider, and the new ground once both its rides are there.
fn catalogue(stored: &BTreeSet<&str>) -> Vec<FrequentSection> {
    let mut sections = Vec::new();
    let mut corridor: Vec<&str> = SEED.to_vec();
    if stored.contains("corridor") {
        corridor.push("corridor");
        sections.push(cut(short_line(), &corridor));
    } else {
        sections.push(cut(long_line(), &corridor));
    }
    if stored.contains("away-1") && stored.contains("away-2") {
        sections.push(cut(elsewhere(), &["away-1", "away-2"]));
    }
    sections
}

fn open(path: &std::path::Path) -> PersistentEngine {
    PersistentEngine::new(path.to_str().unwrap()).expect("engine")
}

fn store(engine: &mut PersistentEngine, id: &str) {
    let (date, track) = ride(id);
    engine
        .add_activity(id.into(), track, "Ride".into())
        .expect("add_activity");
    engine
        .update_activity_metadata(id, Some(date), None, None, None)
        .expect("update_activity_metadata");
}

/// A detect over everything stored: the apply, then the processed ids. A
/// detect with nothing new applies nothing, as the worker's does not.
fn detect(engine: &mut PersistentEngine, stored: &BTreeSet<&str>) {
    if !engine.detection_owed() {
        return;
    }
    engine
        .apply_sections(catalogue(stored))
        .expect("apply_sections");
    let ids: Vec<String> = engine.get_activity_ids();
    engine.save_processed_activity_ids(&ids).expect("processed");
}

/// An engine holding the corridor cut long from the two seed rides.
fn seeded(dir: &TempDir) -> (PersistentEngine, std::path::PathBuf, BTreeSet<&'static str>) {
    let path = dir.path().join("ingest.db");
    let mut engine = open(&path);
    for (i, id) in SEED.iter().enumerate() {
        engine
            .add_activity((*id).into(), long_line(), "Ride".into())
            .expect("add_activity");
        engine
            .update_activity_metadata(id, Some(day(i as i64)), None, None, None)
            .expect("update_activity_metadata");
    }
    let stored: BTreeSet<&str> = SEED.into_iter().collect();
    detect(&mut engine, &stored);
    assert_eq!(
        engine.get_sections().len(),
        1,
        "the seed holds the corridor"
    );
    (engine, path, stored)
}

/// Every ingest ride stored, then one detect.
fn one_detect(dir: &TempDir) -> PersistentEngine {
    let (mut engine, _, mut stored) = seeded(dir);
    for id in CHUNKS.concat() {
        store(&mut engine, id);
        stored.insert(id);
    }
    detect(&mut engine, &stored);
    engine
}

/// A visible section's line, as coordinate bits, and its members.
type Shown = (Vec<(u64, u64)>, BTreeSet<String>);

/// What the athlete sees and the ledger keeps, with nothing that reads the
/// clock.
struct Outcome {
    /// Each visible section's id, line and members.
    view: BTreeMap<String, Shown>,
    /// The registry, birth stamps cleared.
    registry: Vec<u8>,
    /// Each ledger row's section and kind, in the order written.
    history: Vec<(String, String)>,
    /// Each geometry version kept, by section.
    geometry: Vec<(String, i64)>,
}

/// Field by field, so a failure names what differs.
fn assert_same(actual: &PersistentEngine, expected: &PersistentEngine) {
    let (actual, expected) = (outcome(actual), outcome(expected));
    let members = |o: &Outcome| -> BTreeMap<String, BTreeSet<String>> {
        o.view
            .iter()
            .map(|(id, (_, m))| (id.clone(), m.clone()))
            .collect()
    };
    assert_eq!(
        members(&actual),
        members(&expected),
        "the visible ids and members"
    );
    assert_eq!(actual.view, expected.view, "the visible lines");
    assert_eq!(actual.history, expected.history, "the ledger");
    assert_eq!(actual.geometry, expected.geometry, "the geometry versions");
    assert!(
        actual.registry == expected.registry,
        "the registries differ"
    );
}

fn outcome(engine: &PersistentEngine) -> Outcome {
    let view = engine
        .get_sections()
        .iter()
        .map(|s| {
            let line = s
                .polyline
                .iter()
                .map(|p| (p.latitude.to_bits(), p.longitude.to_bits()))
                .collect();
            (
                s.id.clone(),
                (line, s.activity_ids.iter().cloned().collect()),
            )
        })
        .collect();
    let mut identity = engine.identity.clone();
    for row in identity.rows.values_mut() {
        Arc::make_mut(&mut row.section).created_at = None;
    }
    for grave in identity.graves.values_mut() {
        grave.created_at = None;
    }
    let rows = |sql: &str| -> Vec<(String, String)> {
        let mut stmt = engine.db.prepare(sql).expect("prepare");
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("query")
            .map(|r| r.expect("row"))
            .collect()
    };
    let geometry = {
        let mut stmt = engine
            .db
            .prepare(
                "SELECT section_id, version FROM section_geometry ORDER BY section_id, version",
            )
            .expect("prepare");
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("query")
            .map(|r| r.expect("row"))
            .collect()
    };
    Outcome {
        view,
        registry: codec::serialize_named(&identity).expect("encode"),
        history: rows("SELECT section_id, kind FROM section_history ORDER BY id"),
        geometry,
    }
}

/// Store the chunks in download order with a conditioning run after each,
/// end the download and run the sync-end detect. `kill_after` drops the
/// engine and opens the library again after that many runs, as a process
/// killed mid-backfill comes back.
fn backfill(dir: &TempDir, kill_after: Option<usize>) -> PersistentEngine {
    let (mut engine, path, mut stored) = seeded(dir);
    engine.ingest_download_started();
    for (run, chunk) in CHUNKS.iter().enumerate() {
        for id in *chunk {
            store(&mut engine, id);
            stored.insert(id);
        }
        detect(&mut engine, &stored);
        if kill_after == Some(run + 1) {
            drop(engine);
            engine = open(&path);
            engine.load().expect("load");
            engine.ingest_download_started();
        }
    }
    engine.ingest_download_ended();
    detect(&mut engine, &stored);
    engine
}

/// Scenario: the ingest stored in download order with a conditioning run
/// after each chunk. Counted chunk by chunk, the re-cut that only the latest
/// ride proposes is confirmed once per run and applies on the third, and the
/// section the second run forms is minted again by the third.
/// Expected behaviour: the view, the ids, the registry and the ledger are
/// those of one detect over the same rides, where the re-cut waits.
#[test]
fn a_backfill_run_by_run_ends_where_one_detect_of_its_rides_ends() {
    let reference = TempDir::new().expect("tempdir");
    let chunked = TempDir::new().expect("tempdir");
    let reference = one_detect(&reference);
    let chunked = backfill(&chunked, None);

    assert_eq!(
        outcome(&reference).view.len(),
        2,
        "the corridor held long and the new ground"
    );
    assert_same(&chunked, &reference);
    assert!(!chunked.section_identity_ingest_base_held());
}

/// Scenario: the same backfill, the process killed after the second run and
/// the download resumed in the next one.
/// Expected behaviour: the ingest carries on from the registry it began on,
/// so the end is the same as an uninterrupted backfill's.
#[test]
fn a_backfill_killed_mid_way_resumes_the_same_ingest() {
    let reference = TempDir::new().expect("tempdir");
    let killed = TempDir::new().expect("tempdir");
    let reference = one_detect(&reference);
    let killed = backfill(&killed, Some(2));

    assert_same(&killed, &reference);
}

/// Scenario: a run's view before the download ends.
/// Expected behaviour: the registry holds where the ingest began, so the next
/// run can replay from it, and the run's own section is visible meanwhile.
#[test]
fn a_run_before_the_download_ends_is_provisional() {
    let dir = TempDir::new().expect("tempdir");
    let (mut engine, _, mut stored) = seeded(&dir);
    engine.ingest_download_started();
    for chunk in &CHUNKS[..2] {
        for id in *chunk {
            store(&mut engine, id);
            stored.insert(id);
        }
        detect(&mut engine, &stored);
    }

    assert!(engine.section_identity_ingest_base_held());
    assert_eq!(
        engine.get_sections().len(),
        2,
        "the new ground shows mid-backfill"
    );
}

/// Scenario: the download ends while the last run's detect has not covered
/// every stored ride.
/// Expected behaviour: the ingest stays open until a detect covers them, and
/// closes after it.
#[test]
fn an_ingest_closes_only_once_every_stored_ride_is_detected() {
    let dir = TempDir::new().expect("tempdir");
    let (mut engine, _, mut stored) = seeded(&dir);
    engine.ingest_download_started();
    for id in CHUNKS[0] {
        store(&mut engine, id);
        stored.insert(id);
    }
    detect(&mut engine, &stored);
    for id in CHUNKS[1] {
        store(&mut engine, id);
    }
    engine.ingest_download_ended();
    assert!(
        engine.section_identity_ingest_base_held(),
        "the rides stored after the last run are owed a detect"
    );

    for id in CHUNKS[1] {
        stored.insert(id);
    }
    detect(&mut engine, &stored);
    assert!(!engine.section_identity_ingest_base_held());
}

/// Scenario: after a backfill has closed, a sync brings one more ride.
/// Expected behaviour: it is a step of its own, as on the engine that took the
/// backfill in one detect: the re-cut gains one confirmation and still waits.
#[test]
fn a_sync_after_the_backfill_is_its_own_ingest() {
    let reference = TempDir::new().expect("tempdir");
    let chunked = TempDir::new().expect("tempdir");
    let mut reference = one_detect(&reference);
    let mut chunked = backfill(&chunked, None);
    for engine in [&mut reference, &mut chunked] {
        engine.ingest_download_started();
        store(engine, "after");
        engine.ingest_download_ended();
        let mut stored: BTreeSet<&str> = CHUNKS.concat().into_iter().collect();
        stored.extend(SEED);
        stored.insert("after");
        detect(engine, &stored);
    }

    assert_same(&chunked, &reference);
    assert_eq!(
        chunked.identity.hysteresis.pending_ids().len(),
        1,
        "the re-cut still waits"
    );
}

/// Scenario: a sync that stores too few rides to fire a run mid-download.
/// Expected behaviour: its one run comes after the download, so nothing about
/// the registry it began on is ever recorded.
#[test]
fn a_sync_with_no_run_mid_download_records_no_state() {
    let dir = TempDir::new().expect("tempdir");
    let (mut engine, _, mut stored) = seeded(&dir);
    engine.ingest_download_started();
    for id in CHUNKS[0] {
        store(&mut engine, id);
        stored.insert(id);
    }
    engine.ingest_download_ended();
    assert!(!engine.section_identity_ingest_base_held());
    detect(&mut engine, &stored);
    assert!(!engine.section_identity_ingest_base_held());
}
