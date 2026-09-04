//! The one connectivity fact Rust has, pushed over the FFI from TypeScript.
//!
//! Nothing in this crate can see the network. `Q65` put the network lifecycle
//! in Rust anyway, on the condition that TypeScript push the state it already
//! computes, so there is one debounce and one edge rather than two: the push
//! comes from the same place that calls `onlineManager.setOnline`
//! (`src/shared/app/NetworkContext.tsx`).
//!
//! **The value is advisory, and only ever a reason to refuse.** A missed push
//! would leave Rust declining work on a live connection, which is worse than
//! never knowing, so a state nobody has refreshed inside [`STALE_AFTER`]
//! expires back to "try" and the transport's own failure handling carries it
//! from there. Unset reads as "try" for the same reason: an install that never
//! pushes behaves exactly as it did before this existed.

use std::sync::Mutex;
use std::time::{Duration, Instant};

/// How long a pushed state is believed. TypeScript pushes on every transition
/// and on foreground, so a value older than this means a push was missed
/// rather than that the network has been down this whole time.
pub const STALE_AFTER: Duration = Duration::from_secs(15 * 60);

static STATE: Mutex<Option<(bool, Instant)>> = Mutex::new(None);

fn state() -> std::sync::MutexGuard<'static, Option<(bool, Instant)>> {
    STATE.lock().unwrap_or_else(|e| e.into_inner())
}

/// Record what TypeScript sees. Called on every transition and on foreground.
pub fn set_online(online: bool) {
    set_online_at(online, Instant::now());
}

/// [`set_online`] with the moment handed in, so staleness is testable.
pub fn set_online_at(online: bool, at: Instant) {
    *state() = Some((online, at));
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
}
