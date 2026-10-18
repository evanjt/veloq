//! A bulk ingest counts for the debounce as its rides one after another.
//!
//! Many rides stored before one detect are folded once, but the debounce is
//! credited as if each had arrived on its own in date order: a change counts
//! every ride dated at or after the first ride of the ingest that its cut
//! counted, so a change the earliest rides of a backfill support applies in
//! the same ingest, and a change only the last rides support waits as it
//! would have one sync at a time.

use std::collections::HashMap;
use std::sync::Arc;

use tempfile::TempDir;
use tracematch::{FrequentSection, GpsPoint};

use super::{SectionIdentity, SectionLifecycleEvent, SectionReplay};
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

/// Its first half, the re-cut every bulk below proposes.
fn short_line() -> Vec<GpsPoint> {
    line_at(46.0, 20)
}

/// The second half of the long line.
fn far_half() -> Vec<GpsPoint> {
    line_at(46.002, 20)
}

/// A raw detection cut on `line` whose members are `members`.
fn cut(line: Vec<GpsPoint>, members: &[&str]) -> FrequentSection {
    FrequentSection {
        id: "raw".to_string(),
        name: None,
        sport_type: "Ride".to_string(),
        distance_meters: tracematch::matching::calculate_route_distance(&line),
        point_density: vec![members.len() as u32; line.len()],
        representative_activity_id: members[0].to_string(),
        representative_range: Some((0, line.len() as u32)),
        polyline: line,
        activity_ids: members.iter().map(|m| m.to_string()).collect(),
        visit_count: members.len() as u32,
        activity_portions: Vec::new(),
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

const SEED: [&str; 2] = ["seed-1", "seed-2"];

/// Midnight UTC on a day of 2026, as the store keeps a start date.
const fn day(n: i64) -> i64 {
    1_767_225_600 + n * 86_400
}

fn store(engine: &mut PersistentEngine, id: &str, date: Option<i64>) {
    store_on(engine, id, date, long_line());
}

fn store_on(engine: &mut PersistentEngine, id: &str, date: Option<i64>, track: Vec<GpsPoint>) {
    engine
        .add_activity(id.into(), track, "Ride".into())
        .expect("add_activity");
    if let Some(date) = date {
        engine
            .update_activity_metadata(id, Some(date), None, None, None)
            .expect("update_activity_metadata");
    }
}

/// An engine whose registry holds one section on the long line, cut from
/// two seed rides, with one apply behind it.
fn seeded(dir: &TempDir) -> (PersistentEngine, SectionIdentity) {
    let path = dir.path().join("credit.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    for (i, id) in SEED.iter().enumerate() {
        store(&mut engine, id, Some(day(i as i64)));
    }
    let mut identity = SectionIdentity::default();
    let seed = engine.section_identity_apply_into(
        &mut identity,
        SectionReplay::whole(vec![cut(long_line(), &SEED)]),
    );
    assert_eq!(seed.visible.len(), 1, "the seed holds the long line");
    (engine, identity)
}

/// Store `rides` in the order given, each with its date, then apply one
/// catalogue for all of them that cuts the line short with the seed rides and
/// `riders` as its members.
fn bulk(
    rides: &[(&str, Option<i64>)],
    riders: &[&str],
) -> (SectionIdentity, Vec<SectionLifecycleEvent>, String) {
    let dir = TempDir::new().expect("tempdir");
    let (mut engine, mut identity) = seeded(&dir);
    let held = identity
        .rows
        .values()
        .next()
        .expect("the held row")
        .real_id
        .clone();
    for (id, date) in rides {
        store(&mut engine, id, *date);
    }
    let members: Vec<&str> = SEED.iter().chain(riders).copied().collect();
    let applied = engine.section_identity_apply_into(
        &mut identity,
        SectionReplay::whole(vec![cut(short_line(), &members)]),
    );
    (identity, applied.events, held)
}

fn kinds(events: &[SectionLifecycleEvent]) -> Vec<&'static str> {
    events.iter().map(|e| e.kind).collect()
}

fn pending(identity: &SectionIdentity, real_id: &str) -> bool {
    let pid = identity
        .rows
        .iter()
        .find(|(_, r)| r.real_id == real_id)
        .map(|(pid, _)| pid.clone())
        .expect("the row is still visible");
    identity.hysteresis.pending_ids().contains(&pid)
}

/// The registry with the birth stamps cleared, which read the clock.
fn registry_bytes(identity: &SectionIdentity) -> Vec<u8> {
    let mut identity = identity.clone();
    for row in identity.rows.values_mut() {
        Arc::make_mut(&mut row.section).created_at = None;
    }
    for grave in identity.graves.values_mut() {
        grave.created_at = None;
    }
    codec::serialize_named(&identity).expect("encode")
}

/// Three rides, named against their date order so an id order and a date
/// order disagree: `ride-c` is the earliest and `ride-a` the latest.
const THREE: [(&str, Option<i64>); 3] = [
    ("ride-a", Some(day(30))),
    ("ride-b", Some(day(20))),
    ("ride-c", Some(day(10))),
];

/// Scenario: three rides arrive in one detect, and the cut counts the
/// earliest of them on the shorter line, so one sync per ride would have
/// shown the shorter line after each of the three.
/// Expected behaviour: the re-cut applies in that one ingest.
#[test]
fn a_change_the_earliest_ride_supports_applies_in_one_ingest() {
    let (identity, events, held) = bulk(&THREE, &["ride-c"]);

    assert_eq!(kinds(&events), ["recut"]);
    assert_eq!(events[0].real_id, held);
    assert!(!pending(&identity, &held), "nothing is left pending");
}

/// Scenario: the same three rides, with the cut counting only the latest.
/// Expected behaviour: one sync per ride would have shown the change once, so
/// it is pending after the ingest with one confirmation and the line is held.
#[test]
fn a_change_only_the_last_ride_supports_waits() {
    let (identity, events, held) = bulk(&THREE, &["ride-a"]);

    assert!(events.is_empty(), "fired {:?}", kinds(&events));
    assert!(pending(&identity, &held));
}

/// Scenario: two rides arrive, one fewer than the debounce needs, and the cut
/// counts the earlier one.
/// Expected behaviour: two confirmations are not enough, so it waits.
#[test]
fn a_bulk_shorter_than_the_debounce_cannot_apply_a_change_alone() {
    let (identity, events, held) = bulk(&THREE[1..], &["ride-c"]);

    assert!(events.is_empty(), "fired {:?}", kinds(&events));
    assert!(pending(&identity, &held));
}

/// Scenario: the rides of the first case stored in the reverse order.
/// Expected behaviour: the registry and events are the same, since the
/// confirmations follow the rides' dates and not the order they were stored.
#[test]
fn storage_order_does_not_reach_the_debounce() {
    let mut reversed = THREE;
    reversed.reverse();
    let (forward, forward_events, _) = bulk(&THREE, &["ride-c"]);
    let (backward, backward_events, _) = bulk(&reversed, &["ride-c"]);

    assert_eq!(registry_bytes(&backward), registry_bytes(&forward));
    assert_eq!(kinds(&backward_events), kinds(&forward_events));
}

/// Scenario: three rides, one of them with no start date, and the cut counts
/// only the undated one.
/// Expected behaviour: a ride with no date is ordered after every dated ride,
/// so it is the last arrival and the change waits.
#[test]
fn an_undated_ride_counts_as_the_last_arrival() {
    let rides = [
        ("ride-a", Some(day(10))),
        ("ride-b", Some(day(20))),
        ("ride-0", None),
    ];
    let (identity, events, held) = bulk(&rides, &["ride-0"]);

    assert!(events.is_empty(), "fired {:?}", kinds(&events));
    assert!(pending(&identity, &held));
}

/// Scenario: the registry holds the corridor as two halves, and three rides
/// arrive in one detect whose cut draws it as one line counting the earliest
/// of them.
/// Expected behaviour: the junior half's retirement takes its confirmations
/// from the cut that took its ground, so it applies in the ingest, and the
/// senior half's re-cut onto the whole line with it.
#[test]
fn a_merge_the_earliest_ride_supports_applies_in_one_ingest() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("merge.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    for (i, id) in SEED.iter().enumerate() {
        store(&mut engine, id, Some(day(i as i64)));
    }
    let mut identity = SectionIdentity::default();
    engine.section_identity_apply_into(
        &mut identity,
        SectionReplay::whole(vec![
            cut(short_line(), &SEED[..1]),
            cut(far_half(), &SEED[1..]),
        ]),
    );
    assert_eq!(identity.rows.len(), 2, "the seed holds two halves");
    for (id, date) in THREE {
        store(&mut engine, id, date);
    }

    let members: Vec<&str> = SEED.iter().copied().chain(["ride-c"]).collect();
    let applied = engine.section_identity_apply_into(
        &mut identity,
        SectionReplay::whole(vec![cut(long_line(), &members)]),
    );

    let mut fired = kinds(&applied.events);
    fired.sort();
    assert_eq!(fired, ["merged", "recut"]);
    assert_eq!(identity.rows.len(), 1, "one line is left");
    assert!(identity.hysteresis.pending_ids().is_empty());
}

