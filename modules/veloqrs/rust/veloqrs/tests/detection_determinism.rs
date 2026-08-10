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
const WORKER: &str = "a_cold_detect_fills_the_catalogue";

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

fn cold_catalogue_signature() -> String {
    let corpus = LifecycleCorpus::generate(&LifecycleConfig::default());
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    cold.snapshot.catalogue_signature()
}

/// The worker the parent re-executes, and a gate in its own right: an empty
/// catalogue would make every cross-process comparison below agree on nothing.
#[test]
fn a_cold_detect_fills_the_catalogue() {
    let signature = cold_catalogue_signature();

    assert!(
        !signature.is_empty(),
        "cold detect produced no sections, so the determinism comparison would \
         hold two empty strings against each other and pass"
    );

    if std::env::var(CHILD_ENV).is_ok() {
        println!("{MARKER}{}", digest(&signature));
    }
}

fn child_digest(exe: &std::path::Path, index: usize) -> String {
    let out = Command::new(exe)
        .args(["--exact", WORKER, "--nocapture"])
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

#[test]
fn detection_lands_on_the_same_catalogue_in_every_process() {
    let exe = std::env::current_exe().expect("path to this test binary");

    let mut by_digest: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for i in 0..CHILDREN {
        by_digest.entry(child_digest(&exe, i)).or_default().push(i);
    }

    assert_eq!(
        by_digest.len(),
        1,
        "{} processes detected {} different catalogues from identical input: {:?}\n\n\
         The corpus is seeded from a fixed value, so every process saw the same \
         activities. A split here means detection reads an order that varies per \
         process, which on a phone means two devices holding the same history draw \
         different sections.",
        CHILDREN,
        by_digest.len(),
        by_digest
    );
}
