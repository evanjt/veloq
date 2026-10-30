//! Why the routes or sections catalogue is empty.
//!
//! An empty list has several causes that end differently: a library with no
//! GPS tracks never fills, a detect that has not run will, a held detect waits
//! on whatever holds it, and a detect that found nothing needs more repeats.
//! The engine knows each of these, so it names the cause once and both lists
//! render it.

use rusqlite::Connection;

use crate::{FfiCatalogueEmptyReason, FfiDetectionHold};

/// The detection state an empty catalogue is explained from, read once per
/// screen read and shared by both lists.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DetectionState {
    /// Stored activities with a GPS track.
    pub gps_activities: u64,
    /// Of those, the ones no detect has seen.
    pub awaiting: u64,
    /// The running detect's phase and percent.
    pub running: Option<(String, u32)>,
    /// What is refusing a detect, ranked as the sections page ranks it.
    pub hold: Option<FfiDetectionHold>,
}

/// The reason for a catalogue that holds nothing. `min_activities` is the
/// threshold the catalogue's own detector applies.
///
/// A held detect only explains an empty list while something is owed: the
/// elevation download also holds a library every detect has already seen, and
/// there the honest answer is that nothing was found.
pub(crate) fn empty_reason(state: &DetectionState, min_activities: u32) -> FfiCatalogueEmptyReason {
    if state.gps_activities == 0 {
        return FfiCatalogueEmptyReason::NoGpsActivities;
    }
    if let Some((phase, percent)) = &state.running {
        return FfiCatalogueEmptyReason::Running {
            phase: phase.clone(),
            percent: *percent,
        };
    }
    let cutover_owed = state.hold == Some(FfiDetectionHold::Cutover);
    if state.awaiting > 0 || cutover_owed {
        if let Some(hold) = &state.hold {
            return FfiCatalogueEmptyReason::Held { hold: hold.clone() };
        }
        return FfiCatalogueEmptyReason::NotYetRun {
            awaiting: saturating_u32(state.awaiting),
        };
    }
    FfiCatalogueEmptyReason::NoneFound { min_activities }
}

/// The detection state from committed rows and the process's running jobs. A
/// count that cannot be read counts as nothing owed, which leaves the list on
/// the reason the other figures give rather than on a hold nobody can see.
pub(crate) fn detection_state(conn: &Connection) -> DetectionState {
    DetectionState {
        gps_activities: super::activities::pooled::activity_count(conn).unwrap_or(0) as u64,
        awaiting: super::sections::pooled::activities_awaiting_detection(conn).unwrap_or(0),
        running: running_detect(),
        hold: detection_hold(conn),
    }
}

fn running_detect() -> Option<(String, u32)> {
    let handle = super::persistent_engine_ffi::SECTION_DETECTION_HANDLE
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    handle
        .as_ref()
        .map(|handle| (handle.get_progress().0, handle.progress.get_percent()))
}

/// What refuses a detect, in the order the sections page ranks it. The
/// elevation download answers ahead of the cutover because it runs first and
/// the cutover waits behind it, and a pause answers ahead of a pass because
/// the pause is what the athlete has to lift. A pause with nothing left to
/// download holds nothing up.
fn detection_hold(conn: &Connection) -> Option<FfiDetectionHold> {
    use crate::net::elevation_backfill as backfill;
    let elevation_running =
        backfill::backfill_progress().phase == backfill::BACKFILL_PHASE_FETCHING;
    let remaining = if elevation_running {
        None
    } else {
        backfill::pooled_elevation_backfill_remaining(conn).ok()
    };
    hold_from(
        backfill::elevation_backfill_paused(),
        elevation_running,
        remaining.unwrap_or(0),
        super::cutover::pooled::cutover_holds_detection(conn),
    )
}

