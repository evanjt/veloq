//! The recording index: what the athlete has recorded on this device and how
//! far its upload has got.
//!
//! The FIT file and the streams sidecar stay on the filesystem, because the
//! upload streams the FIT rather than reading it into memory. What lives here
//! is where they are, the metadata the library screen lists, and the retry
//! state the upload processor drives.
//!
//! Retry policy lives here rather than in TypeScript because the state it
//! reads and writes does, and splitting the two is how a load-modify-save over
//! one AsyncStorage key came to need a promise chain around every access.

use rusqlite::{Result as SqlResult, Row, params};

use super::PersistentEngine;

/// Automatic retries before an entry parks as `failed` and waits for the
/// athlete. A failed upload never loses its FIT.
pub const MAX_AUTO_RETRIES: u32 = 5;
const BACKOFF_BASE_MS: i64 = 30_000;
const BACKOFF_CAP_MS: i64 = 60 * 60 * 1000;

/// One recording, as the library screen and the upload processor see it.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct FfiRecordingEntry {
    pub id: String,
    pub fit_path: String,
    pub streams_path: Option<String>,
    pub activity_type: String,
    pub name: String,
    /// Milliseconds since the epoch, when the ride started.
    pub start_time: i64,
    pub duration_seconds: i64,
    pub distance_meters: f64,
    pub elevation_gain: Option<f64>,
    pub avg_heartrate: Option<f64>,
    pub paired_event_id: Option<i64>,
    /// Milliseconds since the epoch, when the recording was saved.
    pub created_at: i64,
    pub upload_status: String,
    pub retry_count: u32,
    pub last_attempt_at: Option<i64>,
    pub last_error: Option<String>,
    pub intervals_activity_id: Option<String>,
    /// The engine key the recording was written under at save time.
    pub engine_activity_id: Option<String>,
}

const COLUMNS: &str = "id, fit_path, streams_path, activity_type, name, start_time, \
     duration_seconds, distance_meters, elevation_gain, avg_heartrate, paired_event_id, \
     created_at, upload_status, retry_count, last_attempt_at, last_error, \
     intervals_activity_id, engine_activity_id";

fn row_to_entry(row: &Row) -> SqlResult<FfiRecordingEntry> {
    Ok(FfiRecordingEntry {
        id: row.get(0)?,
        fit_path: row.get(1)?,
        streams_path: row.get(2)?,
        activity_type: row.get(3)?,
        name: row.get(4)?,
        start_time: row.get(5)?,
        duration_seconds: row.get(6)?,
        distance_meters: row.get(7)?,
        elevation_gain: row.get(8)?,
        avg_heartrate: row.get(9)?,
        paired_event_id: row.get(10)?,
        created_at: row.get(11)?,
        upload_status: row.get(12)?,
        retry_count: row.get::<_, i64>(13)? as u32,
        last_attempt_at: row.get(14)?,
        last_error: row.get(15)?,
        intervals_activity_id: row.get(16)?,
        engine_activity_id: row.get(17)?,
    })
}

/// Whether a pending entry is eligible for an automatic upload attempt now.
/// The backoff doubles per attempt and caps at an hour.
fn retry_eligible(entry: &FfiRecordingEntry, now: i64) -> bool {
    if entry.upload_status != "pending" {
        return false;
    }
    let Some(last) = entry.last_attempt_at else {
        return true;
    };
    let delay = BACKOFF_BASE_MS
        .saturating_mul(1i64 << entry.retry_count.min(32))
        .min(BACKOFF_CAP_MS);
    now - last >= delay
}

