//! Scenario: every foreground starts the default sync, and it fetched the
//! athlete, the sport settings and a whole year of wellness each time, though
//! the first two rarely change and a stored year only moves at its newest end.
//!
//! Expected behaviour: the athlete body, which carries the sport settings, is
//! asked for when the stored one is six hours old or the caller forces it, and
//! the sport settings come out of it rather than from a request of their own.
//! Wellness asks the trailing fortnight once the stored year has no gap, and
//! reaches back to the oldest day the census says still owes a download.

use super::*;
use crate::governor::{Governor, NoopPolicy};
use httpmock::prelude::*;
use serde_json::json;

/// The `oldest` of every wellness request, in the order they were answered.
/// A static because `httpmock`'s custom matcher is a bare `fn`; every test
/// here holds `serial_global_state`.
static WELLNESS_OLDEST: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Every request in the order it was answered, named by its endpoint.
static ORDER: Mutex<Vec<&'static str>> = Mutex::new(Vec::new());

fn note(name: &'static str) {
    ORDER.lock().unwrap_or_else(|e| e.into_inner()).push(name);
}

fn note_wellness(req: &HttpMockRequest) -> bool {
    let oldest = req
        .query_params
        .as_ref()
        .and_then(|q| q.iter().find(|(k, _)| k == "oldest"))
        .map(|(_, v)| v.clone())
        .unwrap_or_default();
    WELLNESS_OLDEST
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .push(oldest);
    note("wellness");
    true
}

fn note_census(_: &HttpMockRequest) -> bool {
    note("census");
    true
}

fn taken_wellness_oldest() -> Vec<String> {
    std::mem::take(&mut *WELLNESS_OLDEST.lock().unwrap_or_else(|e| e.into_inner()))
}

fn taken_order() -> Vec<&'static str> {
    std::mem::take(&mut *ORDER.lock().unwrap_or_else(|e| e.into_inner()))
}

fn transport_to(base: String) -> Transport {
    let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
    Transport::with_governor(base, AuthMethod::ApiKey("k"), gov).expect("transport")
}

fn today() -> chrono::NaiveDate {
    chrono::Local::now().date_naive()
}

fn days_back(days: i64) -> String {
    (today() - chrono::Duration::days(days)).to_string()
}

fn sport_settings() -> serde_json::Value {
    json!([
        {"id": 1, "athlete_id": "i1", "types": ["Ride", "VirtualRide"], "ftp": 240,
         "lthr": 168, "max_hr": 190, "hr_zones": [140, 155, 168, 178, 190],
         "power_zones": [55, 75, 90, 105, 120, 150, 999]},
        {"id": 2, "athlete_id": "i1", "types": ["Run"], "lthr": 172, "max_hr": 195,
         "threshold_pace": 3.9, "hr_zones": [145, 160, 172, 182, 195]}
    ])
}

struct Upstream {
    server: MockServer,
    athlete: usize,
    sport_settings: usize,
}

impl Upstream {
    fn athlete_hits(&self) -> usize {
        self.server_hits(self.athlete)
    }

    fn sport_settings_hits(&self) -> usize {
        self.server_hits(self.sport_settings)
    }

    fn server_hits(&self, id: usize) -> usize {
        httpmock::Mock::new(id, &self.server).hits()
    }
}

/// The endpoints a default sync reaches, with the census answering `census`.
/// The athlete body carries `sportSettings` unless `athlete` says otherwise.
fn upstream_with(athlete: serde_json::Value, census: serde_json::Value) -> Upstream {
    let server = MockServer::start();
    let athlete = server
        .mock(|when, then| {
            when.method(GET).path("/athlete/i1");
            then.status(200).json_body(athlete);
        })
        .id;
    let sport_settings = server
        .mock(|when, then| {
            when.method(GET).path("/athlete/i1/sport-settings");
            then.status(200).json_body(sport_settings());
        })
        .id;
    server.mock(|when, then| {
        when.method(GET)
            .path("/athlete/i1/wellness")
            .matches(note_wellness);
        then.status(200).json_body(json!([]));
    });
    // Created first, so it is the mock a census request meets first.
    server.mock(|when, then| {
        when.method(GET)
            .path("/athlete/i1/activities")
            .query_param("oldest", "2000-01-01")
            .matches(note_census);
        then.status(200).json_body(census);
    });
    server.mock(|when, then| {
        when.method(GET).path("/athlete/i1/activities");
        then.status(200).json_body(json!([]));
    });
    taken_wellness_oldest();
    taken_order();
    Upstream {
        server,
        athlete,
        sport_settings,
    }
}

