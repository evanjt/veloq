//! Quiet the engine's writers before the process is suspended.
//!
//! On iOS the library lives in the App Group container, and the system
//! terminates a suspended app that still holds a file lock on a file in a
//! shared container. A write transaction holds SQLite's locks for as long as it
//! is open, and sync, detection and the backfills write on threads of their own
//! that keep running after the app leaves the foreground. A swipe home in the
//! middle of one of them would end in a termination and a cold start. WAL rolls
//! the transaction back, so the cost is the crash and the redone work.
//!
//! This module is the one owner of that state. Every write passes through
//! [`begin_write`]: the engine write lock in `with_persistent_engine_at`, the
//! workers' own connections in `worker_write`, the settings connection and the
//! heatmap lease release. While the engine is suspended a write asked for from
//! one of the engine's own threads waits for the resume and then lands, so no
//! lease release or bookkeeping write is lost. One asked for from any other
//! thread is refused at once: that is the JavaScript thread or a native
//! caller, and parking it could hold the main thread on the way back to the
//! foreground. A write from such a thread that must still land, a lease
//! release, goes through [`write_or_defer`], which keeps it for the resume.
//!
//! A read that runs past a frame on a thread of its own holds a lock too: in
//! WAL a reader keeps a read mark in the `-shm` file for as long as its
//! statement or transaction is open. Such a read passes through [`begin_read`],
//! which the suspension counts and waits on exactly as it does a write. A long
//! job reads in short pieces, each under its own hold, so the suspension waits
//! for one piece rather than the whole job, and the job's next `begin_read`
//! is where it pauses until the resume.
//!
//! Nothing suspends unless the platform has said the app is in the background
//! and no resume has come since. A suspension asked for late, after the app has
//! already come back, is refused rather than leaving a foreground engine that
//! cannot write.

use std::cell::Cell;
use std::marker::PhantomData;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use crate::objects::sync::Interrupted;
use crate::persistence::sections::conditioning::DetectionSuspendGuard;

struct State {
    /// The platform has reported the app in the background, and no resume
    /// has come since.
    background: bool,
    suspended: bool,
    /// Writes in flight, counted once per thread however deeply they nest.
    writes: usize,
    /// Reads in flight, counted the same way.
    reads: usize,
    /// Bumped by every resume, so a wait the resume overtook ends.
    resumes: u64,
    detection: Option<DetectionSuspendGuard>,
    sync: Option<Interrupted>,
    /// Writes a suspension refused that must still land, run by the next
    /// resume before it restarts any work.
    deferred: Vec<DeferredWrite>,
}

/// A write kept for the resume. It answers whether it landed.
type DeferredWrite = Box<dyn FnMut() -> bool + Send>;

static STATE: Mutex<State> = Mutex::new(State {
    background: false,
    suspended: false,
    writes: 0,
    reads: 0,
    resumes: 0,
    detection: None,
    sync: None,
    deferred: Vec::new(),
});

/// Signalled when the last hold in flight ends and on every resume.
static CHANGED: Condvar = Condvar::new();

/// `State::suspended`, readable without the lock.
static SUSPENDED: AtomicBool = AtomicBool::new(false);

thread_local! {
    /// Holds this thread has open, so a write nested inside one in flight is
    /// part of it rather than a new one.
    static DEPTH: Cell<usize> = const { Cell::new(0) };
    /// What the outermost hold on this thread counts, which is what its drop
    /// gives back.
    static OUTER: Cell<Kind> = const { Cell::new(Kind::Write) };
    /// Whether this thread is one the engine started, and so may wait out a
    /// suspension.
    static ENGINE_THREAD: Cell<bool> = const { Cell::new(false) };
}

fn state() -> MutexGuard<'static, State> {
    STATE.lock().unwrap_or_else(|e| e.into_inner())
}

#[derive(Clone, Copy)]
enum Kind {
    Write,
    Read,
}

impl State {
    fn count(&mut self, kind: Kind) -> &mut usize {
        match kind {
            Kind::Write => &mut self.writes,
            Kind::Read => &mut self.reads,
        }
    }
}

/// A write or a read in flight. The suspension waits for every one of them
/// to drop.
#[must_use = "the work counts as in flight only while the hold lives"]
pub struct Hold {
    /// Held on the thread that took it, which is where its depth is counted.
    _thread: PhantomData<*const ()>,
}

