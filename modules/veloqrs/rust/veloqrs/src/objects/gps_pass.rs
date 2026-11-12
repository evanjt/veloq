//! The GPS track pass: one bulk download of every track the census still owes
//! over a date range.
//!
//! The engine owns when a pass runs. One runs at a time. A pass asked for while
//! one is downloading is kept owed and started when that one ends, and a pass
//! that ended because the connection dropped, or was asked for offline, is kept
//! owed to the connection and started on the online edge. The screen that
//! follows a pass asks for it and renders its progress, and schedules nothing.

use std::sync::{Arc, LazyLock, Mutex};

use chrono::{DateTime, Utc};

use super::start::FfiStartOutcome;
use crate::ffi::ActivitySportMapping;

/// The range a pass reads its candidates over, and the ids the screen wants
/// fetched first, in that order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PassRange {
    pub oldest: String,
    pub newest: String,
    pub head: Vec<String>,
}

impl PassRange {
    /// One owed pass standing for two asks: the span both covered, ordered by
    /// the later ask's head. Dates are ISO, so they order as strings.
    fn widened(self, later: PassRange) -> PassRange {
        PassRange {
            oldest: self.oldest.min(later.oldest),
            newest: self.newest.max(later.newest),
            head: later.head,
        }
    }
}

/// What starting a pass answered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct PassStart {
    pub outcome: FfiStartOutcome,
    /// The fetch run to follow, 0 when nothing started.
    pub run: u64,
    /// How many tracks the run was given.
    pub total: u32,
}

impl PassStart {
    fn refused(outcome: FfiStartOutcome) -> Self {
        Self {
            outcome,
            run: 0,
            total: 0,
        }
    }
}

/// The pass holding the slot.
struct Running {
    range: PassRange,
    /// Which taking of the slot this is, so a start that returns after its own
    /// pass has already ended cannot name its run against a later one.
    taken: u64,
    /// The fetch run downloading it, once its start has returned.
    run: Option<u64>,
}

#[derive(Default)]
struct PassState {
    /// The pass downloading now.
    running: Option<Running>,
    /// How many times the slot has been taken.
    taken: u64,
    /// A pass asked for while one ran, started when it ends.
    owed: Option<PassRange>,
    /// A pass the connection cost, started on the online edge.
    owed_to_reconnect: Option<PassRange>,
    /// A pass the request budget held back, started when the hold lifts.
    owed_to_budget: Option<PassRange>,
    /// When that hold lifts.
    held_until: Option<DateTime<Utc>>,
    /// How many passes in a row ended on the network while the device was
    /// online, which sets how long the next retry waits.
    lost_online: u32,
}

impl PassState {
    /// Take the slot for `range`, answering which taking it is.
    fn take_slot(&mut self, range: PassRange) -> u64 {
        self.taken += 1;
        self.running = Some(Running {
            range,
            taken: self.taken,
            run: None,
        });
        self.taken
    }
}

fn owe_into(slot: &mut Option<PassRange>, range: PassRange) {
    *slot = Some(match slot.take() {
        Some(earlier) => earlier.widened(range),
        None => range,
    });
}

/// How long the first retry waits after a pass is lost to the network while
/// the device is online. Each further loss in a row doubles it, up to the cap.
const RETRY_BASE: chrono::Duration = chrono::Duration::seconds(15);
const RETRY_CAP: chrono::Duration = chrono::Duration::minutes(5);

/// How long to wait before retrying after `losses` online losses in a row.
fn retry_delay(losses: u32) -> chrono::Duration {
    let doublings = losses.saturating_sub(1).min(10);
    (RETRY_BASE * 2_i32.pow(doublings)).min(RETRY_CAP)
}

/// How a pass ended, which decides what starts it again.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PassEnd {
    /// Every track it was given landed, was refused for good or failed for good.
    Settled,
    /// A track failed because the connection did.
    NetworkLost,
    /// The request budget, or a refusal's cooldown, sent nothing for some of
    /// its tracks before this instant.
    HeldUntil(DateTime<Utc>),
}

