//! The cutover keeps each outgoing section as a state in the section ledger:
//! an `archived` history row naming a milestone geometry version, which holds
//! the activity and range its line was sliced from.

use crate::persistence::PersistentEngine;
use crate::persistence::codec;
use rusqlite::params;
use tempfile::TempDir;
use tracematch::GpsPoint;

fn ride(longitude: f64) -> Vec<GpsPoint> {
    (0..40)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.000_1,
            longitude,
            elevation: None,
        })
        .collect()
}

/// A second ride over different ground, for the state whose ride is absent.
fn other_ride() -> Vec<GpsPoint> {
    ride(7.5)
}

fn insert_auto_section(
    engine: &PersistentEngine,
    id: &str,
    line: &[GpsPoint],
    reference: (&str, u32, u32),
) {
    engine
        .db
        .execute(
            "INSERT INTO sections
                 (id, section_type, name, sport_type, polyline_json, polyline_blob,
                  distance_meters, representative_activity_id, rep_start_index,
                  rep_end_index, geometry_source, created_at, is_user_defined)
             VALUES (?, 'auto', ?, 'Ride', NULL, ?, 1200.0, ?, ?, ?, 'exact',
                     '2026-01-01T00:00:00Z', 0)",
            params![
                id,
                format!("Name of {id}"),
                codec::serialize_track_points(line),
                reference.0,
                reference.1,
                reference.2
            ],
        )
        .expect("insert the section");
}

/// One stored ride `a1` and an auto section sliced from it.
fn library(dir: &TempDir, name: &str) -> PersistentEngine {
    let path = dir.path().join(name);
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    engine
        .add_activity("a1".into(), ride(7.0), "Ride".into())
        .expect("add_activity");
    insert_auto_section(&engine, "s_auto", &ride(7.0)[0..12], ("a1", 0, 12));
    engine
}

/// The archived row of `section_id`: its details and the version it names.
fn archived_state(engine: &PersistentEngine, section_id: &str) -> (serde_json::Value, i64) {
    let (details, version): (String, i64) = engine
        .db
        .query_row(
            "SELECT details, geometry_version FROM section_history
             WHERE section_id = ? AND kind = 'archived'",
            [section_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("an archived ledger row");
    (serde_json::from_str(&details).expect("details"), version)
}

/// `(source, blob, milestone, triple)` of one stored version.
type VersionRow = (
    String,
    Vec<u8>,
    bool,
    (Option<String>, Option<u32>, Option<u32>),
);

fn version_row(engine: &PersistentEngine, section_id: &str, version: i64) -> VersionRow {
    engine
        .db
        .query_row(
            "SELECT source, blob, milestone, rep_activity_id, rep_start_index, rep_end_index
             FROM section_geometry WHERE section_id = ? AND version = ?",
            params![section_id, version],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get::<_, i64>(2)? != 0,
                    (row.get(3)?, row.get(4)?, row.get(5)?),
                ))
            },
        )
        .expect("the version")
}

fn drawn(engine: &PersistentEngine, section_id: &str, version: i64) -> Vec<GpsPoint> {
    engine
        .section_geometry_version(section_id, version)
        .map(|(points, _)| points)
        .unwrap_or_default()
}

fn canonical(line: &[GpsPoint]) -> Vec<GpsPoint> {
    codec::decode_polyline(&codec::encode_polyline(line)).expect("decode")
}

/// Scenario: the cutover keeps the section it is about to wipe.
/// Expected behaviour: one `archived` ledger row naming a milestone version
/// that holds the ride and range and no copy of the line, since the range
/// re-slices to it here.
#[test]
fn each_outgoing_section_becomes_an_archived_ledger_state() {
    let dir = TempDir::new().expect("tempdir");
    let engine = library(&dir, "archive.db");

    assert_eq!(engine.archive_current_catalogue().expect("archive"), 1);

    let (details, version) = archived_state(&engine, "s_auto");
    assert_eq!(details["name"], "Name of s_auto");
    assert_eq!(details["sport_type"], "Ride");
    let (source, blob, milestone, triple) = version_row(&engine, "s_auto", version);
    assert_eq!(source, "exact");
    assert!(
        blob.is_empty(),
        "the range rebuilds the line, so no copy is kept"
    );
    assert!(milestone, "an archived state must outlive pruning");
    assert_eq!(triple, (Some("a1".into()), Some(0), Some(12)));
    assert_eq!(drawn(&engine, "s_auto", version), ride(7.0)[0..12].to_vec());
}

