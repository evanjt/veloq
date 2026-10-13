//! What each step of a year's expansion costs, measured rather than asserted.
//!
//! Five steps over about 550 activities: the cold set, the window expansion,
//! one added activity, a small batch, and the year's remainder. Every step
//! prints its ingest, detection and apply time and the final step prints how
//! many sections disappeared, appeared or lost activities.
//!
//! Ignored by default, it takes about 15 s in debug and 3 s in release. Run:
//! `cargo test --bench lifecycle_year_expansion_cost -p veloqrs --features synthetic --release -- --ignored --nocapture`

#![cfg(feature = "synthetic")]

#[path = "../tests/lifecycle_support/mod.rs"]
mod lifecycle_support;

use std::alloc::{GlobalAlloc, Layout, System};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::atomic::{AtomicUsize, Ordering};

use tracematch::GpsPoint;
use tracematch::scenarios::{LifecycleActivity, LifecycleConfig, LifecycleCorpus};
use veloqrs::PersistentEngine;

use lifecycle_support::*;

/// Counts live heap bytes and the high-water mark since the last reset, so a
/// step can report the peak its apply reached.
struct PeakCounting;

static LIVE: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for PeakCounting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let p = unsafe { System.alloc(layout) };
        if !p.is_null() {
            let live = LIVE.fetch_add(layout.size(), Ordering::Relaxed) + layout.size();
            PEAK.fetch_max(live, Ordering::Relaxed);
        }
        p
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) };
        LIVE.fetch_sub(layout.size(), Ordering::Relaxed);
    }
}

#[global_allocator]
static ALLOCATOR: PeakCounting = PeakCounting;

#[test]
#[ignore = "about 15 s in debug; run it deliberately, in release"]
fn year_expansion_step_costs() {
    let cfg = LifecycleConfig::default();
    let corpus = LifecycleCorpus::generate(&cfg);
    let (mut engine, _tmp) = fresh_engine();

    let step_a = ingest_step(&mut engine, "E_step1_A", &corpus.through_a());
    let step_b = ingest_step(&mut engine, "E_step2_B", &refs(&corpus.bucket_b_delta));
    let step_c = ingest_step(&mut engine, "E_step3_C", &[&corpus.bucket_c_single]);
    let step_d = ingest_step(&mut engine, "E_step4_D", &refs(&corpus.bucket_d_delta));
    let step_e = ingest_step(&mut engine, "E_step5_E", &refs(&corpus.bucket_e_delta));
    for step in [&step_a, &step_b, &step_c, &step_d, &step_e] {
        step.print();
    }

    let delta = measure_delta(&step_d.snapshot, &step_e.snapshot);
    print_delta("E_step5_E", &delta);
}

const DAY: i64 = 86_400;

/// One year of a synthetic athlete: about a ride or run a day over the
/// lifecycle corridors, generated from `seed` around `origin`.
fn year_of(year: usize, seed: u64, origin: GpsPoint) -> Vec<LifecycleActivity> {
    let corpus = LifecycleCorpus::generate(&LifecycleConfig {
        origin,
        seed,
        bucket_a_count: 40,
        bucket_b_delta_count: 60,
        bucket_d_delta_count: 3,
        bucket_e_delta_count: 261,
        ..LifecycleConfig::default()
    });
    let mut all: Vec<LifecycleActivity> = corpus.through_e().into_iter().cloned().collect();
    for a in &mut all {
        a.id = format!("y{year}_{}", a.id);
        a.start_date_unix += year as i64 * 740 * DAY;
    }
    all.sort_by_key(|a| a.start_date_unix);
    all
}

fn identity_blob_bytes(dir: &tempfile::TempDir) -> usize {
    let db = rusqlite::Connection::open(dir.path().join("lifecycle.db")).expect("open db");
    db.query_row(
        "SELECT length(blob) FROM identity_state WHERE key = 'section_identity'",
        [],
        |r| r.get::<_, i64>(0),
    )
    .map(|n| n as usize)
    .unwrap_or(0)
}

