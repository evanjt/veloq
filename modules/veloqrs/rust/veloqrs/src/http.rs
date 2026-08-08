//! Bulk GPS-track and FIT downloads for intervals.icu.
//!
//! Everything here goes through the shared `Transport`, so there is one client
//! in the process: one connection pool, one governor choke point, one retry
//! and `Retry-After` policy, and one place that classifies a 401. This module
//! keeps only what `Transport` does not do - fanning a batch out across
//! `MAX_CONCURRENCY` tasks and reporting progress to the FFI poll.
//!
//! Tracks come from `streams.json` rather than the map endpoint, because the
//! map endpoint carries coordinates alone. `parse_streams` reduces every series
//! to one validity mask taken from `latlng`, so `latlngs[i]` and `elevations[i]`
//! describe the same sample and stored section indices keep addressing the same
//! ground.

use crate::governor::Lane;
use crate::net::transport::{NetError, Transport};
use crate::net::types::{StreamDto, parse_streams};
use log::{debug, info};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::Instant;

/// Helper to calculate elapsed milliseconds from an Instant
#[inline]
fn elapsed_ms(start: Instant) -> u64 {
    start.elapsed().as_millis() as u64
}

/// Global progress state for FFI polling.
/// Uses atomics to allow safe concurrent access from fetch tasks and FFI polls.
pub struct DownloadProgress {
    completed: AtomicU32,
    total: AtomicU32,
    active: AtomicBool,
}

impl DownloadProgress {
    const fn new() -> Self {
        Self {
            completed: AtomicU32::new(0),
            total: AtomicU32::new(0),
            active: AtomicBool::new(false),
        }
    }
}

/// Global progress instance - single writer (fetch loop), multiple readers (FFI polls)
static DOWNLOAD_PROGRESS: DownloadProgress = DownloadProgress::new();

/// Reset progress counters at start of fetch operation
pub fn reset_download_progress(total: u32) {
    DOWNLOAD_PROGRESS.total.store(total, Ordering::Relaxed);
    DOWNLOAD_PROGRESS.completed.store(0, Ordering::Relaxed);
    DOWNLOAD_PROGRESS.active.store(true, Ordering::Relaxed);
}

/// Increment completed counter after each activity fetches
pub fn increment_download_progress() {
    DOWNLOAD_PROGRESS.completed.fetch_add(1, Ordering::Relaxed);
}

/// Mark download as complete
pub fn finish_download_progress() {
    DOWNLOAD_PROGRESS.active.store(false, Ordering::Relaxed);
}

/// Get current progress state (called by FFI)
pub fn get_download_progress() -> (u32, u32, bool) {
    (
        DOWNLOAD_PROGRESS.completed.load(Ordering::Relaxed),
        DOWNLOAD_PROGRESS.total.load(Ordering::Relaxed),
        DOWNLOAD_PROGRESS.active.load(Ordering::Relaxed),
    )
}

// Dispatch pace is the governor's job now (≤8 req/s across the whole process),
// so this module no longer carries its own burst/sustained intervals.
// Retry and dispatch pace are the transport's job now, so this module only
// decides how many activities may be in flight at once.
const MAX_CONCURRENCY: usize = 50; // Network latency ~200-400ms per activity

/// One activity's track as fetched: coordinates, the elevation that belongs to
/// each of them, and the bytes the body cost.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityMapResult {
    pub activity_id: String,
    pub bounds: Option<MapBounds>,
    pub latlngs: Option<Vec<[f64; 2]>>,
    /// Same length and same index space as `latlngs`, or `None` when the
    /// response carried no usable altitude. A sample with no altitude, or a
    /// non-finite one, is `None` at its own index rather than a fabricated
    /// number.
    pub elevations: Option<Vec<Option<f64>>>,
    /// Response body size after transfer decoding, for the throughput log.
    pub body_bytes: u32,
    pub success: bool,
    pub error: Option<String>,
}

/// Map bounds for an activity
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapBounds {
    pub ne: [f64; 2], // [lat, lng]
    pub sw: [f64; 2], // [lat, lng]
}

/// Corner-to-corner extent of a coordinate list. `None` for an empty list.
use crate::net::types::is_storable;

