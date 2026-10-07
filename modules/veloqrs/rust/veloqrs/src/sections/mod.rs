//! Section types.
//!
//! The shapes a section crosses the crate in. Everything that reads or writes
//! one lives in `persistence::sections`, which is the single tree for storage,
//! detection, identity, editing and history.
//! Sections are stored in a single table with a `section_type` discriminator (auto vs custom).

use serde::{Deserialize, Serialize};
use tracematch::GpsPoint;

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

    pub fn parse(s: &str) -> Option<Self> {
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
    /// The label detection stored, which only a detect that partitions by
    /// sport reads. Nothing shows or filters a section by it: `sport_types`
    /// is what a section is to every reader.
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
    pub elevation_loss_m: Option<f64>,
    /// Steepest grade (%) held over 300 m of the slice.
    pub max_grade_percent: Option<f64>,
    /// Chord over arc, 0..1.
    pub straightness: Option<f64>,
    /// climb, descent, rolling, flat or loop; None when nothing says.
    pub klass: Option<String>,
    pub is_lift: bool,
    /// Interestingness percentile across the catalogue, 0..1.
    pub rank_score: Option<f64>,
    /// Interestingness percentile within the section's sport, 0..1.
    pub sport_rank_score: Option<f64>,
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
    /// Every sport whose included outings have taken the section, sorted.
    pub sport_types: Vec<String>,
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
#[derive(Debug, Clone, Default, Serialize, Deserialize, uniffi::Record)]
pub struct SectionSummary {
    /// Unique section ID
    pub id: String,
    /// Section type: "auto" or "custom"
    pub section_type: String,
    /// Custom name (user-defined, None if not set)
    pub name: Option<String>,
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
    pub elevation_loss_m: Option<f64>,
    /// Steepest grade (%) held over 300 m of the slice.
    pub max_grade_percent: Option<f64>,
    /// climb, descent, rolling, flat or loop; None when nothing says.
    pub klass: Option<String>,
    pub is_lift: bool,
    /// Interestingness percentile across the catalogue, 0..1.
    pub rank_score: Option<f64>,
    /// Interestingness percentile within the section's sport, 0..1.
    pub sport_rank_score: Option<f64>,
    /// ISO timestamp when section was created
    pub created_at: String,
    /// Every sport whose included outings have taken the section, sorted. A
    /// section has no sport of its own.
    pub sport_types: Vec<String>,
    /// Whether the user has accepted/pinned this section.
    pub is_user_defined: bool,
    /// Whether the user has disabled (hidden) this section.
    pub disabled: bool,
    /// If superseded by a custom section, stores its ID.
    pub superseded_by: Option<String>,
}

/// An activity's laps on a section before an edit took its rows, for an
/// activity with some laps excluded and some included. Both lists are
/// `start_index` values; the included ones are kept so the spacing the laps
/// had is known when the excluded ones are matched onto the rebuilt rows.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(from = "LapCarryRepr")]
pub(crate) struct LapCarry {
    pub(crate) excluded: Vec<u32>,
    pub(crate) included: Vec<u32>,
}

/// A hold written before the included laps were kept is the excluded starts
/// alone.
#[derive(Deserialize)]
#[serde(untagged)]
enum LapCarryRepr {
    Current {
        excluded: Vec<u32>,
        included: Vec<u32>,
    },
    ExcludedOnly(Vec<u32>),
}

impl From<LapCarryRepr> for LapCarry {
    fn from(repr: LapCarryRepr) -> Self {
        match repr {
            LapCarryRepr::Current { excluded, included } => Self { excluded, included },
            LapCarryRepr::ExcludedOnly(excluded) => Self {
                excluded,
                included: Vec::new(),
            },
        }
    }
}

/// Match carried lap exclusions onto rebuilt junction rows by nearest
/// `start_index`. Pairs are taken greedily in order of increasing distance,
/// one rebuilt row per carried index, and a pairing further than half the
/// smallest gap between adjacent laps, before the edit or after it, is
/// refused rather than guessed. When the capture held an included lap and
/// every rebuilt row would end up excluded, nothing carries: a per-lap
/// exclusion never leaves the activity fully excluded.
/// All inputs are `start_index` values in ascending order.
pub(crate) fn assign_carried_exclusions(carried: &LapCarry, rebuilt: &[u32]) -> Vec<u32> {
    if carried.excluded.is_empty() || rebuilt.is_empty() {
        return Vec::new();
    }
    let mut before: Vec<u32> = carried
        .excluded
        .iter()
        .chain(&carried.included)
        .copied()
        .collect();
    before.sort_unstable();
    before.dedup();
    let cap = [before.as_slice(), rebuilt]
        .iter()
        .flat_map(|rows| rows.windows(2).map(|w| w[1].saturating_sub(w[0])))
        .min()
        .map(|gap| gap / 2)
        .unwrap_or(u32::MAX);
    let included = &carried.included;
    let carried = &carried.excluded[..];
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
    if !included.is_empty() && matched.len() == rebuilt.len() {
        return Vec::new();
    }
    matched
}

#[cfg(test)]
mod carry_tests {
    use super::{LapCarry, assign_carried_exclusions};

    fn carry(excluded: &[u32], included: &[u32]) -> LapCarry {
        LapCarry {
            excluded: excluded.to_vec(),
            included: included.to_vec(),
        }
    }

    #[test]
    fn an_unchanged_recut_keeps_every_lap() {
        assert_eq!(
            assign_carried_exclusions(&carry(&[100, 500], &[900]), &[0, 100, 500, 900]),
            vec![100, 500]
        );
    }

    #[test]
    fn a_uniform_shift_carries() {
        assert_eq!(
            assign_carried_exclusions(&carry(&[100, 500], &[0, 900]), &[8, 108, 508, 908]),
            vec![108, 508]
        );
    }

    #[test]
    fn an_added_lap_does_not_steal_the_exclusion() {
        assert_eq!(
            assign_carried_exclusions(&carry(&[500], &[0]), &[0, 250, 500, 750]),
            vec![500]
        );
    }

    #[test]
    fn a_removed_lap_drops_its_exclusion() {
        assert_eq!(
            assign_carried_exclusions(&carry(&[100, 500], &[900]), &[100, 900]),
            vec![100]
        );
    }

    #[test]
    fn a_pairing_past_the_half_gap_cap_is_refused() {
        assert!(assign_carried_exclusions(&carry(&[400], &[0]), &[0, 100, 200]).is_empty());
    }

    #[test]
    fn empty_sides_carry_nothing() {
        assert!(assign_carried_exclusions(&carry(&[], &[1]), &[1, 2]).is_empty());
        assert!(assign_carried_exclusions(&carry(&[1], &[2]), &[]).is_empty());
    }

    #[test]
    fn a_lone_excluded_lap_far_from_the_only_rebuilt_row_carries_nothing() {
        assert!(assign_carried_exclusions(&carry(&[500], &[100]), &[108]).is_empty());
    }

    #[test]
    fn a_lone_excluded_lap_shifted_a_few_indices_still_carries() {
        assert_eq!(
            assign_carried_exclusions(&carry(&[500], &[100]), &[100, 505]),
            vec![505]
        );
    }

    #[test]
    fn every_lap_excluded_onto_the_same_laps_carries_both() {
        assert_eq!(
            assign_carried_exclusions(&carry(&[100, 500], &[]), &[100, 500]),
            vec![100, 500]
        );
    }

    #[test]
    fn a_carry_that_would_exclude_every_rebuilt_row_is_dropped_when_a_lap_was_included() {
        assert!(assign_carried_exclusions(&carry(&[500], &[100]), &[505]).is_empty());
    }

    #[test]
    fn a_hold_written_with_excluded_starts_alone_still_reads() {
        let held: LapCarry = serde_json::from_str("[100,500]").unwrap();
        assert_eq!(held, carry(&[100, 500], &[]));
    }
}
