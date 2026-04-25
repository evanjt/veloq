//! Synthetic section detection audit.
//!
//! Builds 5 GPS tracks sharing a ~1 km overlapping segment (with per-track
//! jitter) and verifies that `detect_sections_multiscale` finds the overlap.
//! Unlike `detection_audit.rs` this runs without a private database, so it
//! executes in CI on every push.

use std::collections::HashMap;
use tracematch::{
    geo_utils::haversine_distance,
    sections::{detect_sections_multiscale, SectionConfig},
    GpsPoint,
};

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/// Linearly interpolate `n` points between `start` and `end`.
fn lerp_track(start: (f64, f64), end: (f64, f64), n: usize) -> Vec<GpsPoint> {
    (0..n)
        .map(|i| {
            let t = i as f64 / (n - 1).max(1) as f64;
            GpsPoint::new(
                start.0 + (end.0 - start.0) * t,
                start.1 + (end.1 - start.1) * t,
            )
        })
        .collect()
}

/// Add deterministic GPS-like jitter (±~5 m) seeded by `seed`.
fn add_jitter(points: &[GpsPoint], seed: u64) -> Vec<GpsPoint> {
    let mut state = seed;
    points
        .iter()
        .map(|p| {
            // Simple xorshift for deterministic pseudo-random numbers
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            let dx = ((state % 100) as f64 - 50.0) * 0.000001; // ~±5 m
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            let dy = ((state % 100) as f64 - 50.0) * 0.000001;
            GpsPoint::new(p.latitude + dx, p.longitude + dy)
        })
        .collect()
}

/// Build a track: unique-prefix → shared-segment → unique-suffix.
/// Each prefix/suffix diverges sharply from the shared corridor so the
/// algorithm treats only the central portion as overlapping.
fn build_track(
    prefix_start: (f64, f64),
    shared_start: (f64, f64),
    shared_end: (f64, f64),
    suffix_end: (f64, f64),
    seed: u64,
) -> Vec<GpsPoint> {
    let prefix = lerp_track(prefix_start, shared_start, 20);
    let shared = lerp_track(shared_start, shared_end, 60);
    let suffix = lerp_track(shared_end, suffix_end, 20);

    let mut track = Vec::with_capacity(prefix.len() + shared.len() + suffix.len());
    track.extend_from_slice(&prefix);
    track.extend_from_slice(&shared[1..]);
    track.extend_from_slice(&suffix[1..]);

    add_jitter(&track, seed)
}

/// Create 5 activities sharing the same ~1.5 km central segment.
/// Each activity approaches from a well-separated direction.
fn build_fixture() -> (Vec<(String, Vec<GpsPoint>)>, HashMap<String, String>) {
    // Shared segment: ~1.5 km straight road near Zurich
    let shared_start = (47.3700, 8.5400);
    let shared_end = (47.3835, 8.5400); // ~1.5 km north

    // Unique approach/departure: widely separated so they're clearly outside
    // the proximity_threshold (50 m). ~800 m divergence at mid-prefix.
    let variants: [(f64, f64, f64, f64); 5] = [
        (47.3620, 8.5250, 47.3920, 8.5550), // SW → NE
        (47.3625, 8.5550, 47.3915, 8.5250), // SE → NW
        (47.3610, 8.5400, 47.3930, 8.5400), // S  → N  (straight through)
        (47.3630, 8.5150, 47.3910, 8.5650), // WSW → ENE
        (47.3628, 8.5600, 47.3912, 8.5200), // ESE → WNW
    ];

    let tracks: Vec<(String, Vec<GpsPoint>)> = variants
        .iter()
        .enumerate()
        .map(|(i, (pre_lat, pre_lng, suf_lat, suf_lng))| {
            let id = format!("activity-{}", i + 1);
            let track = build_track(
                (*pre_lat, *pre_lng),
                shared_start,
                shared_end,
                (*suf_lat, *suf_lng),
                (i as u64 + 1) * 7919,
            );
            (id, track)
        })
        .collect();

    let sport_types: HashMap<String, String> = tracks
        .iter()
        .map(|(id, _)| (id.clone(), "Ride".to_string()))
        .collect();

    (tracks, sport_types)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn synthetic_overlap_produces_sections() {
    let (tracks, sport_types) = build_fixture();
    let config = SectionConfig::default();
    let result = detect_sections_multiscale(&tracks, &sport_types, &[], &config);

    assert!(
        !result.sections.is_empty(),
        "detection should find at least one section from 5 overlapping tracks"
    );

    let max_visits = result
        .sections
        .iter()
        .map(|s| s.visit_count)
        .max()
        .unwrap_or(0);
    assert!(
        max_visits >= 3,
        "best section should have >= 3 visits, got {}",
        max_visits
    );
}

#[test]
fn section_distance_is_reasonable() {
    let (tracks, sport_types) = build_fixture();
    let config = SectionConfig::default();
    let result = detect_sections_multiscale(&tracks, &sport_types, &[], &config);

    let best = result
        .sections
        .iter()
        .max_by_key(|s| s.visit_count)
        .expect("should have at least one section");

    assert!(
        best.distance_meters > 200.0 && best.distance_meters < 3000.0,
        "best section distance should be 200–3000 m (shared segment is ~1.5 km), got {:.0} m",
        best.distance_meters
    );
}

#[test]
fn most_activities_appear_in_section() {
    let (tracks, sport_types) = build_fixture();
    let config = SectionConfig::default();
    let result = detect_sections_multiscale(&tracks, &sport_types, &[], &config);

    let best = result
        .sections
        .iter()
        .max_by_key(|s| s.activity_ids.len())
        .expect("should have at least one section");

    assert!(
        best.activity_ids.len() >= 4,
        "best section should contain >= 4 of the 5 activities, got {}",
        best.activity_ids.len()
    );
}

#[test]
fn consensus_polyline_is_near_tracks() {
    let (tracks, sport_types) = build_fixture();
    let config = SectionConfig::default();
    let result = detect_sections_multiscale(&tracks, &sport_types, &[], &config);

    let best = result
        .sections
        .iter()
        .max_by_key(|s| s.visit_count)
        .expect("should have at least one section");

    let all_points: Vec<&GpsPoint> = tracks.iter().flat_map(|(_, pts)| pts.iter()).collect();

    for cp in &best.polyline {
        let min_dist = all_points
            .iter()
            .map(|p| haversine_distance(cp, p))
            .fold(f64::INFINITY, f64::min);

        assert!(
            min_dist < 100.0,
            "consensus point ({:.6}, {:.6}) is {:.0} m from nearest track point (limit 100 m)",
            cp.latitude,
            cp.longitude,
            min_dist
        );
    }
}
