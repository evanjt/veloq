//! The detect and the preview hand tracematch the stored time streams.
//!
//! Scenario: five activities share one straight 25% climb, each arriving and
//! leaving on its own bearing. The climb is geometrically indistinguishable
//! from a cable car, so untimed the lift veto marks it and its ground
//! contributes no evidence, leaving nothing to cut. The stored streams say it
//! was walked at 1 m/s, which is the only thing that can tell the two apart.
//!
//! Expected behaviour: the untimed pool yields no section over the climb and
//! the timed pool does. A detect that passes `&[]` for seconds cannot tell
//! them apart, so both arms read as untimed and the test fails on the second.

use std::time::{Duration, Instant};
use tracematch::GpsPoint;
use veloqrs::FfiSectionConfig;
use veloqrs::PersistentEngine;
use veloqrs::objects::SectionPreview;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::with_persistent_engine;

const BASE: (f64, f64) = (46.0, 7.0);
const M_PER_DEG_LAT: f64 = 111_320.0;
/// At 46 degrees north.
const M_PER_DEG_LNG: f64 = 77_330.0;

/// Metres per sample, and one second per metre, so every leg is walked at
/// 1 m/s: under the 1.5 m/s the velocity veto calls carried movement.
const STEP_M: f64 = 10.0;

fn offset(from: (f64, f64), bearing_deg: f64, metres: f64) -> (f64, f64) {
    let r = bearing_deg.to_radians();
    (
        from.0 + metres * r.cos() / M_PER_DEG_LAT,
        from.1 + metres * r.sin() / M_PER_DEG_LNG,
    )
}

/// `n` samples from `start` to `end`, rising linearly from `lo` to `hi`.
fn leg(start: (f64, f64), end: (f64, f64), n: usize, lo: f64, hi: f64) -> Vec<GpsPoint> {
    (0..n)
        .map(|i| {
            let t = i as f64 / (n - 1).max(1) as f64;
            GpsPoint::with_elevation(
                start.0 + (end.0 - start.0) * t,
                start.1 + (end.1 - start.1) * t,
                lo + (hi - lo) * t,
            )
        })
        .collect()
}

/// The shared climb: 790 m due north at 25%, straight enough and steep
/// enough to seed a lift span on geometry alone.
fn climb_top() -> (f64, f64) {
    offset(BASE, 0.0, 790.0)
}

/// Approach on `in_bearing`, the shared climb, then departure on
/// `out_bearing`. Both legs run 800 m, so no two approaches sit inside the
/// 200 m proximity threshold away from the climb itself.
fn track(in_bearing: f64, out_bearing: f64) -> Vec<GpsPoint> {
    let top = climb_top();
    let approach_start = offset(BASE, in_bearing, 800.0);
    let departure_end = offset(top, out_bearing, 800.0);

    let mut points = leg(approach_start, BASE, 81, 1000.0, 1000.0);
    points.extend_from_slice(&leg(BASE, top, 80, 1000.0, 1197.5)[1..]);
    points.extend_from_slice(&leg(top, departure_end, 81, 1197.5, 1197.5)[1..]);
    points
}

/// Five distinct routes over one climb, on five separate days.
const VARIANTS: [(f64, f64); 5] = [
    (200.0, 20.0),
    (230.0, 50.0),
    (260.0, 80.0),
    (290.0, 110.0),
    (320.0, 140.0),
];

/// 2024-01-01, then a week apart, so each traversal is its own occasion.
const FIRST_START: i64 = 1_704_067_200;
const WEEK: i64 = 7 * 86_400;

fn seed(engine: &mut PersistentEngine, timed: bool) {
    for (i, (into, out)) in VARIANTS.iter().enumerate() {
        let id = format!("a{i}");
        let points = track(*into, *out);
        let count = points.len();
        engine
            .add_activity(id.clone(), points, "hiking".to_string())
            .unwrap();
        engine
            .update_activity_metadata(&id, Some(FIRST_START + i as i64 * WEEK), None, None, None)
            .unwrap();

        if timed {
            let times: Vec<u32> = (0..count).map(|p| (p as f64 * STEP_M) as u32).collect();
            engine.set_time_streams_flat(&[id], &times, &[0]);
        }
    }
}

fn engine_with_corpus(path: &std::path::Path, timed: bool) -> PersistentEngine {
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    seed(&mut engine, timed);
    engine
}

fn detected(engine: &mut PersistentEngine) -> usize {
    let handle = engine.detect_sections_background();
    let (sections, _) = handle.recv().unwrap_or_default();
    let count = sections.len();
    engine.apply_sections(sections).unwrap();
    count
}

#[test]
fn an_untimed_pool_cuts_nothing_over_ground_the_lift_veto_marks() {
    let dir = tempfile::TempDir::new().unwrap();
    let mut engine = engine_with_corpus(&dir.path().join("untimed.db"), false);

    assert_eq!(
        detected(&mut engine),
        0,
        "geometry alone reads the climb as a cable car, so its ground carries no evidence"
    );
}

#[test]
fn a_stored_stream_reaches_the_detector_and_frees_the_ground_it_clears() {
    let dir = tempfile::TempDir::new().unwrap();
    let mut engine = engine_with_corpus(&dir.path().join("timed.db"), true);

    assert!(
        detected(&mut engine) > 0,
        "the streams say the climb was walked at 1 m/s, so the veto must not hold"
    );
}

/// The preview proposes what a Keep would apply, so it reads the same pool
/// through the same seconds. One that ran untimed against a timed detect
/// would offer sections the detect then refuses, or drop the ones it cut.
#[test]
fn the_preview_sees_the_same_ground_as_the_detect() {
    let dir = tempfile::TempDir::new().unwrap();
    let path = dir.path().join("preview.db");
    assert!(persistent_engine_init(path.to_str().unwrap().to_string()));

    with_persistent_engine(|engine| {
        seed(engine, true);
        let handle = engine.detect_sections_background();
        let (sections, _) = handle.recv().unwrap_or_default();
        assert!(
            !sections.is_empty(),
            "the corpus must cut something for the preview to agree with"
        );
        engine.apply_sections(sections).unwrap();
    })
    .expect("engine installed");

    let cfg = with_persistent_engine(|engine| engine.get_section_config()).expect("config");
    let preview = SectionPreview::new();
    let mid = offset(BASE, 0.0, 395.0);
    assert!(
        preview
            .start(mid.0, mid.1, FfiSectionConfig::from(&cfg))
            .expect("start"),
        "the climb sits inside a component"
    );

    let deadline = Instant::now() + Duration::from_secs(120);
    let payload = loop {
        match preview.poll().expect("poll").as_str() {
            "complete" => break preview.take_result().expect("take").expect("payload"),
            "running" => {}
            other => panic!("preview ended as {other}"),
        }
        assert!(Instant::now() < deadline, "preview never completed");
        std::thread::sleep(Duration::from_millis(50));
    };

    let payload: serde_json::Value = serde_json::from_str(&payload).unwrap();
    let counts = &payload["counts"];

    assert!(
        counts["proposed"].as_u64().unwrap() > 0,
        "the preview must see the climb the detect cut, not lift ground: {counts}"
    );
    assert_eq!(
        counts["gone"].as_u64().unwrap(),
        0,
        "an untimed preview reports the timed detect's sections as gone: {counts}"
    );
}