/// Scenario: the diff is stored and the token promoted.
/// Expected behaviour: the archived state still draws its line, so it can be
/// pinned or rolled back to after the cutover is long done.
#[test]
fn promotion_keeps_the_archived_state_drawable() {
    let dir = TempDir::new().expect("tempdir");
    let engine = library(&dir, "promote.db");
    engine.archive_current_catalogue().expect("archive");

    let diff = engine.build_cutover_diff().expect("diff");
    let payload: serde_json::Value = serde_json::from_str(&diff).expect("json");
    assert_eq!(payload["counts"]["gone"].as_u64(), Some(1), "{payload}");
    engine.finish_cutover(&diff).expect("promote");

    let (_, version) = archived_state(&engine, "s_auto");
    assert_eq!(drawn(&engine, "s_auto", version), ride(7.0)[0..12].to_vec());
}

/// Scenario: a run dies after the archive and the next launch retries, once
/// and then again.
/// Expected behaviour: each retry reuses the states the first run wrote, and
/// the diff still sees the section leave.
#[test]
fn a_retried_archive_reuses_its_states() {
    let dir = TempDir::new().expect("tempdir");
    let engine = library(&dir, "retry.db");
    assert_eq!(engine.archive_current_catalogue().expect("archive"), 1);
    engine
        .db
        .execute("DELETE FROM sections", [])
        .expect("the detect wipes the catalogue");

    assert_eq!(engine.archive_current_catalogue().expect("first retry"), 1);
    assert_eq!(engine.archive_current_catalogue().expect("second retry"), 1);

    let rows: i64 = engine
        .db
        .query_row(
            "SELECT COUNT(*) FROM section_history WHERE kind = 'archived'",
            [],
            |row| row.get(0),
        )
        .expect("count");
    assert_eq!(rows, 1);
    let payload: serde_json::Value =
        serde_json::from_str(&engine.build_cutover_diff().expect("diff")).expect("json");
    assert_eq!(payload["counts"]["gone"].as_u64(), Some(1), "{payload}");
}

/// Scenario: the section's ride is not stored when the cutover runs, and
/// arrives later.
/// Expected behaviour: the state keeps its line beside the range while the
/// ride is absent, and once the ride arrives and re-slices to it the range is
/// the truth and the copy goes.
#[test]
fn an_archived_state_whose_ride_is_missing_keeps_its_line_until_the_ride_arrives() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = library(&dir, "missing.db");
    let line = other_ride()[5..20].to_vec();
    insert_auto_section(&engine, "s_absent", &line, ("a2", 5, 20));
    engine.archive_current_catalogue().expect("archive");

    let (_, version) = archived_state(&engine, "s_absent");
    let (source, blob, _, triple) = version_row(&engine, "s_absent", version);
    assert_eq!(source, "orphaned");
    assert!(!blob.is_empty(), "nothing else can draw the state yet");
    assert_eq!(triple, (Some("a2".into()), Some(5), Some(20)));
    assert_eq!(drawn(&engine, "s_absent", version), canonical(&line));

    engine
        .add_activity("a2".into(), other_ride(), "Ride".into())
        .expect("the ride arrives");

    let (source, blob, _, _) = version_row(&engine, "s_absent", version);
    assert_eq!(source, "exact");
    assert!(blob.is_empty(), "the arrived ride now draws the state");
    assert_eq!(drawn(&engine, "s_absent", version), line);
}

