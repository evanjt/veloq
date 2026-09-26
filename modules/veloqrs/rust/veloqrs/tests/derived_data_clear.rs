//! Clear cache empties what the engine can re-derive and keeps what the
//! athlete made. The catalogue side is the detection wipe's own predicate,
//! the activity side is the retention delete's reference exclusion, so a
//! hand-cut, trimmed or disabled section and the stream its geometry is cut
//! from survive by construction.
//!
//! Run: `cargo test --test derived_data_clear -p veloqrs`

use std::path::{Path, PathBuf};

use rusqlite::Connection;
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::persistence::codec;
use veloqrs::sections::CreateSectionParams;
use veloqrs::{ActivityMetrics, PersistentEngine};

fn track() -> Vec<GpsPoint> {
    (0..60)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0001,
            longitude: 7.0,
            elevation: None,
        })
        .collect()
}

fn count(db: &Connection, sql: &str) -> i64 {
    db.query_row(sql, [], |row| row.get(0))
        .unwrap_or_else(|e| panic!("{sql}: {e}"))
}

fn insert_section(db: &Connection, id: &str, kind: &str, trimmed: bool, disabled: bool) {
    let line = codec::serialize_track_points(&track()[0..12]);
    db.execute(
        "INSERT INTO sections
                 (id, section_type, name, sport_type, polyline_json, original_polyline_json,
                  polyline_blob, distance_meters, representative_activity_id, rep_start_index,
                  rep_end_index, geometry_source, created_at, is_user_defined, disabled,
                  bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
             VALUES (?1, ?2, ?1, 'Ride', NULL, ?3, ?4, 1200.0, 'rep', 0, 12, 'exact',
                     '2026-01-01T00:00:00Z', ?5, ?6, 46.0, 46.1, 7.0, 7.1)",
        rusqlite::params![
            id,
            kind,
            trimmed.then_some("[]"),
            line,
            i32::from(kind == "custom"),
            i32::from(disabled),
        ],
    )
    .expect("insert section");
    db.execute(
        "INSERT INTO section_activities (section_id, activity_id, start_index, end_index)
             VALUES (?, 'plain', 0, 12)",
        [id],
    )
    .expect("insert member");
}

fn open(path: &Path) -> PersistentEngine {
    PersistentEngine::new(path.to_str().unwrap()).expect("engine")
}

/// Three activities, four sections and every derived cache filled, on disk
/// and ready to open.
///
/// `rep` carries the hand-cut section's geometry, `versioned` a pinned
/// geometry version, `plain` nothing but its own track. All three are older
/// than any sync range.
fn seed(dir: &TempDir) -> PathBuf {
    let path = dir.path().join("clear.db");
    let mut engine = open(&path);
    for id in ["rep", "versioned", "plain"] {
        engine
            .add_activity(id.into(), track(), "Ride".into())
            .expect("add activity");
        engine
            .update_activity_metadata(id, Some(1_600_000_000), None, None, None)
            .expect("metadata");
    }
    engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".into(),
            polyline: track()[0..30].to_vec(),
            distance_meters: 900.0,
            name: Some("Home climb".into()),
            source_activity_id: Some("rep".into()),
            start_index: Some(0),
            end_index: Some(29),
        })
        .expect("custom section");
    drop(engine);

    let db = Connection::open(&path).expect("raw open");
    db.execute(
        "UPDATE activities SET created_at = strftime('%s', 'now') - 400 * 86400",
        [],
    )
    .expect("age the activities");
    insert_section(&db, "s_auto", "auto", false, false);
    insert_section(&db, "s_trimmed", "auto", true, false);
    insert_section(&db, "s_disabled", "auto", false, true);
    db.execute_batch(
            "INSERT INTO section_geometry
                 (section_id, version, blob, rep_activity_id, rep_start_index, rep_end_index, source)
             VALUES ('s_auto', 1, x'00', 'versioned', 0, 12, 'exact');
             INSERT INTO section_pins (section_id, version) VALUES ('s_auto', 1);
             INSERT INTO section_history (section_id, kind) VALUES ('s_auto', 'pinned');
             INSERT INTO section_intents (id, kind, polyline_json)
                 VALUES ('s_gone', 'deleted', '[]');
             INSERT INTO identity_state (key, blob) VALUES ('registry', x'00');
             INSERT INTO route_names (route_id, custom_name) VALUES ('r1', 'Loop');
             INSERT INTO section_catalogue_archive (token, section_id, sport_type)
                 VALUES ('unified-1', 'archived', 'Ride');
             INSERT INTO route_groups (id, representative_id, activity_ids, sport_type)
                 VALUES ('r1', 'plain', 'plain', 'Ride');
             INSERT INTO activity_matches (route_id, activity_id, match_percentage, direction)
                 VALUES ('r1', 'plain', 1.0, 'same');
             INSERT INTO overlap_cache (activity_a, activity_b, has_overlap, computed_at)
                 VALUES ('rep', 'plain', 1, 0);
             INSERT INTO processed_activities (activity_id) VALUES ('plain');
             INSERT INTO evidence_cache (id, config_digest, folded_ids, cache, updated_at)
                 VALUES (1, 'd', x'00', x'00', 0);",
        )
        .expect("fill the caches");
    path
}

