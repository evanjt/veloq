//! Scenario: an athlete with more sections in one sport than the stale-PR path
//! used to consider, where the section worth resurfacing is the one they have
//! not ridden for a year.
//!
//! Expected behaviour: relevance ranking must not decide which sections are
//! eligible for a stale-PR suggestion. Ranking weights recent traversals, and
//! staleness selects for the opposite, so any truncation of the ranked list
//! removes precisely the candidates the feature exists to find.
//!
//! Run: `cargo test --test stale_pr_candidates -p veloqrs`

use rusqlite::{Connection, params};
use std::path::PathBuf;
use tempfile::TempDir;
use veloqrs::{GpsPoint, PersistentEngine};

const SPORT: &str = "Ride";
const POPULATION: usize = 120;
const NEGLECTED: &str = "sec_neglected";

fn line() -> Vec<GpsPoint> {
    (0..40)
        .map(|i| GpsPoint {
            latitude: 46.2,
            longitude: 7.36 + f64::from(i) * 0.000_11,
            elevation: Some(500.0),
        })
        .collect()
}

fn insert_section(db: &Connection, id: &str) {
    db.execute(
        "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                               distance_meters, disabled, version, source_activity_id)
         VALUES (?1, 'auto', ?1, ?2, ?3, 800.0, 0, 1, NULL)",
        params![
            id,
            SPORT,
            serde_json::to_string(&line()).expect("encode polyline")
        ],
    )
    .expect("insert section");
}

fn insert_traversal(db: &Connection, section_id: &str, activity_id: &str, date: i64) {
    db.execute(
        "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng,
                                 start_date, name, distance_meters, duration_secs)
         VALUES (?1, ?2, 46.0, 46.1, 7.0, 7.1, ?3, ?1, 1000.0, 300)",
        params![activity_id, SPORT, date],
    )
    .expect("insert activity");
    db.execute(
        "INSERT INTO activity_metrics (activity_id, name, date, distance, moving_time,
                                       elapsed_time, elevation_gain, sport_type)
         VALUES (?1, ?1, ?2, 1000.0, 300, 300, 0.0, ?3)",
        params![activity_id, date, SPORT],
    )
    .expect("insert metrics");
    db.execute(
        "INSERT INTO section_activities (section_id, activity_id, direction, start_index,
                                         end_index, distance_meters, lap_time, lap_pace, excluded)
         VALUES (?1, ?2, 'same', 0, 40, 800.0, 240.0, 3.33, 0)",
        params![section_id, activity_id],
    )
    .expect("insert traversal");
}

/// `POPULATION` sections ridden in the last few days, plus one ridden three
/// times and then abandoned a year ago. The neglected one ranks last: recency
/// carries the largest single weight in the relevance score.
fn seeded() -> (PersistentEngine, TempDir) {
    let tmp = TempDir::new().expect("temp dir");
    let path: PathBuf = tmp.path().join("test.db");
    let engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    let db = Connection::open(&path).expect("raw open");

    let now = chrono::Utc::now().timestamp();
    for s in 0..POPULATION {
        let id = format!("sec_{s:03}");
        insert_section(&db, &id);
        for t in 0..3 {
            insert_traversal(
                &db,
                &id,
                &format!("act_{s:03}_{t}"),
                now - i64::from(t) * 86_400,
            );
        }
    }

    insert_section(&db, NEGLECTED);
    for t in 0..3 {
        insert_traversal(
            &db,
            NEGLECTED,
            &format!("act_neglected_{t}"),
            now - 365 * 86_400 - i64::from(t) * 86_400,
        );
    }

    (engine, tmp)
}

fn ids(engine: &PersistentEngine, limit: u32) -> Vec<String> {
    engine
        .get_ranked_sections(SPORT, limit)
        .into_iter()
        .map(|s| s.section_id)
        .collect()
}

#[test]
fn truncating_the_ranking_drops_the_stale_candidate() {
    let (engine, _tmp) = seeded();

    let capped = ids(&engine, 100);
    assert_eq!(capped.len(), 100, "fixture should exceed the old cap");
    assert!(
        !capped.contains(&NEGLECTED.to_string()),
        "the year-old section ranked inside the top 100, so this fixture no \
         longer demonstrates the truncation it exists to pin"
    );
}

#[test]
fn the_uncapped_ranking_keeps_it() {
    let (engine, _tmp) = seeded();

    let all = ids(&engine, u32::MAX);
    assert_eq!(all.len(), POPULATION + 1);
    assert!(
        all.contains(&NEGLECTED.to_string()),
        "the stale-PR path reads the uncapped ranking, so the neglected \
         section must be present for it to be considered"
    );
}

#[test]
fn the_stale_candidate_carries_the_age_the_gate_needs() {
    let (engine, _tmp) = seeded();

    let neglected = engine
        .get_ranked_sections(SPORT, u32::MAX)
        .into_iter()
        .find(|s| s.section_id == NEGLECTED)
        .expect("neglected section ranked");

    assert!(
        neglected.days_since_last >= 365,
        "reported {} days since last traversal",
        neglected.days_since_last
    );
    assert_eq!(neglected.traversal_count, 3);
}

/// The stale-PR path took the whole ranked list for every sport and kept the few
/// stale ones. Asking the query for the stale ones returns the same candidate
/// without walking the other hundred and twenty.
#[test]
fn the_stale_query_returns_only_the_stale_section() {
    let (engine, _tmp) = seeded();

    let stale: Vec<String> = engine
        .get_stale_ranked_sections(SPORT, 30)
        .into_iter()
        .map(|s| s.section_id)
        .collect();

    assert_eq!(
        stale,
        vec![NEGLECTED.to_string()],
        "only the year-old section is stale at a thirty day threshold"
    );
}

/// The bound is on each section's newest traversal, not on the rows, because the
/// best time and the improvement signal are computed over every traversal a
/// section has. A row-level date filter would silently change the times.
#[test]
fn the_stale_section_keeps_every_one_of_its_traversals() {
    let (engine, _tmp) = seeded();

    let stale = engine.get_stale_ranked_sections(SPORT, 30);
    let neglected = stale
        .iter()
        .find(|s| s.section_id == NEGLECTED)
        .expect("the neglected section is the stale one");

    let uncapped = engine.get_ranked_sections(SPORT, u32::MAX);
    let same = uncapped
        .iter()
        .find(|s| s.section_id == NEGLECTED)
        .expect("and it is in the full ranking too");

    assert_eq!(neglected.traversal_count, 3, "all three traversals counted");
    assert_eq!(neglected.traversal_count, same.traversal_count);
    assert!((neglected.best_time_secs - same.best_time_secs).abs() < 1e-9);
    assert_eq!(neglected.days_since_last, same.days_since_last);
}

#[test]
fn a_threshold_nothing_meets_returns_nothing() {
    let (engine, _tmp) = seeded();

    assert!(
        engine.get_stale_ranked_sections(SPORT, 1000).is_empty(),
        "no section has been idle for a thousand days"
    );
}

/// A threshold of zero is every section, which is the whole ranked list. This
/// pins that the narrowing is a filter and not a different query.
#[test]
fn a_zero_threshold_is_every_section() {
    let (engine, _tmp) = seeded();

    assert_eq!(
        engine.get_stale_ranked_sections(SPORT, 0).len(),
        engine.get_ranked_sections(SPORT, u32::MAX).len()
    );
}

#[test]
fn the_stale_query_answers_nothing_for_a_sport_with_no_sections() {
    let (engine, _tmp) = seeded();

    assert!(engine.get_stale_ranked_sections("Swim", 30).is_empty());
}