/// Scenario: a ride arrives under the id the state names, but over ground the
/// range does not slice to the state's line.
/// Expected behaviour: the state stays on its own line.
#[test]
fn a_ride_over_other_ground_leaves_the_state_on_its_own_line() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = library(&dir, "elsewhere.db");
    let line = other_ride()[5..20].to_vec();
    insert_auto_section(&engine, "s_absent", &line, ("a2", 5, 20));
    engine.archive_current_catalogue().expect("archive");
    let (_, version) = archived_state(&engine, "s_absent");

    engine
        .add_activity("a2".into(), ride(8.0), "Ride".into())
        .expect("a different ride arrives");

    let (source, blob, _, _) = version_row(&engine, "s_absent", version);
    assert_eq!(source, "orphaned");
    assert!(!blob.is_empty());
    assert_eq!(drawn(&engine, "s_absent", version), canonical(&line));
}

/// Scenario: the section keeps its id across the cut and changes shape
/// several times afterwards, more than the recent versions retained.
/// Expected behaviour: the archived state survives the pruning, pins, and
/// rolls the section back to its line.
#[test]
fn an_archived_state_survives_later_states_and_rolls_back() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = library(&dir, "rollback.db");
    engine.archive_current_catalogue().expect("archive");
    let (_, archived) = archived_state(&engine, "s_auto");

    for end in 14u32..22 {
        engine
            .record_section_geometry(
                "s_auto",
                &ride(7.0)[2..end as usize],
                false,
                Some(("a1", 2, end)),
            )
            .expect("a later state");
    }
    assert_eq!(
        drawn(&engine, "s_auto", archived),
        ride(7.0)[0..12].to_vec()
    );

    assert!(
        engine
            .pin_section_geometry("s_auto", archived)
            .expect("pin")
    );
    engine
        .revert_section_to_version("s_auto", archived)
        .expect("roll back");
    let (start, end): (u32, u32) = engine
        .db
        .query_row(
            "SELECT rep_start_index, rep_end_index FROM sections WHERE id = 's_auto'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("the section");
    assert_eq!((start, end), (0, 12));
    assert_eq!(engine.pinned_section_version("s_auto"), Some(archived));
}

/// Scenario: the record backup of a library that cut over is restored onto a
/// new library whose own detect named the same ground differently.
/// Expected behaviour: the archived state lands on the local section by
/// ground, draws its line from the ride, and can be pinned and rolled back to.
#[test]
fn an_archived_state_travels_in_the_record_and_lands_by_ground() {
    let dir = TempDir::new().expect("tempdir");
    let old = library(&dir, "old.db");
    old.archive_current_catalogue().expect("archive");
    let payload = crate::persistence::record_backup::collect_record_payload(&old.db)
        .expect("collect the record");
    let json = serde_json::to_string(&payload).expect("serialise");

    let mut new =
        PersistentEngine::new(dir.path().join("new.db").to_str().unwrap()).expect("a new library");
    new.add_activity("a1".into(), ride(7.0), "Ride".into())
        .expect("the ride syncs");
    insert_auto_section(&new, "s_local", &ride(7.0)[0..12], ("a1", 0, 12));
    new.restore_record_json(&json).expect("restore");

    let (details, version) = archived_state(&new, "s_local");
    assert_eq!(details["name"], "Name of s_auto");
    assert_eq!(drawn(&new, "s_local", version), ride(7.0)[0..12].to_vec());
    assert!(new.pin_section_geometry("s_local", version).expect("pin"));
    new.revert_section_to_version("s_local", version)
        .expect("roll back");
    assert_eq!(new.pinned_section_version("s_local"), Some(version));
}

