//! Section types and operations.
//!
//! This module provides the API for all sections.
//! Sections are stored in a single table with a `section_type` discriminator (auto vs custom).

use serde::{Deserialize, Serialize};
use tracematch::GpsPoint;

pub mod crud;
pub mod ffi;

// Re-export FFI functions
pub use ffi::*;

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
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SectionSummary {
    pub id: String,
    pub section_type: SectionType,
    pub name: Option<String>,
    pub sport_type: String,
    pub distance_meters: f64,
    pub visit_count: u32,
    pub representative_activity_id: Option<String>,
    pub created_at: String,
}
