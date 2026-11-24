//! The engine's own wake-up after a refusal.
//!
//! A walk that meets a refusal from intervals.icu or a deferral from the
//! request budget stops there and leaves its work owed, so something has to
//! ask again once the refusal lifts, without waiting for the athlete to open
//! the app. One sleeper does that for every job: it wakes at the earliest time
//! any of them was told to come back, or at once when a probe ends the
//! cooldown early, and restarts the sync, the GPS track pass, both backfills
//! and the upload queue.
//! Each of them asks the governor before it sends anything, so a restart that
//! comes too early is deferred again rather than sent.

use crate::poison::Recover;
use chrono::{DateTime, Utc};
use std::sync::{Condvar, Mutex};

/// When the sleeper next wakes, and whether its thread is running.
#[derive(Debug, Default, PartialEq, Eq)]
struct Due {
    at: Option<DateTime<Utc>>,
    running: bool,
}

impl Due {
    /// Ask for a wake at `at`. The earliest asked for wins, since each job
    /// re-asks the governor and a job not yet due is deferred again.
    fn schedule(&mut self, at: DateTime<Utc>) {
        self.at = Some(self.at.map_or(at, |due| due.min(at)));
    }

    /// Bring a pending wake forward to `now`. A sleeper with nothing pending
    /// has nothing to resume, so it stays as it is.
    fn bring_forward(&mut self, now: DateTime<Utc>) -> bool {
        match self.at {
            Some(due) if due > now => {
                self.at = Some(now);
                true
            }
            _ => false,
        }
    }

    /// Whether the wake is due at `now`, taking it when it is.
    fn take_due(&mut self, now: DateTime<Utc>) -> bool {
        match self.at {
            Some(due) if due <= now => {
                self.at = None;
                true
            }
            _ => false,
        }
    }
}

/// The schedule, and the flag that says a thread is serving it.
struct Sleeper {
    due: Mutex<Due>,
    wake: Condvar,
}

impl Sleeper {
    const fn new() -> Self {
        Self {
            due: Mutex::new(Due {
                at: None,
                running: false,
            }),
            wake: Condvar::new(),
        }
    }

    /// Ask for a wake at `at`. Returns whether the caller must start the
    /// sleeper thread, which is the case when none is running.
    fn ask(&self, at: DateTime<Utc>) -> bool {
        let mut due = self.due.lock_recover();
        due.schedule(at);
        let spawn = !due.running;
        due.running = true;
        spawn
    }
}

static SLEEPER: Sleeper = Sleeper::new();

/// Resume the owed work at `at`, or earlier when a probe ends the cooldown.
pub fn resume_at(at: DateTime<Utc>) {
    let spawn = SLEEPER.ask(at);
    SLEEPER.wake.notify_all();
    if spawn {
        spawn_sleeper();
    }
}

/// Who asked for a hold on the downloads. The order is the order they are
/// named in: intervals.icu's cooldown, then the shared pool, then this
/// install's own share.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HoldCause {
    /// intervals.icu asked for the wait, through a refusal's cooldown.
    Upstream,
    /// A low figure from the shared intervals.icu pool holds the backfill, so
    /// it yields to everyone's sync.
    Pool,
    /// This install's own share of its request budget.
    Budget,
}

/// Why the downloads cannot be restarted yet, and until when.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DownloadsHold {
    pub until: DateTime<Utc>,
    pub cause: HoldCause,
}

/// What a Retry now did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetryNow {
    /// Both downloads were restarted.
    Started,
    /// A hold is in force, so nothing was sent.
    Held(DownloadsHold),
}

/// The hold at `now`, given the refusal cooldown, the backfill's whole
/// deferral and the shared pool's low figure.
///
/// A cooldown is intervals.icu's ask, so it names itself first and holds
/// until its own end. Otherwise a live pool figure names the hold ahead of
/// this install's share, which is only what this install spent. The downloads
/// resume once every deferral has lifted, so `until` is the latest live one.
fn hold_from(
    now: DateTime<Utc>,
    cooldown: Option<DateTime<Utc>>,
    budget: Option<DateTime<Utc>>,
    pool: Option<DateTime<Utc>>,
) -> Option<DownloadsHold> {
    if let Some(until) = cooldown.filter(|until| *until > now) {
        return Some(DownloadsHold {
            until,
            cause: HoldCause::Upstream,
        });
    }
    let pool = pool.filter(|until| *until > now);
    let until = budget
        .into_iter()
        .chain(pool)
        .filter(|until| *until > now)
        .max()?;
    let cause = if pool.is_some() {
        HoldCause::Pool
    } else {
        HoldCause::Budget
    };
    Some(DownloadsHold { until, cause })
}

