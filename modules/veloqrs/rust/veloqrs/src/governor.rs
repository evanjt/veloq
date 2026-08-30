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

/// Request priority lane.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lane {
    /// A user is waiting on this (a tapped screen, an upload).
    Interactive,
    /// Opportunistic history backfill - yields to interactive work.
    Backfill,
}

/// Policy layered on top of the baseline pace. It decides both how long a lane
/// waits before it may dispatch and how far behind existing traffic a lane is
/// willing to queue.
pub trait Policy: Send + Sync {
    /// Extra delay to add before dispatching a request in `lane`.
    ///
    /// This lengthens the shared interval, so it slows every lane behind this
    /// request too. Use it to slow the process as a whole, never to demote one
    /// lane relative to another.
    fn pace(&self, lane: Lane) -> Duration;

    /// How far ahead the shared schedule may already run before a request in
    /// `lane` waits for it to drain instead of claiming a slot behind it.
    /// `None` never yields, which is the right answer for work a user is
    /// waiting on. Defaults to `None`.
    fn max_queue_ahead(&self, _lane: Lane) -> Option<Duration> {
        None
    }

    /// Observe a response's parsed budget so the policy can adapt.
    fn observe(&self, budget: &RateBudget);
}

/// The identity policy: no extra pacing, no yielding, no budget tracking. Used
/// by tests that want the bare baseline pace.
pub struct NoopPolicy;

impl Policy for NoopPolicy {
    fn pace(&self, _lane: Lane) -> Duration {
        Duration::ZERO
    }
    fn observe(&self, _budget: &RateBudget) {}
}

/// How far behind existing traffic a backfill request will queue before it
/// parks and lets the schedule drain. Two dispatch slots at the baseline pace,
/// so a lone backfill runs at full speed and a backfill competing with a tapped
/// screen steps aside within one request.
const BACKFILL_MAX_QUEUE_AHEAD: Duration = Duration::from_millis(250);

/// The same limit once the 15-minute budget is nearly spent. Backfill then only
/// takes slots the app has left completely idle.
const BACKFILL_MAX_QUEUE_AHEAD_LOW_BUDGET: Duration = Duration::from_millis(10);

/// Requests of the 15-minute pool held for interactive work. Below this, the
/// backfill stops competing for the remainder.
const INTERACTIVE_RESERVE_15M: u32 = 200;

/// Sentinel for a budget no response has reported yet.
const BUDGET_UNKNOWN: u32 = u32::MAX;

/// The shipped policy: interactive work never waits, backfill work fills the
/// gaps between it.
///
/// Yielding is expressed as a queue limit rather than as extra pace, because
/// pace lengthens the shared interval and would slow the tapped screen along
/// with the backfill. A queue limit costs the backfill request alone: it holds
/// no slot while it waits, so an interactive request that arrives meanwhile
/// takes the slot the backfill would have had.
pub struct YieldBackfillPolicy {
    remaining_15m: std::sync::atomic::AtomicU32,
}

impl YieldBackfillPolicy {
    pub fn new() -> Self {
        Self {
            remaining_15m: std::sync::atomic::AtomicU32::new(BUDGET_UNKNOWN),
        }
    }
}

impl Default for YieldBackfillPolicy {
    fn default() -> Self {
        Self::new()
    }
}

impl Policy for YieldBackfillPolicy {
    fn pace(&self, _lane: Lane) -> Duration {
        Duration::ZERO
    }

    fn max_queue_ahead(&self, lane: Lane) -> Option<Duration> {
        match lane {
            Lane::Interactive => None,
            Lane::Backfill => {
                let remaining = self
                    .remaining_15m
                    .load(std::sync::atomic::Ordering::Relaxed);
                // An unknown budget is treated as healthy: the reserve is a
                // refinement, and refusing to backfill until a header arrives
                // would stall the first run indefinitely.
                if remaining != BUDGET_UNKNOWN && remaining < INTERACTIVE_RESERVE_15M {
                    Some(BACKFILL_MAX_QUEUE_AHEAD_LOW_BUDGET)
                } else {
                    Some(BACKFILL_MAX_QUEUE_AHEAD)
                }
            }
        }
    }

