//! Two metrics answer "which track represents this group", and nothing checks
//! that they agree.
//!
//! `find_best_representative` (`tracematch/src/grouping.rs`) picks the member
//! with the highest average route-signature match to the rest, at grouping time,
//! and the answer is stored as `route_groups.representative_id`.
//! `compute_medoid_track` (`veloqrs/src/persistence/routes.rs`) picks the member
//! with the smallest summed 20-by-20 haversine distance to every other member,
//! at read time, and `get_consensus_route` caches it in a 50-slot LRU that a
//! removal or a wipe clears.
//!
//! Expected behaviour: if the two agree, `get_consensus_route` can be one
//! `get_gps_track` of `representative_id` and the LRU and the per-open recompute
//! go away. If they disagree, which line route detail should draw is a question
//! rather than a cost.
//!
//! The measurement was written against the private corpus's 47 multi-member
//! groups. That fixture was deleted, so this drives the synthetic corpus
//! instead: repeats of one route with the generator's own noise, which is what a
//! group is.

#![cfg(feature = "synthetic")]

use tempfile::TempDir;
use tracematch::GpsPoint;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentEngine;

/// A library of repeats, which is what makes multi-member groups.
fn engine_with_groups(dir: &TempDir, file: &str) -> PersistentEngine {
    let corpus = LifecycleCorpus::generate(&LifecycleConfig {
        bucket_a_count: 30,
        bucket_b_delta_count: 12,
        bucket_d_delta_count: 8,
        bucket_e_delta_count: 6,
        parallel_street_count: 0,
        ..LifecycleConfig::default()
    });
    let path = dir.path().join(file);
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    for a in corpus.through_e() {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .expect("add activity");
        engine
            .update_activity_metadata(&a.id, Some(a.start_date_unix), None, None, None)
            .expect("metadata");
    }
    engine
}

/// Whether two tracks are the same line, point for point. The consensus is a
/// clone of one member's stored track, so equality is exact rather than fuzzy.
fn same_line(a: &[GpsPoint], b: &[GpsPoint]) -> bool {
    a.len() == b.len()
        && a.iter()
            .zip(b)
            .all(|(p, q)| p.latitude == q.latitude && p.longitude == q.longitude)
}

/// Which member of the group the consensus track actually is, if any.
fn which_member(
    engine: &mut PersistentEngine,
    members: &[String],
    consensus: &[GpsPoint],
) -> Option<String> {
    for id in members {
        if let Some(track) = engine.get_gps_track(id)
            && same_line(&track, consensus)
        {
            return Some(id.clone());
        }
    }
    None
}

/// `compute_medoid_track`'s own distance, restated here because it is private.
///
/// For each of twenty sampled points of `a`, the distance to the nearest of
/// twenty sampled points of `b`, averaged. Note what that is not: it takes the
/// nearest point of `b` for every point of `a` and never the reverse, so it is a
/// one-way covering distance and `d(a, b)` is not `d(b, a)`.
fn one_way_distance(a: &[GpsPoint], b: &[GpsPoint]) -> f64 {
    let n = 20.min(a.len().min(b.len()));
    let (step_a, step_b) = (a.len() / n, b.len() / n);
    (0..n)
        .map(|i| {
            let p = &a[i * step_a];
            (0..n)
                .map(|j| haversine(p, &b[j * step_b]))
                .fold(f64::MAX, f64::min)
        })
        .sum::<f64>()
        / n as f64
}

fn haversine(p: &GpsPoint, q: &GpsPoint) -> f64 {
    const R: f64 = 6_371_008.8;
    let (lat1, lat2) = (p.latitude.to_radians(), q.latitude.to_radians());
    let dlat = lat2 - lat1;
    let dlng = (q.longitude - p.longitude).to_radians();
    let h = (dlat / 2.0).sin().powi(2) + lat1.cos() * lat2.cos() * (dlng / 2.0).sin().powi(2);
    2.0 * R * h.sqrt().asin()
}

