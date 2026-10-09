//! Networking governor: the single choke point all outbound intervals.icu
//! requests pass through.
//!
//! This module owns the transport-agnostic *policy* seams - retry backoff,
//! `Authorization` header formatting, the rate headers a response carries and
//! what a 429 was. They are pure functions so they can be unit-tested without a
//! network. Priority lanes are layered on top through `Policy`.

use std::sync::Arc;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

/// Upper bound on any exponential-backoff wait.
const MAX_BACKOFF: Duration = Duration::from_secs(8);

/// Upper bound on how long we will honour a `Retry-After` inline (longer waits
/// are the rate-limit plan's job - it pauses the queue rather than blocking a
/// request).
const MAX_RETRY_AFTER: Duration = Duration::from_secs(120);

/// The one place a retry backoff, a pacing wait or a lane yield sleeps.
///
/// Tests that hold the crate lock record the wait instead of spending it, so
/// what the code asked for stays observable without the suite waiting it out.
pub(crate) async fn pause(wait: Duration) {
    #[cfg(test)]
    if crate::test_globals::record_pause(wait) {
        return;
    }
    tokio::time::sleep(wait).await;
}

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

/// What a response says about rate: `Retry-After` on a 429, and the
/// `X-RateLimit-Limit` and `X-RateLimit-Remaining` pair when the application
/// sends one.
///
/// The edge refusal measured 2026-09-05 on the API-key path carries
/// `Retry-After: 1`, no `via` header, an empty body and no budget pair. The
/// application's own quota refusal has not been measured, and the published
/// rate limit description singles out the per-IP limit as the one that sends
/// no budget headers. So the pair is read when it arrives and its absence means
/// the budget is unknown, never that it is healthy. A malformed or absent value
/// is `None`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct RateBudget {
    pub retry_after_secs: Option<u64>,
    pub limit: Option<RateWindows>,
    pub remaining: Option<RateWindows>,
}

/// One budget header's two figures: the rolling 15-minute window first, the
/// UTC day second.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RateWindows {
    pub fifteen_minutes: u64,
    pub daily: u64,
}

/// Parse `Retry-After: <seconds>` and the `X-RateLimit-Limit` and
/// `X-RateLimit-Remaining` pairs.
pub fn parse_rate_headers(
    retry_after: Option<&str>,
    limit: Option<&str>,
    remaining: Option<&str>,
) -> RateBudget {
    RateBudget {
        retry_after_secs: retry_after.and_then(|s| s.trim().parse().ok()),
        limit: limit.and_then(parse_rate_windows),
        remaining: remaining.and_then(parse_rate_windows),
    }
}

/// Parse `<15-minute>,<daily>`. Anything but exactly two integers is `None`,
/// since a single figure cannot say which window it counts.
fn parse_rate_windows(value: &str) -> Option<RateWindows> {
    let (fifteen_minutes, daily) = value.split_once(',')?;
    Some(RateWindows {
        fifteen_minutes: fifteen_minutes.trim().parse().ok()?,
        daily: daily.trim().parse().ok()?,
    })
}

/// What a 429 was, read from what it carried.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    /// The edge's burst allowance: a short `Retry-After`, never through the
    /// application, empty. Retried inline.
    EdgeBurst,
    /// The application's quota, or a refusal that repeats. Holds the backfill.
    AppQuota,
}

/// Longest `Retry-After` an edge burst refusal carries.
const EDGE_BURST_MAX_RETRY_AFTER_SECS: u64 = 5;

/// Classify a 429. `via` is the response's `via` header, `consecutive` counts
/// this refusal with those before it since the last success, so 1 is the
/// first.
///
/// An edge burst is a `Retry-After` of five seconds or less, no `via` header,
/// no budget pair and an empty body, and it is the first refusal in a row.
/// Anything that passed through the application, a longer or missing
/// `Retry-After`, or a second refusal in a row is the application's quota.
pub fn classify_refusal(
    budget: &RateBudget,
    via: Option<&str>,
    body: &[u8],
    consecutive: u32,
) -> Refusal {
    let short = budget
        .retry_after_secs
        .is_some_and(|secs| secs <= EDGE_BURST_MAX_RETRY_AFTER_SECS);
    let at_the_edge =
        via.is_none() && body.is_empty() && budget.limit.is_none() && budget.remaining.is_none();
    if consecutive <= 1 && short && at_the_edge {
        Refusal::EdgeBurst
    } else {
        Refusal::AppQuota
    }
}

