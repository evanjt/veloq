//! The section side reads that answer from committed rows: the ledger, the
//! map layer, the line and the performance derivations. Each one used to take
//! the engine write lock, so a sync page or a detection apply in flight held
//! the section screen for the length of its write.

use super::*;
use crate::test_globals::{
    init_global_engine, read_while_writer_holds, seeded_global_engine, serial_global_state,
};

fn empty_engine(name: &str) -> (tempfile::TempDir, Arc<SectionManager>) {
    (init_global_engine(name), SectionManager::new())
}

#[test]
fn test_get_map_sections_writer_held() {
    let _guard = serial_global_state();
    let (_tmp, sections) = empty_engine("map_sections_under_writer.db");
    assert!(
        read_while_writer_holds(|| sections.get_map_sections(None, Some(2)).unwrap()).is_empty()
    );
}

#[test]
fn test_get_reference_info_writer_held() {
    let _guard = serial_global_state();
    let (_tmp, sections) = empty_engine("section_reference_under_writer.db");
    let info = read_while_writer_holds(|| sections.get_reference_info("s1".into()).unwrap());
    assert!(info.activity_id.is_empty());
    assert!(!info.is_user_defined);
}

#[test]
fn test_get_named_corridors_writer_held() {
    let _guard = serial_global_state();
    let (_tmp, sections) = empty_engine("named_corridors_under_writer.db");
    assert!(read_while_writer_holds(|| sections.get_named_corridors().unwrap()).is_empty());
}

#[test]
fn test_get_excluded_activities_writer_held() {
    let _guard = serial_global_state();
    let (_tmp, sections) = empty_engine("section_excluded_under_writer.db");
    assert!(
        read_while_writer_holds(|| sections.get_excluded_activities("s1".into()).unwrap())
            .is_empty()
    );
}

#[test]
fn test_get_history_writer_held() {
    let _guard = serial_global_state();
    let (_tmp, sections) = empty_engine("section_history_under_writer.db");
    assert!(read_while_writer_holds(|| sections.get_history("s1".into()).unwrap()).is_empty());
}

#[test]
fn test_get_geometry_versions_writer_held() {
    let _guard = serial_global_state();
    let (_tmp, sections) = empty_engine("section_versions_under_writer.db");
    assert!(
        read_while_writer_holds(|| sections.get_geometry_versions("s1".into()).unwrap()).is_empty()
    );
}

#[test]
fn test_get_geometry_version_coords_writer_held() {
    let _guard = serial_global_state();
    let (_tmp, sections) = empty_engine("section_version_coords_under_writer.db");
    assert!(
        read_while_writer_holds(|| sections
            .get_geometry_version_coords("s1".into(), 1.0)
            .unwrap())
        .is_empty()
    );
}

#[test]
fn test_get_pinned_version_writer_held() {
    let _guard = serial_global_state();
    let (_tmp, sections) = empty_engine("section_pin_under_writer.db");
    assert!(
        read_while_writer_holds(|| sections.get_pinned_version("s1".into()).unwrap()).is_none()
    );
}

#[test]
fn test_get_retired_writer_held() {
    let _guard = serial_global_state();
    let (_tmp, sections) = empty_engine("sections_retired_under_writer.db");
    assert!(read_while_writer_holds(|| sections.get_retired().unwrap()).is_empty());
}

#[test]
fn test_find_superseded_writer_held() {
    let _guard = serial_global_state();
    let (_tmp, _sections) = empty_engine("sections_superseded_under_writer.db");
    assert!(
        read_while_writer_holds(|| with_reader(|conn| {
            queries::pooled::superseded_auto_sections(conn, "custom_1", 50.0, 0.8)
        })
        .unwrap())
        .is_empty()
    );
}

#[test]
fn test_get_workout_sections_writer_held() {
    let _guard = serial_global_state();
    let (_tmp, sections) = empty_engine("workout_sections_under_writer.db");
    assert!(
        read_while_writer_holds(|| sections.get_workout_sections("Ride".into(), 5).unwrap())
            .is_empty()
    );
}

