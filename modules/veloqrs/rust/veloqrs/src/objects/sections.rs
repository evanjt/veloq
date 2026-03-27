use super::error::{with_engine, VeloqError};
use crate::sections::SectionType;
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

    fn get_all(&self) -> Result<Vec<crate::FfiFrequentSection>, VeloqError> {
        with_engine(|e| {
            e.get_sections()
                .iter()
                .cloned()
                .map(crate::FfiFrequentSection::from)
                .collect()
        })
    }

    fn get_filtered(
        &self,
        sport_type: Option<String>,
        min_visits: Option<u32>,
    ) -> Result<Vec<crate::FfiFrequentSection>, VeloqError> {
        with_engine(|e| {
            e.get_sections_filtered(sport_type.as_deref(), min_visits)
                .into_iter()
                .map(crate::FfiFrequentSection::from)
                .collect()
        })
    }

    fn get_by_type(&self, section_type: Option<String>) -> Result<Vec<crate::FfiSection>, VeloqError> {
        let st = section_type.as_deref().and_then(SectionType::from_str);
        with_engine(|e| {
            e.get_sections_by_type(st)
                .into_iter()
                .map(crate::FfiSection::from)
                .collect()
        })
    }

    fn get_for_activity(&self, activity_id: String) -> Result<Vec<crate::FfiSection>, VeloqError> {
        with_engine(|e| {
            e.get_sections_for_activity(&activity_id)
                .into_iter()
                .map(crate::FfiSection::from)
                .collect()
        })
    }

    fn get_by_id(&self, section_id: String) -> Result<Option<crate::FfiFrequentSection>, VeloqError> {
        with_engine(|e| e.get_section_by_id(&section_id).map(crate::FfiFrequentSection::from))
    }

    fn get_summaries(&self, sport_type: Option<String>) -> Result<Vec<crate::SectionSummary>, VeloqError> {
        with_engine(|e| match sport_type {
            Some(ref sport) => e.get_section_summaries_for_sport(sport),
            None => e.get_section_summaries(),
        })
    }

    fn get_ranked(&self, sport_type: String, limit: u32) -> Result<Vec<crate::FfiRankedSection>, VeloqError> {
        with_engine(|e| e.get_ranked_sections(&sport_type, limit))
    }

    fn get_summaries_with_count(
        &self,
        sport_type: Option<String>,
    ) -> Result<crate::FfiSectionSummariesResult, VeloqError> {
        with_engine(|e| {
            let total_count = e.get_section_count();
            let summaries = match sport_type {
                Some(ref sport) => e.get_section_summaries_for_sport(sport),
                None => e.get_section_summaries(),
            };
            crate::FfiSectionSummariesResult {
                total_count,
                summaries,
            }
        })
    }

    fn get_polyline(&self, section_id: String) -> Result<Vec<crate::FfiGpsPoint>, VeloqError> {
        with_engine(|e| {
            let flat = e.get_section_polyline(&section_id);
            flat.chunks(2)
                .map(|c| crate::FfiGpsPoint {
                    latitude: c[0],
                    longitude: c[1],
                    elevation: None,
                })
                .collect()
        })
    }

    fn get_performances(&self, section_id: String, sport_type: Option<String>) -> Result<crate::FfiSectionPerformanceResult, VeloqError> {
        with_engine(|e| {
            crate::FfiSectionPerformanceResult::from(
                e.get_section_performances_filtered(&section_id, sport_type.as_deref())
            )
        })
    }

    fn get_excluded_performances(&self, section_id: String) -> Result<crate::FfiSectionPerformanceResult, VeloqError> {
        with_engine(|e| {
            let records = e.get_excluded_section_performances(&section_id);
            crate::FfiSectionPerformanceResult::from(crate::SectionPerformanceResult {
                records,
                best_record: None,
                best_forward_record: None,
                best_reverse_record: None,
                forward_stats: None,
                reverse_stats: None,
            })
        })
    }

    fn get_calendar_summary(&self, section_id: String) -> Result<Option<crate::FfiCalendarSummary>, VeloqError> {
        with_engine(|e| {
            e.get_section_calendar_summary(&section_id)
                .map(crate::FfiCalendarSummary::from)
        })
    }

    fn get_reference_info(&self, section_id: String) -> Result<crate::FfiSectionReferenceInfo, VeloqError> {
        with_engine(|e| {
            e.get_section(&section_id)
                .map(|s| crate::FfiSectionReferenceInfo {
                    activity_id: s.representative_activity_id.unwrap_or_default(),
                    is_user_defined: s.is_user_defined,
                })
                .unwrap_or(crate::FfiSectionReferenceInfo {
                    activity_id: String::new(),
                    is_user_defined: false,
                })
        })
    }

    fn set_reference(&self, section_id: String, activity_id: String) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.set_section_reference(&section_id, &activity_id)
                .map_err(|e| VeloqError::Database { msg: e })
        })?
    }

    fn reset_reference(&self, section_id: String) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.reset_section_reference(&section_id)
                .map_err(|e| VeloqError::Database { msg: e })
        })?
    }

    fn set_name(&self, section_id: String, name: String) -> Result<(), VeloqError> {
        let name_opt = if name.is_empty() { None } else { Some(name.as_str()) };
        with_engine(|e| {
            e.set_section_name(&section_id, name_opt)
                .map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })
        })?
    }

    fn get_all_names(&self) -> Result<std::collections::HashMap<String, String>, VeloqError> {
        with_engine(|e| e.get_all_section_names())
    }

    fn create(
        &self,
        sport_type: String,
        polyline: Vec<crate::FfiGpsPoint>,
        _distance_meters: f64,
        name: Option<String>,
        source_activity_id: Option<String>,
        start_index: Option<u32>,
        end_index: Option<u32>,
    ) -> Result<String, VeloqError> {
        let polyline: Vec<tracematch::GpsPoint> =
            polyline.into_iter().map(tracematch::GpsPoint::from).collect();

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

        with_engine(|e| {
            e.create_section(params)
                .map_err(|e| VeloqError::Database { msg: e })
        })?
    }

    fn exclude_activity(&self, section_id: String, activity_id: String) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.exclude_activity_from_section(&section_id, &activity_id)
                .map_err(|e| VeloqError::Database { msg: e })
        })?
    }

    fn include_activity(&self, section_id: String, activity_id: String) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.include_activity_in_section(&section_id, &activity_id)
                .map_err(|e| VeloqError::Database { msg: e })
        })?
    }

    fn get_excluded_activities(&self, section_id: String) -> Result<Vec<String>, VeloqError> {
        with_engine(|e| e.get_excluded_activity_ids(&section_id))
    }

    fn delete(&self, section_id: String) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.delete_section(&section_id)
                .map_err(|e| VeloqError::Database { msg: e })
        })?
    }

    fn extract_trace(
        &self,
        activity_id: String,
        section_polyline_json: String,
    ) -> Result<Vec<f64>, VeloqError> {
        with_engine(|engine| {
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
    }

    fn trim(&self, section_id: String, start_index: u32, end_index: u32) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.trim_section(&section_id, start_index, end_index)
                .map_err(|e| VeloqError::Database { msg: e })
        })?
    }

    fn reset_bounds(&self, section_id: String) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.reset_section_bounds(&section_id)
                .map_err(|e| VeloqError::Database { msg: e })
        })?
    }

    fn has_original_bounds(&self, section_id: String) -> Result<bool, VeloqError> {
        with_engine(|e| e.has_original_bounds(&section_id))
    }

    fn get_extension_track(
        &self,
        section_id: String,
    ) -> Result<crate::FfiSectionExtensionTrack, VeloqError> {
        with_engine(|e| {
            let (track, start, end) = e
                .get_section_extension_track(&section_id)
                .map_err(|msg| VeloqError::Database { msg })?;
            Ok(crate::FfiSectionExtensionTrack {
                track: track
                    .iter()
                    .flat_map(|p| vec![p.latitude, p.longitude])
                    .collect(),
                section_start_idx: start,
                section_end_idx: end,
            })
        })?
    }

    fn expand_bounds(
        &self,
        section_id: String,
        new_polyline_json: String,
    ) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.expand_section_bounds(&section_id, &new_polyline_json)
                .map_err(|e| VeloqError::Database { msg: e })
        })?
    }

    fn get_efficiency_trend(
        &self,
        section_id: String,
    ) -> Result<Option<crate::FfiEfficiencyTrend>, VeloqError> {
        with_engine(|e| e.get_section_efficiency_trend(&section_id))
    }

    fn disable(&self, section_id: String) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.disable_section(&section_id)
                .map_err(|e| VeloqError::Database { msg: e })
        })?
    }

    fn enable(&self, section_id: String) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.enable_section(&section_id)
                .map_err(|e| VeloqError::Database { msg: e })
        })?
    }

    fn set_superseded(&self, auto_section_id: String, custom_section_id: String) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.set_superseded(&auto_section_id, &custom_section_id)
                .map_err(|e| VeloqError::Database { msg: e })
        })?
    }

    fn clear_superseded(&self, custom_section_id: String) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.clear_superseded(&custom_section_id)
                .map_err(|e| VeloqError::Database { msg: e })
        })?
    }

    fn import_disabled_ids(&self, ids: Vec<String>) -> Result<u32, VeloqError> {
        with_engine(|e| {
            e.import_disabled_ids(&ids)
                .map_err(|e| VeloqError::Database { msg: e })
        })?
    }

    fn import_superseded_map(&self, entries: Vec<crate::FfiSupersededEntry>) -> Result<u32, VeloqError> {
        with_engine(|e| {
            let map: Vec<(String, Vec<String>)> = entries
                .into_iter()
                .map(|entry| (entry.custom_section_id, entry.auto_section_ids))
                .collect();
            e.import_superseded_map(&map)
                .map_err(|e| VeloqError::Database { msg: e })
        })?
    }

    /// Get ALL section summaries including disabled/superseded (for restore UI).
    fn get_all_summaries_including_hidden(&self, sport_type: Option<String>) -> Result<Vec<crate::SectionSummary>, VeloqError> {
        with_engine(|e| match sport_type {
            Some(ref sport) => {
                // Use the unfiltered variant
                e.get_all_section_summaries(None)
                    .into_iter()
                    .filter(|s| s.sport_type == sport)
                    .collect()
            }
            None => e.get_all_section_summaries(None),
        })
    }

    fn extract_traces_batch(
        &self,
        activity_ids: Vec<String>,
        section_polyline_json: String,
    ) -> Result<Vec<crate::FfiBatchTrace>, VeloqError> {
        with_engine(|engine| {
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
    }
}
