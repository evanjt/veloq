//! Scenario: a track download fails and the engine, not the caller, re-offers it.
//! Expected behaviour: the failed id is asked for again inside the one run, the
//! attempt store records each failure, and a landed track leaves no row.

use std::io::{Read, Write};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant};

use super::{start_fetch_and_store_with_fetcher, take_fetch_and_store_result};
use crate::governor::{AuthMethod, Governor, NoopPolicy};
use crate::http::{ActivityFetcher, DownloadPriority};
use crate::net::transport::Transport;
use crate::persistence::attempts::JobKey;

const TRACK: &str = r#"[{"type":"latlng","data":[46.0,46.1],"data2":[7.0,7.1]}]"#;

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
                let body = if request.contains("types=latlng") {
                    if seen.fetch_add(1, Ordering::Relaxed) < bad_replies {
                        "not json"
                    } else {
                        TRACK
                    }
                } else {
                    "[]"
                };
                let _ = write!(
                    socket,
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
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
        let governor = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
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
    let run = start_fetch_and_store_with_fetcher(
        vec![id.to_string()],
        vec![],
        priority,
        server.fetcher(),
    );
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
fn a_map_tap_is_not_held_back_by_a_backoff() {
    let _serial = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("fetch_retry_interactive.db");
    let server = FakeServer::start(u32::MAX);
    run_to_end(&server, "ride-3", DownloadPriority::Bulk);
    let before = server.requests();

    run_to_end(&server, "ride-3", DownloadPriority::Interactive);

    assert!(server.requests() > before, "the tap went out");
}
