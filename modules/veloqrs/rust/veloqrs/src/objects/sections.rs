use crate::persistence::with_persistent_engine;
use crate::sections::SectionType;
use log::info;
use std::sync::Arc;

#[derive(uniffi::Object)]
pub struct SectionManager {
    pub(crate) _private: (),
}

#[uniffi::export]
impl SectionManager {
    #[uniffi::constructor]
    fn new() -> Arc<Self> {
        Arc::new(Self { _private: () })
    }

    fn get_all(&self) -> Vec<crate::FfiFrequentSection> {
        with_persistent_engine(|e| {
            e.get_sections()
                .iter()
                .cloned()
                .map(crate::FfiFrequentSection::from)
                .collect()
        })
        .unwrap_or_default()
    }

    fn get_by_type(&self, section_type: Option<String>) -> Vec<crate::FfiSection> {
        let st = section_type.as_deref().and_then(SectionType::from_str);
        with_persistent_engine(|e| {
            e.get_sections_by_type(st)
                .into_iter()
                .map(crate::FfiSection::from)
                .collect()
        })
        .unwrap_or_default()
    }

    fn get_for_activity(&self, activity_id: String) -> Vec<crate::FfiSection> {
        with_persistent_engine(|e| {
            e.get_sections_for_activity(&activity_id)
                .into_iter()
                .map(crate::FfiSection::from)
                .collect()
        })
        .unwrap_or_default()
    }

    fn get_by_id(&self, section_id: String) -> Option<crate::FfiFrequentSection> {
        with_persistent_engine(|e| e.get_section_by_id(&section_id).map(crate::FfiFrequentSection::from))
            .flatten()
    }

    fn get_count(&self, section_type: Option<String>) -> u32 {
        let st = section_type.as_deref().and_then(SectionType::from_str);
        with_persistent_engine(|e| {
            if st.is_some() {
                e.get_section_count_by_type(st)
            } else {
                e.get_section_count()
            }
        })
        .unwrap_or(0)
    }

    fn get_summaries(&self, sport_type: Option<String>) -> Vec<crate::SectionSummary> {
        with_persistent_engine(|e| match sport_type {
            Some(ref sport) => e.get_section_summaries_for_sport(sport),
            None => e.get_section_summaries(),
        })
        .unwrap_or_default()
    }

    fn get_polyline(&self, section_id: String) -> Vec<f64> {
        with_persistent_engine(|e| e.get_section_polyline(&section_id)).unwrap_or_default()
    }

    fn get_performances(&self, section_id: String) -> crate::FfiSectionPerformanceResult {
        with_persistent_engine(|e| {
            crate::FfiSectionPerformanceResult::from(e.get_section_performances(&section_id))
        })
        .unwrap_or_else(|| crate::FfiSectionPerformanceResult {
            records: vec![],
            best_record: None,
            best_forward_record: None,
            best_reverse_record: None,
            forward_stats: None,
            reverse_stats: None,
        })
    }

    fn get_calendar_summary(&self, section_id: String) -> Option<crate::FfiCalendarSummary> {
        with_persistent_engine(|e| {
            e.get_section_calendar_summary(&section_id)
                .map(crate::FfiCalendarSummary::from)
        })
        .flatten()
    }

    fn get_reference_info(&self, section_id: String) -> crate::FfiSectionReferenceInfo {
        with_persistent_engine(|e| {
            e.get_section(&section_id).map(|s| crate::FfiSectionReferenceInfo {
                activity_id: s.representative_activity_id.unwrap_or_default(),
                is_user_defined: s.is_user_defined,
            })
        })
        .flatten()
        .unwrap_or_else(|| crate::FfiSectionReferenceInfo {
            activity_id: String::new(),
            is_user_defined: false,
        })
    }

    fn set_reference(&self, section_id: String, activity_id: String) -> bool {
        with_persistent_engine(|e| e.set_section_reference(&section_id, &activity_id).is_ok())
            .unwrap_or(false)
    }

