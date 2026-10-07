use super::*;
use crate::test_globals::{
    init_global_engine, read_while_writer_holds, returns_while_locked, serial_global_state,
    wait_out_any_lock,
};

const BODY: &str = r#"{"id":"a1","name":"Ride"}"#;
const STREAM_BODY: &str = r#"[{"type":"time","data":[0.0,1.0]}]"#;

fn seed_body() {
    ActivityManager::new()
        .upsert_activity_bodies(vec![crate::FfiActivityBody {
            activity_id: "a1".into(),
            date: 50.0,
            raw: BODY.into(),
        }])
        .unwrap();
}

fn window(oldest_ts: i64, newest_ts: i64) -> crate::FfiActivityBodiesPage {
    ActivityManager::new()
        .get_activity_bodies(crate::FfiActivityBodiesQuery {
            oldest_ts: Some(oldest_ts as f64),
            newest_ts: Some(newest_ts as f64),
            needle: String::new(),
            sport_groups: vec![],
            offset: 0,
            limit: None,
        })
        .unwrap()
}

fn seed_stream(stale: bool) {
    crate::with_persistent_engine(|engine| {
        engine.set_stream_body("a1", "time", STREAM_BODY).unwrap();
        if stale {
            engine
                .db
                .execute(
                    "UPDATE stream_bodies SET updated_at = 1 WHERE activity_id = 'a1'",
                    [],
                )
                .unwrap();
        }
    });
}

#[test]
fn test_feed_bodies_return_while_engine_writer_holds() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("feed_reads_under_writer.db");
    seed_body();
    read_while_writer_holds(|| {
        assert_eq!(window(0, 50).bodies, vec![BODY]);
        assert!(window(51, 100).bodies.is_empty());
    });
}

#[test]
fn test_feed_highlights_return_while_engine_writer_holds() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("feed_highlights_under_writer.db");
    let expected = crate::with_persistent_engine(|engine| {
        engine
            .db
            .execute(
                "INSERT INTO activity_indicators
             (activity_id, indicator_type, target_id, target_name, computed_at)
             VALUES ('a1', 'section_pr', 's1', 'Hill', 50)",
                [],
            )
            .unwrap();
        crate::FfiActivityHighlightsBundle {
            indicators: engine.get_activity_indicators(&["a1".into()]),
            route_highlights: engine.get_activity_route_highlights(&["a1".into()]),
        }
    })
    .unwrap();
    assert_eq!(expected.indicators.len(), 1);

    read_while_writer_holds(move || {
        let bundle = ActivityManager::new()
            .get_highlights_bundle(vec!["a1".into()])
            .unwrap();
        assert_eq!(format!("{bundle:?}"), format!("{expected:?}"));
    });
}

#[test]
fn test_detail_body_returns_while_engine_writer_holds() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("detail_body_under_writer.db");
    seed_body();
    read_while_writer_holds(|| {
        let manager = ActivityManager::new();
        assert_eq!(
            manager.get_activity_body("a1".into()).unwrap().as_deref(),
            Some(BODY)
        );
        assert!(
            manager
                .get_activity_body("missing".into())
                .unwrap()
                .is_none()
        );
    });
}

#[test]
fn test_detail_stream_returns_while_engine_writer_holds() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("detail_stream_under_writer.db");
    seed_stream(false);
    read_while_writer_holds(|| {
        let manager = ActivityManager::new();
        assert_eq!(
            manager
                .get_stream_body("a1".into(), "time".into())
                .unwrap()
                .as_deref(),
            Some(STREAM_BODY)
        );
        assert!(
            manager
                .get_stream_body("missing".into(), "time".into())
                .unwrap()
                .is_none()
        );
    });
}

