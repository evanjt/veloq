//! HTTP client for intervals.icu API with rate limiting.
//!
//! This module provides high-performance activity fetching with:
//! - Connection pooling for HTTP/2 multiplexing
//! - Rate limiting (30 req/s burst, 131 req/10s sustained)
//! - Parallel fetching with configurable concurrency
//! - Automatic retry with exponential backoff on 429

use base64::Engine;
use log::{debug, info, warn};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, Semaphore};

// API rate limits
const BURST_LIMIT: u32 = 30;       // Max requests per second
const SUSTAINED_LIMIT: u32 = 131;  // Max requests per 10 seconds
const WINDOW_MS: u64 = 10_000;     // 10 second window

// Concurrency settings
const MAX_CONCURRENCY: usize = 25; // Parallel requests (tuned for ~300ms latency)
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

/// Rate limiter using sliding window
struct RateLimiter {
    request_times: Mutex<VecDeque<Instant>>,
    consecutive_429s: AtomicU32,
}

impl RateLimiter {
    fn new() -> Self {
        Self {
            request_times: Mutex::new(VecDeque::with_capacity(SUSTAINED_LIMIT as usize + 10)),
            consecutive_429s: AtomicU32::new(0),
        }
    }

    async fn wait_if_needed(&self) {
        loop {
            let wait_time = {
                let mut times = self.request_times.lock().await;
                let now = Instant::now();

                // Prune old requests outside window
                let cutoff = now - Duration::from_millis(WINDOW_MS);
                while times.front().map_or(false, |&t| t < cutoff) {
                    times.pop_front();
                }

                // Check sustained limit (131/10s)
                if times.len() >= SUSTAINED_LIMIT as usize {
                    if let Some(&oldest) = times.front() {
                        let wait_until = oldest + Duration::from_millis(WINDOW_MS);
                        if wait_until > now {
                            Some(wait_until - now)
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                } else {
                    // Check burst limit (30/s)
                    let one_sec_ago = now - Duration::from_secs(1);
                    let requests_last_second = times.iter().filter(|&&t| t > one_sec_ago).count();
                    if requests_last_second >= BURST_LIMIT as usize {
                        if let Some(&oldest_in_second) = times.iter().find(|&&t| t > one_sec_ago) {
                            let wait_until = oldest_in_second + Duration::from_secs(1);
                            if wait_until > now {
                                Some(wait_until - now)
                            } else {
                                None
                            }
                        } else {
                            None
                        }
                    } else {
                        None
                    }
                }
            };

            match wait_time {
                Some(duration) => {
                    debug!("Rate limit: waiting {:?}", duration);
                    tokio::time::sleep(duration).await;
                }
                None => break,
            }
        }
    }

    async fn record_request(&self) {
        let mut times = self.request_times.lock().await;
        times.push_back(Instant::now());
        self.consecutive_429s.store(0, Ordering::Relaxed);
    }

    fn record_429(&self) -> Duration {
        let count = self.consecutive_429s.fetch_add(1, Ordering::Relaxed) + 1;
        // Exponential backoff: 1s, 2s, 4s, 8s...
        let backoff_ms = 1000 * (1 << count.min(4));
        Duration::from_millis(backoff_ms)
    }
}

/// High-performance activity fetcher
pub struct ActivityFetcher {
    client: Client,
    auth_header: String,
    rate_limiter: Arc<RateLimiter>,
}

impl ActivityFetcher {
    /// Create a new activity fetcher with the given API key
    pub fn new(api_key: &str) -> Result<Self, String> {
        let auth = base64::engine::general_purpose::STANDARD
            .encode(format!("API_KEY:{}", api_key));

        let client = Client::builder()
            .pool_max_idle_per_host(MAX_CONCURRENCY)
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

        Ok(Self {
            client,
            auth_header: format!("Basic {}", auth),
            rate_limiter: Arc::new(RateLimiter::new()),
        })
    }

    /// Fetch map data for multiple activities in parallel
    pub async fn fetch_activity_maps(
        &self,
        activity_ids: Vec<String>,
        on_progress: Option<ProgressCallback>,
    ) -> Vec<ActivityMapResult> {
        let total = activity_ids.len() as u32;
        let completed = Arc::new(AtomicU32::new(0));
        let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENCY));
        let progress_callback = on_progress;

        info!(
            "[ActivityFetcher] Fetching {} activities with {} concurrent workers",
            total, MAX_CONCURRENCY
        );

        let start = Instant::now();

        let tasks: Vec<_> = activity_ids
            .into_iter()
            .map(|id| {
                let client = self.client.clone();
                let auth = self.auth_header.clone();
                let rate_limiter = Arc::clone(&self.rate_limiter);
                let semaphore = Arc::clone(&semaphore);
                let completed = Arc::clone(&completed);
                let callback = progress_callback.clone();

                tokio::spawn(async move {
                    // Acquire semaphore permit
                    let _permit = semaphore.acquire().await.unwrap();

                    let result = Self::fetch_single_map(
                        &client,
                        &auth,
                        &rate_limiter,
                        &id,
                    ).await;

                    let done = completed.fetch_add(1, Ordering::Relaxed) + 1;
                    if let Some(ref cb) = callback {
                        cb(done, total);
                    }

                    result
                })
            })
            .collect();

        // Collect results
        let mut results = Vec::with_capacity(tasks.len());
        for task in tasks {
            match task.await {
                Ok(result) => results.push(result),
                Err(e) => {
                    warn!("Task join error: {}", e);
                    results.push(ActivityMapResult {
                        activity_id: String::new(),
                        bounds: None,
                        latlngs: None,
                        success: false,
                        error: Some(format!("Task error: {}", e)),
                    });
                }
            }
        }

        let elapsed = start.elapsed();
        let success_count = results.iter().filter(|r| r.success).count();
        let rate = total as f64 / elapsed.as_secs_f64();

        info!(
            "[ActivityFetcher] Completed: {}/{} successful in {:.2}s ({:.1} req/s)",
            success_count, total, elapsed.as_secs_f64(), rate
        );

        results
    }