fn upstream() -> Upstream {
    upstream_with(
        json!({"id": "i1", "name": "Ada", "sportSettings": sport_settings()}),
        json!([]),
    )
}

fn run(upstream: &Upstream, force: bool) {
    run_against(&upstream.server, force);
}

fn run_against(server: &MockServer, force: bool) {
    let svc = SyncService::new();
    svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
    assert!(svc.try_begin());
    crate::runtime::block_on(perform_sync(
        &svc,
        crate::persistence::engine_install(),
        transport_to(server.base_url()),
        "i1".into(),
        force,
    ));
}

/// A stored wellness row for every day from `oldest` days back to today,
/// except the `missing` ones.
fn store_wellness(oldest: i64, missing: &[i64]) {
    let rows: Vec<_> = (0..=oldest)
        .filter(|back| !missing.contains(back))
        .map(|back| crate::persistence::wellness::WellnessRow {
            date: days_back(back),
            ctl: Some(50.0),
            atl: Some(55.0),
            ramp_rate: None,
            hrv: None,
            resting_hr: None,
            weight: None,
            sleep_secs: None,
            sleep_score: None,
            soreness: None,
            fatigue: None,
            stress: None,
            mood: None,
            motivation: None,
            raw: None,
        })
        .collect();
    crate::persistence::with_persistent_engine(move |engine| {
        engine.upsert_wellness(&rows).expect("wellness");
    })
    .expect("engine");
}

/// Move the stored profile's fetch time `secs` into the past.
fn age_profile(secs: i64) {
    crate::persistence::with_persistent_engine(move |engine| {
        engine
            .db
            .execute(
                "UPDATE athlete_profile SET updated_at = updated_at - ?1",
                [secs],
            )
            .expect("age profile");
    })
    .expect("engine");
}

const MINUTE: i64 = 60;
const HOUR: i64 = 60 * MINUTE;

#[test]
fn a_run_inside_the_gate_asks_only_the_fortnight_of_wellness() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("profile_gate_inside.db");
    store_wellness(WELLNESS_DAYS, &[]);
    let upstream = upstream();

    run(&upstream, false);
    assert_eq!(
        upstream.athlete_hits(),
        1,
        "a first run fetches the profile"
    );
    age_profile(10 * MINUTE);
    run(&upstream, false);

    assert_eq!(
        upstream.athlete_hits(),
        1,
        "ten minutes on, the profile is current"
    );
    assert_eq!(
        upstream.sport_settings_hits(),
        0,
        "the athlete body carries the sport settings"
    );
    assert_eq!(
        taken_wellness_oldest(),
        vec![days_back(WELLNESS_REFRESH_DAYS); 2],
        "a stored year with no gap asks only the fortnight"
    );
}

#[test]
fn the_profile_is_asked_again_once_older_than_the_gate() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("profile_gate_aged.db");
    store_wellness(WELLNESS_DAYS, &[]);
    let upstream = upstream();

    run(&upstream, false);
    age_profile(7 * HOUR);
    run(&upstream, false);

    assert_eq!(upstream.athlete_hits(), 2);
    assert_eq!(upstream.sport_settings_hits(), 0);
}

#[test]
fn a_forced_run_asks_the_profile_inside_the_gate() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("profile_gate_forced.db");
    store_wellness(WELLNESS_DAYS, &[]);
    let upstream = upstream();

    run(&upstream, false);
    age_profile(10 * MINUTE);
    run(&upstream, true);

    assert_eq!(upstream.athlete_hits(), 2);
    assert_eq!(
        taken_wellness_oldest(),
        vec![days_back(WELLNESS_REFRESH_DAYS); 2],
        "forcing the profile does not widen wellness"
    );
}

