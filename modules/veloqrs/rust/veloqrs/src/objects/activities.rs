use super::error::{VeloqError, with_engine, with_reader};
use crate::persistence::sections::conditioning;
use std::sync::Arc;

#[derive(uniffi::Object)]
pub struct ActivityManager {
    pub(crate) _private: (),
}

#[uniffi::export]
impl ActivityManager {
    #[uniffi::constructor]
    pub fn new() -> Arc<Self> {
        Arc::new(Self { _private: () })
    }

    pub fn add(
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
        if !all_coords.len().is_multiple_of(2) {
            return Err(VeloqError::Database {
                msg: format!(
                    "all_coords length {} is not an even count of lat/lon values",
                    all_coords.len()
                ),
            });
        }
        let mutated = with_engine(|engine| {
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
                })
        })??;
        // Announced after `with_engine` has let the lock go: the reader this
        // wakes reads the new track through that same lock. An add that
        // replaced a stored track with a different one is the only case, so a
        // routine re-sync announces nothing.
        if !mutated.is_empty() {
            crate::objects::observer::notify(
                crate::objects::observer::Announcement::GpsTracksMutated(mutated),
            );
        }
        // A batch stored through the FFI is a stored batch like any other:
        // the engine owns the detection run that follows it.
        conditioning::note_stored(activity_ids.len() as u32);
        conditioning::condition_pending();
        Ok(())
    }

    /// Store the recording atomically; detection sees it only after commit.
    async fn save_provisional(
        &self,
        activity_id: String,
        coords: Vec<f64>,
        body: crate::FfiActivityBody,
        metrics: crate::FfiActivityMetrics,
    ) -> Result<(), VeloqError> {
        crate::runtime::ASYNC_RUNTIME
            .spawn_blocking(move || {
                if !coords.len().is_multiple_of(2) {
                    return Err(VeloqError::Database {
                        msg: "provisional coordinates must be lat/lon pairs".into(),
                    });
                }
                let has_track = !coords.is_empty();
                let points = coords
                    .as_chunks::<2>()
                    .0
                    .iter()
                    .map(|p| crate::GpsPoint::new(p[0], p[1]))
                    .collect();
                let stored = with_engine(|engine| {
                    let existed = engine.get_activity_body(&activity_id).is_some();
                    engine
                        .save_provisional_activity(&activity_id, points, &body, metrics)
                        .map_err(|error| VeloqError::Database {
                            msg: error.to_string(),
                        })?;
                    Ok::<_, VeloqError>(!existed)
                })??;
                if has_track && stored {
                    conditioning::note_stored(1);
                    conditioning::condition_pending();
                }
                Ok(())
            })
            .await
            .map_err(|error| VeloqError::Database {
                msg: format!("Provisional activity worker failed: {error}"),
            })?
    }

    /// The recording identity survives retries before its library update lands.
    fn provisional_id(&self, recording_id: String) -> String {
        format!("local-recording-{recording_id}")
    }

    fn get_ids(&self) -> Result<Vec<String>, VeloqError> {
        with_engine(|e| e.get_activity_ids())
    }

    /// Whether the library already holds this activity.
    ///
    /// An in-memory `contains_key`, so the answer is one boolean rather than
    /// the whole id list. The push task asked `get_ids().includes(id)`, which
    /// lifted every id string across the bridge to decide one thing.
    fn has(&self, activity_id: String) -> Result<bool, VeloqError> {
        with_engine(|e| e.has_activity(&activity_id))
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

    /// Store untyped activity bodies. Demo mode seeds the same table a live
    /// sync writes, so every downstream read is identical in both modes.
    fn upsert_activity_bodies(&self, rows: Vec<crate::FfiActivityBody>) -> Result<(), VeloqError> {
        if rows.is_empty() {
            return Ok(());
        }
        with_engine(|e| {
            let mapped: Vec<(String, i64, String)> = rows
                .into_iter()
                .map(|r| (r.activity_id, r.date as i64, r.raw))
                .collect();
            e.upsert_activity_bodies(&mapped)
                .map_err(|err| VeloqError::Database {
                    msg: format!("{}", err),
                })
        })?
    }

    /// One activity's untyped body, or None when the engine has not got it.
    ///
    /// A caller after a single activity uses this rather than the window read
    /// below: the table is keyed by the id, so this is one row instead of a
    /// page of them parsed in JavaScript to find it.
    fn get_activity_body(&self, activity_id: String) -> Result<Option<String>, VeloqError> {
        with_engine(|e| e.get_activity_body(&activity_id))
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

    /// Display names for a batch of activity ids, for a caller that holds ids
    /// and has to draw something an athlete recognises.
    ///
    /// Batched rather than one call per id: a caller drawing a row of chips
    /// would otherwise make a blocking FFI hop each, on a screen where a
    /// transition is already running. Ids the engine has no name for are
    /// absent from the answer rather than carrying an empty string, so the
    /// caller can tell "no name" from "a blank name" and fall back to the id.
    fn get_activity_names(
        &self,
        activity_ids: Vec<String>,
    ) -> Result<Vec<crate::FfiActivityName>, VeloqError> {
        with_engine(|e| {
            let named =
                e.get_activity_names(&activity_ids)
                    .map_err(|err| VeloqError::Database {
                        msg: format!("{}", err),
                    })?;
            // In the order asked for, so the caller does not re-sort what it
            // already had in the right order.
            Ok(activity_ids
                .iter()
                .filter_map(|id| {
                    named.get(id).map(|(name, date)| crate::FfiActivityName {
                        activity_id: id.clone(),
                        name: name.clone(),
                        date: *date as f64,
                    })
                })
                .collect())
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
                .map(|r| (r.event_id, r.date as i64, r.raw))
                .collect();
            e.replace_calendar_events(oldest_ts, newest_ts, &mapped)
                .map_err(|err| VeloqError::Database {
                    msg: format!("{}", err),
                })
        })?
    }

    /// A stream payload for an activity and series selection: the cached
    /// server body, or one rebuilt from the points and times the ingest
    /// already stored. `None` when neither can answer the selection, which is
    /// what makes the caller fetch.
    fn get_stream_body(
        &self,
        activity_id: String,
        types: String,
    ) -> Result<Option<String>, VeloqError> {
        with_engine(|e| {
            e.read_stream_body(&activity_id, &types)
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

    /// The stored track, coordinate-encoded like every other track that leaves
    /// the engine.
    ///
    /// It used to box an `FfiGpsPoint` per point, and seven callers unboxed them
    /// again. On the detail screen that read re-runs on every `activities`
    /// announcement, over a ride of tens of thousands of points, which is the
    /// cost the encoding exists to avoid.
    fn get_gps_track(&self, activity_id: String) -> Result<Vec<u8>, VeloqError> {
        with_engine(|e| {
            let points = e.get_gps_track(&activity_id).unwrap_or_default();
            crate::coords::encode(&points)
        })
    }

    /// One feed card's preview line, from the cached signature.
    ///
    /// The same thing `get_startup_data` hands the first cards. A card that
    /// asks for `get_gps_track` instead pays a full decode of the stored blob
    /// and one boxed record per point, for a thumbnail that draws at about a
    /// hundred.
    fn get_preview_track(
        &self,
        activity_id: String,
    ) -> Result<Option<crate::FfiPreviewTrack>, VeloqError> {
        // Off the engine lock, like the feed bundle this serves a card of.
        with_reader(|conn| crate::persistence::screens::pooled::preview_track(conn, &activity_id))
    }

    /// What one activity was worth, as the title and body a lock screen shows
    /// and the same finding whole for a screen.
    ///
    /// `None` when no templates have been pushed yet, which is a body of raw
    /// keys avoided rather than a failure. `milestone_title` is what the JavaScript
    /// insight pipeline found, if anything; a native handler has none and
    /// passes `None`.
    fn activity_notification(
        &self,
        activity_id: String,
        activity_name: String,
        announce_prs: bool,
        milestone_title: Option<String>,
    ) -> Result<Option<crate::FfiActivityNotification>, VeloqError> {
        // Off the engine lock: every read behind the ladder is committed rows,
        // and a push lands as often as not while a sync page is committing.
        with_reader(|conn| {
            crate::notifications::build_notification_pooled(
                conn,
                &activity_id,
                &activity_name,
                announce_prs,
                milestone_title.as_deref(),
            )
        })
    }

    /// Write the id intervals.icu gave a locally keyed ride once its upload
    /// landed. False when no row was waiting for one.
    fn record_upload(&self, activity_id: String, intervals_id: String) -> Result<bool, VeloqError> {
        with_engine(|e| {
            e.record_upload(&activity_id, &intervals_id)
                .map_err(|err| VeloqError::Database {
                    msg: format!("{}", err),
                })
        })?
    }

    pub fn remove(&self, activity_id: String) -> Result<(), VeloqError> {
        with_engine(|e| {
            let referencing = e.sections_referencing_activity(&activity_id);
            if !referencing.is_empty() {
                return Err(VeloqError::ReferenceActivity {
                    msg: referencing.join(","),
                });
            }
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
    /// `min_route_activities` filters the returned route groups here, so the
    /// screen does not filter them after the fact.
    fn get_detail_data(
        &self,
        activity_id: String,
        min_route_activities: u32,
    ) -> Result<crate::FfiActivityDetailData, VeloqError> {
        // Off the engine lock: every read behind this is committed rows, and the
        // screen is opened from a notification or a deep link, where a sync is
        // very often mid-page and holding the writer.
        with_reader(|conn| {
            crate::persistence::screens::pooled::activity_detail_data(
                conn,
                &activity_id,
                min_route_activities,
            )
        })
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

    /// Scenario: a re-ingest can replace a stored track with a different one,
    /// which moves the preview line every feed card draws. Nothing said which
    /// activities that happened to, so the card's only option was re-reading
    /// its track on every activities event.
    ///
    /// Scenario: a push lands while a sync page commits, and the handler asks
    /// what the activity was worth so the tray entry says something.
    ///
    /// Expected behaviour: the ladder reads through the pool, so the
    /// notification is built inside a frame however long the writer holds. It
    /// took the engine write lock and waited the page out.
    mod notification_under_a_writer {
        use super::*;
        use crate::test_globals::{init_global_engine, serial_global_state};
        use std::sync::Arc as StdArc;
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::time::{Duration, Instant};

        /// One 60 Hz frame.
        const FRAME_BUDGET: Duration = Duration::from_millis(16);
        /// Long enough that a wait cannot be read as scheduling noise.
        const WRITE_HOLD: Duration = Duration::from_millis(200);

        #[test]
        fn the_ladder_does_not_wait_for_a_writer() {
            let _serial = serial_global_state();
            let _dir = init_global_engine("notification_under_a_writer.db");

            let holding = StdArc::new(AtomicBool::new(false));
            let signal = StdArc::clone(&holding);
            let writer = std::thread::spawn(move || {
                crate::with_persistent_engine(|_| {
                    signal.store(true, Ordering::SeqCst);
                    std::thread::sleep(WRITE_HOLD);
                });
            });
            while !holding.load(Ordering::SeqCst) {
                std::thread::yield_now();
            }

            let started = Instant::now();
            let built = ActivityManager::new()
                .activity_notification("a1".to_string(), "Morning Ride".to_string(), true, None)
                .expect("the ladder reads while a writer holds the engine");
            let waited = started.elapsed();

            writer.join().expect("writer");
            assert!(
                built.is_none(),
                "no templates have been pushed, so there is nothing to post"
            );
            assert!(
                waited < FRAME_BUDGET,
                "the ladder waited {waited:?} behind a writer holding for {WRITE_HOLD:?}"
            );
        }

        #[test]
        fn the_native_json_path_does_not_wait_either() {
            let _serial = serial_global_state();
            let _dir = init_global_engine("notification_json_under_a_writer.db");

            let holding = StdArc::new(AtomicBool::new(false));
            let signal = StdArc::clone(&holding);
            let writer = std::thread::spawn(move || {
                crate::with_persistent_engine(|_| {
                    signal.store(true, Ordering::SeqCst);
                    std::thread::sleep(WRITE_HOLD);
                });
            });
            while !holding.load(Ordering::SeqCst) {
                std::thread::yield_now();
            }

            let started = Instant::now();
            let json = crate::push::activity_notification_json("a1", "Morning Ride", true)
                .expect("the native path reads while a writer holds the engine");
            let waited = started.elapsed();

            writer.join().expect("writer");
            assert!(json.is_none(), "no templates, so the handler posts nothing");
            assert!(
                waited < FRAME_BUDGET,
                "the native path waited {waited:?} behind a writer holding for {WRITE_HOLD:?}"
            );
        }
    }

    /// Expected behaviour: the store announces the ids whose track moved, and
    /// announces nothing for a batch that moved none.
    mod mutations {
        use super::*;
        use crate::objects::observer::recorder::Recorder;
        use crate::objects::observer::{flush, set_observer};
        use crate::test_globals::{init_global_engine, serial_global_state};

        /// Two points, as a flat lat/lng buffer with one activity's offsets.
        fn buffer(second_lat: f64) -> (Vec<f64>, Vec<u32>) {
            (vec![46.2, 7.3, second_lat, 7.31], vec![0])
        }

        fn add(id: &str, second_lat: f64) {
            let (coords, offsets) = buffer(second_lat);
            ActivityManager::new()
                .add(
                    vec![id.to_string()],
                    coords,
                    offsets,
                    vec!["Ride".to_string()],
                )
                .expect("the add");
        }

        #[test]
        fn a_replaced_track_is_announced_and_a_verbatim_re_ingest_is_not() {
            let _serial = serial_global_state();
            let _dir = init_global_engine("activity_mutations.db");
            add("a1", 46.21);

            let recorder = Recorder::new();
            set_observer(Some(recorder.clone()));

            add("a1", 46.21);
            flush();
            assert!(
                recorder.events().is_empty(),
                "a sync re-storing what it already holds moved nothing: {:?}",
                recorder.events()
            );

            add("a1", 47.5);
            flush();
            assert_eq!(
                recorder.events(),
                vec!["gps_tracks_mutated:a1".to_string()],
                "the replaced track is named, so only its card re-reads"
            );

            set_observer(None);
        }

        #[test]
        fn an_activity_the_library_never_held_is_not_a_mutation() {
            let _serial = serial_global_state();
            let _dir = init_global_engine("activity_first_add.db");

            let recorder = Recorder::new();
            set_observer(Some(recorder.clone()));

            add("a1", 46.21);
            flush();

            assert!(
                recorder.events().is_empty(),
                "a first sync is every activity arriving, and nothing is stale: {:?}",
                recorder.events()
            );
            set_observer(None);
        }
    }
}
