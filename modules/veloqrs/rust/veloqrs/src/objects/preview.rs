use super::error::{VeloqError, with_engine, with_engine_read};
use crate::persistence::persistent_engine_ffi::SECTION_DETECTION_HANDLE;
use crate::persistence::route_grouping_preview::{
    PreviewPoll as GroupingPoll, PreviewStrictness, ROUTE_GROUPING_PREVIEW_HANDLE,
};
use crate::persistence::sections::preview::{PreviewOverlay, PreviewPoll, SECTION_PREVIEW_HANDLE};
use log::info;
use std::sync::Arc;

/// A ranked riding area: one occupied ~5 km bin of the user's library.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiPreviewCentre {
    /// "lat_bin:lng_bin" at ~5 km, an order-free ranking key.
    pub bin_key: String,
    pub lat: f64,
    pub lng: f64,
    /// Sum of section visit counts in the bin, or activity count on fallback.
    pub visit_total: u32,
    /// 0 on the activities fallback.
    pub section_count: u32,
    /// "sections" | "activities"
    pub source: String,
    /// The place the area covers, or None when no activity over it names one.
    pub locality: Option<String>,
}

#[derive(uniffi::Object)]
pub struct SectionPreview {
    pub(crate) _private: (),
}

#[uniffi::export]
impl SectionPreview {
    #[uniffi::constructor]
    pub fn new() -> Arc<Self> {
        Arc::new(Self { _private: () })
    }

    /// Ranked riding areas. Sections substrate (bounds cache + visit_count)
    /// when any auto section carries bounds, activity-bbox bins otherwise
    /// ((0, 0, 0, 0) sentinel filtered). Ordered visit_total DESC, bin_key ASC.
    pub fn centres(&self, limit: u32) -> Result<Vec<FfiPreviewCentre>, VeloqError> {
        // Write lock, not read: centres queries SQLite and the read lock is
        // memory-only by invariant.
        with_engine(|e| {
            e.preview_centres(limit)
                .into_iter()
                .map(|c| FfiPreviewCentre {
                    bin_key: c.bin_key,
                    lat: c.lat,
                    lng: c.lng,
                    visit_total: c.visit_total,
                    section_count: c.section_count,
                    source: c.source,
                    locality: c.locality,
                })
                .collect()
        })
    }

    /// The live auto catalogue for the riding area containing (lat, lng), as
    /// a JSON array in the same section shape a run's payload carries. Scoped
    /// by the same component the run uses, so the screen opens on exactly the
    /// catalogue the next run will diff against. None when no activity covers
    /// the point.
    pub fn current(&self, lat: f64, lng: f64) -> Result<Option<String>, VeloqError> {
        // Write lock, not read: this queries SQLite for pin intent and the
        // read lock is memory-only by invariant.
        with_engine(|e| e.preview_current(lat, lng))
    }

    /// Resolve the whole geo component containing (lat, lng) and start the
    /// pure preview detect over it. Only the five exposed fields of `config`
    /// overlay the engine's live config. Returns false when a preview or real
    /// detect is running, detection is suspended for a backfill, or no
    /// activity covers the point.
    pub fn start(
        &self,
        lat: f64,
        lng: f64,
        config: crate::FfiSectionConfig,
    ) -> Result<bool, VeloqError> {
        if crate::persistence::detection_suspended() {
            info!("veloqrs: [SectionPreview] Start refused: detection is suspended");
            return Ok(false);
        }

        // The slot mutex is held across reap, check, spawn and install, so two
        // concurrent starts cannot both pass the emptiness check.
        let mut slot = SECTION_PREVIEW_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner());

        // Reap a terminal run first: a cancelled, dead or complete-but-untaken
        // preview must not occupy the slot forever once its poller has gone
        // away. A fresh start supersedes an untaken payload, which was cut for
        // parameters the caller has already abandoned.
        if let Some(handle) = slot.as_mut() {
            match handle.poll_status() {
                PreviewPoll::Running => {
                    info!("veloqrs: [SectionPreview] Start refused: a preview is already running");
                    return Ok(false);
                }
                PreviewPoll::Complete
                | PreviewPoll::Cancelled
                | PreviewPoll::PoolUnusable
                | PreviewPoll::Died => {
                    *slot = None;
                }
            }
        }