#[test]
fn a_profile_stored_for_another_athlete_is_not_current() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("profile_gate_owner.db");
    crate::persistence::with_persistent_engine(|engine| {
        engine
            .set_sport_settings("[]")
            .expect("seed sport settings");
        engine
            .set_athlete_profile(r#"{"id": "i2", "name": "Bo"}"#)
            .expect("seed profile");
    })
    .expect("engine");
    let upstream = upstream();

    run(&upstream, false);

    assert_eq!(upstream.athlete_hits(), 1);
}

#[test]
fn the_sport_settings_are_stored_from_the_athlete_body() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("profile_gate_embedded.db");
    let upstream = upstream();

    run(&upstream, false);

    let stored = crate::persistence::with_persistent_engine(|engine| engine.get_sport_settings())
        .expect("engine")
        .expect("sport settings stored");
    let stored: serde_json::Value = serde_json::from_str(&stored).expect("json");
    assert_eq!(stored, sport_settings());
    assert_eq!(upstream.sport_settings_hits(), 0);
}

#[test]
fn an_athlete_body_without_sport_settings_falls_back_to_their_endpoint() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("profile_gate_fallback.db");
    let upstream = upstream_with(json!({"id": "i1", "name": "Ada"}), json!([]));

    run(&upstream, false);

    assert_eq!(upstream.sport_settings_hits(), 1);
    let stored = crate::persistence::with_persistent_engine(|engine| engine.get_sport_settings())
        .expect("engine")
        .expect("sport settings stored");
    let stored: serde_json::Value = serde_json::from_str(&stored).expect("json");
    assert_eq!(stored, sport_settings());
    age_profile(10 * MINUTE);
    run(&upstream, false);
    assert_eq!(
        upstream.athlete_hits(),
        1,
        "settings from the fallback make the profile current too"
    );
}

#[test]
fn an_empty_wellness_store_asks_the_whole_year_ahead_of_the_census() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("profile_gate_empty_wellness.db");
    let upstream = upstream();

    run(&upstream, false);

    assert_eq!(taken_wellness_oldest(), vec![days_back(WELLNESS_DAYS)]);
    let order = taken_order();
    let wellness = order.iter().position(|name| *name == "wellness");
    let census = order.iter().position(|name| *name == "census");
    assert!(
        wellness < census,
        "a first launch's fitness figure does not wait on the census: {order:?}"
    );
}

#[test]
fn a_gap_in_the_stored_year_asks_back_to_the_gap() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("profile_gate_gap.db");
    store_wellness(WELLNESS_DAYS, &[40, 41]);
    let upstream = upstream();

    run(&upstream, false);

    assert_eq!(taken_wellness_oldest(), vec![days_back(41)]);
}

#[test]
fn a_year_short_at_its_oldest_end_asks_the_whole_year() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("profile_gate_short.db");
    store_wellness(200, &[]);
    let upstream = upstream();

    run(&upstream, false);

    assert_eq!(taken_wellness_oldest(), vec![days_back(WELLNESS_DAYS)]);
}

/// The endpoints a default sync reaches, with wellness answering a row for
/// every day of the trailing year from `oldest_row` days back except the
/// `holes`, whatever window is asked, and `failing` a 500 instead.
fn upstream_keeping_holes(oldest_row: i64, holes: &[i64], failing: bool) -> MockServer {
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(GET).path("/athlete/i1");
        then.status(200)
            .json_body(json!({"id": "i1", "sportSettings": sport_settings()}));
    });
    let rows: Vec<_> = (0..=oldest_row.min(WELLNESS_DAYS))
        .rev()
        .filter(|back| !holes.contains(back))
        .map(|back| wellness_day(back, 50.0))
        .collect();
    server.mock(|when, then| {
        when.method(GET)
            .path("/athlete/i1/wellness")
            .matches(note_wellness);
        if failing {
            then.status(500);
        } else {
            then.status(200).json_body(json!(rows));
        }
    });
    server.mock(|when, then| {
        when.method(GET)
            .path("/athlete/i1/activities")
            .query_param("oldest", "2000-01-01")
            .matches(note_census);
        then.status(200).json_body(json!([]));
    });
    server.mock(|when, then| {
        when.method(GET).path("/athlete/i1/activities");
        then.status(200).json_body(json!([]));
    });
    taken_wellness_oldest();
    taken_order();
    server
}

