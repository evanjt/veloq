//! The recording index: what the athlete has recorded on this device and how
//! far its upload has got.
//!
//! The FIT file and a manual entry's body stay on the filesystem, because the
//! upload streams the FIT rather than reading it into memory. What lives here
//! is where they are, the metadata the library screen lists, and the retry
//! state the upload processor drives.
//!
//! Retry policy lives here rather than in TypeScript because the state it
//! reads and writes does, and splitting the two is how a load-modify-save over
//! one AsyncStorage key came to need a promise chain around every access.

use rusqlite::{Connection, Result as SqlResult, Row, params};

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
    /// `fit` for a ride this device recorded, `manual` for an entry the athlete
    /// typed. A manual row has no FIT and an empty `fit_path`, so the upload path
    /// branches on this rather than on whether a file happens to be there.
    pub kind: String,
    pub fit_path: String,
    /// A manual entry's request body. On a ride an earlier build saved, a
    /// streams copy that is no longer written or read, kept only so a delete
    /// takes the file with the row.
    pub streams_path: Option<String>,
    pub activity_type: String,
    pub name: String,
    /// Milliseconds since the epoch, when the ride started.
    pub start_time: f64,
    pub duration_seconds: f64,
    pub distance_meters: f64,
    pub elevation_gain: Option<f64>,
    pub avg_heartrate: Option<f64>,
    pub paired_event_id: Option<f64>,
    /// Milliseconds since the epoch, when the recording was saved.
    pub created_at: f64,
    pub upload_status: String,
    pub retry_count: u32,
    pub last_attempt_at: Option<f64>,
    pub last_error: Option<String>,
    pub intervals_activity_id: Option<String>,
    /// The engine key the recording was written under at save time.
    pub engine_activity_id: Option<String>,
    /// Whether the engine row has taken the id intervals.icu gave the upload.
    /// False on a ride uploaded while the engine was closed, which is the case
    /// the reconcile sweep exists to replay.
    pub engine_reconciled: bool,
    /// The athlete signed in when the recording was saved. `None` on a row
    /// written before the column existed, which is not the same as a row that
    /// belongs to nobody: an unstamped entry is held rather than uploaded.
    pub athlete_id: Option<String>,
    /// What the athlete wrote on the review screen. It goes up as the
    /// activity's description.
    pub notes: Option<String>,
    /// The effort from 1 to 10 the athlete set on the review screen, `None`
    /// when the slider was never moved.
    pub rpe: Option<u32>,
    /// Whether intervals.icu has the effort. It goes up after the upload, so a
    /// failed update is retried from here without sending the file again.
    pub rpe_sent: bool,
}

const COLUMNS: &str = "id, kind, fit_path, streams_path, activity_type, name, start_time, \
     duration_seconds, distance_meters, elevation_gain, avg_heartrate, paired_event_id, \
     created_at, upload_status, retry_count, last_attempt_at, last_error, \
     intervals_activity_id, engine_activity_id, engine_reconciled, athlete_id, notes, rpe, \
     rpe_sent";

fn row_to_entry(row: &Row) -> SqlResult<FfiRecordingEntry> {
    Ok(FfiRecordingEntry {
        id: row.get(0)?,
        kind: row.get(1)?,
        fit_path: row.get(2)?,
        streams_path: row.get(3)?,
        activity_type: row.get(4)?,
        name: row.get(5)?,
        start_time: row.get(6)?,
        duration_seconds: row.get(7)?,
        distance_meters: row.get(8)?,
        elevation_gain: row.get(9)?,
        avg_heartrate: row.get(10)?,
        paired_event_id: row.get(11)?,
        created_at: row.get(12)?,
        upload_status: row.get(13)?,
        retry_count: row.get::<_, i64>(14)? as u32,
        last_attempt_at: row.get(15)?,
        last_error: row.get(16)?,
        intervals_activity_id: row.get(17)?,
        engine_activity_id: row.get(18)?,
        engine_reconciled: row.get::<_, i64>(19)? != 0,
        athlete_id: row.get(20)?,
        notes: row.get(21)?,
        rpe: row.get(22)?,
        rpe_sent: row.get::<_, i64>(23)? != 0,
    })
}

fn list_recordings_on(conn: &Connection) -> SqlResult<Vec<FfiRecordingEntry>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM recordings ORDER BY created_at DESC"
    ))?;
    let rows = stmt.query_map([], row_to_entry)?;
    rows.collect()
}

/// When a pending entry becomes eligible for an automatic upload attempt, in
/// epoch milliseconds, and `None` for an entry that is not pending. One that has
/// never been tried is eligible from the epoch, so it is always due.
/// The backoff doubles per attempt and caps at an hour.
fn eligible_at(entry: &FfiRecordingEntry) -> Option<i64> {
    if entry.upload_status != "pending" {
        return None;
    }
    let Some(last) = entry.last_attempt_at else {
        return Some(0);
    };
    let delay = BACKOFF_BASE_MS
        .saturating_mul(1i64 << entry.retry_count.min(32))
        .min(BACKOFF_CAP_MS);
    Some((last as i64).saturating_add(delay))
}

/// Whether a pending entry is eligible for an automatic upload attempt now.
fn retry_eligible(entry: &FfiRecordingEntry, now: i64) -> bool {
    eligible_at(entry).is_some_and(|at| now >= at)
}

/// Where a recording's upload has got, as `upload_status` stores it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum UploadStatus {
    Pending,
    Uploading,
    Uploaded,
    Failed,
    PermissionBlocked,
    LocalOnly,
}

impl UploadStatus {
    const fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Uploading => "uploading",
            Self::Uploaded => "uploaded",
            Self::Failed => "failed",
            Self::PermissionBlocked => "permissionBlocked",
            Self::LocalOnly => "localOnly",
        }
    }

    fn parse(status: &str) -> Option<Self> {
        [
            Self::Pending,
            Self::Uploading,
            Self::Uploaded,
            Self::Failed,
            Self::PermissionBlocked,
            Self::LocalOnly,
        ]
        .into_iter()
        .find(|s| s.as_str() == status)
    }
}

/// Every move a recording's upload state makes, the athlete-wide ones and the
/// launch release included, so the states each may leave from have one table.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum UploadMove {
    Begin,
    Uploaded,
    Failed,
    Rejected,
    PermissionBlocked,
    HeldForAuth,
    HeldForNetwork,
    Requeue,
    ReleaseStranded,
    HoldForOtherAthlete,
    ReleasePermissionBlocked,
}

impl UploadMove {
    /// The states this move may leave from. A row in any other state refuses it.
    ///
    /// Only a request in flight has an outcome to report, so the failure and
    /// hold outcomes leave from `uploading` alone: a late one over a sign-in
    /// hold or a launch release would put the ride back in the queue. A
    /// success leaves from every state but `uploaded`, because the server
    /// holding the activity is a fact a refusal would lose and the next drain
    /// would duplicate. A rejection is read before the begin (the body is
    /// missing) and after the upload (the confirmation finds it gone). A
    /// requeue never takes a ride in flight or landed, since a pending row is
    /// what the drain sends.
    const fn leaves_from(self) -> &'static [UploadStatus] {
        use UploadStatus as S;
        match self {
            Self::Begin => &[S::Pending],
            Self::Failed
            | Self::PermissionBlocked
            | Self::HeldForAuth
            | Self::HeldForNetwork
            | Self::ReleaseStranded => &[S::Uploading],
            Self::Rejected => &[S::Pending, S::Uploading, S::Uploaded],
            Self::Requeue => &[S::Pending, S::Failed, S::PermissionBlocked, S::LocalOnly],
            Self::Uploaded => &[
                S::Pending,
                S::Uploading,
                S::Failed,
                S::PermissionBlocked,
                S::LocalOnly,
            ],
            Self::HoldForOtherAthlete => &[S::Pending, S::Uploading, S::PermissionBlocked],
            Self::ReleasePermissionBlocked => &[S::PermissionBlocked],
        }
    }

    fn allows(self, from: UploadStatus) -> bool {
        self.leaves_from().contains(&from)
    }

    /// `upload_status IN (...)` over this move's from-set, for a statement
    /// that moves many rows at once.
    fn leaving_clause(self) -> String {
        let states: Vec<String> = self
            .leaves_from()
            .iter()
            .map(|s| format!("'{}'", s.as_str()))
            .collect();
        format!("upload_status IN ({})", states.join(", "))
    }
}

/// One move of one recording's upload, named by what happened rather than by
/// where the row ends up.
///
/// Every outcome carries `install`, the engine install the `Begin` it settles
/// answered, or for an outcome with no begin the install open when the work
/// that reached it started. The FFI call runs it under that install, so an
/// outcome that outlived a restore is refused rather than written into
/// another library.
#[derive(Debug, Clone, PartialEq, uniffi::Enum)]
pub enum UploadTransition {
    /// The request is about to go out.
    Begin,
    /// intervals.icu took the upload and answered this id, `None` when it
    /// reported none. An id-less success is still a success.
    Uploaded {
        install: f64,
        intervals_activity_id: Option<String>,
    },
    /// A retriable failure: the attempt is counted, and after the last one the
    /// ride parks as `failed`.
    Failed { install: f64, error: String },
    /// A rejection automatic retries cannot fix. The ride parks as `failed`.
    Rejected { install: f64, error: String },
    /// The grant lacks write permission.
    PermissionBlocked { install: f64 },
    /// A credential was refused. The ride waits with its attempts intact.
    HeldForAuth { install: f64, error: String },
    /// The transport failed before intervals.icu was reached. The ride waits
    /// with its attempts intact, stamped so the backoff still applies.
    HeldForNetwork { install: f64, error: String },
    /// A manual retry, or a requeue after an upgrade: back to `pending` with a
    /// clean slate.
    Requeue,
}

