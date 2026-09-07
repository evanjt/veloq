//! The one-shot elevation backfill.
//!
//! Scenario: a library stored before tracks carried elevation. The backfill
//! re-fetches every flat track, holds detection off for the whole pass, and
//! re-cuts the catalogue exactly once at the end.
//!
//! The queue is derived from `gps_tracks.elevation_state` on every call, so
//! resumability is a property of the data rather than of a saved cursor. These
//! tests drive the blocking runner directly against a mock server, which is
//! what the detached FFI thread calls.
//!
//! Coordinates here are synthetic.
//!
//! Runs against the process-global engine, exactly like production, so the
//! tests take a file-local lock and run one at a time.

use httpmock::prelude::*;
use serde_json::json;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::governor::{AuthMethod, Governor, NoopPolicy};
use veloqrs::net::Transport;
use veloqrs::net::elevation_backfill::{
    BACKFILL_PHASE_COMPLETE, BACKFILL_PHASE_FETCHING, BACKFILL_PHASE_PARTIAL,
    BACKFILL_PHASE_PAUSED, BACKFILL_RETRY_ROUNDS, BackfillRun, MAX_CONSECUTIVE_FAILURES,
    backfill_progress, backfill_retry_delays, detect_runs_started, pause_elevation_backfill,
    reset_elevation_backfill_pause, run_elevation_backfill,
};
use veloqrs::objects::{SYNC_SERVICE, SyncState};
use veloqrs::persistence::persistent_engine_ffi::{
    SECTION_DETECTION_HANDLE, persistent_engine_init,
};
use veloqrs::persistence::{detection_suspended, with_persistent_engine};

const UNKNOWN: u8 = 0;
const FETCHED: u8 = 1;
const UNAVAILABLE: u8 = 2;

static SERIAL: Mutex<()> = Mutex::new(());

fn serial() -> MutexGuard<'static, ()> {
    SERIAL.lock().unwrap_or_else(|e| e.into_inner())
}

/// A flat eight-point line, distinct per seed so the pool holds real ground.
fn flat_track(seed: f64) -> Vec<GpsPoint> {
    (0..8)
        .map(|i| GpsPoint::new(46.2 + seed + f64::from(i) * 0.001, 7.35 + seed))
        .collect()
}

/// The response an activity with altitude sends back: eight coordinates and
/// eight matching altitudes, in the one index space.
fn elevated_streams(seed: f64) -> serde_json::Value {
    let lats: Vec<f64> = (0..8).map(|i| 46.2 + seed + f64::from(i) * 0.001).collect();
    let lngs: Vec<f64> = (0..8).map(|_| 7.35 + seed).collect();
    let alts: Vec<f64> = (0..8).map(|i| 1000.0 + f64::from(i) * 12.0).collect();
    json!([
        {"type": "latlng", "data": lats, "data2": lngs},
        {"type": "fixed_altitude", "data": alts}
    ])
}

/// The response an activity with no barometer or DEM sends back: coordinates
/// and nothing else.
fn flat_streams(seed: f64) -> serde_json::Value {
    let lats: Vec<f64> = (0..8).map(|i| 46.2 + seed + f64::from(i) * 0.001).collect();
    let lngs: Vec<f64> = (0..8).map(|_| 7.35 + seed).collect();
    json!([{"type": "latlng", "data": lats, "data2": lngs}])
}

fn fast_transport(base: String) -> Transport {
    let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
    Transport::with_governor(base, AuthMethod::ApiKey("k"), gov).expect("transport")
}

/// The same transport carrying an OAuth token, so the auth method a 401
/// arrives under is a variable the tests can set.
fn fast_oauth_transport(base: String) -> Transport {
    let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
    Transport::with_governor(base, AuthMethod::Bearer("t"), gov).expect("transport")
}

/// The athlete every pass in this file runs for. It only matters to the tests
/// that drive a 401: the id names the profile endpoint the rejection is
/// confirmed on.
const ATHLETE: &str = "i1";

/// A pass for [`ATHLETE`], so the id stays out of the tests that do not care.
fn run_backfill(transport: &Transport) -> BackfillRun {
    run_elevation_backfill(transport, ATHLETE)
}

/// Answer the confirmation the park now asks for, so a 401 on a track counts
/// as a rejected credential rather than a single unexplained refusal.
fn confirm_rejection(server: &MockServer) {
    server.mock(|when, then| {
        when.path("/athlete/i1");
        then.status(401);
    });
}

/// The process-wide sync service is shared across these tests, so each one
/// that reads it starts from a live session rather than the last test's park.
fn live_session() {
    SYNC_SERVICE.finish(SyncState::Idle, None, false);
}

fn sync_state() -> SyncState {
    SYNC_SERVICE.snapshot().state
}

/// A fresh global engine holding `ids` flat tracks, all at elevation state
/// unknown. Returns the temp dir so the database outlives the test body.
fn seeded_engine(ids: &[&str]) -> (TempDir, std::path::PathBuf) {
    drain_detection();
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    assert!(persistent_engine_init(
        path.to_str().expect("utf-8 path").to_string()
    ));
    with_persistent_engine(|engine| {
        for (i, id) in ids.iter().enumerate() {
            engine
                .add_activity(
                    (*id).to_string(),
                    flat_track(i as f64 * 0.05),
                    "Ride".into(),
                )
                .expect("add activity");
            engine
                .update_activity_metadata(
                    id,
                    Some(1_700_000_000 - i as i64 * 86_400),
                    Some("ride"),
                    Some(12_345.0),
                    Some(3_600),
                )
                .expect("metadata");
        }
    })
    .expect("engine");
    (dir, path)
}

/// Wait until no detection run holds the global handle, so one test's re-cut
/// cannot make the next test's re-cut lose a start race.
fn drain_detection() {
    let deadline = Instant::now() + Duration::from_secs(120);
    loop {
        let busy = SECTION_DETECTION_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .is_some();
        if !busy {
            return;
        }
        assert!(Instant::now() < deadline, "detection never went idle");
        std::thread::sleep(Duration::from_millis(100));
    }
}

fn queue_ids() -> Vec<String> {
    with_persistent_engine(|engine| engine.tracks_missing_elevation())
        .expect("engine")
        .expect("queue")
        .into_iter()
        .map(|(id, _)| id)
        .collect()
}

/// The column itself rather than the queue, so a fetched track and an
/// unavailable one are distinguishable.
fn state_of(id: &str) -> u8 {
    with_persistent_engine(|engine| engine.elevation_state_of_track(id))
        .expect("engine")
        .expect("stored track")
}

