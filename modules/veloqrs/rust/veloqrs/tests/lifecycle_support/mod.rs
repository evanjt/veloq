//! Shared harness for the section-detection E2E suites.
//!
//! Two arms over one scenario catalogue, both driving the identical
//! full-stack path (SQLite ingest -> `detect_sections_background` ->
//! `apply_sections` -> snapshot):
//!
//! - `Arm::Battery` drives `DetectionMethod::Corridor` by name, the frozen
//!   baseline (Suite #1).
//! - `Arm::Battery` drives `DetectionMethod::Unified`, the new base
//!   (Suite #2).
//!
//! The two arms differ by exactly one engine setting, so any difference in
//! output is attributable to the detector, not the harness. Identity,
//! incremental persistence, hysteresis, and concurrency assertions live as
//! `#[ignore]` target gates in the Battery suite until B1/B2/B4 ship; this
//! module carries the fingerprint and survival machinery they assert against.

#![allow(dead_code)] // shared across test binaries; not every suite uses every helper

use std::collections::{BTreeMap, BTreeSet};
use std::time::Instant;

use tempfile::TempDir;
use tracematch::GpsPoint;
use tracematch::scenarios::LifecycleActivity;
use veloqrs::PersistentRouteEngine;

/// The one engine the suites drive.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Arm {
    Battery,
}

impl Arm {
    pub fn label(self) -> &'static str {
        "battery"
    }
}

// ============================================================================
// Fingerprint types, what we record per section per step
// ============================================================================

#[derive(Debug, Clone, PartialEq)]
pub struct SectionFingerprint {
    pub activity_ids: BTreeSet<String>,
    pub visit_count: u32,
    pub polyline_point_count: usize,
    pub distance_meters: f64,
    /// Full rendered polyline, carried so the suites can match sections by
    /// GROUND (overlap), not by id. String ids lie in both directions: rank
    /// ids (Corridor) reshuffle on every set change, and emission ids
    /// (Unified, `sec_ride_0`) persist trivially onto different ground. Ground
    /// overlap is the honest identity signal, and it is what B2's IoU layer
    /// will use.
    pub polyline: Vec<GpsPoint>,
    pub sport_type: String,
    /// Interestingness percentile and class, None before a rank has run.
    pub rank_score: Option<f64>,
    pub klass: Option<String>,
    pub is_user_defined: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SectionSnapshot {
    pub sections: BTreeMap<String, SectionFingerprint>,
}

impl SectionSnapshot {
    pub fn count(&self) -> usize {
        self.sections.len()
    }

    /// The set of section ids (identity view).
    pub fn ids(&self) -> BTreeSet<&String> {
        self.sections.keys().collect()
    }

    /// Order-free, identity-free catalogue signature. Rows are keyed by
    /// ground and usage, never by id, and sorted, so two catalogues with
    /// identical ground but renumbered ids produce the SAME signature. A
    /// frozen golden of this string is the backwards-compatibility anchor.
    ///
    /// The `g` field is the geometry digest. Without it a section could
    /// translate wholesale onto different ground and keep an identical
    /// signature, because distance and point count survive a translation.
    /// [`catalogue_signature`](Self::catalogue_signature) with each row's id
    /// in front: the cross-process gate reads this, because two processes
    /// cutting one library must mint the same ids, not only the same ground.
    pub fn catalogue_signature_with_ids(&self) -> String {
        let mut rows: Vec<String> = self
            .sections
            .iter()
            .map(|(id, f)| {
                format!(
                    "{}|{}|v{}|{}m|p{}|g{:016x}|r{}|k{}",
                    id,
                    f.sport_type,
                    f.visit_count,
                    f.distance_meters.round() as i64,
                    f.polyline_point_count,
                    coordinate_digest(&f.polyline),
                    f.rank_score
                        .map(|r| ((r * 1e6).round() as i64).to_string())
                        .unwrap_or_default(),
                    f.klass.as_deref().unwrap_or(""),
                )
            })
            .collect();
        rows.sort();
        rows.join("\n")
    }

