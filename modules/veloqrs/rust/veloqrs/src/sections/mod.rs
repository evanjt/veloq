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
    /// Number of times this section was visited
    pub visit_count: u32,
    /// Number of activities that traverse this section
    pub activity_count: u32,
    /// Activity that provides the representative polyline
    pub representative_activity_id: Option<String>,
    /// Confidence score (0.0-1.0)
    pub confidence: f64,
    /// Detection scale (e.g., "neighborhood", "city")
    pub scale: Option<String>,
    /// Bounding box for map display
    pub bounds: Option<crate::FfiBounds>,
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
