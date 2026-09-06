//! Scenario: `cargo test` has no per-test timeout, so a test that never
//! returns reads as a slow suite and holds every full run to the job's own
//! limit.
//!
//! Expected behaviour: `within` fails the test past its bound with a message
//! naming the label and the bound, passes a body that returns in time, and
//! re-raises the body's own panic unchanged so an assertion inside it reads as
//! it always did.

#![cfg(feature = "synthetic")]

mod lifecycle_support;

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::thread;
use std::time::Duration;

use lifecycle_support::within;

fn panic_message(outcome: Result<(), Box<dyn std::any::Any + Send>>) -> String {
    let payload = outcome.expect_err("expected a panic");
    payload
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| payload.downcast_ref::<&str>().map(|s| s.to_string()))
        .unwrap_or_default()
}

#[test]
fn a_body_that_returns_in_time_passes() {
    within(Duration::from_secs(5), "quick", || {});
}

#[test]
fn a_body_that_overruns_fails_naming_the_label_and_the_bound() {
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        within(Duration::from_millis(50), "runaway", || {
            thread::sleep(Duration::from_secs(2));
        });
    }));

    let message = panic_message(outcome);
    assert!(message.contains("runaway"), "{message}");
    assert!(message.contains("50ms"), "{message}");
}

#[test]
fn the_bodys_own_panic_comes_through_unchanged() {
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        within(Duration::from_secs(5), "asserting", || {
            assert_eq!(1 + 1, 3, "the body's own assertion");
        });
    }));

    let message = panic_message(outcome);
    assert!(message.contains("the body's own assertion"), "{message}");
    assert!(!message.contains("still running"), "{message}");
}
