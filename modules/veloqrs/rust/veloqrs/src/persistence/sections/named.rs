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
//! The scoring itself (core trimming, coverage and offset, qualification,
//! tie-broken selection) is the pure layer's: `tracematch::sections::naming`.
//! This module owns intent storage, SQL, and the lazy overlay cache.
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
use tracematch::sections::{
    GROUND_TOL_M, NamedCandidate, score_named_candidate, select_candidate, shares_ground, trim_core,
};

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

/// Whether a name has the shape of the engine's own generated labels:
/// "<word> N" or the legacy "<sport> <word> N", language-agnostic by token
/// shape. Such names are never user data: the naming path keeps them
/// row-local and the migration backfill skips them. A real user name of
/// that shape ("Route 66") is misclassified and stays row-local, no worse
/// than before named corridors existed.
pub(crate) fn looks_generated(name: &str) -> bool {
    let tokens: Vec<&str> = name.split_whitespace().collect();
    matches!(tokens.len(), 2 | 3)
        && tokens
            .last()
            .is_some_and(|t| !t.is_empty() && t.chars().all(|c| c.is_ascii_digit()))
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
    polyline_blob: Option<Vec<u8>>,
    polyline_json: Option<String>,
    created_at: String,
    bbox: (f64, f64, f64, f64),
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
        // gate, the recompute runs after any write on the connection, so it
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
            let mut candidates: Vec<(usize, tracematch::sections::NamedScore)> = Vec::new();
            for (vi, row) in visible.iter().enumerate() {
                if !bboxes_touch(core_bbox, row.bbox, mid_lat) {
                    continue;
                }
                let polyline = parsed.entry(vi).or_insert_with(|| {
                    crate::persistence::codec::decode_polyline_row(
                        row.polyline_blob.as_deref(),
                        row.polyline_json.as_deref(),
                    )
                    .ok()
                    .filter(|p| !p.is_empty())
                });
                let Some(polyline) = polyline else { continue };
                let Some(score) = score_named_candidate(&core, &intent.footprint, polyline) else {
                    continue;
                };
                candidates.push((vi, score));
            }
            let scored: Vec<NamedCandidate> = candidates
                .iter()
                .map(|&(vi, score)| NamedCandidate {
                    score,
                    created_at: &visible[vi].created_at,
                    id: &visible[vi].id,
                })
                .collect();
            resolved.push(match select_candidate(&scored) {
                Some((i, cov)) => (Some(candidates[i].0), cov),
                None => (None, 0.0),
            });
        }

        // Fallback pass: an intent with no visible cover resolves against
        // the hidden catalogue so the restore list shows the user's name on
        // a disabled or superseded row. The corridor entry itself stays
        // dormant, no visible section carries the name.
        let mut hidden_pairs: Vec<(String, String)> = Vec::new();
        if resolved.iter().any(|(vi, _)| vi.is_none()) {
            let hidden = self.hidden_rows_for_resolution();
            let mut parsed_hidden: std::collections::HashMap<usize, Option<Vec<GpsPoint>>> =
                std::collections::HashMap::new();
            // hidden row index -> (intent index, coverage)
            let mut hidden_winner: BTreeMap<usize, (usize, f64)> = BTreeMap::new();
            for (ii, intent) in intents.iter().enumerate() {
                if resolved[ii].0.is_some() || hidden.is_empty() {
                    continue;
                }
                let core = trim_core(&intent.footprint);
                let core_bbox = bbox(&core);
                let mid_lat = (core_bbox.0 + core_bbox.1) / 2.0;
                let mut candidates: Vec<(usize, tracematch::sections::NamedScore)> = Vec::new();
                for (hi, row) in hidden.iter().enumerate() {
                    if !bboxes_touch(core_bbox, row.bbox, mid_lat) {
                        continue;
                    }
                    let polyline = parsed_hidden.entry(hi).or_insert_with(|| {
                        crate::persistence::codec::decode_polyline_row(
                            row.polyline_blob.as_deref(),
                            row.polyline_json.as_deref(),
                        )
                        .ok()
                        .filter(|p| !p.is_empty())
                    });
                    let Some(polyline) = polyline else { continue };
                    let Some(score) = score_named_candidate(&core, &intent.footprint, polyline)
                    else {
                        continue;
                    };
                    candidates.push((hi, score));
                }
                let scored: Vec<NamedCandidate> = candidates
                    .iter()
                    .map(|&(hi, score)| NamedCandidate {
                        score,
                        created_at: &hidden[hi].created_at,
                        id: &hidden[hi].id,
                    })
                    .collect();
                if let Some((i, cov)) = select_candidate(&scored) {
                    let hi = candidates[i].0;
                    let replace = match hidden_winner.get(&hi) {
                        None => true,
                        Some(&(best_ii, best_cov)) => {
                            cov > best_cov
                                || (cov == best_cov
                                    && intent.created_at < intents[best_ii].created_at)
                        }
                    };
                    if replace {
                        hidden_winner.insert(hi, (ii, cov));
                    }
                }
            }
            for (hi, (ii, _)) in hidden_winner {
                hidden_pairs.push((hidden[hi].id.clone(), intents[ii].name.clone()));
            }
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
        for (sid, name) in hidden_pairs {
            overlay.by_section.insert(sid, name);
        }
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
                    bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
                    polyline_blob
             FROM sections
             WHERE disabled = 0 AND superseded_by IS NULL
               AND is_user_defined = 0 AND section_type = 'auto'",
        ) else {
            return Vec::new();
        };
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<f64>>(3)?,
                row.get::<_, Option<f64>>(4)?,
                row.get::<_, Option<f64>>(5)?,
                row.get::<_, Option<f64>>(6)?,
                row.get::<_, Option<Vec<u8>>>(7)?,
            ))
        });
        let Ok(iter) = rows else { return Vec::new() };
        iter.flatten()
            .filter_map(
                |(id, polyline_json, created_at, lat0, lat1, lng0, lng1, polyline_blob)| {
                    let bb = match (lat0, lat1, lng0, lng1) {
                        (Some(a), Some(b), Some(c), Some(d)) => (a, b, c, d),
                        _ => {
                            let polyline = crate::persistence::codec::decode_polyline_row(
                                polyline_blob.as_deref(),
                                polyline_json.as_deref(),
                            )
                            .ok()?;
                            if polyline.is_empty() {
                                return None;
                            }
                            bbox(&polyline)
                        }
                    };
                    Some(VisibleRow {
                        id,
                        polyline_blob,
                        polyline_json,
                        created_at,
                        bbox: bb,
                    })
                },
            )
            .collect()
    }

    /// Hidden counterparts of `visible_rows_for_resolution`: disabled or
    /// superseded auto rows. The restore list is made of exactly these, so
    /// an intent with no visible cover falls back to them, a named then
    /// disabled corridor must not read "Section N" on the one list whose
    /// job is showing it.
    fn hidden_rows_for_resolution(&self) -> Vec<VisibleRow> {
        let Ok(mut stmt) = self.db.prepare(
            "SELECT id, polyline_json, created_at,
                    bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
                    polyline_blob
             FROM sections
             WHERE (disabled = 1 OR superseded_by IS NOT NULL)
               AND is_user_defined = 0 AND section_type = 'auto'",
        ) else {
            return Vec::new();
        };
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<f64>>(3)?,
                row.get::<_, Option<f64>>(4)?,
                row.get::<_, Option<f64>>(5)?,
                row.get::<_, Option<f64>>(6)?,
                row.get::<_, Option<Vec<u8>>>(7)?,
            ))
        });
        let Ok(iter) = rows else { return Vec::new() };
        iter.flatten()
            .filter_map(
                |(id, polyline_json, created_at, lat0, lat1, lng0, lng1, polyline_blob)| {
                    let bb = match (lat0, lat1, lng0, lng1) {
                        (Some(a), Some(b), Some(c), Some(d)) => (a, b, c, d),
                        _ => {
                            let polyline = crate::persistence::codec::decode_polyline_row(
                                polyline_blob.as_deref(),
                                polyline_json.as_deref(),
                            )
                            .ok()?;
                            if polyline.is_empty() {
                                return None;
                            }
                            bbox(&polyline)
                        }
                    };
                    Some(VisibleRow {
                        id,
                        polyline_blob,
                        polyline_json,
                        created_at,
                        bbox: bb,
                    })
                },
            )
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

        let sport_type: Option<Option<String>> = self
            .db
            .query_row(
                "SELECT sport_type FROM sections WHERE id = ?",
                params![section_id],
                |row| row.get(0),
            )
            .optional()?;
        let Some(sport_type) = sport_type else {
            return Ok(());
        };
        // The intent carries its own JSON footprint, so serialise the section's
        // decoded geometry rather than copying the now-placeholder column.
        let polyline: Vec<GpsPoint> = self.stored_section_polyline(section_id).unwrap_or_default();
        let polyline_json = serde_json::to_string(&polyline).unwrap_or_else(|_| "[]".to_string());

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
    /// the row, the permanent home for user-owned rows, and the intent
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

    #[test]
    fn generated_shapes_are_recognised() {
        assert!(looks_generated("Section 7"));
        assert!(looks_generated("Ride Section 12"));
        assert!(!looks_generated("Col des Planches"));
        assert!(!looks_generated("Evening loop"));
        assert!(!looks_generated("7"));
    }
}
