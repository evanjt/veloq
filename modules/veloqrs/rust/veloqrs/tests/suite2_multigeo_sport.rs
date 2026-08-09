//! Suite #2 — multi-geography + multi-sport pooled detection (invariant 2).
//!
//! Invariant 2: a trace is a trace. Detection sees every sport together, sport
//! belongs to the comparison layer, and `section.sport_type` is a derived
//! attribute of one ground, not a key the detector splits on. The visible
//! catalogue therefore must be stable under two things that should be
//! irrelevant to it: WHERE else in the world the user rides, and WHICH sport
//! happens to travel a shared corridor most.
//!
//! The Battery arm (`DetectionMethod::Unified`) is the probe here because the
//! behaviour under test lives in the detector: it partitions tracks per sport
//! at entry ("sections never span sports"), numbers sections positionally per
//! sport (`sec_<sport>_<n>`), and orders geographic clusters by their
//! south-west corner with one continuous counter. The apply tail then patches
//! the sport split back together with `merge_cross_sport_sections`, whose
//! primary is simply the section with more activities. Every id, sport, and
//! ground fact below falls out of those three mechanisms.
//!
//! Per curiosity: a MEASUREMENT test that prints reality and never fails, and
//! an `#[ignore]` GATE that states the target invariant (red under
//! `--include-ignored` today, green when the B-work lands). Snapshots read the
//! user-visible DB view, so every count is post-merge, what the app renders.
//!
//! Data is synthetic and deterministic (`LifecycleCorpus`, seeded). A second
//! geography is a corpus at a shifted origin with namespaced activity ids so
//! the two never collide in the engine.
//!
//! Run: `cargo test -p veloqrs --features synthetic --test suite2_multigeo_sport -- --nocapture --include-ignored`

mod lifecycle_support;

use lifecycle_support::*;
use std::collections::BTreeSet;
use tracematch::GpsPoint;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};

// ============================================================================
// Inlined helpers (the harness is read-only; these are private to this suite)
// ============================================================================

/// A fingerprint carrying only ground, for `ground_matches` against a corridor
/// truth polyline. `ground_matches` reads `polyline` alone; the rest is inert.
fn ground_fp(polyline: Vec<GpsPoint>) -> SectionFingerprint {
    SectionFingerprint {
        activity_ids: BTreeSet::new(),
        visit_count: 0,
        polyline_point_count: polyline.len(),
        distance_meters: 0.0,
        polyline,
        sport_type: String::new(),
        is_user_defined: false,
    }
}

/// Metres between two points (haversine). Local so this suite owns its endpoint
/// maths without reaching into tracematch or the harness internals.
fn haversine_m(a: &GpsPoint, b: &GpsPoint) -> f64 {
    let r = 6_371_000.0_f64;
    let (la1, lo1) = (a.latitude.to_radians(), a.longitude.to_radians());
    let (la2, lo2) = (b.latitude.to_radians(), b.longitude.to_radians());
    let dla = la2 - la1;
    let dlo = lo2 - lo1;
    let h = (dla / 2.0).sin().powi(2) + la1.cos() * la2.cos() * (dlo / 2.0).sin().powi(2);
    2.0 * r * h.sqrt().asin()
}

/// Clone activities under an id namespace so a second corpus (same id scheme)
/// can be ingested beside the first without an `add_activity` collision.
fn namespaced(prefix: &str, acts: &[&LifecycleActivity]) -> Vec<LifecycleActivity> {
    acts.iter()
        .map(|a| {
            let mut c = (*a).clone();
            c.id = format!("{prefix}{}", c.id);
            c
        })
        .collect()
}

/// Same ground, chosen sport, fresh id. Used to manufacture a controlled
/// sport-majority on one physical corridor: the GPS is untouched, only the
/// label the detector partitions on changes.
fn relabel(src: &LifecycleActivity, new_id: String, sport: &str) -> LifecycleActivity {
    LifecycleActivity {
        id: new_id,
        sport_type: sport.to_string(),
        start_date_unix: src.start_date_unix,
        gps_points: src.gps_points.clone(),
    }
}