impl Drop for Hold {
    fn drop(&mut self) {
        let depth = DEPTH.with(|d| {
            let next = d.get().saturating_sub(1);
            d.set(next);
            next
        });
        if depth == 0 {
            let mut state = state();
            let count = state.count(OUTER.with(Cell::get));
            *count = count.saturating_sub(1);
            if state.writes == 0 && state.reads == 0 {
                CHANGED.notify_all();
            }
        }
    }
}

fn hold() -> Hold {
    DEPTH.with(|d| d.set(d.get() + 1));
    Hold {
        _thread: PhantomData,
    }
}

/// Count a new outermost hold of `kind` and take it. The state lock is held.
fn outermost(mut state: MutexGuard<'_, State>, kind: Kind) -> Hold {
    *state.count(kind) += 1;
    drop(state);
    OUTER.with(|o| o.set(kind));
    hold()
}

/// Mark the calling thread as one of the engine's own, which waits out a
/// suspension rather than being refused. Every thread `threads::spawn_named`
/// starts and every thread of the shared runtime calls it first.
pub(crate) fn mark_engine_thread() {
    ENGINE_THREAD.with(|t| t.set(true));
}

/// Take a hold for a write about to start, or `None` when the engine is
/// suspended and this thread may not wait.
///
/// A thread that already holds one gets another without asking: that write is
/// part of the one in flight, which the suspension is waiting on.
pub(crate) fn begin_write() -> Option<Hold> {
    begin(Kind::Write)
}

/// Take a hold for a read about to start on a connection of its own, or
/// `None` when the engine is suspended and this thread may not wait.
///
/// For a read that may outlast a frame: the statement or transaction it opens
/// holds a read mark on the library until it ends, which the suspension has to
/// wait for. End the read, statement finalised or transaction closed, before
/// the hold drops. A job longer than that reads in pieces, one hold each, and
/// on an engine thread the next piece's `begin_read` waits out a suspension,
/// holding nothing meanwhile.
pub(crate) fn begin_read() -> Option<Hold> {
    begin(Kind::Read)
}

fn begin(kind: Kind) -> Option<Hold> {
    if DEPTH.with(Cell::get) > 0 {
        return Some(hold());
    }
    let may_wait = ENGINE_THREAD.with(Cell::get);
    let mut state = state();
    while state.suspended {
        if !may_wait {
            return None;
        }
        state = CHANGED.wait(state).unwrap_or_else(|e| e.into_inner());
    }
    Some(outermost(state, kind))
}

/// `begin_write` that never waits, for a write that is skipped rather than
/// queued when the engine is suspended.
pub(crate) fn try_begin_write() -> Option<Hold> {
    if DEPTH.with(Cell::get) > 0 {
        return Some(hold());
    }
    let state = state();
    if state.suspended {
        return None;
    }
    Some(outermost(state, Kind::Write))
}

/// Run `write`, and when a suspension refuses it, keep it for the next resume.
///
/// For a write that must not be lost to a suspension, a lease release above
/// all: asked for on a thread that is not the engine's own and refused, the
/// lease stays held for the rest of the process and every later claim on the
/// key is answered busy. The resume runs what was kept on a thread of its own,
/// before the work it restarts claims anything. `write` answers whether it
/// landed. One refused for another reason, a closed engine or a replaced
/// install, is dropped, which is what that refusal means anyway.
pub(crate) fn write_or_defer(mut write: impl FnMut() -> bool + Send + 'static) {
    loop {
        let resumes = state().resumes;
        if write() {
            return;
        }
        let mut state = state();
        if state.suspended {
            state.deferred.push(Box::new(write));
            return;
        }
        if state.resumes == resumes {
            return;
        }
        // A resume came between the refusal and this look, so the refusal may
        // have been the suspension's. Ask again.
    }
}

/// Whether writes are stopped for a suspension.
pub fn is_suspended() -> bool {
    SUSPENDED.load(Ordering::Acquire)
}

/// The app has gone into the background. From now until the next resume a
/// suspension may be prepared.
pub fn entered_background() {
    state().background = true;
}

