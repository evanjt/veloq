//! Networking governor: the single choke point all outbound intervals.icu
//! requests pass through.
//!
//! This module owns the transport-agnostic *policy* seams - retry backoff,
//! `Authorization` header formatting, the rate headers a response carries and
//! what a 429 was. They are pure functions so they can be unit-tested without a
//! network. Priority lanes are layered on top through `Policy`.
//!
//! It also owns the one answer to whether a request may go now: the [`Budget`]
//! every install draws on its share of the limits all of the app's users share,
//! and the cooldown after a refusal.

use std::collections::VecDeque;
use std::sync::Arc;
use std::sync::LazyLock;
use std::time::{Duration, Instant};

use chrono::{DateTime, NaiveDate, TimeDelta, Utc};

/// Upper bound on any exponential-backoff wait.
const MAX_BACKOFF: Duration = Duration::from_secs(8);

/// Upper bound on how long a `Retry-After` is waited out inline. A budgeted
/// governor only ever retries inline on an edge burst, whose `Retry-After` is
/// five seconds or less; anything longer sets the cooldown instead, which
/// sends nothing until it lapses rather than holding a request open.
const MAX_RETRY_AFTER: Duration = Duration::from_secs(120);

/// The least time between two Garmin requests. Garmin publishes no limit, and
/// a burst of about six back-to-back Personal API requests has been refused
/// where twelve spaced two seconds apart all passed.
pub const GARMIN_MIN_GAP: Duration = Duration::from_secs(2);

/// How long a Garmin refusal that names no `Retry-After` holds the lane the
/// first time. Each refusal in a row doubles it.
const GARMIN_HOLD_START: Duration = Duration::from_secs(15 * 60);

/// The longest the Garmin lane is held, whatever a `Retry-After` or the
/// doubling asks for.
pub(crate) const GARMIN_HOLD_MAX: Duration = Duration::from_secs(6 * 60 * 60);

/// When a Garmin request after one dispatched at `last` may go, at `now`.
pub(crate) fn garmin_slot(last: Option<Instant>, now: Instant, gap: Duration) -> Instant {
    last.map_or(now, |last| now.max(last + gap))
}

/// How long the Garmin lane is held after its `refusals`-th refusal in a row
/// (1-based): the `Retry-After` in full when Garmin sent one, otherwise
/// fifteen minutes doubling.
pub(crate) fn garmin_hold(refusals: u32, retry_after_secs: Option<u64>) -> Duration {
    let wait = match retry_after_secs {
        Some(secs) => Duration::from_secs(secs),
        None => GARMIN_HOLD_START.saturating_mul(1u32 << refusals.saturating_sub(1).min(16)),
    };
    wait.min(GARMIN_HOLD_MAX)
}

/// What the Garmin lane has done since the process started.
#[derive(Default)]
struct GarminLane {
    /// When the last request was scheduled to go.
    last: Option<Instant>,
    /// Nothing is sent in the lane before this.
    hold_until: Option<DateTime<Utc>>,
    /// Refusals since the last success.
    refusals: u32,
    /// Requests dispatched since the last refusal.
    requests: u64,
    /// Every slot handed out, for a test to read the spacing off.
    #[cfg(test)]
    slots: Vec<Instant>,
}

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
/// `jitter` is a draw in `[0, 1)` and adds up to the whole wait again on top,
/// so retries from many installs refused at the same moment spread out rather
/// than arriving together. It only ever lengthens the wait: a retry never goes
/// before the server asked.
pub fn decide_backoff(
    retry_after_secs: Option<u64>,
    attempt: u32,
    rate_limited: bool,
    jitter: f64,
) -> Duration {
    let wait = if let Some(secs) = retry_after_secs {
        Duration::from_secs(secs).min(MAX_RETRY_AFTER)
    } else {
        let base_ms: u64 = if rate_limited { 500 } else { 200 };
        let shift = attempt.min(4);
        Duration::from_millis(base_ms.saturating_mul(1u64 << shift)).min(MAX_BACKOFF)
    };
    wait + wait.mul_f64(unit(jitter))
}

/// A jitter draw held to `[0, 1]`, so a caller's bad value can neither shorten
/// a wait nor multiply it.
fn unit(jitter: f64) -> f64 {
    if jitter.is_finite() {
        jitter.clamp(0.0, 1.0)
    } else {
        0.0
    }
}

/// A draw in `[0, 1)` for jitter. Not cryptographic and not meant to be: it
/// only has to differ between installs and between calls. `RandomState` is
/// seeded per process from the operating system and every `new` moves its
/// keys, so hashing nothing yields a fresh value each call without a crate.
pub fn random_unit() -> f64 {
    use std::hash::{BuildHasher, Hasher};
    let bits = std::collections::hash_map::RandomState::new()
        .build_hasher()
        .finish();
    (bits >> 11) as f64 / (1u64 << 53) as f64
}

/// How a request authenticates to intervals.icu.
pub enum AuthMethod<'a> {
    /// OAuth bearer token.
    Bearer(&'a str),
    /// Personal API key, sent as HTTP Basic `API_KEY:<key>`.
    ApiKey(&'a str),
    /// A Garmin Personal key, sent as `ApiKey <key>` to exchange it for a
    /// token.
    GarminKey(&'a str),
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
        AuthMethod::GarminKey(key) => format!("ApiKey {}", key),
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

/// What a request is for, which decides whether the shared budget lets it go.
///
/// It is stated by the caller and is independent of the [`Lane`], which only
/// paces: the upload read-back that gates deleting a recording is paced as
/// backfill and is still work a user is waiting on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Intent {
    /// A user is waiting on it: a tapped screen, a window a scroll or the
    /// range slider asks for, an upload and its read-back, push enrichment,
    /// a credential check. Always admitted and always counted, but for the
    /// probe a cooldown allows.
    User,
    /// The sync's own small requests: the profile slice, the census, the
    /// calendar, the newest five and the window at the head of the feed. A
    /// small allowance, and nothing at all under a cooldown.
    Sync,
    /// Work nobody is waiting on: the interval sweep, curves, elevation,
    /// streams, time streams, record restore and the history behind the
    /// newest window. Draws on the install's own share of the shared limits.
    Backfill,
}

/// How a request asks for a slot: the lane it is paced in and what it is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Dispatch {
    pub lane: Lane,
    pub intent: Intent,
}

impl Dispatch {
    pub const fn new(lane: Lane, intent: Intent) -> Self {
        Self { lane, intent }
    }
}

/// A lane alone states the intent it has always meant: interactive work is a
/// user waiting, backfill is backfill. A caller whose purpose differs from its
/// pacing says so with [`Dispatch::new`].
impl From<Lane> for Dispatch {
    fn from(lane: Lane) -> Self {
        let intent = match lane {
            Lane::Interactive => Intent::User,
            Lane::Backfill | Lane::Garmin => Intent::Backfill,
        };
        Self { lane, intent }
    }
}

/// The budget's answer to a request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Admission {
    /// Send it.
    Admitted,
    /// Send it as the one request a cooldown lets through to ask whether the
    /// refusal has lifted. It is never retried inline, and a refusal of it
    /// holds everything until the daily reset.
    Probe,
    /// Send nothing before `until`. Not a failure: the work is still owed.
    Deferred { until: DateTime<Utc> },
}

/// What a refusal leaves the request that drew it to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AfterRefusal {
    /// An edge burst: wait its short `Retry-After` and send again.
    RetryInline,
    /// The cooldown holds until `until`. Nothing more is sent for it.
    Cooldown { until: DateTime<Utc> },
}

/// One intent's share: how many requests in any rolling fifteen minutes, and
/// how many in a budget day.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Allowance {
    pub per_fifteen_minutes: u32,
    pub per_day: Option<u32>,
}

/// The backfill's steady share for one install: 1,000 in a budget day, drawn
/// no faster than 100 in any fifteen minutes.
///
/// The day figure is the install's agreed share of the application's daily
/// limit. The window figure is the day's share spread over the budget day: at
/// 100 a window the day's 650 would take about an hour and a half of
/// uninterrupted drawing, so the day figure is what stops the backfill and a
/// single window never spends it all at once. The first pass of an install
/// also draws [`BACKFILL_BURST`], once, before this applies.
pub const BACKFILL_ALLOWANCE: Allowance = Allowance {
    per_fifteen_minutes: 100,
    per_day: Some(1_000),
};

/// The one-time burst an install spends on top of its steady share: this many
/// requests, drawn from the moment its first backfill pass arms it, so the
/// recent activities rebuild at once. It lasts until spent rather than for a
/// window, so an athlete who closes the app leaves the rest for the next quiet
/// moment. It is counted apart from the day's count and from the window, and
/// it never arms again.
pub const BACKFILL_BURST: u32 = 500;

/// The whole days an allowance's daily cap takes to draw `owed` requests, when
/// that is more than one day. `None` when the queue fits in one day, or when
/// the allowance has no daily cap to count against.
pub fn days_to_draw(owed: u64, allowance: Allowance) -> Option<u32> {
    let per_day = u64::from(allowance.per_day?);
    if per_day == 0 || owed <= per_day {
        return None;
    }
    Some(u32::try_from(owed.div_ceil(per_day)).unwrap_or(u32::MAX))
}

/// The sync's share: a full pass asks about twenty, so fifty in any fifteen
/// minutes lets two run back to back and stops a loop.
pub const SYNC_ALLOWANCE: Allowance = Allowance {
    per_fifteen_minutes: 50,
    per_day: None,
};

/// How often a cooldown lets one user request through to probe it.
const PROBE_INTERVAL: TimeDelta = TimeDelta::minutes(5);

/// The cooldown a refusal sets when its `Retry-After` asks for less, by how
/// many cooldowns have run since the last success.
const COOLDOWN_LADDER: [TimeDelta; 4] = [
    TimeDelta::minutes(1),
    TimeDelta::minutes(5),
    TimeDelta::minutes(15),
    TimeDelta::minutes(60),
];