/// The activity row, read on a second connection, so an assertion cannot be
/// satisfied by an in-memory value the database never received.
fn activity_row(path: &std::path::Path, id: &str) -> (Option<i64>, Option<String>, Option<f64>) {
    let conn = rusqlite::Connection::open(path).expect("reopen database");
    conn.query_row(
        "SELECT start_date, name, distance_meters FROM activities WHERE id = ?1",
        rusqlite::params![id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )
    .expect("read activity row")
}

/// Block until the pass has entered its fetch loop, so a sample taken next is
/// a sample taken mid-conversion rather than before it started.
fn wait_for_fetching() {
    let deadline = Instant::now() + Duration::from_secs(10);
    while backfill_progress().phase != BACKFILL_PHASE_FETCHING {
        assert!(Instant::now() < deadline, "the pass never started fetching");
        std::thread::sleep(Duration::from_millis(5));
    }
}

/// True while a detection run holds the process-wide handle.
fn detection_handle_installed() -> bool {
    SECTION_DETECTION_HANDLE
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_some()
}

fn outstanding() -> u64 {
    with_persistent_engine(|engine| engine.elevation_backfill_outstanding()).expect("engine")
}

// ============================================================================

/// The queue is the not-yet-fetched set, and completed work leaves it.
#[test]
fn the_queue_is_the_not_yet_fetched_set_and_shrinks_as_work_lands() {
    let _serial = serial();
    let (_dir, _path) = seeded_engine(&["a1", "a2", "a3"]);

    let mut before = queue_ids();
    before.sort();
    assert_eq!(before, vec!["a1", "a2", "a3"]);

    let server = MockServer::start();
    for (i, id) in ["a1", "a2", "a3"].iter().enumerate() {
        server.mock(|when, then| {
            when.path(format!("/activity/{}/streams.json", id));
            then.status(200)
                .json_body(elevated_streams(i as f64 * 0.05));
        });
    }

    let run = run_backfill(&fast_transport(server.base_url()));
    let BackfillRun::Finished(outcome) = run else {
        panic!("expected a finished pass, got {:?}", run);
    };
    assert_eq!(outcome.queued, 3);
    assert_eq!(outcome.elevated, 3);
    assert!(
        queue_ids().is_empty(),
        "completed work must leave the queue"
    );
    drain_detection();
}

/// A pass that could not finish resumes from the column, and does not re-fetch
/// what already landed.
#[test]
fn an_interrupted_pass_resumes_and_does_not_redo_completed_work() {
    let _serial = serial();
    let (_dir, _path) = seeded_engine(&["a1", "a2", "a3"]);

    let server = MockServer::start();
    let ok_a1 = server.mock(|when, then| {
        when.path("/activity/a1/streams.json");
        then.status(200).json_body(elevated_streams(0.0));
    });
    let ok_a2 = server.mock(|when, then| {
        when.path("/activity/a2/streams.json");
        then.status(200).json_body(elevated_streams(0.05));
    });
    let mut broken_a3 = server.mock(|when, then| {
        when.path("/activity/a3/streams.json");
        then.status(404);
    });

    let first = run_backfill(&fast_transport(server.base_url()));
    let BackfillRun::Finished(outcome) = first else {
        panic!("a failing activity must not fail the pass, got {:?}", first);
    };
    assert_eq!(outcome.elevated, 2);
    assert_eq!(outcome.failed, 1);
    assert_eq!(
        outcome.detects_started, 0,
        "a pass that leaves flat tracks must not re-cut over the mixed library"
    );
    assert_eq!(queue_ids(), vec!["a3"], "only the unfinished track remains");
    assert_eq!(
        backfill_progress().phase,
        BACKFILL_PHASE_PARTIAL,
        "an outstanding track is not a complete conversion"
    );
    ok_a1.assert_hits(1);
    ok_a2.assert_hits(1);
    broken_a3.assert_hits(1);
    drain_detection();

    broken_a3.delete();
    server.mock(|when, then| {
        when.path("/activity/a3/streams.json");
        then.status(200).json_body(elevated_streams(0.10));
    });

    let second = run_backfill(&fast_transport(server.base_url()));
    let BackfillRun::Finished(outcome) = second else {
        panic!("expected a finished pass, got {:?}", second);
    };
    assert_eq!(
        outcome.queued, 1,
        "the second pass starts with what is left"
    );
    assert_eq!(outcome.elevated, 1);
    assert_eq!(
        outcome.detects_started, 1,
        "the pass that drains the queue owes the whole conversion its re-cut"
    );
    ok_a1.assert_hits(1);
    ok_a2.assert_hits(1);
    assert!(queue_ids().is_empty());
    drain_detection();
}

/// Detection is held off for the whole conversion, no run holds the global
/// handle while tracks are landing, and it resumes when the pass ends.
#[test]
fn detection_is_suspended_for_the_whole_pass_and_released_at_the_end() {
    let _serial = serial();
    let ids: Vec<String> = (0..12).map(|i| format!("a{}", i)).collect();
    let refs: Vec<&str> = ids.iter().map(|s| s.as_str()).collect();
    let (_dir, _path) = seeded_engine(&refs);
    assert!(!detection_suspended(), "the pass has not started yet");

    let server = MockServer::start();
    for (i, id) in ids.iter().enumerate() {
        server.mock(|when, then| {
            when.path(format!("/activity/{}/streams.json", id));
            then.status(200)
                .delay(Duration::from_millis(120))
                .json_body(elevated_streams(i as f64 * 0.02));
        });
    }

    let base = server.base_url();
    let runner = std::thread::spawn(move || run_backfill(&fast_transport(base)));

    wait_for_fetching();
    let mut samples = 0;
    while backfill_progress().phase == BACKFILL_PHASE_FETCHING {
        assert!(
            detection_suspended(),
            "detection went live while the library was half converted"
        );
        assert!(
            !detection_handle_installed(),
            "a detection run held the handle mid-conversion"
        );
        samples += 1;
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(samples > 0, "the fetch loop was never observed");

    let run = runner.join().expect("runner thread");
    assert!(matches!(run, BackfillRun::Finished(_)));
    assert!(
        !detection_suspended(),
        "the guard must release when the pass ends"
    );
    drain_detection();
}

/// The release is structural, so a pass that cannot proceed leaves detection
/// working rather than wedged off.
#[test]
fn detection_is_released_when_the_pass_fails() {
    let _serial = serial();
    let (_dir, _path) = seeded_engine(&["a1", "a2"]);

    let server = MockServer::start();
    server.mock(|when, then| {
        when.path_contains("/streams.json");
        then.status(401);
    });

    let run = run_backfill(&fast_transport(server.base_url()));
    assert!(
        matches!(run, BackfillRun::Failed(_)),
        "a rejected credential fails the pass, got {:?}",
        run
    );
    assert!(
        !detection_suspended(),
        "a failed pass must still release detection"
    );
    assert_eq!(
        queue_ids().len(),
        2,
        "a rejected credential changes nothing, so the queue stands"
    );
}

/// One re-cut for the whole conversion, and it starts only after the last
/// activity.
#[test]
fn exactly_one_detect_fires_and_it_fires_at_the_end() {
    let _serial = serial();
    // More activities than one batch, so the conditioning cadence would have
    // had several chances to fire had the suspension not held.
    let ids: Vec<String> = (0..25).map(|i| format!("a{}", i)).collect();
    let refs: Vec<&str> = ids.iter().map(|s| s.as_str()).collect();
    let (_dir, _path) = seeded_engine(&refs);

    let before = detect_runs_started();

    let server = MockServer::start();
    for (i, id) in ids.iter().enumerate() {
        server.mock(|when, then| {
            when.path(format!("/activity/{}/streams.json", id));
            then.status(200)
                .delay(Duration::from_millis(60))
                .json_body(elevated_streams(i as f64 * 0.01));
        });
    }

    let base = server.base_url();
    let runner = std::thread::spawn(move || run_backfill(&fast_transport(base)));

    wait_for_fetching();
    while backfill_progress().phase == BACKFILL_PHASE_FETCHING {
        assert_eq!(
            detect_runs_started(),
            before,
            "a detect fired mid-conversion"
        );
        std::thread::sleep(Duration::from_millis(10));
    }

    let run = runner.join().expect("runner thread");
    let BackfillRun::Finished(outcome) = run else {
        panic!("expected a finished pass, got {:?}", run);
    };

    assert_eq!(outcome.elevated, 25);
    assert_eq!(
        outcome.detects_started, 1,
        "the conversion re-cuts exactly once"
    );
    assert_eq!(
        detect_runs_started() - before,
        1,
        "the process saw exactly one backfill detect"
    );
    drain_detection();
}

/// An activity upstream cannot answer for leaves the queue permanently, so a
/// library containing one still terminates.
#[test]
fn upstream_without_altitude_records_unavailable_and_is_not_retried() {
    let _serial = serial();
    let (_dir, _path) = seeded_engine(&["a1", "bare"]);

    let server = MockServer::start();
    server.mock(|when, then| {
        when.path("/activity/a1/streams.json");
        then.status(200).json_body(elevated_streams(0.0));
    });
    let bare = server.mock(|when, then| {
        when.path("/activity/bare/streams.json");
        then.status(200).json_body(flat_streams(0.05));
    });

    let run = run_backfill(&fast_transport(server.base_url()));
    let BackfillRun::Finished(outcome) = run else {
        panic!("expected a finished pass, got {:?}", run);
    };
    assert_eq!(outcome.unavailable, 1);
    assert_eq!(outcome.elevated, 1);
    // Two asks, once ever: the elevation-only ask comes back with nothing,
    // which cannot say whether upstream has no altitude or answered with
    // nothing at all, so the whole track settles it. The row is state 2
    // afterwards and no later pass asks again.
    bare.assert_hits(2);
    assert_eq!(state_of("bare"), UNAVAILABLE);
    assert!(
        queue_ids().is_empty(),
        "an unanswerable activity must leave the queue, or no pass ever ends"
    );
    assert_eq!(
        backfill_progress().phase,
        BACKFILL_PHASE_COMPLETE,
        "nothing outstanding is a complete conversion"
    );
    drain_detection();

    // The same library again: the pass has no work at all, so nothing is
    // re-requested. The count is the two asks the first pass made, unchanged.
    let again = run_backfill(&fast_transport(server.base_url()));
    assert_eq!(again, BackfillRun::Finished(Default::default()));
    bare.assert_hits(2);
}

/// One failed request costs its own activity and nothing else, and leaves that
/// activity exactly as it was.
#[test]
fn a_single_network_failure_does_not_sink_the_pass() {
    let _serial = serial();
    let (_dir, _path) = seeded_engine(&["a1", "a2", "a3"]);

    let server = MockServer::start();
    server.mock(|when, then| {
        when.path("/activity/a1/streams.json");
        then.status(200).json_body(elevated_streams(0.0));
    });
    server.mock(|when, then| {
        when.path("/activity/a2/streams.json");
        then.status(404);
    });
    server.mock(|when, then| {
        when.path("/activity/a3/streams.json");
        then.status(200).json_body(elevated_streams(0.10));
    });

    let run = run_backfill(&fast_transport(server.base_url()));
    let BackfillRun::Finished(outcome) = run else {
        panic!("expected a finished pass, got {:?}", run);
    };
    assert_eq!(outcome.elevated, 2);
    assert_eq!(outcome.failed, 1);
    assert_eq!(state_of("a1"), FETCHED);
    assert_eq!(state_of("a3"), FETCHED);
    assert_eq!(
        state_of("a2"),
        UNKNOWN,
        "a failed fetch must leave the row untouched so the next pass retries it"
    );
    assert_eq!(backfill_progress().failed, 1);
    assert_eq!(
        outcome.detects_started, 0,
        "a partial pass must leave the flat-era catalogue standing rather than cut a mixed one"
    );
    drain_detection();
}

/// A 200 with an empty body is a transient answer, not "upstream has no
/// altitude": the row keeps its unknown state so the next pass asks again.
#[test]
fn an_empty_response_is_retried_rather_than_recorded_unavailable() {
    let _serial = serial();
    let (_dir, _path) = seeded_engine(&["a1"]);

    let server = MockServer::start();
    let mut empty = server.mock(|when, then| {
        when.path("/activity/a1/streams.json");
        then.status(200).json_body(json!([]));
    });

    let run = run_backfill(&fast_transport(server.base_url()));
    let BackfillRun::Finished(outcome) = run else {
        panic!("expected a finished pass, got {:?}", run);
    };
    assert_eq!(outcome.unavailable, 0);
    assert_eq!(outcome.failed, 1);
    assert_eq!(state_of("a1"), UNKNOWN);
    assert_eq!(queue_ids(), vec!["a1"], "the track must stay in the queue");

    empty.delete();
    server.mock(|when, then| {
        when.path("/activity/a1/streams.json");
        then.status(200).json_body(elevated_streams(0.0));
    });

    let second = run_backfill(&fast_transport(server.base_url()));
    assert!(matches!(second, BackfillRun::Finished(_)));
    assert_eq!(state_of("a1"), FETCHED);
    drain_detection();
}

/// The re-ingest must not cost a section its traversal links: the activities
/// upsert updates the row in place, so nothing cascades.
#[test]
fn section_links_survive_the_reingest() {
    let _serial = serial();
    let (_dir, path) = seeded_engine(&["a1"]);

    let conn = rusqlite::Connection::open(&path).expect("open database");
    conn.execute(
        "INSERT INTO sections (id, section_type, sport_type, polyline_json,
                               distance_meters, is_user_defined)
         VALUES ('s1', 'custom', 'Ride', '[]', 800.0, 1)",
        [],
    )
    .expect("insert section");
    conn.execute(
        "INSERT INTO section_activities (section_id, activity_id, start_index, end_index)
         VALUES ('s1', 'a1', 0, 7)",
        [],
    )
    .expect("insert link");
    drop(conn);

    let server = MockServer::start();
    server.mock(|when, then| {
        when.path("/activity/a1/streams.json");
        then.status(200).json_body(elevated_streams(0.0));
    });

    let run = run_backfill(&fast_transport(server.base_url()));
    assert!(matches!(run, BackfillRun::Finished(_)));
    assert_eq!(state_of("a1"), FETCHED);

    let conn = rusqlite::Connection::open(&path).expect("reopen database");
    let links: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM section_activities WHERE section_id = 's1'",
            [],
            |row| row.get(0),
        )
        .expect("count links");
    assert_eq!(
        links, 1,
        "the custom section's traversal link must survive the re-ingest"
    );
    drain_detection();
}