/// Scenario: the athlete rolls a section back to a state whose ride is not
/// stored.
/// Expected behaviour: the section takes the state's own line and keeps the
/// range as provenance without claiming the range draws it, so nothing reads
/// the line as a droppable cache of a slice it cannot rebuild.
#[test]
fn rolling_back_to_a_state_whose_ride_is_absent_keeps_its_line() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = library(&dir, "absent-rollback.db");
    let line = other_ride()[5..20].to_vec();
    insert_auto_section(&engine, "s_absent", &line, ("a2", 5, 20));
    engine.archive_current_catalogue().expect("archive");
    let (_, version) = archived_state(&engine, "s_absent");
    engine
        .record_section_geometry("s_absent", &ride(7.0)[0..12], false, Some(("a1", 0, 12)))
        .expect("a later state");

    engine
        .revert_section_to_version("s_absent", version)
        .expect("roll back");

    let source: String = engine
        .db
        .query_row(
            "SELECT geometry_source FROM sections WHERE id = 's_absent'",
            [],
            |row| row.get(0),
        )
        .expect("the section");
    assert_eq!(source, "orphaned");
    assert_eq!(
        crate::persistence::sections::geometry::stored_line(&engine.db, "s_absent").expect("line"),
        canonical(&line)
    );
}

/// Scenario: an older build's archive is carried into the ledger after the
/// cutover's detect had already retired the section.
/// Expected behaviour: the carried row is bookkeeping, so the section is still
/// listed as retired by the event that retired it.
#[test]
fn a_carried_archive_row_leaves_a_retired_section_listed() {
    let dir = TempDir::new().expect("tempdir");
    let engine = library(&dir, "retired.db");
    engine
        .db
        .execute_batch(
            "INSERT INTO section_history (section_id, at, kind, details)
                 VALUES ('s_gone', '2026-02-01 00:00:00', 'dissolved', '{}');
             CREATE TABLE section_catalogue_archive (
                 token TEXT NOT NULL, section_id TEXT NOT NULL, name TEXT,
                 sport_type TEXT NOT NULL, polyline_blob BLOB, polyline_json TEXT,
                 distance_meters REAL NOT NULL DEFAULT 0,
                 visit_count INTEGER NOT NULL DEFAULT 0, created_at TEXT,
                 PRIMARY KEY (token, section_id));
             INSERT INTO section_catalogue_archive (token, section_id, name, sport_type)
                 VALUES ('unified-1', 's_gone', 'Gone', 'Ride');",
        )
        .expect("an older build's archive");

    assert_eq!(
        super::carry_legacy_archive_into_ledger(&engine.db).expect("carry"),
        1
    );

    let retired = engine.retired_sections();
    assert_eq!(
        retired
            .iter()
            .map(|r| (r.section_id.as_str(), r.kind.as_str()))
            .collect::<Vec<_>>(),
        vec![("s_gone", "dissolved")]
    );
}

/// Retire `section_id` the way a fired retirement does: the row leaves the
/// catalogue and the ledger keeps the departure.
fn retire(engine: &PersistentEngine, section_id: &str) {
    engine
        .db
        .execute("DELETE FROM sections WHERE id = ?", [section_id])
        .expect("retire the section");
    engine
        .db
        .execute(
            "INSERT INTO section_history (section_id, at, kind, details)
             VALUES (?, '2026-02-01 00:00:00', 'dissolved', '{}')",
            [section_id],
        )
        .expect("the departure");
}

