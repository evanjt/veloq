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
    assert_eq!(engine.retired_sections()[0].versions, vec![version]);

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
