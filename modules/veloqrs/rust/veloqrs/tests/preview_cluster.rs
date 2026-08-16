//! Cluster-honest subsetting: a preview over one geo component equals a cold
//! batch detect over exactly that component's activities.
//!
//! The component is a chain of three riding spots whose padded boxes bridge
//! pairwise, with the picked point inside only the first: any bbox-radius
//! subset around the point would drop the far spots, shrink the pool and
//! surface phantom "gone" rows. A second component far away must contribute
//! nothing.
//!
//! Coordinates here are synthetic.
//!
//! Run: `cargo test --test preview_cluster -p veloqrs`

use std::collections::HashMap;
use std::time::{Duration, Instant};

use tempfile::TempDir;
use tracematch::GpsPoint;
use tracematch::sections::{DetectionMethod, Tunables, shares_ground};
use veloqrs::FfiSectionConfig;
use veloqrs::objects::SectionPreview;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::with_persistent_engine;

/// Activities per riding spot; enough for a section at min_activities 3.
const PER_SPOT: usize = 4;

/// Chain spot latitudes ~33 km apart, inside the 50 km cluster gap, so the
/// three spots union into one component while only the first holds the pick.
const CHAIN_LATS: [f64; 3] = [5.0, 5.3, 5.6];

/// A ~2.2 km line at (base_lat, base_lng): 200 points ~11 m apart, laterally
/// jittered per activity within GPS drift.
fn line_track(base_lat: f64, base_lng: f64, jitter: f64) -> Vec<GpsPoint> {
    (0..200)
        .map(|i| GpsPoint {
            latitude: base_lat + f64::from(i) * 0.0001,
            longitude: base_lng + jitter,
            elevation: None,
        })
        .collect()
}

/// The whole seeded pool: (id, track, start epoch), chain spots then the far
/// component. Epochs sit a fortnight apart so every activity is its own
/// occasion.
fn corpus() -> Vec<(String, Vec<GpsPoint>, i64)> {
    let mut out = Vec::new();
    let mut n = 0i64;
    for (spot, base_lat) in CHAIN_LATS.iter().enumerate() {
        for i in 0..PER_SPOT {
            n += 1;
            out.push((
                format!("chain{spot}_{i}"),
                line_track(*base_lat, 10.0, i as f64 * 0.00002),
                1_700_000_000 - n * 14 * 86_400,
            ));
        }
    }
    for i in 0..PER_SPOT {
        n += 1;
        out.push((
            format!("far_{i}"),
            line_track(40.0, 60.0, i as f64 * 0.00002),
            1_700_000_000 - n * 14 * 86_400,
        ));
    }
    out
}

fn in_chain_region(polyline: &[GpsPoint]) -> bool {
    polyline.first().is_some_and(|p| p.latitude < 20.0)
}

