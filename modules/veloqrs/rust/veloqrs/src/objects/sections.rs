use std::sync::Arc;

use super::error::{VeloqError, with_engine, with_reader};
use crate::persistence::sections::history::pooled as history;
use crate::persistence::sections::{SectionNameError, named, pooled, queries};
use crate::sections::SectionType;

/// The rides an edit took out of a section, named from the library.
fn departed_rides(
    engine: &crate::persistence::PersistentEngine,
    departed: &[String],
) -> Vec<crate::FfiDepartedRide> {
    engine
        .departed_rides(departed)
        .into_iter()
        .map(|(activity_id, name, date)| crate::FfiDepartedRide {
            activity_id,
            name,
            date: date as f64,
        })
        .collect()
}

#[derive(uniffi::Object)]
pub struct SectionManager {
    pub(crate) _private: (),
}

/// The points `start..=end` of a stored track. A reversed or out-of-range
/// cut, or one under two points, is refused rather than clamped, so the
/// stored reference triple always names a line the track holds.
fn slice_inclusive(
    track: &[tracematch::GpsPoint],
    start: u32,
    end: u32,
) -> Result<Vec<tracematch::GpsPoint>, VeloqError> {
    let (start, end) = (start as usize, end as usize);
    if start >= end {
        return Err(VeloqError::ParseError {
            msg: "Section must have at least 2 points".into(),
        });
    }
    if end >= track.len() {
        return Err(VeloqError::ParseError {
            msg: format!(
                "Section range {}..={} is outside a track of {} points",
                start,
                end,
                track.len()
            ),
        });
    }
    Ok(track[start..=end].to_vec())
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
        if filter.activity_id.is_some() || filter.section_type.is_some() {
            return with_reader(|conn| {
                let names = named::pooled::overlay_names(conn);
                let mut sections = match filter.activity_id.as_deref() {
                    Some(activity_id) => {
                        queries::pooled::sections_for_activity(conn, activity_id, &names)
                    }
                    None => queries::pooled::sections_by_type(
                        conn,
                        filter.section_type.as_deref().and_then(SectionType::parse),
                        &names,
                    ),
                }
                .into_iter()
                .map(crate::FfiSection::from)
                .collect::<Vec<crate::FfiSection>>();
                if filter.sport_type.is_some() || filter.min_visits.unwrap_or(0) > 0 {
                    let supported = queries::pooled::supported_section_ids(
                        conn,
                        filter.sport_type.as_deref(),
                        filter.min_visits.unwrap_or(0),
                    );
                    sections.retain(|s| supported.contains(&s.id));
                }
                if let Some(section_type) = filter.section_type.as_deref() {
                    sections.retain(|s| s.section_type == section_type);
                }
                sections
            });
        }

        with_reader(|conn| {
            let names = named::pooled::overlay_names(conn);
            let (stored, stored_ids) =
                queries::pooled::sections_by_type_with_ids(conn, None, &names);
            let mut stored = stored
                .into_iter()
                .map(|section| (section.id.clone(), section))
                .collect::<std::collections::HashMap<_, _>>();
            let mut sections: Vec<crate::FfiSection> =
                pooled::catalogue_sections(conn, filter.sport_type.as_deref(), filter.min_visits)
                    .into_iter()
                    .filter_map(|catalogue| match stored.remove(&catalogue.id) {
                        Some(section) => Some(
                            crate::FfiSection::from(section)
                                .with_portions(catalogue.activity_portions.clone()),
                        ),
                        None if stored_ids.contains(&catalogue.id) => None,
                        None => Some(crate::FfiSection::from(&catalogue)),
                    })
                    .collect();
            for section in &mut sections {
                if section.is_user_defined && section.name.is_some() {
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
        with_reader(|conn| {
            let mut section = queries::pooled::section_raw(conn, &section_id)?;
            let names = named::pooled::overlay_names(conn);
            if (!section.is_user_defined || section.name.is_none())
                && let Some(name) = names.get(&section.id)
            {
                section.name = Some(name.clone());
            }
            let portions = pooled::section_portions(conn, &section_id);
            Some(crate::FfiSection::from(section).with_portions(portions))
        })
    }

    /// Total number of sections, without deserializing any section blobs.
    /// Cheap alternative to `get_summaries`/`get_all` for count-only callers.
    fn get_count(&self) -> Result<u32, VeloqError> {
        with_reader(queries::pooled::section_count)
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
        with_reader(|conn| {
            let total_count = queries::pooled::section_count(conn);
            let names = named::pooled::overlay_names(conn);
            let mut summaries =
                queries::pooled::section_summaries_filtered(conn, None, true, &names);
            if let Some(ref sport) = filter.sport_type {
                summaries.retain(|s| {
                    crate::persistence::PersistentEngine::summary_covers_sport(s, sport)
                });
            }
            // The floor `get_sections` applies: the filtered sport's outings,
            // and a pin exempts it.
            if let Some(min_visits) = filter.min_visits.filter(|&min| min > 0) {
                let supported = queries::pooled::supported_section_ids(
                    conn,
                    filter.sport_type.as_deref(),
                    min_visits,
                );
                summaries.retain(|s| supported.contains(&s.id));
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
                Some("name") => summaries.sort_by(|a, b| {
                    let a_name = a.name.as_deref().unwrap_or(&a.id);
                    let b_name = b.name.as_deref().unwrap_or(&b.id);
                    a_name
                        .to_lowercase()
                        .cmp(&b_name.to_lowercase())
                        .then_with(|| a.id.cmp(&b.id))
                }),
                Some("visits") => summaries.sort_by_key(|b| std::cmp::Reverse(b.visit_count)),
                _ => {}
            }
            crate::FfiSectionSummariesResult {
                total_count,
                summaries,
            }
        })
    }

    fn get_map_sections(
        &self,
        sport_type: Option<String>,
        min_visits: Option<u32>,
    ) -> Result<Vec<crate::FfiMapSection>, VeloqError> {
        with_reader(|conn| {
            crate::persistence::sections::pooled::map_sections(
                conn,
                sport_type.as_deref(),
                min_visits,
                &named::pooled::overlay_names(conn),
            )
        })
    }

    /// Read through the pool, so the section detail screen does not wait
    /// behind a sync writing its pages. The answer is
    /// `performances::pooled::section_performances`, the same arithmetic the
    /// engine runs, and `read_cache::performances` is the reader's own LRU
    /// standing in for the engine's `perf_cache`.
    fn get_performances(
        &self,
        section_id: String,
        sport_type: Option<String>,
    ) -> Result<crate::FfiSectionPerformanceResult, VeloqError> {
        with_reader(|conn| {
            crate::FfiSectionPerformanceResult::from(
                crate::persistence::fitness::performances::pooled::cached_section_performances(
                    conn,
                    &section_id,
                    sport_type.as_deref(),
                )
                .as_ref()
                .clone(),
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
        with_reader(|conn| {
            section_ids
                .into_iter()
                .map(|id| {
                    let result = crate::persistence::fitness::performances::pooled::cached_section_performances(
                        conn,
                        &id,
                        sport_type.as_deref(),
                    );
                    crate::FfiSectionPerformanceBatchEntry {
                        section_id: id,
                        result: crate::FfiSectionPerformanceResult::from(result.as_ref().clone()),
                    }
                })
                .collect()
        })
    }

    fn get_reference_info(
        &self,
        section_id: String,
    ) -> Result<crate::FfiSectionReferenceInfo, VeloqError> {
        // The raw row: neither field is one the corridor-name overlay touches.
        with_reader(|conn| {
            queries::pooled::section_raw(conn, &section_id)
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

    fn set_reference(
        &self,
        section_id: String,
        activity_id: String,
    ) -> Result<Vec<crate::FfiDepartedRide>, VeloqError> {
        with_engine(|e| {
            e.set_section_reference(&section_id, &activity_id)
                .map(|departed| departed_rides(e, &departed))
                .map_err(|e| VeloqError::Database { msg: e })
        })?
    }

    fn reset_reference(
        &self,
        section_id: String,
    ) -> Result<Vec<crate::FfiDepartedRide>, VeloqError> {
        with_engine(|e| {
            e.reset_section_reference(&section_id)
                .map(|departed| departed_rides(e, &departed))
                .map_err(|e| VeloqError::Database { msg: e })
        })?
    }

    fn accept(&self, section_id: String) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.accept_section(&section_id)
                .map_err(|e| VeloqError::Database { msg: e.to_string() })
        })?
    }

    fn accept_all(&self) -> Result<u32, VeloqError> {
        with_engine(|e| {
            e.accept_all_sections()
                .map_err(|e| VeloqError::Database { msg: e.to_string() })
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
                .map_err(|e| match e {
                    SectionNameError::Taken(name) => VeloqError::NameTaken { name },
                    SectionNameError::Failed(msg) => VeloqError::Database { msg },
                })
        })?
    }

    /// Mark or unmark a section as a lift.
    ///
    /// The unmark is durable: `is_lift` is re-derived on every enrichment pass,
    /// so the engine records an intent as well as the column. Marking it again
    /// takes the intent back off.
    fn set_is_lift(&self, section_id: String, is_lift: bool) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.set_section_is_lift(&section_id, is_lift)
                .map_err(|msg| VeloqError::Database { msg })
        })?
    }

    fn get_named_corridors(&self) -> Result<Vec<crate::FfiNamedCorridor>, VeloqError> {
        with_reader(|conn| {
            named::pooled::named_corridors(conn)
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
        with_reader(crate::persistence::sections::naming::pooled::all_section_names)
    }

    /// Cut a section from an inclusive index range of a stored activity's
    /// track. The engine holds the track, so the slice is taken here and the
    /// elevation travels with it.
    fn create(
        &self,
        sport_type: String,
        name: Option<String>,
        source_activity_id: String,
        start_index: u32,
        end_index: u32,
    ) -> Result<String, VeloqError> {
        with_engine(|e| {
            let track = e
                .get_gps_track(&source_activity_id)
                .filter(|track| !track.is_empty())
                .ok_or_else(|| VeloqError::NotFound {
                    msg: format!("No GPS track found for activity {}", source_activity_id),
                })?;
            let polyline = slice_inclusive(&track, start_index, end_index)?;
            let distance_meters = tracematch::matching::calculate_route_distance(&polyline);

            let params = crate::sections::CreateSectionParams {
                sport_type,
                polyline,
                distance_meters,
                name,
                source_activity_id: Some(source_activity_id),
                start_index: Some(start_index),
                end_index: Some(end_index),
            };
            e.create_section(params)
                .map_err(|e| VeloqError::Database { msg: e })
        })?
    }

    fn exclude_activity(&self, section_id: String, activity_id: String) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.exclude_activity_from_section(&section_id, &activity_id)
                .map_err(|e| VeloqError::Database { msg: e })?;
            // Recompute indicators since exclusion changes PR/trend calculations
            if let Err(err) = e.recompute_indicators_for_section(&section_id) {
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
            if let Err(err) = e.recompute_indicators_for_section(&section_id) {
                log::warn!(
                    "veloqrs: [include_activity] Indicator recomputation failed: {}",
                    err
                );
            }
            Ok(())
        })?
    }

    fn get_excluded_activities(&self, section_id: String) -> Result<Vec<String>, VeloqError> {
        with_reader(|conn| queries::pooled::excluded_activity_ids(conn, &section_id))
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
            if let Err(err) = e.recompute_indicators_for_section(&section_id) {
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
            if let Err(err) = e.recompute_indicators_for_section(&section_id) {
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
        with_reader(|conn| {
            history::linked_section_history(conn, &section_id, &named::pooled::overlay_names(conn))
                .into_iter()
                .map(|h| crate::FfiSectionHistoryEvent {
                    id: h.id as f64,
                    at: h.at,
                    kind: h.kind,
                    details: h.details,
                    geometry_version: h.geometry_version.map(|v| v as f64),
                })
                .collect()
        })
    }

    fn get_geometry_versions(
        &self,
        section_id: String,
    ) -> Result<Vec<crate::FfiSectionGeometryVersion>, VeloqError> {
        with_reader(|conn| {
            let pinned = history::pinned_section_version(conn, &section_id);
            history::section_geometry_versions(conn, &section_id)
                .into_iter()
                .map(|v| crate::FfiSectionGeometryVersion {
                    version: v.version as f64,
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
        version: f64,
    ) -> Result<Vec<u8>, VeloqError> {
        let version = crate::ffi_types::int_from_wire(version);
        with_reader(|conn| {
            history::section_geometry_version(conn, &section_id, version)
                .map(|(pts, _)| crate::persistence::codec::encode_polyline(&pts))
                .unwrap_or_default()
        })
    }

    fn revert_to_version(
        &self,
        section_id: String,
        version: f64,
    ) -> Result<Vec<crate::FfiDepartedRide>, VeloqError> {
        let version = crate::ffi_types::int_from_wire(version);
        with_engine(|e| {
            e.revert_section_to_version(&section_id, version)
                .map(|departed| departed_rides(e, &departed))
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

    fn get_pinned_version(&self, section_id: String) -> Result<Option<f64>, VeloqError> {
        with_reader(|conn| history::pinned_section_version(conn, &section_id).map(|v| v as f64))
    }

    fn get_retired(&self) -> Result<Vec<crate::FfiRetiredSection>, VeloqError> {
        with_reader(|conn| {
            history::retired_sections(conn)
                .into_iter()
                .map(|r| crate::FfiRetiredSection {
                    section_id: r.section_id,
                    kind: r.kind,
                    at: r.at,
                    into: r.into,
                    versions: r.versions.into_iter().map(|v| v as f64).collect(),
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

    fn trim(
        &self,
        section_id: String,
        start_index: u32,
        end_index: u32,
    ) -> Result<Vec<crate::FfiDepartedRide>, VeloqError> {
        with_engine(|e| {
            e.trim_section(&section_id, start_index, end_index)
                .map(|departed| departed_rides(e, &departed))
                .map_err(|e| VeloqError::Database { msg: e })
        })?
    }

    fn reset_bounds(&self, section_id: String) -> Result<Vec<crate::FfiDepartedRide>, VeloqError> {
        with_engine(|e| {
            e.reset_section_bounds(&section_id)
                .map(|departed| departed_rides(e, &departed))
                .map_err(|e| VeloqError::Database { msg: e })
        })?
    }

    fn get_extension_track(
        &self,
        section_id: String,
    ) -> Result<crate::FfiSectionExtensionTrack, VeloqError> {
        with_reader(|conn| {
            let config = crate::persistence::settings::section_config_from(conn)
                .map_err(|e| VeloqError::Database { msg: e.to_string() })?;
            let (track, start, end) =
                queries::pooled::section_extension_track(conn, &section_id, &config)
                    .map_err(|msg| VeloqError::Database { msg })?;
            Ok(crate::FfiSectionExtensionTrack {
                encoded_track: crate::persistence::codec::encode_polyline(&track),
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
    ) -> Result<Vec<crate::FfiDepartedRide>, VeloqError> {
        with_engine(|e| {
            e.expand_section_bounds(&section_id, &activity_id, start_index, end_index)
                .map(|departed| departed_rides(e, &departed))
                .map_err(|e| VeloqError::Database { msg: e })
        })?
    }

    fn get_efficiency_trend(
        &self,
        section_id: String,
        sport_type: String,
    ) -> Result<Option<crate::FfiEfficiencyTrend>, VeloqError> {
        with_reader(|conn| {
            let names = named::pooled::overlay_names(conn);
            crate::persistence::screens::pooled::section_efficiency_trend_of(
                conn,
                &section_id,
                &sport_type,
                &names,
            )
        })
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

    /// Match an activity's GPS track against all existing sections.
    /// Returns all matches found (may be empty if activity doesn't traverse any section).
    fn match_activity_to_sections(
        &self,
        activity_id: String,
    ) -> Result<Vec<crate::FfiSectionMatch>, VeloqError> {
        with_reader(|conn| {
            let config = crate::persistence::settings::section_config_from(conn)
                .map_err(|e| VeloqError::Database { msg: e.to_string() })?;
            Ok(queries::pooled::activity_section_matches(
                conn,
                &activity_id,
                &config,
            ))
        })?
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

    /// Merge two sections. Rebuilds the primary's traversals against its own line
    /// over the rides of both. A donor ride with no pass over that line leaves
    /// the section and stays in the library. Deletes secondary. Returns the
    /// primary section ID and the rides that left.
    fn merge_sections(
        &self,
        primary_id: String,
        secondary_id: String,
    ) -> Result<crate::FfiMergeOutcome, VeloqError> {
        with_engine(|engine| {
            let (section_id, departed) = engine
                .merge_user_sections_reporting(&primary_id, &secondary_id)
                .map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })?;
            Ok(crate::FfiMergeOutcome {
                section_id,
                departed: departed_rides(engine, &departed),
            })
        })?
    }

    /// The donor rides a merge into `primary_id` would leave out of the section:
    /// those with no pass over its line. Writes nothing.
    fn merge_preview(
        &self,
        primary_id: String,
        secondary_id: String,
    ) -> Result<Vec<crate::FfiMergeDropped>, VeloqError> {
        with_reader(|conn| {
            crate::persistence::sections::merging::pooled::merge_preview(
                conn,
                &primary_id,
                &secondary_id,
            )
            .map_err(|e| VeloqError::Database {
                msg: format!("{}", e),
            })
        })?
    }

    /// Home-screen "Sections for you" list. Composes the weighted ranking + performance
    /// lookups in one FFI round-trip instead of N+1 per-section `getPerformances`
    /// calls from TS.
    fn get_workout_sections(
        &self,
        sport_type: String,
        limit: u32,
    ) -> Result<Vec<crate::FfiWorkoutSection>, VeloqError> {
        with_reader(|conn| {
            use crate::persistence::sections::ranking::pooled as ranking;
            let names = named::pooled::overlay_names(conn);
            let candidates = ranking::workout_candidates(conn, &sport_type, limit, &names);
            ranking::workout_sections(candidates, |id| {
                crate::persistence::fitness::performances::pooled::cached_section_performances(
                    conn,
                    id,
                    Some(&sport_type),
                )
                .as_ref()
                .clone()
            })
        })
    }

    /// Everything the section detail screen can paint before its time streams
    /// have been fetched: the section, its neighbours and merge candidates,
    /// exclusions, bounds state, per-activity metrics and signatures, and the
    /// activities whose streams are still missing.
    ///
    /// Read through the pool, so opening the screen while a sync page commits
    /// does not wait out the write. What the engine path answers from memory,
    /// the count, the per-activity metrics and the section record, is loaded
    /// from the same rows at init, so the pooled read answers off what the
    /// memory tier is a copy of. The engine method is still the write path's,
    /// and `screens::tests::the_pooled_section_detail_matches_the_one_a_lock_holder_gets`
    /// holds the two to one answer.
    fn get_detail_data(
        &self,
        section_id: String,
    ) -> Result<crate::FfiSectionDetailData, VeloqError> {
        with_reader(|conn| {
            crate::persistence::screens::pooled::section_detail_data(conn, &section_id)
        })
    }

    /// The lap-time reads for the section detail screen: calendar summary,
    /// performance records and chart payload. Call once the streams reported
    /// by `get_detail_data` have landed.
    ///
    /// Read through the pool, so opening the screen while a sync page commits
    /// does not wait out the write. Every part of the bundle is arithmetic over
    /// one set of performances and that set is a query, so nothing here needs
    /// the memory tier. The engine method is still the write path's, and
    /// `screens::tests::the_pooled_section_performance_matches_the_one_a_lock_holder_gets`
    /// holds the two to one answer.
    fn get_detail_performance(
        &self,
        section_id: String,
        time_range_days: u32,
        sport_filter: Option<String>,
    ) -> Result<crate::FfiSectionPerformanceData, VeloqError> {
        with_reader(|conn| {
            crate::persistence::screens::pooled::section_detail_performance(
                conn,
                &section_id,
                time_range_days,
                sport_filter.as_deref(),
            )
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_globals::{init_global_engine, seeded_global_engine, serial_global_state};

    /// Scenario: the athlete opens a section while a sync page commits. The
    /// page holds the engine write lock for the length of its transaction and
    /// the performance bundle used to wait it out, which is the whole screen.
    ///
    /// Expected behaviour: the read goes through the pool, so it does not
    /// wait for the writer however long it holds.
    #[test]
    fn the_section_performance_does_not_wait_for_a_writer() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("section_perf_under_a_writer.db");
        let manager = SectionManager::new();

        let bundle = crate::test_globals::read_while_writer_holds(|| {
            manager
                .get_detail_performance("no-such-section".to_string(), 0, None)
                .expect("the bundle reads while a writer holds the engine")
        });

        assert!(
            bundle.performances.records.is_empty(),
            "a section nothing traversed has no efforts, on either path"
        );
    }

    /// Scenario: the athlete opens a section while a sync page commits, and the
    /// detail bundle, the half the screen paints before its streams land, used
    /// to wait the write out.
    ///
    /// Expected behaviour: the read goes through the pool, so it does not
    /// wait for the writer however long it holds.
    #[test]
    fn the_section_detail_does_not_wait_for_a_writer() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("section_detail_under_a_writer.db");
        let manager = SectionManager::new();

        let bundle = crate::test_globals::read_while_writer_holds(|| {
            manager
                .get_detail_data("no-such-section".to_string())
                .expect("the bundle reads while a writer holds the engine")
        });

        assert!(
            bundle.section.is_none(),
            "a section that is not there answers nothing, on either path"
        );
    }

    fn filter() -> crate::FfiSectionFilter {
        crate::FfiSectionFilter {
            sport_type: None,
            min_visits: None,
            section_type: None,
            activity_id: None,
        }
    }

    /// Scenario: the athlete opens a ride's sections while a sync page
    /// commits, which is the list every detail screen draws.
    ///
    /// Expected behaviour: the filtered list comes back without waiting for
    /// the writer, because it reads through the pool and never asks for the
    /// engine lock the writer holds.
    #[test]
    fn the_sections_list_does_not_wait_for_a_writer() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("sections_under_a_writer.db");
        let sections = SectionManager::new();

        let mut by_activity = filter();
        by_activity.activity_id = Some("a1".to_string());

        let listed = crate::test_globals::read_while_writer_holds(|| {
            sections
                .get_sections(by_activity)
                .expect("the list reads while a writer holds the engine")
        });

        assert!(listed.is_empty(), "nothing is seeded");
    }

    /// Scenario: the athlete opens a section while a sync page commits, and
    /// the performance read is the whole screen.
    ///
    /// Expected behaviour: it comes back without waiting for the writer,
    /// because it reads through the pool and never asks for the engine lock
    /// the writer holds.
    #[test]
    fn the_section_performance_read_does_not_wait_for_a_writer() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("section_perf_under_a_writer.db");
        let sections = SectionManager::new();

        let performances = crate::test_globals::read_while_writer_holds(|| {
            sections
                .get_performances("s1".to_string(), None)
                .expect("the section reads while a writer holds the engine")
        });

        assert!(performances.records.is_empty(), "nothing is seeded");
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
        assert!(sections.get_all_names().unwrap().is_empty());
        assert!(sections.get_named_corridors().unwrap().is_empty());
        assert!(sections.get_retired().unwrap().is_empty());
        assert!(sections.get_history("s1".into()).unwrap().is_empty());
        assert!(
            sections
                .get_excluded_activities("s1".into())
                .unwrap()
                .is_empty()
        );
        assert!(
            crate::persistence::with_persistent_engine(|e| e.get_all_section_summaries(None))
                .expect("engine")
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
    fn a_rename_to_a_name_another_section_shows_is_a_typed_refusal() {
        let _guard = serial_global_state();
        let _tmp = seeded_global_engine();
        let sections = SectionManager::new();
        let make = |name: &str| {
            sections
                .create("Ride".into(), Some(name.into()), "a0".into(), 0, 7)
                .unwrap()
        };
        let first = make("Climb");
        let second = make("Descent");

        let refused = sections.set_name(second.clone(), "Climb".into());

        assert!(
            matches!(&refused, Err(VeloqError::NameTaken { name }) if name == "Climb"),
            "{refused:?}"
        );
        let kept = sections.get_by_id(second).unwrap().unwrap();
        assert_eq!(kept.name.as_deref(), Some("Descent"));
        sections.set_name(first, "Climb".into()).unwrap();
    }

    #[test]
    fn a_custom_section_is_created_named_filtered_disabled_and_deleted() {
        let _guard = serial_global_state();
        let _tmp = seeded_global_engine();
        let sections = SectionManager::new();

        let id = sections
            .create("Ride".into(), Some("Climb".into()), "a0".into(), 0, 7)
            .unwrap();
        assert_eq!(sections.get_count().unwrap(), 1);

        assert!(id.starts_with("custom_"), "{id}");

        let section = sections
            .get_by_id(id.clone())
            .unwrap()
            .expect("created section");
        assert_eq!(section.name.as_deref(), Some("Climb"));
        assert_eq!(section.sport_types, vec!["Ride"]);
        assert!(
            section.distance_meters > 500.0,
            "eight points a hundred metres or so apart in latitude"
        );
        assert!(
            !with_reader(|conn| crate::persistence::sections::pooled::section_polyline(conn, &id))
                .unwrap()
                .is_empty()
        );

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
        assert_eq!(
            sections
                .get_all_names()
                .unwrap()
                .get(&id)
                .map(String::as_str),
            Some("Section 1"),
            "an empty name clears it, and the section is shown under its number"
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
            crate::persistence::with_persistent_engine(|e| e.get_all_section_summaries(None))
                .expect("engine")
                .len(),
            1,
            "a disabled section is still in the catalogue, it is only out of the list"
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

        // A rename is a ledger event; hiding and showing a section is not.
        let kinds: Vec<String> = sections
            .get_history(id.clone())
            .unwrap()
            .into_iter()
            .map(|event| event.kind)
            .collect();
        assert_eq!(kinds, vec!["renamed", "renamed"]);

        sections.delete(id.clone()).unwrap();
        assert_eq!(sections.get_count().unwrap(), 0);
        assert!(sections.get_by_id(id).unwrap().is_none());
    }

    /// The catalogue record a by-id read is built from carries no type, no
    /// visibility and no source slice, so a custom section read back said it
    /// was auto and a disabled one said it was visible.
    #[test]
    fn a_section_read_by_id_carries_its_type_slice_and_visibility() {
        let _guard = serial_global_state();
        let _tmp = seeded_global_engine();
        let sections = SectionManager::new();
        let id = sections
            .create("Ride".into(), None, "a0".into(), 0, 7)
            .unwrap();

        let section = sections.get_by_id(id.clone()).unwrap().expect("created");
        assert_eq!(section.section_type, "custom");
        assert_eq!(section.source_activity_id.as_deref(), Some("a0"));
        assert_eq!((section.start_index, section.end_index), (Some(0), Some(7)));
        assert!(!section.disabled);
        assert_eq!(section.superseded_by, None);

        sections.disable(id.clone()).unwrap();
        assert!(
            sections
                .get_by_id(id)
                .unwrap()
                .expect("still readable")
                .disabled
        );
    }

    /// Scenario: the athlete cuts points 2 to 5 of a stored ride.
    ///
    /// Expected behaviour: the section is those four points of the engine's
    /// own track, and its distance is measured over them.
    #[test]
    fn a_section_is_the_stored_slice_of_the_activity_track() {
        let _guard = serial_global_state();
        let _tmp = seeded_global_engine();
        let sections = SectionManager::new();

        let id = sections
            .create("Ride".into(), None, "a0".into(), 2, 5)
            .unwrap();

        let stored =
            with_reader(|conn| crate::persistence::sections::pooled::section_polyline(conn, &id))
                .unwrap();
        assert_eq!(stored.len(), 8);
        let track = crate::persistence::with_persistent_engine(|e| e.get_gps_track("a0"))
            .expect("engine")
            .expect("track");
        assert_eq!(stored[0], track[2].latitude);
        assert_eq!(stored[6], track[5].latitude);
        let section = sections.get_by_id(id).unwrap().expect("created");
        assert!(
            (200.0..400.0).contains(&section.distance_meters),
            "three 0.001 degree steps, {}",
            section.distance_meters
        );
    }

    #[test]
    fn a_range_the_track_cannot_hold_is_refused_and_writes_nothing() {
        let _guard = serial_global_state();
        let _tmp = seeded_global_engine();
        let sections = SectionManager::new();
        let cut = |activity: &str, start: u32, end: u32| {
            sections.create("Ride".into(), None, activity.into(), start, end)
        };

        assert!(cut("a0", 5, 2).is_err(), "reversed");
        assert!(cut("a0", 3, 3).is_err(), "one point is not a line");
        assert!(cut("a0", 0, 8).is_err(), "end past the last point");
        assert!(cut("a0", 8, 20).is_err(), "wholly outside");
        assert!(
            matches!(cut("nope", 0, 3), Err(VeloqError::NotFound { .. })),
            "no stored track"
        );
        assert_eq!(sections.get_count().unwrap(), 0);

        assert!(cut("a0", 0, 7).is_ok(), "the whole track is in range");
    }

    #[test]
    fn exclusions_are_flags_on_a_membership() {
        let _guard = serial_global_state();
        let _tmp = seeded_global_engine();
        let sections = SectionManager::new();
        let id = sections
            .create("Ride".into(), None, "a0".into(), 0, 7)
            .unwrap();

        sections.exclude_activity(id.clone(), "a0".into()).unwrap();
        let excluded = sections.get_excluded_activities(id.clone()).unwrap();
        assert!(excluded.is_empty() || excluded == vec!["a0"]);
        sections.include_activity(id.clone(), "a0".into()).unwrap();
        assert!(sections.get_excluded_activities(id).unwrap().is_empty());
    }
}

#[cfg(test)]
#[path = "tests/section_sort.rs"]
mod sort_regressions;

#[cfg(test)]
#[path = "tests/sections.rs"]
mod section_tests;

#[cfg(test)]
#[path = "tests/sections_pooled.rs"]
mod pooled_tests;

#[cfg(test)]
#[path = "tests/section_names_trend_pooled.rs"]
mod names_trend_pooled_tests;

#[cfg(test)]
#[path = "tests/section_scans_pooled.rs"]
mod scans_pooled_tests;

#[cfg(test)]
#[path = "tests/sections_ledger_pooled.rs"]
mod ledger_pooled_tests;
