use super::error::{VeloqError, with_engine};
use std::sync::Arc;

#[derive(uniffi::Object)]
pub struct RouteManager {
    pub(crate) _private: (),
}

#[uniffi::export]
impl RouteManager {
    #[uniffi::constructor]
    fn new() -> Arc<Self> {
        Arc::new(Self { _private: () })
    }

    fn get_all(&self) -> Result<Vec<crate::FfiRouteGroup>, VeloqError> {
        with_engine(|e| {
            e.get_groups()
                .iter()
                .cloned()
                .map(crate::FfiRouteGroup::from)
                .collect()
        })
    }

    fn get_by_id(&self, group_id: String) -> Result<Option<crate::FfiRouteGroup>, VeloqError> {
        with_engine(|e| e.get_group_by_id(&group_id).map(crate::FfiRouteGroup::from))
    }

    /// Group summaries with the total count beside them.
    ///
    /// `sort_key` accepts "count" and "name"; anything else, and `None`,
    /// leaves the engine's own order.
    fn get_summaries(
        &self,
        min_activities: Option<u32>,
        sort_key: Option<String>,
    ) -> Result<crate::FfiGroupSummariesResult, VeloqError> {
        with_engine(|e| {
            let total_count = e.get_group_count();
            let mut summaries = e.get_group_summaries();
            if let Some(min_activities) = min_activities {
                summaries.retain(|g| g.activity_count >= min_activities);
            }
            match sort_key.as_deref() {
                Some("name") => summaries.sort_by(|a, b| a.group_id.cmp(&b.group_id)),
                Some("count") => summaries.sort_by(|a, b| b.activity_count.cmp(&a.activity_count)),
                _ => {}
            }
            crate::FfiGroupSummariesResult {
                total_count,
                summaries,
            }
        })
    }

    /// The group's representative line, coordinate-encoded. The engine already
    /// holds `GpsPoint`s, so this encodes them rather than boxing one record
    /// per point for a caller that unboxed them again.
    fn get_consensus_route(&self, group_id: String) -> Result<Vec<u8>, VeloqError> {
        with_engine(|e| {
            e.get_consensus_route(&group_id)
                .map(|points| crate::coords::encode(&points))
                .unwrap_or_default()
        })
    }

    fn get_performances(
        &self,
        group_id: String,
        current_activity_id: Option<String>,
        sport_type: Option<String>,
    ) -> Result<crate::FfiRoutePerformanceResult, VeloqError> {
        with_engine(|e| {
            let _ = e.get_groups();
            crate::FfiRoutePerformanceResult::from(e.get_route_performances(
                &group_id,
                current_activity_id.as_deref(),
                sport_type.as_deref(),
            ))
        })
    }

    fn get_screen_data(
        &self,
        query: crate::FfiRoutesScreenQuery,
    ) -> Result<crate::FfiRoutesScreenData, VeloqError> {
        with_engine(|e| e.get_routes_screen_data(query.clone()))
    }