/// The shared limits every install of the app draws on, as the application
/// publishes them. Used as the denominator when a response carries
/// `X-RateLimit-Remaining` without `X-RateLimit-Limit`.
const SHARED_LIMITS: RateWindows = RateWindows {
    fifteen_minutes: 2_500,
    daily: 8_000,
};

/// Below this share of a window left, the backfill stops drawing on it.
const LOW_REMAINING_PERCENT: u64 = 25;

/// The full rolling window, which is how long a low 15-minute figure holds the
/// backfill: the oldest request in it has left by then.
const FIFTEEN_MINUTES: chrono::TimeDelta = chrono::TimeDelta::minutes(15);

/// When the backfill may draw on the shared budget again, read from a
/// response's budget pair at `now`, or `None` when the pair is absent or
/// healthy.
///
/// Below a quarter of the day left it holds until the next midnight UTC, when
/// the daily count resets. Below a quarter of the 15-minute window left it
/// holds for the window. A figure only ever holds the backfill: nothing here
/// speeds anything up, and work a user is waiting on is never gated by it.
pub fn budget_hold_until(
    budget: &RateBudget,
    now: chrono::DateTime<chrono::Utc>,
) -> Option<chrono::DateTime<chrono::Utc>> {
    let remaining = budget.remaining?;
    let limit = budget.limit.unwrap_or(SHARED_LIMITS);
    let low = |left: u64, of: u64| {
        of > 0 && left.saturating_mul(100) < of.saturating_mul(LOW_REMAINING_PERCENT)
    };
    if low(remaining.daily, limit.daily) {
        let tomorrow = now.date_naive().succ_opt()?;
        return Some(tomorrow.and_hms_opt(0, 0, 0)?.and_utc());
    }
    if low(remaining.fifteen_minutes, limit.fifteen_minutes) {
        return Some(now + FIFTEEN_MINUTES);
    }
    None
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
}

/// The identity policy: no extra pacing and no yielding. Used by tests that
/// want the bare baseline pace.
pub struct NoopPolicy;

impl Policy for NoopPolicy {
    fn pace(&self, _lane: Lane) -> Duration {
        Duration::ZERO
    }
}

/// How far behind existing traffic a backfill request will queue before it
/// parks and lets the schedule drain. Two dispatch slots at the baseline pace,
/// so a lone backfill runs at full speed and a backfill competing with a tapped
/// screen steps aside within one request.
const BACKFILL_MAX_QUEUE_AHEAD: Duration = Duration::from_millis(250);

/// The shipped policy: interactive work never waits, backfill work fills the
/// gaps between it.
///
/// Yielding is expressed as a queue limit rather than as extra pace, because
/// pace lengthens the shared interval and would slow the tapped screen along
/// with the backfill. A queue limit costs the backfill request alone: it holds
/// no slot while it waits, so an interactive request that arrives meanwhile
/// takes the slot the backfill would have had.
#[derive(Default)]
pub struct YieldBackfillPolicy;

impl YieldBackfillPolicy {
    pub fn new() -> Self {
        Self
    }
}

impl Policy for YieldBackfillPolicy {
    fn pace(&self, _lane: Lane) -> Duration {
        Duration::ZERO
    }

    fn max_queue_ahead(&self, lane: Lane) -> Option<Duration> {
        match lane {
            Lane::Interactive => None,
            Lane::Backfill => Some(BACKFILL_MAX_QUEUE_AHEAD),
        }
    }
}

