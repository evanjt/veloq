//! Scenario: the GPS track pass downloads every track the census still owes.
//! It can fail because the connection dropped, and it can be asked for again
//! while one is already downloading, when the settle announces the rows the
//! head window brought.
//!
//! Expected behaviour: the engine keeps either pass owed and starts it itself,
//! the first on the online edge and the second once the running pass ends,
//! with no second ask from the caller.

use super::*;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{OnceLock, Weak};

/// The ranges a test service was asked to start, in order.
type Started = Arc<Mutex<Vec<PassRange>>>;

struct Harness {
    service: GpsPassService,
    started: Started,
    offline: Arc<AtomicBool>,
}

impl Harness {
    fn started(&self) -> Vec<PassRange> {
        self.started.lock().unwrap().clone()
    }
}

/// A service whose passes are recorded rather than downloaded, each answering
/// `answer` and holding the slot until the test finishes it.
fn harness(answer: FfiStartOutcome) -> Harness {
    let started: Started = Arc::new(Mutex::new(Vec::new()));
    let record = Arc::clone(&started);
    let offline = Arc::new(AtomicBool::new(false));
    let reads_offline = Arc::clone(&offline);
    // Each start is its own fetch run, numbered from one.
    let runs = AtomicU64::new(0);
    let service = GpsPassService::new(
        move |range: &PassRange| {
            record.lock().unwrap().push(range.clone());
            PassStart {
                outcome: answer,
                run: runs.fetch_add(1, Ordering::SeqCst) + 1,
                total: 1,
            }
        },
        move || reads_offline.load(Ordering::SeqCst),
    );
    Harness {
        service,
        started,
        offline,
    }
}

fn range(oldest: &str, newest: &str) -> PassRange {
    PassRange {
        oldest: oldest.into(),
        newest: newest.into(),
        head: Vec::new(),
    }
}

#[test]
fn a_pass_that_failed_on_the_network_starts_again_when_the_connection_returns() {
    let h = harness(FfiStartOutcome::Started);
    let asked = range("2024-01-01", "2024-03-31");

    assert_eq!(
        h.service.request(asked.clone()).outcome,
        FfiStartOutcome::Started
    );
    h.service.finish(true);
    assert_eq!(
        h.started().len(),
        1,
        "a lost network does not retry at once"
    );

    h.service.reconnected();

    assert_eq!(h.started(), vec![asked.clone(), asked]);
}

#[test]
fn a_pass_that_ended_cleanly_is_not_started_on_the_online_edge() {
    let h = harness(FfiStartOutcome::Started);
    h.service.request(range("2024-01-01", "2024-03-31"));
    h.service.finish(false);

    h.service.reconnected();

    assert_eq!(h.started().len(), 1);
}

#[test]
fn a_pass_asked_while_one_runs_starts_once_when_it_ends() {
    let h = harness(FfiStartOutcome::Started);
    h.service.request(range("2024-01-01", "2024-03-31"));

    let refused = h.service.request(range("2024-01-01", "2024-03-31"));
    let again = h.service.request(range("2023-06-01", "2024-02-01"));
    assert_eq!(refused.outcome, FfiStartOutcome::Busy);
    assert_eq!(again.outcome, FfiStartOutcome::Busy);
    assert_eq!(h.started().len(), 1, "nothing starts while the pass runs");

    h.service.finish(false);

    // Two asks are one owed pass, over the span both of them covered.
    assert_eq!(
        h.started(),
        vec![
            range("2024-01-01", "2024-03-31"),
            range("2023-06-01", "2024-03-31")
        ]
    );

    h.service.finish(false);
    assert_eq!(h.started().len(), 2, "the owed pass is paid once");
}

#[test]
fn a_reconnect_during_a_running_pass_waits_for_it_to_end() {
    let h = harness(FfiStartOutcome::Started);
    h.service.request(range("2024-01-01", "2024-03-31"));
    h.service.finish(true);
    h.service.request(range("2024-02-01", "2024-03-31"));

    h.service.reconnected();
    assert_eq!(
        h.started().len(),
        2,
        "the slot is held, so the edge only owes it"
    );

    h.service.finish(false);
    assert_eq!(h.started().len(), 3);
}