/// A reversed traversal of the same ground: the forward track played backwards.
/// Sport is preserved so a reverse pass is only a direction change.
fn reversed_clone(src: &LifecycleActivity, new_id: String) -> LifecycleActivity {
    let mut pts = src.gps_points.clone();
    pts.reverse();
    LifecycleActivity {
        id: new_id,
        sport_type: src.sport_type.clone(),
        start_date_unix: src.start_date_unix,
        gps_points: pts,
    }
}

/// Relabel a slice of a source pool into one sport under a prefix. Starts
/// are respaced three days apart so a handful of traversals always spans
/// past the occasion floor's one-stay window — these scenarios exercise
/// sport identity, not occasion support.
fn labelled(
    src: &[LifecycleActivity],
    range: std::ops::Range<usize>,
    prefix: &str,
    sport: &str,
) -> Vec<LifecycleActivity> {
    src[range]
        .iter()
        .enumerate()
        .map(|(i, a)| {
            let mut act = relabel(a, format!("{prefix}{i:03}"), sport);
            act.start_date_unix = 1_600_000_000 + i as i64 * 3 * 86_400;
            act
        })
        .collect()
}

/// Every visible section whose ground matches `ground`, cloned out for
/// inspection. Identity is read by ground, never by id string.
fn sections_on_ground(
    snap: &SectionSnapshot,
    ground: &SectionFingerprint,
) -> Vec<(String, SectionFingerprint)> {
    snap.sections
        .iter()
        .filter(|(_, f)| ground_matches(ground, f))
        .map(|(id, f)| (id.clone(), f.clone()))
        .collect()
}

/// The busiest visible section on `ground`, if any.
fn busiest_on_ground(
    snap: &SectionSnapshot,
    ground: &SectionFingerprint,
) -> Option<(String, SectionFingerprint)> {
    sections_on_ground(snap, ground)
        .into_iter()
        .max_by_key(|(_, f)| f.visit_count)
}

/// Whether `a` and `b` describe the same ground travelled in OPPOSITE
/// directions: a reverse-mirror duplicate. Same-ground is coverage; opposite
/// direction is endpoints that line up better head-to-tail than head-to-head.
fn is_reverse_pair(a: &SectionFingerprint, b: &SectionFingerprint) -> bool {
    if a.polyline.len() < 2 || b.polyline.len() < 2 || !ground_matches(a, b) {
        return false;
    }
    let (a0, a1) = (a.polyline.first().unwrap(), a.polyline.last().unwrap());
    let (b0, b1) = (b.polyline.first().unwrap(), b.polyline.last().unwrap());
    let same_orientation = haversine_m(a0, b0) + haversine_m(a1, b1);
    let opposite_orientation = haversine_m(a0, b1) + haversine_m(a1, b0);
    opposite_orientation + 10.0 < same_orientation
}

