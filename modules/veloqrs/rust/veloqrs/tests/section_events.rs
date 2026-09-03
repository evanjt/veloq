//! The lifecycle emitter: the identity apply turns fired changes into
//! `section_history` and `section_geometry` rows, written inside the same
//! transaction as the catalogue save. Contracts:
//! - a mint writes one `formed` event with the birth geometry as version 1,
//! - repeat applies of an unchanged pool write nothing (no event spam from
//!   agreement refinements),
//! - a sustained dissolve writes one `dissolved` event carrying the era
//!   snapshot of the section as it was (visits per month at fire time),
//! - a re-emergence writes one `restored` event with a fresh geometry
//!   version, onto the same real id.
//!
//! Synthetic geometry only; corridors sit >100 m apart so the 50 m ground
//! metric never bridges them.
//!
//! Run:
//!   cargo test -p veloqrs --features synthetic --test section_events

mod lifecycle_support;

use lifecycle_support::*;
use tracematch::scenarios::LifecycleActivity;
use tracematch::{GpsPoint, shares_ground};

const DAY: i64 = 86_400;
const T0: i64 = 1_700_000_000;
const TRUNK_LEN_M: f64 = 2_000.0;
const STEP_M: f64 = 10.0;
const BASE_LAT: f64 = 46.0;
const BASE_LON: f64 = 7.10;

fn deg_lat(m: f64) -> f64 {
    m / 111_320.0
}

fn deg_lon(m: f64) -> f64 {
    m / (111_320.0 * BASE_LAT.to_radians().cos())
}

fn pt(north_m: f64, east_m: f64) -> GpsPoint {
    GpsPoint {
        latitude: BASE_LAT + deg_lat(north_m),
        longitude: BASE_LON + deg_lon(east_m),
        elevation: Some(500.0),
    }
}

fn corridor_ride(east_m: f64, jitter_m: f64) -> Vec<GpsPoint> {
    let mut pts = Vec::new();
    let mut d = 0.0;
    while d <= TRUNK_LEN_M {
        pts.push(pt(d, east_m + jitter_m));
        d += STEP_M;
    }
    pts
}

fn corridor_ground(east_m: f64) -> Vec<GpsPoint> {
    corridor_ride(east_m, 0.0)
}

fn act(id: String, day: i64, pts: Vec<GpsPoint>) -> LifecycleActivity {
    LifecycleActivity {
        id,
        sport_type: "Ride".to_string(),
        start_date_unix: T0 + day * DAY,
        gps_points: pts,
    }
}

/// `count` laterally jittered rides of one corridor, one per day.
fn corridor_rides(prefix: &str, east_m: f64, count: usize, day0: i64) -> Vec<LifecycleActivity> {
    (0..count)
        .map(|i| {
            let jitter = (i as f64 - (count as f64 - 1.0) / 2.0) * 1.5;
            act(
                format!("{prefix}_{i:02}"),
                day0 + i as i64,
                corridor_ride(east_m, jitter),
            )
        })
        .collect()
}

/// A far-away two-point activity that forms no section: forces a fresh
/// detect+apply without perturbing any corridor.
fn filler_act(tag: &str, day: i64) -> LifecycleActivity {
    act(
        format!("filler_{tag}_{day}"),
        day,
        vec![pt(300_000.0, 0.0), pt(300_500.0, 0.0)],
    )
}

/// The busiest visible section on `ground`.
fn section_on(snap: &SectionSnapshot, ground: &[GpsPoint]) -> Option<(String, SectionFingerprint)> {
    snap.sections
        .iter()
        .filter(|(_, f)| shares_ground(&f.polyline, ground))
        .max_by_key(|(_, f)| f.visit_count)
        .map(|(id, f)| (id.clone(), f.clone()))
}

fn kinds(engine: &veloqrs::PersistentEngine, id: &str) -> Vec<String> {
    engine
        .section_history(id)
        .into_iter()
        .map(|e| e.kind)
        .collect()
}

