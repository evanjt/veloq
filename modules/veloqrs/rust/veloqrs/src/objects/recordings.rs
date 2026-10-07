use super::error::{VeloqError, with_engine, with_reader};
use crate::net::upload_recording::{FfiUploadOutcome, FfiUploadResult, Live, upload_ride};
use crate::persistence::FfiRecordingEntry;
use crate::persistence::recordings::{
    FfiUploadTransitionAnswer, UploadRefusal, UploadTransition, pooled,
};
use std::sync::Arc;

fn db(err: rusqlite::Error) -> VeloqError {
    VeloqError::Database {
        msg: err.to_string(),
    }
}

/// The recording index's FFI surface.
///
/// Every call is one transaction, so nothing here needs a promise chain around
/// it the way the AsyncStorage index did: two writers racing is what SQLite
/// already answers. The FIT file and a manual entry's body stay TypeScript's
/// to write and delete; the upload reads them from the paths the row names.
#[derive(uniffi::Object)]
pub struct RecordingManager {
    pub(crate) _private: (),
}

#[uniffi::export]
impl RecordingManager {
    #[uniffi::constructor]
    fn new() -> Arc<Self> {
        Arc::new(Self { _private: () })
    }

    /// Add a recording, or leave an existing row with the same id alone.
    /// Returns whether a row was written, which is what the one-off adoption
    /// of the AsyncStorage index counts.
    fn add_recording(&self, entry: FfiRecordingEntry) -> Result<bool, VeloqError> {
        with_engine(|e| e.insert_recording(&entry).map_err(db))?
    }

    /// Every recording, newest first.
    fn list_recordings(&self) -> Result<Vec<FfiRecordingEntry>, VeloqError> {
        with_reader(|conn| pooled::list(conn).map_err(db))?
    }

    fn get_recording(&self, id: String) -> Result<Option<FfiRecordingEntry>, VeloqError> {
        with_reader(|conn| pooled::recording(conn, &id).map_err(db))?
    }

    /// Every recording the signed-in athlete may see, newest first: their own
    /// and the unstamped ones, never another athlete's held rides.
    fn list_visible_recordings(
        &self,
        athlete_id: Option<String>,
    ) -> Result<Vec<FfiRecordingEntry>, VeloqError> {
        with_reader(|conn| pooled::list_visible(conn, athlete_id.as_deref()).map_err(db))?
    }

    /// One recording, `None` when it is stamped with another athlete.
    fn get_visible_recording(
        &self,
        id: String,
        athlete_id: Option<String>,
    ) -> Result<Option<FfiRecordingEntry>, VeloqError> {
        with_reader(|conn| pooled::recording_visible(conn, &id, athlete_id.as_deref()).map_err(db))?
    }

    /// Recordings intervals.icu does not hold yet, among those the signed-in
    /// athlete may see.
    fn unuploaded_visible_count(&self, athlete_id: Option<String>) -> Result<u32, VeloqError> {
        with_reader(|conn| {
            pooled::unuploaded_visible_count(conn, athlete_id.as_deref()).map_err(db)
        })?
    }

