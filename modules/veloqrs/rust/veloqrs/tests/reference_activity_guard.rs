//! A section's geometry is a reference into one activity's stored stream,
//! so that activity is not the user's to delete and not retention's to
//! prune. The refusal is typed, because the UI names the sections.
//!
//! Run: `cargo test --test reference_activity_guard -p veloqrs`

use std::path::Path;
use std::sync::{Mutex, MutexGuard};
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::VeloqError;
use veloqrs::objects::activities::ActivityManager;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::with_persistent_engine;
use veloqrs::sections::CreateSectionParams;

static SERIAL: Mutex<()> = Mutex::new(());
fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

fn track() -> Vec<GpsPoint> {
    (0..120)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0001,
            longitude: 7.0,
            elevation: None,
        })
        .collect()
}

/// One custom section cut from `rep`, and one plain activity beside it.
/// Both activities are older than any retention window under test.
fn seed(path: &Path) -> String {
    assert!(persistent_engine_init(path.to_str().unwrap().to_string()));
    let section_id = with_persistent_engine(|engine| {
        for id in ["rep", "plain"] {
            engine
                .add_activity(id.to_string(), track(), "Ride".into())
                .expect("add activity");
            engine
                .update_activity_metadata(id, Some(1_600_000_000), None, None, None)
                .expect("metadata");
        }
        engine
            .create_section(CreateSectionParams {
                sport_type: "Ride".into(),
                polyline: track(),
                distance_meters: 1000.0,
                name: Some("Ref".into()),
                source_activity_id: Some("rep".into()),
                start_index: Some(0),
                end_index: Some(119),
            })
            .expect("custom section")
    })
    .expect("engine");

    let db = rusqlite::Connection::open(path).expect("raw open");
    db.execute(
        "UPDATE activities SET created_at = strftime('%s', 'now') - 90 * 86400",
        [],
    )
    .expect("age both activities");
    section_id
}

#[test]
fn a_reference_activity_refuses_deletion() {
    let _g = serial();
    let dir = TempDir::new().unwrap();
    let section_id = seed(&dir.path().join("guard.db"));

    let manager = ActivityManager::new();
    match manager.remove("rep".to_string()) {
        Err(VeloqError::ReferenceActivity { msg }) => assert!(
            msg.contains(&section_id),
            "the refusal must name the section, got {msg}"
        ),
        other => panic!("a reference activity was not refused: {other:?}"),
    }
    assert!(
        manager.remove("plain".to_string()).is_ok(),
        "a plain activity must still delete"
    );
}

#[test]
fn the_prune_keeps_reference_activities() {
    let _g = serial();
    let dir = TempDir::new().unwrap();
    let section_id = seed(&dir.path().join("prune.db"));

    let deleted = with_persistent_engine(|engine| engine.cleanup_old_activities(30))
        .expect("engine")
        .expect("cleanup");

    assert_eq!(
        deleted, 1,
        "retention must take the plain activity and leave the reference"
    );
    let referencing =
        with_persistent_engine(|engine| engine.sections_referencing_activity("rep")).expect("engine");
    assert_eq!(referencing, vec![section_id]);
}
