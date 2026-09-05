//! One call answers "which sections", with a filter, and the corridor-name
//! overlay is applied once inside it.
//!
//! There were four: `get_all`, `get_filtered`, `get_by_type` and
//! `get_for_activity`, all returning the same record, with the overlay block
//! pasted into the first two and missing from the other two, so the name an
//! athlete gave a corridor showed on the sections list and not on the
//! activity screen.
//!
//! Run: `cargo test --test section_filter_one_call -p veloqrs`

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

/// One auto section over `a1`, one custom section the athlete drew over `a2`,
/// and the auto one named.
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
    with_persistent_engine(|engine| {
        engine
            .set_section_name("s_auto", Some(NAMED))
            .expect("name the corridor");
        // The list reads the cached overlay and never refreshes it under the
        // read lock, so a fresh process shows generated names until something
        // resolves it. That gap is `B290`, not this call's to close.
        assert_eq!(engine.get_named_corridors().len(), 1);
    })
    .expect("engine");
}

fn ids(filter: FfiSectionFilter) -> Vec<String> {
    let mut found: Vec<String> = SectionManager::new()
        .get_sections(filter)
        .expect("get_sections")
        .into_iter()
        .map(|s| s.id)
        .collect();
    found.sort();
    found
}

fn name_of(filter: FfiSectionFilter, id: &str) -> Option<String> {
    SectionManager::new()
        .get_sections(filter)
        .expect("get_sections")
        .into_iter()
        .find(|s| s.id == id)
        .and_then(|s| s.name)
}

#[test]
fn an_empty_filter_returns_every_visible_section() {
    let _g = serial();
    let dir = TempDir::new().unwrap();
    seed(&dir);

    assert_eq!(ids(FfiSectionFilter::default()), ["s_auto", "s_custom"]);
}

#[test]
fn a_sport_narrows_the_list() {
    let _g = serial();
    let dir = TempDir::new().unwrap();
    seed(&dir);

    assert_eq!(
        ids(FfiSectionFilter {
            sport_type: Some("Run".into()),
            ..Default::default()
        }),
        ["s_custom"]
    );
}

#[test]
fn a_visit_floor_narrows_the_list() {
    let _g = serial();
    let dir = TempDir::new().unwrap();
    seed(&dir);

    assert_eq!(
        ids(FfiSectionFilter {
            min_visits: Some(2),
            ..Default::default()
        }),
        ["s_auto"]
    );
}

#[test]
fn a_type_narrows_the_list() {
    let _g = serial();
    let dir = TempDir::new().unwrap();
    seed(&dir);

    assert_eq!(
        ids(FfiSectionFilter {
            section_type: Some("custom".into()),
            ..Default::default()
        }),
        ["s_custom"]
    );
}

#[test]
fn an_activity_narrows_the_list() {
    let _g = serial();
    let dir = TempDir::new().unwrap();
    seed(&dir);

    assert_eq!(
        ids(FfiSectionFilter {
            activity_id: Some("a1".into()),
            ..Default::default()
        }),
        ["s_auto"]
    );
}

#[test]
fn the_corridor_name_shows_under_every_filter() {
    let _g = serial();
    let dir = TempDir::new().unwrap();
    seed(&dir);

    for filter in [
        FfiSectionFilter::default(),
        FfiSectionFilter {
            sport_type: Some("Ride".into()),
            ..Default::default()
        },
        FfiSectionFilter {
            section_type: Some("auto".into()),
            ..Default::default()
        },
        FfiSectionFilter {
            activity_id: Some("a1".into()),
            ..Default::default()
        },
    ] {
        assert_eq!(
            name_of(filter.clone(), "s_auto").as_deref(),
            Some(NAMED),
            "the corridor name is missing under {filter:?}"
        );
    }
}

#[test]
fn a_section_the_athlete_drew_keeps_its_own_name() {
    let _g = serial();
    let dir = TempDir::new().unwrap();
    seed(&dir);

    assert_eq!(
        name_of(FfiSectionFilter::default(), "s_custom").as_deref(),
        Some("Home climb")
    );
}
