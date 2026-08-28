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

use tracematch::{GpsPoint, SectionConfig, SectionPortion};

/// Every traversal of a section line by one activity, counted the way
/// detection counts it, so an attached row and a detected row agree.
pub(crate) fn compute_section_portions(
    activity_id: &str,
    track: &[GpsPoint],
    section_polyline: &[GpsPoint],
    config: &SectionConfig,
) -> Vec<SectionPortion> {
    tracematch::track_portions(activity_id, track, section_polyline, config)
}