        // Checked under the preview slot lock so a real detect observed here
        // is current as of this start; a detect that begins mid-spawn merely
        // overlaps a read-only run, it cannot corrupt anything.
        {
            let detect_guard = SECTION_DETECTION_HANDLE
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if detect_guard.is_some() {
                info!("veloqrs: [SectionPreview] Start refused: a real detect is running");
                return Ok(false);
            }
        }

        let overlay = PreviewOverlay {
            proximity_threshold: config.proximity_threshold,
            min_section_length: config.min_section_length,
            max_section_length: config.max_section_length,
            min_activities: config.min_activities,
            divergence_threshold: config.divergence_threshold,
        };

        match with_engine_read(|e| e.preview_detect_background(lat, lng, overlay))? {
            Some(handle) => {
                *slot = Some(handle);
                info!("veloqrs: [SectionPreview] Preview started");
                Ok(true)
            }
            None => {
                info!("veloqrs: [SectionPreview] Start refused: no activity covers the point");
                Ok(false)
            }
        }
    }

    /// "idle" | "running" | "complete" | "cancelled" | "pool_unusable" | "error"
    pub fn poll(&self) -> Result<String, VeloqError> {
        let mut slot = SECTION_PREVIEW_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let Some(handle) = slot.as_mut() else {
            return Ok("idle".to_string());
        };
        Ok(match handle.poll_status() {
            PreviewPoll::Running => "running".to_string(),
            // The slot stays occupied until take_result so the payload
            // cannot be lost between polls.
            PreviewPoll::Complete => "complete".to_string(),
            PreviewPoll::Cancelled => {
                *slot = None;
                "cancelled".to_string()
            }
            PreviewPoll::PoolUnusable => {
                *slot = None;
                log::error!(
                    "veloqrs: [SectionPreview] Preview refused: too much of the pool is unreadable to detect over"
                );
                "pool_unusable".to_string()
            }
            PreviewPoll::Died => {
                *slot = None;
                log::error!("veloqrs: [SectionPreview] Preview thread died without a result");
                "error".to_string()
            }
        })
    }

    pub fn get_progress(&self) -> Result<Option<crate::FfiDetectionProgress>, VeloqError> {
        let slot = SECTION_PREVIEW_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        Ok(slot.as_ref().map(|handle| {
            let phase = handle.progress.get_phase();
            let completed = handle.progress.get_completed();
            let total = handle.progress.get_total();
            let percent = handle.progress.get_percent();
            crate::FfiDetectionProgress {
                phase,
                completed,
                total,
                percent,
            }
        }))
    }

    /// The one JSON payload, once. None while running or after taken.
    pub fn take_result(&self) -> Result<Option<String>, VeloqError> {
        let mut slot = SECTION_PREVIEW_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let Some(handle) = slot.as_mut() else {
            return Ok(None);
        };
        match handle.take_payload() {
            Some(json) => {
                *slot = None;
                Ok(Some(json))
            }
            None => Ok(None),
        }
    }

    /// Cooperative: aborts within one load chunk; once inside the detect the
    /// run completes and is discarded.
    pub fn cancel(&self) -> Result<(), VeloqError> {
        let slot = SECTION_PREVIEW_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(handle) = slot.as_ref() {
            handle.request_cancel();
            info!("veloqrs: [SectionPreview] Cancel requested");
        }
        Ok(())
    }
}

/// One proposed route group at a previewed strictness.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiRouteGroupPreview {
    /// The grouping's own key for this group. It is NOT a stable route id: the
    /// preview never runs the identity remap that assigns one, so this joins
    /// rows within one payload and must never be persisted or matched against
    /// a route id the app holds.
    pub key: String,
    /// Member activity ids, sorted.
    pub activity_ids: Vec<String>,
}

/// What the grouping knob would do, before it is applied.
///
/// The grouping functions are pure and this runs them off the engine lock over
/// the cached signatures. Nothing is written, and the engine's own groups,
/// match info and route identities are untouched.
#[derive(uniffi::Object)]
pub struct RouteGroupingPreview {
    pub(crate) _private: (),
}

#[uniffi::export]
impl RouteGroupingPreview {
    #[uniffi::constructor]
    pub fn new() -> Arc<Self> {
        Arc::new(Self { _private: () })
    }

    /// Group the whole library at this strictness. Only the two knobs the
    /// control exposes cross the boundary; the rest of the match config is the
    /// engine's live one. Returns false when a preview is already running or
    /// the library has no signatures to group.
    pub fn start(
        &self,
        min_match_percentage: f64,
        endpoint_threshold: f64,
    ) -> Result<bool, VeloqError> {
        // The slot mutex is held across reap, check, spawn and install, so two
        // concurrent starts cannot both pass the emptiness check.
        let mut slot = ROUTE_GROUPING_PREVIEW_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner());

