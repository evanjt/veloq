//! The resume ladder that spaces one backfill pass from the next.
//!
//! Scenario: a pass ends partial because the connection went away. Nothing
//! outside the engine schedules the retry any more, so the ladder decides when
//! the next pass is attempted, and it has to climb, cap, and stop for good once
//! the library has been fully asked.
//!
//! The loop is driven with its sleep, its queue read, its connectivity read and
//! its attempt handed in, so the schedule is exercised without waiting on it.

use std::cell::{Cell, RefCell};
use std::time::Duration;
use veloqrs::net::elevation_backfill::{RESUME_WAITS, resume_ladder, resume_wait};

/// A run of the ladder, stopped after `rungs` sleeps.
struct Run {
    slept: Vec<Duration>,
    attempts: usize,
}

fn climb(rungs: usize, remaining: impl Fn(usize) -> Option<u64>, offline: bool) -> Run {
    climb_paused(rungs, remaining, offline, |_| false)
}

/// The same climb with the pause read handed in, per rung.
fn climb_paused(
    rungs: usize,
    remaining: impl Fn(usize) -> Option<u64>,
    offline: bool,
    paused: impl Fn(usize) -> bool,
) -> Run {
    climb_with(rungs, remaining, offline, paused, |_| false)
}

/// The same climb with the engine read handed in too, per rung.
fn climb_with(
    rungs: usize,
    remaining: impl Fn(usize) -> Option<u64>,
    offline: bool,
    paused: impl Fn(usize) -> bool,
    engine_gone: impl Fn(usize) -> bool,
) -> Run {
    let slept = RefCell::new(Vec::new());
    let round = Cell::new(0usize);
    let attempts = Cell::new(0usize);
    resume_ladder(
        |d| {
            round.set(round.get() + 1);
            if round.get() > rungs {
                return false;
            }
            slept.borrow_mut().push(d);
            true
        },
        || remaining(round.get()),
        || offline,
        || paused(round.get()),
        || engine_gone(round.get()),
        || {
            attempts.set(attempts.get() + 1);
        },
    );
    Run {
        slept: slept.into_inner(),
        attempts: attempts.get(),
    }
}

#[test]
fn the_ladder_climbs_and_then_rests() {
    let run = climb(8, |_| Some(5), false);
    assert_eq!(run.slept[..RESUME_WAITS.len()], RESUME_WAITS[..]);
    for wait in &run.slept[RESUME_WAITS.len()..] {
        assert_eq!(*wait, RESUME_WAITS[RESUME_WAITS.len() - 1]);
    }
}

#[test]
fn a_rung_is_never_shorter_than_the_one_before_it() {
    let run = climb(6, |_| Some(5), false);
    for pair in run.slept.windows(2) {
        assert!(pair[1] >= pair[0], "{:?} followed {:?}", pair[1], pair[0]);
    }
}

#[test]
fn an_empty_queue_ends_the_ladder() {
    let run = climb(6, |round| if round >= 2 { Some(0) } else { Some(5) }, false);
    // The second rung read zero and stopped before attempting, so the ladder
    // ended two rungs in rather than climbing to the six it was allowed.
    assert_eq!(run.slept.len(), 2);
    assert_eq!(run.attempts, 1);
}

#[test]
fn a_completed_ladder_leaves_the_next_one_at_the_bottom() {
    let first = climb(3, |_| Some(5), false);
    let second = climb(3, |_| Some(5), false);
    assert_eq!(first.slept, second.slept);
    assert_eq!(second.slept[0], RESUME_WAITS[0]);
}

#[test]
fn an_offline_rung_costs_no_attempt_and_still_climbs() {
    let run = climb(3, |_| Some(5), true);
    assert_eq!(run.attempts, 0);
    assert_eq!(run.slept, RESUME_WAITS[..3].to_vec());
}

#[test]
fn a_queue_that_cannot_be_read_is_not_an_empty_one() {
    let run = climb(2, |_| None, false);
    assert_eq!(run.attempts, 2);
}