#[test]
fn cold_ingest_writes_one_formed_event_with_birth_geometry() {
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let rides = corridor_rides("ca", 0.0, 9, 0);
    let snap = ingest_step(&mut engine, "cold", &refs(&rides)).snapshot;
    let (id, fp) = section_on(&snap, &corridor_ground(0.0)).expect("corpus fault: no section");

    assert_eq!(kinds(&engine, &id), vec!["formed"]);
    let event = &engine.section_history(&id)[0];
    assert_eq!(event.geometry_version, Some(1));
    let birth = engine
        .section_geometry_polyline(&id, 1)
        .expect("birth geometry stored");
    assert!(
        shares_ground(&birth, &fp.polyline),
        "version 1 must be the section's ground at birth"
    );
}

#[test]
fn unchanged_pool_applies_write_no_events() {
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let rides = corridor_rides("ca", 0.0, 9, 0);
    let snap = ingest_step(&mut engine, "cold", &refs(&rides)).snapshot;
    let (id, _) = section_on(&snap, &corridor_ground(0.0)).expect("corpus fault: no section");

    for i in 0..4 {
        let filler = filler_act("steady", 20 + i);
        ingest_step(&mut engine, "steady", &[&filler]);
    }
    assert_eq!(
        kinds(&engine, &id),
        vec!["formed"],
        "an unchanged corridor must accumulate no history"
    );
    assert_eq!(
        engine.section_geometry_versions(&id).len(),
        1,
        "agreement refinements must not stack geometry versions"
    );
}

#[test]
fn sustained_dissolve_writes_one_event_with_an_era_snapshot() {
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let rides_a = corridor_rides("ca", 0.0, 9, 0);
    let rides_b = corridor_rides("cb", 1_500.0, 9, 10);
    let mut pool = refs(&rides_a);
    pool.extend(refs(&rides_b));
    let snap = ingest_step(&mut engine, "cold", &pool).snapshot;
    let (id_a, _) = section_on(&snap, &corridor_ground(0.0)).expect("corpus fault: corridor A");

    for aid in rides_a.iter().map(|r| r.id.clone()).collect::<Vec<_>>() {
        engine.remove_activity(&aid).expect("remove_activity");
    }
    for i in 0..3 {
        let filler = filler_act("drain", 40 + i);
        ingest_step(&mut engine, "drain", &[&filler]);
    }

    let history = engine.section_history(&id_a);
    assert_eq!(
        history.iter().map(|e| e.kind.as_str()).collect::<Vec<_>>(),
        vec!["formed", "dissolved"],
        "exactly one dissolve fires, on the k-th sustained detect"
    );
    let details: serde_json::Value = serde_json::from_str(
        history[1]
            .details
            .as_deref()
            .expect("a dissolve carries its era snapshot"),
    )
    .expect("snapshot is JSON");
    for key in ["pr_activity_id", "pr_time", "avg_time", "visits_per_month"] {
        assert!(details.get(key).is_some(), "snapshot must carry {key}");
    }
}

#[test]
fn re_emerged_ground_writes_a_restored_event_on_the_same_id() {
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let rides_a = corridor_rides("ca", 0.0, 9, 0);
    let rides_b = corridor_rides("cb", 1_500.0, 9, 10);
    let mut pool = refs(&rides_a);
    pool.extend(refs(&rides_b));
    let snap = ingest_step(&mut engine, "cold", &pool).snapshot;
    let (id_a, _) = section_on(&snap, &corridor_ground(0.0)).expect("corpus fault: corridor A");

    for aid in rides_a.iter().map(|r| r.id.clone()).collect::<Vec<_>>() {
        engine.remove_activity(&aid).expect("remove_activity");
    }
    for i in 0..3 {
        let filler = filler_act("drain", 40 + i);
        ingest_step(&mut engine, "drain", &[&filler]);
    }

    let revived = corridor_rides("cr", 0.0, 9, 60);
    let snap = ingest_step(&mut engine, "revive", &refs(&revived)).snapshot;
    let (id_now, _) = section_on(&snap, &corridor_ground(0.0)).expect("corridor A re-emerges");
    assert_eq!(id_now, id_a, "re-emerged ground restores its real id");

    let history_kinds = kinds(&engine, &id_a);
    assert_eq!(
        history_kinds,
        vec!["formed", "dissolved", "restored"],
        "the full arc reads from one id's history"
    );
    let restored = &engine.section_history(&id_a)[2];
    let version = restored
        .geometry_version
        .expect("a restore records the re-emerged geometry");
    assert!(version > 1, "the restore geometry is a fresh version");
    assert!(engine.section_geometry_polyline(&id_a, version).is_some());
}

