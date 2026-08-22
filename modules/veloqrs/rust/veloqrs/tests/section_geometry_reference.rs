//! Scenario: a detected catalogue, read back through the stored triple rather
//! than the cached line.
//! Expected behaviour: a section drawn from one activity records the range it
//! was sliced from, and re-slicing the stored stream reproduces the line point
//! for point. That is what makes the cached blob droppable.

#![cfg(feature = "synthetic")]

use rusqlite::Connection;
use tempfile::TempDir;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};
use tracematch::{DetectionMethod, GpsPoint, SectionConfig};
use veloqrs::PersistentRouteEngine;

fn corpus() -> Vec<LifecycleActivity> {
    LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 40,
        bucket_b_delta_count: 0,
        bucket_d_delta_count: 0,
        bucket_e_delta_count: 0,
        parallel_street_count: 2,
        ..LifecycleConfig::default()
    })
    .through_a()
    .into_iter()
    .cloned()
    .collect()
}

fn detected() -> (TempDir, PersistentRouteEngine) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("geometry.db");
    let mut engine = PersistentRouteEngine::new(path.to_str().unwrap()).expect("engine");
    engine.set_section_config(SectionConfig {
        detection_method: DetectionMethod::Unified,
        ..Default::default()
    });

    for activity in corpus() {
        engine
            .add_activity(
                activity.id.clone(),
                activity.gps_points.clone(),
                activity.sport_type.clone(),
            )
            .expect("add_activity");
        engine
            .update_activity_metadata(
                &activity.id,
                Some(activity.start_date_unix),
                None,
                None,
                None,
            )
            .expect("update_activity_metadata");
    }

    let handle = engine.detect_sections_background();
    let (sections, processed) = handle.recv().unwrap_or_default();
    engine.apply_sections(sections).expect("apply_sections");
    engine
        .save_processed_activity_ids(&processed)
        .expect("save_processed_activity_ids");

    (dir, engine)
}

/// One stored row's provenance: the triple plus the source it claims.
struct Stored {
    id: String,
    activity_id: Option<String>,
    start: Option<u32>,
    end: Option<u32>,
    source: Option<String>,
}

fn stored_rows(db: &Connection) -> Vec<Stored> {
    let mut stmt = db
        .prepare(
            "SELECT id, representative_activity_id, rep_start_index, rep_end_index, geometry_source
             FROM sections
             WHERE section_type = 'auto'
             ORDER BY id",
        )
        .expect("prepare");
    let rows = stmt
        .query_map([], |row| {
            Ok(Stored {
                id: row.get(0)?,
                activity_id: row.get(1)?,
                start: row.get(2)?,
                end: row.get(3)?,
                source: row.get(4)?,
            })
        })
        .expect("query")
        .collect::<Result<Vec<_>, _>>()
        .expect("rows");
    rows
}

fn same_points(a: &[GpsPoint], b: &[GpsPoint]) -> bool {
    a.len() == b.len()
        && a.iter().zip(b).all(|(x, y)| {
            x.latitude == y.latitude && x.longitude == y.longitude && x.elevation == y.elevation
        })
}

/// The detector records the range it sliced, and the range resolves.
#[test]
fn an_exact_section_re_slices_to_its_own_line() {
    let (dir, mut engine) = detected();
    let db = Connection::open(dir.path().join("geometry.db")).expect("open");
    let rows = stored_rows(&db);

    assert!(
        !rows.is_empty(),
        "no auto sections were detected, so this test would pass vacuously"
    );

    let mut checked = 0;
    for row in &rows {
        if row.source.as_deref() != Some("exact") {
            continue;
        }
        let activity_id = row
            .activity_id
            .as_deref()
            .expect("an exact row names its activity");
        let start = row.start.expect("an exact row carries a start") as usize;
        let end = row.end.expect("an exact row carries an end") as usize;

        let track = engine
            .get_gps_track(activity_id)
            .expect("the representative's stream is stored");
        assert!(
            end <= track.len() && start < end,
            "section {} has range {start}..{end} against a {}-point track",
            row.id,
            track.len()
        );

        let section = engine
            .get_section_by_id(&row.id)
            .expect("the row is readable");
        assert!(
            same_points(&track[start..end], &section.polyline),
            "section {} does not re-slice to its stored line",
            row.id
        );
        checked += 1;
    }

    assert!(
        checked > 0,
        "no section claimed an exact triple, so the round trip was never exercised"
    );
}

/// A row claims `exact` only when it can back the claim, and never otherwise.
#[test]
fn provenance_and_the_triple_agree() {
    let (dir, _engine) = detected();
    let db = Connection::open(dir.path().join("geometry.db")).expect("open");

    for row in stored_rows(&db) {
        let has_triple = row.start.is_some() && row.end.is_some() && row.activity_id.is_some();
        match row.source.as_deref() {
            Some("exact") => assert!(
                has_triple,
                "section {} claims exact with an incomplete triple",
                row.id
            ),
            other => assert!(
                row.start.is_none() && row.end.is_none(),
                "section {} carries a range but calls itself {:?}",
                row.id,
                other
            ),
        }
    }
}
