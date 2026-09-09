use super::error::{VeloqError, with_engine};
use crate::persistence::FfiRecordingEntry;
use std::sync::Arc;

fn db(err: rusqlite::Error) -> VeloqError {
    VeloqError::Database {
        msg: err.to_string(),
    }
}

/// The recording index's FFI surface.
///
/// Every call is one statement against one table, so nothing here needs a
/// promise chain around it the way the AsyncStorage index did: two writers
/// racing is what SQLite already answers. The FIT file and the streams sidecar
/// stay TypeScript's to write and delete, because the upload streams the FIT
/// rather than reading it into memory.
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
        with_engine(|e| e.list_recordings().map_err(db))?
    }

    fn get_recording(&self, id: String) -> Result<Option<FfiRecordingEntry>, VeloqError> {
        with_engine(|e| e.get_recording(&id).map_err(db))?
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

    /// Forget the streams sidecar, once the engine holds the ride's track.
    fn clear_streams_path(&self, id: String) -> Result<(), VeloqError> {
        with_engine(|e| e.clear_recording_streams_path(&id).map_err(db))?
    }

    fn mark_uploading(&self, id: String) -> Result<(), VeloqError> {
        with_engine(|e| e.set_recording_uploading(&id).map_err(db))?
    }

    fn mark_uploaded(
        &self,
        id: String,
        intervals_activity_id: Option<String>,
    ) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.set_recording_uploaded(&id, intervals_activity_id.as_deref())
                .map_err(db)
        })?
    }

    /// A retriable failure. Returns the attempt count it now stands at, so the
    /// caller can log the same "retry n of m" line it used to compute itself.
    fn mark_upload_failed(
        &self,
        id: String,
        error: String,
        now_ms: i64,
    ) -> Result<u32, VeloqError> {
        with_engine(|e| {
            e.set_recording_upload_failed(&id, &error, now_ms)
                .map_err(db)
        })?
    }

    /// A server-side rejection automatic retries cannot fix.
    fn mark_rejected(&self, id: String, error: String, now_ms: i64) -> Result<(), VeloqError> {
        with_engine(|e| e.set_recording_rejected(&id, &error, now_ms).map_err(db))?
    }

    fn mark_permission_blocked(&self, id: String, now_ms: i64) -> Result<(), VeloqError> {
        with_engine(|e| e.set_recording_permission_blocked(&id, now_ms).map_err(db))?
    }

    /// A credential was refused mid-upload. The ride goes back in the queue
    /// with its attempts intact, because a 401 is not an attempt it spent.
    fn hold_for_auth(&self, id: String, error: String) -> Result<(), VeloqError> {
        with_engine(|e| e.hold_recording_for_auth(&id, &error).map_err(db))?
    }

    /// An athlete signed in: stop auto-uploading every ride that is not
    /// theirs, unstamped ones included. Returns how many were held.
    fn hold_other_athletes(&self, athlete_id: String) -> Result<u32, VeloqError> {
        with_engine(|e| e.hold_recordings_of_other_athletes(&athlete_id).map_err(db))?
    }

    /// A manual retry, or a requeue after an upgrade.
    fn requeue(&self, id: String) -> Result<(), VeloqError> {
        with_engine(|e| e.requeue_recording(&id).map_err(db))?
    }

    /// After an OAuth write upgrade, everything permission-blocked becomes
    /// uploadable again. Returns how many moved.
    fn clear_permission_blocked(&self) -> Result<u32, VeloqError> {
        with_engine(|e| e.clear_recording_permission_blocked().map_err(db))?
    }

    /// On logout: keep every recording on device, but stop auto-uploading so
    /// nothing lands in a different account after the next login.
    fn demote_pending_to_local_only(&self) -> Result<u32, VeloqError> {
        with_engine(|e| e.demote_recordings_to_local_only().map_err(db))?
    }

    /// The next recording due an automatic upload, respecting the backoff.
    fn next_pending_upload(&self, now_ms: i64) -> Result<Option<FfiRecordingEntry>, VeloqError> {
        with_engine(|e| e.next_pending_recording(now_ms).map_err(db))?
    }

    /// Remove one recording, handing back the row so the caller can delete the
    /// files it names.
    fn delete_recording(&self, id: String) -> Result<Option<FfiRecordingEntry>, VeloqError> {
        with_engine(|e| e.delete_recording(&id).map_err(db))?
    }

    /// Recordings intervals.icu does not hold yet.
    fn unuploaded_count(&self) -> Result<u32, VeloqError> {
        with_engine(|e| e.unuploaded_recording_count().map_err(db))?
    }

    fn permission_blocked_count(&self) -> Result<u32, VeloqError> {
        with_engine(|e| e.permission_blocked_recording_count().map_err(db))?
    }

    /// Drop every row. A `.veloqdb` restore carries this table like any other
    /// but not the FIT files it points at, so the rows are stale the moment
    /// they land on another install.
    fn clear_recordings(&self) -> Result<u32, VeloqError> {
        with_engine(|e| e.clear_recordings().map_err(db))?
    }
}
