//! Which sections start, or end, where the athlete is standing.
//!
//! `get_nearby_sections` is keyed on a section and answers what surrounds it.
//! This is keyed on a coordinate and answers what a fix could be entering, so
//! a recorder can ask the catalogue the only question it has.

use rusqlite::params;
use tracematch::geo_utils::haversine_distance;

use super::geometry;
use crate::persistence::PersistentEngine;
use crate::sections::live::LiveCandidate;

/// Metres per degree of latitude. The longitude span is this scaled by the
/// cosine of the latitude, which is the only correction a corridor-sized box
/// needs.
const METRES_PER_DEGREE: f64 = 111_320.0;

/// Most sections a single point query returns.
const NEAR_POINT_LIMIT: usize = 20;

/// The nearest the two lines come to each other, in metres, stopping as soon
/// as a pair is within `stop_below` because the caller only asks whether they
/// come closer than its radius.
///
/// Midpoint distance cannot answer that. A three-kilometre section running
/// fifty metres alongside has a midpoint a kilometre and a half away, and a
/// loop drawn around a section has a midpoint on top of it.
pub(crate) fn nearest_approach_meters(
    a: &[crate::GpsPoint],
    b: &[crate::GpsPoint],
    stop_below: f64,
) -> f64 {
    let mut nearest = f64::INFINITY;
    for p in a {
        for q in b {
            let d = haversine_distance(p, q);
            if d < nearest {
                nearest = d;
                if nearest <= stop_below {
                    return nearest;
                }
            }
        }
    }
    nearest
}

/// The bounding-box half-spans, in degrees, that cover `radius_meters` at
/// `lat`. Above 89 degrees the longitude span is the whole world, which the
/// prefilter expresses as 180 rather than dividing by a cosine near zero.
pub(crate) fn degree_span(lat: f64, radius_meters: f64) -> (f64, f64) {
    let dlat = radius_meters / METRES_PER_DEGREE;
    let cos = lat.to_radians().cos();
    let dlng = if cos.abs() < 1e-6 {
        180.0
    } else {
        (dlat / cos).min(180.0)
    };
    (dlat, dlng)
}

/// A visible section whose bounding box covers the fix, resolved to its line.
struct Candidate {
    id: String,
    name: Option<String>,
    sport_type: String,
    distance_meters: f64,
    visit_count: u32,
    line: LiveCandidate,
}

/// A section offered because one of its ends is near the fix.
#[derive(Debug, Clone)]
pub struct SectionNearEitherEnd {
    pub section: crate::FfiSectionNearPoint,
    /// Distance to whichever end admitted it, so the last point for a line
    /// about to be ridden backwards.
    pub nearer_end_distance_meters: f64,
}

impl std::ops::Deref for SectionNearEitherEnd {
    type Target = crate::FfiSectionNearPoint;

    fn deref(&self) -> &Self::Target {
        &self.section
    }
}

