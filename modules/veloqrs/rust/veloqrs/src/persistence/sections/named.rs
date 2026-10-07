//! Named corridors: a section name as permanent user data keyed to ground.
//!
//! Naming an auto section writes a `section_intents` row (kind 'named')
//! holding the name and the footprint the user named, never the section row:
//! auto rows are wiped and re-cut by detection, so anything row-local is
//! cache-class. The name is resolved back onto the catalogue by covering
//! ground: the visible section covering the largest share of the footprint's
//! core carries the name, ties broken by smaller lateral offset, matching
//! extent on exact score ties, then older section and id. A contained sub-piece
//! of the named ground qualifies from a quarter of the core, so a corridor that
//! re-emerges shorter than what was
//! named keeps its name. A resolution is refused outright when the covered
//! core sits further from the section than half the ground tolerance on
//! average, so a name never migrates onto a parallel twin. An intent nothing
//! qualifies for is dormant: kept forever, resurfacing the moment its ground
//! re-emerges.
//!
//! Naming never suppresses and never promotes, but it freezes: naming an auto
//! section pins it at its current line (`set_section_name`), and a pinned
//! section keeps its polyline, id and name through detection while a fresh cut
//! over its ground is withheld. The intent itself still takes no part in
//! detection (the emitter's suppression read is kind-filtered, see
//! `durable_intent_rows`).
//!
//! Core trimming, coverage, qualification and the initial candidate selection
//! are in `tracematch::sections::naming`. This module owns intent storage, SQL,
//! exact extent ties and the lazy overlay cache.
//!
//! A name that resolves onto a split child moves up the ledger's lineage to the
//! row still carrying the original section's id, so the id and the name stay on
//! one section and its siblings read as its parts.
//!
//! The overlay is a pure function of DB state (intent rows + visible section
//! rows), refreshed lazily: it is recomputed whenever the connection's
//! `total_changes()` counter has moved since the last compute. Every write to
//! the inputs goes through this connection, so staleness is impossible by
//! construction and no mutation site needs to remember an invalidation call.
//! With no named intents the refresh check is one counter read.

use std::collections::BTreeMap;
use std::sync::Arc;

use rusqlite::{OptionalExtension, params};
use tracematch::GpsPoint;
use tracematch::sections::{
    GROUND_TOL_M, NamedCandidate, score_named_candidate, select_candidate, shares_ground, trim_core,
};

use super::super::PersistentEngine;
use super::super::codec;
use super::geometry;

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

/// Whether a name is one of the engine's own handles: the section word in
/// any shipped language and a number, bare or behind a sport. Every other
/// stored name is the athlete's, whatever it ends in: "Col 2" and "Route 66"
/// are typed names.
pub(crate) fn is_section_handle(name: &str) -> bool {
    super::numbers::label_number(name, &super::super::get_section_word()).is_some()
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
    representative_activity_id: Option<String>,
    rep_start_index: Option<u32>,
    rep_end_index: Option<u32>,
    created_at: String,
    bbox: (f64, f64, f64, f64),
}

impl VisibleRow {
    fn line(&self, conn: &rusqlite::Connection) -> Option<Vec<GpsPoint>> {
        let reference = geometry::reference(
            self.representative_activity_id.as_deref(),
            self.rep_start_index,
            self.rep_end_index,
        );
        geometry::line(
            conn,
            self.polyline_blob.as_deref(),
            self.polyline_json.as_deref(),
            reference,
        )
        .ok()
        .filter(|line| !line.is_empty())
    }
}

impl PersistentEngine {
    /// Bring the overlay up to date with the DB. Returns whether a recompute
    /// ran, so `&mut` callers holding derived caches (the section LRU) know
    /// to drop them. The recompute itself only SELECTs, so it never moves the
    /// counter it is keyed on.
    ///
    /// Queries `self.db`, so it runs under the engine lock like every other
    /// method that reaches SQLite. A pooled reader resolves the overlay from
    /// the intent rows instead, through `pooled::overlay_names`.
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

    /// The name that shows over each section's row: its corridor name from
    /// the cached overlay, at most one write behind, or the numbered label of
    /// a section with no name of its own, read now.
    pub(crate) fn named_overlay_cached_names(&self) -> BTreeMap<String, String> {
        let mut names = super::numbers::unnamed_labels(&self.db);
        let overlay = self.named_overlay.read().unwrap_or_else(|e| e.into_inner());
        super::numbers::compose_split_labels(&self.db, &mut names, &overlay.by_section, || {
            Arc::new(super::numbers::split_lineage(&self.db))
        });
        names.extend(
            overlay
                .by_section
                .iter()
                .map(|(id, name)| (id.clone(), name.clone())),
        );
        names
    }