/// Scenario: the cutover retired a section and the athlete rolls back to its
/// archived state from the retired list.
/// Expected behaviour: the section is live again under its id on the archived
/// line and range, user-owned so a detect keeps it, pinned at that state, and
/// the ledger says it was restored.
#[test]
fn rolling_back_a_retired_section_recreates_it_on_the_archived_line() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = library(&dir, "retired-rollback.db");
    engine.archive_current_catalogue().expect("archive");
    let (_, version) = archived_state(&engine, "s_auto");
    retire(&engine, "s_auto");
    assert_eq!(
        engine.retired_sections()[0].versions,
        vec![crate::WholeNumber(version)]
    );

    engine
        .revert_section_to_version("s_auto", version)
        .expect("roll back a retired section");

    let (kind, user_defined, name, sport, start, end): (
        String,
        bool,
        Option<String>,
        String,
        u32,
        u32,
    ) = engine
        .db
        .query_row(
            "SELECT section_type, is_user_defined, name, sport_type,
                    rep_start_index, rep_end_index
             FROM sections WHERE id = 's_auto'",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .expect("the section is live");
    assert_eq!(kind, "custom");
    assert!(user_defined);
    assert_eq!(name.as_deref(), Some("Name of s_auto"));
    assert_eq!(sport, "Ride");
    assert_eq!((start, end), (0, 12));
    assert_eq!(
        crate::persistence::sections::geometry::stored_line(&engine.db, "s_auto").expect("line"),
        canonical(&ride(7.0)[0..12])
    );
    assert_eq!(engine.pinned_section_version("s_auto"), Some(version));
    let last: String = engine
        .db
        .query_row(
            "SELECT kind FROM section_history WHERE section_id = 's_auto'
             ORDER BY id DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .expect("a ledger row");
    assert_eq!(last, "restored");
    assert!(engine.retired_sections().is_empty());
}

/// Scenario: the retired list offers a restore only where the engine can do one.
/// Expected behaviour: a retired section with an archived state reports that
/// state's version, one the detector dissolved afterwards with no archived
/// state reports none, and neither fails a roll back by the reported version.
#[test]
fn a_retired_section_reports_the_version_it_can_be_restored_from() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = library(&dir, "restorable.db");
    engine.archive_current_catalogue().expect("archive");
    let (_, version) = archived_state(&engine, "s_auto");
    insert_auto_section(&engine, "s_later", &ride(7.0)[0..12], ("a1", 0, 12));
    retire(&engine, "s_auto");
    retire(&engine, "s_later");

    let retired = engine.retired_sections();
    let restorable = |id: &str| {
        retired
            .iter()
            .find(|r| r.section_id == id)
            .expect("retired")
            .restorable_version
    };
    assert_eq!(restorable("s_auto"), Some(crate::WholeNumber(version)));
    assert_eq!(restorable("s_later"), None);
    assert!(engine.revert_section_to_version("s_auto", version).is_ok());
}

/// Scenario: a roll back names a section with no row and no such version.
/// Expected behaviour: it fails and creates nothing.
#[test]
fn rolling_back_an_unknown_section_creates_nothing() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = library(&dir, "unknown.db");
    assert!(engine.revert_section_to_version("s_nowhere", 1).is_err());
    let count: i64 = engine
        .db
        .query_row(
            "SELECT COUNT(*) FROM sections WHERE id = 's_nowhere'",
            [],
            |row| row.get(0),
        )
        .expect("count");
    assert_eq!(count, 0);
}

/// Scenario: a library that still holds an older build's archive tables fails
/// to open and is quarantined.
/// Expected behaviour: salvage carries both archived states, the trimmed one
/// without a line and the untrimmed one on its stored line, into the fresh
/// library's ledger, so the pre-cutover catalogue can still be pinned.
#[test]
fn salvaging_a_file_with_an_older_archive_keeps_its_archived_states() {
    let dir = TempDir::new().expect("tempdir");
    let corrupt = dir.path().join("corrupt.db");
    {
        let engine = PersistentEngine::new(corrupt.to_str().unwrap()).expect("engine");
        engine
            .db
            .execute_batch(
                "INSERT INTO section_history (section_id, at, kind, details)
                     VALUES ('s_trimmed', '2026-02-01 00:00:00', 'algorithm_changed', '{}');
                 CREATE TABLE section_catalogue_archive (
                     token TEXT NOT NULL, section_id TEXT NOT NULL, name TEXT,
                     sport_type TEXT NOT NULL, polyline_blob BLOB, polyline_json TEXT,
                     distance_meters REAL NOT NULL DEFAULT 0,
                     visit_count INTEGER NOT NULL DEFAULT 0, created_at TEXT,
                     PRIMARY KEY (token, section_id));
                 INSERT INTO section_catalogue_archive (token, section_id, name, sport_type)
                     VALUES ('unified-1', 's_trimmed', 'Trimmed', 'Ride');",
            )
            .expect("an older build's archive");
        engine
            .db
            .execute(
                "INSERT INTO section_catalogue_archive
                     (token, section_id, name, sport_type, polyline_blob, distance_meters)
                 VALUES ('unified-1', 's_whole', 'Whole', 'Ride', ?, 1200.0)",
                [codec::serialize_track_points(&ride(7.0)[0..12])],
            )
            .expect("an untrimmed row");
    }

    let fresh =
        PersistentEngine::new(dir.path().join("fresh.db").to_str().unwrap()).expect("fresh");
    fresh.salvage_ledger_from(corrupt.to_str().unwrap());

    let (trimmed, _) = fresh
        .db
        .query_row(
            "SELECT details, geometry_version FROM section_history
             WHERE section_id = 's_trimmed' AND kind = 'archived'",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<i64>>(1)?)),
        )
        .expect("the trimmed state is carried");
    assert!(trimmed.contains("Trimmed"));
    let (whole, version) = archived_state(&fresh, "s_whole");
    assert_eq!(whole["name"], "Whole");
    assert_eq!(
        drawn(&fresh, "s_whole", version),
        canonical(&ride(7.0)[0..12])
    );
}

