//! The one path from a Rust background thread to the JavaScript listener map.
//!
//! Every on-demand fetch settles on a Rust thread. `engine.subscribe` is a
//! TypeScript-only map, so without this the hook that asked for the result has
//! no way to hear about it and re-reads on a timer until it lands.
//!
//! The binding blocks the calling thread until JavaScript returns, so a call
//! made here must be made after the write is committed and the engine lock is
//! released, never under it.

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::LazyLock;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, RwLock};

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
    /// A preview detection run entered `phase`. Four per run, so the screen
    /// reads progress on a transition instead of on a timer.
    fn preview_phase(&self, phase: String);
    /// A preview detection run finished.
    fn preview_finished(&self);
}

static OBSERVER: LazyLock<RwLock<Option<Arc<dyn EngineObserver>>>> =
    LazyLock::new(|| RwLock::new(None));

/// Register the observer, replacing any previous one. `None` clears it.
///
/// One registration per process: the engine is a singleton and so is the
/// JavaScript side that owns the listener map.
pub fn set_observer(observer: Option<Arc<dyn EngineObserver>>) {
    *OBSERVER.write().unwrap_or_else(|e| e.into_inner()) = observer;
}

/// Announcements that came back as a panic from the foreign side.
static OBSERVER_PANICS: AtomicU32 = AtomicU32::new(0);

/// How many announcements the foreign side has panicked out of, this process.
///
/// The device log is otherwise the only record, and it says nothing about
/// which announcement or how many the caller lost.
pub fn observer_panics() -> u32 {
    OBSERVER_PANICS.load(Ordering::Relaxed)
}

/// Call the observer if one is registered.
///
/// The handle is cloned out and the read lock dropped before `f` runs, so a
/// call into JavaScript never holds the registry.
///
/// The call is caught. uniffi's dispatch panics with "Foreign pointer not set"
/// when the vtable slot behind a registered observer was never installed, and
/// twenty of those were pulled off a device in one log. The crate is
/// `panic = unwind` and the panic hook logs rather than aborting, so each one
/// unwound the background thread that announced, past whatever that thread had
/// left to do: a released flag, a slot to give back, a result to store.
/// Announcing is not work, it is a notification about work already committed,
/// so it must not be able to fail the work. `AssertUnwindSafe` because the
/// only state across the boundary is the foreign handle, which is not ours to
/// hold invariants for, and the registry lock is already released.
pub(crate) fn notify<F>(f: F)
where
    F: FnOnce(&dyn EngineObserver),
{
    let observer = OBSERVER
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map(Arc::clone);
    if let Some(observer) = observer
        && catch_unwind(AssertUnwindSafe(|| f(observer.as_ref()))).is_err()
    {
        let total = OBSERVER_PANICS.fetch_add(1, Ordering::Relaxed) + 1;
        log::error!(
            "veloqrs: [observer] the foreign side panicked on an announcement, {total} so far this process; the event is lost and the caller carries on"
        );
    }
}

/// Records what it was told, in order. Shared by every test that needs to see
/// an emit site fire.
#[cfg(test)]
pub(crate) mod recorder {
    use super::EngineObserver;
    use std::sync::{Arc, Mutex};

    pub(crate) struct Recorder {
        events: Mutex<Vec<String>>,
    }

    impl Recorder {
        pub(crate) fn new() -> Arc<Self> {
            Arc::new(Self {
                events: Mutex::new(Vec::new()),
            })
        }

        pub(crate) fn events(&self) -> Vec<String> {
            self.events
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone()
        }

