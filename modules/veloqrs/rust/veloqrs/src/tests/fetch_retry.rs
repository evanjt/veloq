//! Scenario: a track download fails and the engine, not the caller, re-offers it.
//! Expected behaviour: the failed id is asked for again inside the one run, the
//! attempt store records each failure, and a landed track leaves no row.

use std::io::{Read, Write};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant};

use super::{
    start_fetch_and_store_ending_with_fetcher, start_fetch_and_store_with_fetcher,
    take_fetch_and_store_result,
};
use crate::ffi::FetchAndStoreResult;
use crate::governor::{Allowance, AuthMethod, Budget, Governor, NoopPolicy, SYNC_ALLOWANCE};
use crate::http::{ActivityFetcher, DownloadPriority};
use crate::net::transport::Transport;
use crate::persistence::attempts::JobKey;

const TRACK: &str = r#"[{"type":"latlng","data":[46.0,46.1],"data2":[7.0,7.1]}]"#;

/// A track as the bulk ingest asks for it, its clock included, so the run
/// owes no second request for the time stream.
const TIMED_TRACK: &str =
    r#"[{"type":"latlng","data":[46.0,46.1],"data2":[7.0,7.1]},{"type":"time","data":[0,1]}]"#;

/// What the server answers a track request with: a status line, any extra
/// headers, and a body.
type Reply = fn(u32) -> (&'static str, &'static str, &'static str);

/// A status that closes the connection without answering.
const HANG_UP: &str = "hang up";

struct FakeServer {
    base: String,
    track_requests: Arc<AtomicU32>,
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl FakeServer {
    /// Answers the first `bad_replies` track requests with a body that does not
    /// parse, and every later request with a usable track.
    fn start(bad_replies: u32) -> Self {
        Self::answering(match bad_replies {
            0 => |_| ("200 OK", "", TRACK),
            1 => |n| ("200 OK", "", if n < 1 { "not json" } else { TRACK }),
            _ => |_| ("200 OK", "", "not json"),
        })
    }

    /// Answers the `n`th track request, counting from zero, with `reply(n)`,
    /// and every other request with an empty list.
    fn answering(reply: Reply) -> Self {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        listener.set_nonblocking(true).expect("nonblocking");
        let base = format!("http://{}", listener.local_addr().expect("address"));
        let track_requests = Arc::new(AtomicU32::new(0));
        let stop = Arc::new(AtomicBool::new(false));
        let (seen, halt) = (Arc::clone(&track_requests), Arc::clone(&stop));
        let thread = std::thread::spawn(move || {
            while !halt.load(Ordering::Relaxed) {
                let Ok((mut socket, _)) = listener.accept() else {
                    std::thread::sleep(Duration::from_millis(2));
                    continue;
                };
                socket.set_nonblocking(false).ok();
                let mut buf = [0u8; 4096];
                let n = socket.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]);
                let (status, headers, body) = if request.contains("types=latlng") {
                    reply(seen.fetch_add(1, Ordering::Relaxed))
                } else {
                    ("200 OK", "", "[]")
                };
                if status == HANG_UP {
                    continue;
                }
                let _ = write!(
                    socket,
                    "HTTP/1.1 {}\r\n{}Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    status,
                    headers,
                    body.len(),
                    body
                );
            }
        });
        Self {
            base,
            track_requests,
            stop,
            thread: Some(thread),
        }
    }

    fn fetcher(&self) -> ActivityFetcher {
        self.fetcher_on(Arc::new(Governor::new(1000, Box::new(NoopPolicy))))
    }

    fn fetcher_on(&self, governor: Arc<Governor>) -> ActivityFetcher {
        let transport =
            Transport::with_governor(self.base.clone(), AuthMethod::ApiKey("test"), governor)
                .expect("transport");
        ActivityFetcher::with_transport(transport)
    }

    fn requests(&self) -> u32 {
        self.track_requests.load(Ordering::Relaxed)
    }
}

impl Drop for FakeServer {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            thread.join().ok();
        }
    }
}

fn run_to_end(
    server: &FakeServer,
    id: &str,
    priority: DownloadPriority,
) -> crate::ffi::FetchAndStoreResult {
    settle(start_fetch_and_store_with_fetcher(
        vec![id.to_string()],
        vec![],
        priority,
        server.fetcher(),
    ))
}

