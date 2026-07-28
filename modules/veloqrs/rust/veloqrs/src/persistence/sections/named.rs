//! Named corridors: a section name as permanent user data keyed to ground.
//!
//! Naming an auto section writes a `section_intents` row (kind 'named')
//! holding the name and the footprint the user named, never the section row:
//! auto rows are wiped and re-cut by detection, so anything row-local is
//! cache-class. The name is resolved back onto the catalogue by covering
//! ground: the visible section covering the largest share of the footprint's
//! core carries the name, ties broken by smaller lateral offset, then older
//! section, then id. A contained sub-piece of the named ground qualifies from
//! a quarter of the core, so a corridor that re-emerges shorter than what was
//! named keeps its name. A resolution is refused outright when the covered
//! core sits further from the section than half the ground tolerance on
//! average, so a name never migrates onto a parallel twin. An intent nothing
//! qualifies for is dormant: kept forever, resurfacing the moment its ground
//! re-emerges.
//!
//! Naming never suppresses, never promotes, never freezes: detection and
//! evolution proceed as if the name did not exist (the emitter's suppression
//! read is kind-filtered, see `durable_intent_rows`).
//!
//! The overlay is a pure function of DB state (intent rows + visible section
//! rows), refreshed lazily: it is recomputed whenever the connection's
//! `total_changes()` counter has moved since the last compute. Every write to
//! the inputs goes through this connection, so staleness is impossible by
//! construction and no mutation site needs to remember an invalidation call.
//! With no named intents the refresh check is one counter read.

use std::collections::BTreeMap;

use rusqlite::{OptionalExtension, params};
use tracematch::GpsPoint;
use tracematch::sections::{CARRY_COVERAGE, GROUND_TOL_M, shares_ground};

use super::super::PersistentRouteEngine;

/// One named-corridor intent with its current resolution.
#[derive(Debug, Clone)]
pub struct NamedCorridor {
    pub intent_id: String,
    pub name: String,
    pub footprint: Vec<GpsPoint>,
    pub sport_type: Option<String>,
    pub created_at: String,
    /// Visible section currently carrying the name; None while dormant.
    pub section_id: Option<String>,
    /// Core coverage of the resolved section (0.0 while dormant).
    pub coverage: f64,
    /// Whether this intent's name is the one displayed on its section (two
    /// intents can resolve to one section after a merge; the better-covering
    /// one wins display, both persist).
    pub primary: bool,
}

/// The resolved read-time state: display name per visible section id, plus
/// every intent row for the corridor listing.
#[derive(Debug, Default, Clone)]
pub struct NamedOverlay {
    pub by_section: BTreeMap<String, String>,
    pub corridors: Vec<NamedCorridor>,
}

/// Core floor: three ~100 m evidence cells, expressed through the ground
/// tolerance anchor (`GROUND_TOL_M` is half a cell).
const CORE_FLOOR_M: f64 = 6.0 * GROUND_TOL_M;
/// Fraction trimmed from each end of the footprint to form the resolution
/// core. Extent drift concentrates at endpoints (29% median early, 10%
/// settled), so resolving on the middle keeps a name attached through the
/// re-cuts that motivated this feature.
const CORE_TRIM_FRAC: f64 = 0.15;
/// Coverage scores within this of the best are ties, broken by lateral
/// offset.
const COVERAGE_TIE: f64 = 0.05;
/// Resolution refuses a section whose covered core sits further away than
/// this on average. Half the ground tolerance: a name must bind finer than
/// the 50 m same-corridor metric or a 30 m parallel twin would satisfy it,
/// while same-line GPS noise stays well under.
const OFFSET_CEILING_M: f64 = GROUND_TOL_M / 2.0;
/// A section covering less core than this cannot carry the name even when it
/// is a contained sub-piece of the named ground. Matches the quarter-share
/// floor a split piece needs before it is associated with the name at all.
const PART_FLOOR: f64 = 0.25;

