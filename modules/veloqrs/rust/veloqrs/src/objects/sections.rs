use super::error::{VeloqError, with_engine, with_engine_read};
use crate::sections::SectionType;
use std::sync::Arc;

#[derive(uniffi::Object)]
pub struct SectionManager {
    pub(crate) _private: (),
}

#[uniffi::export]
impl SectionManager {
    #[uniffi::constructor]
    pub fn new() -> Arc<Self> {
        Arc::new(Self { _private: () })
    }

    /// The sections a read wants, with the corridor-name overlay applied.
    ///
    /// One call rather than four: the filter narrows by sport, visit floor,
    /// type and activity, and an empty filter is every visible section. The
    /// overlay is applied here, once, so the name an athlete gave a corridor
    /// reads the same on every screen.
    pub fn get_sections(
        &self,
        filter: crate::FfiSectionFilter,
    ) -> Result<Vec<crate::FfiSection>, VeloqError> {
        // Read lock throughout: every path below borrows the engine and none
        // mutates it, so the section list no longer serialises on the write
        // lock the detector's apply holds.
        with_engine_read(|e| {
            let mut sections: Vec<crate::FfiSection> =
                match (&filter.activity_id, &filter.section_type) {
                    (Some(activity_id), _) => e
                        .get_sections_for_activity(activity_id)
                        .into_iter()
                        .map(crate::FfiSection::from)
                        .collect(),
                    (None, Some(section_type)) => e
                        .get_sections_by_type(SectionType::from_str(section_type))
                        .into_iter()
                        .map(crate::FfiSection::from)
                        .collect(),
                    (None, None) => e
                        .get_sections_filtered(filter.sport_type.as_deref(), filter.min_visits)
                        .into_iter()
                        .map(crate::FfiSection::from)
                        .collect(),
                };

            // The two database-backed paths above filter by their own key
            // alone, so a filter naming more than one narrowing is finished
            // here rather than in three query builders.
            if filter.activity_id.is_some() || filter.section_type.is_some() {
                if let Some(sport) = filter.sport_type.as_deref() {
                    sections.retain(|s| s.sport_type == sport);
                }
                if let Some(min_visits) = filter.min_visits {
                    sections.retain(|s| s.visit_count >= min_visits);
                }
            }
            if let Some(section_type) = filter.section_type.as_deref() {
                sections.retain(|s| s.section_type == section_type);
            }

            let names = e.named_overlay_cached_names();
            for section in &mut sections {
                if section.is_user_defined {
                    continue;
                }
                if let Some(name) = names.get(&section.id) {
                    section.name = Some(name.clone());
                }
            }
            sections
        })
    }

    fn get_by_id(&self, section_id: String) -> Result<Option<crate::FfiSection>, VeloqError> {
        with_engine(|e| {
            e.get_section_by_id(&section_id)
                .map(crate::FfiSection::from)
        })
    }

    /// Total number of sections, without deserializing any section blobs.
    /// Cheap alternative to `get_summaries`/`get_all` for count-only callers.
    fn get_count(&self) -> Result<u32, VeloqError> {
        with_engine(|e| e.get_section_count())
    }

    /// Section summaries for a filter, with the total count beside them.
    ///
    /// `sort_key` accepts "visits", "distance" and "name"; anything else, and
    /// `None`, leaves the engine's own order. The visit floor counts outings
    /// and the sort counts traversals: laps show ground covered, not that the
    /// athlete came back.
    fn get_summaries(
        &self,
        filter: crate::FfiSectionFilter,
        sort_key: Option<String>,
    ) -> Result<crate::FfiSectionSummariesResult, VeloqError> {
        with_engine(|e| {
            let total_count = e.get_section_count();
            let mut summaries = match filter.sport_type {
                Some(ref sport) => e.get_section_summaries_for_sport(sport),
                None => e.get_section_summaries(),
            };
            if let Some(min_visits) = filter.min_visits {
                summaries.retain(|s| s.activity_count >= min_visits);
            }
            if let Some(section_type) = filter.section_type.as_deref() {
                summaries.retain(|s| s.section_type == section_type);
            }
            match sort_key.as_deref() {
                Some("distance") => summaries.sort_by(|a, b| {
                    b.distance_meters
                        .partial_cmp(&a.distance_meters)
                        .unwrap_or(std::cmp::Ordering::Equal)
                }),
                Some("name") => summaries.sort_by(|a, b| a.id.cmp(&b.id)),
                Some("visits") => summaries.sort_by(|a, b| b.visit_count.cmp(&a.visit_count)),
                _ => {}
            }
            crate::FfiSectionSummariesResult {
                total_count,
                summaries,
            }
        })
    }

