//! The one path from a Rust background thread to the JavaScript listener map.
//!
//! Every on-demand fetch settles on a Rust thread. `engine.subscribe` is a
//! TypeScript-only map, so without this the hook that asked for the result has
//! no way to hear about it and re-reads on a timer until it lands.
//!
//! The binding blocks the calling thread until JavaScript returns, so an
//! emitter that called the observer itself would park a tokio worker for as
//! long as the JavaScript thread happened to be busy. One delivery thread owns
//! the boundary instead: an emitter pushes an `Announcement` and returns, and
//! whatever piles up while a delivery is parked is coalesced before the next
//! one. A call still has to be made after the write is committed and the engine
//! lock released, since the reader it wakes reads through that lock.

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::LazyLock;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Condvar, Mutex, RwLock};
use std::time::{Duration, Instant};

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

/// One queued event, ready to hand to the observer.
///
/// The queue has to be able to tell two announcements apart to collapse the
/// repeats, and a closure is neither comparable nor nameable, so what an
/// emitter pushes is a value rather than the call itself.
#[derive(Clone, PartialEq, Eq, Debug)]
pub(crate) enum Announcement {
    SyncProgress,
    SyncSettled,
    BodyStored { kind: String, activity_id: String },
    TimeStreamsStored(Vec<String>),
    GpsTrackStored(String),
    FitParsed(String),
    DetectionApplied,
    TilesGenerated,
    BackfillPhase(String),
    CutoverSettled,
    PreviewPhase(String),
    PreviewFinished,
}

impl Announcement {
    fn deliver(&self, observer: &dyn EngineObserver) {
        match self {
            Self::SyncProgress => observer.sync_progress(),
            Self::SyncSettled => observer.sync_settled(),
            Self::BodyStored { kind, activity_id } => {
                observer.body_stored(kind.clone(), activity_id.clone());
            }
            Self::TimeStreamsStored(ids) => observer.time_streams_stored(ids.clone()),
            Self::GpsTrackStored(id) => observer.gps_track_stored(id.clone()),
            Self::FitParsed(id) => observer.fit_parsed(id.clone()),
            Self::DetectionApplied => observer.detection_applied(),
            Self::TilesGenerated => observer.tiles_generated(),
            Self::BackfillPhase(phase) => observer.backfill_phase(phase.clone()),
            Self::CutoverSettled => observer.cutover_settled(),
            Self::PreviewPhase(phase) => observer.preview_phase(phase.clone()),
            Self::PreviewFinished => observer.preview_finished(),
        }
    }
}

static OBSERVER: LazyLock<RwLock<Option<Arc<dyn EngineObserver>>>> =
    LazyLock::new(|| RwLock::new(None));

/// What is queued, and whether the delivery thread is inside a call.
///
/// `delivering` is what makes a flush honest. An empty queue alone does not
/// mean the foreign side has been told: the thread takes the whole batch before
/// it delivers any of it, so between those two the queue is empty and the
/// observer has heard nothing.
#[derive(Default)]
struct Pending {
    queued: Vec<Announcement>,
    delivering: bool,
}

/// The queue and the signal, with the delivery thread started on first use.
struct Announcer {
    pending: Mutex<Pending>,
    changed: Condvar,
}

static ANNOUNCER: LazyLock<Arc<Announcer>> = LazyLock::new(|| {
    let announcer = Arc::new(Announcer {
        pending: Mutex::new(Pending::default()),
        changed: Condvar::new(),
    });
    let thread = Arc::clone(&announcer);
    std::thread::Builder::new()
        .name("veloq-announce".into())
        .spawn(move || thread.run())
        .expect("the announce thread is the only path to the foreign observer");
    announcer
});

impl Announcer {
    fn push(&self, announcement: Announcement) {
        self.pending
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .queued
            .push(announcement);
        self.changed.notify_all();
    }

    /// Take the batch, deliver it, signal, repeat. Never returns.
    fn run(&self) {
        loop {
            let batch = {
                let mut pending = self.pending.lock().unwrap_or_else(|e| e.into_inner());
                while pending.queued.is_empty() {
                    pending = self
                        .changed
                        .wait(pending)
                        .unwrap_or_else(|e| e.into_inner());
                }
                pending.delivering = true;
                coalesce(std::mem::take(&mut pending.queued))
            };

            for announcement in batch {
                deliver(&announcement);
            }

            self.pending
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .delivering = false;
            self.changed.notify_all();
        }
    }

