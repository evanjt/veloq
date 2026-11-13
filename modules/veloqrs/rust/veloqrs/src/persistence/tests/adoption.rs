//! Scenario: a library that worked its ride figures, wellness series and
//! curves out on the phone meets an intervals.icu account, and the first sync
//! links some of its Garmin rides to intervals.icu's copies.
//!
//! Expected behaviour: a ride intervals.icu serves shows intervals.icu's
//! numbers; a ride it does not serve shows none until it does; no wellness day,
//! eFTP entry or curve marked as Veloq's remains; what intervals.icu served is
//! never touched; a library with no intervals.icu is left as it is.

use crate::fit_synthetic::{Activity, Sample, SessionTotals, Thresholds, outdoor_ride};
use crate::net::garmin::ingest::ingest_into;
use crate::net::garmin::wire::ListedActivity;
use crate::persistence::PersistentEngine;
use crate::persistence::origin::garmin_source_key;
use rusqlite::params;
use serde_json::{Value, json};
use tempfile::TempDir;

const DAY: i64 = 86_400;
const RIDES: [i64; 3] = [24_686_966_001, 24_686_966_002, 24_686_966_003];

fn engine() -> (TempDir, PersistentEngine) {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    (dir, engine)
}

fn listed(id: i64) -> ListedActivity {
    serde_json::from_value(json!({
        "activityId": id,
        "activityName": "Long ride",
        "startTimeLocal": "2026-03-14 09:00:00",
        "startTimeGMT": "2026-03-14 07:00:00",
        "activityType": {"typeKey": "cycling"},
        "duration": 3600.0,
        "elapsedDuration": 3600.0,
        "distance": 1.0
    }))
    .unwrap()
}

/// An hour at the athlete's threshold power, `days` after the base ride.
fn hour_at_ftp(days: i64) -> Activity {
    let mut ride = outdoor_ride();
    ride.start_unix += days * DAY;
    ride.samples = (0..3600)
        .map(|at| Sample {
            at,
            position: Some((46.5 + f64::from(at) * 0.00001, 7.25)),
            power: Some(250),
            heart_rate: Some(150),
            ..Sample::default()
        })
        .collect();
    ride.totals = SessionTotals {
        elapsed_secs: Some(3600.0),
        timer_secs: Some(3600.0),
        ..SessionTotals::default()
    };
    ride.thresholds = Some(Thresholds {
        ftp: Some(250),
        threshold_hr: Some(170),
        max_hr: Some(190),
        resting_hr: Some(50),
        ..Thresholds::default()
    });
    ride
}

/// A library of three Garmin rides on three days, each scored by Veloq.
fn garmin_only_library() -> (TempDir, PersistentEngine) {
    let (dir, mut engine) = engine();
    for (day, id) in RIDES.iter().enumerate() {
        ingest_into(
            &mut engine,
            None,
            &listed(*id),
            &hour_at_ftp(day as i64).to_fit(),
        )
        .expect("stored");
    }
    (dir, engine)
}

fn start_of(engine: &PersistentEngine, id: i64) -> String {
    let body: Value =
        serde_json::from_str(&engine.get_activity_body(&garmin_source_key(id)).unwrap()).unwrap();
    body["start_date_local"].as_str().unwrap().to_owned()
}

/// What intervals.icu serves for a ride it imported from Garmin.
fn served(engine: &PersistentEngine, upstream: &str, garmin_id: i64) -> String {
    json!({
        "id": upstream,
        "start_date_local": start_of(engine, garmin_id),
        "type": "Ride",
        "name": "Long ride",
        "moving_time": 3600,
        "elapsed_time": 3600,
        "distance": 40_000.0,
        "icu_training_load": 61.0,
        "icu_ftp": 240,
        "source": "GARMIN_CONNECT",
        "external_id": garmin_id.to_string(),
    })
    .to_string()
}

fn sync_page(engine: &mut PersistentEngine, page: &[(String, String)]) {
    let rows: Vec<(String, i64, String)> = page
        .iter()
        .map(|(id, raw)| {
            let record: crate::net::intervals::wire::ActivityRecord =
                serde_json::from_str(raw).unwrap();
            let date =
                crate::objects::sync::start_date_to_timestamp(record.start_date_local.as_deref())
                    .unwrap();
            (id.clone(), date, raw.clone())
        })
        .collect();
    let ids: Vec<String> = page.iter().map(|(id, _)| id.clone()).collect();
    let metrics = rows
        .iter()
        .map(|(id, date, raw)| crate::net::intervals::metrics_from_body(raw, *date, id).unwrap())
        .collect();
    engine
        .store_synced_activity_bodies("athlete", &rows, &ids, metrics)
        .expect("page stores");
}