/// Traversals of a deterministic road-like corridor: ~900 m with gentle
/// bends, one pass per outing, braided by a per-outing perpendicular
/// wobble. The corpus generator's random-walk corridors coil back within
/// the fold radius of themselves, so no single clean pass exists and the
/// detector honestly refuses to render them — these suites test SPORT
/// identity, and need ground a road could actually take. `corridor_idx`
/// offsets the road south so distinct indices are distinct ground.
fn corridor_source(
    corridor_idx: usize,
    min_needed: usize,
) -> (Vec<LifecycleActivity>, Vec<GpsPoint>) {
    let base_lat = 46.0 - 0.05 * corridor_idx as f64;
    let base_lng = 7.0;
    let m_lat = 111_320.0;
    let m_lng = m_lat * base_lat.to_radians().cos();
    let waypoints: [(f64, f64); 5] = [
        (0.0, 0.0),
        (250.0, 40.0),
        (480.0, -30.0),
        (700.0, 50.0),
        (900.0, 0.0),
    ];
    // Densify at ~10 m.
    let mut path: Vec<(f64, f64)> = Vec::new();
    for w in waypoints.windows(2) {
        let (ax, ay) = w[0];
        let (bx, by) = w[1];
        let len = ((bx - ax).powi(2) + (by - ay).powi(2)).sqrt();
        let steps = (len / 10.0).ceil().max(1.0) as usize;
        for s in 0..steps {
            let t = s as f64 / steps as f64;
            path.push((ax + (bx - ax) * t, ay + (by - ay) * t));
        }
    }
    path.push(waypoints[4]);
    let to_gps = |x: f64, y: f64, ele: f64| {
        GpsPoint::with_elevation(base_lat + y / m_lat, base_lng + x / m_lng, ele)
    };
    let ground: Vec<GpsPoint> = path
        .iter()
        .enumerate()
        .map(|(i, &(x, y))| to_gps(x, y, 300.0 + 0.4 * i as f64))
        .collect();
    let n = min_needed.max(12);
    let traversals: Vec<LifecycleActivity> = (0..n)
        .map(|i| {
            let phase = i as f64 * 1.7;
            let pts: Vec<GpsPoint> = path
                .iter()
                .enumerate()
                .map(|(j, &(x, y))| {
                    // Perpendicular 2.5 m wobble braids outings like
                    // receiver noise while staying deterministic.
                    let (nx, ny) = if j + 1 < path.len() {
                        let (dx, dy) = (path[j + 1].0 - x, path[j + 1].1 - y);
                        let l = (dx * dx + dy * dy).sqrt().max(1e-9);
                        (-dy / l, dx / l)
                    } else {
                        (0.0, 1.0)
                    };
                    let off = 2.5 * (j as f64 * 2.7 + phase).sin();
                    to_gps(x + nx * off, y + ny * off, 300.0 + 0.4 * j as f64)
                })
                .collect();
            LifecycleActivity {
                id: format!("road{corridor_idx}_t{i:03}"),
                sport_type: "Ride".to_string(),
                start_date_unix: 1_600_000_000 + i as i64 * 3 * 86_400,
                gps_points: pts,
            }
        })
        .collect();
    (traversals, ground)
}

// ============================================================================
// Curiosity 1 — SPATIAL PERTURBATION (R2 across space)
// ============================================================================
//
// A second, distant city is added to a detected library. Its clusters have
// their own south-west corner and slot into the single per-sport section
// counter by latitude. If the distant city sorts BEFORE the first (further
// south), every pre-existing id shifts, even though the first city's ground is
// untouched. The reshuffle is therefore GLOBAL across geographies: the id a
// section holds is a function of how many sections sort ahead of it in the
// whole catalogue, not of its own ground. Placing the same city NORTH (sorts
// after) leaves the ids alone, which isolates the cause as spatial position,
// not "adding data".

/// Cold-detect geography 1, then add a namespaced geography 2 at a shifted
/// origin and re-read the SAME engine. Geography 2 is sized at or above
/// geography 1 so the add crosses the 50%-new line into FULL re-detection
/// (the path that re-runs the SW-corner cluster ordering). Returns the cold
/// snapshot and the after snapshot.
fn geo_scenario(
    geo2_origin_lat: f64,
    geo2_seed: u64,
    prefix: &str,
) -> (SectionSnapshot, SectionSnapshot) {
    let geo1 = LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 18,
        ..LifecycleConfig::default()
    });
    let geo2 = LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 20, // >= geo1 so the add forces full re-detection
        origin: GpsPoint::with_elevation(geo2_origin_lat, 8.55, 410.0),
        seed: geo2_seed,
        ..LifecycleConfig::default()
    });
    let geo2_ns = namespaced(prefix, &geo2.through_a());

    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let g1a = ingest_step(&mut engine, "geo1/cold", &geo1.through_a()).snapshot;
    let g1b = ingest_step(&mut engine, "geo2/add", &refs(&geo2_ns)).snapshot;
    (g1a, g1b)
}

