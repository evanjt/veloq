use super::*;
use log::info;

/// Get sections by type (auto or custom).
#[uniffi::export]
pub fn persistent_engine_get_sections_by_type_json(section_type: Option<String>) -> String {
    with_persistent_engine(|e| {
        serde_json::to_string(
                &crate::sections::get_sections_with_type(
                    &e,
                    section_type.as_deref().map(|s| s.as_str()),
                ))
        ).unwrap_or_else(|_| "[]".to_string())
    })
}

/// Create a unified section.
#[uniffi::export]
pub fn persistent_engine_create_section_unified(
    sport_type: String,
    polyline_json: String,
    distance_meters: f64,
    name: Option<String>,
    source_activity_id: Option<String>,
) -> String {
    with_persistent_engine(|e| {
        let params = crate::sections::CreateSectionParams {
            sport_type,
            polyline: crate::serde_json::from_str(&polyline_json)
                .map_err(|e| format!("Invalid polyline JSON: {}", e))
                .unwrap_or_default(),
            distance_meters,
            name,
            source_activity_id,
            start_index: None,
            end_index: None,
            point_density: None,
            route_ids: None,
        };

        crate::sections::create_section_unified(&e, params)
            .map_err(|e| e.to_string())
            .unwrap_or_default()
    }).map_err(|e| e.to_string())
}

/// Get section count by type.
#[uniffi::export]
pub fn persistent_engine_get_section_count_by_type(section_type: Option<String>) -> u32 {
    with_persistent_engine(|e| {
        crate::sections::get_section_count_by_type(&e, section_type)
    }).unwrap_or(0)
}
