//! Background section detection and application.

use crate::persistence::codec;
use crate::persistence::codec::TrackRead;
use crate::{FrequentSection, GpsPoint, SectionEvidenceCache};
use rusqlite::{Connection, Result as SqlResult, params};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::sync::mpsc;
use std::thread;
use tracematch::{Bounds, MatchConfig, RouteGroup, RouteSignature};

use super::super::{
    CacheUpdate, ClusteringAwareProgress, PersistentRouteEngine, SectionDetectionHandle,
    SectionDetectionProgress, load_groups_from_db,
};

/// A stored track that did not decode, named so it can be excluded from a
/// detection pool by id rather than counted anonymously.
pub(crate) struct CorruptTrack {
    pub activity_id: String,
    pub reason: String,
}

/// Share of unreadable rows above which a pool is treated as a read-path
/// failure rather than isolated row rot. Above the ceiling the detect is
/// abandoned and the catalogue is left as it stands, because a catalogue cut
/// over a fraction of the library is wrong rather than incomplete.
const MAX_CORRUPT_POOL_FRACTION: f64 = 0.10;

/// Fewest unreadable rows that can abandon a run. The fraction alone makes a
/// small library a cliff, where one bad blob in nine gives up on detection
/// permanently. A read-path failure takes the whole store with it and clears
/// both bars, so the floor costs nothing against the shape worth catching.
const MIN_CORRUPT_TO_ABANDON: usize = 8;

/// Seconds an abandoned pool stays abandoned while its activity ids are
/// unchanged. The abort returns before `save_processed_activity_ids`, so
/// without a window every sync reloads and re-decodes the whole store to reach
/// the same verdict. Any new or removed activity changes the digest and
/// retries at once, so a repaired library is never held off by the window.
const ABANDON_RETRY_SECONDS: i64 = 6 * 3600;

/// `schema_info` key holding the completeness of the pool the live catalogue
/// was cut over.
const POOL_INTEGRITY_KEY: &str = "detection_pool_integrity";

/// `schema_info` key holding the pool an abandoned run gave up on.
const ABANDONED_POOL_KEY: &str = "detection_abandoned_pool";

/// `schema_info` key holding the sections whose accumulator was seeded over
/// only part of their traversals.
const SEED_EXCLUSIONS_KEY: &str = "accumulator_seed_exclusions";

/// Number of ids named individually in a log line or a durable record.
const CORRUPT_ID_LOG_CAP: usize = 20;

/// Whether a pool with this many unreadable rows may still be cut over. Both
/// bars must be cleared to abandon: enough unreadable rows to rule out
/// isolated rot, and enough of the store to rule out a catalogue worth cutting.
fn pool_is_usable(readable: usize, corrupt: usize) -> bool {
    let total = readable + corrupt;
    if total == 0 || corrupt < MIN_CORRUPT_TO_ABANDON {
        return true;
    }
    (corrupt as f64) / (total as f64) <= MAX_CORRUPT_POOL_FRACTION
}

/// FNV-1a over the sorted activity ids. Fixed by its own arithmetic rather
/// than by the standard library, so the stored digest still names the same
/// pool after a toolchain change.
fn pool_digest(activity_ids: &[String]) -> u64 {
    let mut sorted: Vec<&str> = activity_ids.iter().map(|s| s.as_str()).collect();
    sorted.sort_unstable();
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let mix = |byte: u8, hash: &mut u64| {
        *hash ^= byte as u64;
        *hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    };
    for id in sorted {
        for byte in id.as_bytes() {
            mix(*byte, &mut hash);
        }
        mix(0xff, &mut hash);
    }
    hash
}

/// True when this exact pool was abandoned recently enough that loading it
/// again can only reach the same verdict.
fn abandon_window_active(conn: &Connection, activity_ids: &[String]) -> bool {
    let stored: Option<String> = conn
        .query_row(
            "SELECT value FROM schema_info WHERE key = ?",
            params![ABANDONED_POOL_KEY],
            |row| row.get(0),
        )
        .ok();
    let Some(stored) = stored else {
        return false;
    };
    let Ok(record) = serde_json::from_str::<serde_json::Value>(&stored) else {
        return false;
    };
    let digest = record["pool_digest"].as_str().unwrap_or_default();
    let at = record["abandoned_at"].as_i64().unwrap_or(0);
    let age = chrono::Utc::now().timestamp() - at;
    digest == format!("{:016x}", pool_digest(activity_ids))
        && (0..ABANDON_RETRY_SECONDS).contains(&age)
}

/// Name the pool an abandoned run gave up on, so the next sync can tell it has
/// already been decoded and rejected.
fn record_abandoned_pool(conn: &Connection, activity_ids: &[String]) {
    let value = serde_json::json!({
        "abandoned_at": chrono::Utc::now().timestamp(),
        "pool_digest": format!("{:016x}", pool_digest(activity_ids)),
        "pool_size": activity_ids.len(),
    })
    .to_string();
    if let Err(e) = conn.execute(
        "INSERT OR REPLACE INTO schema_info (key, value) VALUES (?, ?)",
        params![ABANDONED_POOL_KEY, value],
    ) {
        log::error!("tracematch: [pool integrity] abandon record failed: {}", e);
    }
}

/// Drop the abandon record once a pool is usable again.
fn clear_abandoned_pool(conn: &Connection) {
    let _ = conn.execute(
        "DELETE FROM schema_info WHERE key = ?",
        params![ABANDONED_POOL_KEY],
    );
}

/// Name the sections whose accumulator was seeded over only part of their
/// traversals, so a consensus short some traversals is a durable fact rather
/// than a log line. A backfill with nothing excluded clears the record.
fn record_seed_exclusions(conn: &Connection, exclusions: &[(String, Vec<String>)]) {
    if exclusions.is_empty() {
        let _ = conn.execute(
            "DELETE FROM schema_info WHERE key = ?",
            params![SEED_EXCLUSIONS_KEY],
        );
        return;
    }
    let value = serde_json::json!({
        "recorded_at": chrono::Utc::now().timestamp(),
        "sections": exclusions.len(),
        "excluded": exclusions
            .iter()
            .take(CORRUPT_ID_LOG_CAP)
            .map(|(section_id, activity_ids)| serde_json::json!({
                "section_id": section_id,
                "activity_ids": activity_ids,
            }))
            .collect::<Vec<_>>(),
    })
    .to_string();
    if let Err(e) = conn.execute(
        "INSERT OR REPLACE INTO schema_info (key, value) VALUES (?, ?)",
        params![SEED_EXCLUSIONS_KEY, value],
    ) {
        log::error!(
            "tracematch: [accum backfill] exclusion record failed: {}",
            e
        );
    }
}

/// Name every excluded track and its reason, capped so a corpus-wide read
/// failure cannot flood the log.
fn log_corrupt_tracks(context: &str, readable: usize, corrupt: &[CorruptTrack]) {
    if corrupt.is_empty() {
        return;
    }
    log::error!(
        "tracematch: [{}] {} of {} stored tracks are unreadable and excluded from the pool",
        context,
        corrupt.len(),
        readable + corrupt.len()
    );
    for track in corrupt.iter().take(CORRUPT_ID_LOG_CAP) {
        log::error!(
            "tracematch: [{}] activity {} unreadable: {}",
            context,
            track.activity_id,
            track.reason
        );
    }
    if corrupt.len() > CORRUPT_ID_LOG_CAP {
        log::error!(
            "tracematch: [{}] {} further unreadable tracks not listed",
            context,
            corrupt.len() - CORRUPT_ID_LOG_CAP
        );
    }
}