/// The process-wide dispatch choke point. Every outbound intervals.icu request
/// acquires a slot here first, so one shared limiter governs the whole process
/// rather than per-call pacers that can collectively exceed the edge's burst
/// allowance.
///
/// The baseline paces at a fixed `min_interval` (8 req/s, a third of the
/// measured sustained ceiling) plus whatever the `Policy` adds. Scheduling holds a brief
/// non-async lock; the wait happens outside the lock so it never blocks others.
pub struct Governor {
    min_interval: Duration,
    next_at: std::sync::Mutex<Option<Instant>>,
    policy: Box<dyn Policy>,
    /// Acquires that actually parked waiting for a higher lane to drain. The
    /// yield is otherwise only visible as elapsed time, which reads as load
    /// rather than as policy.
    yields: std::sync::atomic::AtomicU64,
    /// 429s since the last success, across every request in the process.
    consecutive_refusals: std::sync::atomic::AtomicU32,
    /// Until when the backfill should not draw on the shared budget, from the
    /// last application quota refusal or a low budget figure.
    backfill_hold: std::sync::Mutex<Option<chrono::DateTime<chrono::Utc>>>,
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
            consecutive_refusals: std::sync::atomic::AtomicU32::new(0),
            backfill_hold: std::sync::Mutex::new(None),
        }
    }

    /// Record a 429 and classify it. Returns what it was and how many refusals
    /// in a row it makes.
    ///
    /// An application quota refusal holds the backfill for its `Retry-After`
    /// in full, uncapped, and for whatever its budget pair says.
    pub fn note_refusal(
        &self,
        budget: &RateBudget,
        via: Option<&str>,
        body: &[u8],
        now: chrono::DateTime<chrono::Utc>,
    ) -> (Refusal, u32) {
        let consecutive = self
            .consecutive_refusals
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            .saturating_add(1);
        let refusal = classify_refusal(budget, via, body, consecutive);
        if refusal == Refusal::AppQuota {
            let retry_after = budget
                .retry_after_secs
                .and_then(|secs| chrono::TimeDelta::try_seconds(i64::try_from(secs).ok()?))
                .and_then(|wait| now.checked_add_signed(wait));
            self.hold_backfill(retry_after);
            self.hold_backfill(budget_hold_until(budget, now));
        }
        (refusal, consecutive)
    }

    /// Record a success: the run of refusals ends, and a low budget figure
    /// holds the backfill. A healthy figure does not lift a hold a refusal set.
    pub fn note_success(&self, budget: &RateBudget, now: chrono::DateTime<chrono::Utc>) {
        self.consecutive_refusals
            .store(0, std::sync::atomic::Ordering::Relaxed);
        self.hold_backfill(budget_hold_until(budget, now));
    }

    /// Extend the backfill hold to `until`. A hold only ever lengthens here; it
    /// lapses when its time passes.
    fn hold_backfill(&self, until: Option<chrono::DateTime<chrono::Utc>>) {
        let Some(until) = until else { return };
        let mut hold = self.backfill_hold.lock().unwrap_or_else(|e| e.into_inner());
        if hold.is_none_or(|current| current < until) {
            *hold = Some(until);
        }
    }

    /// Until when the backfill should not draw on the shared budget, or `None`
    /// when nothing holds it at `now`.
    pub fn backfill_hold_until(
        &self,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Option<chrono::DateTime<chrono::Utc>> {
        let hold = *self.backfill_hold.lock().unwrap_or_else(|e| e.into_inner());
        hold.filter(|until| *until > now)
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
            pause(scheduled - now).await;
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
            pause(wait).await;
            waited += wait;
        }
    }

    /// How many acquires have parked for a higher lane since this governor was
    /// built. The one observable an idle schedule can be asserted on without
    /// timing it.
    pub fn yields(&self) -> u64 {
        self.yields.load(std::sync::atomic::Ordering::Relaxed)
    }
}

/// Longest a single request will park waiting for a busier lane to drain.
const MAX_LANE_YIELD: Duration = Duration::from_secs(60);