/// Measurement: add a distant geography to the south (sorts first) and to the
/// north (sorts last), and print the three survival signals for geography 1's
/// sections in each case. The tell is a HIGH `id_survival` (the string
/// `sec_ride_0` always exists) beside a LOW `identity_retention` (that id no
/// longer covers its old ground) with `ground_survival` at 1.0: same sections,
/// reshuffled. North should hold identity; south should not.
#[test]
fn geography_perturbation_today() {
    let (s_a, s_south) = geo_scenario(46.37, 0x5150, "g2s_");
    let (n_a, n_north) = geo_scenario(48.37, 0x6160, "g2n_");

    println!(
        "[battery] add distant geography to the SOUTH (its clusters sort first):\n  \
         id_survival={:.2} ground_survival={:.2} identity_retention={:.2} \
         (want identity >= 0.85; low here means ids reshuffled off their ground)",
        id_survival(&s_a, &s_south),
        ground_survival(&s_a, &s_south),
        identity_retention(&s_a, &s_south),
    );
    println!(
        "[battery] add the SAME geography to the NORTH (its clusters sort last):\n  \
         id_survival={:.2} ground_survival={:.2} identity_retention={:.2} \
         (identity should hold here — only the sort position changed)",
        id_survival(&n_a, &n_north),
        ground_survival(&n_a, &n_north),
        identity_retention(&n_a, &n_north),
    );

    // Make the id lie concrete: follow geography 1's busiest section by ground.
    if let Some((cold_id, cold)) = busiest_section(&s_a) {
        let ground = ground_fp(cold.polyline.clone());
        let same_id_now = s_south.sections.get(&cold_id);
        let ground_now = busiest_on_ground(&s_south, &ground).map(|(id, _)| id);
        let same_id_still_on_ground = same_id_now
            .map(|f| ground_matches(&cold, f))
            .unwrap_or(false);
        println!(
            "[battery] south: geography-1 busiest was {cold_id}; after the add, id {cold_id} \
             still covers that ground = {same_id_still_on_ground}; the ground now lives under {ground_now:?}",
        );
    }
}

/// Gate (R2 / positional ids): a distant, unrelated geography must not perturb
/// the identity of an existing one. Asserts `identity_retention >= 0.85` for
/// geography 1 when geography 2 is added to the south. Red today — the single
/// per-sport section counter numbers clusters by their south-west corner, so a
/// southern city inserts ahead and renumbers geography 1 wholesale. Green when
/// identity is assigned once and carried with the ground (B2), independent of
/// what else the catalogue contains.
#[test]
fn distant_geography_must_not_reshuffle_ids() {
    let (g1a, g1b) = geo_scenario(46.37, 0x5150, "g2s_");
    let retention = identity_retention(&g1a, &g1b);
    let ground = ground_survival(&g1a, &g1b);
    assert!(
        retention >= 0.85,
        "adding a distant southern geography reshuffled geography 1: \
         identity_retention={retention:.2} (want >= 0.85) while ground_survival={ground:.2} \
         (its ground is all still present — the ids just moved off it)"
    );
}

// ============================================================================
// Curiosity 2 — SPORT DERIVATION ON A SHARED CORRIDOR
// ============================================================================
//
// Corridor 2 in the corpus is travelled by both Ride and Run (ground-truth
// `sport_types = [Ride, Run]`). Pooled detection should treat that as ONE
// ground with a derived sport, keeping a per-sport comparison view on top. The
// current engine instead partitions by sport at detection (a Ride section and
// a Run section on identical ground), then the apply tail's
// `merge_cross_sport_sections` collapses them into one whose sport is simply
// the side with more traversals. So the derived sport is a count artefact:
// flip which sport rides the corridor more and the section's sport flips with
// it, on unchanged ground.

/// Ingest `ride_n` + `run_n` traversals of corridor 2, same ground, only the
/// sport labels differ, and return the post-pipeline snapshot plus the ground.
fn cross_flip_snapshot(
    ride_n: usize,
    run_n: usize,
    prefix: &str,
) -> (SectionSnapshot, Vec<GpsPoint>) {
    let (src, ground) = corridor_source(2, ride_n + run_n);
    let rides = labelled(&src, 0..ride_n, &format!("{prefix}ride_"), "Ride");
    let runs = labelled(
        &src,
        ride_n..ride_n + run_n,
        &format!("{prefix}run_"),
        "Run",
    );

    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    ingest_step(&mut engine, "cross/ride", &refs(&rides));
    let snap = ingest_step(&mut engine, "cross/run", &refs(&runs)).snapshot;
    (snap, ground)
}