    /// The overlay as a pure function of DB state: named intents resolved
    /// onto the visible catalogue by core coverage.
    /// The overlay as a pure function of DB state: named intents resolved
    /// onto the visible catalogue by core coverage. The computation itself is
    /// [`compute::compute_overlay`], shared with the pooled reader.
    fn compute_named_overlay(&self) -> NamedOverlay {
        compute::compute_overlay(&self.db)
    }

    /// Display precedence on a full section read: a user-defined or custom
    /// row keeps its own name; an auto row shows its resolved corridor name
    /// when one exists, its row's name otherwise. A section left with no name
    /// shows its numbered label.
    pub(crate) fn apply_named_overlay_to_section(&self, section: &mut crate::sections::Section) {
        if !section.is_user_defined && section.section_type == crate::sections::SectionType::Auto {
            self.ensure_named_overlay();
            let overlay = self.named_overlay.read().unwrap_or_else(|e| e.into_inner());
            if let Some(name) = overlay.by_section.get(&section.id) {
                section.name = Some(name.clone());
            }
        }
        if section.name.is_none() {
            self.ensure_named_overlay();
            let overlay = self.named_overlay.read().unwrap_or_else(|e| e.into_inner());
            section.name =
                super::numbers::unnamed_label(&self.db, &section.id, &overlay.by_section);
        }
    }

    /// Same precedence on a FrequentSection read (the section LRU path).
    /// Resolution candidates are auto rows only, so id presence in the map
    /// already implies an auto section.
    pub(crate) fn apply_named_overlay_to_frequent(
        &self,
        section: &mut tracematch::FrequentSection,
    ) {
        if !section.is_user_defined {
            self.ensure_named_overlay();
            let overlay = self.named_overlay.read().unwrap_or_else(|e| e.into_inner());
            if let Some(name) = overlay.by_section.get(&section.id) {
                section.name = Some(name.clone());
            }
        }
        if section.name.is_none() {
            self.ensure_named_overlay();
            let overlay = self.named_overlay.read().unwrap_or_else(|e| e.into_inner());
            section.name =
                super::numbers::unnamed_label(&self.db, &section.id, &overlay.by_section);
        }
    }

    /// The name that shows over an in-memory section's row, for the
    /// slice-backed name reads: its corridor name, or its numbered label when
    /// the row has no name.
    pub(crate) fn named_overlay_name(&self, section_id: &str) -> Option<String> {
        self.ensure_named_overlay();
        let overlay = self.named_overlay.read().unwrap_or_else(|e| e.into_inner());
        overlay
            .by_section
            .get(section_id)
            .cloned()
            .or_else(|| super::numbers::unnamed_label(&self.db, section_id, &overlay.by_section))
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
        self.ensure_named_overlay();
        Ok(())
    }

