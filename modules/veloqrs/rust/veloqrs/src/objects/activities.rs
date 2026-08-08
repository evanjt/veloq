use super::error::{VeloqError, with_engine};
use std::sync::Arc;

#[derive(uniffi::Object)]
pub struct ActivityManager {
    pub(crate) _private: (),
}

#[uniffi::export]
impl ActivityManager {
    #[uniffi::constructor]
    fn new() -> Arc<Self> {
        Arc::new(Self { _private: () })
    }

    fn add(
        &self,
        activity_ids: Vec<String>,
        all_coords: Vec<f64>,
        offsets: Vec<u32>,
        sport_types: Vec<String>,
    ) -> Result<(), VeloqError> {
        if offsets.len() != activity_ids.len() {
            return Err(VeloqError::Database {
                msg: format!(
                    "offsets length {} does not match activity_ids length {}",
                    offsets.len(),
                    activity_ids.len()
                ),
            });
        }
        if all_coords.len() % 2 != 0 {
            return Err(VeloqError::Database {
                msg: format!(
                    "all_coords length {} is not an even count of lat/lon values",
                    all_coords.len()
                ),
            });
        }
        with_engine(|engine| {
            let mut batch = Vec::with_capacity(activity_ids.len());
            for (i, id) in activity_ids.iter().enumerate() {
                let start = offsets[i] as usize;
                let end = offsets
                    .get(i + 1)
                    .map(|&o| o as usize)
                    .unwrap_or(all_coords.len() / 2);
                let coords: Vec<crate::GpsPoint> = (start..end)
                    .filter_map(|j| {
                        let idx = j * 2;
                        if idx + 1 < all_coords.len() {
                            Some(crate::GpsPoint::new(all_coords[idx], all_coords[idx + 1]))
                        } else {
                            None
                        }
                    })
                    .collect();
                let sport = sport_types.get(i).cloned().unwrap_or_default();
                batch.push((id.clone(), coords, sport));
            }
            engine
                .add_activities_batch(batch)
                .map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })?;
            Ok(())
        })?
    }

    fn get_ids(&self) -> Result<Vec<String>, VeloqError> {
        with_engine(|e| e.get_activity_ids())
    }

    fn get_count(&self) -> Result<u32, VeloqError> {
        with_engine(|e| e.activity_count() as u32)
    }

    fn set_metrics(&self, metrics: Vec<crate::FfiActivityMetrics>) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.set_activity_metrics_extended(metrics)
                .map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })
        })?
    }

    fn get_metrics_for_ids(
        &self,
        ids: Vec<String>,
    ) -> Result<Vec<crate::FfiActivityMetrics>, VeloqError> {
        with_engine(|engine| {
            ids.iter()
                .filter_map(|id| engine.activity_metrics.get(id).cloned())
                .map(crate::FfiActivityMetrics::from)
                .collect()
        })
    }

    /// Store untyped activity bodies. Demo mode seeds the same table a live
    /// sync writes, so every downstream read is identical in both modes.
    fn upsert_activity_bodies(&self, rows: Vec<crate::FfiActivityBody>) -> Result<(), VeloqError> {
        if rows.is_empty() {
            return Ok(());
        }
        with_engine(|e| {
            let mapped: Vec<(String, i64, String)> = rows
                .into_iter()
                .map(|r| (r.activity_id, r.date, r.raw))
                .collect();
            e.upsert_activity_bodies(&mapped)
                .map_err(|err| VeloqError::Database {
                    msg: format!("{}", err),
                })
        })?
    }

    /// Untyped activity bodies over an inclusive timestamp window, newest
    /// first. The feed and detail screens read fields no Rust type models, so
    /// they parse these rather than a reconstruction from `activity_metrics`.
    fn get_activity_bodies(
        &self,
        oldest_ts: i64,
        newest_ts: i64,
    ) -> Result<Vec<String>, VeloqError> {
        with_engine(|e| {
            e.get_activity_bodies(oldest_ts, newest_ts)
                .map_err(|err| VeloqError::Database {
                    msg: format!("{}", err),
                })
        })?
    }

    /// Store a stream payload directly. Demo seeding writes the same table a
    /// live fetch fills, so every downstream read is identical in both modes.
    fn set_stream_body(
        &self,
        activity_id: String,
        types: String,
        raw: String,
    ) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.set_stream_body(&activity_id, &types, &raw)
                .map_err(|err| VeloqError::Database {
                    msg: format!("{}", err),
                })
        })?
    }

    /// Store an activity's interval payload directly, for demo seeding.
    fn set_interval_body(&self, activity_id: String, raw: String) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.set_interval_body(&activity_id, &raw)
                .map_err(|err| VeloqError::Database {
                    msg: format!("{}", err),
                })
        })?
    }

    /// Store a curve payload directly, for demo seeding. `kind` is
    /// "power" or "pace".
    fn set_curve_body(
        &self,
        kind: String,
        sport: String,
        days: i64,
        gap: bool,
        raw: String,
    ) -> Result<(), VeloqError> {
        let kind = match kind.as_str() {
            "power" => crate::persistence::bodies::CurveKind::Power,
            "pace" => crate::persistence::bodies::CurveKind::Pace,
            other => {
                return Err(VeloqError::ParseError {
                    msg: format!("unknown curve kind: {}", other),
                });
            }
        };
        with_engine(|e| {
            e.set_curve_body(kind, &sport, days, gap, &raw)
                .map_err(|err| VeloqError::Database {
                    msg: format!("{}", err),
                })
        })?
    }

    /// Replace the calendar events in a window, for demo seeding.
    fn replace_calendar_events(
        &self,
        oldest_ts: i64,
        newest_ts: i64,
        rows: Vec<crate::FfiCalendarEventBody>,
    ) -> Result<(), VeloqError> {
        with_engine(|e| {
            let mapped: Vec<(String, i64, String)> = rows
                .into_iter()
                .map(|r| (r.event_id, r.date, r.raw))
                .collect();
            e.replace_calendar_events(oldest_ts, newest_ts, &mapped)
                .map_err(|err| VeloqError::Database {
                    msg: format!("{}", err),
                })
        })?
    }

    /// A stored stream payload for an activity and series selection, or
    /// `None` when it has not been fetched or has aged out of the cache.
    fn get_stream_body(
        &self,
        activity_id: String,
        types: String,
    ) -> Result<Option<String>, VeloqError> {
        with_engine(|e| {
            e.get_stream_body(&activity_id, &types)
                .map_err(|err| VeloqError::Database {
                    msg: format!("{}", err),
                })
        })?
    }

    fn set_time_streams(
        &self,
        activity_ids: Vec<String>,
        all_times: Vec<u32>,
        offsets: Vec<u32>,
    ) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.set_time_streams_flat(&activity_ids, &all_times, &offsets);
        })
    }

    fn get_missing_time_streams(
        &self,
        activity_ids: Vec<String>,
    ) -> Result<Vec<String>, VeloqError> {
        with_engine(|e| e.get_activities_missing_time_streams(&activity_ids))
    }

    fn get_gps_track(&self, activity_id: String) -> Result<Vec<crate::FfiGpsPoint>, VeloqError> {
        with_engine(|e| {
            e.get_gps_track(&activity_id)
                .map(|points| points.into_iter().map(crate::FfiGpsPoint::from).collect())
                .unwrap_or_default()
        })
    }

    fn remove(&self, activity_id: String) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.remove_activity(&activity_id)
                .map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })
        })?
    }

    fn debug_clone(&self, source_id: String, count: u32) -> Result<u32, VeloqError> {
        with_engine(|e| e.debug_clone_activity(&source_id, count))
    }

    /// Combined activity-list highlight bundle: section indicators (PRs +
    /// trends) and route highlights for the same batch of activity IDs in a
    /// single FFI round-trip. Consumed by `useActivitySectionHighlights`.
    fn get_highlights_bundle(
        &self,
        activity_ids: Vec<String>,
    ) -> Result<crate::FfiActivityHighlightsBundle, VeloqError> {
        with_engine(|e| crate::FfiActivityHighlightsBundle {
            indicators: e.get_activity_indicators(&activity_ids),
            route_highlights: e.get_activity_route_highlights(&activity_ids),
        })
    }

    /// Everything the activity detail screen paints with, in one engine lock:
    /// engine counts, route groups, matched and custom sections, encounters,
    /// indicator highlights, this activity's portion of each section it
    /// traverses, and the sections where it holds the record.
    ///
    /// `min_route_activities` filters the returned route groups the same way
    /// the screen used to filter them after the fact.
    fn get_detail_data(
        &self,
        activity_id: String,
        min_route_activities: u32,
    ) -> Result<crate::FfiActivityDetailData, VeloqError> {
        with_engine(|e| e.activity_detail_data(&activity_id, min_route_activities))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The flat-buffer guards reject malformed input before touching the engine,
    // so these cases short-circuit without an initialised PERSISTENT_ENGINE.
    #[test]
    fn add_rejects_offsets_length_mismatch() {
        let mgr = ActivityManager::new();
        let result = mgr.add(
            vec!["a".to_string(), "b".to_string()],
            vec![1.0, 2.0],
            vec![0],
            vec!["Ride".to_string()],
        );
        assert!(result.is_err());
    }

    #[test]
    fn add_rejects_odd_coord_count() {
        let mgr = ActivityManager::new();
        let result = mgr.add(
            vec!["a".to_string()],
            vec![1.0, 2.0, 3.0],
            vec![0],
            vec!["Ride".to_string()],
        );
        assert!(result.is_err());
    }
}