fn encoded_kb(v: &serde_json::Value) -> usize {
    rmp_serde::to_vec_named(v).map(|b| b.len()).unwrap_or(0) / 1024
}

/// The identity blob split by field, re-encoded field by field: the share the
/// visible rows, the graves, the pure layer's tombstones and the seen set each
/// hold, and within the graves the share of each payload field.
fn blob_split(dir: &tempfile::TempDir) -> String {
    let db = rusqlite::Connection::open(dir.path().join("lifecycle.db")).expect("open db");
    let Ok(bytes) = db.query_row(
        "SELECT blob FROM identity_state WHERE key = 'section_identity'",
        [],
        |r| r.get::<_, Vec<u8>>(0),
    ) else {
        return String::new();
    };
    let Ok(v) = rmp_serde::from_slice::<serde_json::Value>(&bytes[1..]) else {
        return "undecodable".to_string();
    };
    let field = |k: &str| encoded_kb(&v[k]);
    let hyst = |k: &str| encoded_kb(&v["hysteresis"][k]);
    let mut grave_fields: BTreeMap<String, serde_json::Value> = BTreeMap::new();
    if let Some(graves) = v["graves"].as_object() {
        for row in graves.values() {
            if let Some(section) = row["section"].as_object() {
                for (k, f) in section {
                    grave_fields
                        .entry(k.clone())
                        .or_insert_with(|| serde_json::Value::Array(Vec::new()))
                        .as_array_mut()
                        .unwrap()
                        .push(f.clone());
                }
            }
        }
    }
    let mut top: Vec<(usize, String)> = grave_fields
        .iter()
        .map(|(k, f)| (encoded_kb(f), k.clone()))
        .collect();
    top.sort_by(|a, b| b.cmp(a));
    let top: Vec<String> = top
        .iter()
        .take(4)
        .map(|(kb, k)| format!("{k}={kb}"))
        .collect();
    format!(
        "rows={} graves={} [{}] tombstones={} visible={} seen={} around={}",
        field("rows"),
        field("graves"),
        top.join(" "),
        hyst("tombstones"),
        hyst("visible"),
        field("seen"),
        field("around"),
    )
}

/// One sync: ingest, detect, apply. Returns the peak heap the apply reached
/// above what was live when it began.
fn sync(engine: &mut PersistentEngine, batch: &[LifecycleActivity]) -> usize {
    for a in batch {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .expect("add_activity");
        engine
            .update_activity_metadata(&a.id, Some(a.start_date_unix), None, None, None)
            .expect("update_activity_metadata");
    }
    let (main, cache) = engine.detect_sections_background().recv_state_with_cache();
    let (sections, processed) = match main {
        veloqrs::persistence::WorkerPoll::Ready(v) => v,
        _ => panic!("the detection worker did not answer"),
    };
    let base = LIVE.load(Ordering::Relaxed);
    PEAK.store(base, Ordering::Relaxed);
    engine
        .apply_sections_with_cache(sections, cache)
        .expect("apply_sections");
    let peak = PEAK.load(Ordering::Relaxed).saturating_sub(base);
    engine
        .save_processed_activity_ids(&processed)
        .expect("save_processed_activity_ids");
    peak
}

/// What the registry's tombstones did across one sync, read from their
/// retirement stamps before and after it.
#[derive(Default)]
struct TombstoneFates {
    restores: usize,
    expiries: usize,
    /// The longest restore seen, in activities arrived since retirement. An
    /// upper bound: a restore is only known to fall inside the sync that
    /// made it.
    oldest_restore: u64,
}

/// The step clock and the arrival count side by side: the arrivals ingested
/// by the end of each step.
#[derive(Default)]
struct Clock {
    arrivals_at_step: BTreeMap<u64, u64>,
}

