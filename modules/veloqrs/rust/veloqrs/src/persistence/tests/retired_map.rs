//! The retired-versus-current map read: each retired section with its newest
//! decodable line, every catalogue row visible or not, and the pairs between
//! them with the reason for each.

use crate::persistence::PersistentEngine;
use crate::persistence::codec;
use crate::persistence::sections::retired_map::{GROUND_COMPARES, GROUND_SCANS};
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

/// Bring the stored ground pairs level, as the background worker does.
fn level(engine: &PersistentEngine) {
    engine
        .level_retired_pairs()
        .expect("level the ground pairs");
    crate::persistence::read_cache::clear();
}

fn scans() -> usize {
    GROUND_SCANS.with(std::cell::Cell::get)
}

fn reset_scans() {
    GROUND_SCANS.with(|c| c.set(0));
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
    level(&engine);
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
/// hidden and names the restored section, with a `supersedes` pair kept; once retired again the two pair as
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
    assert_eq!(restored.pairs.len(), 1, "the restore keeps its pair");
    assert_eq!(restored.pairs[0].retired_id, "s_old");
    assert_eq!(restored.pairs[0].current_id, "s_recut");
    assert!(matches!(
        restored.pairs[0].link,
        crate::FfiRetiredPairLink::Supersedes
    ));
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

/// Scenario: a retired section was archived with its visit count, and a live
/// section sits on its ground with a stored length and visit count.
/// Expected behaviour: the live row carries its distance and visits, and the
/// retired section carries the visits its archived state recorded, or the
/// ones its retirement event recorded when that names them.
#[test]
fn both_sides_of_the_comparison_carry_a_distance_and_a_visit_count() {
    let dir = TempDir::new().expect("tempdir");
    let engine = library(&dir, "counts.db");
    engine
        .db
        .execute("UPDATE sections SET visit_count = 9 WHERE id = 's_old'", [])
        .expect("visits on the old section");
    engine.archive_current_catalogue().expect("archive");
    retire(&engine, "s_old", "dissolved", "{}");
    insert_section(&engine, "s_new", &ride(7.0)[0..14]);
    engine
        .db
        .execute("UPDATE sections SET visit_count = 4 WHERE id = 's_new'", [])
        .expect("visits on the new section");

    let data = engine.retired_map_data();

    let current = data.current.iter().find(|c| c.id == "s_new").expect("row");
    assert_eq!(current.visit_count, 4);
    assert!((current.distance_meters - 1200.0).abs() < 1e-9);
    assert_eq!(data.retired[0].section.visit_count, Some(9));

    engine
        .db
        .execute(
            "UPDATE section_history SET details = '{\"visit_count\": 11}'
             WHERE section_id = 's_old' AND kind = 'dissolved'",
            [],
        )
        .expect("the departure names its visits");
    let named = engine.retired_map_data();
    assert_eq!(named.retired[0].section.visit_count, Some(11));
}

/// Scenario: three hundred retired sections, each cut over by a current
/// section shifted along the same corridor, with corridors far apart.
/// Expected behaviour: every retired section pairs with its twin as `ground`,
/// and the pair search scans each pair whose boxes meet once, not once to
/// decide and again to measure the overlap.
#[test]
fn a_pair_on_shared_ground_is_scanned_once() {
    let dir = TempDir::new().expect("tempdir");
    let engine = library(&dir, "volume.db");
    engine
        .db
        .execute("DELETE FROM sections", [])
        .expect("empty the catalogue");
    let corridor = |i: usize, shift: usize| -> Vec<GpsPoint> {
        (0..40)
            .map(|k| GpsPoint {
                latitude: 46.0 + i as f64 * 0.01,
                longitude: 7.0 + (k + shift) as f64 * 0.000_3,
                elevation: None,
            })
            .collect()
    };
    for i in 0..300 {
        insert_section(&engine, &format!("old_{i}"), &corridor(i, 0));
    }
    for i in 0..300 {
        let id = format!("old_{i}");
        let at = |n: i64| format!("2026-02-01 00:00:{:02}", n % 60);
        engine
            .db
            .execute("DELETE FROM sections WHERE id = ?", [&id])
            .expect("retire");
        engine
            .db
            .execute(
                "INSERT INTO section_geometry (section_id, version, source, blob, milestone, created_at)
                 VALUES (?, 1, 'consensus', ?, 0, ?)",
                params![id, codec::encode_polyline(&corridor(i, 0)), at(0)],
            )
            .expect("the archived line");
        engine
            .db
            .execute(
                "INSERT INTO section_history (section_id, at, kind, details, geometry_version)
                 VALUES (?, ?, 'dissolved', '{}', 1)",
                params![id, at(1)],
            )
            .expect("the departure");
        insert_section(&engine, &format!("new_{i}"), &corridor(i, 2));
    }

    GROUND_COMPARES.with(|c| c.set(0));
    GROUND_SCANS.with(|c| c.set(0));
    level(&engine);
    let data = engine.retired_map_data();

    assert_eq!(data.retired.len(), 300);
    let ground = data
        .pairs
        .iter()
        .filter(|p| p.link == FfiRetiredPairLink::Ground)
        .count();
    assert_eq!(ground, 300);
    let compares = GROUND_COMPARES.with(std::cell::Cell::get);
    assert_eq!(compares, 300, "only the twin's box meets");
    assert_eq!(
        GROUND_SCANS.with(std::cell::Cell::get),
        compares,
        "one scan per compared pair"
    );
}

/// Scenario: the ground pairs were worked out, then a sync stored a ride and
/// the screen opened again.
/// Expected behaviour: the second open reads the same pairs and scans no
/// ground, since no section line moved.
#[test]
fn a_second_open_after_an_activity_sync_scans_no_ground() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = library(&dir, "sync-reopen.db");
    engine.archive_current_catalogue().expect("archive");
    retire(&engine, "s_old", "dissolved", "{}");
    insert_section(&engine, "s_new", &ride(7.0)[0..14]);
    level(&engine);
    let first = engine.retired_map_data();
    assert_eq!(
        pairs_of(&first),
        vec![("s_old".into(), "s_new".into(), FfiRetiredPairLink::Ground)]
    );

    engine
        .add_activity("a2".into(), ride(7.3), "Ride".into())
        .expect("a synced ride");
    crate::persistence::read_cache::clear();
    reset_scans();
    let second = engine.retired_map_data();

    assert_eq!(pairs_of(&second), pairs_of(&first));
    assert_eq!(second.pairs[0].overlap, first.pairs[0].overlap);
    assert!(!second.pairs_pending);
    assert_eq!(scans(), 0, "the open read the stored pairs");
}

