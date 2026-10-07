//! Whether the athlete is touching the screen, pushed over the FFI from TypeScript.
//!
//! A background pass shares the device with the thread that draws the feed.
//! Nothing in this crate can see a gesture, so TypeScript says "interacting"
//! on the first touch and "idle" after a second without one, and a pass that
//! has a boundary between units of work calls [`pause`] there. While the
//! athlete is interacting the pause lengthens the gap by [`GAP`], and
//! otherwise it returns at once.
//!
//! **The value is advisory, and only ever a reason to wait a little longer.**
//! A dropped "idle" push must cost a few seconds of slower background work and
//! never a stalled pass, so a state nobody has refreshed inside [`STALE_AFTER`]
//! expires back to idle. Unset reads as idle for the same reason. Like the
//! network push it is a process-wide value behind a free function, so a push
//! before the engine opens still lands.

use std::sync::Mutex;
use std::time::{Duration, Instant};

/// How long a pass waits at each boundary while the athlete is interacting.
///
/// A tile is tens of milliseconds of work and an elevation batch is one round
/// trip, so a gap of this size leaves the cores idle for most of every unit
/// without making a minutes-long pass noticeably longer once the athlete
/// stops.
pub const GAP: Duration = Duration::from_millis(100);

/// How long an "interacting" push is believed.
///
/// TypeScript restates it every two seconds of a continuous gesture, so a
/// live gesture never ages past this. The window only covers a lost "idle".
pub const STALE_AFTER: Duration = Duration::from_secs(5);

static STATE: Mutex<Option<(bool, Instant)>> = Mutex::new(None);

fn state() -> std::sync::MutexGuard<'static, Option<(bool, Instant)>> {
    STATE.lock().unwrap_or_else(|e| e.into_inner())
}

/// Record what TypeScript sees. Called on the first touch, on every restate
/// during a long gesture, and when a second has passed without one.
pub fn set_interacting(interacting: bool) {
    set_interacting_at(interacting, Instant::now());
}

/// [`set_interacting`] with the moment handed in, so staleness is testable.
pub fn set_interacting_at(interacting: bool, at: Instant) {
    *state() = Some((interacting, at));
}

/// Whether the athlete is touching the screen right now, as far as is known.
///
/// True only for a fresh, pushed interacting. Unset, stale or idle all read
/// as false, so this can never be the reason a pass waits longer than
/// [`STALE_AFTER`] after the last push.
pub fn is_interacting() -> bool {
    matches!(*state(), Some((true, at)) if at.elapsed() < STALE_AFTER)
}

/// The gap a pass takes at a boundary now.
pub fn gap() -> Duration {
    if is_interacting() {
        GAP
    } else {
        Duration::ZERO
    }
}

/// Wait out [`gap`] at a boundary between units of work, returning how long
/// that was. Zero when the athlete is idle.
pub fn pause() -> Duration {
    let wait = gap();
    if !wait.is_zero() {
        std::thread::sleep(wait);
    }
    wait
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
    fn nothing_pushed_reads_as_idle() {
        let _serial = serial_global_state();
        reset();

        assert!(!is_interacting());
        assert_eq!(pause(), Duration::ZERO);
    }

    #[test]
    fn an_interacting_push_lengthens_the_gap_and_an_idle_push_ends_it() {
        let _serial = serial_global_state();
        reset();

        set_interacting(true);
        assert_eq!(gap(), GAP);

        set_interacting(false);
        assert_eq!(gap(), Duration::ZERO);
        assert_eq!(pause(), Duration::ZERO);

        reset();
    }

    /// The last push wins. Two interacting pushes in a row must not outlive
    /// the idle that follows them.
    #[test]
    fn the_last_push_is_the_one_that_counts() {
        let _serial = serial_global_state();
        reset();

        set_interacting(true);
        set_interacting(true);
        set_interacting(false);

        assert!(!is_interacting());
        reset();
    }

    /// Expiry can only shorten the gap. A lost idle must not hold a pass at
    /// the slow rate for ever.
    #[test]
    fn an_interacting_nobody_refreshed_expires_back_to_idle() {
        let _serial = serial_global_state();
        reset();

        set_interacting_at(true, Instant::now() - STALE_AFTER);
        assert!(
            !is_interacting(),
            "a lost idle must not slow the pass for ever"
        );

        set_interacting_at(true, Instant::now() - STALE_AFTER + Duration::from_secs(1));
        assert!(is_interacting(), "inside the window it still counts");

        reset();
    }

    #[test]
    fn a_pause_while_interacting_waits_at_least_the_gap() {
        let _serial = serial_global_state();
        reset();
        set_interacting(true);

        let started = Instant::now();
        let waited = pause();

        assert_eq!(waited, GAP);
        assert!(started.elapsed() >= GAP);
        reset();
    }
}