type StartPass = Box<dyn Fn(&PassRange) -> PassStart + Send + Sync>;
type ReadOffline = Box<dyn Fn() -> bool + Send + Sync>;
type WakeAt = Box<dyn Fn(DateTime<Utc>) + Send + Sync>;

pub(crate) struct GpsPassService {
    inner: Mutex<PassState>,
    start: StartPass,
    offline: ReadOffline,
    wake_at: WakeAt,
}

impl GpsPassService {
    /// `start` starts the download for a range. A pass it starts must call
    /// [`GpsPassService::finish`] when it ends, however it ends.
    pub(crate) fn new(
        start: impl Fn(&PassRange) -> PassStart + Send + Sync + 'static,
        offline: impl Fn() -> bool + Send + Sync + 'static,
    ) -> Self {
        Self {
            inner: Mutex::new(PassState::default()),
            start: Box::new(start),
            offline: Box::new(offline),
            wake_at: Box::new(|_| {}),
        }
    }

    /// `wake_at` asks for [`GpsPassService::budget_lifted`] at the instant a
    /// held pass may go again.
    pub(crate) fn with_wake(self, wake_at: impl Fn(DateTime<Utc>) + Send + Sync + 'static) -> Self {
        Self {
            wake_at: Box::new(wake_at),
            ..self
        }
    }

    /// Start a pass over `range`, or keep it owed. `Busy` means one is
    /// downloading and this one starts when it ends; `Held` means the budget
    /// holds one back and this one starts with it; `Offline` means it starts
    /// when the connection returns.
    pub(crate) fn request(&self, range: PassRange) -> PassStart {
        let (range, taken) = {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            if inner.running.is_some() {
                owe_into(&mut inner.owed, range);
                return PassStart::refused(FfiStartOutcome::Busy);
            }
            // A pass started now would only be deferred again, so the ask
            // waits with the held one and the lift starts both.
            if inner.owed_to_budget.is_some() {
                owe_into(&mut inner.owed_to_budget, range);
                return PassStart::refused(FfiStartOutcome::Held);
            }
            if (self.offline)() {
                owe_into(&mut inner.owed_to_reconnect, range);
                return PassStart::refused(FfiStartOutcome::Offline);
            }
            // The ask starts now, so a pass the connection cost joins it
            // rather than waiting for an edge that may not come.
            let range = match inner.owed_to_reconnect.take() {
                Some(lost) => lost.widened(range),
                None => range,
            };
            let taken = inner.take_slot(range.clone());
            (range, taken)
        };
        self.begin(range, taken)
    }

    /// Start a pass the slot has already been taken for, and give the slot
    /// back if it did not start.
    ///
    /// The slot is not held across the start, so the pass can end before the
    /// start returns. The run is named only against the taking it was started
    /// for, and a taking that has already ended keeps nothing.
    fn begin(&self, range: PassRange, taken: u64) -> PassStart {
        let started = (self.start)(&range);
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        let ours = inner.running.as_mut().filter(|r| r.taken == taken);
        if started.outcome == FfiStartOutcome::Started {
            if let Some(running) = ours {
                running.run = Some(started.run);
                drop(inner);
                // The sync status carries the download from here. The screens
                // that render it read again on this, so nothing has to poll
                // while no pass is downloading.
                super::observer::notify(super::observer::Announcement::SyncProgress);
            }
            return started;
        }
        let freed = ours.is_some();
        if freed {
            inner.running = None;
        }
        if started.outcome == FfiStartOutcome::Offline {
            owe_into(&mut inner.owed_to_reconnect, range);
        }
        drop(inner);
        // A pass asked for while this start was in flight was parked in `owed`
        // behind the slot, and nothing else starts it once the slot is free.
        if freed {
            self.start_owed();
        }
        started
    }