#[test]
fn a_clear_takes_the_auto_sections_and_keeps_the_athletes_own() {
    let dir = TempDir::new().unwrap();
    let path = seed(&dir);
    let mut engine = open(&path);
    let db = Connection::open(&path).expect("raw open");

    let cleared = engine.clear_derived().expect("clear");

    assert_eq!(cleared.sections_removed, 1);
    let ids: Vec<String> = db
        .prepare("SELECT id FROM sections ORDER BY id")
        .and_then(|mut s| {
            s.query_map([], |r| r.get::<_, String>(0))
                .map(|rows| rows.filter_map(Result::ok).collect())
        })
        .expect("ids");
    assert_eq!(
        ids.len(),
        3,
        "custom, trimmed and disabled survive: {ids:?}"
    );
    assert!(!ids.contains(&"s_auto".to_string()));
    assert!(ids.contains(&"s_trimmed".to_string()));
    assert!(ids.contains(&"s_disabled".to_string()));
    let summaries: Vec<String> = engine
        .get_section_summaries()
        .into_iter()
        .map(|s| s.id)
        .collect();
    assert!(
        !summaries.contains(&"s_auto".to_string()),
        "the in-memory catalogue still lists the auto section: {summaries:?}"
    );
    assert!(
        summaries.contains(&"s_trimmed".to_string()),
        "{summaries:?}"
    );
}

#[test]
fn a_clear_keeps_every_activity_a_section_references() {
    let dir = TempDir::new().unwrap();
    let path = seed(&dir);
    let mut engine = open(&path);
    let db = Connection::open(&path).expect("raw open");

    let cleared = engine.clear_derived().expect("clear");

    assert_eq!(cleared.activities_removed, 1);
    assert_eq!(cleared.activities_kept, 2);
    let mut kept = engine.get_activity_ids();
    kept.sort();
    assert_eq!(kept, vec!["rep".to_string(), "versioned".to_string()]);
    assert_eq!(count(&db, "SELECT COUNT(*) FROM gps_tracks"), 2);
    assert_eq!(
        count(
            &db,
            "SELECT COUNT(*) FROM gps_tracks WHERE activity_id = 'plain'"
        ),
        0,
        "the plain activity's track outlived it"
    );
    let members: Vec<(String, String)> = db
        .prepare("SELECT section_id, activity_id FROM section_activities ORDER BY 1, 2")
        .and_then(|mut s| {
            s.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
                .map(|rows| rows.filter_map(Result::ok).collect())
        })
        .expect("members");
    assert!(
        members.iter().all(|(_, a)| a != "plain"),
        "a spared section still names the removed activity: {members:?}"
    );
}

#[test]
fn a_clear_leaves_the_record_tables_alone() {
    let dir = TempDir::new().unwrap();
    let path = seed(&dir);
    let mut engine = open(&path);
    let db = Connection::open(&path).expect("raw open");

    engine.clear_derived().expect("clear");

    for table in [
        "section_geometry",
        "section_pins",
        "section_history",
        "section_intents",
        "identity_state",
        "route_names",
        "section_catalogue_archive",
    ] {
        assert_eq!(
            count(&db, &format!("SELECT COUNT(*) FROM {table}")),
            1,
            "{table} is the athlete's and was touched"
        );
    }
    assert!(
        engine.section_ids_a_mint_must_avoid().contains("s_auto"),
        "the pinned id is still spoken for"
    );
}

