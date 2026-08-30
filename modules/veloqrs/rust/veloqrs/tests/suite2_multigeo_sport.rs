//! Suite #2, multi-geography + multi-sport pooled detection (invariant 2).
//!
//! Invariant 2: a trace is a trace. Detection sees every sport together, sport
//! belongs to the comparison layer, and `section.sport_type` is a derived
//! attribute of one ground, not a key the detector splits on. The visible
//! catalogue therefore must be stable under two things that should be
//! irrelevant to it: WHERE else in the world the user rides, and WHICH sport
//! happens to travel a shared corridor most.
//!
//! The Battery arm (`DetectionMethod::Unified`) is the probe here because the
//! behaviour under test lives in the detector: it cuts one pool and emits
//! sections ordered by each cluster's south-west corner. Identity is layered on
//! top (B2), so an id must stay on its ground while that emission order moves
//! underneath it.
//!
//! One gate per curiosity. Three hold today and run live; the shared-corridor
//! heading is still frozen at first assignment by the identity carry, so that
//! one is `#[ignore]`d with the defect named. Snapshots read the user-visible
//! DB view, so every count is what the app renders.
//!
//! Data is synthetic and deterministic (`LifecycleCorpus`, seeded). A second
//! geography is a corpus at a shifted origin with namespaced activity ids so
//! the two never collide in the engine.
//!
//! Run: `cargo test -p veloqrs --features synthetic --test suite2_multigeo_sport -- --include-ignored`

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
        rank_score: None,
        klass: None,
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
/// past the occasion floor's one-stay window, these scenarios exercise
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
/// detector honestly refuses to render them, these suites test SPORT
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
// Curiosity 1. SPATIAL PERTURBATION (identity across space)
// ============================================================================
//
// A second, distant city is added to a detected library. Emission still orders
// clusters by their south-west corner, so a city placed further SOUTH sorts
// ahead of the first and shifts every emission position. Identity must not
// follow that: the id a section holds has to be a function of its own ground,
// not of how many sections sort ahead of it in the whole catalogue.

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

/// Gate (positional ids): a distant, unrelated geography must not perturb the
/// identity of an existing one. Asserts `identity_retention >= 0.85` for
/// geography 1 when geography 2 is added to the SOUTH, the harder direction,
/// its clusters sort ahead of geography 1's, so a counter numbered by south-west
/// corner would renumber geography 1 wholesale. Identity is assigned once and
/// carried with the ground (B2), independent of what else the catalogue holds.
#[test]
fn distant_geography_must_not_reshuffle_ids() {
    let (g1a, g1b) = geo_scenario(46.37, 0x5150, "g2s_");
    assert_catalogue_populated("geo1 before the southern add", &g1a);
    let retention = identity_retention(&g1a, &g1b);
    let ground = ground_survival(&g1a, &g1b);
    assert!(
        retention >= 0.85,
        "adding a distant southern geography reshuffled geography 1: \
         identity_retention={retention:.2} (want >= 0.85) while ground_survival={ground:.2} \
         (its ground is all still present, the ids just moved off it)"
    );
}

// ============================================================================
// Curiosity 2. SPORT DERIVATION ON A SHARED CORRIDOR
// ============================================================================
//
// Corridor 2 in the corpus is travelled by both Ride and Run (ground-truth
// `sport_types = [Ride, Run]`). Pooled detection treats that as ONE ground with
// a derived sport, keeping a per-sport comparison view on top. The heading it
// derives is still the identity's first assignment, so it tracks which sport
// arrived first rather than which sport owns the ground.

