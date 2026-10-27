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

use std::path::{Path, PathBuf};

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
    /// Nothing is offered: no Garmin key, or not Garmin's import.
    Hidden = 1,
    /// Garmin's original holds more than intervals.icu's copy, or the activity
    /// is a stub Garmin's original can fill.
    Available = 2,
    /// A swap was made and intervals.icu's earlier file is kept to restore.
    Undoable = 3,
    /// A Garmin import that has not been compared yet. Opening it downloads
    /// nothing, the athlete asks for the check.
    Checkable = 4,
    /// The check found nothing more in Garmin's file.
    Unchanged = 5,
}

/// What a feed card says about a stub, an activity intervals.icu holds but
/// does not serve. The one judge for the card, beside [`state`] for the page.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
#[repr(u8)]
pub enum FfiStubVerdict {
    /// intervals.icu serves the activity.
    NotStub = 1,
    /// A stub of Garmin's import, and a key is connected to fill it.
    GarminUpdatable = 2,
    /// A stub of Garmin's import and no key is connected.
    NoKey = 3,
    /// A stub that is not Garmin's import, so there is nothing to offer.
    OtherSource = 4,
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
    /// Store Garmin's original on the phone as the activity's own, linked to
    /// the intervals.icu activity `stub` describes. Nothing is stored twice.
    fn keep_original(&self, garmin_id: i64, original: &[u8], stub: &str) -> Result<(), String>;
    /// Read the activity from intervals.icu again and store what it serves, so
    /// a body it now serves replaces the stub.
    fn reread(&self, id: &str);
    /// The activity as the phone stores it, as JSON. Reads no network.
    fn stored_json(&self, id: &str) -> Option<String>;
    /// What a check of the activity found, as [`remember`] wrote it.
    fn remembered(&self, id: &str) -> Option<String>;
    /// Keep what a check found. An empty value forgets it.
    fn remember(&self, id: &str, value: &str);
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