/// Record how complete the pool behind the live catalogue is, so an incomplete
/// corpus is a durable fact rather than a log line that scrolls away.
/// `abandoned` says whether the run gave up on this pool or cut a catalogue
/// over it, which is the difference between an unchanged catalogue and a
/// current one. A clean pool clears the record.
fn record_pool_integrity(
    conn: &Connection,
    readable: usize,
    corrupt: &[CorruptTrack],
    abandoned: bool,
) {
    if corrupt.is_empty() {
        let _ = conn.execute(
            "DELETE FROM schema_info WHERE key = ?",
            params![POOL_INTEGRITY_KEY],
        );
        return;
    }
    let value = serde_json::json!({
        "recorded_at": chrono::Utc::now().timestamp(),
        "readable": readable,
        "corrupt": corrupt.len(),
        "abandoned": abandoned,
        "activity_ids": corrupt
            .iter()
            .take(CORRUPT_ID_LOG_CAP)
            .map(|c| c.activity_id.as_str())
            .collect::<Vec<_>>(),
        "first_reason": corrupt.first().map(|c| c.reason.as_str()).unwrap_or(""),
    })
    .to_string();
    if let Err(e) = conn.execute(
        "INSERT OR REPLACE INTO schema_info (key, value) VALUES (?, ?)",
        params![POOL_INTEGRITY_KEY, value],
    ) {
        log::error!("tracematch: [pool integrity] record failed: {}", e);
    }
}

/// Load all route signatures from the DB (standalone, no engine needed).
/// Returns the signatures that decoded and the ones that did not, so the
/// caller decides whether a reduced pool may be grouped over.
fn load_all_signatures(conn: &Connection) -> (Vec<RouteSignature>, Vec<CorruptTrack>) {
    let mut stmt = match conn.prepare(
        "SELECT activity_id, points, start_point_lat, start_point_lng,
                end_point_lat, end_point_lng, total_distance
         FROM signatures",
    ) {
        Ok(s) => s,
        Err(_) => return (Vec::new(), Vec::new()),
    };

    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Vec<u8>>(1)?,
            GpsPoint::new(row.get(2)?, row.get(3)?),
            GpsPoint::new(row.get(4)?, row.get(5)?),
            row.get::<_, f64>(6)?,
        ))
    });
    let rows = match rows {
        Ok(r) => r,
        Err(_) => return (Vec::new(), Vec::new()),
    };

    let mut signatures: Vec<RouteSignature> = Vec::new();
    let mut corrupt: Vec<CorruptTrack> = Vec::new();

    for (id, blob, start_point, end_point, total_distance) in rows.flatten() {
        let points: Vec<GpsPoint> = match TrackRead::from_blob(&blob) {
            TrackRead::Present(points) => points,
            TrackRead::Missing => Vec::new(),
            TrackRead::Corrupt(reason) => {
                corrupt.push(CorruptTrack {
                    activity_id: id,
                    reason,
                });
                continue;
            }
        };
        let bounds = Bounds::from_points(&points).unwrap_or(Bounds {
            min_lat: 0.0,
            max_lat: 0.0,
            min_lng: 0.0,
            max_lng: 0.0,
        });
        let center = bounds.center();
        signatures.push(RouteSignature {
            activity_id: id,
            points,
            total_distance,
            start_point,
            end_point,
            bounds,
            center,
        });
    }

    (signatures, corrupt)
}

/// Compute route groups from DB signatures and save them back.
/// Runs on the background thread so it doesn't block the JS thread.
fn recompute_and_save_groups(
    conn: &Connection,
    match_config: &MatchConfig,
    existing_groups: &[RouteGroup],
    activity_metadata: &HashMap<String, String>,
) -> Vec<RouteGroup> {
    let start = std::time::Instant::now();

    let (signatures, corrupt) = load_all_signatures(conn);
    let sig_ms = start.elapsed().as_millis();

    if !corrupt.is_empty() {
        log_corrupt_tracks("BG Groups", signatures.len(), &corrupt);
        if !pool_is_usable(signatures.len(), corrupt.len()) {
            log::error!(
                "tracematch: [BG Groups] Keeping the existing groups: too much of the signature pool is unreadable to regroup over"
            );
            return existing_groups.to_vec();
        }
    }

    if signatures.is_empty() {
        return existing_groups.to_vec();
    }

    let already_grouped: HashSet<&str> = existing_groups
        .iter()
        .flat_map(|g| g.activity_ids.iter().map(|s| s.as_str()))
        .collect();
    let (new_sigs, existing_sigs): (Vec<_>, Vec<_>) = signatures
        .iter()
        .cloned()
        .partition(|s| !already_grouped.contains(s.activity_id.as_str()));

    let total = signatures.len();
    let use_incremental = !existing_groups.is_empty()
        && !new_sigs.is_empty()
        && (new_sigs.len() as f64) < (total as f64 * 0.9);

    let group_start = std::time::Instant::now();
    let result = if use_incremental {
        log::info!(
            "[BG Groups] INCREMENTAL: {} new vs {} existing",
            new_sigs.len(),
            existing_sigs.len()
        );
        let groups =
            tracematch::group_incremental(&new_sigs, existing_groups, &existing_sigs, match_config);
        tracematch::GroupingResult {
            groups,
            activity_matches: HashMap::new(),
        }
    } else {
        log::info!("[BG Groups] FULL: {} signatures", signatures.len());
        tracematch::group_signatures_parallel_with_matches(&signatures, match_config)
    };
    let group_ms = group_start.elapsed().as_millis();

    let mut groups = result.groups;

    for group in &mut groups {
        if let Some(sport) = activity_metadata.get(&group.representative_id) {
            group.sport_type = if sport.is_empty() {
                "Ride".to_string()
            } else {
                sport.clone()
            };
        }
    }

    if let Err(e) = save_groups_to_db(conn, &groups) {
        log::error!("[BG Groups] Save failed: {}", e);
    }

    let total_ms = start.elapsed().as_millis();
    log::info!(
        "[BG Groups] Done: {} groups in {}ms (sigs={}ms, grouping={}ms)",
        groups.len(),
        total_ms,
        sig_ms,
        group_ms
    );

    groups
}

/// Save route groups to DB (standalone, no engine needed).
fn save_groups_to_db(conn: &Connection, groups: &[RouteGroup]) -> SqlResult<()> {
    conn.execute("DELETE FROM route_groups", [])?;
    let mut stmt = conn.prepare(
        "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type,
            bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
            activity_ids_blob)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )?;
    for group in groups {
        let activity_ids_json = serde_json::to_string(&group.activity_ids).unwrap_or_default();
        let activity_ids_blob = super::codec::serialize(&group.activity_ids).ok();
        let (min_lat, max_lat, min_lng, max_lng) = match &group.bounds {
            Some(b) => (
                Some(b.min_lat),
                Some(b.max_lat),
                Some(b.min_lng),
                Some(b.max_lng),
            ),
            None => (None, None, None, None),
        };
        stmt.execute(params![
            group.group_id,
            group.representative_id,
            activity_ids_json,
            group.sport_type,
            min_lat,
            max_lat,
            min_lng,
            max_lng,
            activity_ids_blob,
        ])?;
    }
    Ok(())
}