#[test]
fn a_clear_empties_the_derived_caches() {
    let dir = TempDir::new().unwrap();
    let path = seed(&dir);
    let mut engine = open(&path);
    let db = Connection::open(&path).expect("raw open");

    engine.clear_derived().expect("clear");

    for table in [
        "route_groups",
        "activity_matches",
        "overlap_cache",
        "processed_activities",
        "evidence_cache",
    ] {
        assert_eq!(
            count(&db, &format!("SELECT COUNT(*) FROM {table} WHERE 1")),
            0,
            "{table} survived the clear"
        );
    }
    assert_eq!(
        count(
            &db,
            "SELECT COUNT(*) FROM signatures WHERE activity_id = 'plain'"
        ),
        0,
        "the removed activity's signature survived"
    );
    let stats = engine.stats();
    assert_eq!(stats.group_count, 0);
    assert!(stats.sections_dirty, "the next detect has to re-cut");
}

#[test]
fn a_second_clear_finds_nothing_and_does_not_fail() {
    let dir = TempDir::new().unwrap();
    let path = seed(&dir);
    let mut engine = open(&path);
    let db = Connection::open(&path).expect("raw open");

    engine.clear_derived().expect("first");
    let again = engine.clear_derived().expect("second");

    assert_eq!(count(&db, "SELECT COUNT(*) FROM activities"), 2);
    assert_eq!(again.sections_removed, 0);
    assert_eq!(again.activities_removed, 0);
    assert_eq!(again.activities_kept, 2);
}

#[test]
fn an_empty_engine_clears_to_zero() {
    let dir = TempDir::new().unwrap();
    let mut engine = open(&dir.path().join("empty.db"));

    let cleared = engine.clear_derived().expect("clear");

    assert_eq!(cleared.sections_removed, 0);
    assert_eq!(cleared.activities_removed, 0);
    assert_eq!(cleared.activities_kept, 0);
}

/// Scenario: the athlete takes one attempt out of a route and one lap out of a
/// section they hand-trimmed, on an activity the clear keeps, then clears the
/// derived data.
///
/// Expected behaviour: both decisions stand. `persistence::tables` declares the
/// `excluded` column of `activity_matches` and `section_activities` as the
/// record part of two otherwise derived tables, and this is the path that
/// promises to keep what the athlete made.
#[test]
fn a_clear_keeps_the_attempts_and_laps_the_athlete_took_out() {
    let dir = TempDir::new().unwrap();
    let path = seed(&dir);
    let db = Connection::open(&path).expect("raw open");
    db.execute(
        "INSERT INTO activity_matches (route_id, activity_id, match_percentage, direction, excluded)
         VALUES ('r1', 'rep', 1.0, 'same', 1)",
        [],
    )
    .expect("exclude the attempt");
    db.execute(
        "INSERT INTO section_activities (section_id, activity_id, start_index, end_index, excluded)
         VALUES ('s_trimmed', 'rep', 0, 12, 1)",
        [],
    )
    .expect("exclude the lap");

    let mut engine = open(&path);
    engine.clear_derived().expect("clear");
    drop(engine);

    assert_eq!(
        count(
            &db,
            "SELECT COUNT(*) FROM activity_matches
             WHERE route_id = 'r1' AND activity_id = 'rep' AND excluded = 1"
        ),
        1,
        "the attempt the athlete took out of the route must survive a derived clear"
    );
    assert_eq!(
        count(
            &db,
            "SELECT COUNT(*) FROM section_activities
             WHERE section_id = 's_trimmed' AND activity_id = 'rep' AND excluded = 1"
        ),
        1,
        "the lap the athlete took out of a surviving section must survive a derived clear"
    );
}

/// The engine's own reset makes the same promise, and it removes no activity
/// at all, so nothing else can explain a lost exclusion.
#[test]
fn clearing_routes_and_sections_keeps_the_attempts_the_athlete_took_out() {
    let dir = TempDir::new().unwrap();
    let path = seed(&dir);
    let db = Connection::open(&path).expect("raw open");
    db.execute(
        "UPDATE activity_matches SET excluded = 1 WHERE route_id = 'r1' AND activity_id = 'plain'",
        [],
    )
    .expect("exclude the attempt");

    let mut engine = open(&path);
    engine
        .clear_routes_and_sections()
        .expect("clear routes and sections");
    drop(engine);

    assert_eq!(
        count(
            &db,
            "SELECT COUNT(*) FROM activity_matches
             WHERE route_id = 'r1' AND activity_id = 'plain' AND excluded = 1"
        ),
        1,
        "a route reset must not throw away the attempts the athlete took out"
    );
}

