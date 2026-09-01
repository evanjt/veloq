//! A custom section cut from a stored ride is a slice of that ride, and the
//! row must say so. The reference triple
//! (`representative_activity_id`, `rep_start_index`, `rep_end_index`) is what
//! the resolver re-slices from, so a section that carries only the source
//! triple reads as having no provenance and degrades to an empty line once
//! its blob is gone.
//!
//! Run: `cargo test --test custom_section_provenance -p veloqrs`

use rusqlite::{Connection, params};
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;
use veloqrs::sections::CreateSectionParams;

struct Setup {
    engine: PersistentEngine,
    raw: Connection,
    _tmp: TempDir,
}

fn setup() -> Setup {
    let tmp = TempDir::new().expect("temp dir");
    let path = tmp.path().join("provenance.db");
    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine new");
    let raw = Connection::open(&path).expect("raw open");
    Setup {
        engine,
        raw,
        _tmp: tmp,
    }
}

/// Twenty points ~55 m apart along a meridian.
fn ride() -> Vec<GpsPoint> {
    (0..20)
        .map(|i| GpsPoint::new(46.0 + i as f64 * 0.0005, 7.0))
        .collect()
}

type Provenance = (Option<String>, Option<u32>, Option<u32>, Option<String>);

fn provenance(db: &Connection, id: &str) -> Provenance {
    db.query_row(
        "SELECT representative_activity_id, rep_start_index, rep_end_index, geometry_source
         FROM sections WHERE id = ?",
        params![id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    )
    .expect("section row")
}

fn assert_close(points: &[GpsPoint], expected: &[GpsPoint]) {
    assert_eq!(points.len(), expected.len(), "polyline length mismatch");
    for (got, want) in points.iter().zip(expected) {
        assert!(
            (got.latitude - want.latitude).abs() < 1e-9
                && (got.longitude - want.longitude).abs() < 1e-9,
            "point mismatch: {:?} vs {:?}",
            got,
            want
        );
    }
}

fn cut_from_a_ride(s: &mut Setup, activity_id: &str, start: u32, end: u32) -> String {
    let ride = ride();
    s.engine
        .add_activity(activity_id.to_string(), ride.clone(), "Ride".to_string())
        .expect("add activity");
    let slice = ride[start as usize..=end as usize].to_vec();
    s.engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".to_string(),
            polyline: slice.clone(),
            distance_meters: tracematch::matching::calculate_route_distance(&slice),
            name: Some("Home climb".to_string()),
            source_activity_id: Some(activity_id.to_string()),
            start_index: Some(start),
            end_index: Some(end),
        })
        .expect("create section")
}

#[test]
fn a_section_cut_from_a_ride_stores_the_reference_triple() {
    let mut s = setup();
    let id = cut_from_a_ride(&mut s, "act_cut", 4, 12);

    let (rep_id, rep_start, rep_end, source) = provenance(&s.raw, &id);
    assert_eq!(rep_id.as_deref(), Some("act_cut"));
    assert_eq!(rep_start, Some(4), "rep_start_index was never written");
    assert_eq!(
        rep_end,
        Some(13),
        "the triple is half-open, so an inclusive end moves on by one"
    );
    assert_eq!(source.as_deref(), Some("exact"));
}

/// The blob is a cache. With the triple in the row the resolver re-slices the
/// stored stream, so clearing the blob costs nothing.
#[test]
fn a_cut_section_rebuilds_its_line_after_the_blob_is_cleared() {
    let mut s = setup();
    let id = cut_from_a_ride(&mut s, "act_rebuild", 4, 12);
    let expected = ride()[4..=12].to_vec();

    s.raw
        .execute(
            "UPDATE sections SET polyline_blob = NULL, polyline_json = NULL WHERE id = ?",
            params![id],
        )
        .expect("clear the cached line");

    let reopened = PersistentEngine::new(s.raw.path().expect("db path")).expect("reopen");
    let section = reopened.get_section(&id).expect("section still readable");
    assert_close(&section.polyline, &expected);
}

/// A whole-ride cut is the boundary case: the first and last index of the
/// stream, and the triple must survive it unclamped.
#[test]
fn a_whole_ride_cut_keeps_its_end_index() {
    let mut s = setup();
    let last = (ride().len() - 1) as u32;
    let id = cut_from_a_ride(&mut s, "act_whole", 0, last);

    let (_, rep_start, rep_end, source) = provenance(&s.raw, &id);
    assert_eq!(rep_start, Some(0));
    assert_eq!(rep_end, Some(last + 1), "the whole stream, not one short");
    assert_eq!(source.as_deref(), Some("exact"));
}

/// A hand-drawn line has no stream behind it. It is not rebuildable, and the
/// stamp must say so rather than claim a slice that does not exist.
#[test]
fn a_hand_drawn_section_is_stamped_consensus() {
    let mut s = setup();
    let drawn = ride()[0..6].to_vec();
    let id = s
        .engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".to_string(),
            polyline: drawn.clone(),
            distance_meters: tracematch::matching::calculate_route_distance(&drawn),
            name: Some("Drawn".to_string()),
            source_activity_id: None,
            start_index: None,
            end_index: None,
        })
        .expect("create section");

    let (rep_id, rep_start, rep_end, source) = provenance(&s.raw, &id);
    assert_eq!(rep_id, None, "a drawn line indexes no activity");
    assert_eq!(rep_start, None);
    assert_eq!(rep_end, None);
    assert_eq!(source.as_deref(), Some("consensus"));
}

