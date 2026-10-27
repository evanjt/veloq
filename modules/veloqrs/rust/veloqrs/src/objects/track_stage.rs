//! Where the track work behind a sync stands, for the sync status to carry.
//!
//! The metadata sync is one run with one state. The tracks are three pieces of
//! work the engine runs on their own clocks: the GPS pass downloads them, the
//! section detection the stored batch starts reads them, and the heatmap tile
//! pass draws them. Each has its own slot here, and a pass the engine starts
//! by itself, owed from an earlier ask, from a lost connection or from a
//! budget hold, holds the same slot as one a screen asked for. So the engine is the one place that can
//! say which of them is running, and this decides it once for every surface.

use crate::persistence::sections::detection::PHASE_CANCELLED;

/// Which piece of the track work is running.
///
/// The wire carries the variant's position, so the order here is the contract:
/// append, never reorder. The discriminants start at one so no member is falsy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
#[repr(u8)]
pub enum FfiTrackStep {
    /// The GPS pass is downloading tracks.
    Downloading = 1,
    /// Section detection is reading the stored tracks.
    Analysing = 2,
    /// The heatmap tile pass is drawing them.
    DrawingHeatmap = 3,
    /// The GPS pass owes tracks the request budget, or a cooldown intervals.icu
    /// asked for, held back. The engine starts it again at `resumes_at_ms`.
    Held = 4,
}

/// The running piece of the track work and how far it has got.
#[derive(Debug, Clone, Copy, PartialEq, uniffi::Record)]
pub struct FfiTrackStage {
    pub step: FfiTrackStep,
    /// Items the step has handled, of `total`: tracks for the download, tiles
    /// for the heatmap, the current phase's items for detection.
    pub completed: u32,
    /// Zero while the step has not counted its work yet.
    pub total: u32,
    /// The step's own progress, 0 to 100. Detection weights its phases, so
    /// this is not always `completed` of `total`.
    pub percent: u32,
    /// When a held download starts again, as epoch milliseconds. `None` for
    /// every other step. The counts beside it are zero: the window's own
    /// coverage says how many tracks are still owed.
    pub resumes_at_ms: Option<f64>,
    /// Whether intervals.icu asked for the wait, rather than this install's
    /// own request budget. False for every other step.
    pub held_by_upstream: bool,
}

/// A detection run's progress as its handle reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DetectionWork {
    pub phase: String,
    pub completed: u32,
    pub total: u32,
    pub percent: u32,
}

/// A GPS pass the request budget is holding back.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct HeldDownload {
    /// When it starts again, epoch milliseconds.
    pub until_ms: i64,
    pub by_upstream: bool,
}

/// What each slot holds right now. `None` is a slot with nothing running.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct TrackWork {
    /// Tracks the running GPS pass has stored, of the tracks it was given.
    pub download: Option<(u32, u32)>,
    pub detection: Option<DetectionWork>,
    /// Tiles the running heatmap pass has drawn, of the tiles it planned.
    pub heatmap: Option<(u32, u32)>,
    pub held: Option<HeldDownload>,
}

/// The phases a detection run is left in once it has stopped working. The
/// handle stays in its slot until the run is settled, so it can still be read
/// in one of these.
const DETECTION_ENDED: [&str; 3] = ["complete", "aborted", PHASE_CANCELLED];

fn percent_of(completed: u32, total: u32) -> u32 {
    if total == 0 {
        return 0;
    }
    ((u64::from(completed.min(total)) * 100) / u64::from(total)) as u32
}

/// The stage to show, in the order the work runs: the download feeds the
/// detection and both feed the heatmap, so the earliest one running is what
/// the athlete is waiting on. A download the budget holds back is still the
/// download, so it comes before the detection its stored batch started.
pub(crate) fn stage_of(work: &TrackWork) -> Option<FfiTrackStage> {
    if let Some((completed, total)) = work.download {
        return Some(counted(
            FfiTrackStep::Downloading,
            completed.min(total),
            total,
            percent_of(completed, total),
        ));
    }
    if let Some(held) = work.held {
        return Some(FfiTrackStage {
            resumes_at_ms: Some(held.until_ms as f64),
            held_by_upstream: held.by_upstream,
            ..counted(FfiTrackStep::Held, 0, 0, 0)
        });
    }
    if let Some(detection) = work
        .detection
        .as_ref()
        .filter(|d| !DETECTION_ENDED.contains(&d.phase.as_str()))
    {
        return Some(counted(
            FfiTrackStep::Analysing,
            detection.completed,
            detection.total,
            detection.percent.min(100),
        ));
    }
    work.heatmap.map(|(completed, total)| {
        counted(
            FfiTrackStep::DrawingHeatmap,
            completed.min(total),
            total,
            percent_of(completed, total),
        )
    })
}

fn counted(step: FfiTrackStep, completed: u32, total: u32, percent: u32) -> FfiTrackStage {
    FfiTrackStage {
        step,
        completed,
        total,
        percent,
        resumes_at_ms: None,
        held_by_upstream: false,
    }
}

/// The held GPS pass, and whether intervals.icu's cooldown is what holds it.
fn read_held() -> Option<HeldDownload> {
    let until = super::gps_pass::held_until()?;
    Some(HeldDownload {
        until_ms: until.timestamp_millis(),
        by_upstream: crate::net::resume::downloads_hold().is_some_and(|hold| hold.by_upstream),
    })
}

fn read_detection() -> Option<DetectionWork> {
    let guard = crate::persistence::persistent_engine_ffi::SECTION_DETECTION_HANDLE
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    guard.as_ref().map(|handle| {
        let (phase, completed, total) = handle.get_progress();
        DetectionWork {
            phase,
            completed,
            total,
            percent: handle.progress.get_percent(),
        }
    })
}

fn read_heatmap() -> Option<(u32, u32)> {
    if !crate::persistence::tiles::tile_pass_running() {
        return None;
    }
    let guard = crate::persistence::persistent_engine_ffi::TILE_GENERATION_HANDLE
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    Some(
        guard
            .as_ref()
            .map_or((0, 0), |handle| handle.get_progress()),
    )
}

/// Read every slot and decide the stage. Each read takes one short lock and
/// no database, so the sync status stays a cheap snapshot.
pub(crate) fn read() -> Option<FfiTrackStage> {
    stage_of(&TrackWork {
        download: super::gps_pass::running_download(),
        detection: read_detection(),
        heatmap: read_heatmap(),
        held: read_held(),
    })
}

#[cfg(test)]
#[path = "tests/track_stage.rs"]
mod tests;
