//! The GPS track pass: one bulk download of every track the census still owes
//! over a date range.
//!
//! The engine owns when a pass runs. One runs at a time. A pass asked for while
//! one is downloading is kept owed and started when that one ends, and a pass
//! that ended because the connection dropped, or was asked for offline, is kept
//! owed to the connection and started on the online edge. The screen that
//! follows a pass asks for it and renders its progress, and schedules nothing.

use std::sync::{Arc, LazyLock, Mutex};

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

#[derive(Default)]
struct PassState {
    /// The range of the pass downloading now.
    running: Option<PassRange>,
    /// A pass asked for while one ran, started when it ends.
    owed: Option<PassRange>,
    /// A pass the connection cost, started on the online edge.
    owed_to_reconnect: Option<PassRange>,
}

fn owe_into(slot: &mut Option<PassRange>, range: PassRange) {
    *slot = Some(match slot.take() {
        Some(earlier) => earlier.widened(range),
        None => range,
    });
}

type StartPass = Box<dyn Fn(&PassRange) -> PassStart + Send + Sync>;
type ReadOffline = Box<dyn Fn() -> bool + Send + Sync>;

pub(crate) struct GpsPassService {
    inner: Mutex<PassState>,
    start: StartPass,
    offline: ReadOffline,
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
        }
    }

    /// Start a pass over `range`, or keep it owed. `Busy` means one is
    /// downloading and this one starts when it ends; `Offline` means it starts
    /// when the connection returns.
    pub(crate) fn request(&self, range: PassRange) -> PassStart {
        {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            if inner.running.is_some() {
                owe_into(&mut inner.owed, range);
                return PassStart::refused(FfiStartOutcome::Busy);
            }
            if (self.offline)() {
                owe_into(&mut inner.owed_to_reconnect, range);
                return PassStart::refused(FfiStartOutcome::Offline);
            }
            inner.running = Some(range.clone());
        }
        self.begin(range)
    }

    /// Start a pass the slot has already been taken for, and give the slot
    /// back if it did not start.
    fn begin(&self, range: PassRange) -> PassStart {
        let started = (self.start)(&range);
        if started.outcome != FfiStartOutcome::Started {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.running = None;
            if started.outcome == FfiStartOutcome::Offline {
                owe_into(&mut inner.owed_to_reconnect, range);
            }
        }
        started
    }

    /// The running pass ended. `network_lost` says a track failed because the
    /// connection did, so the pass is owed again on the online edge.
    pub(crate) fn finish(&self, network_lost: bool) {
        {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(ended) = inner.running.take()
                && network_lost
            {
                owe_into(&mut inner.owed_to_reconnect, ended);
            }
        }
        self.start_owed();
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

    /// Start the owed pass if the slot is free. Offline it waits for the edge.
    fn start_owed(&self) {
        let range = {
            let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
            if inner.running.is_some() {
                return;
            }
            let Some(range) = inner.owed.take() else {
                return;
            };
            if (self.offline)() {
                owe_into(&mut inner.owed_to_reconnect, range);
                return;
            }
            inner.running = Some(range.clone());
            range
        };
        self.begin(range);
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

/// Read the candidates over `range` and start one bulk download for them.
fn start_download(range: &PassRange) -> PassStart {
    let Some(Ok(_)) = crate::objects::current_session() else {
        return PassStart::refused(FfiStartOutcome::NotConfigured);
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
    let run = crate::ffi::start_fetch_and_store_pass(ids, candidates, |network_lost| {
        GPS_PASSES.finish(network_lost)
    });
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
    Arc::new(GpsPassService::new(
        start_download,
        crate::net::connectivity::is_offline,
    ))
});

/// Ask for a pass over the range. See [`GpsPassService::request`].
pub(crate) fn request(range: PassRange) -> PassStart {
    GPS_PASSES.request(range)
}

/// The connection came back. Pushed from `objects::sync::reconnected`.
pub(crate) fn reconnected() {
    GPS_PASSES.reconnected();
}

#[cfg(test)]
#[path = "tests/gps_pass.rs"]
mod tests;