/// Scenario: upstream has no wellness row for one day of the year, so the day
/// stays absent from the store after a pull that asked for it.
///
/// Expected behaviour: the day was asked and answered, so the next run asks
/// only the fortnight rather than back to the day for ever.
#[test]
fn a_day_upstream_has_no_row_for_is_asked_once() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("profile_gate_upstream_hole.db");
    let server = upstream_keeping_holes(WELLNESS_DAYS, &[200], false);

    run_against(&server, false);
    run_against(&server, false);
    run_against(&server, false);

    assert_eq!(
        taken_wellness_oldest(),
        vec![
            days_back(WELLNESS_DAYS),
            days_back(WELLNESS_REFRESH_DAYS),
            days_back(WELLNESS_REFRESH_DAYS),
        ]
    );
}

/// Scenario: an account whose wellness starts 100 days back, so the oldest
/// days of the year never get a row.
///
/// Expected behaviour: after the first run asks the year, later runs ask the
/// fortnight, and do it behind the census.
#[test]
fn a_young_account_asks_the_year_once() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("profile_gate_young.db");
    let server = upstream_keeping_holes(100, &[], false);

    run_against(&server, false);
    taken_order();
    run_against(&server, false);

    assert_eq!(
        taken_wellness_oldest(),
        vec![days_back(WELLNESS_DAYS), days_back(WELLNESS_REFRESH_DAYS)]
    );
    let order = taken_order();
    let wellness = order.iter().position(|name| *name == "wellness");
    let census = order.iter().position(|name| *name == "census");
    assert!(
        census < wellness,
        "a held year waits on the census: {order:?}"
    );
}

/// Scenario: an account with no wellness at all, so every pull answers empty.
///
/// Expected behaviour: an empty answer is an answer, and the year is asked once.
#[test]
fn an_account_with_no_wellness_asks_the_year_once() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("profile_gate_no_wellness.db");
    let upstream = upstream();

    run(&upstream, false);
    run(&upstream, false);

    assert_eq!(
        taken_wellness_oldest(),
        vec![days_back(WELLNESS_DAYS), days_back(WELLNESS_REFRESH_DAYS)]
    );
}

#[test]
fn a_failed_wellness_pull_leaves_the_year_owed() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("profile_gate_failed_pull.db");

    run_against(&upstream_keeping_holes(WELLNESS_DAYS, &[], true), false);
    run_against(&upstream_keeping_holes(WELLNESS_DAYS, &[200], false), false);

    assert_eq!(
        taken_wellness_oldest(),
        vec![days_back(WELLNESS_DAYS)],
        "the second upstream records only its own requests"
    );
}

#[test]
fn a_cleared_library_asks_the_year_again() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("profile_gate_cleared.db");
    let server = upstream_keeping_holes(100, &[], false);

    run_against(&server, false);
    crate::persistence::with_persistent_engine(|engine| engine.clear().expect("clear"))
        .expect("engine");
    run_against(&server, false);

    assert_eq!(
        taken_wellness_oldest(),
        vec![days_back(WELLNESS_DAYS), days_back(WELLNESS_DAYS)]
    );
}

#[test]
fn a_window_answered_for_another_athlete_is_not_held() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("profile_gate_answered_owner.db");
    store_wellness(100, &[]);
    let answered = format!("i2|{}|{}", days_back(WELLNESS_DAYS), today());
    crate::persistence::with_persistent_engine(move |engine| {
        engine
            .set_setting(WELLNESS_ANSWERED_KEY, &answered)
            .expect("seed answered window");
    })
    .expect("engine");
    let upstream = upstream();

    run(&upstream, false);

    assert_eq!(taken_wellness_oldest(), vec![days_back(WELLNESS_DAYS)]);
}

fn census_entry(id: &str, day: &str, version: &str) -> serde_json::Value {
    json!({
        "id": id,
        "start_date_local": format!("{day}T08:30:00"),
        "created": format!("{day}T08:00:00Z"),
        "icu_sync_date": version,
    })
}