/// An era snapshot narrates what the athlete sees, and the athlete's view
/// filters excluded traversals. Two member rows at fire time with one
/// excluded must snapshot as one visit, not two.
#[test]
fn era_snapshot_counts_only_included_traversals() {
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let rides_a = corridor_rides("ca", 0.0, 9, 0);
    let rides_b = corridor_rides("cb", 1_500.0, 9, 10);
    let mut pool = refs(&rides_a);
    pool.extend(refs(&rides_b));
    let snap = ingest_step(&mut engine, "cold", &pool).snapshot;
    let (id_a, _) = section_on(&snap, &corridor_ground(0.0)).expect("corpus fault: corridor A");

    // Drain corridor A below its support floor while two members survive,
    // one of them excluded. The dissolve then fires with rows present.
    for aid in rides_a
        .iter()
        .skip(2)
        .map(|r| r.id.clone())
        .collect::<Vec<_>>()
    {
        engine.remove_activity(&aid).expect("remove_activity");
    }
    engine
        .exclude_activity_from_section(&id_a, &rides_a[0].id)
        .expect("exclude one survivor");
    for i in 0..3 {
        let filler = filler_act("vpm", 60 + i);
        ingest_step(&mut engine, "vpm", &[&filler]);
    }

    let history = engine.section_history(&id_a);
    let dissolve = history
        .iter()
        .find(|e| e.kind == "dissolved")
        .expect("the drain must dissolve corridor A");
    let details: serde_json::Value =
        serde_json::from_str(dissolve.details.as_deref().expect("era snapshot"))
            .expect("snapshot is JSON");
    assert_eq!(
        details.get("visits_per_month").and_then(|v| v.as_f64()),
        Some(1.0),
        "one included row over a zero-day span is one visit per month; \
         counting the excluded row too would read 2.0"
    );
}

// ---------------------------------------------------------------- lineage

/// A ride that follows the trunk to its midpoint and peels east.
fn fork_ride(jitter_m: f64) -> Vec<GpsPoint> {
    let mut pts = Vec::new();
    let mut d = 0.0;
    while d <= TRUNK_LEN_M / 2.0 {
        pts.push(pt(d, jitter_m));
        d += STEP_M;
    }
    // North-east at 45 degrees for the second half.
    let leg = TRUNK_LEN_M / 2.0;
    let mut t = STEP_M;
    while t <= leg {
        let along = t / 2f64.sqrt();
        pts.push(pt(TRUNK_LEN_M / 2.0 + along, along + jitter_m));
        t += STEP_M;
    }
    pts
}

fn fork_rides(prefix: &str, count: usize, day0: i64) -> Vec<LifecycleActivity> {
    (0..count)
        .map(|i| {
            let jitter = (i as f64 - (count as f64 - 1.0) / 2.0) * 1.5;
            act(
                format!("{prefix}_{i:02}"),
                day0 + i as i64,
                fork_ride(jitter),
            )
        })
        .collect()
}

fn details_of(event: &veloqrs::persistence::sections::SectionHistoryEvent) -> serde_json::Value {
    event
        .details
        .as_deref()
        .and_then(|d| serde_json::from_str(d).ok())
        .unwrap_or(serde_json::Value::Null)
}