#[test]
fn the_wait_for_a_rung_is_the_ladder_capped_at_its_last() {
    for (i, expected) in RESUME_WAITS.iter().enumerate() {
        assert_eq!(resume_wait(i), *expected);
    }
    assert_eq!(resume_wait(99), RESUME_WAITS[RESUME_WAITS.len() - 1]);
}

/// A paused install used to climb this ladder for ever, calling a `start_pass`
/// that declined on the pause every half hour. Resuming lays a new ladder, so
/// ending the climb loses nothing.
#[test]
fn a_pause_ends_the_climb_rather_than_attempting_for_ever() {
    let run = climb_paused(8, |_| Some(5), false, |round| round >= 3);
    assert_eq!(run.slept.len(), 3, "the rung that read paused is the last");
    assert_eq!(run.attempts, 2, "and it attempts nothing");
}

#[test]
fn an_install_that_is_never_paused_climbs_as_before() {
    let run = climb_paused(4, |_| Some(5), false, |_| false);
    assert_eq!(run.attempts, 4);
}

/// Scenario: the ladder is the one background loop in the crate with no
/// external cancel, which is deliberate and was never written down as such.
/// Every other terminal condition is tested above; this is the statement of
/// what is deliberately absent.
///
/// Expected behaviour: nothing the ladder counts ends it. Not the number of
/// rungs, not sitting at the capped wait, not a queue it can never read. Only
/// the queue emptying, a pause, and the sleep refusing to wait, which is the
/// test harness and never production.
#[test]
fn nothing_the_ladder_counts_ends_it_on_its_own() {
    // Well past the last rung, so the cap is being sat on rather than climbed.
    let long = climb(RESUME_WAITS.len() + 40, |_| Some(5), false);
    assert_eq!(
        long.attempts,
        RESUME_WAITS.len() + 40,
        "every rung past the cap still attempts"
    );

    // A queue that cannot be read is still asked. It is not an empty one, and a
    // read that failed for a moment must not kill a ladder still owed work.
    let unreadable = climb(20, |_| None, false);
    assert_eq!(
        unreadable.attempts, 20,
        "an unreadable queue is still asked"
    );
    assert_eq!(unreadable.slept.len(), 20);

    // Offline for the whole climb is the same: no attempt, no end.
    let away = climb(20, |_| Some(5), true);
    assert_eq!(away.attempts, 0);
    assert_eq!(away.slept.len(), 20);
}

/// Scenario: a restore or a clear destroys the engine under a climbing ladder.
/// The queue then answers `None` for ever, which is the same answer a read that
/// failed for a moment gives, so the ladder woke twice an hour for the life of
/// the process against a handle that was gone.
///
/// Expected behaviour: a destroyed engine ends the climb. It is asked
/// separately from the queue, because only that tells "the engine is gone" from
/// "the read failed", and the second must not end anything.
#[test]
fn a_destroyed_engine_ends_the_climb_and_a_failed_read_does_not() {
    let gone = climb_with(20, |_| None, false, |_| false, |round| round >= 3);
    assert_eq!(
        gone.attempts, 2,
        "the two rungs before the engine went, and none after"
    );
    assert_eq!(
        gone.slept.len(),
        3,
        "it stops on the rung that finds it gone"
    );

    let transient = climb_with(
        20,
        |round| if round % 2 == 0 { None } else { Some(5) },
        false,
        |_| false,
        |_| false,
    );
    assert_eq!(
        transient.attempts, 20,
        "a queue that reads intermittently is still owed every rung"
    );
}

/// The engine is asked every rung, not once at the start: it can go away at any
/// point in a climb that spans hours.
#[test]
fn the_engine_is_asked_on_every_rung() {
    let asked = Cell::new(0usize);
    let run = climb_with(
        6,
        |_| Some(5),
        false,
        |_| false,
        |_| {
            asked.set(asked.get() + 1);
            false
        },
    );
    assert_eq!(run.attempts, 6);
    assert_eq!(asked.get(), 6, "once per rung");
}