/// A custom section on the seeded library, a second one lying over an auto
/// section's ground, a pin, an exclusion and a split birth in the ledger: every
/// read below has something to answer with.
fn seeded_catalogue() -> (tempfile::TempDir, Arc<SectionManager>, String) {
    let tmp = seeded_global_engine();
    let sections = SectionManager::new();
    let id = sections
        .create("Ride".into(), Some("Climb".into()), "a0".into(), 0, 7)
        .unwrap();
    crate::with_persistent_engine(|e| {
        e.db.execute(
            "INSERT INTO sections (id, section_type, name, sport_type, distance_meters,
                                   polyline_json, polyline_blob, representative_activity_id,
                                   rep_start_index, rep_end_index, visit_count, activity_count,
                                   bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
             SELECT 'auto_1', 'auto', 'Lower', 'Ride', distance_meters, polyline_json,
                    polyline_blob, representative_activity_id, rep_start_index, rep_end_index,
                    3, 3, bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng
             FROM sections WHERE id = ?1",
            rusqlite::params![id],
        )
        .unwrap();
        e.db.execute(
            "INSERT INTO section_history (section_id, at, kind, details)
             VALUES ('auto_1', datetime('now'), 'formed',
                     '{\"split_from\":\"parent_1\",\"discriminator\":\"north\"}')",
            [],
        )
        .unwrap();
        e.db.execute(
            "INSERT INTO section_history (section_id, at, kind, details)
             VALUES ('auto_gone', datetime('now'), 'merged', '{\"into\":\"auto_1\"}')",
            [],
        )
        .unwrap();
        let points: Vec<crate::GpsPoint> = (0..8)
            .map(|i| crate::GpsPoint::new(46.2 + f64::from(i) * 0.001, 7.35))
            .collect();
        let version = e.record_section_geometry(&id, &points, true, None).unwrap();
        assert!(e.pin_section_geometry(&id, version).unwrap());
    })
    .unwrap();
    (tmp, sections, id)
}

#[test]
fn test_ledger_reads_match_the_engine() {
    let _guard = serial_global_state();
    let (_tmp, sections, id) = seeded_catalogue();

    let pooled_line = super::super::error::with_reader(|conn| {
        crate::persistence::sections::pooled::section_polyline(conn, &id)
    })
    .unwrap();
    assert!(!pooled_line.is_empty());
    let locked_line = crate::with_persistent_engine(|e| e.get_section_polyline(&id)).unwrap();
    assert_eq!(pooled_line, locked_line);

    let info = sections.get_reference_info(id.clone()).unwrap();
    assert_eq!(
        (info.activity_id.clone(), info.is_user_defined),
        crate::with_persistent_engine(|e| {
            let s = e.get_section(&id).unwrap();
            (
                s.representative_activity_id.unwrap_or_default(),
                s.is_user_defined,
            )
        })
        .unwrap()
    );

    let history = sections.get_history(id.clone()).unwrap();
    let locked_history = crate::with_persistent_engine(|e| e.section_history(&id)).unwrap();
    assert_eq!(history.len(), locked_history.len());
    for (pooled, locked) in history.iter().zip(&locked_history) {
        assert_eq!(pooled.id, locked.id as f64);
        assert_eq!(pooled.kind, locked.kind);
    }

    let versions = sections.get_geometry_versions(id.clone()).unwrap();
    assert!(!versions.is_empty(), "the recorded line is a version");
    let pinned = sections
        .get_pinned_version(id.clone())
        .unwrap()
        .expect("pinned");
    assert!(versions.iter().any(|v| v.pinned && v.version == pinned));
    let coords = sections
        .get_geometry_version_coords(id.clone(), pinned)
        .unwrap();
    assert!(!coords.is_empty());
    assert_eq!(
        coords,
        crate::with_persistent_engine(|e| e
            .section_geometry_polyline(&id, pinned as i64)
            .map(|pts| crate::persistence::codec::encode_polyline(&pts))
            .unwrap_or_default())
        .unwrap()
    );

    let retired = sections.get_retired().unwrap();
    assert_eq!(retired.len(), 1);
    assert_eq!(retired[0].section_id, "auto_gone");
    assert_eq!(retired[0].into.as_deref(), Some("auto_1"));
    assert_eq!(
        retired.len(),
        crate::with_persistent_engine(|e| e.retired_sections().len()).unwrap()
    );
}

