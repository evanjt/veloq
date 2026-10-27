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

use std::sync::{Condvar, Mutex};

use chrono::{DateTime, Utc};

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

struct Sleeper {
    due: Mutex<Due>,
    wake: Condvar,
}

static SLEEPER: Sleeper = Sleeper {
    due: Mutex::new(Due {
        at: None,
        running: false,
    }),
    wake: Condvar::new(),
};

/// Resume the owed work at `at`, or earlier when a probe ends the cooldown.
pub fn resume_at(at: DateTime<Utc>) {
    let spawn = {
        let mut due = SLEEPER.due.lock().unwrap_or_else(|e| e.into_inner());
        due.schedule(at);
        let spawn = !due.running;
        due.running = true;
        spawn
    };
    SLEEPER.wake.notify_all();
    if spawn {
        spawn_sleeper();
    }
}

/// Why the downloads cannot be restarted yet, and until when.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DownloadsHold {
    pub until: DateTime<Utc>,
    /// Whether intervals.icu asked for the wait (a refusal's cooldown) rather
    /// than this install's own request budget.
    pub by_upstream: bool,
}

/// What a Retry now did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetryNow {
    /// Both downloads were restarted.
    Started,
    /// A hold is in force, so nothing was sent.
    Held(DownloadsHold),
}

/// The hold at `now`, given the refusal cooldown and the backfill's own
/// deferral. A cooldown is intervals.icu's ask, so it names itself first.
fn hold_from(
    now: DateTime<Utc>,
    cooldown: Option<DateTime<Utc>>,
    budget: Option<DateTime<Utc>>,
) -> Option<DownloadsHold> {
    if let Some(until) = cooldown.filter(|until| *until > now) {
        return Some(DownloadsHold {
            until,
            by_upstream: true,
        });
    }
    budget
        .filter(|until| *until > now)
        .map(|until| DownloadsHold {
            until,
            by_upstream: false,
        })
}

/// The hold on the downloads right now, if any.
pub fn downloads_hold() -> Option<DownloadsHold> {
    use crate::governor::{GOVERNOR, Intent};
    let now = Utc::now();
    hold_from(
        now,
        GOVERNOR.cooldown_until(now),
        GOVERNOR.deferred_until(Intent::Backfill, now),
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
    let moved = SLEEPER
        .due
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .bring_forward(Utc::now());
    if moved {
        SLEEPER.wake.notify_all();
    }
}

/// The sleeper's thread: wait for the due time, resume, and end once nothing
/// is pending. The flag is cleared under the same lock that reads the empty
/// schedule, so a wake asked for meanwhile either finds it running or starts
/// another.
#[cfg(not(test))]
fn spawn_sleeper() {
    crate::threads::spawn_background("veloq-resume", || {
        let mut due = SLEEPER.due.lock().unwrap_or_else(|e| e.into_inner());
        loop {
            let now = Utc::now();
            if due.take_due(now) {
                drop(due);
                resume_owed_work();
                due = SLEEPER.due.lock().unwrap_or_else(|e| e.into_inner());
                continue;
            }
            let Some(at) = due.at else {
                due.running = false;
                return;
            };
            let wait = (at - now).to_std().unwrap_or_default();
            due = SLEEPER
                .wake
                .wait_timeout(due, wait)
                .unwrap_or_else(|e| e.into_inner())
                .0;
        }
    });
}

/// The crate's tests share one process, and a sleeper that started the
/// process-wide sync would reach into whichever test runs next. The schedule
/// is tested on its own instead.
#[cfg(test)]
fn spawn_sleeper() {
    SLEEPER
        .due
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .running = false;
}

/// Restart everything a refusal stopped. Each start refuses on its own terms
/// when it has nothing owed, and asks the governor before every request.
#[cfg(not(test))]
fn resume_owed_work() {
    log::info!("[Resume] a refusal has lifted, resuming the owed work");
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

    fn at(s: &str) -> DateTime<Utc> {
        s.parse().expect("instant")
    }

    #[test]
    fn the_earliest_wake_asked_for_wins() {
        let mut due = Due::default();
        due.schedule(at("2026-03-04T10:30:00Z"));
        due.schedule(at("2026-03-04T10:10:00Z"));
        due.schedule(at("2026-03-04T11:00:00Z"));
        assert_eq!(due.at, Some(at("2026-03-04T10:10:00Z")));
    }

    #[test]
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

    fn hold(until: &str, by_upstream: bool) -> DownloadsHold {
        DownloadsHold {
            until: at(until),
            by_upstream,
        }
    }

    /// Expected behaviour: with nothing holding the downloads, Retry now runs
    /// the restart and reports it started.
    #[test]
    fn a_retry_with_no_hold_restarts_the_downloads() {
        let mut restarted = 0;
        let outcome = retry_with(None, || restarted += 1);
        assert_eq!(restarted, 1);
        assert_eq!(outcome, RetryNow::Started);
    }

    /// Expected behaviour: a Retry-After or cooldown in force refuses the
    /// restart, sends nothing and reports when it lifts and who asked.
    #[test]
    fn a_retry_inside_a_hold_restarts_nothing_and_reports_the_time() {
        let mut restarted = 0;
        let held = hold("2026-03-04T10:30:00Z", true);
        let outcome = retry_with(Some(held), || restarted += 1);
        assert_eq!(restarted, 0);
        assert_eq!(outcome, RetryNow::Held(held));
    }

    /// Expected behaviour: the refusal's own cooldown names intervals.icu as
    /// the one that asked, and the install's request budget does not.
    #[test]
    fn the_cooldown_outranks_the_budget_in_naming_who_asked() {
        let now = at("2026-03-04T10:00:00Z");
        let cooldown = Some(at("2026-03-04T10:20:00Z"));
        let budget = Some(at("2026-03-04T10:05:00Z"));
        assert_eq!(
            hold_from(now, cooldown, budget),
            Some(hold("2026-03-04T10:20:00Z", true))
        );
        assert_eq!(
            hold_from(now, None, budget),
            Some(hold("2026-03-04T10:05:00Z", false))
        );
        assert_eq!(hold_from(now, None, None), None);
        assert_eq!(
            hold_from(now, None, Some(now)),
            None,
            "a hold that has lifted is none"
        );
    }
}