impl Clock {
    fn record(&mut self, step: u64, arrivals: u64) {
        self.arrivals_at_step.insert(step, arrivals);
    }

    fn arrivals_at(&self, step: u64) -> u64 {
        self.arrivals_at_step
            .range(..=step)
            .next_back()
            .map_or(0, |(_, &a)| a)
    }
}

fn tombstone_fates(
    before: &[(String, Option<u64>)],
    after: &[(String, Option<u64>)],
    steps_after: u64,
    visible_after: &BTreeSet<String>,
    clock: &Clock,
) -> TombstoneFates {
    let after: BTreeMap<&str, Option<u64>> =
        after.iter().map(|(id, s)| (id.as_str(), *s)).collect();
    let mut fates = TombstoneFates::default();
    for (id, stamp) in before {
        let Some(retired_at) = *stamp else { continue };
        let restored_by = match after.get(id.as_str()) {
            Some(&now) if now == Some(retired_at) => continue,
            // Restored, then retired again inside the same sync.
            Some(&now) => now.unwrap_or(steps_after),
            None if visible_after.contains(id) => steps_after,
            None => {
                fates.expiries += 1;
                continue;
            }
        };
        fates.restores += 1;
        let age = clock
            .arrivals_at(restored_by)
            .saturating_sub(clock.arrivals_at(retired_at));
        fates.oldest_restore = fates.oldest_restore.max(age);
    }
    fates
}

fn env_number(name: &str) -> Option<u64> {
    std::env::var(name).ok().and_then(|v| v.parse().ok())
}

/// How the replay batches and ages: activities per sync, and the horizon in
/// the replay's own steps.
#[derive(Clone, Copy)]
struct Pace {
    per_sync: Option<usize>,
    horizon_steps: u64,
}

#[derive(Clone, Copy)]
enum Ground {
    /// The same corridors every year.
    Stable,
    /// New corridors every year, from a home 3 km further east each time.
    Turnover,
    /// The same corridors, and 5% of the library deleted each year.
    StableWithDeletions,
}

fn replay_years(ground: Ground, years: usize, pace: Pace) {
    let (mut engine, tmp) = fresh_engine();
    engine.section_identity_set_tombstone_horizon(pace.horizon_steps);
    let mut clock = Clock::default();
    let mut arrivals = 0u64;
    let mut expiries = 0;
    let home = GpsPoint::with_elevation(47.37, 8.55, 410.0);
    let mut held: Vec<String> = Vec::new();
    println!(
        "year activities visible graves tombstones pending blob_kb apply_peak_kb_max detect_ms_last"
    );
    for year in 0..years {
        let (seed, origin) = match ground {
            Ground::Turnover => (
                0xC0FFEE + year as u64,
                GpsPoint::with_elevation(47.37, 8.55 + 0.04 * year as f64, 410.0),
            ),
            _ => (0xC0FFEE, home),
        };
        let activities = year_of(year, seed, origin);
        let mut peak_max = 0;
        let mut last_ms = 0;
        let mut fates = TombstoneFates::default();
        let per_sync = pace
            .per_sync
            .unwrap_or_else(|| activities.len().div_ceil(12));
        for batch in activities.chunks(per_sync) {
            let (before, _) = engine.section_identity_tombstone_clock();
            let t = std::time::Instant::now();
            peak_max = peak_max.max(sync(&mut engine, batch));
            last_ms = t.elapsed().as_millis();
            held.extend(batch.iter().map(|a| a.id.clone()));
            arrivals += batch.len() as u64;
            let (after, steps) = engine.section_identity_tombstone_clock();
            clock.record(steps, arrivals);
            let visible: BTreeSet<String> = engine
                .section_identity_pure_visible_ids()
                .into_iter()
                .collect();
            let batch_fates = tombstone_fates(&before, &after, steps, &visible, &clock);
            fates.restores += batch_fates.restores;
            fates.expiries += batch_fates.expiries;
            fates.oldest_restore = fates.oldest_restore.max(batch_fates.oldest_restore);
            if let Some(oldest) = after.iter().filter_map(|(_, s)| *s).min() {
                assert!(
                    steps - oldest <= pace.horizon_steps,
                    "a tombstone retired at step {oldest} outlived the horizon at step {steps}"
                );
            }
        }
        expiries += fates.expiries;
        if matches!(ground, Ground::StableWithDeletions) {
            let doomed: Vec<String> = held.iter().step_by(20).cloned().collect();
            for id in &doomed {
                engine.remove_activity(id).expect("remove_activity");
            }
            held.retain(|id| !doomed.contains(id));
            sync(&mut engine, &[]);
        }
        println!(
            "{:>4} {:>10} {:>7} {:>6} {:>10} {:>7} {:>7} {:>17} {:>14}",
            year + 1,
            engine.get_activity_ids().len(),
            engine.section_identity_visible_len(),
            engine.section_identity_grave_rows().len(),
            engine.section_identity_tombstone_ids().len(),
            engine.section_identity_pending_len(),
            identity_blob_bytes(&tmp) / 1024,
            peak_max / 1024,
            last_ms,
        );
        println!("     kb: {}", blob_split(&tmp));
        println!(
            "     restores={} expiries={} oldest_restore={} arrivals",
            fates.restores, fates.expiries, fates.oldest_restore,
        );
    }
    let (_, steps) = engine.section_identity_tombstone_clock();
    if steps > pace.horizon_steps.saturating_add(1) {
        assert!(
            expiries > 0,
            "{steps} steps ran past a horizon of {} and nothing expired",
            pace.horizon_steps
        );
    }
}