    /// Route a name write for an AUTO section into the intent table: relabel
    /// the intent already covering this section (by resolution, or by ground
    /// when the section is dormant or hidden), or record a new one capturing
    /// the section's current footprint. A handle stays row-local: it is the
    /// engine's own label, not user data, and a durable intent for one would
    /// freeze every "Section N" a backup restore replays through this path.
    ///
    /// A section whose line cannot be read is refused: the intent would carry
    /// no footprint, and an intent without one never resolves.
    pub(crate) fn upsert_named_intent_for(
        &mut self,
        section_id: &str,
        name: &str,
    ) -> Result<(), String> {
        if is_section_handle(name) {
            self.db
                .execute(
                    "UPDATE sections SET name = ? WHERE id = ?",
                    params![name, section_id],
                )
                .map_err(|e| e.to_string())?;
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
            .optional()
            .map_err(|e| e.to_string())?;
        let Some(sport_type) = sport_type else {
            return Ok(());
        };
        // The intent carries its own footprint, the section's decoded line.
        let polyline: Vec<GpsPoint> = self
            .stored_section_polyline(section_id)
            .ok()
            .filter(|line| !line.is_empty())
            .ok_or_else(|| format!("Section {section_id} has no readable line to name"))?;

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
                        .find(|c| c.section_id.is_none() && shares_ground(&polyline, &c.footprint))
                        .map(|c| (c.intent_id.clone(), c.name.clone()))
                })
        };
        if let Some((intent_id, current)) = existing {
            if current != name {
                // The referent stays the originally named ground; only the
                // label changes.
                self.db
                    .execute(
                        "UPDATE section_intents SET name = ? WHERE id = ? AND kind = 'named'",
                        params![name, intent_id],
                    )
                    .map_err(|e| e.to_string())?;
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
        self.db
            .execute(
                "INSERT INTO section_intents (id, kind, polyline_blob, created_at, name, sport_type)
                 VALUES (?, 'named', ?, datetime('now'), ?, ?)",
                params![
                    intent_id,
                    codec::serialize_track_points(&polyline),
                    name,
                    sport_type
                ],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Promotion handoff: when a named auto section becomes user-owned
    /// (accept, set-reference, merge, trim, expand), the resolved corridor
    /// name moves onto the row, the permanent home for user-owned rows, and
    /// the intent retires so it cannot re-resolve onto neighbouring auto
    /// ground.
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
        assert!(is_section_handle("Section 7"));
        assert!(is_section_handle("Ride Section 12"));
        assert!(!is_section_handle("Col 2"));
        assert!(!is_section_handle("Route 66"));
        assert!(!is_section_handle("Hill climb 2"));
        assert!(!is_section_handle("Col des Planches"));
        assert!(!is_section_handle("Evening loop"));
        assert!(!is_section_handle("7"));
    }

    /// An auto section whose stored line cannot be decoded and has no
    /// reference to rebuild it from.
    fn engine_with_an_unreadable_auto_section() -> PersistentEngine {
        let engine = PersistentEngine::in_memory().unwrap();
        engine
            .db
            .execute(
                "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                     distance_meters, is_user_defined, version, created_at)
                 VALUES ('s0', 'auto', ?, 'Ride', '[]', 900.0, 0, 1, '2026-01-01T00:00:00Z')",
                params!["Col des Planches"],
            )
            .unwrap();
        engine
    }

    fn named_intents(engine: &PersistentEngine) -> i64 {
        engine
            .db
            .query_row(
                "SELECT COUNT(*) FROM section_intents WHERE kind = 'named'",
                [],
                |row| row.get(0),
            )
            .unwrap()
    }

    fn row_name(engine: &PersistentEngine) -> Option<String> {
        engine
            .db
            .query_row("SELECT name FROM sections WHERE id = 's0'", [], |row| {
                row.get(0)
            })
            .unwrap()
    }

    #[test]
    fn naming_a_section_whose_line_cannot_be_read_is_refused() {
        let mut engine = engine_with_an_unreadable_auto_section();

        assert!(
            engine
                .set_section_name("s0", Some("Col de la Croix"))
                .is_err()
        );

        assert_eq!(named_intents(&engine), 0);
    }

    fn engine_with_a_stored_line_and_no_geometry_version() -> PersistentEngine {
        let engine = PersistentEngine::in_memory().unwrap();
        let line = vec![GpsPoint::new(46.0, 7.0), GpsPoint::new(46.001, 7.0)];
        engine
            .db
            .execute(
                "INSERT INTO sections (id, section_type, sport_type, polyline_json,
                     distance_meters, is_user_defined, version, created_at)
                 VALUES ('s0', 'auto', 'Ride', ?, 110.0, 0, 1, '2026-01-01T00:00:00Z')",
                params![serde_json::to_string(&line).unwrap()],
            )
            .unwrap();
        engine
    }

    fn pin_rows(engine: &PersistentEngine) -> Vec<(String, i64)> {
        let mut stmt = engine
            .db
            .prepare("SELECT section_id, version FROM section_pins")
            .unwrap();
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    #[test]
    fn naming_a_section_with_no_stored_version_writes_the_first_and_pins_it() {
        let mut engine = engine_with_a_stored_line_and_no_geometry_version();

        engine
            .set_section_name("s0", Some("Col de la Croix"))
            .unwrap();

        assert_eq!(pin_rows(&engine), vec![("s0".to_string(), 1)]);
        assert_eq!(engine.section_geometry_versions("s0").len(), 1);
    }

    #[test]
    fn renaming_again_keeps_the_one_pin_and_its_version() {
        let mut engine = engine_with_a_stored_line_and_no_geometry_version();
        engine
            .set_section_name("s0", Some("Col de la Croix"))
            .unwrap();

        engine
            .set_section_name("s0", Some("Col de la Forclaz"))
            .unwrap();
        engine.set_section_name("s0", None).unwrap();

        assert_eq!(pin_rows(&engine), vec![("s0".to_string(), 1)]);
        assert_eq!(engine.section_geometry_versions("s0").len(), 1);
    }

    #[test]
    fn a_refused_name_writes_no_pin() {
        let mut engine = engine_with_an_unreadable_auto_section();

        assert!(
            engine
                .set_section_name("s0", Some("Col de la Croix"))
                .is_err()
        );

        assert!(pin_rows(&engine).is_empty());
    }

    fn insert_section(engine: &PersistentEngine, id: &str, section_type: &str, name: &str) {
        engine
            .db
            .execute(
                "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                     distance_meters, is_user_defined, version, created_at)
                 VALUES (?, ?, ?, 'Ride', '[]', 900.0, ?, 1, '2026-01-01T00:00:00Z')",
                params![id, section_type, name, section_type == "custom"],
            )
            .unwrap();
    }

    #[test]
    fn a_rename_to_the_handle_another_section_shows_is_refused() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        insert_section(&engine, "s12", "auto", "Section 12");
        insert_section(&engine, "mine", "custom", "Evening loop");

        let refused = engine.set_section_name("mine", Some("Section 12"));

        assert_eq!(
            refused,
            Err(crate::persistence::SectionNameError::Taken(
                "Section 12".into()
            ))
        );
        let kept: String = engine
            .db
            .query_row("SELECT name FROM sections WHERE id = 'mine'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(kept, "Evening loop");
    }

    #[test]
    fn a_rename_to_the_name_of_a_dormant_corridor_is_refused() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        insert_section(&engine, "mine", "custom", "Evening loop");
        engine
            .db
            .execute(
                "INSERT INTO section_intents (id, kind, polyline_json, created_at, name, sport_type)
                 VALUES ('ni_dormant', 'named', ?, '2026-01-01T00:00:00Z', 'Col X', 'Ride')",
                params![r#"[{"latitude":46.0,"longitude":7.0},{"latitude":46.001,"longitude":7.0}]"#],
            )
            .unwrap();
        assert_eq!(engine.get_named_corridors()[0].section_id, None);

        let refused = engine.set_section_name("mine", Some("Col X"));

        assert_eq!(
            refused,
            Err(crate::persistence::SectionNameError::Taken("Col X".into()))
        );
    }

    #[test]
    fn a_handle_stays_refused_once_the_section_holding_it_is_renamed() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        insert_section(&engine, "first", "custom", "Section 1");
        insert_section(&engine, "mine", "custom", "Evening loop");
        engine.set_section_name("first", Some("Col X")).unwrap();

        assert!(engine.set_section_name("mine", Some("Section 1")).is_err());

        let stored: String = engine
            .db
            .query_row("SELECT name FROM sections WHERE id = 'mine'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(stored, "Evening loop");
    }

    #[test]
    fn a_section_typing_its_own_handle_clears_its_name() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        insert_section(&engine, "first", "custom", "Evening loop");

        engine.set_section_name("first", Some("Section 1")).unwrap();

        let stored: Option<String> = engine
            .db
            .query_row("SELECT name FROM sections WHERE id = 'first'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(stored, None);
    }

    #[test]
    fn the_legacy_backfill_keeps_a_name_whose_line_cannot_be_read() {
        let engine = engine_with_an_unreadable_auto_section();

        let promoted = PersistentEngine::promote_legacy_named_rows(&engine.db, &engine.db, true)
            .expect("backfill");

        assert_eq!(promoted, 0);
        assert_eq!(named_intents(&engine), 0);
        assert_eq!(row_name(&engine).as_deref(), Some("Col des Planches"));
    }

    fn quay_line() -> Vec<GpsPoint> {
        (0..60)
            .map(|i| GpsPoint::new(46.5 + f64::from(i) * 0.0002, 6.6))
            .collect()
    }

    fn catalogue_section(id: &str, polyline: Vec<GpsPoint>) -> tracematch::FrequentSection {
        let range = Some((0, polyline.len() as u32));
        tracematch::FrequentSection {
            id: id.to_string(),
            name: None,
            sport_type: "Ride".to_string(),
            distance_meters: 1200.0,
            point_density: vec![2; polyline.len()],
            polyline,
            representative_activity_id: "rep".to_string(),
            representative_range: range,
            activity_ids: vec![],
            activity_portions: vec![],
            visit_count: 0,
            activity_traces: std::collections::HashMap::new(),
            confidence: 0.9,
            observation_count: 3,
            average_spread: 4.0,
            scale: None,
            is_user_defined: false,
            stability: 1.0,
            elevation_gain_m: None,
            avg_grade_percent: None,
            version: 1,
            updated_at: None,
            created_at: None,
            enrichment: Default::default(),
            rank: None,
            consensus_state: None,
        }
    }

    fn insert_auto_with_line(engine: &PersistentEngine, id: &str, line: &[GpsPoint]) {
        engine
            .db
            .execute(
                "INSERT INTO sections (id, section_type, sport_type, polyline_json, polyline_blob,
                     distance_meters, is_user_defined, version, created_at,
                     representative_activity_id, rep_start_index, rep_end_index, geometry_source)
                 VALUES (?, 'auto', 'Ride', '[]', ?, 1200.0, 0, 1, '2026-01-01T00:00:00Z',
                     'rep', 0, ?, 'exact')",
                params![
                    id,
                    crate::persistence::codec::serialize_track_points(line),
                    line.len() as u32
                ],
            )
            .unwrap();
    }

    fn kinds(engine: &PersistentEngine, id: &str) -> Vec<String> {
        engine
            .section_history(id)
            .into_iter()
            .map(|e| e.kind)
            .collect()
    }

    /// Scenario: a named auto section is re-cut by a detect that mints the
    /// ground under a new id, with no lineage between the two.
    /// Expected behaviour: the name now shows on the new section, and both
    /// sections carry a history row saying so.
    #[test]
    fn a_name_that_changes_holder_on_a_detect_is_written_to_both_histories() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        let line = quay_line();
        insert_auto_with_line(&engine, "old", &line);
        engine.upsert_named_intent_for("old", "Quay Rise").unwrap();
        assert_eq!(
            engine.named_overlay_name("old").as_deref(),
            Some("Quay Rise")
        );

        engine.sections = vec![catalogue_section("new", line)];
        engine
            .db
            .execute(
                "INSERT INTO section_pins (section_id, version) VALUES ('new', 1)",
                [],
            )
            .unwrap();
        engine.save_sections_with_events(&[]).unwrap();

        assert_eq!(
            engine.named_overlay_name("new").as_deref(),
            Some("Quay Rise")
        );
        assert_eq!(kinds(&engine, "old"), vec!["name_released"]);
        assert_eq!(kinds(&engine, "new"), vec!["name_taken"]);
        let details: serde_json::Value =
            serde_json::from_str(engine.section_history("new")[0].details.as_deref().unwrap())
                .unwrap();
        assert_eq!(details["name"], "Quay Rise");
        assert_eq!(details["from"], "old");
        assert_eq!(details["to"], "new");
    }

    /// Scenario: a detect re-cuts a named section and it keeps its id.
    /// Expected behaviour: no row, because the name did not move.
    #[test]
    fn a_name_that_keeps_its_holder_on_a_detect_writes_nothing() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        let line = quay_line();
        insert_auto_with_line(&engine, "same", &line);
        engine.upsert_named_intent_for("same", "Quay Rise").unwrap();

        engine.sections = vec![catalogue_section("same", line)];
        engine
            .db
            .execute(
                "INSERT INTO section_pins (section_id, version) VALUES ('same', 1)",
                [],
            )
            .unwrap();
        engine.save_sections_with_events(&[]).unwrap();

        assert!(kinds(&engine, "same").is_empty());
    }
}