fn haversine_m(a: &GpsPoint, b: &GpsPoint) -> f64 {
    let r = 6_371_000.0_f64;
    let (la1, lo1) = (a.latitude.to_radians(), a.longitude.to_radians());
    let (la2, lo2) = (b.latitude.to_radians(), b.longitude.to_radians());
    let dla = la2 - la1;
    let dlo = lo2 - lo1;
    let h = (dla / 2.0).sin().powi(2) + la1.cos() * la2.cos() * (dlo / 2.0).sin().powi(2);
    2.0 * r * h.sqrt().asin()
}

/// Whether a name has the shape of the engine's own generated labels:
/// "<word> N" or the legacy "<sport> <word> N", language-agnostic by token
/// shape. Such names are never user data: the naming path keeps them
/// row-local and the migration backfill skips them. A real user name of
/// that shape ("Route 66") is misclassified and stays row-local — no worse
/// than before named corridors existed.
pub(crate) fn looks_generated(name: &str) -> bool {
    let tokens: Vec<&str> = name.split_whitespace().collect();
    matches!(tokens.len(), 2 | 3)
        && tokens
            .last()
            .is_some_and(|t| !t.is_empty() && t.chars().all(|c| c.is_ascii_digit()))
}

/// The middle of the footprint by arc length: trim `CORE_TRIM_FRAC` from each
/// end, never below `CORE_FLOOR_M` of retained length. Short footprints are
/// their own core.
fn trim_core(footprint: &[GpsPoint]) -> Vec<GpsPoint> {
    if footprint.len() < 3 {
        return footprint.to_vec();
    }
    let mut cum = Vec::with_capacity(footprint.len());
    let mut total = 0.0;
    cum.push(0.0);
    for w in footprint.windows(2) {
        total += haversine_m(&w[0], &w[1]);
        cum.push(total);
    }
    if total <= CORE_FLOOR_M {
        return footprint.to_vec();
    }
    let trim = (CORE_TRIM_FRAC * total).min((total - CORE_FLOOR_M) / 2.0);
    let (lo, hi) = (trim, total - trim);
    let core: Vec<GpsPoint> = footprint
        .iter()
        .zip(&cum)
        .filter(|(_, d)| **d >= lo && **d <= hi)
        .map(|(p, _)| p.clone())
        .collect();
    if core.len() < 2 {
        footprint.to_vec()
    } else {
        core
    }
}

/// Coverage of `core` by `line` at the ground tolerance, and the mean
/// distance of the covered points to the line. The mean offset is the
/// twin-lane discriminator: a 30 m parallel can reach coverage at a 50 m
/// tolerance, but its offset gives it away.
fn coverage_and_offset(core: &[GpsPoint], line: &[GpsPoint]) -> (f64, f64) {
    if core.is_empty() || line.is_empty() {
        return (0.0, f64::INFINITY);
    }
    let mut covered = 0usize;
    let mut offset_sum = 0.0;
    for s in core {
        let d = line
            .iter()
            .map(|p| haversine_m(s, p))
            .fold(f64::INFINITY, f64::min);
        if d <= GROUND_TOL_M {
            covered += 1;
            offset_sum += d;
        }
    }
    if covered == 0 {
        return (0.0, f64::INFINITY);
    }
    (
        covered as f64 / core.len() as f64,
        offset_sum / covered as f64,
    )
}

fn bbox(points: &[GpsPoint]) -> (f64, f64, f64, f64) {
    let mut b = (
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
    );
    for p in points {
        b.0 = b.0.min(p.latitude);
        b.1 = b.1.max(p.latitude);
        b.2 = b.2.min(p.longitude);
        b.3 = b.3.max(p.longitude);
    }
    b
}

/// Whether two bboxes padded by the ground tolerance overlap. Cheap gate so
/// resolution never runs the coverage loop against far-away sections.
fn bboxes_touch(a: (f64, f64, f64, f64), b: (f64, f64, f64, f64), mid_lat: f64) -> bool {
    let pad_lat = GROUND_TOL_M / 111_320.0;
    let pad_lng = GROUND_TOL_M / (111_320.0 * mid_lat.to_radians().cos().max(0.01));
    a.0 - pad_lat <= b.1 && b.0 - pad_lat <= a.1 && a.2 - pad_lng <= b.3 && b.2 - pad_lng <= a.3
}