/// A half triple indexes nothing. A source activity with no range is the same
/// as no source at all.
#[test]
fn a_source_activity_without_a_range_is_not_exact() {
    let mut s = setup();
    let ride = ride();
    s.engine
        .add_activity("act_half".to_string(), ride.clone(), "Ride".to_string())
        .expect("add activity");
    let drawn = ride[0..6].to_vec();
    let id = s
        .engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".to_string(),
            polyline: drawn.clone(),
            distance_meters: tracematch::matching::calculate_route_distance(&drawn),
            name: Some("Half".to_string()),
            source_activity_id: Some("act_half".to_string()),
            start_index: None,
            end_index: None,
        })
        .expect("create section");

    let (_, rep_start, rep_end, source) = provenance(&s.raw, &id);
    assert_eq!(rep_start, None);
    assert_eq!(rep_end, None);
    assert_eq!(
        source.as_deref(),
        Some("consensus"),
        "a half triple must not be stamped exact"
    );
}

/// The rows already on disk. Every custom section created before the triple
/// was written carries the source range and nothing else, so the upgrade has
/// to move it across. Simulated by clearing what the fixed create path writes,
/// which is exactly the shape the old one left.
fn strip_the_reference(db: &Connection, id: &str) {
    db.execute(
        "UPDATE sections
            SET rep_start_index = NULL, rep_end_index = NULL, geometry_source = NULL
          WHERE id = ?",
        params![id],
    )
    .expect("strip the reference triple");
}

#[test]
fn an_upgrade_backfills_the_triple_of_a_section_cut_before_the_fix() {
    let mut s = setup();
    let id = cut_from_a_ride(&mut s, "act_upgrade", 4, 12);
    strip_the_reference(&s.raw, &id);

    let path = s.raw.path().expect("db path").to_string();
    drop(s.engine);
    let _upgraded = PersistentEngine::new(&path).expect("reopen");

    let (rep_id, rep_start, rep_end, source) = provenance(&s.raw, &id);
    assert_eq!(rep_id.as_deref(), Some("act_upgrade"));
    assert_eq!(rep_start, Some(4), "the upgrade did not backfill the start");
    assert_eq!(rep_end, Some(13), "the upgrade did not backfill the end");
    assert_eq!(source.as_deref(), Some("exact"));
}

/// The upgrade is only worth running if the row it repairs can then rebuild.
#[test]
fn a_backfilled_section_rebuilds_its_line() {
    let mut s = setup();
    let id = cut_from_a_ride(&mut s, "act_backfill", 4, 12);
    strip_the_reference(&s.raw, &id);
    let expected = ride()[4..=12].to_vec();

    let path = s.raw.path().expect("db path").to_string();
    drop(s.engine);
    let upgraded = PersistentEngine::new(&path).expect("reopen");
    s.raw
        .execute(
            "UPDATE sections SET polyline_blob = NULL, polyline_json = NULL WHERE id = ?",
            params![id],
        )
        .expect("clear the cached line");
    drop(upgraded);

    let reopened = PersistentEngine::new(&path).expect("reopen again");
    let section = reopened.get_section(&id).expect("section still readable");
    assert_close(&section.polyline, &expected);
}

/// A second open must not move a triple that is already right, and must leave
/// a row with no source range alone rather than inventing one.
#[test]
fn the_backfill_is_idempotent_and_skips_what_it_cannot_rebuild() {
    let mut s = setup();
    let cut = cut_from_a_ride(&mut s, "act_twice", 4, 12);
    let drawn = ride()[0..6].to_vec();
    let hand = s
        .engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".to_string(),
            polyline: drawn.clone(),
            distance_meters: tracematch::matching::calculate_route_distance(&drawn),
            name: Some("Drawn".to_string()),
            source_activity_id: None,
            start_index: None,
            end_index: None,
        })
        .expect("create section");

    let path = s.raw.path().expect("db path").to_string();
    drop(s.engine);
    for _ in 0..2 {
        drop(PersistentEngine::new(&path).expect("reopen"));
    }

    let (_, rep_start, rep_end, source) = provenance(&s.raw, &cut);
    assert_eq!((rep_start, rep_end), (Some(4), Some(13)));
    assert_eq!(source.as_deref(), Some("exact"));

    let (rep_id, rep_start, rep_end, source) = provenance(&s.raw, &hand);
    assert_eq!(rep_id, None);
    assert_eq!((rep_start, rep_end), (None, None));
    assert_eq!(source.as_deref(), Some("consensus"));
}

/// A range that spans one point is not a line. Rebuilding from it would turn
/// a row that reads as empty into a plausible single point, so neither the
/// create path nor the backfill claims it.
#[test]
fn a_single_point_range_earns_no_triple() {
    let mut s = setup();
    let id = cut_from_a_ride(&mut s, "act_degenerate", 3, 3);

    let (_, rep_start, rep_end, source) = provenance(&s.raw, &id);
    assert_eq!((rep_start, rep_end), (None, None));
    assert_eq!(source.as_deref(), Some("consensus"));

    let path = s.raw.path().expect("db path").to_string();
    drop(s.engine);
    drop(PersistentEngine::new(&path).expect("reopen"));

    let (_, rep_start, rep_end, _) = provenance(&s.raw, &id);
    assert_eq!(
        (rep_start, rep_end),
        (None, None),
        "the backfill claimed a range that spans no line"
    );
}