        fn push(&self, event: &str) {
            self.events
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .push(event.to_string());
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
        fn preview_phase(&self, phase: String) {
            self.push(&format!("preview_phase:{phase}"));
        }
        fn preview_finished(&self) {
            self.push("preview_finished");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::recorder::Recorder;
    use super::*;
    use crate::test_globals::serial_global_state;

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

    /// A screen waiting on a `time` stream hears it land, so it never re-reads
    /// the gap on a timer.
    #[test]
    fn a_stored_time_stream_is_announced_once_it_has_landed() {
        use crate::objects::sync::store_time_stream;
        use crate::test_globals::init_global_engine;

        let _guard = serial_global_state();
        let _tmp = init_global_engine("time_stream_announcement.db");
        let recorder = Recorder::new();
        set_observer(Some(recorder.clone()));
        crate::runtime::block_on(store_time_stream("a1".into(), vec![0, 5, 10]));
        crate::runtime::block_on(store_time_stream("a2".into(), vec![0, 7]));
        set_observer(None);
        crate::runtime::block_on(store_time_stream("a3".into(), vec![0, 9]));

        assert_eq!(
            recorder.events(),
            vec!["time_streams_stored:a1", "time_streams_stored:a2"]
        );
    }

    /// A cold start has nowhere to put the stream. Announcing it anyway would
    /// tell the screen to stop waiting for something it will never read.
    #[test]
    fn a_stream_with_nowhere_to_land_is_not_announced() {
        use crate::objects::sync::store_time_stream;
        use crate::persistence::PERSISTENT_ENGINE;

        let _guard = serial_global_state();
        *PERSISTENT_ENGINE.write().unwrap_or_else(|e| e.into_inner()) = None;
        let recorder = Recorder::new();
        set_observer(Some(recorder.clone()));
        crate::runtime::block_on(store_time_stream("a1".into(), vec![0, 5]));
        set_observer(None);

        assert!(
            recorder.events().is_empty(),
            "nothing may be announced, got {:?}",
            recorder.events()
        );
    }

    /// The backfill sets its phase from a background thread, so the settings
    /// row hears the transition instead of re-reading the snapshot on a timer.
    #[test]
    fn the_elevation_backfill_announces_every_phase_it_enters() {
        use crate::net::elevation_backfill::{
            BACKFILL_PHASE_COMPLETE, BACKFILL_PHASE_FETCHING, BACKFILL_PHASE_IDLE, set_phase,
        };

        let _guard = serial_global_state();
        let recorder = Recorder::new();
        set_observer(Some(recorder.clone()));
        set_phase(BACKFILL_PHASE_FETCHING);
        set_phase(BACKFILL_PHASE_COMPLETE);
        set_observer(None);
        set_phase(BACKFILL_PHASE_IDLE);

        assert_eq!(
            recorder.events(),
            vec!["backfill_phase:fetching", "backfill_phase:complete"]
        );
    }

    /// Scenario: twenty identical panics in one device log, `Foreign pointer
    /// not set` from uniffi's callback dispatch, each one raised inside a
    /// `notify` on a Rust background thread. The crate is `panic = unwind` and
    /// the hook logs rather than aborting, so every one of them unwound the
    /// thread that announced, past whatever that thread had left to do.
    ///
    /// Expected behaviour: announcing is not a thing that can fail the work
    /// that announced. The foreign side is not ours and a call into it is a
    /// call across a boundary, so a panic coming back over it is caught here.
    mod a_foreign_side_that_panics {
        use super::*;
        use std::sync::atomic::{AtomicU32, Ordering};

        /// Every method panics the way uniffi's dispatch does when the vtable
        /// slot was never installed.
        struct Exploding;

        macro_rules! explode {
            ($($name:ident($($arg:ident: $ty:ty),*);)*) => {
                $(fn $name(&self $(, _: $ty)*) {
                    $(let _ = stringify!($arg);)*
                    panic!("Foreign pointer not set.  This is likely a uniffi bug.");
                })*
            };
        }

        impl EngineObserver for Exploding {
            explode! {
                sync_progress();
                sync_settled();
                body_stored(kind: String, activity_id: String);
                time_streams_stored(activity_ids: Vec<String>);
                gps_track_stored(activity_id: String);
                fit_parsed(activity_id: String);
                detection_applied();
                tiles_generated();
                backfill_phase(phase: String);
                cutover_settled();
                preview_phase(phase: String);
                preview_finished();
            }
        }

        /// Swallow the hook's output, the way the poisoned-lock tests do, so a
        /// deliberate panic does not read as a failing run.
        fn quietly<T>(f: impl FnOnce() -> T) -> T {
            let previous = std::panic::take_hook();
            std::panic::set_hook(Box::new(|_| {}));
            let out = f();
            std::panic::set_hook(previous);
            out
        }

        #[test]
        fn does_not_unwind_the_thread_that_announced() {
            let _guard = serial_global_state();
            set_observer(Some(Arc::new(Exploding)));

            let reached_the_next_line = AtomicU32::new(0);
            quietly(|| {
                notify(|o| o.sync_settled());
                reached_the_next_line.fetch_add(1, Ordering::SeqCst);
            });

            set_observer(None);
            assert_eq!(
                reached_the_next_line.load(Ordering::SeqCst),
                1,
                "the announcement took the rest of the thread with it"
            );
        }

        #[test]
        fn is_counted_so_the_log_is_not_the_only_record() {
            let _guard = serial_global_state();
            let before = observer_panics();
            set_observer(Some(Arc::new(Exploding)));

            quietly(|| {
                notify(|o| o.sync_settled());
                notify(|o| o.backfill_phase("fetching".into()));
            });

            set_observer(None);
            assert_eq!(observer_panics() - before, 2);
        }

        #[test]
        fn leaves_the_registry_usable_for_the_next_observer() {
            let _guard = serial_global_state();
            set_observer(Some(Arc::new(Exploding)));
            quietly(|| notify(|o| o.sync_settled()));

            let good = Recorder::new();
            set_observer(Some(good.clone()));
            notify(|o| o.sync_settled());
            set_observer(None);

            assert_eq!(good.events(), vec!["sync_settled"]);
        }

        /// A real emit site, so this is not only a property of `notify`.
        #[test]
        fn does_not_stop_the_backfill_setting_its_phase() {
            use crate::net::elevation_backfill::{
                BACKFILL_PHASE_COMPLETE, BACKFILL_PHASE_FETCHING, backfill_progress, set_phase,
            };

            let _guard = serial_global_state();
            set_observer(Some(Arc::new(Exploding)));
            quietly(|| {
                set_phase(BACKFILL_PHASE_FETCHING);
                set_phase(BACKFILL_PHASE_COMPLETE);
            });
            set_observer(None);

            assert_eq!(
                backfill_progress().phase,
                BACKFILL_PHASE_COMPLETE,
                "the phase moved even though announcing it panicked"
            );
        }
    }
}
