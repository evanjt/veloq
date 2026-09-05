//! Naming a corridor shows on the next sections read.
//!
//! The list reads the cached overlay and does not refresh it under the read
//! lock, which is right: resolution walks the visible catalogue and doing it
//! inline would put a write under every list read. `load` warms the cache, so
//! a launch is correct. Writing a name did not, so the athlete renamed a
//! section, went back to the list, and read the old name until some other
//! screen happened to resolve the overlay.
//!
//! Run: `cargo test --test named_corridor_first_read -p veloqrs`

use std::sync::{Mutex, MutexGuard};

use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::FfiSectionFilter;
use veloqrs::objects::sections::SectionManager;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::with_persistent_engine;

static SERIAL: Mutex<()> = Mutex::new(());
fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

const NAMED: &str = "Col des Planches";

fn track() -> Vec<GpsPoint> {
    (0..60)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0001,
            longitude: 7.0,
            elevation: None,
        })
        .collect()
}

/// The section's own ground, in the shape `polyline_json` is read as.
fn polyline_json(points: &[GpsPoint]) -> String {
    let values: Vec<serde_json::Value> = points
        .iter()
        .map(|p| {
            serde_json::json!({
                "latitude": p.latitude,
                "longitude": p.longitude,
                "elevation": p.elevation,
            })
        })
        .collect();
    serde_json::to_string(&values).expect("encode the line")
}

fn seed(dir: &TempDir) {
    let path = dir.path().join("filter.db");
    let auto_line = polyline_json(&track()[0..40]);
    let auto_blob = veloqrs::persistence::codec::serialize_track_points(&track()[0..40]);
    let custom_line = polyline_json(&track()[0..20]);

    // The activities first, through an engine of its own, then the sections
    // straight into the file. The global engine loads the catalogue at init,
    // so the rows have to be there before it opens.
    {
        let mut engine =
            veloqrs::PersistentEngine::new(path.to_str().unwrap()).expect("seed engine");
        for id in ["a1", "a2"] {
            engine
                .add_activity(id.to_string(), track(), "Ride".into())
                .expect("add activity");
        }
    }

    let raw = rusqlite::Connection::open(&path).expect("raw open");
    raw.execute(
        "INSERT INTO sections
             (id, section_type, name, sport_type, polyline_json, polyline_blob,
              distance_meters, representative_activity_id, created_at, is_user_defined,
              visit_count, bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
         VALUES ('s_auto', 'auto', NULL, 'Ride', ?, ?, 900.0, 'a1',
                 '2026-01-01T00:00:00Z', 0, 2, 46.0, 46.1, 7.0, 7.1)",
        rusqlite::params![auto_line, auto_blob],
    )
    .expect("insert the auto section");
    raw.execute(
        "INSERT INTO sections
             (id, section_type, name, sport_type, polyline_json, distance_meters,
              representative_activity_id, created_at, is_user_defined, visit_count,
              bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
         VALUES ('s_custom', 'custom', 'Home climb', 'Run', ?, 400.0, 'a2',
                 '2026-01-01T00:00:00Z', 1, 1, 46.0, 46.1, 7.0, 7.1)",
        rusqlite::params![custom_line],
    )
    .expect("insert the custom section");
    raw.execute(
        "INSERT INTO section_activities (section_id, activity_id, start_index, end_index)
         VALUES ('s_auto', 'a1', 0, 30), ('s_auto', 'a2', 0, 30), ('s_custom', 'a2', 0, 20)",
        [],
    )
    .expect("insert the members");
    drop(raw);

    assert!(persistent_engine_init(path.to_str().unwrap().to_string()));
}

fn read_name(id: &str) -> Option<String> {
    SectionManager::new()
        .get_sections(FfiSectionFilter::default())
        .expect("get_sections")
        .into_iter()
        .find(|s| s.id == id)
        .and_then(|s| s.name)
}

fn name_it(section_id: &str, name: Option<&str>) {
    with_persistent_engine(|engine| {
        engine
            .set_section_name(section_id, name)
            .expect("set the name")
    })
    .expect("engine");
}

#[test]
fn a_corridor_named_now_reads_back_now() {
    let _g = serial();
    let dir = TempDir::new().unwrap();
    seed(&dir);

    name_it("s_auto", Some(NAMED));

    assert_eq!(read_name("s_auto").as_deref(), Some(NAMED));
}

#[test]
fn renaming_a_corridor_replaces_the_name_the_list_shows() {
    let _g = serial();
    let dir = TempDir::new().unwrap();
    seed(&dir);
    name_it("s_auto", Some(NAMED));

    name_it("s_auto", Some("Col de la Croix"));

    assert_eq!(read_name("s_auto").as_deref(), Some("Col de la Croix"));
}

#[test]
fn clearing_the_name_returns_the_generated_one() {
    let _g = serial();
    let dir = TempDir::new().unwrap();
    seed(&dir);
    name_it("s_auto", Some(NAMED));

    name_it("s_auto", None);

    assert_eq!(read_name("s_auto").as_deref(), Some("Section 1"));
}

#[test]
fn the_name_survives_a_relaunch() {
    let _g = serial();
    let dir = TempDir::new().unwrap();
    seed(&dir);
    name_it("s_auto", Some(NAMED));

    assert!(persistent_engine_init(
        dir.path().join("filter.db").to_str().unwrap().to_string()
    ));

    assert_eq!(read_name("s_auto").as_deref(), Some(NAMED));
}

#[test]
fn a_section_the_athlete_drew_keeps_its_own_name() {
    let _g = serial();
    let dir = TempDir::new().unwrap();
    seed(&dir);
    name_it("s_auto", Some(NAMED));

    assert_eq!(read_name("s_custom").as_deref(), Some("Home climb"));
}