#[test]
fn a_preview_over_a_component_matches_the_cold_batch_over_its_activities() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    assert!(persistent_engine_init(
        path.to_str().expect("utf-8 path").to_string()
    ));

    let pool = corpus();
    with_persistent_engine(|engine| {
        let mut cfg = engine.get_section_config();
        cfg.detection_method = DetectionMethod::Unified;
        cfg.min_activities = 3;
        engine.set_section_config(cfg);
        for (id, track, epoch) in &pool {
            engine
                .add_activity(id.clone(), track.clone(), "Ride".into())
                .expect("add activity");
            engine
                .update_activity_metadata(id, Some(*epoch), None, None, None)
                .expect("metadata");
        }
    })
    .expect("engine installed");

    // The live catalogue the preview diffs against, from the production arm.
    with_persistent_engine(|engine| {
        let handle = engine.detect_sections_background();
        let (main, cache_update) = handle.recv_with_cache();
        let (sections, processed_ids) = main.expect("real detect result");
        engine
            .apply_sections_with_cache(sections, cache_update)
            .expect("apply sections");
        engine
            .save_processed_activity_ids(&processed_ids)
            .expect("save processed ids");
    })
    .expect("engine installed");

    let (cfg, live_chain, live_far) = with_persistent_engine(|engine| {
        let live: Vec<_> = engine
            .get_sections()
            .iter()
            .filter(|s| !s.is_user_defined)
            .cloned()
            .collect();
        let (chain, far): (Vec<_>, Vec<_>) =
            live.into_iter().partition(|s| in_chain_region(&s.polyline));
        (engine.get_section_config(), chain, far)
    })
    .expect("engine installed");
    assert!(
        live_chain.len() >= CHAIN_LATS.len(),
        "each chain spot must cut a live section, got {}",
        live_chain.len()
    );
    assert!(
        !live_far.is_empty(),
        "the far component must hold live sections for the scoping to exclude"
    );

    // The cold batch over exactly the component's activities, id-sorted like
    // the preview's pool order. It must reproduce the live chain catalogue.
    let mut component: Vec<(String, Vec<GpsPoint>)> = pool
        .iter()
        .filter(|(id, _, _)| id.starts_with("chain"))
        .map(|(id, track, _)| (id.clone(), track.clone()))
        .collect();
    component.sort_by(|a, b| a.0.cmp(&b.0));
    let sport_map: HashMap<String, String> = component
        .iter()
        .map(|(id, _)| (id.clone(), "Ride".to_string()))
        .collect();
    let epochs: HashMap<String, i64> = pool
        .iter()
        .filter(|(id, _, _)| id.starts_with("chain"))
        .map(|(id, _, epoch)| (id.clone(), *epoch))
        .collect();
    let cold = tracematch::detect_sections_unified_dated(
        &component,
        &[],
        &sport_map,
        &epochs,
        &cfg,
        &Tunables::DEFAULT,
    );
    assert_eq!(
        cold.sections.len(),
        live_chain.len(),
        "the live chain catalogue is not the cold batch over the component"
    );
    for cold_section in &cold.sections {
        assert!(
            live_chain
                .iter()
                .any(|l| shares_ground(&cold_section.polyline, &l.polyline)),
            "a cold batch section shares ground with no live chain section"
        );
    }

    // Preview from a point inside only the first spot, live config unchanged.
    let preview = SectionPreview::new();
    assert!(
        preview
            .start(5.01, 10.0, FfiSectionConfig::from(&cfg))
            .expect("start call"),
        "a preview over the chain must start"
    );
    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        let status = preview.poll().expect("poll");
        if status == "complete" {
            break;
        }
        assert!(
            status == "running",
            "preview ended in '{status}' instead of completing"
        );
        assert!(Instant::now() < deadline, "preview never completed");
        std::thread::sleep(Duration::from_millis(50));
    }
    let json = preview
        .take_result()
        .expect("take call")
        .expect("a completed preview yields a payload");
    let payload: serde_json::Value = serde_json::from_str(&json).expect("payload parses");

    // The pool is the whole component, every spot included, nothing from the
    // far component.
    assert_eq!(
        payload["pool"]["activities"].as_u64(),
        Some((CHAIN_LATS.len() * PER_SPOT) as u64),
        "the preview pool is not the whole component"
    );

    // An unchanged config over an unchanged pool reproduces the live
    // catalogue exactly: every row unchanged, nothing gone, minted or moved.
    let counts = &payload["counts"];
    assert_eq!(counts["gone"].as_u64(), Some(0), "phantom gone rows");
    assert_eq!(counts["new"].as_u64(), Some(0), "phantom new rows");
    assert_eq!(counts["changed"].as_u64(), Some(0), "phantom changed rows");
    assert_eq!(
        counts["unchanged"].as_u64(),
        Some(live_chain.len() as u64),
        "the preview does not reproduce the live chain catalogue"
    );
    assert_eq!(counts["current"].as_u64(), Some(live_chain.len() as u64));
    assert_eq!(
        counts["proposed"].as_u64(),
        Some(cold.sections.len() as u64)
    );

    let mut live_ids: Vec<String> = live_chain.iter().map(|s| s.id.clone()).collect();
    live_ids.sort();
    let mut paired_ids: Vec<String> = payload["sections"]
        .as_array()
        .expect("sections")
        .iter()
        .map(|s| {
            assert_eq!(s["status"].as_str(), Some("unchanged"));
            s["live_id"]
                .as_str()
                .expect("unchanged carries live_id")
                .to_string()
        })
        .collect();
    paired_ids.sort();
    assert_eq!(
        paired_ids, live_ids,
        "the preview pairs 1:1 with the component's live sections"
    );
}