/// Tier 2 upgrade-path backfill: seed `consensus_state_blob` on every
/// pre-existing section whose blob is still NULL, using its own SQLite
/// connection so it doesn't block the main engine. Runs once per install
/// (guarded by the `accumulators_seeded_v1` key in `schema_info`).
///
/// Why: users upgrading from 0.2.2 (or any pre-Tier-2 version) have
/// sections on disk whose `consensus_state_blob` is NULL because the
/// detection run that created them didn't seed accumulators. Without this
/// backfill, the first post-upgrade sync still pays the historical-trace
/// extraction cost (scenario C's ~1.5 s). With it, the next sync reads
/// fresh accumulators and lands in the O(K) fast path immediately.
///
/// Race-safety:
/// - UPDATE is gated on `WHERE consensus_state_blob IS NULL`, so if the
///   main engine's `apply_sections_save` persisted a newer blob in the
///   meantime we don't clobber it.
/// - If the user syncs during backfill, the engine's in-memory copy still
///   has None accumulators and will hit today's backfill branch in
///   incremental detection - correct but slow. Subsequent syncs pick up
///   the persisted blobs on next engine reload.
/// - `try_write` at the end is best-effort: if the engine lock is taken
///   by an active operation we skip the in-memory reload; the fresh blobs
///   land on next app start via `load_sections`.
pub fn spawn_accumulator_backfill(db_path: String) {
    std::thread::spawn(move || {
        let result = run_accumulator_backfill(&db_path, /* refresh_engine = */ true);
        if let Err(e) = result {
            log::warn!("tracematch: [accum backfill] {}", e);
        }
    });
}

/// Synchronous body of [`spawn_accumulator_backfill`]. Separated so
/// integration tests can drive the backfill deterministically (no thread).
///
/// When `refresh_engine` is true and any section got seeded, best-effort
/// acquires the global engine write lock and reloads sections. Tests pass
/// `false` - they hold their own engine and don't need the singleton.
pub fn run_accumulator_backfill(db_path: &str, refresh_engine: bool) -> Result<(u32, u32), String> {
    let start = std::time::Instant::now();
    let conn = match Connection::open(db_path) {
        Ok(c) => {
            let _ = c.busy_timeout(std::time::Duration::from_millis(500));
            c
        }
        Err(e) => return Err(format!("open failed: {}", e)),
    };

    // Already-seeded flag: once set, skip entirely.
    let flag_set: bool = conn
        .query_row(
            "SELECT value FROM schema_info WHERE key = 'accumulators_seeded_v1'",
            [],
            |row| row.get::<_, String>(0),
        )
        .is_ok();
    if flag_set {
        return Ok((0, 0));
    }

    // Collect sections that still need seeding.
    let sections_to_seed: Vec<(String, Vec<tracematch::GpsPoint>)> = {
        let mut stmt = conn
            .prepare(
                "SELECT id, polyline_blob, polyline_json FROM sections
                 WHERE consensus_state_blob IS NULL
                   AND disabled = 0",
            )
            .map_err(|e| format!("prepare failed: {}", e))?;
        stmt.query_map([], |row| {
            let id: String = row.get(0)?;
            let blob: Option<Vec<u8>> = row.get(1)?;
            let json: Option<String> = row.get(2)?;
            Ok((id, blob, json))
        })
        .ok()
        .map(|rows| {
            rows.filter_map(|r| r.ok())
                .filter_map(|(id, blob, json)| {
                    codec::decode_polyline_row(blob.as_deref(), json.as_deref())
                        .ok()
                        .map(|p| (id, p))
                })
                .filter(|(_, p)| p.len() >= 2)
                .collect()
        })
        .unwrap_or_default()
    };

    if sections_to_seed.is_empty() {
        // Nothing to do. Set flag so next start skips straight past.
        let _ = conn.execute(
            "INSERT OR REPLACE INTO schema_info (key, value)
             VALUES ('accumulators_seeded_v1', '1')",
            [],
        );
        return Ok((0, 0));
    }

    log::info!(
        "tracematch: [accum backfill] Seeding {} sections from pre-Tier-2 data",
        sections_to_seed.len()
    );

    // The user's stored config, read off this connection: a non-default
    // slider must seed accumulators the same way detection would. Falls
    // back to defaults on a fresh install with no stored blob.
    let section_config = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?",
            [crate::persistence::settings_keys::SECTION_CONFIG_JSON],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|json| serde_json::from_str::<tracematch::SectionConfig>(&json).ok())
        .unwrap_or_default();
    let mut seeded: u32 = 0;
    let mut skipped: u32 = 0;
    let mut unreadable_sections: u32 = 0;
    let mut seed_exclusions: Vec<(String, Vec<String>)> = Vec::new();

    for (section_id, polyline) in &sections_to_seed {
        // Activity ids for this section (excluded=0 matches the rest of the codebase).
        let activity_ids: Vec<String> = match conn.prepare(
            "SELECT activity_id FROM section_activities
             WHERE section_id = ? AND excluded = 0",
        ) {
            Ok(mut stmt) => stmt
                .query_map([section_id], |row| row.get::<_, String>(0))
                .ok()
                .map(|r| r.filter_map(|x| x.ok()).collect())
                .unwrap_or_default(),
            Err(_) => Vec::new(),
        };
        if activity_ids.is_empty() {
            skipped += 1;
            continue;
        }

        // Load full GPS tracks for the section's activities in a single IN(...)
        // query - cheaper than N separate query_row round-trips, especially on
        // sections with many traversals.
        let mut track_map_owned: HashMap<String, Vec<tracematch::GpsPoint>> = HashMap::new();
        let mut section_corrupt: Vec<CorruptTrack> = Vec::new();
        {
            let placeholders: String = std::iter::repeat("?")
                .take(activity_ids.len())
                .collect::<Vec<_>>()
                .join(",");
            let sql = format!(
                "SELECT activity_id, track_data FROM gps_tracks WHERE activity_id IN ({})",
                placeholders
            );
            if let Ok(mut stmt) = conn.prepare(&sql) {
                let params_slice: Vec<&dyn rusqlite::ToSql> = activity_ids
                    .iter()
                    .map(|id| id as &dyn rusqlite::ToSql)
                    .collect();
                if let Ok(rows) = stmt.query_map(params_slice.as_slice(), |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
                }) {
                    for (id, bytes) in rows.flatten() {
                        match TrackRead::from_blob(&bytes) {
                            TrackRead::Present(track) => {
                                if !track.is_empty() {
                                    track_map_owned.insert(id, track);
                                }
                            }
                            TrackRead::Missing => {}
                            TrackRead::Corrupt(reason) => section_corrupt.push(CorruptTrack {
                                activity_id: id,
                                reason,
                            }),
                        }
                    }
                }
            }
        }
        // An accumulator is a consensus over the traversals folded into it and
        // it names them in `absorbed_activity_ids`, so one built over the
        // readable members is a section as it stood before the unreadable
        // traversals, not a wrong one. It is seeded, the exclusion is recorded,
        // and a repaired track folds in later without double-counting.
        if !section_corrupt.is_empty() {
            for track in section_corrupt.iter().take(CORRUPT_ID_LOG_CAP) {
                log::error!(
                    "tracematch: [accum backfill] section {} seeded without activity {}, track unreadable: {}",
                    section_id,
                    track.activity_id,
                    track.reason
                );
            }
            unreadable_sections += 1;
            seed_exclusions.push((
                section_id.clone(),
                section_corrupt
                    .iter()
                    .take(CORRUPT_ID_LOG_CAP)
                    .map(|c| c.activity_id.clone())
                    .collect(),
            ));
        }
        if track_map_owned.is_empty() {
            skipped += 1;
            continue;
        }

        let track_ref_map: HashMap<&str, &[tracematch::GpsPoint]> = track_map_owned
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_slice()))
            .collect();

        let traces_map = tracematch::sections::extract_all_activity_traces(
            &activity_ids,
            polyline,
            &track_ref_map,
        );
        if traces_map.is_empty() {
            skipped += 1;
            continue;
        }
        let traces: Vec<(String, Vec<tracematch::GpsPoint>)> = traces_map.into_iter().collect();
        let acc = tracematch::sections::build_accumulator_from_traces(
            polyline,
            &traces,
            section_config.proximity_threshold,
        );

        match codec::serialize_gps_composite(&acc) {
            Ok(blob) => {
                // IS NULL guard: respect any writes the main engine made
                // while we were computing (e.g., a sync that ran concurrently
                // and populated this section via the normal incremental path).
                let updated = conn
                    .execute(
                        "UPDATE sections SET consensus_state_blob = ?
                         WHERE id = ? AND consensus_state_blob IS NULL",
                        params![blob, section_id],
                    )
                    .unwrap_or(0);
                if updated > 0 {
                    seeded += 1;
                } else {
                    skipped += 1;
                }
            }
            Err(_) => skipped += 1,
        }
    }

    // Mark the flag even if some were skipped - we only want to pay the
    // corpus-wide scan once. Sections we skipped here (e.g., no GPS data on
    // disk) will get their accumulators built by the ordinary incremental
    // backfill path if/when they're ever touched.
    let _ = conn.execute(
        "INSERT OR REPLACE INTO schema_info (key, value)
         VALUES ('accumulators_seeded_v1', '1')",
        [],
    );

    log::info!(
        "tracematch: [accum backfill] Done: {} seeded, {} skipped, took {:?}",
        seeded,
        skipped,
        start.elapsed()
    );
    record_seed_exclusions(&conn, &seed_exclusions);
    if unreadable_sections > 0 {
        log::error!(
            "tracematch: [accum backfill] {} sections seeded over part of their traversals because a member track is unreadable",
            unreadable_sections
        );
    }

    // Best-effort: refresh the engine's in-memory copy so the new blobs
    // become usable without requiring an app restart. If the write lock is
    // held by a concurrent operation, skip - the engine will pick them up
    // on next `load_sections` call / next app start.
    if refresh_engine && seeded > 0 {
        if let Ok(mut guard) = super::super::PERSISTENT_ENGINE.try_write() {
            if let Some(ref mut engine) = *guard {
                if let Err(e) = engine.load_sections() {
                    log::warn!(
                        "tracematch: [accum backfill] in-memory reload failed: {}",
                        e
                    );
                } else {
                    log::info!("tracematch: [accum backfill] in-memory sections refreshed");
                }
            }
        } else {
            log::info!("tracematch: [accum backfill] engine busy, deferring reload to next start");
        }
    }

    Ok((seeded, skipped))
}

