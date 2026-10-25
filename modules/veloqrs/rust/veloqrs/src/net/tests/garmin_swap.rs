//! Scenario: an athlete swaps Garmin's own file into an activity intervals.icu
//! imported from Garmin, over a link that records what was sent.
//!
//! Expected behaviour: the earlier file is kept before anything is sent, the
//! write goes only to an exact Garmin import, a read-back that differs is
//! reported, a refusal changes nothing, and undo restores the earlier file.

use super::*;
use crate::fit_synthetic::{indoor_ride, outdoor_ride};
use crate::objects::sync::FfiCallKind;
use std::cell::RefCell;
use tempfile::TempDir;

const GARMIN_ID: i64 = 18_342_901_776;

fn import_json(edited: bool, analysed_at: &str) -> String {
    serde_json::json!({
        "id": "i500",
        "source": "GARMIN_CONNECT",
        "external_id": GARMIN_ID.to_string(),
        "icu_intervals_edited": edited,
        "analyzed": analysed_at,
    })
    .to_string()
}

fn http(status: u16) -> FfiCallOutcome {
    FfiCallOutcome {
        kind: FfiCallKind::Http,
        id: None,
        status: Some(status),
        detail: None,
        message: format!("http {status}"),
    }
}

fn ok(id: Option<&str>) -> FfiCallOutcome {
    FfiCallOutcome {
        kind: FfiCallKind::Ok,
        id: id.map(str::to_string),
        status: None,
        detail: None,
        message: "ok".into(),
    }
}

struct Fake {
    dir: TempDir,
    key: bool,
    json: String,
    /// The file intervals.icu holds; a replace overwrites it unless `drops`.
    held: RefCell<Vec<u8>>,
    original: Result<Vec<u8>, String>,
    answer: RefCell<FfiCallOutcome>,
    /// A replace answers ok but leaves the held file as it was.
    drops: bool,
    sent: RefCell<Vec<(Vec<u8>, bool)>>,
    kept_when_sent: RefCell<Vec<bool>>,
    file_reads: RefCell<u32>,
    json_reads: RefCell<u32>,
}

impl Fake {
    fn new(original: Vec<u8>, held: Vec<u8>) -> Self {
        Self {
            dir: TempDir::new().unwrap(),
            key: true,
            json: import_json(false, "2026-10-25T09:00:00"),
            held: RefCell::new(held),
            original: Ok(original),
            answer: RefCell::new(ok(Some("i500"))),
            drops: false,
            sent: RefCell::new(Vec::new()),
            kept_when_sent: RefCell::new(Vec::new()),
            file_reads: RefCell::new(0),
            json_reads: RefCell::new(0),
        }
    }

    fn kept_path(&self, id: &str) -> PathBuf {
        self.dir.path().join(format!("{id}.previous.fit"))
    }
}

impl SwapLink for Fake {
    fn has_garmin_key(&self) -> bool {
        self.key
    }

    fn activity_json(&self, _id: &str) -> Result<String, FfiCallOutcome> {
        *self.json_reads.borrow_mut() += 1;
        Ok(self.json.clone())
    }

    fn activity_file(&self, _id: &str) -> Result<Vec<u8>, FfiCallOutcome> {
        *self.file_reads.borrow_mut() += 1;
        Ok(self.held.borrow().clone())
    }

    fn garmin_original(&self, _garmin_id: i64) -> Result<Vec<u8>, String> {
        self.original.clone()
    }

    fn replace(&self, id: &str, path: &Path, _name: &str, keep: bool) -> FfiCallOutcome {
        self.kept_when_sent
            .borrow_mut()
            .push(self.kept_path(id).is_file());
        let bytes = std::fs::read(path).expect("the staged file exists when sent");
        self.sent.borrow_mut().push((bytes.clone(), keep));
        let answer = self.answer.borrow().clone();
        if answer.kind == FfiCallKind::Ok && !self.drops && answer.id.is_some() {
            *self.held.borrow_mut() = bytes;
        }
        answer
    }

    fn swap_dir(&self) -> Option<PathBuf> {
        Some(self.dir.path().to_path_buf())
    }
}

fn full() -> Vec<u8> {
    outdoor_ride().to_fit()
}

