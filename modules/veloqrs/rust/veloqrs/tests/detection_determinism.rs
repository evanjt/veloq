//! Two devices holding the same activities, arriving in the same order, must
//! draw the same sections.
//!
//! `HashMap` iteration order is randomised per process, so a repeated call
//! inside one process sees one fixed order and agrees with itself no matter how
//! order-dependent the detector is. The comparison only means something across a
//! process boundary, so this suite re-executes its own binary and compares what
//! the children produce.
//!
//! The signature carries a coordinate digest, so geometry that moves while the
//! counts hold still fails here.
//!
//! Run: `cargo test -p veloqrs --features synthetic --test detection_synthetic -- detection_determinism::`

use super::lifecycle_support;

use std::collections::BTreeMap;
use std::process::Command;

use lifecycle_support::*;
use sha2::{Digest, Sha256};
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};

/// Children print this prefix and the parent reads it back. A child that dies
/// before printing leaves no line, which the parent treats as a failure rather
/// than as agreement.
const MARKER: &str = "CATALOGUE-DIGEST ";
const CHILD_ENV: &str = "VELOQ_DETERMINISM_CHILD";

/// The cold worker covers one detect over an empty library. The history worker
/// covers what ids depend on: priors to carry, graves to avoid and sections to
/// re-cut.
const WORKER_HISTORY: &str = "a_replayed_history_fills_the_catalogue_with_ids";
const WORKER_BATTERY: &str = "a_cold_detect_fills_the_catalogue";

/// Separate processes get separate `RandomState` seeds. Four is enough that an
/// order-dependent detector disagrees with near-certainty while the suite stays
/// inside its normal runtime.
const CHILDREN: usize = 4;