/// A detection run already in flight when the pass ends is driven to its end
/// and the re-cut still fires, rather than being silently cancelled behind it.
#[test]
fn a_standing_detection_run_does_not_cancel_the_recut() {
    let _serial = serial();
    let (_dir, _path) = seeded_engine(&["a1", "a2"]);
    let before = detect_runs_started();

    // A pre-backfill run holding the process-wide slot, exactly as a launch
    // rescan would leave it.
    let handle =
        with_persistent_engine(|engine| engine.detect_sections_background()).expect("engine");
    *SECTION_DETECTION_HANDLE
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = Some(handle);

    let server = MockServer::start();
    for (i, id) in ["a1", "a2"].iter().enumerate() {
        server.mock(|when, then| {
            when.path(format!("/activity/{}/streams.json", id));
            then.status(200)
                .json_body(elevated_streams(i as f64 * 0.05));
        });
    }

    let run = run_backfill(&fast_transport(server.base_url()));
    let BackfillRun::Finished(outcome) = run else {
        panic!("expected a finished pass, got {:?}", run);
    };
    assert_eq!(outcome.elevated, 2);
    assert_eq!(
        outcome.detects_started, 1,
        "the standing run must be drained, not left to swallow the re-cut"
    );
    assert_eq!(detect_runs_started() - before, 1);
    drain_detection();
}

/// Two starts do not run concurrently and the second does not queue behind the
/// first: it is refused outright and touches nothing.
#[test]
fn a_second_start_while_one_runs_is_refused() {
    let _serial = serial();
    let ids: Vec<String> = (0..6).map(|i| format!("a{}", i)).collect();
    let refs: Vec<&str> = ids.iter().map(|s| s.as_str()).collect();
    let (_dir, _path) = seeded_engine(&refs);

    let server = MockServer::start();
    for (i, id) in ids.iter().enumerate() {
        server.mock(|when, then| {
            when.path(format!("/activity/{}/streams.json", id));
            then.status(200)
                .delay(Duration::from_millis(400))
                .json_body(elevated_streams(i as f64 * 0.05));
        });
    }

    let base = server.base_url();
    let runner = std::thread::spawn(move || run_backfill(&fast_transport(base)));

    wait_for_fetching();
    let second = run_backfill(&fast_transport(server.base_url()));
    assert_eq!(
        second,
        BackfillRun::Refused,
        "a second start must be refused, not queued and not run alongside"
    );

    let first = runner.join().expect("runner thread");
    assert!(matches!(first, BackfillRun::Finished(_)));
    assert!(queue_ids().is_empty());
    drain_detection();
}

