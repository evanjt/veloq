//! The catalogue the preview screen opens on.
//!
//! `SectionPreview::current` reports the live auto sections for one riding
//! area without cutting anything. It must agree with what a run over the same
//! point diffs against, cost the database nothing, and stay quiet where the
//! library has no ground.
//!
//! Coordinates here are synthetic.
//!
//! Run: `cargo test --test preview_current -p veloqrs`

use std::collections::BTreeSet;
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde_json::Value;
use sha2::{Digest, Sha256};
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::FfiSectionConfig;
use veloqrs::objects::SectionPreview;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::with_persistent_engine;

static SERIAL: Mutex<()> = Mutex::new(());

fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

/// A ~2.2 km line: 200 points ~11 m apart, laterally jittered per activity
/// within GPS drift.
fn line_track(jitter: f64) -> Vec<GpsPoint> {
    (0..200)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0001,
            longitude: 7.0 + jitter,
            elevation: None,
        })
        .collect()
}

fn seed_engine() {
    with_persistent_engine(|engine| {
        let mut cfg = engine.get_section_config();
        cfg.min_activities = 3;
        engine.set_section_config(cfg);
        for i in 0..4 {
            let id = format!("ride_{i}");
            engine
                .add_activity(id.clone(), line_track(i as f64 * 0.00002), "Ride".into())
                .expect("add activity");
            // A fortnight apart, clear of the one-week occasion span, so
            // every activity counts as its own occasion.
            engine
                .update_activity_metadata(
                    &id,
                    Some(1_700_000_000 - i as i64 * 14 * 86_400),
                    None,
                    None,
                    None,
                )
                .expect("metadata");
        }
    })
    .expect("engine installed");
}

fn detect_and_apply() {
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
}

fn init_engine(path: &std::path::Path) {
    assert!(persistent_engine_init(
        path.to_str().expect("utf-8 path").to_string()
    ));
}

fn rows(json: &str) -> Vec<Value> {
    serde_json::from_str::<Vec<Value>>(json).expect("a JSON array of sections")
}

fn ids(rows: &[Value]) -> BTreeSet<String> {
    rows.iter()
        .map(|r| r["id"].as_str().expect("id").to_string())
        .collect()
}

fn db_sha256(path: &std::path::Path) -> [u8; 32] {
    let bytes = std::fs::read(path).expect("read db file");
    Sha256::digest(&bytes).into()
}

#[test]
fn the_current_catalogue_is_what_the_engine_holds_for_the_area() {
    let _serial = serial();
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    init_engine(&path);
    seed_engine();
    detect_and_apply();

    let live: BTreeSet<String> = with_persistent_engine(|engine| {
        engine
            .get_sections()
            .iter()
            .map(|s| s.id.clone())
            .collect::<BTreeSet<String>>()
    })
    .expect("engine installed");
    assert!(!live.is_empty(), "the seed pool produced no live catalogue");

    let preview = SectionPreview::new();
    let json = preview
        .current(46.01, 7.0)
        .expect("current call")
        .expect("the seeded area is covered");
    let rows = rows(&json);

    assert_eq!(ids(&rows), live);
    for row in &rows {
        assert_eq!(row["status"], "unchanged");
        assert_eq!(row["live_id"], row["id"]);
        assert!(
            row["polyline"].as_str().is_some_and(|p| !p.is_empty()),
            "every row carries geometry to draw"
        );
    }
}

#[test]
fn the_current_catalogue_is_the_one_a_run_diffs_against() {
    let _serial = serial();
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    init_engine(&path);
    seed_engine();
    detect_and_apply();

    let preview = SectionPreview::new();
    let opened = ids(&rows(
        &preview
            .current(46.01, 7.0)
            .expect("current call")
            .expect("covered"),
    ));

    let cfg = with_persistent_engine(|engine| engine.get_section_config()).expect("config");
    let mut ffi_cfg = FfiSectionConfig::from(&cfg);
    ffi_cfg.min_activities = 2;
    assert!(preview.start(46.01, 7.0, ffi_cfg).expect("start"));

    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        let status = preview.poll().expect("poll");
        if status == "complete" {
            break;
        }
        assert!(status == "running", "preview ended in '{status}'");
        assert!(Instant::now() < deadline, "preview never completed");
        std::thread::sleep(Duration::from_millis(50));
    }
    let payload: Value =
        serde_json::from_str(&preview.take_result().expect("take").expect("payload"))
            .expect("payload json");

    // The run's own view of the live catalogue: every row it paired against a
    // live section, plus every live section it retires.
    let diffed: BTreeSet<String> = payload["sections"]
        .as_array()
        .expect("sections")
        .iter()
        .filter_map(|s| {
            if s["status"] == "gone" {
                s["id"].as_str().map(str::to_string)
            } else {
                s["live_id"].as_str().map(str::to_string)
            }
        })
        .collect();

    assert_eq!(opened, diffed);
}

#[test]
fn an_area_with_no_catalogue_yet_reads_empty_not_missing() {
    let _serial = serial();
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    init_engine(&path);
    seed_engine();

    let preview = SectionPreview::new();
    let json = preview
        .current(46.01, 7.0)
        .expect("current call")
        .expect("the point is covered by activities");

    assert!(rows(&json).is_empty());
}

#[test]
fn a_point_no_activity_covers_reports_nothing() {
    let _serial = serial();
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    init_engine(&path);
    seed_engine();
    detect_and_apply();

    let preview = SectionPreview::new();
    assert!(
        preview
            .current(-33.9, 151.2)
            .expect("current call")
            .is_none()
    );
}

#[test]
fn reading_the_current_catalogue_writes_nothing() {
    let _serial = serial();
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    init_engine(&path);
    seed_engine();
    detect_and_apply();

    let before = db_sha256(&path);
    let preview = SectionPreview::new();
    let first = preview.current(46.01, 7.0).expect("current call");
    let second = preview.current(46.01, 7.0).expect("second current call");

    assert_eq!(first, second, "a second read reports the same catalogue");
    assert_eq!(before, db_sha256(&path));
}
