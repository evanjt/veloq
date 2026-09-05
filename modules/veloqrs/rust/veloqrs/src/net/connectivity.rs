//! The one connectivity fact Rust has, pushed over the FFI from TypeScript.
//!
//! Nothing in this crate can see the network. The lifecycle is Rust's anyway,
//! on the condition that TypeScript push the state it already computes, so
//! there is one debounce and one edge rather than two: the push
//! comes from the same place that calls `onlineManager.setOnline`
//! (`src/shared/app/NetworkContext.tsx`).
//!
//! **The value is advisory, and only ever a reason to refuse.** A missed push
//! would leave Rust declining work on a live connection, which is worse than
//! never knowing, so a state nobody has refreshed inside [`STALE_AFTER`]
//! expires back to "try" and the transport's own failure handling carries it
//! from there. Unset reads as "try" for the same reason: an install that never
//! pushes behaves exactly as it did before this existed.
//!
//! The one thing scheduled work waits on is the connection coming back, so a
//! transition to online is also an edge a sleeper can be woken by, through
//! [`sleep_or_online_edge`]. The elevation backfill's resume ladder sleeps on
//! it rather than through it.

use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

/// How long a pushed state is believed. TypeScript pushes on every transition
/// and on foreground, so a value older than this means a push was missed
/// rather than that the network has been down this whole time.
pub const STALE_AFTER: Duration = Duration::from_secs(15 * 60);

static STATE: Mutex<Option<(bool, Instant)>> = Mutex::new(None);

/// How many times the state has gone from not online to online. A sleeper
/// compares this against the count it started with, so an edge that landed
/// before the sleep began is not mistaken for one during it.
static ONLINE_EDGES: Mutex<u64> = Mutex::new(0);
static ONLINE_EDGE: Condvar = Condvar::new();

fn state() -> std::sync::MutexGuard<'static, Option<(bool, Instant)>> {
    STATE.lock().unwrap_or_else(|e| e.into_inner())
}

fn edges() -> std::sync::MutexGuard<'static, u64> {
    ONLINE_EDGES.lock().unwrap_or_else(|e| e.into_inner())
}

/// Record what TypeScript sees. Called on every transition and on foreground.
pub fn set_online(online: bool) {
    set_online_at(online, Instant::now());
}

/// [`set_online`] with the moment handed in, so staleness is testable.
pub fn set_online_at(online: bool, at: Instant) {
    let was_online = state()
        .replace((online, at))
        .is_some_and(|(online, _)| online);
    if online && !was_online {
        *edges() += 1;
        ONLINE_EDGE.notify_all();
    }
}

/// Sleep for `wait`, or until the connection comes back, whichever is first.
///
/// True when an online edge cut the sleep short. Only a transition counts: a
/// push that repeats the online already held, an offline push, and an edge
/// that landed before this was called all leave the sleeper waiting.
pub fn sleep_or_online_edge(wait: Duration) -> bool {
    let deadline = Instant::now() + wait;
    let mut seen = edges();
    let at_start = *seen;
    loop {
        if *seen != at_start {
            return true;
        }
        let now = Instant::now();
        if now >= deadline {
            return false;
        }
        seen = ONLINE_EDGE
            .wait_timeout(seen, deadline - now)
            .unwrap_or_else(|e| e.into_inner())
            .0;
    }
}

/// Whether outbound work should be refused right now.
///
/// True only for a fresh, pushed offline. Unset, stale, or online all read as
/// "try", so this can never be the reason a live connection goes unused for
/// longer than [`STALE_AFTER`].
pub fn is_offline() -> bool {
    matches!(*state(), Some((false, at)) if at.elapsed() < STALE_AFTER)
}

/// What was last pushed, and how long ago, for logging and for the read the
/// FFI hands back. `None` means nothing has ever been pushed.
pub fn last_push() -> Option<(bool, Duration)> {
    state().map(|(online, at)| (online, at.elapsed()))
}