/// The overlay, computed from the database and nothing else.
///
/// Free functions over a connection rather than methods, so the pooled reader
/// can answer "what is this section called" without the engine lock. The
/// engine's own `compute_named_overlay` is one call into here, so the two
/// cannot drift.
/// The overlay a pooled reader sees: the same computation, behind the read
/// cache's `data_version` stamp, because resolving it walks every visible
/// section and the answer only changes when something commits.
pub(crate) mod pooled {
    use std::collections::BTreeMap;
    use std::sync::Arc;

    use rusqlite::Connection;

    /// The name that shows over each section's row: its corridor name, or
    /// the numbered label of a section with no name of its own. The labels
    /// are read on every call, since they follow the language and the cache
    /// is keyed on the data alone.
    pub(crate) fn overlay_names(conn: &Connection) -> Arc<BTreeMap<String, String>> {
        let overlay = resolved_overlay(conn);
        let mut names = crate::persistence::sections::numbers::unnamed_labels(conn);
        if names.is_empty() {
            return Arc::new(overlay.by_section.clone());
        }
        crate::persistence::sections::numbers::compose_split_labels(
            conn,
            &mut names,
            &overlay.by_section,
            || {
                crate::persistence::read_cache::split_lineage(|| {
                    crate::persistence::sections::numbers::split_lineage(conn)
                })
            },
        );
        names.extend(
            overlay
                .by_section
                .iter()
                .map(|(id, name)| (id.clone(), name.clone())),
        );
        Arc::new(names)
    }

