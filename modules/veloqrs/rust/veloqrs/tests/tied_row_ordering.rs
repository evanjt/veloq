//! Rows tied on their sort key must come out in the same order on every
//! read. Without a total order the pick follows SQLite's scan order, so
//! the same database answers the same question two ways.
//!
//! Run: `cargo test --test tied_row_ordering -p veloqrs`

use rusqlite::{Connection, params};
use tempfile::TempDir;
use veloqrs::PersistentRouteEngine;

struct Setup {
    engine: PersistentRouteEngine,
    raw: Connection,
    _tmp: TempDir,
}

fn setup(name: &str) -> Setup {
    let tmp = TempDir::new().expect("temp dir");
    let path = tmp.path().join(name);
    let engine = PersistentRouteEngine::new(path.to_str().unwrap()).expect("engine");
    let raw = Connection::open(&path).expect("raw open");
    Setup {
        engine,
        raw,
        _tmp: tmp,
    }
}

/// Two sections on identical ground, inserted in reverse id order so a
/// scan-order pick would surface the later id first.
fn insert_twin_sections(db: &Connection) {
    for id in ["sec_b", "sec_a"] {
        db.execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                                   distance_meters, disabled, version, visit_count,
                                   bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
                                   created_at, updated_at)
             VALUES (?1, 'auto', ?1, 'Run', '[]', 500.0, 0, 1, 3,
                     46.0, 46.01, 7.0, 7.01, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            params![id],
        )
        .expect("insert section");
    }
}

#[test]
fn merge_candidates_tied_on_overlap_come_back_in_id_order() {
    let s = setup("merge.db");
    insert_twin_sections(&s.raw);
    s.raw
        .execute(
            "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                                   distance_meters, disabled, version, visit_count,
                                   bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
                                   created_at, updated_at)
             VALUES ('query', 'auto', 'query', 'Run', '[]', 500.0, 0, 1, 3,
                     46.0, 46.01, 7.0, 7.01, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .expect("insert query section");

    let first: Vec<String> = s
        .engine
        .get_merge_candidates("query")
        .into_iter()
        .map(|c| c.section_id)
        .collect();
    for _ in 0..10 {
        let again: Vec<String> = s
            .engine
            .get_merge_candidates("query")
            .into_iter()
            .map(|c| c.section_id)
            .collect();
        assert_eq!(again, first, "the candidate order changed between reads");
    }
    let mut sorted = first.clone();
    sorted.sort();
    assert_eq!(first, sorted, "tied candidates must come out in id order");
}

#[test]
fn preview_centres_are_the_same_on_every_read() {
    let s = setup("preview.db");
    insert_twin_sections(&s.raw);

    let first = s.engine.preview_centres(10);
    for _ in 0..10 {
        let again = s.engine.preview_centres(10);
        assert_eq!(
            again.len(),
            first.len(),
            "the centre count changed between reads"
        );
        for (a, b) in again.iter().zip(first.iter()) {
            assert_eq!(
                (a.bin_key.clone(), a.lat, a.lng, a.section_count),
                (b.bin_key.clone(), b.lat, b.lng, b.section_count)
            );
        }
    }
}