    /// The fetch run of the pass downloading now, or `None` when no pass holds
    /// the slot or its start has not returned yet.
    pub(crate) fn running_run(&self) -> Option<u64> {
        let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.running.as_ref().and_then(|r| r.run)
    }

    /// The running pass ended. One the connection cost is owed again on the
    /// online edge, and one the budget held back when the hold lifts, which
    /// asks for a wake then.
    ///
    /// One the connection cost while the device reads as online has no edge
    /// coming, so it also asks for a wake after a delay that doubles with each
    /// loss in a row.
    pub(crate) fn finish(&self, end: PassEnd) {
        let wake = {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            let ended = inner.running.take();
            if !matches!(end, PassEnd::NetworkLost) {
                inner.lost_online = 0;
            }
            match (ended, end) {
                (Some(ended), PassEnd::NetworkLost) => {
                    owe_into(&mut inner.owed_to_reconnect, ended.range);
                    if (self.offline)() {
                        None
                    } else {
                        inner.lost_online += 1;
                        Some(Utc::now() + retry_delay(inner.lost_online))
                    }
                }
                (Some(ended), PassEnd::HeldUntil(until)) => {
                    owe_into(&mut inner.owed_to_budget, ended.range);
                    inner.held_until = Some(until);
                    Some(until)
                }
                _ => None,
            }
        };
        if let Some(until) = wake {
            (self.wake_at)(until);
        }
        self.start_owed();
    }

    /// A wake came: the hold on a held pass has lifted, or a retry is due. Each
    /// joins the owed pass and starts when the slot is free; a retry waits for
    /// the connection while the device is offline. One that comes too early is held again by the
    /// budget, which asks for the next wake.
    pub(crate) fn budget_lifted(&self) {
        {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.held_until = None;
            if let Some(range) = inner.owed_to_budget.take() {
                owe_into(&mut inner.owed, range);
            }
            if !(self.offline)()
                && let Some(range) = inner.owed_to_reconnect.take()
            {
                owe_into(&mut inner.owed, range);
            }
        }
        self.start_owed();
    }

    /// When the pass the budget is holding may go again, or `None` when none is held.
    pub(crate) fn held_until(&self) -> Option<DateTime<Utc>> {
        let inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        inner.owed_to_budget.as_ref().and(inner.held_until)
    }

    /// The connection came back: the pass it cost joins the owed one.
    pub(crate) fn reconnected(&self) {
        {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(range) = inner.owed_to_reconnect.take() {
                owe_into(&mut inner.owed, range);
            }
        }
        self.start_owed();
    }

    /// Start the owed pass if the slot is free. Offline it waits for the edge,
    /// and behind a budget hold it waits for the lift.
    fn start_owed(&self) {
        let (range, taken) = {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            if inner.running.is_some() {
                return;
            }
            let Some(range) = inner.owed.take() else {
                return;
            };
            if inner.owed_to_budget.is_some() {
                owe_into(&mut inner.owed_to_budget, range);
                return;
            }
            if (self.offline)() {
                owe_into(&mut inner.owed_to_reconnect, range);
                return;
            }
            let taken = inner.take_slot(range.clone());
            (range, taken)
        };
        self.begin(range, taken);
    }
}

/// `items` with those `head` names first, in the head's order, then the rest in
/// their own. A head id with no item is skipped.
pub(crate) fn head_first<T>(items: Vec<T>, head: &[String], id: impl Fn(&T) -> &str) -> Vec<T> {
    let rank = |item: &T| {
        head.iter()
            .position(|h| h == id(item))
            .unwrap_or(head.len())
    };
    let mut ranked: Vec<(usize, T)> = items.into_iter().map(|item| (rank(&item), item)).collect();
    // Stable, so the rest keep their order.
    ranked.sort_by_key(|(at, _)| *at);
    ranked.into_iter().map(|(_, item)| item).collect()
}