struct Figures {
    load: Option<f64>,
    mark: Option<String>,
    power_z4: f64,
}

fn figures(engine: &PersistentEngine, key: &str) -> Figures {
    engine
        .db
        .query_row(
            "SELECT training_load, metrics_source, power_z4 FROM activity_metrics
             WHERE activity_id = ?",
            [key],
            |r| {
                Ok(Figures {
                    load: r.get(0)?,
                    mark: r.get(1)?,
                    power_z4: r.get(2)?,
                })
            },
        )
        .unwrap()
}

fn body_of(engine: &PersistentEngine, key: &str) -> Value {
    serde_json::from_str(&engine.get_activity_body(key).expect("a body")).unwrap()
}

fn count(engine: &PersistentEngine, sql: &str) -> i64 {
    engine.db.query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
fn a_sync_that_links_two_rides_leaves_intervals_numbers_on_them_and_none_of_veloqs() {
    let (_dir, mut engine) = garmin_only_library();
    for id in RIDES {
        let key = garmin_source_key(id);
        assert_eq!(figures(&engine, &key).mark.as_deref(), Some("veloq"));
    }
    assert!(
        count(
            &engine,
            "SELECT COUNT(*) FROM wellness WHERE source = 'veloq'"
        ) > 0
    );
    assert!(
        count(
            &engine,
            "SELECT COUNT(*) FROM curve_bodies WHERE source = 'veloq'"
        ) > 0
    );
    assert!(count(&engine, "SELECT COUNT(*) FROM activity_curves") > 0);

    let page = [
        ("i501".to_owned(), served(&engine, "i501", RIDES[0])),
        ("i502".to_owned(), served(&engine, "i502", RIDES[1])),
    ];
    sync_page(&mut engine, &page);

    for (id, upstream) in [(RIDES[0], "i501"), (RIDES[1], "i502")] {
        let key = garmin_source_key(id);
        assert_eq!(engine.intervals_id(&key).as_deref(), Some(upstream));
        let shown = figures(&engine, &key);
        assert_eq!(shown.load, Some(61.0), "{key}: intervals.icu's load");
        assert_ne!(shown.mark.as_deref(), Some("veloq"), "{key}");
        assert_eq!(body_of(&engine, &key)["icu_training_load"], 61.0, "{key}");
        assert_eq!(engine.activity_metrics[&key].training_load, Some(61.0));
    }

    let third = garmin_source_key(RIDES[2]);
    let unserved = figures(&engine, &third);
    assert_eq!(
        unserved.load, None,
        "no figure until intervals.icu serves it"
    );
    assert_eq!(unserved.mark, None);
    assert_eq!(unserved.power_z4, 0.0);
    let body = body_of(&engine, &third);
    for key in [
        "icu_training_load",
        "icu_intensity",
        "icu_ftp",
        "metrics_source",
    ] {
        assert!(body.get(key).is_none(), "{key} left on the unserved ride");
    }
    assert_eq!(body["name"], "Long ride", "the rest of the body is kept");
    assert_eq!(engine.activity_metrics[&third].training_load, None);

    assert_eq!(
        count(
            &engine,
            "SELECT COUNT(*) FROM wellness WHERE source = 'veloq'"
        ),
        0
    );
    assert_eq!(
        count(
            &engine,
            "SELECT COUNT(*) FROM wellness WHERE ctl IS NOT NULL OR atl IS NOT NULL"
        ),
        0,
        "no fitness or fatigue is left from Veloq's series"
    );
    assert_eq!(
        count(
            &engine,
            "SELECT COUNT(*) FROM curve_bodies WHERE source = 'veloq'"
        ),
        0
    );
    assert_eq!(count(&engine, "SELECT COUNT(*) FROM activity_curves"), 0);
}

#[test]
fn an_unserved_ride_is_not_scored_again_in_a_library_that_holds_intervals() {
    let (_dir, mut engine) = garmin_only_library();
    let page = [("i501".to_owned(), served(&engine, "i501", RIDES[0]))];
    sync_page(&mut engine, &page);
    let third = garmin_source_key(RIDES[2]);

    assert!(!engine.settle_ride_metrics(&third).unwrap());
    assert_eq!(figures(&engine, &third).load, None);
    assert_eq!(
        crate::persistence::fitness::ride_metrics::owed_count(&engine.db).unwrap(),
        0,
        "the backfill owes nothing here"
    );
    assert_eq!(
        crate::persistence::fitness::fitness_series::refresh(&engine.db, "2026-04-01").unwrap(),
        0
    );
}

#[test]
fn a_library_with_no_intervals_activity_keeps_every_figure() {
    let (_dir, engine) = garmin_only_library();
    let before = count(
        &engine,
        "SELECT COUNT(*) FROM wellness WHERE source = 'veloq'",
    );

    let dropped = engine.drop_veloq_figures().unwrap();

    assert!(dropped.is_empty());
    assert_eq!(
        count(
            &engine,
            "SELECT COUNT(*) FROM wellness WHERE source = 'veloq'"
        ),
        before
    );
    for id in RIDES {
        assert_eq!(
            figures(&engine, &garmin_source_key(id)).mark.as_deref(),
            Some("veloq")
        );
    }
}

#[test]
fn a_wellness_day_with_figures_of_its_own_loses_only_the_entry_veloq_wrote() {
    let (_dir, mut engine) = garmin_only_library();
    engine
        .db
        .execute(
            "INSERT INTO wellness (date, hrv, resting_hr, raw)
             VALUES ('2026-02-01', 55.0, 48.0, ?1)",
            params![
                json!({
                    "comments": "slept well",
                    "sportInfo": [
                        {"type": "Ride", "eftp": 250.0, "source": "veloq"},
                        {"type": "Run", "load": 30.0}
                    ]
                })
                .to_string()
            ],
        )
        .unwrap();
    engine
        .db
        .execute(
            "INSERT INTO wellness (date, raw) VALUES ('2026-02-02', ?1)",
            params![
                json!({
                    "sportInfo": [{"type": "Ride", "eftp": 240.0, "source": "veloq"}]
                })
                .to_string()
            ],
        )
        .unwrap();
    engine
        .db
        .execute(
            "INSERT INTO wellness (date, ctl, atl, source) VALUES ('2026-02-03', 40.0, 30.0, NULL)",
            [],
        )
        .unwrap();
    let page = [("i501".to_owned(), served(&engine, "i501", RIDES[0]))];
    sync_page(&mut engine, &page);

    let (hrv, resting, raw): (Option<f64>, Option<f64>, String) = engine
        .db
        .query_row(
            "SELECT hrv, resting_hr, raw FROM wellness WHERE date = '2026-02-01'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!((hrv, resting), (Some(55.0), Some(48.0)));
    let body: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(body["comments"], "slept well");
    assert_eq!(body["sportInfo"], json!([{"type": "Run", "load": 30.0}]));

    assert_eq!(
        count(
            &engine,
            "SELECT COUNT(*) FROM wellness WHERE date = '2026-02-02'"
        ),
        0,
        "a day holding nothing but Veloq's entry is gone"
    );
    assert_eq!(
        count(
            &engine,
            "SELECT COUNT(*) FROM wellness WHERE date = '2026-02-03' AND ctl = 40.0"
        ),
        1,
        "a day intervals.icu served keeps its figures"
    );
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_wellness_day_intervals_serves_stops_being_marked_as_veloqs() {
    let (_dir, mut engine) = garmin_only_library();
    let day = engine
        .db
        .query_row(
            "SELECT MIN(date) FROM wellness WHERE source = 'veloq'",
            [],
            |r| r.get::<_, String>(0),
        )
        .unwrap();

    engine
        .upsert_wellness(&[crate::persistence::wellness::WellnessRow {
            date: day.clone(),
            ctl: Some(70.0),
            atl: Some(60.0),
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
        }])
        .unwrap();

    let (ctl, source): (Option<f64>, Option<String>) = engine
        .db
        .query_row(
            "SELECT ctl, source FROM wellness WHERE date = ?1",
            [&day],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(ctl, Some(70.0));
    assert_eq!(source, None);
}

#[test]
fn a_second_page_drops_nothing_more() {
    let (_dir, mut engine) = garmin_only_library();
    let page = [("i501".to_owned(), served(&engine, "i501", RIDES[0]))];
    sync_page(&mut engine, &page);
    let third = garmin_source_key(RIDES[2]);
    let before = body_of(&engine, &third);

    sync_page(&mut engine, &page);

    assert_eq!(body_of(&engine, &third), before);
    assert!(engine.drop_veloq_figures().unwrap().is_empty());
}

#[test]
fn a_ride_intervals_holds_as_a_stub_loses_veloqs_figures_and_keeps_its_own_body() {
    let (_dir, mut engine) = garmin_only_library();
    let stub = json!({
        "id": "i501",
        "start_date_local": start_of(&engine, RIDES[0]),
        "type": "Ride",
        "source": "GARMIN_CONNECT",
        "external_id": RIDES[0].to_string(),
        "_note": "not available via the API"
    })
    .to_string();

    sync_page(&mut engine, &[("i501".to_owned(), stub)]);

    let key = garmin_source_key(RIDES[0]);
    assert_eq!(engine.intervals_id(&key).as_deref(), Some("i501"));
    let shown = figures(&engine, &key);
    assert_eq!((shown.load, shown.mark), (None, None));
    let body = body_of(&engine, &key);
    assert_eq!(body["name"], "Long ride", "the original's own body is kept");
    assert!(body.get("icu_training_load").is_none());
    assert!(body.get("metrics_source").is_none());
}

fn name_library(engine: &PersistentEngine, athlete: &str) {
    engine.set_setting("__athlete_id", athlete).unwrap();
}

/// A Garmin library that intervals.icu adopted and served two of its rides,
/// then signed out and came back by the same Garmin account.
fn returned_library() -> (TempDir, PersistentEngine) {
    let (dir, mut engine) = garmin_only_library();
    name_library(&engine, "garmin:8841");
    name_library(&engine, "i77");
    let page = [
        ("i501".to_owned(), served(&engine, "i501", RIDES[0])),
        ("i502".to_owned(), served(&engine, "i502", RIDES[1])),
    ];
    sync_page(&mut engine, &page);
    name_library(&engine, "garmin:8841");
    (dir, engine)
}

#[test]
fn a_returned_library_scores_its_unserved_rides_and_leaves_intervals_numbers() {
    let (_dir, mut engine) = returned_library();
    let third = garmin_source_key(RIDES[2]);
    assert_eq!(figures(&engine, &third).load, None);

    assert!(crate::persistence::fitness::curves_local::is_garmin_only(&engine.db).unwrap());
    let mut attempted = std::collections::HashSet::new();
    assert!(
        engine
            .backfill_ride_metrics_page(&mut attempted, 25)
            .unwrap()
            > 0,
        "the unserved ride is owed work"
    );

    let scored = figures(&engine, &third);
    assert!(scored.load.is_some());
    assert_eq!(scored.mark.as_deref(), Some("veloq"));
    for id in &RIDES[..2] {
        let key = garmin_source_key(*id);
        let kept = figures(&engine, &key);
        assert_eq!(kept.load, Some(61.0), "{key}: intervals.icu's load");
        assert_eq!(kept.mark.as_deref(), Some("intervals"), "{key}");
        assert_eq!(body_of(&engine, &key)["icu_training_load"], 61.0, "{key}");
    }
}

#[test]
fn a_returned_library_folds_the_series_and_builds_the_curves_again() {
    let (_dir, mut engine) = returned_library();
    let mut attempted = std::collections::HashSet::new();
    engine
        .backfill_ride_metrics_page(&mut attempted, 25)
        .unwrap();

    let folded =
        crate::persistence::fitness::fitness_series::refresh(&engine.db, "2026-04-01").unwrap();
    crate::persistence::fitness::curves_local::refresh(&engine.db, 1_775_000_000).unwrap();

    assert!(folded > 0, "the series folds the days");
    assert!(
        count(
            &engine,
            "SELECT COUNT(*) FROM wellness WHERE source = 'veloq'"
        ) > 0
    );
    assert!(
        count(
            &engine,
            "SELECT COUNT(*) FROM curve_bodies WHERE source = 'veloq'"
        ) > 0
    );
}

#[test]
fn a_returned_library_keeps_a_cycling_eftp_intervals_wrote() {
    let (_dir, engine) = returned_library();
    engine
        .db
        .execute(
            "INSERT INTO wellness (date, raw) VALUES ('2026-03-14', ?1)",
            params![json!({"sportInfo": [{"type": "Ride", "eftp": 261.0}]}).to_string()],
        )
        .unwrap();

    crate::persistence::fitness::curves_local::refresh(&engine.db, 1_775_000_000).unwrap();

    let raw: String = engine
        .db
        .query_row(
            "SELECT raw FROM wellness WHERE date = '2026-03-14'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let body: Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(body["sportInfo"], json!([{"type": "Ride", "eftp": 261.0}]));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_library_still_named_for_garmin_under_intervals_rows_is_dropped_as_before() {
    let (_dir, mut engine) = garmin_only_library();
    name_library(&engine, "garmin:8841");
    let page = [("i501".to_owned(), served(&engine, "i501", RIDES[0]))];

    sync_page(&mut engine, &page);

    let third = garmin_source_key(RIDES[2]);
    assert_eq!(figures(&engine, &third).load, None);
    assert!(!crate::persistence::fitness::curves_local::is_garmin_only(&engine.db).unwrap());
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn leaving_a_garmin_identity_records_the_account_the_library_held() {
    let (_dir, engine) = engine();
    name_library(&engine, "garmin:8841");
    assert_eq!(engine.get_setting("__garmin_library_id").unwrap(), None);

    name_library(&engine, "i77");

    assert_eq!(
        engine
            .get_setting("__garmin_library_id")
            .unwrap()
            .as_deref(),
        Some("garmin:8841")
    );
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn an_identity_that_was_never_garmin_or_that_leaves_for_demo_records_nothing() {
    let (_dir, engine) = engine();
    name_library(&engine, "i77");
    name_library(&engine, "i88");
    assert_eq!(engine.get_setting("__garmin_library_id").unwrap(), None);

    name_library(&engine, "garmin:8841");
    name_library(&engine, "demo");
    name_library(&engine, "garmin:9000");

    assert_eq!(engine.get_setting("__garmin_library_id").unwrap(), None);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_ffi_settings_write_records_it_too() {
    let (_dir, engine) = engine();
    crate::persistence::settings::set_settings_on(
        &engine.db,
        &[("__athlete_id".to_owned(), "garmin:8841".to_owned())],
    )
    .unwrap();
    crate::persistence::settings::set_settings_on(
        &engine.db,
        &[("__athlete_id".to_owned(), "i77".to_owned())],
    )
    .unwrap();

    assert_eq!(
        engine
            .get_setting("__garmin_library_id")
            .unwrap()
            .as_deref(),
        Some("garmin:8841")
    );
}

fn wellness_day(date: &str, hrv: f64) -> crate::persistence::wellness::WellnessRow {
    crate::persistence::wellness::WellnessRow {
        date: date.to_owned(),
        ctl: None,
        atl: None,
        ramp_rate: None,
        hrv: Some(hrv),
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
    }
}

#[test]
fn a_wellness_page_with_no_activity_ends_the_garmin_only_library_and_drops_veloqs_figures() {
    let (_dir, mut engine) = garmin_only_library();
    assert!(
        count(
            &engine,
            "SELECT COUNT(*) FROM wellness WHERE source = 'veloq'"
        ) > 0
    );
    assert!(crate::persistence::fitness::curves_local::is_garmin_only(&engine.db).unwrap());

    engine
        .upsert_wellness(&[wellness_day("2025-12-01", 55.0)])
        .unwrap();

    assert!(!crate::persistence::fitness::curves_local::is_garmin_only(&engine.db).unwrap());
    assert_eq!(
        count(
            &engine,
            "SELECT COUNT(*) FROM wellness WHERE source = 'veloq'"
        ),
        0
    );
    for id in RIDES {
        assert_eq!(figures(&engine, &garmin_source_key(id)).mark, None);
    }
    assert_eq!(count(&engine, "SELECT COUNT(*) FROM wellness"), 1);
}

#[test]
fn veloqs_own_wellness_days_do_not_end_the_garmin_only_library() {
    let (_dir, engine) = garmin_only_library();
    assert!(count(&engine, "SELECT COUNT(*) FROM wellness") > 0);
    assert!(crate::persistence::fitness::curves_local::is_garmin_only(&engine.db).unwrap());
}
