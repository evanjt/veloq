//! Bulk GPS-map and FIT downloads for intervals.icu.
//!
//! Everything here goes through the shared `Transport`, so there is one client
//! in the process: one connection pool, one governor choke point, one retry
//! and `Retry-After` policy, and one place that classifies a 401. This module
//! keeps only what `Transport` does not do - fanning a batch out across
//! `MAX_CONCURRENCY` tasks and reporting progress to the FFI poll.

use crate::governor::Lane;
use crate::net::transport::{NetError, Transport};
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

/// Result of fetching activity map data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityMapResult {
    pub activity_id: String,
    pub bounds: Option<MapBounds>,
    pub latlngs: Option<Vec<[f64; 2]>>,
    pub success: bool,
    pub error: Option<String>,
}

/// Map bounds for an activity
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapBounds {
    pub ne: [f64; 2], // [lat, lng]
    pub sw: [f64; 2], // [lat, lng]
}

/// API response for activity map endpoint
#[derive(Debug, Deserialize)]
struct MapApiResponse {
    bounds: Option<ApiBounds>,
    latlngs: Option<Vec<Option<[f64; 2]>>>,
}

#[derive(Debug, Deserialize)]
struct ApiBounds {
    ne: [f64; 2],
    sw: [f64; 2],
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

                    let result = Self::fetch_single_map(transport, &id).await;

                    // Track progress
                    let done = completed.fetch_add(1, Ordering::Relaxed) + 1;
                    // Update global progress for FFI polling
                    increment_download_progress();
                    let bytes = result.latlngs.as_ref().map_or(0, |v| v.len() * 16) as u32;
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

    /// One activity's map. Transport owns pacing, retry, `Retry-After` and
    /// 401 classification, so this is request, decode, flatten.
    async fn fetch_single_map(transport: &Transport, activity_id: &str) -> ActivityMapResult {
        let req_start = Instant::now();

        let failed = |error: String| ActivityMapResult {
            activity_id: activity_id.to_string(),
            bounds: None,
            latlngs: None,
            success: false,
            error: Some(error),
        };

        let bytes = match transport
            .get_bytes(
                &format!("/activity/{}/map", activity_id),
                &[],
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
        let data: MapApiResponse = match serde_json::from_slice(&bytes) {
            Ok(d) => d,
            Err(e) => return failed(format!("JSON parse error: {}", e)),
        };
        let json_elapsed = json_start.elapsed();
        let point_count = data.latlngs.as_ref().map_or(0, |v| v.len());

        let bounds = data.bounds.map(|b| MapBounds { ne: b.ne, sw: b.sw });
        let latlngs = data
            .latlngs
            .map(|coords| coords.into_iter().flatten().collect());

        debug!(
            "[Fetch {}] body={:?}({:.1}KB) json={:?} total={:?} points={}",
            activity_id,
            body_elapsed,
            body_size as f64 / 1024.0,
            json_elapsed,
            req_start.elapsed(),
            point_count
        );

        ActivityMapResult {
            activity_id: activity_id.to_string(),
            bounds,
            latlngs,
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

    /// A fetcher pointed at a mock server. Folding this module onto Transport
    /// is what makes that possible: the URL used to be hardcoded.
    fn fetcher_to(base: String) -> ActivityFetcher {
        let gov = Arc::new(Governor::new(1000, Box::new(NoopPolicy)));
        ActivityFetcher::with_transport(
            Transport::with_governor(base, AuthMethod::ApiKey("k"), gov).unwrap(),
        )
    }

    #[test]
    fn test_activity_map_result_serialization() {
        let result = ActivityMapResult {
            activity_id: "test-123".to_string(),
            bounds: Some(MapBounds {
                ne: [51.5, -0.1],
                sw: [51.4, -0.2],
            }),
            latlngs: Some(vec![[51.45, -0.15], [51.46, -0.14]]),
            success: true,
            error: None,
        };

        let json = serde_json::to_string(&result).unwrap();
        let parsed: ActivityMapResult = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.activity_id, "test-123");
        assert!(parsed.success);
        assert!(parsed.bounds.is_some());
        assert_eq!(parsed.latlngs.as_ref().unwrap().len(), 2);
    }

    #[test]
    fn map_fetch_flattens_coordinates_and_bounds() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/activity/a1/map");
            then.status(200).json_body(json!({
                "bounds": {"ne": [46.95, 7.45], "sw": [46.94, 7.44]},
                "latlngs": [[46.941, 7.441], null, [46.942, 7.442]]
            }));
        });

        let f = fetcher_to(server.base_url());
        let results = crate::runtime::block_on(f.fetch_activity_maps(vec!["a1".into()], None));

        mock.assert();
        assert!(results[0].success);
        // The null hole is dropped, not carried through as a gap.
        assert_eq!(
            results[0].latlngs.as_ref().unwrap(),
            &vec![[46.941, 7.441], [46.942, 7.442]]
        );
        assert_eq!(results[0].bounds.as_ref().unwrap().ne, [46.95, 7.45]);
    }

    #[test]
    fn map_fetch_names_unauthorized_rather_than_a_bare_http_code() {
        // 401 classification is what the sync service turns into a re-login,
        // and this path could not see it before it went through Transport.
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path("/activity/a1/map");
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
            when.method(GET).path("/activity/good/map");
            then.status(200)
                .json_body(json!({"latlngs": [[46.9, 7.4], [46.91, 7.41]]}));
        });
        server.mock(|when, then| {
            when.method(GET).path("/activity/gone/map");
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
    fn map_fetch_reports_progress_per_activity() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(GET).path_contains("/map");
            then.status(200).json_body(json!({"latlngs": []}));
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