    fn observe(&self, budget: &RateBudget) {
        if let Some(remaining) = budget.remaining_15m {
            self.remaining_15m
                .store(remaining, std::sync::atomic::Ordering::Relaxed);
        }
    }
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
    /// Acquires that actually parked waiting for a higher lane to drain. The
    /// yield is otherwise only visible as elapsed time, which reads as load
    /// rather than as policy.
    yields: std::sync::atomic::AtomicU64,
}

impl Governor {
    /// Build a governor paced at `max_per_sec` with the given policy.
    pub fn new(max_per_sec: u32, policy: Box<dyn Policy>) -> Self {
        let per_sec = max_per_sec.max(1) as f64;
        Self {
            min_interval: Duration::from_secs_f64(1.0 / per_sec),
            next_at: std::sync::Mutex::new(None),
            policy,
            yields: std::sync::atomic::AtomicU64::new(0),
        }
    }

    /// Acquire a dispatch slot for `lane`, awaiting until the shared pace allows.
    /// Never holds the scheduling lock across the await.
    ///
    /// A lane with a queue limit waits for the schedule to drain to that limit
    /// before it claims anything, so it holds no slot while it waits and a
    /// higher-priority request arriving meanwhile takes the slot ahead of it.
    pub async fn acquire(&self, lane: Lane) {
        self.yield_to_higher_lanes(lane).await;
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

    /// Park until the schedule has drained to this lane's queue limit.
    ///
    /// Capped in total, so a process under sustained interactive load delays a
    /// backfill request rather than parking it forever. The backfill is
    /// resumable either way, but a request that never dispatches also never
    /// reports a failure.
    async fn yield_to_higher_lanes(&self, lane: Lane) {
        let Some(max_ahead) = self.policy.max_queue_ahead(lane) else {
            return;
        };
        let mut waited = Duration::ZERO;
        while waited < MAX_LANE_YIELD {
            let backlog = {
                let next = self.next_at.lock().unwrap_or_else(|e| e.into_inner());
                (*next).map_or(Duration::ZERO, |t| {
                    t.saturating_duration_since(Instant::now())
                })
            };
            if backlog <= max_ahead {
                return;
            }
            if waited.is_zero() {
                self.yields
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            }
            let wait = (backlog - max_ahead).min(MAX_LANE_YIELD - waited);
            tokio::time::sleep(wait).await;
            waited += wait;
        }
    }

    /// How many acquires have parked for a higher lane since this governor was
    /// built. The one observable an idle schedule can be asserted on without
    /// timing it.
    pub fn yields(&self) -> u64 {
        self.yields.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Feed a response's rate budget to the policy.
    pub fn observe(&self, budget: &RateBudget) {
        self.policy.observe(budget);
    }
}

/// Longest a single request will park waiting for a busier lane to drain.
const MAX_LANE_YIELD: Duration = Duration::from_secs(60);

/// Largest sustained dispatch rate, under intervals.icu's 10 req/s per-IP cap.
const MAX_DISPATCH_PER_SEC: u32 = 8;

/// The shared process-wide governor. Held in an `Arc` so transports clone a
/// handle to the same limiter (and tests can inject a fast local one for
/// isolation).
pub static GOVERNOR: Lazy<Arc<Governor>> = Lazy::new(|| {
    Arc::new(Governor::new(
        MAX_DISPATCH_PER_SEC,
        Box::new(YieldBackfillPolicy::new()),
    ))
});

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

    /// Expected behaviour: a lane with no queue limit claims the next slot
    /// immediately however long the schedule already is.
    #[test]
    fn interactive_never_yields() {
        crate::runtime::block_on(async {
            let gov = Governor::new(8, Box::new(YieldBackfillPolicy::new()));
            // Build a backlog of roughly a second.
            for _ in 0..8 {
                gov.acquire(Lane::Interactive).await;
            }
            let start = Instant::now();
            gov.acquire(Lane::Interactive).await;
            assert!(
                start.elapsed() < Duration::from_millis(400),
                "interactive waited on the queue: {:?}",
                start.elapsed()
            );
        });
    }

    /// Expected behaviour: a backfill request behind a long queue parks until
    /// the queue has drained, rather than taking the slot at the back of it.
    #[test]
    fn backfill_parks_behind_a_busy_schedule() {
        crate::runtime::block_on(async {
            let gov = Arc::new(Governor::new(8, Box::new(YieldBackfillPolicy::new())));
            // Eight interactive claims put the next free slot ~875ms out.
            let mut claims = Vec::new();
            for _ in 0..8 {
                let g = gov.clone();
                claims.push(crate::runtime::spawn(async move {
                    g.acquire(Lane::Interactive).await
                }));
            }
            // Let every claim land before measuring, so the schedule really is
            // backed up rather than about to be.
            tokio::time::sleep(Duration::from_millis(100)).await;
            let start = Instant::now();
            gov.acquire(Lane::Backfill).await;
            assert!(
                start.elapsed() >= Duration::from_millis(300),
                "backfill queued behind interactive instead of parking: {:?}",
                start.elapsed()
            );
            for c in claims {
                c.await.unwrap();
            }
        });
    }

    /// Expected behaviour: with nothing else in flight the backfill pays no
    /// yield at all, so a lone conversion runs at the full shared pace.
    ///
    /// The governor reports the yield itself. Reading it off the wall clock
    /// made the test a load detector: one scheduling hiccup on a busy box put
    /// an idle five-acquire loop over its bound, and because this lives in the
    /// lib target its failure aborted the workspace run before any integration
    /// binary started.
    #[test]
    fn backfill_alone_pays_no_yield() {
        crate::runtime::block_on(async {
            let gov = Governor::new(1000, Box::new(YieldBackfillPolicy::new()));
            for _ in 0..5 {
                gov.acquire(Lane::Backfill).await;
            }
            assert_eq!(
                gov.yields(),
                0,
                "an idle schedule must not make backfill wait"
            );
        });
    }

    /// A counter wired to nothing also reads zero, so the same counter has to
    /// move when the backfill really does park.
    #[test]
    fn a_busy_schedule_records_the_yield_it_costs() {
        crate::runtime::block_on(async {
            let gov = Arc::new(Governor::new(8, Box::new(YieldBackfillPolicy::new())));
            let mut claims = Vec::new();
            for _ in 0..8 {
                let g = gov.clone();
                claims.push(crate::runtime::spawn(async move {
                    g.acquire(Lane::Interactive).await
                }));
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
            assert_eq!(gov.yields(), 0, "interactive work has no queue limit");

            gov.acquire(Lane::Backfill).await;
            assert_eq!(gov.yields(), 1);

            for c in claims {
                c.await.unwrap();
            }
        });
    }

    #[test]
    fn a_spent_budget_tightens_the_backfill_limit() {
        let policy = YieldBackfillPolicy::new();
        assert_eq!(
            policy.max_queue_ahead(Lane::Backfill),
            Some(BACKFILL_MAX_QUEUE_AHEAD),
            "an unreported budget is treated as healthy"
        );
        assert_eq!(policy.max_queue_ahead(Lane::Interactive), None);

        policy.observe(&RateBudget {
            remaining_15m: Some(INTERACTIVE_RESERVE_15M - 1),
            ..RateBudget::default()
        });
        assert_eq!(
            policy.max_queue_ahead(Lane::Backfill),
            Some(BACKFILL_MAX_QUEUE_AHEAD_LOW_BUDGET)
        );
        assert_eq!(
            policy.max_queue_ahead(Lane::Interactive),
            None,
            "the reserve exists for interactive work, so it never limits it"
        );

        policy.observe(&RateBudget {
            remaining_15m: Some(INTERACTIVE_RESERVE_15M * 10),
            ..RateBudget::default()
        });
        assert_eq!(
            policy.max_queue_ahead(Lane::Backfill),
            Some(BACKFILL_MAX_QUEUE_AHEAD),
            "a refilled pool restores the normal limit"
        );
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