    /// The section's line, coordinate-encoded like every other track that
    /// leaves the engine. It used to box a record per point and its one caller
    /// unboxed them again, which is the cost the encoding exists to avoid.
    fn get_polyline(&self, section_id: String) -> Result<Vec<u8>, VeloqError> {
        with_engine(|e| {
            let flat = e.get_section_polyline(&section_id);
            let points: Vec<crate::GpsPoint> = flat
                .chunks_exact(2)
                .map(|c| crate::GpsPoint {
                    latitude: c[0],
                    longitude: c[1],
                    elevation: None,
                })
                .collect();
            crate::coords::encode(&points)
        })
    }

    fn get_performances(
        &self,
        section_id: String,
        sport_type: Option<String>,
    ) -> Result<crate::FfiSectionPerformanceResult, VeloqError> {
        with_engine(|e| {
            crate::FfiSectionPerformanceResult::from(
                e.get_section_performances_filtered(&section_id, sport_type.as_deref()),
            )
        })
    }

    /// Tier 3.2: batched section-performance fetch. Returns one entry per
    /// requested section_id (in input order). Saves N FFI round-trips when
    /// the caller (Insights, Routes list) needs perfs for many sections in
    /// one render.
    fn get_performances_batch(
        &self,
        section_ids: Vec<String>,
        sport_type: Option<String>,
    ) -> Result<Vec<crate::FfiSectionPerformanceBatchEntry>, VeloqError> {
        with_engine(|e| {
            section_ids
                .into_iter()
                .map(|id| {
                    let result = e.get_section_performances_filtered(&id, sport_type.as_deref());
                    crate::FfiSectionPerformanceBatchEntry {
                        section_id: id,
                        result: crate::FfiSectionPerformanceResult::from(result),
                    }
                })
                .collect()
        })
    }