/// An exclusion the athlete never made must not appear, so the restore is a
/// restore and not a blanket re-flag.
#[test]
fn a_clear_invents_no_exclusion_that_was_never_made() {
    let dir = TempDir::new().unwrap();
    let path = seed(&dir);
    let db = Connection::open(&path).expect("raw open");

    let mut engine = open(&path);
    engine.clear_derived().expect("clear");
    drop(engine);

    assert_eq!(
        count(
            &db,
            "SELECT COUNT(*) FROM activity_matches WHERE excluded = 1"
        ),
        0,
        "nothing was excluded, so nothing may come back excluded"
    );
    assert_eq!(
        count(
            &db,
            "SELECT COUNT(*) FROM section_activities WHERE excluded = 1"
        ),
        0
    );
}

/// Every table that holds an activity id with no foreign key to it, with the
/// seed for one row. `activity_matches` and `activity_indicators` are seeded
/// in a shape the catalogue wipe itself spares, an excluded attempt and a
/// record on a surviving section, so a row that goes can only have gone with
/// its activity.
fn activity_keyed_seeds() -> Vec<(&'static str, &'static str)> {
    vec![
        (
            "activity_bodies",
            "INSERT INTO activity_bodies (activity_id, date, raw) VALUES (?1, 0, '{}')",
        ),
        (
            "activity_metrics",
            "INSERT INTO activity_metrics (activity_id, name, date, distance, moving_time,
                 elapsed_time, elevation_gain, sport_type)
             VALUES (?1, 'n', 0, 0, 0, 0, 0, 'Ride')",
        ),
        (
            "activity_indicators",
            "INSERT INTO activity_indicators
                 (activity_id, indicator_type, target_id, direction, computed_at)
             VALUES (?1, 'section_pr', 's_trimmed', 'same', 0)",
        ),
        (
            "activity_matches",
            "INSERT INTO activity_matches
                 (route_id, activity_id, match_percentage, direction, excluded)
             VALUES ('r_kept', ?1, 1.0, 'same', 1)",
        ),
        (
            "activity_streams",
            "INSERT INTO activity_streams (activity_id, kind, data, sample_count)
             VALUES (?1, 'watts', X'00', 1)",
        ),
        (
            "activity_stream_backfill",
            "INSERT INTO activity_stream_backfill (activity_id) VALUES (?1)",
        ),
        (
            "stream_bodies",
            "INSERT INTO stream_bodies (activity_id, types, raw) VALUES (?1, 'watts', '{}')",
        ),
        (
            "interval_bodies",
            "INSERT INTO interval_bodies (activity_id, raw) VALUES (?1, '{}')",
        ),
        (
            "exercise_sets",
            "INSERT INTO exercise_sets (activity_id, set_order, exercise_category, set_type)
             VALUES (?1, 0, 0, 0)",
        ),
        (
            "fit_file_status",
            "INSERT INTO fit_file_status (activity_id, processed_at) VALUES (?1, 0)",
        ),
        (
            "ftp_history",
            "INSERT INTO ftp_history (date, ftp, activity_id)
             VALUES ((SELECT COUNT(*) FROM ftp_history), 250, ?1)",
        ),
        (
            "eftp_changes",
            "INSERT INTO eftp_changes (activity_id, date, eftp, delta, activity_name)
             VALUES (?1, 0, 250.0, 0.0, 'n')",
        ),
    ]
}

/// The tables holding an activity id that a removal reaches some other way,
/// or that are not the activity's to lose: the four the foreign key cascade
/// empties, the processed list the clear empties whole, the frozen cutover
/// archive, and the push worker's run log.
const REACHED_OTHERWISE: &[&str] = &[
    "gps_tracks",
    "signatures",
    "time_streams",
    "section_activities",
    "processed_activities",
    "section_catalogue_archive_members",
    "push_runs",
];

fn keyed_rows(db: &Connection, table: &str, id: &str) -> i64 {
    db.query_row(
        &format!("SELECT COUNT(*) FROM {table} WHERE activity_id = ?1"),
        [id],
        |row| row.get(0),
    )
    .unwrap_or_else(|e| panic!("{table}: {e}"))
}

