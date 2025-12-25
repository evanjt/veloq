//! HTTP client for intervals.icu API with rate limiting.
//!
//! This module provides high-performance activity fetching with:
//! - Connection pooling for HTTP/2 multiplexing
//! - Dispatch rate limiting (spaces out request starts)
//! - Parallel fetching with configurable concurrency
//! - Automatic retry with exponential backoff on 429

use base64::Engine;
use log::{debug, info, warn};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

// Version for debugging - increment when making changes
const HTTP_VERSION: &str = "v6-sustained";

// Rate limits from intervals.icu API: 30/s burst, 131/10s sustained
// Target: 12.5 req/s (80ms intervals) to respect sustained limit
// Math: 131/10s = 13.1 req/s max sustained. Use 12.5 for safety margin.
const DISPATCH_INTERVAL_MS: u64 = 80;  // 1000ms / 12.5 = 80ms between dispatches
const MAX_CONCURRENCY: usize = 50;      // Allow many in-flight (network latency ~200-400ms)
const MAX_RETRIES: u32 = 3;

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
    pub ne: [f64; 2],  // [lat, lng]
    pub sw: [f64; 2],  // [lat, lng]
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
/// more than 20 requests per second by spacing them 50ms apart.
struct DispatchRateLimiter {
    next_dispatch: Mutex<Instant>,
    dispatched_count: AtomicU32,
    consecutive_429s: AtomicU32,
}

impl DispatchRateLimiter {
    fn new() -> Self {
        Self {
            next_dispatch: Mutex::new(Instant::now()),
            dispatched_count: AtomicU32::new(0),
            consecutive_429s: AtomicU32::new(0),
        }
    }