    async fn fetch_single_map(
        client: &Client,
        auth: &str,
        rate_limiter: &RateLimiter,
        activity_id: &str,
    ) -> ActivityMapResult {
        let url = format!(
            "https://intervals.icu/api/v1/activity/{}/map",
            activity_id
        );

        let mut retries = 0;

        loop {
            // Wait for rate limit
            rate_limiter.wait_if_needed().await;

            let response = client
                .get(&url)
                .header("Authorization", auth)
                .send()
                .await;

            rate_limiter.record_request().await;

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

                        let backoff = rate_limiter.record_429();
                        warn!(
                            "[ActivityFetcher] 429 for {}, retry {} after {:?}",
                            activity_id, retries, backoff
                        );
                        tokio::time::sleep(backoff).await;
                        continue;
                    }

                    if !status.is_success() {
                        return ActivityMapResult {
                            activity_id: activity_id.to_string(),
                            bounds: None,
                            latlngs: None,
                            success: false,
                            error: Some(format!("HTTP {}", status)),
                        };
                    }

                    // Parse response
                    match resp.json::<MapApiResponse>().await {
                        Ok(data) => {
                            let bounds = data.bounds.map(|b| MapBounds {
                                ne: b.ne,
                                sw: b.sw,
                            });

                            // Filter null latlngs
                            let latlngs = data.latlngs.map(|coords| {
                                coords.into_iter().flatten().collect()
                            });

                            return ActivityMapResult {
                                activity_id: activity_id.to_string(),
                                bounds,
                                latlngs,
                                success: true,
                                error: None,
                            };
                        }
                        Err(e) => {
                            return ActivityMapResult {
                                activity_id: activity_id.to_string(),
                                bounds: None,
                                latlngs: None,
                                success: false,
                                error: Some(format!("Parse error: {}", e)),
                            };
                        }
                    }
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

                    let backoff = Duration::from_millis(500 * (1 << retries));
                    warn!(
                        "[ActivityFetcher] Error for {}: {}, retry {} after {:?}",
                        activity_id, e, retries, backoff
                    );
                    tokio::time::sleep(backoff).await;
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
    use tokio::runtime::Runtime;

    // Create a new runtime for this call
    let rt = match Runtime::new() {
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
    async fn test_rate_limiter() {
        let limiter = RateLimiter::new();

        // Should not wait on first request
        let start = Instant::now();
        limiter.wait_if_needed().await;
        limiter.record_request().await;
        assert!(start.elapsed() < Duration::from_millis(100));
    }
}
