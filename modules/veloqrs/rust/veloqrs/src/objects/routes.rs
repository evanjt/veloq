use std::sync::Arc;

use super::engine::InFlight;
use super::error::{VeloqError, with_engine, with_reader};
use crate::persistence::sections::lap_curves::pooled::CurveRead;

/// One representative choice at a time. Cleared by the choice itself rather
/// than by the caller's future, so a caller that stops waiting does not free
/// the slot while the choice still holds the engine.
static REPRESENTATIVE_EDIT_IN_FLIGHT: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Choose the representative in the library open at `install`, holding `slot`
/// until the choice ends. A library installed since, by a restore or a wipe,
/// is not written, and the choice resolves as the closed engine's error.
async fn representative_edit_for(
    install: u64,
    route_id: String,
    activity_id: Option<String>,
    slot: InFlight,
) -> Result<(), VeloqError> {
    crate::persistence::with_persistent_engine_blocking_for(install, move |e| {
        let done = match activity_id {
            Some(activity_id) => e.set_route_representative(&route_id, &activity_id),
            None => e.reset_route_representative(&route_id),
        }
        .map_err(|msg| VeloqError::Database { msg });
        drop(slot);
        done
    })
    .await
    .ok_or(VeloqError::NotInitialized)?
}

#[derive(uniffi::Object)]
pub struct RouteManager {
    pub(crate) _private: (),
}

#[derive(uniffi::Record)]
pub struct LiveRouteOverlap {
    pub group_id: String,
    pub percentage: f64,
}

#[uniffi::export]
impl RouteManager {
    #[uniffi::constructor]
    fn new() -> Arc<Self> {
        Arc::new(Self { _private: () })
    }