    fn set_name(&self, route_id: String, name: String) -> Result<(), VeloqError> {
        let name_opt = if name.is_empty() {
            None
        } else {
            Some(name.as_str())
        };
        with_engine(|e| {
            e.set_route_name(&route_id, name_opt)
                .map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })
        })?
    }

    fn get_all_names(&self) -> Result<std::collections::HashMap<String, String>, VeloqError> {
        with_engine(|e| e.get_all_route_names())
    }

    fn exclude_activity(&self, route_id: String, activity_id: String) -> Result<(), VeloqError> {
        // No indicator rebuild: the flag lands on `activity_matches` and the
        // indicator table holds section rows read from `section_activities`,
        // so a route edit cannot move a row the rebuild would rewrite. The
        // rebuild was 31 to 39 ms of the JS thread plus a time-stream read,
        // for nothing.
        with_engine(|e| {
            e.exclude_activity_from_route(&route_id, &activity_id)
                .map_err(|e| VeloqError::Database { msg: e })
        })?
    }

    fn include_activity(&self, route_id: String, activity_id: String) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.include_activity_in_route(&route_id, &activity_id)
                .map_err(|e| VeloqError::Database { msg: e })
        })?
    }

    fn get_excluded_activities(&self, route_id: String) -> Result<Vec<String>, VeloqError> {
        with_engine(|e| e.get_excluded_route_activity_ids(&route_id))
    }

    fn get_excluded_performances(
        &self,
        route_id: String,
        sport_type: Option<String>,
    ) -> Result<crate::FfiRoutePerformanceResult, VeloqError> {
        with_engine(|e| {
            crate::FfiRoutePerformanceResult::from(
                e.get_excluded_route_performances(&route_id, sport_type.as_deref()),
            )
        })
    }

    /// Batch-query route highlights (PRs and trends) for a list of activity IDs.
    fn get_activity_route_highlights(
        &self,
        activity_ids: Vec<String>,
    ) -> Result<Vec<crate::FfiActivityRouteHighlight>, VeloqError> {
        with_engine(|e| e.get_activity_route_highlights(&activity_ids))
    }

    /// Everything the route detail screen paints with: engine counts, the
    /// route and the group list it is ranked within, every attempt across
    /// sports, the consensus polyline, names, exclusions and signatures.
    fn get_detail_data(
        &self,
        group_id: String,
        current_activity_id: Option<String>,
        min_group_activities: u32,
    ) -> Result<crate::FfiRouteDetailData, VeloqError> {
        with_engine(|e| {
            e.route_detail_data(
                &group_id,
                current_activity_id.as_deref(),
                min_group_activities,
            )
        })
    }

    fn set_representative(&self, route_id: String, activity_id: String) -> Result<(), VeloqError> {
        with_engine(|e| {
            e.set_route_representative(&route_id, &activity_id)
                .map_err(|e| VeloqError::Database { msg: e })?;
            Ok(())
        })?
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_globals::{init_global_engine, serial_global_state};

    #[test]
    fn an_empty_library_answers_every_read_with_nothing() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("routes.db");
        let routes = RouteManager::new();

        assert!(routes.get_all().unwrap().is_empty());
        assert!(routes.get_by_id("g1".into()).unwrap().is_none());
        let summaries = routes.get_summaries(Some(2), Some("count".into())).unwrap();
        assert_eq!(summaries.total_count, 0);
        assert!(summaries.summaries.is_empty());
        assert!(routes.get_consensus_route("g1".into()).unwrap().is_empty());
        assert!(routes.get_all_names().unwrap().is_empty());
        assert!(
            routes
                .get_excluded_activities("g1".into())
                .unwrap()
                .is_empty()
        );
    }

    /// Statements SQLite ran. `Connection::trace` takes a function pointer,
    /// so the sink is a static rather than a captured counter.
    mod traced {
        use std::sync::Mutex;

        static SQL: Mutex<Vec<String>> = Mutex::new(Vec::new());

        pub fn record(sql: &str) {
            SQL.lock()
                .unwrap_or_else(|e| e.into_inner())
                .push(sql.to_string());
        }

        pub fn reset() {
            SQL.lock().unwrap_or_else(|e| e.into_inner()).clear();
        }

        pub fn count(fragment: &str) -> usize {
            SQL.lock()
                .unwrap_or_else(|e| e.into_inner())
                .iter()
                .filter(|sql| sql.contains(fragment))
                .count()
        }
    }

    /// Scenario: the athlete excludes one activity from a route, then puts it
    /// back.
    ///
    /// Expected behaviour: neither edit rewrites the indicator table. The
    /// table holds section rows read from `section_activities`, the edit
    /// writes a flag on `activity_matches`, and the rebuild it used to run
    /// cost 31 to 39 ms of the JS thread plus a library-wide lap backfill.
    #[test]
    fn a_route_exclusion_leaves_the_indicator_table_alone() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("routes.db");
        let routes = RouteManager::new();
        crate::persistence::with_persistent_engine(|engine| {
            engine.db.trace(Some(traced::record));
        })
        .expect("engine");

        traced::reset();
        routes.exclude_activity("g1".into(), "a1".into()).unwrap();
        routes.include_activity("g1".into(), "a1".into()).unwrap();

        assert_eq!(
            traced::count("UPDATE activity_matches SET excluded"),
            2,
            "both edits wrote their flag"
        );
        assert_eq!(
            traced::count("DELETE FROM activity_indicators"),
            0,
            "neither edit rewrote the indicators"
        );

        crate::persistence::with_persistent_engine(|engine| {
            engine.db.trace(None);
        })
        .expect("engine");
    }

    #[test]
    fn a_name_and_an_exclusion_are_stored_against_the_route_id() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("routes.db");
        let routes = RouteManager::new();

        routes.set_name("g1".into(), "Home loop".into()).unwrap();
        let names = routes.get_all_names().unwrap();
        assert_eq!(names.get("g1").map(String::as_str), Some("Home loop"));

        // An exclusion is a flag on a match, so an activity the route never
        // matched cannot be excluded from it.
        routes.exclude_activity("g1".into(), "a1".into()).unwrap();
        assert!(
            routes
                .get_excluded_activities("g1".into())
                .unwrap()
                .is_empty()
        );

        crate::with_persistent_engine(|e| {
            e.db.execute(
                "INSERT INTO activity_matches (route_id, activity_id, match_percentage, direction) \
                 VALUES ('g1', 'a1', 0.9, 'same')",
                [],
            )
            .unwrap();
        })
        .unwrap();
        routes.exclude_activity("g1".into(), "a1".into()).unwrap();
        assert_eq!(
            routes.get_excluded_activities("g1".into()).unwrap(),
            vec!["a1"]
        );
        routes.include_activity("g1".into(), "a1".into()).unwrap();
        assert!(
            routes
                .get_excluded_activities("g1".into())
                .unwrap()
                .is_empty()
        );
    }
}