    /// Block until the queue is empty and nothing is mid-delivery.
    ///
    /// The deadline is there because a flush that cannot finish must not be the
    /// thing that hangs a test run or an engine teardown. Nothing is expected to
    /// reach it: delivery is wrapped in `catch_unwind`, so the thread outlives a
    /// foreign side that panics on every call.
    fn drain(&self) {
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut pending = self.pending.lock().unwrap_or_else(|e| e.into_inner());
        while !pending.queued.is_empty() || pending.delivering {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                log::error!(
                    "veloqrs: [observer] the announce queue did not drain in ten seconds, {} queued",
                    pending.queued.len()
                );
                return;
            }
            pending = self
                .changed
                .wait_timeout(pending, left)
                .unwrap_or_else(|e| e.into_inner())
                .0;
        }
    }
}

/// Drop the repeats, keeping the first of each and the order they arrived in.
///
/// The batch is whatever piled up while the previous delivery was parked on the
/// JavaScript thread, which is exactly the window the repeats come from: a
/// payload-free `sync_progress` per stored activity says the same thing as one.
/// Two announcements that differ in any field are two facts, so only an exact
/// match collapses.
fn coalesce(batch: Vec<Announcement>) -> Vec<Announcement> {
    let mut kept: Vec<Announcement> = Vec::with_capacity(batch.len());
    for announcement in batch {
        if !kept.contains(&announcement) {
            kept.push(announcement);
        }
    }
    kept
}

