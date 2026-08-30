//! Suite #2, `set_section_config` no-op stability (the launch-renumber guard).
//!
//! `set_section_config` resets the identity registry, because a genuine
//! config change invalidates the identity basis (the stable ids were assigned to
//! ground the old params found). But the TS init path re-sends the PERSISTED
//! config on every launch (GlobalDataSync applies the strictness preset whenever
//! `detectionStrictness != 60`), so an UNCHANGED config must be a no-op or every
//! section renumbers on each open for any user who has moved the slider, which
//! defeats stable identity at startup for exactly the engaged users. The guard
//! is a top-of-function early-return when `config == self.section_config`,
//! gating the whole tail (settings persist, processed-set clear, dirty flag,
//! registry reset).
//!
//! These gates lock both halves: re-sending the active config leaves the
//! catalogue and its ids untouched across a later detect, while a genuine change
//! still re-analyses. Battery arm, since the launch re-apply targets Unified.
//!
//! Run: `cargo test -p veloqrs --features synthetic --test suite2_config_stability`

mod lifecycle_support;

use std::collections::BTreeSet;

use lifecycle_support::*;
use tempfile::TempDir;
use tracematch::scenarios::{LifecycleConfig, LifecycleCorpus};
use tracematch::sections::SectionConfig;
use veloqrs::PersistentEngine;

fn corpus() -> LifecycleCorpus {
    LifecycleCorpus::generate(&LifecycleConfig::default())
}

/// The engine's active config, so re-sending it compares equal and exercises
/// the no-op path.
fn unified_config() -> SectionConfig {
    SectionConfig::default()
}

fn ids(snap: &SectionSnapshot) -> BTreeSet<String> {
    snap.sections.keys().cloned().collect()
}

/// Re-sending the identical config must not disturb the catalogue: no re-detect,
/// no registry reset, so a later detect carries the SAME section ids. Red without
/// the guard, `set_section_config` cleared the processed set and reset the
/// registry unconditionally, so the next detect re-minted every id (a full
/// renumber on every launch for any user past the default strictness).
#[test]
fn unchanged_config_keeps_section_ids() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a()).snapshot;
    assert!(cold.count() > 0, "cold detect produced no sections");
    let before = ids(&cold);

    // The launch re-apply: re-send the active config verbatim. Must be a no-op.
    engine.set_section_config(unified_config());

    // A detect with no new activities. With the guard the processed set is intact,
    // so this short-circuits and the registry is untouched; without it the detect
    // re-runs against a reset registry and renumbers the whole catalogue.
    let after = ids(&ingest_step(&mut engine, "post-noop", &[]).snapshot);
    assert_eq!(
        after, before,
        "re-sending the active config renumbered sections, the registry was reset on a no-op config set"
    );
}

/// The guard must not over-suppress: a GENUINE config change still clears the
/// processed set and resets the registry, re-analysing under the new params. A
/// stricter `min_activities` can only reduce the qualifying sections, so the
/// catalogue count must drop, proving the invalidation tail still fires.
#[test]
fn changed_config_reanalyses() {
    let corpus = corpus();
    let (mut engine, _dir) = fresh_engine_for(Arm::Battery);
    let cold = ingest_step(&mut engine, "cold", &corpus.through_a()).snapshot;
    assert!(cold.count() > 0, "cold detect produced no sections");

    // A genuinely different config: demand far more traversals per section.
    let mut strict = unified_config();
    strict.min_activities = 50;
    engine.set_section_config(strict);

    let after = ingest_step(&mut engine, "reanalyse", &[&corpus.bucket_c_single]).snapshot;
    assert!(
        after.count() < cold.count(),
        "a genuine config change did not re-analyse under min_activities=50: {} sections (was {})",
        after.count(),
        cold.count(),
    );
}

/// The REAL launch scenario, end to end. A config carrying preset-only fields the
/// four slider keys never persisted (`preserve_hierarchy`, `min_corridor_tracks`)
/// is set, the engine is RESTARTED, and the SAME config is re-applied, exactly
/// what GlobalDataSync does on mount. The whole-config blob restores those fields,
/// so the loaded config equals the re-applied one, the guard no-ops, and the
/// section ids survive the relaunch. Red with only the slider keys persisted:
/// load rebuilds `default()` for the preset-only fields, so the re-apply differs
/// and renumbers every section on boot.
#[test]
fn relaunch_reapply_of_persisted_config_keeps_ids() {
    let corpus = corpus();
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("relaunch.db");
    let ps = path.to_str().unwrap();

    // What a moved strictness slider produces: Unified + preset-only fields off
    // their defaults, none of which the four slider keys persist.
    let mut cfg = unified_config();
    cfg.min_activities = 2;
    cfg.preserve_hierarchy = true;
    cfg.min_corridor_tracks = 5;

    let before = {
        let mut e = PersistentEngine::new(ps).expect("engine");
        e.set_section_config(cfg.clone());
        ingest_step(&mut e, "cold", &corpus.through_a());
        ids(&snapshot(&mut e))
    };
    assert!(!before.is_empty(), "cold detect produced no sections");

    // Restart: reopen the same DB, hydrate from settings.
    let mut e2 = PersistentEngine::new(ps).expect("reopen");
    e2.load().expect("load");
    // The launch re-apply of the identical config, must be a no-op now.
    e2.set_section_config(cfg.clone());
    ingest_step(&mut e2, "post-relaunch", &[]);
    let after = ids(&snapshot(&mut e2));

    assert_eq!(
        after, before,
        "relaunch re-apply of the persisted config renumbered sections, the config blob did not restore the preset-only fields"
    );
}
