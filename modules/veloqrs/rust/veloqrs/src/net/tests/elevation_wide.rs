//! Scenario: an upgrader's flat tracks also owe their per-metric series and,
//! for the section maths, their time stream. Asked separately that is three
//! requests per track: the elevation, the series, and `time,latlng`.
//!
//! Expected behaviour: a track the athlete's answers allow the series for is
//! asked once, for the whole series set, and that one answer stocks the
//! elevation, its series, the series store and the time stream. A track they
//! do not allow it for keeps the elevation-only ask.

use super::*;
use crate::governor::{AuthMethod, Governor, NoopPolicy};
use crate::net::intervals::endpoints::{DEFAULT_STREAM_TYPES, ELEVATION_STREAM_TYPES};
use crate::net::stream_backfill::{STREAM_ATTEMPT_LIMIT, STREAM_CONSENT_KEY};
use crate::persistence::{
    ELEVATION_SOURCE_CORRECTED, ELEVATION_STATE_FETCHED, with_persistent_engine,
};
use crate::test_globals::{drain_detection, init_global_engine, serial_global_state};
use httpmock::prelude::*;
use std::sync::Arc;
use tempfile::TempDir;

const POINTS: usize = 8;

fn transport(server: &MockServer) -> Transport {
    let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
    Transport::with_governor(server.base_url(), AuthMethod::ApiKey("secret"), gov).unwrap()
}

fn line(seed: f64, n: usize) -> Vec<GpsPoint> {
    (0..n)
        .map(|i| GpsPoint::new(46.2 + seed + i as f64 * 0.001, 7.35 + seed))
        .collect()
}

/// A library holding each named track, stored flat, signed in, with nothing
/// paused or held from an earlier test.
fn library(ids: &[&str]) -> TempDir {
    let tmp = init_global_engine("elevation_wide.db");
    crate::net::connectivity::reset();
    reset_pause();
    crate::net::stream_backfill::release_autostart_hold();
    crate::objects::sync::set_credentials_from_native("api_key", "secret", "1")
        .expect("test credential");
    with_persistent_engine(|engine| {
        let batch = ids
            .iter()
            .enumerate()
            .map(|(i, id)| (id.to_string(), line(i as f64 * 0.01, POINTS), "Ride".into()))
            .collect();
        engine.add_activities_batch(batch).expect("add activities");
    })
    .expect("engine");
    tmp
}

fn consent() {
    with_persistent_engine(|e| e.set_setting(STREAM_CONSENT_KEY, "yes"))
        .expect("engine")
        .expect("consent recorded");
}

/// The thirteen series the detail charts ask for, over `points`, which
/// carries the coordinates upstream holds. `time` comes back `time_len` long,
/// so a test can put it out of step with the coordinates.
fn wide_body(points: &[GpsPoint], time_len: usize) -> serde_json::Value {
    let n = points.len();
    let series = |f: fn(usize) -> f64| (0..n).map(f).collect::<Vec<f64>>();
    serde_json::json!([
        {"type": "time", "data": (0..time_len).map(|i| i as f64 * 2.0).collect::<Vec<f64>>()},
        {"type": "distance", "data": series(|i| i as f64 * 10.0)},
        {"type": "latlng",
         "data": points.iter().map(|p| p.latitude).collect::<Vec<f64>>(),
         "data2": points.iter().map(|p| p.longitude).collect::<Vec<f64>>()},
        {"type": "velocity_smooth", "data": series(|_| 5.0)},
        {"type": "heartrate", "data": series(|i| 120.0 + i as f64)},
        {"type": "watts", "data": series(|i| 200.0 + i as f64)},
        {"type": "altitude", "data": series(|i| 900.0 + i as f64)},
        {"type": "fixed_altitude", "data": series(|i| 1000.0 + i as f64 * 12.0)},
        {"type": "cadence", "data": series(|_| 85.0)},
        {"type": "grade_smooth", "data": series(|_| 1.0)},
        {"type": "temp", "data": series(|_| 20.0)},
        {"type": "w_bal", "data": series(|_| 20000.0)},
        {"type": "ga_velocity", "data": series(|_| 5.0)}
    ])
}

