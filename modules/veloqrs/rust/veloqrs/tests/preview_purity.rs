//! A preview never writes: the DB file is byte-identical across a full run.
//!
//! The preview detector works on its own read-only connection and hands back
//! one JSON payload, so the file bytes, the catalogue tables and the
//! detection slot must all read exactly as they did before the run.
//!
//! Coordinates here are synthetic.
//!
//! Run: `cargo test --test preview_purity -p veloqrs`

use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use rusqlite::Connection;
use sha2::{Digest, Sha256};
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::FfiSectionConfig;
use veloqrs::objects::SectionPreview;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::{detection_suspended, with_persistent_engine};

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

fn db_sha256(path: &std::path::Path) -> [u8; 32] {
    let bytes = std::fs::read(path).expect("read db file");
    Sha256::digest(&bytes).into()
}

/// The catalogue tables as a second connection reads them.
fn catalogue_snapshot(path: &std::path::Path) -> Vec<(String, String, Option<String>, i64)> {
    let conn = Connection::open(path).expect("second connection");
    let mut stmt = conn
        .prepare(
            "SELECT id, sport_type, polyline_json, visit_count
             FROM sections ORDER BY id",
        )
        .expect("prepare");
    stmt.query_map([], |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
    })
    .expect("query")
    .collect::<Result<Vec<_>, _>>()
    .expect("rows")
}

/// A poller that cancels and walks away must not occupy the slot forever:
/// the next start reaps the terminal run instead of refusing.
#[test]
fn an_abandoned_preview_does_not_wedge_the_slot() {
    let _serial = serial();
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    assert!(persistent_engine_init(
        path.to_str().expect("utf-8 path").to_string()
    ));
    seed_engine();

    let cfg = with_persistent_engine(|engine| engine.get_section_config()).expect("config");
    let ffi_cfg = FfiSectionConfig::from(&cfg);

    let preview = SectionPreview::new();
    assert!(preview.start(46.01, 7.0, ffi_cfg.clone()).expect("start"));
    preview.cancel().expect("cancel");
    // No further polls: the poller is gone, exactly as an unmounted screen.

    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        if preview.start(46.01, 7.0, ffi_cfg.clone()).expect("restart") {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "the abandoned run wedged the slot"
        );
        std::thread::sleep(Duration::from_millis(50));
    }

    // Drive the superseding run to its end so the slot is clean.
    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        match preview.poll().expect("poll").as_str() {
            "complete" => {
                preview.take_result().expect("take");
                break;
            }
            "cancelled" | "error" | "idle" => break,
            _ => {
                assert!(Instant::now() < deadline, "second preview never ended");
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    }
    assert_eq!(preview.poll().expect("final poll"), "idle");
}

#[test]
fn a_full_preview_run_leaves_the_database_byte_identical() {
    let _serial = serial();
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    assert!(persistent_engine_init(
        path.to_str().expect("utf-8 path").to_string()
    ));

    seed_engine();
    detect_and_apply();
    let live_count =
        with_persistent_engine(|engine| engine.get_sections().len()).expect("engine installed");
    assert!(live_count > 0, "the seed pool produced no live catalogue");

    let hash_before = db_sha256(&path);
    let catalogue_before = catalogue_snapshot(&path);

    let cfg = with_persistent_engine(|engine| engine.get_section_config()).expect("config");
    let mut ffi_cfg = FfiSectionConfig::from(&cfg);
    ffi_cfg.min_activities = 2;

    let preview = SectionPreview::new();
    assert!(
        preview
            .start(46.01, 7.0, ffi_cfg.clone())
            .expect("start call"),
        "a preview over the seeded area must start"
    );
    assert!(
        !preview.start(46.01, 7.0, ffi_cfg).expect("second start"),
        "the slot is occupied, so a second start must refuse"
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
    assert_eq!(
        payload["pool"]["activities"].as_u64(),
        Some(4),
        "the whole component's pool feeds the preview"
    );
    assert!(
        !payload["sections"].as_array().expect("sections").is_empty(),
        "the payload names no sections over a pool the real detect cut one from"
    );
    assert!(
        preview.take_result().expect("second take").is_none(),
        "the payload leaves exactly once"
    );
    assert_eq!(preview.poll().expect("poll after take"), "idle");

    assert_eq!(
        db_sha256(&path),
        hash_before,
        "a preview run changed the database file"
    );
    assert_eq!(
        catalogue_snapshot(&path),
        catalogue_before,
        "a preview run changed the catalogue tables"
    );
    for suffix in ["routes.db-wal", "routes.db-journal"] {
        assert!(
            !dir.path().join(suffix).exists(),
            "a preview run left a {suffix} sidecar"
        );
    }

    // The suspension guard released with the worker, so a real detect runs.
    assert!(
        !detection_suspended(),
        "the preview left detection suspended"
    );
    let real = with_persistent_engine(|engine| {
        let handle = engine.detect_sections_background();
        handle.recv().is_some()
    })
    .expect("engine installed");
    assert!(real, "a real detect after the preview refused to run");
}
