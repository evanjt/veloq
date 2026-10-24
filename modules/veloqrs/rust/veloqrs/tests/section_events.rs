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
//!   cargo test -p veloqrs --features synthetic --test section_synthetic -- section_events::

use tracematch::scenarios::LifecycleActivity;
use tracematch::{GpsPoint, shares_ground};

use crate::lifecycle_support::*;

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
    let (mut engine, _dir) = fresh_engine();
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
    let (mut engine, _dir) = fresh_engine();
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
    let (mut engine, _dir) = fresh_engine();
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
    assert!(details.get("prs").is_some(), "snapshot must carry prs");
    for key in ["avg_time", "visits_per_month"] {
        assert!(details.get(key).is_none(), "snapshot must not carry {key}");
    }
    let prs = details["prs"]
        .as_array()
        .expect("the era's records are a list");
    for record in prs {
        assert!(
            record["sport"].is_string() && record["direction"].is_string(),
            "each era record names its sport and direction: {record}"
        );
    }
}

#[test]
fn re_emerged_ground_writes_a_restored_event_on_the_same_id() {
    let (mut engine, _dir) = fresh_engine();
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
    let (mut engine, _dir) = fresh_engine();
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
    let lineages = engine.section_lineages();
    for (id, d) in &births {
        assert!(
            d.get("line_order")
                .and_then(|v| v.as_u64())
                .is_some_and(|n| n > 0),
            "a split birth keeps its position along the parent line"
        );
        assert_eq!(
            lineages
                .iter()
                .find(|lineage| lineage.section_id == *id)
                .and_then(|lineage| lineage.line_order)
                .map(u64::from),
            d.get("line_order").and_then(|value| value.as_u64())
        );
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

/// A ride over the trunk between two distances north of its start.
fn stretch_rides(
    prefix: &str,
    from_m: f64,
    to_m: f64,
    count: usize,
    day0: i64,
) -> Vec<LifecycleActivity> {
    (0..count)
        .map(|i| {
            let jitter = (i as f64 - (count as f64 - 1.0) / 2.0) * 1.5;
            let mut pts = Vec::new();
            let mut d = from_m;
            while d <= to_m {
                pts.push(pt(d, jitter));
                d += STEP_M;
            }
            act(format!("{prefix}_{i:02}"), day0 + i as i64, pts)
        })
        .collect()
}

/// Rides over one stretch that stay in a narrow lane however many there are,
/// so the count can grow without widening the band the rides cover.
fn stretch_rides_in_lane(
    prefix: &str,
    from_m: f64,
    to_m: f64,
    count: usize,
    day0: i64,
) -> Vec<LifecycleActivity> {
    (0..count)
        .map(|i| {
            let jitter = ((i % 7) as f64 - 3.0) * 1.5;
            let mut pts = Vec::new();
            let mut d = from_m;
            while d <= to_m {
                pts.push(pt(d, jitter));
                d += STEP_M;
            }
            act(format!("{prefix}_{i:02}"), day0 + i as i64, pts)
        })
        .collect()
}

/// A road joined by later through rides keeps its original sections when
/// enough earlier outings start or end at the join.
#[test]
fn a_join_where_outings_start_and_end_keeps_both_sections() {
    let (mut engine, _dir) = fresh_engine();
    let near = stretch_rides("near", 0.0, 350.0, 9, 0);
    let far = stretch_rides("far", 450.0, 800.0, 9, 10);
    let mut pool = refs(&near);
    pool.extend(refs(&far));
    let before = ingest_step(&mut engine, "cold", &pool).snapshot;
    assert!(
        before.sections.len() >= 2,
        "corpus fault: the two stretches must start as separate sections"
    );

    let whole = stretch_rides("whole", 0.0, 800.0, 12, 30);
    ingest_step(&mut engine, "join", &refs(&whole));
    for i in 0..3 {
        let filler = filler_act("settle", 60 + i);
        ingest_step(&mut engine, "settle", &[&filler]);
    }

    let live: Vec<String> = engine.get_sections().iter().map(|s| s.id.clone()).collect();
    assert_eq!(live.len(), 2, "the busy termini keep two stretches");
    for id in before.sections.keys() {
        assert!(live.contains(id), "the original section {id} remains live");
        assert!(
            engine
                .section_history(id)
                .iter()
                .all(|event| event.kind != "merged"),
            "a retained section has no merge event"
        );
    }
}

/// A sustained merge retires the junior into the senior and says which.
///
/// Scenario: two small stretches of one road, then many more rides over all of
/// it, so one candidate covers both existing sections. Only a small share of
/// the traffic ends at the gap, which is attrition and not a join the detector
/// cuts at, so the stretches merge. The whole road stays under the detector's
/// section length cap, or it would be cut into two again.
#[test]
fn a_merge_names_the_survivor() {
    let (mut engine, _dir) = fresh_engine();
    let near = stretch_rides("near", 0.0, 350.0, 9, 0);
    let far = stretch_rides("far", 450.0, 800.0, 9, 10);
    let mut pool = refs(&near);
    pool.extend(refs(&far));
    let before = ingest_step(&mut engine, "cold", &pool).snapshot;
    assert!(
        before.sections.len() >= 2,
        "corpus fault: the two stretches must start as separate sections"
    );

    let whole = stretch_rides_in_lane("whole", 0.0, 800.0, 100, 30);
    ingest_step(&mut engine, "join", &refs(&whole));
    for i in 0..3 {
        let filler = filler_act("settle", 300 + i);
        ingest_step(&mut engine, "settle", &[&filler]);
    }

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
        "a stretch joined by rides over the gap merges into its senior"
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
    let (mut engine, _dir) = fresh_engine();
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
    let (mut engine, _dir) = fresh_engine();
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
        bucket_a_count: 80,
        bucket_b_delta_count: 90,
        bucket_d_delta_count: 3,
        bucket_e_delta_count: 0,
        parallel_street_count: 4,
        ..LifecycleConfig::default()
    });
    let (mut engine, _dir) = fresh_engine();
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
        let (sections, processed) = handle.recv().expect("the detect ran");
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
            assert!(
                d.get("sport").and_then(|v| v.as_str()).is_some(),
                "a record moves within one sport"
            );
            assert!(
                matches!(
                    d.get("direction").and_then(|v| v.as_str()),
                    Some("same" | "reverse")
                ),
                "a record moves within one direction"
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
    let (mut engine, _dir) = fresh_engine();
    let rides_a = corridor_rides("ca", 0.0, 9, 0);
    let rides_b = corridor_rides("cb", 1_500.0, 9, 10);
    let mut pool = refs(&rides_a);
    pool.extend(refs(&rides_b));
    let snap = ingest_step(&mut engine, "cold", &pool).snapshot;
    let (id_a, _) = section_on(&snap, &corridor_ground(0.0)).expect("corpus fault: corridor A");
    assert!(engine.retired_sections().is_empty(), "nothing has left yet");
    let shown_before = engine
        .get_all_section_names()
        .get(&id_a)
        .cloned()
        .expect("a live section always shows a name");

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
    assert_eq!(entry.name.as_deref(), Some(shown_before.as_str()));
    let distance = entry
        .distance_meters
        .expect("the retired section keeps its length");
    assert!(
        (distance - TRUNK_LEN_M).abs() < 0.1 * TRUNK_LEN_M,
        "it keeps the corridor's length, read {distance}"
    );
    assert!(
        entry.versions.contains(&veloqrs::WholeNumber(1)),
        "its birth geometry still draws it"
    );
    assert!(
        engine.get_section_by_id(&id_a).is_none(),
        "retired means gone from the catalogue"
    );
}

/// A pin holds a stored line against the detector. A user who accepts,
/// trims, re-references or re-matches the section has taken it
/// over, and the pin goes with the edit rather than fighting it.
#[test]
fn a_promotion_mutation_drops_the_pin() {
    let (mut engine, _dir) = fresh_engine();
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

    pin(&mut engine);
    let aid = rides[0].id.clone();
    let last = engine.get_gps_track(&aid).expect("a stored track").len() as u32 - 1;
    engine
        .expand_section_bounds(&id, &aid, 0, last)
        .expect("expand");
    assert_eq!(
        engine.pinned_section_version(&id),
        None,
        "an expand drops the pin"
    );

    pin(&mut engine);
    engine.reset_section_bounds(&id).expect("reset");
    assert_eq!(
        engine.pinned_section_version(&id),
        None,
        "a reset drops the pin"
    );
}

/// Accept all promotes every auto row, so a pinned one is taken over too.
#[test]
fn accept_all_drops_the_pin() {
    let (mut engine, _dir) = fresh_engine();
    let rides = corridor_rides("cb", 0.0, 9, 0);
    let snap = ingest_step(&mut engine, "cold", &refs(&rides)).snapshot;
    let (id, _) = section_on(&snap, &corridor_ground(0.0)).expect("corpus fault: no section");
    engine
        .revert_section_to_version(&id, 1)
        .expect("revert pins");
    assert_eq!(engine.pinned_section_version(&id), Some(1));

    engine.accept_all_sections().expect("accept all");
    assert_eq!(
        engine.pinned_section_version(&id),
        None,
        "accept all drops the pin"
    );
}

/// The merged-away secondary leaves no pin row for an id that is gone, and
/// the primary's pin goes with the promotion.
#[test]
fn merge_drops_both_pins() {
    let (mut engine, _dir) = fresh_engine();
    let rides_a = corridor_rides("ma", 0.0, 9, 0);
    let rides_b = corridor_rides("mb", 1_500.0, 9, 10);
    let mut pool = refs(&rides_a);
    pool.extend(refs(&rides_b));
    let snap = ingest_step(&mut engine, "cold", &pool).snapshot;
    let (id_a, _) = section_on(&snap, &corridor_ground(0.0)).expect("corpus fault: A");
    let (id_b, _) = section_on(&snap, &corridor_ground(1_500.0)).expect("corpus fault: B");
    for id in [&id_a, &id_b] {
        engine
            .revert_section_to_version(id, 1)
            .expect("revert pins");
        assert_eq!(engine.pinned_section_version(id), Some(1));
    }

    engine.merge_user_sections(&id_a, &id_b).expect("merge");
    assert_eq!(engine.pinned_section_version(&id_a), None, "primary pin");
    assert_eq!(engine.pinned_section_version(&id_b), None, "secondary pin");
}

/// Naming an auto section makes its line the athlete's: the next detection
/// that would re-cut its ground leaves it whole, under its id and name.
#[test]
fn a_named_section_survives_a_recut_of_its_ground() {
    let (mut engine, _dir) = fresh_engine();
    let straight = corridor_rides("ca", 0.0, 9, 0);
    let snap = ingest_step(&mut engine, "cold", &refs(&straight)).snapshot;
    let (trunk, _) = section_on(&snap, &corridor_ground(0.0)).expect("corpus fault: no trunk");
    let line_before = engine.get_section_by_id(&trunk).unwrap().polyline;

    engine
        .set_section_name(&trunk, Some("Morning Berg"))
        .expect("name");
    assert_eq!(engine.pinned_section_version(&trunk), Some(1));
    engine
        .set_section_name(&trunk, Some("Berg Loop"))
        .expect("rename");
    assert_eq!(engine.pinned_section_version(&trunk), Some(1));

    let forked = fork_rides("cf", 9, 20);
    ingest_step(&mut engine, "fork", &refs(&forked));

    let kept = engine
        .get_section_by_id(&trunk)
        .expect("the named section survives the fork");
    assert_eq!(kept.polyline, line_before);
    assert_eq!(
        engine
            .get_all_section_names()
            .get(&trunk)
            .map(String::as_str),
        Some("Berg Loop")
    );
    assert_eq!(engine.pinned_section_version(&trunk), Some(1));
    assert!(
        engine
            .section_history(&trunk)
            .iter()
            .all(|e| e.kind != "split"),
        "a pinned section is not split"
    );
}

/// Scenario: the athlete draws a custom section over ground an auto section
/// already covers. Expected behaviour: the auto section is hidden behind the
/// drawn one and the ledger holds the `superseded` pair on both ids.
#[test]
fn a_drawn_section_over_an_auto_section_writes_the_superseded_pair() {
    let (mut engine, _dir) = fresh_engine();
    let rides = corridor_rides("ca", 0.0, 9, 0);
    let snap = ingest_step(&mut engine, "cold", &refs(&rides)).snapshot;
    let (auto_id, _) = section_on(&snap, &corridor_ground(0.0)).expect("corpus fault: no section");

    let ground = corridor_ground(0.0);
    let drawn = engine
        .create_section(veloqrs::sections::CreateSectionParams {
            sport_type: "Ride".to_string(),
            polyline: ground.clone(),
            distance_meters: tracematch::matching::calculate_route_distance(&ground),
            name: Some("Drawn".to_string()),
            source_activity_id: Some("ca_00".to_string()),
            start_index: Some(0),
            end_index: Some(ground.len() as u32 - 1),
        })
        .expect("create section");

    assert!(kinds(&engine, &auto_id).contains(&"superseded".to_string()));
    assert_eq!(kinds(&engine, &drawn), vec!["superseded"]);
    let details = details_of(
        engine
            .section_history(&drawn)
            .iter()
            .find(|e| e.kind == "superseded")
            .expect("event"),
    );
    assert_eq!(details["supersedes"], auto_id.as_str());
}

/// A custom section drawn over the first half of the corridor an auto
/// section covers whole: too short a share of the auto line to hide it, so
/// both stay live until the athlete chooses.
fn draw_over_half(engine: &mut veloqrs::PersistentEngine) -> String {
    let ground = corridor_ground(0.0);
    let half = ground[..ground.len() / 2].to_vec();
    engine
        .create_section(veloqrs::sections::CreateSectionParams {
            sport_type: "Ride".to_string(),
            polyline: half.clone(),
            distance_meters: tracematch::matching::calculate_route_distance(&half),
            name: Some("Drawn half".to_string()),
            source_activity_id: Some("ca_00".to_string()),
            start_index: Some(0),
            end_index: Some(half.len() as u32 - 1),
        })
        .expect("create section")
}

fn visible_ids(engine: &veloqrs::PersistentEngine) -> Vec<String> {
    engine
        .get_section_summaries()
        .into_iter()
        .map(|s| s.id)
        .collect()
}

/// Scenario: a drawn section and the auto section on its ground are both
/// live, and the athlete prefers the drawn one.
/// Expected behaviour: the auto section is hidden behind it, a detect over
/// new rides keeps it hidden and the drawn one live, and a wipe of the
/// detected catalogue followed by a re-detect shows only the drawn
/// section on that ground.
#[test]
fn a_preferred_drawn_section_keeps_the_auto_section_hidden_through_detects_and_a_wipe() {
    let (mut engine, _dir) = fresh_engine();
    let rides = corridor_rides("ca", 0.0, 9, 0);
    let snap = ingest_step(&mut engine, "cold", &refs(&rides)).snapshot;
    let (auto_id, _) = section_on(&snap, &corridor_ground(0.0)).expect("corpus fault: no section");
    let drawn = draw_over_half(&mut engine);
    assert!(
        visible_ids(&engine).contains(&auto_id),
        "the half-length line must leave the auto section showing"
    );

    engine.prefer_section(&drawn, &auto_id).expect("prefer");

    assert!(!visible_ids(&engine).contains(&auto_id));
    assert!(visible_ids(&engine).contains(&drawn));
    let more = corridor_rides("cb", 0.0, 4, 20);
    ingest_step(&mut engine, "after prefer", &refs(&more));
    assert!(!visible_ids(&engine).contains(&auto_id));
    assert!(visible_ids(&engine).contains(&drawn));

    engine.clear_derived().expect("wipe");
    let again: Vec<_> = rides.iter().chain(more.iter()).collect();
    ingest_step(&mut engine, "after wipe", &again);
    assert_eq!(visible_ids(&engine), vec![drawn.clone()]);
}

/// Scenario: the same pair, and the athlete prefers the auto section.
/// Expected behaviour: the drawn section is on the retired list linked to
/// the auto one, a detect over new rides keeps the auto section live and
/// the drawn one gone, and a wipe and re-detect does not bring it back.
#[test]
fn a_preferred_auto_section_keeps_the_drawn_one_retired_through_detects_and_a_wipe() {
    let (mut engine, _dir) = fresh_engine();
    let rides = corridor_rides("ca", 0.0, 9, 0);
    let snap = ingest_step(&mut engine, "cold", &refs(&rides)).snapshot;
    let (auto_id, _) = section_on(&snap, &corridor_ground(0.0)).expect("corpus fault: no section");
    let drawn = draw_over_half(&mut engine);

    engine.prefer_section(&auto_id, &drawn).expect("prefer");

    let entry = engine
        .retired_sections()
        .into_iter()
        .find(|r| r.section_id == drawn)
        .expect("the drawn section is on the retired list");
    assert_eq!(entry.kind, "superseded");
    assert_eq!(entry.into.as_deref(), Some(auto_id.as_str()));
    assert!(
        entry.restorable_version.is_some(),
        "a drawn section that leaves is kept as a state it can be restored from"
    );
    let more = corridor_rides("cb", 0.0, 4, 20);
    ingest_step(&mut engine, "after prefer", &refs(&more));
    assert!(visible_ids(&engine).contains(&auto_id));
    assert!(!visible_ids(&engine).contains(&drawn));
    assert!(engine.get_section_by_id(&drawn).is_none());

    engine.clear_derived().expect("wipe");
    let again: Vec<_> = rides.iter().chain(more.iter()).collect();
    ingest_step(&mut engine, "after wipe", &again);
    assert!(!visible_ids(&engine).contains(&drawn));
    assert!(engine.get_section_by_id(&drawn).is_none());
    assert_eq!(visible_ids(&engine).len(), 1, "one section on the corridor");
}
