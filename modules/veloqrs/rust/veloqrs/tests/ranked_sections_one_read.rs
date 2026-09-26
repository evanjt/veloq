//! Scenario: an athlete with several sports opens Insights. The bundle used to
//! ask for each sport's ranked sections one sport at a time, and each ask
//! walked the same `sections`-`section_activities`-`activity_metrics` join, so
//! the cost grew with the number of sports rather than with the sections.
//!
//! Expected behaviour: one read answers every sport, and the ranking stays
//! per sport. A run's lap and a ride's over the same ground are not comparable
//! efforts, so the batch must produce exactly what asking sport by sport
//! produced, and one sport's traversals must never score another's.
//!
//! Run: `cargo test --test ranked_sections_one_read -p veloqrs`

use rusqlite::{Connection, params};
use std::path::PathBuf;
use tempfile::TempDir;
use veloqrs::{GpsPoint, PersistentEngine};

fn line() -> Vec<GpsPoint> {
    (0..40)
        .map(|i| GpsPoint {
            latitude: 46.2,
            longitude: 7.36 + f64::from(i) * 0.000_11,
            elevation: Some(500.0),
        })
        .collect()
}

fn insert_section(db: &Connection, id: &str, sport: &str) {
    db.execute(
        "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                               distance_meters, disabled, version, source_activity_id)
         VALUES (?1, 'auto', ?1, ?2, ?3, 800.0, 0, 1, NULL)",
        params![
            id,
            sport,
            serde_json::to_string(&line()).expect("encode polyline")
        ],
    )
    .expect("insert section");
}

fn insert_traversal(
    db: &Connection,
    section_id: &str,
    activity_id: &str,
    sport: &str,
    date: i64,
    lap_time: f64,
) {
    db.execute(
        "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng,
                                 start_date, name, distance_meters, duration_secs)
         VALUES (?1, ?2, 46.0, 46.1, 7.0, 7.1, ?3, ?1, 1000.0, 300)",
        params![activity_id, sport, date],
    )
    .expect("insert activity");
    db.execute(
        "INSERT INTO activity_metrics (activity_id, name, date, distance, moving_time,
                                       elapsed_time, elevation_gain, sport_type)
         VALUES (?1, ?1, ?2, 1000.0, 300, 300, 0.0, ?3)",
        params![activity_id, date, sport],
    )
    .expect("insert metrics");
    db.execute(
        "INSERT INTO section_activities (section_id, activity_id, direction, start_index,
                                         end_index, distance_meters, lap_time, lap_pace, excluded)
         VALUES (?1, ?2, 'same', 0, 40, 800.0, ?3, 3.33, 0)",
        params![section_id, activity_id, lap_time],
    )
    .expect("insert traversal");
}

const SPORTS: [&str; 3] = ["Ride", "Run", "Swim"];

/// Three sports, three sections each, six traversals apiece so the improvement
/// signal has both halves to compare.
fn seeded() -> (PersistentEngine, TempDir) {
    let tmp = TempDir::new().expect("temp dir");
    let path: PathBuf = tmp.path().join("test.db");
    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    let db = Connection::open(&path).expect("raw open");

    let now = chrono::Utc::now().timestamp();
    for (s, sport) in SPORTS.iter().enumerate() {
        for n in 0..3 {
            let id = format!("sec_{sport}_{n}");
            insert_section(&db, &id, sport);
            for t in 0..6 {
                insert_traversal(
                    &db,
                    &id,
                    &format!("act_{s}_{n}_{t}"),
                    sport,
                    now - i64::from(t) * 86_400,
                    // A different time per sport and section, so a row that
                    // leaked across sports would move a score.
                    200.0 + (s as f64) * 30.0 + f64::from(n) * 7.0 + f64::from(t),
                );
            }
        }
    }

    (engine, tmp)
}

fn sports() -> Vec<String> {
    SPORTS.iter().map(|s| s.to_string()).collect()
}

#[test]
fn the_batch_answers_what_asking_sport_by_sport_answered() {
    let (engine, _tmp) = seeded();

    let batch = engine.get_ranked_sections_by_sports(&sports(), 10);

    assert_eq!(batch.len(), SPORTS.len());
    for entry in &batch {
        let one = engine.get_ranked_sections(&entry.sport_type, 10);
        let batch_ids: Vec<&str> = entry
            .sections
            .iter()
            .map(|s| s.section_id.as_str())
            .collect();
        let one_ids: Vec<&str> = one.iter().map(|s| s.section_id.as_str()).collect();
        assert_eq!(batch_ids, one_ids, "sport {}", entry.sport_type);
        for (a, b) in entry.sections.iter().zip(one.iter()) {
            assert_eq!(a.relevance_score, b.relevance_score);
            assert_eq!(a.traversal_count, b.traversal_count);
            assert_eq!(a.best_time_secs, b.best_time_secs);
        }
    }
}

#[test]
fn a_sport_holds_only_its_own_sections() {
    let (engine, _tmp) = seeded();

    for entry in engine.get_ranked_sections_by_sports(&sports(), 10) {
        assert!(!entry.sections.is_empty(), "sport {}", entry.sport_type);
        for section in &entry.sections {
            assert!(
                section.section_id.contains(&entry.sport_type),
                "{} ranked under {}",
                section.section_id,
                entry.sport_type
            );
        }
    }
}

#[test]
fn the_answer_is_in_the_order_the_sports_were_asked_for() {
    let (engine, _tmp) = seeded();

    let asked = vec!["Swim".to_string(), "Ride".to_string(), "Run".to_string()];
    let got: Vec<String> = engine
        .get_ranked_sections_by_sports(&asked, 10)
        .into_iter()
        .map(|e| e.sport_type)
        .collect();

    assert_eq!(got, asked);
}

#[test]
fn a_sport_with_no_traversals_is_answered_empty_rather_than_dropped() {
    let (engine, _tmp) = seeded();

    let asked = vec!["Ride".to_string(), "Nordic".to_string()];
    let got = engine.get_ranked_sections_by_sports(&asked, 10);

    assert_eq!(got.len(), 2);
    assert!(!got[0].sections.is_empty());
    assert_eq!(got[1].sport_type, "Nordic");
    assert!(got[1].sections.is_empty());
}

#[test]
fn the_limit_applies_per_sport() {
    let (engine, _tmp) = seeded();

    for entry in engine.get_ranked_sections_by_sports(&sports(), 2) {
        assert_eq!(entry.sections.len(), 2, "sport {}", entry.sport_type);
    }
}

#[test]
fn an_empty_library_answers_every_sport_empty() {
    let tmp = TempDir::new().expect("temp dir");
    let path: PathBuf = tmp.path().join("test.db");
    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");

    let got = engine.get_ranked_sections_by_sports(&sports(), 10);

    assert_eq!(got.len(), SPORTS.len());
    assert!(got.iter().all(|e| e.sections.is_empty()));
}