fn settle(run: f64) -> crate::ffi::FetchAndStoreResult {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if let Some(result) = take_fetch_and_store_result(run) {
            return result;
        }
        assert!(Instant::now() < deadline, "the run never settled");
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn attempts_for(id: &str) -> Option<u32> {
    crate::with_persistent_engine(|e| e.job_attempt(&JobKey::new("gps_track", &[id])))
        .expect("engine")
        .expect("read")
        .map(|row| row.attempts)
}

#[test]
fn a_failed_track_is_asked_for_again_inside_the_run_and_leaves_no_row() {
    let _serial = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("fetch_retry_recovers.db");
    let server = FakeServer::start(1);

    let result = run_to_end(&server, "ride-1", DownloadPriority::Bulk);

    assert_eq!(result.synced_ids, vec!["ride-1".to_string()]);
    assert!(result.failed_ids.is_empty());
    assert_eq!(server.requests(), 2);
    assert_eq!(attempts_for("ride-1"), None);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_track_that_keeps_failing_stops_at_the_bound_and_the_engine_remembers() {
    let _serial = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("fetch_retry_bounded.db");
    let server = FakeServer::start(u32::MAX);

    let result = run_to_end(&server, "ride-2", DownloadPriority::Bulk);

    assert!(result.synced_ids.is_empty());
    assert_eq!(result.failed_ids, vec!["ride-2".to_string()]);
    assert_eq!(server.requests(), 3);
    assert_eq!(attempts_for("ride-2"), Some(3));
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_map_tap_is_not_held_back_by_a_backoff() {
    let _serial = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("fetch_retry_interactive.db");
    let server = FakeServer::start(u32::MAX);
    run_to_end(&server, "ride-3", DownloadPriority::Bulk);
    let before = server.requests();

    run_to_end(&server, "ride-3", DownloadPriority::Interactive);

    assert!(server.requests() > before, "the tap went out");
}

fn ids(count: usize) -> Vec<String> {
    (0..count).map(|index| format!("ride-{index}")).collect()
}

fn budgeted(budget: Budget) -> Arc<Governor> {
    Arc::new(Governor::new(1000, Box::new(NoopPolicy)).with_budget(budget, None, || 0.0))
}

fn bulk_run(
    server: &FakeServer,
    ids: Vec<String>,
    governor: &Arc<Governor>,
) -> FetchAndStoreResult {
    settle(start_fetch_and_store_with_fetcher(
        ids,
        vec![],
        DownloadPriority::Bulk,
        server.fetcher_on(Arc::clone(governor)),
    ))
}

/// Scenario: a fresh install downloads the tracks of a library of a few
/// hundred activities, and intervals.icu refuses nothing.
///
/// Expected behaviour: every track lands on the shipped allowance, so no route
/// is reported missing and nothing is left owed.
#[test]
fn a_first_sync_of_three_hundred_tracks_lands_every_one_on_the_shipped_allowance() {
    let _serial = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("fetch_budget_first_sync.db");
    let server = FakeServer::answering(|_| ("200 OK", "", TIMED_TRACK));
    let governor = budgeted(Budget::new(0));

    let result = bulk_run(&server, ids(300), &governor);

    assert_eq!(result.synced_ids.len(), 300);
    assert_eq!(result.failed_ids, Vec::<String>::new());
    assert_eq!(result.owed_ids, Vec::<String>::new());
    assert_eq!(server.requests(), 300);
    assert_eq!(governor.cooldown_until(chrono::Utc::now()), None);
}

/// Scenario: the install's own allowance is spent part way through a run, and
/// intervals.icu has refused nothing.
///
/// Expected behaviour: the tracks held back are owed, not failed, so the run
/// reports no missing route, and no backoff grows against them.
#[test]
fn a_track_the_allowance_holds_back_is_owed_and_not_failed() {
    let _serial = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("fetch_budget_owed.db");
    let server = FakeServer::answering(|_| ("200 OK", "", TIMED_TRACK));
    let one = Allowance {
        per_fifteen_minutes: Some(1),
        per_day: None,
    };
    let governor = budgeted(Budget::with_allowances(one, SYNC_ALLOWANCE, 0));

    let result = bulk_run(&server, ids(3), &governor);

    assert_eq!(result.synced_ids.len(), 1);
    assert_eq!(result.failed_ids, Vec::<String>::new());
    let mut owed = result.owed_ids.clone();
    owed.extend(result.synced_ids.iter().cloned());
    owed.sort();
    assert_eq!(owed, ids(3));
    assert_eq!(server.requests(), 1);
    for id in &result.owed_ids {
        assert_eq!(attempts_for(id), None, "{id} grew a backoff");
    }
}

/// Scenario: intervals.icu answers a track request with its own quota
/// refusal, a long `Retry-After`.
///
/// Expected behaviour: the refusal sets the cooldown, and the track it held
/// back is owed rather than reported missing.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_track_intervals_icu_refuses_sets_the_cooldown_and_is_owed() {
    let _serial = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("fetch_budget_refused.db");
    let server = FakeServer::answering(|_| ("429 Too Many Requests", "Retry-After: 600\r\n", ""));
    let governor = budgeted(Budget::new(0));

    let result = bulk_run(&server, ids(1), &governor);

    assert!(governor.cooldown_until(chrono::Utc::now()).is_some());
    assert_eq!(result.failed_ids, Vec::<String>::new());
    assert_eq!(result.owed_ids, ids(1));
}

/// Scenario: the install's own allowance is spent part way through the pass
/// a widened range started, with hundreds of tracks still owed.
///
/// Expected behaviour: the run ends held by the budget, naming when it lifts,
/// which is what lets the engine start the pass again by itself then.
#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn a_run_the_allowance_holds_back_ends_held_until_the_window_frees() {
    let _serial = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("fetch_budget_held_end.db");
    let server = FakeServer::answering(|_| ("200 OK", "", TIMED_TRACK));
    let one = Allowance {
        per_fifteen_minutes: Some(1),
        per_day: None,
    };
    let governor = budgeted(Budget::with_allowances(one, SYNC_ALLOWANCE, 0));
    let (tx, rx) = std::sync::mpsc::channel();
    let started = chrono::Utc::now();

    let result = settle(start_fetch_and_store_ending_with_fetcher(
        ids(3),
        server.fetcher_on(Arc::clone(&governor)),
        move |end| tx.send(end).expect("send"),
    ));
    let end = rx
        .recv_timeout(Duration::from_secs(5))
        .expect("the run ended");

    assert_eq!(result.owed_ids.len(), 2);
    let crate::objects::gps_pass::PassEnd::HeldUntil(until) = end else {
        panic!("the run ended {end:?}, not held by the budget");
    };
    assert!(until > started, "the hold lifts after the run: {until}");
}

/// Scenario: a second bulk run asks for a track whose earlier failures still
/// hold it inside the attempt store's backoff.
///
/// Expected behaviour: nothing is sent for it and it is owed, not reported
/// missing, because this run never asked for it.
#[test]
fn a_track_inside_its_backoff_is_owed_and_not_failed() {
    let _serial = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("fetch_backoff_owed.db");
    let server = FakeServer::answering(|_| ("500 Internal Server Error", "", ""));
    let governor = budgeted(Budget::new(0));
    let first = bulk_run(&server, ids(1), &governor);
    assert_eq!(first.failed_ids, ids(1));
    let before = server.requests();

    let second = bulk_run(&server, ids(1), &governor);

    assert_eq!(second.failed_ids, Vec::<String>::new());
    assert_eq!(second.owed_ids, ids(1));
    assert_eq!(server.requests(), before);
}

/// Scenario: the connection drops while a run is downloading.
///
/// Expected behaviour: the tracks it had left are owed, the run ends as a
/// lost network, and no backoff grows against them.
#[test]
fn a_dropped_connection_leaves_the_tracks_owed_and_not_failed() {
    let _serial = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("fetch_dropped_owed.db");
    let server = FakeServer::answering(|_| (HANG_UP, "", ""));
    let governor = budgeted(Budget::new(0));
    let (tx, rx) = std::sync::mpsc::channel();

    let result = settle(start_fetch_and_store_ending_with_fetcher(
        ids(3),
        server.fetcher_on(Arc::clone(&governor)),
        move |end| tx.send(end).expect("send"),
    ));
    let end = rx
        .recv_timeout(Duration::from_secs(5))
        .expect("the run ended");

    assert_eq!(result.failed_ids, Vec::<String>::new());
    let mut owed = result.owed_ids.clone();
    owed.sort();
    assert_eq!(owed, ids(3));
    assert!(matches!(
        end,
        crate::objects::gps_pass::PassEnd::NetworkLost
    ));
    for id in ids(3) {
        assert_eq!(attempts_for(&id), None, "{id} grew a backoff");
    }
}

const SERVER_RECORDS: u32 = 30;

fn laps_to(end: u32) -> String {
    format!(
        "{{\"icu_intervals\":[{{\"id\":1,\"type\":\"WORK\",\"start_index\":0,\"end_index\":{end}}}]}}"
    )
}

/// Rides synced from the server, each with a body, an interval body whose last
/// interval ends at the server's record count, and the census saying a track
/// exists upstream, and nothing stored for the track. Ride `n` starts ten
/// minutes after ride `n - 1`.
fn synced_rides(count: i64) -> Vec<String> {
    let first = crate::fit_synthetic::outdoor_ride().start_unix + 7_200;
    let local = |n: i64| first + n * 600;
    let census: Vec<_> = (0..count)
        .map(|n| crate::net::types::ActivityCensusEntry {
            id: format!("i{n}"),
            start_date_local: Some(
                chrono::DateTime::from_timestamp(local(n), 0)
                    .unwrap()
                    .format("%Y-%m-%dT%H:%M:%S")
                    .to_string(),
            ),
            created: Some("2026-03-14T08:00:00Z".to_string()),
            icu_sync_date: Some("2026-03-14T08:10:00Z".to_string()),
            has_latlng: true,
            has_series: true,
        })
        .collect();
    crate::with_persistent_engine(|e| {
        e.record_activity_census("i1", &census).unwrap();
        for n in 0..count {
            let id = format!("i{n}");
            e.store_synced_activity_bodies(
                "i1",
                &[(
                    id.clone(),
                    local(n),
                    format!("{{\"id\":\"{id}\",\"type\":\"Ride\"}}"),
                )],
                &[id.clone()],
                vec![crate::ActivityMetrics {
                    activity_id: id.clone(),
                    date: local(n),
                    sport_type: "Ride".to_string(),
                    ..Default::default()
                }],
            )
            .unwrap();
            e.set_interval_body(&id, &laps_to(SERVER_RECORDS)).unwrap();
        }
        census.into_iter().map(|entry| entry.id).collect()
    })
    .expect("engine")
}

/// A file of ride `n` with `records` samples.
fn file_of_ride(n: i64, records: u32) -> Vec<u8> {
    let mut ride = crate::fit_synthetic::outdoor_ride();
    ride.start_unix += n * 600;
    while ride.samples.len() < records as usize {
        let mut next = ride.samples.last().unwrap().clone();
        next.at += 1;
        ride.samples.push(next);
    }
    ride.to_fit()
}

fn import_files(files: &[Vec<u8>]) {
    let dir = tempfile::TempDir::new().unwrap();
    for (n, bytes) in files.iter().enumerate() {
        std::fs::write(dir.path().join(format!("ride-{n:02}.fit")), bytes).unwrap();
    }
    let progress = crate::net::import::import_with(
        crate::persistence::engine_install(),
        dir.path(),
        &AtomicBool::new(false),
        |_| {},
    )
    .expect("the walk finished");
    assert_eq!(progress.already_stored, files.len() as u32, "{progress:#?}");
}

/// Run the track pass over the rides the library owes a track, as the front
/// end does after a sync, and answer how many requests reached the server.
fn owed_candidates() -> Vec<crate::ffi::ActivitySportMapping> {
    crate::with_persistent_engine(|e| e.gps_fetch_candidates("i1", "2026-01-01", "2026-12-31"))
        .expect("engine")
}

fn owed_now() -> Vec<String> {
    let mut ids: Vec<String> = owed_candidates()
        .into_iter()
        .map(|c| c.activity_id)
        .collect();
    ids.sort();
    ids
}

fn track_run_requests(server: &FakeServer) -> (Vec<String>, u32) {
    let ids = owed_now();
    settle(start_fetch_and_store_with_fetcher(
        ids.clone(),
        Vec::new(),
        DownloadPriority::Bulk,
        server.fetcher_on(budgeted(Budget::new(0))),
    ));
    (ids, server.requests())
}

/// Scenario: a first sync of twenty rides, each with an imported file of the
/// same ride whose record count is the server's, then the track run.
///
/// Expected behaviour: the track run owes nothing, so no request reaches the
/// server.
#[test]
fn a_first_sync_of_rides_all_linked_to_matching_files_makes_no_track_request() {
    let _serial = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("fetch_files_matching.db");
    let server = FakeServer::answering(|_| ("200 OK", "", TIMED_TRACK));
    let mut rides = synced_rides(20);
    rides.sort();
    assert_eq!(
        owed_now(),
        rides,
        "every ride owes its track before the files"
    );
    let files: Vec<Vec<u8>> = (0..20).map(|n| file_of_ride(n, SERVER_RECORDS)).collect();
    import_files(&files);

    let (owed, requests) = track_run_requests(&server);

    assert_eq!(owed, Vec::<String>::new());
    assert_eq!(requests, 0);
}

/// Scenario: the same twenty rides, but the file of one holds a record more
/// than the server's count.
///
/// Expected behaviour: that file is not used, its row carries the mismatch,
/// and the track run makes one request, for that ride.
#[test]
fn a_file_with_one_record_more_than_the_server_is_not_used_and_costs_one_request() {
    let _serial = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("fetch_files_extra_record.db");
    let server = FakeServer::answering(|_| ("200 OK", "", TIMED_TRACK));
    synced_rides(20);
    let files: Vec<Vec<u8>> = (0..20)
        .map(|n| file_of_ride(n, SERVER_RECORDS + u32::from(n == 7)))
        .collect();
    import_files(&files);

    let (owed, requests) = track_run_requests(&server);

    assert_eq!(owed, vec!["i7".to_string()]);
    assert_eq!(requests, 1);
    let recorded = crate::with_persistent_engine(|e| e.file_track_check("i7")).expect("engine");
    assert_eq!(
        recorded,
        Some(crate::persistence::FileTrackCheck {
            file_records: 31,
            server_records: Some(30),
            supplied: false,
        })
    );
}
