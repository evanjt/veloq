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
    /// intervals.icu refuses the file, as it does for a stub it will not serve.
    file_refused: bool,
    kept_originals: RefCell<Vec<(i64, Vec<u8>)>>,
    keep_answer: Result<(), String>,
    rereads: RefCell<u32>,
    /// What the engine remembers of a check, by activity.
    remembered: RefCell<std::collections::HashMap<String, String>>,
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
            file_refused: false,
            kept_originals: RefCell::new(Vec::new()),
            keep_answer: Ok(()),
            rereads: RefCell::new(0),
            remembered: RefCell::new(Default::default()),
        }
    }

    fn stub(original: Vec<u8>) -> Self {
        let mut link = Self::new(original, Vec::new());
        link.json = stub_json(GARMIN_ID.to_string());
        link.file_refused = true;
        link
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

    fn stored_json(&self, _id: &str) -> Option<String> {
        Some(self.json.clone())
    }

    fn remembered(&self, id: &str) -> Option<String> {
        self.remembered.borrow().get(id).cloned()
    }

    fn remember(&self, id: &str, value: &str) {
        self.remembered
            .borrow_mut()
            .insert(id.to_string(), value.to_string());
    }

    fn activity_file(&self, _id: &str) -> Result<Vec<u8>, FfiCallOutcome> {
        *self.file_reads.borrow_mut() += 1;
        if self.file_refused {
            return Err(http(403));
        }
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

    fn keep_original(&self, garmin_id: i64, original: &[u8], _stub: &str) -> Result<(), String> {
        self.kept_originals
            .borrow_mut()
            .push((garmin_id, original.to_vec()));
        self.keep_answer.clone()
    }

    fn reread(&self, _id: &str) {
        *self.rereads.borrow_mut() += 1;
    }
}

fn stub_json(external_id: String) -> String {
    serde_json::json!({
        "id": "i500",
        "_note": "stub",
        "source": "GARMIN_CONNECT",
        "external_id": external_id,
    })
    .to_string()
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
    assert_eq!(state(&link, "refused"), FfiSwapState::Checkable);
}

#[test]
fn a_refused_grant_is_reported_as_permission() {
    let _serial = crate::test_globals::serial_global_state();
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
    assert_eq!(check(&link, "offer-more"), FfiSwapState::Available);

    let mut no_key = Fake::new(full(), thin());
    no_key.key = false;
    assert_eq!(state(&no_key, "offer-nokey"), FfiSwapState::Hidden);
    assert_eq!(check(&no_key, "offer-nokey"), FfiSwapState::Hidden);

    let same = Fake::new(full(), full());
    assert_eq!(check(&same, "offer-same"), FfiSwapState::Unchanged);

    let mut other = Fake::new(full(), thin());
    other.json = serde_json::json!({"source": "STRAVA", "external_id": "9"}).to_string();
    assert_eq!(state(&other, "offer-other"), FfiSwapState::Hidden);
}

#[test]
fn opening_a_served_import_asks_the_network_for_nothing_and_offers_the_check() {
    let link = Fake::new(full(), thin());

    assert_eq!(state(&link, "open"), FfiSwapState::Checkable);

    assert_eq!(*link.json_reads.borrow(), 0);
    assert_eq!(*link.file_reads.borrow(), 0);
}

#[test]
fn the_check_answers_available_when_garmin_holds_more_and_unchanged_when_identical() {
    let more = Fake::new(full(), thin());
    assert_eq!(check(&more, "more"), FfiSwapState::Available);

    let same = Fake::new(full(), full());
    assert_eq!(check(&same, "same"), FfiSwapState::Unchanged);
}

#[test]
fn a_check_that_could_not_be_made_stays_checkable_and_is_not_remembered() {
    let mut link = Fake::new(full(), thin());
    link.original = Err("garmin is down".into());

    assert_eq!(check(&link, "down"), FfiSwapState::Checkable);
    assert_eq!(state(&link, "down"), FfiSwapState::Checkable);
    assert!(link.remembered.borrow().is_empty());
}

#[test]
fn a_check_is_remembered_and_read_back_without_a_request() {
    let link = Fake::new(full(), thin());
    check(&link, "kept");
    let files = *link.file_reads.borrow();
    let jsons = *link.json_reads.borrow();

    assert_eq!(state(&link, "kept"), FfiSwapState::Available);
    assert_eq!(state(&link, "kept"), FfiSwapState::Available);

    assert_eq!(*link.file_reads.borrow(), files);
    assert_eq!(*link.json_reads.borrow(), jsons);

    let same = Fake::new(full(), full());
    check(&same, "kept-same");
    assert_eq!(state(&same, "kept-same"), FfiSwapState::Unchanged);
}

#[test]
fn a_new_analysed_time_clears_the_remembered_check() {
    let mut link = Fake::new(full(), thin());
    check(&link, "later");
    assert_eq!(state(&link, "later"), FfiSwapState::Available);

    link.json = import_json(false, "2026-10-26T09:00:00");

    assert_eq!(state(&link, "later"), FfiSwapState::Checkable);
}

#[test]
fn a_swap_or_an_undo_clears_the_remembered_check() {
    let link = Fake::new(full(), thin());
    check(&link, "i500");
    replace(&link, "i500");
    assert_eq!(state(&link, "i500"), FfiSwapState::Undoable);

    undo(&link, "i500");
    assert_eq!(state(&link, "i500"), FfiSwapState::Checkable);
}

#[test]
fn a_check_never_writes_to_intervals_icu() {
    let link = Fake::new(full(), thin());
    check(&link, "ro");
    assert!(link.sent.borrow().is_empty());
}

#[test]
fn the_check_needs_a_garmin_import_with_a_file_to_compare() {
    let mut other = Fake::new(full(), thin());
    other.json = serde_json::json!({"source": "STRAVA", "external_id": "9"}).to_string();
    assert_eq!(check(&other, "other"), FfiSwapState::Hidden);

    let empty = Fake::new(full(), Vec::new());
    assert_eq!(check(&empty, "empty"), FfiSwapState::Checkable);
}

#[test]
fn an_activity_with_no_file_on_intervals_icu_is_neither_offered_nor_written() {
    let link = Fake::new(full(), Vec::new());

    assert_eq!(check(&link, "offer-empty"), FfiSwapState::Checkable);
    assert_eq!(replace(&link, "i500").outcome, FfiSwapOutcome::Failed);
    assert!(link.sent.borrow().is_empty());
}

#[test]
fn a_stub_with_a_garmin_id_is_offered_without_reading_either_file() {
    let link = Fake::stub(full());

    assert_eq!(state(&link, "stub-offer"), FfiSwapState::Available);
    assert_eq!(*link.file_reads.borrow(), 0);
    assert_eq!(*link.json_reads.borrow(), 0);
}

#[test]
fn a_stub_without_the_key_or_with_a_foreign_id_is_not_offered() {
    let mut keyless = Fake::stub(full());
    keyless.key = false;
    assert_eq!(state(&keyless, "stub-keyless"), FfiSwapState::Hidden);

    let mut foreign = Fake::stub(full());
    foreign.json = stub_json("garmin:18342901776".into());
    assert_eq!(state(&foreign, "stub-foreign"), FfiSwapState::Hidden);
    assert_eq!(
        replace(&foreign, "i500").outcome,
        FfiSwapOutcome::NotEligible
    );
    assert!(foreign.sent.borrow().is_empty());
}

#[test]
fn replacing_a_stub_posts_garmins_file_keeps_it_and_reads_the_activity_again() {
    let link = Fake::stub(full());

    let result = replace(&link, "i500");

    assert_eq!(result.outcome, FfiSwapOutcome::Replaced, "{result:?}");
    assert_eq!(*link.sent.borrow(), vec![(full(), false)]);
    assert_eq!(*link.kept_originals.borrow(), vec![(GARMIN_ID, full())]);
    assert_eq!(*link.rereads.borrow(), 1);
    assert!(
        !link.kept_path("i500").exists(),
        "a stub has no earlier file to restore"
    );
    assert_eq!(state(&link, "i500"), FfiSwapState::Available);
}

#[test]
fn a_stub_swap_keeps_the_athletes_edited_intervals() {
    let mut link = Fake::stub(full());
    link.json = serde_json::json!({
        "id": "i500",
        "_note": "stub",
        "source": "GARMIN_CONNECT",
        "external_id": GARMIN_ID.to_string(),
        "icu_intervals_edited": true,
    })
    .to_string();

    replace(&link, "i500");

    assert_eq!(*link.sent.borrow(), vec![(full(), true)]);
}

#[test]
fn a_stub_that_intervals_icu_refuses_to_replace_changes_nothing() {
    let link = Fake::stub(full());
    *link.answer.borrow_mut() = http(422);

    let result = replace(&link, "i500");

    assert_eq!(result.outcome, FfiSwapOutcome::Refused, "{result:?}");
    assert!(link.kept_originals.borrow().is_empty());
    assert_eq!(*link.rereads.borrow(), 0);
}

#[test]
fn a_stub_swap_stores_nothing_when_garmin_gives_nothing_or_an_unreadable_file() {
    let mut gone = Fake::stub(full());
    gone.original = Err("Garmin refused".into());
    assert_eq!(
        replace(&gone, "i500").outcome,
        FfiSwapOutcome::GarminUnavailable
    );
    assert!(gone.sent.borrow().is_empty());

    let junk = Fake::stub(b"not a fit file".to_vec());
    assert_eq!(replace(&junk, "i500").outcome, FfiSwapOutcome::Failed);
    assert!(junk.sent.borrow().is_empty());
}

#[test]
fn a_stub_swap_that_could_not_be_kept_on_the_phone_still_reports_the_post() {
    let mut link = Fake::stub(full());
    link.keep_answer = Err("no room".into());

    let result = replace(&link, "i500");

    assert_eq!(result.outcome, FfiSwapOutcome::Replaced);
    assert!(result.detail.is_some_and(|d| d.contains("no room")));
}

#[test]
fn a_stub_intervals_icu_serves_takes_the_served_path_with_an_undo() {
    let mut link = Fake::new(full(), thin());
    link.json = stub_json(GARMIN_ID.to_string());

    let result = replace(&link, "i500");

    assert_eq!(result.outcome, FfiSwapOutcome::Replaced, "{result:?}");
    assert_eq!(std::fs::read(link.kept_path("i500")).unwrap(), thin());
    assert_eq!(*link.held.borrow(), full());
}

#[test]
fn the_automatic_pass_swaps_a_stub_through_the_stub_path() {
    let link = Fake::stub(full());

    let result = crate::net::garmin_auto_swap::swap_import(&link, "i500");

    assert_eq!(result.outcome, FfiSwapOutcome::Replaced, "{result:?}");
    assert_eq!(*link.sent.borrow(), vec![(full(), false)]);
    assert_eq!(*link.kept_originals.borrow(), vec![(GARMIN_ID, full())]);
}

#[test]
fn the_automatic_pass_compares_and_keeps_an_earlier_file_for_a_served_ride() {
    let link = Fake::new(full(), thin());

    let result = crate::net::garmin_auto_swap::swap_import(&link, "i500");

    assert_eq!(result.outcome, FfiSwapOutcome::Replaced, "{result:?}");
    assert_eq!(std::fs::read(link.kept_path("i500")).unwrap(), thin());
    assert_eq!(*link.held.borrow(), full());
}

#[test]
fn an_import_of_any_sport_is_swapped_and_a_manual_activity_is_not() {
    for sport in ["Ride", "Run", "Swim", "WeightTraining"] {
        let mut link = Fake::new(full(), thin());
        link.json = serde_json::json!({
            "id": "i500",
            "type": sport,
            "source": "GARMIN_CONNECT",
            "external_id": GARMIN_ID.to_string(),
        })
        .to_string();
        assert_eq!(state(&link, "sport"), FfiSwapState::Checkable, "{sport}");
    }

    let mut manual = Fake::new(full(), thin());
    manual.json = serde_json::json!({
        "id": "i500",
        "type": "Ride",
        "source": "UPLOAD",
        "external_id": GARMIN_ID.to_string(),
    })
    .to_string();
    assert_eq!(
        replace(&manual, "i500").outcome,
        FfiSwapOutcome::NotEligible
    );
    assert!(manual.sent.borrow().is_empty());
}