#[test]
fn test_detail_track_returns_while_engine_writer_holds() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("detail_track_under_writer.db");
    ActivityManager::new()
        .add(
            vec!["a1".into()],
            vec![46.0, 7.0, 46.1, 7.1],
            vec![0],
            vec!["Ride".into()],
        )
        .unwrap();
    let expected_track = crate::with_persistent_engine(|engine| {
        crate::persistence::codec::encode_polyline(&engine.get_gps_track("a1").unwrap())
    })
    .unwrap();
    read_while_writer_holds(move || {
        let manager = ActivityManager::new();
        assert_eq!(manager.get_gps_track("a1".into()).unwrap(), expected_track);
        assert_eq!(
            manager.get_gps_track("missing".into()).unwrap(),
            crate::persistence::codec::encode_polyline(&[])
        );
    });
}

/// Scenario: a stored track is read for the bridge.
///
/// Expected behaviour: the bytes that cross are the stream the store holds,
/// less its frame, rather than the track decoded and written again in a second
/// codec at a precision the store never had.
#[test]
fn test_stored_track_crosses_in_the_stored_stream() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("track_crosses_as_stored.db");
    ActivityManager::new()
        .add(
            vec!["a1".into()],
            vec![
                45.123456, 8.654321, 45.123565, 8.654426, 45.123679, 8.654535,
            ],
            vec![0],
            vec!["Ride".into()],
        )
        .unwrap();
    let stored: Vec<u8> = crate::with_persistent_engine(|engine| {
        engine
            .db
            .query_row(
                "SELECT track_data FROM gps_tracks WHERE activity_id = 'a1'",
                [],
                |row| row.get(0),
            )
            .unwrap()
    })
    .unwrap();
    assert_eq!(
        ActivityManager::new().get_gps_track("a1".into()).unwrap(),
        stored[5..]
    );
}

#[test]
fn test_stale_stream_body_returns_while_engine_writer_holds() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("stale_stream_under_writer.db");
    seed_stream(true);
    read_while_writer_holds(|| {
        let body = ActivityManager::new()
            .get_stream_body("a1".into(), "time".into())
            .unwrap();
        assert_eq!(body.as_deref(), Some(STREAM_BODY));
    });
}

