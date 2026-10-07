//! Naming a corridor shows on the next sections read.
//!
//! The list reads the cached overlay and does not refresh it under the read
//! lock, which is right: resolution walks the visible catalogue and doing it
//! inline would put a write under every list read. `load` warms the cache, so
//! a launch is correct. Writing a name did not, so the athlete renamed a
//! section, went back to the list, and read the old name until some other
//! screen happened to resolve the overlay.
//!
//! Run: `cargo test --test preview -p veloqrs -- named_corridor_first_read::`

use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::FfiSectionFilter;
use veloqrs::objects::sections::SectionManager;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::with_persistent_engine;

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

fn seed_overlapping_auto_sections(
    dir: &TempDir,
    large_range: std::ops::Range<usize>,
    small_range: std::ops::Range<usize>,
) {
    let path = dir.path().join("overlap.db");
    let points = track();
    let mut engine = veloqrs::PersistentEngine::new(path.to_str().unwrap()).expect("seed engine");
    engine
        .add_activity("a1".into(), points.clone(), "Ride".into())
        .expect("add activity");
    drop(engine);

    let raw = rusqlite::Connection::open(&path).expect("raw open");
    for (id, range, name) in [
        ("s_large", large_range, "Section 1"),
        ("s_small", small_range, "Section 2"),
    ] {
        let line = &points[range];
        raw.execute(
            "INSERT INTO sections
                 (id, section_type, name, sport_type, polyline_json, distance_meters,
                  created_at, bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
             VALUES (?, 'auto', ?, 'Ride', ?, 500.0, '2026-01-01T00:00:00Z', ?, ?, 7.0, 7.0)",
            rusqlite::params![
                id,
                name,
                polyline_json(line),
                line[0].latitude,
                line.last().unwrap().latitude
            ],
        )
        .expect("insert section");
    }
    raw.execute(
        "INSERT INTO section_intents (id, kind, polyline_json, created_at, name, sport_type)
         VALUES ('named_trunk', 'named', ?, '2026-01-01T00:00:00Z', ?, 'Ride')",
        rusqlite::params![polyline_json(&points), NAMED],
    )
    .expect("insert named trunk");
    drop(raw);

    assert!(persistent_engine_init(path.to_str().unwrap().to_string()));
}

fn summary_name(id: &str) -> Option<String> {
    with_persistent_engine(|engine| {
        engine
            .get_section_summaries()
            .into_iter()
            .find(|section| section.id == id)
            .and_then(|section| section.name)
    })
    .expect("engine")
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
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    seed(&dir);

    name_it("s_auto", Some(NAMED));

    assert_eq!(read_name("s_auto").as_deref(), Some(NAMED));
}

#[test]
fn renaming_a_corridor_replaces_the_name_the_list_shows() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    seed(&dir);
    name_it("s_auto", Some(NAMED));

    name_it("s_auto", Some("Col de la Croix"));

    assert_eq!(read_name("s_auto").as_deref(), Some("Col de la Croix"));
}

#[test]
fn removing_a_corridor_updates_the_next_unfiltered_list_read() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    seed(&dir);
    let generated_name = read_name("s_auto");
    name_it("s_auto", Some(NAMED));
    assert_eq!(read_name("s_auto").as_deref(), Some(NAMED));

    with_persistent_engine(|engine| {
        let intent_id = engine.get_named_corridors()[0].intent_id.clone();
        engine
            .remove_named_corridor(&intent_id)
            .expect("remove corridor");
    })
    .expect("engine");

    assert_eq!(read_name("s_auto"), generated_name);
}

#[test]
fn renaming_a_smaller_split_piece_keeps_the_live_trunk_name() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    seed_overlapping_auto_sections(&dir, 0..42, 42..60);
    assert_eq!(summary_name("s_large").as_deref(), Some(NAMED));

    name_it("s_small", Some("Lower climb"));

    assert_eq!(summary_name("s_large").as_deref(), Some(NAMED));
    assert_eq!(summary_name("s_small").as_deref(), Some("Lower climb"));
}

#[test]
fn renaming_a_nested_short_section_keeps_the_long_name() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    seed_overlapping_auto_sections(&dir, 0..60, 15..35);
    assert_eq!(summary_name("s_large").as_deref(), Some(NAMED));

    name_it("s_small", Some("Short climb"));

    assert_eq!(summary_name("s_large").as_deref(), Some(NAMED));
    assert_eq!(summary_name("s_small").as_deref(), Some("Short climb"));
}

#[test]
fn clearing_the_name_returns_the_generated_one() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    seed(&dir);
    name_it("s_auto", Some(NAMED));

    name_it("s_auto", None);

    assert_eq!(read_name("s_auto").as_deref(), Some("Section 1"));
}

#[test]
fn the_name_survives_a_relaunch() {
    let _serial_state = super::serial_state();
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
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    seed(&dir);
    name_it("s_auto", Some(NAMED));

    assert_eq!(read_name("s_custom").as_deref(), Some("Home climb"));
}

fn cached_reader_name(id: &str) -> Option<String> {
    with_persistent_engine(|engine| {
        engine
            .get_sections_by_type(Some(veloqrs::sections::SectionType::Auto))
            .into_iter()
            .find(|section| section.id == id)
            .and_then(|section| section.name)
    })
    .expect("engine")
}

fn dormant_corridors() -> usize {
    with_persistent_engine(|engine| {
        engine
            .get_named_corridors()
            .into_iter()
            .filter(|corridor| corridor.section_id.is_none())
            .count()
    })
    .expect("engine")
}

