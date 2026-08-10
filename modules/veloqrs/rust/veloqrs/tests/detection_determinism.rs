//! Two devices holding the same activities must draw the same sections.
//!
//! `HashMap` iteration order is randomised per process, so a repeated call
//! inside one process sees one fixed order and agrees with itself no matter how
//! order-dependent the detector is. The comparison only means something across a
//! process boundary, so this suite re-executes its own binary and compares what
//! the children produce.
//!
//! The signature carries a coordinate digest, so geometry that moves while the
//! counts hold still fails here.
//!
//! Run: `cargo test -p veloqrs --features synthetic --test detection_determinism`

mod lifecycle_support;

use std::collections::BTreeMap;
use std::process::Command;

use lifecycle_support::*;
use sha2::{Digest, Sha256};
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};

/// Children print this prefix and the parent reads it back. A child that dies
/// before printing leaves no line, which the parent treats as a failure rather
/// than as agreement.
const MARKER: &str = "CATALOGUE-DIGEST ";
const CHILD_ENV: &str = "VELOQ_DETERMINISM_CHILD";

/// Both arms are gated. `Control` is the shipped default and is scheduled for
/// replacement rather than repair, so its result says what users get today.
/// `Battery` is `Unified`, the arm that has to be deterministic before it
/// becomes the default.
const WORKER_CONTROL: &str = "a_cold_detect_fills_the_catalogue_on_the_control_arm";
const WORKER_BATTERY: &str = "a_cold_detect_fills_the_catalogue_on_the_battery_arm";

/// Separate processes get separate `RandomState` seeds. Four is enough that an
/// order-dependent detector disagrees with near-certainty while the suite stays
/// inside its normal runtime.
const CHILDREN: usize = 4;

fn digest(text: &str) -> String {
    let mut h = Sha256::new();
    h.update(text.as_bytes());
    h.finalize()
        .iter()
        .take(8)
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn cold_catalogue_signature(arm: Arm) -> String {
    let corpus = LifecycleCorpus::generate(&LifecycleConfig::default());
    let (mut engine, _dir) = fresh_engine_for(arm);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    cold.snapshot.catalogue_signature()
}

/// Doubles as the worker the parent re-executes and as a gate in its own right:
/// an empty catalogue would make every cross-process comparison below agree on
/// nothing.
fn run_worker(arm: Arm) {
    let signature = cold_catalogue_signature(arm);

    assert!(
        !signature.is_empty(),
        "cold detect on the {} arm produced no sections, so the determinism \
         comparison would hold two empty strings against each other and pass",
        arm.label()
    );

    if std::env::var(CHILD_ENV).is_ok() {
        println!("{MARKER}{}", digest(&signature));
    }
}

#[test]
fn a_cold_detect_fills_the_catalogue_on_the_control_arm() {
    run_worker(Arm::Control);
}

#[test]
fn a_cold_detect_fills_the_catalogue_on_the_battery_arm() {
    run_worker(Arm::Battery);
}

fn child_digest(exe: &std::path::Path, worker: &str, index: usize) -> String {
    let out = Command::new(exe)
        .args(["--exact", worker, "--nocapture"])
        .env(CHILD_ENV, "1")
        .output()
        .unwrap_or_else(|e| panic!("child {index}: could not re-execute {}: {e}", exe.display()));

    assert!(
        out.status.success(),
        "child {index} failed before it could report a catalogue.\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );

    let stdout = String::from_utf8_lossy(&out.stdout);
    stdout
        .lines()
        .find_map(|l| l.strip_prefix(MARKER))
        .unwrap_or_else(|| {
            panic!(
                "child {index} printed no {MARKER} line. Without it the parent has \
                 nothing to compare and must not pass.\nstdout:\n{stdout}"
            )
        })
        .trim()
        .to_string()
}

fn assert_every_process_agrees(arm: Arm, worker: &str) {
    let exe = std::env::current_exe().expect("path to this test binary");

    let mut by_digest: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for i in 0..CHILDREN {
        by_digest
            .entry(child_digest(&exe, worker, i))
            .or_default()
            .push(i);
    }

    assert_eq!(
        by_digest.len(),
        1,
        "{} processes detected {} different catalogues from identical input on \
         the {} arm: {:?}\n\n\
         The corpus is seeded from a fixed value, so every process saw the same \
         activities. A split here means detection reads an order that varies per \
         process, which on a phone means two devices holding the same history draw \
         different sections.",
        CHILDREN,
        by_digest.len(),
        arm.label(),
        by_digest
    );
}

/// The shipped default. Scheduled for replacement rather than repair, so a red
/// here measures what users get today.
#[test]
fn the_control_arm_lands_on_the_same_catalogue_in_every_process() {
    assert_every_process_agrees(Arm::Control, WORKER_CONTROL);
}

/// The arm that has to be deterministic before it can become the default.
#[test]
fn the_battery_arm_lands_on_the_same_catalogue_in_every_process() {
    assert_every_process_agrees(Arm::Battery, WORKER_BATTERY);
}
