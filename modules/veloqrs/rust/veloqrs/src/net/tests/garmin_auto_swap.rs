//! Scenario: the athlete's switch is on and intervals.icu has imported new
//! Garmin rides.
//!
//! Expected behaviour: only a ride imported after the switch was turned on and
//! within 48 hours is swapped, each once, and the first refusal or mismatch
//! turns the switch off with its reason.

use super::*;
use std::cell::RefCell;
use std::collections::HashMap;

const GARMIN_BODY: &str = r#"{"id":"x","source":"GARMIN_CONNECT","external_id":"18342901776"}"#;
const MANUAL_BODY: &str = r#"{"id":"y","source":"UPLOAD","external_id":"18342901777"}"#;

/// A census of activities: an id, its `created` time, its start and its body.
fn census(rows: &[(&str, Option<&str>, Option<&str>, &str)]) -> rusqlite::Connection {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE activity_census (intervals_id TEXT NOT NULL, start_date_local TEXT, created TEXT);
         CREATE TABLE activity_bodies (activity_id TEXT PRIMARY KEY, raw TEXT NOT NULL);",
    )
    .unwrap();
    for (id, created, start, raw) in rows {
        conn.execute(
            "INSERT INTO activity_census (intervals_id, start_date_local, created) VALUES (?1, ?2, ?3)",
            rusqlite::params![id, start, created],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO activity_bodies (activity_id, raw) VALUES (?1, ?2)",
            rusqlite::params![id, raw],
        )
        .unwrap();
    }
    conn
}

const NOW: &str = "2026-10-26T12:00:00Z";

fn at(text: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(text)
        .unwrap()
        .with_timezone(&Utc)
}

struct Store {
    settings: RefCell<HashMap<String, String>>,
    imports: Vec<Imported>,
}

impl Store {
    fn new(switch: Option<&str>, imports: Vec<(&str, &str)>) -> Self {
        let store = Self {
            settings: RefCell::new(HashMap::new()),
            imports: imports
                .into_iter()
                .map(|(id, when)| Imported {
                    id: id.into(),
                    when: when.into(),
                })
                .collect(),
        };
        if let Some(value) = switch {
            store.set_setting(SWITCH, value);
        }
        store
    }
}

impl AutoStore for Store {
    fn setting(&self, key: &str) -> Option<String> {
        self.settings.borrow().get(key).cloned()
    }
    fn set_setting(&self, key: &str, value: &str) {
        self.settings.borrow_mut().insert(key.into(), value.into());
    }
    fn recent_imports(&self) -> Vec<Imported> {
        self.imports.clone()
    }
}

fn result(outcome: FfiSwapOutcome) -> FfiSwapResult {
    FfiSwapResult {
        outcome,
        detail: Some("why".into()),
    }
}

fn run_with(store: &Store, answers: &[(&str, FfiSwapOutcome)]) -> Vec<String> {
    let sent = RefCell::new(Vec::new());
    run(store, at(NOW), |id| {
        sent.borrow_mut().push(id.to_string());
        let outcome = answers
            .iter()
            .find(|(i, _)| *i == id)
            .map_or(FfiSwapOutcome::Replaced, |(_, o)| *o);
        result(outcome)
    });
    sent.into_inner()
}

#[test]
fn a_switch_that_is_off_swaps_nothing() {
    for value in [None, Some("false"), Some("true"), Some("")] {
        let store = Store::new(value, vec![("i1", "2026-10-26T10:00:00Z")]);
        assert!(run_with(&store, &[]).is_empty(), "{value:?}");
    }
}

#[test]
fn a_ride_imported_after_the_switch_and_within_two_days_is_swapped_once() {
    let store = Store::new(
        Some("2026-10-26T09:00:00Z"),
        vec![("i1", "2026-10-26T10:00:00Z")],
    );
    assert_eq!(run_with(&store, &[]), ["i1"]);
    assert!(
        run_with(&store, &[]).is_empty(),
        "a second pass swaps it again"
    );
}

#[test]
fn a_ride_imported_before_the_switch_is_left_alone() {
    let store = Store::new(
        Some("2026-10-26T09:00:00Z"),
        vec![
            ("i1", "2026-10-26T08:59:59Z"),
            ("i2", "2026-10-26T09:00:00Z"),
        ],
    );
    assert_eq!(run_with(&store, &[]), ["i2"]);
}

#[test]
fn a_ride_imported_over_forty_eight_hours_ago_is_left_alone() {
    let store = Store::new(
        Some("2026-10-20T00:00:00Z"),
        vec![
            ("old", "2026-10-24T11:59:59Z"),
            ("edge", "2026-10-24T12:00:00Z"),
        ],
    );
    assert_eq!(run_with(&store, &[]), ["edge"]);
}

#[test]
fn a_ride_with_no_readable_import_time_is_left_alone() {
    let store = Store::new(
        Some("2026-10-20T00:00:00Z"),
        vec![("i1", "soon"), ("i2", "")],
    );
    assert!(run_with(&store, &[]).is_empty());
}

