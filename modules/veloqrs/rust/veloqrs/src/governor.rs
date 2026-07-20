//! Networking governor: the single choke point all outbound intervals.icu
//! requests pass through.
//!
//! This module owns the transport-agnostic *policy* seams - retry backoff,
//! `Authorization` header formatting, and rate-limit-header parsing. They are
//! pure functions so they can be unit-tested without a network. The richer
//! policy (a live budget cell, priority lanes, a per-pool reserve) is layered
//! on top by the rate-limit follow-up plan; this module ships the seams it
//! plugs into.

use once_cell::sync::Lazy;
use std::sync::Arc;
use std::time::{Duration, Instant};

/// Upper bound on any exponential-backoff wait.
const MAX_BACKOFF: Duration = Duration::from_secs(8);

/// Upper bound on how long we will honour a `Retry-After` inline (longer waits
/// are the rate-limit plan's job - it pauses the queue rather than blocking a
/// request).
const MAX_RETRY_AFTER: Duration = Duration::from_secs(120);

/// Decide how long to wait before retrying a failed request.
///
/// The server's `Retry-After` (seconds) always wins when present - it knows its
/// own reset window. Absent that, fall back to exponential backoff. `attempt` is
/// the 1-based retry number; `rate_limited` distinguishes a 429 (longer base)
/// from a transport error.
///
/// Replaces the previous code paths that ignored `Retry-After` and used a fixed
/// `500ms * 2^n` (429) / `200ms * 2^n` (transport) schedule.
pub fn decide_backoff(retry_after_secs: Option<u64>, attempt: u32, rate_limited: bool) -> Duration {
    if let Some(secs) = retry_after_secs {
        return Duration::from_secs(secs).min(MAX_RETRY_AFTER);
    }
    let base_ms: u64 = if rate_limited { 500 } else { 200 };
    let shift = attempt.min(4);
    Duration::from_millis(base_ms.saturating_mul(1u64 << shift)).min(MAX_BACKOFF)
}

/// How a request authenticates to intervals.icu.
pub enum AuthMethod<'a> {
    /// OAuth bearer token.
    Bearer(&'a str),
    /// Personal API key, sent as HTTP Basic `API_KEY:<key>`.
    ApiKey(&'a str),
}

/// Build the `Authorization` header value for the given method. Single source of
/// truth for auth-header construction (previously duplicated across http.rs,
/// ffi.rs, strength.rs and the TS layer).
pub fn format_auth_header(method: AuthMethod<'_>) -> String {
    match method {
        AuthMethod::Bearer(token) => format!("Bearer {}", token),
        AuthMethod::ApiKey(key) => {
            use base64::Engine;
            let encoded =
                base64::engine::general_purpose::STANDARD.encode(format!("API_KEY:{}", key));
            format!("Basic {}", encoded)
        }
    }
}

/// A snapshot of the rate-limit budget parsed from response headers. An unknown
/// or malformed field is `None`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RateBudget {
    pub limit_15m: Option<u32>,
    pub limit_daily: Option<u32>,
    pub remaining_15m: Option<u32>,
    pub remaining_daily: Option<u32>,
    pub retry_after_secs: Option<u64>,
}

/// Parse intervals.icu rate-limit headers:
/// `X-RateLimit-Limit: <15m>,<daily>`, `X-RateLimit-Remaining: <15m>,<daily>`,
/// and `Retry-After: <seconds>`. Missing or malformed values become `None`.
pub fn parse_rate_headers(
    limit: Option<&str>,
    remaining: Option<&str>,
    retry_after: Option<&str>,
) -> RateBudget {
    fn pair(s: Option<&str>) -> (Option<u32>, Option<u32>) {
        match s {
            None => (None, None),
            Some(s) => {
                let mut it = s.split(',');
                let a = it.next().and_then(|x| x.trim().parse().ok());
                let b = it.next().and_then(|x| x.trim().parse().ok());
                (a, b)
            }
        }
    }
    let (limit_15m, limit_daily) = pair(limit);
    let (remaining_15m, remaining_daily) = pair(remaining);
    RateBudget {
        limit_15m,
        limit_daily,
        remaining_15m,
        remaining_daily,
        retry_after_secs: retry_after.and_then(|s| s.trim().parse().ok()),
    }
}

/// Request priority lane. The baseline policy ignores it; the rate-limit plan
/// uses it to reserve headroom for interactive work over backfill.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lane {
    /// A user is waiting on this (a tapped screen, an upload).
    Interactive,
    /// Opportunistic history backfill - yields to interactive work.
    Backfill,
}

