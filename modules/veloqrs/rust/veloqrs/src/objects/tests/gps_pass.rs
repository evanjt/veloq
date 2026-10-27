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
    h.service.finish(PassEnd::NetworkLost);
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
    h.service.finish(PassEnd::Settled);

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

    h.service.finish(PassEnd::Settled);

    // Two asks are one owed pass, over the span both of them covered.
    assert_eq!(
        h.started(),
        vec![
            range("2024-01-01", "2024-03-31"),
            range("2023-06-01", "2024-03-31")
        ]
    );

    h.service.finish(PassEnd::Settled);
    assert_eq!(h.started().len(), 2, "the owed pass is paid once");
}

#[test]
fn a_reconnect_during_a_running_pass_waits_for_it_to_end() {
    let h = harness(FfiStartOutcome::Started);
    h.service.request(range("2024-01-01", "2024-03-31"));
    h.service.finish(PassEnd::NetworkLost);
    h.service.request(range("2024-02-01", "2024-03-31"));

    h.service.reconnected();
    assert_eq!(
        h.started().len(),
        2,
        "the slot is held, so the edge only owes it"
    );

    h.service.finish(PassEnd::Settled);
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

    h.service.finish(PassEnd::Settled);
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

    h.service.finish(PassEnd::Settled);
    assert_eq!(h.service.running_run(), None);
}

#[test]
fn a_pass_the_engine_starts_itself_names_its_own_run() {
    let h = harness(FfiStartOutcome::Started);
    h.service.request(range("2024-01-01", "2024-03-31"));
    h.service.request(range("2024-01-01", "2024-03-31"));

    h.service.finish(PassEnd::Settled);

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
                service.finish(PassEnd::Settled);
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

    service.finish(PassEnd::Settled);
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

/// The instants a test service was asked to wake at, in order.
type Wakes = Arc<Mutex<Vec<chrono::DateTime<chrono::Utc>>>>;

/// [`harness`] with its wake requests recorded.
fn waking_harness() -> (Harness, Wakes) {
    let wakes: Wakes = Arc::new(Mutex::new(Vec::new()));
    let record = Arc::clone(&wakes);
    let mut h = harness(FfiStartOutcome::Started);
    h.service = h
        .service
        .with_wake(move |at| record.lock().unwrap().push(at));
    (h, wakes)
}

fn instant(s: &str) -> chrono::DateTime<chrono::Utc> {
    s.parse().expect("instant")
}

/// Scenario: an athlete widens the range to two years back, and the request
/// budget holds the tracks back after the first hundred.
///
/// Expected behaviour: the pass is owed to the budget, the engine asks to be
/// woken when the hold lifts, and the same range starts again then, with no
/// second ask from a screen.
#[test]
fn a_pass_the_budget_held_back_starts_again_when_the_hold_lifts() {
    let (h, wakes) = waking_harness();
    let asked = range("2024-10-27", "2026-10-27");
    let lifts = instant("2026-10-27T05:15:00Z");

    h.service.request(asked.clone());
    h.service.finish(PassEnd::HeldUntil(lifts));

    assert_eq!(*wakes.lock().unwrap(), vec![lifts]);
    assert_eq!(h.started().len(), 1, "nothing starts before the hold lifts");
    assert_eq!(h.service.held_until(), Some(lifts));

    h.service.reconnected();
    assert_eq!(h.started().len(), 1, "the online edge is not the budget's");

    h.service.budget_lifted();

    assert_eq!(h.started(), vec![asked.clone(), asked]);
    assert_eq!(h.service.held_until(), None);
}

#[test]
fn a_budget_lift_with_nothing_held_starts_nothing() {
    let (h, _) = waking_harness();
    h.service.request(range("2024-01-01", "2024-03-31"));
    h.service.finish(PassEnd::Settled);

    h.service.budget_lifted();

    assert_eq!(h.started().len(), 1);
}

/// Scenario: the athlete widens the range again while the first pass is
/// downloading, and the budget then holds that pass back.
///
/// Expected behaviour: the pass owed behind it waits for the lift rather than
/// starting into the hold, and the lift starts one pass over both spans.
#[test]
fn a_pass_owed_behind_one_the_budget_holds_waits_for_the_lift() {
    let (h, _) = waking_harness();
    h.service.request(range("2024-10-27", "2026-10-27"));
    let behind = h.service.request(range("2023-01-01", "2026-10-27"));
    assert_eq!(behind.outcome, FfiStartOutcome::Busy);

    h.service
        .finish(PassEnd::HeldUntil(instant("2026-10-27T05:15:00Z")));
    assert_eq!(h.started().len(), 1, "nothing starts into the hold");

    h.service.budget_lifted();
    assert_eq!(h.started().len(), 2);
    assert_eq!(h.started().last(), Some(&range("2023-01-01", "2026-10-27")));
}

/// Scenario: the budget holds two passes back in a row, the second until later.
///
/// Expected behaviour: the hold reported is the later one, which is the wait in
/// force, and each asks for its own wake.
#[test]
fn a_second_hold_moves_the_wait_to_its_own_lift() {
    let (h, wakes) = waking_harness();
    let first = instant("2026-10-27T05:15:00Z");
    let second = instant("2026-10-27T05:30:00Z");
    h.service.request(range("2024-10-27", "2026-10-27"));
    h.service.finish(PassEnd::HeldUntil(first));
    h.service.budget_lifted();
    h.service.finish(PassEnd::HeldUntil(second));

    assert_eq!(*wakes.lock().unwrap(), vec![first, second]);
    assert_eq!(h.service.held_until(), Some(second));
}

/// Scenario: a pass is held by the budget, and a stored page announces itself
/// before the hold lifts, which asks for a pass again.
///
/// Expected behaviour: the ask is held with the pass, starting nothing that
/// would only be deferred, and the lift starts one pass over both spans.
#[test]
fn a_pass_asked_while_one_is_held_is_held_with_it() {
    let (h, _) = waking_harness();
    h.service.request(range("2024-10-27", "2026-10-27"));
    h.service
        .finish(PassEnd::HeldUntil(instant("2026-10-27T05:15:00Z")));

    let asked = h.service.request(range("2023-01-01", "2026-10-27"));

    assert_eq!(asked.outcome, FfiStartOutcome::Held);
    assert_eq!(h.started().len(), 1);

    h.service.budget_lifted();
    assert_eq!(h.started().last(), Some(&range("2023-01-01", "2026-10-27")));
    assert_eq!(h.started().len(), 2);
}