fn bounds_of(latlngs: &[[f64; 2]]) -> Option<MapBounds> {
    let mut kept = latlngs.iter().filter(|p| is_storable(p[0], p[1]));
    let first = kept.next()?;
    let (mut min_lat, mut max_lat) = (first[0], first[0]);
    let (mut min_lng, mut max_lng) = (first[1], first[1]);
    for p in kept {
        min_lat = min_lat.min(p[0]);
        max_lat = max_lat.max(p[0]);
        min_lng = min_lng.min(p[1]);
        max_lng = max_lng.max(p[1]);
    }
    Some(MapBounds {
        ne: [max_lat, max_lng],
        sw: [min_lat, min_lng],
    })
}

/// Progress callback type
pub type ProgressCallback = Arc<dyn Fn(u32, u32) + Send + Sync>;

/// Running dispatch number, for the progress log only. Pacing, retry and
/// `Retry-After` all belong to the transport now.
struct DispatchCounter {
    dispatched_count: AtomicU32,
}

impl DispatchCounter {
    fn new() -> Self {
        Self {
            dispatched_count: AtomicU32::new(0),
        }
    }

    /// Next 1-based dispatch number.
    fn next_dispatch_number(&self) -> u32 {
        self.dispatched_count.fetch_add(1, Ordering::Relaxed) + 1
    }
}

/// Batch fetcher for activity maps and FIT files.
pub struct ActivityFetcher {
    transport: Transport,
}

impl ActivityFetcher {
    /// Build a fetcher from the credential the sync service holds. Errors when
    /// no credential is set, rather than issuing an unauthenticated request.
    pub fn from_credentials() -> Result<Self, String> {
        let transport = crate::objects::current_transport()
            .ok_or_else(|| "no credentials set".to_string())??;
        Ok(Self { transport })
    }

    /// Build a fetcher over a caller-supplied transport, so tests can point it
    /// at a mock server.
    pub fn with_transport(transport: Transport) -> Self {
        Self { transport }
    }

    /// The shared transport, so callers can issue their own paced requests
    /// against the same client rather than building a second one.
    pub fn transport(&self) -> &Transport {
        &self.transport
    }

    /// Download the raw FIT file for an activity.
    /// Returns the binary data or an error message.
    pub async fn download_fit_file(&self, activity_id: &str) -> Result<Vec<u8>, String> {
        self.transport
            .get_bytes(
                &format!("/activity/{}/file", activity_id),
                &[],
                Lane::Interactive,
            )
            .await
            .map_err(|e| e.to_string())
    }

    /// Fetch map data for multiple activities in parallel
    pub async fn fetch_activity_maps(
        &self,
        activity_ids: Vec<String>,
        on_progress: Option<ProgressCallback>,
    ) -> Vec<ActivityMapResult> {
        use futures::stream::{self, StreamExt};

        let total = activity_ids.len() as u32;
        // NOTE: Caller is responsible for calling reset_download_progress() before this
        // and finish_download_progress() after this completes.
        let completed = Arc::new(AtomicU32::new(0));
        let total_bytes = Arc::new(AtomicU32::new(0));

        info!(
            "[RUST: PERF] HTTP Fetch: {} activities, max {} concurrent (governor-paced)",
            total, MAX_CONCURRENCY
        );

        let start = Instant::now();

        // Per-fetch counters only; the governor owns dispatch pacing.
        let counter = Arc::new(DispatchCounter::new());

        // Buffered parallel fetch; the governor paces dispatch across all tasks.
        let results: Vec<ActivityMapResult> = stream::iter(activity_ids)
            .map(|id| {
                let transport = &self.transport;
                let counter = Arc::clone(&counter);
                let completed = Arc::clone(&completed);
                let total_bytes = Arc::clone(&total_bytes);
                let callback = on_progress.clone();
                let start_time = start;

                async move {
                    // Transport paces every dispatch through the shared choke
                    // point, so this only numbers them for the log.
                    let dispatch_num = counter.next_dispatch_number();
                    let dispatch_time = start_time.elapsed();

                    let result = Self::fetch_single_track(transport, &id).await;

                    // Track progress
                    let done = completed.fetch_add(1, Ordering::Relaxed) + 1;
                    // Update global progress for FFI polling
                    increment_download_progress();
                    let bytes = result.body_bytes;
                    total_bytes.fetch_add(bytes, Ordering::Relaxed);
                    let complete_time = start_time.elapsed();

                    // Calculate effective dispatch rate
                    let dispatch_rate = if dispatch_time.as_secs_f64() > 0.0 {
                        dispatch_num as f64 / dispatch_time.as_secs_f64()
                    } else {
                        0.0
                    };

                    // Log progress at key milestones (every 10 activities or first/last)
                    if done == 1 || done == total || done.is_multiple_of(10) {
                        info!(
                            "[RUST: fetch_activity_maps] Progress {}/{} | dispatched@{:.2}s (#{} @ {:.1}/s) | done@{:.2}s | {}KB",
                            done,
                            total,
                            dispatch_time.as_secs_f64(),
                            dispatch_num,
                            dispatch_rate,
                            complete_time.as_secs_f64(),
                            bytes / 1024
                        );
                    }

                    if let Some(ref cb) = callback {
                        cb(done, total);
                    }

                    result
                }
            })
            .buffer_unordered(MAX_CONCURRENCY)
            .collect()
            .await;

        let elapsed = start.elapsed();
        let success_count = results.iter().filter(|r| r.success).count();
        let error_count = results.iter().filter(|r| !r.success).count();
        let rate = total as f64 / elapsed.as_secs_f64();
        let total_kb = total_bytes.load(Ordering::Relaxed) / 1024;

        info!(
            "[RUST: fetch_activity_maps] Complete: {}/{} success ({} errors) in {:.2}s ({:.1} req/s, {}KB) ({} ms)",
            success_count,
            total,
            error_count,
            elapsed.as_secs_f64(),
            rate,
            total_kb,
            elapsed_ms(start)
        );

        info!(
            "[RUST: PERF] Throughput: {:.1} req/s, {:.1} KB/s",
            rate,
            total_kb as f64 / elapsed.as_secs_f64()
        );

        // NOTE: Caller is responsible for calling finish_download_progress()

        results
    }