/// The seed list is read against the schema, so a table added with an
/// `activity_id` column and no seed here fails rather than going untested.
#[test]
fn the_seeds_cover_every_table_keyed_on_an_activity() {
    let dir = TempDir::new().unwrap();
    let path = seed(&dir);
    let db = Connection::open(&path).expect("raw open");
    let mut schema: Vec<String> = db
        .prepare(
            "SELECT m.name FROM sqlite_master m
             JOIN pragma_table_info(m.name) p
             WHERE m.type = 'table' AND p.name = 'activity_id'
             ORDER BY m.name",
        )
        .and_then(|mut s| {
            s.query_map([], |r| r.get::<_, String>(0))
                .map(|rows| rows.filter_map(Result::ok).collect())
        })
        .expect("schema");
    schema.retain(|t| !REACHED_OTHERWISE.contains(&t.as_str()));
    let mut seeded: Vec<String> = activity_keyed_seeds()
        .iter()
        .map(|(t, _)| (*t).to_string())
        .collect();
    seeded.sort();
    assert_eq!(schema, seeded);
}

/// Scenario: a library whose oldest rides no section references, cleared.
///
/// Expected behaviour: every row keyed on a removed activity goes with it, in
/// every table, and the activity the clear keeps keeps all of its own. The
/// cascade reaches four tables, so a bare activity delete stranded the feed
/// body, the metrics every aggregate counts and the stream bytes the clear
/// exists to free.
#[test]
fn a_clear_takes_every_row_keyed_on_a_removed_activity() {
    let dir = TempDir::new().unwrap();
    let path = seed(&dir);
    // Opened first: an open recomputes a stale indicator table, which would
    // take the seeded rows before the clear could.
    let mut engine = open(&path);
    let db = Connection::open(&path).expect("raw open");
    for id in ["plain", "rep"] {
        for (table, sql) in activity_keyed_seeds() {
            db.execute(sql, [id])
                .unwrap_or_else(|e| panic!("seed {table} for {id}: {e}"));
        }
    }

    engine.clear_derived().expect("clear");
    drop(engine);

    for (table, _) in activity_keyed_seeds() {
        assert_eq!(
            keyed_rows(&db, table, "plain"),
            0,
            "{table} still holds the removed activity"
        );
        assert_eq!(
            keyed_rows(&db, table, "rep"),
            1,
            "{table} lost a row of the activity the clear keeps"
        );
    }
}

/// Scenario: a table added later, holding athlete data keyed on an activity,
/// that no clear list names.
///
/// Expected behaviour: the clear leaves it alone. The clear deletes by name
/// and by predicate, so a table it was never told about keeps its rows even
/// for an activity the clear removes.
#[test]
fn a_clear_keeps_a_table_it_was_never_told_about() {
    let dir = TempDir::new().unwrap();
    let path = seed(&dir);
    let db = Connection::open(&path).expect("raw open");
    db.execute_batch(
        "CREATE TABLE athlete_notes (activity_id TEXT NOT NULL, note TEXT NOT NULL);
         INSERT INTO athlete_notes VALUES ('plain', 'headwind'), ('rep', 'new wheels');",
    )
    .expect("a new plain table");

    let mut engine = open(&path);
    let cleared = engine.clear_derived().expect("clear");
    drop(engine);

    assert_eq!(cleared.activities_removed, 1, "plain went");
    assert_eq!(keyed_rows(&db, "athlete_notes", "plain"), 1);
    assert_eq!(keyed_rows(&db, "athlete_notes", "rep"), 1);
}

/// The widget's own window, wide enough to hold every seeded date.
fn latest_is_pr(engine: &mut PersistentEngine) -> bool {
    engine
        .widget_snapshot_data(0, 2_000_000_000, 0, 1, 7, 10)
        .latest_is_pr
}

/// `versioned` is the latest ride and holds a record on the auto section,
/// `rep` holds one on the athlete's own section. Returns that section's id.
/// Seeded after the engine opens, since an open recomputes a stale
/// indicator table.
fn seed_section_records(engine: &mut PersistentEngine, db: &Connection) -> String {
    let custom: String = db
        .query_row(
            "SELECT id FROM sections WHERE section_type = 'custom'",
            [],
            |row| row.get(0),
        )
        .expect("the hand-cut section");
    let metrics = [("rep", 1_600_000_000), ("versioned", 1_700_000_000)]
        .into_iter()
        .map(|(id, date)| ActivityMetrics {
            activity_id: id.into(),
            name: id.into(),
            date,
            distance: 1000.0,
            moving_time: 100,
            elapsed_time: 100,
            elevation_gain: 0.0,
            avg_hr: None,
            avg_power: None,
            sport_type: "Ride".into(),
            training_load: None,
            ftp: None,
            power_zone_times: None,
            hr_zone_times: None,
        })
        .collect();
    engine.set_activity_metrics(metrics).expect("metrics");
    db.execute(
        "INSERT INTO activity_indicators
             (activity_id, indicator_type, target_id, direction, lap_time, computed_at)
         VALUES ('versioned', 'section_pr', 's_auto', 'same', 60.0, 0),
                ('rep', 'section_pr', ?1, 'same', 60.0, 0)",
        [&custom],
    )
    .expect("records");
    custom
}

