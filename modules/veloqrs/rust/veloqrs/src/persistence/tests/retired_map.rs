//! The retired-versus-current map read: each retired section with its newest
//! decodable line, every catalogue row visible or not, and the pairs between
//! them with the reason for each.

use crate::persistence::PersistentEngine;
use crate::persistence::codec;
use crate::persistence::sections::retired_map::GROUND_COMPARES;
use crate::{FfiRetiredMapData, FfiRetiredPairLink};
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

fn insert_section(engine: &PersistentEngine, id: &str, line: &[GpsPoint]) {
    let bounds = tracematch::geo_utils::compute_bounds(line);
    engine
        .db
        .execute(
            "INSERT INTO sections
                 (id, section_type, name, sport_type, polyline_blob, distance_meters,
                  representative_activity_id, rep_start_index, rep_end_index,
                  geometry_source, created_at, is_user_defined,
                  bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
             VALUES (?, 'auto', ?, 'Ride', ?, 1200.0, 'a1', 0, 12, 'exact',
                     '2026-01-01T00:00:00Z', 0, ?, ?, ?, ?)",
            params![
                id,
                format!("Name of {id}"),
                codec::serialize_track_points(line),
                bounds.min_lat,
                bounds.max_lat,
                bounds.min_lng,
                bounds.max_lng,
            ],
        )
        .expect("insert the section");
}

/// A library holding one stored ride and one auto section, `s_old`, on the
/// ride's first stretch.
fn library(dir: &TempDir, name: &str) -> PersistentEngine {
    let path = dir.path().join(name);
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    engine
        .add_activity("a1".into(), ride(7.0), "Ride".into())
        .expect("add_activity");
    insert_section(&engine, "s_old", &ride(7.0)[0..12]);
    engine
}

/// Take `section_id` out of the catalogue and record how it left.
fn retire(engine: &PersistentEngine, section_id: &str, kind: &str, details: &str) {
    engine
        .db
        .execute("DELETE FROM sections WHERE id = ?", [section_id])
        .expect("retire the section");
    engine
        .db
        .execute(
            "INSERT INTO section_history (section_id, at, kind, details)
             VALUES (?, '2026-02-01 00:00:00', ?, ?)",
            params![section_id, kind, details],
        )
        .expect("the departure");
}

fn pairs_of(data: &FfiRetiredMapData) -> Vec<(String, String, FfiRetiredPairLink)> {
    data.pairs
        .iter()
        .map(|p| (p.retired_id.clone(), p.current_id.clone(), p.link))
        .collect()
}

/// Scenario: the cutover retired a section, the detector cut a live section
/// over the same stretch, and a third live section lies on another corridor.
/// Expected behaviour: the retired and the overlapping live section pair as
/// `ground` with the overlap measured, both carry their lines, the far
/// section pairs with nothing, and the far section was never compared.
#[test]
fn a_retired_line_pairs_with_the_live_section_on_its_ground_and_skips_the_far_one() {
    let dir = TempDir::new().expect("tempdir");
    let engine = library(&dir, "ground-pair.db");
    engine.archive_current_catalogue().expect("archive");
    retire(&engine, "s_old", "dissolved", "{}");
    insert_section(&engine, "s_new", &ride(7.0)[0..14]);
    insert_section(&engine, "s_far", &ride(7.5)[0..12]);

    GROUND_COMPARES.with(|c| c.set(0));
    let data = engine.retired_map_data();

    assert_eq!(data.retired.len(), 1);
    assert_eq!(data.retired[0].section.section_id, "s_old");
    assert!(
        data.retired[0]
            .encoded_polyline
            .as_ref()
            .is_some_and(|line| !line.is_empty()),
        "the newest stored version draws"
    );
    let mut ids: Vec<&str> = data.current.iter().map(|c| c.id.as_str()).collect();
    ids.sort_unstable();
    assert_eq!(ids, vec!["s_far", "s_new"]);
    assert!(data.current.iter().all(|c| !c.encoded_polyline.is_empty()));
    assert_eq!(
        pairs_of(&data),
        vec![("s_old".into(), "s_new".into(), FfiRetiredPairLink::Ground)]
    );
    assert!(data.pairs[0].overlap.is_some_and(|o| o > 0.6));
    assert_eq!(
        GROUND_COMPARES.with(std::cell::Cell::get),
        1,
        "the bounding-box prefilter keeps the far section out of the comparison"
    );
}

/// Scenario: a retired section is restored over the auto section on its ground
/// and later retired again, leaving the auto section hidden behind its id.
/// Expected behaviour: while restored, the auto section is in `current` as
/// hidden and names the restored section; once retired again the two pair as
/// `supersedes`, not as `ground`.
#[test]
fn a_restored_section_hides_the_auto_row_it_covers_and_pairs_as_supersedes() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = library(&dir, "restore-supersedes.db");
    engine.archive_current_catalogue().expect("archive");
    let version: i64 = engine
        .db
        .query_row(
            "SELECT geometry_version FROM section_history
             WHERE section_id = 's_old' AND kind = 'archived'",
            [],
            |row| row.get(0),
        )
        .expect("archived state");
    retire(&engine, "s_old", "dissolved", "{}");
    insert_section(&engine, "s_recut", &ride(7.0)[0..12]);
    engine
        .revert_section_to_version("s_old", version)
        .expect("restore");

    let restored = engine.retired_map_data();
    assert!(restored.retired.is_empty());
    assert!(restored.pairs.is_empty());
    let recut = restored
        .current
        .iter()
        .find(|c| c.id == "s_recut")
        .expect("the hidden auto section is still listed");
    assert!(recut.hidden);
    assert_eq!(recut.superseded_by.as_deref(), Some("s_old"));
    let back = restored
        .current
        .iter()
        .find(|c| c.id == "s_old")
        .expect("the restored section");
    assert!(!back.hidden);
    assert!(back.is_user_defined);
    assert!(back.pinned);

    retire(&engine, "s_old", "dissolved", "{}");
    let again = engine.retired_map_data();
    assert_eq!(
        pairs_of(&again),
        vec![(
            "s_old".into(),
            "s_recut".into(),
            FfiRetiredPairLink::Supersedes
        )]
    );
}