    /// One activity's track. Transport owns pacing, retry, `Retry-After` and
    /// 401 classification, so this is request, decode, reduce to one index
    /// space.
    async fn fetch_single_track(transport: &Transport, activity_id: &str) -> ActivityMapResult {
        let req_start = Instant::now();

        let failed = |error: String| ActivityMapResult {
            activity_id: activity_id.to_string(),
            bounds: None,
            latlngs: None,
            elevations: None,
            body_bytes: 0,
            success: false,
            error: Some(error),
        };

        let bytes = match transport
            .get_bytes(
                &format!("/activity/{}/streams.json", activity_id),
                &[("types", crate::net::endpoints::TRACK_STREAM_TYPES)],
                Lane::Interactive,
            )
            .await
        {
            Ok(b) => b,
            // Unauthorized is worth naming: it means the whole batch will fail
            // the same way, and the sync service turns it into a re-login.
            Err(NetError::Unauthorized) => return failed("unauthorized".to_string()),
            Err(e) => return failed(e.to_string()),
        };
        let body_elapsed = req_start.elapsed();
        let body_size = bytes.len();

        let json_start = Instant::now();
        let raw: Vec<StreamDto> = match serde_json::from_slice(&bytes) {
            Ok(d) => d,
            Err(e) => return failed(format!("JSON parse error: {}", e)),
        };
        let parsed = parse_streams(raw);
        let json_elapsed = json_start.elapsed();

        // A latlng series that disagrees with itself has no trustworthy index
        // space, and every stored section index addresses that space.
        if parsed.misaligned.iter().any(|m| m.series == "latlng") {
            return failed("latlng misaligned".to_string());
        }

        let point_count = parsed.latlng.len();
        // Altitude rides the latlng mask, so a length that still disagrees
        // means the series was never in this index space. Drop the elevation
        // and keep the track rather than losing the activity.
        let altitude_aligned = parsed.altitude.len() == point_count
            && !parsed
                .misaligned
                .iter()
                .any(|m| m.series == "altitude" || m.series == "fixed_altitude");
        let elevations = if altitude_aligned && point_count > 0 {
            Some(
                parsed
                    .altitude
                    .iter()
                    .map(|e| e.is_finite().then_some(*e))
                    .collect(),
            )
        } else {
            None
        };

        debug!(
            "[Fetch {}] body={:?}({:.1}KB) json={:?} total={:?} points={} elevation={}",
            activity_id,
            body_elapsed,
            body_size as f64 / 1024.0,
            json_elapsed,
            req_start.elapsed(),
            point_count,
            elevations.is_some()
        );

        ActivityMapResult {
            activity_id: activity_id.to_string(),
            bounds: bounds_of(&parsed.latlng),
            latlngs: Some(parsed.latlng),
            elevations,
            body_bytes: body_size as u32,
            success: true,
            error: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::governor::{AuthMethod, Governor, NoopPolicy};
    use httpmock::prelude::*;
    use serde_json::json;

    /// A fetcher pointed at a mock server rather than the live base URL.
    fn fetcher_to(base: String) -> ActivityFetcher {
        let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
        ActivityFetcher::with_transport(
            Transport::with_governor(base, AuthMethod::ApiKey("k"), gov).unwrap(),
        )
    }

    /// A `streams.json` body: latlng split across data/data2, one series per
    /// requested type. `lat`/`lng`/`alt` entries may be JSON null.
    fn streams_body(
        lat: serde_json::Value,
        lng: serde_json::Value,
        series: Vec<serde_json::Value>,
    ) -> serde_json::Value {
        let mut out = vec![json!({"type": "latlng", "data": lat, "data2": lng})];
        out.extend(series);
        json!(out)
    }

    fn fetch_one(server: &MockServer, id: &str) -> ActivityMapResult {
        let f = fetcher_to(server.base_url());
        crate::runtime::block_on(f.fetch_activity_maps(vec![id.to_string()], None))
            .pop()
            .unwrap()
    }

    #[test]
    fn track_fetch_reduces_coordinates_and_derives_bounds() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/activity/a1/streams.json")
                .query_param("types", "latlng,fixed_altitude,altitude");
            then.status(200).json_body(streams_body(
                json!([46.941, null, 46.942]),
                json!([7.441, null, 7.442]),
                vec![],
            ));
        });