/// Ingest `ride_n` + `run_n` traversals of corridor 2, same ground, only the
/// sport labels differ, and return the post-pipeline snapshot plus the ground.
///
/// The minority sport goes in first, so a heading held from first assignment
/// disagrees between the two arms instead of agreeing on whichever sport the
/// caller happened to ingest first.
/// Ingest `ride_n` rides and `run_n` runs of corridor 2 in a chosen order,
/// so two arms with the same counts differ only in which sport arrived
/// first.
fn cross_order_snapshot(
    ride_n: usize,
    run_n: usize,
    prefix: &str,
    runs_first: bool,
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
    let (first, second) = if runs_first {
        (("cross/run", &runs), ("cross/ride", &rides))
    } else {
        (("cross/ride", &rides), ("cross/run", &runs))
    };
    ingest_step(&mut engine, first.0, &refs(first.1));
    let snap = ingest_step(&mut engine, second.0, &refs(second.1)).snapshot;
    (snap, ground)
}

/// Gate (invariant 2, sport is derived, not partitioned): a corridor travelled
/// by both sports yields ONE section on that ground, headed by the sport most
/// of its members do, whichever sport arrived first. Every apply re-derives
/// the heading from the members, so a carried row never keeps the label of
/// its first assignment.
#[test]
fn shared_corridor_yields_one_section_with_stable_sport() {
    let (rides_first, ground) = cross_order_snapshot(8, 4, "c2a_", false);
    let (runs_first, _) = cross_order_snapshot(8, 4, "c2b_", true);
    let g = ground_fp(ground);

    let on_rides_first = sections_on_ground(&rides_first, &g);
    let on_runs_first = sections_on_ground(&runs_first, &g);
    assert_eq!(
        on_rides_first.len(),
        1,
        "rides first: shared multi-sport ground carries {} sections (want 1; >1 is per-sport duplication)",
        on_rides_first.len()
    );
    assert_eq!(
        on_runs_first.len(),
        1,
        "runs first: shared multi-sport ground carries {} sections (want 1)",
        on_runs_first.len()
    );

    let heading_rides_first = &on_rides_first[0].1.sport_type;
    let heading_runs_first = &on_runs_first[0].1.sport_type;
    assert_eq!(
        heading_rides_first, "Ride",
        "the heading is the sport most of the members do"
    );
    assert_eq!(
        heading_rides_first, heading_runs_first,
        "the heading disagrees across two arms with the same members: {heading_rides_first} vs {heading_runs_first} \
         (invariant 2: sport is derived from the members, not from which sport arrived first)"
    );
}

// ============================================================================
// Curiosity 3. ADD-A-SECOND-SPORT IDENTITY
// ============================================================================
//
// A Ride-only corridor exists, then Run passes of the SAME ground arrive. Under
// invariant 2 the section is the ground: it keeps its id, and the second sport
// is absorbed. The Run batch here is >= 50% new, so it takes the FULL re-detect
// path, the harder case, where the whole pool is re-cut and the id has to be
// handed to the surviving candidate rather than re-minted.

/// Gate (invariant 2, id survives a sport addition): adding a second sport on
/// the same ground must leave the cold section's id still on that ground.
///
/// This is B2's identity layer: the Run pass re-cuts the whole pool, and B2's
/// resolution hands the cold id to the surviving candidate rather than
/// re-minting it. The heading that candidate carries is gated separately by
/// `shared_corridor_yields_one_section_with_stable_sport`.
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
        on.iter().any(|(id, _)| id == &cold_id),
        "adding a second sport on the same ground broke identity: cold id {cold_id} left the \
         ground, which now carries {:?}",
        on.iter()
            .map(|(id, f)| (id.clone(), f.sport_type.clone()))
            .collect::<Vec<_>>(),
    );
}

// ============================================================================
// Curiosity 4. REVERSE DIRECTION
// ============================================================================
//
// A corridor travelled both ways is one corridor. The unified detector rasters
// tracks into a coverage grid, which is direction-blind, so a reverse pass joins
// the forward section rather than spawning a mirror on the same ground.

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

/// Gate (invariant 2, one corridor, both directions): a reverse pass reuses the
/// forward section, never spawning a mirror on the same ground. Battery arm. The
/// unified detector rasters into a direction-blind coverage grid, so both
/// directions land in one section. A red is a direction-sensitive change
/// reintroducing mirror duplicates.
#[test]
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
