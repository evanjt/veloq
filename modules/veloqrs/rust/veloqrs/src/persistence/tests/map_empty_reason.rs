//! Scenario: the map tab draws a bare basemap whenever nothing in the window
//! has a track, and an empty map has several causes that end differently: an
//! empty period needs a wider one, trainer sessions never draw, a download in
//! flight will, and filters that hide every track need loosening.
//!
//! Expected behaviour: the map read names the cause once, from the window's
//! own counts, and names none while the map draws anything.

use super::pooled::map_empty_reason;
use crate::persistence::PersistentEngine;
use crate::{FfiMapEmptyReason, FfiMapUnmapped};
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

fn read(
    engine: &PersistentEngine,
    sport_types: Vec<String>,
    name_needle: &str,
) -> crate::FfiMapScreenData {
    engine.map_screen_data(
        WINDOW_START,
        WINDOW_END,
        sport_types,
        crate::MapDistanceBand::All,
        true,
        false,
        false,
        name_needle.into(),
    )
}

fn reason(engine: &PersistentEngine, sport_types: Vec<String>) -> Option<FfiMapEmptyReason> {
    read(engine, sport_types, "").empty_reason
}

fn unmapped(without_gps: u32, downloading: u32) -> FfiMapUnmapped {
    FfiMapUnmapped {
        without_gps,
        downloading,
    }
}

fn refuse(engine: &PersistentEngine, id: &str, refusal: &str) {
    engine
        .db
        .execute(
            "UPDATE activity_census
             SET track_refusal = ?2, track_refused_sync_date = icu_sync_date
             WHERE intervals_id = ?1",
            rusqlite::params![id, refusal],
        )
        .expect("refusal");
}

/// Two drawn rides, a strength session with no GPS upstream, a ride whose
/// track is still owed and one whose track was refused as too short.
fn mixed_window(engine: &mut PersistentEngine) {
    let mut strength = ride("strength", 1_700_000_200);
    strength.sport_type = "WeightTraining".into();
    engine
        .set_activity_metrics(vec![
            ride("drawn-a", 1_700_000_000),
            ride("drawn-b", 1_700_000_100),
            strength,
            ride("owed", 1_700_000_300),
            ride("short", 1_700_000_400),
            ride("outside", WINDOW_END + 86_400),
        ])
        .expect("metrics");
    track(engine, "drawn-a");
    track(engine, "drawn-b");
    census(engine, "strength", false);
    census(engine, "owed", true);
    census(engine, "short", true);
    census(engine, "outside", true);
    refuse(engine, "short", "too_short");
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

#[test]
fn the_window_counts_what_it_cannot_draw_beside_what_it_draws() {
    with_engine("map_unmapped_mixed.db", |engine| {
        mixed_window(engine);
        let data = read(engine, vec![], "");
        assert_eq!(data.activities.len(), 2);
        assert_eq!(data.unmapped, unmapped(2, 1));
        assert_eq!(data.empty_reason, None);
    });
}

#[test]
fn the_sport_filter_narrows_the_unmapped_counts_as_it_narrows_the_drawn_set() {
    with_engine("map_unmapped_sport.db", |engine| {
        mixed_window(engine);
        let data = read(engine, vec!["Ride".into()], "");
        assert_eq!(data.activities.len(), 2);
        assert_eq!(data.unmapped, unmapped(1, 1));
    });
}

#[test]
fn a_name_that_matches_nothing_counts_nothing_unmapped() {
    with_engine("map_unmapped_needle.db", |engine| {
        mixed_window(engine);
        let data = read(engine, vec![], "no such ride");
        assert!(data.activities.is_empty());
        assert_eq!(data.unmapped, unmapped(0, 0));
        assert_eq!(
            data.empty_reason,
            Some(FfiMapEmptyReason::Filtered { mapped: 2 })
        );
    });
}

#[test]
fn an_empty_window_counts_nothing_unmapped() {
    with_engine("map_unmapped_empty.db", |engine| {
        engine
            .set_activity_metrics(vec![ride("before", WINDOW_START - 86_400)])
            .expect("metrics");
        census(engine, "before", true);
        let data = read(engine, vec![], "");
        assert_eq!(data.unmapped, unmapped(0, 0));
        assert_eq!(data.empty_reason, Some(FfiMapEmptyReason::NoActivities));
    });
}

#[test]
fn a_window_still_downloading_counts_every_activity_as_downloading() {
    with_engine("map_unmapped_downloading.db", |engine| {
        engine
            .set_activity_metrics(vec![
                ride("first", 1_700_000_000),
                ride("second", 1_700_000_100),
                ride("third", 1_700_000_200),
            ])
            .expect("metrics");
        for id in ["first", "second", "third"] {
            census(engine, id, true);
        }
        let data = read(engine, vec![], "");
        assert_eq!(data.unmapped, unmapped(0, 3));
        assert_eq!(
            data.empty_reason,
            Some(FfiMapEmptyReason::TracksPending {
                activities: 3,
                pending: 3
            })
        );
    });
}

#[test]
fn a_track_given_up_on_counts_as_without_gps() {
    with_engine("map_unmapped_failed.db", |engine| {
        engine
            .set_activity_metrics(vec![ride("flaky", 1_700_000_000)])
            .expect("metrics");
        census(engine, "flaky", true);
        engine
            .db
            .execute(
                "UPDATE activity_census
                 SET track_fetch_failures = ?1, track_failed_sync_date = icu_sync_date",
                [crate::persistence::activities::TRACK_FAILURE_LIMIT],
            )
            .expect("failures");
        let data = read(engine, vec![], "");
        assert_eq!(data.unmapped, unmapped(1, 0));
        assert_eq!(
            data.empty_reason,
            Some(FfiMapEmptyReason::NoGps { activities: 1 })
        );
    });
}