/// Largest sustained dispatch rate. Measured 2026-09-05 against the live API:
/// paced runs up to 25 req/s pass clean, and refusals come from a Cloudflare
/// burst allowance of about thirty requests in flight, answered with
/// `Retry-After: 1`. Eight a second is a third of that ceiling, with room for
/// the retry loop's worst case on top.
const MAX_DISPATCH_PER_SEC: u32 = 8;

/// The shared process-wide governor. Held in an `Arc` so transports clone a
/// handle to the same limiter (and tests can inject a fast local one for
/// isolation).
pub static GOVERNOR: LazyLock<Arc<Governor>> = LazyLock::new(|| {
    Arc::new(Governor::new(
        MAX_DISPATCH_PER_SEC,
        Box::new(YieldBackfillPolicy::new()),
    ))
});

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

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
    fn parses_retry_after() {
        let retry = |v| parse_rate_headers(v, None, None).retry_after_secs;
        assert_eq!(retry(Some("370")), Some(370));
        assert_eq!(retry(Some(" 1 ")), Some(1));
        assert_eq!(retry(Some("soon")), None);
        assert_eq!(retry(Some("")), None);
        assert_eq!(parse_rate_headers(None, None, None), RateBudget::default());
    }

    #[test]
    fn parses_the_budget_pair_as_fifteen_minutes_then_daily() {
        let budget = parse_rate_headers(None, Some("2500,8000"), Some("1200,5400"));
        assert_eq!(
            budget.remaining,
            Some(RateWindows {
                fifteen_minutes: 1_200,
                daily: 5_400
            })
        );
        assert_eq!(budget.limit, Some(SHARED_LIMITS));
        let remaining = |v| parse_rate_headers(None, None, Some(v)).remaining;
        assert_eq!(
            remaining(" 1200 , 5400 "),
            Some(RateWindows {
                fifteen_minutes: 1_200,
                daily: 5_400
            })
        );
        assert_eq!(remaining("0,0").map(|w| w.daily), Some(0));
    }

    #[test]
    fn a_budget_header_that_is_not_two_integers_is_none() {
        let remaining = |v| parse_rate_headers(None, None, Some(v)).remaining;
        for bad in [
            "1200",
            "",
            "   ",
            ",",
            "1200,",
            ",5400",
            "a,b",
            "1200,5400,9",
            "-1,5",
            "1.5,2",
        ] {
            assert_eq!(remaining(bad), None, "{bad:?}");
        }
    }

    fn at(rfc3339: &str) -> chrono::DateTime<chrono::Utc> {
        chrono::DateTime::parse_from_rfc3339(rfc3339)
            .unwrap()
            .with_timezone(&chrono::Utc)
    }

    fn retry_after(secs: u64) -> RateBudget {
        RateBudget {
            retry_after_secs: Some(secs),
            ..RateBudget::default()
        }
    }

    #[test]
    fn a_short_empty_refusal_from_the_edge_is_a_burst() {
        assert_eq!(
            classify_refusal(&retry_after(1), None, b"", 1),
            Refusal::EdgeBurst
        );
        assert_eq!(
            classify_refusal(&retry_after(5), None, b"", 1),
            Refusal::EdgeBurst
        );
    }

    #[test]
    fn a_refusal_through_the_application_is_its_quota() {
        assert_eq!(
            classify_refusal(&retry_after(370), Some("1.1 Caddy"), b"", 1),
            Refusal::AppQuota
        );
        assert_eq!(
            classify_refusal(&retry_after(1), Some("1.1 Caddy"), b"", 1),
            Refusal::AppQuota
        );
        assert_eq!(
            classify_refusal(&retry_after(6), None, b"", 1),
            Refusal::AppQuota
        );
        assert_eq!(
            classify_refusal(&RateBudget::default(), None, b"", 1),
            Refusal::AppQuota
        );
        assert_eq!(
            classify_refusal(&retry_after(1), None, b"{\"error\":\"quota\"}", 1),
            Refusal::AppQuota
        );
        let with_pair = RateBudget {
            remaining: Some(RateWindows {
                fifteen_minutes: 0,
                daily: 10,
            }),
            ..retry_after(1)
        };
        assert_eq!(
            classify_refusal(&with_pair, None, b"", 1),
            Refusal::AppQuota
        );
    }

    #[test]
    fn a_second_refusal_in_a_row_is_the_quota_whatever_it_carries() {
        assert_eq!(
            classify_refusal(&retry_after(1), None, b"", 2),
            Refusal::AppQuota
        );
        assert_eq!(
            classify_refusal(&retry_after(1), None, b"", 7),
            Refusal::AppQuota
        );
    }

    fn remaining(fifteen_minutes: u64, daily: u64) -> RateBudget {
        RateBudget {
            remaining: Some(RateWindows {
                fifteen_minutes,
                daily,
            }),
            ..RateBudget::default()
        }
    }

    #[test]
    fn an_absent_or_healthy_budget_holds_nothing() {
        let now = at("2026-03-04T10:00:00Z");
        assert_eq!(budget_hold_until(&RateBudget::default(), now), None);
        assert_eq!(budget_hold_until(&retry_after(370), now), None);
        assert_eq!(budget_hold_until(&remaining(2_000, 5_400), now), None);
        // Exactly a quarter left is not below a quarter.
        assert_eq!(budget_hold_until(&remaining(625, 2_000), now), None);
    }

    #[test]
    fn a_low_daily_figure_holds_the_backfill_until_midnight_utc() {
        let now = at("2026-03-04T22:15:00Z");
        assert_eq!(
            budget_hold_until(&remaining(2_000, 1_999), now),
            Some(at("2026-03-05T00:00:00Z"))
        );
        assert_eq!(
            budget_hold_until(&remaining(2_000, 0), at("2026-03-04T00:00:00Z")),
            Some(at("2026-03-05T00:00:00Z"))
        );
    }

    #[test]
    fn a_low_fifteen_minute_figure_holds_the_backfill_for_the_window() {
        let now = at("2026-03-04T10:00:00Z");
        assert_eq!(
            budget_hold_until(&remaining(624, 5_400), now),
            Some(at("2026-03-04T10:15:00Z"))
        );
        // Both low: the later of the two.
        assert_eq!(
            budget_hold_until(&remaining(0, 0), now),
            Some(at("2026-03-05T00:00:00Z"))
        );
    }

    #[test]
    fn the_reported_limit_is_the_denominator_when_it_arrives() {
        let now = at("2026-03-04T10:00:00Z");
        let budget = RateBudget {
            limit: Some(RateWindows {
                fifteen_minutes: 100,
                daily: 400,
            }),
            ..remaining(30, 120)
        };
        assert_eq!(budget_hold_until(&budget, now), None);
        let low = RateBudget {
            limit: budget.limit,
            ..remaining(24, 120)
        };
        assert_eq!(
            budget_hold_until(&low, now),
            Some(at("2026-03-04T10:15:00Z"))
        );
        // A zero limit says nothing usable, so it holds nothing rather than dividing by it.
        let zero = RateBudget {
            limit: Some(RateWindows {
                fifteen_minutes: 0,
                daily: 0,
            }),
            ..remaining(0, 0)
        };
        assert_eq!(budget_hold_until(&zero, now), None);
    }

    #[test]
    fn the_governor_counts_refusals_in_a_row_and_a_success_ends_the_run() {
        let gov = Governor::new(1000, Box::new(NoopPolicy));
        let now = at("2026-03-04T10:00:00Z");
        assert_eq!(
            gov.note_refusal(&retry_after(1), None, b"", now),
            (Refusal::EdgeBurst, 1)
        );
        assert_eq!(
            gov.backfill_hold_until(now),
            None,
            "an edge burst holds nothing"
        );
        assert_eq!(
            gov.note_refusal(&retry_after(1), None, b"", now),
            (Refusal::AppQuota, 2)
        );
        gov.note_success(&RateBudget::default(), now);
        assert_eq!(
            gov.note_refusal(&retry_after(1), None, b"", now),
            (Refusal::EdgeBurst, 1)
        );
    }

    #[test]
    fn an_app_quota_refusal_holds_the_backfill_for_its_full_retry_after() {
        let gov = Governor::new(1000, Box::new(NoopPolicy));
        let now = at("2026-03-04T10:00:00Z");
        let (kind, _) = gov.note_refusal(&retry_after(600), Some("1.1 Caddy"), b"", now);
        assert_eq!(kind, Refusal::AppQuota);
        assert_eq!(
            gov.backfill_hold_until(now),
            Some(at("2026-03-04T10:10:00Z"))
        );
        // A healthy success does not lift it, and it lapses on its own.
        gov.note_success(&remaining(2_000, 6_000), now);
        assert_eq!(
            gov.backfill_hold_until(now),
            Some(at("2026-03-04T10:10:00Z"))
        );
        assert_eq!(gov.backfill_hold_until(at("2026-03-04T10:10:00Z")), None);
    }

    #[test]
    fn a_low_figure_on_a_success_holds_the_backfill() {
        let gov = Governor::new(1000, Box::new(NoopPolicy));
        let now = at("2026-03-04T22:00:00Z");
        gov.note_success(&remaining(2_000, 100), now);
        assert_eq!(
            gov.backfill_hold_until(now),
            Some(at("2026-03-05T00:00:00Z"))
        );
        // A shorter hold arriving later does not shorten it.
        gov.note_refusal(&retry_after(60), Some("1.1 Caddy"), b"", now);
        assert_eq!(
            gov.backfill_hold_until(now),
            Some(at("2026-03-05T00:00:00Z"))
        );
    }

    #[test]
    fn paces_concurrent_acquires_under_target_rate() {
        let _clock = crate::test_globals::real_clock();
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
        let _clock = crate::test_globals::real_clock();
        struct FixedPace(Duration);
        impl Policy for FixedPace {
            fn pace(&self, _lane: Lane) -> Duration {
                self.0
            }
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
    /// behind the schedule however long it already is, and never parks for it
    /// to drain.
    #[test]
    fn interactive_never_yields() {
        let _clock = crate::test_globals::real_clock();
        crate::runtime::block_on(async {
            let gov = Governor::new(8, Box::new(YieldBackfillPolicy::new()));
            // Eight claims polled once each put the next free slot about a
            // second out, with none of them waited on.
            let mut cx = std::task::Context::from_waker(std::task::Waker::noop());
            let mut claims: Vec<_> = (0..8)
                .map(|_| Box::pin(gov.acquire(Lane::Interactive)))
                .collect();
            for claim in &mut claims {
                let _ = claim.as_mut().poll(&mut cx);
            }
            gov.acquire(Lane::Interactive).await;
            assert_eq!(gov.yields(), 0, "interactive parked for the queue to drain");
        });
    }

    /// Expected behaviour: a backfill request behind a long queue parks until
    /// the queue has drained, rather than taking the slot at the back of it.
    #[test]
    fn backfill_parks_behind_a_busy_schedule() {
        let _clock = crate::test_globals::real_clock();
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
        let _clock = crate::test_globals::real_clock();
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
        let _clock = crate::test_globals::real_clock();
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

    // A budget figure holds the backfill through the governor's hold, never
    // through the queue limit, so there is one queue limit for the backfill
    // lane and none for interactive work, whatever has been seen.
    #[test]
    fn the_backfill_limit_is_one_value_and_interactive_never_waits() {
        let policy = YieldBackfillPolicy::new();
        assert_eq!(
            policy.max_queue_ahead(Lane::Backfill),
            Some(BACKFILL_MAX_QUEUE_AHEAD)
        );
        assert_eq!(policy.max_queue_ahead(Lane::Interactive), None);
        assert_eq!(policy.pace(Lane::Backfill), Duration::ZERO);
        assert_eq!(policy.pace(Lane::Interactive), Duration::ZERO);
    }
}