/// The hold on the downloads right now, if any.
pub fn downloads_hold() -> Option<DownloadsHold> {
    use crate::governor::{GOVERNOR, Intent};
    let now = Utc::now();
    hold_from(
        now,
        GOVERNOR.cooldown_until(now),
        GOVERNOR.deferred_until(Intent::Backfill, now),
        GOVERNOR.pool_hold_until(now),
    )
}

fn retry_with(hold: Option<DownloadsHold>, restart: impl FnOnce()) -> RetryNow {
    match hold {
        Some(hold) => RetryNow::Held(hold),
        None => {
            restart();
            RetryNow::Started
        }
    }
}

/// Restart the elevation and the stream download at once, the way the sleeper
/// does, unless a hold is in force. The governor still decides what is sent.
pub fn retry_downloads_now() -> RetryNow {
    retry_downloads_with(downloads_hold(), || {
        crate::objects::gps_pass::budget_lifted();
        crate::net::elevation_backfill::start_owed_work();
        crate::net::stream_backfill::autostart_stream_backfill();
    })
}

/// Retry now with the hold and the start supplied. A refused track or series
/// upstream withheld is asked again here, since asking is what the athlete
/// pressed, and only then are the downloads started so they find it owed.
pub fn retry_downloads_with(hold: Option<DownloadsHold>, start: impl FnOnce()) -> RetryNow {
    retry_with(hold, || {
        match crate::persistence::with_persistent_engine(|e| e.release_withheld_downloads()) {
            Some(Err(e)) => log::warn!("[Resume] releasing withheld downloads failed: {e}"),
            Some(Ok(n)) if n > 0 => log::info!("[Resume] {n} withheld downloads asked again"),
            _ => {}
        }
        start();
    })
}

/// A request answered inside a cooldown and ended it, so whatever was waiting
/// for the cooldown can go now.
pub fn cooldown_cleared() {
    let moved = SLEEPER.due.lock_recover().bring_forward(Utc::now());
    if moved {
        SLEEPER.wake.notify_all();
    }
}

/// Holds the sleeper thread's claim on the schedule. However the thread body
/// leaves, by a return or by an unwind out of a resume, the drop clears the
/// flag under the lock, unless a wake was asked for meanwhile. That wake is
/// handed to a new sleeper, which inherits the claim and keeps the flag set.
struct Running<'a, R: Fn()> {
    sleeper: &'a Sleeper,
    respawn: R,
}

impl<R: Fn()> Drop for Running<'_, R> {
    fn drop(&mut self) {
        let mut due = self.sleeper.due.lock_recover();
        if due.at.is_none() {
            due.running = false;
            return;
        }
        drop(due);
        (self.respawn)();
    }
}

/// The sleeper's body: wait for the due time, resume, and end once nothing is
/// pending. The claim is released by [`Running`] on every way out, so a wake
/// asked for meanwhile either finds the flag set or is served by a new sleeper.
fn sleep_until_idle(sleeper: &Sleeper, mut resume: impl FnMut(), respawn: impl Fn()) {
    let _claim = Running { sleeper, respawn };
    let mut due = sleeper.due.lock_recover();
    loop {
        let now = Utc::now();
        if due.take_due(now) {
            drop(due);
            resume();
            due = sleeper.due.lock_recover();
            continue;
        }
        let Some(at) = due.at else {
            return;
        };
        let wait = (at - now).to_std().unwrap_or_default();
        due = sleeper
            .wake
            .wait_timeout(due, wait)
            .unwrap_or_else(|e| e.into_inner())
            .0;
    }
}

/// Start the sleeper's thread. A refused thread is logged and the claim given
/// back, so the next wake asks again. It does not panic into the caller, which
/// may be unwinding already when a [`Running`] hands the wake on.
#[cfg(not(test))]
fn spawn_sleeper() {
    let started = crate::threads::try_spawn_background("veloq-resume", || {
        sleep_until_idle(&SLEEPER, resume_owed_work, spawn_sleeper);
    });
    if let Err(err) = started {
        log::warn!("[Resume] could not start the resume sleeper, the next wake asks again: {err}");
        SLEEPER.due.lock_recover().running = false;
    }
}

/// The crate's tests share one process, and a sleeper that started the
/// process-wide sync would reach into whichever test runs next. The schedule
/// is tested on its own instead.
#[cfg(test)]
fn spawn_sleeper() {
    SLEEPER.due.lock_recover().running = false;
}

