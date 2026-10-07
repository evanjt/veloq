//! The section display names and the efficiency trend answer from committed
//! rows, so a detection apply holding the engine does not hold them.

use super::*;
use crate::test_globals::{init_global_engine, read_while_writer_holds, serial_global_state};

fn seed_section(id: &str, section_type: &str, name: Option<&str>, user_defined: bool) {
    crate::with_persistent_engine(|engine| {
        engine
            .db
            .execute(
                "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                                       distance_meters, disabled, version, is_user_defined)
                 VALUES (?1, ?2, ?3, 'Ride', '[]', 1000.0, 0, 1, ?4)",
                rusqlite::params![id, section_type, name, user_defined],
            )
            .expect("section");
    })
    .expect("engine");
}

fn seed_lap(section_id: &str, n: i64, lap_time: f64, avg_hr: f64) {
    let id = format!("{section_id}_lap{n}");
    let date = 1_700_000_000 - n * 86_400;
    crate::with_persistent_engine(|engine| {
        engine
            .db
            .execute(
                "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng,
                                         start_date, name, distance_meters, duration_secs)
                 VALUES (?1, 'Ride', 46.0, 46.1, 7.0, 7.1, ?2, ?1, 1000.0, 300)",
                rusqlite::params![id, date],
            )
            .expect("activity");
        engine
            .db
            .execute(
                "INSERT INTO activity_metrics (activity_id, name, date, distance,
                                               moving_time, elapsed_time, elevation_gain,
                                               sport_type)
                 VALUES (?1, ?1, ?2, 1000.0, 300, 300, 0.0, 'Ride')",
                rusqlite::params![id, date],
            )
            .expect("metrics");
        engine
            .db
            .execute(
                "INSERT INTO section_activities (section_id, activity_id, direction,
                                                 start_index, end_index, distance_meters,
                                                 lap_time, lap_pace, excluded, avg_hr)
                 VALUES (?1, ?2, 'same', 0, 40, 1000.0, ?3, 3.0, 0, ?4)",
                rusqlite::params![section_id, id, lap_time, avg_hr],
            )
            .expect("traversal");
    })
    .expect("engine");
}

#[test]
fn test_get_all_names_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("section_names_under_writer.db");
    let sections = SectionManager::new();
    assert!(read_while_writer_holds(|| sections.get_all_names().unwrap()).is_empty());
}

#[test]
fn test_get_efficiency_trend_writer_held() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("section_trend_under_writer.db");
    let sections = SectionManager::new();
    assert!(
        read_while_writer_holds(|| sections
            .get_efficiency_trend("absent".into(), "Ride".into())
            .unwrap())
        .is_none()
    );
}

#[test]
fn test_pooled_names_keep_the_precedence_and_the_numbered_label() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("section_names_pooled.db");
    seed_section("mine", "custom", Some("Mine"), true);
    seed_section("auto_named", "auto", Some("Stored"), false);
    seed_section("auto_bare", "auto", None, false);

    let names = SectionManager::new().get_all_names().unwrap();
    assert_eq!(names.get("mine").map(String::as_str), Some("Mine"));
    assert_eq!(names.get("auto_named").map(String::as_str), Some("Stored"));
    assert!(
        names.get("auto_bare").is_some_and(|n| !n.is_empty()),
        "an unnamed section is shown under its number"
    );
    assert_eq!(names.len(), 3);
}

#[test]
fn test_pooled_trend_needs_three_paced_heart_rate_laps() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("section_trend_pooled.db");
    seed_section("three", "auto", Some("Three laps"), false);
    seed_section("two", "auto", Some("Two laps"), false);
    for (n, (lap, hr)) in [(300.0, 150.0), (290.0, 148.0), (280.0, 146.0)]
        .into_iter()
        .enumerate()
    {
        seed_lap("three", n as i64, lap, hr);
    }
    for (n, (lap, hr)) in [(300.0, 150.0), (290.0, 148.0)].into_iter().enumerate() {
        seed_lap("two", n as i64, lap, hr);
    }

    let sections = SectionManager::new();
    let trend = sections
        .get_efficiency_trend("three".into(), "Ride".into())
        .unwrap()
        .expect("three laps make a trend");
    assert_eq!(trend.section_name, "Three laps");
    assert!(
        sections
            .get_efficiency_trend("two".into(), "Ride".into())
            .unwrap()
            .is_none()
    );
}
