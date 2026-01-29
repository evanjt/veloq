use super::*;
use log::info;

pub enum SectionType {
    #[serde(rename = "auto")]
    Auto,
    #[serde(rename = "custom")]
    Custom,
}

pub struct UnifiedSection {
    pub id: String,
    pub section_type: SectionType,

    pub name: Option<String>,

    pub polyline: Vec<GpsPoint>,
    pub distance_meters: f64,

    pub sport_type: String,

    pub source_activity_id: Option<String>,
    pub start_index: Option<u32>,
    pub end_index: Option<u32>,

    pub activity_ids: Vec<String>,
    pub visit_count: u32,

    pub representative_activity_id: Option<String>,

    pub confidence: Option<f64>,
    pub observation_count: Option<u32>,
    pub average_spread: Option<f64>,
    pub point_density: Option<Vec<u32>>,
    pub scale: Option<String>,
    pub version: u32,
    pub is_user_defined: bool,
    pub stability: Option<f64>,

    pub created_at: String,
    pub updated_at: Option<String>,

    pub route_ids: Option<Vec<String>>,

    pub activity_portions: Option<Vec<SectionPortion>>,
}

pub struct CreateSectionParams {
    pub sport_type: String,
    pub polyline: Vec<GpsPoint>,
    pub distance_meters: f64,
    pub name: Option<String>,
    pub source_activity_id: Option<String>,
    pub start_index: Option<u32>,
    pub end_index: Option<u32>,
    pub point_density: Option<Vec<u32>>,
    pub route_ids: Option<Vec<String>>,
}

pub struct SectionPortion {
    pub activity_id: String,
    pub start_index: u32,
    pub end_index: u32,
    pub distance_meters: f64,
    pub direction: String,
}

pub fn get_sections_with_type(
    engine: &mut PersistentRouteEngine,
    section_type: Option<&str>,
) -> Vec<UnifiedSection> {
    engine.get_sections_with_type(section_type)
}

pub fn get_section_count_by_type(
    engine: &PersistentRouteEngine,
    section_type: Option<&str>,
) -> u32 {
    engine.get_section_count_by_type(section_type)
}

pub fn create_section_unified(
    engine: &mut PersistentRouteEngine,
    params: CreateSectionParams,
) -> Result<String, String> {
    engine.create_section_unified(params)
}