/// The end state the release is aiming at: a library where upstream had
/// altitude for everything reads as uniformly elevated.
#[test]
fn a_finished_pass_leaves_nothing_not_fetched() {
    let _serial = serial();
    let ids: Vec<String> = (0..12).map(|i| format!("a{}", i)).collect();
    let refs: Vec<&str> = ids.iter().map(|s| s.as_str()).collect();
    let (_dir, path) = seeded_engine(&refs);
    assert_eq!(outstanding(), 12);
    let before = activity_row(&path, "a0");

    let server = MockServer::start();
    for (i, id) in ids.iter().enumerate() {
        server.mock(|when, then| {
            when.path(format!("/activity/{}/streams.json", id));
            then.status(200)
                .json_body(elevated_streams(i as f64 * 0.02));
        });
    }

    let run = run_backfill(&fast_transport(server.base_url()));
    assert!(matches!(run, BackfillRun::Finished(_)));

    assert_eq!(outstanding(), 0);
    assert!(with_persistent_engine(|engine| engine.library_uniformly_elevated()).expect("engine"));
    assert_eq!(backfill_progress().phase, BACKFILL_PHASE_COMPLETE);

    let track = with_persistent_engine(|engine| engine.get_gps_track("a0")).expect("engine");
    let track = track.expect("stored track");
    assert_eq!(track.len(), 8);
    assert_eq!(track[0].elevation, Some(1000.0));
    assert_eq!(track[7].elevation, Some(1084.0));

    assert_eq!(
        activity_row(&path, "a0"),
        before,
        "re-ingesting a track for its elevation must not cost the activity its date, name or distance"
    );
    drain_detection();
}

// ============================================================================
// The handover to the detector cutover
// ============================================================================

/// A track that overlaps its neighbours closely enough for a section to form,
/// and carries no elevation, so it also sits in the backfill queue.
fn overlapping_flat_track(jitter: f64) -> Vec<GpsPoint> {
    (0..200)
        .map(|i| GpsPoint::new(46.0 + f64::from(i) * 0.0001, 7.0 + jitter))
        .collect()
}

/// The same line with a steady grade on it, which is what upstream answers
/// with once the tracks are asked about.
fn overlapping_elevated_streams(jitter: f64) -> serde_json::Value {
    let lats: Vec<f64> = (0..200).map(|i| 46.0 + f64::from(i) * 0.0001).collect();
    let lngs: Vec<f64> = (0..200).map(|_| 7.0 + jitter).collect();
    let alts: Vec<f64> = (0..200).map(|i| 1000.0 + f64::from(i) * 2.0).collect();
    json!([
        {"type": "latlng", "data": lats, "data2": lngs},
        {"type": "fixed_altitude", "data": alts}
    ])
}

/// A library an older build cut: a catalogue on disk, no detector recorded
/// against it, and every track still flat. This is the shape a 0.3.x install
/// arrives in, and the one `seeded_engine` cannot produce because it never
/// detects.
fn seeded_older_build_engine(ids: &[&str]) -> (TempDir, std::path::PathBuf) {
    drain_detection();
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    assert!(persistent_engine_init(
        path.to_str().expect("utf-8 path").to_string()
    ));
    with_persistent_engine(|engine| {
        let mut cfg = engine.get_section_config();
        cfg.min_activities = 3;
        engine.set_section_config(cfg);
        for (i, id) in ids.iter().enumerate() {
            engine
                .add_activity(
                    (*id).to_string(),
                    overlapping_flat_track(i as f64 * 0.00002),
                    "Ride".into(),
                )
                .expect("add activity");
            engine
                .update_activity_metadata(
                    id,
                    Some(1_700_000_000 - i as i64 * 14 * 86_400),
                    Some("ride"),
                    Some(12_345.0),
                    Some(3_600),
                )
                .expect("metadata");
        }
    })
    .expect("engine");

    with_persistent_engine(|engine| {
        let handle = engine.detect_sections_background();
        let (main, cache_update) = handle.recv_with_cache();
        let (sections, processed_ids) = main.expect("detect");
        engine
            .apply_sections_with_cache(sections, cache_update)
            .expect("apply");
        engine
            .save_processed_activity_ids(&processed_ids)
            .expect("save");
    })
    .expect("engine");

    // What an older build left behind: a catalogue with no detector stamped
    // against it. `seed_older_build_engine` in `tests/cutover.rs` strips the
    // same key.
    let db = rusqlite::Connection::open(&path).expect("open");
    db.execute(
        "DELETE FROM schema_info WHERE key = 'catalogue_detection_method'",
        [],
    )
    .expect("strip the detector marker");

    assert!(
        with_persistent_engine(|e| e.get_sections().len()).expect("engine") > 0,
        "the seed detect produced no catalogue to archive"
    );
    (dir, path)
}

fn archived_rows(path: &std::path::Path) -> i64 {
    let conn = rusqlite::Connection::open(path).expect("reopen database");
    conn.query_row("SELECT COUNT(*) FROM section_catalogue_archive", [], |r| {
        r.get(0)
    })
    .expect("count the archive")
}

/// Scenario: a 0.3.x install upgrades. The launch fires the backfill and the
/// cutover trigger together, and the trigger declines while the queue is
/// non-empty, so the pass that drains the queue is the only thing that can
/// hand the catalogue over.
///
/// Expected behaviour: that pass runs the migration rather than a bare re-cut,
/// so the archive, the diff and the rollback all exist afterwards.
#[test]
fn a_drained_pass_hands_an_owed_catalogue_to_the_cutover() {
    let _serial = serial();
    let ids: Vec<String> = (0..4).map(|i| format!("ride_{i}")).collect();
    let refs: Vec<&str> = ids.iter().map(|s| s.as_str()).collect();
    let (_dir, path) = seeded_older_build_engine(&refs);

    assert!(
        veloqrs::ffi::is_cutover_pending(),
        "the seed is not owed a cutover, so this proves nothing"
    );
    assert_eq!(archived_rows(&path), 0, "the seed already archived");

    let server = MockServer::start();
    for (i, id) in ids.iter().enumerate() {
        server.mock(|when, then| {
            when.path(format!("/activity/{}/streams.json", id));
            then.status(200)
                .json_body(overlapping_elevated_streams(i as f64 * 0.00002));
        });
    }

    let run = run_backfill(&fast_transport(server.base_url()));
    let BackfillRun::Finished(outcome) = run else {
        panic!("expected a finished pass, got {:?}", run);
    };
    assert_eq!(outcome.elevated, 4, "the queue did not drain");
    assert_eq!(
        outcome.detects_started, 1,
        "the drained pass still owes one terminal cut"
    );

    assert!(
        archived_rows(&path) > 0,
        "the flat-era catalogue was replaced without being archived, so the \
         user has nothing to roll back to"
    );
    assert!(
        with_persistent_engine(|e| e.cutover_diff())
            .expect("engine")
            .is_some(),
        "no cutover diff was written, so the change card has no counts of the user's own"
    );
    assert!(
        !veloqrs::ffi::is_cutover_pending(),
        "the migration ran but did not finish"
    );
    drain_detection();
}