/// Up to a quarter more on top of a cooldown, so installs refused together do
/// not all come back at the same second.
const COOLDOWN_JITTER: f64 = 0.25;

/// Header-less refusals in a row that read as the day's quota being spent.
const HEADERLESS_REFUSALS_TO_THE_RESET: u32 = 2;

/// The widest per-install offset on the daily reset, so every install does
/// not start its day at midnight UTC together.
const MAX_DAY_OFFSET_SECS: u32 = 30 * 60;

/// The longest a stored cooldown is believed past `now`, beside the next
/// reset. A clock changed while the app was closed must not hold it for days.
const STORED_COOLDOWN_CEILING: TimeDelta = TimeDelta::minutes(60);

/// The day's counts, per intent. Only the backfill's is drawn against.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct DayCounts {
    pub user: u32,
    pub sync: u32,
    pub backfill: u32,
}

/// What the budget keeps across a relaunch and between the processes that
/// open the library: the app, the Android workers and the iOS extension.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StoredBudget {
    pub cooldown_until: Option<DateTime<Utc>>,
    /// The budget day the count belongs to.
    pub day: NaiveDate,
    /// Backfill requests admitted on `day`.
    pub backfill_today: u32,
    /// This install's offset on the daily reset, in seconds.
    pub day_offset_secs: u32,
    /// Cooldowns since the last success, which is the ladder's rung.
    pub ladder_step: u32,
    /// When the one-time burst armed, or none while it has not.
    pub burst_armed_at: Option<DateTime<Utc>>,
    /// Burst requests admitted.
    pub burst_drawn: u32,
    /// Whether the burst is spent. It ends only by being drawn, never by time.
    pub burst_spent: bool,
}

/// Where the budget's state outlives the process. Read before every
/// decision, so a cooldown another process set is honoured here, and written
/// whenever the state it holds changes.
pub trait BudgetStore: Send + Sync {
    fn load(&self) -> Option<StoredBudget>;
    fn save(&self, stored: &StoredBudget);
}

/// The budget at a moment, as the Developer Dashboard shows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BudgetSnapshot {
    pub today: DayCounts,
    pub backfill_last_fifteen_minutes: u32,
    pub sync_last_fifteen_minutes: u32,
    pub backfill: Allowance,
    pub sync: Allowance,
    pub cooldown_until: Option<DateTime<Utc>>,
    pub next_reset: DateTime<Utc>,
}

/// The request budget as the Developer Dashboard shows it. Instants are
/// seconds since the epoch, the unit every other date on the surface uses.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FfiRequestBudget {
    pub user_today: u32,
    pub sync_today: u32,
    pub backfill_today: u32,
    pub backfill_per_day: Option<u32>,
    pub backfill_last_fifteen_minutes: u32,
    pub backfill_per_fifteen_minutes: u32,
    pub sync_last_fifteen_minutes: u32,
    pub sync_per_fifteen_minutes: u32,
    /// Until when a refusal's cooldown holds, or none.
    pub cooldown_until: Option<f64>,
    /// When this install's daily count next resets.
    pub next_reset: f64,
}

impl From<BudgetSnapshot> for FfiRequestBudget {
    fn from(seen: BudgetSnapshot) -> Self {
        let seconds = |at: DateTime<Utc>| at.timestamp() as f64;
        Self {
            user_today: seen.today.user,
            sync_today: seen.today.sync,
            backfill_today: seen.today.backfill,
            backfill_per_day: seen.backfill.per_day,
            backfill_last_fifteen_minutes: seen.backfill_last_fifteen_minutes,
            backfill_per_fifteen_minutes: seen.backfill.per_fifteen_minutes,
            sync_last_fifteen_minutes: seen.sync_last_fifteen_minutes,
            sync_per_fifteen_minutes: seen.sync.per_fifteen_minutes,
            cooldown_until: seen.cooldown_until.map(seconds),
            next_reset: seconds(seen.next_reset),
        }
    }
}

/// What the backfill has drawn of its daily allowance, as the sync settings
/// show it. Instants are epoch milliseconds, the unit the background jobs read
/// uses.
#[derive(Debug, Clone, Copy, PartialEq, uniffi::Record)]
pub struct FfiDailyLimit {
    /// Requests the backfill has drawn in this budget day.
    pub used: u32,
    /// The backfill's requests for a budget day.
    pub per_day: u32,
    /// When this install's daily count next resets.
    pub resets_at_ms: f64,
}

impl FfiDailyLimit {
    /// The day's figure from a budget snapshot, or `None` when the backfill has
    /// no daily cap to draw against.
    pub fn from_snapshot(seen: &BudgetSnapshot) -> Option<Self> {
        Some(Self {
            used: seen.today.backfill,
            per_day: seen.backfill.per_day?,
            resets_at_ms: seen.next_reset.timestamp_millis() as f64,
        })
    }
}

/// The backfill's daily figure from the process governor, or `None` where it
/// only paces.
pub fn daily_limit() -> Option<FfiDailyLimit> {
    GOVERNOR
        .budget_snapshot(GOVERNOR.now())
        .and_then(|seen| FfiDailyLimit::from_snapshot(&seen))
}

/// The process governor's budget for the dashboard, or `None` where it only
/// paces.
pub fn request_budget() -> Option<FfiRequestBudget> {
    GOVERNOR.budget_snapshot(GOVERNOR.now()).map(Into::into)
}

/// One install's share of the limits every user of the app shares, and the
/// cooldown after a refusal. The one owner of whether a request may go now.
///
/// Every decision takes `now` and every random draw is handed in, so the
/// whole of it is tested without a clock.
///
/// The OAuth proxy spends the same shared budget, on the token exchange and
/// the athlete lookup at sign-in, and the device cannot see those calls. They
/// sit outside this count, which is part of why the backfill's share leaves a
/// baseline unspent.
#[derive(Debug, Clone)]
pub struct Budget {
    backfill_allowance: Allowance,
    sync_allowance: Allowance,
    day_offset: TimeDelta,
    day: Option<NaiveDate>,
    today: DayCounts,
    backfill_recent: VecDeque<DateTime<Utc>>,
    sync_recent: VecDeque<DateTime<Utc>>,
    cooldown_until: Option<DateTime<Utc>>,
    ladder_step: u32,
    refusals_in_a_row: u32,
    headerless_in_a_row: u32,
    last_probe_at: Option<DateTime<Utc>>,
    /// Until when a low budget figure on a response holds the backfill.
    low_figure_until: Option<DateTime<Utc>>,
    burst_armed_at: Option<DateTime<Utc>>,
    burst_drawn: u32,
    burst_spent: bool,
}

impl Budget {
    /// The shipped allowances, with the daily reset `day_offset_secs` after
    /// midnight UTC, held to thirty minutes.
    pub fn new(day_offset_secs: u32) -> Self {
        Self::with_allowances(BACKFILL_ALLOWANCE, SYNC_ALLOWANCE, day_offset_secs)
    }

    pub fn with_allowances(backfill: Allowance, sync: Allowance, day_offset_secs: u32) -> Self {
        Self {
            backfill_allowance: backfill,
            sync_allowance: sync,
            day_offset: day_offset(day_offset_secs),
            day: None,
            today: DayCounts::default(),
            backfill_recent: VecDeque::new(),
            sync_recent: VecDeque::new(),
            cooldown_until: None,
            ladder_step: 0,
            refusals_in_a_row: 0,
            headerless_in_a_row: 0,
            last_probe_at: None,
            low_figure_until: None,
            burst_armed_at: None,
            burst_drawn: 0,
            burst_spent: false,
        }
    }

    /// Whether the burst is spent, drawn to its figure. It has no window, so an
    /// armed burst waits for the next quiet moment rather than lapsing. Once
    /// true it stays true.
    fn burst_over(&self) -> bool {
        self.burst_spent || self.burst_drawn >= BACKFILL_BURST
    }

    /// Whether the burst is drawing: armed and not spent.
    fn burst_open(&self) -> bool {
        self.burst_armed_at.is_some() && !self.burst_over()
    }

    /// Start the one-time burst when a backfill pass starts. It arms once per
    /// install: a burst already armed, or over, is left as it is.
    pub fn arm_burst(&mut self, now: DateTime<Utc>) {
        self.roll(now);
        if self.burst_armed_at.is_none() && !self.burst_spent {
            self.burst_armed_at = Some(now);
        }
    }

    /// The budget day `now` falls in: the UTC date, starting at this install's
    /// offset past midnight.
    fn budget_day(&self, now: DateTime<Utc>) -> NaiveDate {
        (now - self.day_offset).date_naive()
    }

    /// When the budget day `now` falls in ends and the daily count resets.
    pub fn next_reset(&self, now: DateTime<Utc>) -> DateTime<Utc> {
        start_of(self.budget_day(now).succ_opt().unwrap_or(NaiveDate::MAX)) + self.day_offset
    }

    /// The next midnight UTC after `now`, plus this install's offset.
    fn next_midnight(&self, now: DateTime<Utc>) -> DateTime<Utc> {
        start_of(now.date_naive().succ_opt().unwrap_or(NaiveDate::MAX)) + self.day_offset
    }

    /// Start a new day's counts when `now` has moved into one, and forget the
    /// fifteen-minute entries that have left the window.
    fn roll(&mut self, now: DateTime<Utc>) {
        let day = self.budget_day(now);
        if self.day != Some(day) {
            self.day = Some(day);
            self.today = DayCounts::default();
        }
        self.burst_spent = self.burst_over();
        let horizon = now - FIFTEEN_MINUTES;
        for recent in [&mut self.backfill_recent, &mut self.sync_recent] {
            // A clock moved back leaves entries ahead of now. They are kept,
            // which only ever defers, and leave once their fifteen minutes
            // have passed by the new clock.
            while recent.front().is_some_and(|at| *at <= horizon) {
                recent.pop_front();
            }
        }
    }