#[test]
fn a_mismatch_turns_the_switch_off_and_stops_the_pass() {
    let store = Store::new(
        Some("2026-10-26T09:00:00Z"),
        vec![
            ("i1", "2026-10-26T10:00:00Z"),
            ("i2", "2026-10-26T11:00:00Z"),
        ],
    );
    let sent = run_with(&store, &[("i1", FfiSwapOutcome::Mismatch)]);
    assert_eq!(sent, ["i1"]);
    assert_eq!(store.setting(SWITCH).as_deref(), Some("false"));
    assert_eq!(store.setting(STOPPED).as_deref(), Some("why"));
    assert!(run_with(&store, &[]).is_empty());
}

#[test]
fn a_refusal_turns_the_switch_off() {
    for outcome in [
        FfiSwapOutcome::Refused,
        FfiSwapOutcome::PermissionBlocked,
        FfiSwapOutcome::AuthExpired,
    ] {
        let store = Store::new(
            Some("2026-10-26T09:00:00Z"),
            vec![("i1", "2026-10-26T10:00:00Z")],
        );
        run_with(&store, &[("i1", outcome)]);
        assert_eq!(
            store.setting(SWITCH).as_deref(),
            Some("false"),
            "{outcome:?}"
        );
    }
}

#[test]
fn a_ride_that_could_not_be_tried_is_tried_again_by_the_next_pass() {
    for outcome in [FfiSwapOutcome::Failed, FfiSwapOutcome::GarminUnavailable] {
        let store = Store::new(
            Some("2026-10-26T09:00:00Z"),
            vec![
                ("i1", "2026-10-26T10:00:00Z"),
                ("i2", "2026-10-26T11:00:00Z"),
            ],
        );
        assert_eq!(run_with(&store, &[("i1", outcome)]), ["i1", "i2"]);
        assert_eq!(
            store.setting(SWITCH).as_deref(),
            Some("2026-10-26T09:00:00Z")
        );
        assert_eq!(run_with(&store, &[]), ["i1"]);
    }
}

#[test]
fn a_ride_that_is_not_an_exact_import_or_holds_nothing_more_is_not_asked_again() {
    for outcome in [FfiSwapOutcome::NotEligible, FfiSwapOutcome::Unchanged] {
        let store = Store::new(
            Some("2026-10-26T09:00:00Z"),
            vec![("i1", "2026-10-26T10:00:00Z")],
        );
        assert_eq!(run_with(&store, &[("i1", outcome)]), ["i1"]);
        assert!(run_with(&store, &[]).is_empty());
    }
}

#[test]
fn rides_that_left_the_window_are_forgotten() {
    let mut store = Store::new(
        Some("2026-10-20T00:00:00Z"),
        vec![("i1", "2026-10-26T10:00:00Z")],
    );
    run_with(&store, &[]);
    assert_eq!(store.setting(HANDLED).as_deref(), Some("i1"));
    store.imports.clear();
    run_with(&store, &[]);
    assert_eq!(store.setting(HANDLED).as_deref(), Some(""));
}

#[test]
fn the_switch_value_is_the_moment_it_was_turned_on_and_false_is_off() {
    assert_eq!(
        switched_on_since("2026-10-26T09:00:00Z"),
        Some(at("2026-10-26T09:00:00Z"))
    );
    assert_eq!(switched_on_since("false"), None);
}

#[test]
fn a_stub_with_no_created_time_is_swapped_by_its_start_within_the_window() {
    let conn = census(&[
        ("stub", None, Some("2026-10-26T10:00:00"), GARMIN_BODY),
        ("old", None, Some("2026-10-24T11:00:00"), GARMIN_BODY),
        ("manual", None, Some("2026-10-26T10:30:00"), MANUAL_BODY),
    ]);
    let mut store = Store::new(Some("2026-10-20T00:00:00Z"), vec![]);
    store.imports = recent_imports_in(&conn).unwrap();

    assert_eq!(run_with(&store, &[]), ["stub"]);
}

/// Scenario: the pass reads and writes the library open at an install.
/// Expected behaviour: a setting written reads back, and an empty library
/// has no imports to swap.
#[test]
fn the_install_store_keeps_settings_and_lists_no_imports_from_an_empty_library() {
    let _serial = crate::test_globals::serial_global_state();
    let _dir = crate::test_globals::init_global_engine("auto_swap_store.db");
    let store = InstallStore(crate::persistence::engine_install());

    assert_eq!(store.setting("garmin_auto_probe"), None);
    store.set_setting("garmin_auto_probe", "on");
    assert_eq!(store.setting("garmin_auto_probe").as_deref(), Some("on"));
    assert!(store.recent_imports().is_empty());
}

/// Expected behaviour: a pass whose switch is off starts nothing and leaves
/// the pass free to start later.
#[test]
fn a_pass_with_the_switch_off_does_not_start() {
    let _serial = crate::test_globals::serial_global_state();
    let _dir = crate::test_globals::init_global_engine("auto_swap_off.db");

    start(crate::persistence::engine_install());

    assert!(!ACTIVE.load(Ordering::SeqCst));
}