/// A trunk that becomes a fork later in the library's life splits: the
/// piece that keeps the id records the split and names its siblings, and a
/// sibling's birth names the parent it was carved from, with a
/// discriminator a read side can render in-locale.
#[test]
fn a_late_fork_splits_the_trunk_and_records_lineage() {
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let straight = corridor_rides("ca", 0.0, 9, 0);
    let snap = ingest_step(&mut engine, "cold", &refs(&straight)).snapshot;
    let (trunk, _) = section_on(&snap, &corridor_ground(0.0)).expect("corpus fault: no trunk");

    let forked = fork_rides("cf", 9, 20);
    ingest_step(&mut engine, "fork", &refs(&forked));

    let births: Vec<(String, serde_json::Value)> = engine
        .get_sections()
        .iter()
        .filter(|s| s.id != trunk)
        .flat_map(|s| {
            engine
                .section_history(&s.id)
                .into_iter()
                .filter(|e| e.kind == "formed")
                .map(|e| (s.id.clone(), details_of(&e)))
                .collect::<Vec<_>>()
        })
        .filter(|(_, d)| d.get("split_from").and_then(|v| v.as_str()) == Some(trunk.as_str()))
        .collect();
    assert!(
        !births.is_empty(),
        "a sibling carved from the trunk must record it as its parent"
    );
    for (_, d) in &births {
        let disc = d
            .get("discriminator")
            .and_then(|v| v.as_str())
            .expect("a sibling carries a discriminator");
        assert!(
            ["north", "east", "south", "west"].contains(&disc) || disc.parse::<u32>().is_ok(),
            "a discriminator is a cardinal or an ordinal, got {disc}"
        );
    }
    let split = engine
        .section_history(&trunk)
        .into_iter()
        .find(|e| e.kind == "split")
        .expect("the trunk records the split");
    let siblings: Vec<String> = details_of(&split)
        .get("siblings")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .unwrap_or_default();
    for (sibling, _) in &births {
        assert!(
            siblings.contains(sibling),
            "the split names every sibling carved from it: {siblings:?}"
        );
    }
}

/// A sustained merge retires the junior into the senior and says which.
#[test]
fn a_merge_names_the_survivor() {
    use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
    let corpus = LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 60,
        bucket_b_delta_count: 90,
        bucket_d_delta_count: 3,
        bucket_e_delta_count: 0,
        parallel_street_count: 4,
        ..LifecycleConfig::default()
    });
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    ingest_step(&mut engine, "a", &corpus.through_a());
    ingest_step(&mut engine, "b", &refs(&corpus.bucket_b_delta));
    let before = snapshot(&mut engine);
    ingest_step(&mut engine, "c", &[&corpus.bucket_c_single]);
    ingest_step(&mut engine, "d", &refs(&corpus.bucket_d_delta));

    let live: Vec<String> = engine.get_sections().iter().map(|s| s.id.clone()).collect();
    let merges: Vec<(String, String)> = before
        .sections
        .keys()
        .flat_map(|id| {
            engine
                .section_history(id)
                .into_iter()
                .filter(|e| e.kind == "merged")
                .map(|e| {
                    (
                        id.clone(),
                        details_of(&e)
                            .get("into")
                            .and_then(|v| v.as_str())
                            .unwrap_or_default()
                            .to_string(),
                    )
                })
                .collect::<Vec<_>>()
        })
        .collect();
    assert!(
        !merges.is_empty(),
        "the small batch fires at least one merge"
    );
    for (junior, senior) in &merges {
        assert!(!senior.is_empty(), "a merge names the survivor");
        assert!(
            live.contains(senior),
            "{junior} merged into {senior}, which must be live"
        );
        assert!(!live.contains(junior), "the junior leaves the catalogue");
    }
}

// ------------------------------------------------------------------ revert