/// Scenario: a routes regroup on its own connection holds the write lock when
/// the archive starts, and commits while the archive is under way.
/// Expected behaviour: the archive waits its turn and archives, rather than
/// failing on a snapshot the regroup's commit made stale.
#[test]
fn the_archive_waits_out_a_writer_that_commits_under_it() {
    let dir = TempDir::new().expect("tempdir");
    let engine = library(&dir, "archive.db");
    let writer = rusqlite::Connection::open(dir.path().join("archive.db")).expect("writer");
    writer
        .execute_batch(
            "BEGIN IMMEDIATE;
             INSERT INTO settings (key, value) VALUES ('another_writer', '1');",
        )
        .expect("the other writer holds the lock");
    let committer = std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(300));
        writer.execute_batch("COMMIT").expect("commit");
    });

    let archived = engine.archive_current_catalogue();
    committer.join().unwrap();

    assert_eq!(archived.expect("archive"), 1);
    assert_eq!(
        archived_state(&engine, "s_auto").0["name"],
        "Name of s_auto"
    );
}

/// Archive `s_auto`, retire it, and return the version that draws its line.
fn retired_archived(engine: &PersistentEngine) -> i64 {
    engine.archive_current_catalogue().expect("archive");
    let (_, version) = archived_state(engine, "s_auto");
    retire(engine, "s_auto");
    version
}

fn track_rows(engine: &PersistentEngine, activity_id: &str) -> i64 {
    engine
        .db
        .query_row(
            "SELECT COUNT(*) FROM gps_tracks WHERE activity_id = ?",
            [activity_id],
            |row| row.get(0),
        )
        .expect("count tracks")
}

/// Scenario: a retired section's archived version, then ten geometry writes
/// on it and on another section, and a stream-retention pass that reaches past the
/// reference ride's date.
/// Expected behaviour: the version and the ride track it is read from both
/// stay, and the line still draws.
#[test]
fn a_retired_sections_state_survives_later_writes_and_the_retention_pass() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = library(&dir, "retained.db");
    engine
        .update_activity_metadata("a1", Some(1_000_000), None, None, None)
        .expect("an old ride");
    insert_auto_section(&engine, "s_other", &ride(7.0)[4..30], ("a1", 4, 30));
    engine
        .record_section_geometry("s_auto", &ride(7.0)[0..8], false, Some(("a1", 0, 8)))
        .expect("an earlier state, so the archived one is not the first");
    let version = retired_archived(&engine);
    assert!(version > 1);

    for end in 14u32..24 {
        engine
            .record_section_geometry(
                "s_other",
                &ride(7.0)[2..end as usize],
                false,
                Some(("a1", 2, end)),
            )
            .expect("a later write on another section");
        engine
            .record_section_geometry(
                "s_auto",
                &ride(7.0)[1..end as usize],
                false,
                Some(("a1", 1, end)),
            )
            .expect("a later write on the retired section");
    }
    engine.set_stream_retention_days(30).expect("retention");
    engine
        .prune_streams_outside_retention()
        .expect("the retention pass");

    let (_, _, milestone, _) = version_row(&engine, "s_auto", version);
    assert!(milestone);
    assert_eq!(track_rows(&engine, "a1"), 1, "the reference track went");
    assert_eq!(drawn(&engine, "s_auto", version), ride(7.0)[0..12].to_vec());
}

