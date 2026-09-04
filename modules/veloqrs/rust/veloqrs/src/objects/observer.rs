//! The one path from a Rust background thread to the JavaScript listener map.
//!
//! Every on-demand fetch settles on a Rust thread. `engine.subscribe` is a
//! TypeScript-only map, so without this the hook that asked for the result has
//! no way to hear about it and re-reads on a timer until it lands.
//!
//! The binding blocks the calling thread until JavaScript returns, so a call
//! made here must be made after the write is committed and the engine lock is
//! released, never under it.

use std::sync::{Arc, RwLock};

use once_cell::sync::Lazy;

/// What Rust tells TypeScript when work finishes off the JavaScript thread.
///
/// One method per event, each naming what landed rather than which query to
/// refetch, so the routing stays on the TypeScript side.
#[uniffi::export(with_foreign)]
pub trait EngineObserver: Send + Sync {
    /// A sync step completed. Carries no payload: the reader takes a status
    /// snapshot.
    fn sync_progress(&self);
    /// A sync reached a terminal state, successful or not.
    fn sync_settled(&self);
    /// An on-demand body landed in SQLite under `kind` for `activity_id`.
    fn body_stored(&self, kind: String, activity_id: String);
    /// Time streams landed for these activities.
    fn time_streams_stored(&self, activity_ids: Vec<String>);
    /// A GPS track landed for this activity.
    fn gps_track_stored(&self, activity_id: String);
    /// A FIT file finished parsing for this activity.
    fn fit_parsed(&self, activity_id: String);
    /// A section detection run was applied to the catalogue.
    fn detection_applied(&self);
    /// A heatmap tile pass finished.
    fn tiles_generated(&self);
    /// The elevation backfill entered `phase`.
    fn backfill_phase(&self, phase: String);
    /// The section cutover committed.
    fn cutover_settled(&self);
    /// A preview detection run finished.
    fn preview_finished(&self);
}

static OBSERVER: Lazy<RwLock<Option<Arc<dyn EngineObserver>>>> = Lazy::new(|| RwLock::new(None));

/// Register the observer, replacing any previous one. `None` clears it.
///
/// One registration per process: the engine is a singleton and so is the
/// JavaScript side that owns the listener map.
pub fn set_observer(observer: Option<Arc<dyn EngineObserver>>) {
    *OBSERVER.write().unwrap_or_else(|e| e.into_inner()) = observer;
}

/// Call the observer if one is registered.
///
/// The handle is cloned out and the read lock dropped before `f` runs, so a
/// call into JavaScript never holds the registry.
pub(crate) fn notify<F>(f: F)
where
    F: FnOnce(&dyn EngineObserver),
{
    let observer = OBSERVER
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map(Arc::clone);
    if let Some(observer) = observer {
        f(observer.as_ref());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_globals::serial_global_state;
    use std::sync::Mutex;

    /// Records what it was told, in order.
    struct Recorder {
        events: Mutex<Vec<String>>,
    }

    impl Recorder {
        fn new() -> Arc<Self> {
            Arc::new(Self {
                events: Mutex::new(Vec::new()),
            })
        }

        fn events(&self) -> Vec<String> {
            self.events.lock().unwrap().clone()
        }

        fn push(&self, event: &str) {
            self.events.lock().unwrap().push(event.to_string());
        }
    }

    impl EngineObserver for Recorder {
        fn sync_progress(&self) {
            self.push("sync_progress");
        }
        fn sync_settled(&self) {
            self.push("sync_settled");
        }
        fn body_stored(&self, kind: String, activity_id: String) {
            self.push(&format!("body_stored:{kind}:{activity_id}"));
        }
        fn time_streams_stored(&self, activity_ids: Vec<String>) {
            self.push(&format!("time_streams_stored:{}", activity_ids.join(",")));
        }
        fn gps_track_stored(&self, activity_id: String) {
            self.push(&format!("gps_track_stored:{activity_id}"));
        }
        fn fit_parsed(&self, activity_id: String) {
            self.push(&format!("fit_parsed:{activity_id}"));
        }
        fn detection_applied(&self) {
            self.push("detection_applied");
        }
        fn tiles_generated(&self) {
            self.push("tiles_generated");
        }
        fn backfill_phase(&self, phase: String) {
            self.push(&format!("backfill_phase:{phase}"));
        }
        fn cutover_settled(&self) {
            self.push("cutover_settled");
        }
        fn preview_finished(&self) {
            self.push("preview_finished");
        }
    }

    #[test]
    fn the_registry_delivers_to_one_observer_at_a_time() {
        let _guard = serial_global_state();
        set_observer(None);
        notify(|o| o.sync_settled());

        let first = Recorder::new();
        set_observer(Some(first.clone()));
        notify(|o| o.sync_progress());
        notify(|o| o.body_stored("power_curve".into(), "a1".into()));
        assert_eq!(
            first.events(),
            vec!["sync_progress", "body_stored:power_curve:a1"]
        );

        let second = Recorder::new();
        set_observer(Some(second.clone()));
        notify(|o| o.sync_settled());
        assert_eq!(second.events(), vec!["sync_settled"]);
        assert_eq!(
            first.events(),
            vec!["sync_progress", "body_stored:power_curve:a1"],
            "the replaced observer hears nothing more"
        );

        set_observer(None);
        notify(|o| o.sync_settled());
        assert_eq!(second.events(), vec!["sync_settled"]);
    }

    /// The sync service is the first caller, and it is the proof the path runs
    /// from a real emit site rather than only from `notify`.
    #[test]
    fn the_sync_service_announces_its_own_terminal_transition() {
        use crate::objects::sync::{SYNC_SERVICE, SyncState};

        let _guard = serial_global_state();
        let recorder = Recorder::new();
        set_observer(Some(recorder.clone()));
        SYNC_SERVICE.finish(SyncState::Idle, None, true);
        set_observer(None);

        assert!(
            recorder.events().contains(&"sync_settled".to_string()),
            "finish must announce the settle, got {:?}",
            recorder.events()
        );
    }
}
