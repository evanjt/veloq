//! Swapping Garmin's own file into an activity intervals.icu imported from
//! Garmin, one activity at a time, and putting intervals.icu's file back.
//!
//! intervals.icu's copy of a Garmin ride holds the same records as the
//! original but drops fields Garmin writes. The athlete asks for the swap on
//! one activity; nothing here runs on its own and nothing is deleted.
//!
//! The write goes only to an activity whose `external_id` is exactly the
//! Garmin id and whose source is Garmin's import. Before the file is replaced
//! the file intervals.icu holds is kept on the device, so every swap can be
//! undone the same way, and after it the file is read back and compared with
//! what was sent.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use crate::net::upload_recording::{Verdict, classify};
use crate::objects::observer::{Announcement, notify};
use crate::objects::sync::FfiCallOutcome;

/// The `source` intervals.icu records for an activity it imported from Garmin.
const GARMIN_IMPORT_SOURCE: &str = "GARMIN_CONNECT";

/// The directory under the documents directory the previous files sit in.
const SWAP_DIR: &str = "garmin-swap";

/// Whether the athlete is offered the swap, or an undo, on an activity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
#[repr(u8)]
pub enum FfiSwapState {
    /// Nothing is offered: no Garmin key, not Garmin's import, nothing more in
    /// Garmin's file, or the comparison could not be made.
    Hidden = 1,
    /// Garmin's original holds more than intervals.icu's copy.
    Available = 2,
    /// A swap was made and intervals.icu's earlier file is kept to restore.
    Undoable = 3,
}

/// How a swap or an undo ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
#[repr(u8)]
pub enum FfiSwapOutcome {
    /// intervals.icu's file is now Garmin's, read back byte for byte.
    Replaced = 1,
    /// intervals.icu already held that file, or Garmin's holds nothing more.
    Unchanged = 2,
    /// intervals.icu does not accept a replacement for this activity. Nothing
    /// changed.
    Refused = 3,
    /// The grant lacks write permission.
    PermissionBlocked = 4,
    /// The credential was refused.
    AuthExpired = 5,
    /// The call failed before or while sending. The earlier file is still the
    /// activity's unless the read-back says otherwise.
    Failed = 6,
    /// The activity is not Garmin's import, so no write is made to it.
    NotEligible = 7,
    /// The file was sent but the read-back differs. Undo restores the earlier
    /// file.
    Mismatch = 8,
    /// Garmin's original could not be fetched: no key, or Garmin refused.
    GarminUnavailable = 9,
    /// intervals.icu's earlier file is back, read back byte for byte.
    Restored = 10,
}

#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FfiSwapResult {
    pub outcome: FfiSwapOutcome,
    pub detail: Option<String>,
}

impl FfiSwapResult {
    fn bare(outcome: FfiSwapOutcome) -> Self {
        Self {
            outcome,
            detail: None,
        }
    }

    fn with(outcome: FfiSwapOutcome, detail: String) -> Self {
        Self {
            outcome,
            detail: Some(detail),
        }
    }
}

/// What the swap asks of intervals.icu, of Garmin and of the device. The app
/// runs [`Live`]; a test hands in a fake.
pub(crate) trait SwapLink {
    fn has_garmin_key(&self) -> bool;
    /// The activity as intervals.icu holds it now, as JSON.
    fn activity_json(&self, id: &str) -> Result<String, FfiCallOutcome>;
    /// The file intervals.icu holds for the activity.
    fn activity_file(&self, id: &str) -> Result<Vec<u8>, FfiCallOutcome>;
    /// Garmin's original FIT, `Err` with the reason when it cannot be had.
    fn garmin_original(&self, garmin_id: i64) -> Result<Vec<u8>, String>;
    /// Replace the activity's file from `path`.
    fn replace(
        &self,
        id: &str,
        path: &Path,
        filename: &str,
        keep_intervals: bool,
    ) -> FfiCallOutcome;
    /// Where the files kept for undo sit, `None` while the app has not said
    /// where its documents directory is.
    fn swap_dir(&self) -> Option<PathBuf>;
}