/// Policy layered on top of the baseline pace. The baseline is an identity
/// no-op (`NoopPolicy`); the rate-limit follow-up plan supplies a budget-aware
/// implementation (a live budget cell from `X-RateLimit-*`, a reserve, and
/// per-lane pacing). This is the seam the policy plugs into.
pub trait Policy: Send + Sync {
    /// Extra delay to add before dispatching a request in `lane`. Baseline: zero.
    fn pace(&self, lane: Lane) -> Duration;
    /// Observe a response's parsed budget so the policy can adapt. Baseline: ignore.
    fn observe(&self, budget: &RateBudget);
}

/// The baseline identity policy: no extra pacing, no budget tracking.
pub struct NoopPolicy;

impl Policy for NoopPolicy {
    fn pace(&self, _lane: Lane) -> Duration {
        Duration::ZERO
    }
    fn observe(&self, _budget: &RateBudget) {}
}

/// The process-wide dispatch choke point. Every outbound intervals.icu request
/// acquires a slot here first, so one shared limiter governs the whole process
/// rather than per-call pacers that can collectively exceed the per-IP cap.
///
/// The baseline paces at a fixed `min_interval` (≤8 req/s, under the 10 req/s
/// per-IP hard limit) plus whatever the `Policy` adds. Scheduling holds a brief
/// non-async lock; the wait happens outside the lock so it never blocks others.
pub struct Governor {
    min_interval: Duration,
    next_at: std::sync::Mutex<Option<Instant>>,
    policy: Box<dyn Policy>,
}

impl Governor {
    /// Build a governor paced at `max_per_sec` with the given policy.
    pub fn new(max_per_sec: u32, policy: Box<dyn Policy>) -> Self {
        let per_sec = max_per_sec.max(1) as f64;
        Self {
            min_interval: Duration::from_secs_f64(1.0 / per_sec),
            next_at: std::sync::Mutex::new(None),
            policy,
        }
    }

    /// Acquire a dispatch slot for `lane`, awaiting until the shared pace allows.
    /// Never holds the scheduling lock across the await.
    pub async fn acquire(&self, lane: Lane) {
        let interval = self.min_interval + self.policy.pace(lane);
        let scheduled = {
            let mut next = self.next_at.lock().unwrap_or_else(|e| e.into_inner());
            let now = Instant::now();
            let scheduled = (*next).map_or(now, |t| t.max(now));
            *next = Some(scheduled + interval);
            scheduled
        };
        let now = Instant::now();
        if scheduled > now {
            tokio::time::sleep(scheduled - now).await;
        }
    }

    /// Feed a response's rate budget to the policy.
    pub fn observe(&self, budget: &RateBudget) {
        self.policy.observe(budget);
    }
}

/// Largest sustained dispatch rate, under intervals.icu's 10 req/s per-IP cap.
const MAX_DISPATCH_PER_SEC: u32 = 8;

