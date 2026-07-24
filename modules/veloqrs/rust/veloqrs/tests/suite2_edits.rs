//! Suite #2 — user-edit survival.
//!
//! The believability core: what the user does to a section must be honoured
//! across later resyncs. Pins/accepts freeze; hides stay hidden; everything
//! else is free to auto-morph. These behaviours live in the persistence layer
//! and are method-agnostic, so they run on the fast Control arm.
//!
//! Snapshots read the user-visible DB view, so an accepted section shows up and
//! a disabled one drops out exactly as the app renders them.
//!
//! Run: `cargo test -p veloqrs --features synthetic --test suite2_edits -- --nocapture`

mod lifecycle_support;

use lifecycle_support::*;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};

fn corpus() -> LifecycleCorpus {
    LifecycleCorpus::generate(&LifecycleConfig::default())
}

/// Target gate: accepting (pinning) a section must survive a later resync
/// without crashing, and stay user-defined. Fails today — the resync dies in
/// `apply_sections` with `UNIQUE constraint failed: sections.id`, because the
/// spared accepted section keeps its positional id (`sec_ride_0`) and fresh
/// detection assigns the SAME id to a different section, colliding on INSERT.
/// A pinned section can therefore break the next sync. Green when stable
/// identity (B2) stops ids colliding and/or persistence upserts (B4).
#[test]
#[ignore = "B2/B4 not built — accept+resync crashes on positional id collision (UNIQUE sections.id)"]
fn accept_survives_resync() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, _f) = busiest_section(&cold.snapshot).expect("cold detect produced a section");

    engine.accept_section(&id).expect("accept_section");
    let after = try_ingest_step(&mut engine, "resync", &refs(&corpus.bucket_d_delta))
        .expect("resync after accepting a section must not crash")
        .snapshot;

    let kept = after
        .sections
        .get(&id)
        .unwrap_or_else(|| panic!("accepted section {id} was wiped by resync"));
    assert!(
        kept.is_user_defined,
        "accepted section {id} survived but lost its user-defined flag"
    );
}

/// Measurement: hide a section, then resync with activities that re-travel its
/// corridor. Does the corridor re-emerge as a fresh visible section? Prints the
/// outcome; the gate below owns the assertion.
#[test]
fn disabled_corridor_reemerges_today() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, disabled_ground) =
        busiest_section(&cold.snapshot).expect("cold detect produced a section");

    engine.disable_section(&id).expect("disable_section");
    let after = ingest_step(&mut engine, "resync", &refs(&corpus.bucket_b_delta)).snapshot;

    let reemerged = after
        .sections
        .values()
        .any(|s| ground_matches(&disabled_ground, s));
    println!(
        "[control] hid section {id}: same-id visible after resync = {}, ground re-emerged under a new id = {}",
        after.sections.contains_key(&id),
        reemerged,
    );
}

/// Target gate (B4 intent records): a disabled corridor must NOT re-emerge on
/// resync. Fails today — a disabled-only section is still `is_user_defined = 0`,
/// so the re-detect wipe deletes it and detection re-creates the corridor as a
/// fresh visible section (violates invariant 6). Green when disabled sections
/// become honoured intent records whose corridor the emitter suppresses.
#[test]
#[ignore = "B4 intent records not built — target gate (disabled corridor re-emerges today)"]
fn disabled_corridor_stays_hidden() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Control);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a());
    let (id, disabled_ground) =
        busiest_section(&cold.snapshot).expect("cold detect produced a section");

    engine.disable_section(&id).expect("disable_section");
    let after = ingest_step(&mut engine, "resync", &refs(&corpus.bucket_b_delta)).snapshot;

    let reemerged = after
        .sections
        .values()
        .any(|s| ground_matches(&disabled_ground, s));
    assert!(
        !reemerged,
        "disabled corridor {id} re-emerged as a visible section after resync (invariant 6)"
    );
}