/// Coordinates and both altitudes and nothing else: an answer that settles
/// the elevation and carries no series the store keeps.
fn bare_body(points: &[GpsPoint]) -> serde_json::Value {
    serde_json::json!([
        {"type": "latlng",
         "data": points.iter().map(|p| p.latitude).collect::<Vec<f64>>(),
         "data2": points.iter().map(|p| p.longitude).collect::<Vec<f64>>()},
        {"type": "fixed_altitude", "data": (0..points.len()).map(|i| 1000.0 + i as f64).collect::<Vec<f64>>()}
    ])
}

fn altitude_only(n: usize) -> serde_json::Value {
    serde_json::json!([
        {"type": "fixed_altitude", "data": (0..n).map(|i| 1000.0 + i as f64 * 12.0).collect::<Vec<f64>>()}
    ])
}

fn any_streams() -> &'static str {
    r"^/activity/[^/]+/streams\.json$"
}

fn stored_track(id: &str) -> Vec<GpsPoint> {
    with_persistent_engine(|e| e.get_gps_track(id))
        .expect("engine")
        .expect("stored track")
}

fn state(id: &str) -> u8 {
    with_persistent_engine(|e| {
        e.db.query_row(
            "SELECT elevation_state FROM gps_tracks WHERE activity_id = ?1",
            params![id],
            |row| row.get::<_, i64>(0),
        )
    })
    .expect("engine")
    .expect("state") as u8
}

fn source(id: &str) -> u8 {
    with_persistent_engine(|e| {
        e.db.query_row(
            "SELECT elevation_source FROM gps_tracks WHERE activity_id = ?1",
            params![id],
            |row| row.get::<_, i64>(0),
        )
    })
    .expect("engine")
    .expect("source") as u8
}

fn series_kinds(id: &str) -> Vec<String> {
    let mut kinds = with_persistent_engine(|e| e.stored_stream_kinds(id))
        .expect("engine")
        .expect("kinds");
    kinds.sort();
    kinds
}

fn series_samples(id: &str, kind: &str) -> Option<i64> {
    with_persistent_engine(|e| {
        e.db.query_row(
            "SELECT sample_count FROM activity_streams WHERE activity_id = ?1 AND kind = ?2",
            params![id, kind],
            |row| row.get::<_, i64>(0),
        )
        .optional()
    })
    .expect("engine")
    .expect("samples")
}

fn time_points(id: &str) -> Option<i64> {
    with_persistent_engine(|e| {
        e.db.query_row(
            "SELECT point_count FROM time_streams WHERE activity_id = ?1",
            params![id],
            |row| row.get::<_, i64>(0),
        )
        .optional()
    })
    .expect("engine")
    .expect("time stream")
}

fn owed_series() -> Vec<String> {
    with_persistent_engine(|e| e.activities_missing_streams(STREAM_ATTEMPT_LIMIT))
        .expect("engine")
        .expect("queue")
        .into_iter()
        .map(|gap| gap.activity_id)
        .collect()
}

fn owed_time(ids: &[&str]) -> Vec<String> {
    let ids: Vec<String> = ids.iter().map(|id| id.to_string()).collect();
    with_persistent_engine(|e| e.get_activities_missing_time_streams(&ids)).expect("engine")
}

use rusqlite::OptionalExtension;

const STOCKED: [&str; 9] = [
    "cadence",
    "distance",
    "ga_velocity",
    "grade_smooth",
    "heartrate",
    "temp",
    "velocity_smooth",
    "w_bal",
    "watts",
];