    /// The names that show over `ids` alone, on the precedence `overlay_names`
    /// gives them, so a page of the list does not build a label for every
    /// unnamed section in the catalogue.
    pub(crate) fn overlay_names_for(conn: &Connection, ids: &[&str]) -> BTreeMap<String, String> {
        let overlay = resolved_overlay(conn);
        let mut names = crate::persistence::sections::numbers::unnamed_labels_for(conn, ids);
        crate::persistence::sections::numbers::compose_split_labels(
            conn,
            &mut names,
            &overlay.by_section,
            || {
                crate::persistence::read_cache::split_lineage(|| {
                    crate::persistence::sections::numbers::split_lineage(conn)
                })
            },
        );
        names.extend(ids.iter().filter_map(|id| {
            overlay
                .by_section
                .get(*id)
                .map(|n| (id.to_string(), n.clone()))
        }));
        names
    }

    /// The whole overlay, or an empty one for a library nobody has named. The
    /// `EXISTS` probe is the engine's own short-circuit: without a named
    /// intent there is nothing to resolve and the catalogue is not read.
    fn resolved_overlay(conn: &Connection) -> Arc<super::NamedOverlay> {
        crate::persistence::read_cache::named_overlay(|| {
            let has_named: bool = conn
                .query_row(
                    "SELECT EXISTS(SELECT 1 FROM section_intents WHERE kind = 'named')",
                    [],
                    |row| row.get(0),
                )
                .unwrap_or(false);
            if !has_named {
                return super::NamedOverlay::default();
            }
            super::compute::compute_overlay(conn)
        })
    }