/// A pass that ends partial must leave the migration owed. Cutting a catalogue
/// over a half-elevated library is the thing the backfill exists to prevent,
/// and burning the one-shot token on it would make that permanent.
#[test]
fn a_partial_pass_leaves_the_cutover_owed() {
    let _serial = serial();
    let ids: Vec<String> = (0..4).map(|i| format!("ride_{i}")).collect();
    let refs: Vec<&str> = ids.iter().map(|s| s.as_str()).collect();
    let (_dir, path) = seeded_older_build_engine(&refs);
    assert!(veloqrs::ffi::is_cutover_pending());

    // Three answer, the fourth cannot be reached, so its row is untouched and
    // the queue is still non-empty when the pass ends.
    let server = MockServer::start();
    for (i, id) in ids.iter().enumerate().take(3) {
        server.mock(|when, then| {
            when.path(format!("/activity/{}/streams.json", id));
            then.status(200)
                .json_body(overlapping_elevated_streams(i as f64 * 0.00002));
        });
    }
    server.mock(|when, then| {
        when.path(format!("/activity/{}/streams.json", ids[3]));
        then.status(500);
    });

    let run = run_backfill(&fast_transport(server.base_url()));
    let BackfillRun::Finished(outcome) = run else {
        panic!("expected a finished pass, got {:?}", run);
    };
    assert_eq!(backfill_progress().phase, BACKFILL_PHASE_PARTIAL);
    assert_eq!(outcome.detects_started, 0, "a partial pass must not cut");

    assert_eq!(
        archived_rows(&path),
        0,
        "a partial pass archived a catalogue it had no business touching"
    );
    assert!(
        veloqrs::ffi::is_cutover_pending(),
        "a partial pass retired the migration"
    );
    drain_detection();
}

/// The second drained pass. A backfill that runs again after the migration has
/// completed must not archive over the snapshot the restore reads from.
#[test]
fn a_second_drained_pass_does_not_re_archive_over_the_first_snapshot() {
    let _serial = serial();
    let ids: Vec<String> = (0..4).map(|i| format!("ride_{i}")).collect();
    let refs: Vec<&str> = ids.iter().map(|s| s.as_str()).collect();
    let (_dir, path) = seeded_older_build_engine(&refs);

    let server = MockServer::start();
    for (i, id) in ids.iter().enumerate() {
        server.mock(|when, then| {
            when.path(format!("/activity/{}/streams.json", id));
            then.status(200)
                .json_body(overlapping_elevated_streams(i as f64 * 0.00002));
        });
    }
    let base = server.base_url();

    run_backfill(&fast_transport(base.clone()));
    let first = archived_rows(&path);
    assert!(first > 0, "the first pass did not archive");
    drain_detection();

    // A later launch with fresh flat tracks: the queue refills, drains again,
    // and the migration is no longer owed.
    with_persistent_engine(|engine| {
        engine
            .add_activity(
                "ride_4".to_string(),
                overlapping_flat_track(4.0 * 0.00002),
                "Ride".into(),
            )
            .expect("add activity");
    })
    .expect("engine");
    server.mock(|when, then| {
        when.path("/activity/ride_4/streams.json");
        then.status(200)
            .json_body(overlapping_elevated_streams(4.0 * 0.00002));
    });

    assert!(!veloqrs::ffi::is_cutover_pending());
    run_backfill(&fast_transport(base));

    assert_eq!(
        archived_rows(&path),
        first,
        "the second pass re-archived, burying the snapshot the restore needs"
    );
    drain_detection();
}

// ============================================================================
// A pass with nothing to work with
// ============================================================================

/// The pass counts every queued track against a connection that is gone, one
/// request at a time, and only then reports partial. On the captive-portal
/// case each of those requests can cost four thirty-second attempts, so the
/// bound has to come from the failures rather than from the queue.

/// A queue longer than the threshold, so a pass that stops at the threshold
/// is distinguishable from one that ran to the end.
fn long_queue_ids() -> Vec<String> {
    (0..MAX_CONSECUTIVE_FAILURES as u32 + 10)
        .map(|i| format!("q{i}"))
        .collect()
}

fn seeded_long_queue() -> (TempDir, Vec<String>) {
    let ids = long_queue_ids();
    let refs: Vec<&str> = ids.iter().map(String::as_str).collect();
    let (dir, _path) = seeded_engine(&refs);
    (dir, ids)
}

/// Every activity in `ids` answers `status`. `Retry-After: 0` keeps a 429
/// test fast while still taking the header path the transport honours.
fn answer_all(server: &MockServer, ids: &[String], status: u16, retry_after: bool) {
    for id in ids {
        server.mock(|when, then| {
            when.path(format!("/activity/{id}/streams.json"));
            let then = then.status(status).body("nothing to give");
            if retry_after {
                then.header("Retry-After", "0");
            }
        });
    }
}

#[test]
fn a_connection_that_is_gone_stops_the_pass_at_the_threshold_not_at_the_queue() {
    let _serial = serial();
    let (_dir, ids) = seeded_long_queue();

    let server = MockServer::start();
    answer_all(&server, &ids, 500, false);

    let run = run_backfill(&fast_transport(server.base_url()));
    let BackfillRun::Finished(outcome) = run else {
        panic!("a dead connection is not a failed pass, it is an unfinished one: {run:?}");
    };

    assert_eq!(outcome.queued, ids.len() as u32);
    assert_eq!(
        outcome.failed, MAX_CONSECUTIVE_FAILURES as u32,
        "the pass spent the whole queue instead of stopping at the threshold"
    );
    assert_eq!(outcome.elevated, 0);
    assert_eq!(
        queue_ids().len(),
        ids.len(),
        "a failed fetch leaves its row untouched, so the queue is unchanged"
    );
    assert_eq!(
        backfill_progress().phase,
        BACKFILL_PHASE_PARTIAL,
        "the next launch has to retry, so the pass is partial and not failed"
    );
}

#[test]
fn an_exhausted_budget_stops_the_pass_the_same_way() {
    let _serial = serial();
    let (_dir, ids) = seeded_long_queue();

    let server = MockServer::start();
    answer_all(&server, &ids, 429, true);

    let run = run_backfill(&fast_transport(server.base_url()));
    let BackfillRun::Finished(outcome) = run else {
        panic!("an exhausted budget is not a failed pass: {run:?}");
    };

    assert_eq!(outcome.failed, MAX_CONSECUTIVE_FAILURES as u32);
    assert_eq!(queue_ids().len(), ids.len());
    assert_eq!(backfill_progress().phase, BACKFILL_PHASE_PARTIAL);
}

/// Upstream answering about one activity is not the connection going away. A
/// permanently 404-ing prefix would otherwise wedge the queue: every run
/// re-derives the same order and would stop at the same place forever.
#[test]
fn an_answer_about_one_activity_does_not_stop_the_pass() {
    let _serial = serial();
    let (_dir, ids) = seeded_long_queue();

    let server = MockServer::start();
    answer_all(&server, &ids, 404, false);

    let run = run_backfill(&fast_transport(server.base_url()));
    let BackfillRun::Finished(outcome) = run else {
        panic!("expected a finished pass, got {run:?}");
    };

    assert_eq!(
        outcome.failed,
        ids.len() as u32,
        "a 404 answers for its own activity, so the pass walks the whole queue"
    );
}

/// The threshold counts consecutive failures, not the pass's total. A flaky
/// connection landing work between the failures must run the queue out.
#[test]
fn work_landing_between_the_failures_keeps_the_pass_going() {
    let _serial = serial();
    let (_dir, ids) = seeded_long_queue();

    let server = MockServer::start();
    for (i, id) in ids.iter().enumerate() {
        server.mock(|when, then| {
            when.path(format!("/activity/{id}/streams.json"));
            if i % 2 == 0 {
                then.status(500).body("upstream is down");
            } else {
                then.status(200)
                    .json_body(elevated_streams(i as f64 * 0.05));
            }
        });
    }

    let run = run_backfill(&fast_transport(server.base_url()));
    let BackfillRun::Finished(outcome) = run else {
        panic!("expected a finished pass, got {run:?}");
    };

    assert_eq!(
        outcome.elevated + outcome.failed,
        ids.len() as u32,
        "the run of failures never reached the threshold, so nothing should have stopped"
    );
    assert!(outcome.elevated > 0);
}

// ============================================================================
// Backoff inside the pass
//
// Scenario: the connection drops for a moment part way through a long pass.
// Expected behaviour: the pass re-asks the tracks the connection refused,
// waiting longer before each round, rather than deferring every one of them to
// the next cold launch. Bounded, so a connection that is really gone still ends
// the pass rather than looping on it.
//
// One ask is four hits: the backfill lane retries a transient answer three
// times inside the request before it gives the pass an error to work with.
// `Retry-After: 0` keeps that ladder fast while still taking the path the
// transport honours.
// ============================================================================

