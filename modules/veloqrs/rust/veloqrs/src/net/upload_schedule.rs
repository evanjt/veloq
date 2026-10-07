//! When the recording upload queue is due, decided in Rust, and the drain that
//! follows.
//!
//! One worker sleeps until the earliest pending recording is due or the
//! connection comes back, then drains the queue itself through
//! `upload_recording::drain`, in the foreground or not.
//!
//! The worker re-reads the queue on every wake and never trusts a clock it
//! computed earlier. Anything that can make a recording due sooner than the
//! sleeper believes nudges it (a recording saved, a ride requeued, a failed
//! attempt that set a new backoff, the athlete granting write permission).

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use crate::net::connectivity;
use crate::net::upload_recording::{Live, drain};
use crate::objects::error::with_reader;
use crate::persistence::recordings::pooled;

/// How long the worker rests when nothing wakes it: with nothing pending, while
/// offline, and after a drain. A drain stops on an outcome the rest of the
/// queue would meet too, a refused credential among them, which sets no
/// backoff, so resting here is what keeps that ride from being sent in a loop.
pub const RESTING_WAIT: Duration = Duration::from_secs(5 * 60);

/// The schedule, with everything it reads and does handed in.
///
/// `next_due` answers the epoch millisecond the earliest pending recording is
/// due at, `None` when nothing is pending or the queue cannot be read. `wait`
/// sleeps for at most the duration and returns false to end the loop, which is
/// how a test stops it and nothing else.
pub fn schedule_loop(
    mut now_ms: impl FnMut() -> i64,
    mut next_due: impl FnMut() -> Option<i64>,
    mut wait: impl FnMut(Duration) -> bool,
    mut offline: impl FnMut() -> bool,
    mut drain: impl FnMut(),
) {
    loop {
        let rest = match next_due() {
            None => RESTING_WAIT,
            Some(due) if due > now_ms() => {
                Duration::from_millis((due - now_ms()) as u64).min(RESTING_WAIT)
            }
            Some(_) if offline() => RESTING_WAIT,
            Some(_) => {
                drain();
                RESTING_WAIT
            }
        };
        if !wait(rest) {
            return;
        }
    }
}

static RUNNING: AtomicBool = AtomicBool::new(false);

/// Start the worker if it is not running, and wake it either way.
///
/// Idempotent: the app calls it when the engine is ready and again after the
/// athlete grants write permission.
pub fn start_or_wake() {
    if RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_ok()
    {
        crate::threads::spawn_named("veloq-upsched", || {
            schedule_loop(
                || chrono::Utc::now().timestamp_millis(),
                || {
                    with_reader(pooled::next_due_at)
                        .ok()
                        .and_then(Result::ok)
                        .flatten()
                },
                |wait| {
                    connectivity::sleep_or_online_edge_or_nudge(wait);
                    true
                },
                connectivity::is_offline,
                || drain(&Live, &|| chrono::Utc::now().timestamp_millis()),
            );
        });
    }
    connectivity::nudge();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    /// Runs `schedule_loop` over a scripted clock: each wake advances time by
    /// the slept duration (or by the scripted jump), and the loop stops after
    /// `wakes` of them. Returns how many drains ran and how long each wait was.
    struct Run {
        drained: usize,
        waits: Vec<Duration>,
    }

    fn run(
        start: i64,
        due: impl Fn(i64) -> Option<i64>,
        offline: impl Fn(i64) -> bool,
        wakes: usize,
    ) -> Run {
        let now = Cell::new(start);
        let drained = Cell::new(0);
        let waits = RefCell::new(Vec::new());
        schedule_loop(
            || now.get(),
            || due(now.get()),
            |wait| {
                waits.borrow_mut().push(wait);
                now.set(now.get() + wait.as_millis() as i64);
                waits.borrow().len() < wakes
            },
            || offline(now.get()),
            || drained.set(drained.get() + 1),
        );
        Run {
            drained: drained.get(),
            waits: waits.into_inner(),
        }
    }

    #[test]
    fn nothing_pending_drains_nothing() {
        let r = run(1_000, |_| None, |_| false, 3);
        assert_eq!(r.drained, 0);
    }

    #[test]
    fn a_due_ride_online_is_drained() {
        let r = run(1_000, |_| Some(0), |_| false, 1);
        assert_eq!(r.drained, 1);
    }

    #[test]
    fn a_due_ride_while_offline_is_not_drained() {
        let r = run(1_000, |_| Some(0), |_| true, 3);
        assert_eq!(r.drained, 0);
    }

    #[test]
    fn a_ride_due_later_sleeps_to_its_time_then_drains_once() {
        let r = run(
            1_000,
            |now| {
                Some(if now < 1_000 + 20_000 {
                    21_000
                } else {
                    i64::MAX
                })
            },
            |_| false,
            2,
        );
        assert_eq!(r.waits[0], Duration::from_secs(20));
        assert_eq!(r.drained, 0, "nothing is due before its time");

        let r = run(21_000, |_| Some(21_000), |_| false, 1);
        assert_eq!(r.drained, 1);
    }

    #[test]
    fn a_far_off_due_time_is_re_read_within_the_resting_wait() {
        let r = run(0, |_| Some(i64::MAX / 2), |_| false, 1);
        assert_eq!(r.waits[0], RESTING_WAIT);
    }

    #[test]
    fn a_ride_still_due_after_a_drain_is_drained_again_after_resting() {
        let r = run(0, |_| Some(0), |_| false, 3);
        assert_eq!(r.drained, 3);
        assert!(r.waits.iter().all(|w| *w == RESTING_WAIT));
    }

    #[test]
    fn coming_back_online_drains_a_due_ride_at_the_next_wake() {
        let r = run(
            0,
            |_| Some(0),
            |now| now < RESTING_WAIT.as_millis() as i64,
            3,
        );
        assert_eq!(r.drained, 2, "silent while offline, then once per wake");
    }
}