#[test]
fn one_wide_answer_per_track_stocks_elevation_series_and_time() {
    let _serial = serial_global_state();
    let ids = ["i1", "i2", "i3"];
    let _tmp = library(&ids);
    consent();
    let server = MockServer::start();
    let mut wide = Vec::new();
    for (i, id) in ids.iter().enumerate() {
        let body = wide_body(&line(i as f64 * 0.01, POINTS), POINTS);
        wide.push(server.mock(|when, then| {
            when.method(GET)
                .path(format!("/activity/{id}/streams.json"))
                .query_param("types", DEFAULT_STREAM_TYPES);
            then.status(200).json_body(body);
        }));
    }
    let anything_else = server.mock(|when, then| {
        when.method(GET).path_matches(any_streams());
        then.status(200).json_body(altitude_only(POINTS));
    });

    assert_eq!(owed_time(&ids).len(), 3, "the time streams start owed");
    let before: Vec<Vec<GpsPoint>> = ids.iter().map(|id| stored_track(id)).collect();
    let run = run_elevation_backfill(&transport(&server), "1");
    let BackfillRun::Finished(outcome) = run else {
        panic!("expected a finished pass, got {run:?}");
    };

    assert_eq!(outcome.elevated, 3);
    for mock in &wide {
        mock.assert_calls(1);
    }
    anything_else.assert_calls(0);
    for (id, flat) in ids.iter().zip(&before) {
        let track = stored_track(id);
        assert_eq!(track.len(), POINTS);
        for (k, (was, now)) in flat.iter().zip(&track).enumerate() {
            assert_eq!((was.latitude, was.longitude), (now.latitude, now.longitude));
            assert_eq!(now.elevation, Some(1000.0 + k as f64 * 12.0));
        }
        assert_eq!(state(id), ELEVATION_STATE_FETCHED);
        assert_eq!(source(id), ELEVATION_SOURCE_CORRECTED);
        assert_eq!(series_kinds(id), STOCKED);
        assert_eq!(time_points(id), Some(POINTS as i64));
    }
    assert!(owed_series().is_empty(), "the stream pass has nothing left");
    assert!(owed_time(&ids).is_empty(), "the time pass has nothing left");
    drain_detection();
}

#[test]
fn a_track_upstream_moved_is_replaced_from_the_same_answer() {
    let _serial = serial_global_state();
    let _tmp = library(&["i1"]);
    let server = MockServer::start();
    let moved: Vec<GpsPoint> = (0..POINTS + 2)
        .map(|i| GpsPoint::new(12.0 + i as f64 * 0.001, 99.0))
        .collect();
    let body = wide_body(&moved, POINTS + 2);
    let wide = server.mock(|when, then| {
        when.method(GET)
            .path("/activity/i1/streams.json")
            .query_param("types", DEFAULT_STREAM_TYPES);
        then.status(200).json_body(body);
    });
    let anything_else = server.mock(|when, then| {
        when.method(GET).path_matches(any_streams());
        then.status(200).json_body(altitude_only(POINTS + 2));
    });

    run_elevation_backfill(&transport(&server), "1");

    wide.assert_calls(1);
    anything_else.assert_calls(0);
    let track = stored_track("i1");
    assert_eq!(track.len(), POINTS + 2, "the track upstream holds now");
    assert_eq!(track[0].latitude, 12.0);
    assert!(track.iter().all(|p| p.elevation.is_some()));
    assert_eq!(series_samples("i1", "heartrate"), Some((POINTS + 2) as i64));
    assert_eq!(time_points("i1"), Some((POINTS + 2) as i64));
    assert!(owed_series().is_empty());
    assert!(owed_time(&["i1"]).is_empty());
    drain_detection();
}