impl UploadTransition {
    fn upload_move(&self) -> UploadMove {
        match self {
            Self::Begin => UploadMove::Begin,
            Self::Uploaded { .. } => UploadMove::Uploaded,
            Self::Failed { .. } => UploadMove::Failed,
            Self::Rejected { .. } => UploadMove::Rejected,
            Self::PermissionBlocked { .. } => UploadMove::PermissionBlocked,
            Self::HeldForAuth { .. } => UploadMove::HeldForAuth,
            Self::HeldForNetwork { .. } => UploadMove::HeldForNetwork,
            Self::Requeue => UploadMove::Requeue,
        }
    }

    /// The install an outcome was issued under, `None` for a begin or a
    /// requeue, which run against whichever install is open.
    pub fn install(&self) -> Option<f64> {
        match self {
            Self::Begin | Self::Requeue => None,
            Self::Uploaded { install, .. }
            | Self::Failed { install, .. }
            | Self::Rejected { install, .. }
            | Self::PermissionBlocked { install }
            | Self::HeldForAuth { install, .. }
            | Self::HeldForNetwork { install, .. } => Some(*install),
        }
    }
}

/// Why a transition wrote nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum UploadRefusal {
    /// No recording has the id.
    NoRecording,
    /// The row's state is not one the transition may leave from.
    IllegalTransition,
    /// The ride is already uploaded under another intervals.icu id.
    AnotherActivity,
    /// The outcome belongs to an install that is no longer open.
    AnotherInstall,
}

/// What a transition did. A refusal is an answer, not an error, and writes
/// nothing, so a caller can stop on it.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FfiUploadTransitionAnswer {
    pub applied: bool,
    pub refusal: Option<UploadRefusal>,
    /// The state the row was in when the transition read it, `None` when no
    /// row was read.
    pub found: Option<String>,
    /// The state the row is in now.
    pub status: Option<String>,
    /// The attempts counted against the ride now.
    pub retry_count: u32,
    /// The install the transition ran under. A begin's answer is the attempt,
    /// handed back with its outcome.
    pub install: f64,
}

impl FfiUploadTransitionAnswer {
    /// A refusal that read no row: the id is unknown, or the install moved.
    pub(crate) fn refused_unread(refusal: UploadRefusal, install: f64) -> Self {
        Self {
            applied: false,
            refusal: Some(refusal),
            found: None,
            status: None,
            retry_count: 0,
            install,
        }
    }
}

