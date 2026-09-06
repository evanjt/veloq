//! Activity management: CRUD, GPS tracks, signatures, spatial queries, time streams.

use crate::{ActivityMatchInfo, ActivityMetrics, Bounds, GpsPoint, RouteSignature};
use rstar::{AABB, RTree};
use rusqlite::{OptionalExtension, Result as SqlResult, params, types::Type};
use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use super::codec;
use super::codec::{TrackRead, TrackWalk};
use super::{ActivityBoundsEntry, ActivityMetadata, PersistentEngine};

/// The prefix every device-minted activity key carries. intervals.icu ids are
/// `i` and digits and the seeded corpora use `demo-`, so this namespace is
/// ours alone and the three can share `activities.id` without meeting.
pub const LOCAL_KEY_PREFIX: &str = "local-";

/// Whether a key was minted here rather than handed down by intervals.icu.
/// The ingest writes `intervals_id` from the key for every server-sourced
/// activity, which is true by construction and is what the `024` backfill
/// rests on; this is the one case where it is not.
pub fn is_local_activity_key(activity_id: &str) -> bool {
    activity_id.starts_with(LOCAL_KEY_PREFIX)
}

/// A key for a ride the device recorded and no server has named.
///
/// `activities.id` holds both these and intervals.icu's own ids, so the two
/// spaces must never meet. An intervals.icu id is `i` and digits; this is
/// `local-` and hex, so no server id can be minted here and no key can be
/// mistaken for one upstream. The `demo-` prefixes the seeded corpora use are
/// likewise out of reach.
///
/// Uniqueness is the clock at nanosecond resolution, a process-lifetime
/// counter so two saves inside one tick differ, and a per-process random seed
/// so two devices restoring into one library cannot collide. They are mixed
/// rather than concatenated, so the key carries no timestamp a reader could
/// come to depend on. The mixer is `splitmix64`: this wants distinctness, not
/// secrecy, and a hash dependency for a row key is not worth carrying.
pub fn mint_local_activity_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn mix(mut z: u64) -> u64 {
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    static COUNTER: AtomicU64 = AtomicU64::new(0);
    static SEED: std::sync::OnceLock<u64> = std::sync::OnceLock::new();

    let seed = *SEED.get_or_init(|| {
        use std::hash::{BuildHasher, Hasher};
        let mut h = std::collections::hash_map::RandomState::new().build_hasher();
        h.write_u64(u64::from(std::process::id()));
        h.finish()
    });
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let tick = COUNTER.fetch_add(1, Ordering::Relaxed);

    let hi = mix(seed ^ nanos.rotate_left(17) ^ tick);
    let lo = mix(hi ^ seed.rotate_left(41) ^ nanos);
    format!("local-{hi:016x}{lo:016x}")
}

/// The stored zone series, or `None` when the column is empty or unreadable.
/// A row whose JSON no longer parses is worth loading without its zones.
fn zone_times(stored: Option<String>) -> Option<Vec<u32>> {
    serde_json::from_str(&stored?).ok()
}

/// Mark every id of a batch the SQL failure covers as `Corrupt`, leaving ids
/// the query already answered alone.
fn fail_chunk(decoded: &mut HashMap<String, TrackRead>, chunk: &[String], reason: &str) {
    log::error!("[tracks_batch] {}", reason);
    for id in chunk {
        decoded
            .entry(id.clone())
            .or_insert_with(|| TrackRead::Corrupt(reason.to_string()));
    }
}

/// Elevation provenance a stored track can be in: `elevation_state` 0.
pub const ELEVATION_STATE_UNKNOWN: u8 = 0;
/// Elevation provenance a stored track can be in: `elevation_state` 1.
pub const ELEVATION_STATE_FETCHED: u8 = 1;
/// Elevation provenance a stored track can be in: `elevation_state` 2.
pub const ELEVATION_STATE_UNAVAILABLE: u8 = 2;

/// How many stored tracks sit in each elevation provenance state.
///
/// The question the rest of the system asks is whether the library is
/// uniformly elevated, which is a scalar. Counts answer it without loading a
/// list of ids the caller would then have to walk.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ElevationStateCounts {
    /// Never asked, or stored before the provenance column existed.
    pub unknown: u64,
    /// Points carry elevation.
    pub fetched: u64,
    /// Asked, and upstream had no usable altitude series.
    pub unavailable: u64,
}

impl ElevationStateCounts {
    /// Tracks in a state other than `fetched`, ie. the size of the remaining
    /// backfill plus the activities that can never be filled.
    pub fn not_fetched(&self) -> u64 {
        self.unknown + self.unavailable
    }
}

/// An activity a section's stored geometry is cut from is not the engine's
/// to remove, so the derived-data clear leaves it alone.
const REFERENCE_ACTIVITY_EXCLUSION: &str = "id NOT IN (SELECT representative_activity_id \
    FROM sections WHERE representative_activity_id IS NOT NULL) \
    AND id NOT IN (SELECT rep_activity_id FROM section_geometry \
    WHERE rep_activity_id IS NOT NULL)";

/// What a derived-data clear removed and what it kept.
#[derive(Debug, Clone, uniffi::Record)]
pub struct DerivedClear {
    pub sections_removed: u32,
    pub activities_removed: u32,
    pub activities_kept: u32,
}

/// Remove the detected catalogue and the route caches, keeping every
/// section the athlete touched. Returns how many sections went.
fn wipe_derived_catalogue(db: &rusqlite::Connection) -> SqlResult<usize> {
    use super::sections::DERIVED_SECTION_PREDICATE;
    db.execute(
        &format!(
            "DELETE FROM section_activities
             WHERE section_id IN (SELECT id FROM sections WHERE {DERIVED_SECTION_PREDICATE})"
        ),
        [],
    )?;
    let sections = db.execute(
        &format!("DELETE FROM sections WHERE {DERIVED_SECTION_PREDICATE}"),
        [],
    )?;
    db.execute_batch(
        "DELETE FROM route_groups;
         DELETE FROM activity_matches;
         DELETE FROM overlap_cache;",
    )?;
    Ok(sections)
}

/// The tables keyed on an activity id that carry no foreign key to it, so a
/// removal has to clear them by hand. `ftp_history` holds the activity only as
/// provenance on a dated FTP reading, and that reading came from the activity,
/// so it goes with it. `overlap_cache` is not here: it holds a pair, so it is
/// cleared by its own statement.
///
/// `section_catalogue_archive_members` is deliberately absent. It is a frozen
/// snapshot of the pre-cutover catalogue with the lap data denormalised into
/// it, so removing an activity from it would rewrite a record of what was once
/// true. Whether the archive owns those rows or mirrors them is unsettled.
const ACTIVITY_KEYED_TABLES: &[&str] = &[
    "activity_bodies",
    "activity_metrics",
    "activity_indicators",
    "activity_matches",
    "activity_streams",
    "stream_bodies",
    "interval_bodies",
    "exercise_sets",
    "fit_file_status",
    "ftp_history",
];

impl PersistentEngine {
    // ========================================================================
    // Loading
    // ========================================================================

    /// Load activity metadata into memory (lightweight).
    pub(super) fn load_metadata(&mut self) -> SqlResult<()> {
        self.activity_metadata.clear();

        let mut stmt = self
            .db
            .prepare("SELECT id, sport_type, min_lat, max_lat, min_lng, max_lng FROM activities")?;

        let rows: Vec<SqlResult<ActivityBoundsEntry>> = stmt
            .query_map([], |row| {
                let id: String = row.get(0)?;
                let sport_type: String = row.get(1)?;
                let bounds = Bounds {
                    min_lat: row.get(2)?,
                    max_lat: row.get(3)?,
                    min_lng: row.get(4)?,
                    max_lng: row.get(5)?,
                };

                self.activity_metadata.insert(
                    id.clone(),
                    ActivityMetadata {
                        id: id.clone(),
                        sport_type,
                        bounds,
                    },
                );

                Ok(ActivityBoundsEntry {
                    activity_id: id,
                    bounds,
                })
            })?
            .collect::<Vec<_>>();
        // A malformed row is skipped; a corrupt page is the caller's to
        // quarantine, and swallowing it here would hide the one signal the
        // failover keys on.
        let mut entries = Vec::with_capacity(rows.len());
        for r in rows {
            match r {
                Ok(v) => entries.push(v),
                Err(e) if super::is_corruption_error(&e) => return Err(e),
                Err(e) => {
                    log::warn!("Skipping malformed row during metadata loading: {:?}", e);
                }
            }
        }

        self.spatial_index = RTree::bulk_load(entries);
        Ok(())
    }