#[test]
fn a_wide_answer_with_no_series_settles_the_stream_ask() {
    let _serial = serial_global_state();
    let _tmp = library(&["i1"]);
    let server = MockServer::start();
    let body = bare_body(&line(0.0, POINTS));
    server.mock(|when, then| {
        when.method(GET).path_matches(any_streams());
        then.status(200).json_body(body);
    });

    run_elevation_backfill(&transport(&server), "1");

    assert_eq!(state("i1"), ELEVATION_STATE_FETCHED);
    assert!(series_kinds("i1").is_empty());
    assert!(
        owed_series().is_empty(),
        "an answer with no series is the stream pass's answer too"
    );
    drain_detection();
}

#[test]
fn a_time_series_out_of_step_with_the_coordinates_is_left_owed() {
    let _serial = serial_global_state();
    let _tmp = library(&["i1"]);
    let server = MockServer::start();
    let body = wide_body(&line(0.0, POINTS), POINTS - 1);
    server.mock(|when, then| {
        when.method(GET)
            .path("/activity/i1/streams.json")
            .query_param("types", DEFAULT_STREAM_TYPES);
        then.status(200).json_body(body);
    });

    run_elevation_backfill(&transport(&server), "1");

    assert_eq!(series_kinds("i1"), STOCKED, "the aligned series still land");
    assert_eq!(time_points("i1"), None, "a misaligned clock is not stored");
    assert_eq!(owed_time(&["i1"]), vec!["i1".to_string()]);
    drain_detection();
}

#[test]
fn an_activity_outside_the_retention_window_is_asked_for_elevation_alone() {
    let _serial = serial_global_state();
    let _tmp = library(&["i1"]);
    // Undated, so outside any bounded window.
    with_persistent_engine(|e| e.set_stream_retention_days(30))
        .expect("engine")
        .expect("window set");
    let server = MockServer::start();
    let narrow = server.mock(|when, then| {
        when.method(GET)
            .path("/activity/i1/streams.json")
            .query_param("types", ELEVATION_STREAM_TYPES);
        then.status(200).json_body(altitude_only(POINTS));
    });
    let wide = server.mock(|when, then| {
        when.method(GET)
            .path("/activity/i1/streams.json")
            .query_param("types", DEFAULT_STREAM_TYPES);
        then.status(200)
            .json_body(wide_body(&line(0.0, POINTS), POINTS));
    });

    run_elevation_backfill(&transport(&server), "1");

    narrow.assert_calls(1);
    wide.assert_calls(0);
    drain_detection();
}

#[test]
fn a_stopped_stream_pass_keeps_the_elevation_ask_narrow() {
    let _serial = serial_global_state();
    let _tmp = library(&["i1"]);
    crate::net::stream_backfill::hold_autostart_for_test();
    let server = MockServer::start();
    let narrow = server.mock(|when, then| {
        when.method(GET)
            .path("/activity/i1/streams.json")
            .query_param("types", ELEVATION_STREAM_TYPES);
        then.status(200).json_body(altitude_only(POINTS));
    });
    let wide = server.mock(|when, then| {
        when.method(GET)
            .path("/activity/i1/streams.json")
            .query_param("types", DEFAULT_STREAM_TYPES);
        then.status(200)
            .json_body(wide_body(&line(0.0, POINTS), POINTS));
    });

    run_elevation_backfill(&transport(&server), "1");
    crate::net::stream_backfill::release_autostart_hold();

    narrow.assert_calls(1);
    wide.assert_calls(0);
    drain_detection();
}

#[test]
fn a_library_past_the_threshold_is_asked_wide_only_once_the_athlete_agrees() {
    use crate::net::stream_backfill::STREAM_CONSENT_THRESHOLD;
    let _serial = serial_global_state();
    let ids: Vec<String> = (0..=STREAM_CONSENT_THRESHOLD)
        .map(|i| format!("i{i}"))
        .collect();
    let refs: Vec<&str> = ids.iter().map(String::as_str).collect();
    let _tmp = library(&refs);
    let batch: Vec<String> = ids[..BATCH].to_vec();

    assert!(
        wide_asks(engine_install(), &batch).is_empty(),
        "past the threshold with no answer, nothing is asked wide"
    );
    consent();
    assert_eq!(
        wide_asks(engine_install(), &batch).len(),
        BATCH,
        "a recorded yes lets every owed track be asked wide"
    );
}

