//! Why the engine did not open.
//!
//! Init answered with a bare `bool`, so a database written by a newer build, a
//! file another connection held, and a directory nothing can be written to all
//! reached the banner as the same failure and the same sentence. Two of those
//! three have a remedy and they are different remedies, so the banner needs the
//! reason rather than the fact.
//!
//! This is the sibling of `FfiStartOutcome`, and it is a second type on purpose:
//! a start refuses because something else is happening, init refuses because of
//! the file on disk, and nothing sensible reads both.

use std::sync::atomic::{AtomicU8, Ordering};

/// How the last engine init ended.
///
/// The wire carries the variant's position, so the order here is the contract:
/// append, never reorder. The discriminants start at one so no member is falsy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
#[repr(u8)]
pub enum FfiInitOutcome {
    /// The engine is open. A database that was quarantined and replaced ends
    /// here too: the athlete lost a cache the next sync refills, and the
    /// engine works.
    Opened = 1,
    /// Another connection held the file. The same file opens on the retry, so
    /// nothing is wrong with it and nothing is asked of the athlete.
    Busy = 2,
    /// The database was written by a newer build than this one. It is healthy
    /// and it is deliberately left where it is, so the remedy is to update the
    /// app, never to clear anything.
    ForwardSchema = 3,
    /// Nothing could be written where the database belongs: the directory
    /// could not be created, or an unusable file could not be replaced. A full
    /// disk and a denied permission both land here.
    StorageUnavailable = 4,
    /// Init has not run yet in this process.
    NotAttempted = 5,
    /// The init call itself threw. Rust never answers with this: it is the
    /// outcome TypeScript records when the FFI boundary fails, so a caught
    /// error is still a reason and not another bare `false`.
    Failed = 6,
}

impl FfiInitOutcome {
    /// Whether opening again later can change the answer.
    pub fn is_retryable(self) -> bool {
        matches!(self, FfiInitOutcome::Busy)
    }

    /// Whether the engine is usable.
    pub fn opened(self) -> bool {
        matches!(self, FfiInitOutcome::Opened)
    }

    fn from_wire(value: u8) -> Self {
        match value {
            1 => FfiInitOutcome::Opened,
            2 => FfiInitOutcome::Busy,
            3 => FfiInitOutcome::ForwardSchema,
            4 => FfiInitOutcome::StorageUnavailable,
            6 => FfiInitOutcome::Failed,
            _ => FfiInitOutcome::NotAttempted,
        }
    }
}

/// The last outcome, kept beside the engine rather than returned by init.
///
/// Init's `bool` has sixty-eight call sites in the tests alone and it answers
/// the only question those ask, so the reason is read separately, the way a
/// sync failure's reason is.
static LAST: AtomicU8 = AtomicU8::new(FfiInitOutcome::NotAttempted as u8);

pub(crate) fn record_init_outcome(outcome: FfiInitOutcome) -> bool {
    LAST.store(outcome as u8, Ordering::Release);
    outcome.opened()
}

/// How the last init in this process ended.
pub fn last_init_outcome() -> FfiInitOutcome {
    FfiInitOutcome::from_wire(LAST.load(Ordering::Acquire))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_held_file_lifts_on_its_own() {
        assert!(FfiInitOutcome::Busy.is_retryable());
        for outcome in [
            FfiInitOutcome::Opened,
            FfiInitOutcome::ForwardSchema,
            FfiInitOutcome::StorageUnavailable,
            FfiInitOutcome::NotAttempted,
            FfiInitOutcome::Failed,
        ] {
            assert!(!outcome.is_retryable(), "{outcome:?} does not lift");
        }
    }

    #[test]
    fn recording_returns_whether_the_engine_is_usable() {
        assert!(record_init_outcome(FfiInitOutcome::Opened));
        assert_eq!(last_init_outcome(), FfiInitOutcome::Opened);

        assert!(!record_init_outcome(FfiInitOutcome::ForwardSchema));
        assert_eq!(last_init_outcome(), FfiInitOutcome::ForwardSchema);
    }

    /// A variant this build has no name for reads as "not attempted" rather
    /// than panicking, which is what a binding newer than the crate produces.
    #[test]
    fn an_unknown_wire_value_falls_back() {
        assert_eq!(FfiInitOutcome::from_wire(200), FfiInitOutcome::NotAttempted);
    }
}