impl PersistentEngine {
    /// Apply one upload transition to one recording, if the table allows it
    /// from the state the row is in, in one transaction.
    ///
    /// The install an outcome carries is not checked here: the engine call
    /// site runs this under it, and fills in the answer's `install`, which is
    /// 0 until then.
    pub fn transition_recording(
        &self,
        id: &str,
        transition: &UploadTransition,
        now: i64,
    ) -> SqlResult<FfiUploadTransitionAnswer> {
        self.db.execute_batch("BEGIN IMMEDIATE")?;
        match self.apply_upload_transition(id, transition, now) {
            Ok(answer) => {
                super::commit_write_txn(&self.db)?;
                if answer.applied
                    && answer.status.as_deref() == Some(UploadStatus::Pending.as_str())
                {
                    crate::net::connectivity::nudge();
                }
                Ok(answer)
            }
            Err(e) => {
                let _ = self.db.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    }

    fn apply_upload_transition(
        &self,
        id: &str,
        transition: &UploadTransition,
        now: i64,
    ) -> SqlResult<FfiUploadTransitionAnswer> {
        let conn = &self.db;
        let found = pooled::recording(conn, id)?;
        let Some(found) = found else {
            return Ok(FfiUploadTransitionAnswer::refused_unread(
                UploadRefusal::NoRecording,
                0.0,
            ));
        };
        let answer = |applied: bool, refusal: Option<UploadRefusal>, row: &FfiRecordingEntry| {
            FfiUploadTransitionAnswer {
                applied,
                refusal,
                found: Some(found.upload_status.clone()),
                status: Some(row.upload_status.clone()),
                retry_count: row.retry_count,
                install: 0.0,
            }
        };

        let from = UploadStatus::parse(&found.upload_status);
        if let (
            UploadTransition::Uploaded {
                intervals_activity_id,
                ..
            },
            Some(UploadStatus::Uploaded),
        ) = (transition, from)
        {
            // The same answer twice is one upload. Another id for a ride that
            // landed is refused rather than overwriting the first link.
            return Ok(if found.intervals_activity_id == *intervals_activity_id {
                answer(true, None, &found)
            } else {
                answer(false, Some(UploadRefusal::AnotherActivity), &found)
            });
        }
        if !from.is_some_and(|from| transition.upload_move().allows(from)) {
            return Ok(answer(
                false,
                Some(UploadRefusal::IllegalTransition),
                &found,
            ));
        }

        // Every write is guarded on the state read above, so the row cannot
        // have moved between the read and the write.
        let was = found.upload_status.as_str();
        match transition {
            UploadTransition::Begin => conn.execute(
                "UPDATE recordings SET upload_status = 'uploading'                  WHERE id = ? AND upload_status = ?",
                params![id, was],
            )?,
            UploadTransition::Uploaded {
                intervals_activity_id,
                ..
            } => conn.execute(
                "UPDATE recordings SET upload_status = 'uploaded', intervals_activity_id = ?,                  last_error = NULL WHERE id = ? AND upload_status = ?",
                params![intervals_activity_id, id, was],
            )?,
            UploadTransition::Failed { error, .. } => conn.execute(
                "UPDATE recordings                  SET retry_count = retry_count + 1,                      last_attempt_at = ?,                      last_error = ?,                      upload_status = CASE WHEN retry_count + 1 >= ? THEN 'failed' ELSE 'pending' END                  WHERE id = ? AND upload_status = ?",
                params![now, error, MAX_AUTO_RETRIES as i64, id, was],
            )?,
            UploadTransition::Rejected { error, .. } => {
                // The engine row loses the server id the confirmation found
                // gone, so a manual retry reuses the provisional row.
                conn.execute(
                    "UPDATE activities SET intervals_id = NULL
                     WHERE (id, intervals_id) IN (
                         SELECT engine_activity_id, intervals_activity_id FROM recordings WHERE id = ?
                     )",
                    params![id],
                )?;
                conn.execute(
                    "UPDATE activity_bodies SET intervals_id = NULL
                     WHERE (activity_id, intervals_id) IN (
                         SELECT engine_activity_id, intervals_activity_id FROM recordings WHERE id = ?
                     )",
                    params![id],
                )?;
                conn.execute(
                    "UPDATE recordings SET upload_status = 'failed', last_error = ?,                      last_attempt_at = ?, intervals_activity_id = NULL, engine_reconciled = 0                      WHERE id = ? AND upload_status = ?",
                    params![error, now, id, was],
                )?
            }
            UploadTransition::PermissionBlocked { .. } => conn.execute(
                "UPDATE recordings SET upload_status = 'permissionBlocked', last_attempt_at = ?                  WHERE id = ? AND upload_status = ?",
                params![now, id, was],
            )?,
            UploadTransition::HeldForAuth { error, .. } => conn.execute(
                "UPDATE recordings SET upload_status = 'pending', last_error = ?                  WHERE id = ? AND upload_status = ?",
                params![error, id, was],
            )?,
            UploadTransition::HeldForNetwork { error, .. } => conn.execute(
                "UPDATE recordings SET upload_status = 'pending', last_error = ?,                  last_attempt_at = ? WHERE id = ? AND upload_status = ?",
                params![error, now, id, was],
            )?,
            UploadTransition::Requeue => conn.execute(
                "UPDATE recordings SET upload_status = 'pending', retry_count = 0,                  last_attempt_at = NULL, last_error = NULL WHERE id = ? AND upload_status = ?",
                params![id, was],
            )?,
        };
        let now_row = pooled::recording(conn, id)?.unwrap_or_else(|| found.clone());
        Ok(answer(true, None, &now_row))
    }
}

impl PersistentEngine {
    /// Insert a recording, or leave an existing row with the same id alone.
    /// Returns whether a row was written, which is what the AsyncStorage
    /// adoption counts.
    pub fn insert_recording(&self, entry: &FfiRecordingEntry) -> SqlResult<bool> {
        let changed = self.db.execute(
            &format!(
                "INSERT OR IGNORE INTO recordings ({COLUMNS}) \
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            ),
            params![
                entry.id,
                entry.kind,
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
                i64::from(entry.engine_reconciled),
                entry.athlete_id,
                entry.notes,
                entry.rpe,
                i64::from(entry.rpe_sent),
            ],
        )?;
        crate::net::connectivity::nudge();
        Ok(changed > 0)
    }

    /// Every recording, newest first.
    pub fn list_recordings(&self) -> SqlResult<Vec<FfiRecordingEntry>> {
        pooled::list(&self.db)
    }

    pub fn get_recording(&self, id: &str) -> SqlResult<Option<FfiRecordingEntry>> {
        pooled::recording(&self.db, id)
    }

    /// The engine row has taken the id intervals.icu gave the upload, so the
    /// reconcile sweep can stop replaying this one. Idempotent, and a no-op on
    /// an id nothing claims: the sweep is best effort and a row deleted
    /// underneath it is not a failure.
    pub fn set_recording_reconciled(&self, id: &str) -> SqlResult<()> {
        self.db.execute(
            "UPDATE recordings SET engine_reconciled = 1 WHERE id = ?",
            params![id],
        )?;
        Ok(())
    }

    /// intervals.icu has the effort the athlete set. Idempotent, and a no-op on
    /// an id nothing claims.
    pub fn set_recording_rpe_sent(&self, id: &str) -> SqlResult<()> {
        self.db.execute(
            "UPDATE recordings SET rpe_sent = 1 WHERE id = ?",
            params![id],
        )?;
        Ok(())
    }

    /// The engine key the recording was written under, so a background retry
    /// can still reconcile the upload.
    pub fn set_recording_engine_activity(
        &self,
        id: &str,
        engine_activity_id: &str,
    ) -> SqlResult<()> {
        self.db.execute(
            "UPDATE recordings SET engine_activity_id = ? WHERE id = ?",
            params![engine_activity_id, id],
        )?;
        Ok(())
    }

    // The per-destination writers below apply the named transition and drop
    // its answer, so legality has the one table until their callers move.

    pub fn set_recording_uploading(&self, id: &str) -> SqlResult<()> {
        self.transition_recording(id, &UploadTransition::Begin, 0)?;
        Ok(())
    }

    pub fn set_recording_uploaded(
        &self,
        id: &str,
        intervals_activity_id: Option<&str>,
    ) -> SqlResult<()> {
        let landed = UploadTransition::Uploaded {
            install: 0.0,
            intervals_activity_id: intervals_activity_id.map(str::to_string),
        };
        self.transition_recording(id, &landed, 0)?;
        Ok(())
    }

    /// A retriable failure. The entry stays `pending` until the automatic
    /// retries are exhausted, then parks as `failed` for a manual retry. The
    /// FIT is kept either way. Answers the attempts counted against it.
    ///
    /// Like every outcome but the success, it writes only over a row still
    /// `uploading`. A sign-in hold can take the row while the request is in
    /// flight, and a late outcome that set it `pending` again would send one
    /// athlete's ride under the next athlete's credentials.
    pub fn set_recording_upload_failed(&self, id: &str, error: &str, now: i64) -> SqlResult<u32> {
        let failed = UploadTransition::Failed {
            install: 0.0,
            error: error.to_string(),
        };
        Ok(self.transition_recording(id, &failed, now)?.retry_count)
    }

    /// A server-side rejection that automatic retries cannot fix.
    pub fn set_recording_rejected(&self, id: &str, error: &str, now: i64) -> SqlResult<()> {
        let rejected = UploadTransition::Rejected {
            install: 0.0,
            error: error.to_string(),
        };
        self.transition_recording(id, &rejected, now)?;
        Ok(())
    }

    pub fn set_recording_permission_blocked(&self, id: &str, now: i64) -> SqlResult<()> {
        self.transition_recording(
            id,
            &UploadTransition::PermissionBlocked { install: 0.0 },
            now,
        )?;
        Ok(())
    }

    /// Release every ride the last launch left mid-upload, and answer how many.
    ///
    /// `set_recording_uploading` is written before the request goes out and
    /// only a returned outcome moves it on, so an app kill leaves the row at
    /// `uploading`, where the manual affordance is hidden and the automatic
    /// retry does not look. The attempt is counted, the same as any other that
    /// did not report back: a kill that keeps happening would otherwise retry
    /// the same ride forever. After the last attempt it parks as `failed`,
    /// which is still manually retriable, and the FIT is never deleted.
    pub fn release_stranded_uploads(&self, now: i64) -> SqlResult<u32> {
        let changed = self.db.execute(
            &format!(
                "UPDATE recordings \
             SET retry_count = retry_count + 1, \
                 last_attempt_at = ?, \
                 last_error = 'The app closed while this ride was uploading', \
                 upload_status = CASE WHEN retry_count + 1 >= ? THEN 'failed' ELSE 'pending' END \
             WHERE {}",
                UploadMove::ReleaseStranded.leaving_clause()
            ),
            params![now, MAX_AUTO_RETRIES as i64],
        )?;
        if changed > 0 {
            log::info!(
                "veloqrs: [recordings] Released {} ride(s) stranded mid-upload",
                changed
            );
        }
        crate::net::connectivity::nudge();
        Ok(changed as u32)
    }

    /// After an OAuth write upgrade, the upgrading athlete's permission-blocked
    /// rides become uploadable again. Nobody else's: the grant is theirs, and
    /// an unstamped row has no owner it could be checked against.
    pub fn clear_recording_permission_blocked(&self, athlete_id: &str) -> SqlResult<u32> {
        let changed = self.db.execute(
            &format!(
                "UPDATE recordings SET upload_status = 'pending', retry_count = 0, \
                 last_attempt_at = NULL WHERE {} AND athlete_id = ?",
                UploadMove::ReleasePermissionBlocked.leaving_clause()
            ),
            params![athlete_id],
        )?;
        crate::net::connectivity::nudge();
        Ok(changed as u32)
    }

    /// The transport failed before intervals.icu was reached.
    ///
    /// The ride stays in the queue with its attempt counter untouched, for the
    /// same reason a 401 does: a request that never arrived says nothing about
    /// the ride, and a device that spends a week out of signal would otherwise
    /// spend all five attempts on cold launches and park a ride the server has
    /// never seen. `last_attempt_at` *is* stamped, so the ordinary backoff
    /// still applies and a failing transport cannot become a hot loop.
    pub fn hold_recording_for_network(&self, id: &str, error: &str, now: i64) -> SqlResult<()> {
        let held = UploadTransition::HeldForNetwork {
            install: 0.0,
            error: error.to_string(),
        };
        self.transition_recording(id, &held, now)?;
        Ok(())
    }

    /// A credential was refused while this ride was uploading.
    ///
    /// The ride goes back in the queue exactly as it was: the attempt counter
    /// and the last attempt are untouched, because a 401 says nothing about the
    /// ride and spending one of its five attempts on a dead credential would
    /// retire a recording the server never saw. The error is kept so the
    /// library can say why it is waiting.
    pub fn hold_recording_for_auth(&self, id: &str, error: &str) -> SqlResult<()> {
        let held = UploadTransition::HeldForAuth {
            install: 0.0,
            error: error.to_string(),
        };
        self.transition_recording(id, &held, 0)?;
        Ok(())
    }

    /// An athlete has signed in: stop auto-uploading everything that is not
    /// theirs, and answer how many were held.
    ///
    /// What they recorded keeps its place in the queue and drains on its own. A
    /// row stamped with someone else stops, and so does an unstamped one, which
    /// predates the column and belongs to nobody the app can name. Neither is
    /// deleted and neither is hidden: the athlete can still send one up by hand
    /// from the library.
    ///
    /// Only a ride that could still be sent is touched, a permission-blocked
    /// one included, since the next scope upgrade would requeue it. An upload
    /// that already landed is not anybody's to demote.
    pub fn hold_recordings_of_other_athletes(&self, athlete_id: &str) -> SqlResult<u32> {
        let changed = self.db.execute(
            &format!(
                "UPDATE recordings SET upload_status = 'localOnly' \
                 WHERE {} AND (athlete_id IS NULL OR athlete_id != ?)",
                UploadMove::HoldForOtherAthlete.leaving_clause()
            ),
            params![athlete_id],
        )?;
        Ok(changed as u32)
    }

    /// Name the athlete a library belongs to on every ride that has none, and
    /// answer how many were named.
    ///
    /// Rides adopted from an older build's storage carry no athlete. Rows of
    /// another athlete and every `upload_status` are left as they are, so a
    /// pending ride keeps its place and the sign-in hold settles the rest.
    pub fn stamp_ownerless_recordings(&self, athlete_id: &str) -> SqlResult<u32> {
        let changed = self.db.execute(
            "UPDATE recordings SET athlete_id = ? WHERE athlete_id IS NULL",
            params![athlete_id],
        )?;
        Ok(changed as u32)
    }

    /// The next recording due an automatic upload, respecting the backoff.
    /// Oldest first, so a queue drains in the order it was recorded.
    pub fn next_pending_recording(&self, now: i64) -> SqlResult<Option<FfiRecordingEntry>> {
        pooled::next_pending(&self.db, now)
    }

    /// Remove one recording the signed-in athlete may see: their own or an
    /// unstamped one. A row stamped with someone else is left in place and
    /// answers `None`, so a stale screen or a deep link cannot remove it.
    pub fn delete_own_recording(
        &self,
        id: &str,
        athlete_id: Option<&str>,
    ) -> SqlResult<Option<FfiRecordingEntry>> {
        let Some(entry) = pooled::recording_visible(&self.db, id, athlete_id)? else {
            return Ok(None);
        };
        self.db
            .execute("DELETE FROM recordings WHERE id = ?", params![id])?;
        Ok(Some(entry))
    }

    /// Recordings intervals.icu does not hold yet, which is every status but
    /// `uploaded`, among those the signed-in athlete may see.
    pub fn unuploaded_recording_count(&self, athlete_id: Option<&str>) -> SqlResult<u32> {
        pooled::unuploaded_visible_count(&self.db, athlete_id)
    }

    /// Drop every row. A `.veloqdb` restore carries this table like any other,
    /// but not the FIT files it points at, so the rows are stale the moment
    /// they land on another install.
    pub fn clear_recordings(&self) -> SqlResult<u32> {
        let changed = self.db.execute("DELETE FROM recordings", [])?;
        Ok(changed as u32)
    }
}

/// The recording reads the library screen and the upload processor make,
/// over a pooled connection. The engine methods above delegate here rather
/// than carrying a second copy.
pub(crate) mod pooled {
    use rusqlite::{Connection, Result as SqlResult, params};

    use super::{
        COLUMNS, FfiRecordingEntry, eligible_at, list_recordings_on, retry_eligible, row_to_entry,
    };

    /// Every recording, newest first.
    pub(crate) fn list(conn: &Connection) -> SqlResult<Vec<FfiRecordingEntry>> {
        list_recordings_on(conn)
    }

    /// The rows the signed-in athlete may see: their own and the unstamped
    /// ones. With nobody signed in only the unstamped rows qualify, because a
    /// NULL never equals a column.
    const VISIBLE: &str = "(athlete_id = ?1 OR athlete_id IS NULL)";

    /// Every recording the signed-in athlete may see, newest first.
    pub(crate) fn list_visible(
        conn: &Connection,
        athlete_id: Option<&str>,
    ) -> SqlResult<Vec<FfiRecordingEntry>> {
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUMNS} FROM recordings WHERE {VISIBLE} ORDER BY created_at DESC"
        ))?;
        let rows = stmt.query_map(params![athlete_id], row_to_entry)?;
        rows.collect()
    }