/// Scenario: `compute_medoid_track` sums this distance from each member to every
/// other and takes the smallest sum, which is the definition of a medoid only if
/// the distance is symmetric. It is not.
///
/// Expected behaviour: this records that it is not, because that is the mechanism
/// behind the disagreement the table above prints. The member that wins is the
/// one whose points are best covered by the others, not the one most central, and
/// a group of two has no tie to fall back on either.
#[test]
fn the_distance_the_medoid_sums_is_one_way() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with_groups(&dir, "one_way.db");

    let pairs: Vec<Vec<String>> = engine
        .get_groups()
        .iter()
        .filter(|g| g.activity_ids.len() == 2)
        .map(|g| g.activity_ids.clone())
        .collect();
    assert!(!pairs.is_empty(), "the corpus produced no two-member group");

    let mut asymmetric = 0;
    for members in &pairs {
        let first = engine.get_gps_track(&members[0]).expect("stored track");
        let second = engine.get_gps_track(&members[1]).expect("stored track");
        let forward = one_way_distance(&first, &second);
        let back = one_way_distance(&second, &first);
        println!(
            "{} -> {}: {forward:.3} m, back: {back:.3} m",
            members[0], members[1]
        );
        if (forward - back).abs() > 1e-6 {
            asymmetric += 1;
        }
    }

    assert!(
        asymmetric > 0,
        "every pair measured the same both ways, so the distance is symmetric          after all and a two-member group is decided by list order instead"
    );
}

/// The experiment itself. It prints the table and counts, and asserts only what
/// the reading established: that the corpus makes enough groups to say something
/// and that the two metrics do not agree. It deliberately does not assert that
/// they agree. They do not, and which of the two route detail should draw is a
/// decision rather than a defect, so turning the disagreement into a failing gate
/// would be asserting an answer nobody has given.
#[test]
fn the_stored_representative_and_the_medoid_are_measured_against_each_other() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with_groups(&dir, "representative.db");

    let groups: Vec<(String, String, Vec<String>)> = engine
        .get_groups()
        .iter()
        .filter(|g| g.activity_ids.len() > 1)
        .map(|g| {
            (
                g.group_id.clone(),
                g.representative_id.clone(),
                g.activity_ids.clone(),
            )
        })
        .collect();

    assert!(
        groups.len() >= 3,
        "the corpus produced {} multi-member groups, too few to say anything",
        groups.len()
    );

    let mut disagreements = Vec::new();
    for (group_id, representative, members) in &groups {
        let consensus = engine
            .get_consensus_route(group_id)
            .expect("a group with members has a consensus route");
        let medoid = which_member(&mut engine, members, &consensus);
        println!(
            "{group_id}: {} members, representative {representative}, medoid {}",
            members.len(),
            medoid.as_deref().unwrap_or("<no member>")
        );
        if medoid.as_deref() != Some(representative.as_str()) {
            disagreements.push((
                group_id.clone(),
                members.len(),
                representative.clone(),
                medoid.unwrap_or_else(|| "<no member>".to_string()),
            ));
        }
    }

    println!(
        "{} of {} multi-member groups disagree: {disagreements:?}",
        disagreements.len(),
        groups.len()
    );
    assert!(
        !disagreements.is_empty(),
        "the two metrics now agree on every group, which the reading found they did \
         not. Re-read the decision this measurement was taken for before deleting \
         this: if they agree, get_consensus_route can be one get_gps_track of \
         representative_id and the LRU goes away."
    );
}

/// The consensus is one member's track, not an average of them. If it ever
/// stopped being one, `representative_id` could not stand in for it whatever the
/// two metrics agreed on.
#[test]
fn the_consensus_is_one_members_own_track() {
    let dir = TempDir::new().expect("tempdir");
    let mut engine = engine_with_groups(&dir, "consensus_identity.db");

    let groups: Vec<(String, Vec<String>)> = engine
        .get_groups()
        .iter()
        .filter(|g| g.activity_ids.len() > 1)
        .map(|g| (g.group_id.clone(), g.activity_ids.clone()))
        .collect();

    for (group_id, members) in &groups {
        let consensus = engine
            .get_consensus_route(group_id)
            .expect("a group with members has a consensus route");
        assert!(
            which_member(&mut engine, members, &consensus).is_some(),
            "{group_id}'s consensus matches no member's stored track"
        );
    }
}
