//! The engine's own wake-up after a refusal.
//!
//! A walk that meets a refusal from intervals.icu or a deferral from the
//! request budget stops there and leaves its work owed, so something has to
//! ask again once the refusal lifts, without waiting for the athlete to open
//! the app. One sleeper does that for every job: it wakes at the earliest time
//! any of them was told to come back, or at once when a probe ends the
//! cooldown early, and restarts the sync, both backfills and the upload queue.
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
}
