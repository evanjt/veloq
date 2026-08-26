//! Section types and operations.
//!
//! This module provides the API for all sections.
//! Sections are stored in a single table with a `section_type` discriminator (auto vs custom).

use serde::{Deserialize, Serialize};
use tracematch::GpsPoint;

pub mod crud;

/// Section type discriminator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SectionType {
    Auto,
    Custom,
}

impl SectionType {
    pub fn as_str(&self) -> &'static str {
        match self {
            SectionType::Auto => "auto",
            SectionType::Custom => "custom",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "auto" => Some(SectionType::Auto),
            "custom" => Some(SectionType::Custom),
            _ => None,
        }
    }
}

/// A section (auto-detected or custom).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub id: String,
    pub section_type: SectionType,
    pub name: Option<String>,
    pub sport_type: String,
    pub polyline: Vec<GpsPoint>,
    pub distance_meters: f64,

    /// The activity used as reference for the polyline.
    pub representative_activity_id: Option<String>,

    /// Activity IDs that match this section.
    pub activity_ids: Vec<String>,

    /// Number of times this section has been visited.
    pub visit_count: u32,

    // Auto-specific metadata (None for custom sections)
    pub confidence: Option<f64>,
    pub observation_count: Option<u32>,
    pub average_spread: Option<f64>,
    pub point_density: Option<Vec<u32>>,
    pub scale: Option<String>,

    pub is_user_defined: bool,

    /// How well the reference trace aligns with the consensus polyline (0.0-1.0)
    pub stability: Option<f64>,
    /// Elevation gain (m) over the representative slice; None when unknown
    pub elevation_gain_m: Option<f64>,
    /// Net grade (%) over the representative slice; None when unknown
    pub avg_grade_percent: Option<f64>,
    /// Number of times this section has been recalibrated
    pub version: Option<u32>,
    /// ISO timestamp of last recalibration
    pub updated_at: Option<String>,

    pub created_at: String,

    // Route associations
    pub route_ids: Option<Vec<String>>,

    // Custom-specific fields (None for auto sections)
    pub source_activity_id: Option<String>,
    pub start_index: Option<u32>,
    pub end_index: Option<u32>,

    // Visibility state
    /// Whether the user has disabled (hidden) this section.
    pub disabled: bool,
    /// If this auto section is superseded by a custom section, stores its ID.
    pub superseded_by: Option<String>,
}

/// Result of cheap per-activity section indexing (post-ingest).
#[derive(Debug, Default, Clone)]
pub struct IndexActivitySummary {
    pub matched_sections: u32,
    pub inserted_portions: u32,
    pub regrouped: bool,
    pub indicators_recomputed: bool,
}

/// Result of attaching a stored batch to the catalogue (two-tier ingest).
#[derive(Debug, Default, Clone)]
pub struct BatchAttachSummary {
    /// Activities that matched at least one existing section.
    pub attached_activities: u32,
    pub inserted_portions: u32,
    pub regrouped: bool,
    pub indicators_recomputed: bool,
}

/// Parameters for creating a new section.
#[derive(Debug, Clone)]
pub struct CreateSectionParams {
    pub sport_type: String,
    pub polyline: Vec<GpsPoint>,
    pub distance_meters: f64,
    pub name: Option<String>,
    /// If provided, creates a custom section. Otherwise creates auto section.
    pub source_activity_id: Option<String>,
    pub start_index: Option<u32>,
    pub end_index: Option<u32>,
}