/// Scenario: the same library converted two ways, into two fresh databases.
/// One takes the narrow asks the passes make on their own, elevation alone,
/// the series from the stream pass, and the clock from `time,latlng` for
/// whatever is still owed one. The other takes the one answer to the whole
/// series set per track. Upstream answers every ask by cutting the same body
/// down to the series asked for.
///
/// Expected behaviour: both databases hold the same tracks, the same
/// elevation provenance, the same stored series and the same clocks, and the
/// wide conversion asks once per track. The cases are a ride with a dropped
/// coordinate, a run with device altitude only, a track upstream has since
/// re-processed, one with no clock, one whose clock is out of step with its
/// coordinates, and an indoor session with no track, which neither asks for.
mod equivalence {
    use super::*;

    struct Recorded {
        id: &'static str,
        /// The track this device stored before the conversion.
        stored: Vec<GpsPoint>,
        /// What upstream holds for it now.
        body: Vec<serde_json::Value>,
    }

    fn series(kind: &str, data: Vec<Option<f64>>) -> serde_json::Value {
        serde_json::json!({"type": kind, "data": data})
    }

    fn some(n: usize, f: impl Fn(usize) -> f64) -> Vec<Option<f64>> {
        (0..n).map(|i| Some(f(i))).collect()
    }

    fn coords(seed: f64, n: usize, gap: Option<usize>) -> serde_json::Value {
        let lat: Vec<Option<f64>> = (0..n)
            .map(|i| (Some(i) != gap).then_some(46.2 + seed + i as f64 * 0.001))
            .collect();
        let lng: Vec<Option<f64>> = (0..n)
            .map(|i| (Some(i) != gap).then_some(7.35 + seed))
            .collect();
        serde_json::json!({"type": "latlng", "data": lat, "data2": lng})
    }

    fn stored(seed: f64, n: usize, gap: Option<usize>) -> Vec<GpsPoint> {
        (0..n)
            .filter(|i| Some(*i) != gap)
            .map(|i| GpsPoint::new(46.2 + seed + i as f64 * 0.001, 7.35 + seed))
            .collect()
    }

    fn library_recorded() -> Vec<Recorded> {
        let n = 12;
        vec![
            Recorded {
                id: "ride",
                stored: stored(0.0, n, Some(4)),
                body: vec![
                    series("time", some(n, |i| i as f64)),
                    coords(0.0, n, Some(4)),
                    series("watts", some(n, |i| 180.0 + i as f64)),
                    series("heartrate", some(n, |i| 130.0 + i as f64)),
                    series("cadence", some(n, |_| 88.0)),
                    series("altitude", some(n, |i| 400.0 + i as f64)),
                    series("fixed_altitude", some(n, |i| 410.0 + i as f64 * 2.0)),
                ],
            },
            Recorded {
                id: "run",
                stored: stored(0.02, n, None),
                body: vec![
                    series("time", some(n, |i| i as f64 * 3.0)),
                    coords(0.02, n, None),
                    series("heartrate", some(n, |i| 150.0 + i as f64)),
                    series("ga_velocity", some(n, |_| 3.1)),
                    series("altitude", some(n, |i| 600.0 - i as f64)),
                ],
            },
            Recorded {
                id: "moved",
                stored: stored(0.04, n - 3, None),
                body: vec![
                    series("time", some(n, |i| i as f64 * 2.0)),
                    coords(0.04, n, None),
                    series("watts", some(n, |i| 220.0 + i as f64)),
                    series("fixed_altitude", some(n, |i| 800.0 + i as f64)),
                ],
            },
            Recorded {
                id: "clockless",
                stored: stored(0.06, n, None),
                body: vec![
                    coords(0.06, n, None),
                    series("heartrate", some(n, |i| 110.0 + i as f64)),
                    series("fixed_altitude", some(n, |i| 300.0 + i as f64)),
                ],
            },
            Recorded {
                id: "clock_off",
                stored: stored(0.08, n, None),
                body: vec![
                    series("time", some(n - 2, |i| i as f64)),
                    coords(0.08, n, None),
                    series("watts", some(n, |i| 150.0 + i as f64)),
                    series("fixed_altitude", some(n, |i| 500.0 + i as f64)),
                ],
            },
        ]
    }

