//! Finishing a live strength session as a recording: the FIT file of its done
//! sets, the session finished under the recording's key, and the row the
//! upload reads.

use crate::persistence::PersistentEngine;
use crate::persistence::recordings::{FfiRecordingEntry, provisional_activity_id};
use std::path::Path;

/// The directory under the documents directory a recording's FIT sits in.
const RECORDINGS_DIR: &str = "recordings";

/// What finishing a session needs from the caller.
#[derive(Debug, Clone, Copy)]
pub struct FinishRecording<'a> {
    /// The id the recording row takes and the FIT file is named after.
    pub recording_id: &'a str,
    /// The activity's name on intervals.icu.
    pub name: &'a str,
    /// The athlete signed in, who owns the recording.
    pub athlete_id: Option<&'a str>,
    /// Unix seconds.
    pub now: i64,
    /// The effort from 1 to 10 the athlete gave the session, sent to intervals.icu after the file.
    pub rpe: Option<u32>,
    /// The row waits on the device for the athlete to send it, as when auto-upload is off or the
    /// source has nowhere to send a ride. Otherwise it is queued for upload.
    pub keep_on_device: bool,
    /// The documents directory the FIT is written under, in `recordings/`.
    pub files_root: &'a Path,
}

/// How a finish ended.
#[derive(Debug, Clone)]
pub enum StrengthFinish {
    /// The session is finished and this row holds its FIT.
    Finished(Box<FfiRecordingEntry>),
    /// No set was done. Nothing was written and the session is still live.
    NoSets,
}

/// Why a finish was refused or failed. Nothing is changed in either case.
#[derive(Debug, Clone, PartialEq)]
pub enum FinishError {
    /// No session is live.
    NoLiveSession,
    /// A recording already holds the id.
    RecordingExists,
    /// The file could not be written.
    Io(String),
    Sql(String),
}

impl std::fmt::Display for FinishError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FinishError::NoLiveSession => write!(f, "no strength session is live"),
            FinishError::RecordingExists => write!(f, "a recording already holds that id"),
            FinishError::Io(msg) | FinishError::Sql(msg) => write!(f, "{msg}"),
        }
    }
}

impl From<rusqlite::Error> for FinishError {
    fn from(error: rusqlite::Error) -> Self {
        FinishError::Sql(error.to_string())
    }
}

impl PersistentEngine {
    /// Finish the live session as the recording `input.recording_id`: write the
    /// FIT of its done sets under `files_root`, finish the session under the
    /// recording's key and insert the `fit` row, in one transaction. A
    /// session with no done set answers [`StrengthFinish::NoSets`] and
    /// changes nothing. A failure after the file was written removes it.
    pub fn finish_strength_recording(
        &self,
        input: &FinishRecording<'_>,
    ) -> Result<StrengthFinish, FinishError> {
        let mut written: Option<std::path::PathBuf> = None;
        let result = self.finish_in_txn(input, &mut written);
        if !matches!(result, Ok(StrengthFinish::Finished(_)))
            && let Some(path) = written
        {
            let _ = std::fs::remove_file(path);
        }
        result
    }

    fn finish_in_txn(
        &self,
        input: &FinishRecording<'_>,
        written: &mut Option<std::path::PathBuf>,
    ) -> Result<StrengthFinish, FinishError> {
        crate::persistence::climb_bests::in_write_txn(&self.db, |_| {
            let Some(mut session) = self.live_strength_session()? else {
                return Ok(Err(FinishError::NoLiveSession));
            };
            if !session
                .exercises
                .iter()
                .any(|e| e.sets.iter().any(|s| s.done))
            {
                return Ok(Ok(StrengthFinish::NoSets));
            }
            if self.get_recording(input.recording_id)?.is_some() {
                return Ok(Err(FinishError::RecordingExists));
            }
            let key = provisional_activity_id(input.recording_id);
            session.finish(&key, input.now);
            let fit = session.fit_session(self.athlete_weight_unit()?).to_fit();
            let relative = format!("{RECORDINGS_DIR}/{}.fit", input.recording_id);
            let path = input.files_root.join(&relative);
            if let Err(error) = write_file(&path, &fit) {
                return Ok(Err(FinishError::Io(error.to_string())));
            }
            *written = Some(path);

            let start = session.started_at.unwrap_or(input.now);
            let entry = FfiRecordingEntry {
                id: input.recording_id.to_string(),
                kind: "fit".to_string(),
                fit_path: relative,
                streams_path: None,
                activity_type: "WeightTraining".to_string(),
                name: input.name.to_string(),
                start_time: start as f64 * 1000.0,
                duration_seconds: (input.now - start).max(0) as f64,
                distance_meters: 0.0,
                elevation_gain: None,
                avg_heartrate: session.average_heart_rate().map(f64::from),
                paired_event_id: None,
                created_at: input.now as f64 * 1000.0,
                upload_status: if input.keep_on_device {
                    "localOnly"
                } else {
                    "pending"
                }
                .to_string(),
                retry_count: 0,
                last_attempt_at: None,
                last_error: None,
                intervals_activity_id: None,
                engine_activity_id: Some(key),
                engine_reconciled: false,
                athlete_id: input.athlete_id.map(str::to_string),
                notes: None,
                rpe: input.rpe,
                rpe_sent: false,
            };
            self.save_strength_session(&session)?;
            self.insert_recording(&entry)?;
            Ok(Ok(StrengthFinish::Finished(Box::new(entry))))
        })?
    }
}

fn write_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, bytes)
}