/// The ranking of [`detection_hold`] over its inputs. Owed elevation waits a
/// detect only while the cutover is still owed: once the new catalogue is
/// promoted, new activities detect and the owed history joins as it downloads,
/// which is progress and not a hold.
fn hold_from(
    paused: bool,
    elevation_running: bool,
    remaining: u64,
    cutover_holds: bool,
) -> Option<FfiDetectionHold> {
    let owed = remaining > 0;
    if paused && (owed || elevation_running) {
        return Some(FfiDetectionHold::ElevationPaused);
    }
    if elevation_running {
        return Some(FfiDetectionHold::ElevationRunning);
    }
    if owed && cutover_holds {
        return Some(FfiDetectionHold::ElevationWaiting {
            remaining: saturating_u32(remaining),
        });
    }
    if cutover_holds {
        return Some(FfiDetectionHold::Cutover);
    }
    None
}

fn saturating_u32(n: u64) -> u32 {
    n.try_into().unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resting(gps_activities: u64, awaiting: u64) -> DetectionState {
        DetectionState {
            gps_activities,
            awaiting,
            running: None,
            hold: None,
        }
    }

    #[test]
    fn owed_elevation_waits_a_detect_only_while_the_cutover_is_owed() {
        assert_eq!(
            hold_from(false, false, 7, true),
            Some(FfiDetectionHold::ElevationWaiting { remaining: 7 })
        );
        assert_eq!(hold_from(false, false, 7, false), None);
        assert_eq!(
            hold_from(false, false, 0, true),
            Some(FfiDetectionHold::Cutover)
        );
        assert_eq!(hold_from(false, false, 0, false), None);
    }

    #[test]
    fn a_running_or_paused_download_holds_after_the_cutover_too() {
        assert_eq!(
            hold_from(false, true, 0, false),
            Some(FfiDetectionHold::ElevationRunning)
        );
        assert_eq!(
            hold_from(true, false, 7, false),
            Some(FfiDetectionHold::ElevationPaused)
        );
        assert_eq!(hold_from(true, false, 0, false), None);
    }

    #[test]
    fn no_gps_answers_ahead_of_a_running_detect_and_a_hold() {
        let state = DetectionState {
            running: Some(("loading".into(), 10)),
            hold: Some(FfiDetectionHold::ElevationRunning),
            ..resting(0, 0)
        };
        assert_eq!(
            empty_reason(&state, 2),
            FfiCatalogueEmptyReason::NoGpsActivities
        );
    }

    #[test]
    fn a_running_detect_answers_with_its_phase_and_percent() {
        let state = DetectionState {
            running: Some(("analyzing".into(), 42)),
            hold: Some(FfiDetectionHold::ElevationWaiting { remaining: 3 }),
            ..resting(5, 5)
        };
        assert_eq!(
            empty_reason(&state, 2),
            FfiCatalogueEmptyReason::Running {
                phase: "analyzing".into(),
                percent: 42
            }
        );
    }

    #[test]
    fn a_hold_answers_only_while_a_detect_is_owed() {
        let held = DetectionState {
            hold: Some(FfiDetectionHold::ElevationPaused),
            ..resting(5, 1)
        };
        assert_eq!(
            empty_reason(&held, 2),
            FfiCatalogueEmptyReason::Held {
                hold: FfiDetectionHold::ElevationPaused
            }
        );
        let seen = DetectionState {
            hold: Some(FfiDetectionHold::ElevationPaused),
            ..resting(5, 0)
        };
        assert_eq!(
            empty_reason(&seen, 2),
            FfiCatalogueEmptyReason::NoneFound { min_activities: 2 }
        );
    }

    #[test]
    fn an_owed_cutover_holds_a_library_every_detect_has_seen() {
        let state = DetectionState {
            hold: Some(FfiDetectionHold::Cutover),
            ..resting(5, 0)
        };
        assert_eq!(
            empty_reason(&state, 3),
            FfiCatalogueEmptyReason::Held {
                hold: FfiDetectionHold::Cutover
            }
        );
    }

    #[test]
    fn unseen_activities_with_nothing_holding_read_as_not_yet_run() {
        assert_eq!(
            empty_reason(&resting(5, 4), 2),
            FfiCatalogueEmptyReason::NotYetRun { awaiting: 4 }
        );
    }

    #[test]
    fn a_library_every_detect_has_seen_carries_the_threshold() {
        assert_eq!(
            empty_reason(&resting(5, 0), 3),
            FfiCatalogueEmptyReason::NoneFound { min_activities: 3 }
        );
    }
}
