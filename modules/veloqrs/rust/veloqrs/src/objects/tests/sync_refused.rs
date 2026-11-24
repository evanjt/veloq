//! Scenario: intervals.icu refuses every request for quota, with a
//! `Retry-After`, while the library holds activities, a section, a route
//! group and a recording.
//!
//! Expected behaviour: every screen read still answers from the library, the
//! same rows as before the refusal; the process governor holds a cooldown the
//! length the server asked for; the sync status names the instant downloads
//! resume and reads as rate limited and idle; and the next default sync is
//! held until that instant without sending a request.

use super::*;
use crate::MapDistanceBand;
use crate::governor::{GOVERNOR, Governor};
use crate::objects::error::with_reader;
use crate::persistence::screens::{self, pooled as screen_reads};
use crate::persistence::strength::FitOutcome;
use crate::persistence::with_persistent_engine;
use crate::sections::CreateSectionParams;
use crate::test_globals::{init_global_engine, serial_global_state};
use httpmock::prelude::*;
use std::collections::BTreeSet;
use tracematch::GpsPoint;

const DAY: i64 = 86_400;
const ACTIVITIES: usize = 8;
const ACTIVITIES_PER_SECTION: usize = 4;
const POINTS_PER_TRACK: usize = 100;
const STRENGTH_SESSIONS: usize = 1;
const STRENGTH_CATEGORY: u16 = 7;
const WELLNESS_DAYS: i64 = 10;
const RETRY_AFTER_SECS: i64 = 600;

fn track(seed: usize) -> Vec<GpsPoint> {
    let seed = seed - seed % ACTIVITIES_PER_SECTION;
    let base_lat = 46.0 + (seed % 20) as f64 * 0.05;
    let base_lng = 7.0 + (seed / 20) as f64 * 0.05;
    (0..POINTS_PER_TRACK)
        .map(|i| GpsPoint {
            latitude: base_lat + i as f64 * 0.0001,
            longitude: base_lng,
            elevation: Some(500.0 + i as f64),
        })
        .collect()
}

fn ride_id(i: usize) -> String {
    format!("a{i}")
}

