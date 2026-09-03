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
        || {
            attempts.set(attempts.get() + 1);
            true
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