/// The link the app runs.
pub(crate) struct Live;

impl SwapLink for Live {
    fn has_garmin_key(&self) -> bool {
        crate::objects::garmin_key::GARMIN_KEY.client().is_some()
    }

    fn activity_json(&self, id: &str) -> Result<String, FfiCallOutcome> {
        let (outcome, body) =
            crate::runtime::block_on(crate::objects::sync::fetch_activity_json(id.to_string()));
        body.ok_or(outcome)
    }

    fn activity_file(&self, id: &str) -> Result<Vec<u8>, FfiCallOutcome> {
        let (outcome, file) =
            crate::runtime::block_on(crate::objects::sync::fetch_activity_file(id.to_string()));
        file.ok_or(outcome)
    }

    fn garmin_original(&self, garmin_id: i64) -> Result<Vec<u8>, String> {
        let client = crate::objects::garmin_key::GARMIN_KEY
            .client()
            .ok_or_else(|| "no Garmin key is connected".to_string())?;
        crate::runtime::block_on(async move {
            let (tx, rx) = tokio::sync::oneshot::channel();
            crate::runtime::spawn(async move {
                let _ = tx.send(
                    client
                        .download_original(garmin_id, crate::net::garmin::dispatch())
                        .await,
                );
            });
            rx.await
        })
        .map_err(|_| "the download ended without reporting".to_string())?
        .map_err(|e| e.to_string())
    }

    fn replace(
        &self,
        id: &str,
        path: &Path,
        filename: &str,
        keep_intervals: bool,
    ) -> FfiCallOutcome {
        crate::runtime::block_on(crate::objects::sync::replace_activity_file_in_place(
            id.to_string(),
            path.to_string_lossy().into_owned(),
            filename.to_string(),
            keep_intervals,
        ))
    }

    fn swap_dir(&self) -> Option<PathBuf> {
        crate::net::upload_recording::recording_file(SWAP_DIR)
    }
}

/// What an activity's JSON says about whether Garmin's file can be swapped in.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Import {
    garmin_id: i64,
    /// Whether the athlete has edited the activity's intervals, so a
    /// replacement has to keep them.
    intervals_edited: bool,
    /// When intervals.icu last analysed the activity, which a comparison is
    /// cached against.
    analysed: String,
}

/// The Garmin import an activity is: its source is Garmin's import and its
/// `external_id` is the Garmin id, digits only. Any other activity, including
/// a Garmin original this app uploaded itself, is not one.
fn import_of(activity_json: &str) -> Option<Import> {
    let value: serde_json::Value = serde_json::from_str(activity_json).ok()?;
    if value.get("source")?.as_str()? != GARMIN_IMPORT_SOURCE {
        return None;
    }
    let external = value.get("external_id")?.as_str()?;
    if external.is_empty() || !external.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let garmin_id = external.parse::<i64>().ok().filter(|id| *id > 0)?;
    Some(Import {
        garmin_id,
        intervals_edited: value
            .get("icu_intervals_edited")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        analysed: value
            .get("analyzed")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
    })
}

/// What a comparison found, kept against the analysed time it was made at, so
/// an activity is compared once until intervals.icu analyses it again.
static COMPARED: LazyLock<Mutex<HashMap<String, (String, bool)>>> = LazyLock::new(Default::default);

fn forget_comparison(id: &str) {
    COMPARED
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(id);
}

fn previous_file(link: &dyn SwapLink, id: &str) -> Option<PathBuf> {
    Some(link.swap_dir()?.join(format!("{id}.previous.fit")))
}