    /// Until when a request for `intent` would be deferred at `now`, without
    /// counting or sending anything. `None` when it would go. A user request is
    /// never deferred here, since inside a cooldown it may go as the probe.
    pub fn deferred_until(&mut self, intent: Intent, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
        self.roll(now);
        if let Some(until) = self.cooldown_until.filter(|until| *until > now) {
            return (intent != Intent::User).then_some(until);
        }
        match intent {
            Intent::User => None,
            Intent::Sync => window_full(&self.sync_recent, self.sync_allowance),
            Intent::Backfill => self.backfill_held_until(now),
        }
    }

    /// Until when the backfill's own share holds it at `now`: a low budget
    /// figure, then, once the burst is over, the day's count or a full
    /// fifteen-minute window.
    fn backfill_held_until(&self, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
        let low_figure = self.low_figure_until.filter(|until| *until > now);
        if self.burst_open() {
            return low_figure;
        }
        [
            low_figure,
            self.backfill_allowance
                .per_day
                .filter(|per_day| self.today.backfill >= *per_day)
                .map(|_| self.next_reset(now)),
            window_full(&self.backfill_recent, self.backfill_allowance),
        ]
        .into_iter()
        .flatten()
        .max()
    }

    /// Whether a request for `intent` may go at `now`. An admission is
    /// counted; a deferral sends nothing and counts nothing.
    pub fn admit(&mut self, intent: Intent, now: DateTime<Utc>) -> Admission {
        self.roll(now);
        if let Some(until) = self.cooldown_until.filter(|until| *until > now) {
            return match intent {
                Intent::User => match self.last_probe_at {
                    Some(last) if now < last + PROBE_INTERVAL => Admission::Deferred {
                        until: (last + PROBE_INTERVAL).min(until),
                    },
                    _ => {
                        self.last_probe_at = Some(now);
                        self.today.user = self.today.user.saturating_add(1);
                        Admission::Probe
                    }
                },
                Intent::Sync | Intent::Backfill => Admission::Deferred { until },
            };
        }
        match intent {
            Intent::User => {
                self.today.user = self.today.user.saturating_add(1);
                Admission::Admitted
            }
            Intent::Sync => {
                if let Some(until) = window_full(&self.sync_recent, self.sync_allowance) {
                    return Admission::Deferred { until };
                }
                self.sync_recent.push_back(now);
                self.today.sync = self.today.sync.saturating_add(1);
                Admission::Admitted
            }
            Intent::Backfill => {
                if let Some(until) = self.backfill_held_until(now) {
                    return Admission::Deferred { until };
                }
                if self.burst_open() {
                    self.burst_drawn = self.burst_drawn.saturating_add(1);
                    self.burst_spent = self.burst_over();
                    return Admission::Admitted;
                }
                self.backfill_recent.push_back(now);
                self.today.backfill = self.today.backfill.saturating_add(1);
                Admission::Admitted
            }
        }
    }

    /// Record a 429 and say what the request that drew it does next.
    ///
    /// The first refusal in a row that is an edge burst, a `Retry-After` of
    /// five seconds or less from the edge, is retried inline. Anything else
    /// sets the cooldown: to the larger of its `Retry-After` in full and the
    /// ladder's rung, with up to a quarter more by `jitter`, a draw in
    /// `[0, 1)`. A second header-less refusal in a row, or a refused probe,
    /// says the day's quota is spent, and holds until the next reset.
    pub fn refused(
        &mut self,
        rate: &RateBudget,
        via: Option<&str>,
        body: &[u8],
        probe: bool,
        now: DateTime<Utc>,
        jitter: f64,
    ) -> AfterRefusal {
        self.roll(now);
        self.refusals_in_a_row = self.refusals_in_a_row.saturating_add(1);
        if rate.retry_after_secs.is_none() {
            self.headerless_in_a_row = self.headerless_in_a_row.saturating_add(1);
        }
        self.hold_on_low_figure(rate, now);
        let refusal = classify_refusal(rate, via, body, self.refusals_in_a_row);
        if refusal == Refusal::EdgeBurst && !probe {
            return AfterRefusal::RetryInline;
        }
        let until = if probe || self.headerless_in_a_row >= HEADERLESS_REFUSALS_TO_THE_RESET {
            self.next_midnight(now)
        } else {
            let rung = COOLDOWN_LADDER[(self.ladder_step as usize).min(COOLDOWN_LADDER.len() - 1)];
            let asked = rate
                .retry_after_secs
                .and_then(|secs| TimeDelta::try_seconds(i64::try_from(secs).ok()?))
                .unwrap_or(TimeDelta::zero());
            let wait = asked.max(rung);
            let extra = wait
                .to_std()
                .ok()
                .map(|w| w.mul_f64(COOLDOWN_JITTER * unit(jitter)))
                .and_then(|extra| TimeDelta::from_std(extra).ok())
                .unwrap_or(TimeDelta::zero());
            now.checked_add_signed(wait + extra)
                .unwrap_or(DateTime::<Utc>::MAX_UTC)
        };
        self.ladder_step = self.ladder_step.saturating_add(1);
        let until = self
            .cooldown_until
            .map_or(until, |current| current.max(until));
        self.cooldown_until = Some(until);
        AfterRefusal::Cooldown { until }
    }

    /// Record a success: the cooldown, its ladder and the run of refusals all
    /// end. A low budget figure on it still holds the backfill. Returns
    /// whether it ended a cooldown that still held.
    pub fn succeeded(&mut self, rate: &RateBudget, now: DateTime<Utc>) -> bool {
        let ended = self.cooldown_until(now).is_some();
        self.refusals_in_a_row = 0;
        self.headerless_in_a_row = 0;
        self.ladder_step = 0;
        self.cooldown_until = None;
        self.last_probe_at = None;
        self.hold_on_low_figure(rate, now);
        ended
    }

    /// A low remaining figure holds the backfill: below a quarter of the day
    /// until the next midnight, below a quarter of the window for the window.
    /// A hold only lengthens; it lapses when its time passes.
    fn hold_on_low_figure(&mut self, rate: &RateBudget, now: DateTime<Utc>) {
        if let Some(until) = budget_hold_until(rate, now) {
            self.low_figure_until = Some(self.low_figure_until.map_or(until, |c| c.max(until)));
        }
    }

    /// Until when a cooldown holds, or `None` when none does at `now`.
    pub fn cooldown_until(&self, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
        self.cooldown_until.filter(|until| *until > now)
    }

    /// What outlives the process.
    pub fn stored(&self, now: DateTime<Utc>) -> StoredBudget {
        let day = self.budget_day(now);
        StoredBudget {
            cooldown_until: self.cooldown_until(now),
            day,
            backfill_today: if self.day == Some(day) {
                self.today.backfill
            } else {
                0
            },
            day_offset_secs: u32::try_from(self.day_offset.num_seconds()).unwrap_or(0),
            ladder_step: self.ladder_step,
            burst_armed_at: self.burst_armed_at,
            burst_drawn: self.burst_drawn,
            burst_spent: self.burst_over(),
        }
    }

    /// Take in what another process or an earlier launch left, as of `now`.
    ///
    /// The stored install offset replaces this one, so every process starts
    /// the day at the same moment. A stored cooldown is believed no further
    /// than an hour past `now` or half an hour past the next midnight UTC,
    /// whichever is later, since a clock moved while the app was closed could
    /// otherwise hold it for days; it only ever lengthens the cooldown held
    /// here. The day's count is taken when it is for the day `now` falls in.
    pub fn adopt(&mut self, stored: &StoredBudget, now: DateTime<Utc>) {
        if stored.day_offset_secs <= MAX_DAY_OFFSET_SECS {
            self.day_offset = day_offset(stored.day_offset_secs);
        }
        self.roll(now);
        if let Some(until) = stored.cooldown_until {
            let midnight = start_of(now.date_naive().succ_opt().unwrap_or(NaiveDate::MAX));
            let ceiling = (now + STORED_COOLDOWN_CEILING).max(midnight + TimeDelta::minutes(30));
            let until = until.min(ceiling);
            if until > now {
                self.cooldown_until = Some(self.cooldown_until.map_or(until, |c| c.max(until)));
            }
        }
        if Some(stored.day) == self.day {
            self.today.backfill = self.today.backfill.max(stored.backfill_today);
        }
        self.ladder_step = self.ladder_step.max(stored.ladder_step);
        self.burst_armed_at = match (self.burst_armed_at, stored.burst_armed_at) {
            (Some(held), Some(kept)) => Some(held.min(kept)),
            (held, kept) => held.or(kept),
        };
        self.burst_drawn = self.burst_drawn.max(stored.burst_drawn);
        self.burst_spent |= stored.burst_spent;
        self.roll(now);
    }

    /// The counts, the cooldown and the next reset at `now`.
    pub fn snapshot(&mut self, now: DateTime<Utc>) -> BudgetSnapshot {
        self.roll(now);
        BudgetSnapshot {
            today: self.today,
            backfill_last_fifteen_minutes: u32::try_from(self.backfill_recent.len())
                .unwrap_or(u32::MAX),
            sync_last_fifteen_minutes: u32::try_from(self.sync_recent.len()).unwrap_or(u32::MAX),
            backfill: self.backfill_allowance,
            sync: self.sync_allowance,
            cooldown_until: self.cooldown_until(now),
            next_reset: self.next_reset(now),
        }
    }
}

/// When the oldest entry leaves a full window, or `None` while it has room.
fn window_full(recent: &VecDeque<DateTime<Utc>>, allowance: Allowance) -> Option<DateTime<Utc>> {
    let cap = allowance.per_fifteen_minutes as usize;
    if recent.len() < cap {
        return None;
    }
    // The entry whose leaving brings the window back under its cap.
    recent
        .get(recent.len() - cap)
        .map(|oldest| *oldest + FIFTEEN_MINUTES)
}

fn day_offset(secs: u32) -> TimeDelta {
    TimeDelta::seconds(i64::from(secs.min(MAX_DAY_OFFSET_SECS)))
}

fn start_of(day: NaiveDate) -> DateTime<Utc> {
    day.and_time(chrono::NaiveTime::MIN).and_utc()
}

