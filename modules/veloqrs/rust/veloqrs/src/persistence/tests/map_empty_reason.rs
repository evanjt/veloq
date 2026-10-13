//! Scenario: the map tab draws a bare basemap whenever nothing in the window
//! has a track, and an empty map has several causes that end differently: an
//! empty period needs a wider one, trainer sessions never draw, a download in
//! flight will, and filters that hide every track need loosening.
//!
//! Expected behaviour: the map read names the cause once, from the window's
//! own counts, and names none while the map draws anything.

use super::pooled::map_empty_reason;
use crate::FfiMapEmptyReason;
use crate::persistence::PersistentEngine;
use tracematch::GpsPoint;

const WINDOW_START: i64 = 1_699_000_000;
const WINDOW_END: i64 = 1_701_000_000;

fn ride(id: &str, date: i64) -> crate::types::ActivityMetrics {
    crate::types::ActivityMetrics {
        activity_id: id.into(),
        name: id.into(),
        date,
        distance: 20_000.0,
        moving_time: 3_600,
        elapsed_time: 3_700,
        elevation_gain: 0.0,
        avg_hr: None,
        avg_power: None,
        sport_type: "Ride".into(),
        training_load: None,
        ftp: None,
        power_zone_times: None,
        hr_zone_times: None,
    }
}

fn census(engine: &PersistentEngine, id: &str, has_latlng: bool) {
    engine
        .db
        .execute(
            "INSERT INTO activity_census
                 (athlete_id, intervals_id, start_date_local, icu_sync_date, has_latlng)
             VALUES ('athlete', ?1, '2023-11-14T22:13:20', 'v1', ?2)",
            rusqlite::params![id, has_latlng],
        )
        .expect("census row");
}

fn track(engine: &mut PersistentEngine, id: &str) {
    let points: Vec<GpsPoint> = (0..8)
        .map(|i| GpsPoint::new(46.2 + f64::from(i) * 0.001, 7.35))
        .collect();
    engine
        .add_activity(id.into(), points, "Ride".into())
        .expect("track");
}

fn reason(engine: &PersistentEngine, sport_types: Vec<String>) -> Option<FfiMapEmptyReason> {
    engine
        .map_screen_data(
            WINDOW_START,
            WINDOW_END,
            sport_types,
            crate::MapDistanceBand::All,
            true,
            false,
            false,
            String::new(),
        )
        .empty_reason
}

fn with_engine(name: &str, body: impl FnOnce(&mut PersistentEngine)) {
    let _serial = crate::test_globals::serial_global_state();
    let dir = tempfile::TempDir::new().expect("tempdir");
    let path = dir.path().join(name);
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    body(&mut engine);
    crate::persistence::read_cache::close();
}

#[test]
fn a_window_with_no_activity_names_the_period() {
    with_engine("map_empty_period.db", |engine| {
        engine
            .set_activity_metrics(vec![ride("before", WINDOW_START - 86_400)])
            .expect("metrics");
        assert_eq!(
            reason(engine, vec![]),
            Some(FfiMapEmptyReason::NoActivities)
        );
    });
}

#[test]
fn activities_whose_census_has_no_gps_name_the_missing_gps() {
    with_engine("map_empty_no_gps.db", |engine| {
        engine
            .set_activity_metrics(vec![
                ride("trainer", 1_700_000_000),
                ride("pool", 1_700_000_100),
            ])
            .expect("metrics");
        census(engine, "trainer", false);
        assert_eq!(
            reason(engine, vec![]),
            Some(FfiMapEmptyReason::NoGps { activities: 2 })
        );
    });
}

#[test]
fn a_track_the_census_says_is_upstream_names_the_download() {
    with_engine("map_empty_pending.db", |engine| {
        engine
            .set_activity_metrics(vec![
                ride("outdoor", 1_700_000_000),
                ride("indoor", 1_700_000_100),
            ])
            .expect("metrics");
        census(engine, "outdoor", true);
        census(engine, "indoor", false);
        assert_eq!(
            reason(engine, vec![]),
            Some(FfiMapEmptyReason::TracksPending {
                activities: 2,
                pending: 1
            })
        );
    });
}

#[test]
fn a_track_refused_for_good_is_not_pending() {
    with_engine("map_empty_refused.db", |engine| {
        engine
            .set_activity_metrics(vec![ride("outdoor", 1_700_000_000)])
            .expect("metrics");
        census(engine, "outdoor", true);
        engine
            .db
            .execute(
                "UPDATE activity_census
                 SET track_refusal = 'no_track', track_refused_sync_date = 'v1'",
                [],
            )
            .expect("refusal");
        assert_eq!(
            reason(engine, vec![]),
            Some(FfiMapEmptyReason::NoGps { activities: 1 })
        );
    });
}

#[test]
fn filters_that_hide_every_track_name_the_filters_and_none_while_one_draws() {
    with_engine("map_empty_filtered.db", |engine| {
        engine
            .set_activity_metrics(vec![ride("drawn", 1_700_000_000)])
            .expect("metrics");
        track(engine, "drawn");
        assert_eq!(reason(engine, vec![]), None);
        assert_eq!(
            reason(engine, vec!["Run".into()]),
            Some(FfiMapEmptyReason::Filtered { mapped: 1 })
        );
    });
}

#[test]
fn the_reason_ranks_filters_over_the_download_and_the_download_over_no_gps() {
    assert_eq!(
        map_empty_reason(0, 0, 0, 0),
        Some(FfiMapEmptyReason::NoActivities)
    );
    assert_eq!(map_empty_reason(5, 2, 1, 3), None);
    assert_eq!(
        map_empty_reason(5, 2, 0, 3),
        Some(FfiMapEmptyReason::Filtered { mapped: 2 })
    );
    assert_eq!(
        map_empty_reason(5, 0, 0, 3),
        Some(FfiMapEmptyReason::TracksPending {
            activities: 5,
            pending: 3
        })
    );
    assert_eq!(
        map_empty_reason(5, 0, 0, 0),
        Some(FfiMapEmptyReason::NoGps { activities: 5 })
    );
}