fn thin() -> Vec<u8> {
    indoor_ride().to_fit()
}

#[test]
fn a_swap_keeps_the_earlier_file_before_sending_and_reads_the_result_back() {
    let link = Fake::new(full(), thin());

    let result = replace(&link, "i500");

    assert_eq!(result.outcome, FfiSwapOutcome::Replaced, "{result:?}");
    assert_eq!(*link.sent.borrow(), vec![(full(), false)]);
    assert_eq!(*link.kept_when_sent.borrow(), vec![true]);
    assert_eq!(std::fs::read(link.kept_path("i500")).unwrap(), thin());
    assert_eq!(*link.held.borrow(), full());
}

#[test]
fn edited_intervals_are_kept_only_when_the_athlete_edited_them() {
    let mut link = Fake::new(full(), thin());
    link.json = import_json(true, "a");

    replace(&link, "i500");

    assert!(link.sent.borrow()[0].1);
}

#[test]
fn an_identical_file_sends_nothing() {
    let link = Fake::new(full(), full());

    let result = replace(&link, "i500");

    assert_eq!(result.outcome, FfiSwapOutcome::Unchanged);
    assert!(link.sent.borrow().is_empty());
    assert!(!link.kept_path("i500").exists());
}

#[test]
fn an_activity_that_is_not_a_garmin_import_is_never_written_to() {
    for json in [
        // Another source, even with a numeric external id.
        serde_json::json!({"source": "STRAVA", "external_id": "123"}),
        // A Garmin original this app uploaded under its prefixed id.
        serde_json::json!({"source": "OAUTH_CLIENT", "external_id": "garmin:123"}),
        // No external id: a match by time and length is never enough.
        serde_json::json!({"source": "GARMIN_CONNECT"}),
        // Not digits.
        serde_json::json!({"source": "GARMIN_CONNECT", "external_id": "12a"}),
        // No source.
        serde_json::json!({"external_id": "123"}),
    ] {
        let mut link = Fake::new(full(), thin());
        link.json = json.to_string();

        assert_eq!(replace(&link, "i500").outcome, FfiSwapOutcome::NotEligible);
        assert!(link.sent.borrow().is_empty(), "{json}");
    }
}

#[test]
fn a_refusal_changes_nothing_and_leaves_nothing_to_undo() {
    let link = Fake::new(full(), thin());
    *link.answer.borrow_mut() = http(422);

    let result = replace(&link, "i500");

    assert_eq!(result.outcome, FfiSwapOutcome::Refused);
    assert_eq!(*link.held.borrow(), thin());
    assert!(!link.kept_path("i500").exists());
    assert_eq!(state(&link, "refused"), FfiSwapState::Available);
}

#[test]
fn a_refused_grant_is_reported_as_permission() {
    let link = Fake::new(full(), thin());
    *link.answer.borrow_mut() = http(403);

    assert_eq!(
        replace(&link, "i500").outcome,
        FfiSwapOutcome::PermissionBlocked
    );
    assert!(!link.kept_path("i500").exists());
}

#[test]
fn a_refused_grant_raises_the_permission_announcement_and_an_expired_credential_does_not() {
    use crate::objects::observer::{recorder::Recorder, set_observer};
    let _serial = crate::test_globals::serial_global_state();
    let recorder = Recorder::new();
    set_observer(Some(recorder.clone()));

    let expired = Fake::new(full(), thin());
    *expired.answer.borrow_mut() = http(401);
    assert_eq!(
        replace(&expired, "i500").outcome,
        FfiSwapOutcome::AuthExpired
    );
    assert!(
        !recorder
            .events()
            .contains(&"upload_permission_refused".into())
    );

    let blocked = Fake::new(full(), thin());
    *blocked.answer.borrow_mut() = http(403);
    replace(&blocked, "i500");
    let events = recorder.events();
    set_observer(None);
    assert_eq!(
        events
            .iter()
            .filter(|e| *e == "upload_permission_refused")
            .count(),
        1,
        "{events:?}"
    );
    assert_eq!(*blocked.held.borrow(), thin());
}