/// Measurement: run the shared corridor twice, once Ride-majority and once
/// Run-majority, over the SAME physical ground. Print how many sections land on
/// that ground and what sport the section carries each way. Ground-truth is
/// multi-sport {Ride, Run}; a defensibly-derived sport would not depend on the
/// count. Prints, never asserts.
#[test]
fn shared_corridor_sport_derivation_today() {
    let (ride_major, ground) = cross_flip_snapshot(8, 4, "c2a_");
    let (run_major, _) = cross_flip_snapshot(4, 8, "c2b_");
    let g = ground_fp(ground);

    let on_ride_major = sections_on_ground(&ride_major, &g);
    let on_run_major = sections_on_ground(&run_major, &g);
    let sport_ride_major = busiest_on_ground(&ride_major, &g).map(|(_, f)| f.sport_type);
    let sport_run_major = busiest_on_ground(&run_major, &g).map(|(_, f)| f.sport_type);

    println!(
        "[battery] cross-sport ground truth = [Ride, Run]. Pooled detection result:\n  \
         Ride-majority (8R/4r): {} section(s) on the ground, derived sport = {:?}\n  \
         Run-majority  (4R/8r): {} section(s) on the ground, derived sport = {:?}\n  \
         (invariant 2: want ONE section whose sport does NOT flip with the majority)",
        on_ride_major.len(),
        sport_ride_major,
        on_run_major.len(),
        sport_run_major,
    );
    println!(
        "[battery] cross-sport: derived sport flips with the traversal count = {}",
        sport_ride_major != sport_run_major,
    );
}

/// Gate (invariant 2 — sport is derived, not partitioned): a corridor travelled
/// by both sports must yield ONE section on that ground, and its derived sport
/// must be invariant to which sport travels it more. Red today — detection
/// splits per sport and `merge_cross_sport_sections` picks the majority side as
/// primary, so the sport flips Ride<->Run on identical ground (or, if the merge
/// gates miss, two per-sport sections coexist on one ground). Green when sport
/// is a comparison-layer attribute of a single pooled section.
#[test]
#[ignore = "invariant 2 — detection partitions by sport then the apply tail's count-based cross-sport merge picks the majority as the section sport, so the derived sport is a rank artefact that flips on unchanged ground."]
fn shared_corridor_yields_one_section_with_stable_sport() {
    let (ride_major, ground) = cross_flip_snapshot(8, 4, "c2a_");
    let (run_major, _) = cross_flip_snapshot(4, 8, "c2b_");
    let g = ground_fp(ground);

    let on_ride_major = sections_on_ground(&ride_major, &g);
    let on_run_major = sections_on_ground(&run_major, &g);
    assert_eq!(
        on_ride_major.len(),
        1,
        "Ride-majority: shared multi-sport ground carries {} sections (want 1; >1 is per-sport duplication)",
        on_ride_major.len()
    );
    assert_eq!(
        on_run_major.len(),
        1,
        "Run-majority: shared multi-sport ground carries {} sections (want 1)",
        on_run_major.len()
    );

    let sport_ride_major = &on_ride_major[0].1.sport_type;
    let sport_run_major = &on_run_major[0].1.sport_type;
    assert_eq!(
        sport_ride_major, sport_run_major,
        "derived sport flips with the traversal-count majority: {sport_ride_major} vs {sport_run_major} \
         (invariant 2: sport is derived from the ground, not from which side has more visits)"
    );
}

// ============================================================================
// Curiosity 3 — ADD-A-SECOND-SPORT IDENTITY
// ============================================================================
//
// A Ride-only corridor exists, then Run passes of the SAME ground arrive. Under
// invariant 2 the section is the ground: it keeps its id, and the second sport
// is absorbed into a derived attribute. The current engine does one of two
// things depending only on batch size:
//  - incremental (Run < 50% new): the Run pass matches the existing section
//    geometrically (no sport filter) and is absorbed, so the id survives but
//    the section stays frozen at "Ride" while silently holding Run members;
//  - full (Run >= 50% new): re-detection makes a fresh Run section, then the
//    count-based cross-sport merge makes the Run side primary and DELETES the
//    old Ride section, so the id does not survive at all.
// Either way the outcome hinges on how many activities arrived, not on the
// ground.