/// Ground well away from the corridor.
fn elsewhere() -> Vec<GpsPoint> {
    line_at(46.5, 40)
}

/// Store the three rides with only `on_line` riding the corridor and the rest
/// riding elsewhere, then apply one catalogue that cuts only the ground
/// elsewhere, so no cut takes the corridor's ground.
fn bulk_gone(on_line: &str) -> (SectionIdentity, Vec<SectionLifecycleEvent>, String) {
    let dir = TempDir::new().expect("tempdir");
    let (mut engine, mut identity) = seeded(&dir);
    let held = identity
        .rows
        .values()
        .next()
        .expect("the held row")
        .real_id
        .clone();
    let mut away = Vec::new();
    for (id, date) in THREE {
        let track = if id == on_line {
            long_line()
        } else {
            away.push(id);
            elsewhere()
        };
        store_on(&mut engine, id, date, track);
    }
    let applied = engine.section_identity_apply_into(
        &mut identity,
        SectionReplay::whole(vec![cut(elsewhere(), &away)]),
    );
    (identity, applied.events, held)
}

/// Scenario: three rides arrive in one detect, the earliest of them riding the
/// held corridor, and the cut takes none of its ground.
/// Expected behaviour: one sync per ride would have shown the corridor gone
/// after each of the three, so it dissolves in the ingest.
#[test]
fn ground_the_earliest_ride_passed_and_no_cut_took_dissolves_in_one_ingest() {
    let (identity, events, held) = bulk_gone("ride-c");

    assert_eq!(
        kinds(&events),
        ["formed", "dissolved"],
        "the cut elsewhere forms"
    );
    assert_eq!(events[1].real_id, held);
    assert!(identity.rows.values().all(|r| r.real_id != held));
}

/// Scenario: the same, with only the latest ride riding the corridor.
/// Expected behaviour: the absence is confirmed once, so the corridor stays
/// visible and pending.
#[test]
fn ground_only_the_last_ride_passed_waits() {
    let (identity, events, held) = bulk_gone("ride-a");

    assert_eq!(kinds(&events), ["formed"], "only the cut elsewhere forms");
    assert!(pending(&identity, &held));
}