/// Reverting to a stored version puts that line and its reference back on
/// the row, re-matches the junction, pins the section there, and records
/// it, so the next re-cut holds the line the user chose.
#[test]
fn revert_swaps_the_stored_version_into_the_section_row() {
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let rides = corridor_rides("ca", 0.0, 9, 0);
    let snap = ingest_step(&mut engine, "cold", &refs(&rides)).snapshot;
    let (id, _) = section_on(&snap, &corridor_ground(0.0)).expect("corpus fault: no section");
    let birth = engine
        .section_geometry_polyline(&id, 1)
        .expect("birth geometry");

    // A second version the section did not keep: the same corridor cut short.
    let short: Vec<GpsPoint> = birth.iter().take(birth.len() / 2).cloned().collect();
    let v2 = engine
        .record_section_geometry(&id, &short, false, None)
        .expect("store a version");
    assert_eq!(v2, 2);
    engine
        .revert_section_to_version(&id, 2)
        .expect("revert to v2");
    let row = engine.get_section_by_id(&id).expect("row");
    assert!(
        shares_ground(&row.polyline, &short) && row.polyline.len() < birth.len(),
        "the row carries the reverted line"
    );
    assert_eq!(engine.pinned_section_version(&id), Some(2));
    let last = engine.section_history(&id).pop().expect("history");
    assert_eq!(last.kind, "reverted");
    assert_eq!(last.geometry_version, Some(2));
    assert!(
        !row.activity_ids.is_empty(),
        "the junction is re-matched against the reverted line"
    );

    // Back to birth: the exact reference rides along.
    engine
        .revert_section_to_version(&id, 1)
        .expect("revert to v1");
    let row = engine.get_section_by_id(&id).expect("row");
    assert!(shares_ground(&row.polyline, &birth));
    assert_eq!(engine.pinned_section_version(&id), Some(1));

    // A later detect holds the pinned line.
    let more = corridor_rides("cb", 0.0, 6, 40);
    let after = ingest_step(&mut engine, "held", &refs(&more)).snapshot;
    let (id_now, fp) = section_on(&after, &corridor_ground(0.0)).expect("section survives");
    assert_eq!(id_now, id);
    assert!(
        shares_ground(&fp.polyline, &birth),
        "a pinned section keeps its line"
    );
}

#[test]
fn a_revert_to_a_missing_version_is_refused() {
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let rides = corridor_rides("ca", 0.0, 9, 0);
    let snap = ingest_step(&mut engine, "cold", &refs(&rides)).snapshot;
    let (id, fp) = section_on(&snap, &corridor_ground(0.0)).expect("corpus fault: no section");
    assert!(engine.revert_section_to_version(&id, 7).is_err());
    let row = engine.get_section_by_id(&id).expect("row");
    assert_eq!(
        row.polyline.len(),
        fp.polyline.len(),
        "a refused revert changes nothing"
    );
    assert_eq!(engine.pinned_section_version(&id), None);
}

// ------------------------------------------------------------ PR re-basing

/// A re-cut re-bases the record on the new extent; when that moves the
/// record, the ledger says so beside the re-cut, against the current extent.
#[test]
fn a_recut_that_changes_the_pr_writes_a_ledger_row() {
    use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
    let corpus = LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 60,
        bucket_b_delta_count: 90,
        bucket_d_delta_count: 3,
        bucket_e_delta_count: 0,
        parallel_street_count: 4,
        ..LifecycleConfig::default()
    });
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    // One second per point on every stream, so junction rows carry lap times.
    let timed = |engine: &mut veloqrs::PersistentEngine, acts: &[&LifecycleActivity]| {
        let mut ids = Vec::new();
        let mut times: Vec<u32> = Vec::new();
        let mut offsets = Vec::new();
        for a in acts {
            engine
                .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
                .unwrap();
            engine
                .update_activity_metadata(&a.id, Some(a.start_date_unix), None, None, None)
                .unwrap();
            offsets.push(times.len() as u32);
            times.extend(0..a.gps_points.len() as u32);
            ids.push(a.id.clone());
        }
        offsets.push(times.len() as u32);
        engine.set_time_streams_flat(&ids, &times, &offsets);
        let handle = engine.detect_sections_background();
        let (sections, processed) = handle.recv().unwrap_or_default();
        engine.apply_sections(sections).unwrap();
        engine.save_processed_activity_ids(&processed).unwrap();
    };
    timed(&mut engine, &corpus.through_a());
    timed(&mut engine, &refs(&corpus.bucket_b_delta));
    timed(&mut engine, &[&corpus.bucket_c_single]);
    let before = snapshot(&mut engine);
    timed(&mut engine, &refs(&corpus.bucket_d_delta));

    let mut recuts = 0;
    let mut rebased = 0;
    for id in before.sections.keys() {
        let history = engine.section_history(id);
        for (i, e) in history.iter().enumerate() {
            if e.kind != "recut" {
                continue;
            }
            recuts += 1;
            let Some(next) = history.get(i + 1) else {
                continue;
            };
            if next.kind != "pr_rebased" {
                continue;
            }
            rebased += 1;
            let d = details_of(next);
            assert_eq!(
                d.get("basis").and_then(|v| v.as_str()),
                Some("current_extent")
            );
            let from = d.get("from_time").and_then(|v| v.as_f64());
            let to = d.get("to_time").and_then(|v| v.as_f64());
            assert!(from != to || d.get("from_activity_id") != d.get("to_activity_id"));
        }
    }
    assert!(recuts > 0, "the small batch fires a re-cut");
    assert!(rebased > 0, "a re-cut that moves the record writes a row");
}