/// Rides on shared tracks, four to a track with a section on each, and one
/// recording, in the engine the test opened.
fn seed_library(now: i64) {
    with_persistent_engine(|engine| {
        for i in 0..ACTIVITIES {
            let id = ride_id(i);
            let date = now - (i as i64 + 1) * DAY;
            engine
                .add_activity(id.clone(), track(i), "Ride".into())
                .expect("add activity");
            engine
                .update_activity_metadata(&id, Some(date), Some("ride"), Some(12_345.0), Some(3_600))
                .expect("metadata");
            engine
                .set_activity_metrics(vec![crate::ActivityMetrics {
                    activity_id: id.clone(),
                    name: format!("Ride {i}"),
                    date,
                    distance: 12_345.0,
                    moving_time: 3_600,
                    elapsed_time: 3_700,
                    elevation_gain: 100.0,
                    sport_type: "Ride".into(),
                    ..crate::ActivityMetrics::default()
                }])
                .expect("metrics");
            engine
                .upsert_activity_bodies(&[(
                    id.clone(),
                    date,
                    format!(
                        r#"{{"id":"{id}","name":"Ride {i}","type":"Ride","distance":12345.0,"moving_time":3600,"elapsed_time":3700,"total_elevation_gain":100.0,"stream_types":["latlng","time"]}}"#
                    ),
                )])
                .expect("body");
            if i % ACTIVITIES_PER_SECTION == 0 {
                engine
                    .create_section(CreateSectionParams {
                        sport_type: "Ride".into(),
                        polyline: track(i),
                        distance_meters: 1_100.0,
                        name: Some(format!("Section {i}")),
                        source_activity_id: Some(id.clone()),
                        start_index: Some(0),
                        end_index: Some(POINTS_PER_TRACK as u32 - 1),
                    })
                    .expect("create section");
            }
        }
        for i in 0..STRENGTH_SESSIONS {
            let id = format!("s{i}");
            let date = now - 2 * DAY;
            engine
                .add_activity(id.clone(), track(ACTIVITIES + i), "WeightTraining".into())
                .expect("add strength session");
            engine
                .update_activity_metadata(&id, Some(date), Some("Strength"), None, Some(3_600))
                .expect("metadata");
            engine
                .set_activity_metrics(vec![crate::ActivityMetrics {
                    activity_id: id.clone(),
                    name: "Strength".into(),
                    date,
                    moving_time: 3_600,
                    elapsed_time: 3_700,
                    sport_type: "WeightTraining".into(),
                    ..crate::ActivityMetrics::default()
                }])
                .expect("metrics");
            engine
                .upsert_activity_bodies(&[(
                    id.clone(),
                    date,
                    format!(
                        r#"{{"id":"{id}","name":"Strength","type":"WeightTraining","distance":0.0,"moving_time":3600,"elapsed_time":3700,"total_elevation_gain":0.0}}"#
                    ),
                )])
                .expect("body");
            engine
                .store_exercise_sets(
                    &id,
                    &[crate::fit::FitExerciseSet {
                        set_order: 0,
                        exercise_category: STRENGTH_CATEGORY,
                        exercise_name: None,
                        set_type: 0,
                        repetitions: Some(8),
                        weight_kg: Some(40.0),
                        duration_secs: None,
                        start_time: None,
                    }],
                )
                .expect("sets");
            engine
                .mark_fit_outcome(&id, FitOutcome::Parsed)
                .expect("fit outcome");
        }
        let today = chrono::NaiveDate::parse_from_str(
            &crate::persistence::wellness::today_iso(),
            "%Y-%m-%d",
        )
        .expect("today is an ISO date");
        let wellness: Vec<crate::persistence::wellness::WellnessRow> = (0..WELLNESS_DAYS)
            .map(|back| crate::persistence::wellness::WellnessRow {
                date: (today - chrono::Duration::days(back)).to_string(),
                ctl: Some(50.0 + back as f64),
                atl: Some(60.0 - back as f64),
                ramp_rate: Some(1.5),
                hrv: Some(70.0 + back as f64),
                resting_hr: Some(48.0),
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
        engine.upsert_wellness(&wellness).expect("wellness");

        engine.load().expect("load");
        assert!(!engine.get_groups().is_empty(), "the seed has no route group");
        engine
            .insert_recording(&crate::persistence::recordings::FfiRecordingEntry {
                id: "r1".into(),
                kind: "fit".into(),
                fit_path: "/recordings/r1.fit".into(),
                streams_path: None,
                activity_type: "Ride".into(),
                name: "Evening ride".into(),
                start_time: (now * 1_000) as f64,
                duration_seconds: 3_600.0,
                distance_meters: 20_000.0,
                elevation_gain: None,
                avg_heartrate: None,
                paired_event_id: None,
                created_at: (now * 1_000) as f64,
                upload_status: "pending".into(),
                retry_count: 0,
                last_attempt_at: None,
                last_error: None,
                intervals_activity_id: None,
                engine_activity_id: None,
                engine_reconciled: false,
                athlete_id: None,
                notes: None,
                rpe: None,
                rpe_sent: false,
            })
            .expect("recording");
    })
    .expect("engine");
}

fn range(now: i64, days: i64) -> crate::FfiTimestampRange {
    crate::FfiTimestampRange {
        start_ts: (now - days * DAY) as f64,
        end_ts: now as f64,
    }
}

fn insights_params(now: i64) -> crate::FfiInsightsParams {
    crate::FfiInsightsParams {
        history_limit: 20,
        current_start: (now - 7 * DAY) as f64,
        current_end: now as f64,
        prev_start: (now - 14 * DAY) as f64,
        prev_end: (now - 7 * DAY) as f64,
        chronic_start: (now - 35 * DAY) as f64,
        today_start: (now - DAY) as f64,
        include_sections: true,
        ranked_limit: 50,
        active_window_days: 90,
        efficiency_per_sport: 5,
        efficiency_min_hr_change_bpm: 1,
        efficiency_limit: 2,
        efficiency_min_efforts: 3,
        efficiency_declining_min_efforts: 5,
        strength_month: range(now, 28),
        strength_weeks: vec![range(now, 7)],
        wellness_oldest: "2020-01-01".into(),
        wellness_newest: "2099-12-31".into(),
        hrv_window_days: 7,
        section_change_window_days: 14,
        stale_threshold_days: 30,
        stale_min_gain_percent: 3.0,
        stale_max_opportunities: 3,
        stale_min_traversals: 1,
        recent_pr_window_days: 7,
        recent_pr_min_outings: 3,
    }
}

/// What each screen read answered: the rows the list screens carry, and the
/// fitness, insights, strength and settings screens whole, as they serialise.
#[derive(Debug, PartialEq)]
struct Rows {
    feed: Vec<String>,
    map_activities: BTreeSet<String>,
    route_lines: BTreeSet<String>,
    map_sections: BTreeSet<String>,
    route_groups: BTreeSet<String>,
    section_ids: BTreeSet<String>,
    recordings: Vec<String>,
    library_sports: Vec<String>,
    activity_detail_count: u32,
    section_detail_activities: usize,
    wellness_dates: Vec<String>,
    fitness: serde_json::Value,
    insights: serde_json::Value,
    strength: serde_json::Value,
    backup: serde_json::Value,
    cache: serde_json::Value,
    thresholds: serde_json::Value,
}

fn whole<T: serde::Serialize>(screen: &T) -> serde_json::Value {
    serde_json::to_value(screen).expect("the screen serialises")
}

/// Every screen read of the app against the library, each required to answer
/// `Ok`.
fn read_every_screen(now: i64) -> Rows {
    let route_query = || crate::FfiRoutesScreenQuery {
        group_limit: 10,
        section_limit: 10,
        min_group_activity_count: 2,
        ..Default::default()
    };
    let windows = crate::FfiFitnessScreenWindows {
        heatmap_first_day: "2020-01-01".into(),
        heatmap_last_day: "2099-12-31".into(),
        months: range(now, 730),
        now_wall_seconds: now as f64,
    };
    let feed = with_reader(|conn| {
        crate::persistence::activities::pooled::feed_card_page(
            conn,
            &crate::FfiActivityBodiesQuery {
                oldest_ts: None,
                newest_ts: None,
                needle: String::new(),
                sport_families: vec![],
                offset: 0,
                limit: None,
                min_distance: None,
                max_distance: None,
                min_moving_time: None,
                max_moving_time: None,
                sort: None,
            },
        )
    })
    .expect("pool")
    .expect("feed answers");
    let map = with_reader(|conn| {
        screen_reads::map_screen_data(
            conn,
            now - 365 * DAY,
            now,
            vec![],
            MapDistanceBand::All,
            true,
            screen_reads::MapLayers {
                route_lines: Some(None),
                sections: Some(None),
            },
            String::new(),
        )
    })
    .expect("map answers");
    let route_screen =
        with_reader(|conn| crate::persistence::pooled_routes_screen_data(conn, route_query()))
            .expect("routes answer");
    let detail = with_reader(|conn| screen_reads::activity_detail_data(conn, &ride_id(0), 2))
        .expect("activity detail answers");
    let section_id = route_screen
        .sections
        .first()
        .map(|s| s.id.clone())
        .expect("the library has a section");
    let section = with_reader(|conn| screen_reads::section_detail_data(conn, &section_id))
        .expect("section detail answers");
    let fitness = with_reader(|conn| {
        screen_reads::fitness_screen_data(
            conn,
            &crate::persistence::wellness::today_iso(),
            &[7, 30, 90],
            &windows,
        )
    })
    .expect("pool")
    .expect("fitness answers");
    let insights = with_reader(|conn| screen_reads::insights_data(conn, &insights_params(now)))
        .expect("insights answer");
    let strength = with_reader(|conn| {
        crate::objects::strength::strength_screen_from(
            conn,
            now - 28 * DAY,
            now,
            vec![range(now, 7)],
        )
    })
    .expect("pool")
    .expect("strength answers");
    let backup = with_reader(screens::backup_screen_data)
        .expect("pool")
        .expect("backup settings");
    let cache = with_reader(screens::cache_screen_data)
        .expect("pool")
        .expect("cache settings");
    let thresholds = with_reader(screens::thresholds_screen_data).expect("thresholds");
    let wellness = with_reader(|conn| {
        crate::persistence::wellness::pooled::wellness_days(conn, "2020-01-01", "2099-12-31")
    })
    .expect("pool")
    .expect("wellness answers");
    let record = with_reader(screens::record_screen_data)
        .expect("pool")
        .expect("record screen");
    let listed = with_reader(crate::persistence::recordings::pooled::list)
        .expect("pool")
        .expect("recordings answer");

    Rows {
        feed: feed.cards.iter().map(|c| c.id.clone()).collect(),
        map_activities: map
            .activities
            .iter()
            .map(|a| a.activity_id.clone())
            .collect(),
        route_lines: map
            .route_lines
            .and_then(|layer| layer.routes)
            .unwrap_or_default()
            .into_iter()
            .map(|r| r.route_id)
            .collect(),
        map_sections: map
            .sections
            .and_then(|layer| layer.sections)
            .unwrap_or_default()
            .into_iter()
            .map(|s| s.id)
            .collect(),
        route_groups: route_screen
            .groups
            .iter()
            .map(|g| g.group_id.clone())
            .collect(),
        section_ids: route_screen.sections.iter().map(|s| s.id.clone()).collect(),
        recordings: listed.into_iter().map(|r| r.id).collect(),
        library_sports: record.library_sports,
        activity_detail_count: detail.activity_count,
        section_detail_activities: section.activity_rows.len(),
        wellness_dates: wellness.into_iter().map(|day| day.date).collect(),
        fitness: whole(&fitness),
        insights: whole(&insights),
        strength: whole(&strength),
        backup: whole(&backup),
        cache: whole(&cache),
        thresholds: whole(&thresholds),
    }
}

/// Answer every path with the refusal the quota's spent state draws.
fn refuse_everything(server: &MockServer) -> httpmock::Mock<'_> {
    server.mock(|when, then| {
        when.any_request();
        then.status(429)
            .header("via", "1.1 Caddy")
            .header("Retry-After", RETRY_AFTER_SECS.to_string());
    })
}

#[test]
fn every_screen_answers_from_the_library_while_the_quota_is_refused() {
    let _serial = serial_global_state();
    let _engine_dir = init_global_engine("refused.db");
    let _budget = GOVERNOR.live_budget();

    let now = chrono::Utc::now().timestamp();
    seed_library(now);
    SYNC_SERVICE.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());

    // The first read of a library fills lazy derived caches, so the rows the
    // refusal is compared against are the second read's.
    read_every_screen(now);
    let before = read_every_screen(now);
    let sessions = ACTIVITIES + STRENGTH_SESSIONS;
    assert_eq!(before.feed.len(), sessions, "the feed holds the sessions");
    assert_eq!(before.map_activities.len(), sessions);
    assert!(!before.route_lines.is_empty(), "the route layer is on");
    assert!(!before.map_sections.is_empty(), "the section layer is on");
    assert!(!before.route_groups.is_empty());
    assert_eq!(before.recordings, vec!["r1".to_string()]);
    assert_eq!(
        before.library_sports,
        vec!["Ride".to_string(), "WeightTraining".to_string()]
    );
    assert!(before.activity_detail_count > 0);
    assert!(before.section_detail_activities > 0);
    assert_eq!(
        before.wellness_dates.len(),
        WELLNESS_DAYS as usize,
        "the wellness days are the library's"
    );
    assert!(
        before.strength["exercises"]
            .as_array()
            .is_some_and(|exercises| !exercises.is_empty()),
        "the strength screen carries the session's sets"
    );

    let server = MockServer::start();
    let refusals = refuse_everything(&server);
    assert!(SYNC_SERVICE.try_begin(), "nothing else holds the sync slot");
    let asked_at = chrono::Utc::now();
    let gov: Arc<Governor> = GOVERNOR.clone();
    let transport = Transport::with_governor(server.base_url(), AuthMethod::ApiKey("k"), gov)
        .expect("transport");
    crate::runtime::block_on(perform_sync(
        &SYNC_SERVICE,
        crate::persistence::engine_install(),
        transport,
        "i1".into(),
        false,
    ));
    let sent = refusals.calls();
    assert!(sent > 0, "the sync reached the server");

    let after = read_every_screen(now);
    assert_eq!(after, before, "a refused sync moved what the screens read");

    let cooldown = GOVERNOR
        .cooldown_until(chrono::Utc::now())
        .expect("the refusal holds the process governor");
    let held_for = (cooldown - asked_at).num_seconds();
    assert!(
        (RETRY_AFTER_SECS..=RETRY_AFTER_SECS + RETRY_AFTER_SECS / 4 + 5).contains(&held_for),
        "the hold is the Retry-After plus its jitter: {held_for} s"
    );
    let status = SYNC_SERVICE.snapshot();
    assert_eq!(status.retry_at_ms, Some(cooldown.timestamp_millis() as f64));
    assert_eq!(
        status.last_error_reason,
        Some(FfiSyncErrorReason::RateLimited)
    );
    assert_eq!(status.state, SyncState::Idle);

    let held = start_full_sync(false);
    assert_eq!(held.outcome, FfiStartOutcome::Held);
    assert_eq!(held.retry_at_ms, status.retry_at_ms);
    assert_eq!(
        refusals.calls(),
        sent,
        "a held start sent a request to the server"
    );
    assert_eq!(
        SYNC_SERVICE.snapshot().state,
        SyncState::Idle,
        "a held start began no run"
    );

    SYNC_SERVICE.clear_credentials();
}