/// Scenario: one retirement was merged into a live section on other ground,
/// and a chain of two retirements ends at the same live section.
/// Expected behaviour: each retired section pairs with the survivor as
/// `ledger`, though no line of theirs lies near it.
#[test]
fn a_merged_retirement_pairs_with_its_survivor_through_the_ledger() {
    let dir = TempDir::new().expect("tempdir");
    let engine = library(&dir, "ledger-pair.db");
    insert_section(&engine, "s_mid", &ride(7.1)[0..12]);
    insert_section(&engine, "s_survivor", &ride(7.5)[0..12]);
    engine.archive_current_catalogue().expect("archive");
    retire(&engine, "s_old", "merged", r#"{"into":"s_mid"}"#);
    retire(
        &engine,
        "s_mid",
        "superseded",
        r#"{"superseded_by":"s_survivor"}"#,
    );

    let data = engine.retired_map_data();

    let mut pairs = pairs_of(&data);
    pairs.sort_by(|a, b| a.0.cmp(&b.0));
    assert_eq!(
        pairs,
        vec![
            (
                "s_mid".into(),
                "s_survivor".into(),
                FfiRetiredPairLink::Ledger
            ),
            (
                "s_old".into(),
                "s_survivor".into(),
                FfiRetiredPairLink::Ledger
            ),
        ]
    );
    assert!(data.pairs.iter().all(|p| p.overlap.is_none()));
}

/// Scenario: a retired section left no stored version that decodes, while a
/// live section lies on its ground and a merge names it as the survivor.
/// Expected behaviour: the retired section is listed with no line and
/// pairs with nothing.
#[test]
fn a_retired_section_without_a_decodable_line_carries_no_line_and_no_pair() {
    let dir = TempDir::new().expect("tempdir");
    let engine = library(&dir, "no-line.db");
    insert_section(&engine, "s_new", &ride(7.0)[0..12]);
    retire(&engine, "s_old", "merged", r#"{"into":"s_new"}"#);

    let data = engine.retired_map_data();

    assert_eq!(data.retired.len(), 1);
    assert!(data.retired[0].section.versions.is_empty());
    assert_eq!(data.retired[0].encoded_polyline, None);
    assert_eq!(data.current.len(), 1);
    assert!(data.pairs.is_empty());
}

/// Scenario: the newest stored version of a retired section is damaged.
/// Expected behaviour: the line comes from the newest version that decodes.
#[test]
fn the_line_comes_from_the_newest_version_that_decodes() {
    let dir = TempDir::new().expect("tempdir");
    let engine = library(&dir, "damaged-newest.db");
    engine.archive_current_catalogue().expect("archive");
    retire(&engine, "s_old", "dissolved", "{}");
    let intact = engine.retired_map_data().retired[0]
        .encoded_polyline
        .clone();
    assert!(intact.is_some());

    engine
        .db
        .execute(
            "INSERT INTO section_geometry (section_id, version, source, blob, milestone, created_at)
             SELECT section_id, MAX(version) + 1, source, x'00', 0, created_at
             FROM section_geometry WHERE section_id = 's_old'",
            [],
        )
        .expect("a newer version that will not decode");
    crate::persistence::read_cache::clear();

    let data = engine.retired_map_data();
    assert_eq!(data.retired[0].section.versions.len(), 2);
    assert_eq!(data.retired[0].encoded_polyline, intact);
}
