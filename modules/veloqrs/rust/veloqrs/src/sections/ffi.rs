//! Section FFI exports.
//!
//! Clean FFI functions for section operations.

use super::{CreateSectionParams, SectionType};
use crate::persistence::with_persistent_engine;
use log::info;

/// Get sections with optional type filter.
///
/// # Arguments
/// * `section_type` - Optional filter: "auto", "custom", or None for all
///
/// # Returns
/// Vec of FfiSection objects
#[uniffi::export]
pub fn get_sections(section_type: Option<String>) -> Vec<crate::FfiSection> {
    let st = section_type.as_deref().and_then(SectionType::from_str);

    with_persistent_engine(|e| {
        e.get_sections_by_type(st)
            .into_iter()
            .map(crate::FfiSection::from)
            .collect()
    })
    .unwrap_or_default()
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
    info!(
        "tracematch: [sections] Creating section: sport={}, distance={:.0}m, source={:?}, range={:?}-{:?}, polyline_len={}",
        sport_type, distance_meters, source_activity_id, start_index, end_index, polyline_json.len()
    );

    let polyline: Vec<tracematch::GpsPoint> = match serde_json::from_str(&polyline_json) {
        Ok(p) => p,
        Err(e) => {
            info!("tracematch: [sections] Failed to parse polyline JSON: {}", e);
            return String::new();
        }
    };

    info!("tracematch: [sections] Parsed {} GPS points", polyline.len());

    // Compute distance from polyline in Rust (ignore JS-computed distance_meters)
    let computed_distance = tracematch::matching::calculate_route_distance(&polyline);

    let params = CreateSectionParams {
        sport_type,
        polyline,
        distance_meters: computed_distance,
        name,
        source_activity_id,
        start_index,
        end_index,
    };

    let result = with_persistent_engine(|e| e.create_section(params));

    match result {
        Some(Ok(id)) => {
            info!("tracematch: [sections] Created section: {}", id);
            id
        }
        Some(Err(e)) => {
            info!("tracematch: [sections] Failed to create section: {}", e);
            String::new()
        }
        None => {
            info!("tracematch: [sections] Engine not available");
            String::new()
        }
    }
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
/// Returns structured data instead of JSON string.
///
/// # Arguments
/// * `activity_id` - Activity ID to find sections for
///
/// # Returns
/// Vec of sections containing the activity
#[uniffi::export]
pub fn get_sections_for_activity(activity_id: String) -> Vec<crate::FfiSection> {
    with_persistent_engine(|e| {
        e.get_sections_for_activity(&activity_id)
            .into_iter()
            .map(crate::FfiSection::from)
            .collect()
    })
    .unwrap_or_default()
}

/// Get the reference activity ID for a section.
///
/// # Arguments
/// * `section_id` - Section ID to query
///
/// # Returns
/// The representative_activity_id, or empty string if not found
#[uniffi::export]
pub fn get_section_reference(section_id: String) -> String {
    with_persistent_engine(|e| {
        e.get_section(&section_id)
            .and_then(|s| s.representative_activity_id)
    })
    .flatten()
    .unwrap_or_default()
}

/// Check if a section's reference is user-defined (vs algorithm-selected).
///
/// # Arguments
/// * `section_id` - Section ID to query
///
/// # Returns
/// true if user manually set the reference, false if algorithm-selected
#[uniffi::export]
pub fn is_section_reference_user_defined(section_id: String) -> bool {
    with_persistent_engine(|e| e.get_section(&section_id).map(|s| s.is_user_defined))
        .flatten()
        .unwrap_or(false)
}

/// Reset a section's reference to automatic (algorithm-selected).
/// Sets is_user_defined to false.
///
/// # Arguments
/// * `section_id` - Section ID to reset
///
/// # Returns
/// true on success, false on error
#[uniffi::export]
pub fn reset_section_reference(section_id: String) -> bool {
    with_persistent_engine(|e| e.reset_section_reference(&section_id).is_ok()).unwrap_or(false)
}