impl PersistentEngine {
    /// Sections whose line begins within `radius_meters` of the fix, nearest
    /// start first.
    ///
    /// `sport` matches the stored `sport_type` exactly, so a caller that wants
    /// several sports asks for each.
    pub fn sections_near_point(
        &self,
        lat: f64,
        lng: f64,
        sport: Option<&str>,
        radius_meters: f64,
    ) -> Vec<crate::FfiSectionNearPoint> {
        let fix = crate::GpsPoint::new(lat, lng);
        let mut results: Vec<crate::FfiSectionNearPoint> = self
            .candidates_in_box(lat, lng, sport, radius_meters)
            .into_iter()
            .filter_map(|candidate| {
                let start_distance_meters = haversine_distance(&fix, &candidate.line.start());
                (start_distance_meters <= radius_meters)
                    .then(|| candidate.into_near_point(start_distance_meters))
            })
            .collect();

        results.sort_by(|a, b| {
            a.start_distance_meters
                .partial_cmp(&b.start_distance_meters)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        results.truncate(NEAR_POINT_LIMIT);
        results
    }

    /// Sections with either end within `radius_meters` of the fix, nearer end
    /// first. A fix at a line's last point is about to ride it backwards, and
    /// the start-keyed query above never offers it that line.
    pub fn sections_near_either_end(
        &self,
        lat: f64,
        lng: f64,
        sport: Option<&str>,
        radius_meters: f64,
    ) -> Vec<SectionNearEitherEnd> {
        let fix = crate::GpsPoint::new(lat, lng);
        let mut results: Vec<SectionNearEitherEnd> = self
            .candidates_in_box(lat, lng, sport, radius_meters)
            .into_iter()
            .filter_map(|candidate| {
                let points = candidate.line.points();
                let start_distance_meters = haversine_distance(&fix, &points[0]);
                let end_distance_meters = haversine_distance(&fix, &points[points.len() - 1]);
                let nearer_end_distance_meters = start_distance_meters.min(end_distance_meters);
                (nearer_end_distance_meters <= radius_meters).then(|| SectionNearEitherEnd {
                    section: candidate.into_near_point(start_distance_meters),
                    nearer_end_distance_meters,
                })
            })
            .collect();

        results.sort_by(|a, b| {
            a.nearer_end_distance_meters
                .partial_cmp(&b.nearer_end_distance_meters)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        results.truncate(NEAR_POINT_LIMIT);
        results
    }

    /// Every visible section whose bounding box covers the fix, with its line
    /// resolved. The box is a prefilter and nothing more: a fix inside a long
    /// section's box is usually nowhere near either end, so the callers decide
    /// on the line.
    fn candidates_in_box(
        &self,
        lat: f64,
        lng: f64,
        sport: Option<&str>,
        radius_meters: f64,
    ) -> Vec<Candidate> {
        if !lat.is_finite() || !lng.is_finite() || !(radius_meters > 0.0) {
            return vec![];
        }
        let (dlat, dlng) = degree_span(lat, radius_meters);

        let sql = format!(
            "SELECT id, name, sport_type, distance_meters, visit_count,
                    polyline_json, polyline_blob,
                    representative_activity_id, rep_start_index, rep_end_index
             FROM sections
             WHERE {}
               AND bounds_min_lat IS NOT NULL
               AND bounds_min_lat <= ?1 + ?3 AND bounds_max_lat >= ?1 - ?3
               AND bounds_min_lng <= ?2 + ?4 AND bounds_max_lng >= ?2 - ?4
               AND (?5 IS NULL OR sport_type = ?5)",
            Self::VISIBLE_FILTER
        );

        let mut stmt = match self.db.prepare(&sql) {
            Ok(stmt) => stmt,
            Err(e) => {
                log::warn!("veloqrs: [proximity] near-point query did not prepare: {e}");
                return vec![];
            }
        };

        let rows = stmt.query_map(params![lat, lng, dlat, dlng, sport], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, f64>(3)?,
                row.get::<_, u32>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<Vec<u8>>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<u32>>(8)?,
                row.get::<_, Option<u32>>(9)?,
            ))
        });
        let rows = match rows {
            Ok(rows) => rows,
            Err(e) => {
                log::warn!("veloqrs: [proximity] near-point query did not run: {e}");
                return vec![];
            }
        };

        let mut candidates = Vec::new();
        for row in rows.flatten() {
            let (
                id,
                name,
                sport_type,
                distance_meters,
                visit_count,
                polyline_json,
                polyline_blob,
                rep,
                rep_start,
                rep_end,
            ) = row;
            let Ok(points) = geometry::line(
                &self.db,
                polyline_blob.as_deref(),
                polyline_json.as_deref(),
                geometry::reference(rep.as_deref(), rep_start, rep_end),
            ) else {
                continue;
            };
            let Some(line) = LiveCandidate::new(id.clone(), points) else {
                continue;
            };
            candidates.push(Candidate {
                id,
                name,
                sport_type,
                distance_meters,
                visit_count,
                line,
            });
        }
        candidates
    }
}

impl Candidate {
    fn into_near_point(self, start_distance_meters: f64) -> crate::FfiSectionNearPoint {
        crate::FfiSectionNearPoint {
            id: self.id,
            name: self.name,
            sport_type: self.sport_type,
            distance_meters: self.distance_meters,
            visit_count: self.visit_count,
            start_distance_meters,
            entry_bearing_degrees: self.line.opening_bearing(),
            encoded_polyline: crate::coords::encode(self.line.points()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_degree_span_widens_with_latitude() {
        let (dlat, dlng) = degree_span(0.0, 111_320.0);
        assert!((dlat - 1.0).abs() < 1e-9);
        assert!((dlng - 1.0).abs() < 1e-6);

        let (_, dlng_60) = degree_span(60.0, 111_320.0);
        assert!((dlng_60 - 2.0).abs() < 1e-3, "got {dlng_60}");
    }

    fn line(points: &[(f64, f64)]) -> Vec<crate::GpsPoint> {
        points
            .iter()
            .map(|(lat, lng)| crate::GpsPoint::new(*lat, *lng))
            .collect()
    }

    #[test]
    fn nearest_approach_is_the_closest_pair_not_the_closest_midpoints() {
        // A short stub and a long line running 0.001 degrees north of it. The
        // midpoints are a degree apart; the lines are never more than ~111 m.
        let stub = line(&[(0.0, 0.0), (0.0, 0.001)]);
        let alongside = line(&[(0.001, 0.0), (0.001, 1.0), (0.001, 2.0)]);
        let d = nearest_approach_meters(&stub, &alongside, 0.0);
        assert!(d > 100.0 && d < 120.0, "got {d}");
    }

    #[test]
    fn nearest_approach_stops_as_soon_as_it_is_under_the_threshold() {
        let a = line(&[(0.0, 0.0)]);
        let b = line(&[(0.0, 0.0), (10.0, 10.0)]);
        assert_eq!(nearest_approach_meters(&a, &b, 1.0), 0.0);
    }

    #[test]
    fn nearest_approach_of_an_empty_line_is_infinite() {
        let a = line(&[(0.0, 0.0)]);
        assert!(nearest_approach_meters(&a, &[], 0.0).is_infinite());
        assert!(nearest_approach_meters(&[], &a, 0.0).is_infinite());
    }

    #[test]
    fn test_degree_span_is_bounded_at_the_pole() {
        let (_, dlng) = degree_span(90.0, 100.0);
        assert_eq!(dlng, 180.0);
    }
}