#[test]
fn test_map_and_superseded_reads_match_the_engine() {
    let _guard = serial_global_state();
    let (_tmp, sections, id) = seeded_catalogue();
    // A sport filter keeps the sections that sport's outings took, so the auto
    // section needs a ride over it to be listed under Ride.
    crate::with_persistent_engine(|e| {
        e.db.execute(
            "INSERT INTO section_activities (section_id, activity_id, direction, start_index,
                                             end_index, distance_meters, excluded)
             VALUES ('auto_1', 'a1', 'same', 0, 7, 100.0, 0)",
            [],
        )
        .unwrap();
    })
    .unwrap();

    let pooled = sections
        .get_map_sections(Some("Ride".into()), None)
        .unwrap();
    let locked = crate::with_persistent_engine(|e| e.get_map_sections(Some("Ride"), None)).unwrap();
    assert_eq!(pooled.len(), 2, "the custom section and the auto one");
    assert_eq!(format!("{pooled:?}"), format!("{locked:?}"));

    let floored = sections.get_map_sections(None, Some(2)).unwrap();
    let locked_floored =
        crate::with_persistent_engine(|e| e.get_map_sections(None, Some(2))).unwrap();
    assert_eq!(format!("{floored:?}"), format!("{locked_floored:?}"));

    assert!(
        sections
            .get_map_sections(Some("Run".into()), None)
            .unwrap()
            .is_empty()
    );

    let superseded =
        with_reader(|conn| queries::pooled::superseded_auto_sections(conn, &id, 50.0, 0.8))
            .unwrap();
    assert_eq!(superseded, vec!["auto_1".to_string()]);
    assert_eq!(
        superseded,
        crate::with_persistent_engine(|e| e.find_superseded_auto_sections(&id, 50.0, 0.8)).unwrap()
    );
}

#[test]
fn test_performance_derivations_match_the_engine() {
    let _guard = serial_global_state();
    let (_tmp, sections, _id) = seeded_catalogue();

    assert_eq!(
        format!(
            "{:?}",
            sections.get_workout_sections("Ride".into(), 5).unwrap()
        ),
        format!(
            "{:?}",
            crate::with_persistent_engine(|e| e.get_workout_sections_for_sport("Ride", 5)).unwrap()
        )
    );
}

#[test]
fn test_exclusions_read_through_the_pool() {
    let _guard = serial_global_state();
    let (_tmp, sections, id) = seeded_catalogue();
    crate::with_persistent_engine(|e| {
        e.db.execute(
            "INSERT OR REPLACE INTO section_activities
                 (section_id, activity_id, direction, start_index, end_index, distance_meters, excluded)
             VALUES (?1, 'a1', 'same', 0, 7, 800.0, 1)",
            rusqlite::params![id],
        )
        .unwrap();
    })
    .unwrap();
    assert_eq!(
        sections.get_excluded_activities(id.clone()).unwrap(),
        vec!["a1".to_string()]
    );
}

/// Scenario: the corridor list is read twice with nothing written, then once
/// more after a named intent commits.
///
/// Expected behaviour: the overlay is resolved once for the two reads and
/// again after the commit; a library with no named intent resolves nothing.
#[test]
fn named_corridors_resolve_the_overlay_once_per_database_state() {
    use crate::persistence::sections::named::compute::OVERLAY_COMPUTES;
    use std::sync::atomic::Ordering;

    let _guard = serial_global_state();
    let (tmp, sections) = empty_engine("named_corridors_cached.db");
    let computes = || OVERLAY_COMPUTES.load(Ordering::SeqCst);
    let start = computes();

    assert!(sections.get_named_corridors().unwrap().is_empty());
    assert!(sections.get_named_corridors().unwrap().is_empty());
    assert_eq!(computes(), start, "no named intent, so nothing to resolve");

    let writer = rusqlite::Connection::open(tmp.path().join("named_corridors_cached.db")).unwrap();
    writer
        .execute(
            "INSERT INTO section_intents (id, kind, polyline_json, created_at, name, sport_type)
             VALUES ('i1', 'named', '[]', datetime('now'), 'Col des Planches', 'Ride')",
            [],
        )
        .unwrap();

    sections.get_named_corridors().unwrap();
    sections.get_named_corridors().unwrap();
    assert_eq!(computes(), start + 1, "two reads of one state resolve once");

    writer
        .execute("UPDATE section_intents SET name = 'Col de la Croix'", [])
        .unwrap();
    sections.get_named_corridors().unwrap();
    assert_eq!(computes(), start + 2, "a commit drops the cached overlay");
}
