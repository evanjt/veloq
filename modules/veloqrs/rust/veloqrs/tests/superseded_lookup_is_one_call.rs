//! A custom section hides the auto sections it covers. That question used to be
//! answered from TypeScript, one FFI call per auto section, each rebuilding the
//! same R-tree over the custom polyline and each decoding a polyline the engine
//! already held. The engine answers it in one read now, so this pins what the
//! answer is: the fraction of the *auto* section lying within the custom one,
//! strictly above the threshold.
//!
//! Run: `cargo test --test superseded_lookup_is_one_call -p veloqrs`

use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;
use veloqrs::sections::CreateSectionParams;

const THRESHOLD_M: f64 = 50.0;
const OVERLAP: f64 = 0.8;

struct Setup {
    engine: PersistentEngine,
    _tmp: TempDir,
}

fn setup() -> Setup {
    let tmp = TempDir::new().expect("temp dir");
    let path = tmp.path().join("superseded.db");
    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine new");
    Setup { engine, _tmp: tmp }
}

/// `count` points ~55 m apart along a meridian, starting at `lat`.
fn line(lat: f64, lng: f64, count: usize) -> Vec<GpsPoint> {
    (0..count)
        .map(|i| GpsPoint::new(lat + i as f64 * 0.0005, lng))
        .collect()
}

fn create(engine: &mut PersistentEngine, polyline: Vec<GpsPoint>, custom: bool) -> String {
    let distance = tracematch::matching::calculate_route_distance(&polyline);
    engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".to_string(),
            polyline,
            distance_meters: distance,
            name: None,
            source_activity_id: custom.then(|| "act-1".to_string()),
            start_index: custom.then_some(0),
            end_index: custom.then_some(19),
        })
        .expect("create section")
}

#[test]
fn an_auto_section_the_custom_one_covers_is_returned() {
    let mut s = setup();
    let auto = create(&mut s.engine, line(46.0, 7.0, 20), false);
    let custom = create(&mut s.engine, line(46.0, 7.0, 20), true);

    let found = s
        .engine
        .find_superseded_auto_sections(&custom, THRESHOLD_M, OVERLAP);

    assert_eq!(found, vec![auto]);
}

#[test]
fn an_auto_section_far_away_is_not_returned() {
    let mut s = setup();
    create(&mut s.engine, line(47.5, 9.0, 20), false);
    let custom = create(&mut s.engine, line(46.0, 7.0, 20), true);

    let found = s
        .engine
        .find_superseded_auto_sections(&custom, THRESHOLD_M, OVERLAP);

    assert!(found.is_empty(), "expected nothing, got {found:?}");
}

/// The overlap measured is the fraction of the auto section inside the custom
/// one, not the reverse. A short custom cut through a long auto section covers
/// little of it and must supersede nothing, while the same pair read the other
/// way round would be fully covered and pass.
#[test]
fn a_short_custom_cut_does_not_supersede_the_long_auto_section() {
    let mut s = setup();
    create(&mut s.engine, line(46.0, 7.0, 40), false);
    let custom = create(&mut s.engine, line(46.0, 7.0, 4), true);

    let found = s
        .engine
        .find_superseded_auto_sections(&custom, THRESHOLD_M, OVERLAP);

    assert!(found.is_empty(), "expected nothing, got {found:?}");
}

#[test]
fn a_section_id_that_resolves_to_no_line_returns_nothing() {
    let mut s = setup();
    create(&mut s.engine, line(46.0, 7.0, 20), false);

    let found = s
        .engine
        .find_superseded_auto_sections("no-such-section", THRESHOLD_M, OVERLAP);

    assert!(found.is_empty(), "expected nothing, got {found:?}");
}

#[test]
fn an_already_superseded_auto_section_is_not_returned_again() {
    let mut s = setup();
    let auto = create(&mut s.engine, line(46.0, 7.0, 20), false);
    let first = create(&mut s.engine, line(46.0, 7.0, 20), true);
    s.engine.set_superseded(&auto, &first).expect("supersede");

    let second = create(&mut s.engine, line(46.0, 7.0, 20), true);
    let found = s
        .engine
        .find_superseded_auto_sections(&second, THRESHOLD_M, OVERLAP);

    assert!(found.is_empty(), "expected nothing, got {found:?}");
}

/// Every auto section in range is answered by the one call, not just the first.
#[test]
fn each_covered_auto_section_comes_back_from_the_one_call() {
    let mut s = setup();
    let a = create(&mut s.engine, line(46.0, 7.0, 20), false);
    let b = create(&mut s.engine, line(46.0, 7.0, 20), false);
    let custom = create(&mut s.engine, line(46.0, 7.0, 20), true);

    let mut found = s
        .engine
        .find_superseded_auto_sections(&custom, THRESHOLD_M, OVERLAP);
    found.sort();
    let mut want = vec![a, b];
    want.sort();

    assert_eq!(found, want);
}

/// The bounds prefilter must not clip a section that is offset but still
/// inside the threshold. ~33 m east of the custom line, under the 50 m
/// tolerance, so every point still matches.
#[test]
fn an_auto_section_offset_within_the_threshold_is_still_superseded() {
    let mut s = setup();
    let auto = create(&mut s.engine, line(46.0, 7.000_43, 20), false);
    let custom = create(&mut s.engine, line(46.0, 7.0, 20), true);

    let found = s
        .engine
        .find_superseded_auto_sections(&custom, THRESHOLD_M, OVERLAP);

    assert_eq!(found, vec![auto]);
}
