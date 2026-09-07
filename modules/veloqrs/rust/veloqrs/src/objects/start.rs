//! The verdict on a request to start exclusive work.
//!
//! Every start in the engine used to answer with a bare `bool`, so "the slot is
//! held, ask again in a moment" and "there is no credential, this will never
//! work" reached TypeScript as the same `false`. Nothing downstream could
//! decide whether to retry, so retries were wired to unrelated edges instead:
//! a reconnect, a foreground, a settled sync. This carries the reason, and with
//! it the only thing a caller actually needs, whether waiting changes anything.

/// Why a start was refused, or that it was not refused at all.
///
/// The wire carries the variant's position, so the order here is the contract:
/// append, never reorder. The discriminants start at one so no member is falsy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
#[repr(u8)]
pub enum FfiStartOutcome {
    /// The job is running.
    Started = 1,
    /// Something else holds the exclusive slot. Asking again once it frees
    /// starts the job unchanged.
    Busy = 2,
    /// A stage that does finish holds the work back: an elevation backfill
    /// mid-flight, or a detector cutover still owed.
    Held = 3,
    /// The engine is not open yet. Nothing is wrong, the caller is early.
    NotReady = 4,
    /// The athlete has to change something before this can run: there is no
    /// credential to sign the call with, or the work is switched off in
    /// Settings. No amount of waiting helps.
    NotConfigured = 5,
    /// There is no work to do. Refusing is the correct answer and will stay
    /// the correct answer.
    NotOwed = 6,
    /// The start threw rather than refusing. Rust never answers with this: it
    /// is the verdict TypeScript records when the FFI call itself fails, so a
    /// caught error is still a reason and not another bare `false`.
    Failed = 7,
    /// The device is offline, and the work needs the network. The engine
    /// sleeps on its own connectivity edge rather than a timer, so a caller
    /// that reads this has somewhere to put the retry.
    Offline = 8,
}

impl FfiStartOutcome {
    /// Whether asking again later can change the answer.
    ///
    /// `Started` is not retryable: it has nothing to retry. This is the whole
    /// point of the type, so it lives in one place and no caller re-derives it.
    pub fn is_retryable(self) -> bool {
        matches!(
            self,
            FfiStartOutcome::Busy
                | FfiStartOutcome::Held
                | FfiStartOutcome::NotReady
                | FfiStartOutcome::Offline
        )
    }

    /// Whether the job is now running.
    pub fn started(self) -> bool {
        matches!(self, FfiStartOutcome::Started)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_started_run_is_not_retryable() {
        assert!(FfiStartOutcome::Started.started());
        assert!(!FfiStartOutcome::Started.is_retryable());
    }

    #[test]
    fn only_the_refusals_that_lift_are_retryable() {
        for outcome in [
            FfiStartOutcome::Busy,
            FfiStartOutcome::Held,
            FfiStartOutcome::NotReady,
            FfiStartOutcome::Offline,
        ] {
            assert!(outcome.is_retryable(), "{outcome:?} lifts on its own");
            assert!(!outcome.started());
        }
        for outcome in [
            FfiStartOutcome::NotConfigured,
            FfiStartOutcome::NotOwed,
            FfiStartOutcome::Failed,
        ] {
            assert!(
                !outcome.is_retryable(),
                "{outcome:?} does not lift on its own"
            );
            assert!(!outcome.started());
        }
    }
}