/// What is offered on the activity `id`.
pub(crate) fn state(link: &dyn SwapLink, id: &str) -> FfiSwapState {
    if previous_file(link, id).is_some_and(|p| p.is_file()) {
        return FfiSwapState::Undoable;
    }
    if !link.has_garmin_key() {
        return FfiSwapState::Hidden;
    }
    let Ok(json) = link.activity_json(id) else {
        return FfiSwapState::Hidden;
    };
    let Some(import) = import_of(&json) else {
        return FfiSwapState::Hidden;
    };
    let cached = COMPARED
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(id)
        .filter(|(analysed, _)| *analysed == import.analysed)
        .map(|(_, more)| *more);
    let more = match cached {
        Some(more) => more,
        None => {
            let Some(more) = compare(link, id, &import) else {
                return FfiSwapState::Hidden;
            };
            COMPARED
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .insert(id.to_string(), (import.analysed.clone(), more));
            more
        }
    };
    if more {
        FfiSwapState::Available
    } else {
        FfiSwapState::Hidden
    }
}

/// Whether Garmin's original holds more than intervals.icu's file, `None`
/// when either cannot be had or read.
fn compare(link: &dyn SwapLink, id: &str, import: &Import) -> Option<bool> {
    let original = link.garmin_original(import.garmin_id).ok()?;
    let current = link
        .activity_file(id)
        .ok()
        .filter(|file| !file.is_empty())?;
    crate::fit::holds_more_than(&original, &current).ok()
}

fn outcome_of(verdict: Verdict) -> FfiSwapResult {
    match verdict {
        Verdict::Landed(Some(_)) => FfiSwapResult::bare(FfiSwapOutcome::Replaced),
        Verdict::Landed(None) => FfiSwapResult::bare(FfiSwapOutcome::Unchanged),
        Verdict::PermissionBlocked => FfiSwapResult::bare(FfiSwapOutcome::PermissionBlocked),
        Verdict::AuthExpired(d) => FfiSwapResult::with(FfiSwapOutcome::AuthExpired, d),
        Verdict::Rejected(d) => FfiSwapResult::with(FfiSwapOutcome::Refused, d),
        Verdict::OtherAthlete => FfiSwapResult::bare(FfiSwapOutcome::Failed),
        Verdict::Network(d) | Verdict::Retriable(d) => {
            FfiSwapResult::with(FfiSwapOutcome::Failed, d)
        }
    }
}

fn failed(detail: impl Into<String>) -> FfiSwapResult {
    FfiSwapResult::with(FfiSwapOutcome::Failed, detail.into())
}

/// Replace intervals.icu's file with `bytes` and read it back. `landed` is the
/// outcome to report when the read-back matches. The temp file the post
/// streams from is removed whatever happens.
fn post_and_verify(
    link: &dyn SwapLink,
    id: &str,
    bytes: &[u8],
    keep_intervals: bool,
    landed: FfiSwapOutcome,
) -> FfiSwapResult {
    let Some(dir) = link.swap_dir() else {
        return failed("the documents directory is not known yet");
    };
    if let Err(e) = std::fs::create_dir_all(&dir) {
        return failed(format!("could not make room for the file: {e}"));
    }
    let outgoing = dir.join(format!("{id}.outgoing.fit"));
    if let Err(e) = crate::atomic_file::write_atomically(&outgoing, bytes) {
        return failed(format!("could not stage the file: {e}"));
    }
    let answer = link.replace(id, &outgoing, &format!("{id}.fit"), keep_intervals);
    let _ = std::fs::remove_file(&outgoing);
    match classify(&answer) {
        Verdict::Landed(Some(_)) => confirm(link, id, bytes, FfiSwapResult::bare(landed)),
        // The request may have reached intervals.icu before it failed.
        verdict @ (Verdict::Network(_) | Verdict::Retriable(_)) => {
            reconcile(link, id, bytes, landed, outcome_of(verdict))
        }
        // The same refusal a recording upload reads, so the store parks every
        // write surface together.
        Verdict::PermissionBlocked => {
            notify(Announcement::UploadPermissionRefused);
            outcome_of(Verdict::PermissionBlocked)
        }
        other => outcome_of(other),
    }
}