const HITS_PER_ASK: usize = 4;

static REFUSALS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// Refuses the first ask, whichever activity it is for, then stops refusing.
/// Tests are serialised, so the count belongs to the one running.
fn refuse_the_first_ask(_req: &httpmock::prelude::HttpMockRequest) -> bool {
    REFUSALS.fetch_add(1, std::sync::atomic::Ordering::SeqCst) < HITS_PER_ASK
}

/// `id` is refused once, then answers with altitude.
fn refused_once_then_elevated(server: &MockServer, id: &str, seed: f64) {
    REFUSALS.store(0, std::sync::atomic::Ordering::SeqCst);
    let path = format!("/activity/{id}/streams.json");
    let refused = path.clone();
    server.mock(|when, then| {
        when.path(refused).matches(refuse_the_first_ask);
        then.status(429)
            .header("Retry-After", "0")
            .body("slow down");
    });
    server.mock(|when, then| {
        when.path(path);
        then.status(200).json_body(elevated_streams(seed));
    });
}

#[test]
fn a_transient_failure_is_re_asked_inside_the_pass_rather_than_next_launch() {
    let _serial = serial();
    let (_dir, _path) = seeded_engine(&["a", "b"]);

    let server = MockServer::start();
    refused_once_then_elevated(&server, "a", 0.0);
    server.mock(|when, then| {
        when.path("/activity/b/streams.json");
        then.status(200).json_body(elevated_streams(0.4));
    });

    let run = run_backfill(&fast_transport(server.base_url()));
    let BackfillRun::Finished(outcome) = run else {
        panic!("expected a finished pass, got {run:?}");
    };

    assert_eq!(
        outcome.elevated, 2,
        "the track the connection refused was never re-asked inside the pass"
    );
    assert_eq!(outcome.failed, 0, "a track that landed is not a failure");
    assert!(
        queue_ids().is_empty(),
        "the queue drained, so nothing is owed"
    );
    assert_eq!(backfill_progress().phase, BACKFILL_PHASE_COMPLETE);
}

#[test]
fn the_re_asking_is_bounded_and_waits_longer_each_round() {
    let _serial = serial();
    let (_dir, _path) = seeded_engine(&["a"]);

    let server = MockServer::start();
    let mock = server.mock(|when, then| {
        when.path("/activity/a/streams.json");
        then.status(429)
            .header("Retry-After", "0")
            .body("slow down");
    });

    let started = Instant::now();
    let run = run_backfill(&fast_transport(server.base_url()));
    let elapsed = started.elapsed();
    let BackfillRun::Finished(outcome) = run else {
        panic!("expected a finished pass, got {run:?}");
    };

    assert_eq!(
        outcome.failed, 1,
        "one track failed, however many times it was asked"
    );
    assert_eq!(outcome.elevated, 0);
    assert_eq!(
        mock.hits(),
        HITS_PER_ASK * (1 + BACKFILL_RETRY_ROUNDS),
        "the first ask plus one per bounded round, and no more"
    );

    let ladder: Duration = backfill_retry_delays().iter().sum();
    assert!(
        elapsed >= ladder,
        "the rounds ran back to back instead of backing off: {elapsed:?} < {ladder:?}"
    );
    assert!(
        backfill_retry_delays().windows(2).all(|w| w[1] > w[0]),
        "each round has to wait longer than the one before it"
    );
    assert_eq!(
        backfill_progress().phase,
        BACKFILL_PHASE_PARTIAL,
        "the queue is not drained, so the next run still has work"
    );
    assert_eq!(queue_ids().len(), 1);
}

#[test]
fn an_answer_about_one_activity_is_asked_once_and_not_re_asked() {
    let _serial = serial();
    let (_dir, _path) = seeded_engine(&["a"]);

    let server = MockServer::start();
    let mock = server.mock(|when, then| {
        when.path("/activity/a/streams.json");
        then.status(404).body("no such activity");
    });

    let run = run_backfill(&fast_transport(server.base_url()));
    let BackfillRun::Finished(outcome) = run else {
        panic!("expected a finished pass, got {run:?}");
    };

    assert_eq!(
        mock.hits(),
        1,
        "a 404 is upstream answering, not the connection going away"
    );
    assert_eq!(outcome.failed, 1);
}

#[test]
fn a_connection_that_is_gone_is_not_re_asked_at_all() {
    let _serial = serial();
    let (_dir, ids) = seeded_long_queue();

    let server = MockServer::start();
    answer_all(&server, &ids, 429, true);

    let started = Instant::now();
    let run = run_backfill(&fast_transport(server.base_url()));
    let elapsed = started.elapsed();
    let BackfillRun::Finished(outcome) = run else {
        panic!("expected a finished pass, got {run:?}");
    };

    assert_eq!(
        outcome.failed, MAX_CONSECUTIVE_FAILURES as u32,
        "the stop threshold already decided nothing is coming back"
    );
    let ladder: Duration = backfill_retry_delays().iter().sum();
    assert!(
        elapsed < ladder,
        "a pass stopped for a dead connection spent the backoff anyway: {elapsed:?}"
    );
}

#[test]
fn re_asking_never_reports_more_progress_than_the_queue_held() {
    let _serial = serial();
    let (_dir, _path) = seeded_engine(&["a", "b"]);

    let server = MockServer::start();
    refused_once_then_elevated(&server, "a", 0.0);
    server.mock(|when, then| {
        when.path("/activity/b/streams.json");
        then.status(200).json_body(elevated_streams(0.4));
    });

    run_backfill(&fast_transport(server.base_url()));

    let progress = backfill_progress();
    assert_eq!(progress.total, 2);
    assert_eq!(
        progress.completed, 2,
        "the retry counted its tracks a second time"
    );
}

/// Scenario: a token is revoked while the backfill is the only thing talking
/// to intervals.icu.
///
/// Expected behaviour: the rejected credential reaches the same park a sync
/// step's 401 does, so the one hook that signs the session out sees it.
/// Without this the pass ends "failed", the settings line says the update
/// could not run, and the dead session stands until something else asks.
#[test]
fn a_rejected_credential_parks_the_sync_service() {
    let _serial = serial();
    let (_dir, _path) = seeded_engine(&["a1", "a2"]);
    live_session();

    let server = MockServer::start();
    server.mock(|when, then| {
        when.path_contains("/streams.json");
        then.status(401);
    });
    confirm_rejection(&server);

    let run = run_backfill(&fast_oauth_transport(server.base_url()));
    assert!(
        matches!(run, BackfillRun::Failed(_)),
        "a rejected credential fails the pass, got {:?}",
        run
    );

    let status = SYNC_SERVICE.snapshot();
    assert_eq!(
        status.state,
        SyncState::AuthExpired,
        "the 401 never reached the session-expiry path"
    );
    assert_eq!(status.last_error.as_deref(), Some("unauthorized"));
}

/// The park is auth-method agnostic, exactly as `Q20` decided. What an
/// API-key session then does with it is `B90`, not this.
#[test]
fn an_api_key_401_parks_the_service_too() {
    let _serial = serial();
    let (_dir, _path) = seeded_engine(&["a1"]);
    live_session();

    let server = MockServer::start();
    server.mock(|when, then| {
        when.path_contains("/streams.json");
        then.status(401);
    });
    confirm_rejection(&server);

    run_backfill(&fast_transport(server.base_url()));

    assert_eq!(sync_state(), SyncState::AuthExpired);
}