    pub fn catalogue_signature(&self) -> String {
        let mut rows: Vec<String> = self
            .sections
            .values()
            .map(|f| {
                format!(
                    "{}|v{}|{}m|p{}|g{:016x}|[{}]",
                    f.sport_type,
                    f.visit_count,
                    f.distance_meters.round() as i64,
                    f.polyline_point_count,
                    coordinate_digest(&f.polyline),
                    f.activity_ids.iter().cloned().collect::<Vec<_>>().join(","),
                )
            })
            .collect();
        rows.sort();
        rows.join("\n")
    }
}

/// FNV-1a over the polyline's coordinates rounded to five decimal places
/// (~1 m). Rounding keeps the digest stable against float noise that is far
/// below the detector's own tolerances, while any real move of the line
/// changes it.
fn coordinate_digest(polyline: &[GpsPoint]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for p in polyline {
        for v in [p.latitude, p.longitude] {
            for b in ((v * 1e5).round() as i64).to_le_bytes() {
                h ^= b as u64;
                h = h.wrapping_mul(0x0000_0100_0000_01b3);
            }
        }
    }
    h
}

/// Two catalogues that differ only in where the line sits must not share a
/// signature. Distance, point count, sport and membership all survive a
/// wholesale translation, so the geometry digest is the only thing separating
/// them, and every self-comparison contract rests on that.
#[test]
fn signature_separates_translated_ground() {
    let at = |lat: f64| SectionSnapshot {
        sections: [(
            "sec_ride_0".to_string(),
            SectionFingerprint {
                activity_ids: ["a1".to_string(), "a2".to_string()].into_iter().collect(),
                visit_count: 2,
                polyline_point_count: 3,
                distance_meters: 1234.0,
                polyline: vec![
                    GpsPoint::new(lat, 7.35),
                    GpsPoint::new(lat + 0.01, 7.36),
                    GpsPoint::new(lat + 0.02, 7.37),
                ],
                sport_type: "Ride".to_string(),
                rank_score: None,
                klass: None,
                is_user_defined: false,
            },
        )]
        .into_iter()
        .collect(),
    };
    assert_eq!(
        at(46.23).catalogue_signature(),
        at(46.23).catalogue_signature()
    );
    assert_ne!(
        at(46.23).catalogue_signature(),
        at(46.40).catalogue_signature(),
        "a section translated onto different ground kept its signature"
    );
}

/// Metres between two points (haversine). Local so the harness owns its
/// ground-match maths and doesn't depend on tracematch internals.
fn haversine_m(a: &GpsPoint, b: &GpsPoint) -> f64 {
    let r = 6_371_000.0_f64;
    let (la1, lo1) = (a.latitude.to_radians(), a.longitude.to_radians());
    let (la2, lo2) = (b.latitude.to_radians(), b.longitude.to_radians());
    let dla = la2 - la1;
    let dlo = lo2 - lo1;
    let h = (dla / 2.0).sin().powi(2) + la1.cos() * la2.cos() * (dlo / 2.0).sin().powi(2);
    2.0 * r * h.sqrt().asin()
}

/// Fraction of `samples` within `tol_m` of any point on `line`.
fn coverage(samples: &[GpsPoint], line: &[GpsPoint], tol_m: f64) -> f64 {
    if samples.is_empty() || line.is_empty() {
        return 0.0;
    }
    let covered = samples
        .iter()
        .filter(|s| {
            line.iter()
                .map(|p| haversine_m(s, p))
                .fold(f64::INFINITY, f64::min)
                <= tol_m
        })
        .count();
    covered as f64 / samples.len() as f64
}

/// Ground-match tolerance: half the ~100 m evidence cell. Two lines within
/// this of each other are "the same corridor".
pub const GROUND_TOL_M: f64 = 50.0;

/// Whether two sections describe the same physical ground, tolerant to extent
/// growth: one corridor is (mostly) covered by the other in either direction,
/// so a cold section that later grows a longer supported extent still matches.
pub fn ground_matches(a: &SectionFingerprint, b: &SectionFingerprint) -> bool {
    coverage(&a.polyline, &b.polyline, GROUND_TOL_M) >= 0.6
        || coverage(&b.polyline, &a.polyline, GROUND_TOL_M) >= 0.6
}

/// Whether an activity's track lends support to a section's ground: any
/// contact beyond noise with the footprint counts, because even a short
/// overlap can seed a small honest section inside the corridor now that
/// orphaned ground re-queues. Dissolution scaffolding uses this to pick
/// what to remove and which drain activities cannot keep ground alive.
pub fn lends_ground(fp: &SectionFingerprint, track: &[GpsPoint]) -> bool {
    coverage(&fp.polyline, track, GROUND_TOL_M) >= 0.02
}

/// Snapshot the USER-VISIBLE catalogue: the DB view the app actually renders
/// (`get_sections_by_type(None)`), which excludes disabled/superseded and
/// includes custom sections. Deliberately NOT the in-memory `get_sections()`
/// detection cache: `apply_sections_save` sets that cache to the fresh
/// detection result and never reloads from DB, so the cache and the visible
/// view can diverge (the seam B4 must close). The suite measures what the user
/// experiences, so it reads the visible view.
pub fn snapshot(engine: &mut PersistentRouteEngine) -> SectionSnapshot {
    let sections = engine.get_sections_by_type(None);
    SectionSnapshot {
        sections: sections
            .into_iter()
            .map(|s| {
                (
                    s.id.clone(),
                    SectionFingerprint {
                        activity_ids: s.activity_ids.iter().cloned().collect(),
                        visit_count: s.visit_count,
                        polyline_point_count: s.polyline.len(),
                        distance_meters: s.distance_meters,
                        polyline: s.polyline.clone(),
                        sport_type: s.sport_type.clone(),
                        rank_score: s.rank_score,
                        klass: s.klass.clone(),
                        is_user_defined: s.is_user_defined,
                    },
                )
            })
            .collect(),
    }
}

/// Snapshot the RAW detection catalogue (pre-identity, pre-hysteresis) instead of
/// the DAMPED visible view `snapshot` reads. Since B2 the two DIFFER on purpose:
/// the damped view carries stable ids and can hold a section a debounced dissolve
/// has not yet retired (or a member an append-only fold has not dropped), so it
/// lags the raw batch by up to `k` steps. DETECTION itself stays order-free and
/// tracks the batch every step, so the B1 convergence / order-invariance /
/// freshness gates read this raw view, comparing the damped view there would
/// score a legitimate hysteresis lag as a detection desync. B2 identity/stability
/// gates keep reading `snapshot` (the visible view the app renders).
pub fn raw_snapshot(engine: &PersistentRouteEngine) -> SectionSnapshot {
    SectionSnapshot {
        sections: engine
            .raw_detection_catalogue()
            .iter()
            .map(|s| {
                (
                    s.id.clone(),
                    SectionFingerprint {
                        activity_ids: s.activity_ids.iter().cloned().collect(),
                        visit_count: s.visit_count,
                        polyline_point_count: s.polyline.len(),
                        distance_meters: s.distance_meters,
                        polyline: s.polyline.clone(),
                        sport_type: s.sport_type.clone(),
                        rank_score: s.rank.as_ref().map(|r| r.score),
                        klass: s.enrichment.klass.map(|k| k.as_str().to_string()),
                        is_user_defined: s.is_user_defined,
                    },
                )
            })
            .collect(),
    }
}

// ============================================================================
// Engine construction per arm
// ============================================================================

/// A fresh temp-DB engine.
pub fn fresh_engine() -> (PersistentRouteEngine, TempDir) {
    let _ = env_logger::builder().is_test(true).try_init();
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("lifecycle.db");
    let engine = PersistentRouteEngine::new(path.to_str().unwrap()).expect("open engine");
    (engine, dir)
}

/// A fresh temp-DB engine on the given arm.
pub fn fresh_engine_for(_arm: Arm) -> (PersistentRouteEngine, TempDir) {
    fresh_engine()
}

// ============================================================================
// Step measurement + full-stack ingest driver
// ============================================================================

#[derive(Debug)]
pub struct StepMeasurement {
    pub label: String,
    pub activity_count: usize,
    pub new_activities_in_step: usize,
    pub section_count: usize,
    pub ingest_ms: u128,
    pub detection_ms: u128,
    pub apply_ms: u128,
    pub total_ms: u128,
    pub snapshot: SectionSnapshot,
}

impl StepMeasurement {
    pub fn print(&self, arm: Arm) {
        println!(
            "[{}/{}] activities={:>4} (+{:<3}) sections={:>3} | ingest={:>5}ms detect={:>6}ms apply={:>5}ms total={:>6}ms",
            arm.label(),
            self.label,
            self.activity_count,
            self.new_activities_in_step,
            self.section_count,
            self.ingest_ms,
            self.detection_ms,
            self.apply_ms,
            self.total_ms,
        );
    }
}

/// Fallible ingest step: returns `Err` instead of panicking if any engine call
/// fails, so a suite can assert that a step completes WITHOUT crashing. Mirrors
/// the production poll path (`objects/detection.rs`) including
/// `save_processed_activity_ids` so the next step enters incremental mode.
/// (Today a resync after `accept_section` fails here with a UNIQUE
/// `sections.id` violation, a positional-id collision.)
pub fn try_ingest_step(
    engine: &mut PersistentRouteEngine,
    label: &str,
    activities: &[&LifecycleActivity],
) -> Result<StepMeasurement, String> {
    let new_activities_in_step = activities.len();

    let ingest_start = Instant::now();
    for a in activities {
        engine
            .add_activity(a.id.clone(), a.gps_points.clone(), a.sport_type.clone())
            .map_err(|e| format!("add_activity: {e:?}"))?;
        engine
            .update_activity_metadata(&a.id, Some(a.start_date_unix), None, None, None)
            .map_err(|e| format!("update_activity_metadata: {e:?}"))?;
    }
    let ingest_ms = ingest_start.elapsed().as_millis();

    let detect_start = Instant::now();
    let handle = engine.detect_sections_background();
    // Cache-aware recv so a Unified drip actually folds through the evidence
    // cache; Control produces no cache update, so this is identical to the plain
    // path for the Control arm.
    let (main, cache_update) = handle.recv_with_cache();
    let (sections, processed_ids) = main.unwrap_or_default();
    let detection_ms = detect_start.elapsed().as_millis();

    let apply_start = Instant::now();
    engine
        .apply_sections_with_cache(sections, cache_update)
        .map_err(|e| format!("apply_sections: {e:?}"))?;
    engine
        .save_processed_activity_ids(&processed_ids)
        .map_err(|e| format!("save_processed_activity_ids: {e:?}"))?;
    let apply_ms = apply_start.elapsed().as_millis();

    let total_ms = ingest_start.elapsed().as_millis();

    let snap = snapshot(engine);
    Ok(StepMeasurement {
        label: label.to_string(),
        activity_count: engine.get_activity_ids().len(),
        new_activities_in_step,
        section_count: snap.count(),
        ingest_ms,
        detection_ms,
        apply_ms,
        total_ms,
        snapshot: snap,
    })
}

/// One user-visible step. Panics on any engine error (the common case for the
/// growth scenarios). Use `try_ingest_step` when a test must assert the step
/// does not crash.
pub fn ingest_step(
    engine: &mut PersistentRouteEngine,
    label: &str,
    activities: &[&LifecycleActivity],
) -> StepMeasurement {
    try_ingest_step(engine, label, activities).expect("ingest_step")
}

/// Convenience: collect an owned bucket into the borrowed slice `ingest_step`
/// wants.
pub fn refs(activities: &[LifecycleActivity]) -> Vec<&LifecycleActivity> {
    activities.iter().collect()
}

// ============================================================================
// Survival metrics, the discontinuity the redesign targets
// ============================================================================

/// Fraction of `before`'s section ids still present in `after`. Exact. Low id
/// survival across an expand is the renumber discontinuity.
///
/// An empty `before` scores 0.0, not 1.0: there is nothing to survive, so no
/// gate may read it as a pass. Call sites assert the catalogue is populated
/// first, which is the honest place for that check to fail.
pub fn id_survival(before: &SectionSnapshot, after: &SectionSnapshot) -> f64 {
    if before.sections.is_empty() {
        return 0.0;
    }
    let survived = before
        .sections
        .keys()
        .filter(|id| after.sections.contains_key(*id))
        .count();
    survived as f64 / before.sections.len() as f64
}

/// Fraction of `before`'s sections whose ground (geo_key proxy) still appears
/// in `after`, regardless of id. High ground survival with low id survival is
/// exactly "same sections, reshuffled", the thing to eliminate.
///
/// An empty `before` scores 0.0 for the same reason as `id_survival`: an
/// undefined comparison must never read as a pass.
pub fn ground_survival(before: &SectionSnapshot, after: &SectionSnapshot) -> f64 {
    if before.sections.is_empty() {
        return 0.0;
    }
    let after_sections: Vec<&SectionFingerprint> = after.sections.values().collect();
    let survived = before
        .sections
        .values()
        .filter(|f| after_sections.iter().any(|g| ground_matches(f, g)))
        .count();
    survived as f64 / before.sections.len() as f64
}

/// The honest identity metric: among `before` sections whose GROUND survives
/// somewhere in `after`, the fraction that survive under the SAME id. It
/// ignores string-id coincidence (a positional `sec_ride_0` always exists) and
/// asks the real question, did the id follow its ground? Low today (ids are
/// positional and renumber); B2's assign-once identity layer is what drives it
/// up. This is what the identity gate asserts on, never raw id survival.
///
/// No survivors scores 0.0. That case is a wiped catalogue, and scoring it a
/// perfect 1.0 made every identity gate pass on nothing at all.
pub fn identity_retention(before: &SectionSnapshot, after: &SectionSnapshot) -> f64 {
    let survivors: Vec<(&String, &SectionFingerprint)> = before
        .sections
        .iter()
        .filter(|(_, f)| after.sections.values().any(|g| ground_matches(f, g)))
        .collect();
    if survivors.is_empty() {
        return 0.0;
    }
    let kept = survivors
        .iter()
        .filter(|(id, f)| {
            after
                .sections
                .get(*id)
                .is_some_and(|g| ground_matches(f, g))
        })
        .count();
    kept as f64 / survivors.len() as f64
}

/// Every survival metric scores an empty `before` 0.0, so a gate that compares
/// before a section has formed measures nothing. Assert the catalogue exists
/// first.
pub fn assert_catalogue_populated(label: &str, snap: &SectionSnapshot) {
    assert!(
        snap.count() > 0,
        "{label}: catalogue is empty, the comparison that follows would assert nothing"
    );
}

/// A wiped or never-formed catalogue must score zero on every survival metric.
/// Scoring it 1.0 let the identity gates pass while asserting on nothing.
#[test]
fn survival_metrics_never_pass_on_an_empty_catalogue() {
    let empty = SectionSnapshot {
        sections: BTreeMap::new(),
    };
    let populated = SectionSnapshot {
        sections: [(
            "sec_ride_0".to_string(),
            SectionFingerprint {
                activity_ids: ["a1".to_string()].into_iter().collect(),
                visit_count: 2,
                polyline_point_count: 2,
                distance_meters: 500.0,
                polyline: vec![GpsPoint::new(46.23, 7.35), GpsPoint::new(46.24, 7.36)],
                sport_type: "Ride".to_string(),
                rank_score: None,
                klass: None,
                is_user_defined: false,
            },
        )]
        .into_iter()
        .collect(),
    };

    assert_eq!(id_survival(&empty, &empty), 0.0);
    assert_eq!(ground_survival(&empty, &empty), 0.0);
    assert_eq!(identity_retention(&empty, &empty), 0.0);

    assert_eq!(id_survival(&populated, &empty), 0.0);
    assert_eq!(ground_survival(&populated, &empty), 0.0);
    assert_eq!(identity_retention(&populated, &empty), 0.0);

    assert_eq!(identity_retention(&populated, &populated), 1.0);
}

/// The busiest section (highest visit count, most robust ground), for edit
/// scenarios that need a real, reliably-reforming section to act on.
pub fn busiest_section(snap: &SectionSnapshot) -> Option<(String, SectionFingerprint)> {
    snap.sections
        .iter()
        .max_by_key(|(_, f)| f.visit_count)
        .map(|(id, f)| (id.clone(), f.clone()))
}

// ============================================================================
// Behaviour delta, measured, printed (not asserted)
// ============================================================================

#[derive(Debug, Default)]
pub struct BehaviourDelta {
    pub sections_disappeared: usize,
    pub sections_appeared: usize,
    pub sections_with_lost_activities: usize,
    pub total_activities_lost: usize,
    pub sections_with_sport_type_change: usize,
}

pub fn measure_delta(before: &SectionSnapshot, after: &SectionSnapshot) -> BehaviourDelta {
    let mut d = BehaviourDelta::default();
    let after_ids: BTreeSet<&String> = after.sections.keys().collect();
    let before_ids: BTreeSet<&String> = before.sections.keys().collect();

    d.sections_disappeared = before_ids.difference(&after_ids).count();
    d.sections_appeared = after_ids.difference(&before_ids).count();

    for (id, prev) in &before.sections {
        if let Some(now) = after.sections.get(id) {
            if now.sport_type != prev.sport_type {
                d.sections_with_sport_type_change += 1;
            }
            let lost: BTreeSet<&String> = prev.activity_ids.difference(&now.activity_ids).collect();
            if !lost.is_empty() {
                d.sections_with_lost_activities += 1;
                d.total_activities_lost += lost.len();
            }
        }
    }
    d
}

pub fn print_delta(arm: Arm, label: &str, delta: &BehaviourDelta) {
    println!(
        "[{}/{}] delta: disappeared={} appeared={} sections_with_lost_activities={} total_activities_lost={} sport_type_changes={}",
        arm.label(),
        label,
        delta.sections_disappeared,
        delta.sections_appeared,
        delta.sections_with_lost_activities,
        delta.total_activities_lost,
        delta.sections_with_sport_type_change,
    );
}

// ============================================================================
// Strict stability assertions (Battery target gates)
// ============================================================================

pub fn assert_single_add_stability(
    before: &SectionSnapshot,
    after: &SectionSnapshot,
    new_activity_id: &str,
) {
    for (id, prev) in &before.sections {
        let now = after
            .sections
            .get(id)
            .unwrap_or_else(|| panic!("section {id} disappeared after a single add"));
        assert_eq!(
            now.sport_type, prev.sport_type,
            "section {id} sport_type changed across a single add"
        );

        let new_ids: BTreeSet<&String> = now.activity_ids.difference(&prev.activity_ids).collect();
        let removed_ids: BTreeSet<&String> =
            prev.activity_ids.difference(&now.activity_ids).collect();
        assert!(
            removed_ids.is_empty(),
            "section {id} lost activity_ids {removed_ids:?} on a single add"
        );

        if new_ids.is_empty() {
            assert_eq!(
                now.visit_count, prev.visit_count,
                "section {id}: activity_ids unchanged but visit_count moved"
            );
        } else {
            assert!(
                new_ids.iter().all(|s| s.as_str() == new_activity_id),
                "section {id} gained unexpected activities {new_ids:?} (only {new_activity_id} should appear)"
            );
        }
    }
}

pub fn assert_no_activity_removed(before: &SectionSnapshot, after: &SectionSnapshot) {
    for (id, prev) in &before.sections {
        if let Some(now) = after.sections.get(id) {
            let removed: BTreeSet<&String> =
                prev.activity_ids.difference(&now.activity_ids).collect();
            assert!(
                removed.is_empty(),
                "section {id} lost activities {removed:?}"
            );
        }
    }
}

pub fn assert_sport_types_stable(before: &SectionSnapshot, after: &SectionSnapshot) {
    for (id, prev) in &before.sections {
        if let Some(now) = after.sections.get(id) {
            assert_eq!(
                now.sport_type, prev.sport_type,
                "section {id} sport_type changed: {} -> {}",
                prev.sport_type, now.sport_type
            );
        }
    }
}