/// Graves, tombstones and identity blob bytes after each simulated year, for
/// three kinds of library: stable ground, ground that moves every year, and
/// stable ground with a twentieth of the library deleted each year. `YEARS`
/// sets the count, five by default, and `GROUND` runs one kind by its label.
/// Each year syncs a month at a time unless `PER_SYNC` sets the batch.
///
/// The horizon is read in arrivals, since the debounce counts arrivals. This
/// replay steps once per sync, so it keeps a tombstone
/// `HORIZON.div_ceil(PER_SYNC)` of its own steps, which spans the same
/// arrivals. `HORIZON` is the engine's default unless set, and `off` keeps
/// every tombstone, which is how restore ages are read: the oldest restore
/// printed is the horizon that keeps all of them. With a horizon the replay
/// fails when a tombstone outlives it, or when a run longer than it expires
/// nothing.
///
/// `cargo test --bench lifecycle_year_expansion_cost -p veloqrs --features synthetic --release -- --ignored --nocapture identity_growth`
#[test]
#[ignore = "minutes in release; run it deliberately"]
fn identity_growth_per_year() {
    let years = env_number("YEARS").unwrap_or(5) as usize;
    let per_sync = env_number("PER_SYNC").map(|n| n.max(1) as usize);
    let horizon = match std::env::var("HORIZON").as_deref() {
        Ok("off") => None,
        _ => Some(
            env_number("HORIZON")
                .unwrap_or(tracematch::HysteresisParams::default().tombstone_horizon_steps),
        ),
    };
    // A month of this replay's year is 31 activities.
    let arrivals_per_step = per_sync.unwrap_or(31) as u64;
    let pace = Pace {
        per_sync,
        horizon_steps: horizon.map_or(u64::MAX, |h| h.div_ceil(arrivals_per_step)),
    };
    let only = std::env::var("GROUND").ok();
    for (label, ground) in [
        ("stable", Ground::Stable),
        ("turnover", Ground::Turnover),
        ("stable_with_deletions", Ground::StableWithDeletions),
    ] {
        if only.as_deref().is_some_and(|o| o != label) {
            continue;
        }
        println!("== {label}");
        replay_years(ground, years, pace);
    }
}
