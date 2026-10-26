//! A library whose stored passes were written under an older pass rule is
//! recounted once, on the open that finds the stamp behind.
//!
//! Scenario: a detected library whose section rows include a half-length pass
//! and an overrun lap, as an earlier matcher wrote them, plus one excluded
//! member.
//! Expected behaviour: the next open drops the half pass, restores the overrun
//! lap's length and time, keeps the exclusion, agrees `visit_count` with the
//! rows and stamps the rule. A further open does no recount.

#![cfg(feature = "synthetic")]

use rusqlite::{Connection, params};
use tempfile::TempDir;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentEngine;

const STAMP: &str = "pass_rule_version";

struct Library {
    _dir: TempDir,
    path: String,
    section: String,
    excluded: String,
    overrun_start: i64,
    overrun_distance: f64,
    half_start: i64,
}

fn build() -> Library {
    let corpus = LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 30,
        bucket_b_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 0,
        ..LifecycleConfig::default()
    });
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("recount.db").to_str().unwrap().to_string();
    let mut engine = PersistentEngine::new(&path).unwrap();
    for a in corpus.through_a() {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .unwrap();
        engine
            .update_activity_metadata(&a.id, Some(a.start_date_unix), None, None, None)
            .unwrap();
    }
    let (sections, _) = engine.detect_sections_background().recv().unwrap();
    engine.apply_sections(sections).unwrap();
    let section = engine
        .get_sections_by_type(None)
        .into_iter()
        .filter(|s| !s.is_user_defined)
        .max_by_key(|s| s.activity_ids.len())
        .expect("an auto section");
    let excluded = section.activity_ids[0].clone();
    engine
        .exclude_activity_from_section(&section.id, &excluded)
        .unwrap();
    let section_id = section.id.clone();
    drop(engine);

    let raw = Connection::open(&path).unwrap();
    let victim = section.activity_ids[1].clone();
    let (overrun_start, overrun_distance): (i64, f64) = raw
        .query_row(
            "SELECT start_index, distance_meters FROM section_activities
             WHERE section_id = ?1 AND activity_id = ?2",
            params![section_id, victim],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    raw.execute(
        "UPDATE section_activities SET distance_meters = distance_meters * 2, lap_time = 99999
         WHERE section_id = ?1 AND activity_id = ?2",
        params![section_id, victim],
    )
    .unwrap();
    let half_start = overrun_start + 100_000;
    raw.execute(
        "INSERT INTO section_activities
           (section_id, activity_id, direction, start_index, end_index, distance_meters, lap_time)
         VALUES (?1, ?2, 'same', ?3, ?3 + 10, ?4, 50)",
        params![section_id, victim, half_start, overrun_distance / 2.0],
    )
    .unwrap();
    raw.execute("DELETE FROM schema_info WHERE key = ?1", params![STAMP])
        .unwrap();
    Library {
        _dir: dir,
        path,
        section: section_id,
        excluded,
        overrun_start,
        overrun_distance,
        half_start,
    }
}

fn open(path: &str) -> PersistentEngine {
    let mut engine = PersistentEngine::new(path).unwrap();
    engine.load().unwrap();
    engine
}

/// Open, then wait for the recount the open started to settle.
fn open_settled(path: &str) -> PersistentEngine {
    let mut engine = open(path);
    engine.wait_for_pass_recount();
    engine
}

fn stamp(path: &str) -> Option<i64> {
    Connection::open(path)
        .unwrap()
        .query_row(
            "SELECT CAST(value AS INTEGER) FROM schema_info WHERE key = ?1",
            params![STAMP],
            |r| r.get(0),
        )
        .ok()
}

#[test]
fn a_stale_stamp_recounts_stored_passes_once() {
    let lib = build();
    drop(open_settled(&lib.path));

    let raw = Connection::open(&lib.path).unwrap();
    let half: i64 = raw
        .query_row(
            "SELECT COUNT(*) FROM section_activities WHERE section_id = ?1 AND start_index = ?2",
            params![lib.section, lib.half_start],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(half, 0, "the half-length pass must leave the section");

    let (distance, lap): (f64, Option<f64>) = raw
        .query_row(
            "SELECT distance_meters, lap_time FROM section_activities
             WHERE section_id = ?1 AND start_index = ?2 AND excluded = 0",
            params![lib.section, lib.overrun_start],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert!(
        (distance - lib.overrun_distance).abs() < 1.0,
        "the overrun lap returns to the line's length, got {distance}"
    );
    assert_ne!(lap, Some(99999.0), "the overrun lap time is recut");

    let held: i64 = raw
        .query_row(
            "SELECT COUNT(*) FROM section_activities
             WHERE section_id = ?1 AND activity_id = ?2 AND excluded = 1",
            params![lib.section, lib.excluded],
            |r| r.get(0),
        )
        .unwrap();
    assert!(held >= 1, "the exclusion survives the recount");

    let (visits, rows): (i64, i64) = raw
        .query_row(
            "SELECT s.visit_count,
                    (SELECT COUNT(*) FROM section_activities sa
                     WHERE sa.section_id = s.id AND sa.excluded = 0)
             FROM sections s WHERE s.id = ?1",
            params![lib.section],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(visits, rows, "visit_count agrees with the rows");
    assert!(stamp(&lib.path).is_some(), "the rule is stamped");
}

#[test]
fn a_current_stamp_does_no_recount() {
    let lib = build();
    drop(open_settled(&lib.path));
    let raw = Connection::open(&lib.path).unwrap();
    raw.execute(
        "UPDATE section_activities SET lap_time = 77777
         WHERE section_id = ?1 AND start_index = ?2",
        params![lib.section, lib.overrun_start],
    )
    .unwrap();
    let mut again = open(&lib.path);
    assert!(
        again.wait_for_pass_recount().is_none(),
        "a stamped library starts no recount"
    );
    drop(again);
    let lap: f64 = raw
        .query_row(
            "SELECT lap_time FROM section_activities WHERE section_id = ?1 AND start_index = ?2",
            params![lib.section, lib.overrun_start],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(lap, 77777.0, "a stamped library is left as it stands");
}

#[test]
fn the_recount_runs_off_the_opening_thread_and_agrees_with_the_foreground_pass() {
    let lib = build();
    let mut engine = open(&lib.path);
    let report = engine
        .wait_for_pass_recount()
        .expect("a stale stamp starts a recount");
    assert_ne!(
        report.thread,
        std::thread::current().id(),
        "the launch thread does no recount work"
    );
    assert!(
        report.sections > 0,
        "the recount took the library's sections"
    );
    assert!(report.complete, "every section recounted");

    let raw = Connection::open(&lib.path).unwrap();
    let (visits, rows): (i64, i64) = raw
        .query_row(
            "SELECT s.visit_count,
                    (SELECT COUNT(*) FROM section_activities sa
                     WHERE sa.section_id = s.id AND sa.excluded = 0)
             FROM sections s WHERE s.id = ?1",
            params![lib.section],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(visits, rows);
    assert!(stamp(&lib.path).is_some());
}

#[test]
fn the_opening_engine_reads_the_recounted_visits_once_the_recount_settles() {
    let lib = build();
    let mut engine = open(&lib.path);
    engine.wait_for_pass_recount();
    let section = engine
        .get_sections_by_type(None)
        .into_iter()
        .find(|s| s.id == lib.section)
        .expect("the section stands");
    let raw = Connection::open(&lib.path).unwrap();
    let rows: i64 = raw
        .query_row(
            "SELECT COUNT(*) FROM section_activities WHERE section_id = ?1 AND excluded = 0",
            params![lib.section],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(i64::from(section.visit_count), rows);
}