    fn get_all(&self) -> Result<Vec<crate::FfiRouteGroup>, VeloqError> {
        // The last saved grouping. A regroup the library owes runs on the
        // worker, so a read never recomputes it on the way past.
        with_reader(|conn| {
            crate::persistence::routes::pooled::all_groups(conn)
                .into_iter()
                .map(crate::FfiRouteGroup::from)
                .collect()
        })
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
        with_reader(|conn| {
            let total_count = conn
                .query_row("SELECT COUNT(*) FROM route_groups", [], |row| row.get(0))
                .unwrap_or(0);
            let mut summaries = crate::persistence::routes::pooled::group_summaries(conn);
            if let Some(min_activities) = min_activities {
                summaries.retain(|g| g.activity_count >= min_activities);
            }
            match sort_key.as_deref() {
                Some("name") => summaries.sort_by(|a, b| {
                    let a_name = a.custom_name.as_deref().unwrap_or(&a.group_id);
                    let b_name = b.custom_name.as_deref().unwrap_or(&b.group_id);
                    a_name
                        .to_lowercase()
                        .cmp(&b_name.to_lowercase())
                        .then_with(|| a.group_id.cmp(&b.group_id))
                }),
                Some("count") => summaries.sort_by_key(|b| std::cmp::Reverse(b.activity_count)),
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
    fn get_representative_route(&self, group_id: String) -> Result<Vec<u8>, VeloqError> {
        with_reader(|conn| {
            crate::persistence::routes::pooled::representative_route(conn, &group_id)
                .map(|points| crate::persistence::codec::encode_polyline(&points))
                .unwrap_or_default()
        })
    }

    /// Measure the recorded line against the listed groups off the JS thread.
    pub async fn live_overlaps(
        &self,
        group_ids: Vec<String>,
        coordinates: Vec<f64>,
    ) -> Result<Vec<LiveRouteOverlap>, VeloqError> {
        crate::runtime::ASYNC_RUNTIME
            .spawn_blocking(move || {
                with_reader(|conn| {
                    let config =
                        crate::persistence::settings::match_config_from(conn).unwrap_or_default();
                    let track: Vec<crate::GpsPoint> = coordinates
                        .as_chunks::<2>()
                        .0
                        .iter()
                        .filter(|&&[lat, lng]| {
                            lat.is_finite()
                                && lng.is_finite()
                                && lat.abs() <= 90.0
                                && lng.abs() <= 180.0
                                && (lat != 0.0 || lng != 0.0)
                        })
                        .map(|&[lat, lng]| crate::GpsPoint::new(lat, lng))
                        .collect();
                    group_ids
                        .into_iter()
                        .map(|group_id| {
                            let percentage =
                                crate::persistence::routes::pooled::representative_route(
                                    conn, &group_id,
                                )
                                .map_or(0.0, |route| {
                                    crate::persistence::routes::live_overlap_percentage(
                                        &track, &route, &config,
                                    )
                                });
                            LiveRouteOverlap {
                                group_id,
                                percentage,
                            }
                        })
                        .collect()
                })
            })
            .await
            .map_err(|error| VeloqError::Database {
                msg: error.to_string(),
            })?
    }

    fn get_performances(
        &self,
        group_id: String,
        current_activity_id: Option<String>,
        sport_type: Option<String>,
    ) -> Result<crate::FfiRoutePerformanceResult, VeloqError> {
        with_reader(|conn| {
            crate::FfiRoutePerformanceResult::from(
                crate::persistence::fitness::performances::route_performances_of(
                    conn,
                    &group_id,
                    current_activity_id.as_deref(),
                    sport_type.as_deref(),
                ),
            )
        })
    }

    fn get_screen_data(
        &self,
        query: crate::FfiRoutesScreenQuery,
    ) -> Result<crate::FfiRoutesScreenData, VeloqError> {
        with_reader(|conn| crate::persistence::pooled_routes_screen_data(conn, query.clone()))
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

    /// Everything the route detail screen paints with: engine counts, the
    /// route and the group list it is ranked within, every attempt across
    /// sports, the representative polyline, names, exclusions and signatures.
    fn get_detail_data(
        &self,
        group_id: String,
        current_activity_id: Option<String>,
        min_group_activities: u32,
    ) -> Result<crate::FfiRouteDetailData, VeloqError> {
        // Off the engine lock: every read behind this is committed rows. The
        // groups it lists are the last saved grouping rather than one a
        // regroup would produce on the way past, which is the deferred-regroup
        // staleness the app already announces to the athlete.
        with_reader(|conn| {
            crate::persistence::screens::pooled::route_detail_data(
                conn,
                &group_id,
                current_activity_id.as_deref(),
                min_group_activities,
            )
        })
    }

    /// The route detail reads that answer one sport and one range, in the
    /// section performance read's shape: the chart, calendar, ranged bests,
    /// trend, histogram, correlations, sport counts and excluded attempts.
    fn get_detail_performance(
        &self,
        group_id: String,
        time_range_days: u32,
        sport_filter: Option<String>,
    ) -> Result<crate::FfiSectionPerformanceData, VeloqError> {
        // Off the engine lock: every read behind this is committed rows. The
        // delta curves come only once held, since computing them can take
        // longer than a tap may block, and `curves_pending` says they are owed:
        // `SectionManager::load_detail_performance` computes them.
        with_reader(|conn| {
            crate::persistence::screens::pooled::route_detail_performance(
                conn,
                &group_id,
                time_range_days,
                sport_filter.as_deref(),
                CurveRead::Held,
            )
        })
    }

    /// Choose the route's representative, or with no activity restore the
    /// one grouping chose, off the JS thread. Every member is measured again
    /// against the new representative's full track, which on a well-ridden
    /// route runs past a tap's budget.
    async fn set_representative(
        &self,
        route_id: String,
        activity_id: Option<String>,
    ) -> Result<(), VeloqError> {
        let slot = InFlight::claim(
            &REPRESENTATIVE_EDIT_IN_FLIGHT,
            "A route representative is already being chosen",
        )?;
        representative_edit_for(
            crate::persistence::engine_install(),
            route_id,
            activity_id,
            slot,
        )
        .await
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
        let summaries = routes.get_summaries(Some(2), Some("count".into())).unwrap();
        assert_eq!(summaries.total_count, 0);
        assert!(summaries.summaries.is_empty());
        assert!(
            routes
                .get_representative_route("g1".into())
                .unwrap()
                .is_empty()
        );
        assert!(
            with_reader(crate::persistence::routes::pooled::all_route_names)
                .unwrap()
                .is_empty()
        );
        assert!(
            with_reader(
                |conn| crate::persistence::routes::pooled::excluded_route_activity_ids(conn, "g1")
            )
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
            crate::test_trace::trace_statements!(engine.db, traced::record);
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
            crate::test_trace::untrace(&engine.db);
        })
        .expect("engine");
    }

    #[test]
    fn a_name_and_an_exclusion_are_stored_against_the_route_id() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("routes.db");
        let routes = RouteManager::new();

        routes.set_name("g1".into(), "Home loop".into()).unwrap();
        let names = with_reader(crate::persistence::routes::pooled::all_route_names).unwrap();
        assert_eq!(names.get("g1").map(String::as_str), Some("Home loop"));

        // An exclusion is a flag on a match, so an activity the route never
        // matched cannot be excluded from it.
        routes.exclude_activity("g1".into(), "a1".into()).unwrap();
        assert!(
            with_reader(
                |conn| crate::persistence::routes::pooled::excluded_route_activity_ids(conn, "g1")
            )
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
            with_reader(
                |conn| crate::persistence::routes::pooled::excluded_route_activity_ids(conn, "g1")
            )
            .unwrap(),
            vec!["a1"]
        );
        routes.include_activity("g1".into(), "a1".into()).unwrap();
        assert!(
            with_reader(
                |conn| crate::persistence::routes::pooled::excluded_route_activity_ids(conn, "g1")
            )
            .unwrap()
            .is_empty()
        );
    }
}

#[cfg(test)]
mod pooled_read_tests {
    use super::*;
    use crate::test_globals::{init_global_engine, read_while_writer_holds, serial_global_state};
    use crate::with_persistent_engine;
    use tracematch::GpsPoint;

    const ACTIVITIES: [(&str, &str, i64, u32); 4] = [
        ("a1", "Ride", 1_700_000_000, 600),
        ("a2", "Ride", 1_700_100_000, 580),
        ("a3", "Run", 1_700_200_000, 900),
        ("a4", "Ride", 1_700_300_000, 700),
    ];

    /// One saved route of four activities, the last of them excluded.
    fn seed_route() {
        with_persistent_engine(|e| {
            for (id, sport, date, moving_time) in ACTIVITIES {
                let track: Vec<GpsPoint> = (0..8)
                    .map(|i| GpsPoint::new(46.2 + f64::from(i) * 0.001, 7.35))
                    .collect();
                e.add_activity(id.to_string(), track, sport.to_string())
                    .expect("add activity");
                e.set_activity_metrics(vec![crate::ActivityMetrics {
                    activity_id: id.to_string(),
                    name: format!("Ride {id}"),
                    date,
                    distance: 5000.0,
                    moving_time,
                    elapsed_time: moving_time,
                    sport_type: sport.to_string(),
                    ..Default::default()
                }])
                .expect("metrics");
            }
            e.db.execute(
                "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type, activity_count)
                 VALUES ('g1', 'a1', '[\"a1\",\"a2\",\"a3\",\"a4\"]', 'Ride', 4)",
                [],
            )
            .unwrap();
            for (id, percentage, direction, excluded) in [
                ("a1", 100.0, "same", 0),
                ("a2", 92.5, "reverse", 0),
                ("a3", 88.0, "same", 0),
                ("a4", 95.0, "same", 1),
            ] {
                e.db.execute(
                    "INSERT INTO activity_matches (route_id, activity_id, match_percentage, direction, excluded)
                     VALUES ('g1', ?, ?, ?, ?)",
                    rusqlite::params![id, percentage, direction, excluded],
                )
                .unwrap();
            }
            e.adopt_committed_groups();
            e.set_groups_dirty(false);
        })
        .expect("engine");
    }

    fn same<T: std::fmt::Debug>(a: &T, b: &T, what: &str) {
        assert_eq!(format!("{a:?}"), format!("{b:?}"), "{what}");
    }

    #[test]
    fn the_route_list_reads_while_a_writer_holds_the_engine() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("routes_list_under_writer.db");
        seed_route();
        let routes = RouteManager::new();

        let groups = read_while_writer_holds(|| routes.get_all().unwrap());

        assert_eq!(groups.len(), 1);
    }

    #[test]
    fn route_performances_read_while_a_writer_holds_the_engine() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("routes_perf_under_writer.db");
        seed_route();
        let routes = RouteManager::new();

        let result = read_while_writer_holds(|| {
            routes
                .get_performances("g1".into(), Some("a1".into()), None)
                .unwrap()
        });

        assert_eq!(result.performances.len(), 2);
    }

    #[test]
    fn the_pooled_reads_equal_the_engines_on_a_clean_grouping() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("routes_parity.db");
        seed_route();
        let routes = RouteManager::new();

        let engine_groups: Vec<crate::FfiRouteGroup> = with_persistent_engine(|e| {
            e.get_groups()
                .iter()
                .cloned()
                .map(crate::FfiRouteGroup::from)
                .collect()
        })
        .unwrap();
        same(&routes.get_all().unwrap(), &engine_groups, "the route list");

        for (current, sport) in [
            (None, None),
            (Some("a1"), None),
            (Some("a3"), None),
            (None, Some("Ride")),
            (Some("a1"), Some("Run")),
        ] {
            let own = with_persistent_engine(|e| {
                crate::FfiRoutePerformanceResult::from(
                    e.get_route_performances("g1", current, sport),
                )
            })
            .unwrap();
            let pooled = routes
                .get_performances(
                    "g1".into(),
                    current.map(str::to_string),
                    sport.map(str::to_string),
                )
                .unwrap();
            same(
                &pooled,
                &own,
                &format!("performances for {current:?} in {sport:?}"),
            );
        }

        let unknown = routes.get_performances("nope".into(), None, None).unwrap();
        assert!(unknown.performances.is_empty());
    }

    #[test]
    fn a_dirty_grouping_is_listed_as_last_saved_and_left_for_the_worker() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("routes_dirty.db");
        seed_route();
        with_persistent_engine(|e| e.set_groups_dirty(true)).unwrap();
        let routes = RouteManager::new();

        let listed = routes.get_all().unwrap();
        routes.get_performances("g1".into(), None, None).unwrap();

        assert_eq!(listed.len(), 1, "the saved grouping is listed");
        assert!(
            with_persistent_engine(|e| e.groups_are_dirty()).unwrap(),
            "a read leaves the regroup owed rather than running it"
        );
    }
}

#[cfg(test)]
#[path = "tests/route_sort.rs"]
mod sort_regressions;

#[cfg(test)]
#[path = "tests/routes_pooled.rs"]
mod pooled_tests;

#[cfg(test)]
#[path = "tests/routes_side_pooled.rs"]
mod side_pooled_tests;

#[cfg(test)]
#[path = "tests/route_representative_edit.rs"]
mod route_representative_edit_tests;