#[test]
fn removing_a_corridor_updates_the_next_cached_names_read() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    seed(&dir);
    let generated_name = cached_reader_name("s_auto");
    name_it("s_auto", Some(NAMED));
    assert_eq!(cached_reader_name("s_auto").as_deref(), Some(NAMED));

    with_persistent_engine(|engine| {
        let intent_id = engine.get_named_corridors()[0].intent_id.clone();
        engine
            .remove_named_corridor(&intent_id)
            .expect("remove corridor");
    })
    .expect("engine");

    assert_eq!(cached_reader_name("s_auto"), generated_name);
}

#[test]
fn trimming_a_named_corridor_keeps_its_name() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    seed(&dir);
    name_it("s_auto", Some(NAMED));

    with_persistent_engine(|engine| engine.trim_section("s_auto", 2, 35).expect("trim"))
        .expect("engine");

    assert_eq!(summary_name("s_auto").as_deref(), Some(NAMED));
    assert_eq!(read_name("s_auto").as_deref(), Some(NAMED));
    assert_eq!(dormant_corridors(), 0);
}

#[test]
fn resetting_a_trimmed_named_corridor_hands_the_name_back_to_an_intent() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    seed(&dir);
    name_it("s_auto", Some(NAMED));

    with_persistent_engine(|engine| {
        engine.trim_section("s_auto", 2, 35).expect("trim");
        engine.reset_section_bounds("s_auto").expect("reset");
    })
    .expect("engine");

    assert_eq!(read_name("s_auto").as_deref(), Some(NAMED));
    let resolved: Vec<_> = with_persistent_engine(|engine| {
        engine
            .get_named_corridors()
            .into_iter()
            .filter(|c| c.name == NAMED)
            .map(|c| c.section_id)
            .collect()
    })
    .expect("engine");
    assert_eq!(
        resolved,
        vec![Some("s_auto".to_string())],
        "the name lives in one named intent resolving to the section, which a re-detect keeps"
    );
}

#[test]
fn expanding_a_named_corridor_keeps_its_name() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    seed(&dir);
    name_it("s_auto", Some(NAMED));

    with_persistent_engine(|engine| {
        engine
            .expand_section_bounds("s_auto", "a1", 0, 50)
            .expect("expand")
    })
    .expect("engine");

    assert_eq!(summary_name("s_auto").as_deref(), Some(NAMED));
    assert_eq!(read_name("s_auto").as_deref(), Some(NAMED));
    assert_eq!(dormant_corridors(), 0);
}

fn try_name(section_id: &str, name: &str) -> Result<(), String> {
    with_persistent_engine(|engine| engine.set_section_name(section_id, Some(name)))
        .expect("engine")
        .map_err(|e| e.to_string())
}

#[test]
fn a_rename_to_the_name_a_drawn_section_holds_is_refused() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    seed(&dir);

    assert!(try_name("s_auto", "Home climb").is_err());

    assert_eq!(read_name("s_auto").as_deref(), Some("Section 1"));
    assert_eq!(read_name("s_custom").as_deref(), Some("Home climb"));
}

#[test]
fn a_rename_to_a_corridor_name_another_section_shows_is_refused() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    seed(&dir);
    name_it("s_auto", Some(NAMED));

    assert!(try_name("s_custom", NAMED).is_err());

    assert_eq!(read_name("s_custom").as_deref(), Some("Home climb"));
    assert_eq!(read_name("s_auto").as_deref(), Some(NAMED));
}

#[test]
fn a_rename_to_a_free_name_or_its_own_name_is_accepted() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    seed(&dir);
    name_it("s_auto", Some(NAMED));

    assert_eq!(try_name("s_custom", "Col de la Croix"), Ok(()));
    assert_eq!(try_name("s_auto", NAMED), Ok(()));
    assert_eq!(try_name("s_custom", "Col de la Croix"), Ok(()));

    assert_eq!(read_name("s_custom").as_deref(), Some("Col de la Croix"));
    assert_eq!(read_name("s_auto").as_deref(), Some(NAMED));
}

#[test]
fn a_name_freed_by_a_rename_can_be_taken() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    seed(&dir);
    name_it("s_custom", Some("Lower road"));

    assert_eq!(try_name("s_auto", "Home climb"), Ok(()));

    assert_eq!(read_name("s_auto").as_deref(), Some("Home climb"));
}

#[test]
fn the_activity_encounters_carry_the_corridor_name() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    seed(&dir);
    name_it("s_auto", Some(NAMED));

    let (locked, detail) = with_persistent_engine(|engine| {
        (
            engine.get_activity_section_encounters("a1"),
            engine.activity_detail_data("a1", 2),
        )
    })
    .expect("engine");

    let name_of = |encounters: &[veloqrs::FfiSectionEncounter]| {
        encounters
            .iter()
            .find(|e| e.section_id == "s_auto")
            .map(|e| e.section_name.clone())
    };
    assert_eq!(name_of(&locked).as_deref(), Some(NAMED));
    assert_eq!(name_of(&detail.encounters).as_deref(), Some(NAMED));
}

#[test]
fn a_scan_match_carries_the_corridor_name() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    seed(&dir);
    name_it("s_auto", Some(NAMED));

    let matches =
        with_persistent_engine(|engine| engine.match_activity_to_sections("a1")).expect("engine");

    let named = matches.iter().find(|m| m.section_id == "s_auto");
    assert_eq!(
        named.and_then(|m| m.section_name.clone()).as_deref(),
        Some(NAMED)
    );
}
