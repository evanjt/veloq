//! HTTP client for intervals.icu API with rate limiting.
//!
//! This module provides high-performance activity fetching with:
//! - Connection pooling for HTTP/2 multiplexing
//! - Dispatch rate limiting (spaces out request starts)
//! - Parallel fetching with configurable concurrency
//! - Automatic retry with exponential backoff on 429

use base64::Engine;
use log::{debug, info, warn};
use once_cell::sync::Lazy;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

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

/// Storage for background fetch results
static BACKGROUND_FETCH_RESULTS: Lazy<StdMutex<Option<Vec<ActivityMapResult>>>> =
    Lazy::new(|| StdMutex::new(None));

/// Start a background fetch operation (returns immediately, doesn't block)
/// Call get_download_progress() to monitor progress
/// Call take_background_fetch_results() when active becomes false to get results
pub fn start_background_fetch(auth_header: String, activity_ids: Vec<String>) {
    let fn_start = Instant::now();
    let activity_count = activity_ids.len();

    // Clear any previous results
    if let Ok(mut results) = BACKGROUND_FETCH_RESULTS.lock() {
        *results = None;
    }

    // Reset progress counters
    reset_download_progress(activity_ids.len() as u32);

    info!(
        "[RUST: start_background_fetch] Spawning thread for {} activities",
        activity_count
    );

    // Spawn background thread to do the actual work
    std::thread::spawn(move || {
        let thread_start = Instant::now();
        info!(
            "[RUST: start_background_fetch] Thread started for {} activities",
            activity_ids.len()
        );

        // Create runtime in this thread
        let runtime_start = Instant::now();
        let rt = match tokio::runtime::Builder::new_multi_thread()
            .worker_threads(8)
            .enable_all()
            .build()
        {
            Ok(rt) => {
                info!(
                    "[RUST: start_background_fetch] Created tokio runtime ({} ms)",
                    elapsed_ms(runtime_start)
                );
                rt
            }
            Err(e) => {
                warn!(
                    "[RUST: start_background_fetch] Failed to create runtime: {} ({} ms)",
                    e,
                    elapsed_ms(runtime_start)
                );
                finish_download_progress();
                if let Ok(mut results) = BACKGROUND_FETCH_RESULTS.lock() {
                    *results = Some(
                        activity_ids
                            .into_iter()
                            .map(|id| ActivityMapResult {
                                activity_id: id,
                                bounds: None,
                                latlngs: None,
                                success: false,
                                error: Some(format!("Runtime error: {}", e)),
                            })
                            .collect(),
                    );
                }
                return;
            }
        };

        // Create HTTP client
        let client_start = Instant::now();
        let fetcher = match ActivityFetcher::with_auth_header(auth_header) {
            Ok(f) => {
                info!(
                    "[RUST: start_background_fetch] Created HTTP client ({} ms)",
                    elapsed_ms(client_start)
                );
                f
            }
            Err(e) => {
                warn!(
                    "[RUST: start_background_fetch] Failed to create HTTP client: {} ({} ms)",
                    e,
                    elapsed_ms(client_start)
                );
                finish_download_progress();
                if let Ok(mut results) = BACKGROUND_FETCH_RESULTS.lock() {
                    *results = Some(
                        activity_ids
                            .into_iter()
                            .map(|id| ActivityMapResult {
                                activity_id: id,
                                bounds: None,
                                latlngs: None,
                                success: false,
                                error: Some(e.clone()),
                            })
                            .collect(),
                    );
                }
                return;
            }
        };

        // Run the fetch
        let fetch_start = Instant::now();
        let fetch_results = rt.block_on(fetcher.fetch_activity_maps(activity_ids, None));
        let success_count = fetch_results.iter().filter(|r| r.success).count();
        info!(
            "[RUST: start_background_fetch] Fetch complete: {}/{} successful ({} ms)",
            success_count,
            fetch_results.len(),
            elapsed_ms(fetch_start)
        );

        // Store results
        if let Ok(mut results) = BACKGROUND_FETCH_RESULTS.lock() {
            *results = Some(fetch_results);
        }

        // Mark as complete (active = false)
        finish_download_progress();

        info!(
            "[RUST: start_background_fetch] Thread complete ({} ms)",
            elapsed_ms(thread_start)
        );
    });

    info!(
        "[RUST: start_background_fetch] Thread spawned, returning to caller ({} ms)",
        elapsed_ms(fn_start)
    );
}

/// Take the results from a completed background fetch
/// Returns None if fetch is still in progress or no fetch was started
/// Returns Some(results) and clears the storage
pub fn take_background_fetch_results() -> Option<Vec<ActivityMapResult>> {
    if let Ok(mut results) = BACKGROUND_FETCH_RESULTS.lock() {
        results.take()
    } else {
        None
    }
}