/// Scenario: the athlete clears derived data after the cutover retired a
/// section.
/// Expected behaviour: the reference ride survives the clear and the retired
/// section can still be rolled back to its archived line.
#[test]
fn clearing_derived_data_leaves_a_retired_section_restorable() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = library(&dir, "cleared.db");
    let version = retired_archived(&engine);

    engine.clear_derived().expect("clear derived");

    assert_eq!(track_rows(&engine, "a1"), 1, "the reference ride was swept");
    assert_eq!(drawn(&engine, "s_auto", version), ride(7.0)[0..12].to_vec());
    assert_eq!(engine.retired_sections().len(), 1);
    engine
        .revert_section_to_version("s_auto", version)
        .expect("roll back");
    assert_eq!(
        crate::persistence::sections::geometry::stored_line(&engine.db, "s_auto").expect("line"),
        canonical(&ride(7.0)[0..12])
    );
}

/// Scenario: the census no longer names the reference ride of a retired
/// section, so the sync removes it.
/// Expected behaviour: the archived version keeps a drawable line of its own,
/// and the section can still be restored from it.
#[test]
fn a_census_removal_of_a_retired_sections_reference_ride_leaves_it_restorable() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = library(&dir, "removed.db");
    let version = retired_archived(&engine);
    assert!(version_row(&engine, "s_auto", version).1.is_empty());

    engine
        .db
        .execute(
            "UPDATE activities SET intervals_id = 'i1' WHERE id = 'a1'",
            [],
        )
        .expect("a synced ride");
    let removed = engine.reconcile_against_census(&["i2".to_string()], "2100-01-01");
    assert_eq!(removed, vec!["a1".to_string()]);

    assert_eq!(track_rows(&engine, "a1"), 0);
    assert!(!version_row(&engine, "s_auto", version).1.is_empty());
    assert_eq!(drawn(&engine, "s_auto", version), ride(7.0)[0..12].to_vec());
    engine
        .revert_section_to_version("s_auto", version)
        .expect("roll back");
    assert_eq!(
        crate::persistence::sections::geometry::stored_line(&engine.db, "s_auto").expect("line"),
        canonical(&ride(7.0)[0..12])
    );
}

/// Scenario: a record backup of a library with a retired section, restored
/// onto a fresh install, and the ground arrives afterwards.
/// Expected behaviour: the restored state is held until the ride syncs, then
/// draws its line and rolls back.
#[test]
fn a_retired_state_restored_before_its_ground_arrives_becomes_restorable() {
    let dir = TempDir::new().expect("tempdir");
    let old = library(&dir, "old.db");
    retired_archived(&old);
    let payload = crate::persistence::record_backup::collect_record_payload(&old.db)
        .expect("collect the record");
    let json = serde_json::to_string(&payload).expect("serialise");

    let mut new =
        PersistentEngine::new(dir.path().join("new.db").to_str().unwrap()).expect("a new library");
    new.restore_record_json(&json).expect("restore");
    let pending: i64 = new
        .db
        .query_row(
            "SELECT COUNT(*) FROM settings WHERE key = '__record_restore_pending'",
            [],
            |row| row.get(0),
        )
        .expect("pending");
    assert_eq!(pending, 1, "the record waits for its ground");

    new.add_activity("a1".into(), ride(7.0), "Ride".into())
        .expect("the ride syncs");
    insert_auto_section(&new, "s_local", &ride(7.0)[0..12], ("a1", 0, 12));
    new.restore_record_json(&json).expect("restore again");

    let (_, version) = archived_state(&new, "s_local");
    assert_eq!(drawn(&new, "s_local", version), ride(7.0)[0..12].to_vec());
    new.revert_section_to_version("s_local", version)
        .expect("roll back");
}
