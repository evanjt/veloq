//! Catalogue ranking: the interestingness score on every visible section,
//! pooled across the catalogue and within the section's sport, written
//! back as columns beside the profile the detector computed.

use std::collections::{HashMap, HashSet};

use rusqlite::{Result as SqlResult, Row, params};
use tracematch::{
    Direction, Enrichment, GpsPoint, RankCandidate, RankFeatures, RankMember, RankOuting,
    RankTraversal, SectionClass,
};

use crate::persistence::PersistentEngine;

/// Rankings that read the tracks on the caller's engine lock rather than on a
/// connection of the worker's own. A work counter for the tests that hold a
/// path to the off-lock shape.
pub(crate) static LOCKED_RANK_PASSES: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

/// How many rankings have read the tracks under the engine lock since process
/// start.
pub fn locked_rank_passes() -> usize {
    LOCKED_RANK_PASSES.load(std::sync::atomic::Ordering::SeqCst)
}

/// Read the profile columns: gain and grade at `gain_idx`, the rest of the
/// enrichment from `base` in migration order.
pub(crate) fn enrichment_from_row(
    row: &Row,
    gain_idx: usize,
    base: usize,
) -> SqlResult<Enrichment> {
    Ok(Enrichment {
        elevation_gain_m: row.get(gain_idx)?,
        avg_grade_percent: row.get(gain_idx + 1)?,
        elevation_loss_m: row.get(base)?,
        max_grade_percent: row.get(base + 1)?,
        straightness: row.get(base + 2)?,
        klass: row
            .get::<_, Option<String>>(base + 3)?
            .as_deref()
            .and_then(SectionClass::parse),
        is_lift: row.get::<_, Option<i32>>(base + 4)?.unwrap_or(0) != 0,
    })
}

/// Read the two score columns from `base`. Only the scores persist; the
/// feature breakdown is recomputed by the next rank.
pub(crate) fn rank_from_row(row: &Row, base: usize) -> SqlResult<Option<RankFeatures>> {
    let score: Option<f64> = row.get(base)?;
    let sport_score: Option<f64> = row.get(base + 1)?;
    Ok(score.map(|score| RankFeatures {
        score,
        sport_score: sport_score.unwrap_or(score),
        ..Default::default()
    }))
}

/// Rank of `v` in a sorted sample, 0..1, ties at their midpoint.
fn percentile(sorted: &[f64], v: f64) -> f64 {
    if sorted.is_empty() {
        return 0.5;
    }
    let below = sorted.partition_point(|&x| x < v);
    let equal = sorted[below..].iter().take_while(|&&x| x == v).count();
    (below as f64 + 0.5 * equal as f64) / sorted.len() as f64
}