/// A fresh install's offset on the daily reset, from a jitter draw.
pub fn day_offset_secs(jitter: f64) -> u32 {
    (unit(jitter) * f64::from(MAX_DAY_OFFSET_SECS)) as u32 % (MAX_DAY_OFFSET_SECS + 1)
}

/// Request priority lane.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lane {
    /// A user is waiting on this (a tapped screen, an upload).
    Interactive,
    /// Opportunistic history backfill - yields to interactive work.
    Backfill,
    /// Requests to Garmin. Paced on the shared schedule and yielding to
    /// interactive work like backfill, but a lane of its own so a Garmin pass
    /// is told apart from an intervals.icu one.
    Garmin,
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
            Lane::Backfill | Lane::Garmin => Some(BACKFILL_MAX_QUEUE_AHEAD),
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
///
/// A governor built with [`Governor::with_budget`] also asks its [`Budget`]
/// whether each request may go at all. One built with [`Governor::new`] alone
/// only paces, which is what a test of the pacing wants.
pub struct Governor {
    min_interval: Duration,
    next_at: std::sync::Mutex<Option<Instant>>,
    policy: Box<dyn Policy>,
    /// Acquires that actually parked waiting for a higher lane to drain. The
    /// yield is otherwise only visible as elapsed time, which reads as load
    /// rather than as policy.
    yields: std::sync::atomic::AtomicU64,
    budget: Option<std::sync::Mutex<Budget>>,
    store: Option<Arc<dyn BudgetStore>>,
    /// The Garmin lane's own gap and hold. Garmin traffic draws on none of the
    /// intervals.icu budget, and its refusals hold none of it.
    garmin: std::sync::Mutex<GarminLane>,
    garmin_gap: Duration,
    /// The source of every jitter draw. Zero unless a budget is installed, so
    /// a pacing-only governor waits exactly what it is asked to.
    jitter: fn() -> f64,
    /// The source of every instant the budget is asked or told about.
    clock: fn() -> DateTime<Utc>,
}