    /// Every named corridor with the section it resolves to, from the same
    /// overlay `overlay_names` reads.
    pub(crate) fn named_corridors(conn: &Connection) -> Vec<super::NamedCorridor> {
        resolved_overlay(conn).corridors.clone()
    }
}

pub(crate) mod compute {
    use std::collections::BTreeMap;

    use rusqlite::Connection;
    use tracematch::GpsPoint;

    use super::{
        IntentRow, NamedCandidate, NamedCorridor, NamedOverlay, VisibleRow, bbox, bboxes_touch,
        score_named_candidate, select_candidate, trim_core,
    };

    /// Exact ground ties prefer the section whose extent matches the named line.
    fn select_extent_tie(
        scored: &[NamedCandidate<'_>],
        lengths: &[f64],
        footprint_length: f64,
    ) -> Option<(usize, f64)> {
        let (winner, _) = select_candidate(scored)?;
        let score = scored[winner].score;
        let mut best = winner;
        let mut best_gap = (lengths[winner] - footprint_length).abs();
        for (index, candidate) in scored.iter().enumerate() {
            if candidate.score != score {
                continue;
            }
            let gap = (lengths[index] - footprint_length).abs();
            if gap < best_gap {
                best = index;
                best_gap = gap;
            }
        }
        Some((best, scored[best].score.coverage))
    }

    /// When each split child was born, from the ledger's newest split birth
    /// row, as `YYYY-MM-DD HH:MM:SS` so it compares with an intent's
    /// `created_at` whichever of the two ISO spellings either was written in.
    fn split_birth_times(conn: &Connection) -> std::collections::HashMap<String, String> {
        let mut times = std::collections::HashMap::new();
        let Ok(mut stmt) = conn.prepare(
            "SELECT section_id, at FROM section_history
             WHERE kind = 'formed' AND details LIKE '%split_from%' ORDER BY id",
        ) else {
            return times;
        };
        let Ok(rows) = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }) else {
            return times;
        };
        for (section_id, at) in rows.flatten() {
            times.insert(section_id, comparable_time(&at));
        }
        times
    }

    fn comparable_time(at: &str) -> String {
        at.chars()
            .take(19)
            .map(|c| if c == 'T' { ' ' } else { c })
            .collect()
    }

    /// The visible row a name resolved onto, moved up the ledger's split
    /// lineage to the row that carries the original section's id while that
    /// row is still visible. A name follows the id through a split, so the
    /// siblings read as parts of it whichever piece covers the most ground.
    /// A name written after a child was born belongs to that child, so the
    /// walk stops at the first child born before the name was written.
    fn split_heir(
        mut index: usize,
        created_at: &str,
        visible: &[VisibleRow],
        lineage: &crate::persistence::sections::numbers::SplitLineage,
        births: &std::collections::HashMap<String, String>,
    ) -> usize {
        let written = comparable_time(created_at);
        let mut seen = std::collections::HashSet::new();
        while seen.insert(index) {
            let child = visible[index].id.as_str();
            let Some((parent, _)) = lineage.get(child) else {
                break;
            };
            if births.get(child).is_some_and(|born| *born < written) {
                break;
            }
            let Some(parent_index) = visible.iter().position(|row| &row.id == parent) else {
                break;
            };
            index = parent_index;
        }
        index
    }

    #[cfg(test)]
    pub(crate) static OVERLAY_COMPUTES: std::sync::atomic::AtomicUsize =
        std::sync::atomic::AtomicUsize::new(0);

    pub(crate) fn compute_overlay(conn: &Connection) -> NamedOverlay {
        #[cfg(test)]
        OVERLAY_COMPUTES.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let intents = named_intent_rows(conn);
        if intents.is_empty() {
            return NamedOverlay::default();
        }
        let visible = visible_rows_for_resolution(conn);
        let lineage = crate::persistence::sections::numbers::split_lineage(conn);
        let births = split_birth_times(conn);

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
            let mut candidates: Vec<(usize, tracematch::sections::NamedScore, f64)> = Vec::new();
            for (vi, row) in visible.iter().enumerate() {
                if !bboxes_touch(core_bbox, row.bbox, mid_lat) {
                    continue;
                }
                let polyline = parsed.entry(vi).or_insert_with(|| row.line(conn));
                let Some(polyline) = polyline else { continue };
                let Some(score) = score_named_candidate(&core, &intent.footprint, polyline) else {
                    continue;
                };
                candidates.push((
                    vi,
                    score,
                    tracematch::matching::calculate_route_distance(polyline),
                ));
            }
            let scored: Vec<NamedCandidate> = candidates
                .iter()
                .map(|&(vi, score, _)| NamedCandidate {
                    score,
                    created_at: &visible[vi].created_at,
                    id: &visible[vi].id,
                })
                .collect();
            let lengths: Vec<f64> = candidates.iter().map(|candidate| candidate.2).collect();
            let footprint_length =
                tracematch::matching::calculate_route_distance(&intent.footprint);
            resolved.push(
                match select_extent_tie(&scored, &lengths, footprint_length) {
                    Some((i, cov)) => (
                        Some(split_heir(
                            candidates[i].0,
                            &intent.created_at,
                            &visible,
                            &lineage,
                            &births,
                        )),
                        cov,
                    ),
                    None => (None, 0.0),
                },
            );
        }

        // Fallback pass: an intent with no visible cover resolves against
        // the hidden catalogue so the restore list shows the user's name on
        // a disabled or superseded row. The corridor entry itself stays
        // dormant, no visible section carries the name.
        let mut hidden_pairs: Vec<(String, String)> = Vec::new();
        if resolved.iter().any(|(vi, _)| vi.is_none()) {
            let hidden = hidden_rows_for_resolution(conn);
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
                let mut candidates: Vec<(usize, tracematch::sections::NamedScore, f64)> =
                    Vec::new();
                for (hi, row) in hidden.iter().enumerate() {
                    if !bboxes_touch(core_bbox, row.bbox, mid_lat) {
                        continue;
                    }
                    let polyline = parsed_hidden.entry(hi).or_insert_with(|| row.line(conn));
                    let Some(polyline) = polyline else { continue };
                    let Some(score) = score_named_candidate(&core, &intent.footprint, polyline)
                    else {
                        continue;
                    };
                    candidates.push((
                        hi,
                        score,
                        tracematch::matching::calculate_route_distance(polyline),
                    ));
                }
                let scored: Vec<NamedCandidate> = candidates
                    .iter()
                    .map(|&(hi, score, _)| NamedCandidate {
                        score,
                        created_at: &hidden[hi].created_at,
                        id: &hidden[hi].id,
                    })
                    .collect();
                let lengths: Vec<f64> = candidates.iter().map(|candidate| candidate.2).collect();
                let footprint_length =
                    tracematch::matching::calculate_route_distance(&intent.footprint);
                if let Some((i, cov)) = select_extent_tie(&scored, &lengths, footprint_length) {
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

    fn named_intent_rows(conn: &Connection) -> Vec<IntentRow> {
        let Ok(mut stmt) = conn.prepare(
            "SELECT id, name, polyline_blob, polyline_json, sport_type, created_at
             FROM section_intents WHERE kind = 'named' AND name IS NOT NULL",
        ) else {
            return Vec::new();
        };
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<Vec<u8>>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, String>(5)?,
            ))
        });
        let Ok(iter) = rows else { return Vec::new() };
        iter.flatten()
            .filter_map(|(intent_id, name, blob, json, sport_type, created_at)| {
                let footprint = crate::persistence::codec::decode_polyline_row(
                    blob.as_deref(),
                    json.as_deref(),
                )
                .ok()?;
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
    fn visible_rows_for_resolution(conn: &Connection) -> Vec<VisibleRow> {
        let Ok(mut stmt) = conn.prepare(
            "SELECT id, polyline_json, created_at,
                    bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
                    polyline_blob, representative_activity_id,
                    rep_start_index, rep_end_index
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
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<u32>>(9)?,
                row.get::<_, Option<u32>>(10)?,
            ))
        });
        let Ok(iter) = rows else { return Vec::new() };
        iter.flatten()
            .filter_map(
                |(
                    id,
                    polyline_json,
                    created_at,
                    lat0,
                    lat1,
                    lng0,
                    lng1,
                    polyline_blob,
                    representative_activity_id,
                    rep_start_index,
                    rep_end_index,
                )| {
                    let bb = match (lat0, lat1, lng0, lng1) {
                        (Some(a), Some(b), Some(c), Some(d)) => (a, b, c, d),
                        _ => {
                            let reference = super::geometry::reference(
                                representative_activity_id.as_deref(),
                                rep_start_index,
                                rep_end_index,
                            );
                            let line = super::geometry::line(
                                conn,
                                polyline_blob.as_deref(),
                                polyline_json.as_deref(),
                                reference,
                            )
                            .ok()?;
                            if line.is_empty() {
                                return None;
                            }
                            bbox(&line)
                        }
                    };
                    Some(VisibleRow {
                        id,
                        polyline_blob,
                        polyline_json,
                        representative_activity_id,
                        rep_start_index,
                        rep_end_index,
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
    fn hidden_rows_for_resolution(conn: &Connection) -> Vec<VisibleRow> {
        let Ok(mut stmt) = conn.prepare(
            "SELECT id, polyline_json, created_at,
                    bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
                    polyline_blob, representative_activity_id,
                    rep_start_index, rep_end_index
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
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<u32>>(9)?,
                row.get::<_, Option<u32>>(10)?,
            ))
        });
        let Ok(iter) = rows else { return Vec::new() };
        iter.flatten()
            .filter_map(
                |(
                    id,
                    polyline_json,
                    created_at,
                    lat0,
                    lat1,
                    lng0,
                    lng1,
                    polyline_blob,
                    representative_activity_id,
                    rep_start_index,
                    rep_end_index,
                )| {
                    let bb = match (lat0, lat1, lng0, lng1) {
                        (Some(a), Some(b), Some(c), Some(d)) => (a, b, c, d),
                        _ => {
                            let reference = super::geometry::reference(
                                representative_activity_id.as_deref(),
                                rep_start_index,
                                rep_end_index,
                            );
                            let line = super::geometry::line(
                                conn,
                                polyline_blob.as_deref(),
                                polyline_json.as_deref(),
                                reference,
                            )
                            .ok()?;
                            if line.is_empty() {
                                return None;
                            }
                            bbox(&line)
                        }
                    };
                    Some(VisibleRow {
                        id,
                        polyline_blob,
                        polyline_json,
                        representative_activity_id,
                        rep_start_index,
                        rep_end_index,
                        created_at,
                        bbox: bb,
                    })
                },
            )
            .collect()
    }
}