/// Measurement: cold-detect a Ride-only corridor, then add Run passes two ways.
/// The full-mode add (Run majority) shows whether the cold id survives; the
/// incremental-mode add shows whether the id survives but the sport freezes.
#[test]
fn add_second_sport_identity_today() {
    {
        // Full mode: 5 Ride cold, then 6 Run (>= half of 11) forces re-detect.
        let (src, ground) = corridor_source(2, 11);
        let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
        let cold = ingest_step(
            &mut engine,
            "full/ride-cold",
            &refs(&labelled(&src, 0..5, "c3f_ride_", "Ride")),
        )
        .snapshot;
        let g = ground_fp(ground);
        let cold_sec = busiest_on_ground(&cold, &g);

        let after = match try_ingest_step(
            &mut engine,
            "full/run-add",
            &refs(&labelled(&src, 5..11, "c3f_run_", "Run")),
        ) {
            Ok(m) => Some(m.snapshot),
            Err(e) => {
                println!("[battery] full add crashed (a crash is a finding): {e}");
                None
            }
        };

        if let (Some((cold_id, _)), Some(after)) = (cold_sec, after) {
            let on = sections_on_ground(&after, &g);
            println!(
                "[battery] FULL add (5 Ride then 6 Run, same ground):\n  \
                 cold id was {cold_id}; after add the ground carries {} section(s): {:?}\n  \
                 same id survives = {}",
                on.len(),
                on.iter()
                    .map(|(id, f)| (id.clone(), f.sport_type.clone()))
                    .collect::<Vec<_>>(),
                on.iter().any(|(id, _)| *id == cold_id),
            );
        }
    }

    {
        // Incremental mode: 7 Ride cold, then 3 Run (< half of 10) is absorbed.
        let (src, ground) = corridor_source(2, 10);
        let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
        let cold = ingest_step(
            &mut engine,
            "incr/ride-cold",
            &refs(&labelled(&src, 0..7, "c3i_ride_", "Ride")),
        )
        .snapshot;
        let gi = ground_fp(ground);
        let cold_sec = busiest_on_ground(&cold, &gi);
        let after = ingest_step(
            &mut engine,
            "incr/run-add",
            &refs(&labelled(&src, 7..10, "c3i_run_", "Run")),
        )
        .snapshot;

        if let Some((cold_id, _)) = cold_sec {
            let now = after.sections.get(&cold_id);
            let holds_run = now
                .map(|f| f.activity_ids.iter().any(|a| a.contains("c3i_run_")))
                .unwrap_or(false);
            println!(
                "[battery] INCREMENTAL add (7 Ride then 3 Run, same ground):\n  \
                 cold id {cold_id} survives = {}; its sport_type is now {:?}; \
                 it silently holds Run members = {holds_run} \
                 (id kept, but sport frozen at cold value — not derived)",
                now.is_some(),
                now.map(|f| f.sport_type.clone()),
            );
        }
    }
}

/// Gate (invariant 2 — id survives a sport addition): adding a second sport on
/// the same ground must leave exactly one section that keeps its id.
///
/// The IDENTITY half is B2's: when the Run pass arrives, detection splits the
/// shared ground into a Ride and a Run candidate, and B2's split resolution
/// hands the cold id to the higher-support candidate (its tie-break is
/// majority-visits, identical to the cross-sport merge's majority primary on
/// this relabelled identical-ground corpus, so the id always lands on the
/// survivor). The SINGLE-SECTION half still comes from the apply-tail cross-sport
/// merge collapsing the two per-sport sections into one; B3's pooled detection
/// will make that structural rather than incidental (and delete the merge), and
/// the gate stays green across it because pooled detection also yields one
/// section on the ground.
#[test]
fn section_id_survives_sport_addition() {
    let (src, ground) = corridor_source(2, 11);
    let g = ground_fp(ground);

    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(
        &mut engine,
        "ride-cold",
        &refs(&labelled(&src, 0..5, "c3g_ride_", "Ride")),
    )
    .snapshot;
    let (cold_id, _) =
        busiest_on_ground(&cold, &g).expect("cold detect produced a Ride section on the corridor");

    let after = try_ingest_step(
        &mut engine,
        "run-add",
        &refs(&labelled(&src, 5..11, "c3g_run_", "Run")),
    )
    .expect("adding a second sport must not crash")
    .snapshot;

    let on = sections_on_ground(&after, &g);
    assert!(
        on.len() == 1 && on[0].0 == cold_id,
        "adding a second sport on the same ground broke identity: cold id {cold_id} now maps to \
         {} section(s) {:?} (want exactly 1, keeping {cold_id})",
        on.len(),
        on.iter()
            .map(|(id, f)| (id.clone(), f.sport_type.clone()))
            .collect::<Vec<_>>(),
    );
}