/// Forget everything pushed, returning the process to its never-pushed state.
#[cfg(test)]
pub fn reset() {
    *state() = None;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_globals::serial_global_state;

    #[test]
    fn nothing_pushed_reads_as_try() {
        let _serial = serial_global_state();
        reset();

        assert!(!is_offline());
        assert_eq!(last_push(), None);
    }

    #[test]
    fn a_pushed_offline_refuses_and_a_pushed_online_releases() {
        let _serial = serial_global_state();
        reset();

        set_online(false);
        assert!(is_offline());

        set_online(true);
        assert!(!is_offline(), "the release edge has to land as well");

        reset();
    }

    /// The last push wins. Two offline pushes in a row must not stack into a
    /// state that outlives the online that follows them.
    #[test]
    fn the_last_push_is_the_one_that_counts() {
        let _serial = serial_global_state();
        reset();

        set_online(false);
        set_online(false);
        set_online(true);
        set_online(false);

        assert!(is_offline());
        reset();
    }

    #[test]
    fn an_offline_nobody_refreshed_expires_back_to_try() {
        let _serial = serial_global_state();
        reset();

        set_online_at(false, Instant::now() - STALE_AFTER);
        assert!(!is_offline(), "a missed push must not strand the queue");

        set_online_at(
            false,
            Instant::now() - STALE_AFTER + Duration::from_secs(30),
        );
        assert!(is_offline(), "inside the window it still counts");

        reset();
    }

    /// Expiry can only open the gate. An online that goes stale must not flip
    /// to a refusal, which is the one direction that would cost work.
    #[test]
    fn a_stale_online_never_becomes_a_refusal() {
        let _serial = serial_global_state();
        reset();

        set_online_at(true, Instant::now() - STALE_AFTER * 4);
        assert!(!is_offline());

        reset();
    }

    #[test]
    fn the_push_reports_its_own_age() {
        let _serial = serial_global_state();
        reset();

        set_online_at(false, Instant::now() - Duration::from_secs(60));
        let (online, age) = last_push().expect("a push was recorded");

        assert!(!online);
        assert!(age >= Duration::from_secs(60));

        reset();
    }
    /// The one thing a sleeper can be woken by is the connection coming
    /// back. A push that repeats the online it already had is not an edge.
    #[test]
    fn an_online_edge_wakes_a_sleeper_before_its_time() {
        let _serial = serial_global_state();
        reset();
        set_online(false);

        let waker = std::thread::spawn(|| {
            std::thread::sleep(Duration::from_millis(50));
            set_online(true);
        });
        let started = Instant::now();
        let woken = sleep_or_online_edge(Duration::from_secs(30));
        waker.join().unwrap();

        assert!(woken, "the edge has to cut the sleep short");
        assert!(started.elapsed() < Duration::from_secs(5));
        reset();
    }

    #[test]
    fn a_sleep_nobody_wakes_runs_to_its_deadline() {
        let _serial = serial_global_state();
        reset();
        set_online(true);

        let started = Instant::now();
        let woken = sleep_or_online_edge(Duration::from_millis(100));

        assert!(!woken);
        assert!(started.elapsed() >= Duration::from_millis(100));
        reset();
    }

    #[test]
    fn a_repeated_online_is_not_an_edge() {
        let _serial = serial_global_state();
        reset();
        set_online(true);

        let waker = std::thread::spawn(|| {
            std::thread::sleep(Duration::from_millis(20));
            set_online(true);
        });
        let woken = sleep_or_online_edge(Duration::from_millis(150));
        waker.join().unwrap();

        assert!(
            !woken,
            "a foreground re-push of the same state must not wake anything"
        );
        reset();
    }

    #[test]
    fn an_offline_push_is_not_an_edge() {
        let _serial = serial_global_state();
        reset();
        set_online(true);

        let waker = std::thread::spawn(|| {
            std::thread::sleep(Duration::from_millis(20));
            set_online(false);
        });
        let woken = sleep_or_online_edge(Duration::from_millis(150));
        waker.join().unwrap();

        assert!(!woken);
        reset();
    }

    /// An edge that landed before the sleep began was already acted on by
    /// whatever ran between them. Only an edge during the sleep counts.
    #[test]
    fn an_edge_before_the_sleep_does_not_count() {
        let _serial = serial_global_state();
        reset();
        set_online(false);
        set_online(true);

        let woken = sleep_or_online_edge(Duration::from_millis(100));

        assert!(!woken);
        reset();
    }
}