// Rate limits from intervals.icu API: 30/s burst, 132/10s sustained (13.2/s average)
// In practice, 30/s burst triggers 429s - the API uses a sliding window.
// Safe rates discovered through testing:
// - 20 req/s (50ms) works reliably for small batches
// - 13 req/s (77ms) for sustained large fetches
const BURST_INTERVAL_MS: u64 = 50; // 1000ms / 20 = 50ms (20 req/s - safe burst)
const SUSTAINED_INTERVAL_MS: u64 = 77; // 1000ms / 13 = 77ms (13 req/s sustained rate)
const BURST_THRESHOLD: usize = 100; // Use burst for batches under 100
const MAX_CONCURRENCY: usize = 50; // Allow many in-flight (network latency ~200-400ms)
const MAX_RETRIES: u32 = 3;

/// Calculate optimal dispatch interval based on request count
fn calculate_dispatch_interval(total_requests: usize) -> u64 {
    if total_requests <= BURST_THRESHOLD {
        BURST_INTERVAL_MS
    } else {
        SUSTAINED_INTERVAL_MS
    }
}

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

/// Dispatch rate limiter - spaces out when requests START
/// This is different from counting requests - it ensures we never dispatch
/// faster than the configured rate by spacing them apart.
struct DispatchRateLimiter {
    next_dispatch: Mutex<Instant>,
    dispatched_count: AtomicU32,
    consecutive_429s: AtomicU32,
    interval_ms: u64,
}

impl DispatchRateLimiter {
    fn new(interval_ms: u64) -> Self {
        Self {
            next_dispatch: Mutex::new(Instant::now()),
            dispatched_count: AtomicU32::new(0),
            consecutive_429s: AtomicU32::new(0),
            interval_ms,
        }
    }

    /// Wait for our dispatch slot. Each caller gets a unique slot
    /// spaced interval_ms apart.
    async fn wait_for_dispatch_slot(&self) -> u32 {
        let (wait_duration, dispatch_num) = {
            let mut next = self.next_dispatch.lock().await;
            let now = Instant::now();

            // Calculate when this request can dispatch
            let dispatch_at = if *next > now { *next } else { now };

            // Reserve the next slot for the next caller
            *next = dispatch_at + Duration::from_millis(self.interval_ms);

            let num = self.dispatched_count.fetch_add(1, Ordering::Relaxed) + 1;

            // Calculate how long we need to wait
            let wait = if dispatch_at > now {
                dispatch_at - now
            } else {
                Duration::ZERO
            };

            (wait, num)
        };

        // Wait outside the lock
        if wait_duration > Duration::from_millis(5) {
            debug!(
                "[Dispatch #{}] Waiting {:?} for slot",
                dispatch_num, wait_duration
            );
            tokio::time::sleep(wait_duration).await;
        }

        dispatch_num
    }

    fn record_success(&self) {
        self.consecutive_429s.store(0, Ordering::Relaxed);
    }

    fn record_429(&self) -> Duration {
        let count = self.consecutive_429s.fetch_add(1, Ordering::Relaxed) + 1;
        // Exponential backoff: 500ms, 1s, 2s, 4s max
        let backoff = Duration::from_millis(500 * (1 << count.min(3)));
        warn!(
            "[DispatchRateLimiter] Got 429! Consecutive: {}, backing off {:?}",
            count, backoff
        );
        backoff
    }
}

/// High-performance activity fetcher
pub struct ActivityFetcher {
    client: Client,
    auth_header: String,
}

impl ActivityFetcher {
    /// Create a new activity fetcher with the given API key (Basic auth)
    pub fn new(api_key: &str) -> Result<Self, String> {
        let auth = base64::engine::general_purpose::STANDARD.encode(format!("API_KEY:{}", api_key));
        Self::with_auth_header(format!("Basic {}", auth))
    }