#[test]
fn an_activity_owed_thirty_days_back_widens_wellness_to_its_day() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("profile_gate_owed.db");
    store_wellness(WELLNESS_DAYS, &[]);
    let day = days_back(30);
    let upstream = upstream_with(
        json!({"id": "i1", "name": "Ada", "sportSettings": sport_settings()}),
        json!([census_entry("late", &day, "2026-01-01T00:00:00Z")]),
    );

    run(&upstream, false);

    assert_eq!(taken_wellness_oldest(), vec![day]);
}

#[test]
fn an_edit_upstream_two_hundred_days_back_widens_wellness_to_its_day() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("profile_gate_old_edit.db");
    store_wellness(WELLNESS_DAYS, &[]);
    let day = days_back(200);
    let stored = crate::net::types::ActivityCensusEntry {
        id: "old".into(),
        start_date_local: Some(format!("{day}T08:30:00")),
        created: Some(format!("{day}T08:00:00Z")),
        icu_sync_date: Some("2025-01-01T00:00:00Z".into()),
        has_latlng: false,
        has_series: false,
    };
    crate::persistence::with_persistent_engine(move |engine| {
        engine
            .record_activity_census("i1", &[stored])
            .expect("census");
        engine
            .db
            .execute(
                "UPDATE activity_census SET fetched_sync_date = icu_sync_date",
                [],
            )
            .expect("mark fetched");
    })
    .expect("engine");
    let upstream = upstream_with(
        json!({"id": "i1", "name": "Ada", "sportSettings": sport_settings()}),
        json!([census_entry("old", &day, "2026-02-02T00:00:00Z")]),
    );

    run(&upstream, false);

    assert_eq!(taken_wellness_oldest(), vec![day]);
}

#[test]
fn a_change_older_than_the_year_asks_no_further_than_the_year() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("profile_gate_ancient_edit.db");
    store_wellness(WELLNESS_DAYS, &[]);
    let day = days_back(500);
    let stored = crate::net::types::ActivityCensusEntry {
        id: "ancient".into(),
        start_date_local: Some(format!("{day}T08:30:00")),
        created: Some(format!("{day}T08:00:00Z")),
        icu_sync_date: Some("2025-01-01T00:00:00Z".into()),
        has_latlng: false,
        has_series: false,
    };
    crate::persistence::with_persistent_engine(move |engine| {
        engine
            .record_activity_census("i1", &[stored])
            .expect("census");
        engine
            .db
            .execute(
                "UPDATE activity_census SET fetched_sync_date = icu_sync_date",
                [],
            )
            .expect("mark fetched");
    })
    .expect("engine");
    let upstream = upstream_with(
        json!({"id": "i1", "name": "Ada", "sportSettings": sport_settings()}),
        json!([census_entry("ancient", &day, "2026-02-02T00:00:00Z")]),
    );

    run(&upstream, false);

    assert_eq!(taken_wellness_oldest(), vec![days_back(WELLNESS_DAYS)]);
}

fn wellness_day(back: i64, ctl: f64) -> serde_json::Value {
    json!({"id": days_back(back), "ctl": ctl, "atl": 40.0, "updated": "2026-01-01T00:00:00.000+00:00"})
}