/// Tier 2: seed `consensus_state` on any section that came out of detection
/// with None. Uses the GPS tracks already loaded for detection, so no DB
/// round-trip. Runs before the results cross the mpsc channel so the
/// accumulator lands in the FrequentSection that `apply_sections_save` later
/// persists via `consensus_state_blob`.
///
/// Why it matters: without a seeded accumulator, the first incremental add
/// that touches each section falls into the backfill branch in
/// `tracematch/src/sections/incremental.rs` (extract_all_activity_traces for
/// every historical activity of that section). On a 150-activity corpus
/// that's the bulk of scenario C's 1.6 s lag per the baselines. Seeding
/// eagerly shifts that cost into the detection phase itself (where we
/// already have all the traces resident) and lets the next incremental
/// touch take the O(K) fast path.
///
/// Idempotent: sections that already have `consensus_state` (from the
/// incremental path that produced them) are skipped, so we never
/// double-seed.
fn seed_consensus_state(
    sections: &mut [FrequentSection],
    tracks: &[(String, Vec<GpsPoint>)],
    proximity_threshold: f64,
) {
    if sections.is_empty() || tracks.is_empty() {
        return;
    }
    let track_map: HashMap<&str, &[GpsPoint]> = tracks
        .iter()
        .map(|(id, pts)| (id.as_str(), pts.as_slice()))
        .collect();

    for section in sections.iter_mut() {
        if section.consensus_state.is_some() {
            continue;
        }
        if section.polyline.len() < 2 || section.activity_ids.is_empty() {
            continue;
        }
        let traces_map = tracematch::sections::extract_all_activity_traces(
            &section.activity_ids,
            &section.polyline,
            &track_map,
        );
        if traces_map.is_empty() {
            continue;
        }
        let traces: Vec<(String, Vec<GpsPoint>)> = traces_map.into_iter().collect();
        let acc = tracematch::sections::build_accumulator_from_traces(
            &section.polyline,
            &traces,
            proximity_threshold,
        );
        section.consensus_state = Some(acc);
    }
}

/// Phase reported by a handle that was refused because detection is
/// suspended. It is not one of the weighted run phases, so `get_percent`
/// reports the unknown-phase 50 rather than pretending to progress.
pub const DETECTION_PHASE_SUSPENDED: &str = "suspended";

impl PersistentRouteEngine {
    /// A handle for a run that never started: no worker, both senders dropped.
    ///
    /// The first poll reads `WorkerPoll::Died`, which the FFI poll reports as
    /// "error". A refusal is therefore visible to the caller and distinct from
    /// a run that completed and changed nothing, which reports "complete".
    fn refused_detection_handle() -> SectionDetectionHandle {
        let (tx, rx) = mpsc::channel();
        let (cache_tx, cache_rx) = mpsc::channel::<CacheUpdate>();
        drop(tx);
        drop(cache_tx);
        let progress = SectionDetectionProgress::new();
        progress.set_phase(DETECTION_PHASE_SUSPENDED, 0);
        SectionDetectionHandle {
            receiver: rx,
            cache_receiver: cache_rx,
            progress,
        }
    }

    /// Stored tracks that do not yet carry elevation, ie. the size of the
    /// remaining backfill plus the tracks upstream can never fill.
    pub fn elevation_backfill_outstanding(&self) -> u64 {
        self.elevation_state_counts()
            .map(|counts| counts.not_fetched())
            .unwrap_or(0)
    }

    /// True when every stored track has been asked about its elevation and
    /// answered, so lift rescue reads the same way for every track in the pool.
    ///
    /// Detection does NOT gate on this. A library that has simply never been
    /// backfilled reads as non-uniform, and refusing it would leave a user who
    /// never updates with no sections at all. The gate is the suspension
    /// guard a backfill holds; this is the query a backfill uses to decide
    /// whether it has work, and a diagnostic for everyone else.
    pub fn library_uniformly_elevated(&self) -> bool {
        self.elevation_backfill_outstanding() == 0
    }