        let r = fetch_one(&server, "a1");

        mock.assert();
        assert!(r.success);
        // The null hole is dropped, not carried through as a gap.
        assert_eq!(
            r.latlngs.as_ref().unwrap(),
            &vec![[46.941, 7.441], [46.942, 7.442]]
        );
        let bounds = r.bounds.as_ref().unwrap();
        assert_eq!(bounds.ne, [46.942, 7.442]);
        assert_eq!(bounds.sw, [46.941, 7.441]);
        assert!(r.body_bytes > 0);
    }

    #[test]
    fn elevation_follows_the_original_index_of_each_surviving_coordinate() {
        // Nulls at 1 and 3 of a five-sample track. Altitude is full length and
        // distinct per index, so a compaction that shifted it would show.
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/a1/streams.json");
            then.status(200).json_body(streams_body(
                json!([46.10, null, 46.12, null, 46.14]),
                json!([7.10, null, 7.12, null, 7.14]),
                vec![json!({"type": "altitude",
                            "data": [100.0, 200.0, 300.0, 400.0, 500.0]})],
            ));
        });

        let r = fetch_one(&server, "a1");

        assert_eq!(
            r.latlngs.as_ref().unwrap(),
            &vec![[46.10, 7.10], [46.12, 7.12], [46.14, 7.14]]
        );
        assert_eq!(
            r.elevations.as_ref().unwrap(),
            &vec![Some(100.0), Some(300.0), Some(500.0)]
        );
    }

    #[test]
    fn fixed_altitude_wins_over_altitude() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/a1/streams.json");
            then.status(200).json_body(streams_body(
                json!([46.10, 46.11]),
                json!([7.10, 7.11]),
                vec![
                    json!({"type": "altitude", "data": [100.0, 101.0]}),
                    json!({"type": "fixed_altitude", "data": [900.0, 901.0]}),
                ],
            ));
        });

        let r = fetch_one(&server, "a1");

        assert_eq!(
            r.elevations.as_ref().unwrap(),
            &vec![Some(900.0), Some(901.0)]
        );
    }

    #[test]
    fn a_track_with_no_altitude_series_still_fetches() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/a1/streams.json");
            then.status(200).json_body(streams_body(
                json!([46.10, 46.11]),
                json!([7.10, 7.11]),
                vec![],
            ));
        });

        let r = fetch_one(&server, "a1");

        assert!(r.success);
        assert_eq!(r.latlngs.as_ref().unwrap().len(), 2);
        assert!(r.elevations.is_none());
    }

    #[test]
    fn a_gap_in_the_altitude_series_is_none_at_that_point_alone() {
        // A null altitude sample parses to NaN, which would poison every
        // comparison the detector makes on it.
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/a1/streams.json");
            then.status(200).json_body(streams_body(
                json!([46.10, 46.11, 46.12]),
                json!([7.10, 7.11, 7.12]),
                vec![json!({"type": "altitude", "data": [100.0, null, 102.0]})],
            ));
        });

        let r = fetch_one(&server, "a1");

        assert_eq!(
            r.elevations.as_ref().unwrap(),
            &vec![Some(100.0), None, Some(102.0)]
        );
    }

    #[test]
    fn altitude_does_not_change_the_point_count() {
        let lat = json!([46.10, null, 46.12, 46.13, null]);
        let lng = json!([7.10, null, 7.12, 7.13, null]);

        let bare = MockServer::start();
        bare.mock(|when, then| {
            when.method(GET).path("/activity/a1/streams.json");
            then.status(200)
                .json_body(streams_body(lat.clone(), lng.clone(), vec![]));
        });
        let with_alt = MockServer::start();
        with_alt.mock(|when, then| {
            when.method(GET).path("/activity/a1/streams.json");
            then.status(200).json_body(streams_body(
                lat,
                lng,
                vec![json!({"type": "fixed_altitude", "data": [1.0, 2.0, 3.0, 4.0, 5.0]})],
            ));
        });

        let a = fetch_one(&bare, "a1");
        let b = fetch_one(&with_alt, "a1");

        assert_eq!(a.latlngs.as_ref().unwrap().len(), 3);
        assert_eq!(a.latlngs, b.latlngs);
        assert_eq!(
            b.elevations.as_ref().unwrap(),
            &vec![Some(1.0), Some(3.0), Some(4.0)]
        );
    }

    #[test]
    fn an_altitude_series_of_the_wrong_length_costs_the_elevation_not_the_track() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/a1/streams.json");
            then.status(200).json_body(streams_body(
                json!([46.10, 46.11, 46.12]),
                json!([7.10, 7.11, 7.12]),
                vec![json!({"type": "altitude", "data": [100.0]})],
            ));
        });

        let r = fetch_one(&server, "a1");

        assert!(r.success);
        assert_eq!(r.latlngs.as_ref().unwrap().len(), 3);
        assert!(r.elevations.is_none());
    }

    #[test]
    fn track_fetch_names_unauthorized_rather_than_a_bare_http_code() {
        // 401 classification is what the sync service turns into a re-login,
        // and this path could not see it before it went through Transport.
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/a1/streams.json");
            then.status(401);
        });

        let f = fetcher_to(server.base_url());
        let results = crate::runtime::block_on(f.fetch_activity_maps(vec!["a1".into()], None));

        assert!(!results[0].success);
        assert_eq!(results[0].error.as_deref(), Some("unauthorized"));
    }

    #[test]
    fn a_failing_activity_does_not_sink_the_batch() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/good/streams.json");
            then.status(200).json_body(streams_body(
                json!([46.9, 46.91]),
                json!([7.4, 7.41]),
                vec![],
            ));
        });
        server.mock(|when, then| {
            when.method(GET).path("/activity/gone/streams.json");
            then.status(404);
        });

        let f = fetcher_to(server.base_url());
        let results = crate::runtime::block_on(
            f.fetch_activity_maps(vec!["good".into(), "gone".into()], None),
        );

        let good = results.iter().find(|r| r.activity_id == "good").unwrap();
        let gone = results.iter().find(|r| r.activity_id == "gone").unwrap();
        assert!(good.success);
        assert!(!gone.success);
    }

    #[test]
    fn track_fetch_reports_progress_per_activity() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path_contains("/streams.json");
            then.status(200).json_body(json!([]));
        });

        let seen = Arc::new(AtomicU32::new(0));
        let counter = Arc::clone(&seen);
        let f = fetcher_to(server.base_url());
        crate::runtime::block_on(f.fetch_activity_maps(
            vec!["a".into(), "b".into(), "c".into()],
            Some(Arc::new(move |_done, _total| {
                counter.fetch_add(1, Ordering::Relaxed);
            })),
        ));

        assert_eq!(seen.load(Ordering::Relaxed), 3);
    }

    #[test]
    fn fit_download_returns_the_raw_bytes() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/a1/file");
            then.status(200).body(vec![0x0Eu8, 0x10, 0x00, 0x00]);
        });

        let f = fetcher_to(server.base_url());
        let bytes = crate::runtime::block_on(f.download_fit_file("a1")).unwrap();

        assert_eq!(bytes, vec![0x0E, 0x10, 0x00, 0x00]);
    }

    #[test]
    fn fit_download_surfaces_a_missing_file_as_an_error() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/a1/file");
            then.status(404);
        });

        let f = fetcher_to(server.base_url());
        assert!(crate::runtime::block_on(f.download_fit_file("a1")).is_err());
    }
}