    /// The body cut down to the series an ask names, the way upstream answers.
    fn answer(body: &[serde_json::Value], types: &str) -> serde_json::Value {
        let wanted: Vec<&str> = types.split(',').collect();
        serde_json::Value::Array(
            body.iter()
                .filter(|s| wanted.contains(&s["type"].as_str().unwrap_or_default()))
                .cloned()
                .collect(),
        )
    }

    /// Serve every ask about the library, answering how many each kind of
    /// ask was made.
    fn serve<'a>(
        server: &'a MockServer,
        recorded: &[Recorded],
    ) -> Vec<(&'static str, httpmock::Mock<'a>)> {
        let mut asks = Vec::new();
        for r in recorded {
            for types in [
                ELEVATION_STREAM_TYPES,
                crate::net::intervals::endpoints::TRACK_STREAM_TYPES,
                DEFAULT_STREAM_TYPES,
                "time,latlng",
            ] {
                let body = answer(&r.body, types);
                asks.push((
                    types,
                    server.mock(|when, then| {
                        when.method(GET)
                            .path(format!("/activity/{}/streams.json", r.id))
                            .query_param("types", types);
                        then.status(200).json_body(body);
                    }),
                ));
            }
        }
        asks.push((
            "indoor",
            server.mock(|when, then| {
                when.method(GET).path("/activity/indoor/streams.json");
                then.status(200).json_body(serde_json::json!([
                    {"type": "time", "data": [0.0, 1.0, 2.0]},
                    {"type": "watts", "data": [200.0, 210.0, 220.0]}
                ]));
            }),
        ));
        asks
    }

    fn hits(asks: &[(&'static str, httpmock::Mock<'_>)], types: &str) -> usize {
        asks.iter()
            .filter(|(t, _)| *t == types)
            .map(|(_, m)| m.calls())
            .sum()
    }

    fn seed(recorded: &[Recorded]) -> TempDir {
        let tmp = library(&[]);
        with_persistent_engine(|engine| {
            let batch = recorded
                .iter()
                .map(|r| (r.id.to_string(), r.stored.clone(), "Ride".to_string()))
                .collect();
            engine.add_activities_batch(batch).expect("add activities");
            engine
                .db
                .execute(
                    "INSERT INTO activities (id, intervals_id, sport_type, min_lat, max_lat, min_lng, max_lng)
                     VALUES ('indoor', 'indoor', 'VirtualRide', 0, 0, 0, 0)",
                    [],
                )
                .expect("indoor activity");
        })
        .expect("engine");
        tmp
    }

    /// Everything a conversion writes about one activity, as stored.
    #[derive(Debug, PartialEq)]
    struct Stored {
        track: Option<(Vec<u8>, i64, i64, i64)>,
        series: Vec<(String, Vec<u8>, i64)>,
        clock: Option<(Vec<u8>, i64)>,
    }

    fn snapshot(id: &str) -> Stored {
        with_persistent_engine(|e| {
            let track =
                e.db.query_row(
                    "SELECT track_data, point_count, elevation_state, elevation_source
                       FROM gps_tracks WHERE activity_id = ?1",
                    params![id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
                )
                .optional()
                .expect("track");
            let mut stmt =
                e.db.prepare(
                    "SELECT kind, data, sample_count FROM activity_streams
                      WHERE activity_id = ?1 ORDER BY kind",
                )
                .expect("series");
            let series = stmt
                .query_map(params![id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
                .expect("series")
                .collect::<Result<Vec<_>, _>>()
                .expect("series rows");
            let clock =
                e.db.query_row(
                    "SELECT times, point_count FROM time_streams WHERE activity_id = ?1",
                    params![id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()
                .expect("clock");
            Stored {
                track,
                series,
                clock,
            }
        })
        .expect("engine")
    }

    /// The clock pass the bulk sync runs for what is still owed one, over the
    /// activities whose track it stored. An answer it refuses leaves the
    /// activity owed, as the pass does.
    fn owed_clocks(server: &MockServer, ids: &[String]) {
        for id in owed_time(&ids.iter().map(String::as_str).collect::<Vec<_>>()) {
            let Ok(times) =
                crate::runtime::block_on(crate::net::intervals::endpoints::fetch_time_stream(
                    &transport(server),
                    &id,
                    crate::governor::Lane::Backfill,
                ))
            else {
                continue;
            };
            with_persistent_engine(|e| {
                e.set_time_streams_flat(std::slice::from_ref(&id), &times, &[0])
            })
            .expect("engine");
        }
    }

    #[test]
    fn the_narrow_passes_and_the_one_wide_answer_store_the_same_library() {
        let _serial = serial_global_state();
        let recorded = library_recorded();
        let mut ids: Vec<String> = recorded.iter().map(|r| r.id.to_string()).collect();
        ids.push("indoor".to_string());

        let narrow_server = MockServer::start();
        let narrow_asks = serve(&narrow_server, &recorded);
        let narrow: Vec<Stored> = {
            let _tmp = seed(&recorded);
            crate::net::stream_backfill::hold_autostart_for_test();
            run_elevation_backfill(&transport(&narrow_server), "1");
            crate::net::stream_backfill::release_autostart_hold();
            crate::net::stream_backfill::run_stream_backfill(&transport(&narrow_server), "1");
            let tracked: Vec<String> = recorded.iter().map(|r| r.id.to_string()).collect();
            owed_clocks(&narrow_server, &tracked);
            drain_detection();
            ids.iter().map(|id| snapshot(id)).collect()
        };

        let wide_server = MockServer::start();
        let wide_asks = serve(&wide_server, &recorded);
        let wide: Vec<Stored> = {
            let _tmp = seed(&recorded);
            run_elevation_backfill(&transport(&wide_server), "1");
            drain_detection();
            ids.iter().map(|id| snapshot(id)).collect()
        };
        let narrow_requests: usize = narrow_asks.iter().map(|(_, m)| m.calls()).sum();
        let wide_requests: usize = wide_asks.iter().map(|(_, m)| m.calls()).sum();
        assert_eq!(hits(&wide_asks, DEFAULT_STREAM_TYPES), recorded.len());
        assert_eq!(
            wide_requests,
            recorded.len(),
            "one ask per track, nothing else"
        );
        assert!(
            narrow_requests > wide_requests,
            "the narrow passes asked {narrow_requests} times"
        );

        for ((id, n), w) in ids.iter().zip(&narrow).zip(&wide) {
            assert_eq!(n, w, "{id} differs between the two conversions");
        }
        let by_id = |id: &str| &wide[ids.iter().position(|i| i == id).expect("id")];
        assert!(by_id("ride").clock.is_some() && !by_id("ride").series.is_empty());
        assert_eq!(by_id("moved").track.as_ref().map(|t| t.1), Some(12));
        assert_eq!(
            by_id("clockless").clock.as_ref().map(|c| c.1),
            Some(0),
            "upstream having no clock is recorded, so nothing asks for it again"
        );
        assert!(
            by_id("clock_off").clock.is_none(),
            "an out-of-step clock stays owed"
        );
        assert_eq!(by_id("indoor").track, None);
    }
}