    /// Start section detection in a background thread.
    ///
    /// Returns a handle that can be polled for completion and progress.
    ///
    /// Detection always covers every activity, so the catalogue is a pure
    /// function of the activity set plus config.
    ///
    /// Note: This method is designed to be non-blocking on the calling thread.
    /// All heavy operations (groups loading, track loading, detection) happen
    /// in the background thread to keep the UI responsive.
    pub fn detect_sections_background(&mut self) -> SectionDetectionHandle {
        // The single funnel every detection arm passes through, so the
        // suspension gate sits here rather than at each caller.
        if super::conditioning::detection_suspended() {
            log::info!(
                "tracematch: [SectionDetection] Refused: detection is suspended for a backfill"
            );
            return Self::refused_detection_handle();
        }
        self.detect_sections_background_unchecked()
    }

    /// The run behind [`detect_sections_background`], without the suspension
    /// gate. Only the backfill's own final re-cut may call this: it holds the
    /// guard precisely so nothing else can run, and its detect is the one the
    /// suspension exists to protect.
    pub(crate) fn detect_sections_background_unchecked(&mut self) -> SectionDetectionHandle {
        let (tx, rx) = mpsc::channel();
        // Out-of-band channel for the Unified detector's evidence-cache update.
        // Left unsent by the legacy detectors and the short-circuit, so the
        // caller's `take_cache` returns None and the engine cache is untouched.
        let (cache_tx, cache_rx) = mpsc::channel::<CacheUpdate>();
        let db_path = self.db_path.clone();
        let section_config = self.section_config.clone();

        // The Unified incremental folds new activities into a per-cluster
        // evidence cache. Clone the current cache + its folded-id shadow into the
        // worker only when Unified is the active method — the legacy detectors
        // never touch it, so they pay nothing to clone. The worker mutates its
        // clone and ships it back via `cache_tx`; the cache-aware apply stores it
        // only if the save succeeds, so `self`'s cache can never advance past the
        // applied catalogue.
        let unified = matches!(
            section_config.detection_method,
            tracematch::DetectionMethod::Unified
        );
        let (cache_at_spawn, folded_at_spawn) = if unified {
            (
                self.section_evidence_cache.clone(),
                self.cache_folded_ids.clone(),
            )
        } else {
            (SectionEvidenceCache::new(), HashSet::new())
        };

        // Create shared progress tracker
        let progress = SectionDetectionProgress::new();
        let progress_clone = progress.clone();

        // Capture whether groups need recomputation. Instead of blocking the
        // calling thread (which freezes the JS progress bar), we pass this
        // flag to the background thread and let it recompute from DB.
        let needs_group_recompute = self.groups_dirty;
        let match_config = self.match_config.clone();
        let current_groups = self.groups.clone();

        // Build sport type map + activity_ids in a single pass over metadata.
        // Uses the HashMap key (= activity id) to avoid cloning m.id separately.
        let mut sport_map: HashMap<String, String> =
            HashMap::with_capacity(self.activity_metadata.len());
        let mut activity_ids: Vec<String> = Vec::with_capacity(self.activity_metadata.len());

        for (id, m) in &self.activity_metadata {
            sport_map.insert(id.clone(), m.sport_type.clone());
            activity_ids.push(id.clone());
        }
        // Metadata iterates in HashMap order, so sort by the activities primary
        // key to give the detector a deterministic input order.
        activity_ids.sort();

        // Activity start times for the occasion support floor: ground
        // visited only within one stay is a trip, not repetition. Dates
        // before 2000 are treated as unknown (each its own occasion),
        // mirroring how anonymised exports are handled corpus-side.
        let mut start_epochs: HashMap<String, i64> = HashMap::new();
        if let Ok(mut stmt) = self
            .db
            .prepare("SELECT id, start_date FROM activities WHERE start_date >= 946684800")
        {
            let rows = stmt.query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            });
            if let Ok(rows) = rows {
                for (id, e) in rows.flatten() {
                    start_epochs.insert(id, e);
                }
            }
        }

        // The catalogue this detect re-derives from. It seeds the Unified
        // incremental (its add/dissolve diff is computed against this prior
        // catalogue) and gates the no-new-activities short-circuit below. Only the
        // auto catalogue belongs here: `self.sections` also carries the durable
        // user-defined sections (custom + accepted) for the matcher, but the
        // incremental converges the AUTO batch and must not treat a custom section
        // as an auto prior.
        let existing_sections: Vec<FrequentSection> = self
            .sections
            .iter()
            .filter(|s| !s.is_user_defined)
            .cloned()
            .collect();

        // Pinned sections hold their drawn line: the fold freezes them and
        // withholds any fresh cut sharing their corridor. Read here, on the
        // engine, so the worker takes the durable intent as an explicit input.
        let pinned_ids = self.pinned_section_ids();

        let new_activity_ids: Vec<String> = activity_ids
            .iter()
            .filter(|id| !self.processed_activity_ids.contains(*id))
            .cloned()
            .collect();

        // Short-circuit: no new activities means nothing to detect. Re-emit the
        // last RAW batch, not the damped visible view: the visible catalogue can
        // lag the batch while a dissolve debounces, and echoing it back through
        // identity would count as a decisive continuation and hold the laggards
        // forever. The raw batch is what a re-fold over the unchanged pool would
        // emit, so the debounce keeps pressing and the view converges. A known
        // EMPTY raw batch is echoed as empty for the same reason: it is the
        // detector's answer, and echoing the visible view instead would
        // resurrect sections the pool no longer supports. The raw batch lives
        // in memory only; in a fresh process the visible catalogue is the best
        // available echo.
        if new_activity_ids.is_empty() && !existing_sections.is_empty() {
            log::info!(
                "tracematch: [SectionDetection] No new activities, skipping detection ({} already processed)",
                self.processed_activity_ids.len()
            );
            let sections_copy = match &self.raw_sections {
                Some(raw) => raw.clone(),
                None => existing_sections.clone(),
            };
            let all_ids = activity_ids.clone();
            tx.send((sections_copy, all_ids)).ok();
            // No detection ran, so the evidence cache is unchanged: `cache_tx` is
            // dropped unsent, `take_cache` returns None, and the caller leaves the
            // engine cache as-is.
            return SectionDetectionHandle {
                receiver: rx,
                cache_receiver: cache_rx,
                progress,
            };
        }

        // Load every activity's track. Both detection paths need the full pool:
        // the Unified incremental re-batches it (converging to the batch), and
        // the legacy detectors run full detection each sync. The old bbox
        // pre-filter only made sense for the deleted threshold-incremental path,
        // which loaded just the new + geographically-nearby subset.
        let ids_to_load = activity_ids.clone();
        progress.set_phase("loading", ids_to_load.len() as u32);

        // Clone activity_ids for the background thread (to persist as processed after detection)
        let all_activity_ids = activity_ids.clone();

        thread::spawn(move || {
            log::info!(
                "tracematch: [SectionDetection] Background thread started with {} activity IDs",
                ids_to_load.len()
            );

            let conn = match Connection::open(&db_path) {
                Ok(c) => {
                    let _ = c.busy_timeout(std::time::Duration::from_secs(5));
                    c
                }
                Err(e) => {
                    log::info!("tracematch: [SectionDetection] Failed to open DB: {:?}", e);
                    tx.send((Vec::new(), Vec::new())).ok();
                    return;
                }
            };

            // A pool already decoded and rejected is not decoded again until it
            // changes or the window lapses, so an unreadable store costs one
            // full load per window rather than one per sync. The run still ends
            // without a result, so the poll reports the same abort.
            if abandon_window_active(&conn, &ids_to_load) {
                log::error!(
                    "tracematch: [SectionDetection] Abandoning detection: this pool of {} activities was already found unreadable within the last {} hours. The catalogue is left unchanged.",
                    ids_to_load.len(),
                    ABANDON_RETRY_SECONDS / 3600
                );
                progress_clone.set_phase("aborted", 0);
                return;
            }

            let groups = if needs_group_recompute {
                log::info!(
                    "tracematch: [SectionDetection] Recomputing route groups on background thread..."
                );
                recompute_and_save_groups(&conn, &match_config, &current_groups, &sport_map)
            } else {
                load_groups_from_db(&conn)
            };
            log::info!(
                "tracematch: [SectionDetection] {} groups ready (recomputed={})",
                groups.len(),
                needs_group_recompute
            );

            progress_clone.set_phase("loading", ids_to_load.len() as u32);

            // #21: chunk the track load to bound the transient SQL/parse
            // spike. The detection algorithm consumes full-resolution tracks
            // (the multiscale/incremental entry points borrow each track's
            // points directly into their `track_map` - see
            // tracematch::sections::detect_sections_multiscale_with_progress),
            // and `seed_consensus_state` below also needs them, so all tracks
            // must still be resident simultaneously when detection runs. We
            // can NOT downsample on load without changing detection output.
            // What chunking DOES fix: instead of binding every id into one
            // giant IN(...) statement and materialising the whole result set
            // at once, we load in CHUNK_SIZE batches and move each row into
            // the resident `loaded` map as it arrives. This caps the peak of
            // (resident tracks + in-flight query buffers) to roughly
            // (all tracks) + (one chunk) rather than (all tracks) + (full
            // result set). The final order-preserving pass over `ids_to_load`
            // is byte-identical to before, so the detection input is unchanged.
            //
            // PARTIAL: this only trims the transient spike. The dominant
            // resident cost - every full-resolution track held at once - is
            // inherent to the all-pairs algorithm and can only be removed by
            // a streaming/downsampling change inside the tracematch submodule
            // (out of scope here).
            const CHUNK_SIZE: usize = 150;
            const MEMORY_WARN_THRESHOLD: usize = 800;

            if ids_to_load.len() > MEMORY_WARN_THRESHOLD {
                log::warn!(
                    "tracematch: [SectionDetection] Loading {} full-resolution tracks for detection - all must stay resident simultaneously (all-pairs algorithm). Peak memory may be high (~{}MB est.); chunked load bounds only the transient spike, not the resident set.",
                    ids_to_load.len(),
                    // Rough estimate: ~64KB resident per track at ~1k points.
                    ids_to_load.len() * 64 / 1024,
                );
            }

            let mut tracks_loaded = 0;
            let mut tracks_empty = 0;
            let mut rows_readable = 0usize;
            let mut corrupt_tracks: Vec<CorruptTrack> = Vec::new();
            let tracks: Vec<(String, Vec<GpsPoint>)> = if ids_to_load.is_empty() {
                Vec::new()
            } else {
                let mut loaded: HashMap<String, Vec<GpsPoint>> =
                    HashMap::with_capacity(ids_to_load.len());

                for chunk in ids_to_load.chunks(CHUNK_SIZE) {
                    let placeholders: String = std::iter::repeat("?")
                        .take(chunk.len())
                        .collect::<Vec<_>>()
                        .join(",");
                    let sql = format!(
                        "SELECT activity_id, track_data FROM gps_tracks WHERE activity_id IN ({})",
                        placeholders
                    );
                    match conn.prepare(&sql) {
                        Ok(mut stmt) => {
                            let params_slice: Vec<&dyn rusqlite::ToSql> =
                                chunk.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
                            let rows = stmt.query_map(params_slice.as_slice(), |row| {
                                Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
                            });
                            if let Ok(iter) = rows {
                                for (id, blob) in iter.flatten() {
                                    match TrackRead::from_blob(&blob) {
                                        TrackRead::Present(track) => {
                                            rows_readable += 1;
                                            loaded.insert(id, track);
                                        }
                                        TrackRead::Missing => {}
                                        TrackRead::Corrupt(reason) => {
                                            corrupt_tracks.push(CorruptTrack {
                                                activity_id: id,
                                                reason,
                                            })
                                        }
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            log::warn!(
                                "tracematch: [SectionDetection] Batch prepare failed for chunk of {}: {:?}; skipping chunk",
                                chunk.len(),
                                e
                            );
                        }
                    }
                }

                // Preserve the original `ids_to_load` order + emit per-track
                // progress ticks + classify empty vs loaded. Tracks missing
                // from the result (unknown ids, rows not found) count as empty.
                ids_to_load
                    .iter()
                    .filter_map(|id| {
                        progress_clone.increment();
                        match loaded.remove(id) {
                            Some(track) if !track.is_empty() => {
                                tracks_loaded += 1;
                                Some((id.clone(), track))
                            }
                            _ => {
                                tracks_empty += 1;
                                None
                            }
                        }
                    })
                    .collect()
            };

            log::info!(
                "tracematch: [SectionDetection] Loaded {} tracks ({} empty/missing, {} unreadable) from {} activity IDs",
                tracks_loaded,
                tracks_empty,
                corrupt_tracks.len(),
                ids_to_load.len()
            );

            // The pool is the corpus the catalogue is cut over, so an
            // unreadable row is never absorbed quietly. It is named in the log
            // and recorded in schema_info, and past both bars the run is
            // abandoned rather than allowed to re-cut every section against a
            // corpus smaller than the user's library. Dropping `tx` unsent
            // leaves the poll reporting Died, which clears the handle and
            // leaves the stored catalogue exactly as it stands.
            let usable = pool_is_usable(rows_readable, corrupt_tracks.len());
            log_corrupt_tracks("SectionDetection", rows_readable, &corrupt_tracks);
            record_pool_integrity(&conn, rows_readable, &corrupt_tracks, !usable);

            if !usable {
                log::error!(
                    "tracematch: [SectionDetection] Abandoning detection: {} of {} stored tracks are unreadable, past both the {} row floor and the {:.0}% ceiling. The catalogue is left unchanged.",
                    corrupt_tracks.len(),
                    rows_readable + corrupt_tracks.len(),
                    MIN_CORRUPT_TO_ABANDON,
                    MAX_CORRUPT_POOL_FRACTION * 100.0
                );
                record_abandoned_pool(&conn, &ids_to_load);
                progress_clone.set_phase("aborted", 0);
                return;
            }
            clear_abandoned_pool(&conn);

            if tracks.is_empty() {
                log::info!("tracematch: [SectionDetection] No tracks loaded, skipping detection");
                progress_clone.set_phase("complete", 0);
                tx.send((Vec::new(), all_activity_ids)).ok();
                return;
            }

            let total_points: usize = tracks.iter().map(|(_, t)| t.len()).sum();
            log::info!(
                "tracematch: [SectionDetection] Total GPS points: {}, avg per track: {}",
                total_points,
                total_points / tracks.len().max(1)
            );

            // #25: emit an intermediate phase so the JS progress bar moves
            // past "loading" before the heavy tracematch detect call. The
            // first phase tracematch reports is "building_rtrees", but the
            // R-tree build + density-grid clustering can run for tens of
            // seconds before any per-item tick lands. Without this marker the
            // bar sits frozen at the end of "loading" and a long large-corpus
            // detection reads as a crash. We use the existing progress handle
            // only - no tracematch change. The ClusteringAwareProgress passed
            // into detect overwrites the phase on its first on_phase callback.
            progress_clone.set_phase("analyzing", tracks.len() as u32);

            if unified {
                // Unified: the order-free CACHED incremental. It folds only the
                // activities not yet in the evidence cache and recomputes just the
                // cluster(s) they touch, reusing every untouched cluster verbatim,
                // so a multi-cluster sync is O(touched-cluster) not O(pool). The
                // result is identical to the batch by construction (each cluster
                // is an order-free pure function of its set).
                //
                // The new-id set is derived from the cache's own folded shadow,
                // NOT from `processed_activity_ids`: `pool − folded_at_spawn`. On a
                // cold cache (fresh engine, restart, or any invalidation) that is
                // the whole pool, so the fold seeds every cluster = the full batch;
                // on a warm cache it is just the genuinely new activities. This is
                // what makes a restart self-heal (the DB holds the catalogue; the
                // cache rebuilds) without ever double-routing an already-folded id.
                // No seconds. They feed only the lift veto, which needs point
                // elevations to raise a candidate at all, and ingest carries none.
                let new_ids_for_cache: Vec<String> = tracks
                    .iter()
                    .map(|(id, _)| id.clone())
                    .filter(|id| !folded_at_spawn.contains(id))
                    .collect();
                let new_id_refs: Vec<&str> = new_ids_for_cache.iter().map(|s| s.as_str()).collect();

                log::info!(
                    "tracematch: [SectionDetection] Unified cached incremental: {} new of {} pool tracks against {} existing sections ({} folded in cache)",
                    new_id_refs.len(),
                    tracks.len(),
                    existing_sections.len(),
                    folded_at_spawn.len(),
                );

                let mut cache = cache_at_spawn;
                let sections_to_send = tracematch::detect_sections_unified_incremental_dated(
                    &mut cache,
                    &existing_sections,
                    &tracks,
                    &new_id_refs,
                    &[],
                    &sport_map,
                    &start_epochs,
                    &section_config,
                    &tracematch::SectionUpdatePolicy {
                        pinned_ids,
                        freeze_all_geometry: false,
                    },
                )
                .catalogue;

                // The cache now folds everything it did before plus the new pool
                // ids just routed (each present in the pool, so actually folded).
                // Keeping this shadow set in step with the returned cache is what
                // lets the next detect compute `pool − folded` correctly.
                let mut folded_after = folded_at_spawn;
                folded_after.extend(new_ids_for_cache);

                log::info!(
                    "tracematch: [SectionDetection] Unified cached incremental complete: {} sections",
                    sections_to_send.len()
                );

                // Ship the cache update BEFORE the main result. `recv`/`poll_state`
                // on the main channel is the caller's signal to `take_cache`, so
                // sending the cache first guarantees it is present by then.
                cache_tx
                    .send(CacheUpdate {
                        cache,
                        folded_ids: folded_after,
                    })
                    .ok();

                // No consensus seed here. The accumulator is read only by
                // `sections::incremental`, which the unified arm never calls,
                // so seeding it rebuilds an R-tree and rescans every member
                // track per section for a value nothing consumes.

                // Signal saving phase before sending results for DB persistence
                progress_clone.set_phase("saving", 1);
                tx.send((sections_to_send, all_activity_ids)).ok();
            } else {
                // Full detection mode with batching for large datasets.
                // Cap full pairwise detection at BATCH_CAP activities per batch.
                // Subsequent batches use incremental detection against results from prior batches.
                const BATCH_CAP: usize = 500;

                if tracks.len() <= BATCH_CAP {
                    let mut sections_to_send = match section_config.detection_method {
                        tracematch::DetectionMethod::Corridor => {
                            log::info!(
                                "tracematch: [SectionDetection] Corridor detection on {} tracks",
                                tracks.len()
                            );
                            tracematch::detect_sections_corridor(
                                &tracks,
                                &sport_map,
                                &section_config,
                            )
                        }
                        tracematch::DetectionMethod::FlowGraph => {
                            log::info!(
                                "tracematch: [SectionDetection] Flow graph detection on {} tracks",
                                tracks.len()
                            );
                            tracematch::detect_sections_flow_graph(
                                &tracks,
                                &sport_map,
                                &section_config,
                            )
                        }
                        tracematch::DetectionMethod::DensityGrid => {
                            log::info!(
                                "tracematch: [SectionDetection] Density grid detection on {} tracks",
                                tracks.len()
                            );
                            let result = tracematch::detect_sections_multiscale_with_progress(
                                &tracks,
                                &sport_map,
                                &groups,
                                &section_config,
                                Arc::new(ClusteringAwareProgress::new(progress_clone.clone())),
                            );
                            log::info!(
                                "tracematch: [SectionDetection] {} sections, {} potentials",
                                result.sections.len(),
                                result.potentials.len()
                            );
                            result.sections
                        }
                        tracematch::DetectionMethod::Unified => unreachable!(
                            "Unified runs the order-free incremental in the branch above"
                        ),
                    };

                    log::info!(
                        "tracematch: [SectionDetection] Detection complete: {} sections",
                        sections_to_send.len()
                    );
                    seed_consensus_state(
                        &mut sections_to_send,
                        &tracks,
                        section_config.proximity_threshold,
                    );

                    // Signal saving phase before sending results for DB persistence
                    progress_clone.set_phase("saving", 1);
                    tx.send((sections_to_send, all_activity_ids)).ok();
                } else {
                    // Large dataset: process in batches
                    let num_batches = (tracks.len() + BATCH_CAP - 1) / BATCH_CAP;
                    log::info!(
                        "tracematch: [SectionDetection] Batched mode: {} activities in {} batches of up to {}",
                        tracks.len(),
                        num_batches,
                        BATCH_CAP
                    );

                    // Batch 1: full detection on first BATCH_CAP activities
                    let batch1_tracks = &tracks[..BATCH_CAP.min(tracks.len())];
                    let result = tracematch::detect_sections_multiscale_with_progress(
                        batch1_tracks,
                        &sport_map,
                        &groups,
                        &section_config,
                        Arc::new(ClusteringAwareProgress::new(progress_clone.clone())),
                    );

                    let mut accumulated_sections = result.sections;
                    log::info!(
                        "tracematch: [SectionDetection] Batch 1/{}: {} sections from {} activities",
                        num_batches,
                        accumulated_sections.len(),
                        batch1_tracks.len()
                    );

                    // Subsequent batches: incremental detection against accumulated sections
                    let mut batch_start = BATCH_CAP;
                    let mut batch_num = 2;
                    while batch_start < tracks.len() {
                        let batch_end = (batch_start + BATCH_CAP).min(tracks.len());
                        let batch_tracks = &tracks[batch_start..batch_end];

                        log::info!(
                            "tracematch: [SectionDetection] Batch {}/{}: {} new activities against {} sections",
                            batch_num,
                            num_batches,
                            batch_tracks.len(),
                            accumulated_sections.len()
                        );

                        let incr_result =
                            tracematch::sections::incremental::detect_sections_incremental(
                                batch_tracks,
                                &accumulated_sections,
                                &tracks, // all tracks for consensus
                                &sport_map,
                                &groups,
                                &section_config,
                                Arc::new(ClusteringAwareProgress::new(progress_clone.clone())),
                            );

                        // Replace accumulated with updated + new
                        accumulated_sections = incr_result.updated_sections;
                        accumulated_sections.extend(incr_result.new_sections);

                        log::info!(
                            "tracematch: [SectionDetection] Batch {}/{}: now {} total sections ({} matched, {} unmatched)",
                            batch_num,
                            num_batches,
                            accumulated_sections.len(),
                            incr_result.matched_activity_ids.len(),
                            incr_result.unmatched_activity_ids.len(),
                        );

                        batch_start = batch_end;
                        batch_num += 1;
                    }

                    log::info!(
                        "tracematch: [SectionDetection] Batched detection complete: {} sections",
                        accumulated_sections.len()
                    );

                    // Tier 2: seed consensus_state. Sections from the first
                    // batch's full detection arrive with None; subsequent
                    // batches' updated-sections already carry accumulators,
                    // so seed is a no-op for those and only pays for the
                    // first-batch sections and any new sections from later
                    // batches' unmatched-pool detections.
                    seed_consensus_state(
                        &mut accumulated_sections,
                        &tracks,
                        section_config.proximity_threshold,
                    );

                    // Signal saving phase before sending results for DB persistence
                    progress_clone.set_phase("saving", 1);
                    tx.send((accumulated_sections, all_activity_ids)).ok();
                }
            }
        });

        SectionDetectionHandle {
            receiver: rx,
            cache_receiver: cache_rx,
            progress,
        }
    }

    /// Hot path of apply_sections: replace in-memory sections, persist
    /// them to SQLite, clear the relevant LRU caches. Returns as soon as
    /// the new section set is durably saved and queryable from in-memory
    /// reads. Does NOT do the cross-sport merge or the indicator
    /// recompute - those are the deferred tail
    /// (`apply_sections_finalize`) so callers that want the UI interactive
    /// can return after `_save` and do the tail on a background thread.
    ///
    /// If `save_sections` fails the prior in-memory state is restored -
    /// the rollback contract is unchanged from the monolithic
    /// `apply_sections`.
    pub fn apply_sections_save(&mut self, sections: Vec<FrequentSection>) -> SqlResult<()> {
        // B2: remap the raw detection batch through the assign-once identity +
        // hysteresis registry into the id-stable, churn-damped VISIBLE catalogue
        // the app renders. Run on a clone of the registry so a failed save never
        // advances identity past what is durable in the DB; commit it only on Ok.
        let mut trial_identity = self.identity.clone();
        let raw_for_convergence = sections.clone();
        let (mut visible, events) = self.section_identity_apply_into(&mut trial_identity, sections);
        // The identity layer owns only the auto catalogue. Carry the durable
        // user-defined sections (custom + accepted) already held in memory across
        // the apply so get_sections() keeps mirroring the full visible catalogue —
        // the in-memory matcher must keep seeing custom sections after a detect.
        // save_sections skips them (durable rows), so this touches only the view.
        for s in &self.sections {
            if s.is_user_defined && !visible.iter().any(|v| v.id == s.id) {
                visible.push(s.clone());
            }
        }
        let old_sections = std::mem::replace(&mut self.sections, visible);
        // Make the trial registry live BEFORE the save: `save_sections` writes its
        // blob (B4) inside the same transaction as the catalogue, so the two
        // commit atomically and a crash cannot leave the registry ahead of the DB.
        let old_identity = std::mem::replace(&mut self.identity, trial_identity);
        match self.save_sections_with_events(&events) {
            Ok(()) => {
                self.raw_sections = Some(raw_for_convergence);
                self.sections_dirty = false;
                // Clear activity_traces to prevent memory leak. These GPS
                // traces were used for consensus computation but aren't
                // persisted; shrink_to_fit() releases the bucket
                // allocation too.
                for section in &mut self.sections {
                    section.activity_traces.clear();
                    section.activity_traces.shrink_to_fit();
                }
                self.section_cache.clear();
                self.invalidate_perf_cache();
                Ok(())
            }
            Err(e) => {
                // The transaction rolled back both the catalogue and the blob;
                // roll the in-memory registry back to match.
                self.sections = old_sections;
                self.identity = old_identity;
                Err(e)
            }
        }
    }

    /// Cache-aware hot save: `apply_sections_save`, then advance the Unified
    /// evidence cache iff the save succeeded. `update` is the worker's
    /// `CacheUpdate` for the Unified path, or None for the legacy detectors and
    /// the no-new-activities short-circuit (nothing to advance — the cache is
    /// left as-is).
    ///
    /// The consistency contract: the cache must never get ahead of the applied
    /// catalogue. On success the returned cache exactly reflects the sections
    /// just persisted, so it is adopted wholesale. On failure `apply_sections_save`
    /// has already rolled the in-memory sections back to the prior state, so the
    /// cache is dropped (`invalidate_evidence_cache`) and the next detect
    /// cold-rebatches from the real DB state rather than from a catalogue that was
    /// never durably saved.
    pub fn apply_sections_save_with_cache(
        &mut self,
        sections: Vec<FrequentSection>,
        update: Option<CacheUpdate>,
    ) -> SqlResult<()> {
        match self.apply_sections_save(sections) {
            Ok(()) => {
                if let Some(u) = update {
                    self.section_evidence_cache = u.cache;
                    self.cache_folded_ids = u.folded_ids;
                }
                Ok(())
            }
            Err(e) => {
                self.invalidate_evidence_cache();
                Err(e)
            }
        }
    }

    /// Cache-aware equivalent of `apply_sections`: the hot save-with-cache
    /// followed by the deferred finalize tail. The harness/test ingest path uses
    /// this so a Unified drip actually exercises the cache; production splits the
    /// two halves across separate engine locks (see `objects/detection.rs`).
    pub fn apply_sections_with_cache(
        &mut self,
        sections: Vec<FrequentSection>,
        update: Option<CacheUpdate>,
    ) -> SqlResult<()> {
        self.apply_sections_save_with_cache(sections, update)?;
        self.apply_sections_finalize();
        Ok(())
    }

    /// Deferred tail of apply_sections: activity-indicator recompute. It is
    /// best-effort (errors are logged, not returned) because it doesn't affect
    /// the ability to query the just-saved sections, it only refines derived
    /// state. Safe to invoke on a background thread after
    /// `apply_sections_save` returns.
    pub fn apply_sections_finalize(&mut self) {
        self.apply_sections_finalize_with_progress(None);
    }

    /// Variant that emits phase markers to the supplied progress tracker
    /// so the UI can show "still recomputing indicators" instead of a
    /// frozen-looking 100% bar.
    pub fn apply_sections_finalize_with_progress(
        &mut self,
        progress: Option<&super::super::SectionDetectionProgress>,
    ) {
        if let Some(p) = progress {
            p.set_phase("recomputing_indicators", 1);
        }
        if let Err(e) = self.recompute_activity_indicators() {
            log::warn!(
                "tracematch: [apply_sections_finalize] Indicator recomputation failed: {}",
                e
            );
        }
        if let Some(p) = progress {
            p.increment();
            p.set_phase("complete", 1);
            p.increment();
        }
    }

    /// Apply completed section detection results synchronously: hot save
    /// path followed by the deferred tail. Equivalent to today's pre-Tier
    /// 1.1 single call. Callers that want to keep the UI responsive
    /// during the tail should use `apply_sections_save` followed by
    /// `apply_sections_finalize` on a background thread.
    pub fn apply_sections(&mut self, sections: Vec<FrequentSection>) -> SqlResult<()> {
        self.apply_sections_save(sections)?;
        self.apply_sections_finalize();
        Ok(())
    }
}
