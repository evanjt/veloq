//! Which sections start where the athlete is standing.
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
        if !lat.is_finite() || !lng.is_finite() || !(radius_meters > 0.0) {
            return vec![];
        }
        let (dlat, dlng) = degree_span(lat, radius_meters);

        // The bounding box is a prefilter and nothing more. A fix inside a
        // long section's box is usually nowhere near where that section
        // starts, so the answer is decided on the resolved line below.
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

        let fix = crate::GpsPoint::new(lat, lng);
        let mut results: Vec<crate::FfiSectionNearPoint> = Vec::new();
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
            let Some(candidate) = LiveCandidate::new(id.clone(), points) else {
                continue;
            };
            let start_distance_meters = haversine_distance(&fix, &candidate.start());
            if start_distance_meters > radius_meters {
                continue;
            }
            results.push(crate::FfiSectionNearPoint {
                id,
                name,
                sport_type,
                distance_meters,
                visit_count,
                start_distance_meters,
                entry_bearing_degrees: candidate.opening_bearing(),
                encoded_polyline: crate::coords::encode(candidate.points()),
            });
        }

        results.sort_by(|a, b| {
            a.start_distance_meters
                .partial_cmp(&b.start_distance_meters)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        results.truncate(NEAR_POINT_LIMIT);
        results
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

    #[test]
    fn test_degree_span_is_bounded_at_the_pole() {
        let (_, dlng) = degree_span(90.0, 100.0);
        assert_eq!(dlng, 180.0);
    }
}
