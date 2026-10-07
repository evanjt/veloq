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
        let (mutated, install) = with_engine(|engine| {
            let install = crate::persistence::engine_install();
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
            let mutated = engine
                .add_activities_batch(batch)
                .map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })?;
            // Junction rows now, so a stored ride shows its sections and PRs
            // without waiting on a detect run, which may be suspended.
            engine.attach_new_activities(&activity_ids);
            Ok::<_, VeloqError>((mutated, install))
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
        conditioning::note_stored_for(install, activity_ids.len() as u32);
        conditioning::condition_pending();
        Ok(())
    }

    /// Store the recording atomically; detection sees it only after commit.
    ///
    /// The track is read from the FIT the save wrote, on the worker, so it
    /// never crosses the bridge and the launch replay of a failed write reads
    /// the same file the save did. `None` is a manual entry, which has no file
    /// and gets a row with no track. A FIT that cannot be read fails the save
    /// rather than storing a ride with no track.
    async fn save_provisional(
        &self,
        activity_id: String,
        fit_path: Option<String>,
        body: crate::FfiActivityBody,
    ) -> Result<(), VeloqError> {
        // Taken at the call, not when the worker runs: a restore or an account
        // switch can reopen the engine before the worker is scheduled.
        let install = crate::persistence::engine_install();
        run_provisional_worker(move || {
            let coords = match fit_path {
                Some(path) => fit_coords(&path)?,
                None => Vec::new(),
            };
            save_provisional_for(install, &activity_id, coords, &body)
        })
        .await
    }

    /// The recording identity survives retries before its library update lands.
    fn provisional_id(&self, recording_id: String) -> String {
        format!("local-recording-{recording_id}")
    }

    fn get_ids(&self) -> Result<Vec<String>, VeloqError> {
        with_reader(crate::persistence::activities::pooled::activity_ids).and_then(|r| {
            r.map_err(|e| VeloqError::Database {
                msg: format!("{}", e),
            })
        })
    }

    /// The activities whose track the engine refused for good at the version
    /// the census still names. An empty list when no athlete is set.
    fn get_refused_track_ids(&self) -> Result<Vec<String>, VeloqError> {
        with_reader(|conn| {
            let athlete_id = crate::persistence::settings::setting_from(
                conn,
                crate::persistence::settings_keys::ATHLETE_ID,
            )
            .ok()
            .flatten();
            athlete_id
                .map(|id| crate::persistence::activities::pooled::refused_track_ids(conn, &id))
                .unwrap_or_default()
        })
    }

    /// Whether the library already holds this activity.
    ///
    /// An in-memory `contains_key`, so the answer is one boolean rather than
    /// the whole id list. The push task asked `get_ids().includes(id)`, which
    /// lifted every id string across the bridge to decide one thing.
    fn has(&self, activity_id: String) -> Result<bool, VeloqError> {
        with_reader(|conn| crate::persistence::activities::pooled::has_activity(conn, &activity_id))
            .and_then(|r| {
                r.map_err(|e| VeloqError::Database {
                    msg: format!("{}", e),
                })
            })
    }

    fn get_count(&self) -> Result<u32, VeloqError> {
        with_reader(crate::persistence::activities::pooled::activity_count).and_then(|r| {
            r.map_err(|e| VeloqError::Database {
                msg: format!("{}", e),
            })
        })
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
            e.upsert_activity_bodies_with_metrics(&mapped)
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
        with_reader(|conn| {
            crate::persistence::activities::pooled::activity_body(conn, &activity_id)
        })
    }

    /// The feed's read: untyped activity bodies in a window, newest first,
    /// narrowed by a search and a sport chip and then paged. The screens read
    /// fields no Rust type models, so they parse these rather than a
    /// reconstruction from `activity_metrics`. A search or a chip reaches every
    /// stored activity, not only the windows the feed has paged in.
    fn get_activity_bodies(
        &self,
        query: crate::FfiActivityBodiesQuery,
    ) -> Result<crate::FfiActivityBodiesPage, VeloqError> {
        with_reader(|conn| {
            crate::persistence::activities::pooled::activity_body_page(conn, &query).map_err(
                |err| VeloqError::Database {
                    msg: format!("{}", err),
                },
            )
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
        with_reader(|conn| {
            let named = crate::persistence::strength::pooled::activity_names(conn, &activity_ids)
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
        days: f64,
        gap: bool,
        raw: String,
    ) -> Result<(), VeloqError> {
        let days = crate::ffi_types::int_from_wire(days);
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
        oldest_ts: f64,
        newest_ts: f64,
        rows: Vec<crate::FfiCalendarEventBody>,
    ) -> Result<(), VeloqError> {
        let oldest_ts = crate::ffi_types::int_from_wire(oldest_ts);
        let newest_ts = crate::ffi_types::int_from_wire(newest_ts);
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
        let install = crate::persistence::engine_install();
        let (body, stale) = with_reader(|conn| {
            crate::persistence::bodies::pooled::stream_body(conn, &activity_id, &types).map_err(
                |err| VeloqError::Database {
                    msg: format!("{}", err),
                },
            )
        })??;
        if stale {
            let touched = crate::persistence::try_with_persistent_engine_for(install, |engine| {
                engine.try_touch_stream_body(&activity_id, &types)
            });
            if let Some(Err(error)) = touched
                && !matches!(
                    error.sqlite_error_code(),
                    Some(rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked)
                )
            {
                return Err(VeloqError::Database {
                    msg: error.to_string(),
                });
            }
        }
        Ok(body)
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

    pub fn get_missing_time_streams(
        &self,
        activity_ids: Vec<String>,
    ) -> Result<Vec<String>, VeloqError> {
        with_reader(|conn| {
            crate::persistence::activities::pooled::activities_missing_time_streams(
                conn,
                &activity_ids,
            )
        })
    }

    /// The stored track, coordinate-encoded like every other track that leaves
    /// the engine.
    ///
    /// It used to box an `FfiGpsPoint` per point, and seven callers unboxed them
    /// again. On the detail screen that read re-runs on every `activities`
    /// announcement, over a ride of tens of thousands of points, which is the
    /// cost the encoding exists to avoid.
    fn get_gps_track(&self, activity_id: String) -> Result<Vec<u8>, VeloqError> {
        with_reader(|conn| {
            let points = crate::persistence::activities::pooled::gps_track(conn, &activity_id)
                .unwrap_or_default();
            crate::persistence::codec::encode_polyline(&points)
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
    /// keys avoided rather than a failure. `announce_milestones` is the
    /// athlete's fitness milestone switch; the engine finds the step itself.
    fn activity_notification(
        &self,
        activity_id: String,
        activity_name: String,
        announce_prs: bool,
        announce_milestones: bool,
    ) -> Result<Option<crate::FfiActivityNotification>, VeloqError> {
        // Off the engine lock: every read behind the ladder is committed rows,
        // and a push lands as often as not while a sync page is committing.
        with_reader(|conn| {
            crate::notifications::build_notification_pooled(
                conn,
                &activity_id,
                &activity_name,
                announce_prs,
                announce_milestones,
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
        with_reader(|conn| crate::FfiActivityHighlightsBundle {
            indicators: crate::persistence::indicators::pooled::activity_indicators(
                conn,
                &activity_ids,
            ),
            route_highlights: crate::persistence::fitness::derivations::pooled::route_highlights(
                conn,
                &activity_ids,
            ),
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

/// Busy refusals the provisional save has slept past since process start. A
/// count is how a test sees the save inside its retry loop, where it must not
/// be holding the engine, rather than guessing at it with a sleep.
pub(crate) static PROVISIONAL_BUSY_RETRIES: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

/// The positions a recording's FIT holds, as lat/lon pairs.
fn fit_coords(path: &str) -> Result<Vec<f64>, VeloqError> {
    let data = std::fs::read(path).map_err(|e| VeloqError::Database {
        msg: format!("the recording's FIT could not be read: {e}"),
    })?;
    let track = crate::fit::parse_fit_track(&data).map_err(|e| VeloqError::Database {
        msg: format!("the recording's FIT could not be parsed: {e}"),
    })?;
    Ok(track
        .iter()
        .flat_map(|p| [p.latitude, p.longitude])
        .collect())
}

/// The provisional save, written into the library that was open at `install`.
fn save_provisional_for(
    install: u64,
    activity_id: &str,
    coords: Vec<f64>,
    body: &crate::FfiActivityBody,
) -> Result<(), VeloqError> {
    if !coords.len().is_multiple_of(2) {
        return Err(VeloqError::Database {
            msg: "provisional coordinates must be lat/lon pairs".into(),
        });
    }
    let has_track = !coords.is_empty();
    let points: Vec<crate::GpsPoint> = coords
        .as_chunks::<2>()
        .0
        .iter()
        .map(|p| crate::GpsPoint::new(p[0], p[1]))
        .collect();
    let started = std::time::Instant::now();
    let stored = loop {
        let result = crate::persistence::with_persistent_engine_for(install, |engine| {
            let existed = engine.get_activity_body(activity_id).is_some();
            engine
                .try_save_provisional_activity(activity_id, &points, body)
                .map(|()| !existed)
        });
        match result {
            Some(Ok(stored)) => break stored,
            Some(Err(error))
                if matches!(
                    error.sqlite_error_code(),
                    Some(rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked)
                ) && started.elapsed() < std::time::Duration::from_secs(5) =>
            {
                PROVISIONAL_BUSY_RETRIES.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
            Some(Err(error)) => {
                return Err(VeloqError::Database {
                    msg: error.to_string(),
                });
            }
            None if crate::persistence::engine_install() != install => {
                return Err(VeloqError::Database {
                    msg: "the library changed before the recording was saved".into(),
                });
            }
            None => return Err(VeloqError::NotInitialized),
        }
    };
    if has_track && stored {
        conditioning::note_stored_for(install, 1);
        conditioning::condition_pending();
    }
    Ok(())
}

async fn run_provisional_worker(
    work: impl FnOnce() -> Result<(), VeloqError> + Send + 'static,
) -> Result<(), VeloqError> {
    crate::runtime::ASYNC_RUNTIME
        .spawn_blocking(move || {
            pause_provisional_worker();
            work()
        })
        .await
        .map_err(|error| VeloqError::Database {
            msg: format!("Provisional activity worker failed: {error}"),
        })?
}

#[cfg(not(test))]
fn pause_provisional_worker() {}

#[cfg(test)]
static PROVISIONAL_WORKER_GATE: std::sync::Mutex<
    Option<(std::sync::mpsc::Sender<()>, std::sync::mpsc::Receiver<()>)>,
> = std::sync::Mutex::new(None);

#[cfg(test)]
fn pause_provisional_worker() {
    let gate = PROVISIONAL_WORKER_GATE.lock().unwrap().take();
    if let Some((started, release)) = gate {
        started.send(()).unwrap();
        release.recv().unwrap();
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
    /// Expected behaviour: the notification read finishes while the writer
    /// still holds the engine lock.
    mod notification_under_a_writer {
        use super::*;
        use crate::test_globals::{
            init_global_engine, read_while_writer_holds, serial_global_state,
        };

        #[test]
        fn the_ladder_does_not_wait_for_a_writer() {
            let _serial = serial_global_state();
            let _dir = init_global_engine("notification_under_a_writer.db");

            let built = read_while_writer_holds(|| {
                ActivityManager::new()
                    .activity_notification(
                        "a1".to_string(),
                        "Morning Ride".to_string(),
                        true,
                        false,
                    )
                    .expect("the ladder reads while a writer holds the engine")
            });
            assert!(
                built.is_none(),
                "no templates have been pushed, so there is nothing to post"
            );
        }

        #[test]
        fn the_native_notification_path_does_not_wait_either() {
            let _serial = serial_global_state();
            let _dir = init_global_engine("notification_json_under_a_writer.db");

            let outcome = read_while_writer_holds(|| {
                crate::push::activity_notification_outcome("a1", "Morning Ride", true, false)
                    .expect("the native path reads while a writer holds the engine")
            });
            assert_eq!(
                outcome,
                Err(crate::push::PushRunOutcome::NoStringBundle),
                "no templates, so the handler posts nothing"
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
            let _suspended = conditioning::suspend_detection();
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

            crate::objects::observer::flush();
            set_observer(None);
        }

        #[test]
        fn an_activity_the_library_never_held_is_not_a_mutation() {
            let _serial = serial_global_state();
            let _suspended = conditioning::suspend_detection();
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
            crate::objects::observer::flush();
            set_observer(None);
        }
    }
    /// Scenario: an athlete saves a ride while a `.veloqdb` restore or an
    /// account switch closes and reopens the engine, and the save's worker is
    /// scheduled after the reopen.
    ///
    /// Expected behaviour: the save belongs to the library open when it was
    /// made. It is refused, and the new library holds no row for the ride.
    mod provisional_install {
        use super::*;
        use crate::test_globals::{init_global_engine, serial_global_state};
        use std::sync::mpsc;
        use std::time::Duration;

        const ID: &str = "local-recording-r1";

        fn body() -> crate::FfiActivityBody {
            crate::FfiActivityBody {
                activity_id: ID.into(),
                date: 1000.0,
                raw: format!(
                    "{{\"id\":\"{ID}\",\"name\":\"Ride\",\"type\":\"Ride\",\"distance\":50,\"moving_time\":30}}"
                ),
            }
        }

        fn track() -> Vec<f64> {
            vec![46.0, 7.0, 46.001, 7.001]
        }

        /// A FIT the app's own writer produced: 30 positions, on disk where
        /// the save would have left it.
        fn fit() -> Option<String> {
            static FILE: std::sync::OnceLock<tempfile::NamedTempFile> = std::sync::OnceLock::new();
            let file = FILE.get_or_init(|| {
                let file = tempfile::NamedTempFile::new().unwrap();
                std::fs::write(file.path(), crate::fit::recorded_ride_fit()).unwrap();
                file
            });
            Some(file.path().to_string_lossy().into_owned())
        }

        /// Rows for the ride in the open library: track, body, metrics.
        fn rows() -> (i64, i64, i64) {
            with_engine(|engine| {
                let count = |table: &str| -> i64 {
                    engine
                        .db
                        .query_row(
                            &format!("SELECT COUNT(*) FROM {table} WHERE activity_id = ?1"),
                            [ID],
                            |r| r.get(0),
                        )
                        .unwrap()
                };
                (
                    count("gps_tracks"),
                    count("activity_bodies"),
                    count("activity_metrics"),
                )
            })
            .expect("an open engine")
        }

        #[test]
        fn a_save_from_the_library_before_a_reopen_writes_nothing() {
            let _serial = serial_global_state();
            let _first = init_global_engine("provisional_first.db");
            let started_against = crate::persistence::engine_install();

            let _second = init_global_engine("provisional_second.db");
            assert_ne!(crate::persistence::engine_install(), started_against);

            let saved = save_provisional_for(started_against, ID, track(), &body());

            assert!(saved.is_err(), "a save for the old library is refused");
            assert_eq!(rows(), (0, 0, 0), "the new library holds nothing for it");
            assert!(
                with_engine(|engine| !engine.has_activity(ID)
                    && engine.get_activity_body(ID).is_none()
                    && !engine.activity_metrics.contains_key(ID))
                .unwrap(),
                "nor does the memory tier"
            );
        }

        #[test]
        fn a_queued_save_from_before_a_reopen_writes_nothing() {
            let _serial = serial_global_state();
            let _first = init_global_engine("provisional_queued_first.db");
            let (started_tx, started_rx) = mpsc::channel();
            let (release_tx, release_rx) = mpsc::channel();
            *PROVISIONAL_WORKER_GATE.lock().unwrap() = Some((started_tx, release_rx));

            let manager = ActivityManager::new();
            let save = crate::runtime::ASYNC_RUNTIME
                .spawn(async move { manager.save_provisional(ID.into(), fit(), body()).await });
            started_rx
                .recv_timeout(Duration::from_secs(10))
                .expect("the save worker must reach its gate");

            let _second = init_global_engine("provisional_queued_second.db");
            release_tx.send(()).unwrap();
            let saved = crate::runtime::block_on(save).expect("the worker must finish");

            assert!(
                matches!(saved, Err(VeloqError::Database { .. })),
                "a save queued for the old library is refused: {saved:?}"
            );
            assert_eq!(rows(), (0, 0, 0), "the new library holds nothing for it");
            assert!(
                with_engine(|engine| !engine.has_activity(ID)
                    && engine.get_activity_body(ID).is_none()
                    && !engine.activity_metrics.contains_key(ID))
                .unwrap(),
                "nor does the memory tier"
            );

            let manager = ActivityManager::new();
            crate::runtime::block_on(manager.save_provisional(ID.into(), fit(), body()))
                .expect("a new save belongs to the reopened library");
            assert_eq!(rows(), (1, 1, 1));
        }

        #[test]
        fn a_save_into_the_library_it_started_against_still_lands() {
            let _serial = serial_global_state();
            let _dir = init_global_engine("provisional_current.db");

            save_provisional_for(crate::persistence::engine_install(), ID, track(), &body())
                .expect("the save");

            assert_eq!(rows(), (1, 1, 1));
        }

        /// Scenario: the ride's provisional row is written from the FIT the
        /// save left on disk, so the track never crosses the bridge and the
        /// launch replay has the same source the save had.
        #[test]
        fn a_save_from_a_fit_stores_the_track_the_file_holds() {
            let _serial = serial_global_state();
            let _dir = init_global_engine("provisional_fit.db");

            crate::runtime::block_on(ActivityManager::new().save_provisional(
                ID.into(),
                fit(),
                body(),
            ))
            .expect("the save");

            assert_eq!(rows(), (1, 1, 1));
            let points = with_engine(|engine| engine.get_gps_track(ID))
                .unwrap()
                .expect("a stored track");
            assert_eq!(points.len(), 30);
            assert!((points[0].latitude - 46.948).abs() < 1e-6);
        }

        /// A file that is gone or unreadable is a failed save, retried at the
        /// next launch, never a ride stored with no track.
        #[test]
        fn a_save_from_a_missing_fit_writes_nothing() {
            let _serial = serial_global_state();
            let _dir = init_global_engine("provisional_missing_fit.db");

            let saved = crate::runtime::block_on(ActivityManager::new().save_provisional(
                ID.into(),
                Some("/nowhere/ride.fit".into()),
                body(),
            ));

            assert!(
                matches!(saved, Err(VeloqError::Database { .. })),
                "{saved:?}"
            );
            assert_eq!(rows(), (0, 0, 0));
        }

        /// A manual entry has no file, and its row is the body and metrics.
        #[test]
        fn a_save_with_no_fit_writes_a_trackless_row() {
            let _serial = serial_global_state();
            let _dir = init_global_engine("provisional_no_fit.db");

            crate::runtime::block_on(ActivityManager::new().save_provisional(
                ID.into(),
                None,
                body(),
            ))
            .expect("the save");

            assert_eq!(rows(), (0, 1, 1));
        }

        #[test]
        fn a_save_with_no_engine_open_is_not_initialised() {
            let _serial = serial_global_state();
            let _dir = init_global_engine("provisional_closed.db");
            let install = crate::persistence::engine_install();
            crate::persistence::clear_persistent_engine();

            let saved = save_provisional_for(install, ID, track(), &body());

            assert!(
                matches!(saved, Err(VeloqError::NotInitialized)),
                "{saved:?}"
            );
        }

        #[test]
        fn odd_coordinates_are_refused_before_the_engine() {
            let _serial = serial_global_state();
            let _dir = init_global_engine("provisional_odd.db");

            let saved = save_provisional_for(
                crate::persistence::engine_install(),
                ID,
                vec![46.0, 7.0, 46.001],
                &body(),
            );

            assert!(
                matches!(saved, Err(VeloqError::Database { .. })),
                "{saved:?}"
            );
            assert_eq!(rows(), (0, 0, 0));
        }
    }
}

#[cfg(test)]
#[path = "tests/activity_reads.rs"]
mod activity_reads_tests;

#[cfg(test)]
#[path = "tests/activity_provisional.rs"]
mod activity_provisional_tests;

#[cfg(test)]
#[path = "tests/activity_names_pooled.rs"]
mod activity_names_pooled_tests;

#[cfg(test)]
#[path = "tests/activity_set_pooled.rs"]
mod activity_set_pooled_tests;