#[test]
fn a_pass_asked_offline_is_owed_to_the_connection() {
    let h = harness(FfiStartOutcome::Started);
    h.offline.store(true, Ordering::SeqCst);

    let asked = h.service.request(range("2024-01-01", "2024-03-31"));
    assert_eq!(asked.outcome, FfiStartOutcome::Offline);
    assert!(h.started().is_empty());

    h.offline.store(false, Ordering::SeqCst);
    h.service.reconnected();

    assert_eq!(h.started(), vec![range("2024-01-01", "2024-03-31")]);
}

#[test]
fn an_owed_pass_that_comes_due_offline_waits_for_the_connection() {
    let h = harness(FfiStartOutcome::Started);
    h.service.request(range("2024-01-01", "2024-03-31"));
    h.service.request(range("2024-01-01", "2024-03-31"));
    h.offline.store(true, Ordering::SeqCst);

    h.service.finish(false);
    assert_eq!(h.started().len(), 1);

    h.offline.store(false, Ordering::SeqCst);
    h.service.reconnected();
    assert_eq!(h.started().len(), 2);
}

#[test]
fn a_pass_that_does_not_start_frees_the_slot() {
    let h = harness(FfiStartOutcome::NotOwed);

    assert_eq!(
        h.service.request(range("2024-01-01", "2024-03-31")).outcome,
        FfiStartOutcome::NotOwed
    );
    assert_eq!(
        h.service.request(range("2024-01-01", "2024-03-31")).outcome,
        FfiStartOutcome::NotOwed,
        "a refusal holds nothing, so the next ask is answered rather than owed"
    );
    assert_eq!(h.started().len(), 2);
}

#[test]
fn the_running_pass_names_its_run_until_it_ends() {
    let h = harness(FfiStartOutcome::Started);
    assert_eq!(h.service.running_run(), None);

    h.service.request(range("2024-01-01", "2024-03-31"));
    assert_eq!(h.service.running_run(), Some(1));

    h.service.finish(false);
    assert_eq!(h.service.running_run(), None);
}

#[test]
fn a_pass_the_engine_starts_itself_names_its_own_run() {
    let h = harness(FfiStartOutcome::Started);
    h.service.request(range("2024-01-01", "2024-03-31"));
    h.service.request(range("2024-01-01", "2024-03-31"));

    h.service.finish(false);

    assert_eq!(
        h.service.running_run(),
        Some(2),
        "the owed pass nobody on screen asked for is still the one reported"
    );
}

#[test]
fn a_pass_that_did_not_start_names_no_run() {
    let h = harness(FfiStartOutcome::NotOwed);
    h.service.request(range("2024-01-01", "2024-03-31"));
    assert_eq!(h.service.running_run(), None);
}

/// Scenario: a pass ends on its fetch thread before the start that spawned
/// it has returned, and the pass owed behind it starts in that gap.
///
/// Expected behaviour: the run reported is the owed pass's, which is the one
/// downloading, and not the run of the pass that has already ended.
#[test]
fn a_pass_that_ends_before_its_start_returns_does_not_name_its_run() {
    let service_slot: Arc<OnceLock<Weak<GpsPassService>>> = Arc::new(OnceLock::new());
    let reaches_service = Arc::clone(&service_slot);
    let calls = AtomicU64::new(0);
    let service = Arc::new(GpsPassService::new(
        move |_range: &PassRange| {
            let call = calls.fetch_add(1, Ordering::SeqCst) + 1;
            if call == 1
                && let Some(service) = reaches_service.get().and_then(Weak::upgrade)
            {
                service.request(range("2023-01-01", "2023-12-31"));
                service.finish(false);
            }
            PassStart {
                outcome: FfiStartOutcome::Started,
                run: call,
                total: 1,
            }
        },
        || false,
    ));
    service_slot.set(Arc::downgrade(&service)).ok();

    service.request(range("2024-01-01", "2024-03-31"));

    assert_eq!(service.running_run(), Some(2));

    service.finish(false);
    assert_eq!(service.running_run(), None);
}

#[test]
fn the_head_ids_come_first_in_their_own_order() {
    let ordered = head_first(
        vec!["a".into(), "b".into(), "c".into(), "d".into()],
        &["c".into(), "x".into(), "a".into()],
        |id: &String| id.as_str(),
    );
    assert_eq!(ordered, vec!["c", "a", "b", "d"]);
}