// ============================================================================
// Curiosity 4 — REVERSE DIRECTION
// ============================================================================
//
// A corridor travelled both ways is one corridor. The unified detector rasters
// tracks into a coverage grid, which is direction-blind, so a reverse pass
// should join the forward section rather than spawn a mirror on the same
// ground. This measures both arms and gates the Battery (Unified) invariant.

/// Ingest forward + reversed passes of the same `n` corridor-0 traversals as one
/// sport on `arm`, and return the snapshot plus the corridor ground.
fn reverse_mix_snapshot(arm: Arm, n: usize, prefix: &str) -> (SectionSnapshot, Vec<GpsPoint>) {
    let (src, ground) = corridor_source(0, n);
    let mut batch: Vec<LifecycleActivity> = Vec::new();
    for (i, a) in src.iter().take(n).enumerate() {
        batch.push(relabel(a, format!("{prefix}fwd_{i:03}"), "Ride"));
        batch.push(reversed_clone(a, format!("{prefix}rev_{i:03}")));
    }
    let (mut engine, _dir) = fresh_engine_for(arm);
    let snap = ingest_step(&mut engine, "reverse-mix", &refs(&batch)).snapshot;
    (snap, ground)
}

/// Measurement: on both arms, print how many sections land on the corridor and
/// how many of those pairs are reverse mirrors (same ground, opposite
/// orientation). Prints, never asserts.
#[test]
fn reverse_direction_today() {
    for arm in [Arm::Battery, Arm::Control] {
        let (snap, ground) = reverse_mix_snapshot(arm, 6, &format!("c4{}_", arm.label()));
        let g = ground_fp(ground);
        let on = sections_on_ground(&snap, &g);
        let mut mirror_pairs = 0usize;
        for i in 0..on.len() {
            for j in (i + 1)..on.len() {
                if is_reverse_pair(&on[i].1, &on[j].1) {
                    mirror_pairs += 1;
                }
            }
        }
        println!(
            "[{}] reverse mix (6 forward + 6 reverse of one corridor): {} section(s) on the \
             ground, {mirror_pairs} reverse-mirror pair(s) (want 1 section, 0 mirrors)",
            arm.label(),
            on.len(),
        );
    }
}

/// Gate (invariant 2 — one corridor, both directions): a reverse pass must
/// reuse the forward section, never spawn a mirror on the same ground. Battery
/// arm. The unified detector's coverage grid is direction-blind, so this is
/// expected to hold today; kept as an `#[ignore]` Battery-target invariant so a
/// future direction-sensitive change cannot quietly reintroduce mirror
/// duplicates. Red if any reverse-mirror pair appears on the corridor ground.
#[test]
#[ignore = "invariant 2 reverse-mirror guard — Unified's coverage grid is direction-blind so this holds today; retained as a Battery-target invariant against a regression that would split forward/reverse into mirror sections."]
fn reverse_pass_reuses_forward_section() {
    let (snap, ground) = reverse_mix_snapshot(Arm::Battery, 6, "c4g_");
    let g = ground_fp(ground);
    let on = sections_on_ground(&snap, &g);
    assert!(
        !on.is_empty(),
        "reverse mix produced no section on the corridor ground (setup failed)"
    );
    let mut mirrors: Vec<(String, String)> = Vec::new();
    for i in 0..on.len() {
        for j in (i + 1)..on.len() {
            if is_reverse_pair(&on[i].1, &on[j].1) {
                mirrors.push((on[i].0.clone(), on[j].0.clone()));
            }
        }
    }
    assert!(
        mirrors.is_empty(),
        "reverse-mirror duplicates on one corridor ground: {mirrors:?} (invariant 2: both directions are one section)"
    );
}