    /// Wait for our dispatch slot. Each caller gets a unique slot
    /// spaced DISPATCH_INTERVAL_MS apart.
    async fn wait_for_dispatch_slot(&self) -> u32 {
        let (wait_duration, dispatch_num) = {
            let mut next = self.next_dispatch.lock().await;
            let now = Instant::now();

            // Calculate when this request can dispatch
            let dispatch_at = if *next > now { *next } else { now };

            // Reserve the next slot for the next caller
            *next = dispatch_at + Duration::from_millis(DISPATCH_INTERVAL_MS);

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
            debug!("[Dispatch #{}] Waiting {:?} for slot", dispatch_num, wait_duration);
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
        warn!("[DispatchRateLimiter] Got 429! Consecutive: {}, backing off {:?}", count, backoff);
        backoff
    }
}

/// High-performance activity fetcher
pub struct ActivityFetcher {
    client: Client,
    auth_header: String,
    rate_limiter: Arc<DispatchRateLimiter>,
}

impl ActivityFetcher {
    /// Create a new activity fetcher with the given API key
    pub fn new(api_key: &str) -> Result<Self, String> {
        let auth = base64::engine::general_purpose::STANDARD
            .encode(format!("API_KEY:{}", api_key));

        let client = Client::builder()
            .pool_max_idle_per_host(MAX_CONCURRENCY * 2)
            .pool_idle_timeout(Duration::from_secs(60))
            .tcp_keepalive(Duration::from_secs(30))
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

        Ok(Self {
            client,
            auth_header: format!("Basic {}", auth),
            rate_limiter: Arc::new(DispatchRateLimiter::new()),
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
        let completed = Arc::new(AtomicU32::new(0));
        let total_bytes = Arc::new(AtomicU32::new(0));

        info!(
            "[ActivityFetcher {}] Starting fetch of {} activities (dispatch interval: {}ms, max concurrent: {})",
            HTTP_VERSION, total, DISPATCH_INTERVAL_MS, MAX_CONCURRENCY
        );

        let start = Instant::now();

        // Use buffered stream for parallel execution with dispatch rate limiting
        let results: Vec<ActivityMapResult> = stream::iter(activity_ids)
            .map(|id| {
                let client = &self.client;
                let auth = &self.auth_header;
                let rate_limiter = &self.rate_limiter;
                let completed = Arc::clone(&completed);
                let total_bytes = Arc::clone(&total_bytes);
                let callback = on_progress.clone();
                let start_time = start;

                async move {
                    // Wait for our dispatch slot - this spaces out request starts
                    let dispatch_num = rate_limiter.wait_for_dispatch_slot().await;
                    let dispatch_time = start_time.elapsed();

                    let result = Self::fetch_single_map(client, auth, rate_limiter, &id).await;

                    // Track progress
                    let done = completed.fetch_add(1, Ordering::Relaxed) + 1;
                    let bytes = result.latlngs.as_ref().map_or(0, |v| v.len() * 16) as u32;
                    total_bytes.fetch_add(bytes, Ordering::Relaxed);
                    let complete_time = start_time.elapsed();

                    // Calculate effective dispatch rate
                    let dispatch_rate = if dispatch_time.as_secs_f64() > 0.0 {
                        dispatch_num as f64 / dispatch_time.as_secs_f64()
                    } else {
                        0.0
                    };

                    info!(
                        "[Progress] {}/{} | dispatched@{:.2}s (#{} @ {:.1}/s) | done@{:.2}s | {}KB",
                        done, total,
                        dispatch_time.as_secs_f64(), dispatch_num, dispatch_rate,
                        complete_time.as_secs_f64(),
                        bytes / 1024
                    );

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
            "[ActivityFetcher {}] DONE: {}/{} success ({} errors) in {:.2}s ({:.1} req/s, {}KB)",
            HTTP_VERSION, success_count, total, error_count, elapsed.as_secs_f64(), rate, total_kb
        );

        results
    }

    async fn fetch_single_map(
        client: &Client,
        auth: &str,
        rate_limiter: &DispatchRateLimiter,
        activity_id: &str,
    ) -> ActivityMapResult {
        let url = format!(
            "https://intervals.icu/api/v1/activity/{}/map",
            activity_id
        );

        let mut retries = 0;
        let req_start = Instant::now();

        loop {
            // Phase 1: Send request, receive headers
            let response = client
                .get(&url)
                .header("Authorization", auth)
                .send()
                .await;

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
                    let bounds = data.bounds.map(|b| MapBounds {
                        ne: b.ne,
                        sw: b.sw,
                    });
                    let latlngs = data.latlngs.map(|coords| {
                        coords.into_iter().flatten().collect()
                    });
                    let transform_elapsed = transform_start.elapsed();

                    let total_elapsed = req_start.elapsed();

                    // Detailed timing breakdown
                    info!(
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
#[cfg(feature = "ffi")]
pub fn fetch_activity_maps_sync(
    api_key: String,
    activity_ids: Vec<String>,
    on_progress: Option<ProgressCallback>,
) -> Vec<ActivityMapResult> {
    use tokio::runtime::Builder;

    info!("[FFI {}] fetch_activity_maps_sync called for {} activities", HTTP_VERSION, activity_ids.len());

    // Create a multi-threaded runtime with enough workers for high concurrency
    let rt = match Builder::new_multi_thread()
        .worker_threads(8)
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            warn!("Failed to create tokio runtime: {}", e);
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

    let fetcher = match ActivityFetcher::new(&api_key) {
        Ok(f) => f,
        Err(e) => {
            warn!("Failed to create fetcher: {}", e);
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

    rt.block_on(fetcher.fetch_activity_maps(activity_ids, on_progress))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_dispatch_rate_limiter() {
        let limiter = DispatchRateLimiter::new();

        // First request should not wait
        let start = Instant::now();
        let num = limiter.wait_for_dispatch_slot().await;
        assert_eq!(num, 1);
        assert!(start.elapsed() < Duration::from_millis(10));

        // Second request should wait ~50ms
        let start2 = Instant::now();
        let num2 = limiter.wait_for_dispatch_slot().await;
        assert_eq!(num2, 2);
        let elapsed = start2.elapsed();
        assert!(elapsed >= Duration::from_millis(40), "Expected ~50ms wait, got {:?}", elapsed);
        assert!(elapsed < Duration::from_millis(100), "Expected ~50ms wait, got {:?}", elapsed);
    }
}