/// Scenario: a track is refused but the credential still works.
///
/// Expected behaviour: one 401 is not evidence, so the profile is asked and
/// answers, and the session stands. The pass still fails, because the track it
/// wanted was refused, but nobody is signed out over it.
#[test]
fn a_single_401_does_not_sign_the_athlete_out() {
    let _serial = serial();
    let (_dir, _path) = seeded_engine(&["a1"]);
    live_session();

    let server = MockServer::start();
    server.mock(|when, then| {
        when.path_contains("/streams.json");
        then.status(401);
    });
    server.mock(|when, then| {
        when.path("/athlete/i1");
        then.status(200).json_body(json!({"id": "i1"}));
    });

    let run = run_backfill(&fast_transport(server.base_url()));

    assert!(
        matches!(run, BackfillRun::Failed(_)),
        "the refused track still fails the pass, got {:?}",
        run
    );
    assert_eq!(
        sync_state(),
        SyncState::Idle,
        "a single 401 signed the athlete out with a working credential"
    );
}

/// A confirmation the server cannot answer confirms nothing either.
#[test]
fn a_confirmation_that_errors_leaves_the_session_alone() {
    let _serial = serial();
    let (_dir, _path) = seeded_engine(&["a1"]);
    live_session();

    let server = MockServer::start();
    server.mock(|when, then| {
        when.path_contains("/streams.json");
        then.status(401);
    });
    server.mock(|when, then| {
        when.path("/athlete/i1");
        then.status(500);
    });

    run_backfill(&fast_transport(server.base_url()));

    assert_eq!(
        sync_state(),
        SyncState::Idle,
        "a 5xx on the confirmation is not the server rejecting the credential"
    );
}

/// A connection that is gone says nothing about the credential, so the pass
/// gives up without signing anybody out.
#[test]
fn a_connectivity_failure_leaves_the_session_alone() {
    let _serial = serial();
    let (_dir, _path) = seeded_engine(&["a1", "a2"]);
    live_session();

    let server = MockServer::start();
    server.mock(|when, then| {
        when.path_contains("/streams.json");
        then.status(503);
    });

    run_backfill(&fast_transport(server.base_url()));

    assert_eq!(
        sync_state(),
        SyncState::Idle,
        "a 5xx is not a rejected credential and must not sign the athlete out"
    );
}

/// Neither does a pass that works.
#[test]
fn a_clean_pass_leaves_the_session_alone() {
    let _serial = serial();
    let (_dir, _path) = seeded_engine(&["a1"]);
    live_session();

    let server = MockServer::start();
    server.mock(|when, then| {
        when.path_contains("/streams.json");
        then.status(200).json_body(elevated_streams(0.0));
    });

    run_backfill(&fast_transport(server.base_url()));
    drain_detection();

    assert_eq!(sync_state(), SyncState::Idle);
}

/// The second pass parks too. Nothing latches the first one, so a resume that
/// runs while the token is still dead reports it again rather than falling
/// silent.
#[test]
fn a_second_rejected_pass_parks_again() {
    let _serial = serial();
    let (_dir, _path) = seeded_engine(&["a1"]);
    live_session();

    let server = MockServer::start();
    server.mock(|when, then| {
        when.path_contains("/streams.json");
        then.status(401);
    });
    confirm_rejection(&server);

    run_backfill(&fast_transport(server.base_url()));
    assert_eq!(sync_state(), SyncState::AuthExpired);

    live_session();
    run_backfill(&fast_transport(server.base_url()));
    assert_eq!(
        sync_state(),
        SyncState::AuthExpired,
        "the second pass fell silent"
    );
}

// ============================================================================
// Elevation alone, spliced onto the stored track
// ============================================================================

/// The altitude series on its own, index-aligned with the samples upstream
/// holds. This is all the pass asks for.
fn altitude_only(count: usize) -> serde_json::Value {
    let alts: Vec<f64> = (0..count).map(|i| 1000.0 + i as f64 * 12.0).collect();
    json!([{"type": "fixed_altitude", "data": alts}])
}

/// A full-track response whose coordinates are nowhere near the stored ones,
/// so a pass that takes upstream's geometry is caught by the assertion rather
/// than by a byte count.
fn moved_streams(count: usize) -> serde_json::Value {
    let lats: Vec<f64> = (0..count).map(|i| 12.0 + i as f64 * 0.001).collect();
    let lngs: Vec<f64> = (0..count).map(|_| 99.0).collect();
    let alts: Vec<f64> = (0..count).map(|i| 500.0 + i as f64).collect();
    json!([
        {"type": "latlng", "data": lats, "data2": lngs},
        {"type": "fixed_altitude", "data": alts}
    ])
}

fn stored_track(id: &str) -> Vec<GpsPoint> {
    with_persistent_engine(|engine| engine.get_gps_track(id))
        .expect("engine")
        .expect("stored track")
}

/// The coordinates are already on the device, so the pass asks for altitude
/// alone and splices it onto the points it already holds. Nothing about the
/// track moves, so the catalogue derived from it is not invalidated.
#[test]
fn elevation_is_spliced_onto_the_stored_track_and_the_coordinates_do_not_move() {
    let _serial = serial();
    let (_dir, _path) = seeded_engine(&["a1"]);
    let before = stored_track("a1");

    let server = MockServer::start();
    let elevation = server.mock(|when, then| {
        when.path("/activity/a1/streams.json")
            .query_param("types", "fixed_altitude,altitude");
        then.status(200).json_body(altitude_only(before.len()));
    });
    let whole_track = server.mock(|when, then| {
        when.path("/activity/a1/streams.json")
            .query_param("types", "latlng,fixed_altitude,altitude");
        then.status(200).json_body(moved_streams(before.len()));
    });

    let run = run_backfill(&fast_transport(server.base_url()));
    let BackfillRun::Finished(outcome) = run else {
        panic!("expected a finished pass, got {:?}", run);
    };

    assert_eq!(outcome.elevated, 1);
    elevation.assert();
    assert_eq!(
        whole_track.hits(),
        0,
        "a track whose sample count still matches must not be re-downloaded"
    );

    let after = stored_track("a1");
    assert_eq!(after.len(), before.len());
    for (was, now) in before.iter().zip(&after) {
        assert_eq!(
            (was.latitude, was.longitude),
            (now.latitude, now.longitude),
            "the stored coordinates moved"
        );
    }
    assert_eq!(
        after.iter().map(|p| p.elevation).collect::<Vec<_>>(),
        (0..before.len())
            .map(|i| Some(1000.0 + i as f64 * 12.0))
            .collect::<Vec<_>>()
    );
    assert_eq!(state_of("a1"), FETCHED);
    drain_detection();
}

/// A sample count that disagrees with the stored track means intervals.icu
/// re-processed the activity. That is the one case where the whole track is
/// fetched again and replaced, and the catalogue has to be re-derived from it.
#[test]
fn a_track_whose_sample_count_moved_upstream_is_fetched_whole() {
    let _serial = serial();
    let (_dir, _path) = seeded_engine(&["a1"]);
    let before = stored_track("a1");
    let moved = before.len() + 2;

    let server = MockServer::start();
    let elevation = server.mock(|when, then| {
        when.path("/activity/a1/streams.json")
            .query_param("types", "fixed_altitude,altitude");
        then.status(200).json_body(altitude_only(moved));
    });
    let whole_track = server.mock(|when, then| {
        when.path("/activity/a1/streams.json")
            .query_param("types", "latlng,fixed_altitude,altitude");
        then.status(200).json_body(moved_streams(moved));
    });

    let run = run_backfill(&fast_transport(server.base_url()));
    let BackfillRun::Finished(outcome) = run else {
        panic!("expected a finished pass, got {:?}", run);
    };

    assert_eq!(outcome.elevated, 1);
    elevation.assert();
    whole_track.assert();

    let after = stored_track("a1");
    assert_eq!(
        after.len(),
        moved,
        "the replaced track is the one upstream has"
    );
    assert_eq!(state_of("a1"), FETCHED);
    drain_detection();
}