fn assert_only_the_athletes_record_left(
    engine: &mut PersistentEngine,
    db: &Connection,
    custom: &str,
) {
    assert!(
        !latest_is_pr(engine),
        "the widget still calls the latest ride a record on a section that is gone"
    );
    assert_eq!(
        count(
            db,
            "SELECT COUNT(*) FROM activity_indicators
             WHERE target_id NOT IN (SELECT id FROM sections)"
        ),
        0,
        "an indicator names a section the clear removed"
    );
    assert_eq!(
        db.query_row(
            "SELECT COUNT(*) FROM activity_indicators
             WHERE activity_id = 'rep' AND target_id = ?1",
            [custom],
            |row| row.get::<_, i64>(0),
        )
        .expect("count"),
        1,
        "the record on the athlete's own section went with the auto one"
    );
}

/// Scenario: the latest ride holds a record on an auto section and the
/// athlete turns route matching off.
///
/// Expected behaviour: the record goes with the section, so the widget stops
/// calling the ride a PR, and the record on the athlete's own section stays.
#[test]
fn clearing_routes_and_sections_takes_the_records_of_the_sections_it_removed() {
    let dir = TempDir::new().unwrap();
    let path = seed(&dir);
    let mut engine = open(&path);
    engine.load().expect("load");
    let db = Connection::open(&path).expect("raw open");
    let custom = seed_section_records(&mut engine, &db);
    assert!(latest_is_pr(&mut engine), "the seed must start as a record");

    engine
        .clear_routes_and_sections()
        .expect("clear routes and sections");

    assert_only_the_athletes_record_left(&mut engine, &db, &custom);
}

#[test]
fn a_clear_takes_the_records_of_the_sections_it_removed() {
    let dir = TempDir::new().unwrap();
    let path = seed(&dir);
    let mut engine = open(&path);
    engine.load().expect("load");
    let db = Connection::open(&path).expect("raw open");
    let custom = seed_section_records(&mut engine, &db);
    assert!(latest_is_pr(&mut engine), "the seed must start as a record");

    engine.clear_derived().expect("clear");

    assert_only_the_athletes_record_left(&mut engine, &db, &custom);
}