    /// Load activity match info from the database.
    pub(super) fn load_activity_matches(&mut self) -> SqlResult<()> {
        self.activity_matches.clear();

        let mut stmt = self.db.prepare(
            "SELECT route_id, activity_id, match_percentage, direction FROM activity_matches",
        )?;

        let matches: Vec<(String, ActivityMatchInfo)> = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    ActivityMatchInfo {
                        activity_id: row.get(1)?,
                        match_percentage: row.get(2)?,
                        direction: {
                            let s: String = row.get(3)?;
                            s.parse().map_err(|_: ()| {
                                rusqlite::Error::FromSqlConversionFailure(
                                    3,
                                    Type::Text,
                                    Box::new(std::io::Error::new(
                                        std::io::ErrorKind::InvalidData,
                                        "invalid direction",
                                    )),
                                )
                            })?
                        },
                    },
                ))
            })?
            .filter_map(|r| match r {
                Ok(v) => Some(v),
                Err(e) => {
                    log::warn!(
                        "Skipping malformed row during activity match loading: {:?}",
                        e
                    );
                    None
                }
            })
            .collect();

        // Group by route_id
        for (route_id, match_info) in matches {
            self.activity_matches
                .entry(route_id)
                .or_default()
                .push(match_info);
        }

        Ok(())
    }

    /// Load activity metrics from the database.
    pub(super) fn load_activity_metrics(&mut self) -> SqlResult<()> {
        self.activity_metrics.clear();

        let mut stmt = self.db.prepare(
            "SELECT activity_id, name, date, distance, moving_time, elapsed_time,
                    elevation_gain, avg_hr, avg_power, sport_type,
                    training_load, ftp, power_zone_times, hr_zone_times
             FROM activity_metrics",
        )?;

        let metrics_iter = stmt.query_map([], |row| {
            Ok(ActivityMetrics {
                activity_id: row.get(0)?,
                name: row.get(1)?,
                date: row.get(2)?,
                distance: row.get(3)?,
                moving_time: row.get(4)?,
                elapsed_time: row.get(5)?,
                elevation_gain: row.get(6)?,
                avg_hr: row.get::<_, Option<i32>>(7)?.map(|v| v as u16),
                avg_power: row.get::<_, Option<i32>>(8)?.map(|v| v as u16),
                sport_type: row.get(9)?,
                training_load: row.get(10)?,
                ftp: row.get::<_, Option<i32>>(11)?.map(|v| v as u16),
                power_zone_times: zone_times(row.get::<_, Option<String>>(12)?),
                hr_zone_times: zone_times(row.get::<_, Option<String>>(13)?),
            })
        })?;

        for m in metrics_iter.flatten() {
            self.activity_metrics.insert(m.activity_id.clone(), m);
        }

        Ok(())
    }

    // ========================================================================
    // Activity Management
    // ========================================================================

    /// Add an activity with its GPS coordinates.
    pub fn add_activity(
        &mut self,
        id: String,
        coords: Vec<GpsPoint>,
        sport_type: String,
    ) -> SqlResult<()> {
        self.add_activities_batch(vec![(id, coords, sport_type)])
    }

    /// Add multiple activities in a single transaction with one R-tree rebuild.
    pub fn add_activities_batch(
        &mut self,
        activities: Vec<(String, Vec<GpsPoint>, String)>,
    ) -> SqlResult<()> {
        if activities.is_empty() {
            return Ok(());
        }

        // An add that REPLACES a previously-synced activity with a
        // DIFFERENT track is a GPS mutation the catalogue must re-derive. Detect
        // it here, before the store overwrites the old track, so the ids can be
        // evicted from the processed set after commit (below). A verbatim
        // re-ingest (identical points) is NOT a mutation and must stay
        // idempotent, so compare the stored track, not just the id.
        let mutated_ids: Vec<String> = activities
            .iter()
            .filter(|(id, coords, _)| {
                self.activity_metadata.contains_key(id)
                    && self
                        .load_gps_track_blob(id)
                        .map(|stored| !codec::track_matches(&stored, coords))
                        .unwrap_or(true)
            })
            .map(|(id, _, _)| id.clone())
            .collect();

        self.db.execute_batch("BEGIN IMMEDIATE")?;

        let mut all_bounds: Vec<Bounds> = Vec::with_capacity(activities.len());

        for (id, coords, sport_type) in &activities {
            let bounds = Bounds::from_points(coords).unwrap_or(Bounds {
                min_lat: 0.0,
                max_lat: 0.0,
                min_lng: 0.0,
                max_lng: 0.0,
            });

            let signature = RouteSignature::from_points(id, coords, &self.match_config);

            self.store_activity(id, sport_type, &bounds)?;
            self.store_gps_track(id, coords)?;
            if let Some(sig) = &signature {
                self.store_signature(id, sig)?;
                self.signature_cache.put(id.clone(), Arc::new(sig.clone()));
            }

            self.activity_metadata.insert(
                id.clone(),
                ActivityMetadata {
                    id: id.clone(),
                    sport_type: sport_type.clone(),
                    bounds,
                },
            );

            all_bounds.push(bounds);
        }

        self.db.execute_batch("COMMIT")?;

        self.rebuild_spatial_index();

        // Evict the mutated activities so the next detect re-analyses them
        // (their new tracks now count as unprocessed). No-op when nothing
        // changed, so a routine re-sync of unchanged activities stays free.
        if !mutated_ids.is_empty() {
            self.evict_processed_activity_ids(&mutated_ids);
        }

        self.groups_dirty = true;
        self.sections_dirty = true;

        if let Some(tiles_path) = self.heatmap_tiles_path.clone() {
            // Tile invalidation deletes PNGs on disk - slow filesystem I/O. Run it
            // on a detached thread so it does not happen while the engine write
            // lock is held (that would convoy every foreground read). The sweep
            // needs only the path and bounds, never `self`.
            let bounds_to_clear = all_bounds;
            let activity_count = activities.len();
            std::thread::spawn(move || {
                let config = crate::tiles::HeatmapConfig::default();
                let path = std::path::Path::new(&tiles_path);
                let margin = 0.001;
                let mut total_deleted = 0;
                for bounds in &bounds_to_clear {
                    total_deleted += crate::tiles::invalidate_tiles_in_bounds(
                        path,
                        bounds.min_lat - margin,
                        bounds.max_lat + margin,
                        bounds.min_lng - margin,
                        bounds.max_lng + margin,
                        config.min_zoom,
                        config.max_zoom,
                    );
                }
                // Marked after the sweep, never before. A mark set first can be
                // cleared by a generation run that finishes between the mark and
                // the delete, and nothing then redraws the ground the sweep took.
                crate::persistence::tiles::mark_tiles_dirty(&tiles_path);
                if total_deleted > 0 {
                    log::info!(
                        "[heatmap] Invalidated {} tiles for {} new activities",
                        total_deleted,
                        activity_count
                    );
                }
            });
        }

        Ok(())
    }

    /// Sections whose stored geometry is cut from this activity. An
    /// activity naming any of them is the reference the triple points at,
    /// so deleting it would leave that geometry unreadable.
    pub fn sections_referencing_activity(&self, id: &str) -> Vec<String> {
        self.db
            .prepare(
                "SELECT id FROM sections WHERE representative_activity_id = ?1
                 UNION
                 SELECT DISTINCT section_id FROM section_geometry WHERE rep_activity_id = ?1",
            )
            .and_then(|mut stmt| {
                stmt.query_map(params![id], |row| row.get::<_, String>(0))
                    .map(|rows| rows.filter_map(|r| r.ok()).collect())
            })
            .unwrap_or_default()
    }

    /// Add an activity from flat coordinate buffer.
    /// Remove an activity.
    pub fn remove_activity(&mut self, id: &str) -> SqlResult<()> {
        // Capture bounds before removal for heatmap tile invalidation
        let removed_bounds = self.activity_metadata.get(id).map(|m| m.bounds.clone());

        // One transaction for the whole removal. The cascade, a visit_count
        // update per section the activity was in, the identity blob and the
        // processed set were separate autocommits, so deleting an activity in
        // a dozen sections paid fifteen fsyncs under the engine lock. The tile
        // sweep stays outside it: that is filesystem work, not a row.
        self.db.execute_batch("BEGIN IMMEDIATE")?;
        match self.remove_activity_rows(id) {
            Ok(()) => self.db.execute_batch("COMMIT")?,
            Err(e) => {
                let _ = self.db.execute_batch("ROLLBACK");
                return Err(e);
            }
        }

        self.rebuild_spatial_index();

        // Invalidate heatmap tiles covering the removed activity
        // Add small margin (~100m) to catch edge tiles where GPS points bled into neighbors
        if let Some(ref bounds) = removed_bounds {
            if let Some(ref tiles_path) = self.heatmap_tiles_path {
                let config = crate::tiles::HeatmapConfig::default();
                let path = std::path::Path::new(tiles_path);
                let margin = 0.001; // ~111m at equator
                let deleted = crate::tiles::invalidate_tiles_in_bounds(
                    path,
                    bounds.min_lat - margin,
                    bounds.max_lat + margin,
                    bounds.min_lng - margin,
                    bounds.max_lng + margin,
                    config.min_zoom,
                    config.max_zoom,
                );
                if deleted > 0 {
                    log::info!(
                        "[heatmap] Invalidated {} tiles for removed activity {}",
                        deleted,
                        id
                    );
                    self.mark_heatmap_dirty();
                }
            }
        }

        Ok(())
    }

    /// Every row a removal touches, with no transaction of its own so the
    /// caller commits them together.
    fn remove_activity_rows(&mut self, id: &str) -> SqlResult<()> {
        // Sections this activity contributes to, captured before the cascade
        // removes its junction rows. The delete trigger fires on the cascade
        // and keeps visit_count current; the recompute below is a redundant
        // backstop, kept because it is cheap and self-healing.
        let affected_sections: Vec<String> = self
            .db
            .prepare("SELECT DISTINCT section_id FROM section_activities WHERE activity_id = ?")
            .and_then(|mut stmt| {
                stmt.query_map([id], |row| row.get::<_, String>(0))
                    .map(|rows| rows.filter_map(|r| r.ok()).collect())
            })
            .unwrap_or_default();

        // Remove from database (cascade deletes signature and track)
        self.db
            .execute("DELETE FROM activities WHERE id = ?", params![id])?;

        // Only four tables carry the foreign key, so the cascade reaches
        // `gps_tracks`, `signatures`, `time_streams` and `section_activities`
        // and no further. The rest were stranded, and `activity_bodies` is the
        // feed, so a removed activity went on rendering on the home screen
        // with its metrics intact. Deleted here rather than given foreign keys
        // of their own: this runs inside the caller's transaction, and eleven
        // new keys on live tables is a migration on every install.
        for table in ACTIVITY_KEYED_TABLES {
            self.db.execute(
                &format!("DELETE FROM {table} WHERE activity_id = ?1"),
                params![id],
            )?;
        }
        // The overlap cache holds a pair, so the activity is either side of it.
        self.db.execute(
            "DELETE FROM overlap_cache WHERE activity_a = ?1 OR activity_b = ?1",
            params![id],
        )?;

        // Recompute visit_count on the sections the removed activity was in.
        for sid in &affected_sections {
            let _ = self.db.execute(
                "UPDATE sections SET visit_count = (
                    SELECT COUNT(*) FROM section_activities
                    WHERE section_id = ? AND excluded = 0
                 ) WHERE id = ?",
                params![sid, sid],
            );
        }

        // Remove from memory
        self.activity_metadata.remove(id);
        self.signature_cache.pop(&id.to_string());
        self.consensus_cache.clear(); // Invalidate all consensus since groups may change

        self.groups_dirty = true;
        self.sections_dirty = true;

        // Drop the gone activity from the identity registry's carried sections and
        // the in-memory catalogue. The junction rows are cascade-deleted by the
        // activity_id foreign key, but the append-only fold would keep the activity
        // as a phantom member of a carried section, and the next detect's save would
        // then try to re-insert its junction row against a deleted activity -
        // aborting the whole apply on a foreign-key violation.
        self.section_identity_purge_activity(id);

        // The removed activity may have contributed to any section,
        // so the next detect must re-derive the catalogue without it. Its id is
        // now gone from `activity_metadata`, so it can never re-enter
        // `new_activity_ids`, a targeted eviction can't defeat the
        // no-new-activities short-circuit. Clear the whole processed set so the
        // next detect re-analyses the remaining library.
        self.clear_processed_activity_ids();

        Ok(())
    }

    /// Clear all data. Every table except `settings` empties, because this is
    /// the logout path and anything left behind is one athlete's data shown to
    /// the next. Nothing cascades here: only three tables carry an activity
    /// foreign key, so a table missing from this list survives indefinitely.
    /// `clear_wipes_every_table` holds the list to the schema.
    pub fn clear(&mut self) -> SqlResult<()> {
        self.db.execute_batch(
            "DELETE FROM section_activities;
             DELETE FROM sections;
             DELETE FROM section_history;
             DELETE FROM section_geometry;
             DELETE FROM section_pins;
             DELETE FROM section_intents;
             DELETE FROM section_catalogue_archive_members;
             DELETE FROM section_catalogue_archive;
             DELETE FROM identity_state;
             DELETE FROM route_groups;
             DELETE FROM route_names;
             DELETE FROM gps_tracks;
             DELETE FROM signatures;
             DELETE FROM activities;
             DELETE FROM activity_metrics;
             DELETE FROM activity_matches;
             DELETE FROM activity_bodies;
             DELETE FROM activity_indicators;
             DELETE FROM activity_heatmap;
             DELETE FROM time_streams;
             DELETE FROM stream_bodies;
             DELETE FROM activity_streams;
             DELETE FROM interval_bodies;
             DELETE FROM curve_bodies;
             DELETE FROM calendar_event_bodies;
             DELETE FROM exercise_sets;
             DELETE FROM fit_file_status;
             DELETE FROM wellness;
             DELETE FROM ftp_history;
             DELETE FROM pace_history;
             DELETE FROM overlap_cache;
             DELETE FROM processed_activities;
             DELETE FROM athlete_profile;
             DELETE FROM sport_settings;",
        )?;

        // Settings survive `clear()` on purpose, but four of them describe the
        // catalogue that was just deleted. Left behind, the next athlete to
        // sign in inherits the previous one's detector and a spent cutover
        // token, with no surface to change either.
        let mut stmt = self
            .db
            .prepare("DELETE FROM settings WHERE key IN (?, ?, ?, ?)")?;
        stmt.execute(rusqlite::params![
            super::cutover::CUTOVER_KEY,
            super::cutover::CUTOVER_DIFF_KEY,
            super::cutover::CUTOVER_PREVIOUS_CONFIG_KEY,
            super::settings_keys::SECTION_CONFIG_JSON,
        ])?;
        drop(stmt);

        self.activity_metadata.clear();
        self.activity_metrics.clear();
        self.spatial_index = RTree::new();
        self.signature_cache.clear();
        self.consensus_cache.clear();
        self.groups.clear();
        self.sections.clear();
        self.processed_activity_ids.clear();
        self.invalidate_evidence_cache();
        self.time_streams.clear();
        self.groups_dirty = false;
        self.sections_dirty = false;
        self.invalidate_perf_cache();

        // The registries are in memory as well as on disk. Without this the
        // deleted athlete's grounds stay live for the debounce window, so the
        // next athlete's first detect adopts their ids, names and tombstones.
        self.identity = super::sections::SectionIdentity::default();
        self.route_identity = super::route_identity::RouteIdentity::default();

        Ok(())
    }

    /// Clear detected route/section data, keeping GPS tracks, activities and
    /// user-defined sections intact. Used when route matching is toggled off
    /// to free section memory without losing the underlying GPS data (needed
    /// for heatmap).
    pub fn clear_routes_and_sections(&mut self) -> SqlResult<()> {
        wipe_derived_catalogue(&self.db)?;

        self.groups.clear();
        self.load_sections()?;
        self.consensus_cache.clear();
        self.invalidate_evidence_cache();
        self.groups_dirty = true;
        self.sections_dirty = true;
        self.invalidate_perf_cache();

        log::info!("[engine] Cleared routes and sections (GPS tracks preserved)");
        Ok(())
    }

    /// Empty what the engine can re-derive and keep what the athlete made.
    ///
    /// The catalogue side is the detection wipe's own predicate and the
    /// activity side is the retention delete's reference exclusion, so a
    /// hand-cut, trimmed or disabled section and the stream its geometry is
    /// cut from survive by construction. The ledger, pins, intents, names,
    /// identity registry and cutover archive are records and are not touched.
    /// Every spared section comes back memberless until the next detect
    /// re-matches it.
    pub fn clear_derived(&mut self) -> SqlResult<DerivedClear> {
        let tx = self.db.unchecked_transaction()?;
        let sections_removed = wipe_derived_catalogue(&tx)?;
        let removed_ids: Vec<String> = tx
            .prepare(&format!(
                "SELECT id FROM activities WHERE {REFERENCE_ACTIVITY_EXCLUSION}"
            ))?
            .query_map([], |row| row.get::<_, String>(0))?
            .filter_map(Result::ok)
            .collect();
        let activities_removed = tx.execute(
            &format!("DELETE FROM activities WHERE {REFERENCE_ACTIVITY_EXCLUSION}"),
            [],
        )?;
        let activities_kept: u32 =
            tx.query_row("SELECT COUNT(*) FROM activities", [], |row| row.get(0))?;
        tx.execute("DELETE FROM processed_activities", [])?;
        tx.commit()?;

        // A removed activity stays a phantom member of a carried section
        // otherwise, and the next apply would re-insert its junction row
        // against a foreign key that no longer resolves.
        for id in &removed_ids {
            self.section_identity_purge_activity(id);
        }
        self.processed_activity_ids.clear();
        self.invalidate_evidence_cache();
        self.signature_cache.clear();
        self.consensus_cache.clear();
        self.time_streams.clear();
        self.groups.clear();
        self.load_metadata()?;
        self.load_sections()?;
        self.groups_dirty = true;
        self.sections_dirty = true;
        self.invalidate_perf_cache();
        self.mark_heatmap_dirty();

        log::info!(
            "[engine] Cleared derived data: {} sections, {} activities removed, {} kept",
            sections_removed,
            activities_removed,
            activities_kept
        );
        Ok(DerivedClear {
            sections_removed: sections_removed as u32,
            activities_removed: activities_removed as u32,
            activities_kept,
        })
    }

    /// Force re-computation of route groups and sections.
    ///
    /// This should be called when historical activities are added (e.g., cache expansion)
    /// to improve route quality with the new data. The next call to `get_groups()` or
    /// `get_sections()` will trigger re-computation with the expanded dataset.
    ///
    /// # Example
    /// ```no_run
    /// # use veloqrs::persistence::PersistentEngine;
    /// # let mut engine: PersistentEngine = unsafe { std::mem::zeroed() };
    /// // User expanded cache from 90 days to 1 year
    /// engine.mark_for_recomputation();
    /// // Next access to groups/sections will re-compute with improved data
    /// let groups = engine.get_groups();
    /// ```
    pub fn mark_for_recomputation(&mut self) {
        if !self.groups_dirty && !self.sections_dirty {
            self.groups_dirty = true;
            self.sections_dirty = true;
            log::info!("veloqrs: [PersistentEngine] Marked for re-computation (cache expanded)");
        }
    }

    // ========================================================================
    // Database Storage
    // ========================================================================

    pub(super) fn store_activity(
        &self,
        id: &str,
        sport_type: &str,
        bounds: &Bounds,
    ) -> SqlResult<()> {
        // An upsert, never REPLACE: SQLite runs REPLACE as DELETE then INSERT,
        // and the delete cascades to every child row keyed on the activity
        // (section_activities, signatures, time_streams). A re-ingest must
        // update the row in place so those links and the unnamed columns
        // (date, name, distance) survive.
        //
        // `intervals_id` is the server's own id, kept beside the key rather
        // than as it. An activity that came from intervals.icu is keyed by
        // that id, so the column records it and the `024` backfill is true by
        // construction. A row the device minted carries NULL until an upload
        // answers, which is what makes it a ride nothing upstream has named.
        // `COALESCE` so a re-ingest never overwrites one already recorded.
        let intervals_id = (!is_local_activity_key(&id)).then(|| id.clone());
        self.db.execute(
            "INSERT INTO activities
                 (id, intervals_id, sport_type, min_lat, max_lat, min_lng, max_lng)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                 intervals_id = COALESCE(activities.intervals_id, excluded.intervals_id),
                 sport_type = excluded.sport_type,
                 min_lat = excluded.min_lat, max_lat = excluded.max_lat,
                 min_lng = excluded.min_lng, max_lng = excluded.max_lng",
            params![
                id,
                intervals_id,
                sport_type,
                bounds.min_lat,
                bounds.max_lat,
                bounds.min_lng,
                bounds.max_lng
            ],
        )?;
        Ok(())
    }

    /// Update activity metadata (date, name, distance, duration).
    /// Called after GPS sync to add metadata from intervals.icu API.
    pub fn update_activity_metadata(
        &self,
        id: &str,
        start_date: Option<i64>,
        name: Option<&str>,
        distance_meters: Option<f64>,
        duration_secs: Option<i64>,
    ) -> SqlResult<()> {
        self.db.execute(
            "UPDATE activities SET start_date = ?, name = ?, distance_meters = ?, duration_secs = ? WHERE id = ?",
            params![start_date, name, distance_meters, duration_secs, id],
        )?;
        Ok(())
    }

    pub(super) fn store_gps_track(&self, id: &str, coords: &[GpsPoint]) -> SqlResult<()> {
        let track_data = codec::serialize_track_points(coords);
        self.db.execute(
            "INSERT OR REPLACE INTO gps_tracks (activity_id, track_data, point_count)
             VALUES (?, ?, ?)",
            params![id, track_data, coords.len() as i64],
        )?;
        Ok(())
    }

    /// Put a fetched altitude series onto a stored track, leaving its
    /// coordinates exactly where they are.
    ///
    /// The stored blob is the device's only copy of the coordinates, and
    /// `store_gps_track` is `INSERT OR REPLACE`, so re-ingesting a whole track
    /// to add elevation replaces geometry the catalogue was derived from and
    /// evicts the activity from the processed set. Splicing writes the points
    /// already held, with their elevation filled in, so no coordinate moves and
    /// nothing is re-derived. `point_count` is unchanged and the provenance is
    /// set in the same statement, which is why this does not need the separate
    /// `record_elevation_state` pass that a replace does.
    ///
    /// Returns false, having written nothing, when there is no stored track or
    /// when the series is a different length from it. A different length means
    /// intervals.icu re-processed the activity, and the caller has to fetch the
    /// whole track instead.
    pub fn splice_track_elevation(&self, id: &str, elevations: &[f64]) -> SqlResult<bool> {
        let Some(points) = self.load_gps_track_from_db(id) else {
            return Ok(false);
        };
        if points.len() != elevations.len() {
            return Ok(false);
        }

        let spliced: Vec<GpsPoint> = points
            .iter()
            .zip(elevations)
            .map(|(p, ele)| {
                if ele.is_finite() {
                    GpsPoint::with_elevation(p.latitude, p.longitude, *ele)
                } else {
                    GpsPoint::new(p.latitude, p.longitude)
                }
            })
            .collect();

        self.db.execute(
            "UPDATE gps_tracks SET track_data = ?, elevation_state = ? WHERE activity_id = ?",
            params![
                codec::serialize_track_points(&spliced),
                i64::from(crate::persistence::ELEVATION_STATE_FETCHED),
                id
            ],
        )?;
        Ok(true)
    }

    /// Record elevation provenance for tracks that are already stored, where
    /// `state` is 0 unknown, 1 fetched, 2 unavailable upstream.
    ///
    /// Provenance cannot ride on the insert: the batch tuple is
    /// `(id, coords, sport)` with no room for it, and an activity whose
    /// upstream has no altitude still stores its points, so state 2 has nothing
    /// to attach to. This writer touches `elevation_state` alone, leaving the
    /// points blob, `point_count` and every activity column untouched, and an
    /// id with no track row updates nothing rather than minting a phantom.
    ///
    /// `store_gps_track` writes with `INSERT OR REPLACE`, which resets the
    /// column to its default, so a re-ingest must record state AFTER storing
    /// the track.
    ///
    /// One statement per chunk, grouped by state, chunked like `tracks_batch`
    /// to stay under SQLite's parameter limit.
    pub fn record_elevation_state(&self, states: &[(String, u8)]) -> SqlResult<()> {
        const CHUNK: usize = 500;
        let mut by_state: BTreeMap<u8, Vec<&String>> = BTreeMap::new();
        for (id, state) in states {
            by_state.entry(*state).or_default().push(id);
        }

        for (state, ids) in by_state {
            let state = i64::from(state);
            for chunk in ids.chunks(CHUNK) {
                let placeholders = std::iter::repeat_n("?", chunk.len())
                    .collect::<Vec<_>>()
                    .join(",");
                let sql = format!(
                    "UPDATE gps_tracks SET elevation_state = ? WHERE activity_id IN ({})",
                    placeholders
                );
                let mut params_vec: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(chunk.len() + 1);
                params_vec.push(&state);
                params_vec.extend(chunk.iter().map(|s| *s as &dyn rusqlite::ToSql));
                self.db.execute(&sql, params_vec.as_slice())?;
            }
        }
        Ok(())
    }

    /// How many stored tracks sit in each elevation provenance state. Any value
    /// outside the known set counts as unknown, which is the honest reading of
    /// a state this build does not understand.
    pub fn elevation_state_counts(&self) -> SqlResult<ElevationStateCounts> {
        let mut stmt = self
            .db
            .prepare("SELECT elevation_state, COUNT(*) FROM gps_tracks GROUP BY elevation_state")?;
        let rows = stmt.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))?;

        let mut counts = ElevationStateCounts::default();
        for row in rows {
            let (state, n) = row?;
            let n = n.max(0) as u64;
            match u8::try_from(state).unwrap_or(ELEVATION_STATE_UNKNOWN) {
                ELEVATION_STATE_FETCHED => counts.fetched += n,
                ELEVATION_STATE_UNAVAILABLE => counts.unavailable += n,
                _ => counts.unknown += n,
            }
        }
        Ok(counts)
    }

    pub(super) fn store_signature(&self, id: &str, sig: &RouteSignature) -> SqlResult<()> {
        // One codec for stored GPS, ~3 B/point against postcard's 25. Every
        // earlier container still reads, so no bulk rewrite runs: a row moves
        // when its activity is next stored.
        let points_blob = codec::serialize_track_points(&sig.points);
        self.db.execute(
            "INSERT OR REPLACE INTO signatures (activity_id, points, start_point_lat, start_point_lng, end_point_lat, end_point_lng, total_distance, point_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                id,
                points_blob,
                sig.start_point.latitude,
                sig.start_point.longitude,
                sig.end_point.latitude,
                sig.end_point.longitude,
                sig.total_distance,
                sig.points.len() as i64
            ],
        )?;
        Ok(())
    }

    pub(super) fn rebuild_spatial_index(&mut self) {
        let entries: Vec<ActivityBoundsEntry> = self
            .activity_metadata
            .values()
            .map(|m| ActivityBoundsEntry {
                activity_id: m.id.clone(),
                bounds: m.bounds,
            })
            .collect();
        self.spatial_index = RTree::bulk_load(entries);
    }

    // ========================================================================
    // Queries
    // ========================================================================

    /// Get activity count.
    pub fn activity_count(&self) -> usize {
        self.activity_metadata.len()
    }
    /// Get all activity IDs.
    /// Flag the catalogue as owing a detect. Used where a caller knows the
    /// pool moved under a run that has already reported its own result.
    pub fn mark_sections_dirty(&mut self) {
        self.sections_dirty = true;
    }

    /// Ids this athlete's sync wrote, as the server names them, paired with
    /// the local key.
    ///
    /// Scoped three ways, and each one is a library wiped if it is dropped. A
    /// row with no `intervals_id` was never upstream, so the server not naming
    /// it says nothing. Demo rows are seeded on the device and no census
    /// carries them. And the comparison is against the server's own id, never
    /// against the key, or a row the device minted would read as deleted the
    /// moment it was stored.
    pub fn census_candidates(&self) -> Vec<(String, String)> {
        let mut stmt = match self.db.prepare(
            "SELECT id, intervals_id FROM activities
             WHERE intervals_id IS NOT NULL
               AND intervals_id NOT LIKE 'demo-test-%'
               AND intervals_id NOT LIKE 'demo-stress-%'
               AND id NOT LIKE 'demo-test-%'
               AND id NOT LIKE 'demo-stress-%'",
        ) {
            Ok(stmt) => stmt,
            Err(e) => {
                log::warn!("veloqrs: [census] candidate read failed: {}", e);
                return Vec::new();
            }
        };
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        });
        match rows {
            Ok(rows) => rows.flatten().collect(),
            Err(e) => {
                log::warn!("veloqrs: [census] candidate read failed: {}", e);
                Vec::new()
            }
        }
    }

    /// Remove every stored activity the census does not carry, re-anchoring
    /// any section that pointed at one first. Returns the local keys removed.
    ///
    /// **`upstream` must be a census that succeeded whole.** A truncated or
    /// empty list is indistinguishable from an athlete who deleted everything,
    /// and a blind difference then wipes the library, so an empty one removes
    /// nothing and says so.
    pub fn reconcile_against_census(&mut self, upstream: &[String]) -> Vec<String> {
        if upstream.is_empty() {
            log::info!("veloqrs: [census] empty census, nothing reconciled");
            return Vec::new();
        }
        let named: std::collections::HashSet<&str> = upstream.iter().map(String::as_str).collect();
        let vanished: Vec<String> = self
            .census_candidates()
            .into_iter()
            .filter(|(_, intervals_id)| !named.contains(intervals_id.as_str()))
            .map(|(key, _)| key)
            .collect();
        if vanished.is_empty() {
            return Vec::new();
        }

        let mut removed = Vec::with_capacity(vanished.len());
        for key in vanished {
            // A section's line is a triple into one stored stream, so the
            // reference moves before the row does: `section_activities`
            // cascades on the activity and the candidate list would go with it.
            match self.sections_anchored_to(&key) {
                anchored if anchored.is_empty() => {}
                anchored => {
                    let mut stranded = false;
                    for section_id in anchored {
                        match self.reanchor_section_reference(&section_id, &key) {
                            Ok(Some(_)) => {}
                            Ok(None) => stranded = true,
                            Err(e) => {
                                log::warn!(
                                    "veloqrs: [census] re-anchor of {} failed: {}",
                                    section_id,
                                    e
                                );
                                stranded = true;
                            }
                        }
                    }
                    if stranded {
                        // Its only visit was this activity, so there is nothing
                        // to re-cut against. Today's behaviour stands: the row
                        // is protected and the delete is skipped.
                        log::info!(
                            "veloqrs: [census] {} left upstream but a section has no other member, kept",
                            key
                        );
                        continue;
                    }
                }
            }
            match self.remove_activity(&key) {
                Ok(()) => removed.push(key),
                Err(e) => log::warn!("veloqrs: [census] removal of {} failed: {}", key, e),
            }
        }
        if !removed.is_empty() {
            log::info!(
                "veloqrs: [census] {} activities left intervals.icu and were removed",
                removed.len()
            );
        }
        removed
    }

    /// Sections whose line was sliced from this activity.
    pub fn sections_anchored_to(&self, activity_id: &str) -> Vec<String> {
        let mut stmt = match self
            .db
            .prepare("SELECT id FROM sections WHERE source_activity_id = ?")
        {
            Ok(stmt) => stmt,
            Err(_) => return Vec::new(),
        };
        let rows = stmt.query_map(params![activity_id], |row| row.get::<_, String>(0));
        match rows {
            Ok(rows) => rows.flatten().collect(),
            Err(_) => Vec::new(),
        }
    }

    /// Record the id intervals.icu gave a ride the device keyed itself, after
    /// the upload has landed. Returns whether anything was written.
    ///
    /// One `UPDATE`, and it is the only writer of the column outside ingest.
    /// It writes only where the column is still NULL, so a retried upload that
    /// lands twice, or an answer arriving after a sync has already matched the
    /// ride, leaves the first id standing rather than repointing the row at a
    /// second one. A key nothing stores is not a failure either: the recording
    /// can be deleted between the upload starting and the server answering.
    pub fn record_upload(&mut self, activity_id: &str, intervals_id: &str) -> SqlResult<bool> {
        let changed = self.db.execute(
            "UPDATE activities SET intervals_id = ?
             WHERE id = ? AND intervals_id IS NULL",
            params![intervals_id, activity_id],
        )?;
        Ok(changed > 0)
    }

    /// The intervals.icu id for a stored activity, or None for one the server
    /// has never seen.
    ///
    /// Every URL that names an activity upstream is built from this, never
    /// from the key: the two are equal for every row today and the whole
    /// point of the column is that they stop being.
    pub fn intervals_id(&self, activity_id: &str) -> Option<String> {
        self.db
            .query_row(
                "SELECT intervals_id FROM activities WHERE id = ?",
                params![activity_id],
                |row| row.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten()
    }

    /// The intervals.icu id for each of `activity_ids` that has one, keyed by
    /// the local id. One query, so a batch of URLs never takes the engine lock
    /// per activity.
    pub fn intervals_ids(
        &self,
        activity_ids: &[String],
    ) -> std::collections::HashMap<String, String> {
        let mut out = std::collections::HashMap::with_capacity(activity_ids.len());
        if activity_ids.is_empty() {
            return out;
        }
        let placeholders = vec!["?"; activity_ids.len()].join(",");
        let sql = format!(
            "SELECT id, intervals_id FROM activities
             WHERE intervals_id IS NOT NULL AND id IN ({placeholders})"
        );
        let Ok(mut stmt) = self.db.prepare(&sql) else {
            return out;
        };
        let params = rusqlite::params_from_iter(activity_ids.iter());
        if let Ok(rows) = stmt.query_map(params, |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }) {
            for row in rows.flatten() {
                out.insert(row.0, row.1);
            }
        }
        out
    }

    /// The local key for one activity the server named, or None when no
    /// stored row claims it.
    pub fn activity_id_for_intervals_id(&self, intervals_id: &str) -> Option<String> {
        self.db
            .query_row(
                "SELECT id FROM activities WHERE intervals_id = ?",
                params![intervals_id],
                |row| row.get::<_, String>(0),
            )
            .ok()
    }

    /// The local key for each activity the server named, keyed by the server's
    /// own id, for those a stored row claims.
    ///
    /// The sync matches on this, so a row the device minted and later uploaded
    /// is found rather than stored a second time. A server id nothing claims
    /// is absent, and the caller then uses it as the key, which is what every
    /// row an older build stored already did.
    pub fn local_ids_for_intervals_ids(
        &self,
        intervals_ids: &[String],
    ) -> std::collections::HashMap<String, String> {
        let mut out = std::collections::HashMap::with_capacity(intervals_ids.len());
        if intervals_ids.is_empty() {
            return out;
        }
        let placeholders = vec!["?"; intervals_ids.len()].join(",");
        let sql = format!(
            "SELECT intervals_id, id FROM activities
             WHERE intervals_id IN ({placeholders})"
        );
        let Ok(mut stmt) = self.db.prepare(&sql) else {
            return out;
        };
        let params = rusqlite::params_from_iter(intervals_ids.iter());
        if let Ok(rows) = stmt.query_map(params, |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        }) {
            for row in rows.flatten() {
                out.insert(row.0, row.1);
            }
        }
        out
    }

    pub fn get_activity_ids(&self) -> Vec<String> {
        self.activity_metadata.keys().cloned().collect()
    }

    /// Get activity IDs filtered by sport type.
    pub fn get_activity_ids_by_sport(&self, sport_type: &str) -> Vec<String> {
        self.activity_metadata
            .iter()
            .filter(|(_, meta)| meta.sport_type == sport_type)
            .map(|(id, _)| id.clone())
            .collect()
    }

    /// Check if an activity exists.
    pub fn has_activity(&self, id: &str) -> bool {
        self.activity_metadata.contains_key(id)
    }

    /// Query activities within a viewport.
    pub fn query_viewport(&self, bounds: &Bounds) -> Vec<String> {
        let search_bounds = AABB::from_corners(
            [bounds.min_lng, bounds.min_lat],
            [bounds.max_lng, bounds.max_lat],
        );

        self.spatial_index
            .locate_in_envelope_intersecting(&search_bounds)
            .map(|b| b.activity_id.clone())
            .collect()
    }

    /// Get a signature, loading from DB if not cached.
    pub fn get_signature(&mut self, id: &str) -> Option<Arc<RouteSignature>> {
        if let Some(sig) = self.signature_cache.get(&id.to_string()) {
            return Some(Arc::clone(sig));
        }

        let sig = self.load_signature_from_db(id)?;
        let arc = Arc::new(sig);
        self.signature_cache.put(id.to_string(), Arc::clone(&arc));
        Some(arc)
    }

    /// Load a stored signature. A corrupt points blob names itself in the log
    /// before the read gives up, so route grouping never drops an activity in
    /// silence.
    fn load_signature_from_db(&self, id: &str) -> Option<RouteSignature> {
        let mut stmt = match self
            .db
            .prepare(
                "SELECT points, start_point_lat, start_point_lng, end_point_lat, end_point_lng, total_distance
                 FROM signatures WHERE activity_id = ?",
            ) {
            Ok(s) => s,
            Err(e) => {
                log::warn!("[load_signature_from_db] activity {}: query failed: {}", id, e);
                return None;
            }
        };

        let row = stmt
            .query_row(params![id], |row| {
                Ok((
                    row.get::<_, Vec<u8>>(0)?,
                    GpsPoint::new(row.get(1)?, row.get(2)?),
                    GpsPoint::new(row.get(3)?, row.get(4)?),
                    row.get::<_, f64>(5)?,
                ))
            })
            .optional();

        let (points_blob, start_point, end_point, total_distance) = match row {
            Ok(Some(values)) => values,
            Ok(None) => return None,
            Err(e) => {
                log::warn!(
                    "[load_signature_from_db] activity {}: row read failed: {}",
                    id,
                    e
                );
                return None;
            }
        };

        let points =
            TrackRead::from_blob(&points_blob).into_option("load_signature_from_db", id)?;

        let bounds = Bounds::from_points(&points).unwrap_or(Bounds {
            min_lat: 0.0,
            max_lat: 0.0,
            min_lng: 0.0,
            max_lng: 0.0,
        });
        let center = bounds.center();

        Some(RouteSignature {
            activity_id: id.to_string(),
            points,
            total_distance,
            start_point,
            end_point,
            bounds,
            center,
        })
    }

    /// Get all map signatures in a single query.
    /// Returns lightweight flat-coord signatures for map rendering.
    /// Bypasses LRU cache since we want all rows at once.
    pub fn get_all_map_signatures(&self) -> Vec<crate::ffi_types::FfiMapSignature> {
        let mut stmt = match self
            .db
            .prepare("SELECT activity_id, points FROM signatures")
        {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        let rows = match stmt.query_map([], |row| {
            let activity_id: String = row.get(0)?;
            let points_blob: Vec<u8> = row.get(1)?;
            Ok((activity_id, points_blob))
        }) {
            Ok(r) => r,
            Err(_) => return Vec::new(),
        };

        let mut result = Vec::new();
        for row in rows {
            let (activity_id, points_blob) = match row {
                Ok(r) => r,
                Err(_) => continue,
            };
            let Some(points) =
                TrackRead::from_blob(&points_blob).into_option("map_signatures", &activity_id)
            else {
                continue;
            };
            if points.is_empty() {
                continue;
            }

            // Compute center from bounds
            let bounds = Bounds::from_points(&points).unwrap_or(Bounds {
                min_lat: 0.0,
                max_lat: 0.0,
                min_lng: 0.0,
                max_lng: 0.0,
            });
            let center = bounds.center();

            result.push(crate::ffi_types::FfiMapSignature {
                activity_id,
                encoded_coords: crate::coords::encode(&points),
                center_lat: center.latitude,
                center_lng: center.longitude,
            });
        }
        result
    }

    /// Get map signatures for a specific set of activity IDs.
    /// Avoids deserializing the whole `signatures` table when only a handful
    /// of activities are needed (e.g. section-detail map overlay).
    pub fn get_map_signatures_for_ids(
        &self,
        ids: &[String],
    ) -> Vec<crate::ffi_types::FfiMapSignature> {
        if ids.is_empty() {
            return Vec::new();
        }

        let placeholders = std::iter::repeat("?")
            .take(ids.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT activity_id, points FROM signatures WHERE activity_id IN ({})",
            placeholders
        );
        let mut stmt = match self.db.prepare(&sql) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };

        let params_vec: Vec<&dyn rusqlite::ToSql> =
            ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        let rows = match stmt.query_map(params_vec.as_slice(), |row| {
            let activity_id: String = row.get(0)?;
            let points_blob: Vec<u8> = row.get(1)?;
            Ok((activity_id, points_blob))
        }) {
            Ok(r) => r,
            Err(_) => return Vec::new(),
        };

        let mut result = Vec::new();
        for row in rows {
            let (activity_id, points_blob) = match row {
                Ok(r) => r,
                Err(_) => continue,
            };
            let Some(points) =
                TrackRead::from_blob(&points_blob).into_option("map_signatures", &activity_id)
            else {
                continue;
            };
            if points.is_empty() {
                continue;
            }

            // Compute center from bounds
            let bounds = Bounds::from_points(&points).unwrap_or(Bounds {
                min_lat: 0.0,
                max_lat: 0.0,
                min_lng: 0.0,
                max_lng: 0.0,
            });
            let center = bounds.center();

            result.push(crate::ffi_types::FfiMapSignature {
                activity_id,
                encoded_coords: crate::coords::encode(&points),
                center_lat: center.latitude,
                center_lng: center.longitude,
            });
        }
        result
    }

    // ========================================================================
    // Track reads
    // ========================================================================

    /// Read one stored track, distinguishing an activity with no row from a row
    /// that did not decode. The single decode path: every other track read on
    /// this engine goes through here.
    pub fn track(&self, activity_id: &str) -> TrackRead {
        let mut stmt = match self
            .db
            .prepare("SELECT track_data FROM gps_tracks WHERE activity_id = ?")
        {
            Ok(s) => s,
            Err(e) => return TrackRead::Corrupt(format!("track query failed: {}", e)),
        };
        let blob: Option<Vec<u8>> = match stmt
            .query_row(params![activity_id], |row| row.get::<_, Vec<u8>>(0))
            .optional()
        {
            Ok(b) => b,
            Err(e) => return TrackRead::Corrupt(format!("track row read failed: {}", e)),
        };
        match blob {
            Some(bytes) => TrackRead::from_blob(&bytes),
            None => TrackRead::Missing,
        }
    }

    /// Read many tracks in one query per chunk. Ids with no row come back as
    /// `Missing`, and the result carries one entry per requested id in the
    /// order requested, repeated ids included. A SQL failure is reported as
    /// `Corrupt` for every id it covers, the same classification [`track`]
    /// gives the same event, so a readable row is never reported as an
    /// activity that was never synced.
    ///
    /// [`track`]: Self::track
    pub fn tracks_batch(&self, ids: &[String]) -> Vec<(String, TrackRead)> {
        // SQLite's default parameter limit is 999; stay well under it.
        const CHUNK: usize = 500;
        let mut decoded: HashMap<String, TrackRead> = HashMap::with_capacity(ids.len());

        for chunk in ids.chunks(CHUNK) {
            let placeholders = std::iter::repeat_n("?", chunk.len())
                .collect::<Vec<_>>()
                .join(",");
            let sql = format!(
                "SELECT activity_id, track_data FROM gps_tracks WHERE activity_id IN ({})",
                placeholders
            );
            let mut stmt = match self.db.prepare(&sql) {
                Ok(s) => s,
                Err(e) => {
                    fail_chunk(&mut decoded, chunk, &format!("track query failed: {}", e));
                    continue;
                }
            };
            let params_vec: Vec<&dyn rusqlite::ToSql> =
                chunk.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
            let rows = stmt.query_map(params_vec.as_slice(), |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
            });
            let rows = match rows {
                Ok(r) => r,
                Err(e) => {
                    fail_chunk(&mut decoded, chunk, &format!("track query failed: {}", e));
                    continue;
                }
            };
            let mut row_failures = 0usize;
            for row in rows {
                match row {
                    Ok((id, bytes)) => {
                        let read = TrackRead::from_blob(&bytes);
                        if let TrackRead::Corrupt(reason) = &read {
                            log::warn!("[tracks_batch] activity {}: corrupt track, {}", id, reason);
                        }
                        decoded.insert(id, read);
                    }
                    Err(e) => {
                        row_failures += 1;
                        log::warn!("[tracks_batch] row read failed: {}", e);
                    }
                }
            }
            // The failed rows carry no id, so every id the chunk did not
            // account for is unresolved rather than known to be absent.
            if row_failures > 0 {
                fail_chunk(
                    &mut decoded,
                    chunk,
                    &format!(
                        "track row read failed for {} rows in this batch",
                        row_failures
                    ),
                );
            }
        }

        ids.iter()
            .map(|id| {
                let read = decoded.get(id).cloned().unwrap_or(TrackRead::Missing);
                (id.clone(), read)
            })
            .collect()
    }

    /// Visit every stored track once, streaming. The callback borrows the
    /// points for the length of the call and the decoded buffer is dropped
    /// before the next row, so the whole library is never resident at once.
    /// A corrupt row is logged and visited with an empty slice. The returned
    /// [`TrackWalk`] counts what the walk saw and what it lost, so a caller
    /// can tell a short result from a complete one.
    pub fn for_each_track(&self, mut f: impl FnMut(&str, &[GpsPoint])) -> TrackWalk {
        let mut walk = TrackWalk::default();
        let mut stmt = match self
            .db
            .prepare("SELECT activity_id, track_data FROM gps_tracks")
        {
            Ok(s) => s,
            Err(e) => {
                log::error!("[for_each_track] prepare failed: {}", e);
                walk.failed += 1;
                return walk;
            }
        };
        let mut rows = match stmt.query([]) {
            Ok(r) => r,
            Err(e) => {
                log::error!("[for_each_track] query failed: {}", e);
                walk.failed += 1;
                return walk;
            }
        };
        loop {
            // rusqlite resets the statement on a row error, so the next call
            // ends the walk. The count is what tells the caller it was short.
            let row = match rows.next() {
                Ok(Some(row)) => row,
                Ok(None) => break,
                Err(e) => {
                    log::warn!("[for_each_track] row read failed: {}", e);
                    walk.failed += 1;
                    continue;
                }
            };
            let (id, blob): (String, Vec<u8>) = match (row.get(0), row.get(1)) {
                (Ok(id), Ok(blob)) => (id, blob),
                (Err(e), _) | (_, Err(e)) => {
                    log::warn!("[for_each_track] column read failed: {}", e);
                    walk.failed += 1;
                    continue;
                }
            };
            walk.visited += 1;
            match TrackRead::from_blob(&blob) {
                TrackRead::Present(points) => f(&id, &points),
                TrackRead::Missing => f(&id, &[]),
                TrackRead::Corrupt(reason) => {
                    walk.corrupt += 1;
                    log::warn!(
                        "[for_each_track] activity {}: corrupt track, {}",
                        id,
                        reason
                    );
                    f(&id, &[]);
                }
            }
        }
        walk
    }

    /// Get GPS track from database (on-demand, never cached).
    pub fn get_gps_track(&self, id: &str) -> Option<Vec<GpsPoint>> {
        self.track(id).into_option("get_gps_track", id)
    }

    /// Load original GPS track from database (separate function to avoid borrow issues)
    /// The stored bytes, undecoded. The mutation check compares encodings
    /// rather than points, so it must not go through a decode that would erase
    /// which container the row is in.
    fn load_gps_track_blob(&self, activity_id: &str) -> Option<Vec<u8>> {
        self.db
            .query_row(
                "SELECT track_data FROM gps_tracks WHERE activity_id = ?",
                params![activity_id],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .ok()
    }

    pub(super) fn load_gps_track_from_db(&self, activity_id: &str) -> Option<Vec<GpsPoint>> {
        self.track(activity_id)
            .into_option("load_gps_track_from_db", activity_id)
    }

    // ========================================================================
    // Activity Bodies (untyped intervals.icu payloads)
    // ========================================================================

    /// Store the untyped body for each activity, keyed by id. Idempotent: a
    /// re-sync overwrites the day's payload in place.
    pub fn upsert_activity_bodies(&mut self, rows: &[(String, i64, String)]) -> SqlResult<()> {
        if rows.is_empty() {
            return Ok(());
        }
        let tx = self.db.transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO activity_bodies (activity_id, date, raw, updated_at)
                 VALUES (?, ?, ?, strftime('%s', 'now'))
                 ON CONFLICT(activity_id) DO UPDATE SET
                    date = excluded.date,
                    raw = excluded.raw,
                    updated_at = excluded.updated_at",
            )?;
            for (activity_id, date, raw) in rows {
                stmt.execute(params![activity_id, date, raw])?;
            }
        }
        tx.commit()
    }

    /// Untyped activity bodies over an inclusive timestamp window, newest
    /// first to match the order intervals.icu returns and the feed renders.
    pub fn get_activity_bodies(&self, oldest_ts: i64, newest_ts: i64) -> SqlResult<Vec<String>> {
        let mut stmt = self.db.prepare(
            "SELECT raw FROM activity_bodies
             WHERE date >= ? AND date <= ?
             ORDER BY date DESC",
        )?;
        let rows = stmt.query_map(params![oldest_ts, newest_ts], |r| r.get::<_, String>(0))?;
        rows.collect()
    }

    // ========================================================================
    // Time Streams (for section performance calculations)
    // ========================================================================

    /// Store time stream to database.
    pub(super) fn store_time_stream(&self, activity_id: &str, times: &[u32]) -> SqlResult<()> {
        let times_blob = codec::serialize(times)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(e.into()))?;
        self.db.execute(
            "INSERT OR REPLACE INTO time_streams (activity_id, times, point_count)
             VALUES (?, ?, ?)",
            params![activity_id, times_blob, times.len() as i64],
        )?;
        Ok(())
    }

    /// Load time stream from database.
    pub(super) fn load_time_stream(&self, activity_id: &str) -> Option<Vec<u32>> {
        let mut stmt = self
            .db
            .prepare("SELECT times FROM time_streams WHERE activity_id = ?")
            .ok()?;

        stmt.query_row(params![activity_id], |row| {
            let times_blob: Vec<u8> = row.get(0)?;
            Ok(codec::deserialize(&times_blob)
                .map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, Type::Blob, e.into()))?)
        })
        .ok()
    }

    /// Check which activities are missing time streams (not in memory or SQLite).
    /// Returns list of activity IDs that need to be fetched from the API.
    pub fn get_activities_missing_time_streams(&self, activity_ids: &[String]) -> Vec<String> {
        if activity_ids.is_empty() {
            return Vec::new();
        }

        // First filter out any that are already in memory
        let not_in_memory: Vec<&String> = activity_ids
            .iter()
            .filter(|id| !self.time_streams.contains(*id))
            .collect();

        if not_in_memory.is_empty() {
            return Vec::new();
        }

        // Check SQLite for the remaining ones
        let placeholders: Vec<&str> = not_in_memory.iter().map(|_| "?").collect();
        let query = format!(
            "SELECT activity_id FROM time_streams WHERE activity_id IN ({})",
            placeholders.join(",")
        );

        let mut stmt = match self.db.prepare(&query) {
            Ok(s) => s,
            Err(_) => {
                // On error, return all that aren't in memory
                return not_in_memory.into_iter().cloned().collect();
            }
        };

        // Bind all activity IDs as parameters
        let params: Vec<&dyn rusqlite::ToSql> = not_in_memory
            .iter()
            .map(|s| *s as &dyn rusqlite::ToSql)
            .collect();

        let cached_in_sqlite: std::collections::HashSet<String> = stmt
            .query_map(params.as_slice(), |row| row.get::<_, String>(0))
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default();

        // Return IDs that are NOT in memory AND NOT in SQLite
        not_in_memory
            .into_iter()
            .filter(|id| !cached_in_sqlite.contains(*id))
            .cloned()
            .collect()
    }

    /// Ensure time stream is loaded into memory (from SQLite if needed).
    /// Returns true if the time stream is available.
    pub(super) fn ensure_time_stream_loaded(&mut self, activity_id: &str) -> bool {
        // Already in memory?
        if self.time_streams.contains(activity_id) {
            return true;
        }
        // Try to load from SQLite
        if let Some(times) = self.load_time_stream(activity_id) {
            self.time_streams.put(activity_id.to_string(), times);
            return true;
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::super::commit_counter;
    use super::*;

    fn engine_with_activity_in_sections(sections: usize) -> PersistentEngine {
        let mut engine = PersistentEngine::in_memory().unwrap();
        let coords = vec![
            GpsPoint {
                latitude: 46.2,
                longitude: 7.3,
                elevation: None,
            },
            GpsPoint {
                latitude: 46.21,
                longitude: 7.31,
                elevation: None,
            },
        ];
        engine
            .add_activity("a1".to_string(), coords, "Ride".to_string())
            .unwrap();
        for s in 0..sections {
            let sid = format!("s{s}");
            engine
                .db
                .execute(
                    "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                        distance_meters, is_user_defined, version, created_at,
                        bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
                     VALUES (?, 'auto', ?, 'Ride', '[]', 3000.0, 0, 1, '2026-01-01T00:00:00Z',
                        46.2, 46.21, 7.3, 7.31)",
                    params![sid, format!("Section {s}")],
                )
                .unwrap();
            engine
                .db
                .execute(
                    "INSERT INTO section_activities (section_id, activity_id, direction,
                        start_index, end_index, distance_meters, lap_time, lap_pace)
                     VALUES (?, 'a1', 'same', 0, 100, 3000.0, 600.0, 5.0)",
                    params![sid],
                )
                .unwrap();
        }
        engine
    }

    /// A deletion ran the cascade, then one visit_count update per section the
    /// activity was in, then the registry and processed-set writes, each its
    /// own autocommit under the engine lock.
    #[test]
    fn removing_an_activity_is_one_commit() {
        let mut engine = engine_with_activity_in_sections(12);
        let commits = commit_counter::watch(&engine);

        engine.remove_activity("a1").unwrap();

        assert_eq!(commit_counter::count(&commits), 1);
        assert!(!engine.has_activity("a1"));
        let junction: i64 = engine
            .db
            .query_row("SELECT COUNT(*) FROM section_activities", [], |r| r.get(0))
            .unwrap();
        assert_eq!(junction, 0);
        let visits: i64 = engine
            .db
            .query_row("SELECT SUM(visit_count) FROM sections", [], |r| r.get(0))
            .unwrap();
        assert_eq!(visits, 0);
    }

    /// An activity in no section still commits once, and removing an id that
    /// was never there writes nothing to roll back.
    #[test]
    fn removing_an_activity_in_no_section_is_one_commit() {
        let mut engine = engine_with_activity_in_sections(0);
        let commits = commit_counter::watch(&engine);

        engine.remove_activity("a1").unwrap();

        assert_eq!(commit_counter::count(&commits), 1);
        assert!(!engine.has_activity("a1"));
    }

    /// Every table an activity id reaches, with the column that holds it.
    /// `ftp_history` is the athlete's FTP by date and carries the activity
    /// only as provenance, so it is here as a nullable column, not a key.
    /// `overlap_cache` holds a pair, so an activity is either side of it.
    const ACTIVITY_KEYED: &[(&str, &str)] = &[
        ("activity_bodies", "activity_id"),
        ("activity_metrics", "activity_id"),
        ("activity_indicators", "activity_id"),
        ("activity_matches", "activity_id"),
        ("activity_streams", "activity_id"),
        ("stream_bodies", "activity_id"),
        ("interval_bodies", "activity_id"),
        ("exercise_sets", "activity_id"),
        ("fit_file_status", "activity_id"),
        ("ftp_history", "activity_id"),
    ];

    fn seed_activity_keyed_rows(engine: &mut PersistentEngine, id: &str) {
        let seeds: &[&str] = &[
            "INSERT INTO activity_bodies (activity_id, date, raw) VALUES (?1, 0, '{}')",
            "INSERT INTO activity_metrics (activity_id, name, date, distance, moving_time,
                 elapsed_time, elevation_gain, sport_type)
             VALUES (?1, 'n', 0, 0, 0, 0, 0, 'Ride')",
            "INSERT INTO activity_indicators
                 (activity_id, indicator_type, target_id, direction, computed_at)
             VALUES (?1, 'section_pr', 't', 'same', 0)",
            "INSERT INTO activity_matches (route_id, activity_id, match_percentage, direction)
             VALUES ('r1', ?1, 1.0, 'same')",
            "INSERT INTO activity_streams (activity_id, kind, data, sample_count)
             VALUES (?1, 'watts', X'00', 1)",
            "INSERT INTO stream_bodies (activity_id, types, raw) VALUES (?1, 'watts', '{}')",
            "INSERT INTO interval_bodies (activity_id, raw) VALUES (?1, '{}')",
            "INSERT INTO exercise_sets (activity_id, set_order, exercise_category, set_type)
             VALUES (?1, 0, 0, 0)",
            "INSERT INTO fit_file_status (activity_id, processed_at) VALUES (?1, 0)",
            "INSERT INTO ftp_history (date, ftp, activity_id) VALUES ((SELECT COUNT(*) FROM ftp_history), 250, ?1)",
            "INSERT INTO overlap_cache (activity_a, activity_b, has_overlap, computed_at)
             VALUES (?1, 'other', 0, 0)",
            "INSERT INTO overlap_cache (activity_a, activity_b, has_overlap, computed_at)
             VALUES ('other', ?1, 0, 0)",
        ];
        for sql in seeds {
            engine
                .db
                .execute(sql, params![id])
                .unwrap_or_else(|e| panic!("seed failed: {sql}: {e}"));
        }
    }

    fn rows_for(engine: &PersistentEngine, table: &str, column: &str, id: &str) -> i64 {
        engine
            .db
            .query_row(
                &format!("SELECT COUNT(*) FROM {table} WHERE {column} = ?1"),
                params![id],
                |r| r.get(0),
            )
            .unwrap()
    }

    /// A removal cleared six tables and stranded the rest, so the feed kept
    /// rendering an activity that had left the map, the routes and the
    /// sections. `get_activity_bodies` reads `activity_bodies` alone.
    #[test]
    fn removing_an_activity_takes_every_row_keyed_on_it() {
        let mut engine = engine_with_activity_in_sections(2);
        seed_activity_keyed_rows(&mut engine, "a1");

        engine.remove_activity("a1").unwrap();

        for (table, column) in ACTIVITY_KEYED {
            assert_eq!(
                rows_for(&engine, table, column, "a1"),
                0,
                "{table} still holds the removed activity"
            );
        }
        assert_eq!(rows_for(&engine, "overlap_cache", "activity_a", "a1"), 0);
        assert_eq!(rows_for(&engine, "overlap_cache", "activity_b", "a1"), 0);
    }

    /// The feed is the visible half of it: the body is what the home screen
    /// renders, so an activity with its body left behind never leaves.
    #[test]
    fn a_removed_activity_is_gone_from_the_feed() {
        let mut engine = engine_with_activity_in_sections(0);
        seed_activity_keyed_rows(&mut engine, "a1");

        engine.remove_activity("a1").unwrap();

        assert!(engine.get_activity_bodies(0, i64::MAX).unwrap().is_empty());
    }

    /// Only the removed activity goes. A neighbour sharing every table keeps
    /// its rows, and the other side of an overlap pair keeps its own.
    #[test]
    fn removing_an_activity_leaves_its_neighbour_alone() {
        let mut engine = engine_with_activity_in_sections(0);
        seed_activity_keyed_rows(&mut engine, "a1");
        seed_activity_keyed_rows(&mut engine, "a2");

        engine.remove_activity("a1").unwrap();

        for (table, column) in ACTIVITY_KEYED {
            assert_eq!(
                rows_for(&engine, table, column, "a2"),
                1,
                "{table} lost a row belonging to another activity"
            );
        }
    }

    /// The removal stays one commit with eleven more deletes inside it.
    #[test]
    fn removing_an_activity_with_every_table_seeded_is_still_one_commit() {
        let mut engine = engine_with_activity_in_sections(12);
        seed_activity_keyed_rows(&mut engine, "a1");
        let commits = commit_counter::watch(&engine);

        engine.remove_activity("a1").unwrap();

        assert_eq!(commit_counter::count(&commits), 1);
    }

    /// The list above is a hand-kept list, so the schema is what holds it
    /// honest: a table added later with an `activity_id` column is covered by
    /// this without anyone remembering to extend the test.
    #[test]
    fn every_activity_keyed_table_in_the_schema_is_covered() {
        let engine = PersistentEngine::in_memory().unwrap();
        let tables: Vec<String> = engine
            .db
            .prepare(
                "SELECT m.name FROM sqlite_master m
                 JOIN pragma_table_info(m.name) p
                 WHERE m.type = 'table' AND p.name = 'activity_id'
                 ORDER BY m.name",
            )
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();

        // A query that found nothing would pass this test vacuously.
        assert!(tables.len() >= ACTIVITY_KEYED_TABLES.len());

        // The four the foreign key cascade already reaches, and the frozen
        // archive that keeps its members on purpose.
        let cascaded = [
            "gps_tracks",
            "signatures",
            "time_streams",
            "section_activities",
            "processed_activities",
            "section_catalogue_archive_members",
        ];
        let uncovered: Vec<&String> = tables
            .iter()
            .filter(|t| !ACTIVITY_KEYED_TABLES.contains(&t.as_str()))
            .filter(|t| !cascaded.contains(&t.as_str()))
            .collect();

        assert!(
            uncovered.is_empty(),
            "these tables hold an activity_id and no removal clears them: {uncovered:?}"
        );
    }

    #[test]
    fn removing_the_same_activity_twice_is_one_commit_each() {
        let mut engine = engine_with_activity_in_sections(3);
        engine.remove_activity("a1").unwrap();

        let commits = commit_counter::watch(&engine);
        engine.remove_activity("a1").unwrap();

        assert_eq!(commit_counter::count(&commits), 1);
        assert!(engine.db.is_autocommit());
    }
}