struct IntentRow {
    intent_id: String,
    name: String,
    footprint: Vec<GpsPoint>,
    sport_type: Option<String>,
    created_at: String,
}

struct VisibleRow {
    id: String,
    polyline_json: String,
    created_at: String,
    bbox: (f64, f64, f64, f64),
}

/// The winning candidate for one intent: largest core coverage (the split
/// ruling), with candidates within `COVERAGE_TIE` of the maximum treated as
/// a band whose winner is the smallest lateral offset, then the older
/// section, then id. Two deterministic total-order passes — a single
/// comparator with a tie band is not a strict weak ordering and `sort_by`
/// may panic on one.
fn select_candidate(
    candidates: &[(usize, f64, f64)],
    visible: &[VisibleRow],
) -> (Option<usize>, f64) {
    let Some(top_cov) = candidates
        .iter()
        .map(|c| c.1)
        .fold(None::<f64>, |m, c| Some(m.map_or(c, |m| m.max(c))))
    else {
        return (None, 0.0);
    };
    let floor = top_cov - COVERAGE_TIE;
    candidates
        .iter()
        .filter(|c| c.1 >= floor)
        .min_by(|a, b| {
            a.2.total_cmp(&b.2)
                .then_with(|| visible[a.0].created_at.cmp(&visible[b.0].created_at))
                .then_with(|| visible[a.0].id.cmp(&visible[b.0].id))
        })
        .map(|&(vi, cov, _)| (Some(vi), cov))
        .unwrap_or((None, 0.0))
}