impl PersistentEngine {
    /// Insert a recording, or leave an existing row with the same id alone.
    /// Returns whether a row was written, which is what the AsyncStorage
    /// adoption counts.
    pub fn insert_recording(&self, entry: &FfiRecordingEntry) -> SqlResult<bool> {
        let changed = self.db.execute(
            &format!(
                "INSERT OR IGNORE INTO recordings ({COLUMNS}) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            ),
            params![
                entry.id,
                entry.fit_path,
                entry.streams_path,
                entry.activity_type,
                entry.name,
                entry.start_time,
                entry.duration_seconds,
                entry.distance_meters,
                entry.elevation_gain,
                entry.avg_heartrate,
                entry.paired_event_id,
                entry.created_at,
                entry.upload_status,
                entry.retry_count as i64,
                entry.last_attempt_at,
                entry.last_error,
                entry.intervals_activity_id,
                entry.engine_activity_id,
            ],
        )?;
        Ok(changed > 0)
    }

    /// Every recording, newest first.
    pub fn list_recordings(&self) -> SqlResult<Vec<FfiRecordingEntry>> {
        let mut stmt = self
            .db
            .prepare(&format!("SELECT {COLUMNS} FROM recordings ORDER BY created_at DESC"))?;
        let rows = stmt.query_map([], row_to_entry)?;
        rows.collect()
    }

    pub fn get_recording(&self, id: &str) -> SqlResult<Option<FfiRecordingEntry>> {
        let mut stmt = self
            .db
            .prepare(&format!("SELECT {COLUMNS} FROM recordings WHERE id = ?"))?;
        let mut rows = stmt.query_map(params![id], row_to_entry)?;
        rows.next().transpose()
    }

    /// The engine key the recording was written under, so a background retry
    /// can still reconcile the upload.
    pub fn set_recording_engine_activity(&self, id: &str, engine_activity_id: &str) -> SqlResult<()> {
        self.db.execute(
            "UPDATE recordings SET engine_activity_id = ? WHERE id = ?",
            params![engine_activity_id, id],
        )?;
        Ok(())
    }

    pub fn set_recording_uploading(&self, id: &str) -> SqlResult<()> {
        self.db.execute(
            "UPDATE recordings SET upload_status = 'uploading' WHERE id = ?",
            params![id],
        )?;
        Ok(())
    }

    pub fn set_recording_uploaded(&self, id: &str, intervals_activity_id: Option<&str>) -> SqlResult<()> {
        self.db.execute(
            "UPDATE recordings SET upload_status = 'uploaded', intervals_activity_id = ?, \
             last_error = NULL WHERE id = ?",
            params![intervals_activity_id, id],
        )?;
        Ok(())
    }

    /// A retriable failure. The entry stays `pending` until the automatic
    /// retries are exhausted, then parks as `failed` for a manual retry. The
    /// FIT is kept either way.
    pub fn set_recording_upload_failed(&self, id: &str, error: &str, now: i64) -> SqlResult<u32> {
        self.db.execute(
            "UPDATE recordings \
             SET retry_count = retry_count + 1, \
                 last_attempt_at = ?, \
                 last_error = ?, \
                 upload_status = CASE WHEN retry_count + 1 >= ? THEN 'failed' ELSE 'pending' END \
             WHERE id = ?",
            params![now, error, MAX_AUTO_RETRIES as i64, id],
        )?;
        Ok(self
            .get_recording(id)?
            .map(|e| e.retry_count)
            .unwrap_or_default())
    }

    /// A server-side rejection that automatic retries cannot fix.
    pub fn set_recording_rejected(&self, id: &str, error: &str, now: i64) -> SqlResult<()> {
        self.db.execute(
            "UPDATE recordings SET upload_status = 'failed', last_error = ?, last_attempt_at = ? \
             WHERE id = ?",
            params![error, now, id],
        )?;
        Ok(())
    }

    pub fn set_recording_permission_blocked(&self, id: &str, now: i64) -> SqlResult<()> {
        self.db.execute(
            "UPDATE recordings SET upload_status = 'permissionBlocked', last_attempt_at = ? \
             WHERE id = ?",
            params![now, id],
        )?;
        Ok(())
    }

    /// A manual retry, or a requeue after an upgrade: back to `pending` with a
    /// clean slate.
    pub fn requeue_recording(&self, id: &str) -> SqlResult<()> {
        self.db.execute(
            "UPDATE recordings SET upload_status = 'pending', retry_count = 0, \
             last_attempt_at = NULL, last_error = NULL WHERE id = ?",
            params![id],
        )?;
        Ok(())
    }

    /// After an OAuth write upgrade, everything permission-blocked becomes
    /// uploadable again.
    pub fn clear_recording_permission_blocked(&self) -> SqlResult<u32> {
        let changed = self.db.execute(
            "UPDATE recordings SET upload_status = 'pending', retry_count = 0, \
             last_attempt_at = NULL WHERE upload_status = 'permissionBlocked'",
            [],
        )?;
        Ok(changed as u32)
    }

    /// On logout: keep every recording, but stop auto-uploading so nothing
    /// lands in a different account after the next login.
    pub fn demote_recordings_to_local_only(&self) -> SqlResult<u32> {
        let changed = self.db.execute(
            "UPDATE recordings SET upload_status = 'localOnly' \
             WHERE upload_status IN ('pending', 'uploading', 'permissionBlocked')",
            [],
        )?;
        Ok(changed as u32)
    }

    /// The next recording due an automatic upload, respecting the backoff.
    /// Oldest first, so a queue drains in the order it was recorded.
    pub fn next_pending_recording(&self, now: i64) -> SqlResult<Option<FfiRecordingEntry>> {
        let mut stmt = self.db.prepare(&format!(
            "SELECT {COLUMNS} FROM recordings WHERE upload_status = 'pending' \
             ORDER BY created_at ASC"
        ))?;
        let rows = stmt.query_map([], row_to_entry)?;
        for row in rows {
            let entry = row?;
            if retry_eligible(&entry, now) {
                return Ok(Some(entry));
            }
        }
        Ok(None)
    }

    /// Remove one recording, handing back the row so the caller can delete the
    /// files it names.
    pub fn delete_recording(&self, id: &str) -> SqlResult<Option<FfiRecordingEntry>> {
        let entry = self.get_recording(id)?;
        if entry.is_some() {
            self.db
                .execute("DELETE FROM recordings WHERE id = ?", params![id])?;
        }
        Ok(entry)
    }

    /// Recordings intervals.icu does not hold yet, which is every status but
    /// `uploaded`.
    pub fn unuploaded_recording_count(&self) -> SqlResult<u32> {
        self.db.query_row(
            "SELECT COUNT(*) FROM recordings WHERE upload_status != 'uploaded'",
            [],
            |row| row.get::<_, i64>(0).map(|n| n as u32),
        )
    }

    pub fn permission_blocked_recording_count(&self) -> SqlResult<u32> {
        self.db.query_row(
            "SELECT COUNT(*) FROM recordings WHERE upload_status = 'permissionBlocked'",
            [],
            |row| row.get::<_, i64>(0).map(|n| n as u32),
        )
    }

    /// Drop every row. A `.veloqdb` restore carries this table like any other,
    /// but not the FIT files it points at, so the rows are stale the moment
    /// they land on another install.
    pub fn clear_recordings(&self) -> SqlResult<u32> {
        let changed = self.db.execute("DELETE FROM recordings", [])?;
        Ok(changed as u32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn entry(id: &str, created_at: i64, status: &str) -> FfiRecordingEntry {
        FfiRecordingEntry {
            id: id.to_string(),
            fit_path: format!("/recordings/{id}.fit"),
            streams_path: None,
            activity_type: "Ride".to_string(),
            name: format!("Ride {id}"),
            start_time: created_at,
            duration_seconds: 3600,
            distance_meters: 20_000.0,
            elevation_gain: Some(120.0),
            avg_heartrate: Some(148.0),
            paired_event_id: None,
            created_at,
            upload_status: status.to_string(),
            retry_count: 0,
            last_attempt_at: None,
            last_error: None,
            intervals_activity_id: None,
            engine_activity_id: None,
        }
    }

    fn engine() -> (TempDir, PersistentEngine) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("routes.db");
        let engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
        (dir, engine)
    }

    #[test]
    fn a_recording_round_trips_every_field() {
        let (_dir, e) = engine();
        let mut row = entry("r1", 1_000, "pending");
        row.streams_path = Some("/recordings/r1.streams.json".to_string());
        row.paired_event_id = Some(42);
        row.engine_activity_id = Some("local-r1".to_string());
        assert!(e.insert_recording(&row).unwrap());

        let read = e.get_recording("r1").unwrap().unwrap();
        assert_eq!(read.streams_path.as_deref(), Some("/recordings/r1.streams.json"));
        assert_eq!(read.paired_event_id, Some(42));
        assert_eq!(read.engine_activity_id.as_deref(), Some("local-r1"));
        assert_eq!(read.distance_meters, 20_000.0);
    }

    #[test]
    fn a_second_insert_of_the_same_id_leaves_the_first_alone() {
        let (_dir, e) = engine();
        assert!(e.insert_recording(&entry("r1", 1_000, "pending")).unwrap());
        let mut later = entry("r1", 2_000, "uploaded");
        later.name = "clobbered".to_string();
        assert!(!e.insert_recording(&later).unwrap());

        let read = e.get_recording("r1").unwrap().unwrap();
        assert_eq!(read.upload_status, "pending");
        assert_eq!(read.name, "Ride r1");
    }

    #[test]
    fn the_library_lists_newest_first() {
        let (_dir, e) = engine();
        e.insert_recording(&entry("old", 1_000, "pending")).unwrap();
        e.insert_recording(&entry("new", 3_000, "pending")).unwrap();
        e.insert_recording(&entry("mid", 2_000, "pending")).unwrap();

        let ids: Vec<String> = e.list_recordings().unwrap().into_iter().map(|r| r.id).collect();
        assert_eq!(ids, vec!["new", "mid", "old"]);
    }

    #[test]
    fn retries_park_the_entry_as_failed_on_the_last_one() {
        let (_dir, e) = engine();
        e.insert_recording(&entry("r1", 1_000, "pending")).unwrap();

        for attempt in 1..MAX_AUTO_RETRIES {
            let count = e.set_recording_upload_failed("r1", "network", 10_000).unwrap();
            assert_eq!(count, attempt);
            assert_eq!(e.get_recording("r1").unwrap().unwrap().upload_status, "pending");
        }

        let count = e.set_recording_upload_failed("r1", "network", 10_000).unwrap();
        assert_eq!(count, MAX_AUTO_RETRIES);
        let read = e.get_recording("r1").unwrap().unwrap();
        assert_eq!(read.upload_status, "failed");
        assert_eq!(read.last_error.as_deref(), Some("network"));
    }

    #[test]
    fn the_backoff_holds_a_failed_entry_back_and_then_releases_it() {
        let (_dir, e) = engine();
        e.insert_recording(&entry("r1", 1_000, "pending")).unwrap();
        assert!(e.next_pending_recording(0).unwrap().is_some());

        e.set_recording_upload_failed("r1", "network", 100_000).unwrap();
        assert!(
            e.next_pending_recording(100_000 + BACKOFF_BASE_MS - 1).unwrap().is_none(),
            "an entry that just failed is not due again immediately"
        );
        assert!(
            e.next_pending_recording(100_000 + BACKOFF_BASE_MS * 2).unwrap().is_some(),
            "the backoff after one failure is two base intervals"
        );
    }

    #[test]
    fn only_pending_entries_are_ever_picked_up() {
        let (_dir, e) = engine();
        e.insert_recording(&entry("local", 1_000, "localOnly")).unwrap();
        e.insert_recording(&entry("blocked", 2_000, "permissionBlocked")).unwrap();
        e.insert_recording(&entry("done", 3_000, "uploaded")).unwrap();

        assert!(e.next_pending_recording(9_999_999).unwrap().is_none());
    }

    #[test]
    fn the_queue_drains_oldest_first() {
        let (_dir, e) = engine();
        e.insert_recording(&entry("new", 3_000, "pending")).unwrap();
        e.insert_recording(&entry("old", 1_000, "pending")).unwrap();

        assert_eq!(e.next_pending_recording(9_999).unwrap().unwrap().id, "old");
    }

    #[test]
    fn an_upgrade_releases_the_blocked_and_a_logout_demotes_the_live_ones() {
        let (_dir, e) = engine();
        e.insert_recording(&entry("blocked", 1_000, "permissionBlocked")).unwrap();
        e.insert_recording(&entry("pending", 2_000, "pending")).unwrap();
        e.insert_recording(&entry("done", 3_000, "uploaded")).unwrap();

        assert_eq!(e.clear_recording_permission_blocked().unwrap(), 1);
        assert_eq!(e.get_recording("blocked").unwrap().unwrap().upload_status, "pending");

        assert_eq!(e.demote_recordings_to_local_only().unwrap(), 2);
        assert_eq!(e.get_recording("done").unwrap().unwrap().upload_status, "uploaded");
        assert_eq!(e.get_recording("pending").unwrap().unwrap().upload_status, "localOnly");
    }

    #[test]
    fn a_delete_hands_back_the_row_so_its_files_can_go_too() {
        let (_dir, e) = engine();
        let mut row = entry("r1", 1_000, "pending");
        row.streams_path = Some("/recordings/r1.streams.json".to_string());
        e.insert_recording(&row).unwrap();

        let deleted = e.delete_recording("r1").unwrap().unwrap();
        assert_eq!(deleted.fit_path, "/recordings/r1.fit");
        assert_eq!(deleted.streams_path.as_deref(), Some("/recordings/r1.streams.json"));
        assert!(e.get_recording("r1").unwrap().is_none());
        assert!(e.delete_recording("r1").unwrap().is_none());
    }

    #[test]
    fn the_counts_answer_what_the_badges_ask() {
        let (_dir, e) = engine();
        e.insert_recording(&entry("a", 1_000, "pending")).unwrap();
        e.insert_recording(&entry("b", 2_000, "permissionBlocked")).unwrap();
        e.insert_recording(&entry("c", 3_000, "uploaded")).unwrap();

        assert_eq!(e.unuploaded_recording_count().unwrap(), 2);
        assert_eq!(e.permission_blocked_recording_count().unwrap(), 1);
    }

    #[test]
    fn a_requeue_clears_the_retry_state_the_failure_left() {
        let (_dir, e) = engine();
        e.insert_recording(&entry("r1", 1_000, "pending")).unwrap();
        e.set_recording_upload_failed("r1", "network", 100_000).unwrap();

        e.requeue_recording("r1").unwrap();
        let read = e.get_recording("r1").unwrap().unwrap();
        assert_eq!(read.upload_status, "pending");
        assert_eq!(read.retry_count, 0);
        assert_eq!(read.last_attempt_at, None);
        assert_eq!(read.last_error, None);
    }

    #[test]
    fn a_successful_upload_clears_the_error_the_last_attempt_left() {
        let (_dir, e) = engine();
        e.insert_recording(&entry("r1", 1_000, "pending")).unwrap();
        e.set_recording_upload_failed("r1", "network", 100_000).unwrap();

        e.set_recording_uploaded("r1", Some("i12345")).unwrap();
        let read = e.get_recording("r1").unwrap().unwrap();
        assert_eq!(read.upload_status, "uploaded");
        assert_eq!(read.intervals_activity_id.as_deref(), Some("i12345"));
        assert_eq!(read.last_error, None);
    }

    #[test]
    fn a_restore_wipes_rows_whose_fit_files_did_not_come_with_it() {
        let (_dir, e) = engine();
        e.insert_recording(&entry("a", 1_000, "pending")).unwrap();
        e.insert_recording(&entry("b", 2_000, "uploaded")).unwrap();

        assert_eq!(e.clear_recordings().unwrap(), 2);
        assert!(e.list_recordings().unwrap().is_empty());
    }
}
