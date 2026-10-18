//! The one shape every engine run handle answers in.
//!
//! A run handle is an object TypeScript starts work through and then watches
//! until it ends. Each used to carry its own spelling of the same four steps:
//! a status string from one poll and a progress record from another, a result
//! taken under one name or not at all, and a cancel answering nothing, a bool
//! or a `Result`. A screen following two of them had to learn both, and a
//! status word one side renamed reached the other as a state nobody handled.
//!
//! So a handle has four members and no others for the run:
//!
//! - `start(..) -> FfiStartResult`, the typed verdict from `start.rs`.
//! - `progress() -> FfiRunProgress`, where the run stands and how far along it
//!   is, in one read rather than a status poll beside a progress poll.
//! - `take() -> Option<T>`, the run's result, once.
//! - `cancel() -> bool`, whether a run was there to be asked to stop.

/// Where a run stands.
///
/// The wire carries the variant's position, so the order here is the
/// contract: append, never reorder. The discriminants start at one so no
/// member is falsy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
#[repr(u8)]
pub enum FfiRunState {
    /// No run holds the slot, and none has finished untaken.
    Idle = 1,
    /// A run holds the slot and has not ended.
    Running = 2,
    /// The run ended with a result, which `take` hands over.
    Complete = 3,
    /// The run was asked to stop and did, and has no result.
    Cancelled = 4,
    /// The run ended without a result: it failed, or its worker died.
    Failed = 5,
    /// The run looked at its input and declined to produce from it, because
    /// too little of it could be read. Not a failure of the run: asking again
    /// over the same input answers the same.
    Refused = 6,
}

impl FfiRunState {
    /// Whether the run has ended, however it ended.
    pub fn ended(self) -> bool {
        !matches!(self, FfiRunState::Idle | FfiRunState::Running)
    }
}

/// Where a run stands and how far along it is, read in one call.
///
/// The counters describe the current phase only. `percent` is the run's own
/// estimate across every phase, so a bar can move monotonically while the
/// counters restart at each phase.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FfiRunProgress {
    pub state: FfiRunState,
    /// The phase the run is in, such as "loading" or "analyzing". Empty when
    /// the run has no phases or none is running.
    pub phase: String,
    /// Items done in the current phase.
    pub completed: u32,
    /// Items in the current phase, 0 when the run cannot count them.
    pub total: u32,
    /// Phase-weighted overall percent, 0 to 100.
    pub percent: u32,
}

impl FfiRunProgress {
    /// A run in `state` with nothing counted.
    pub fn at(state: FfiRunState) -> Self {
        Self {
            state,
            phase: String::new(),
            completed: 0,
            total: 0,
            percent: if state == FfiRunState::Complete {
                100
            } else {
                0
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_idle_and_running_have_not_ended() {
        for state in [FfiRunState::Idle, FfiRunState::Running] {
            assert!(!state.ended(), "{state:?} has not ended");
        }
        for state in [
            FfiRunState::Complete,
            FfiRunState::Cancelled,
            FfiRunState::Failed,
            FfiRunState::Refused,
        ] {
            assert!(state.ended(), "{state:?} has ended");
        }
    }

    #[test]
    fn a_complete_run_with_nothing_counted_is_at_one_hundred_percent() {
        assert_eq!(FfiRunProgress::at(FfiRunState::Complete).percent, 100);
        assert_eq!(FfiRunProgress::at(FfiRunState::Running).percent, 0);
    }
}