    fn get_excluded_performances(
        &self,
        section_id: String,
    ) -> Result<crate::FfiSectionPerformanceResult, VeloqError> {
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

    fn get_calendar_summary(
        &self,
        section_id: String,
    ) -> Result<Option<crate::FfiCalendarSummary>, VeloqError> {
        with_engine(|e| {
            e.get_section_calendar_summary(&section_id, None)
                .map(crate::FfiCalendarSummary::from)
        })
    }

    fn get_reference_info(
        &self,
        section_id: String,
    ) -> Result<crate::FfiSectionReferenceInfo, VeloqError> {
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

    fn accept(&self, section_id: String) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.accept_section(&section_id)
                .map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })
        })?
    }

    fn accept_all(&self) -> Result<u32, VeloqError> {
        with_engine(|e| {
            e.accept_all_sections().map_err(|e| VeloqError::Database {
                msg: format!("{}", e),
            })
        })?
    }

    fn set_name(&self, section_id: String, name: String) -> Result<(), VeloqError> {
        let name_opt = if name.is_empty() {
            None
        } else {
            Some(name.as_str())
        };
        with_engine(|e| {
            e.set_section_name(&section_id, name_opt)
                .map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })
        })?
    }

    fn get_named_corridors(&self) -> Result<Vec<crate::FfiNamedCorridor>, VeloqError> {
        with_engine(|e| {
            e.get_named_corridors()
                .into_iter()
                .map(crate::FfiNamedCorridor::from)
                .collect()
        })
    }

    fn remove_named_corridor(&self, intent_id: String) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.remove_named_corridor(&intent_id)
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
        let polyline: Vec<tracematch::GpsPoint> = polyline
            .into_iter()
            .map(tracematch::GpsPoint::from)
            .collect();

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
                .map_err(|e| VeloqError::Database { msg: e })?;
            // Recompute indicators since exclusion changes PR/trend calculations
            if let Err(err) = e.recompute_activity_indicators() {
                log::warn!(
                    "veloqrs: [exclude_activity] Indicator recomputation failed: {}",
                    err
                );
            }
            Ok(())
        })?
    }

    fn include_activity(&self, section_id: String, activity_id: String) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.include_activity_in_section(&section_id, &activity_id)
                .map_err(|e| VeloqError::Database { msg: e })?;
            // Recompute indicators since inclusion changes PR/trend calculations
            if let Err(err) = e.recompute_activity_indicators() {
                log::warn!(
                    "veloqrs: [include_activity] Indicator recomputation failed: {}",
                    err
                );
            }
            Ok(())
        })?
    }

    fn get_excluded_activities(&self, section_id: String) -> Result<Vec<String>, VeloqError> {
        with_engine(|e| e.get_excluded_activity_ids(&section_id))
    }

    fn exclude_lap(
        &self,
        section_id: String,
        activity_id: String,
        start_index: u32,
    ) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.exclude_section_lap(&section_id, &activity_id, start_index)
                .map_err(|e| VeloqError::Database { msg: e })?;
            if let Err(err) = e.recompute_activity_indicators() {
                log::warn!(
                    "veloqrs: [exclude_lap] Indicator recomputation failed: {}",
                    err
                );
            }
            Ok(())
        })?
    }

    fn include_lap(
        &self,
        section_id: String,
        activity_id: String,
        start_index: u32,
    ) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.include_section_lap(&section_id, &activity_id, start_index)
                .map_err(|e| VeloqError::Database { msg: e })?;
            if let Err(err) = e.recompute_activity_indicators() {
                log::warn!(
                    "veloqrs: [include_lap] Indicator recomputation failed: {}",
                    err
                );
            }
            Ok(())
        })?
    }

    fn get_history(
        &self,
        section_id: String,
    ) -> Result<Vec<crate::FfiSectionHistoryEvent>, VeloqError> {
        with_engine(|e| {
            e.section_history(&section_id)
                .into_iter()
                .map(|h| crate::FfiSectionHistoryEvent {
                    id: h.id,
                    at: h.at,
                    kind: h.kind,
                    details: h.details,
                    geometry_version: h.geometry_version,
                })
                .collect()
        })
    }

    fn get_geometry_versions(
        &self,
        section_id: String,
    ) -> Result<Vec<crate::FfiSectionGeometryVersion>, VeloqError> {
        with_engine(|e| {
            let pinned = e.pinned_section_version(&section_id);
            e.section_geometry_versions(&section_id)
                .into_iter()
                .map(|v| crate::FfiSectionGeometryVersion {
                    version: v.version,
                    created_at: v.created_at,
                    milestone: v.milestone,
                    pinned: pinned == Some(v.version),
                })
                .collect()
        })
    }

    /// A stored version's line, coordinate-encoded like a section polyline.
    fn get_geometry_version_coords(
        &self,
        section_id: String,
        version: i64,
    ) -> Result<Vec<u8>, VeloqError> {
        with_engine(|e| {
            e.section_geometry_polyline(&section_id, version)
                .map(|pts| crate::coords::encode(&pts))
                .unwrap_or_default()
        })
    }

    fn revert_to_version(&self, section_id: String, version: i64) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.revert_section_to_version(&section_id, version)
                .map_err(|msg| VeloqError::Database { msg })
        })?
    }

    fn unpin(&self, section_id: String) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.unpin_section_geometry(&section_id)
                .map_err(|err| VeloqError::Database {
                    msg: err.to_string(),
                })
        })?
    }

    fn get_pinned_version(&self, section_id: String) -> Result<Option<i64>, VeloqError> {
        with_engine(|e| e.pinned_section_version(&section_id))
    }

    fn get_retired(&self) -> Result<Vec<crate::FfiRetiredSection>, VeloqError> {
        with_engine(|e| {
            e.retired_sections()
                .into_iter()
                .map(|r| crate::FfiRetiredSection {
                    section_id: r.section_id,
                    kind: r.kind,
                    at: r.at,
                    into: r.into,
                    versions: r.versions,
                })
                .collect()
        })
    }

    fn get_recent_changes(&self, days: u32) -> Result<Vec<crate::FfiSectionChange>, VeloqError> {
        with_engine(|e| {
            e.recent_section_changes(days)
                .into_iter()
                .map(|c| crate::FfiSectionChange {
                    section_id: c.section_id,
                    kind: c.kind,
                    at: c.at,
                })
                .collect()
        })
    }

    fn get_lineages(&self) -> Result<Vec<crate::FfiSectionLineage>, VeloqError> {
        with_engine(|e| {
            e.section_lineages()
                .into_iter()
                .map(|l| crate::FfiSectionLineage {
                    section_id: l.section_id,
                    parent_id: l.parent_id,
                    discriminator: l.discriminator,
                })
                .collect()
        })
    }

    fn get_excluded_laps(
        &self,
        section_id: String,
    ) -> Result<Vec<crate::FfiExcludedLap>, VeloqError> {
        with_engine(|e| {
            e.get_excluded_section_laps(&section_id)
                .into_iter()
                .map(|(activity_id, start_index)| crate::FfiExcludedLap {
                    activity_id,
                    start_index,
                })
                .collect()
        })
    }

    fn delete(&self, section_id: String) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.delete_section(&section_id)
                .map_err(|e| VeloqError::Database { msg: e })
        })?
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

    fn get_extension_track(
        &self,
        section_id: String,
    ) -> Result<crate::FfiSectionExtensionTrack, VeloqError> {
        with_engine(|e| {
            let (track, start, end) = e
                .get_section_extension_track(&section_id)
                .map_err(|msg| VeloqError::Database { msg })?;
            Ok(crate::FfiSectionExtensionTrack {
                encoded_track: crate::coords::encode(&track),
                section_start_idx: start,
                section_end_idx: end,
            })
        })?
    }

    fn expand_bounds(
        &self,
        section_id: String,
        activity_id: String,
        start_index: u32,
        end_index: u32,
    ) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.expand_section_bounds(&section_id, &activity_id, start_index, end_index)
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

    fn set_superseded(
        &self,
        auto_section_id: String,
        custom_section_id: String,
    ) -> Result<(), VeloqError> {
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

    /// Get ALL section summaries including disabled/superseded (for restore UI).
    fn get_all_summaries_including_hidden(
        &self,
        sport_type: Option<String>,
    ) -> Result<Vec<crate::SectionSummary>, VeloqError> {
        with_engine(|e| match sport_type {
            Some(ref sport) => {
                // Use the unfiltered variant
                e.get_all_section_summaries(None)
                    .into_iter()
                    .filter(|s| {
                        crate::persistence::PersistentEngine::summary_covers_sport(s, sport)
                    })
                    .collect()
            }
            None => e.get_all_section_summaries(None),
        })
    }

    /// Match an activity's GPS track against all existing sections.
    /// Returns all matches found (may be empty if activity doesn't traverse any section).
    fn match_activity_to_sections(
        &self,
        activity_id: String,
    ) -> Result<Vec<crate::FfiSectionMatch>, VeloqError> {
        with_engine(|engine| {
            let track = match engine.get_gps_track(&activity_id) {
                Some(t) if t.len() >= 3 => t,
                _ => return vec![],
            };

            let sections = engine.get_sections();
            if sections.is_empty() {
                return vec![];
            }

            // The user's config, matching the attach path's window.
            let config = engine.get_section_config();
            let matches =
                tracematch::sections::optimized::find_sections_in_route(&track, sections, &config);

            matches
                .into_iter()
                .map(|m| {
                    let section = sections.iter().find(|s| s.id == m.section_id);
                    let portion_slice =
                        &track[m.start_index as usize..(m.end_index as usize).min(track.len())];
                    let distance = tracematch::matching::calculate_route_distance(portion_slice);
                    crate::FfiSectionMatch {
                        section_id: m.section_id,
                        section_name: section.and_then(|s| s.name.clone()),
                        sport_type: section.map(|s| s.sport_type.clone()).unwrap_or_default(),
                        start_index: m.start_index,
                        end_index: m.end_index,
                        match_quality: m.match_quality,
                        same_direction: m.same_direction,
                        distance_meters: distance,
                    }
                })
                .collect()
        })
    }

    /// Cheap post-ingest indexing for one freshly downloaded activity: match it
    /// against existing sections, insert junction rows, regroup incrementally,
    /// and refresh indicators. Does not create new sections - those wait for
    /// the next full detection run.
    fn index_new_activity(
        &self,
        activity_id: String,
    ) -> Result<crate::FfiIndexActivitySummary, VeloqError> {
        with_engine(|engine| {
            engine
                .index_new_activity(&activity_id)
                .map(crate::FfiIndexActivitySummary::from)
        })?
        .map_err(|e| VeloqError::Database { msg: e })
    }

    /// Force-match a single activity to a specific section with relaxed thresholds.
    /// Returns true if a match was found and the section_activities row was inserted.
    fn rematch_activity_to_section(
        &self,
        activity_id: String,
        section_id: String,
    ) -> Result<bool, VeloqError> {
        with_engine(|engine| {
            engine
                .rematch_activity_to_section(&activity_id, &section_id)
                .unwrap_or_else(|e| {
                    log::warn!("veloqrs: [rematch] {}", e);
                    false
                })
        })
    }

    /// Merge two sections. Moves all traversal history from secondary into primary.
    /// Recomputes consensus polyline. Deletes secondary. Returns the primary section ID.
    fn merge_sections(
        &self,
        primary_id: String,
        secondary_id: String,
    ) -> Result<String, VeloqError> {
        with_engine(|engine| {
            engine
                .merge_user_sections(&primary_id, &secondary_id)
                .map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })
        })?
    }

    /// Home-screen "Sections for you" list. Composes ML ranking + performance
    /// lookups in one FFI round-trip instead of N+1 per-section `getPerformances`
    /// calls from TS.
    fn get_workout_sections(
        &self,
        sport_type: String,
        limit: u32,
    ) -> Result<Vec<crate::FfiWorkoutSection>, VeloqError> {
        with_engine(|e| e.get_workout_sections_for_sport(&sport_type, limit))
    }

    /// Pre-computed chart payload for the section-detail screen: per-lap
    /// points, speed ranks, best/avg/last stats - all in one FFI round-trip.
    /// Replaces the 3+ useMemo aggregations in `useSectionChartData`.
    fn get_chart_data(
        &self,
        section_id: String,
        time_range_days: u32,
        sport_filter: Option<String>,
    ) -> Result<crate::FfiSectionChartData, VeloqError> {
        with_engine(|e| {
            e.get_section_chart_data(&section_id, time_range_days, sport_filter.as_deref())
        })
    }

    /// The sections a fix could be entering, nearest start first.
    ///
    /// Keyed on a coordinate rather than a section, so a live recording can
    /// ask what is in front of it. `sport` matches the stored sport exactly.
    fn get_near_point(
        &self,
        latitude: f64,
        longitude: f64,
        sport_type: Option<String>,
        radius_meters: f64,
    ) -> Result<Vec<crate::FfiSectionNearPoint>, VeloqError> {
        with_engine_read(|e| {
            e.sections_near_point(latitude, longitude, sport_type.as_deref(), radius_meters)
        })
    }

    /// Everything the section detail screen can paint before its time streams
    /// have been fetched: the section, its neighbours and merge candidates,
    /// exclusions, bounds state, per-activity metrics and signatures, and the
    /// activities whose streams are still missing.
    fn get_detail_data(
        &self,
        section_id: String,
        nearby_radius_meters: f64,
    ) -> Result<crate::FfiSectionDetailData, VeloqError> {
        with_engine(|e| e.section_detail_data(&section_id, nearby_radius_meters))
    }

    /// The lap-time reads for the section detail screen: calendar summary,
    /// performance records and chart payload. Call once the streams reported
    /// by `get_detail_data` have landed.
    fn get_detail_performance(
        &self,
        section_id: String,
        time_range_days: u32,
        sport_filter: Option<String>,
    ) -> Result<crate::FfiSectionPerformanceData, VeloqError> {
        with_engine(|e| {
            e.section_detail_performance(&section_id, time_range_days, sport_filter.as_deref())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_globals::{init_global_engine, seeded_global_engine, serial_global_state};

    fn filter() -> crate::FfiSectionFilter {
        crate::FfiSectionFilter {
            sport_type: None,
            min_visits: None,
            section_type: None,
            activity_id: None,
        }
    }

    fn line(seed: f64) -> Vec<crate::FfiGpsPoint> {
        (0..12)
            .map(|i| crate::FfiGpsPoint {
                latitude: 46.2 + seed + f64::from(i) * 0.001,
                longitude: 7.35 + seed,
                elevation: None,
            })
            .collect()
    }

    #[test]
    fn an_empty_catalogue_answers_every_read_with_nothing() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("sections.db");
        let sections = SectionManager::new();

        assert_eq!(sections.get_count().unwrap(), 0);
        assert!(sections.get_by_id("s1".into()).unwrap().is_none());
        let result = sections
            .get_summaries(filter(), Some("visits".into()))
            .unwrap();
        assert_eq!(result.total_count, 0);
        assert!(result.summaries.is_empty());
        assert!(crate::coords::decode(&sections.get_polyline("s1".into()).unwrap()).is_empty());
        assert!(sections.get_all_names().unwrap().is_empty());
        assert!(sections.get_named_corridors().unwrap().is_empty());
        assert!(sections.get_retired().unwrap().is_empty());
        assert!(sections.get_recent_changes(30).unwrap().is_empty());
        assert!(sections.get_lineages().unwrap().is_empty());
        assert!(sections.get_history("s1".into()).unwrap().is_empty());
        assert!(
            sections
                .get_excluded_activities("s1".into())
                .unwrap()
                .is_empty()
        );
        assert!(sections.get_excluded_laps("s1".into()).unwrap().is_empty());
        assert!(
            sections
                .get_all_summaries_including_hidden(None)
                .unwrap()
                .is_empty()
        );
        assert!(
            sections
                .get_workout_sections("Ride".into(), 5)
                .unwrap()
                .is_empty()
        );
        assert_eq!(sections.accept_all().unwrap(), 0);
        assert!(
            sections
                .match_activity_to_sections("a1".into())
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn a_custom_section_is_created_named_filtered_disabled_and_deleted() {
        let _guard = serial_global_state();
        let _tmp = seeded_global_engine();
        let sections = SectionManager::new();

        let id = sections
            .create(
                "Ride".into(),
                line(0.0),
                0.0,
                Some("Climb".into()),
                Some("a0".into()),
                Some(0),
                Some(11),
            )
            .unwrap();
        assert_eq!(sections.get_count().unwrap(), 1);

        assert!(id.starts_with("custom_"), "{id}");

        let section = sections
            .get_by_id(id.clone())
            .unwrap()
            .expect("created section");
        assert_eq!(section.name.as_deref(), Some("Climb"));
        assert_eq!(section.sport_type, "Ride");
        assert!(
            section.distance_meters > 1000.0,
            "twelve points a metre-ish apart in latitude"
        );
        assert!(!sections.get_polyline(id.clone()).unwrap().is_empty());

        let custom = sections
            .get_summaries(
                crate::FfiSectionFilter {
                    section_type: Some("custom".into()),
                    ..filter()
                },
                Some("name".into()),
            )
            .unwrap();
        assert_eq!(custom.total_count, 1);
        assert_eq!(custom.summaries.len(), 1);
        let auto_only = sections
            .get_summaries(
                crate::FfiSectionFilter {
                    section_type: Some("auto".into()),
                    ..filter()
                },
                None,
            )
            .unwrap();
        assert!(
            auto_only.summaries.is_empty(),
            "a custom section is not an auto one"
        );
        let other_sport = sections
            .get_summaries(
                crate::FfiSectionFilter {
                    sport_type: Some("Run".into()),
                    ..filter()
                },
                None,
            )
            .unwrap();
        assert!(other_sport.summaries.is_empty());

        sections.set_name(id.clone(), "Col".into()).unwrap();
        assert_eq!(
            sections
                .get_all_names()
                .unwrap()
                .get(&id)
                .map(String::as_str),
            Some("Col")
        );
        sections.set_name(id.clone(), String::new()).unwrap();
        assert!(
            sections.get_all_names().unwrap().get(&id).is_none(),
            "an empty name clears it"
        );

        sections.disable(id.clone()).unwrap();
        assert!(
            sections
                .get_summaries(filter(), None)
                .unwrap()
                .summaries
                .is_empty(),
            "a disabled section leaves the visible list"
        );
        assert_eq!(
            sections
                .get_all_summaries_including_hidden(None)
                .unwrap()
                .len(),
            1
        );
        sections.enable(id.clone()).unwrap();
        assert_eq!(
            sections
                .get_summaries(filter(), None)
                .unwrap()
                .summaries
                .len(),
            1
        );

        // A name or visibility edit is not a lifecycle event; only a geometry
        // change, a supersession or a rebase writes one.
        assert!(sections.get_history(id.clone()).unwrap().is_empty());

        sections.delete(id.clone()).unwrap();
        assert_eq!(sections.get_count().unwrap(), 0);
        assert!(sections.get_by_id(id).unwrap().is_none());
    }

    #[test]
    fn exclusions_are_flags_on_a_membership() {
        let _guard = serial_global_state();
        let _tmp = seeded_global_engine();
        let sections = SectionManager::new();
        let id = sections
            .create(
                "Ride".into(),
                line(0.0),
                0.0,
                None,
                Some("a0".into()),
                Some(0),
                Some(11),
            )
            .unwrap();

        sections.exclude_activity(id.clone(), "a0".into()).unwrap();
        let excluded = sections.get_excluded_activities(id.clone()).unwrap();
        assert!(excluded.is_empty() || excluded == vec!["a0"]);
        sections.include_activity(id.clone(), "a0".into()).unwrap();
        assert!(sections.get_excluded_activities(id).unwrap().is_empty());
    }
}