fn digest(text: &str) -> String {
    let mut h = Sha256::new();
    h.update(text.as_bytes());
    h.finalize()
        .iter()
        .take(8)
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn cold_catalogue_signature() -> String {
    let corpus = LifecycleCorpus::generate(&LifecycleConfig::default());
    let (mut engine, _dir) = fresh_engine();
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    cold.snapshot.catalogue_signature_with_ids()
}

/// Four detects over one library, the last of them older than everything held.
///
/// 1. the newest bucket cold, which mints every id;
/// 2. the single ride and small batch dated after it, which re-cut sections that
///    already carry ids;
/// 3. rides over the longest ride corridor and over a track 60 m beside it, which
///    change sections that already carry ids;
/// 4. the middle bucket, dated before everything held, the shape of a retention
///    widen, which re-cuts existing sections against their priors.
///
/// A fifth stage, on hand-built ground far from the corpus, restores a buried id
/// and mints beside it: see [`restored_and_overlapped_signature`].
///
/// The middle bucket is cut to 30 rides from the default 90, which keeps the
/// four re-executions of this worker inside the suite's runtime while each
/// step still changes the catalogue.
fn history_catalogue_signature() -> String {
    let corpus = LifecycleCorpus::generate(&LifecycleConfig {
        bucket_b_delta_count: 30,
        ..LifecycleConfig::default()
    });
    let (mut engine, _dir) = fresh_engine();
    ingest_step(&mut engine, "cold", &refs(&corpus.bucket_a));

    let mut newer = vec![&corpus.bucket_c_single];
    newer.extend(corpus.bucket_d_delta.iter());
    ingest_step(&mut engine, "newer", &newer);

    let corridor = corpus
        .corridors
        .iter()
        .filter(|c| c.sport_types.iter().all(|s| s == "Ride"))
        .max_by(|a, b| a.length_meters.total_cmp(&b.length_meters))
        .expect("the corpus has a ride corridor");
    let latest = corpus
        .bucket_d_delta
        .iter()
        .map(|a| a.start_date_unix)
        .max()
        .expect("bucket d is not empty");
    let ride_over = |name: String, day: i64, dlat_m: f64| LifecycleActivity {
        id: format!("beside-{name}"),
        sport_type: "Ride".to_string(),
        start_date_unix: latest + day * 86_400,
        gps_points: corridor
            .polyline
            .iter()
            .map(|p| {
                tracematch::GpsPoint::with_elevation(
                    p.latitude + dlat_m / 111_320.0,
                    p.longitude,
                    p.elevation.unwrap_or(300.0),
                )
            })
            .collect(),
    };
    let beside: Vec<LifecycleActivity> = (0..5)
        .flat_map(|i| {
            [
                ride_over(format!("on{i}"), 1 + i, 0.0),
                ride_over(format!("off{i}"), 1 + i, 60.0),
            ]
        })
        .collect();
    ingest_step(&mut engine, "beside", &refs(&beside));

    let widened = ingest_step(&mut engine, "older", &refs(&corpus.bucket_b_delta));
    let corpus_signature = widened.snapshot.catalogue_signature_with_ids();

    let hand_built_signature = restored_and_overlapped_signature();
    format!("{corpus_signature}\n{hand_built_signature}")
}

const HAND_LAT: f64 = 46.0;
const HAND_LON: f64 = 7.10;
const HAND_STEP_M: f64 = 10.0;
const HAND_ROUTE_M: f64 = 2_000.0;
/// Sideways offset at which the midpoint of a route sits at the start of its
/// 100 m anchor cell, so a route 70 m further out falls in the same cell.
const BURIED_EAST_M: f64 = 6_050.0;

fn hand_point(north_m: f64, east_m: f64) -> tracematch::GpsPoint {
    tracematch::GpsPoint::with_elevation(
        HAND_LAT + north_m / 111_320.0,
        HAND_LON + east_m / (111_320.0 * HAND_LAT.to_radians().cos()),
        500.0,
    )
}

/// `count` rides along one straight line, each shifted sideways by a fraction of
/// a metre so no two are identical.
fn hand_rides(
    prefix: &str,
    north_from_m: f64,
    north_to_m: f64,
    east_m: f64,
    count: usize,
    first_day_unix: i64,
) -> Vec<LifecycleActivity> {
    (0..count)
        .map(|i| {
            let sway = (i as f64 - (count as f64 - 1.0) / 2.0) * 1.5;
            let mut points = Vec::new();
            let mut north = north_from_m;
            while north <= north_to_m {
                points.push(hand_point(north, east_m + sway));
                north += HAND_STEP_M;
            }
            LifecycleActivity {
                id: format!("{prefix}-{i:02}"),
                sport_type: "Ride".to_string(),
                start_date_unix: first_day_unix + i as i64 * 86_400,
                gps_points: points,
            }
        })
        .collect()
}

/// Hand-built ground for the identity paths the corpus never reaches. Every
/// section here is minted in one detect, so priors tie on first sighting,
/// visits and length and only the id decides between them.
///
/// 1. two parallel 2 km routes 70 m apart, and two routes far from them and
///    from each other;
/// 2. rides midway between the parallel routes, a candidate within reach of
///    both that must take one prior's id, the priors tying on everything but id;
/// 3. the rides of both far routes removed and three detects run, which buries
///    both ids;
/// 4. new rides on the first far route, which restore its id, together with
///    rides 70 m beside the second, which mint into the cell its grave holds.
fn restored_and_overlapped_signature() -> String {
    let (mut engine, _dir) = fresh_engine();
    let start_unix = 1_700_000_000;
    let day = 86_400;
    let west = hand_rides("west", 0.0, HAND_ROUTE_M, 0.0, 9, start_unix);
    let east = hand_rides("east", 0.0, HAND_ROUTE_M, 70.0, 9, start_unix + 20 * day);
    let far = hand_rides("far", 0.0, HAND_ROUTE_M, 3_000.0, 9, start_unix + 40 * day);
    let buried = hand_rides(
        "buried",
        0.0,
        HAND_ROUTE_M,
        BURIED_EAST_M,
        9,
        start_unix + 60 * day,
    );

    let mut cold = refs(&west);
    cold.extend(refs(&east));
    cold.extend(refs(&far));
    cold.extend(refs(&buried));
    let cold = ingest_step(&mut engine, "hand-built cold", &cold).snapshot;
    let far_id = busiest_section_near(&cold, 3_000.0).expect("the far route forms a section");
    let west_id = busiest_section_near(&cold, 0.0).expect("the west route forms a section");
    let east_id = busiest_section_near(&cold, 70.0).expect("the east route forms a section");
    assert_ne!(
        west_id, east_id,
        "the two routes fused, so there is only one prior"
    );
    let buried_id =
        busiest_section_near(&cold, BURIED_EAST_M).expect("the buried route forms a section");

    let between = hand_rides(
        "between",
        0.0,
        HAND_ROUTE_M,
        35.0,
        24,
        start_unix + 80 * day,
    );
    ingest_step(&mut engine, "hand-built overlap", &refs(&between));
    settle(&mut engine, 8);
    let joined = snapshot(&mut engine);
    let carried = busiest_section_near(&joined, 35.0).expect("the middle route forms a section");
    assert!(
        carried == west_id || carried == east_id,
        "the section over the middle route took neither prior's id, so a two-prior \
         overlap is not reached: {carried} against {west_id} and {east_id}"
    );

    for ride in far.iter().chain(&buried) {
        engine.remove_activity(&ride.id).expect("remove_activity");
    }
    for i in 0..3 {
        let filler = LifecycleActivity {
            id: format!("filler-{i}"),
            sport_type: "Ride".to_string(),
            start_date_unix: start_unix + (100 + i) * day,
            gps_points: vec![hand_point(300_000.0, 0.0), hand_point(300_500.0, 0.0)],
        };
        ingest_step(&mut engine, "hand-built drain", &[&filler]);
    }

    let revived = hand_rides(
        "revived",
        0.0,
        HAND_ROUTE_M,
        3_000.0,
        9,
        start_unix + 120 * day,
    );
    let beside_buried = hand_rides(
        "beside-buried",
        0.0,
        HAND_ROUTE_M,
        BURIED_EAST_M + 70.0,
        9,
        start_unix + 140 * day,
    );
    let mut last = refs(&revived);
    last.extend(refs(&beside_buried));
    let last = ingest_step(&mut engine, "hand-built restore", &last).snapshot;
    assert_eq!(
        busiest_section_near(&last, 3_000.0).as_deref(),
        Some(far_id.as_str()),
        "the far route did not come back under its own id, so a restore is not reached"
    );
    let minted_beside = busiest_section_near(&last, BURIED_EAST_M + 70.0)
        .expect("the route beside the buried one forms a section");
    assert_eq!(
        minted_beside,
        format!("{buried_id}_2"),
        "a mint into a buried id's cell did not take the next ordinal"
    );
    last.catalogue_signature_with_ids()
}

fn busiest_section_near(snapshot: &SectionSnapshot, east_m: f64) -> Option<String> {
    let want = hand_point(HAND_ROUTE_M / 2.0, east_m);
    snapshot
        .sections
        .iter()
        .filter(|(_, f)| {
            f.polyline
                .iter()
                .any(|p| tracematch::geo_utils::haversine_distance(p, &want) < 30.0)
        })
        .max_by_key(|(_, f)| f.visit_count)
        .map(|(id, _)| id.clone())
}

fn run_history_worker() {
    let signature = history_catalogue_signature();

    assert!(
        !signature.is_empty(),
        "a four-step history produced no sections, so the cross-process \
         comparison would hold two empty strings against each other and pass"
    );

    if std::env::var(CHILD_ENV).is_ok() {
        println!("{MARKER}{}", digest(&signature));
    }
}

/// Doubles as the worker the parent re-executes and as a gate in its own right:
/// an empty catalogue would make every cross-process comparison below agree on
/// nothing.
fn run_worker() {
    let signature = cold_catalogue_signature();

    assert!(
        !signature.is_empty(),
        "cold detect produced no sections, so the determinism \
         comparison would hold two empty strings against each other and pass"
    );

    if std::env::var(CHILD_ENV).is_ok() {
        println!("{MARKER}{}", digest(&signature));
    }
}

#[test]
fn a_replayed_history_fills_the_catalogue_with_ids() {
    let _serial_state = super::serial_state();
    run_history_worker();
}

#[test]
fn a_cold_detect_fills_the_catalogue() {
    let _serial_state = super::serial_state();
    run_worker();
}

fn child_digest(exe: &std::path::Path, worker: &str, index: usize) -> String {
    let exact = format!("detection_determinism::{worker}");
    let out = Command::new(exe)
        .args(["--exact", &exact, "--nocapture"])
        .env(CHILD_ENV, "1")
        .output()
        .unwrap_or_else(|e| panic!("child {index}: could not re-execute {}: {e}", exe.display()));

    assert!(
        out.status.success(),
        "child {index} failed before it could report a catalogue.\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );

    let stdout = String::from_utf8_lossy(&out.stdout);
    stdout
        .lines()
        .find_map(|l| l.strip_prefix(MARKER))
        .unwrap_or_else(|| {
            panic!(
                "child {index} printed no {MARKER} line. Without it the parent has \
                 nothing to compare and must not pass.\nstdout:\n{stdout}"
            )
        })
        .trim()
        .to_string()
}

fn assert_every_process_agrees(worker: &str) {
    let exe = std::env::current_exe().expect("path to this test binary");

    let mut by_digest: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for i in 0..CHILDREN {
        by_digest
            .entry(child_digest(&exe, worker, i))
            .or_default()
            .push(i);
    }

    assert_eq!(
        by_digest.len(),
        1,
        "{} processes detected {} different catalogues from identical input: {:?}\n\n\
         The corpus is seeded from a fixed value, so every process saw the same \
         activities. A split here means detection reads an order that varies per \
         process, which on a phone means two devices holding the same history draw \
         different sections.",
        CHILDREN,
        by_digest.len(),
        by_digest
    );
}

/// Ids depend on history: a re-cut carries the id of the prior it overlaps and a
/// mint steers clear of every id held or buried. A cold detect has neither, so
/// this replays four detects, the last one older than what is held, and every
/// process must land on the same ids.
#[test]
fn a_replayed_history_mints_the_same_ids_in_every_process() {
    let _serial_state = super::serial_state();
    assert_every_process_agrees(WORKER_HISTORY);
}

/// A cold detect over the lifecycle corpus lands on one catalogue.
#[test]
fn a_cold_detect_lands_on_the_same_catalogue_in_every_process() {
    let _serial_state = super::serial_state();
    assert_every_process_agrees(WORKER_BATTERY);
}