/// Scenario: a retired section shares ground with one live section and was
/// merged into another, and the engine has not yet worked out the ground.
/// Expected behaviour: the read says the pairs are still owed, keeps the
/// ledger link, lists no ground pair and scans nothing. Once levelled the
/// ground pair is there and nothing is owed.
#[test]
fn the_read_says_ground_pairs_are_owed_and_keeps_its_ledger_links() {
    let dir = TempDir::new().expect("tempdir");
    let engine = library(&dir, "owed.db");
    insert_section(&engine, "s_survivor", &ride(7.5)[0..12]);
    engine.archive_current_catalogue().expect("archive");
    retire(&engine, "s_old", "merged", r#"{"into":"s_survivor"}"#);
    insert_section(&engine, "s_new", &ride(7.0)[0..14]);

    reset_scans();
    let owed = engine.retired_map_data();
    assert!(owed.pairs_pending);
    assert_eq!(
        pairs_of(&owed),
        vec![(
            "s_old".into(),
            "s_survivor".into(),
            FfiRetiredPairLink::Ledger
        )]
    );
    assert_eq!(scans(), 0, "the read works out no ground itself");

    level(&engine);
    let level = engine.retired_map_data();
    assert!(!level.pairs_pending);
    let mut pairs = pairs_of(&level);
    pairs.sort_by(|a, b| (&a.0, &a.1).cmp(&(&b.0, &b.1)));
    assert_eq!(
        pairs,
        vec![
            ("s_old".into(), "s_new".into(), FfiRetiredPairLink::Ground),
            (
                "s_old".into(),
                "s_survivor".into(),
                FfiRetiredPairLink::Ledger
            ),
        ]
    );
}

/// Three corridors, each holding a retired line and the live line cut over it.
fn corridors(dir: &TempDir, name: &str) -> PersistentEngine {
    let engine = library(dir, name);
    engine
        .db
        .execute("DELETE FROM sections", [])
        .expect("empty the catalogue");
    for i in 0..3 {
        let id = format!("old_{i}");
        engine
            .db
            .execute(
                "INSERT INTO section_geometry (section_id, version, source, blob, milestone, created_at)
                 VALUES (?, 1, 'consensus', ?, 0, '2026-02-01 00:00:00')",
                params![id, codec::encode_polyline(&corridor(i, 0))],
            )
            .expect("the archived line");
        engine
            .db
            .execute(
                "INSERT INTO section_history (section_id, at, kind, details, geometry_version)
                 VALUES (?, '2026-02-01 00:00:01', 'dissolved', '{}', 1)",
                [&id],
            )
            .expect("the departure");
        insert_section(&engine, &format!("new_{i}"), &corridor(i, 2));
    }
    engine
}

fn corridor(i: usize, shift: usize) -> Vec<GpsPoint> {
    (0..40)
        .map(|k| GpsPoint {
            latitude: 46.0 + i as f64 * 0.01,
            longitude: 7.0 + (k + shift) as f64 * 0.000_3,
            elevation: None,
        })
        .collect()
}

fn stored_pairs(engine: &PersistentEngine) -> Vec<(String, String, String)> {
    let mut stmt = engine
        .db
        .prepare(
            "SELECT retired_id, current_id, printf('%.9f', overlap)
             FROM retired_ground_pairs ORDER BY retired_id, current_id",
        )
        .expect("the stored pairs");
    stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .expect("the stored pairs")
        .collect::<Result<_, _>>()
        .expect("the stored pairs")
}

/// Scenario: the pairs are level, then one live line is re-drawn on its
/// ground, one moves to a corridor of its own and one is removed.
/// Expected behaviour: the level after scans only the lines that moved, the
/// removed line's pair goes without a scan, a second level does nothing, and
/// the result is what a rebuild from an empty table finds.
#[test]
fn a_changed_line_rescans_only_its_own_pairs() {
    let dir = TempDir::new().expect("tempdir");
    let engine = corridors(&dir, "edit.db");
    level(&engine);
    assert_eq!(engine.retired_map_data().pairs.len(), 3);

    let redraw = |id: &str, line: &[GpsPoint]| {
        let b = tracematch::geo_utils::compute_bounds(line);
        engine
            .db
            .execute(
                "UPDATE sections SET polyline_blob = ?, bounds_min_lat = ?, bounds_max_lat = ?,
                     bounds_min_lng = ?, bounds_max_lng = ? WHERE id = ?",
                params![
                    codec::serialize_track_points(line),
                    b.min_lat,
                    b.max_lat,
                    b.min_lng,
                    b.max_lng,
                    id
                ],
            )
            .expect("re-draw the section");
    };
    redraw("new_1", &corridor(1, 4));
    redraw("new_2", &corridor(7, 0));
    engine
        .db
        .execute("DELETE FROM sections WHERE id = 'new_0'", [])
        .expect("remove the section");
    crate::persistence::read_cache::clear();
    assert!(engine.retired_map_data().pairs_pending);

    reset_scans();
    level(&engine);
    assert_eq!(scans(), 1, "new_1 against old_1, the one box it meets");
    let data = engine.retired_map_data();
    assert!(!data.pairs_pending);
    assert_eq!(
        pairs_of(&data),
        vec![("old_1".into(), "new_1".into(), FfiRetiredPairLink::Ground)]
    );

    reset_scans();
    assert_eq!(engine.level_retired_pairs().expect("level"), 0);
    assert_eq!(scans(), 0, "a level table owes nothing");

    let incremental = stored_pairs(&engine);
    engine
        .db
        .execute_batch("DELETE FROM retired_ground_pairs; DELETE FROM retired_ground_lines;")
        .expect("empty the table");
    level(&engine);
    assert_eq!(stored_pairs(&engine), incremental);
}

/// Scenario: the pairs are level, then a second section is retired.
/// Expected behaviour: the new retired line is owed and scanned against the
/// live lines its box meets, and the pairs already stored are not scanned again.
#[test]
fn a_section_retired_after_levelling_scans_only_its_own_line() {
    let dir = TempDir::new().expect("tempdir");
    let engine = corridors(&dir, "retire-after.db");
    insert_section(&engine, "s_late", &corridor(1, 1));
    level(&engine);
    assert_eq!(engine.retired_map_data().pairs.len(), 4);

    engine
        .db
        .execute(
            "INSERT INTO section_geometry (section_id, version, source, blob, milestone, created_at)
             VALUES ('s_late', 1, 'consensus', ?, 0, '2026-03-01 00:00:00')",
            [codec::encode_polyline(&corridor(1, 1))],
        )
        .expect("the archived line");
    retire(&engine, "s_late", "dissolved", "{}");
    crate::persistence::read_cache::clear();
    assert!(engine.retired_map_data().pairs_pending);

    reset_scans();
    level(&engine);
    assert_eq!(
        scans(),
        1,
        "s_late against new_1, the one live box it meets"
    );
    let mut pairs = pairs_of(&engine.retired_map_data());
    pairs.sort_by(|a, b| (&a.0, &a.1).cmp(&(&b.0, &b.1)));
    assert_eq!(
        pairs,
        vec![
            ("old_0".into(), "new_0".into(), FfiRetiredPairLink::Ground),
            ("old_1".into(), "new_1".into(), FfiRetiredPairLink::Ground),
            ("old_2".into(), "new_2".into(), FfiRetiredPairLink::Ground),
            ("s_late".into(), "new_1".into(), FfiRetiredPairLink::Ground),
        ]
    );
}