// ----------------------------------------------------------------- retired

/// A section the catalogue dropped stays in the ledger as retired, with how
/// it left and the versions that still draw it.
#[test]
fn a_dissolved_section_is_listed_as_retired() {
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let rides_a = corridor_rides("ca", 0.0, 9, 0);
    let rides_b = corridor_rides("cb", 1_500.0, 9, 10);
    let mut pool = refs(&rides_a);
    pool.extend(refs(&rides_b));
    let snap = ingest_step(&mut engine, "cold", &pool).snapshot;
    let (id_a, _) = section_on(&snap, &corridor_ground(0.0)).expect("corpus fault: corridor A");
    assert!(engine.retired_sections().is_empty(), "nothing has left yet");

    for aid in rides_a.iter().map(|r| r.id.clone()).collect::<Vec<_>>() {
        engine.remove_activity(&aid).expect("remove_activity");
    }
    for i in 0..3 {
        let filler = filler_act("drain", 40 + i);
        ingest_step(&mut engine, "drain", &[&filler]);
    }

    let retired = engine.retired_sections();
    let entry = retired
        .iter()
        .find(|r| r.section_id == id_a)
        .expect("the dissolved section is listed");
    assert_eq!(entry.kind, "dissolved");
    assert_eq!(entry.into, None);
    assert!(
        entry.versions.contains(&1),
        "its birth geometry still draws it"
    );
    assert!(
        engine.get_section_by_id(&id_a).is_none(),
        "retired means gone from the catalogue"
    );
}

/// A pin holds a stored line against the detector. A user who accepts,
/// renames, trims, re-references or re-matches the section has taken it
/// over, and the pin goes with the edit rather than fighting it.
#[test]
fn a_promotion_mutation_drops_the_pin() {
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let rides = corridor_rides("ca", 0.0, 9, 0);
    let snap = ingest_step(&mut engine, "cold", &refs(&rides)).snapshot;
    let (id, _) = section_on(&snap, &corridor_ground(0.0)).expect("corpus fault: no section");

    let pin = |engine: &mut veloqrs::PersistentEngine| {
        engine
            .revert_section_to_version(&id, 1)
            .expect("revert pins");
        assert_eq!(engine.pinned_section_version(&id), Some(1));
    };

    pin(&mut engine);
    engine
        .set_section_name(&id, Some("Morning Berg"))
        .expect("rename");
    assert_eq!(
        engine.pinned_section_version(&id),
        None,
        "a rename drops the pin"
    );

    pin(&mut engine);
    let len = engine.get_section_by_id(&id).unwrap().polyline.len() as u32;
    engine.trim_section(&id, 1, len - 2).expect("trim");
    assert_eq!(
        engine.pinned_section_version(&id),
        None,
        "a trim drops the pin"
    );

    pin(&mut engine);
    let other = engine
        .get_section_by_id(&id)
        .unwrap()
        .activity_ids
        .into_iter()
        .find(|a| a != &rides[0].id)
        .expect("a second member");
    engine
        .set_section_reference(&id, &other)
        .expect("set reference");
    assert_eq!(
        engine.pinned_section_version(&id),
        None,
        "a reference change drops the pin"
    );

    pin(&mut engine);
    engine.accept_section(&id).expect("accept");
    assert_eq!(
        engine.pinned_section_version(&id),
        None,
        "an accept drops the pin"
    );
}