    /// Create a new activity fetcher with a pre-formatted auth header
    /// Supports both "Basic ..." and "Bearer ..." formats
    pub fn with_auth_header(auth_header: String) -> Result<Self, String> {
        let client = Client::builder()
            .pool_max_idle_per_host(MAX_CONCURRENCY * 2)
            .pool_idle_timeout(Duration::from_secs(60))
            .tcp_keepalive(Duration::from_secs(30))
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

        Ok(Self {
            client,
            auth_header,
        })
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

        // Dynamic rate limiting: use burst rate for small batches, sustained for large
        let dispatch_interval = calculate_dispatch_interval(activity_ids.len());
        let rate_mode = if activity_ids.len() <= BURST_THRESHOLD {
            "BURST"
        } else {
            "SUSTAINED"
        };
        let req_per_sec = 1000.0 / dispatch_interval as f64;

        // PERF ASSESSMENT: Using PARALLEL async fetch with rate limiting
        info!(
            "[RUST: PERF] HTTP Fetch: {} activities, {} mode ({:.0} req/s), max {} concurrent",
            total, rate_mode, req_per_sec, MAX_CONCURRENCY
        );
        let theoretical_dispatch_time = (total as u64 - 1) * dispatch_interval;
        info!(
            "[RUST: PERF] Theoretical minimum time: dispatch={}ms + network latency",
            theoretical_dispatch_time
        );

        let start = Instant::now();

        // Create rate limiter with the calculated interval
        let rate_limiter = Arc::new(DispatchRateLimiter::new(dispatch_interval));

        // Use buffered stream for parallel execution with dispatch rate limiting
        let results: Vec<ActivityMapResult> = stream::iter(activity_ids)
            .map(|id| {
                let client = &self.client;
                let auth = &self.auth_header;
                let rate_limiter = Arc::clone(&rate_limiter);
                let completed = Arc::clone(&completed);
                let total_bytes = Arc::clone(&total_bytes);
                let callback = on_progress.clone();
                let start_time = start;

                async move {
                    // Wait for our dispatch slot - this spaces out request starts
                    let dispatch_num = rate_limiter.wait_for_dispatch_slot().await;
                    let dispatch_time = start_time.elapsed();

                    let result = Self::fetch_single_map(client, auth, &rate_limiter, &id).await;

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

        // PERF ASSESSMENT: Efficiency analysis
        let actual_ms = elapsed_ms(start);
        let overhead_ms = actual_ms.saturating_sub(theoretical_dispatch_time);
        let efficiency = (theoretical_dispatch_time as f64 / actual_ms as f64 * 100.0).min(100.0);
        info!(
            "[RUST: PERF] HTTP efficiency: theoretical={}ms, actual={}ms, overhead={}ms ({:.1}% efficient)",
            theoretical_dispatch_time, actual_ms, overhead_ms, efficiency
        );
        info!(
            "[RUST: PERF] Throughput: {:.1} req/s, {:.1} KB/s",
            rate,
            total_kb as f64 / elapsed.as_secs_f64()
        );

        // NOTE: Caller is responsible for calling finish_download_progress()

        results
    }

    async fn fetch_single_map(
        client: &Client,
        auth: &str,
        rate_limiter: &DispatchRateLimiter,
        activity_id: &str,
    ) -> ActivityMapResult {
        let url = format!("https://intervals.icu/api/v1/activity/{}/map", activity_id);

        let mut retries = 0;
        let req_start = Instant::now();

        loop {
            // Phase 1: Send request, receive headers
            let response = client.get(&url).header("Authorization", auth).send().await;

            let headers_elapsed = req_start.elapsed();

            match response {
                Ok(resp) => {
                    let status = resp.status();

                    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                        retries += 1;
                        if retries > MAX_RETRIES {
                            return ActivityMapResult {
                                activity_id: activity_id.to_string(),
                                bounds: None,
                                latlngs: None,
                                success: false,
                                error: Some("Max retries exceeded (429)".to_string()),
                            };
                        }

                        let wait = rate_limiter.record_429();
                        warn!(
                            "[Fetch {}] 429 Too Many Requests after {:?}, retry {} with {:?} backoff",
                            activity_id, headers_elapsed, retries, wait
                        );
                        tokio::time::sleep(wait).await;
                        continue;
                    }

                    rate_limiter.record_success();

                    if !status.is_success() {
                        return ActivityMapResult {
                            activity_id: activity_id.to_string(),
                            bounds: None,
                            latlngs: None,
                            success: false,
                            error: Some(format!("HTTP {}", status)),
                        };
                    }

                    // Phase 2: Download response body (this is network time!)
                    let body_start = Instant::now();
                    let bytes = match resp.bytes().await {
                        Ok(b) => b,
                        Err(e) => {
                            return ActivityMapResult {
                                activity_id: activity_id.to_string(),
                                bounds: None,
                                latlngs: None,
                                success: false,
                                error: Some(format!("Body download error: {}", e)),
                            };
                        }
                    };
                    let body_elapsed = body_start.elapsed();
                    let body_size = bytes.len();

                    // Phase 3: JSON deserialization (pure CPU)
                    let json_start = Instant::now();
                    let data: MapApiResponse = match serde_json::from_slice(&bytes) {
                        Ok(d) => d,
                        Err(e) => {
                            return ActivityMapResult {
                                activity_id: activity_id.to_string(),
                                bounds: None,
                                latlngs: None,
                                success: false,
                                error: Some(format!("JSON parse error: {}", e)),
                            };
                        }
                    };
                    let json_elapsed = json_start.elapsed();
                    let point_count = data.latlngs.as_ref().map_or(0, |v| v.len());

                    // Phase 4: Data transformation (flatten coords)
                    let transform_start = Instant::now();
                    let bounds = data.bounds.map(|b| MapBounds { ne: b.ne, sw: b.sw });
                    let latlngs = data
                        .latlngs
                        .map(|coords| coords.into_iter().flatten().collect());
                    let transform_elapsed = transform_start.elapsed();

                    let total_elapsed = req_start.elapsed();

                    // Detailed timing breakdown
                    debug!(
                        "[Fetch {}] headers={:?} body={:?}({:.1}KB) json={:?} transform={:?} total={:?} points={}",
                        activity_id,
                        headers_elapsed,
                        body_elapsed,
                        body_size as f64 / 1024.0,
                        json_elapsed,
                        transform_elapsed,
                        total_elapsed,
                        point_count
                    );

                    return ActivityMapResult {
                        activity_id: activity_id.to_string(),
                        bounds,
                        latlngs,
                        success: true,
                        error: None,
                    };
                }
                Err(e) => {
                    retries += 1;
                    if retries > MAX_RETRIES {
                        return ActivityMapResult {
                            activity_id: activity_id.to_string(),
                            bounds: None,
                            latlngs: None,
                            success: false,
                            error: Some(format!("Request error: {}", e)),
                        };
                    }

                    let wait = Duration::from_millis(200 * (1 << retries));
                    warn!(
                        "[Fetch {}] Error: {}, retry {} after {:?}",
                        activity_id, e, retries, wait
                    );
                    tokio::time::sleep(wait).await;
                }
            }
        }
    }
}

/// Synchronous wrapper for FFI - runs the async code on a tokio runtime
/// Accepts a pre-formatted auth header (e.g., "Basic ..." or "Bearer ...")
#[cfg(feature = "ffi")]
pub fn fetch_activity_maps_sync(
    auth_header: String,
    activity_ids: Vec<String>,
    on_progress: Option<ProgressCallback>,
) -> Vec<ActivityMapResult> {
    use tokio::runtime::Builder;

    let fn_start = Instant::now();
    let activity_count = activity_ids.len();
    info!(
        "[RUST: fetch_activity_maps_sync] Called for {} activities",
        activity_count
    );

    // Create a multi-threaded runtime with enough workers for high concurrency
    let runtime_start = Instant::now();
    let rt = match Builder::new_multi_thread()
        .worker_threads(8)
        .enable_all()
        .build()
    {
        Ok(rt) => {
            info!(
                "[RUST: fetch_activity_maps_sync] Created tokio runtime ({} ms)",
                elapsed_ms(runtime_start)
            );
            rt
        }
        Err(e) => {
            warn!(
                "[RUST: fetch_activity_maps_sync] Failed to create runtime: {} ({} ms)",
                e,
                elapsed_ms(runtime_start)
            );
            return activity_ids
                .into_iter()
                .map(|id| ActivityMapResult {
                    activity_id: id,
                    bounds: None,
                    latlngs: None,
                    success: false,
                    error: Some(format!("Runtime error: {}", e)),
                })
                .collect();
        }
    };

    let client_start = Instant::now();
    let fetcher = match ActivityFetcher::with_auth_header(auth_header) {
        Ok(f) => {
            info!(
                "[RUST: fetch_activity_maps_sync] Created HTTP client ({} ms)",
                elapsed_ms(client_start)
            );
            f
        }
        Err(e) => {
            warn!(
                "[RUST: fetch_activity_maps_sync] Failed to create HTTP client: {} ({} ms)",
                e,
                elapsed_ms(client_start)
            );
            return activity_ids
                .into_iter()
                .map(|id| ActivityMapResult {
                    activity_id: id,
                    bounds: None,
                    latlngs: None,
                    success: false,
                    error: Some(e.clone()),
                })
                .collect();
        }
    };

    let fetch_start = Instant::now();
    let results = rt.block_on(fetcher.fetch_activity_maps(activity_ids, on_progress));
    let success_count = results.iter().filter(|r| r.success).count();
    info!(
        "[RUST: fetch_activity_maps_sync] Fetch complete: {}/{} successful ({} ms)",
        success_count,
        activity_count,
        elapsed_ms(fetch_start)
    );

    info!(
        "[RUST: fetch_activity_maps_sync] Complete ({} ms)",
        elapsed_ms(fn_start)
    );

    results
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
