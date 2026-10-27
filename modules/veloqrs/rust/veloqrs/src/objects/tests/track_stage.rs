//! Scenario: the metadata sync has settled while the GPS pass, section
//! detection or the heatmap pass is still running.
//!
//! Expected behaviour: the sync status names the one running piece, the
//! earliest in the order the work runs, with its own progress, and names none
//! when nothing is running.

use super::*;

fn detection(phase: &str, percent: u32) -> DetectionWork {
    DetectionWork {
        phase: phase.into(),
        completed: 4,
        total: 9,
        percent,
    }
}

#[test]
fn nothing_running_is_no_stage() {
    assert_eq!(stage_of(&TrackWork::default()), None);
}

#[test]
fn a_download_is_reported_whatever_else_runs_beside_it() {
    let stage = stage_of(&TrackWork {
        download: Some((3, 12)),
        detection: Some(detection("analyzing", 40)),
        heatmap: Some((5, 10)),
        held: None,
    });
    assert_eq!(
        stage,
        Some(FfiTrackStage {
            step: FfiTrackStep::Downloading,
            completed: 3,
            total: 12,
            percent: 25,
            resumes_at_ms: None,
            held_by_upstream: false,
        })
    );
}

#[test]
fn detection_is_reported_once_the_download_ends_with_its_own_weighted_percent() {
    let stage = stage_of(&TrackWork {
        download: None,
        detection: Some(detection("analyzing", 62)),
        heatmap: Some((5, 10)),
        held: None,
    });
    assert_eq!(
        stage,
        Some(FfiTrackStage {
            step: FfiTrackStep::Analysing,
            completed: 4,
            total: 9,
            percent: 62,
            resumes_at_ms: None,
            held_by_upstream: false,
        })
    );
}

#[test]
fn a_detection_run_left_in_an_ending_phase_is_not_analysing() {
    for phase in ["complete", "aborted", "cancelled"] {
        let stage = stage_of(&TrackWork {
            download: None,
            detection: Some(detection(phase, 100)),
            heatmap: None,
            held: None,
        });
        assert_eq!(stage, None, "a run in {phase} is waiting to settle");
    }
}

#[test]
fn the_heatmap_is_reported_when_nothing_before_it_runs() {
    let stage = stage_of(&TrackWork {
        download: None,
        detection: None,
        heatmap: Some((30, 40)),
        held: None,
    });
    assert_eq!(
        stage,
        Some(FfiTrackStage {
            step: FfiTrackStep::DrawingHeatmap,
            completed: 30,
            total: 40,
            percent: 75,
            resumes_at_ms: None,
            held_by_upstream: false,
        })
    );
}

#[test]
fn a_step_that_has_not_counted_its_work_reads_zero_rather_than_dividing_by_it() {
    let download = stage_of(&TrackWork {
        download: Some((0, 0)),
        ..TrackWork::default()
    })
    .unwrap();
    assert_eq!(
        (download.completed, download.total, download.percent),
        (0, 0, 0)
    );

    let heatmap = stage_of(&TrackWork {
        heatmap: Some((0, 0)),
        ..TrackWork::default()
    })
    .unwrap();
    assert_eq!(heatmap.step, FfiTrackStep::DrawingHeatmap);
    assert_eq!(heatmap.percent, 0);
}

#[test]
fn a_count_past_its_total_is_held_at_the_total() {
    let stage = stage_of(&TrackWork {
        download: Some((14, 12)),
        ..TrackWork::default()
    })
    .unwrap();
    assert_eq!((stage.completed, stage.percent), (12, 100));
}

fn held(until_ms: i64, by_upstream: bool) -> Option<HeldDownload> {
    Some(HeldDownload {
        until_ms,
        by_upstream,
    })
}

/// Scenario: the budget held the GPS pass of a widened range back after its
/// first hundred tracks, and the detection the stored batch started is near
/// its end.
///
/// Expected behaviour: the stage is the held download with the time it starts
/// again, not detection's percent, which read as the widened range being
/// almost done while most of its tracks were still owed.
#[test]
fn a_held_download_is_reported_ahead_of_the_detection_beside_it() {
    let stage = stage_of(&TrackWork {
        download: None,
        detection: Some(detection("analyzing", 98)),
        heatmap: Some((5, 10)),
        held: held(1_793_078_100_000, false),
    });
    assert_eq!(
        stage,
        Some(FfiTrackStage {
            step: FfiTrackStep::Held,
            completed: 0,
            total: 0,
            percent: 0,
            resumes_at_ms: Some(1_793_078_100_000.0),
            held_by_upstream: false,
        })
    );
}

/// Expected behaviour: a held pass the engine has started again is a
/// download, and a cooldown intervals.icu asked for says so.
#[test]
fn a_running_download_outranks_the_hold_and_a_refusal_names_itself() {
    let running = stage_of(&TrackWork {
        download: Some((3, 12)),
        held: held(1_793_078_100_000, true),
        ..TrackWork::default()
    })
    .unwrap();
    assert_eq!(running.step, FfiTrackStep::Downloading);

    let refused = stage_of(&TrackWork {
        held: held(1_793_078_100_000, true),
        ..TrackWork::default()
    })
    .unwrap();
    assert_eq!(refused.step, FfiTrackStep::Held);
    assert!(refused.held_by_upstream);
}