impl PersistentRouteEngine {
    /// Bring the overlay up to date with the DB. Returns whether a recompute
    /// ran, so `&mut` callers holding derived caches (the section LRU) know
    /// to drop them. The recompute itself only SELECTs, so it never moves the
    /// counter it is keyed on.
    ///
    /// Queries `self.db`, so this belongs to the WRITE-lock class of engine
    /// methods (see the `unsafe impl Sync` invariant). Read-lock paths use
    /// `named_overlay_cached_names` instead and tolerate one write of
    /// staleness.
    pub(crate) fn ensure_named_overlay(&self) -> bool {
        use std::sync::atomic::Ordering;
        let stamp: i64 = self
            .db
            .query_row("SELECT total_changes()", [], |row| row.get(0))
            .unwrap_or(-1);
        if stamp == self.named_overlay_stamp.load(Ordering::Acquire) {
            return false;
        }
        // The common library has no named intents at all; catch up the stamp
        // with one EXISTS probe instead of touching the sections table.
        let has_named: bool = self
            .db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM section_intents WHERE kind = 'named')",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if !has_named {
            let mut overlay = self
                .named_overlay
                .write()
                .unwrap_or_else(|e| e.into_inner());
            let was_empty = overlay.by_section.is_empty() && overlay.corridors.is_empty();
            *overlay = NamedOverlay::default();
            drop(overlay);
            self.named_overlay_stamp.store(stamp, Ordering::Release);
            return !was_empty;
        }
        let overlay = self.compute_named_overlay();
        *self
            .named_overlay
            .write()
            .unwrap_or_else(|e| e.into_inner()) = overlay;
        self.named_overlay_stamp.store(stamp, Ordering::Release);
        true
    }

    /// The cached display-name map without a refresh: safe under the engine
    /// READ lock (no db access), at most one write behind.
    pub(crate) fn named_overlay_cached_names(&self) -> BTreeMap<String, String> {
        self.named_overlay
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .by_section
            .clone()
    }

    /// The overlay as a pure function of DB state: named intents resolved
    /// onto the visible catalogue by core coverage.
    fn compute_named_overlay(&self) -> NamedOverlay {
        let intents = self.named_intent_rows();
        if intents.is_empty() {
            return NamedOverlay::default();
        }
        let visible = self.visible_rows_for_resolution();

        // Polylines parse lazily, only for rows that pass an intent's bbox
        // gate — the recompute runs after any write on the connection, so it
        // must not deserialise the whole catalogue each time.
        let mut parsed: std::collections::HashMap<usize, Option<Vec<GpsPoint>>> =
            std::collections::HashMap::new();

        // (section_id, intent index, coverage, section created_at) per
        // resolved intent, then per-section dedup for display.
        let mut resolved: Vec<(Option<usize>, f64)> = Vec::with_capacity(intents.len());
        for intent in &intents {
            let core = trim_core(&intent.footprint);
            let core_bbox = bbox(&core);
            let mid_lat = (core_bbox.0 + core_bbox.1) / 2.0;
            let mut candidates: Vec<(usize, f64, f64)> = Vec::new();
            for (vi, row) in visible.iter().enumerate() {
                if !bboxes_touch(core_bbox, row.bbox, mid_lat) {
                    continue;
                }
                let polyline = parsed.entry(vi).or_insert_with(|| {
                    serde_json::from_str::<Vec<GpsPoint>>(&row.polyline_json)
                        .ok()
                        .filter(|p| !p.is_empty())
                });
                let Some(polyline) = polyline else { continue };
                let (cov, offset) = coverage_and_offset(&core, polyline);
                if offset > OFFSET_CEILING_M {
                    continue;
                }
                // Qualify on covering most of the core, or on being a
                // contained sub-piece of the named ground carrying at least a
                // quarter of the core — a corridor that re-emerges shorter
                // than what the user named still deserves its name.
                let qualifies = cov >= CARRY_COVERAGE
                    || (cov >= PART_FLOOR
                        && coverage_and_offset(polyline, &intent.footprint).0 >= CARRY_COVERAGE);
                if !qualifies {
                    continue;
                }
                candidates.push((vi, cov, offset));
            }
            resolved.push(select_candidate(&candidates, &visible));
        }

        // Two intents on one section: the better-covering one displays, ties
        // to the older intent. Both stay listed.
        let mut winner_per_section: BTreeMap<usize, usize> = BTreeMap::new();
        for (ii, (vi, cov)) in resolved.iter().enumerate() {
            let Some(vi) = vi else { continue };
            let replace = match winner_per_section.get(vi) {
                None => true,
                Some(&best) => {
                    *cov > resolved[best].1
                        || (*cov == resolved[best].1
                            && intents[ii].created_at < intents[best].created_at)
                }
            };
            if replace {
                winner_per_section.insert(*vi, ii);
            }
        }

        let mut overlay = NamedOverlay::default();
        for (ii, intent) in intents.into_iter().enumerate() {
            let (vi, cov) = resolved[ii];
            let primary = vi.is_some_and(|vi| winner_per_section.get(&vi) == Some(&ii));
            if primary {
                let vi = vi.expect("primary implies resolved");
                overlay
                    .by_section
                    .insert(visible[vi].id.clone(), intent.name.clone());
            }
            overlay.corridors.push(NamedCorridor {
                section_id: vi.map(|vi| visible[vi].id.clone()),
                coverage: cov,
                primary,
                intent_id: intent.intent_id,
                name: intent.name,
                footprint: intent.footprint,
                sport_type: intent.sport_type,
                created_at: intent.created_at,
            });
        }
        overlay
    }

    fn named_intent_rows(&self) -> Vec<IntentRow> {
        let Ok(mut stmt) = self.db.prepare(
            "SELECT id, name, polyline_json, sport_type, created_at
             FROM section_intents WHERE kind = 'named' AND name IS NOT NULL",
        ) else {
            return Vec::new();
        };
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, String>(4)?,
            ))
        });
        let Ok(iter) = rows else { return Vec::new() };
        iter.flatten()
            .filter_map(|(intent_id, name, polyline_json, sport_type, created_at)| {
                let footprint: Vec<GpsPoint> = serde_json::from_str(&polyline_json).ok()?;
                if footprint.is_empty() {
                    return None;
                }
                Some(IntentRow {
                    intent_id,
                    name,
                    footprint,
                    sport_type,
                    created_at,
                })
            })
            .collect()
    }

    /// Resolution candidates: AUTO rows only. User-defined and custom rows
    /// carry their own permanent row names and every display path prefers
    /// those, so letting one win a resolution would sink the corridor name
    /// invisibly. Bboxes come from the cached bounds columns; a legacy row
    /// without them parses its polyline for the bbox only.
    fn visible_rows_for_resolution(&self) -> Vec<VisibleRow> {
        let Ok(mut stmt) = self.db.prepare(
            "SELECT id, polyline_json, created_at,
                    bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng
             FROM sections
             WHERE disabled = 0 AND superseded_by IS NULL
               AND is_user_defined = 0 AND section_type = 'auto'",
        ) else {
            return Vec::new();
        };
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<f64>>(3)?,
                row.get::<_, Option<f64>>(4)?,
                row.get::<_, Option<f64>>(5)?,
                row.get::<_, Option<f64>>(6)?,
            ))
        });
        let Ok(iter) = rows else { return Vec::new() };
        iter.flatten()
            .filter_map(|(id, polyline_json, created_at, lat0, lat1, lng0, lng1)| {
                let bb = match (lat0, lat1, lng0, lng1) {
                    (Some(a), Some(b), Some(c), Some(d)) => (a, b, c, d),
                    _ => {
                        let polyline: Vec<GpsPoint> = serde_json::from_str(&polyline_json).ok()?;
                        if polyline.is_empty() {
                            return None;
                        }
                        bbox(&polyline)
                    }
                };
                Some(VisibleRow {
                    id,
                    polyline_json,
                    created_at,
                    bbox: bb,
                })
            })
            .collect()
    }

    /// Display precedence on a full section read: a user-defined or custom
    /// row keeps its own name; an auto row shows its resolved corridor name
    /// when one exists, its generated name otherwise.
    pub(crate) fn apply_named_overlay_to_section(&self, section: &mut crate::sections::Section) {
        if section.is_user_defined || section.section_type != crate::sections::SectionType::Auto {
            return;
        }
        self.ensure_named_overlay();
        let overlay = self.named_overlay.read().unwrap_or_else(|e| e.into_inner());
        if let Some(name) = overlay.by_section.get(&section.id) {
            section.name = Some(name.clone());
        }
    }

    /// Same precedence on the summaries read the list UI uses.
    pub(crate) fn apply_named_overlay_to_summary(
        &self,
        summary: &mut crate::sections::SectionSummary,
    ) {
        if summary.is_user_defined || summary.section_type != "auto" {
            return;
        }
        self.ensure_named_overlay();
        let overlay = self.named_overlay.read().unwrap_or_else(|e| e.into_inner());
        if let Some(name) = overlay.by_section.get(&summary.id) {
            summary.name = Some(name.clone());
        }
    }

    /// Same precedence on a FrequentSection read (the section LRU path).
    /// Resolution candidates are auto rows only, so id presence in the map
    /// already implies an auto section.
    pub(crate) fn apply_named_overlay_to_frequent(
        &self,
        section: &mut tracematch::FrequentSection,
    ) {
        if section.is_user_defined {
            return;
        }
        self.ensure_named_overlay();
        let overlay = self.named_overlay.read().unwrap_or_else(|e| e.into_inner());
        if let Some(name) = overlay.by_section.get(&section.id) {
            section.name = Some(name.clone());
        }
    }

    /// The corridor name an in-memory auto section resolves to, for the
    /// slice-backed name reads.
    pub(crate) fn named_overlay_name(&self, section_id: &str) -> Option<String> {
        self.ensure_named_overlay();
        self.named_overlay
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .by_section
            .get(section_id)
            .cloned()
    }

    /// Every named corridor with its current resolution, dormant included.
    pub fn get_named_corridors(&self) -> Vec<NamedCorridor> {
        self.ensure_named_overlay();
        self.named_overlay
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .corridors
            .clone()
    }

    /// Delete a named intent outright. The name is gone for good; the
    /// section it resolved to falls back to its generated name.
    pub fn remove_named_corridor(&mut self, intent_id: &str) -> rusqlite::Result<()> {
        self.db.execute(
            "DELETE FROM section_intents WHERE id = ? AND kind = 'named'",
            params![intent_id],
        )?;
        Ok(())
    }

    /// Route a name write for an AUTO section into the intent table: relabel
    /// the intent already covering this section (by resolution, or by ground
    /// when the section is dormant or hidden), or record a new one capturing
    /// the section's current footprint. Generated-shaped names stay
    /// row-local: they are the engine's own labels, not user data, and a
    /// durable intent for one would freeze every "Section N" a backup
    /// restore replays through this path.
    pub(crate) fn upsert_named_intent_for(
        &mut self,
        section_id: &str,
        name: &str,
    ) -> rusqlite::Result<()> {
        if looks_generated(name) {
            self.db.execute(
                "UPDATE sections SET name = ? WHERE id = ?",
                params![name, section_id],
            )?;
            if let Some(section) = self.sections.iter_mut().find(|s| s.id == section_id) {
                section.name = Some(name.to_string());
            }
            return Ok(());
        }

        let row: Option<(String, Option<String>)> = self
            .db
            .query_row(
                "SELECT polyline_json, sport_type FROM sections WHERE id = ?",
                params![section_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let Some((polyline_json, sport_type)) = row else {
            return Ok(());
        };

        self.ensure_named_overlay();
        let existing = {
            let overlay = self.named_overlay.read().unwrap_or_else(|e| e.into_inner());
            overlay
                .corridors
                .iter()
                .find(|c| c.primary && c.section_id.as_deref() == Some(section_id))
                .map(|c| (c.intent_id.clone(), c.name.clone()))
                .or_else(|| {
                    // No live resolution (dormant, disabled, superseded):
                    // fall back to the ground so repeated renames relabel one
                    // intent instead of stacking new ones.
                    let polyline: Vec<GpsPoint> =
                        serde_json::from_str(&polyline_json).unwrap_or_default();
                    overlay
                        .corridors
                        .iter()
                        .find(|c| !polyline.is_empty() && shares_ground(&polyline, &c.footprint))
                        .map(|c| (c.intent_id.clone(), c.name.clone()))
                })
        };
        if let Some((intent_id, current)) = existing {
            if current != name {
                // The referent stays the originally named ground; only the
                // label changes.
                self.db.execute(
                    "UPDATE section_intents SET name = ? WHERE id = ? AND kind = 'named'",
                    params![name, intent_id],
                )?;
            }
            return Ok(());
        }

        let intent_id = format!(
            "ni_{}_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0),
            section_id,
        );
        self.db.execute(
            "INSERT INTO section_intents (id, kind, polyline_json, created_at, name, sport_type)
             VALUES (?, 'named', ?, datetime('now'), ?, ?)",
            params![intent_id, polyline_json, name, sport_type],
        )?;
        Ok(())
    }

    /// Promotion handoff: when a named auto section becomes user-owned
    /// (accept, set-reference, merge), the resolved corridor name moves onto
    /// the row — the permanent home for user-owned rows — and the intent
    /// retires so it cannot re-resolve onto neighbouring auto ground.
    pub(crate) fn adopt_corridor_name(&mut self, section_id: &str) {
        self.ensure_named_overlay();
        let adopted = self
            .named_overlay
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .corridors
            .iter()
            .find(|c| c.primary && c.section_id.as_deref() == Some(section_id))
            .map(|c| (c.intent_id.clone(), c.name.clone()));
        let Some((intent_id, name)) = adopted else {
            return;
        };
        let _ = self.db.execute(
            "UPDATE sections SET name = ? WHERE id = ?",
            params![name, section_id],
        );
        let _ = self.db.execute(
            "DELETE FROM section_intents WHERE id = ? AND kind = 'named'",
            params![intent_id],
        );
        if let Some(section) = self.sections.iter_mut().find(|s| s.id == section_id) {
            section.name = Some(name);
        }
        self.invalidate_section_cache(section_id);
    }

    /// Unname an auto section: delete the intent currently resolving to it,
    /// if any.
    pub(crate) fn delete_named_intent_for(&mut self, section_id: &str) -> rusqlite::Result<()> {
        self.ensure_named_overlay();
        let existing: Vec<String> = self
            .named_overlay
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .corridors
            .iter()
            .filter(|c| c.primary && c.section_id.as_deref() == Some(section_id))
            .map(|c| c.intent_id.clone())
            .collect();
        for intent_id in existing {
            self.db.execute(
                "DELETE FROM section_intents WHERE id = ? AND kind = 'named'",
                params![intent_id],
            )?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pt(lat: f64, lng: f64) -> GpsPoint {
        GpsPoint {
            latitude: lat,
            longitude: lng,
            elevation: Some(500.0),
        }
    }

    /// A straight north line of `n` points spaced ~`step_m`.
    fn line(n: usize, step_m: f64, east_m: f64) -> Vec<GpsPoint> {
        (0..n)
            .map(|i| {
                pt(
                    46.0 + (i as f64 * step_m) / 111_320.0,
                    7.0 + east_m / (111_320.0 * 46.0_f64.to_radians().cos()),
                )
            })
            .collect()
    }

    #[test]
    fn core_trims_ends_but_never_below_floor() {
        let long = line(200, 10.0, 0.0); // ~2 km
        let core = trim_core(&long);
        assert!(core.len() < long.len(), "a long footprint must trim");
        assert!(core.len() > long.len() / 2, "the core keeps the middle 70%");

        let short = line(10, 10.0, 0.0); // ~90 m, under the floor
        assert_eq!(trim_core(&short).len(), short.len());
    }

    #[test]
    fn candidate_selection_is_order_independent() {
        let visible: Vec<VisibleRow> = (0..3)
            .map(|i| VisibleRow {
                id: format!("s{i}"),
                polyline_json: String::new(),
                created_at: format!("2026-01-0{}", i + 1),
                bbox: (0.0, 0.0, 0.0, 0.0),
            })
            .collect();
        // Pathological near-tie chain: pairwise tie bands overlap so a naive
        // banded comparator is intransitive. The winner must not depend on
        // input order.
        let a = vec![(0usize, 0.34, 10.0), (1, 0.30, 5.0), (2, 0.26, 1.0)];
        let b = vec![(2usize, 0.26, 1.0), (1, 0.30, 5.0), (0, 0.34, 10.0)];
        assert_eq!(
            select_candidate(&a, &visible),
            select_candidate(&b, &visible)
        );
        // Band anchors at the maximum: 0.26 falls outside 0.34 - 0.05, so the
        // winner is the lower-offset member of {0.34, 0.30}.
        assert_eq!(select_candidate(&a, &visible).0, Some(1));
    }

    #[test]
    fn generated_shapes_are_recognised() {
        assert!(looks_generated("Section 7"));
        assert!(looks_generated("Ride Section 12"));
        assert!(!looks_generated("Col des Planches"));
        assert!(!looks_generated("Evening loop"));
        assert!(!looks_generated("7"));
    }

    #[test]
    fn offset_discriminates_a_parallel_twin() {
        let named = line(100, 10.0, 0.0);
        let twin = line(100, 10.0, 30.0);
        let (cov_self, off_self) = coverage_and_offset(&named, &named);
        let (cov_twin, off_twin) = coverage_and_offset(&named, &twin);
        assert!(cov_self >= 0.99);
        assert!(off_self < 1.0);
        assert!(
            cov_twin > CARRY_COVERAGE,
            "the twin must clear coverage at the 50 m tolerance for the offset ceiling to matter"
        );
        assert!(
            off_self < OFFSET_CEILING_M && off_twin > OFFSET_CEILING_M,
            "the ceiling must separate the named line ({off_self:.1} m) from the twin ({off_twin:.1} m)"
        );
    }
}