/// A request that may have reached intervals.icu: if its file is already the
/// one sent, the swap landed.
fn reconcile(
    link: &dyn SwapLink,
    id: &str,
    sent: &[u8],
    landed: FfiSwapOutcome,
    otherwise: FfiSwapResult,
) -> FfiSwapResult {
    match link.activity_file(id) {
        Ok(held) if held == sent => FfiSwapResult::bare(landed),
        _ => otherwise,
    }
}

/// Read the file back and compare it with what was sent.
fn confirm(link: &dyn SwapLink, id: &str, sent: &[u8], ok: FfiSwapResult) -> FfiSwapResult {
    match link.activity_file(id) {
        Ok(held) if held == sent => ok,
        Ok(_) => FfiSwapResult::with(
            FfiSwapOutcome::Mismatch,
            "intervals.icu holds a different file than the one sent".into(),
        ),
        Err(e) => FfiSwapResult::with(
            FfiSwapOutcome::Mismatch,
            format!("the file could not be read back: {}", e.message),
        ),
    }
}

/// Swap Garmin's original into the activity `id`.
pub(crate) fn replace(link: &dyn SwapLink, id: &str) -> FfiSwapResult {
    let Ok(json) = link.activity_json(id) else {
        return failed("the activity could not be read from intervals.icu");
    };
    let Some(import) = import_of(&json) else {
        return FfiSwapResult::bare(FfiSwapOutcome::NotEligible);
    };
    let original = match link.garmin_original(import.garmin_id) {
        Ok(original) => original,
        Err(reason) => return FfiSwapResult::with(FfiSwapOutcome::GarminUnavailable, reason),
    };
    let current = match link.activity_file(id) {
        Ok(current) => current,
        Err(e) => {
            return failed(format!(
                "intervals.icu's file could not be read: {}",
                e.message
            ));
        }
    };
    // An empty file is no file: there would be nothing to restore.
    if current.is_empty() {
        return failed("intervals.icu holds no file for this activity");
    }
    match crate::fit::holds_more_than(&original, &current) {
        Ok(true) => {}
        Ok(false) => return FfiSwapResult::bare(FfiSwapOutcome::Unchanged),
        Err(e) => return failed(format!("a file could not be read: {e}")),
    }
    let Some(kept) = previous_file(link, id) else {
        return failed("the documents directory is not known yet");
    };
    if let Some(dir) = kept.parent()
        && let Err(e) = std::fs::create_dir_all(dir)
    {
        return failed(format!("could not make room for the earlier file: {e}"));
    }
    if let Err(e) = crate::atomic_file::write_atomically(&kept, &current) {
        return failed(format!("could not keep the earlier file: {e}"));
    }
    let result = post_and_verify(
        link,
        id,
        &original,
        import.intervals_edited,
        FfiSwapOutcome::Replaced,
    );
    forget_comparison(id);
    // Only a swap that changed the file leaves an earlier one to restore.
    let changed = matches!(
        result.outcome,
        FfiSwapOutcome::Replaced | FfiSwapOutcome::Mismatch
    );
    if !changed {
        let _ = std::fs::remove_file(&kept);
    }
    result
}

/// Put the earlier file back into the activity `id`.
pub(crate) fn undo(link: &dyn SwapLink, id: &str) -> FfiSwapResult {
    let Some(kept) = previous_file(link, id).filter(|p| p.is_file()) else {
        return FfiSwapResult::bare(FfiSwapOutcome::Unchanged);
    };
    let Ok(earlier) = std::fs::read(&kept) else {
        return failed("the earlier file could not be read from the device");
    };
    let edited = link
        .activity_json(id)
        .ok()
        .and_then(|json| serde_json::from_str::<serde_json::Value>(&json).ok())
        .and_then(|v| v.get("icu_intervals_edited").and_then(|e| e.as_bool()))
        .unwrap_or(false);
    let result = post_and_verify(link, id, &earlier, edited, FfiSwapOutcome::Restored);
    forget_comparison(id);
    if result.outcome == FfiSwapOutcome::Restored {
        let _ = std::fs::remove_file(&kept);
    }
    result
}

#[cfg(test)]
#[path = "tests/garmin_swap.rs"]
mod tests;