/// Restart everything a refusal stopped. Each start refuses on its own terms
/// when it has nothing owed, and asks the governor before every request.
#[cfg(not(test))]
fn resume_owed_work() {
    log::info!("[Resume] a refusal has lifted, resuming the owed work");
    crate::objects::sync::retry_transient_failure();
    let sync = crate::objects::sync::start_resumed_sync();
    log::info!("[Resume] sync: {sync:?}");
    crate::objects::gps_pass::budget_lifted();
    crate::net::elevation_backfill::start_owed_work();
    crate::net::stream_backfill::autostart_stream_backfill();
    crate::net::upload_schedule::start_or_wake();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    fn at(s: &str) -> DateTime<Utc> {
        s.parse().expect("instant")
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn the_earliest_wake_asked_for_wins() {
        let mut due = Due::default();
        due.schedule(at("2026-03-04T10:30:00Z"));
        due.schedule(at("2026-03-04T10:10:00Z"));
        due.schedule(at("2026-03-04T11:00:00Z"));
        assert_eq!(due.at, Some(at("2026-03-04T10:10:00Z")));
    }

    /// Expected behaviour: a resume that panics does not leave the sleeper
    /// claimed, so the next refusal starts one again.
    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_panicking_resume_releases_the_sleeper() {
        let sleeper = Sleeper::new();
        assert!(sleeper.ask(at("2026-03-04T10:00:00Z")));
        let handed_on = Cell::new(0);
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            sleep_until_idle(
                &sleeper,
                || panic!("the resume failed"),
                || handed_on.set(handed_on.get() + 1),
            );
        }));
        assert!(outcome.is_err());
        assert_eq!(handed_on.get(), 0, "nothing was asked for meanwhile");
        assert!(
            sleeper.ask(at("2026-03-04T11:00:00Z")),
            "a sleeper that unwound is still claimed, so the next refusal's wake is served by no one"
        );
    }

    /// Expected behaviour: a wake asked for while a resume is running is not
    /// lost when that resume panics. It is handed to a new sleeper, which keeps
    /// the claim.
    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_wake_asked_during_a_panicking_resume_is_handed_on() {
        let sleeper = Sleeper::new();
        assert!(sleeper.ask(at("2026-03-04T10:00:00Z")));
        let asked_during = Cell::new(true);
        let handed_on = Cell::new(0);
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            sleep_until_idle(
                &sleeper,
                || {
                    asked_during.set(sleeper.ask(at("2026-03-04T11:00:00Z")));
                    panic!("the resume failed");
                },
                || handed_on.set(handed_on.get() + 1),
            );
        }));
        assert!(outcome.is_err());
        assert!(
            !asked_during.get(),
            "a claimed sleeper is not asked to start another"
        );
        assert_eq!(handed_on.get(), 1, "the pending wake starts a new sleeper");
        let due = sleeper.due.lock_recover();
        assert_eq!(due.at, Some(at("2026-03-04T11:00:00Z")));
        assert!(due.running, "the new sleeper inherits the claim");
    }

    /// Expected behaviour: a resume that returns releases the claim once the
    /// schedule is empty, and hands nothing on.
    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_resume_that_returns_releases_the_sleeper() {
        let sleeper = Sleeper::new();
        assert!(sleeper.ask(at("2026-03-04T10:00:00Z")));
        let resumed = Cell::new(0);
        let handed_on = Cell::new(0);
        sleep_until_idle(
            &sleeper,
            || resumed.set(resumed.get() + 1),
            || handed_on.set(handed_on.get() + 1),
        );
        assert_eq!(resumed.get(), 1);
        assert_eq!(handed_on.get(), 0);
        assert!(!sleeper.due.lock_recover().running);
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn nothing_resumes_before_the_wake() {
        let mut due = Due::default();
        due.schedule(at("2026-03-04T10:30:00Z"));
        assert!(!due.take_due(at("2026-03-04T10:29:59Z")));
        assert!(due.take_due(at("2026-03-04T10:30:00Z")));
        assert!(
            !due.take_due(at("2026-03-04T10:31:00Z")),
            "a wake is taken once"
        );
        assert_eq!(due.at, None);
    }

    /// Expected behaviour: a probe that ends the cooldown early resumes the
    /// work at once, and with nothing waiting it schedules nothing.
    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_cleared_cooldown_brings_the_wake_forward() {
        let now = at("2026-03-04T10:00:00Z");
        let mut idle = Due::default();
        assert!(!idle.bring_forward(now));
        assert!(
            !idle.take_due(now),
            "a clear with nothing owed resumed work"
        );

        let mut due = Due::default();
        due.schedule(at("2026-03-04T11:00:00Z"));
        assert!(due.bring_forward(now));
        assert!(due.take_due(now));
    }

    fn hold(until: &str, cause: HoldCause) -> DownloadsHold {
        DownloadsHold {
            until: at(until),
            cause,
        }
    }

    /// Expected behaviour: with nothing holding the downloads, Retry now runs
    /// the restart and reports it started.
    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_retry_with_no_hold_restarts_the_downloads() {
        let mut restarted = 0;
        let outcome = retry_with(None, || restarted += 1);
        assert_eq!(restarted, 1);
        assert_eq!(outcome, RetryNow::Started);
    }

    /// Expected behaviour: a Retry-After or cooldown in force refuses the
    /// restart, sends nothing and reports when it lifts and who asked.
    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_retry_inside_a_hold_restarts_nothing_and_reports_the_time() {
        let mut restarted = 0;
        let held = hold("2026-03-04T10:30:00Z", HoldCause::Upstream);
        let outcome = retry_with(Some(held), || restarted += 1);
        assert_eq!(restarted, 0);
        assert_eq!(outcome, RetryNow::Held(held));
    }

    /// Expected behaviour: Retry now on the downloads starts them once when
    /// nothing holds them, with or without a library open, and starts nothing
    /// inside a hold.
    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn retrying_the_downloads_starts_them_once_unless_held() {
        let _serial = crate::test_globals::serial_global_state();
        let _dir = crate::test_globals::init_global_engine("resume_retry.db");
        let mut started = 0;
        assert_eq!(
            retry_downloads_with(None, || started += 1),
            RetryNow::Started
        );
        assert_eq!(started, 1);

        let held = hold("2026-03-04T10:30:00Z", HoldCause::Budget);
        assert_eq!(
            retry_downloads_with(Some(held), || started += 1),
            RetryNow::Held(held)
        );
        assert_eq!(started, 1);
    }

    /// Expected behaviour: the refusal's own cooldown names intervals.icu as
    /// the one that asked, ahead of the shared pool and the install's budget.
    #[test]
    fn the_cooldown_outranks_the_pool_and_the_budget_in_naming_who_asked() {
        let now = at("2026-03-04T10:00:00Z");
        let cooldown = Some(at("2026-03-04T10:20:00Z"));
        let budget = Some(at("2026-03-04T10:05:00Z"));
        let pool = Some(at("2026-03-04T10:15:00Z"));
        assert_eq!(
            hold_from(now, cooldown, budget, pool),
            Some(hold("2026-03-04T10:20:00Z", HoldCause::Upstream))
        );
        assert_eq!(
            hold_from(now, None, budget, None),
            Some(hold("2026-03-04T10:05:00Z", HoldCause::Budget))
        );
        assert_eq!(hold_from(now, None, None, None), None);
        assert_eq!(
            hold_from(now, None, Some(now), None),
            None,
            "a hold that has lifted is none"
        );
    }

    /// Scenario: the shared pool's low figure holds the backfill until
    /// midnight, and this install's own day share is spent until the same
    /// midnight.
    ///
    /// Expected behaviour: the hold is named for the pool, which asked, and
    /// not for the install's own limit, which nothing of the athlete's reached.
    #[test]
    fn a_pool_hold_is_named_for_the_pool_not_the_install() {
        let now = at("2026-03-04T10:00:00Z");
        let midnight = Some(at("2026-03-05T00:00:00Z"));
        assert_eq!(
            hold_from(now, None, midnight, midnight),
            Some(hold("2026-03-05T00:00:00Z", HoldCause::Pool))
        );
    }

    /// Expected behaviour: a pool figure with no install share still holds,
    /// and names the pool.
    #[test]
    fn a_pool_hold_alone_is_named_for_the_pool() {
        let now = at("2026-03-04T10:00:00Z");
        let midnight = Some(at("2026-03-05T00:00:00Z"));
        assert_eq!(
            hold_from(now, None, None, midnight),
            Some(hold("2026-03-05T00:00:00Z", HoldCause::Pool))
        );
    }

    /// Scenario: the pool figure has lifted, and this install's day share is
    /// spent until midnight.
    ///
    /// Expected behaviour: the hold is the install's own share, named as such.
    /// A pool figure that has already passed names nothing.
    #[test]
    fn once_the_pool_lifts_the_install_share_is_what_holds() {
        let now = at("2026-03-04T10:00:00Z");
        let midnight = Some(at("2026-03-05T00:00:00Z"));
        assert_eq!(
            hold_from(now, None, midnight, None),
            Some(hold("2026-03-05T00:00:00Z", HoldCause::Budget))
        );
        assert_eq!(
            hold_from(now, None, midnight, Some(now)),
            Some(hold("2026-03-05T00:00:00Z", HoldCause::Budget))
        );
    }

    /// Scenario: the pool figure lifts at half past ten and this install's
    /// window stays full until midnight.
    ///
    /// Expected behaviour: the pool still names the hold while it is live,
    /// and the hold runs to the later end, so the downloads do not resume at
    /// the pool's lift while the install's share still holds them.
    #[test]
    fn the_hold_runs_to_the_later_deferral_and_the_pool_names_it_while_live() {
        let now = at("2026-03-04T10:00:00Z");
        let midnight = Some(at("2026-03-05T00:00:00Z"));
        let pool = Some(at("2026-03-04T10:30:00Z"));
        assert_eq!(
            hold_from(now, None, midnight, pool),
            Some(hold("2026-03-05T00:00:00Z", HoldCause::Pool))
        );
    }
}