/// Epoch seconds to a civil date, `YYYY-MM-DD`.
fn iso_date(epoch: i64) -> String {
    let z = epoch.div_euclid(86_400) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

impl PersistentEngine {
    fn unflagged_lift_ids(&self) -> SqlResult<HashSet<String>> {
        let mut stmt = self
            .db
            .prepare("SELECT id FROM section_intents WHERE kind = 'lift'")?;
        let ids = stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<SqlResult<HashSet<_>>>()?;
        Ok(ids)
    }

    pub(super) fn apply_lift_intents_to_memory(&mut self) -> SqlResult<()> {
        let unflagged = self.unflagged_lift_ids()?;
        let mut changed = Vec::new();
        for section in &mut self.sections {
            if section.enrichment.is_lift && unflagged.contains(&section.id) {
                section.enrichment.is_lift = false;
                changed.push(section.id.clone());
            }
        }
        for id in changed {
            self.invalidate_section_cache(&id);
        }
        Ok(())
    }

    /// The stored profile and scores of one section, defaults when the row
    /// predates the columns.
    pub(super) fn read_enrichment(&self, section_id: &str) -> (Enrichment, Option<RankFeatures>) {
        self.db
            .query_row(
                "SELECT elevation_gain_m, avg_grade_percent, elevation_loss_m, max_grade_percent,
                        straightness, klass, is_lift, rank_score, sport_rank_score
                 FROM sections WHERE id = ?",
                params![section_id],
                |row| Ok((enrichment_from_row(row, 0, 2)?, rank_from_row(row, 7)?)),
            )
            .unwrap_or_default()
    }

    /// Re-rank every visible section from the stored passes, tracks and
    /// dates: a pooled score and a within-sport score, both percentiles.
    /// The whole pass runs on the caller's lock; a worker that holds a
    /// connection of its own takes the plan, computes on that connection and
    /// writes the result back, which keeps the track reads off the lock.
    pub(crate) fn rank_catalogue(&mut self) -> SqlResult<()> {
        let Some(plan) = self.rank_plan() else {
            return Ok(());
        };
        LOCKED_RANK_PASSES.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let ranked = plan.compute(&self.db)?;
        self.write_rank(ranked)
    }

    /// The catalogue as ranking needs it, or none when there is nothing to
    /// rank. Copies only the section lines, not any track.
    pub(crate) fn rank_plan(&self) -> Option<RankPlan> {
        if self.sections.is_empty() {
            return None;
        }
        Some(RankPlan {
            sections: self
                .sections
                .iter()
                .map(|s| RankSection {
                    id: s.id.clone(),
                    polyline: s.polyline.clone(),
                    distance_meters: s.distance_meters,
                    sport_type: s.sport_type.clone(),
                    enrichment: s.enrichment.clone(),
                })
                .collect(),
            proximity: self.section_config.proximity_threshold,
        })
    }

    /// Persist and adopt a ranking computed from an earlier plan.
    ///
    /// The scores describe the catalogue the plan was taken from. A section
    /// that was deleted or redrawn since is skipped, and so keeps the score it
    /// had, because a score for a line that no longer exists would describe
    /// nothing. A section added since has no score until the next ranking, the
    /// state every newly detected section is in until ranking has run.
    pub(crate) fn write_rank(&mut self, ranked: Vec<RankedSection>) -> SqlResult<()> {
        let unflagged_lifts = self.unflagged_lift_ids()?;
        let tx = self.db.unchecked_transaction()?;
        let mut applied: Vec<(usize, RankedSection)> = Vec::with_capacity(ranked.len());
        {
            let mut stmt = tx.prepare(&format!(
                "UPDATE sections SET elevation_loss_m = ?, max_grade_percent = ?, straightness = ?,
                        klass = ?, is_lift = {IS_LIFT_UNLESS_UNFLAGGED}, rank_score = ?,
                        sport_rank_score = ?
                 WHERE id = ?"
            ))?;
            for r in ranked {
                let Some(idx) = self.sections.iter().position(|s| {
                    s.id == r.id
                        && s.polyline.len() == r.polyline_len
                        && s.distance_meters == r.distance_meters
                }) else {
                    continue;
                };
                let mut enrichment = r.enrichment.clone();
                if unflagged_lifts.contains(&r.id) {
                    enrichment.is_lift = false;
                }
                stmt.execute(params![
                    enrichment.elevation_loss_m,
                    enrichment.max_grade_percent,
                    enrichment.straightness,
                    enrichment.klass.map(SectionClass::as_str),
                    r.id,
                    i32::from(enrichment.is_lift),
                    r.rank.score,
                    r.rank.sport_score,
                    r.id,
                ])?;
                applied.push((idx, RankedSection { enrichment, ..r }));
            }
        }
        tx.commit()?;
        for (idx, r) in applied {
            let s = &mut self.sections[idx];
            s.enrichment = r.enrichment;
            s.rank = Some(r.rank);
        }
        Ok(())
    }
}

/// One section's line and profile, as ranking reads them.
pub(crate) struct RankSection {
    id: String,
    polyline: Vec<GpsPoint>,
    distance_meters: f64,
    sport_type: String,
    enrichment: Enrichment,
}

/// A catalogue snapshot ranking is computed from.
pub(crate) struct RankPlan {
    sections: Vec<RankSection>,
    proximity: f64,
}

/// One section's computed profile and scores, with the line they describe.
pub(crate) struct RankedSection {
    id: String,
    polyline_len: usize,
    distance_meters: f64,
    enrichment: Enrichment,
    rank: RankFeatures,
}

impl RankPlan {
    /// Compute the pooled and within-sport scores from the stored passes,
    /// tracks and dates on `conn`. A section loaded without a profile (a row
    /// older than the columns) gets one here from its own line. Effort per
    /// pass is the pass's average heart rate as a percentile of the athlete's
    /// own activities in that sport; a pass without one sits at neutral.
    pub(crate) fn compute(mut self, conn: &rusqlite::Connection) -> SqlResult<Vec<RankedSection>> {
        for s in self.sections.iter_mut() {
            if s.enrichment == Enrichment::default() && s.polyline.len() >= 2 {
                s.enrichment = tracematch::enrich(&s.polyline, s.distance_meters);
            }
        }

        let mut norms: HashMap<String, Vec<f64>> = HashMap::new();
        {
            let mut stmt = conn.prepare(
                "SELECT sport_type, avg_hr FROM activity_metrics WHERE avg_hr IS NOT NULL",
            )?;
            for r in stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, f64>(1)?)))? {
                let (sport, hr) = r?;
                norms.entry(sport).or_default().push(hr);
            }
        }
        for v in norms.values_mut() {
            v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        }

        let mut meta: HashMap<String, (String, Option<String>)> = HashMap::new();
        {
            let mut stmt = conn.prepare(
                "SELECT a.id, COALESCE(am.sport_type, a.sport_type), a.start_date
                 FROM activities a LEFT JOIN activity_metrics am ON am.activity_id = a.id",
            )?;
            for r in stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<i64>>(2)?,
                ))
            })? {
                let (id, sport, start) = r?;
                let date = start.filter(|&s| s > 0).map(iso_date);
                meta.insert(id, (sport, date));
            }
        }

        let mut passes: HashMap<String, HashMap<String, Vec<RankTraversal>>> = HashMap::new();
        {
            let mut stmt = conn.prepare(&format!(
                "SELECT sa.section_id, sa.activity_id, sa.direction, sa.start_index,
                        sa.end_index, sa.avg_hr
                 FROM section_activities sa JOIN sections s ON s.id = sa.section_id
                 WHERE sa.excluded = 0{}
                 ORDER BY sa.section_id, sa.activity_id, sa.start_index",
                crate::persistence::records::complete_traversal_clause("sa", "s")
            ))?;
            for r in stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, Option<f64>>(5)?,
                ))
            })? {
                let (sid, aid, dir, start, end, hr) = r?;
                let effort = hr.and_then(|h| {
                    let sport = meta.get(&aid).map(|m| m.0.as_str())?;
                    norms.get(sport).map(|n| percentile(n, h))
                });
                passes
                    .entry(sid)
                    .or_default()
                    .entry(aid)
                    .or_default()
                    .push(RankTraversal {
                        start: start.max(0) as usize,
                        end: end.max(0) as usize,
                        direction: match dir.as_str() {
                            "reverse" => Direction::Reverse,
                            "partial" => Direction::Partial,
                            _ => Direction::Same,
                        },
                        effort,
                    });
            }
        }

        let needed: HashSet<&str> = passes
            .values()
            .flat_map(|m| m.keys().map(String::as_str))
            .collect();
        let mut tracks: HashMap<String, Vec<GpsPoint>> = HashMap::with_capacity(needed.len());
        crate::persistence::activities::for_each_track_on(conn, &needed, |id, pts| {
            tracks.insert(id.to_string(), pts.to_vec());
        });
        let outings: HashMap<String, RankOuting> = tracks
            .iter()
            .map(|(id, pts)| {
                (
                    id.clone(),
                    RankOuting {
                        date: meta.get(id).and_then(|m| m.1.as_deref()),
                        points: pts,
                    },
                )
            })
            .collect();

        let candidates: Vec<RankCandidate> = self
            .sections
            .iter()
            .map(|s| RankCandidate {
                id: &s.id,
                polyline: &s.polyline,
                distance_meters: s.distance_meters,
                members: passes
                    .get(&s.id)
                    .map(|by_activity| {
                        by_activity
                            .iter()
                            .map(|(aid, traversals)| RankMember {
                                activity_id: aid,
                                traversals: traversals.clone(),
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
            })
            .collect();
        let proximity = self.proximity;
        // Measuring the features is the whole cost of ranking, and the pooled
        // and per-sport scores are two percentiles over the same measurements.
        let measured = tracematch::rank_features(&candidates, &outings, proximity, None);
        let features: HashMap<&str, &RankFeatures> =
            measured.iter().map(|(id, f)| (id.as_str(), f)).collect();

        let mut pooled_scored = measured.clone();
        tracematch::score_features(&mut pooled_scored);
        let pooled: HashMap<String, RankFeatures> = pooled_scored.into_iter().collect();

        let mut by_sport: HashMap<&str, Vec<(String, RankFeatures)>> = HashMap::new();
        for (c, s) in candidates.iter().zip(&self.sections) {
            let Some(f) = features.get(c.id) else {
                continue;
            };
            by_sport
                .entry(s.sport_type.as_str())
                .or_default()
                .push((c.id.to_string(), (*f).clone()));
        }
        let mut sport_scores: HashMap<String, f64> = HashMap::new();
        for group in by_sport.values_mut() {
            tracematch::score_features(group);
            for (id, f) in group.drain(..) {
                sport_scores.insert(id, f.score);
            }
        }

        Ok(self
            .sections
            .iter()
            .map(|s| {
                let mut rank = pooled.get(&s.id).cloned().unwrap_or_default();
                rank.sport_score = sport_scores.get(&s.id).copied().unwrap_or(rank.score);
                RankedSection {
                    id: s.id.clone(),
                    polyline_len: s.polyline.len(),
                    distance_meters: s.distance_meters,
                    enrichment: s.enrichment.clone(),
                    rank,
                }
            })
            .collect())
    }
}

/// The `is_lift` column of the enrichment write, as SQL.
///
/// A `lift` intent overrides a detected flag on inserts and rank updates.
pub(crate) const IS_LIFT_UNLESS_UNFLAGGED: &str = "CASE WHEN EXISTS(
        SELECT 1 FROM section_intents i WHERE i.id = ? AND i.kind = 'lift'
    ) THEN 0 ELSE ? END";

impl PersistentEngine {
    /// Mark or unmark a section as a lift.
    ///
    /// Unmarking writes an intent as well as the column, because the column
    /// alone does not survive the next enrichment pass. Re-marking takes the
    /// intent away again, or the section could never be a lift once unflagged.
    /// The intent suppresses nothing: every other reader of `section_intents`
    /// is scoped to its own kind, so the section stays in the catalogue.
    pub fn set_section_is_lift(&mut self, section_id: &str, is_lift: bool) -> Result<(), String> {
        if is_lift {
            self.db
                .execute(
                    "DELETE FROM section_intents WHERE id = ? AND kind = 'lift'",
                    rusqlite::params![section_id],
                )
                .map_err(|e| e.to_string())?;
        } else {
            self.record_section_intent(section_id, "lift");
        }
        self.db
            .execute(
                "UPDATE sections SET is_lift = ? WHERE id = ?",
                rusqlite::params![i32::from(is_lift), section_id],
            )
            .map_err(|e| e.to_string())?;
        if let Some(section) = self.sections.iter_mut().find(|s| s.id == section_id) {
            section.enrichment.is_lift = is_lift;
        }
        self.invalidate_section_cache(section_id);
        Ok(())
    }

    /// Run the enrichment pass's `is_lift` write alone, with the detector's
    /// answer, so a test can prove the intent survives it without standing up a
    /// whole detection run.
    #[doc(hidden)]
    pub fn restamp_lift_flag_for_test(
        &self,
        section_id: &str,
        detected: bool,
    ) -> Result<(), String> {
        self.db
            .execute(
                &format!("UPDATE sections SET is_lift = {IS_LIFT_UNLESS_UNFLAGGED} WHERE id = ?"),
                rusqlite::params![section_id, i32::from(detected), section_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(points: i32) -> Vec<GpsPoint> {
        (0..points)
            .map(|i| GpsPoint {
                latitude: 46.2 + f64::from(i) * 0.0001,
                longitude: 7.3,
                elevation: Some(400.0 + f64::from(i)),
            })
            .collect()
    }

    /// A file-backed engine, so a second connection sees the same library,
    /// with one ride that passes both of two sections.
    fn engine_with_two_ranked_sections(dir: &std::path::Path) -> PersistentEngine {
        let path = dir.join("rank.db");
        let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
        engine
            .add_activity("a1".to_string(), line(200), "Ride".to_string())
            .unwrap();
        for (id, points) in [("s0", 120), ("s1", 60)] {
            engine
                .db
                .execute(
                    "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                        distance_meters, is_user_defined, version, created_at,
                        bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
                     VALUES (?, 'auto', ?, 'Ride', ?, 1000.0, 0, 1, '2026-01-01T00:00:00Z',
                        46.2, 46.22, 7.3, 7.3)",
                    params![id, id, serde_json::to_string(&line(points)).unwrap()],
                )
                .unwrap();
            engine
                .db
                .execute(
                    "INSERT INTO section_activities (section_id, activity_id, direction,
                        start_index, end_index, distance_meters)
                     VALUES (?, 'a1', 'same', 0, ?, 1000.0)",
                    params![id, points - 1],
                )
                .unwrap();
        }
        engine.load_sections().unwrap();
        engine
    }

    fn scores(engine: &PersistentEngine) -> Vec<(String, Option<(f64, f64)>)> {
        let mut out: Vec<_> = engine
            .sections
            .iter()
            .map(|s| {
                (
                    s.id.clone(),
                    s.rank.as_ref().map(|r| (r.score, r.sport_score)),
                )
            })
            .collect();
        out.sort_by(|a, b| a.0.cmp(&b.0));
        out
    }

    #[test]
    fn fragments_do_not_change_catalogue_rank_features() {
        let dir = tempfile::tempdir().unwrap();
        let mut engine = engine_with_two_ranked_sections(dir.path());
        let track = line(200);
        let middle = &track[50..150];
        engine
            .db
            .execute(
                "UPDATE sections SET polyline_json = ? WHERE id = 's0'",
                params![serde_json::to_string(middle).unwrap()],
            )
            .unwrap();
        engine
            .db
            .execute(
                "UPDATE section_activities SET start_index = 50, end_index = 149,
                    avg_hr = 100 WHERE section_id = 's0'",
                [],
            )
            .unwrap();
        engine
            .db
            .execute(
                "UPDATE activities SET start_date = 1767225600 WHERE id = 'a1'",
                [],
            )
            .unwrap();
        engine
            .db
            .execute(
                "INSERT INTO activity_metrics (activity_id, name, date, distance, moving_time,
                    elapsed_time, elevation_gain, avg_hr, sport_type)
                 VALUES ('a1', 'First', 1767225600, 2000, 600, 600, 0, 100, 'Ride')",
                [],
            )
            .unwrap();
        engine.load_sections().unwrap();
        for id in ["a2", "a3"] {
            engine
                .add_activity(id.to_string(), track.clone(), "Ride".to_string())
                .unwrap();
            engine
                .db
                .execute(
                    "UPDATE activities SET start_date = 1772323200 WHERE id = ?",
                    params![id],
                )
                .unwrap();
            engine
                .db
                .execute(
                    "INSERT INTO activity_metrics (activity_id, name, date, distance, moving_time,
                        elapsed_time, elevation_gain, avg_hr, sport_type)
                     VALUES (?, 'Later', 1772323200, 2000, 600, 600, 0, 200, 'Ride')",
                    params![id],
                )
                .unwrap();
        }
        let baseline = engine.rank_plan().unwrap().compute(&engine.db).unwrap();
        for (id, direction, distance, coverage) in
            [("a2", "partial", 1000.0, 1.0), ("a3", "same", 200.0, 0.2)]
        {
            engine
                .db
                .execute(
                    "INSERT INTO section_activities (section_id, activity_id, direction,
                        start_index, end_index, distance_meters, coverage, avg_hr)
                     VALUES ('s0', ?, ?, 50, 149, ?, ?, 200)",
                    params![id, direction, distance, coverage],
                )
                .unwrap();
        }
        let with_fragments = engine.rank_plan().unwrap().compute(&engine.db).unwrap();
        let original = &baseline.iter().find(|s| s.id == "s0").unwrap().rank;
        let current = &with_fragments.iter().find(|s| s.id == "s0").unwrap().rank;
        assert_eq!(current.effort, original.effort);
        assert_eq!(current.months, original.months);
        assert_eq!(current.recency_days, original.recency_days);
        assert_eq!(current.converge, original.converge);
        assert_eq!(current.apex, original.apex);
    }

    #[test]
    fn ranking_computed_on_a_separate_connection_matches_ranking_under_the_lock() {
        let (da, db) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let mut inline = engine_with_two_ranked_sections(da.path());
        inline.rank_catalogue().unwrap();

        let mut split = engine_with_two_ranked_sections(db.path());
        let plan = split.rank_plan().unwrap();
        let reader = rusqlite::Connection::open(db.path().join("rank.db")).unwrap();
        let ranked = plan.compute(&reader).unwrap();
        assert!(scores(&split).iter().all(|(_, r)| r.is_none()));
        split.write_rank(ranked).unwrap();

        assert!(scores(&inline).iter().all(|(_, r)| r.is_some()));
        assert_eq!(scores(&split), scores(&inline));
        let stored: Option<f64> = split
            .db
            .query_row("SELECT rank_score FROM sections WHERE id = 's0'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert!(stored.is_some());
    }

    #[test]
    fn a_ranking_written_after_a_section_was_removed_skips_only_that_section() {
        let dir = tempfile::tempdir().unwrap();
        let mut engine = engine_with_two_ranked_sections(dir.path());
        let plan = engine.rank_plan().unwrap();
        let reader = rusqlite::Connection::open(dir.path().join("rank.db")).unwrap();
        let ranked = plan.compute(&reader).unwrap();

        engine.sections.retain(|s| s.id != "s0");
        engine.write_rank(ranked).unwrap();

        assert_eq!(engine.sections.len(), 1);
        assert!(engine.sections[0].rank.is_some());
    }

    #[test]
    fn a_ranking_written_after_a_section_was_redrawn_leaves_it_unscored() {
        let dir = tempfile::tempdir().unwrap();
        let mut engine = engine_with_two_ranked_sections(dir.path());
        let plan = engine.rank_plan().unwrap();
        let reader = rusqlite::Connection::open(dir.path().join("rank.db")).unwrap();
        let ranked = plan.compute(&reader).unwrap();

        engine
            .sections
            .iter_mut()
            .find(|s| s.id == "s1")
            .unwrap()
            .polyline
            .truncate(30);
        engine.write_rank(ranked).unwrap();

        let by_id = scores(&engine);
        assert!(by_id[0].1.is_some());
        assert!(by_id[1].1.is_none());
    }

    #[test]
    fn epoch_dates_are_civil() {
        assert_eq!(iso_date(0), "1970-01-01");
        assert_eq!(iso_date(1_740_000_000), "2025-02-19");
        assert_eq!(iso_date(951_782_400), "2000-02-29");
    }

    #[test]
    fn percentile_ranks_inside_the_sample() {
        let s = [100.0, 120.0, 140.0, 160.0];
        assert_eq!(percentile(&s, 90.0), 0.0);
        assert_eq!(percentile(&s, 120.0), 0.375);
        assert_eq!(percentile(&s, 200.0), 1.0);
        assert_eq!(percentile(&[], 1.0), 0.5);
    }
}