/// A clear followed by the re-detect it owes, over a detected catalogue.
/// The detector needs a corpus, so these run in the synthetic lane.
#[cfg(feature = "synthetic")]
mod through_the_redetect {
    use super::*;
    use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};

    #[derive(Clone, Copy, Debug)]
    enum Clear {
        Derived,
        RoutesAndSections,
    }

    fn corpus() -> LifecycleCorpus {
        LifecycleCorpus::generate(&LifecycleConfig {
            bucket_a_count: 30,
            bucket_b_delta_count: 0,
            bucket_e_delta_count: 0,
            parallel_street_count: 0,
            ..LifecycleConfig::default()
        })
    }

    /// Add whatever of the corpus the engine does not hold, the way a sync
    /// refills the library after a clear removed it.
    fn add_corpus(engine: &mut PersistentEngine, corpus: &LifecycleCorpus, lapped: bool) {
        for a in corpus.through_a() {
            if engine.has_activity(&a.id) {
                continue;
            }
            engine
                .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
                .unwrap();
            engine
                .update_activity_metadata(&a.id, Some(a.start_date_unix), None, None, None)
                .unwrap();
        }
        let base = &corpus.bucket_c_single;
        if lapped && !engine.has_activity("act_lapped") {
            engine
                .add_activity("act_lapped".into(), base.lapped(3), base.sport_type.clone())
                .unwrap();
            engine
                .update_activity_metadata(
                    "act_lapped",
                    Some(base.start_date_unix),
                    None,
                    None,
                    None,
                )
                .unwrap();
        }
    }

    fn detect(engine: &mut PersistentEngine) {
        let handle = engine.detect_sections_background();
        let (sections, _) = handle.recv().expect("the detect ran");
        engine.apply_sections(sections).unwrap();
    }

    /// Give `id` a pinned geometry elsewhere, so the derived clear keeps it
    /// the way it keeps any activity a section's stored line is cut from.
    fn keep_through_the_clear(path: &Path, id: &str) {
        Connection::open(path)
            .expect("raw open")
            .execute(
                "INSERT INTO section_geometry
                     (section_id, version, blob, rep_activity_id, rep_start_index,
                      rep_end_index, source)
                 VALUES ('held_elsewhere', 1, x'00', ?1, 0, 12, 'exact')",
                [id],
            )
            .expect("keep the activity");
    }

    /// Clear, close the app, reopen it, let the sync refill the library and
    /// run the re-detect. The restart is inside the window on purpose: the
    /// exclusions have to outlive the process, not only the wipe.
    fn clear_restart_and_redetect(
        engine: PersistentEngine,
        path: &Path,
        how: Clear,
        lapped: bool,
    ) -> PersistentEngine {
        let mut engine = engine;
        match how {
            Clear::Derived => {
                engine.clear_derived().expect("clear");
            }
            Clear::RoutesAndSections => engine.clear_routes_and_sections().expect("clear"),
        }
        drop(engine);
        let mut engine = open(path);
        engine.load().expect("load");
        add_corpus(&mut engine, &corpus(), lapped);
        detect(&mut engine);
        engine
    }

    fn an_excluded_activity_comes_back_excluded(how: Clear) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("redetect.db");
        let mut engine = open(&path);
        add_corpus(&mut engine, &corpus(), false);
        detect(&mut engine);
        let section = engine
            .get_sections_by_type(None)
            .into_iter()
            .filter(|s| !s.is_user_defined)
            .max_by_key(|s| s.activity_ids.len())
            .expect("an auto section from 30 overlapping tracks");
        let (sid, member) = (section.id.clone(), section.activity_ids[0].clone());
        engine.exclude_activity_from_section(&sid, &member).unwrap();
        keep_through_the_clear(&path, &member);

        let mut engine = clear_restart_and_redetect(engine, &path, how, false);

        assert!(
            engine.get_section_by_id(&sid).is_some(),
            "{how:?}: the re-detect did not re-mint {sid}, so there is nothing to carry onto"
        );
        assert_eq!(
            engine.get_excluded_activity_ids(&sid),
            vec![member],
            "{how:?}: the activity the athlete took out of an auto section counts again"
        );
    }

    fn an_excluded_lap_comes_back_excluded(how: Clear) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("redetect_laps.db");
        let mut engine = open(&path);
        add_corpus(&mut engine, &corpus(), true);
        detect(&mut engine);
        let section = engine
            .get_sections_for_activity("act_lapped")
            .iter()
            .filter_map(|s| engine.get_section_by_id(&s.id))
            .filter(|s| !s.is_user_defined)
            .find(|s| {
                s.activity_portions
                    .iter()
                    .filter(|p| p.activity_id == "act_lapped")
                    .count()
                    >= 2
            })
            .expect("a section holding several act_lapped laps");
        let sid = section.id.clone();
        let mut starts: Vec<u32> = section
            .activity_portions
            .iter()
            .filter(|p| p.activity_id == "act_lapped")
            .map(|p| p.start_index)
            .collect();
        starts.sort_unstable();
        engine
            .exclude_section_lap(&sid, "act_lapped", starts[1])
            .unwrap();
        keep_through_the_clear(&path, "act_lapped");

        let mut engine = clear_restart_and_redetect(engine, &path, how, true);

        assert!(
            engine.get_section_by_id(&sid).is_some(),
            "{how:?}: the re-detect did not re-mint {sid}, so there is nothing to carry onto"
        );
        let laps: Vec<(String, u32)> = engine
            .get_excluded_section_laps(&sid)
            .into_iter()
            .filter(|(aid, _)| aid == "act_lapped")
            .collect();
        assert_eq!(
            laps.len(),
            1,
            "{how:?}: the lap the athlete took out counts again: {laps:?}"
        );
        assert!(
            !engine
                .get_excluded_activity_ids(&sid)
                .contains(&"act_lapped".to_string()),
            "{how:?}: one excluded lap widened to the whole activity"
        );
    }

    #[test]
    fn a_clear_keeps_an_activity_excluded_from_an_auto_section() {
        an_excluded_activity_comes_back_excluded(Clear::Derived);
    }

    #[test]
    fn clearing_routes_and_sections_keeps_an_activity_excluded_from_an_auto_section() {
        an_excluded_activity_comes_back_excluded(Clear::RoutesAndSections);
    }

    #[test]
    fn a_clear_keeps_a_lap_excluded_from_an_auto_section() {
        an_excluded_lap_comes_back_excluded(Clear::Derived);
    }

    #[test]
    fn clearing_routes_and_sections_keeps_a_lap_excluded_from_an_auto_section() {
        an_excluded_lap_comes_back_excluded(Clear::RoutesAndSections);
    }

    /// Scenario: Clear cache in the app's own order. The clear removes the
    /// excluded member with every other activity no section keeps, the
    /// re-detect runs at once over what is left, and only then does the sync
    /// bring the library back for the detect after it.
    ///
    /// Expected behaviour: the near-empty re-detect cannot place the
    /// exclusion, so it keeps holding it, and the detect over the refilled
    /// library puts it back.
    #[test]
    fn an_exclusion_outlives_the_redetect_that_runs_before_the_sync_refills() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("redetect_before_refill.db");
        let mut engine = open(&path);
        add_corpus(&mut engine, &corpus(), false);
        detect(&mut engine);
        let section = engine
            .get_sections_by_type(None)
            .into_iter()
            .filter(|s| !s.is_user_defined)
            .max_by_key(|s| s.activity_ids.len())
            .expect("an auto section from 30 overlapping tracks");
        let sid = section.id.clone();
        let member = section
            .activity_ids
            .iter()
            .find(|id| section.representative_activity_id.as_ref() != Some(*id))
            .expect("a member that is not the representative")
            .clone();
        engine.exclude_activity_from_section(&sid, &member).unwrap();

        engine.clear_derived().expect("clear");
        assert!(
            !engine.has_activity(&member),
            "the clear kept {member}, so this is not the app's order"
        );
        detect(&mut engine);
        add_corpus(&mut engine, &corpus(), false);
        detect(&mut engine);

        assert!(
            engine.get_section_by_id(&sid).is_some(),
            "the re-detect did not re-mint {sid}, so there is nothing to carry onto"
        );
        assert_eq!(
            engine.get_excluded_activity_ids(&sid),
            vec![member],
            "the re-detect before the refill spent the hold"
        );
        drop(engine);
        assert_eq!(
            count(
                &Connection::open(&path).expect("raw open"),
                "SELECT COUNT(*) FROM identity_state WHERE key = 'wiped_section_exclusions'"
            ),
            0,
            "a hold that was placed is still held"
        );
    }

    /// A second clear before the re-detect finds no rows left to capture, and
    /// must not release what the first one holds.
    #[test]
    fn a_second_clear_before_the_redetect_keeps_the_exclusion() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("redetect_twice.db");
        let mut engine = open(&path);
        add_corpus(&mut engine, &corpus(), false);
        detect(&mut engine);
        let section = engine
            .get_sections_by_type(None)
            .into_iter()
            .filter(|s| !s.is_user_defined)
            .max_by_key(|s| s.activity_ids.len())
            .expect("an auto section from 30 overlapping tracks");
        let (sid, member) = (section.id.clone(), section.activity_ids[0].clone());
        engine.exclude_activity_from_section(&sid, &member).unwrap();
        keep_through_the_clear(&path, &member);
        engine.clear_routes_and_sections().expect("first clear");

        let engine = clear_restart_and_redetect(engine, &path, Clear::Derived, false);

        assert_eq!(engine.get_excluded_activity_ids(&sid), vec![member]);
    }

    /// Nothing excluded before the clear, nothing excluded after the
    /// re-detect: the carry restores and never invents.
    #[test]
    fn a_redetect_after_a_clear_invents_no_exclusion() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("redetect_none.db");
        let mut engine = open(&path);
        add_corpus(&mut engine, &corpus(), false);
        detect(&mut engine);

        let engine = clear_restart_and_redetect(engine, &path, Clear::Derived, false);
        drop(engine);

        assert_eq!(
            count(
                &Connection::open(&path).expect("raw open"),
                "SELECT COUNT(*) FROM section_activities WHERE excluded = 1"
            ),
            0
        );
    }
}