#[test]
fn test_busy_stream_touch_returns_cached_body() {
    let _serial = serial_global_state();
    let dir = init_global_engine("busy_stream_touch.db");
    seed_stream(true);
    let db = rusqlite::Connection::open(dir.path().join("busy_stream_touch.db")).unwrap();
    db.execute_batch("BEGIN IMMEDIATE").unwrap();
    wait_out_any_lock();
    let prompt = returns_while_locked("a stale stream read under a held write lock", || {
        ActivityManager::new().get_stream_body("a1".into(), "time".into())
    });
    db.execute_batch("ROLLBACK").unwrap();
    assert_eq!(prompt.unwrap().as_deref(), Some(STREAM_BODY));
    assert_eq!(
        ActivityManager::new()
            .get_stream_body("a1".into(), "time".into())
            .unwrap()
            .as_deref(),
        Some(STREAM_BODY)
    );
    crate::with_persistent_engine(|engine| {
        let stamp: i64 = engine
            .db
            .query_row(
                "SELECT updated_at FROM stream_bodies WHERE activity_id = 'a1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let timeout: i64 = engine
            .db
            .query_row("PRAGMA busy_timeout", [], |row| row.get(0))
            .unwrap();
        assert!(stamp > 1);
        assert_eq!(timeout, 5000);
    });
}

const DAY: f64 = 86_400.0;
/// A fixed "now", so the library's shape does not move with the clock.
const NOW: f64 = 1_900_000_000.0;

fn library_body(id: &str, name: &str, sport: &str) -> String {
    format!(r#"{{"id":"{id}","name":"{name}","type":"{sport}"}}"#)
}

/// A recent month of runs, then two years of nothing the feed would page in
/// before its window cap, then the old activities the search has to reach.
fn seed_library() {
    let mut rows: Vec<crate::FfiActivityBody> = (0..30)
        .map(|day| crate::FfiActivityBody {
            activity_id: format!("run{day}"),
            date: NOW - day as f64 * DAY,
            raw: library_body(&format!("run{day}"), "Harbour loop", "Run"),
        })
        .collect();
    for (id, days_ago, name, sport) in [
        ("old-ride", 800.0, "Lantern Valley Classic", "Ride"),
        ("old-swim", 700.0, "Reservoir crossing", "OpenWaterSwim"),
        ("old-walk", 650.0, "Église stroll", "Walk"),
        ("club-a", 400.0, "Tuesday club spin", "VirtualRide"),
        ("club-b", 500.0, "Tuesday club spin", "GravelRide"),
        ("club-c", 600.0, "Tuesday club spin", "Ride"),
    ] {
        rows.push(crate::FfiActivityBody {
            activity_id: id.into(),
            date: NOW - days_ago * DAY,
            raw: library_body(id, name, sport),
        });
    }
    ActivityManager::new().upsert_activity_bodies(rows).unwrap();
}

fn search(
    needle: &str,
    sport_group: Option<crate::FfiFeedGroup>,
    offset: u32,
    limit: u32,
) -> crate::FfiActivityBodiesPage {
    ActivityManager::new()
        .get_activity_bodies(crate::FfiActivityBodiesQuery {
            oldest_ts: None,
            newest_ts: None,
            needle: needle.into(),
            sport_groups: sport_group.into_iter().collect(),
            offset,
            limit: Some(limit),
        })
        .unwrap()
}

fn ids(page: &crate::FfiActivityBodiesPage) -> Vec<String> {
    page.bodies
        .iter()
        .map(|raw| {
            serde_json::from_str::<serde_json::Value>(raw).unwrap()["id"]
                .as_str()
                .unwrap()
                .to_string()
        })
        .collect()
}

/// Scenario: the feed reads thirty-day windows and holds ten of them at most,
/// so an activity two years back is in no page it has loaded.
/// Expected behaviour: the search and the sport chips answer over the whole
/// stored library, newest first, and count what they matched there.
#[test]
fn test_feed_search_reaches_activities_past_the_loaded_windows() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("feed_search_whole_library.db");
    seed_library();

    let by_name = search("  lantern VALLEY ", None, 0, 30);
    assert_eq!(ids(&by_name), vec!["old-ride"]);
    assert_eq!(by_name.matched_count, 1);
    assert!(!by_name.has_more);

    let by_accent = search("ÉGLISE", None, 0, 30);
    assert_eq!(ids(&by_accent), vec!["old-walk"]);

    let by_type = search("openwater", None, 0, 30);
    assert_eq!(ids(&by_type), vec!["old-swim"]);

    let swims = search("", Some(crate::FfiFeedGroup::Swimming), 0, 30);
    assert_eq!(ids(&swims), vec!["old-swim"]);

    let cycling = search("", Some(crate::FfiFeedGroup::Cycling), 0, 30);
    assert_eq!(
        ids(&cycling),
        vec!["club-a", "club-b", "club-c", "old-ride"]
    );

    let other = search("", Some(crate::FfiFeedGroup::Other), 0, 30);
    assert_eq!(ids(&other), vec!["old-walk"]);

    let cycling_and_other = ActivityManager::new()
        .get_activity_bodies(crate::FfiActivityBodiesQuery {
            oldest_ts: None,
            newest_ts: None,
            needle: String::new(),
            sport_groups: vec![crate::FfiFeedGroup::Cycling, crate::FfiFeedGroup::Other],
            offset: 0,
            limit: Some(30),
        })
        .unwrap();
    assert_eq!(
        ids(&cycling_and_other),
        vec!["club-a", "club-b", "club-c", "old-walk", "old-ride"]
    );
    assert_eq!(cycling_and_other.matched_count, 5);

    let runs = search("", Some(crate::FfiFeedGroup::Running), 0, 30);
    assert_eq!(runs.matched_count, 30);
    assert_eq!(ids(&runs)[0], "run0");

    let both = search("lantern", Some(crate::FfiFeedGroup::Running), 0, 30);
    assert!(both.bodies.is_empty());
    assert_eq!(both.matched_count, 0);
    assert!(!both.has_more);

    let nothing = search("no such activity", None, 0, 30);
    assert!(nothing.bodies.is_empty());
    assert_eq!(nothing.matched_count, 0);
}

/// Scenario: a search with more matches than a page.
/// Expected behaviour: each page continues where the last stopped, the count
/// is the whole match, and the last page says there is no more.
#[test]
fn test_feed_search_pages_newest_first_and_counts_the_whole_match() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("feed_search_paging.db");
    seed_library();

    let first = search("club", None, 0, 2);
    assert_eq!(ids(&first), vec!["club-a", "club-b"]);
    assert_eq!(first.matched_count, 3);
    assert!(first.has_more);

    let second = search("club", None, 2, 2);
    assert_eq!(ids(&second), vec!["club-c"]);
    assert_eq!(second.matched_count, 3);
    assert!(!second.has_more);

    let past_the_end = search("club", None, 9, 2);
    assert!(past_the_end.bodies.is_empty());
    assert!(!past_the_end.has_more);

    let unpaged = search("club", None, 0, 0);
    assert!(unpaged.bodies.is_empty());
    assert_eq!(unpaged.matched_count, 3);
    assert!(unpaged.has_more);
}

