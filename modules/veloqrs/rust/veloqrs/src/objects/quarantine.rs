//! That the library was replaced, and what survived it.
//!
//! A database that cannot be opened or migrated is renamed aside and a fresh
//! one takes its place, which is the right call: the alternative is an engine
//! that is bricked on every launch. But init then reports success, so the
//! athlete opens the app to an empty library, no message, and a sync that
//! starts from scratch. The only record was a `log::warn`, which release keeps
//! and nobody reads.
//!
//! `salvage_ledger_from` already counts what it rescued, so the engine knows
//! both that a quarantine happened and how much came across. This is where
//! that is kept until the app asks, once.

use std::sync::Mutex;

use crate::persistence::sections::SalvageCounts;

/// One quarantine, and what came out of the file it replaced.
///
/// Every count is a row a rebuild cannot re-derive. The catalogue is not here
/// because it is a cache the next sync refills, which is the whole reason a
/// quarantine is safe.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Record)]
pub struct FfiQuarantineReport {
    /// Section lifecycle events carried over.
    pub history: u32,
    /// Section geometry versions carried over.
    pub geometry: u32,
    /// Pinned geometry versions carried over.
    pub pins: u32,
    /// User-owned sections: drawn, accepted, renamed, trimmed.
    pub sections: u32,
    /// Suppressions, whose contract is that a removed corridor stays removed.
    pub intents: u32,
}

/// The quarantine this process did, until something reads it.
///
/// A `Mutex<Option<_>>` rather than an atomic, because five counts do not fit
/// in one and they have to arrive together: a reader that saw the flag set and
/// the counts half written would report a salvage that did not happen.
static LAST: Mutex<Option<FfiQuarantineReport>> = Mutex::new(None);

pub(crate) fn record_quarantine(salvaged: &SalvageCounts) {
    let report = FfiQuarantineReport {
        history: salvaged.history as u32,
        geometry: salvaged.geometry as u32,
        pins: salvaged.pins as u32,
        sections: salvaged.sections as u32,
        intents: salvaged.intents as u32,
    };
    *LAST.lock().unwrap_or_else(|e| e.into_inner()) = Some(report);
}

/// The quarantine this launch did, if there was one, and never twice.
///
/// Taken rather than read: what it feeds is a one-time notice, and a notice
/// that survives its own dismissal is the shape a banner takes when it outlives
/// the resync. A launch that opened the file it was given answers `None`.
#[uniffi::export]
pub fn take_quarantine_report() -> Option<FfiQuarantineReport> {
    LAST.lock().unwrap_or_else(|e| e.into_inner()).take()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn counts() -> SalvageCounts {
        SalvageCounts {
            history: 4,
            geometry: 3,
            pins: 2,
            sections: 1,
            intents: 5,
        }
    }

    #[test]
    fn a_launch_with_no_quarantine_has_nothing_to_report() {
        take_quarantine_report();
        assert_eq!(take_quarantine_report(), None);
    }

    #[test]
    fn the_counts_arrive_whole_and_only_once() {
        take_quarantine_report();
        record_quarantine(&counts());

        let report = take_quarantine_report().expect("recorded");
        assert_eq!(report.history, 4);
        assert_eq!(report.geometry, 3);
        assert_eq!(report.pins, 2);
        assert_eq!(report.sections, 1);
        assert_eq!(report.intents, 5);

        assert_eq!(take_quarantine_report(), None);
    }

    /// Two quarantines in one process is a fresh database that failed too, and
    /// the second is the one that stands.
    #[test]
    fn a_second_quarantine_replaces_the_first() {
        take_quarantine_report();
        record_quarantine(&counts());
        record_quarantine(&SalvageCounts {
            history: 0,
            geometry: 0,
            pins: 0,
            sections: 0,
            intents: 0,
        });

        assert_eq!(take_quarantine_report().expect("recorded").history, 0);
    }
}
