//! The saved routes near the recording fix: the record screen's nearby read.

use crate::Bounds;

/// How far from the fix a route's bounding box may lie and still count as nearby.
pub(crate) const NEARBY_RADIUS_METRES: f64 = 2_000.0;

/// The most routes the read returns, nearest first.
pub(crate) const NEARBY_LIMIT: usize = 10;

const METRES_PER_DEGREE: f64 = 111_320.0;

/// Metres from the fix to the bounding box, zero when the box contains it.
pub(crate) fn metres_from_bounds(bounds: &Bounds, latitude: f64, longitude: f64) -> f64 {
    let metres_per_lng_degree = METRES_PER_DEGREE * latitude.to_radians().cos();
    let d_lat = (bounds.min_lat - latitude)
        .max(0.0)
        .max(latitude - bounds.max_lat);
    let d_lng = (bounds.min_lng - longitude)
        .max(0.0)
        .max(longitude - bounds.max_lng);
    (d_lat * METRES_PER_DEGREE).hypot(d_lng * metres_per_lng_degree)
}

pub(crate) mod pooled {
    use rusqlite::Connection;

    use super::*;
    use crate::persistence::activities::pooled as activities;
    use crate::persistence::fitness::performances::route_performances;
    use crate::persistence::route_lines::MIN_ROUTE_ACTIVITIES;
    use crate::persistence::routes::pooled as routes;

    /// The routes of `sport`'s family within the radius of the fix, nearest first, at most
    /// [`NEARBY_LIMIT`]. A route is in when one of its attempts is in the family, and its best
    /// time is the fastest counted attempt in that family. The `followed` route is always
    /// returned, last when it lies outside the radius or past the limit, so what the athlete
    /// follows is described by the same read.
    pub(crate) fn recording_nearby_routes(
        conn: &Connection,
        latitude: f64,
        longitude: f64,
        sport: &str,
        followed: Option<&str>,
    ) -> Vec<crate::ffi_types::FfiNearbyRoute> {
        let family = crate::sport::family_of(sport);
        let mut candidates: Vec<(f64, crate::persistence::GroupSummary)> =
            routes::group_keys(conn, true, true)
                .into_iter()
                .filter(|g| g.activity_count >= MIN_ROUTE_ACTIVITIES)
                .filter_map(|g| {
                    let away = metres_from_bounds(g.bounds.as_ref()?, latitude, longitude);
                    (away <= NEARBY_RADIUS_METRES || followed == Some(g.group_id.as_str()))
                        .then_some((away, g))
                })
                .collect();
        candidates.sort_by(|a, b| {
            a.0.total_cmp(&b.0)
                .then_with(|| a.1.group_id.cmp(&b.1.group_id))
        });

        let mut nearby = Vec::new();
        for (away, summary) in candidates {
            let is_followed = followed == Some(summary.group_id.as_str());
            if nearby.len() == NEARBY_LIMIT && !is_followed {
                continue;
            }
            let Some(group) = routes::group_by_id(conn, &summary.group_id) else {
                continue;
            };
            let in_family = |id: &str| {
                activities::metrics_of(conn, id).filter(|m| family.contains(&m.sport_type.as_str()))
            };
            if !group.activity_ids.iter().any(|id| in_family(id).is_some()) {
                continue;
            }
            let performances = route_performances(
                &group.activity_ids,
                Some(&routes::match_info(conn, &group.group_id)),
                &routes::excluded_route_activity_ids(conn, &group.group_id),
                in_family,
                None,
                None,
            );
            let encoded_coords = activities::map_signatures_for_ids(
                conn,
                std::slice::from_ref(&summary.representative_id),
            )
            .into_iter()
            .next()
            .map(|s| s.encoded_coords)
            .unwrap_or_default();
            nearby.push(crate::ffi_types::FfiNearbyRoute {
                name: summary
                    .custom_name
                    .clone()
                    .unwrap_or_else(|| summary.group_id.clone()),
                group_id: summary.group_id,
                distance_meters: summary.distance_meters,
                away_meters: away,
                best_time_seconds: performances.best.map(|p| p.moving_time),
                encoded_coords,
            });
        }
        nearby
    }
}
