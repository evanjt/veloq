//! Section FFI exports.
//!
//! Clean FFI functions for section operations.

use super::{CreateSectionParams, SectionType};
use crate::persistence::with_persistent_engine;
use log::info;

/// Get sections as JSON with optional type filter.
///
/// # Arguments
/// * `section_type` - Optional filter: "auto", "custom", or None for all
///
/// # Returns
/// JSON array of Section objects
#[uniffi::export]
pub fn get_sections_json(section_type: Option<String>) -> String {
    let st = section_type.as_deref().and_then(SectionType::from_str);

    with_persistent_engine(|e| {
        let sections = e.get_sections_by_type(st);
        serde_json::to_string(&sections).unwrap_or_else(|_| "[]".to_string())
    })
    .unwrap_or_else(|| "[]".to_string())
}

/// Get section count by type.
///
/// # Arguments
/// * `section_type` - Optional filter: "auto", "custom", or None for all
#[uniffi::export]
pub fn get_section_count(section_type: Option<String>) -> u32 {
    let st = section_type.as_deref().and_then(SectionType::from_str);

    with_persistent_engine(|e| e.get_section_count_by_type(st)).unwrap_or(0)
}

/// Get section summaries (lightweight, no polylines).
///
/// # Arguments
/// * `section_type` - Optional filter: "auto", "custom", or None for all
#[uniffi::export]
pub fn get_section_summaries_json(section_type: Option<String>) -> String {
    let st = section_type.as_deref().and_then(SectionType::from_str);

    with_persistent_engine(|e| {
        let summaries = e.get_section_summaries_by_type(st);
        serde_json::to_string(&summaries).unwrap_or_else(|_| "[]".to_string())
    })
    .unwrap_or_else(|| "[]".to_string())
}

/// Create a new section.
///
/// # Arguments
/// * `sport_type` - Activity type (cycling, running, etc.)
/// * `polyline_json` - JSON array of GpsPoint coordinates
/// * `distance_meters` - Total section distance
/// * `name` - Optional section name
/// * `source_activity_id` - Source activity ID (required for custom sections)
/// * `start_index` - Start index in source activity (custom sections)
/// * `end_index` - End index in source activity (custom sections)
///
/// # Returns
/// The created section ID, or empty string on error
#[uniffi::export]
pub fn create_section(
    sport_type: String,
    polyline_json: String,
    distance_meters: f64,
    name: Option<String>,
    source_activity_id: Option<String>,
    start_index: Option<u32>,
    end_index: Option<u32>,
) -> String {
    let polyline = serde_json::from_str(&polyline_json).unwrap_or_default();

    let params = CreateSectionParams {
        sport_type,
        polyline,
        distance_meters,
        name,
        source_activity_id,
        start_index,
        end_index,
    };

    with_persistent_engine(|e| e.create_section(params).unwrap_or_default())
        .unwrap_or_default()
}

/// Rename a section.
///
/// # Arguments
/// * `section_id` - Section ID to rename
/// * `name` - New name
///
/// # Returns
/// true on success, false on error
#[uniffi::export]
pub fn rename_section(section_id: String, name: String) -> bool {
    with_persistent_engine(|e| e.rename_section(&section_id, &name).is_ok()).unwrap_or(false)
}

/// Set a new reference activity for a section.
///
/// Updates the representative_activity_id and reloads the polyline from the activity.
///
/// # Arguments
/// * `section_id` - Section ID to update
/// * `activity_id` - New reference activity ID
///
/// # Returns
/// true on success, false on error
#[uniffi::export]
pub fn set_section_reference(section_id: String, activity_id: String) -> bool {
    info!(
        "tracematch: [sections] Setting reference for {} to {}",
        section_id, activity_id
    );

    with_persistent_engine(|e| e.set_section_reference(&section_id, &activity_id).is_ok())
        .unwrap_or(false)
}

/// Delete a section.
///
/// # Arguments
/// * `section_id` - Section ID to delete
///
/// # Returns
/// true on success, false on error
#[uniffi::export]
pub fn delete_section(section_id: String) -> bool {
    info!("tracematch: [sections] Deleting section {}", section_id);

    with_persistent_engine(|e| e.delete_section(&section_id).is_ok()).unwrap_or(false)
}

/// Get sections for a specific activity.
///
/// Uses junction table for efficient lookup.
///
/// # Arguments
/// * `activity_id` - Activity ID to find sections for
///
/// # Returns
/// JSON array of sections containing the activity
#[uniffi::export]
pub fn get_sections_for_activity_json(activity_id: String) -> String {
    with_persistent_engine(|e| {
        let sections = e.get_sections_for_activity(&activity_id);
        serde_json::to_string(&sections).unwrap_or_else(|_| "[]".to_string())
    })
    .unwrap_or_else(|| "[]".to_string())
}

/// Get a single section by ID.
///
/// # Arguments
/// * `section_id` - Section ID to retrieve
///
/// # Returns
/// JSON object of the section, or empty string if not found
#[uniffi::export]
pub fn get_section_json(section_id: String) -> String {
    with_persistent_engine(|e| {
        e.get_section(&section_id)
            .map(|s| serde_json::to_string(&s).unwrap_or_default())
            .unwrap_or_default()
    })
    .unwrap_or_default()
}

/// Initialize sections schema.
/// Called during database initialization.
#[uniffi::export]
pub fn init_sections_schema() -> bool {
    with_persistent_engine(|e| e.init_sections_schema().is_ok()).unwrap_or(false)
}