/// Lightweight section summary without polyline data.
/// Unified type used by both the persistence layer and sections CRUD.
#[derive(Debug, Clone, Serialize, Deserialize, uniffi::Record)]
pub struct SectionSummary {
    /// Unique section ID
    pub id: String,
    /// Section type: "auto" or "custom"
    pub section_type: String,
    /// Custom name (user-defined, None if not set)
    pub name: Option<String>,
    /// Sport type ("Run", "Ride", etc.)
    pub sport_type: String,
    /// Section length in meters
    pub distance_meters: f64,
    /// Traversals: one per pass, so ten laps count ten. Never below
    /// `activity_count`.
    pub visit_count: u32,
    /// Outings: distinct activities traversing this section.
    pub activity_count: u32,
    /// Activity that provides the representative polyline
    pub representative_activity_id: Option<String>,
    /// Confidence score (0.0-1.0)
    pub confidence: f64,
    /// Detection scale (e.g., "neighborhood", "city")
    pub scale: Option<String>,
    /// Bounding box for map display
    pub bounds: Option<crate::FfiBounds>,
    /// Elevation gain (m) over the representative slice; None when unknown
    pub elevation_gain_m: Option<f64>,
    /// Net grade (%) over the representative slice; None when unknown
    pub avg_grade_percent: Option<f64>,
    /// ISO timestamp when section was created
    pub created_at: String,
    /// All sport types present in this section's activities
    pub sport_types: Vec<String>,
    /// Whether the user has accepted/pinned this section.
    pub is_user_defined: bool,
    /// Whether the user has disabled (hidden) this section.
    pub disabled: bool,
    /// If superseded by a custom section, stores its ID.
    pub superseded_by: Option<String>,
}

/// Match carried lap exclusions onto rebuilt junction rows by nearest
/// `start_index`. Pairs are taken greedily in order of increasing distance,
/// one rebuilt row per carried index, and a pairing further than half the
/// smallest gap between adjacent rebuilt rows is refused rather than guessed.
/// Both inputs are `start_index` values in ascending order.
pub(crate) fn assign_carried_exclusions(carried: &[u32], rebuilt: &[u32]) -> Vec<u32> {
    if carried.is_empty() || rebuilt.is_empty() {
        return Vec::new();
    }
    let cap = rebuilt
        .windows(2)
        .map(|w| w[1].saturating_sub(w[0]))
        .min()
        .map(|gap| gap / 2)
        .unwrap_or(u32::MAX);
    let mut pairs: Vec<(u32, usize, usize)> = Vec::new();
    for (ci, c) in carried.iter().enumerate() {
        for (ri, r) in rebuilt.iter().enumerate() {
            let distance = c.abs_diff(*r);
            if distance <= cap {
                pairs.push((distance, ci, ri));
            }
        }
    }
    pairs.sort_unstable();
    let mut carried_taken = vec![false; carried.len()];
    let mut rebuilt_taken = vec![false; rebuilt.len()];
    let mut matched = Vec::new();
    for (_, ci, ri) in pairs {
        if carried_taken[ci] || rebuilt_taken[ri] {
            continue;
        }
        carried_taken[ci] = true;
        rebuilt_taken[ri] = true;
        matched.push(rebuilt[ri]);
    }
    matched.sort_unstable();
    matched
}

#[cfg(test)]
mod carry_tests {
    use super::assign_carried_exclusions;

    #[test]
    fn an_unchanged_recut_keeps_every_lap() {
        assert_eq!(
            assign_carried_exclusions(&[100, 500], &[0, 100, 500, 900]),
            vec![100, 500]
        );
    }

    #[test]
    fn a_uniform_shift_carries() {
        assert_eq!(
            assign_carried_exclusions(&[100, 500], &[8, 108, 508, 908]),
            vec![108, 508]
        );
    }

    #[test]
    fn an_added_lap_does_not_steal_the_exclusion() {
        assert_eq!(
            assign_carried_exclusions(&[500], &[0, 250, 500, 750]),
            vec![500]
        );
    }

    #[test]
    fn a_removed_lap_drops_its_exclusion() {
        assert_eq!(assign_carried_exclusions(&[100, 500], &[100]), vec![100]);
    }

    #[test]
    fn a_pairing_past_the_half_gap_cap_is_refused() {
        assert!(assign_carried_exclusions(&[400], &[0, 100, 200]).is_empty());
    }

    #[test]
    fn empty_sides_carry_nothing() {
        assert!(assign_carried_exclusions(&[], &[1, 2]).is_empty());
        assert!(assign_carried_exclusions(&[1], &[]).is_empty());
    }

    #[test]
    fn a_single_rebuilt_row_has_no_gap_cap() {
        assert_eq!(assign_carried_exclusions(&[9000], &[3]), vec![3]);
    }
}