/// Scenario: the year is stored and the next run asks the fortnight. Upstream
/// has since recomputed one day inside it, as it does when an activity lands.
///
/// Expected behaviour: the fortnight's rows are exactly what a year's pull of
/// the same upstream would have stored, the edited day included.
#[test]
fn the_fortnight_stores_what_the_year_would_have() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("profile_gate_parity.db");
    let year = |edited: Option<i64>| -> Vec<serde_json::Value> {
        (0..=WELLNESS_DAYS)
            .rev()
            .map(|back| wellness_day(back, if Some(back) == edited { 61.5 } else { 50.0 }))
            .collect()
    };
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(GET).path("/athlete/i1");
        then.status(200)
            .json_body(json!({"id": "i1", "sportSettings": sport_settings()}));
    });
    let whole = server.mock(|when, then| {
        when.method(GET)
            .path("/athlete/i1/wellness")
            .query_param("oldest", days_back(WELLNESS_DAYS));
        then.status(200).json_body(json!(year(None)));
    });
    let fortnight: Vec<_> = year(Some(3))
        .into_iter()
        .skip((WELLNESS_DAYS - WELLNESS_REFRESH_DAYS) as usize)
        .collect();
    assert_eq!(fortnight.len() as i64, WELLNESS_REFRESH_DAYS + 1);
    let recent = server.mock(|when, then| {
        when.method(GET)
            .path("/athlete/i1/wellness")
            .query_param("oldest", days_back(WELLNESS_REFRESH_DAYS));
        then.status(200).json_body(json!(fortnight));
    });
    server.mock(|when, then| {
        when.method(GET).path("/athlete/i1/activities");
        then.status(200).json_body(json!([]));
    });

    run_against(&server, false);
    run_against(&server, false);
    whole.assert_hits(1);
    recent.assert_hits(1);

    let stored = crate::persistence::with_persistent_engine(|engine| {
        engine
            .get_wellness_days(&days_back(WELLNESS_DAYS), &today().to_string())
            .expect("wellness")
    })
    .expect("engine");
    let expected = year(Some(3));
    assert_eq!(stored.len(), expected.len());
    for (row, want) in stored.iter().zip(&expected) {
        assert_eq!(Some(row.date.as_str()), want["id"].as_str());
        assert_eq!(row.ctl, want["ctl"].as_f64(), "{}", row.date);
    }
}

#[test]
fn the_profile_gate_holds_six_hours_and_yields_to_force() {
    let now = 1_800_000_000;
    assert!(profile_owed(None, now, false), "nothing stored");
    assert!(!profile_owed(Some(now - 10 * MINUTE), now, false));
    assert!(!profile_owed(
        Some(now - PROFILE_MAX_AGE_SECS + 1),
        now,
        false
    ));
    assert!(profile_owed(Some(now - PROFILE_MAX_AGE_SECS), now, false));
    assert!(profile_owed(Some(now - 10 * MINUTE), now, true), "forced");
    assert!(
        profile_owed(Some(now + HOUR), now, false),
        "a clock set back does not hold the profile"
    );
}

#[test]
fn the_wellness_window_starts_at_the_first_missing_day_or_the_oldest_owed() {
    let today = chrono::NaiveDate::from_ymd_opt(2026, 3, 1).expect("date");
    let back = |days: i64| today - chrono::Duration::days(days);
    let year = back(WELLNESS_DAYS);
    let fortnight = back(WELLNESS_REFRESH_DAYS);
    let stored_except = |missing: &[i64]| -> BTreeSet<chrono::NaiveDate> {
        (0..=WELLNESS_DAYS)
            .filter(|days| !missing.contains(days))
            .map(back)
            .collect()
    };

    assert_eq!(wellness_oldest(&BTreeSet::new(), None, None, today), year);
    assert_eq!(
        wellness_oldest(&stored_except(&[]), None, None, today),
        fortnight
    );
    assert_eq!(
        wellness_oldest(
            &stored_except(&[0, 3, WELLNESS_REFRESH_DAYS]),
            None,
            None,
            today
        ),
        fortnight,
        "the fortnight's own days are fetched anyway"
    );
    assert_eq!(
        wellness_oldest(
            &stored_except(&[WELLNESS_REFRESH_DAYS + 1]),
            None,
            None,
            today
        ),
        back(WELLNESS_REFRESH_DAYS + 1)
    );
    assert_eq!(
        wellness_oldest(&stored_except(&[WELLNESS_DAYS]), None, None, today),
        year
    );
    let full = stored_except(&[]);
    let owed = |day: chrono::NaiveDate| wellness_oldest(&full, None, Some(&day.to_string()), today);
    assert_eq!(
        owed(back(3)),
        fortnight,
        "a recent change is inside the fortnight"
    );
    assert_eq!(owed(back(30)), back(30));
    assert_eq!(owed(back(WELLNESS_DAYS + 100)), year, "never past the year");
    assert_eq!(
        wellness_oldest(&full, None, Some("not a day"), today),
        fortnight,
        "an unreadable day widens nothing"
    );
    assert_eq!(
        wellness_oldest(
            &stored_except(&[60]),
            None,
            Some(&back(30).to_string()),
            today
        ),
        back(60),
        "a gap older than the owed day wins"
    );
}