        // Reap a terminal run first: a cancelled, dead or complete-but-untaken
        // run must not hold the slot once its poller has gone away. A fresh
        // start supersedes an untaken payload, which was grouped at a
        // strictness the caller has already moved off.
        if let Some(handle) = slot.as_mut() {
            match handle.poll_status() {
                GroupingPoll::Running => {
                    info!(
                        "veloqrs: [RouteGroupingPreview] Start refused: a preview is already running"
                    );
                    return Ok(false);
                }
                GroupingPoll::Complete | GroupingPoll::Cancelled | GroupingPoll::Died => {
                    *slot = None;
                }
            }
        }

        let strictness = PreviewStrictness {
            min_match_percentage,
            endpoint_threshold,
        };
        // Write lock, not read: the signature cache this fills is the
        // engine's, and a miss reads SQLite.
        match with_engine(|e| e.grouping_preview_background(strictness))? {
            Some(handle) => {
                *slot = Some(handle);
                info!("veloqrs: [RouteGroupingPreview] Preview started");
                Ok(true)
            }
            None => {
                info!("veloqrs: [RouteGroupingPreview] Start refused: no signatures to group");
                Ok(false)
            }
        }
    }

    /// "idle" | "running" | "complete" | "cancelled" | "error"
    pub fn poll(&self) -> Result<String, VeloqError> {
        let mut slot = ROUTE_GROUPING_PREVIEW_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let Some(handle) = slot.as_mut() else {
            return Ok("idle".to_string());
        };
        Ok(match handle.poll_status() {
            GroupingPoll::Running => "running".to_string(),
            // The slot stays occupied until take_result so the payload cannot
            // be lost between polls.
            GroupingPoll::Complete => "complete".to_string(),
            GroupingPoll::Cancelled => {
                *slot = None;
                "cancelled".to_string()
            }
            GroupingPoll::Died => {
                *slot = None;
                log::error!("veloqrs: [RouteGroupingPreview] Preview thread died without a result");
                "error".to_string()
            }
        })
    }

    /// The one payload, once. None while running or after taken.
    pub fn take_result(&self) -> Result<Option<Vec<FfiRouteGroupPreview>>, VeloqError> {
        let mut slot = ROUTE_GROUPING_PREVIEW_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let Some(handle) = slot.as_mut() else {
            return Ok(None);
        };
        match handle.take_groups() {
            Some(groups) => {
                *slot = None;
                Ok(Some(
                    groups
                        .into_iter()
                        .map(|g| FfiRouteGroupPreview {
                            key: g.key,
                            activity_ids: g.activity_ids,
                        })
                        .collect(),
                ))
            }
            None => Ok(None),
        }
    }

    /// Cooperative. The grouping itself is one tracematch call and cannot be
    /// interrupted, so a cancel that arrives inside it discards the result
    /// rather than shortening the run.
    pub fn cancel(&self) -> Result<(), VeloqError> {
        let slot = ROUTE_GROUPING_PREVIEW_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if let Some(handle) = slot.as_ref() {
            handle.request_cancel();
            info!("veloqrs: [RouteGroupingPreview] Cancel requested");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_globals::{init_global_engine, seeded_global_engine, serial_global_state};

    fn clear_slot() {
        *SECTION_PREVIEW_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = None;
    }

    /// A panic while a slot lock is held poisons it. The engine lock and the
    /// detection object both recover, so the preview screen must not read
    /// "error" for the rest of the session over the same thing.
    fn poison<T: Send + 'static>(lock: &'static std::sync::Mutex<T>) {
        let _ = std::thread::spawn(move || {
            let _guard = lock.lock().unwrap();
            panic!("poison the slot on purpose");
        })
        .join();
        assert!(lock.is_poisoned());
    }

    fn clear_grouping_slot() {
        *ROUTE_GROUPING_PREVIEW_HANDLE
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = None;
    }

    /// Every byte of the route-group tables and the state the grouping owns
    /// outside them, so "wrote nothing" is a comparison and not a hope. Three
    /// things live outside the tables and each is a way a preview could look
    /// clean and be wrong: the group cache is in memory, the dirty flag
    /// decides whether the next read recomputes, and the strictness itself is
    /// a persisted setting, which is what `set_match_strictness` writes and
    /// what a preview must never touch on its way to the same grouping call.
    fn grouping_state() -> String {
        with_engine(|e| {
            let tables: String = ["route_groups", "activity_matches", "route_names"]
                .iter()
                .map(|t| {
                    let rows: Vec<String> = e
                        .db
                        .prepare(&format!("SELECT * FROM {t}"))
                        .and_then(|mut stmt| {
                            let cols = stmt.column_count();
                            let rows = stmt.query_map([], move |row| {
                                Ok((0..cols)
                                    .map(|i| {
                                        row.get_ref(i).map(|v| format!("{v:?}")).unwrap_or_default()
                                    })
                                    .collect::<Vec<_>>()
                                    .join("|"))
                            })?;
                            rows.collect::<Result<Vec<String>, _>>()
                        })
                        .unwrap_or_default();
                    format!("{t}[{}]", rows.join(";"))
                })
                .collect::<Vec<_>>()
                .join(" ");
            let held: Vec<String> = e
                .get_groups()
                .iter()
                .map(|g| format!("{}:{}", g.group_id, g.activity_ids.join(",")))
                .collect();
            let (min_pct, endpoint) = e.match_strictness();
            format!(
                "{tables} held[{}] strictness[{min_pct},{endpoint}] dirty[{}]",
                held.join(";"),
                e.groups_are_dirty()
            )
        })
        .expect("engine")
    }

    /// Scenario: the knob that regroups the whole library has no preview, and
    /// the only thing that groups today also writes every table it touches.
    /// Expected behaviour: the preview object runs the same grouping and
    /// leaves storage byte-identical.
    #[test]
    fn a_grouping_preview_writes_nothing() {
        let _guard = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_grouping_slot();
        let preview = RouteGroupingPreview::new();

        // Group for real first, so the comparison is against a populated
        // state rather than an empty one a preview could not disturb.
        with_engine(|e| {
            e.get_groups();
        })
        .expect("engine");
        let before = grouping_state();
        assert!(
            before.contains("held["),
            "the fixture has a grouping to disturb"
        );

        assert!(preview.start(40.0, 500.0).unwrap());
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);
        while preview.poll().unwrap() == "running" {
            assert!(
                std::time::Instant::now() < deadline,
                "preview never finished"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert_eq!(preview.poll().unwrap(), "complete");

        let groups = preview.take_result().unwrap().expect("one payload");
        assert!(
            !groups.is_empty(),
            "six activities on one track group into something"
        );
        assert!(
            groups
                .windows(2)
                .all(|w| w[0].activity_ids.len() >= w[1].activity_ids.len()),
            "ordered by member count descending, the order the route list paints in"
        );
        assert!(
            groups
                .iter()
                .all(|g| g.activity_ids.windows(2).all(|w| w[0] <= w[1])),
            "members sorted, so one strictness gives one payload"
        );

        assert_eq!(grouping_state(), before, "the preview wrote something");
        assert!(preview.take_result().unwrap().is_none(), "taken once");
        assert_eq!(preview.poll().unwrap(), "idle");
        clear_grouping_slot();
    }

    /// A slack strictness cannot split what a strict one joined, so the two
    /// runs are evidence the knob is actually reaching the grouping.
    #[test]
    fn a_slacker_strictness_groups_at_least_as_hard() {
        let _guard = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_grouping_slot();
        let preview = RouteGroupingPreview::new();

        let run = |min_pct: f64, endpoint: f64| -> usize {
            assert!(preview.start(min_pct, endpoint).unwrap());
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);
            while preview.poll().unwrap() == "running" {
                assert!(
                    std::time::Instant::now() < deadline,
                    "preview never finished"
                );
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            preview.take_result().unwrap().expect("one payload").len()
        };

        let strict = run(99.0, 1.0);
        let slack = run(10.0, 5_000.0);
        assert!(
            slack <= strict,
            "loosening the knob cannot make more groups: {slack} against {strict}"
        );
        clear_grouping_slot();
    }

    /// An empty library has nothing to group, and that is not an error.
    #[test]
    fn an_empty_library_has_nothing_to_group() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("grouping_preview.db");
        clear_grouping_slot();
        let preview = RouteGroupingPreview::new();

        assert!(!preview.start(65.0, 500.0).unwrap());
        assert_eq!(preview.poll().unwrap(), "idle");
        assert!(preview.take_result().unwrap().is_none());
        preview.cancel().unwrap();
    }

    /// A poisoned slot lock must not read "error" for the rest of the session.
    #[test]
    fn a_poisoned_grouping_slot_does_not_fail_every_later_call() {
        let _guard = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_grouping_slot();
        let preview = RouteGroupingPreview::new();
        poison(&ROUTE_GROUPING_PREVIEW_HANDLE);

        assert_eq!(preview.poll().unwrap(), "idle");
        assert!(preview.take_result().unwrap().is_none());
        preview.cancel().unwrap();
        assert!(preview.start(65.0, 500.0).unwrap());
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);
        while preview.poll().unwrap() == "running" {
            assert!(
                std::time::Instant::now() < deadline,
                "preview never finished"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert!(preview.take_result().unwrap().is_some());
        clear_grouping_slot();
    }

    #[test]
    fn a_poisoned_slot_lock_does_not_fail_every_later_call() {
        let _guard = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_slot();
        let preview = SectionPreview::new();
        poison(&SECTION_PREVIEW_HANDLE);
        poison(&SECTION_DETECTION_HANDLE);

        assert_eq!(preview.poll().unwrap(), "idle");
        assert!(preview.get_progress().unwrap().is_none());
        assert!(preview.take_result().unwrap().is_none());
        preview.cancel().unwrap();

        let first = preview.centres(1).unwrap().remove(0);
        assert!(
            preview
                .start(first.lat, first.lng, crate::FfiSectionConfig::default())
                .unwrap()
        );
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);
        while preview.poll().unwrap() == "running" {
            assert!(
                std::time::Instant::now() < deadline,
                "preview never finished"
            );
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        assert!(preview.take_result().unwrap().is_some());
        clear_slot();
    }

    #[test]
    fn an_empty_library_has_no_centres_and_nothing_to_preview() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("preview.db");
        clear_slot();
        let preview = SectionPreview::new();

        assert!(preview.centres(5).unwrap().is_empty());
        assert!(preview.current(46.2, 7.35).unwrap().is_none());
        assert!(
            !preview
                .start(46.2, 7.35, crate::FfiSectionConfig::default())
                .unwrap()
        );
        assert_eq!(preview.poll().unwrap(), "idle");
        assert!(preview.get_progress().unwrap().is_none());
        assert!(preview.take_result().unwrap().is_none());
        preview.cancel().unwrap();
    }

    #[test]
    fn a_library_with_no_sections_ranks_its_activity_bins() {
        let _guard = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_slot();
        let preview = SectionPreview::new();

        let centres = preview.centres(3).unwrap();
        assert!(!centres.is_empty());
        assert!(centres.len() <= 3);
        assert!(
            centres
                .iter()
                .all(|c| c.source == "activities" && c.section_count == 0)
        );
        assert!(
            centres
                .windows(2)
                .all(|w| w[0].visit_total >= w[1].visit_total)
        );

        let first = &centres[0];
        assert!(preview.current(first.lat, first.lng).unwrap().is_some());
        assert!(preview.current(0.0, 0.0).unwrap().is_none());
    }

    #[test]
    fn a_preview_runs_to_a_payload_that_is_taken_once() {
        let _guard = serial_global_state();
        let _tmp = seeded_global_engine();
        clear_slot();
        let preview = SectionPreview::new();
        let first = preview.centres(1).unwrap().remove(0);

        assert!(
            preview
                .start(first.lat, first.lng, crate::FfiSectionConfig::default())
                .unwrap()
        );
        assert!(
            !preview
                .start(first.lat, first.lng, crate::FfiSectionConfig::default())
                .unwrap()
                || preview.poll().unwrap() != "running",
            "a second start while one runs is refused"
        );
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);
        while preview.poll().unwrap() == "running" {
            assert!(
                std::time::Instant::now() < deadline,
                "preview never finished"
            );
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        assert_eq!(preview.poll().unwrap(), "complete");
        assert!(
            preview.get_progress().unwrap().is_some(),
            "the slot holds the run until taken"
        );

        let payload = preview.take_result().unwrap().expect("one payload");
        let json: serde_json::Value = serde_json::from_str(&payload).expect("a JSON payload");
        assert_eq!(json["pool"]["activities"], 6, "{payload}");
        assert_eq!(json["pool"]["unreadable"], 0);
        assert!(json["sections"].is_array());
        assert_eq!(
            json["counts"]["proposed"],
            json["sections"].as_array().unwrap().len()
        );
        assert!(preview.take_result().unwrap().is_none(), "taken once");
        assert_eq!(preview.poll().unwrap(), "idle");
    }
}