    /// One recording, only if the signed-in athlete may see it.
    pub(crate) fn recording_visible(
        conn: &Connection,
        id: &str,
        athlete_id: Option<&str>,
    ) -> SqlResult<Option<FfiRecordingEntry>> {
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUMNS} FROM recordings WHERE id = ?2 AND {VISIBLE}"
        ))?;
        let mut rows = stmt.query_map(params![athlete_id, id], row_to_entry)?;
        rows.next().transpose()
    }

    /// Recordings intervals.icu does not hold yet, among those the signed-in
    /// athlete may see.
    pub(crate) fn unuploaded_visible_count(
        conn: &Connection,
        athlete_id: Option<&str>,
    ) -> SqlResult<u32> {
        conn.query_row(
            &format!(
                "SELECT COUNT(*) FROM recordings WHERE upload_status != 'uploaded' AND {VISIBLE}"
            ),
            params![athlete_id],
            |row| row.get::<_, i64>(0).map(|n| n as u32),
        )
    }

    pub(crate) fn recording(conn: &Connection, id: &str) -> SqlResult<Option<FfiRecordingEntry>> {
        let mut stmt = conn.prepare(&format!("SELECT {COLUMNS} FROM recordings WHERE id = ?"))?;
        let mut rows = stmt.query_map(params![id], row_to_entry)?;
        rows.next().transpose()
    }

    /// The next recording due an automatic upload, respecting the backoff.
    /// Oldest first, so a queue drains in the order it was recorded.
    pub(crate) fn next_pending(
        conn: &Connection,
        now: i64,
    ) -> SqlResult<Option<FfiRecordingEntry>> {
        let mut stmt = conn.prepare(&format!(
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

    /// When the earliest pending recording becomes due, in epoch milliseconds:
    /// a value at or before now means one is due already, `None` that nothing is
    /// pending. The upload schedule sleeps until this.
    pub(crate) fn next_due_at(conn: &Connection) -> SqlResult<Option<i64>> {
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLUMNS} FROM recordings WHERE upload_status = 'pending'"
        ))?;
        let rows = stmt.query_map([], row_to_entry)?;
        let mut earliest: Option<i64> = None;
        for row in rows {
            if let Some(at) = eligible_at(&row?) {
                earliest = Some(earliest.map_or(at, |best| best.min(at)));
            }
        }
        Ok(earliest)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn entry(id: &str, created_at: i64, status: &str) -> FfiRecordingEntry {
        FfiRecordingEntry {
            id: id.to_string(),
            kind: "fit".to_string(),
            fit_path: format!("/recordings/{id}.fit"),
            streams_path: None,
            activity_type: "Ride".to_string(),
            name: format!("Ride {id}"),
            start_time: created_at as f64,
            duration_seconds: 3600.0,
            distance_meters: 20_000.0,
            elevation_gain: Some(120.0),
            avg_heartrate: Some(148.0),
            paired_event_id: None,
            created_at: created_at as f64,
            upload_status: status.to_string(),
            retry_count: 0,
            last_attempt_at: None,
            last_error: None,
            intervals_activity_id: None,
            engine_activity_id: None,
            engine_reconciled: false,
            athlete_id: Some("i296629".to_string()),
            notes: None,
            rpe: None,
            rpe_sent: false,
        }
    }

    /// Scenario: the index carried a flag saying the engine row had taken the
    /// id intervals.icu gave the upload, and the reconcile sweep reads it to
    /// find the rides whose write was lost to a closed engine. The move to a
    /// table dropped it.
    /// Expected behaviour: the flag is a column, it defaults to unreconciled,
    /// and setting it survives a read.
    #[test]
    fn a_reconciled_upload_is_remembered_across_a_read() {
        let (_dir, e) = engine();
        e.insert_recording(&entry("r1", 1_000, "uploaded")).unwrap();
        assert!(
            !e.get_recording("r1").unwrap().unwrap().engine_reconciled,
            "a fresh row owes its reconcile"
        );

        e.set_recording_reconciled("r1").unwrap();
        assert!(e.get_recording("r1").unwrap().unwrap().engine_reconciled);
        // The sweep asks the list, not one row at a time.
        assert!(
            e.list_recordings()
                .unwrap()
                .iter()
                .all(|r| r.engine_reconciled)
        );
    }

    fn stamped(id: &str, created_at: i64, athlete: Option<&str>) -> FfiRecordingEntry {
        let mut row = entry(id, created_at, "pending");
        row.athlete_id = athlete.map(str::to_string);
        row
    }

    fn library_of_two_athletes() -> (TempDir, PersistentEngine) {
        let (dir, e) = engine();
        e.insert_recording(&stamped("a1", 3_000, Some("iA")))
            .unwrap();
        e.insert_recording(&stamped("b1", 2_000, Some("iB")))
            .unwrap();
        e.insert_recording(&stamped("u1", 1_000, None)).unwrap();
        (dir, e)
    }

    /// Scenario: athlete A's held ride sits beside athlete B's and an
    /// unstamped one on a shared phone, and B is signed in.
    /// Expected behaviour: B's reads see B's row and the unstamped row, never
    /// A's, and nobody signed in sees only the unstamped row.
    #[test]
    fn visible_reads_exclude_another_athletes_rows() {
        let (_dir, e) = library_of_two_athletes();
        let ids = |rows: Vec<FfiRecordingEntry>| rows.into_iter().map(|r| r.id).collect::<Vec<_>>();

        assert_eq!(
            ids(pooled::list_visible(&e.db, Some("iB")).unwrap()),
            vec!["b1", "u1"]
        );
        assert_eq!(ids(pooled::list_visible(&e.db, None).unwrap()), vec!["u1"]);
        assert!(
            pooled::recording_visible(&e.db, "a1", Some("iB"))
                .unwrap()
                .is_none()
        );
        assert!(
            pooled::recording_visible(&e.db, "b1", Some("iB"))
                .unwrap()
                .is_some()
        );
        assert!(
            pooled::recording_visible(&e.db, "u1", Some("iB"))
                .unwrap()
                .is_some()
        );
        assert!(
            pooled::recording_visible(&e.db, "b1", None)
                .unwrap()
                .is_none()
        );
        assert_eq!(
            pooled::unuploaded_visible_count(&e.db, Some("iB")).unwrap(),
            2
        );
        assert_eq!(pooled::unuploaded_visible_count(&e.db, None).unwrap(), 1);
    }

    /// Scenario: B's screen holds the id of A's ride.
    /// Expected behaviour: the delete returns nothing and A's row is still
    /// there; the same call for B's own row and an unstamped row removes it.
    #[test]
    fn delete_own_recording_leaves_another_athletes_row() {
        let (_dir, e) = library_of_two_athletes();

        assert!(e.delete_own_recording("a1", Some("iB")).unwrap().is_none());
        assert!(e.get_recording("a1").unwrap().is_some());
        assert!(e.delete_own_recording("a1", None).unwrap().is_none());
        assert!(e.get_recording("a1").unwrap().is_some());

        assert_eq!(
            e.delete_own_recording("b1", Some("iB"))
                .unwrap()
                .map(|r| r.id),
            Some("b1".to_string())
        );
        assert!(e.get_recording("b1").unwrap().is_none());
        assert!(e.delete_own_recording("u1", Some("iB")).unwrap().is_some());
        assert!(
            e.delete_own_recording("missing", Some("iB"))
                .unwrap()
                .is_none()
        );
    }

    fn engine() -> (TempDir, PersistentEngine) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("routes.db");
        let engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
        (dir, engine)
    }

    fn uploaded_recording(e: &mut PersistentEngine) {
        e.db.execute(
            "INSERT INTO activities (id, intervals_id, sport_type, min_lat, max_lat, min_lng, max_lng)
             VALUES ('local-r1', 'i-old', 'Ride', 0, 0, 0, 0)", [],
        ).unwrap();
        let mut row = entry("r1", 1_000, "uploaded");
        row.engine_activity_id = Some("local-r1".into());
        row.intervals_activity_id = Some("i-old".into());
        row.engine_reconciled = true;
        e.insert_recording(&row).unwrap();
    }

    #[test]
    fn rejected_upload_reuses_the_provisional_row_on_manual_retry() {
        let (_dir, mut e) = engine();
        uploaded_recording(&mut e);
        e.set_recording_rejected("r1", "intervals.icu no longer has the activity", 2_000)
            .unwrap();
        let row = e.get_recording("r1").unwrap().unwrap();
        assert_eq!(row.upload_status, "failed");
        assert_eq!(row.intervals_activity_id, None);
        assert!(!row.engine_reconciled);
        assert_eq!(row.fit_path, "/recordings/r1.fit");
        assert_eq!(row.engine_activity_id.as_deref(), Some("local-r1"));
        assert!(row.last_error.unwrap().contains("intervals.icu"));
        assert!(e.next_pending_recording(1_000_000).unwrap().is_none());
        assert_eq!(e.intervals_id("local-r1"), None);
        e.set_recording_rejected("r1", "still missing", 3_000)
            .unwrap();
        assert!(e.record_upload("local-r1", "i-new").unwrap());
        assert_eq!(
            e.activity_id_for_intervals_id("i-new").as_deref(),
            Some("local-r1")
        );
        assert_eq!(e.activity_id_for_intervals_id("i-old"), None);
    }

    #[test]
    fn rejected_upload_rolls_back_the_activity_link_when_recording_write_fails() {
        let (_dir, mut e) = engine();
        uploaded_recording(&mut e);
        e.db.execute_batch("CREATE TRIGGER fail_rejection BEFORE UPDATE ON recordings BEGIN SELECT RAISE(ABORT, 'injected failure'); END;").unwrap();
        assert!(e.set_recording_rejected("r1", "missing", 2_000).is_err());
        assert_eq!(e.intervals_id("local-r1").as_deref(), Some("i-old"));
        assert_eq!(
            e.get_recording("r1").unwrap().unwrap().upload_status,
            "uploaded"
        );
    }

    #[test]
    fn rejected_upload_preserves_another_remote_link_and_handles_missing_rows() {
        let (_dir, mut e) = engine();
        uploaded_recording(&mut e);
        e.db.execute("UPDATE activities SET intervals_id = 'i-other'", [])
            .unwrap();
        e.set_recording_rejected("r1", "missing", 2_000).unwrap();
        assert_eq!(e.intervals_id("local-r1").as_deref(), Some("i-other"));
        e.set_recording_rejected("absent", "missing", 2_000)
            .unwrap();
        e.insert_recording(&entry("manual", 1_000, "pending"))
            .unwrap();
        e.set_recording_rejected("manual", "invalid", 2_000)
            .unwrap();
        assert_eq!(
            e.get_recording("manual").unwrap().unwrap().upload_status,
            "failed"
        );
    }

    #[test]
    fn a_recording_round_trips_every_field() {
        let (_dir, e) = engine();
        let mut row = entry("r1", 1_000, "pending");
        row.streams_path = Some("/recordings/r1.streams.json".to_string());
        row.paired_event_id = Some(42.0);
        row.engine_activity_id = Some("local-r1".to_string());
        assert!(e.insert_recording(&row).unwrap());

        let read = e.get_recording("r1").unwrap().unwrap();
        assert_eq!(
            read.streams_path.as_deref(),
            Some("/recordings/r1.streams.json")
        );
        assert_eq!(read.paired_event_id, Some(42.0));
        assert_eq!(read.engine_activity_id.as_deref(), Some("local-r1"));
        assert_eq!(read.distance_meters, 20_000.0);
    }

    /// Scenario: the athlete drags the effort slider to 8 and types "legs
    /// heavy", saves with no signal, and the ride waits in the queue across a
    /// relaunch.
    ///
    /// Expected behaviour: both are on the row the upload reads, and the
    /// effort is owed to intervals.icu until it is marked sent, which only
    /// the row it belongs to records.
    #[test]
    fn the_review_notes_and_effort_wait_on_the_row_until_sent() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("routes.db");
        {
            let e = PersistentEngine::new(path.to_str().unwrap()).unwrap();
            let mut row = entry("r1", 1_000, "pending");
            row.notes = Some("legs heavy".to_string());
            row.rpe = Some(8);
            e.insert_recording(&row).unwrap();
            e.insert_recording(&entry("r2", 2_000, "pending")).unwrap();
        }

        let e = PersistentEngine::new(path.to_str().unwrap()).unwrap();
        let read = e.get_recording("r1").unwrap().unwrap();
        assert_eq!(read.notes.as_deref(), Some("legs heavy"));
        assert_eq!(read.rpe, Some(8));
        assert!(!read.rpe_sent, "the effort has not reached intervals.icu");
        let untouched = e.get_recording("r2").unwrap().unwrap();
        assert_eq!(untouched.notes, None);
        assert_eq!(untouched.rpe, None);

        e.set_recording_rpe_sent("r1").unwrap();
        assert!(e.get_recording("r1").unwrap().unwrap().rpe_sent);
        assert!(!e.get_recording("r2").unwrap().unwrap().rpe_sent);
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

        let ids: Vec<String> = e
            .list_recordings()
            .unwrap()
            .into_iter()
            .map(|r| r.id)
            .collect();
        assert_eq!(ids, vec!["new", "mid", "old"]);
    }

    #[test]
    fn the_next_due_time_is_the_earliest_backoff_among_pending_rides() {
        let (_dir, e) = engine();
        assert_eq!(pooled::next_due_at(&e.db).unwrap(), None, "empty queue");

        e.insert_recording(&entry("held", 1_000, "uploaded"))
            .unwrap();
        assert_eq!(pooled::next_due_at(&e.db).unwrap(), None, "nothing pending");

        e.insert_recording(&entry("a", 1_000, "pending")).unwrap();
        e.set_recording_uploading("a").unwrap();
        e.set_recording_upload_failed("a", "network", 100_000)
            .unwrap();
        assert_eq!(
            pooled::next_due_at(&e.db).unwrap(),
            Some(100_000 + BACKOFF_BASE_MS * 2)
        );

        e.insert_recording(&entry("fresh", 2_000, "pending"))
            .unwrap();
        assert!(
            pooled::next_due_at(&e.db).unwrap().unwrap() <= 0,
            "a ride never tried is due now"
        );
    }

    #[test]
    fn retries_park_the_entry_as_failed_on_the_last_one() {
        let (_dir, e) = engine();
        e.insert_recording(&entry("r1", 1_000, "pending")).unwrap();

        for attempt in 1..MAX_AUTO_RETRIES {
            e.set_recording_uploading("r1").unwrap();
            let count = e
                .set_recording_upload_failed("r1", "network", 10_000)
                .unwrap();
            assert_eq!(count, attempt);
            assert_eq!(
                e.get_recording("r1").unwrap().unwrap().upload_status,
                "pending"
            );
        }

        e.set_recording_uploading("r1").unwrap();
        let count = e
            .set_recording_upload_failed("r1", "network", 10_000)
            .unwrap();
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

        e.set_recording_uploading("r1").unwrap();
        e.set_recording_upload_failed("r1", "network", 100_000)
            .unwrap();
        assert!(
            e.next_pending_recording(100_000 + BACKOFF_BASE_MS - 1)
                .unwrap()
                .is_none(),
            "an entry that just failed is not due again immediately"
        );
        assert!(
            e.next_pending_recording(100_000 + BACKOFF_BASE_MS * 2)
                .unwrap()
                .is_some(),
            "the backoff after one failure is two base intervals"
        );
    }

    #[test]
    fn only_pending_entries_are_ever_picked_up() {
        let (_dir, e) = engine();
        e.insert_recording(&entry("local", 1_000, "localOnly"))
            .unwrap();
        e.insert_recording(&entry("blocked", 2_000, "permissionBlocked"))
            .unwrap();
        e.insert_recording(&entry("done", 3_000, "uploaded"))
            .unwrap();

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
    fn an_upgrade_releases_the_blocked_and_leaves_the_rest_alone() {
        let (_dir, e) = engine();
        e.insert_recording(&entry("blocked", 1_000, "permissionBlocked"))
            .unwrap();
        e.insert_recording(&entry("pending", 2_000, "pending"))
            .unwrap();
        e.insert_recording(&entry("done", 3_000, "uploaded"))
            .unwrap();

        assert_eq!(e.clear_recording_permission_blocked("i296629").unwrap(), 1);
        assert_eq!(
            e.get_recording("blocked").unwrap().unwrap().upload_status,
            "pending"
        );
        assert_eq!(
            e.get_recording("done").unwrap().unwrap().upload_status,
            "uploaded"
        );
    }

    /// Scenario: a credential dies while the queue drains. The ride is not the
    /// athlete's mistake and re-sending it against a dead credential cannot
    /// help, so it waits rather than being spent or parked.
    #[test]
    fn a_rejected_credential_leaves_the_ride_waiting_with_its_attempts_intact() {
        let (_dir, e) = engine();
        let mut held = entry("held", 1_000, "uploading");
        held.retry_count = 3;
        held.last_attempt_at = Some(900.0);
        e.insert_recording(&held).unwrap();

        e.hold_recording_for_auth("held", "unauthorized").unwrap();

        let row = e.get_recording("held").unwrap().unwrap();
        assert_eq!(row.upload_status, "pending");
        assert_eq!(row.retry_count, 3, "a 401 is not an attempt the ride spent");
        assert_eq!(row.last_attempt_at, Some(900.0));
        assert_eq!(row.last_error.as_deref(), Some("unauthorized"));
    }

    /// Scenario: the athlete records a ride, then the phone spends a week with
    /// no usable network. Every cold launch tries the upload and the transport
    /// fails before the server is ever reached.
    ///
    /// Expected behaviour: the ride stays in the queue however many times the
    /// transport fails. A failure that never reached intervals.icu says nothing
    /// about the ride, so it must not spend one of the five attempts that park
    /// it as `failed`.
    #[test]
    fn an_unreachable_network_never_parks_the_ride() {
        let (_dir, e) = engine();
        e.insert_recording(&entry("ride", 1_000, "uploading"))
            .unwrap();

        for i in 0..(MAX_AUTO_RETRIES + 3) {
            let now = 100_000 + i as i64 * BACKOFF_BASE_MS * 64;
            e.set_recording_uploading("ride").unwrap();
            e.hold_recording_for_network("ride", "Network request failed", now)
                .unwrap();

            let row = e.get_recording("ride").unwrap().unwrap();
            assert_eq!(
                row.upload_status,
                "pending",
                "transport failure {} parked the ride",
                i + 1
            );
            assert_eq!(
                row.retry_count,
                0,
                "transport failure {} spent an attempt",
                i + 1
            );
            assert_eq!(row.last_attempt_at, Some(now as f64));
        }

        assert_eq!(
            e.get_recording("ride")
                .unwrap()
                .unwrap()
                .last_error
                .as_deref(),
            Some("Network request failed")
        );
    }

    /// The stamp is what stops a hot loop: an entry held for the network is
    /// eligible again on the ordinary backoff, not immediately.
    #[test]
    fn a_network_held_ride_waits_out_its_backoff_before_the_next_attempt() {
        let (_dir, e) = engine();
        e.insert_recording(&entry("ride", 1_000, "uploading"))
            .unwrap();

        e.hold_recording_for_network("ride", "offline", 100_000)
            .unwrap();

        assert!(
            e.next_pending_recording(100_000 + BACKOFF_BASE_MS - 1)
                .unwrap()
                .is_none(),
            "a ride held for the network retried before its backoff elapsed"
        );
        assert!(
            e.next_pending_recording(100_000 + BACKOFF_BASE_MS)
                .unwrap()
                .is_some(),
            "a ride held for the network never became eligible again"
        );
    }

    /// Scenario: the phone is signed out by a 401 and someone else signs in.
    /// Every held ride is still on the device and none of them is theirs.
    ///
    /// Expected behaviour: what the signing-in athlete recorded keeps its place
    /// in the queue, and everything else stops auto-uploading. An unstamped row
    /// predates the column and is nobody's, so it is held too.
    #[test]
    fn signing_in_holds_every_ride_that_is_not_the_signing_athletes() {
        let (_dir, e) = engine();
        let mine = entry("mine", 1_000, "pending");
        let mut theirs = entry("theirs", 2_000, "pending");
        theirs.athlete_id = Some("i111111".to_string());
        let mut unstamped = entry("unstamped", 3_000, "pending");
        unstamped.athlete_id = None;
        let mut uploaded = entry("uploaded", 4_000, "uploaded");
        uploaded.athlete_id = Some("i111111".to_string());
        for row in [&mine, &theirs, &unstamped, &uploaded] {
            e.insert_recording(row).unwrap();
        }

        assert_eq!(e.hold_recordings_of_other_athletes("i296629").unwrap(), 2);

        assert_eq!(
            e.get_recording("mine").unwrap().unwrap().upload_status,
            "pending"
        );
        assert_eq!(
            e.get_recording("theirs").unwrap().unwrap().upload_status,
            "localOnly"
        );
        assert_eq!(
            e.get_recording("unstamped").unwrap().unwrap().upload_status,
            "localOnly"
        );
        assert_eq!(
            e.get_recording("uploaded").unwrap().unwrap().upload_status,
            "uploaded",
            "a landed upload is nobody's to demote"
        );
    }

    /// Scenario: a 0.3.x upgrader's rides were adopted into the table with no
    /// athlete, beside a ride of another athlete and one of their own.
    ///
    /// Expected behaviour: only the unstamped rows take the id, the count is
    /// theirs alone, no status moves, and a second call finds nothing.
    #[test]
    fn stamping_ownerless_rides_names_only_the_unstamped_ones() {
        let (_dir, e) = engine();
        let mut a = entry("a", 1_000, "pending");
        a.athlete_id = None;
        let mut b = entry("b", 2_000, "permissionBlocked");
        b.athlete_id = None;
        let mut c = entry("c", 3_000, "uploaded");
        c.athlete_id = None;
        let mut theirs = entry("theirs", 4_000, "pending");
        theirs.athlete_id = Some("iOther".to_string());
        for row in [&a, &b, &c, &theirs] {
            e.insert_recording(row).unwrap();
        }

        assert_eq!(e.stamp_ownerless_recordings("iA").unwrap(), 3);

        for (id, status) in [
            ("a", "pending"),
            ("b", "permissionBlocked"),
            ("c", "uploaded"),
        ] {
            let row = e.get_recording(id).unwrap().unwrap();
            assert_eq!(row.athlete_id.as_deref(), Some("iA"));
            assert_eq!(row.upload_status, status);
        }
        let other = e.get_recording("theirs").unwrap().unwrap();
        assert_eq!(other.athlete_id.as_deref(), Some("iOther"));
        assert_eq!(e.stamp_ownerless_recordings("iB").unwrap(), 0);
    }

    /// Scenario: athlete A's ride was refused for scope and sits
    /// permission-blocked. A session expiry signs A out, B signs in and grants
    /// write scope.
    ///
    /// Expected behaviour: the hold at B's sign-in takes A's blocked ride and
    /// an unstamped one, and B's upgrade requeues only B's own.
    #[test]
    fn a_scope_upgrade_requeues_only_the_signed_in_athletes_blocked_rides() {
        let (_dir, e) = engine();
        let mut theirs = entry("theirs", 1_000, "permissionBlocked");
        theirs.athlete_id = Some("iA".to_string());
        let mut unstamped = entry("unstamped", 2_000, "permissionBlocked");
        unstamped.athlete_id = None;
        let mut mine = entry("mine", 3_000, "permissionBlocked");
        mine.athlete_id = Some("iB".to_string());
        for row in [&theirs, &unstamped, &mine] {
            e.insert_recording(row).unwrap();
        }

        assert_eq!(e.hold_recordings_of_other_athletes("iB").unwrap(), 2);
        assert_eq!(e.clear_recording_permission_blocked("iB").unwrap(), 1);

        let next = e.next_pending_recording(9_999_999).unwrap().unwrap();
        assert_eq!(next.id, "mine");
        for id in ["theirs", "unstamped"] {
            assert_eq!(
                e.get_recording(id).unwrap().unwrap().upload_status,
                "localOnly",
                "{id} left the hold"
            );
        }
    }

    /// The hold is not the only thing that can leave a blocked row behind: one
    /// written while nobody was signed in is never met by it. The clear still
    /// takes only the athlete it names.
    #[test]
    fn a_scope_upgrade_leaves_another_athletes_blocked_ride_alone_without_a_hold() {
        let (_dir, e) = engine();
        let mut theirs = entry("theirs", 1_000, "permissionBlocked");
        theirs.athlete_id = Some("iA".to_string());
        let mut unstamped = entry("unstamped", 2_000, "permissionBlocked");
        unstamped.athlete_id = None;
        e.insert_recording(&theirs).unwrap();
        e.insert_recording(&unstamped).unwrap();

        assert_eq!(e.clear_recording_permission_blocked("iB").unwrap(), 0);
        assert!(e.next_pending_recording(9_999_999).unwrap().is_none());
    }

    /// Scenario: A's ride is uploading on a slow link when B signs in, and the
    /// hold takes it. A's request then comes back with an outcome.
    ///
    /// Expected behaviour: no failure or hold outcome puts the held ride back
    /// in the queue, where B's credentials would send it.
    #[test]
    fn a_late_outcome_does_not_undo_a_hold() {
        type Outcome = fn(&PersistentEngine, &str);
        let outcomes: [(&str, Outcome); 4] = [
            ("failed", |e, id| {
                e.set_recording_upload_failed(id, "500", 5_000).unwrap();
            }),
            ("network", |e, id| {
                e.hold_recording_for_network(id, "offline", 5_000).unwrap();
            }),
            ("auth", |e, id| {
                e.hold_recording_for_auth(id, "401").unwrap();
            }),
            ("blocked", |e, id| {
                e.set_recording_permission_blocked(id, 5_000).unwrap();
            }),
        ];
        for (name, outcome) in outcomes {
            let (_dir, e) = engine();
            let mut ride = entry("ride", 1_000, "pending");
            ride.athlete_id = Some("iA".to_string());
            e.insert_recording(&ride).unwrap();
            e.set_recording_uploading("ride").unwrap();
            e.hold_recordings_of_other_athletes("iB").unwrap();

            outcome(&e, "ride");

            assert_eq!(
                e.get_recording("ride").unwrap().unwrap().upload_status,
                "localOnly",
                "the {name} outcome undid the hold"
            );
            assert!(e.next_pending_recording(9_999_999).unwrap().is_none());
        }
    }

    /// A landed upload is a fact about the server, and dropping it would have
    /// a manual retry post the same ride twice.
    #[test]
    fn a_late_success_is_still_recorded_over_a_hold() {
        let (_dir, e) = engine();
        let mut ride = entry("ride", 1_000, "pending");
        ride.athlete_id = Some("iA".to_string());
        e.insert_recording(&ride).unwrap();
        e.set_recording_uploading("ride").unwrap();
        e.hold_recordings_of_other_athletes("iB").unwrap();

        e.set_recording_uploaded("ride", Some("i9")).unwrap();
        let row = e.get_recording("ride").unwrap().unwrap();
        assert_eq!(row.upload_status, "uploaded");
        assert_eq!(row.intervals_activity_id.as_deref(), Some("i9"));
    }

    #[test]
    fn signing_in_again_as_the_same_athlete_changes_nothing() {
        let (_dir, e) = engine();
        e.insert_recording(&entry("mine", 1_000, "pending"))
            .unwrap();

        assert_eq!(e.hold_recordings_of_other_athletes("i296629").unwrap(), 0);
        assert_eq!(
            e.get_recording("mine").unwrap().unwrap().upload_status,
            "pending"
        );
    }

    #[test]
    fn a_delete_hands_back_the_row_so_its_files_can_go_too() {
        let (_dir, e) = engine();
        let mut row = entry("r1", 1_000, "pending");
        row.streams_path = Some("/recordings/r1.streams.json".to_string());
        e.insert_recording(&row).unwrap();

        let deleted = e
            .delete_own_recording("r1", Some("i296629"))
            .unwrap()
            .unwrap();
        assert_eq!(deleted.fit_path, "/recordings/r1.fit");
        assert_eq!(
            deleted.streams_path.as_deref(),
            Some("/recordings/r1.streams.json")
        );
        assert!(e.get_recording("r1").unwrap().is_none());
        assert!(
            e.delete_own_recording("r1", Some("i296629"))
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn the_counts_answer_what_the_badges_ask() {
        let (_dir, e) = engine();
        e.insert_recording(&entry("a", 1_000, "pending")).unwrap();
        e.insert_recording(&entry("b", 2_000, "permissionBlocked"))
            .unwrap();
        e.insert_recording(&entry("c", 3_000, "uploaded")).unwrap();

        assert_eq!(e.unuploaded_recording_count(Some("i296629")).unwrap(), 2);
    }

    #[test]
    fn a_requeue_clears_the_retry_state_the_failure_left() {
        let (_dir, e) = engine();
        e.insert_recording(&entry("r1", 1_000, "pending")).unwrap();
        e.set_recording_uploading("r1").unwrap();
        e.set_recording_upload_failed("r1", "network", 100_000)
            .unwrap();

        e.transition_recording("r1", &UploadTransition::Requeue, 0)
            .unwrap();
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
        e.set_recording_uploading("r1").unwrap();
        e.set_recording_upload_failed("r1", "network", 100_000)
            .unwrap();

        e.set_recording_uploaded("r1", Some("i12345")).unwrap();
        let read = e.get_recording("r1").unwrap().unwrap();
        assert_eq!(read.upload_status, "uploaded");
        assert_eq!(read.intervals_activity_id.as_deref(), Some("i12345"));
        assert_eq!(read.last_error, None);
    }

    /// Scenario: the app is killed while a ride is uploading. The row is left
    /// at `uploading`, which hides the manual retry and is skipped by the
    /// automatic one, so the ride is stuck with no way out.
    #[test]
    fn a_launch_releases_a_ride_the_last_one_was_still_uploading() {
        let (_dir, e) = engine();
        e.insert_recording(&entry("r1", 1_000, "pending")).unwrap();
        e.set_recording_uploading("r1").unwrap();

        assert_eq!(e.release_stranded_uploads(200_000).unwrap(), 1);
        let read = e.get_recording("r1").unwrap().unwrap();
        assert_eq!(read.upload_status, "pending");
        assert_eq!(read.retry_count, 1);
        assert_eq!(read.last_attempt_at, Some(200_000.0));
    }

    /// A kill that keeps happening has to stop costing attempts forever, so it
    /// is counted the same as any other attempt that did not report back.
    #[test]
    fn a_ride_killed_on_every_launch_parks_for_a_manual_retry() {
        let (_dir, e) = engine();
        e.insert_recording(&entry("r1", 1_000, "pending")).unwrap();

        for launch in 0..MAX_AUTO_RETRIES {
            e.set_recording_uploading("r1").unwrap();
            e.release_stranded_uploads(200_000 + launch as i64).unwrap();
        }

        let read = e.get_recording("r1").unwrap().unwrap();
        assert_eq!(read.upload_status, "failed");
        assert_eq!(read.retry_count, MAX_AUTO_RETRIES);
    }

    #[test]
    fn a_launch_leaves_every_other_status_alone() {
        let (_dir, e) = engine();
        e.insert_recording(&entry("a", 1_000, "pending")).unwrap();
        e.insert_recording(&entry("b", 2_000, "uploaded")).unwrap();
        e.insert_recording(&entry("c", 3_000, "localOnly")).unwrap();
        e.insert_recording(&entry("d", 4_000, "permissionBlocked"))
            .unwrap();

        assert_eq!(e.release_stranded_uploads(200_000).unwrap(), 0);
        for (id, status) in [
            ("a", "pending"),
            ("b", "uploaded"),
            ("c", "localOnly"),
            ("d", "permissionBlocked"),
        ] {
            assert_eq!(e.get_recording(id).unwrap().unwrap().upload_status, status);
        }
    }

    /// The sweep runs at construction, so a database opened after a kill comes
    /// up with nothing stranded.
    #[test]
    fn opening_the_database_releases_what_the_last_launch_stranded() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("routes.db");
        {
            let e = PersistentEngine::new(path.to_str().unwrap()).unwrap();
            e.insert_recording(&entry("r1", 1_000, "pending")).unwrap();
            e.set_recording_uploading("r1").unwrap();
        }

        let e = PersistentEngine::new(path.to_str().unwrap()).unwrap();
        assert_eq!(
            e.get_recording("r1").unwrap().unwrap().upload_status,
            "pending"
        );
    }

    #[test]
    fn a_restore_wipes_rows_whose_fit_files_did_not_come_with_it() {
        let (_dir, e) = engine();
        e.insert_recording(&entry("a", 1_000, "pending")).unwrap();
        e.insert_recording(&entry("b", 2_000, "uploaded")).unwrap();

        assert_eq!(e.clear_recordings().unwrap(), 2);
        assert!(e.list_recordings().unwrap().is_empty());
    }

    /// The install an outcome hands back. The engine call site checks it, so
    /// at this level any value stands for the attempt's own.
    const ATTEMPT: f64 = 1.0;

    fn status_of(e: &PersistentEngine, id: &str) -> String {
        e.get_recording(id).unwrap().unwrap().upload_status
    }

    #[test]
    fn a_begun_upload_that_lands_keeps_the_server_id() {
        let (_dir, e) = engine();
        e.insert_recording(&entry("r1", 1_000, "pending")).unwrap();

        let begun = e
            .transition_recording("r1", &UploadTransition::Begin, 2_000)
            .unwrap();
        assert!(begun.applied);
        assert_eq!(begun.found.as_deref(), Some("pending"));
        assert_eq!(begun.status.as_deref(), Some("uploading"));

        let landed = e
            .transition_recording(
                "r1",
                &UploadTransition::Uploaded {
                    install: ATTEMPT,
                    intervals_activity_id: Some("i77".to_string()),
                },
                3_000,
            )
            .unwrap();
        assert!(landed.applied);
        let row = e.get_recording("r1").unwrap().unwrap();
        assert_eq!(row.upload_status, "uploaded");
        assert_eq!(row.intervals_activity_id.as_deref(), Some("i77"));
    }

    /// Scenario: a stale library screen offers "upload now" on a ride that
    /// has already landed.
    /// Expected behaviour: the requeue is refused and the row is unchanged,
    /// because a pending row is what the drain sends, and it would send the
    /// ride a second time.
    #[test]
    fn a_requeue_of_an_uploaded_ride_is_refused() {
        let (_dir, e) = engine();
        let mut row = entry("r1", 1_000, "uploaded");
        row.intervals_activity_id = Some("i77".to_string());
        e.insert_recording(&row).unwrap();

        let answer = e
            .transition_recording("r1", &UploadTransition::Requeue, 2_000)
            .unwrap();
        assert!(!answer.applied);
        assert_eq!(answer.refusal, Some(UploadRefusal::IllegalTransition));
        assert_eq!(answer.found.as_deref(), Some("uploaded"));
        assert_eq!(status_of(&e, "r1"), "uploaded");

        let read = e.get_recording("r1").unwrap().unwrap();
        assert_eq!(read.upload_status, "uploaded");
        assert_eq!(read.intervals_activity_id.as_deref(), Some("i77"));
        assert!(e.next_pending_recording(9_999_999).unwrap().is_none());
    }

    /// A requeue of a ride mid-upload would let the next drain send it while
    /// the first request is still in flight.
    #[test]
    fn a_requeue_of_a_ride_mid_upload_is_refused() {
        let (_dir, e) = engine();
        e.insert_recording(&entry("r1", 1_000, "pending")).unwrap();
        e.transition_recording("r1", &UploadTransition::Begin, 2_000)
            .unwrap();

        let answer = e
            .transition_recording("r1", &UploadTransition::Requeue, 3_000)
            .unwrap();
        assert!(!answer.applied);
        assert_eq!(status_of(&e, "r1"), "uploading");
    }

    /// Scenario: a ride held for another athlete is offered to the drain.
    /// Expected behaviour: the begin is refused and the hold stands, so the
    /// signed-in athlete's credentials never send someone else's ride.
    #[test]
    fn a_begin_on_a_held_ride_is_refused() {
        let (_dir, e) = engine();
        e.insert_recording(&entry("r1", 1_000, "localOnly"))
            .unwrap();

        let answer = e
            .transition_recording("r1", &UploadTransition::Begin, 2_000)
            .unwrap();
        assert!(!answer.applied);
        assert_eq!(answer.found.as_deref(), Some("localOnly"));
        assert_eq!(status_of(&e, "r1"), "localOnly");

        e.set_recording_uploading("r1").unwrap();
        assert_eq!(status_of(&e, "r1"), "localOnly");
    }

    /// Two drains reaching one ride: the second begin is refused, which is the
    /// answer that stops it sending.
    #[test]
    fn a_second_begin_is_refused() {
        let (_dir, e) = engine();
        e.insert_recording(&entry("r1", 1_000, "pending")).unwrap();

        assert!(
            e.transition_recording("r1", &UploadTransition::Begin, 2_000)
                .unwrap()
                .applied
        );
        let again = e
            .transition_recording("r1", &UploadTransition::Begin, 2_001)
            .unwrap();
        assert!(!again.applied);
        assert_eq!(again.found.as_deref(), Some("uploading"));
    }

    #[test]
    fn a_second_failure_does_not_count_a_second_attempt() {
        let (_dir, e) = engine();
        e.insert_recording(&entry("r1", 1_000, "pending")).unwrap();
        e.transition_recording("r1", &UploadTransition::Begin, 2_000)
            .unwrap();
        let failed = UploadTransition::Failed {
            install: ATTEMPT,
            error: "503".to_string(),
        };

        let first = e.transition_recording("r1", &failed, 3_000).unwrap();
        assert!(first.applied);
        assert_eq!(first.retry_count, 1);
        let second = e.transition_recording("r1", &failed, 4_000).unwrap();
        assert!(!second.applied);
        assert_eq!(second.retry_count, 1);

        let row = e.get_recording("r1").unwrap().unwrap();
        assert_eq!(row.upload_status, "pending");
        assert_eq!(row.retry_count, 1);
        assert_eq!(row.last_attempt_at, Some(3_000.0));
    }

    /// The server holding the activity is a fact: the same answer twice is
    /// one upload, and a different id for one ride is refused rather than
    /// overwriting the link to the first.
    #[test]
    fn a_second_success_is_applied_once() {
        let (_dir, e) = engine();
        e.insert_recording(&entry("r1", 1_000, "pending")).unwrap();
        e.transition_recording("r1", &UploadTransition::Begin, 2_000)
            .unwrap();
        let landed = |id: &str| UploadTransition::Uploaded {
            install: ATTEMPT,
            intervals_activity_id: Some(id.to_string()),
        };
        assert!(
            e.transition_recording("r1", &landed("i77"), 3_000)
                .unwrap()
                .applied
        );
        e.set_recording_reconciled("r1").unwrap();

        let repeat = e.transition_recording("r1", &landed("i77"), 4_000).unwrap();
        assert!(repeat.applied);
        assert_eq!(repeat.found.as_deref(), Some("uploaded"));
        assert!(e.get_recording("r1").unwrap().unwrap().engine_reconciled);

        let other = e.transition_recording("r1", &landed("i88"), 5_000).unwrap();
        assert!(!other.applied);
        assert_eq!(other.refusal, Some(UploadRefusal::AnotherActivity));
        assert_eq!(
            e.get_recording("r1")
                .unwrap()
                .unwrap()
                .intervals_activity_id
                .as_deref(),
            Some("i77")
        );
    }

    /// Scenario: the app is killed between the begin and the outcome, and the
    /// next launch releases the ride before the old attempt reports back.
    /// Expected behaviour: the release counts one attempt and leaves the ride
    /// pending; a late failure of the released attempt is refused, so it is
    /// not counted twice, and a late success is still recorded, since the
    /// server has the ride.
    #[test]
    fn an_interrupted_attempt_is_counted_once_and_its_late_failure_refused() {
        let (_dir, e) = engine();
        e.insert_recording(&entry("r1", 1_000, "pending")).unwrap();
        e.transition_recording("r1", &UploadTransition::Begin, 2_000)
            .unwrap();

        assert_eq!(e.release_stranded_uploads(3_000).unwrap(), 1);
        let row = e.get_recording("r1").unwrap().unwrap();
        assert_eq!(row.upload_status, "pending");
        assert_eq!(row.retry_count, 1);

        let late_failure = e
            .transition_recording(
                "r1",
                &UploadTransition::Failed {
                    install: ATTEMPT,
                    error: "503".to_string(),
                },
                4_000,
            )
            .unwrap();
        assert!(!late_failure.applied);
        assert_eq!(e.get_recording("r1").unwrap().unwrap().retry_count, 1);

        let late_success = e
            .transition_recording(
                "r1",
                &UploadTransition::Uploaded {
                    install: ATTEMPT,
                    intervals_activity_id: Some("i77".to_string()),
                },
                5_000,
            )
            .unwrap();
        assert!(late_success.applied);
        assert_eq!(status_of(&e, "r1"), "uploaded");
    }

    /// Every outcome a failed request can report is refused once the row has
    /// left `uploading`, and writes nothing.
    #[test]
    fn an_outcome_without_a_begin_is_refused() {
        let outcomes = [
            UploadTransition::Failed {
                install: ATTEMPT,
                error: "503".to_string(),
            },
            UploadTransition::PermissionBlocked { install: ATTEMPT },
            UploadTransition::HeldForAuth {
                install: ATTEMPT,
                error: "401".to_string(),
            },
            UploadTransition::HeldForNetwork {
                install: ATTEMPT,
                error: "offline".to_string(),
            },
        ];
        for outcome in outcomes {
            let (_dir, e) = engine();
            e.insert_recording(&entry("r1", 1_000, "pending")).unwrap();
            let before = e.get_recording("r1").unwrap().unwrap();

            let answer = e.transition_recording("r1", &outcome, 2_000).unwrap();
            assert!(!answer.applied, "{outcome:?} was applied to a pending row");
            let after = e.get_recording("r1").unwrap().unwrap();
            assert_eq!(after.upload_status, before.upload_status);
            assert_eq!(after.last_attempt_at, before.last_attempt_at);
            assert_eq!(after.last_error, before.last_error);
        }
    }

    #[test]
    fn a_transition_on_a_missing_ride_is_refused() {
        let (_dir, e) = engine();
        let answer = e
            .transition_recording("absent", &UploadTransition::Begin, 2_000)
            .unwrap();
        assert!(!answer.applied);
        assert_eq!(answer.refusal, Some(UploadRefusal::NoRecording));
        assert_eq!(answer.found, None);
    }

    /// The confirmation reads an uploaded ride gone from intervals.icu, and
    /// a body missing before the begin rejects a pending one: both park it
    /// for the athlete. A ride already parked is not rejected again.
    #[test]
    fn a_rejection_parks_a_pending_or_uploaded_ride_and_nothing_else() {
        let (_dir, mut e) = engine();
        uploaded_recording(&mut e);
        e.insert_recording(&entry("p1", 2_000, "pending")).unwrap();
        let rejected = UploadTransition::Rejected {
            install: ATTEMPT,
            error: "gone".to_string(),
        };

        assert!(
            e.transition_recording("r1", &rejected, 3_000)
                .unwrap()
                .applied
        );
        assert_eq!(e.intervals_id("local-r1"), None);
        assert!(
            e.transition_recording("p1", &rejected, 3_000)
                .unwrap()
                .applied
        );
        for id in ["r1", "p1"] {
            assert_eq!(status_of(&e, id), "failed");
        }
        let again = e.transition_recording("r1", &rejected, 4_000).unwrap();
        assert!(!again.applied);
        assert_eq!(
            e.get_recording("r1").unwrap().unwrap().last_attempt_at,
            Some(3_000.0)
        );
    }
}