/// Why a pass cannot start with no intervals.icu session. A library holding
/// Garmin rows has every track from the original it was made from, so nothing
/// is owed; one holding none has no source configured.
fn refusal_without_session(garmin_rows: u32) -> FfiStartOutcome {
    if garmin_rows > 0 {
        FfiStartOutcome::NotOwed
    } else {
        FfiStartOutcome::NotConfigured
    }
}

/// Read the candidates over `range` and start one bulk download for them.
fn start_download(range: &PassRange) -> PassStart {
    let Some(Ok(_)) = crate::objects::current_session() else {
        let garmin_rows = crate::objects::error::with_reader(|conn| {
            crate::persistence::activities::pooled::library_coverage(conn, "").upstream
        })
        .unwrap_or(0);
        return PassStart::refused(refusal_without_session(garmin_rows));
    };
    let read = crate::objects::error::with_reader(|conn| {
        let athlete_id = crate::persistence::settings::setting_from(
            conn,
            crate::persistence::settings_keys::ATHLETE_ID,
        )
        .ok()
        .flatten();
        athlete_id
            .map(|id| {
                crate::persistence::activities::pooled::gps_fetch_candidates(
                    conn,
                    &id,
                    &range.oldest,
                    &range.newest,
                )
            })
            .unwrap_or_default()
    });
    // An engine that cannot be read is not open yet.
    let Ok(candidates): Result<Vec<ActivitySportMapping>, _> = read else {
        return PassStart::refused(FfiStartOutcome::NotReady);
    };
    if candidates.is_empty() {
        return PassStart::refused(FfiStartOutcome::NotOwed);
    }
    let candidates = head_first(candidates, &range.head, |c| c.activity_id.as_str());
    let ids: Vec<String> = candidates.iter().map(|c| c.activity_id.clone()).collect();
    let total = ids.len() as u32;
    let run = crate::ffi::start_fetch_and_store_pass(ids, candidates, |end| GPS_PASSES.finish(end));
    match run {
        Some(run) => PassStart {
            outcome: FfiStartOutcome::Started,
            run,
            total,
        },
        None => PassStart::refused(FfiStartOutcome::NotConfigured),
    }
}

static GPS_PASSES: LazyLock<Arc<GpsPassService>> = LazyLock::new(|| {
    Arc::new(
        GpsPassService::new(start_download, crate::net::connectivity::is_offline)
            .with_wake(crate::net::resume::resume_at),
    )
});

/// Ask for a pass over the range. See [`GpsPassService::request`].
pub(crate) fn request(range: PassRange) -> PassStart {
    GPS_PASSES.request(range)
}

/// How far the pass downloading now has got, as tracks done of tracks given,
/// or `None` when no pass is downloading.
pub(crate) fn running_download() -> Option<(u32, u32)> {
    let run = GPS_PASSES.running_run()?;
    let (completed, total, active) = crate::http::run_download_progress(run);
    active.then_some((completed, total))
}

/// The connection came back. Pushed from `objects::sync::reconnected`.
pub(crate) fn reconnected() {
    GPS_PASSES.reconnected();
}

/// A budget hold or a refusal's cooldown has lifted. Pushed from the engine's
/// wake-up in `net::resume`.
pub(crate) fn budget_lifted() {
    GPS_PASSES.budget_lifted();
}

/// When the pass the budget is holding may go again, or `None` when none is held.
pub(crate) fn held_until() -> Option<DateTime<Utc>> {
    GPS_PASSES.held_until()
}

#[cfg(test)]
#[path = "tests/gps_pass.rs"]
mod tests;

#[cfg(test)]
mod garmin_only_tests {
    use super::*;

    #[test]
    fn a_pass_with_no_session_owes_nothing_to_a_garmin_library() {
        assert_eq!(refusal_without_session(3), FfiStartOutcome::NotOwed);
        assert_eq!(refusal_without_session(0), FfiStartOutcome::NotConfigured);
    }
}
