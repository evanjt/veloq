//! Section CRUD operations.
//!
//! Unified database operations for all sections (both auto and custom).
//! All sections are stored in a single `sections` table with a `section_type` discriminator.
//!
//! Split into three sibling submodules by responsibility:
//! - [`queries`]: read-only queries (by type, by activity, summaries, bounds checks).
//! - [`mutations`]: create, rename, reference, delete, save, activity matching.
//! - [`editing`]: bounds editing, visibility, imports, schema initialisation.

mod editing;
mod mutations;
mod queries;

use tracematch::matching::calculate_route_distance;
use tracematch::sections::{find_all_track_portions, find_all_track_portions_with_gap};
use tracematch::{GpsPoint, SectionPortion};

/// Compute all traversals (laps) of an activity over a section polyline.
/// Uses the tracematch lap-splitting algorithm.
///
/// The tolerance derives from the proximity anchor: a quarter of it is the
/// long-standing 50 m at the default 200 m, and it scales with the slider
/// so the attach paths match the same ground detection would.
pub(crate) fn compute_section_portions(
    activity_id: &str,
    track: &[GpsPoint],
    section_polyline: &[GpsPoint],
    proximity_threshold: f64,
) -> Vec<SectionPortion> {
    let traversals = find_all_track_portions(track, section_polyline, proximity_threshold * 0.25);

    traversals
        .into_iter()
        .map(|(start_idx, end_idx, direction)| {
            let distance = calculate_route_distance(&track[start_idx..end_idx]);
            SectionPortion {
                activity_id: activity_id.to_string(),
                start_index: start_idx as u32,
                end_index: end_idx as u32,
                distance_meters: distance,
                direction,
            }
        })
        .collect()
}

/// Stricter version of compute_section_portions for reference changes.
/// Tolerance 0.15x the proximity anchor (30 m at the default 200 m) and
/// gap 1, to avoid including parallel roads or large non-matching spans.
pub(super) fn compute_section_portions_strict(
    activity_id: &str,
    track: &[GpsPoint],
    section_polyline: &[GpsPoint],
    proximity_threshold: f64,
) -> Vec<SectionPortion> {
    let traversals =
        find_all_track_portions_with_gap(track, section_polyline, proximity_threshold * 0.15, 1);

    traversals
        .into_iter()
        .map(|(start_idx, end_idx, direction)| {
            let distance = calculate_route_distance(&track[start_idx..end_idx]);
            SectionPortion {
                activity_id: activity_id.to_string(),
                start_index: start_idx as u32,
                end_index: end_idx as u32,
                distance_meters: distance,
                direction,
            }
        })
        .collect()
}