#[test]
fn an_answered_run_holds_its_days_and_nothing_older() {
    let today = chrono::NaiveDate::from_ymd_opt(2026, 3, 1).expect("date");
    let back = |days: i64| today - chrono::Duration::days(days);
    let year = back(WELLNESS_DAYS);
    let fortnight = back(WELLNESS_REFRESH_DAYS);
    let rows_from =
        |oldest: i64| -> BTreeSet<chrono::NaiveDate> { (0..=oldest).map(back).collect() };
    let run = |from: i64, through: i64| AnsweredDays {
        from: back(from),
        through: back(through),
    };

    assert_eq!(
        wellness_oldest(&rows_from(100), Some(run(WELLNESS_DAYS, 0)), None, today),
        fortnight
    );
    assert_eq!(
        wellness_oldest(&rows_from(100), Some(run(300, 0)), None, today),
        year,
        "a day older than the run is still asked"
    );
    assert_eq!(
        wellness_oldest(&BTreeSet::new(), Some(run(WELLNESS_DAYS, 60)), None, today),
        back(59),
        "a day newer than the run is still asked"
    );
    assert_eq!(
        wellness_oldest(
            &rows_from(100),
            Some(run(WELLNESS_DAYS, 0)),
            Some(&back(30).to_string()),
            today
        ),
        back(30),
        "an owed day still widens the window"
    );
}

#[test]
fn an_answered_run_extends_only_across_stored_rows() {
    let today = chrono::NaiveDate::from_ymd_opt(2026, 3, 1).expect("date");
    let back = |days: i64| today - chrono::Duration::days(days);
    let run = |from: i64, through: i64| AnsweredDays {
        from: back(from),
        through: back(through),
    };
    let rows = |days: std::ops::RangeInclusive<i64>| -> BTreeSet<chrono::NaiveDate> {
        days.map(back).collect()
    };

    assert_eq!(
        answered_after(&BTreeSet::new(), None, back(WELLNESS_DAYS), today),
        run(WELLNESS_DAYS, 0)
    );
    assert_eq!(
        answered_after(
            &BTreeSet::new(),
            Some(run(WELLNESS_DAYS, 60)),
            back(59),
            today
        ),
        run(WELLNESS_DAYS, 0),
        "a request from the day after the run extends it"
    );
    assert_eq!(
        answered_after(
            &BTreeSet::new(),
            Some(run(WELLNESS_DAYS, 10)),
            back(14),
            today
        ),
        run(WELLNESS_DAYS, 0),
        "an overlapping request extends it"
    );
    assert_eq!(
        answered_after(
            &rows(15..=59),
            Some(run(WELLNESS_DAYS, 60)),
            back(14),
            today
        ),
        run(WELLNESS_DAYS, 0),
        "stored rows bridge the run to the request"
    );
    assert_eq!(
        answered_after(
            &rows(20..=59),
            Some(run(WELLNESS_DAYS, 60)),
            back(14),
            today
        ),
        run(14, 0),
        "an unstored day between them breaks the run"
    );
    assert_eq!(
        answered_after(
            &BTreeSet::new(),
            Some(run(30, 0)),
            back(WELLNESS_DAYS),
            today
        ),
        run(WELLNESS_DAYS, 0),
        "an older request starts the run"
    );
}

#[test]
fn an_answered_run_reads_back_only_for_its_athlete() {
    let run = AnsweredDays {
        from: chrono::NaiveDate::from_ymd_opt(2025, 3, 1).expect("date"),
        through: chrono::NaiveDate::from_ymd_opt(2026, 3, 1).expect("date"),
    };
    let stored = run.encode("i1");

    assert_eq!(AnsweredDays::decode(&stored, "i1"), Some(run));
    assert_eq!(AnsweredDays::decode(&stored, "i2"), None);
    assert_eq!(AnsweredDays::decode("i1|2026-03-01|2025-03-01", "i1"), None);
    assert_eq!(AnsweredDays::decode("i1|2025-03-01", "i1"), None);
    assert_eq!(AnsweredDays::decode("i1|not a day|2026-03-01", "i1"), None);
}