/// Scenario: the unfiltered feed reads one thirty-day window at a time.
/// Expected behaviour: the window bounds hold, inclusive at both ends, every
/// body in it comes back newest first with no limit, and a search inside a
/// window stays inside it.
#[test]
fn test_feed_window_read_is_bounded_and_unpaged() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("feed_window_read.db");
    seed_library();

    let month = window((NOW - 29.0 * DAY) as i64, NOW as i64);
    assert_eq!(month.matched_count, 30);
    assert!(!month.has_more);
    assert_eq!(ids(&month).first().map(String::as_str), Some("run0"));
    assert_eq!(ids(&month).last().map(String::as_str), Some("run29"));

    let edge = window((NOW - 400.0 * DAY) as i64, (NOW - 400.0 * DAY) as i64);
    assert_eq!(ids(&edge), vec!["club-a"]);

    let year_of_clubs = ActivityManager::new()
        .get_activity_bodies(crate::FfiActivityBodiesQuery {
            oldest_ts: Some(NOW - 550.0 * DAY),
            newest_ts: Some(NOW),
            needle: "club".into(),
            sport_groups: vec![],
            offset: 0,
            limit: None,
        })
        .unwrap();
    assert_eq!(ids(&year_of_clubs), vec!["club-a", "club-b"]);
    assert_eq!(year_of_clubs.matched_count, 2);
}

/// Scenario: a body that has no metrics row, which the repair sweep has not
/// reached yet, and a body that will not parse.
/// Expected behaviour: the first is still found by its stored name and type,
/// and the second is skipped rather than failing the whole search.
#[test]
fn test_feed_search_reads_a_body_with_no_metrics_row_and_skips_a_corrupt_one() {
    let _serial = serial_global_state();
    let _dir = init_global_engine("feed_search_unmetered.db");
    seed_library();
    crate::with_persistent_engine(|engine| {
        engine
            .db
            .execute_batch(&format!(
                "INSERT INTO activity_bodies (activity_id, date, raw) VALUES
                     ('bare', {date}, '{raw}'),
                     ('broken', {date}, '{{not json');",
                date = (NOW - 900.0 * DAY) as i64,
                raw = library_body("bare", "Quarry hill repeats", "Swim"),
            ))
            .unwrap();
    })
    .unwrap();

    assert_eq!(ids(&search("quarry", None, 0, 30)), vec!["bare"]);
    assert_eq!(
        ids(&search("", Some(crate::FfiFeedGroup::Swimming), 0, 30)),
        vec!["old-swim", "bare"]
    );
}