    fn reset_reference(&self, section_id: String) -> bool {
        with_persistent_engine(|e| e.reset_section_reference(&section_id).is_ok()).unwrap_or(false)
    }

    fn set_name(&self, section_id: String, name: String) {
        let name_opt = if name.is_empty() { None } else { Some(name.as_str()) };
        with_persistent_engine(|e| {
            e.set_section_name(&section_id, name_opt).ok();
        });
    }

    fn get_all_names(&self) -> std::collections::HashMap<String, String> {
        with_persistent_engine(|e| e.get_all_section_names()).unwrap_or_default()
    }

    fn create(
        &self,
        sport_type: String,
        polyline_json: String,
        _distance_meters: f64,
        name: Option<String>,
        source_activity_id: Option<String>,
        start_index: Option<u32>,
        end_index: Option<u32>,
    ) -> String {
        let polyline: Vec<tracematch::GpsPoint> = match serde_json::from_str(&polyline_json) {
            Ok(p) => p,
            Err(e) => {
                info!("tracematch: [sections] Failed to parse polyline JSON: {}", e);
                return String::new();
            }
        };

        let computed_distance = tracematch::matching::calculate_route_distance(&polyline);

        let params = crate::sections::CreateSectionParams {
            sport_type,
            polyline,
            distance_meters: computed_distance,
            name,
            source_activity_id,
            start_index,
            end_index,
        };

        match with_persistent_engine(|e| e.create_section(params)) {
            Some(Ok(id)) => id,
            _ => String::new(),
        }
    }

    fn delete(&self, section_id: String) -> bool {
        with_persistent_engine(|e| e.delete_section(&section_id).is_ok()).unwrap_or(false)
    }

    fn extract_trace(
        &self,
        activity_id: String,
        section_polyline_json: String,
    ) -> Vec<f64> {
        with_persistent_engine(|engine| {
            let polyline: Vec<tracematch::GpsPoint> =
                match serde_json::from_str(&section_polyline_json) {
                    Ok(p) => p,
                    Err(_) => return vec![],
                };
            if polyline.len() < 2 {
                return vec![];
            }
            let track = match engine.get_gps_track(&activity_id) {
                Some(t) => t,
                None => return vec![],
            };
            if track.len() < 3 {
                return vec![];
            }
            let mut track_map: std::collections::HashMap<&str, &[tracematch::GpsPoint]> =
                std::collections::HashMap::new();
            track_map.insert(activity_id.as_str(), track.as_slice());
            let traces = tracematch::sections::extract_all_activity_traces(
                std::slice::from_ref(&activity_id),
                &polyline,
                &track_map,
            );
            match traces.get(&activity_id) {
                Some(trace) => trace
                    .iter()
                    .flat_map(|p| vec![p.latitude, p.longitude])
                    .collect(),
                None => vec![],
            }
        })
        .unwrap_or_default()
    }

    fn extract_traces_batch(
        &self,
        activity_ids: Vec<String>,
        section_polyline_json: String,
    ) -> Vec<crate::FfiBatchTrace> {
        with_persistent_engine(|engine| {
            let polyline: Vec<tracematch::GpsPoint> =
                match serde_json::from_str(&section_polyline_json) {
                    Ok(p) => p,
                    Err(_) => return vec![],
                };
            if polyline.len() < 2 {
                return vec![];
            }
            let polyline_tree = tracematch::sections::build_rtree(&polyline);
            activity_ids
                .iter()
                .filter_map(|id| {
                    let track = engine.get_gps_track(id)?;
                    if track.len() < 3 {
                        return None;
                    }
                    let trace = tracematch::sections::extract_activity_trace(
                        &track,
                        &polyline,
                        &polyline_tree,
                    );
                    if trace.is_empty() {
                        return None;
                    }
                    Some(crate::FfiBatchTrace {
                        activity_id: id.clone(),
                        coords: trace
                            .iter()
                            .flat_map(|p| vec![p.latitude, p.longitude])
                            .collect(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
    }
}