/// A recorded pair, reduced and with invented values: the athlete body and
/// the sport settings endpoint over the same account at the same moment.
const ATHLETE_BODY: &str = include_str!("../../../tests/fixtures/intervals/athlete_body.json");
const SPORT_SETTINGS_BODY: &str =
    include_str!("../../../tests/fixtures/intervals/sport_settings_body.json");

/// Every key the two stored copies disagree on, as `entry index.key`.
fn differing_keys(left: &serde_json::Value, right: &serde_json::Value) -> BTreeSet<String> {
    let (left, right) = (
        left.as_array().expect("an array"),
        right.as_array().expect("an array"),
    );
    assert_eq!(left.len(), right.len(), "the same entries");
    let mut keys = BTreeSet::new();
    for (i, (l, r)) in left.iter().zip(right).enumerate() {
        let (l, r) = (l.as_object().expect("entry"), r.as_object().expect("entry"));
        for key in l.keys().chain(r.keys()) {
            if l.get(key) != r.get(key) {
                keys.insert(format!("{i}.{key}"));
            }
        }
    }
    keys
}

/// What the screens and the insight rules derive from the stored settings,
/// read off the rows the engine holds.
fn derived_from_stored() -> Vec<String> {
    const SPORTS: [&str; 8] = [
        "Ride",
        "VirtualRide",
        "GravelRide",
        "Run",
        "TrailRun",
        "Swim",
        "Walk",
        "WeightTraining",
    ];
    crate::persistence::with_persistent_engine(|engine| {
        let stored = engine.get_sport_settings();
        let mut derived = Vec::new();
        for sport in SPORTS {
            for bpm in (60..=200).step_by(5) {
                let zone = crate::persistence::screens::hr_zone_for_sport(
                    &engine.db,
                    sport,
                    f64::from(bpm),
                );
                derived.push(format!("{sport} {bpm} bpm: {zone:?}"));
            }
            for zone_type in ["power", "hr", "pace"] {
                let names = crate::persistence::fitness::derivations::pooled::zone_names(
                    stored.as_deref(),
                    sport,
                    zone_type,
                );
                derived.push(format!("{sport} {zone_type} names: {names:?}"));
            }
        }
        derived
    })
    .expect("engine")
}

/// Scenario: the sport settings used to come from their own endpoint and now
/// come out of the athlete body.
///
/// Expected behaviour: the stored settings, and every value derived from them,
/// are what the old path stored. The one accepted difference is `mmp_model` on
/// the two entries the athlete body fills it in for, which no reader uses: a
/// new difference fails here rather than reaching a screen unnoticed.
#[test]
fn the_athlete_body_stores_what_the_sport_settings_endpoint_did() {
    let _serial = crate::test_globals::serial_global_state();
    let _engine = crate::test_globals::init_global_engine("profile_gate_parity_settings.db");
    crate::persistence::with_persistent_engine(|engine| {
        engine
            .set_sport_settings(SPORT_SETTINGS_BODY)
            .expect("old path");
    })
    .expect("engine");
    let old_stored =
        crate::persistence::with_persistent_engine(|engine| engine.get_sport_settings())
            .expect("engine")
            .expect("stored");
    let old_derived = derived_from_stored();

    let server = MockServer::start();
    let athlete: serde_json::Value = serde_json::from_str(ATHLETE_BODY).expect("fixture");
    server.mock(|when, then| {
        when.method(GET).path("/athlete/i1");
        then.status(200).json_body(athlete);
    });
    let endpoint = server.mock(|when, then| {
        when.method(GET).path("/athlete/i1/sport-settings");
        then.status(200).body(SPORT_SETTINGS_BODY);
    });
    run_against(&server, false);
    endpoint.assert_hits(0);
    let new_stored =
        crate::persistence::with_persistent_engine(|engine| engine.get_sport_settings())
            .expect("engine")
            .expect("stored");

    let old: serde_json::Value = serde_json::from_str(&old_stored).expect("json");
    let new: serde_json::Value = serde_json::from_str(&new_stored).expect("json");
    assert_eq!(
        differing_keys(&old, &new),
        BTreeSet::from(["0.mmp_model".to_string(), "1.mmp_model".to_string()]),
    );
    assert_eq!(derived_from_stored(), old_derived);
}