/// No jitter, for a governor whose waits a test reads back.
fn no_jitter() -> f64 {
    0.0
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
            budget: None,
            store: None,
            garmin: std::sync::Mutex::new(GarminLane::default()),
            garmin_gap: GARMIN_MIN_GAP,
            jitter: no_jitter,
            clock: Utc::now,
        }
    }

    /// Read every instant from `clock` rather than the wall clock, so a test
    /// can stand at a chosen time of day.
    pub fn with_clock(mut self, clock: fn() -> DateTime<Utc>) -> Self {
        self.clock = clock;
        self
    }

    /// The instant the budget is asked or told about now.
    pub fn now(&self) -> DateTime<Utc> {
        (self.clock)()
    }

    /// Ask `budget` before every request, keep its state in `store` when one
    /// is given, and draw jitter from `jitter`.
    pub fn with_budget(
        mut self,
        budget: Budget,
        store: Option<Arc<dyn BudgetStore>>,
        jitter: fn() -> f64,
    ) -> Self {
        self.budget = Some(std::sync::Mutex::new(budget));
        self.store = store;
        self.jitter = jitter;
        self
    }

    /// Space Garmin requests `gap` apart rather than [`GARMIN_MIN_GAP`].
    pub fn with_garmin_gap(mut self, gap: Duration) -> Self {
        self.garmin_gap = gap;
        self
    }

    fn garmin_state<R>(&self, f: impl FnOnce(&mut GarminLane) -> R) -> R {
        f(&mut self.garmin.lock().unwrap_or_else(|e| e.into_inner()))
    }

    /// Until when the Garmin lane is held at `now`, or `None`.
    pub fn garmin_deferred_until(&self, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
        self.garmin_state(|lane| lane.hold_until.filter(|until| *until > now))
    }

    /// Record a Garmin 429 and hold the lane: for its `Retry-After` when it
    /// sent one, otherwise fifteen minutes, doubling for each refusal in a
    /// row. The request count since the previous refusal is logged, so real
    /// runs measure the limit. Returns when the lane lifts.
    pub fn note_garmin_refusal(
        &self,
        retry_after_secs: Option<u64>,
        now: DateTime<Utc>,
    ) -> DateTime<Utc> {
        self.garmin_state(|lane| {
            lane.refusals = lane.refusals.saturating_add(1);
            let wait = garmin_hold(lane.refusals, retry_after_secs);
            let until = now + TimeDelta::from_std(wait).unwrap_or(TimeDelta::hours(6));
            let until = lane
                .hold_until
                .filter(|held| *held > until)
                .unwrap_or(until);
            lane.hold_until = Some(until);
            log::warn!(
                "veloqrs: [garmin] refused after {} requests since the last refusal \
                 (retry-after {}), holding the lane {}s",
                lane.requests,
                retry_after_secs.map_or_else(|| "none".to_string(), |s| format!("{s}s")),
                wait.as_secs()
            );
            lane.requests = 0;
            until
        })
    }

    /// A Garmin request was answered: the doubling starts over.
    pub fn note_garmin_success(&self) {
        self.garmin_state(|lane| lane.refusals = 0);
    }

    /// Garmin requests dispatched since the last refusal.
    pub fn garmin_requests(&self) -> u64 {
        self.garmin_state(|lane| lane.requests)
    }

    /// The instants Garmin requests were scheduled to go, in order.
    #[cfg(test)]
    pub(crate) fn garmin_slots(&self) -> Vec<Instant> {
        self.garmin_state(|lane| lane.slots.clone())
    }

    /// Claim the next Garmin slot and wait for it.
    async fn garmin_gap_wait(&self) {
        let slot = self.garmin_state(|lane| {
            let slot = garmin_slot(lane.last, Instant::now(), self.garmin_gap);
            lane.last = Some(slot);
            lane.requests += 1;
            #[cfg(test)]
            lane.slots.push(slot);
            slot
        });
        let now = Instant::now();
        if slot > now {
            pause(slot - now).await;
        }
    }

    /// A jitter draw in `[0, 1)`.
    pub fn jitter(&self) -> f64 {
        (self.jitter)()
    }

    /// Run `f` against the budget with the stored state taken in first, and
    /// write the state back when `f` changed it. `None` without a budget.
    fn with_budget_state<R>(
        &self,
        now: DateTime<Utc>,
        f: impl FnOnce(&mut Budget) -> R,
    ) -> Option<R> {
        let mut budget = self
            .budget
            .as_ref()?
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let loaded = self.store.as_ref().and_then(|store| store.load());
        if let Some(stored) = &loaded {
            budget.adopt(stored, now);
        }
        let result = f(&mut budget);
        let after = budget.stored(now);
        if let Some(store) = &self.store
            && loaded.as_ref() != Some(&after)
        {
            store.save(&after);
        }
        Some(result)
    }

    /// Whether a request for `intent` may go at `now`. A pacing-only governor
    /// admits everything.
    pub fn admit(&self, intent: Intent, now: DateTime<Utc>) -> Admission {
        self.with_budget_state(now, |budget| budget.admit(intent, now))
            .unwrap_or(Admission::Admitted)
    }

    /// Arm the one-time burst, as every process sees it. A pacing-only
    /// governor has none.
    pub fn arm_backfill_burst(&self, now: DateTime<Utc>) {
        self.with_budget_state(now, |budget| budget.arm_burst(now));
    }

    /// Record a 429 and say what the request that drew it does next. `probe`
    /// is whether the budget admitted it as a cooldown's probe.
    ///
    /// A pacing-only governor retries every refusal inline, up to the
    /// transport's own limit.
    pub fn note_refusal(
        &self,
        rate: &RateBudget,
        via: Option<&str>,
        body: &[u8],
        probe: bool,
        now: DateTime<Utc>,
    ) -> AfterRefusal {
        let jitter = self.jitter();
        self.with_budget_state(now, |budget| {
            budget.refused(rate, via, body, probe, now, jitter)
        })
        .unwrap_or(AfterRefusal::RetryInline)
    }

    /// Record a success, which ends any cooldown. Returns whether it ended
    /// one, so the work the cooldown held can resume at once.
    pub fn note_success(&self, rate: &RateBudget, now: DateTime<Utc>) -> bool {
        self.with_budget_state(now, |budget| budget.succeeded(rate, now))
            .unwrap_or(false)
    }

    /// Until when a refusal's cooldown holds at `now`, as every process sees
    /// it. `None` when none does, and always on a pacing-only governor.
    pub fn cooldown_until(&self, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
        self.with_budget_state(now, |budget| budget.cooldown_until(now))
            .flatten()
    }

    /// Until when a request for `intent` would be deferred at `now`, as every
    /// process sees it, counting nothing. `None` when it would go, and always
    /// on a pacing-only governor.
    pub fn deferred_until(&self, intent: Intent, now: DateTime<Utc>) -> Option<DateTime<Utc>> {
        self.with_budget_state(now, |budget| budget.deferred_until(intent, now))
            .flatten()
    }

    /// When work refused at `now` may be asked for again: the end of the
    /// cooldown, or the first rung of the cooldown ladder when none holds.
    pub fn refusal_lifts_at(&self, now: DateTime<Utc>) -> DateTime<Utc> {
        self.cooldown_until(now)
            .unwrap_or_else(|| now + COOLDOWN_LADDER[0])
    }

    /// The budget at `now`, or `None` on a pacing-only governor.
    pub fn budget_snapshot(&self, now: DateTime<Utc>) -> Option<BudgetSnapshot> {
        self.with_budget_state(now, |budget| budget.snapshot(now))
    }

    /// Ask the budget for a slot, then wait for the shared pace to allow it.
    /// A deferral returns at once and sends nothing. Never holds the
    /// scheduling lock across the await.
    ///
    /// A lane with a queue limit waits for the schedule to drain to that limit
    /// before it claims anything, so it holds no slot while it waits and a
    /// higher-priority request arriving meanwhile takes the slot ahead of it.
    pub async fn acquire(&self, dispatch: impl Into<Dispatch>) -> Admission {
        let Dispatch { lane, intent } = dispatch.into();
        let admission = if lane == Lane::Garmin {
            match self.garmin_deferred_until(self.now()) {
                Some(until) => Admission::Deferred { until },
                None => Admission::Admitted,
            }
        } else {
            self.admit(intent, self.now())
        };
        if matches!(admission, Admission::Deferred { .. }) {
            return admission;
        }
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
        if lane == Lane::Garmin {
            self.garmin_gap_wait().await;
        }
        admission
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
///
/// It carries the shipped budget, kept in the settings rows. The crate's own
/// tests share this one governor across every test in the process, so there
/// it only paces: a refusal one test provokes must not defer the next test's
/// requests. A test of the budget builds its own.
pub static GOVERNOR: LazyLock<Arc<Governor>> = LazyLock::new(|| {
    let governor = Governor::new(MAX_DISPATCH_PER_SEC, Box::new(YieldBackfillPolicy::new()));
    #[cfg(not(test))]
    let governor = governor.with_budget(
        Budget::new(day_offset_secs(random_unit())),
        Some(Arc::new(crate::persistence::settings::RequestBudgetRows)),
        random_unit,
    );
    Arc::new(governor)
});

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    /// Scenario: a stream queue is priced against a daily cap of 600 requests.
    ///
    /// Expected behaviour: a queue that fits in one day has no days to report,
    /// one more request than a day's cap is two days, and an allowance without
    /// a daily cap, or a zero cap, has no day to count in.
    #[test]
    fn a_queue_past_one_days_cap_reports_the_whole_days_it_takes() {
        let daily = Allowance {
            per_fifteen_minutes: 225,
            per_day: Some(600),
        };
        assert_eq!(days_to_draw(0, daily), None);
        assert_eq!(days_to_draw(1, daily), None);
        assert_eq!(days_to_draw(600, daily), None);
        assert_eq!(days_to_draw(601, daily), Some(2));
        assert_eq!(days_to_draw(1_200, daily), Some(2));
        assert_eq!(days_to_draw(1_201, daily), Some(3));

        let uncapped = Allowance {
            per_fifteen_minutes: 225,
            per_day: None,
        };
        assert_eq!(days_to_draw(10_000, uncapped), None);

        let zero = Allowance {
            per_fifteen_minutes: 225,
            per_day: Some(0),
        };
        assert_eq!(days_to_draw(10, zero), None);
    }

    /// Expected behaviour: the backfill's share is a thousand requests in a
    /// budget day, and a queue past it reports the whole days it takes.
    #[test]
    fn the_backfill_share_is_a_thousand_a_day() {
        assert_eq!(BACKFILL_ALLOWANCE.per_day, Some(1_000));
        assert_eq!(days_to_draw(1_000, BACKFILL_ALLOWANCE), None);
        assert_eq!(days_to_draw(1_001, BACKFILL_ALLOWANCE), Some(2));
        assert_eq!(days_to_draw(2_600, BACKFILL_ALLOWANCE), Some(3));
    }

    /// Expected behaviour: a thousand backfill requests are admitted in a
    /// budget day, windows permitting, and the next waits for the reset.
    #[test]
    fn a_thousand_backfill_requests_fit_a_budget_day() {
        let mut budget = Budget::new(0);
        let mut now = at("2026-03-04T00:00:00Z");
        for _ in 0..10 {
            admit_n(&mut budget, Intent::Backfill, 100, now);
            now += chrono::TimeDelta::minutes(16);
        }
        assert_eq!(
            budget.admit(Intent::Backfill, now),
            Admission::Deferred {
                until: at("2026-03-05T00:00:00Z")
            }
        );
    }

    #[test]
    fn retry_after_always_wins() {
        // Even on a 429 where the exponential base would be 1s, the server hint wins.
        assert_eq!(
            decide_backoff(Some(10), 1, true, 0.0),
            Duration::from_secs(10)
        );
        assert_eq!(
            decide_backoff(Some(3), 3, false, 0.0),
            Duration::from_secs(3)
        );
    }

    #[test]
    fn retry_after_is_capped() {
        // A pathological / pool-reset-sized hint is capped inline.
        assert_eq!(decide_backoff(Some(3600), 1, true, 0.0), MAX_RETRY_AFTER);
    }

    #[test]
    fn exponential_fallback_matches_prior_schedule() {
        // 429: 1s, 2s, 4s for attempts 1..3 (was 500ms * 2^n).
        assert_eq!(
            decide_backoff(None, 1, true, 0.0),
            Duration::from_millis(1000)
        );
        assert_eq!(
            decide_backoff(None, 2, true, 0.0),
            Duration::from_millis(2000)
        );
        assert_eq!(
            decide_backoff(None, 3, true, 0.0),
            Duration::from_millis(4000)
        );
        // transport: 400ms, 800ms, 1600ms (was 200ms * 2^n).
        assert_eq!(
            decide_backoff(None, 1, false, 0.0),
            Duration::from_millis(400)
        );
        assert_eq!(
            decide_backoff(None, 2, false, 0.0),
            Duration::from_millis(800)
        );
        assert_eq!(
            decide_backoff(None, 3, false, 0.0),
            Duration::from_millis(1600)
        );
    }

    #[test]
    fn backoff_is_capped() {
        assert_eq!(decide_backoff(None, 10, true, 0.0), MAX_BACKOFF);
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
        // A round trip through one crate cannot see that crate change its alphabet or padding.
        assert_eq!(header, "Basic QVBJX0tFWTpzZWNyZXQ=");
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
    fn jitter_only_ever_lengthens_a_backoff_and_at_most_doubles_it() {
        assert_eq!(
            decide_backoff(Some(1), 1, true, 0.5),
            Duration::from_millis(1500)
        );
        assert_eq!(
            decide_backoff(None, 1, false, 0.75),
            Duration::from_millis(700)
        );
        // A bad draw neither shortens nor multiplies the wait.
        assert_eq!(
            decide_backoff(Some(2), 1, true, -3.0),
            Duration::from_secs(2)
        );
        assert_eq!(
            decide_backoff(Some(2), 1, true, 7.0),
            Duration::from_secs(4)
        );
        assert_eq!(
            decide_backoff(Some(2), 1, true, f64::NAN),
            Duration::from_secs(2)
        );
        for _ in 0..100 {
            let draw = random_unit();
            assert!((0.0..1.0).contains(&draw), "{draw}");
        }
    }

    fn via_app(secs: u64) -> (RateBudget, Option<&'static str>) {
        (retry_after(secs), Some("1.1 Caddy"))
    }

    /// Admit `n` requests for `intent` at `now`, asserting each goes.
    fn admit_n(budget: &mut Budget, intent: Intent, n: u32, now: chrono::DateTime<chrono::Utc>) {
        for i in 0..n {
            assert_eq!(
                budget.admit(intent, now),
                Admission::Admitted,
                "request {i}"
            );
        }
    }

    #[test]
    fn budget_defers_backfill_past_its_15_minute_allowance() {
        let mut budget = Budget::new(0);
        let window = BACKFILL_ALLOWANCE.per_fifteen_minutes;
        let first = at("2026-03-04T10:00:00Z");
        assert_eq!(budget.admit(Intent::Backfill, first), Admission::Admitted);
        admit_n(
            &mut budget,
            Intent::Backfill,
            window - 1,
            at("2026-03-04T10:05:00Z"),
        );
        assert_eq!(
            budget.admit(Intent::Backfill, at("2026-03-04T10:06:00Z")),
            Admission::Deferred {
                until: at("2026-03-04T10:15:00Z")
            },
            "the one past the window waits for the oldest to leave it"
        );
        // A deferral counts nothing, so the window is unchanged by asking.
        assert_eq!(
            budget.snapshot(at("2026-03-04T10:06:00Z")).today.backfill,
            window
        );
        assert_eq!(
            budget.admit(Intent::Backfill, at("2026-03-04T10:15:00Z")),
            Admission::Admitted
        );
        assert_eq!(
            budget.admit(Intent::Backfill, at("2026-03-04T10:15:01Z")),
            Admission::Deferred {
                until: at("2026-03-04T10:20:00Z")
            }
        );
        // The backfill's share is its own: the sync and the user still go.
        assert_eq!(
            budget.admit(Intent::Sync, at("2026-03-04T10:15:01Z")),
            Admission::Admitted
        );
        assert_eq!(
            budget.admit(Intent::User, at("2026-03-04T10:15:01Z")),
            Admission::Admitted
        );
    }

    /// Scenario: a fresh install's first backfill pass over a library of about
    /// four hundred activities, one streams request a track, sent at the
    /// dispatch pace after the pass armed the burst.
    ///
    /// Expected behaviour: the burst admits all of it, then the steady share
    /// of 1,000 a day follows on top, held to its window.
    #[test]
    fn the_burst_admits_five_hundred_on_top_of_the_days_share() {
        let mut budget = Budget::new(0);
        let start = at("2026-03-04T10:00:00Z");
        let pace = chrono::TimeDelta::milliseconds(1_000 / i64::from(MAX_DISPATCH_PER_SEC));
        budget.arm_burst(start);
        for i in 0..BACKFILL_BURST {
            assert_eq!(
                budget.admit(Intent::Backfill, start + pace * i as i32),
                Admission::Admitted,
                "burst request {i}"
            );
        }
        let seen = budget.snapshot(start + pace * BACKFILL_BURST as i32);
        assert_eq!(seen.today.backfill, 0, "the burst is counted apart");
        assert_eq!(seen.backfill_last_fifteen_minutes, 0);

        // The burst is drawn, so the steady share applies from the next one:
        // a window of it now, then the window holds the rest.
        let after = start + chrono::TimeDelta::minutes(1);
        let window = BACKFILL_ALLOWANCE.per_fifteen_minutes;
        admit_n(&mut budget, Intent::Backfill, window, after);
        assert!(matches!(
            budget.admit(Intent::Backfill, after),
            Admission::Deferred { .. }
        ));
        assert_eq!(budget.snapshot(after).today.backfill, window);
    }

    /// Expected behaviour: with the burst armed and drawn, the whole first day
    /// is the burst plus the day's 1,000, and nothing more.
    #[test]
    fn the_first_day_holds_the_burst_plus_the_daily_share() {
        let mut budget = Budget::new(0);
        let start = at("2026-03-04T08:00:00Z");
        budget.arm_burst(start);
        admit_n(&mut budget, Intent::Backfill, BACKFILL_BURST, start);
        let per_day = BACKFILL_ALLOWANCE.per_day.expect("a daily allowance");
        let window = BACKFILL_ALLOWANCE.per_fifteen_minutes;
        let mut admitted = 0;
        let mut now = start + chrono::TimeDelta::minutes(16);
        while admitted < per_day {
            let n = window.min(per_day - admitted);
            admit_n(&mut budget, Intent::Backfill, n, now);
            admitted += n;
            now += chrono::TimeDelta::minutes(16);
        }
        assert_eq!(
            budget.admit(Intent::Backfill, now),
            Admission::Deferred {
                until: at("2026-03-05T00:00:00Z")
            },
            "the day's share is spent"
        );
    }

    /// Scenario: the app closes with the burst a tenth drawn and opens an hour
    /// later.
    ///
    /// Expected behaviour: the burst still draws the rest, and the steady share
    /// applies only once it is spent.
    #[test]
    fn an_undrawn_burst_waits_for_the_next_quiet_moment() {
        let mut budget = Budget::new(0);
        let start = at("2026-03-04T10:00:00Z");
        budget.arm_burst(start);
        admit_n(&mut budget, Intent::Backfill, 50, start);
        let later = start + chrono::TimeDelta::hours(1);
        admit_n(&mut budget, Intent::Backfill, BACKFILL_BURST - 50, later);
        assert_eq!(
            budget.snapshot(later).today.backfill,
            0,
            "the burst is counted apart"
        );
        let window = BACKFILL_ALLOWANCE.per_fifteen_minutes;
        admit_n(&mut budget, Intent::Backfill, window, later);
        assert!(matches!(
            budget.admit(Intent::Backfill, later),
            Admission::Deferred { .. }
        ));
    }

    /// Scenario: the burst's last request is drawn on the budget day after the
    /// pass armed it.
    ///
    /// Expected behaviour: that request is still a burst request, so the day's
    /// share is untouched and the window applies from the request after it.
    #[test]
    fn the_burst_draws_its_last_request_on_a_later_day() {
        let mut budget = Budget::new(0);
        let start = at("2026-03-04T23:50:00Z");
        budget.arm_burst(start);
        admit_n(&mut budget, Intent::Backfill, BACKFILL_BURST - 1, start);
        let next_day = at("2026-03-05T09:00:00Z");
        assert_eq!(
            budget.admit(Intent::Backfill, next_day),
            Admission::Admitted
        );
        assert_eq!(
            budget.snapshot(next_day).today.backfill,
            0,
            "the burst's last request is counted apart"
        );
        let window = BACKFILL_ALLOWANCE.per_fifteen_minutes;
        admit_n(&mut budget, Intent::Backfill, window, next_day);
        assert!(matches!(
            budget.admit(Intent::Backfill, next_day),
            Admission::Deferred { .. }
        ));
    }

    /// Expected behaviour: nothing is drawn from the burst before a pass arms
    /// it, and a pass that starts after it is spent arms nothing.
    #[test]
    fn a_spent_burst_never_arms_again() {
        let mut budget = Budget::new(0);
        let window = BACKFILL_ALLOWANCE.per_fifteen_minutes;
        let start = at("2026-03-04T10:00:00Z");
        admit_n(&mut budget, Intent::Backfill, window, start);
        assert!(
            matches!(
                budget.admit(Intent::Backfill, start),
                Admission::Deferred { .. }
            ),
            "an unarmed budget draws only the steady share"
        );

        let mut budget = Budget::new(0);
        budget.arm_burst(start);
        admit_n(&mut budget, Intent::Backfill, BACKFILL_BURST, start);
        let later = start + chrono::TimeDelta::hours(2);
        budget.arm_burst(later);
        admit_n(&mut budget, Intent::Backfill, window, later);
        assert!(
            matches!(
                budget.admit(Intent::Backfill, later),
                Admission::Deferred { .. }
            ),
            "a second pass draws only the trickle"
        );
    }

    /// Expected behaviour: the burst's state survives a relaunch and is shared
    /// with another process, and a restored budget does not re-arm it.
    #[test]
    fn the_burst_state_survives_a_stored_round_trip() {
        let store = Arc::new(MemoryStore::default());
        let start = at("2026-03-04T10:00:00Z");
        let gov = Governor::new(1000, Box::new(NoopPolicy)).with_budget(
            Budget::new(0),
            Some(store.clone()),
            no_jitter,
        );
        gov.arm_backfill_burst(start);
        for _ in 0..BACKFILL_BURST {
            assert_eq!(gov.admit(Intent::Backfill, start), Admission::Admitted);
        }
        let kept = store.get().expect("the budget was written");
        assert_eq!(kept.burst_armed_at, Some(start));
        assert_eq!(kept.burst_drawn, BACKFILL_BURST);
        assert!(kept.burst_spent);

        // A relaunch: a fresh budget adopts the stored state.
        let later = start + chrono::TimeDelta::hours(1);
        let relaunched = Governor::new(1000, Box::new(NoopPolicy)).with_budget(
            Budget::new(0),
            Some(store.clone()),
            no_jitter,
        );
        relaunched.arm_backfill_burst(later);
        let window = BACKFILL_ALLOWANCE.per_fifteen_minutes;
        for _ in 0..window {
            assert_eq!(
                relaunched.admit(Intent::Backfill, later),
                Admission::Admitted
            );
        }
        assert!(matches!(
            relaunched.admit(Intent::Backfill, later),
            Admission::Deferred { .. }
        ));
        assert!(store.get().is_some_and(|s| s.burst_spent));
    }

    /// Scenario: an upgrade draws two hundred of the burst, the app closes, and
    /// it opens two hours later.
    ///
    /// Expected behaviour: the other three hundred are still available, and the
    /// burst is stored as spent only once it is drawn.
    #[test]
    fn a_half_drawn_burst_survives_a_stored_round_trip() {
        let store = Arc::new(MemoryStore::default());
        let start = at("2026-03-04T10:00:00Z");
        let gov = Governor::new(1000, Box::new(NoopPolicy)).with_budget(
            Budget::new(0),
            Some(store.clone()),
            no_jitter,
        );
        gov.arm_backfill_burst(start);
        for _ in 0..200 {
            assert_eq!(gov.admit(Intent::Backfill, start), Admission::Admitted);
        }
        let kept = store.get().expect("the budget was written");
        assert_eq!(kept.burst_drawn, 200);
        assert!(!kept.burst_spent);

        let later = start + chrono::TimeDelta::hours(2);
        let relaunched = Governor::new(1000, Box::new(NoopPolicy)).with_budget(
            Budget::new(0),
            Some(store.clone()),
            no_jitter,
        );
        relaunched.arm_backfill_burst(later);
        for i in 0..BACKFILL_BURST - 200 {
            assert_eq!(
                relaunched.admit(Intent::Backfill, later),
                Admission::Admitted,
                "burst request {i} after the relaunch"
            );
        }
        assert!(store.get().is_some_and(|s| s.burst_spent));
    }

    /// Expected behaviour: a low budget figure on a response holds the burst
    /// like it holds the steady share.
    #[test]
    fn a_low_figure_holds_the_burst() {
        let mut budget = Budget::new(0);
        let now = at("2026-03-04T10:00:00Z");
        budget.arm_burst(now);
        budget.succeeded(
            &RateBudget {
                limit: Some(RateWindows {
                    fifteen_minutes: 100,
                    daily: 1_000,
                }),
                remaining: Some(RateWindows {
                    fifteen_minutes: 10,
                    daily: 900,
                }),
                retry_after_secs: None,
            },
            now,
        );
        assert!(matches!(
            budget.admit(Intent::Backfill, now),
            Admission::Deferred { .. }
        ));
    }

    /// Expected behaviour: asking when a request would be deferred answers
    /// what `admit` would, and counts and sends nothing.
    #[test]
    fn a_deferral_read_counts_nothing() {
        let one = Allowance {
            per_fifteen_minutes: 1,
            per_day: None,
        };
        let mut budget = Budget::with_allowances(one, one, 0);
        let now = at("2026-03-04T10:00:00Z");
        assert_eq!(budget.deferred_until(Intent::Sync, now), None);
        assert_eq!(budget.deferred_until(Intent::Sync, now), None);
        assert_eq!(budget.admit(Intent::Sync, now), Admission::Admitted);
        let until = at("2026-03-04T10:15:00Z");
        assert_eq!(budget.deferred_until(Intent::Sync, now), Some(until));
        assert_eq!(
            budget.admit(Intent::Sync, now),
            Admission::Deferred { until }
        );
        assert_eq!(budget.deferred_until(Intent::Backfill, now), None);
        assert_eq!(budget.deferred_until(Intent::User, now), None);
        assert_eq!(budget.snapshot(now).today.sync, 1);
        assert_eq!(budget.snapshot(now).today.backfill, 0);
    }

    #[test]
    fn the_sync_has_a_small_allowance_and_the_user_none() {
        let mut budget = Budget::new(0);
        let now = at("2026-03-04T10:00:00Z");
        admit_n(
            &mut budget,
            Intent::Sync,
            SYNC_ALLOWANCE.per_fifteen_minutes,
            now,
        );
        assert_eq!(
            budget.admit(Intent::Sync, now),
            Admission::Deferred {
                until: at("2026-03-04T10:15:00Z")
            }
        );
        admit_n(&mut budget, Intent::User, 5_000, now);
        let seen = budget.snapshot(now);
        assert_eq!(seen.today.user, 5_000, "every user request is counted");
        assert_eq!(seen.today.sync, SYNC_ALLOWANCE.per_fifteen_minutes);
        assert_eq!(seen.today.backfill, 0);
    }

    #[test]
    fn the_daily_limit_reads_the_backfill_count_and_this_installs_reset() {
        let mut budget = Budget::new(10 * 60);
        let now = at("2026-03-04T10:00:00Z");
        admit_n(&mut budget, Intent::Backfill, 7, now);
        admit_n(&mut budget, Intent::Sync, 3, now);
        let limit = FfiDailyLimit::from_snapshot(&budget.snapshot(now)).expect("a daily cap");
        assert_eq!(limit.used, 7, "sync requests are not the backfill's");
        assert_eq!(
            limit.per_day,
            BACKFILL_ALLOWANCE.per_day.expect("a daily cap")
        );
        assert_eq!(
            limit.resets_at_ms,
            at("2026-03-05T00:10:00Z").timestamp_millis() as f64
        );
    }

    #[test]
    fn an_uncapped_backfill_has_no_daily_limit() {
        let mut budget = Budget::with_allowances(
            Allowance {
                per_fifteen_minutes: 100,
                per_day: None,
            },
            SYNC_ALLOWANCE,
            0,
        );
        let now = at("2026-03-04T10:00:00Z");
        assert_eq!(FfiDailyLimit::from_snapshot(&budget.snapshot(now)), None);
    }

    #[test]
    fn budget_resets_daily_count_at_utc_midnight_with_jitter() {
        let mut budget = Budget::new(10 * 60);
        // Spaced so they never fill the fifteen-minute window, so the day's
        // allowance is the only thing that can stop them.
        let per_day = BACKFILL_ALLOWANCE.per_day.expect("a daily allowance");
        let spacing = 900 / i64::from(BACKFILL_ALLOWANCE.per_fifteen_minutes) + 1;
        let start = at("2026-03-04T20:50:00Z");
        for i in 0..i64::from(per_day) {
            let now = start + chrono::TimeDelta::seconds(spacing * i);
            assert_eq!(
                budget.admit(Intent::Backfill, now),
                Admission::Admitted,
                "{i}"
            );
        }
        let reset = at("2026-03-05T00:10:00Z");
        assert_eq!(
            budget.admit(Intent::Backfill, at("2026-03-04T23:55:00Z")),
            Admission::Deferred { until: reset }
        );
        assert_eq!(
            budget.admit(Intent::Backfill, at("2026-03-05T00:05:00Z")),
            Admission::Deferred { until: reset },
            "midnight UTC is not this install's reset"
        );
        assert_eq!(budget.admit(Intent::Backfill, reset), Admission::Admitted);
        assert_eq!(budget.snapshot(reset).today.backfill, 1);
        assert_eq!(budget.next_reset(reset), at("2026-03-06T00:10:00Z"));
    }

    #[test]
    fn a_day_offset_is_held_to_thirty_minutes() {
        assert_eq!(day_offset_secs(0.0), 0);
        assert!(day_offset_secs(0.999_999) <= 1_800);
        assert_eq!(day_offset_secs(f64::NAN), 0);
        let budget = Budget::new(86_400);
        assert_eq!(
            budget.next_reset(at("2026-03-04T10:00:00Z")),
            at("2026-03-05T00:30:00Z")
        );
    }

    #[test]
    fn an_edge_burst_is_retried_inline_and_a_second_refusal_cools_down() {
        let mut budget = Budget::new(0);
        let now = at("2026-03-04T10:00:00Z");
        assert_eq!(
            budget.refused(&retry_after(1), None, b"", false, now, 0.0),
            AfterRefusal::RetryInline
        );
        assert_eq!(
            budget.cooldown_until(now),
            None,
            "an edge burst holds nothing"
        );
        assert_eq!(
            budget.refused(&retry_after(1), None, b"", false, now, 0.0),
            AfterRefusal::Cooldown {
                until: at("2026-03-04T10:01:00Z")
            },
            "the second in a row is the ladder's first rung"
        );
        budget.succeeded(&RateBudget::default(), now);
        assert_eq!(budget.cooldown_until(now), None, "a success clears it");
        assert_eq!(
            budget.refused(&retry_after(1), None, b"", false, now, 0.0),
            AfterRefusal::RetryInline,
            "and starts the run again"
        );
    }

    #[test]
    fn refused_backfill_defers_until_retry_after_and_persists() {
        let store = Arc::new(MemoryStore::default());
        let now = at("2026-03-04T10:00:00Z");
        let gov = Governor::new(1000, Box::new(NoopPolicy)).with_budget(
            Budget::new(0),
            Some(store.clone()),
            no_jitter,
        );
        let (rate, via) = via_app(600);
        let until = at("2026-03-04T10:10:00Z");
        assert_eq!(
            gov.note_refusal(&rate, via, b"", false, now),
            AfterRefusal::Cooldown { until },
            "the Retry-After in full, not capped at two minutes"
        );
        assert_eq!(
            gov.admit(Intent::Backfill, now),
            Admission::Deferred { until }
        );
        assert_eq!(gov.admit(Intent::Sync, now), Admission::Deferred { until });
        assert_eq!(store.get().and_then(|s| s.cooldown_until), Some(until));

        // A relaunch, or another process opening the same library.
        let reopened = Governor::new(1000, Box::new(NoopPolicy)).with_budget(
            Budget::new(0),
            Some(store.clone()),
            no_jitter,
        );
        let later = at("2026-03-04T10:04:00Z");
        assert_eq!(
            reopened.admit(Intent::Backfill, later),
            Admission::Deferred { until }
        );
        assert_eq!(reopened.admit(Intent::Backfill, until), Admission::Admitted);
    }

    #[test]
    fn a_cooldown_climbs_the_ladder_with_jitter_on_top() {
        let mut budget = Budget::new(0);
        let now = at("2026-03-04T10:00:00Z");
        let (rate, via) = via_app(30);
        let rungs: Vec<_> = (0..5)
            .map(|_| match budget.refused(&rate, via, b"", false, now, 0.0) {
                AfterRefusal::Cooldown { until } => (until - now).num_minutes(),
                AfterRefusal::RetryInline => panic!("an application refusal was retried"),
            })
            .collect();
        assert_eq!(rungs, vec![1, 5, 15, 60, 60]);

        let mut jittered = Budget::new(0);
        assert_eq!(
            jittered.refused(&retry_after(400), via, b"", false, now, 0.5),
            AfterRefusal::Cooldown {
                until: now + chrono::TimeDelta::seconds(450)
            },
            "an eighth more at a draw of a half"
        );
    }

    #[test]
    fn budget_admits_user_intent_as_one_probe_inside_a_cooldown() {
        let mut budget = Budget::new(0);
        let now = at("2026-03-04T10:00:00Z");
        let (rate, via) = via_app(3_600);
        let until = at("2026-03-04T11:00:00Z");
        assert_eq!(
            budget.refused(&rate, via, b"", false, now, 0.0),
            AfterRefusal::Cooldown { until }
        );
        assert_eq!(budget.admit(Intent::User, now), Admission::Probe);
        assert_eq!(
            budget.admit(Intent::User, at("2026-03-04T10:04:59Z")),
            Admission::Deferred {
                until: at("2026-03-04T10:05:00Z")
            },
            "one probe in five minutes"
        );
        assert_eq!(
            budget.admit(Intent::Sync, at("2026-03-04T10:04:59Z")),
            Admission::Deferred { until }
        );
        assert_eq!(
            budget.admit(Intent::User, at("2026-03-04T10:05:00Z")),
            Admission::Probe
        );
        // A probe that answers ends the cooldown for everyone.
        budget.succeeded(&RateBudget::default(), at("2026-03-04T10:05:01Z"));
        assert_eq!(
            budget.admit(Intent::Backfill, at("2026-03-04T10:05:01Z")),
            Admission::Admitted
        );
        admit_n(&mut budget, Intent::User, 3, at("2026-03-04T10:05:01Z"));
    }

    #[test]
    fn a_refused_probe_holds_until_the_next_midnight() {
        let mut budget = Budget::new(20 * 60);
        let now = at("2026-03-04T10:00:00Z");
        let (rate, via) = via_app(60);
        budget.refused(&rate, via, b"", false, now, 0.0);
        assert_eq!(budget.admit(Intent::User, now), Admission::Probe);
        assert_eq!(
            budget.refused(&retry_after(1), None, b"", true, now, 0.0),
            AfterRefusal::Cooldown {
                until: at("2026-03-05T00:20:00Z")
            },
            "a probe is never retried inline, even on what looks like a burst"
        );
    }

    #[test]
    fn two_headerless_refusals_hold_until_the_next_midnight() {
        let mut budget = Budget::new(0);
        let now = at("2026-03-04T10:00:00Z");
        assert_eq!(
            budget.refused(&RateBudget::default(), None, b"", false, now, 0.0),
            AfterRefusal::Cooldown {
                until: at("2026-03-04T10:01:00Z")
            }
        );
        assert_eq!(
            budget.refused(&RateBudget::default(), None, b"", false, now, 0.0),
            AfterRefusal::Cooldown {
                until: at("2026-03-05T00:00:00Z")
            }
        );
    }

    #[test]
    fn a_shorter_cooldown_never_shortens_a_longer_one() {
        let mut budget = Budget::new(0);
        let now = at("2026-03-04T10:00:00Z");
        budget.refused(&RateBudget::default(), None, b"", false, now, 0.0);
        budget.refused(&RateBudget::default(), None, b"", false, now, 0.0);
        let (rate, via) = via_app(60);
        assert_eq!(
            budget.refused(&rate, via, b"", false, now, 0.0),
            AfterRefusal::Cooldown {
                until: at("2026-03-05T00:00:00Z")
            }
        );
    }

    #[test]
    fn stored_cooldown_is_clamped_on_read() {
        let now = at("2026-03-04T10:00:00Z");
        let stored = StoredBudget {
            cooldown_until: Some(at("2026-03-07T10:00:00Z")),
            day: now.date_naive(),
            backfill_today: 0,
            day_offset_secs: 0,
            ladder_step: 0,
            burst_armed_at: None,
            burst_drawn: 0,
            burst_spent: false,
        };
        let mut budget = Budget::new(0);
        budget.adopt(&stored, now);
        assert_eq!(
            budget.cooldown_until(now),
            Some(at("2026-03-05T00:30:00Z")),
            "three days ahead is held to half an hour past the next midnight"
        );

        // Late in the day an hour from now is the later bound.
        let late = at("2026-03-04T23:50:00Z");
        let mut budget = Budget::new(0);
        budget.adopt(&stored, late);
        assert_eq!(
            budget.cooldown_until(late),
            Some(at("2026-03-05T00:50:00Z"))
        );

        // A cooldown already past is no cooldown.
        let mut budget = Budget::new(0);
        budget.adopt(
            &StoredBudget {
                cooldown_until: Some(at("2026-03-04T09:00:00Z")),
                ..stored
            },
            now,
        );
        assert_eq!(budget.cooldown_until(now), None);
    }

    #[test]
    fn a_stored_count_is_taken_for_its_own_day_only() {
        let now = at("2026-03-04T10:00:00Z");
        let stored = StoredBudget {
            cooldown_until: None,
            day: now.date_naive(),
            backfill_today: BACKFILL_ALLOWANCE.per_day.expect("a daily allowance"),
            day_offset_secs: 0,
            ladder_step: 0,
            burst_armed_at: None,
            burst_drawn: 0,
            burst_spent: false,
        };
        let mut budget = Budget::new(0);
        budget.adopt(&stored, now);
        assert_eq!(
            budget.admit(Intent::Backfill, now),
            Admission::Deferred {
                until: at("2026-03-05T00:00:00Z")
            },
            "another process spent today's allowance"
        );

        let mut tomorrow = Budget::new(0);
        let next = at("2026-03-05T10:00:00Z");
        tomorrow.adopt(&stored, next);
        assert_eq!(tomorrow.admit(Intent::Backfill, next), Admission::Admitted);

        // The stored offset is the install's, so every process resets together,
        // and one past thirty minutes is not believed.
        let mut offset = Budget::new(0);
        offset.adopt(
            &StoredBudget {
                day_offset_secs: 900,
                ..stored
            },
            now,
        );
        assert_eq!(offset.next_reset(now), at("2026-03-05T00:15:00Z"));
        let mut wild = Budget::new(300);
        wild.adopt(
            &StoredBudget {
                day_offset_secs: 90_000,
                ..stored
            },
            now,
        );
        assert_eq!(wild.next_reset(now), at("2026-03-05T00:05:00Z"));
    }

    #[test]
    fn the_store_is_written_only_when_what_it_holds_changes() {
        let store = Arc::new(MemoryStore::default());
        let gov = Governor::new(1000, Box::new(NoopPolicy)).with_budget(
            Budget::new(0),
            Some(store.clone()),
            no_jitter,
        );
        let now = at("2026-03-04T10:00:00Z");
        gov.admit(Intent::User, now);
        let first = store.saves();
        gov.admit(Intent::User, now);
        gov.admit(Intent::Sync, now);
        assert_eq!(
            store.saves(),
            first,
            "a user or sync admission changes nothing kept"
        );
        gov.admit(Intent::Backfill, now);
        assert_eq!(store.saves(), first + 1);
        assert_eq!(store.get().map(|s| s.backfill_today), Some(1));
    }

    #[test]
    fn a_low_figure_holds_the_backfill_and_nothing_else() {
        let mut budget = Budget::new(0);
        let now = at("2026-03-04T22:00:00Z");
        budget.succeeded(&remaining(2_000, 100), now);
        assert_eq!(
            budget.admit(Intent::Backfill, now),
            Admission::Deferred {
                until: at("2026-03-05T00:00:00Z")
            }
        );
        assert_eq!(budget.admit(Intent::Sync, now), Admission::Admitted);
        assert_eq!(budget.admit(Intent::User, now), Admission::Admitted);
        // A healthy figure later does not lift it, and it lapses on its own.
        budget.succeeded(&remaining(2_000, 6_000), now);
        assert!(matches!(
            budget.admit(Intent::Backfill, now),
            Admission::Deferred { .. }
        ));
        assert_eq!(
            budget.admit(Intent::Backfill, at("2026-03-05T00:00:00Z")),
            Admission::Admitted
        );
    }

    #[test]
    fn two_garmin_slots_are_never_closer_than_the_gap() {
        let t0 = Instant::now();
        let gap = GARMIN_MIN_GAP;
        assert_eq!(gap, Duration::from_secs(2));
        assert_eq!(garmin_slot(None, t0, gap), t0);
        let first = garmin_slot(None, t0, gap);
        let second = garmin_slot(Some(first), t0, gap);
        assert_eq!(second - first, gap);
        let late = t0 + Duration::from_secs(10);
        assert_eq!(garmin_slot(Some(second), late, gap), late);
    }

    #[test]
    fn a_garmin_refusal_without_retry_after_holds_fifteen_minutes_then_doubles() {
        let minutes = |m: u64| Duration::from_secs(m * 60);
        assert_eq!(garmin_hold(1, None), minutes(15));
        assert_eq!(garmin_hold(2, None), minutes(30));
        assert_eq!(garmin_hold(3, None), minutes(60));
        assert_eq!(garmin_hold(40, None), GARMIN_HOLD_MAX);
        assert_eq!(garmin_hold(1, Some(7)), Duration::from_secs(7));
        assert_eq!(garmin_hold(5, Some(7)), Duration::from_secs(7));
        assert_eq!(garmin_hold(1, Some(u64::MAX)), GARMIN_HOLD_MAX);
    }

    #[test]
    fn a_garmin_refusal_holds_only_the_garmin_lane() {
        let gov = Governor::new(1000, Box::new(NoopPolicy)).with_garmin_gap(Duration::ZERO);
        let now = at("2026-10-25T10:00:00Z");
        let until = gov.note_garmin_refusal(None, now);
        assert_eq!(until, now + chrono::Duration::minutes(15));
        assert_eq!(gov.garmin_deferred_until(now), Some(until));
        assert_eq!(gov.garmin_deferred_until(until), None);
        assert_eq!(gov.cooldown_until(now), None);
        assert_eq!(gov.admit(Intent::Backfill, now), Admission::Admitted);

        let again = gov.note_garmin_refusal(None, until);
        assert_eq!(again, until + chrono::Duration::minutes(30));
        gov.note_garmin_success();
        let after_success = gov.note_garmin_refusal(None, again);
        assert_eq!(after_success, again + chrono::Duration::minutes(15));
    }

    #[test]
    fn a_held_garmin_lane_sends_nothing_and_other_lanes_go() {
        let _clock = crate::test_globals::real_clock();
        crate::runtime::block_on(async {
            let gov = Governor::new(1000, Box::new(NoopPolicy)).with_garmin_gap(Duration::ZERO);
            let until = gov.note_garmin_refusal(Some(600), gov.now());
            assert!(matches!(
                gov.acquire(Lane::Garmin).await,
                Admission::Deferred { until: u } if u == until
            ));
            assert_eq!(gov.acquire(Lane::Backfill).await, Admission::Admitted);
        });
    }

    #[test]
    fn garmin_acquires_wait_out_the_gap_and_count_requests() {
        let _clock = crate::test_globals::real_clock();
        crate::runtime::block_on(async {
            let gap = Duration::from_millis(120);
            let gov = Governor::new(1000, Box::new(NoopPolicy)).with_garmin_gap(gap);
            let start = Instant::now();
            for _ in 0..3 {
                assert_eq!(gov.acquire(Lane::Garmin).await, Admission::Admitted);
            }
            assert!(start.elapsed() >= gap * 2, "{:?}", start.elapsed());
            assert_eq!(gov.garmin_requests(), 3);
            gov.note_garmin_refusal(None, gov.now());
            assert_eq!(gov.garmin_requests(), 0, "counted since the last refusal");
        });
    }

    #[test]
    fn a_pacing_only_governor_admits_everything_and_retries_every_refusal() {
        let gov = Governor::new(1000, Box::new(NoopPolicy));
        let now = at("2026-03-04T10:00:00Z");
        let (rate, via) = via_app(600);
        assert_eq!(
            gov.note_refusal(&rate, via, b"", false, now),
            AfterRefusal::RetryInline
        );
        assert_eq!(gov.admit(Intent::Backfill, now), Admission::Admitted);
        assert_eq!(gov.budget_snapshot(now), None);
        assert_eq!(gov.jitter(), 0.0);
    }

    #[test]
    fn a_deferred_acquire_sends_nothing_and_takes_no_slot() {
        let now = chrono::Utc::now();
        let gov =
            Governor::new(1, Box::new(NoopPolicy)).with_budget(Budget::new(0), None, no_jitter);
        let (rate, via) = via_app(600);
        gov.note_refusal(&rate, via, b"", false, now);
        crate::runtime::block_on(async {
            for _ in 0..3 {
                assert!(matches!(
                    gov.acquire(Lane::Backfill).await,
                    Admission::Deferred { .. }
                ));
            }
            assert_eq!(
                *gov.next_at.lock().unwrap(),
                None,
                "a deferred request claimed a dispatch slot"
            );
            assert_eq!(
                gov.acquire(Dispatch::new(Lane::Backfill, Intent::User))
                    .await,
                Admission::Probe,
                "the intent decides, not the lane"
            );
        });
    }

    /// A store in memory, standing in for the settings rows.
    #[derive(Default)]
    struct MemoryStore {
        held: std::sync::Mutex<(Option<StoredBudget>, usize)>,
    }

    impl MemoryStore {
        fn get(&self) -> Option<StoredBudget> {
            self.held.lock().unwrap().0
        }

        fn saves(&self) -> usize {
            self.held.lock().unwrap().1
        }
    }

    impl BudgetStore for MemoryStore {
        fn load(&self) -> Option<StoredBudget> {
            self.get()
        }

        fn save(&self, stored: &StoredBudget) {
            let mut held = self.held.lock().unwrap();
            held.0 = Some(*stored);
            held.1 += 1;
        }
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