    fn keep_original(&self, garmin_id: i64, original: &[u8], stub: &str) -> Result<(), String> {
        use crate::net::garmin::ingest::{Ingested, ingest_original};
        let record: crate::net::intervals::wire::ActivityRecord =
            serde_json::from_str(stub).map_err(|e| e.to_string())?;
        let listed = crate::push::garmin::listed_from(garmin_id, &record);
        let install = crate::persistence::engine_install();
        // The activity is on intervals.icu already, so the upload never offers it.
        let ingested =
            ingest_original(install, &listed, original, false).map_err(|e| e.to_string())?;
        if matches!(ingested, Ingested::AlreadyStored) {
            let key = crate::persistence::origin::garmin_source_key(garmin_id);
            crate::persistence::with_persistent_engine_for(install, |e| {
                e.link_garmin_original(&key)
            })
            .ok_or_else(|| "the engine closed".to_string())?
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn reread(&self, id: &str) {
        let Ok(body) = self.activity_json(id) else {
            return;
        };
        let install = crate::persistence::engine_install();
        let stored = crate::persistence::with_persistent_engine_for(install, |engine| {
            crate::push::record_activity_detail(engine, id, &body)
        });
        if !matches!(stored, Some(Ok(_))) {
            log::warn!("veloqrs: [garmin] the activity did not store after the update");
        }
    }

    fn stored_json(&self, id: &str) -> Option<String> {
        crate::objects::error::with_reader(|conn| {
            conn.query_row(
                "SELECT raw FROM activity_bodies WHERE activity_id = ?1",
                [id],
                |row| row.get::<_, String>(0),
            )
            .ok()
        })
        .ok()
        .flatten()
    }

    fn remembered(&self, id: &str) -> Option<String> {
        crate::objects::error::with_reader(|conn| {
            crate::persistence::settings::setting_from(conn, &check_key(id))
                .ok()
                .flatten()
        })
        .ok()
        .flatten()
    }

    fn remember(&self, id: &str, value: &str) {
        let key = check_key(id);
        let install = crate::persistence::engine_install();
        let written =
            crate::persistence::with_persistent_engine_for(install, |e| e.set_setting(&key, value));
        if !matches!(written, Some(Ok(()))) {
            log::warn!("veloqrs: [garmin] a check result did not store");
        }
    }
}

fn check_key(id: &str) -> String {
    format!("garmin_check.{id}")
}

/// What an activity's JSON says about whether Garmin's file can be swapped in.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Import {
    garmin_id: i64,
    /// Whether intervals.icu answered an empty stub for the activity.
    held_back: bool,
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
fn garmin_id_of(source: Option<&str>, external_id: Option<&str>) -> Option<i64> {
    if source? != GARMIN_IMPORT_SOURCE {
        return None;
    }
    let external = external_id?;
    if external.is_empty() || !external.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    external.parse::<i64>().ok().filter(|id| *id > 0)
}

/// What a stored activity body makes of the card: a stub, and whether Garmin's
/// file can fill it.
pub(crate) fn stub_verdict(
    body: &crate::net::intervals::wire::ActivityRecord,
    key_held: bool,
) -> FfiStubVerdict {
    if !body.is_held_back() {
        return FfiStubVerdict::NotStub;
    }
    match garmin_id_of(body.source.as_deref(), body.external_id.as_deref()) {
        None => FfiStubVerdict::OtherSource,
        Some(_) if key_held => FfiStubVerdict::GarminUpdatable,
        Some(_) => FfiStubVerdict::NoKey,
    }
}

fn import_of(activity_json: &str) -> Option<Import> {
    let value: serde_json::Value = serde_json::from_str(activity_json).ok()?;
    let garmin_id = garmin_id_of(
        value.get("source")?.as_str(),
        value.get("external_id")?.as_str(),
    )?;
    let held_back =
        serde_json::from_value::<crate::net::intervals::wire::ActivityRecord>(value.clone())
            .is_ok_and(|record| record.is_held_back());
    Some(Import {
        garmin_id,
        held_back,
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

/// Forget what a check of the activity found.
fn forget_comparison(link: &dyn SwapLink, id: &str) {
    link.remember(id, "");
}

/// What a check found, kept against the analysed time it was made at, so an
/// activity is checked once until intervals.icu analyses it again.
fn remembered_check(link: &dyn SwapLink, id: &str, import: &Import) -> Option<bool> {
    let value = link.remembered(id)?;
    let (analysed, more) = value.rsplit_once('|')?;
    if analysed != import.analysed {
        return None;
    }
    match more {
        "1" => Some(true),
        "0" => Some(false),
        _ => None,
    }
}

fn previous_file(link: &dyn SwapLink, id: &str) -> Option<PathBuf> {
    Some(link.swap_dir()?.join(format!("{id}.previous.fit")))
}

/// What is offered on the activity `id`. Reads only what the phone holds:
/// comparing the two files is the athlete's tap, see [`check`].
pub(crate) fn state(link: &dyn SwapLink, id: &str) -> FfiSwapState {
    if previous_file(link, id).is_some_and(|p| p.is_file()) {
        return FfiSwapState::Undoable;
    }
    if !link.has_garmin_key() {
        return FfiSwapState::Hidden;
    }
    let Some(json) = link.stored_json(id) else {
        return FfiSwapState::Hidden;
    };
    let Some(import) = import_of(&json) else {
        return FfiSwapState::Hidden;
    };
    // A stub has no file to compare, and Garmin's original is what the athlete
    // asks to have in its place.
    if import.held_back {
        return FfiSwapState::Available;
    }
    match remembered_check(link, id, &import) {
        Some(true) => FfiSwapState::Available,
        Some(false) => FfiSwapState::Unchanged,
        None => FfiSwapState::Checkable,
    }
}

/// Compare Garmin's original with intervals.icu's file, on the athlete's tap,
/// and keep the answer against the analysed time. A comparison that cannot be
/// made leaves the check on offer. Nothing is written to intervals.icu.
pub(crate) fn check(link: &dyn SwapLink, id: &str) -> FfiSwapState {
    if !link.has_garmin_key() {
        return FfiSwapState::Hidden;
    }
    let Ok(json) = link.activity_json(id) else {
        return state(link, id);
    };
    let Some(import) = import_of(&json) else {
        return FfiSwapState::Hidden;
    };
    if import.held_back {
        return FfiSwapState::Available;
    }
    let Some(more) = compare(link, id, &import) else {
        return FfiSwapState::Checkable;
    };
    link.remember(
        id,
        &format!("{}|{}", import.analysed, if more { 1 } else { 0 }),
    );
    if more {
        FfiSwapState::Available
    } else {
        FfiSwapState::Unchanged
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
    post(link, id, bytes, keep_intervals, landed, true)
}

/// [`post_and_verify`], with the read-back optional: intervals.icu does not
/// serve the file of a stub, so there is nothing to read back.
fn post(
    link: &dyn SwapLink,
    id: &str,
    bytes: &[u8],
    keep_intervals: bool,
    landed: FfiSwapOutcome,
    read_back: bool,
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
        Verdict::Landed(Some(_)) if !read_back => FfiSwapResult::bare(landed),
        Verdict::Landed(Some(_)) => confirm(link, id, bytes, FfiSwapResult::bare(landed)),
        // The request may have reached intervals.icu before it failed.
        verdict @ (Verdict::Network(_) | Verdict::Retriable(_)) if read_back => {
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

/// Swap Garmin's original into the activity `id`. A stub intervals.icu will
/// not serve takes Garmin's file with nothing to compare or restore. The
/// automatic pass takes this same path for each new import.
pub(crate) fn replace(link: &dyn SwapLink, id: &str) -> FfiSwapResult {
    swap(link, id)
}

/// Replace a stub's file with Garmin's original and keep the original on the
/// phone. The activity may be served again afterwards or stay a stub, and the
/// post stands either way.
fn replace_stub(link: &dyn SwapLink, id: &str, json: &str, import: &Import) -> FfiSwapResult {
    let original = match link.garmin_original(import.garmin_id) {
        Ok(original) => original,
        Err(reason) => return FfiSwapResult::with(FfiSwapOutcome::GarminUnavailable, reason),
    };
    if let Err(e) = crate::fit::parse_fit_activity(&original) {
        return failed(format!("Garmin's file could not be read: {e}"));
    }
    let result = post(
        link,
        id,
        &original,
        import.intervals_edited,
        FfiSwapOutcome::Replaced,
        false,
    );
    if result.outcome != FfiSwapOutcome::Replaced {
        return result;
    }
    forget_comparison(link, id);
    link.reread(id);
    match link.keep_original(import.garmin_id, &original, json) {
        Ok(()) => result,
        Err(e) => FfiSwapResult::with(
            FfiSwapOutcome::Replaced,
            format!("the original was not kept on the phone: {e}"),
        ),
    }
}

fn swap(link: &dyn SwapLink, id: &str) -> FfiSwapResult {
    let Ok(json) = link.activity_json(id) else {
        return failed("the activity could not be read from intervals.icu");
    };
    let Some(import) = import_of(&json) else {
        return FfiSwapResult::bare(FfiSwapOutcome::NotEligible);
    };
    // A stub whose file intervals.icu serves anyway is a served activity.
    let served = if import.held_back {
        match link.activity_file(id) {
            Ok(file) if !file.is_empty() => Some(file),
            _ => return replace_stub(link, id, &json, &import),
        }
    } else {
        None
    };
    let original = match link.garmin_original(import.garmin_id) {
        Ok(original) => original,
        Err(reason) => return FfiSwapResult::with(FfiSwapOutcome::GarminUnavailable, reason),
    };
    let current = match served.map_or_else(|| link.activity_file(id), Ok) {
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
    forget_comparison(link, id);
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
    forget_comparison(link, id);
    if result.outcome == FfiSwapOutcome::Restored {
        let _ = std::fs::remove_file(&kept);
    }
    result
}

#[cfg(test)]
#[path = "tests/garmin_swap.rs"]
mod tests;