/// Upstream answering with an altitude series it cannot fill is a final
/// answer, not a transient one. The track is left exactly as it is.
#[test]
fn an_altitude_series_upstream_cannot_fill_leaves_the_track_alone() {
    let _serial = serial();
    let (_dir, _path) = seeded_engine(&["a1"]);
    let before = stored_track("a1");

    let server = MockServer::start();
    server.mock(|when, then| {
        when.path("/activity/a1/streams.json")
            .query_param("types", "fixed_altitude,altitude");
        then.status(200).json_body(json!([
            {"type": "fixed_altitude", "data": [null, null, null, null, null, null, null, null]}
        ]));
    });
    let whole_track = server.mock(|when, then| {
        when.path("/activity/a1/streams.json")
            .query_param("types", "latlng,fixed_altitude,altitude");
        then.status(200).json_body(moved_streams(before.len()));
    });

    let run = run_backfill(&fast_transport(server.base_url()));
    let BackfillRun::Finished(outcome) = run else {
        panic!("expected a finished pass, got {:?}", run);
    };

    assert_eq!(outcome.unavailable, 1);
    assert_eq!(outcome.elevated, 0);
    assert_eq!(
        whole_track.hits(),
        0,
        "an answered activity is not re-asked"
    );
    assert_eq!(state_of("a1"), UNAVAILABLE);
    assert_eq!(stored_track("a1"), before, "the track must not be touched");
    assert!(
        queue_ids().is_empty(),
        "an answered activity does not stay in the queue"
    );
    drain_detection();
}

/// An elevation ask that comes back with nothing cannot say whether upstream
/// has no altitude or answered with nothing at all, and those end differently.
/// The whole track settles it, and only for those activities.
#[test]
fn an_answer_with_no_altitude_series_is_settled_by_the_whole_track() {
    let _serial = serial();
    let (_dir, _path) = seeded_engine(&["bare", "gone"]);

    let server = MockServer::start();
    for id in ["bare", "gone"] {
        server.mock(|when, then| {
            when.path(format!("/activity/{}/streams.json", id))
                .query_param("types", "fixed_altitude,altitude");
            then.status(200).json_body(json!([]));
        });
    }
    // Coordinates and no altitude: upstream has answered, permanently.
    let bare = server.mock(|when, then| {
        when.path("/activity/bare/streams.json")
            .query_param("types", "latlng,fixed_altitude,altitude");
        then.status(200).json_body(flat_streams(0.0));
    });
    // Nothing at all: a transient answer, so the row waits for the next pass.
    let gone = server.mock(|when, then| {
        when.path("/activity/gone/streams.json")
            .query_param("types", "latlng,fixed_altitude,altitude");
        then.status(200).json_body(json!([]));
    });

    let run = run_backfill(&fast_transport(server.base_url()));
    let BackfillRun::Finished(outcome) = run else {
        panic!("expected a finished pass, got {:?}", run);
    };

    bare.assert();
    gone.assert();
    assert_eq!(outcome.unavailable, 1);
    assert_eq!(state_of("bare"), UNAVAILABLE);
    assert_eq!(state_of("gone"), UNKNOWN);
    assert_eq!(queue_ids(), vec!["gone"]);
    drain_detection();
}

/// B252: the terminal cut was guarded on `fetched > 0`, a library-wide count of
/// elevated tracks. A library where upstream has altitude for nothing drains
/// its queue honestly and elevates nothing, so the cut never fired, and since
/// `SB12` an owed cutover then refuses every detect for the rest of the
/// session.
#[test]
fn a_pass_whose_library_has_no_altitude_upstream_still_cuts() {
    let _serial = serial();
    let (_dir, _path) = seeded_engine(&["a1", "a2"]);

    let server = MockServer::start();
    server.mock(|when, then| {
        when.path("/activity/a1/streams.json");
        then.status(200).json_body(flat_streams(0.0));
    });
    server.mock(|when, then| {
        when.path("/activity/a2/streams.json");
        then.status(200).json_body(flat_streams(0.05));
    });

    let run = run_backfill(&fast_transport(server.base_url()));
    let BackfillRun::Finished(outcome) = run else {
        panic!("expected a finished pass, got {:?}", run);
    };

    assert_eq!(outcome.elevated, 0, "upstream had altitude for nothing");
    assert_eq!(outcome.unavailable, 2);
    assert_eq!(state_of("a1"), UNAVAILABLE);
    assert_eq!(state_of("a2"), UNAVAILABLE);
    assert!(queue_ids().is_empty(), "the queue drained honestly");
    assert_eq!(
        backfill_progress().phase,
        BACKFILL_PHASE_COMPLETE,
        "a drained queue is a complete conversion whatever upstream held"
    );
    assert_eq!(
        outcome.detects_started, 1,
        "the pass that drains the queue owes the re-cut, elevated or not"
    );
    drain_detection();
}

/// The clause `fetched > 0` was written for this, and it still has to hold: an
/// earlier pass elevated tracks and died before its cut, and the pass that
/// finishes the queue makes good on it.
#[test]
fn a_pass_finishing_an_earlier_pass_still_cuts() {
    let _serial = serial();
    let (_dir, _path) = seeded_engine(&["a1", "a2"]);

    let server = MockServer::start();
    let mut broken = server.mock(|when, then| {
        when.path("/activity/a2/streams.json");
        then.status(500);
    });
    server.mock(|when, then| {
        when.path("/activity/a1/streams.json");
        then.status(200).json_body(elevated_streams(0.0));
    });

    let first = run_backfill(&fast_transport(server.base_url()));
    let BackfillRun::Finished(first) = first else {
        panic!("expected a finished pass");
    };
    assert_eq!(first.elevated, 1);
    assert_eq!(first.detects_started, 0, "a partial pass must not cut");
    drain_detection();

    broken.delete();
    server.mock(|when, then| {
        when.path("/activity/a2/streams.json");
        then.status(200).json_body(flat_streams(0.05));
    });

    let second = run_backfill(&fast_transport(server.base_url()));
    let BackfillRun::Finished(second) = second else {
        panic!("expected a finished pass");
    };
    assert!(queue_ids().is_empty());
    assert_eq!(
        second.detects_started, 1,
        "the pass that drains makes good on the earlier one's cut"
    );
    drain_detection();
}

/// Scenario: the athlete pauses the download while a pass is fetching. The
/// pass ends at its next batch boundary and reports `paused`, so the page can
/// say the download resumes when the app is next opened. The queue is left
/// half full, so the final re-cut, which is only honest over a fully
/// converted library, must not fire, and detection must come back on.
#[test]
fn a_paused_pass_ends_paused_without_the_final_recut_and_releases_detection() {
    let _serial = serial();
    reset_elevation_backfill_pause();
    let ids: Vec<String> = (0..2 * MAX_CONSECUTIVE_FAILURES)
        .map(|i| format!("a{}", i))
        .collect();
    let refs: Vec<&str> = ids.iter().map(|s| s.as_str()).collect();
    let (_dir, _path) = seeded_engine(&refs);
    let detects_before = detect_runs_started();

    let server = MockServer::start();
    for (i, id) in ids.iter().enumerate() {
        server.mock(|when, then| {
            when.path(format!("/activity/{}/streams.json", id));
            then.status(200)
                .delay(Duration::from_millis(150))
                .json_body(elevated_streams(i as f64 * 0.02));
        });
    }

    let base = server.base_url();
    let runner = std::thread::spawn(move || run_backfill(&fast_transport(base)));
    wait_for_fetching();
    assert!(pause_elevation_backfill(), "a pass was in flight to stop");

    let run = runner.join().expect("runner thread");
    let BackfillRun::Finished(outcome) = run else {
        panic!("a paused pass still finishes: {run:?}");
    };
    assert_eq!(backfill_progress().phase, BACKFILL_PHASE_PAUSED);
    assert!(
        outcome.elevated > 0,
        "the batch in flight was allowed to land"
    );
    assert!(outstanding() > 0, "the rest of the queue is still owed");
    assert_eq!(outcome.detects_started, 0);
    assert_eq!(
        detect_runs_started(),
        detects_before,
        "no re-cut over a half-converted library"
    );
    assert!(
        !detection_suspended(),
        "the guard must release when the pass ends"
    );

    reset_elevation_backfill_pause();
    drain_detection();
}
