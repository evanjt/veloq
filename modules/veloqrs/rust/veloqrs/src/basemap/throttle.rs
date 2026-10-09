//! A tile host that has asked to be left alone.
//!
//! A miss is fetched off the caller's thread, so a 429 or a 503 from the host
//! arrives after the page has already been told a tile is on its way, and can
//! only fail that one tile. The page's throttle backoff counts those two
//! statuses and nothing else, so they must still reach it as themselves. The
//! host's answer is kept here for a short while, and every miss for that
//! source in the meantime is answered with it at once, without a request.

use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

/// How long a 429 or a 503 holds a source's misses. Long enough that a pan's
/// remaining misses do not each ask a host that has just refused, short
/// enough that the next pan asks again rather than drawing nothing.
pub(crate) const HOLD: Duration = Duration::from_secs(10);

static HELD: LazyLock<Mutex<HashMap<String, (u16, Instant)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// Remember that this source's host answered `status`, if it is one that asks
/// to be left alone. Any other status is forgotten at once.
pub(crate) fn remember(source: &str, status: u16, now: Instant) {
    if status != 429 && status != 503 {
        return;
    }
    HELD.lock()
        .unwrap_or_else(|e| e.into_inner())
        .insert(source.to_string(), (status, now + HOLD));
}

/// The status this source's misses are answered with until the hold ends, or
/// `None` when its host may be asked.
pub(crate) fn holding(source: &str, now: Instant) -> Option<u16> {
    let mut held = HELD.lock().unwrap_or_else(|e| e.into_inner());
    match held.get(source) {
        Some(&(status, until)) if now < until => Some(status),
        Some(_) => {
            held.remove(source);
            None
        }
        None => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Each test names its own source, because the table is process-wide and
    /// the suite runs its tests on threads of one process.
    #[test]
    fn a_429_holds_the_source_until_the_hold_ends() {
        let at = Instant::now();
        remember("held-429", 429, at);

        assert_eq!(holding("held-429", at), Some(429));
        assert_eq!(
            holding("held-429", at + HOLD - Duration::from_millis(1)),
            Some(429)
        );
        assert_eq!(holding("held-429", at + HOLD), None);
    }

    #[test]
    fn a_503_crosses_as_itself() {
        let at = Instant::now();
        remember("held-503", 503, at);

        assert_eq!(holding("held-503", at), Some(503));
    }

    #[test]
    fn a_host_failing_in_any_other_way_is_asked_again() {
        let at = Instant::now();
        remember("failing", 500, at);
        remember("failing", 404, at);
        remember("failing", 502, at);

        assert_eq!(holding("failing", at), None);
    }

    #[test]
    fn a_hold_belongs_to_the_source_that_earned_it() {
        let at = Instant::now();
        remember("busy-host", 429, at);

        assert_eq!(holding("quiet-host", at), None);
    }

    #[test]
    fn a_later_refusal_extends_the_hold() {
        let at = Instant::now();
        remember("extended", 429, at);
        remember("extended", 503, at + HOLD / 2);

        assert_eq!(holding("extended", at + HOLD), Some(503));
    }
}