    /// Remember the engine key the recording was written under, so a
    /// background retry can still reconcile the upload.
    fn attach_engine_activity(
        &self,
        id: String,
        engine_activity_id: String,
    ) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.set_recording_engine_activity(&id, &engine_activity_id)
                .map_err(db)
        })?
    }

    /// The engine row has taken the id intervals.icu gave the upload, so the
    /// reconcile sweep can stop replaying this one.
    fn mark_reconciled(&self, id: String) -> Result<(), VeloqError> {
        with_engine(|e| e.set_recording_reconciled(&id).map_err(db))?
    }

    /// intervals.icu has the effort the athlete set, so the sweep that sends
    /// an owed one can stop.
    fn mark_rpe_sent(&self, id: String) -> Result<(), VeloqError> {
        with_engine(|e| e.set_recording_rpe_sent(&id).map_err(db))?
    }

    /// Move one recording's upload by a named transition, refused when the row
    /// is in a state the transition may not leave from. A begin answers the
    /// install it ran under; an outcome carries that install back, runs under
    /// it, and is refused once a restore or wipe has moved it on.
    fn transition(
        &self,
        id: String,
        transition: UploadTransition,
        now_ms: f64,
    ) -> Result<FfiUploadTransitionAnswer, VeloqError> {
        let now_ms = crate::ffi_types::int_from_wire(now_ms);
        let apply = |e: &mut crate::persistence::PersistentEngine| {
            // Read under the engine lock, so it names the engine written to.
            let install = crate::persistence::engine_install() as f64;
            let answer = e
                .transition_recording(&id, &transition, now_ms)
                .map_err(db)?;
            Ok(FfiUploadTransitionAnswer { install, ..answer })
        };
        let Some(install) = transition.install() else {
            return with_engine(apply)?;
        };
        let install = crate::ffi_types::uint_from_wire(install);
        match crate::persistence::with_persistent_engine_for(install, apply) {
            Some(answer) => answer,
            None => {
                let open = crate::persistence::engine_install();
                if open == install {
                    Err(VeloqError::NotInitialized)
                } else {
                    Ok(FfiUploadTransitionAnswer::refused_unread(
                        UploadRefusal::AnotherInstall,
                        open as f64,
                    ))
                }
            }
        }
    }

    /// An athlete signed in: stop auto-uploading every ride that is not
    /// theirs, unstamped ones included. Returns how many were held.
    fn hold_other_athletes(&self, athlete_id: String) -> Result<u32, VeloqError> {
        with_engine(|e| e.hold_recordings_of_other_athletes(&athlete_id).map_err(db))?
    }

    /// Name the library's athlete on every ride that has none. Returns how
    /// many were named.
    fn stamp_ownerless(&self, athlete_id: String) -> Result<u32, VeloqError> {
        with_engine(|e| e.stamp_ownerless_recordings(&athlete_id).map_err(db))?
    }

    /// After an OAuth write upgrade, the upgrading athlete's permission-blocked
    /// rides become uploadable again, and nobody else's. Returns how many moved.
    fn clear_permission_blocked(&self, athlete_id: String) -> Result<u32, VeloqError> {
        with_engine(|e| {
            e.clear_recording_permission_blocked(&athlete_id)
                .map_err(db)
        })?
    }

    /// Start the upload schedule if it is not running, and wake it. Called when
    /// the engine is ready and when the athlete grants write permission, the one
    /// trigger that is theirs rather than the schedule's.
    fn wake_upload_schedule(&self) {
        crate::net::upload_schedule::start_or_wake();
    }

    /// Upload one recording now, the whole sequence the schedule runs for a
    /// due ride, and answer how it ended. `manual` is the athlete asking, from
    /// the review save or Upload now: a parked ride is requeued first and its
    /// backoff does not apply.
    ///
    /// The requests block, so the sequence runs on a thread of its own and
    /// this resolves when it has finished.
    async fn upload_recording(&self, id: String, manual: bool) -> FfiUploadResult {
        let (tx, rx) = tokio::sync::oneshot::channel();
        crate::threads::spawn_named("veloq-upload", move || {
            let now = || chrono::Utc::now().timestamp_millis();
            let _ = tx.send(upload_ride(&id, manual, &Live, &now));
        });
        // A sequence that died without answering sent something or nothing,
        // and either way the row says which: nothing was settled by this call.
        rx.await.unwrap_or(FfiUploadResult {
            outcome: FfiUploadOutcome::NotStarted,
            error_detail: None,
        })
    }

    /// Remove one recording the signed-in athlete may see, handing back the
    /// row so the caller can delete the files it names. A row stamped with
    /// another athlete is left in place and answers `None`.
    fn delete_own_recording(
        &self,
        id: String,
        athlete_id: Option<String>,
    ) -> Result<Option<FfiRecordingEntry>, VeloqError> {
        with_engine(|e| {
            e.delete_own_recording(&id, athlete_id.as_deref())
                .map_err(db)
        })?
    }

    /// Drop every row. A `.veloqdb` restore carries this table like any other
    /// but not the FIT files it points at, so the rows are stale the moment
    /// they land on another install.
    fn clear_recordings(&self) -> Result<u32, VeloqError> {
        with_engine(|e| e.clear_recordings().map_err(db))?
    }
}

#[cfg(test)]
#[path = "tests/recordings_pooled.rs"]
mod pooled_tests;
