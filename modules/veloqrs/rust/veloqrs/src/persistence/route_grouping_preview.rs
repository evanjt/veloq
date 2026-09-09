//! What-if route grouping at a chosen strictness, without writing a byte.
//!
//! The grouping functions in tracematch are pure and persist nothing. All the
//! cost and all the persistence live in `recompute_groups`, which this never
//! calls: it takes the cached signatures under the engine lock, hands them to
//! a worker, and the worker groups them off-lock at the caller's strictness.
//! No table is touched, the engine's own `groups`, `activity_matches` and
//! identity remap are untouched, and the result leaves as one payload.

use crate::{MatchConfig, RouteSignature};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex, mpsc};
use std::thread;

use super::PersistentEngine;

/// The one grouping-preview slot. Occupied from start until the result is
/// taken or the run ends cancelled or dead, so two runs can never hold two
/// copies of the library's signatures at once.
pub static ROUTE_GROUPING_PREVIEW_HANDLE: LazyLock<Mutex<Option<RouteGroupingPreviewHandle>>> =
    LazyLock::new(|| Mutex::new(None));

/// One proposed group, before any identity remap.
pub struct PreviewGroup {
    /// The grouping's own key for this group, a Union-Find root. The full and
    /// incremental paths pick it differently and `route_identity_remap` is
    /// what turns one into a stable route id, so this is a join key within
    /// one payload and nothing else.
    pub key: String,
    /// Member activity ids, sorted, so two runs at the same strictness give
    /// the same payload.
    pub activity_ids: Vec<String>,
}

/// The two knobs the strictness control exposes. The rest of `MatchConfig` is
/// taken from the engine's live config: trusting a caller-supplied whole
/// config would silently flip fields the panel never shows.
#[derive(Debug, Clone, Copy)]
pub struct PreviewStrictness {
    pub min_match_percentage: f64,
    pub endpoint_threshold: f64,
}

/// How a finished run ended.
pub enum PreviewOutcome {
    Complete(Vec<PreviewGroup>),
    /// Cancelled cooperatively; nothing to take.
    Cancelled,
}

/// One poll of a handle.
pub enum PreviewPoll {
    Running,
    Complete,
    Cancelled,
    /// The worker died without sending.
    Died,
}

/// Handle for one background grouping-preview run.
pub struct RouteGroupingPreviewHandle {
    receiver: mpsc::Receiver<PreviewOutcome>,
    cancel: Arc<AtomicBool>,
    outcome: Option<PreviewOutcome>,
}

impl RouteGroupingPreviewHandle {
    fn pump(&mut self) {
        if self.outcome.is_none()
            && let Ok(o) = self.receiver.try_recv()
        {
            self.outcome = Some(o);
        }
    }

    /// Non-blocking poll that also reports a dead worker thread.
    pub fn poll_status(&mut self) -> PreviewPoll {
        self.pump();
        match self.outcome {
            Some(PreviewOutcome::Complete(_)) => PreviewPoll::Complete,
            Some(PreviewOutcome::Cancelled) => PreviewPoll::Cancelled,
            None => match self.receiver.try_recv() {
                Ok(o) => {
                    let poll = match o {
                        PreviewOutcome::Complete(_) => PreviewPoll::Complete,
                        PreviewOutcome::Cancelled => PreviewPoll::Cancelled,
                    };
                    self.outcome = Some(o);
                    poll
                }
                Err(mpsc::TryRecvError::Empty) => PreviewPoll::Running,
                Err(mpsc::TryRecvError::Disconnected) => PreviewPoll::Died,
            },
        }
    }

    /// Take the groups once. None while running, cancelled or already taken.
    pub fn take_groups(&mut self) -> Option<Vec<PreviewGroup>> {
        self.pump();
        match self.outcome {
            Some(PreviewOutcome::Complete(_)) => match self.outcome.take() {
                Some(PreviewOutcome::Complete(groups)) => Some(groups),
                _ => None,
            },
            _ => None,
        }
    }

    /// Request cooperative cancellation. The worker checks once before the
    /// grouping and once after: the grouping itself is one tracematch call
    /// and cannot be interrupted, so a cancel that arrives inside it discards
    /// the result rather than shortening the run.
    pub fn request_cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }

    /// Block for the outcome (test path; production polls).
    pub fn recv(self) -> Option<PreviewOutcome> {
        if self.outcome.is_some() {
            return self.outcome;
        }
        self.receiver.recv().ok()
    }
}

impl PersistentEngine {
    /// Start a grouping preview over the whole library at `strictness`.
    ///
    /// The signatures are collected here, under the caller's engine lock,
    /// because the cache that holds them is the engine's. Everything after
    /// that is off-lock. `None` when the library has no signatures to group,
    /// which is the empty-library case and not a failure.
    ///
    /// Measured on a desktop at 117 ms over 550 activities and 307 to 348 ms
    /// over 1,198, which is what makes grouping the whole library affordable
    /// rather than a subset of it. The device is unmeasured.
    pub fn grouping_preview_background(
        &mut self,
        strictness: PreviewStrictness,
    ) -> Option<RouteGroupingPreviewHandle> {
        let activity_ids: Vec<String> = self.activity_metadata.keys().cloned().collect();
        let signatures: Vec<Arc<RouteSignature>> = activity_ids
            .iter()
            .filter_map(|id| self.get_signature(id))
            .collect();
        if signatures.is_empty() {
            return None;
        }

        let mut config = self.match_config.clone();
        config.min_match_percentage = strictness.min_match_percentage;
        config.endpoint_threshold = strictness.endpoint_threshold;

        let (tx, receiver) = mpsc::channel();
        let cancel = Arc::new(AtomicBool::new(false));
        let worker_cancel = Arc::clone(&cancel);
        thread::spawn(move || {
            if worker_cancel.load(Ordering::SeqCst) {
                let _ = tx.send(PreviewOutcome::Cancelled);
                return;
            }
            let owned: Vec<RouteSignature> =
                signatures.iter().map(|a| a.as_ref().clone()).collect();
            let groups = group_at(&owned, &config);
            let _ = tx.send(if worker_cancel.load(Ordering::SeqCst) {
                PreviewOutcome::Cancelled
            } else {
                PreviewOutcome::Complete(groups)
            });
        });

        Some(RouteGroupingPreviewHandle {
            receiver,
            cancel,
            outcome: None,
        })
    }
}

/// The pure half, so a test can group without an engine or a thread. Ordered
/// by member count descending then key, the order the route list already
/// paints in, and each group's members sorted, so one strictness gives one
/// payload however the grouping enumerated it.
fn group_at(signatures: &[RouteSignature], config: &MatchConfig) -> Vec<PreviewGroup> {
    let mut groups: Vec<PreviewGroup> = tracematch::group_signatures_parallel(signatures, config)
        .into_iter()
        .map(|g| {
            let mut activity_ids = g.activity_ids;
            activity_ids.sort();
            PreviewGroup {
                key: g.group_id,
                activity_ids,
            }
        })
        .collect();
    groups.sort_by(|a, b| {
        b.activity_ids
            .len()
            .cmp(&a.activity_ids.len())
            .then_with(|| a.key.cmp(&b.key))
    });
    groups
}