/// The shared process-wide governor. Ships with the baseline no-op policy; the
/// rate-limit plan replaces the policy with a budget-aware one. Held in an `Arc`
/// so transports clone a handle to the same limiter (and tests can inject a
/// fast local one for isolation).
pub static GOVERNOR: Lazy<Arc<Governor>> =
    Lazy::new(|| Arc::new(Governor::new(MAX_DISPATCH_PER_SEC, Box::new(NoopPolicy))));

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicU32, Ordering};

    #[test]
    fn retry_after_always_wins() {
        // Even on a 429 where the exponential base would be 1s, the server hint wins.
        assert_eq!(decide_backoff(Some(10), 1, true), Duration::from_secs(10));
        assert_eq!(decide_backoff(Some(3), 3, false), Duration::from_secs(3));
    }

    #[test]
    fn retry_after_is_capped() {
        // A pathological / pool-reset-sized hint is capped inline.
        assert_eq!(decide_backoff(Some(3600), 1, true), MAX_RETRY_AFTER);
    }

    #[test]
    fn exponential_fallback_matches_prior_schedule() {
        // 429: 1s, 2s, 4s for attempts 1..3 (was 500ms * 2^n).
        assert_eq!(decide_backoff(None, 1, true), Duration::from_millis(1000));
        assert_eq!(decide_backoff(None, 2, true), Duration::from_millis(2000));
        assert_eq!(decide_backoff(None, 3, true), Duration::from_millis(4000));
        // transport: 400ms, 800ms, 1600ms (was 200ms * 2^n).
        assert_eq!(decide_backoff(None, 1, false), Duration::from_millis(400));
        assert_eq!(decide_backoff(None, 2, false), Duration::from_millis(800));
        assert_eq!(decide_backoff(None, 3, false), Duration::from_millis(1600));
    }

    #[test]
    fn backoff_is_capped() {
        assert_eq!(decide_backoff(None, 10, true), MAX_BACKOFF);
    }

    #[test]
    fn bearer_header_is_passthrough() {
        assert_eq!(
            format_auth_header(AuthMethod::Bearer("abc123")),
            "Bearer abc123"
        );
    }

    #[test]
    fn api_key_header_is_basic_api_key_prefixed() {
        use base64::Engine;
        let header = format_auth_header(AuthMethod::ApiKey("secret"));
        let encoded = header.strip_prefix("Basic ").expect("Basic prefix");
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .unwrap();
        assert_eq!(std::str::from_utf8(&decoded).unwrap(), "API_KEY:secret");
    }

    #[test]
    fn parses_well_formed_rate_headers() {
        let b = parse_rate_headers(Some("2500,5000"), Some("2487,4988"), Some("370"));
        assert_eq!(b.limit_15m, Some(2500));
        assert_eq!(b.limit_daily, Some(5000));
        assert_eq!(b.remaining_15m, Some(2487));
        assert_eq!(b.remaining_daily, Some(4988));
        assert_eq!(b.retry_after_secs, Some(370));
    }

    #[test]
    fn tolerates_missing_and_malformed_headers() {
        assert_eq!(parse_rate_headers(None, None, None), RateBudget::default());
        // Whitespace + a single value (no daily) + garbage retry-after.
        let b = parse_rate_headers(Some(" 2500 , 5000 "), Some("2487"), Some("soon"));
        assert_eq!(b.limit_15m, Some(2500));
        assert_eq!(b.limit_daily, Some(5000));
        assert_eq!(b.remaining_15m, Some(2487));
        assert_eq!(b.remaining_daily, None);
        assert_eq!(b.retry_after_secs, None);
    }

    #[test]
    fn paces_concurrent_acquires_under_target_rate() {
        crate::runtime::block_on(async {
            let gov = Arc::new(Governor::new(8, Box::new(NoopPolicy)));
            let start = Instant::now();
            let handles: Vec<_> = (0..8)
                .map(|_| {
                    let g = gov.clone();
                    crate::runtime::spawn(async move { g.acquire(Lane::Interactive).await })
                })
                .collect();
            for h in handles {
                h.await.unwrap();
            }
            // 8 dispatches at 8/s span 7 intervals of 125ms = 875ms minimum.
            // sleep never returns early, so this lower bound is non-flaky.
            assert!(
                start.elapsed() >= Duration::from_millis(800),
                "8 dispatches finished too fast: {:?}",
                start.elapsed()
            );
        });
    }

    #[test]
    fn policy_pace_adds_to_interval() {
        struct FixedPace(Duration);
        impl Policy for FixedPace {
            fn pace(&self, _lane: Lane) -> Duration {
                self.0
            }
            fn observe(&self, _budget: &RateBudget) {}
        }
        crate::runtime::block_on(async {
            // Tiny base interval; the 200ms policy pace dominates the spacing.
            let gov = Governor::new(1000, Box::new(FixedPace(Duration::from_millis(200))));
            let start = Instant::now();
            gov.acquire(Lane::Backfill).await;
            gov.acquire(Lane::Backfill).await;
            assert!(
                start.elapsed() >= Duration::from_millis(180),
                "policy pace not applied: {:?}",
                start.elapsed()
            );
        });
    }

    #[test]
    fn observe_forwards_to_policy() {
        struct Counting(Arc<AtomicU32>);
        impl Policy for Counting {
            fn pace(&self, _lane: Lane) -> Duration {
                Duration::ZERO
            }
            fn observe(&self, _budget: &RateBudget) {
                self.0.fetch_add(1, Ordering::Relaxed);
            }
        }
        let counter = Arc::new(AtomicU32::new(0));
        let gov = Governor::new(8, Box::new(Counting(counter.clone())));
        gov.observe(&RateBudget::default());
        assert_eq!(counter.load(Ordering::Relaxed), 1);
    }
}
