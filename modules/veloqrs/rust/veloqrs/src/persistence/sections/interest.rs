//! Catalogue ranking: the interestingness score on every visible section,
//! pooled across the catalogue and within the section's sport, written
//! back as columns beside the profile the detector computed.

use std::collections::{HashMap, HashSet};

use rusqlite::{Result as SqlResult, Row, params};
use tracematch::{
    Direction, Enrichment, GpsPoint, RankCandidate, RankFeatures, RankMember, RankOuting,
    RankTraversal, SectionClass,
};

use crate::persistence::PersistentRouteEngine;

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

impl PersistentRouteEngine {
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
    /// A section loaded without a profile (a row older than the columns)
    /// gets one here from its own line. Effort per pass is the pass's
    /// average heart rate as a percentile of the athlete's own activities
    /// in that sport; a pass without one sits at neutral.
    pub(crate) fn rank_catalogue(&mut self) -> SqlResult<()> {
        if self.sections.is_empty() {
            return Ok(());
        }
        for s in self.sections.iter_mut() {
            if s.enrichment == Enrichment::default() && s.polyline.len() >= 2 {
                s.enrichment = tracematch::enrich(&s.polyline, s.distance_meters);
            }
        }

        let mut norms: HashMap<String, Vec<f64>> = HashMap::new();
        {
            let mut stmt = self.db.prepare(
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
            let mut stmt = self
                .db
                .prepare("SELECT id, sport_type, start_date FROM activities")?;
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
            let mut stmt = self.db.prepare(
                "SELECT section_id, activity_id, direction, start_index, end_index, avg_hr
                 FROM section_activities WHERE excluded = 0
                 ORDER BY section_id, activity_id, start_index",
            )?;
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
        self.for_each_track(|id, pts| {
            if needed.contains(id) {
                tracks.insert(id.to_string(), pts.to_vec());
            }
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
        let proximity = self.section_config.proximity_threshold;
        let pooled: HashMap<String, RankFeatures> =
            tracematch::rank(&candidates, &outings, proximity, None)
                .into_iter()
                .collect();
        let mut by_sport: HashMap<&str, Vec<RankCandidate>> = HashMap::new();
        for (c, s) in candidates.iter().zip(&self.sections) {
            by_sport
                .entry(s.sport_type.as_str())
                .or_default()
                .push(c.clone());
        }
        let mut sport_scores: HashMap<String, f64> = HashMap::new();
        for group in by_sport.values() {
            for (id, f) in tracematch::rank(group, &outings, proximity, None) {
                sport_scores.insert(id, f.score);
            }
        }

        let tx = self.db.unchecked_transaction()?;
        {
            let mut stmt = tx.prepare(
                "UPDATE sections SET elevation_loss_m = ?, max_grade_percent = ?, straightness = ?,
                        klass = ?, is_lift = ?, rank_score = ?, sport_rank_score = ?
                 WHERE id = ?",
            )?;
            for s in self.sections.iter_mut() {
                let mut rank = pooled.get(&s.id).cloned().unwrap_or_default();
                rank.sport_score = sport_scores.get(&s.id).copied().unwrap_or(rank.score);
                stmt.execute(params![
                    s.enrichment.elevation_loss_m,
                    s.enrichment.max_grade_percent,
                    s.enrichment.straightness,
                    s.enrichment.klass.map(SectionClass::as_str),
                    i32::from(s.enrichment.is_lift),
                    rank.score,
                    rank.sport_score,
                    s.id,
                ])?;
                s.rank = Some(rank);
            }
        }
        tx.commit()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