/// Register the observer, replacing any previous one. `None` clears it.
///
/// One registration per process: the engine is a singleton and so is the
/// JavaScript side that owns the listener map.
///
/// The queue is drained before the swap, so an announcement pushed while one
/// observer was installed reaches that observer rather than its replacement.
pub fn set_observer(observer: Option<Arc<dyn EngineObserver>>) {
    ANNOUNCER.drain();
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

/// Queue an announcement and return. The delivery happens on the announce
/// thread, so the caller never waits on the JavaScript thread.
pub(crate) fn notify(announcement: Announcement) {
    ANNOUNCER.push(announcement);
}

/// Block until every queued announcement has been delivered.
///
/// A test that emits and then reads what the observer was told needs this: the
/// emit returns before the delivery, which is the whole point of the queue.
/// Nothing in the crate's own paths waits on a delivery.
pub fn flush() {
    ANNOUNCER.drain();
}

/// Hand one announcement to the registered observer, if there is one.
///
/// The handle is cloned out and the read lock dropped before the call runs, so a
/// call into JavaScript never holds the registry.
///
/// The call is caught. uniffi's dispatch panics with "Foreign pointer not set"
/// when the vtable slot behind a registered observer was never installed, and
/// twenty of those were pulled off a device in one log. The crate is
/// `panic = unwind` and the panic hook logs rather than aborting, so before the
/// announce thread existed each one unwound the background thread that
/// announced, past whatever that thread had left to do: a released flag, a slot
/// to give back, a result to store. Announcing is not work, it is a notification
/// about work already committed, so it must not be able to fail the work, and it
/// must not be able to take the announce thread with it either.
/// `AssertUnwindSafe` because the only state across the boundary is the foreign
/// handle, which is not ours to hold invariants for, and the registry lock is
/// already released.
fn deliver(announcement: &Announcement) {
    let observer = OBSERVER
        .read()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map(Arc::clone);
    if let Some(observer) = observer
        && catch_unwind(AssertUnwindSafe(|| announcement.deliver(observer.as_ref()))).is_err()
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
        notify(Announcement::SyncSettled);

        let first = Recorder::new();
        set_observer(Some(first.clone()));
        notify(Announcement::SyncProgress);
        notify(Announcement::BodyStored {
            kind: "power_curve".into(),
            activity_id: "a1".into(),
        });
        flush();
        assert_eq!(
            first.events(),
            vec!["sync_progress", "body_stored:power_curve:a1"]
        );

        let second = Recorder::new();
        set_observer(Some(second.clone()));
        notify(Announcement::SyncSettled);
        flush();
        assert_eq!(second.events(), vec!["sync_settled"]);
        assert_eq!(
            first.events(),
            vec!["sync_progress", "body_stored:power_curve:a1"],
            "the replaced observer hears nothing more"
        );

        set_observer(None);
        notify(Announcement::SyncSettled);
        flush();
        assert_eq!(second.events(), vec!["sync_settled"]);
    }

    /// Scenario: the JavaScript thread is mid-render and a store loop announces
    /// once per activity. The binding parks the calling thread until JavaScript
    /// returns, so before the announce thread every announcement in that window
    /// held a tokio worker for as long as the render took, and a 490-activity
    /// loop paid it once per activity.
    ///
    /// Expected behaviour: the emitter hands the announcement over and returns,
    /// and the repeats that pile up behind one slow delivery arrive as one.
    mod the_announce_thread_owns_the_boundary {
        use super::*;
        use std::sync::mpsc::{Receiver, Sender, channel};
        use std::time::Duration;

        /// Records what it was told and what the test noted, in one order, and
        /// parks inside a settle so the queue behind it is real.
        ///
        /// The park is a gate rather than a sleep because the collapse is a
        /// property of one batch: a sleep leaves the test racing the delivery
        /// thread for whether the pushes land in the batch it already took or
        /// the next one, and it loses that race under a loaded suite.
        struct Slow {
            events: Mutex<Vec<String>>,
            entered: Mutex<Option<Sender<()>>>,
            release: Mutex<Option<Receiver<()>>>,
        }

        impl Slow {
            /// A `Slow` that reports entering a settle and waits to be let go.
            fn gated() -> (Self, Receiver<()>, Sender<()>) {
                let (entered, was_entered) = channel();
                let (release, released) = channel();
                (
                    Self {
                        events: Mutex::new(Vec::new()),
                        entered: Mutex::new(Some(entered)),
                        release: Mutex::new(Some(released)),
                    },
                    was_entered,
                    release,
                )
            }

            fn note(&self, event: &str) {
                self.events
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .push(event.to_string());
            }

            fn events(&self) -> Vec<String> {
                self.events
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .clone()
            }
        }

        impl EngineObserver for Slow {
            fn sync_progress(&self) {
                self.note("sync_progress");
            }
            fn sync_settled(&self) {
                if let Some(entered) = self
                    .entered
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .as_ref()
                {
                    let _ = entered.send(());
                }
                if let Some(released) = self
                    .release
                    .lock()
                    .unwrap_or_else(|e| e.into_inner())
                    .as_ref()
                {
                    let _ = released.recv_timeout(Duration::from_secs(5));
                }
                self.note("sync_settled");
            }
            fn body_stored(&self, _: String, _: String) {}
            fn time_streams_stored(&self, _: Vec<String>) {}
            fn gps_track_stored(&self, _: String) {}
            fn fit_parsed(&self, _: String) {}
            fn detection_applied(&self) {}
            fn tiles_generated(&self) {}
            fn backfill_phase(&self, _: String) {}
            fn cutover_settled(&self) {}
            fn preview_phase(&self, _: String) {}
            fn preview_finished(&self) {}
        }

        #[test]
        fn an_emitter_returns_before_the_callback_runs() {
            let _guard = serial_global_state();
            let (gated, was_entered, release) = Slow::gated();
            let slow = Arc::new(gated);
            set_observer(Some(slow.clone()));

            notify(Announcement::SyncSettled);
            slow.note("the emitter returned");
            was_entered
                .recv_timeout(Duration::from_secs(5))
                .expect("the announcement never reached the observer");
            let _ = release.send(());
            flush();
            set_observer(None);

            assert_eq!(
                slow.events(),
                vec!["the emitter returned", "sync_settled"],
                "the emitter waited on the foreign side"
            );
        }

        /// `sync_progress` carries no payload and the reader takes one status
        /// snapshot, so a store loop announcing per activity says the same thing
        /// each time. Whatever piles up behind one parked delivery is that loop.
        #[test]
        fn repeats_behind_one_parked_delivery_arrive_once() {
            let _guard = serial_global_state();
            let (gated, was_entered, release) = Slow::gated();
            let slow = Arc::new(gated);
            set_observer(Some(slow.clone()));

            notify(Announcement::SyncSettled);
            was_entered
                .recv_timeout(Duration::from_secs(5))
                .expect("the announcement never reached the observer");
            for _ in 0..8 {
                notify(Announcement::SyncProgress);
            }
            let _ = release.send(());
            flush();
            set_observer(None);

            assert_eq!(
                slow.events(),
                vec!["sync_settled", "sync_progress"],
                "eight identical announcements did not collapse to one"
            );
        }

        /// Two announcements that differ in any field are two facts, so the
        /// collapse must not reach them.
        #[test]
        fn announcements_that_differ_are_both_delivered() {
            let _guard = serial_global_state();
            let recorder = Recorder::new();
            set_observer(Some(recorder.clone()));

            notify(Announcement::BodyStored {
                kind: "power_curve".into(),
                activity_id: "a1".into(),
            });
            notify(Announcement::BodyStored {
                kind: "power_curve".into(),
                activity_id: "a2".into(),
            });
            notify(Announcement::BodyStored {
                kind: "power_curve".into(),
                activity_id: "a1".into(),
            });
            flush();
            set_observer(None);

            let events = recorder.events();
            assert!(
                events.contains(&"body_stored:power_curve:a1".to_string())
                    && events.contains(&"body_stored:power_curve:a2".to_string()),
                "a distinct announcement was collapsed away, got {events:?}"
            );
        }
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
        /// slot was never installed, and counts itself on the way out.
        ///
        /// The count is what the assertions compare against. `OBSERVER_PANICS`
        /// is a process global and nothing stops a thread an earlier test left
        /// running from reaching a `notify` while this observer is installed,
        /// so a delta measured against a literal is a delta measured against
        /// how busy the rest of the binary happened to be.
        #[derive(Default)]
        struct Exploding {
            raised: AtomicU32,
        }

        impl Exploding {
            fn raised(&self) -> u32 {
                self.raised.load(Ordering::SeqCst)
            }
        }

        macro_rules! explode {
            ($($name:ident($($arg:ident: $ty:ty),*);)*) => {
                $(fn $name(&self $(, _: $ty)*) {
                    $(let _ = stringify!($arg);)*
                    self.raised.fetch_add(1, Ordering::SeqCst);
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

        /// The emitter cannot unwind on a foreign panic any more, it never calls
        /// the foreign side. The thread that does is the one delivery thread in
        /// the process, so a panic taking it would end every announcement after
        /// it rather than one.
        #[test]
        fn does_not_take_the_announce_thread_with_it() {
            let _guard = serial_global_state();
            set_observer(Some(Arc::new(Exploding::default())));
            quietly(|| {
                notify(Announcement::SyncSettled);
                flush();
            });

            let good = Recorder::new();
            set_observer(Some(good.clone()));
            notify(Announcement::TilesGenerated);
            flush();
            set_observer(None);

            assert_eq!(
                good.events(),
                vec!["tiles_generated"],
                "nothing was delivered after the panic, the announce thread is gone"
            );
        }

        #[test]
        fn is_counted_so_the_log_is_not_the_only_record() {
            let _guard = serial_global_state();
            let exploding = Arc::new(Exploding::default());
            let before = observer_panics();
            set_observer(Some(exploding.clone()));

            quietly(|| {
                notify(Announcement::SyncSettled);
                notify(Announcement::BackfillPhase("fetching".into()));
                flush();
            });

            set_observer(None);
            assert_eq!(exploding.raised(), 2, "the two announcements did not panic");
            assert_eq!(
                observer_panics() - before,
                exploding.raised(),
                "the counter and the panics it counts disagree"
            );
        }

        /// The counter is a process global, so the guarantee is that it moves
        /// once per foreign panic, not that it moves a fixed number of times
        /// here. The guard serialises tests, not a worker an earlier one left
        /// running, and such a worker announcing into the observer installed
        /// here is a third panic nobody asked for. Against a literal that
        /// arrives as somebody else's merge failing on a change that is fine,
        /// which is what this reproduces: the two the test raises, and one from
        /// a thread standing in for that worker.
        #[test]
        fn counts_a_stray_panic_rather_than_a_fixed_number() {
            let _guard = serial_global_state();
            let exploding = Arc::new(Exploding::default());
            let before = observer_panics();
            set_observer(Some(exploding.clone()));

            quietly(|| {
                notify(Announcement::SyncSettled);
                notify(Announcement::BackfillPhase("fetching".into()));
                std::thread::spawn(|| notify(Announcement::TilesGenerated))
                    .join()
                    .expect("the stray announcement was pushed");
                flush();
            });

            set_observer(None);
            assert_eq!(
                exploding.raised(),
                3,
                "the stray announcement did not reach the observer"
            );
            assert_eq!(
                observer_panics() - before,
                exploding.raised(),
                "the counter and the panics it counts disagree"
            );
        }

        #[test]
        fn leaves_the_registry_usable_for_the_next_observer() {
            let _guard = serial_global_state();
            set_observer(Some(Arc::new(Exploding::default())));
            quietly(|| {
                notify(Announcement::SyncSettled);
                flush();
            });

            let good = Recorder::new();
            set_observer(Some(good.clone()));
            notify(Announcement::SyncSettled);
            flush();
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
            set_observer(Some(Arc::new(Exploding::default())));
            quietly(|| {
                set_phase(BACKFILL_PHASE_FETCHING);
                set_phase(BACKFILL_PHASE_COMPLETE);
                flush();
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