/// Stop the engine writing before the process is suspended, and say whether
/// it is quiet.
///
/// New writes and reads stop at once, sync is cut short and detection starts
/// no new run. Writes already in flight are given until `deadline` to commit
/// or roll back, and reads until then to end. True means none is left open. False means the wait ran out, a resume
/// overtook it, or the app was not in the background, which is the only case
/// that leaves writes open. A second call while suspended only waits again.
pub fn prepare_for_suspension(deadline: Duration) -> bool {
    let until = Instant::now() + deadline;
    let (resumes, newly) = {
        let mut state = state();
        if !state.background {
            return false;
        }
        let newly = !state.suspended;
        if newly {
            state.suspended = true;
            SUSPENDED.store(true, Ordering::Release);
            state.detection = Some(crate::persistence::suspend_detection());
        }
        (state.resumes, newly)
    };
    if newly {
        // Outside the state lock, because the sync service takes its own.
        let interrupted = crate::objects::sync::interrupt_sync();
        let mut state = state();
        if state.resumes == resumes {
            state.sync = interrupted;
        } else {
            drop(state);
            crate::objects::sync::resume_sync_after_clear(interrupted);
        }
    }

    let mut state = state();
    loop {
        if state.resumes != resumes {
            return false;
        }
        if state.writes == 0 && state.reads == 0 {
            log::info!("veloqrs: [suspension] the engine is quiet");
            return true;
        }
        let now = Instant::now();
        if now >= until {
            log::warn!(
                "veloqrs: [suspension] {} write(s) and {} read(s) still open at the deadline",
                state.writes,
                state.reads
            );
            return false;
        }
        state = CHANGED
            .wait_timeout(state, until - now)
            .unwrap_or_else(|e| e.into_inner())
            .0;
    }
}

/// The app is back in the foreground, or a background task needs the engine.
/// Writes start again, the writers waiting on the suspension go on, and the
/// sync it cut short starts again on a thread of its own.
pub fn resume_after_suspension() {
    let (detection, sync, deferred, was_suspended) = {
        let mut state = state();
        state.background = false;
        state.resumes += 1;
        let was_suspended = state.suspended;
        state.suspended = false;
        SUSPENDED.store(false, Ordering::Release);
        CHANGED.notify_all();
        (
            state.detection.take(),
            state.sync.take(),
            std::mem::take(&mut state.deferred),
            was_suspended,
        )
    };
    drop(detection);
    if was_suspended {
        // Off the calling thread, which is the main thread on iOS: restarting
        // the work may wait on the engine lock, and so may the kept writes.
        crate::threads::spawn_background("veloq-resume", move || {
            // First, so a lease the suspension kept is free before the work
            // below asks for it.
            for write in deferred {
                write_or_defer(write);
            }
            crate::objects::sync::resume_sync_after_clear(sync);
            crate::persistence::sections::conditioning::condition_pending();
        });
    }
}

/// The C entries the iOS app delegate and the widget refresh task call. Not
/// gated on the target, because a C symbol costs nothing elsewhere.
mod c {
    /// The app entered the background: a suspension may now be prepared.
    #[unsafe(no_mangle)]
    pub extern "C" fn veloq_engine_entered_background() {
        crate::ffi_refuse_on_panic("entered background", (), || {
            super::entered_background();
        })
    }

    /// [`super::prepare_for_suspension`], blocking for up to `deadline_ms`.
    #[unsafe(no_mangle)]
    pub extern "C" fn veloq_engine_prepare_for_suspension(deadline_ms: u32) -> bool {
        crate::ffi_refuse_on_panic("prepare for suspension", false, || {
            super::prepare_for_suspension(std::time::Duration::from_millis(u64::from(deadline_ms)))
        })
    }

    /// [`super::resume_after_suspension`].
    #[unsafe(no_mangle)]
    pub extern "C" fn veloq_engine_resume_after_suspension() {
        crate::ffi_refuse_on_panic("resume after suspension", (), || {
            super::resume_after_suspension();
        })
    }
}

/// Put the state back to a process that has never been suspended, so one
/// test's suspension cannot reach the next.
#[cfg(test)]
pub(crate) fn reset() {
    let mut state = state();
    state.background = false;
    state.suspended = false;
    state.detection = None;
    state.sync = None;
    state.deferred.clear();
    state.resumes += 1;
    SUSPENDED.store(false, Ordering::Release);
    CHANGED.notify_all();
}

#[cfg(test)]
#[path = "tests/suspension.rs"]
mod tests;