#[test]
fn an_unchanged_answer_is_reported_unchanged_and_keeps_no_earlier_file() {
    let link = Fake::new(full(), thin());
    *link.answer.borrow_mut() = ok(None);

    let result = replace(&link, "i500");

    assert_eq!(result.outcome, FfiSwapOutcome::Unchanged);
    assert!(!link.kept_path("i500").exists());
}

#[test]
fn a_read_back_that_differs_is_reported_and_undo_stays_offered() {
    let mut link = Fake::new(full(), thin());
    link.drops = true;

    let result = replace(&link, "i500");

    assert_eq!(result.outcome, FfiSwapOutcome::Mismatch);
    assert_eq!(state(&link, "i500"), FfiSwapState::Undoable);
}

#[test]
fn a_request_that_failed_in_transport_is_checked_before_it_is_called_failed() {
    let link = Fake::new(full(), thin());
    *link.answer.borrow_mut() = FfiCallOutcome {
        kind: FfiCallKind::Network,
        id: None,
        status: None,
        detail: None,
        message: "connection reset".into(),
    };
    let result = replace(&link, "i500");
    assert_eq!(result.outcome, FfiSwapOutcome::Failed);
    assert!(!link.kept_path("i500").exists());
}

#[test]
fn undo_puts_the_earlier_file_back_byte_for_byte_and_forgets_it() {
    let link = Fake::new(full(), thin());
    replace(&link, "i500");
    assert_eq!(*link.held.borrow(), full());

    let result = undo(&link, "i500");

    assert_eq!(result.outcome, FfiSwapOutcome::Restored, "{result:?}");
    assert_eq!(*link.held.borrow(), thin());
    assert!(!link.kept_path("i500").exists());
    assert_eq!(link.sent.borrow().len(), 2);
}

#[test]
fn undo_with_nothing_kept_sends_nothing() {
    let link = Fake::new(full(), thin());

    assert_eq!(undo(&link, "i500").outcome, FfiSwapOutcome::Unchanged);
    assert!(link.sent.borrow().is_empty());
}

#[test]
fn a_failed_undo_keeps_the_earlier_file() {
    let link = Fake::new(full(), thin());
    replace(&link, "i500");
    *link.answer.borrow_mut() = http(500);

    assert_eq!(undo(&link, "i500").outcome, FfiSwapOutcome::Failed);
    assert!(link.kept_path("i500").is_file());
}

#[test]
fn garmin_being_unreachable_sends_nothing() {
    let mut link = Fake::new(full(), thin());
    link.original = Err("Garmin refused the key".into());

    assert_eq!(
        replace(&link, "i500").outcome,
        FfiSwapOutcome::GarminUnavailable
    );
    assert!(link.sent.borrow().is_empty());
}

#[test]
fn the_offer_shows_only_with_a_key_and_a_file_holding_more() {
    let link = Fake::new(full(), thin());
    assert_eq!(state(&link, "offer-more"), FfiSwapState::Available);

    let mut no_key = Fake::new(full(), thin());
    no_key.key = false;
    assert_eq!(state(&no_key, "offer-nokey"), FfiSwapState::Hidden);

    let same = Fake::new(full(), full());
    assert_eq!(state(&same, "offer-same"), FfiSwapState::Hidden);

    let mut other = Fake::new(full(), thin());
    other.json = serde_json::json!({"source": "STRAVA", "external_id": "9"}).to_string();
    assert_eq!(state(&other, "offer-other"), FfiSwapState::Hidden);
}

#[test]
fn the_comparison_is_made_once_until_the_activity_is_analysed_again() {
    let link = Fake::new(full(), thin());

    state(&link, "offer-cached");
    state(&link, "offer-cached");
    assert_eq!(*link.file_reads.borrow(), 1);

    let mut later = Fake::new(full(), thin());
    later.json = import_json(false, "2026-10-26T09:00:00");
    state(&later, "offer-cached");
    assert_eq!(*later.file_reads.borrow(), 1);
}

#[test]
fn an_activity_with_no_file_on_intervals_icu_is_neither_offered_nor_written() {
    let link = Fake::new(full(), Vec::new());

    assert_eq!(state(&link, "offer-empty"), FfiSwapState::Hidden);
    assert_eq!(replace(&link, "i500").outcome, FfiSwapOutcome::Failed);
    assert!(link.sent.borrow().is_empty());
}
