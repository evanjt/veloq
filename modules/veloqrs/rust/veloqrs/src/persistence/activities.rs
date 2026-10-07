//! Activity management: CRUD, GPS tracks, signatures, spatial queries, time streams.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, LazyLock};

use rstar::{AABB, RTree};
use rusqlite::{OptionalExtension, Result as SqlResult, params, types::Type};

use super::codec;
use super::codec::{TrackRead, TrackWalk};
use super::{ActivityBoundsEntry, ActivityMetadata, PersistentEngine};
use crate::net::types::{ActivityCensusEntry, ActivityRecord};
use crate::{
    ActivityMatchInfo, ActivityMetrics, Bounds, FrequentSection, GpsPoint, RouteSignature,
};
use crate::{LibraryCoverage, RangeCoverage};

fn metrics_from_body(raw: &str, date: i64, id: &str) -> SqlResult<crate::FfiActivityMetrics> {
    let mut record: ActivityRecord = serde_json::from_str(raw)
        .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
    record.id = id.to_string();
    Ok(super::fitness::metrics_input(
        crate::objects::sync::activity_metrics_row(record, date),
    ))
}

struct RemovalMemory {
    identity: super::sections::SectionIdentity,
    sections: Vec<FrequentSection>,
    /// The removal took a track, so detection runs again over the rest.
    had_track: bool,
}

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
/// Elevation provenance a stored track can be in: `elevation_state` 3.
///
/// Distinct from `UNAVAILABLE` on purpose. That value is upstream answering
/// that it holds no altitude for the ride, which the lift rescue reads as
/// fact. This one is nobody ever getting an answer at all, so it makes no
/// claim about the ground.
pub const ELEVATION_STATE_UNREACHABLE: u8 = 3;

/// Which altitude series a stored track's points carry: `elevation_source` 0.
/// Every row stored before the column existed, and every track whose points
/// carry no elevation at all.
pub const ELEVATION_SOURCE_UNKNOWN: u8 = 0;
/// `elevation_source` 1: upstream's corrected series, `fixed_altitude`.
pub const ELEVATION_SOURCE_CORRECTED: u8 = 1;
/// `elevation_source` 2: the series the device recorded, `altitude`.
pub const ELEVATION_SOURCE_DEVICE: u8 = 2;
/// `elevation_source` 3: altitude recorded on the phone by this app.
pub const ELEVATION_SOURCE_RECORDED: u8 = 3;

/// How far a stored elevation may sit from the series it was stored from: half
/// the codec's 0.1 m step, and a hair for the float arithmetic.
const STORED_ELEVATION_TOLERANCE_M: f64 = 0.05 + 1e-6;

/// Whether `points` carry `elevations` sample for sample: the same length, an
/// elevation within the codec's rounding wherever the series has a finite
/// sample, and none wherever it has not.
fn carries_series(points: &[GpsPoint], elevations: &[f64]) -> bool {
    points.len() == elevations.len()
        && points
            .iter()
            .zip(elevations)
            .all(|(p, e)| match (p.elevation, e.is_finite()) {
                (Some(stored), true) => (stored - e).abs() <= STORED_ELEVATION_TOLERANCE_M,
                (None, false) => true,
                _ => false,
            })
}

/// What [`PersistentEngine::settle_elevation_source`] did with one track.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SourceSettled {
    /// The points carry the series, and it is recorded.
    Recorded,
    /// The points carry something else, so the track is owed elevation again.
    HandedBack,
    /// No fetched track of unknown series is stored under the id any more.
    Missing,
}

/// The series a set of points was built from, as the writer that built them
/// knows it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ElevationSeries {
    Corrected,
    Device,
    Recorded,
}

impl ElevationSeries {
    /// The upstream series `parse_streams` chose, from its `altitude_is_fixed`.
    pub fn upstream(altitude_is_fixed: bool) -> Self {
        if altitude_is_fixed {
            Self::Corrected
        } else {
            Self::Device
        }
    }
}

/// The `elevation_source` a stored track records. It follows the points the
/// engine keeps, so a track no series could elevate is unknown rather than a
/// claim about a series it does not carry.
pub fn elevation_source_of(points: &[GpsPoint], series: ElevationSeries) -> u8 {
    if !points.iter().any(|p| p.elevation.is_some()) {
        return ELEVATION_SOURCE_UNKNOWN;
    }
    match series {
        ElevationSeries::Corrected => ELEVATION_SOURCE_CORRECTED,
        ElevationSeries::Device => ELEVATION_SOURCE_DEVICE,
        ElevationSeries::Recorded => ELEVATION_SOURCE_RECORDED,
    }
}

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
    /// Asked until the backfill gave up, and upstream never answered.
    pub unreachable: u64,
}

impl ElevationStateCounts {
    /// Tracks in a state other than `fetched`, ie. the size of the remaining
    /// backfill plus the activities that can never be filled.
    pub fn not_fetched(&self) -> u64 {
        self.unknown + self.unavailable + self.unreachable
    }
}

/// The settings key holding the oldest date this athlete has asked the device
/// to hold. Keyed by athlete so a second sign-in never reads the first's.
pub(crate) const ACTIVITY_WINDOW_KEY_PREFIX: &str = "__activity_window_oldest:";

fn activity_window_key(athlete_id: &str) -> String {
    format!("{ACTIVITY_WINDOW_KEY_PREFIX}{athlete_id}")
}

/// An activity a section or dormant record names is not the engine's to remove.
const REFERENCE_ACTIVITY_EXCLUSION: &str = "id NOT IN (SELECT representative_activity_id \
    FROM sections WHERE representative_activity_id IS NOT NULL) \
    AND id NOT IN (SELECT rep_activity_id FROM section_geometry \
    WHERE rep_activity_id IS NOT NULL) \
    AND id NOT IN (SELECT json_extract(value, '$.ground.rep_activity_id') \
    FROM json_each(COALESCE((SELECT value FROM settings \
    WHERE key = '__record_restore_pending'), '[]')) \
    WHERE json_extract(value, '$.ground.rep_activity_id') IS NOT NULL)";

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
    // An excluded junction row is the athlete taking a lap out of a section,
    // and the re-detect re-mints these sections under the same ids.
    super::sections::hold_auto_exclusions_through_wipe(db)?;
    // A custom section's replacement of detected ground is the athlete's
    // decision too, and the re-detect mints that ground again.
    super::sections::hold_supersessions_through_wipe(db)?;
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
    // Nothing cascades from `sections` into the indicators, and with route
    // matching off no detect runs to rewrite them, so a record on a deleted
    // section went on marking the ride a PR. Every row the engine writes
    // targets a section; the legacy route kinds target route groups, which
    // this wipe empties whole, so they go too.
    db.execute(
        "DELETE FROM activity_indicators WHERE target_id NOT IN (SELECT id FROM sections)",
        [],
    )?;
    // An excluded match row is the athlete taking one attempt out of a route,
    // and the `activity_matches` entry in `persistence/tables.rs` declares it
    // the record part of an otherwise derived table. The detector already holds
    // this policy in `save_groups_txn`, "a carried id keeps them; only a
    // dissolved route loses them", and `recompute_groups` in
    // `persistence/routes.rs` snapshots and restores across its own delete.
    // This wipe was the one that did not,
    // so a clear took every exclusion the athlete had made.
    //
    // The spared row outlives its group until the next regroup re-mints one.
    // Nothing shows it: every read either joins through `sections` and
    // `section_activities`, which this wipe empties, or is keyed by a route id
    // that now has no group.
    db.execute_batch(
        "DELETE FROM route_groups;
         DELETE FROM activity_matches WHERE excluded = 0;
         DELETE FROM overlap_cache;",
    )?;
    // The generation stays where it was, so the layer would still read as
    // current for the groups just deleted.
    super::route_lines::clear(db)?;
    Ok(sections)
}

/// What one activity's sweep deletes.
#[derive(Debug, Clone, PartialEq)]
enum SweepGround {
    /// Every tile in the box at every zoom, for a removed activity, whose
    /// bounds are all that survive its delete.
    Bounds(Bounds),
    /// The tiles `tiles_along_track` gives for the track at every zoom, which
    /// are the tiles a pass draws it into and so the only ones it changed.
    Track(Vec<GpsPoint>),
}

/// Delete the heatmap tiles under `ground`, on a thread of its own, then mark
/// the set dirty and ask for the pass that redraws it.
///
/// Tile invalidation is file deletes on disk, tens of thousands of them for a
/// long ride's box. Run where the caller stands it holds the engine write
/// lock, or the JS thread, for the whole walk and convoys every foreground
/// read behind it. The sweep needs the path and the ground and never the
/// engine, so it takes neither until it asks for the pass.
///
/// The whole set is handed over at once rather than one call per activity: a
/// census reconcile removes as many activities as the athlete deleted, and a
/// thread apiece is worse than the hold it replaces.
fn spawn_tile_sweep(tiles_path: String, ground: Vec<SweepGround>, reason: &'static str) {
    let count = ground.len();
    let registration = crate::persistence::register_tile_sweep();
    let cancel = registration.token();
    // Read under the caller's engine lock, so the pass is asked of this
    // library and not of one signed in while the sweep ran.
    let install = crate::persistence::engine_install();
    crate::threads::spawn_named("veloq-sweep", move || {
        // Held for the life of the sweep, the pass request included. Dropping
        // it takes this sweep's registration and leaves every sibling's, so a
        // sweep that ends cannot make another one unstoppable.
        let _registration = registration;
        let config = crate::tiles::HeatmapConfig::default();
        let path = std::path::Path::new(&tiles_path);
        let margin = 0.001; // ~111m at equator, for points that bled into a neighbour
        let mut total_deleted = 0;
        let mut stopped = false;
        let mut swept: Vec<crate::tiles::TileSpan> = Vec::new();
        for one in &ground {
            // Per activity, which is the sweep's only boundary: one is a
            // bounded walk of one activity's tiles, and there are as many of
            // them as the caller handed over.
            if cancel.is_cancelled() {
                stopped = true;
                break;
            }
            swept.extend(match one {
                SweepGround::Bounds(bound) => crate::tiles::bounds_spans(
                    bound.min_lat - margin,
                    bound.max_lat + margin,
                    bound.min_lng - margin,
                    bound.max_lng + margin,
                    config.min_zoom,
                    config.max_zoom,
                ),
                SweepGround::Track(track) => {
                    crate::tiles::track_spans(track, config.min_zoom, config.max_zoom)
                }
            });
            total_deleted += match one {
                SweepGround::Bounds(bound) => crate::tiles::invalidate_tiles_in_bounds(
                    path,
                    bound.min_lat - margin,
                    bound.max_lat + margin,
                    bound.min_lng - margin,
                    bound.max_lng + margin,
                    config.min_zoom,
                    config.max_zoom,
                ),
                SweepGround::Track(track) => crate::tiles::invalidate_tiles_along_track(
                    path,
                    track,
                    config.min_zoom,
                    config.max_zoom,
                ),
            };
        }
        // Marked after the sweep, never before. A mark set first can be cleared
        // by a generation run that finishes between the mark and the delete, and
        // nothing then redraws the ground the sweep took.
        //
        // A cancelled sweep marks too, and must: it deleted tiles for the
        // ground it reached, and the ground it never reached still changed.
        // Either way the set is owed a redraw.
        crate::persistence::tiles::mark_tiles_swept(&tiles_path, &swept);
        if stopped {
            // The athlete stopped the heatmap work, so nothing asks for more.
            log::info!(
                "[heatmap] Sweep cancelled after {} tiles, the set stays dirty",
                total_deleted
            );
            return;
        }
        if total_deleted > 0 {
            log::info!(
                "[heatmap] Invalidated {} tiles for {} {}",
                total_deleted,
                count,
                reason
            );
        }
        // Nothing draws a tile on demand, so what this deleted is a hole until
        // a pass redraws it. A pass already running refuses this one and runs
        // again when it ends, because the mark above moved under it.
        crate::persistence::tiles::request_tile_pass(&tiles_path, install);
    });
}

/// The tables keyed on an activity id that carry no foreign key to it, so a
/// removal has to clear them by hand. `overlap_cache` holds a pair, so it is
/// cleared by its own statement.
const ACTIVITY_KEYED_TABLES: &[&str] = &[
    "activity_bodies",
    "activity_metrics",
    "activity_indicators",
    "activity_matches",
    "activity_streams",
    "activity_stream_backfill",
    "stream_bodies",
    "interval_bodies",
    "exercise_sets",
    "fit_file_status",
    "eftp_changes",
    "section_forced_matches",
    "section_rank_dirty_activity",
];

/// Record that an activity of this one's sport left intervals.icu now, under
/// `CURVE_REMOVED_AT_PREFIX`. Runs before the rows go, since it reads them.
///
/// The sport comes from the metrics row, else the track's, else the stored
/// body's type: an activity with no GPS has no `activities` row, and one
/// stored only as a body has no metrics row, and both depart all the same. One whose
/// departure was already stamped while it was kept for a section stamps
/// nothing, since the curves have been fetched again without it.
fn stamp_curve_removal(conn: &rusqlite::Connection, id: &str) -> SqlResult<()> {
    conn.execute(
        "INSERT INTO settings (key, value, updated_at)
         SELECT ?1 || sport, strftime('%s', 'now'), strftime('%s', 'now')
         FROM (SELECT COALESCE(
                   (SELECT sport_type FROM activity_metrics WHERE activity_id = ?2),
                   (SELECT sport_type FROM activities WHERE id = ?2),
                   (SELECT json_extract(raw, '$.type') FROM activity_bodies
                    WHERE activity_id = ?2)) AS sport)
         WHERE sport IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM settings WHERE key = ?3 || ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                        updated_at = excluded.updated_at",
        params![
            super::settings_keys::CURVE_REMOVED_AT_PREFIX,
            id,
            super::settings_keys::CURVE_DEPARTED_PREFIX
        ],
    )?;
    Ok(())
}

/// Stamp the sport of a departure the census keeps for a section, once.
///
/// The row stays, so every later census finds it gone again, and a stamp on
/// each would refetch the family's curves on every sync. The marker says the
/// departure has been counted, and is written in the same transaction as the
/// stamp so neither lands without the other.
fn stamp_kept_departure(conn: &rusqlite::Connection, id: &str) -> SqlResult<()> {
    stamp_curve_removal(conn, id)?;
    conn.execute(
        "INSERT INTO settings (key, value, updated_at)
         VALUES (?1 || ?2, strftime('%s', 'now'), strftime('%s', 'now'))
         ON CONFLICT(key) DO NOTHING",
        params![super::settings_keys::CURVE_DEPARTED_PREFIX, id],
    )?;
    Ok(())
}

/// Whether a removal leaves what the athlete decided about the activity.
///
/// An activity gone upstream takes its decisions with it. One a clear drops
/// only because it falls outside the window is still on intervals.icu and
/// returns when the range widens, so its decisions stay: the `Record` tables
/// and the record part of a derived one, as `persistence/tables.rs` declares
/// them.
#[derive(Clone, Copy, PartialEq, Eq)]
enum KeepAthleteRows {
    Yes,
    No,
}

/// Delete the rows keyed on a removed activity that the foreign key cascade
/// does not reach. Every path that removes an activity calls this, so the
/// list is read in one place.
///
/// Only four tables carry the foreign key, so the cascade reaches
/// `gps_tracks`, `signatures`, `time_streams` and `section_activities` and no
/// further. The rest were stranded, and `activity_bodies` is the feed, so a
/// removed activity went on rendering on the home screen with its metrics
/// intact. Deleted here rather than given foreign keys of their own: this runs
/// inside the caller's transaction, and ten new keys on live tables is a
/// migration on every install.
fn delete_activity_keyed_rows(
    db: &rusqlite::Connection,
    id: &str,
    keep: KeepAthleteRows,
) -> SqlResult<()> {
    for table in ACTIVITY_KEYED_TABLES {
        let sql = match (keep, super::tables::declaration_of(table)) {
            (KeepAthleteRows::No, _) => format!("DELETE FROM {table} WHERE activity_id = ?1"),
            (KeepAthleteRows::Yes, Some(t)) if t.class == super::tables::TableClass::Record => {
                continue;
            }
            // A derived table with a record part carries the athlete's
            // decision in its `excluded` column.
            (KeepAthleteRows::Yes, Some(t)) if t.record_part.is_some() => {
                format!("DELETE FROM {table} WHERE activity_id = ?1 AND excluded = 0")
            }
            (KeepAthleteRows::Yes, _) => format!("DELETE FROM {table} WHERE activity_id = ?1"),
        };
        db.prepare_cached(&sql)?.execute(params![id])?;
    }
    // The overlap cache holds a pair, so the activity is either side of it.
    db.prepare_cached("DELETE FROM overlap_cache WHERE activity_a = ?1 OR activity_b = ?1")?
        .execute(params![id])?;
    db.prepare_cached("DELETE FROM settings WHERE key = ?1 || ?2")?
        .execute(params![super::settings_keys::CURVE_DEPARTED_PREFIX, id])?;
    Ok(())
}

/// The ground a heatmap tile sweep is owed for: the tracks of the activities
/// new to the catalogue, and for each one whose track changed, its new track
/// and the ground it covered before.
///
/// The batch already draws this line for the processed set, where a verbatim
/// re-ingest is not a mutation and has to stay idempotent. The tile sweep did
/// not ask, so an unchanged activity had the tiles it reaches deleted, tiles
/// that were still correct, and the whole set marked dirty for a redraw
/// nothing needed. A routine sync is mostly unchanged activities.
///
/// A track and not its box: a loop round a town has the town inside its box,
/// and the store would otherwise delete every home tile it never crosses.
fn ground_needing_tile_sweep(
    batch: &[(String, Vec<GpsPoint>, String)],
    known_before: &std::collections::HashSet<String>,
    covered_before: &HashMap<String, SweepGround>,
) -> Vec<SweepGround> {
    let mut owed = Vec::new();
    for (id, coords, _) in batch {
        let changed = covered_before.get(id);
        if known_before.contains(id) && changed.is_none() {
            continue;
        }
        owed.push(SweepGround::Track(coords.clone()));
        if let Some(before) = changed {
            owed.push(before.clone());
        }
    }
    owed
}

/// One signature from the columns its row carries. A corrupt points blob names
/// itself in the log before the read gives up, so route grouping never drops an
/// activity in silence.
fn signature_from_parts(
    id: &str,
    points_blob: &[u8],
    start_point: GpsPoint,
    end_point: GpsPoint,
    total_distance: f64,
) -> Option<RouteSignature> {
    let points = TrackRead::from_blob(points_blob).into_option("load_signature_from_db", id)?;
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

/// Signature reads over a connection rather than the engine.
///
/// The query touches nothing the engine holds in memory, which is what lets a
/// feed card's preview line come from a pooled read-only connection while a
/// write is in flight. The method above is the same function on the write
/// connection.
pub(crate) mod pooled {
    use super::{
        Bounds, CENSUS_ROW_OWED, CENSUS_TRACK_SETTLED_OUT, CENSUS_TRACK_UNAVAILABLE,
        LibraryCoverage, RangeCoverage, RouteSignature, SqlResult, signature_from_parts,
    };
    use rusqlite::{Connection, OptionalExtension, params};
    use tracematch::GpsPoint;

    /// Every activity id the library holds: the rows the engine's in-memory
    /// catalogue is loaded from.
    pub(crate) fn activity_ids(conn: &Connection) -> SqlResult<Vec<String>> {
        let mut stmt = conn.prepare_cached("SELECT id FROM activities")?;
        stmt.query_map([], |row| row.get(0))?.collect()
    }

    /// Whether the library holds this activity.
    pub(crate) fn has_activity(conn: &Connection, id: &str) -> SqlResult<bool> {
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM activities WHERE id = ?)",
            params![id],
            |row| row.get(0),
        )
    }

    /// How many activities the library holds, GPS or not: every metrics row.
    /// The screen reads report this one.
    pub(crate) fn library_count(conn: &Connection) -> SqlResult<u32> {
        conn.query_row("SELECT COUNT(*) FROM activity_metrics", [], |row| {
            row.get(0)
        })
    }

    /// How many activities the engine's mirrored set holds: those with a GPS
    /// row. The activity set exports and the spatial index report this one.
    pub(crate) fn activity_count(conn: &Connection) -> SqlResult<u32> {
        conn.query_row("SELECT COUNT(*) FROM activities", [], |row| row.get(0))
    }

    const VIEWPORT_SQL: &str = "SELECT id FROM activities
         WHERE min_lat <= ?2 AND max_lat >= ?1 AND min_lng <= ?4 AND max_lng >= ?3";

    /// The activities whose stored bounds intersect a window, edges included:
    /// the rule the engine's spatial index applies. A window given with its
    /// corners swapped is read as the box between them.
    pub(crate) fn activities_in_viewport(conn: &Connection, bounds: &Bounds) -> Vec<String> {
        let (min_lat, max_lat) = ordered(bounds.min_lat, bounds.max_lat);
        let (min_lng, max_lng) = ordered(bounds.min_lng, bounds.max_lng);
        let run = || -> rusqlite::Result<Vec<String>> {
            let mut stmt = conn.prepare_cached(VIEWPORT_SQL)?;
            stmt.query_map(params![min_lat, max_lat, min_lng, max_lng], |row| {
                row.get(0)
            })?
            .collect()
        };
        run().unwrap_or_else(|e| {
            log::warn!("veloqrs: [maps] viewport read failed: {}", e);
            Vec::new()
        })
    }

    fn ordered(a: f64, b: f64) -> (f64, f64) {
        if a <= b { (a, b) } else { (b, a) }
    }

    /// `EXPLAIN QUERY PLAN` detail lines for the viewport read.
    #[cfg(test)]
    pub(crate) fn viewport_query_plan(conn: &Connection) -> Vec<String> {
        let mut stmt = conn
            .prepare(&format!("EXPLAIN QUERY PLAN {VIEWPORT_SQL}"))
            .unwrap();
        stmt.query_map(params![0.0, 1.0, 0.0, 1.0], |row| row.get::<_, String>(3))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    pub(crate) fn window_is_covered(
        conn: &Connection,
        athlete_id: &str,
        oldest: &str,
        newest: &str,
    ) -> bool {
        if athlete_id.is_empty() {
            return false;
        }
        let known: i64 = match conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM activity_census WHERE athlete_id = ?)",
            params![athlete_id],
            |row| row.get(0),
        ) {
            Ok(known) => known,
            Err(e) => {
                log::warn!("veloqrs: [census] coverage probe failed: {}", e);
                return false;
            }
        };
        if known == 0 {
            return false;
        }
        let owed: i64 = match conn.query_row(
            &format!(
                "SELECT COUNT(*) FROM activity_census c
                 WHERE c.athlete_id = ?1
                   AND c.start_date_local IS NOT NULL
                   AND date(c.start_date_local) >= date(?2)
                   AND date(c.start_date_local) <= date(?3)
                   AND ({owed})",
                owed = CENSUS_ROW_OWED.as_str(),
            ),
            params![athlete_id, oldest, newest],
            |row| row.get(0),
        ) {
            Ok(owed) => owed,
            Err(e) => {
                log::warn!("veloqrs: [census] coverage read failed: {}", e);
                return false;
            }
        };
        owed == 0
    }

    pub(crate) fn range_coverage(
        conn: &Connection,
        athlete_id: &str,
        oldest: &str,
        newest: &str,
    ) -> RangeCoverage {
        if athlete_id.is_empty() {
            return RangeCoverage::NotFetched;
        }
        let counted: SqlResult<(i64, i64)> = conn.query_row(
            &format!(
                "SELECT COUNT(*), COUNT(*) FILTER (WHERE {owed})
                 FROM activity_census c
                 WHERE c.athlete_id = ?1
                   AND c.start_date_local IS NOT NULL
                   AND date(c.start_date_local) >= date(?2)
                   AND date(c.start_date_local) <= date(?3)",
                owed = CENSUS_ROW_OWED.as_str(),
            ),
            params![athlete_id, oldest, newest],
            |row| Ok((row.get(0)?, row.get(1)?)),
        );
        let (inside, owed) = match counted {
            Ok(counted) => counted,
            Err(e) => {
                log::warn!("veloqrs: [census] range coverage read failed: {}", e);
                return RangeCoverage::NotFetched;
            }
        };
        if owed > 0 {
            return RangeCoverage::NotFetched;
        }
        if inside > 0 {
            return RangeCoverage::Loaded;
        }
        // Nothing inside the range. Whether that is an empty range or an
        // unpulled census is the whole question, and only the table as a whole
        // answers it.
        let known: i64 = match conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM activity_census WHERE athlete_id = ?)",
            params![athlete_id],
            |row| row.get(0),
        ) {
            Ok(known) => known,
            Err(e) => {
                log::warn!("veloqrs: [census] range probe failed: {}", e);
                return RangeCoverage::NotFetched;
            }
        };
        if known == 0 {
            RangeCoverage::NotFetched
        } else {
            RangeCoverage::Empty
        }
    }

    /// The oldest date the athlete has asked the device to hold, as `YYYY-MM-DD`.
    ///
    /// The earlier of the default window and what is stored for this athlete.
    /// With no athlete it is the default window.
    /// With nothing stored, an install upgrading from before the window was
    /// recorded reads it off the oldest activity it holds, leaving out the ones
    /// kept only because a section or record names them.
    pub(crate) fn activity_window_oldest(conn: &Connection, athlete_id: &str) -> String {
        let default = (chrono::Local::now().date_naive()
            - chrono::Duration::days(crate::objects::sync::ACTIVITY_DAYS))
        .to_string();
        if athlete_id.is_empty() {
            return default;
        }
        let stored: Option<String> = conn
            .query_row(
                "SELECT value FROM settings WHERE key = ?1",
                params![super::activity_window_key(athlete_id)],
                |row| row.get(0),
            )
            .optional()
            .ok()
            .flatten();
        let held = stored.or_else(|| {
            conn.query_row(
                &format!(
                    "SELECT date(MIN(date), 'unixepoch')
                     FROM (SELECT activity_id AS id, date FROM activity_bodies)
                     WHERE {}",
                    super::REFERENCE_ACTIVITY_EXCLUSION
                ),
                [],
                |row| row.get::<_, Option<String>>(0),
            )
            .ok()
            .flatten()
        });
        match held {
            Some(held) if held < default => held,
            _ => default,
        }
    }

    pub(crate) fn library_coverage(conn: &Connection, athlete_id: &str) -> LibraryCoverage {
        if athlete_id.is_empty() {
            return LibraryCoverage::default();
        }
        let window_oldest = activity_window_oldest(conn, athlete_id);
        let counted: SqlResult<LibraryCoverage> = conn.query_row(
            &format!(
                "SELECT COUNT(*),
                        COUNT(*) FILTER (WHERE NOT ({owed})),
                        COUNT(*) FILTER (WHERE c.has_latlng = 1 AND NOT ({refused})),
                        COUNT(*) FILTER (WHERE c.has_latlng = 1 AND NOT ({refused}) AND EXISTS (
                             SELECT 1 FROM gps_tracks g
                             WHERE g.activity_id = c.intervals_id
                                OR g.activity_id = (SELECT a.id FROM activities a
                                                    WHERE a.intervals_id = c.intervals_id)))
                 FROM activity_census c
                 WHERE c.athlete_id = ?1
                   AND c.start_date_local IS NOT NULL
                   AND date(c.start_date_local) >= date(?2)",
                owed = CENSUS_ROW_OWED.as_str(),
                refused = CENSUS_TRACK_SETTLED_OUT.as_str(),
            ),
            params![athlete_id, window_oldest],
            |row| {
                Ok(LibraryCoverage {
                    upstream: row.get(0)?,
                    fetched: row.get(1)?,
                    tracks_upstream: row.get(2)?,
                    tracks_stored: row.get(3)?,
                })
            },
        );
        match counted {
            Ok(counted) => counted,
            Err(e) => {
                log::warn!("veloqrs: [census] library coverage read failed: {}", e);
                LibraryCoverage::default()
            }
        }
    }

    /// The census ids whose track was refused for good at the version the
    /// census still names.
    pub(crate) fn refused_track_ids(conn: &Connection, athlete_id: &str) -> Vec<String> {
        let read = || -> SqlResult<Vec<String>> {
            let mut stmt = conn.prepare(&format!(
                "SELECT c.intervals_id FROM activity_census c
                 WHERE c.athlete_id = ?1 AND ({refused})",
                refused = super::CENSUS_TRACK_REFUSED,
            ))?;
            stmt.query_map(params![athlete_id], |row| row.get(0))?
                .collect()
        };
        read().unwrap_or_else(|e| {
            log::warn!("veloqrs: [census] refused track read failed: {}", e);
            Vec::new()
        })
    }

    /// The census ids whose track failed the limit of settled runs at the
    /// version the census still names.
    pub(crate) fn unavailable_track_ids(conn: &Connection, athlete_id: &str) -> Vec<String> {
        let read = || -> SqlResult<Vec<String>> {
            let mut stmt = conn.prepare(&format!(
                "SELECT c.intervals_id FROM activity_census c
                 WHERE c.athlete_id = ?1 AND ({unavailable})",
                unavailable = CENSUS_TRACK_UNAVAILABLE.as_str(),
            ))?;
            stmt.query_map(params![athlete_id], |row| row.get(0))?
                .collect()
        };
        read().unwrap_or_else(|e| {
            log::warn!("veloqrs: [census] unavailable track read failed: {}", e);
            Vec::new()
        })
    }

    pub(crate) fn activity_body(conn: &Connection, activity_id: &str) -> Option<String> {
        conn.query_row(
            "SELECT raw FROM activity_bodies WHERE activity_id = ?",
            params![activity_id],
            |row| row.get(0),
        )
        .ok()
    }

    pub(crate) fn activity_bodies(
        conn: &Connection,
        oldest_ts: i64,
        newest_ts: i64,
    ) -> rusqlite::Result<Vec<String>> {
        let mut stmt = conn.prepare(
            "SELECT raw FROM activity_bodies
             WHERE date >= ? AND date <= ?
             ORDER BY date DESC",
        )?;
        stmt.query_map(params![oldest_ts, newest_ts], |row| row.get(0))?
            .collect()
    }

    /// The feed's read: the bodies in a window, newest first, narrowed by a
    /// search and a sport chip, then paged. The match runs over the whole
    /// window before the page is taken, and the count is of every match.
    ///
    /// The name and sport come from `activity_metrics`, which the body write
    /// fills in the same transaction, so a search reads two short columns
    /// rather than parsing every payload. A body the metrics write missed is
    /// matched on its own payload, and one that will not parse matches no
    /// search, as the feed drops it. A payload is copied out only for the
    /// rows on the page.
    pub(crate) fn activity_body_page(
        conn: &Connection,
        query: &crate::FfiActivityBodiesQuery,
    ) -> rusqlite::Result<crate::FfiActivityBodiesPage> {
        let needle = query.needle.trim().to_lowercase();
        let filtered = !needle.is_empty() || !query.sport_groups.is_empty();
        let matches = |name: &str, sport: &str| {
            (query.sport_groups.is_empty()
                || query.sport_groups.contains(&crate::FfiFeedGroup::of(sport)))
                && (needle.is_empty()
                    || name.to_lowercase().contains(&needle)
                    || sport.to_lowercase().contains(&needle))
        };
        let first = query.offset as usize;
        let last = query
            .limit
            .map_or(usize::MAX, |limit| first.saturating_add(limit as usize));

        let mut stmt = conn.prepare_cached(
            "SELECT b.raw, m.name, m.sport_type
             FROM activity_bodies b
             LEFT JOIN activity_metrics m ON m.activity_id = b.activity_id
             WHERE b.date >= ?1 AND b.date <= ?2
             ORDER BY b.date DESC, b.activity_id DESC",
        )?;
        let mut rows = stmt.query(params![
            query.oldest_ts.map_or(i64::MIN, |ts| ts as i64),
            query.newest_ts.map_or(i64::MAX, |ts| ts as i64)
        ])?;
        let mut bodies = Vec::new();
        let mut matched = 0usize;
        while let Some(row) = rows.next()? {
            let hit = !filtered
                || match (
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ) {
                    (Some(name), Some(sport)) => matches(&name, &sport),
                    _ => match serde_json::from_str::<serde_json::Value>(&row.get::<_, String>(0)?)
                    {
                        Ok(body) => matches(
                            body["name"].as_str().unwrap_or_default(),
                            body["type"].as_str().unwrap_or_default(),
                        ),
                        Err(_) => false,
                    },
                };
            if !hit {
                continue;
            }
            if (first..last).contains(&matched) {
                bodies.push(row.get(0)?);
            }
            matched += 1;
        }
        Ok(crate::FfiActivityBodiesPage {
            bodies,
            matched_count: matched as u32,
            has_more: matched > last,
        })
    }

    pub(crate) fn time_stream(conn: &Connection, activity_id: &str) -> Option<Vec<u32>> {
        let blob: Vec<u8> = conn
            .query_row(
                "SELECT times FROM time_streams WHERE activity_id = ?",
                params![activity_id],
                |row| row.get(0),
            )
            .ok()?;
        match super::codec::deserialize(&blob) {
            Ok(times) => Some(times),
            Err(e) => {
                log::error!("time_streams {activity_id}: times read failed: {e}");
                None
            }
        }
    }

    /// Whether a period's activity inputs are complete for the saved athlete.
    /// These timestamps encode local wall time, like `activity_metrics.date`.
    pub(crate) fn period_is_covered(conn: &Connection, start: i64, end: i64) -> bool {
        conn.query_row(
            &format!(
                "SELECT EXISTS(SELECT 1 FROM activity_census WHERE athlete_id = s.value)
                    AND NOT EXISTS (
                        SELECT 1 FROM activity_census c
                        WHERE c.athlete_id = s.value
                          AND unixepoch(c.start_date_local) BETWEEN ?1 AND ?2
                          AND ({owed}))
                 FROM settings s WHERE s.key = '__athlete_id' AND s.value <> ''",
                owed = super::CENSUS_ROW_OWED.as_str(),
            ),
            params![start, end],
            |row| row.get(0),
        )
        .unwrap_or(false)
    }

    /// The activities and moving seconds stored in an inclusive date range,
    /// which is everything the offline estimate scales on.
    pub(crate) fn offline_range_totals(
        conn: &Connection,
        oldest: i64,
        newest: i64,
    ) -> rusqlite::Result<(u32, u64)> {
        conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(moving_time), 0)
             FROM activity_metrics
             WHERE date >= ? AND date <= ?",
            params![oldest, newest],
            |r| Ok((r.get::<_, i64>(0)? as u32, r.get::<_, i64>(1)? as u64)),
        )
    }

    /// The stored signature line for each of `ids`, for the route detail map.
    pub(crate) fn map_signatures_for_ids(
        conn: &Connection,
        ids: &[String],
    ) -> Vec<crate::ffi_types::FfiMapSignature> {
        if ids.is_empty() {
            return Vec::new();
        }

        let placeholders = std::iter::repeat_n("?", ids.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT activity_id, points FROM signatures WHERE activity_id IN ({})",
            placeholders
        );
        let params_vec: Vec<&dyn rusqlite::ToSql> =
            ids.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        map_signatures(conn, &sql, params_vec.as_slice())
    }

    /// Every stored signature line in one query, for the map tab.
    pub(crate) fn all_map_signatures(conn: &Connection) -> Vec<crate::ffi_types::FfiMapSignature> {
        map_signatures(conn, "SELECT activity_id, points FROM signatures", &[])
    }

    /// Signature lines as the map draws them: encoded, with the centre of
    /// their bounds. A row whose blob does not decode, or holds no points, is
    /// skipped.
    fn map_signatures(
        conn: &Connection,
        sql: &str,
        params: &[&dyn rusqlite::ToSql],
    ) -> Vec<crate::ffi_types::FfiMapSignature> {
        let mut stmt = match conn.prepare(sql) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        let rows = match stmt.query_map(params, |row| {
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
            let Some(points) = super::TrackRead::from_blob(&points_blob)
                .into_option("map_signatures", &activity_id)
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
                encoded_coords: crate::persistence::codec::encode_polyline(&points),
                center_lat: center.latitude,
                center_lng: center.longitude,
            });
        }
        result
    }

    /// One activity's stored GPS track.
    ///
    /// The same read as [`super::PersistentEngine::get_gps_track`], on a
    /// connection rather than the engine, and it classifies a bad blob the
    /// same way: a corrupt row is a warning and a `None`, never a track that
    /// was never synced.
    pub(crate) fn gps_track(conn: &Connection, activity_id: &str) -> Option<Vec<GpsPoint>> {
        let blob: Option<Vec<u8>> = match conn
            .prepare_cached("SELECT track_data FROM gps_tracks WHERE activity_id = ?")
            .and_then(|mut stmt| {
                stmt.query_row(params![activity_id], |row| row.get::<_, Vec<u8>>(0))
                    .optional()
            }) {
            Ok(blob) => blob,
            Err(e) => {
                log::warn!("[gps_track] activity {activity_id}: query failed: {e}");
                return None;
            }
        };
        super::TrackRead::from_blob(&blob?).into_option("gps_track", activity_id)
    }

    /// One `activity_metrics` row, in the shape the engine's own tier holds.
    fn metrics_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<crate::ActivityMetrics> {
        Ok(crate::ActivityMetrics {
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
            power_zone_times: None,
            hr_zone_times: None,
        })
    }

    /// One activity's metrics row.
    pub(crate) fn metrics_of(
        conn: &Connection,
        activity_id: &str,
    ) -> Option<crate::ActivityMetrics> {
        conn.query_row(
            "SELECT activity_id, name, date, distance, moving_time, elapsed_time,
                    elevation_gain, avg_hr, avg_power, sport_type,
                    training_load, ftp
             FROM activity_metrics WHERE activity_id = ?",
            params![activity_id],
            metrics_from_row,
        )
        .optional()
        .ok()
        .flatten()
    }

    /// Which of these activities has no usable stored time stream.
    ///
    /// The stored row and the length rule answer alone: the time-stream LRU is
    /// not consulted, because it holds any stored stream whatever its length.
    /// A stream whose `point_count` disagrees with its track's is not in the
    /// track's index space and no lap time can be read off it. A zero-count row
    /// is exempt, since it records that upstream has no `time` for the activity.
    /// The engine's own method is this function over its connection.
    pub(crate) fn activities_missing_time_streams(
        conn: &Connection,
        activity_ids: &[String],
    ) -> Vec<String> {
        if activity_ids.is_empty() {
            return Vec::new();
        }
        let placeholders: Vec<&str> = activity_ids.iter().map(|_| "?").collect();
        let query = format!(
            "SELECT ts.activity_id FROM time_streams ts
             LEFT JOIN gps_tracks g ON g.activity_id = ts.activity_id
             WHERE ts.activity_id IN ({})
               AND (ts.point_count = 0
                    OR g.activity_id IS NULL
                    OR g.point_count = ts.point_count)",
            placeholders.join(",")
        );
        let mut stmt = match conn.prepare(&query) {
            Ok(s) => s,
            // Offering every id again is the safe failure: a refetch is
            // wasted work, a missed one is a blank lap chart.
            Err(_) => return activity_ids.to_vec(),
        };
        let bound: Vec<&dyn rusqlite::ToSql> = activity_ids
            .iter()
            .map(|s| s as &dyn rusqlite::ToSql)
            .collect();
        let stored: std::collections::HashSet<String> = stmt
            .query_map(bound.as_slice(), |row| row.get::<_, String>(0))
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default();
        activity_ids
            .iter()
            .filter(|id| !stored.contains(*id))
            .cloned()
            .collect()
    }

    /// The newest activity by date, with the fields the widget snapshot draws.
    ///
    /// Every metrics row counts, whether or not an activity row exists for it,
    /// and a tie on date goes to the lowest activity id.
    pub(crate) fn latest_metrics(conn: &Connection) -> Option<crate::ActivityMetrics> {
        conn.query_row(
            "SELECT activity_id, name, date, distance, moving_time, elapsed_time,
                    elevation_gain, avg_hr, avg_power, sport_type,
                    training_load, ftp
             FROM activity_metrics ORDER BY date DESC, activity_id ASC LIMIT 1",
            [],
            metrics_from_row,
        )
        .optional()
        .unwrap_or_else(|e| {
            log::warn!("[widget] latest metrics: {e:?}");
            None
        })
    }

    /// Load a stored signature. A corrupt points blob names itself in the log
    /// before the read gives up, so route grouping never drops an activity in
    /// silence.
    pub(crate) fn signature(conn: &Connection, id: &str) -> Option<RouteSignature> {
        // Cached, because a regroup runs this once per activity and the parse
        // is the whole cost of a row that decodes in microseconds.
        let mut stmt = match conn
            .prepare_cached(
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

        signature_from_parts(id, &points_blob, start_point, end_point, total_distance)
    }
}

// Both fragments refer to the activity_census alias `c`.
const CENSUS_ROW_CHANGED: &str = "c.fetched_sync_date IS NOT c.icu_sync_date";

/// A census row whose track was refused for good at the version the census
/// still names. An edit upstream moves `icu_sync_date` off the recorded one,
/// which retires the refusal. Refers to the alias `c`.
const CENSUS_TRACK_REFUSED: &str =
    "c.track_refusal IS NOT NULL AND c.track_refused_sync_date IS c.icu_sync_date";

/// Settled runs a track may fail before the engine gives up on it. A run is
/// settled when the download ended on a server answer rather than on a lost
/// network or a cancel.
pub const TRACK_FAILURE_LIMIT: u32 = 3;

/// A census row whose track failed `TRACK_FAILURE_LIMIT` settled runs at the
/// version the census still names. An edit upstream moves `icu_sync_date` off
/// the recorded one, which retires the mark. Refers to the alias `c`.
static CENSUS_TRACK_UNAVAILABLE: LazyLock<String> = LazyLock::new(|| {
    format!(
        "c.track_fetch_failures >= {TRACK_FAILURE_LIMIT}
         AND c.track_failed_sync_date IS c.icu_sync_date"
    )
});

/// A track no sync asks for or reports: refused for good, or unavailable.
static CENSUS_TRACK_SETTLED_OUT: LazyLock<String> = LazyLock::new(|| {
    format!(
        "({CENSUS_TRACK_REFUSED}) OR ({})",
        *CENSUS_TRACK_UNAVAILABLE
    )
});

/// Why a track can never be stored from what the server returned.
///
/// Only the two refusals that are final: a failed fetch is not one, and is
/// not representable here, so it cannot be recorded by mistake.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrackRefusalKind {
    /// The response carried no `latlng` series.
    NoTrack,
    /// The series is under two storable points.
    TooShort,
}

impl TrackRefusalKind {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            TrackRefusalKind::NoTrack => "no_track",
            TrackRefusalKind::TooShort => "too_short",
        }
    }
}

static CENSUS_ROW_OWED: LazyLock<String> = LazyLock::new(|| {
    format!(
        "c.fetched_sync_date IS NULL
     OR {CENSUS_ROW_CHANGED}
     OR NOT EXISTS (
          SELECT 1 FROM activity_bodies b
          WHERE b.activity_id = c.intervals_id
             OR b.intervals_id = c.intervals_id
             OR b.activity_id = (SELECT a.id FROM activities a
                                 WHERE a.intervals_id = c.intervals_id))"
    )
});

/// A value no other census run shares, stamped on every row one run writes so
/// the rows it did not write can be deleted afterwards.
///
/// `census_at` defaults to `datetime('now')`, which has one-second resolution,
/// and two pulls inside one second would then be indistinguishable: the second
/// would delete nothing, or the first's leftovers would survive. The counter
/// rides on the wall clock so the column still reads as a time.
fn census_run_stamp() -> String {
    static RUN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let run = RUN.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{now}.{run}")
}

impl PersistentEngine {
    // ========================================================================
    // Loading
    // ========================================================================

    /// Load activity metadata into memory (lightweight).
    pub(super) fn load_metadata(&mut self) -> SqlResult<()> {
        self.activity_metadata.clear();

        // The start point rides along on the same pass. It lives in `signatures`,
        // which is a left join rather than a second query: an activity with no
        // signature yet still has to load, with `None` for its start.
        let mut stmt = self.db.prepare(
            "SELECT a.id, a.sport_type, a.min_lat, a.max_lat, a.min_lng, a.max_lng,
                    s.start_point_lat, s.start_point_lng
             FROM activities a LEFT JOIN signatures s ON s.activity_id = a.id",
        )?;

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
                let start_lat: Option<f64> = row.get(6)?;
                let start_lng: Option<f64> = row.get(7)?;

                self.activity_metadata.insert(
                    id.clone(),
                    ActivityMetadata {
                        id: id.clone(),
                        sport_type,
                        bounds,
                        start_point: start_lat.zip(start_lng),
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
                    training_load, ftp
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
                power_zone_times: None,
                hr_zone_times: None,
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
    ) -> SqlResult<Vec<String>> {
        self.add_activities_batch(vec![(id, coords, sport_type)])
    }

    /// Add multiple activities in a single transaction with one R-tree rebuild.
    ///
    /// Reports the ids whose stored track was replaced with a different one.
    /// Everything derived from a track is stale for exactly those, and the
    /// caller is what announces it: this runs under the engine lock, and a
    /// reader woken here would wake into a lock it cannot take.
    pub fn add_activities_batch(
        &mut self,
        activities: Vec<(String, Vec<GpsPoint>, String)>,
    ) -> SqlResult<Vec<String>> {
        if activities.is_empty() {
            return Ok(Vec::new());
        }

        // An add that REPLACES a previously-synced activity with a
        // DIFFERENT track is a GPS mutation the catalogue must re-derive. Detect
        // it here, before the store overwrites the old track, so the ids can be
        // evicted from the processed set after commit (below). A verbatim
        // re-ingest (identical points) is NOT a mutation and must stay
        // idempotent, so compare the stored track, not just the id.
        //
        // The old track is kept for each one, since the tiles it reached hold
        // heat the new track may no longer lay down, and after the overwrite
        // only its bounds are left.
        let mut covered_before: HashMap<String, SweepGround> = HashMap::new();
        for (id, coords, _) in &activities {
            let Some(known) = self.activity_metadata.get(id) else {
                continue;
            };
            let stored = self.load_gps_track_blob(id);
            if stored
                .as_deref()
                .is_some_and(|stored| codec::track_matches(stored, coords))
            {
                continue;
            }
            let before = match stored.as_deref().map(TrackRead::from_blob) {
                Some(TrackRead::Present(points)) => SweepGround::Track(points),
                // Unreadable or gone: the box is the widest the old heat can be.
                _ => SweepGround::Bounds(known.bounds),
            };
            covered_before.insert(id.clone(), before);
        }
        let mutated_ids: Vec<String> = activities
            .iter()
            .filter(|(id, _, _)| covered_before.contains_key(id))
            .map(|(id, _, _)| id.clone())
            .collect();

        // Read before the loop inserts into the map, or every activity reads
        // as already known and nothing would ever be swept.
        let known_before: std::collections::HashSet<String> = activities
            .iter()
            .filter(|(id, _, _)| self.activity_metadata.contains_key(id))
            .map(|(id, _, _)| id.clone())
            .collect();
        // The climb bests are measured from the track and the sport, so a new
        // track, a different one or a sport change each measures them again.
        let climb_moved: Vec<&str> = activities
            .iter()
            .filter(|(id, _, sport)| {
                !known_before.contains(id)
                    || covered_before.contains_key(id)
                    || self
                        .activity_metadata
                        .get(id)
                        .is_some_and(|known| known.sport_type != *sport)
            })
            .map(|(id, _, _)| id.as_str())
            .collect();

        // The rollback arm every sibling writer has. Without it a failed write
        // left the connection inside the transaction, so every later `BEGIN`
        // failed with "cannot start a transaction within a transaction" and the
        // first sibling that does roll back discarded everything since.
        self.db.execute_batch("BEGIN IMMEDIATE")?;
        let written = self
            .write_activities_batch(&activities)
            .and_then(|written| {
                for id in &climb_moved {
                    super::climb_bests::refresh(&self.db, id)?;
                }
                Ok(written)
            });
        let written = match written {
            Ok(w) => {
                super::commit_write_txn(&self.db)?;
                w
            }
            Err(e) => {
                let _ = self.db.execute_batch("ROLLBACK");
                return Err(e);
            }
        };

        // In-memory only once the rows are on disk, or a rolled-back batch
        // leaves the catalogue claiming activities the database does not hold.
        for (id, metadata, signature) in written {
            if let Some(sig) = signature {
                self.signature_cache.put(id.clone(), sig);
            }
            self.activity_metadata.insert(id, metadata);
        }

        self.rebuild_spatial_index();

        // Evict the mutated activities so the next detect re-analyses them
        // (their new tracks now count as unprocessed). No-op when nothing
        // changed, so a routine re-sync of unchanged activities stays free.
        if !mutated_ids.is_empty() {
            for id in &mutated_ids {
                self.time_streams.pop(id);
            }
            self.evict_processed_activity_ids(&mutated_ids);
        }

        // A re-sync that hands back what is already stored changes nothing a
        // route or section was built from, so it owes no regrouping.
        if !climb_moved.is_empty() {
            self.set_groups_dirty(true);
            self.sections_dirty = true;
        }

        if let Some(tiles_path) = self.heatmap_tiles_path.clone() {
            let ground = ground_needing_tile_sweep(&activities, &known_before, &covered_before);
            if !ground.is_empty() {
                // Tile invalidation deletes files on disk, slow filesystem
                // I/O. Run it on a detached thread so it does not happen while
                // the engine write lock is held, which would convoy every
                // foreground read. The sweep needs only the path and the
                // ground, never `self`.
                spawn_tile_sweep(tiles_path, ground, "new activities");
            }
        }

        Ok(mutated_ids)
    }

    /// Commit all provisional rows before publishing them to any engine reader.
    pub fn save_provisional_activity(
        &mut self,
        id: &str,
        coords: Vec<GpsPoint>,
        body: &crate::FfiActivityBody,
    ) -> SqlResult<()> {
        self.save_provisional_activity_inner(id, &coords, body, false)
    }

    pub(crate) fn try_save_provisional_activity(
        &mut self,
        id: &str,
        coords: &[GpsPoint],
        body: &crate::FfiActivityBody,
    ) -> SqlResult<()> {
        self.save_provisional_activity_inner(id, coords, body, true)
    }

    fn save_provisional_activity_inner(
        &mut self,
        id: &str,
        coords: &[GpsPoint],
        body: &crate::FfiActivityBody,
        nonblocking_begin: bool,
    ) -> SqlResult<()> {
        if body.activity_id != id {
            return Err(rusqlite::Error::InvalidParameterName(
                "provisional activity id mismatch".into(),
            ));
        }
        let metrics = metrics_from_body(&body.raw, body.date as i64, id)?;
        // The recording key is stable. A committed retry has nothing left to write,
        // including the heatmap count, which must only increase once per ride.
        if self.get_activity_body(id).is_some() && self.activity_metrics.contains_key(id) {
            return Ok(());
        }
        if nonblocking_begin {
            self.db.busy_timeout(std::time::Duration::ZERO)?;
        }
        let begin = self.db.execute_batch("BEGIN IMMEDIATE");
        if nonblocking_begin
            && let Err(error) = self.db.busy_timeout(std::time::Duration::from_secs(5))
        {
            if begin.is_ok() {
                let _ = self.db.execute_batch("ROLLBACK");
            }
            return Err(error);
        }
        begin?;
        let result = (|| {
            let written = if coords.is_empty() {
                Vec::new()
            } else {
                let written = self.write_activities_batch(&[(
                    id.to_owned(),
                    coords.to_vec(),
                    metrics.sport_type.clone(),
                )])?;
                // The store resets the series to unknown, so it is recorded
                // after the points. Unknown while a recording keeps no altitude.
                self.record_elevation_source(&[(
                    id.to_owned(),
                    elevation_source_of(coords, ElevationSeries::Recorded),
                )])?;
                super::climb_bests::refresh(&self.db, id)?;
                written
            };
            self.db.execute(
                "INSERT INTO activity_bodies (activity_id, date, raw, updated_at) VALUES (?1, ?2, ?3, strftime('%s', 'now'))
                 ON CONFLICT(activity_id) DO UPDATE SET date=excluded.date, raw=excluded.raw, updated_at=excluded.updated_at",
                params![id, body.date as i64, body.raw],
            )?;
            self.write_activity_metrics(&[&metrics], true)?;
            self.db.execute_batch("COMMIT")?;
            Ok::<_, rusqlite::Error>(written)
        })();
        let written = match result {
            Ok(written) => written,
            Err(error) => {
                let _ = self.db.execute_batch("ROLLBACK");
                return Err(error);
            }
        };
        let ground: Vec<SweepGround> = if written.is_empty() {
            Vec::new()
        } else {
            vec![SweepGround::Track(coords.to_vec())]
        };
        for (id, metadata, signature) in written {
            if let Some(signature) = signature {
                self.signature_cache.put(id.clone(), signature);
            }
            self.activity_metadata.insert(id, metadata);
        }
        let metrics: ActivityMetrics = metrics.into();
        self.activity_metrics.insert(id.to_owned(), metrics);
        self.rebuild_spatial_index();
        self.set_groups_dirty(true);
        self.sections_dirty = true;
        self.invalidate_perf_cache();
        if let Some(path) = self.heatmap_tiles_path.clone()
            && !ground.is_empty()
        {
            spawn_tile_sweep(path, ground, "provisional activity");
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

    /// Remove an activity.
    pub fn remove_activity(&mut self, id: &str) -> SqlResult<()> {
        // Capture bounds before removal for heatmap tile invalidation
        let removed_bounds = self.activity_metadata.get(id).map(|m| m.bounds);

        // One transaction for the whole removal. The cascade, a visit_count
        // update per section the activity was in, the identity blob and the
        // processed set were separate autocommits, so deleting an activity in
        // a dozen sections paid fifteen fsyncs under the engine lock. The tile
        // sweep stays outside it: that is filesystem work, not a row.
        self.remove_activity_transaction(id)?;

        self.forget_activity_in_memory(id);
        self.rebuild_spatial_index();

        if let Some(bounds) = removed_bounds {
            self.sweep_tiles_for(vec![bounds], "removed activities");
        }

        Ok(())
    }

    /// Remove an activity that left intervals.icu without sweeping its tiles,
    /// handing the caller the bounds the sweep would have covered.
    ///
    /// For a caller removing many in one hold: `remove_activity` spawns a
    /// sweep of its own, and a census reconcile that deleted two hundred
    /// activities would spawn two hundred threads, each overwriting the cancel
    /// token of the one before it. The caller sweeps once, at the end.
    ///
    /// The same transaction stamps the activity's sport for the curve sweep,
    /// so the curves the server drew with it are fetched again.
    pub fn remove_departed_activity(&mut self, id: &str) -> SqlResult<Option<Bounds>> {
        let removed_bounds = self.activity_metadata.get(id).map(|m| m.bounds);

        self.db.execute_batch("BEGIN IMMEDIATE")?;
        let result = stamp_curve_removal(&self.db, id)
            .and_then(|()| self.remove_activity_rows(id))
            .and_then(|memory| self.commit_activity_removal(memory));
        if result.is_err() {
            let _ = self.db.execute_batch("ROLLBACK");
        }
        result?;

        self.forget_activity_in_memory(id);
        self.rebuild_spatial_index();
        Ok(removed_bounds)
    }

    /// `stamp_kept_departure` in a transaction of its own.
    fn stamp_kept_departure(&mut self, id: &str) -> SqlResult<()> {
        let tx = self.db.transaction()?;
        stamp_kept_departure(&tx, id)?;
        tx.commit()
    }

    fn remove_activity_transaction(&mut self, id: &str) -> SqlResult<()> {
        self.db.execute_batch("BEGIN IMMEDIATE")?;
        let result = self
            .remove_activity_rows(id)
            .and_then(|memory| self.commit_activity_removal(memory));
        if result.is_err() {
            let _ = self.db.execute_batch("ROLLBACK");
        }
        result
    }

    fn commit_activity_removal(&mut self, memory: RemovalMemory) -> SqlResult<()> {
        super::commit_write_txn(&self.db)?;
        self.apply_removal_memory(memory);
        Ok(())
    }

    fn apply_removal_memory(&mut self, memory: RemovalMemory) {
        self.identity = memory.identity;
        self.sections = memory.sections;
        if memory.had_track {
            self.processed_activity_ids.clear();
            self.pending_processed_clear = false;
            self.forget_evidence_cache_in_memory();
        }
    }

    /// Hand a set of bounds to the detached sweep, if tiles are configured.
    pub(crate) fn sweep_tiles_for(&mut self, bounds: Vec<Bounds>, reason: &'static str) {
        if bounds.is_empty() {
            return;
        }
        let Some(tiles_path) = self.heatmap_tiles_path.clone() else {
            return;
        };
        // Marked here rather than after the sweep: the rows are already gone,
        // so the ground they drew is stale whatever the sweep manages.
        self.mark_heatmap_dirty();
        let ground = bounds.into_iter().map(SweepGround::Bounds).collect();
        spawn_tile_sweep(tiles_path, ground, reason);
    }

    /// Drop one activity from the tiers that hold it, after its rows are gone.
    ///
    /// The registry and processed set are published by the transaction owner.
    fn forget_activity_in_memory(&mut self, id: &str) {
        self.activity_metadata.remove(id);
        self.activity_metrics.remove(id);
        self.signature_cache.pop(&id.to_string());
        self.section_cache.clear();
        self.time_streams.pop(&id.to_string());
        self.set_groups_dirty(true);
        self.sections_dirty = true;
        self.invalidate_perf_cache();
    }

    /// Every row a removal touches, with no transaction of its own so the
    /// caller commits them together.
    ///
    /// Returns the next registry and section tiers for publication after commit.
    fn remove_activity_rows(&mut self, id: &str) -> SqlResult<RemovalMemory> {
        let metric_date = self
            .db
            .query_row(
                "SELECT date FROM activity_metrics WHERE activity_id = ?",
                [id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?;
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
        let had_track = self
            .db
            .execute("DELETE FROM activities WHERE id = ?", params![id])?
            > 0;
        delete_activity_keyed_rows(&self.db, id, KeepAthleteRows::No)?;
        if let Some(date) = metric_date {
            super::schema::recompute_heatmap_day(&self.db, date)?;
        }

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

        // Prepare the registry and section tiers without publishing them.
        // Junction rows cascade-delete, but the append-only fold would keep the activity
        // as a phantom member of a carried section, and the next detect's save would
        // then try to re-insert its junction row against a deleted activity -
        // aborting the whole apply on a foreign-key violation.
        let mut identity = self.identity.clone();
        let mut sections = self.sections.clone();
        super::sections::purge_activity_from_tiers(&mut identity, &mut sections, id);
        let blob = super::sections::identity_blob_for(&identity).ok_or_else(|| {
            rusqlite::Error::ToSqlConversionFailure("Cannot encode section identity".into())
        })?;
        self.db.execute(
            "INSERT INTO identity_state (key, blob, updated_at)
             VALUES (?, ?, datetime('now'))
             ON CONFLICT(key) DO UPDATE SET blob = excluded.blob, updated_at = excluded.updated_at",
            params![super::sections::SECTION_IDENTITY_KEY, blob],
        )?;

        // The removed activity may have contributed to any section,
        // so the next detect must re-derive the catalogue without it. Its id is
        // now gone from `activity_metadata`, so it can never re-enter
        // `new_activity_ids`, a targeted eviction can't defeat the
        // no-new-activities short-circuit. Clear the whole processed set so the
        // next detect re-analyses the remaining library. One with no track
        // was never detected against, so it owes no re-analysis.
        if had_track {
            self.db.execute("DELETE FROM processed_activities", [])?;
            self.db.execute("DELETE FROM evidence_cache", [])?;
        }

        Ok(RemovalMemory {
            identity,
            sections,
            had_track,
        })
    }

    /// Clear all data. Every table the declaration does not call
    /// `TableClass::Meta` empties, because this is the logout path and
    /// anything left behind is one athlete's data shown to the next. Nothing
    /// cascades here: only four tables carry an activity foreign key, so a
    /// table missing from this list survives indefinitely.
    ///
    /// The list stays hand-ordered because the order is a foreign-key order,
    /// not an alphabetical one. What holds it to the schema is
    /// `clear_wipes_every_table`, and what decides which tables belong in it is
    /// `persistence::tables`, read by that test rather than restated here.
    pub fn clear(&mut self) -> SqlResult<()> {
        let tx = self.db.unchecked_transaction()?;
        tx.execute_batch(
            "DELETE FROM section_activities;
             DELETE FROM sections;
             DELETE FROM section_numbers;
             DELETE FROM section_forced_matches;
             DELETE FROM section_history;
             DELETE FROM section_geometry;
             DELETE FROM section_pins;
             DELETE FROM section_intents;
             DELETE FROM identity_state;
             DELETE FROM route_groups;
             DELETE FROM route_line_layer;
             DELETE FROM route_names;
             DELETE FROM route_numbers;
             DELETE FROM gps_tracks;
             DELETE FROM signatures;
             DELETE FROM activities;
             DELETE FROM activity_census;
             DELETE FROM activity_metrics;
             DELETE FROM activity_matches;
             DELETE FROM activity_bodies;
             DELETE FROM activity_indicators;
             DELETE FROM activity_heatmap;
             DELETE FROM time_streams;
             DELETE FROM stream_bodies;
             DELETE FROM activity_streams;
             DELETE FROM activity_stream_backfill;
             DELETE FROM interval_bodies;
             DELETE FROM curve_bodies;
             DELETE FROM calendar_event_bodies;
             DELETE FROM exercise_sets;
             DELETE FROM fit_file_status;
             DELETE FROM wellness;
             DELETE FROM eftp_changes;
             DELETE FROM pace_history;
             DELETE FROM overlap_cache;
             DELETE FROM processed_activities;
             DELETE FROM athlete_profile;
             DELETE FROM job_attempts;
             DELETE FROM job_runs;
             DELETE FROM push_runs;
             DELETE FROM sport_settings;
             DELETE FROM section_rank_inputs;
             DELETE FROM section_rank_dirty;
             DELETE FROM section_rank_dirty_activity;
             DELETE FROM section_visible_count;",
        )?;

        // Settings survive `clear()` on purpose, but detector, owner and record
        // restore keys describe the library that was just deleted. Left
        // behind, the next athlete to sign in inherits the previous one's
        // detector and a spent cutover token, with no surface to change
        // either, the athlete id keeps naming an owner for a library that is
        // gone, and the restore state keeps the previous athlete's section
        // names and activity ids. The export home and the sync history are
        // the athlete's too, and the record zip carries every settings key, so
        // left behind they would go out in the next athlete's backup.
        let library_keys = [
            super::cutover::CUTOVER_KEY,
            super::cutover::CUTOVER_DIFF_KEY,
            super::cutover::CUTOVER_PREVIOUS_CONFIG_KEY,
            super::cutover::CUTOVER_ARCHIVE_KEY,
            super::settings_keys::SECTION_CONFIG_JSON,
            super::settings_keys::ATHLETE_ID,
            super::settings_keys::FEED_RINGS,
            super::settings_keys::SECTION_PROXIMITY_THRESHOLD,
            super::settings_keys::SECTION_MIN_LENGTH,
            super::settings_keys::SECTION_MIN_ACTIVITIES,
            super::settings_keys::MATCH_MIN_MATCH_PCT,
            super::settings_keys::MATCH_ENDPOINT_THRESHOLD,
            super::settings_keys::PLATFORM_RECORD_ANSWERED,
            super::settings_keys::SECTION_HEALTH_CHECK_DONE,
            super::record_restore::PENDING_KEY,
            super::record_restore::OWED_KEY,
            super::record_restore::UNAVAILABLE_KEY,
            super::record_restore::PAUSED_IMPORT_KEY,
            super::settings_keys::EXPORT_HOME_LAT,
            super::settings_keys::EXPORT_HOME_LNG,
            super::settings_keys::EXPORT_PRIVACY_RADIUS_M,
            super::settings_keys::SYNC_LAST_SUCCESS_AT,
            super::settings_keys::WIDGET_CONTEXT,
            crate::objects::sync::OLDEST_ACTIVITY_DATE_KEY,
            crate::objects::sync::ACTIVITY_YEAR_COUNTS_KEY,
        ];
        let mut stmt = tx.prepare("DELETE FROM settings WHERE key = ?")?;
        for key in library_keys {
            stmt.execute(params![key])?;
        }
        drop(stmt);
        tx.execute(
            "DELETE FROM schema_info WHERE key = ?",
            params![super::routes::GROUPS_MATCH_RULE_KEY],
        )?;
        // The curve sweep's removal stamps and kept-departure markers name the
        // departed activities of the library that went, and the next sync
        // would read them as its own.
        for prefix in [
            super::settings_keys::CURVE_REMOVED_AT_PREFIX,
            super::settings_keys::CURVE_DEPARTED_PREFIX,
        ] {
            tx.execute(
                "DELETE FROM settings WHERE substr(key, 1, length(?1)) = ?1",
                params![prefix],
            )?;
        }
        tx.commit()?;

        self.activity_metadata.clear();
        self.activity_metrics.clear();
        self.spatial_index = RTree::new();
        self.signature_cache.clear();
        self.groups.clear();
        self.sections.clear();
        self.section_config = tracematch::sections::SectionConfig::default();
        self.match_config = tracematch::MatchConfig::default();
        self.processed_activity_ids.clear();
        self.invalidate_evidence_cache();
        self.time_streams.clear();
        self.set_groups_dirty(false);
        self.sections_dirty = false;
        self.clear_memory_caches();

        // The registries are in memory as well as on disk. Without this the
        // deleted athlete's grounds stay live for the debounce window, so the
        // next athlete's first detect adopts their ids, names and tombstones.
        self.identity = super::sections::SectionIdentity::default();
        self.route_identity = super::route_identity::RouteIdentity::default();
        // The stored generation went with `identity_state`, and a background
        // regroup compares against this one, so a stale count refuses it.
        self.group_generation = 0;

        // The tiles on disk draw the library that was just deleted. Marking
        // the set owes it a draw, but a dirty pass only fills tiles that are
        // missing, so the tiles themselves are removed by the wipe's thread
        // in `clear_all_background` once this lock is released.
        self.mark_heatmap_dirty();

        Ok(())
    }

    /// Clear detected route/section data, keeping GPS tracks, activities and
    /// user-defined sections intact. Used when route matching is toggled off
    /// to free section memory without losing the underlying GPS data (needed
    /// for heatmap).
    pub fn clear_routes_and_sections(&mut self) -> SqlResult<()> {
        // One commit, so a kill mid-wipe cannot leave the exclusions held and
        // their rows still in place, or the rows gone and nothing held.
        let tx = self.db.unchecked_transaction()?;
        wipe_derived_catalogue(&tx)?;
        tx.commit()?;

        self.groups.clear();
        self.load_sections()?;
        self.invalidate_evidence_cache();
        self.set_groups_dirty(true);
        self.sections_dirty = true;
        self.clear_memory_caches();

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
    /// So is an excluded match row, which is the athlete taking one attempt
    /// out of a route: `wipe_derived_catalogue` spares it. A lap taken out of
    /// an auto section goes with the section's rows and is held for the
    /// re-detect, which puts it back on the re-minted id, and so does a drawn
    /// section's replacement of one.
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
        for id in &removed_ids {
            delete_activity_keyed_rows(&tx, id, KeepAthleteRows::Yes)?;
        }
        super::schema::recompute_all_heatmap(&tx)?;
        let activities_kept: u32 =
            tx.query_row("SELECT COUNT(*) FROM activities", [], |row| row.get(0))?;
        tx.execute("DELETE FROM processed_activities", [])?;
        tx.commit()?;

        // A removed activity stays a phantom member of a carried section
        // otherwise, and the next apply would re-insert its junction row
        // against a foreign key that no longer resolves.
        for id in &removed_ids {
            self.section_identity_purge_activity(id);
            self.activity_metrics.remove(id);
        }
        self.processed_activity_ids.clear();
        self.invalidate_evidence_cache();
        self.signature_cache.clear();
        self.time_streams.clear();
        self.groups.clear();
        self.load_metadata()?;
        self.load_sections()?;
        self.set_groups_dirty(true);
        self.sections_dirty = true;
        self.clear_memory_caches();
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
            self.set_groups_dirty(true);
            self.sections_dirty = true;
            log::info!("veloqrs: [PersistentEngine] Marked for re-computation (cache expanded)");
        }
    }

    // ========================================================================
    // Database Storage
    // ========================================================================

    /// Write one batch's rows, answering what the in-memory catalogue owes.
    ///
    /// Takes `&self`, so nothing it returns has touched the catalogue yet: the
    /// caller applies that after the commit.
    #[allow(clippy::type_complexity)]
    fn write_activities_batch(
        &self,
        activities: &[(String, Vec<GpsPoint>, String)],
    ) -> SqlResult<Vec<(String, ActivityMetadata, Option<Arc<RouteSignature>>)>> {
        let mut written = Vec::with_capacity(activities.len());

        for (id, coords, sport_type) in activities {
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
            }

            written.push((
                id.clone(),
                ActivityMetadata {
                    id: id.clone(),
                    sport_type: sport_type.clone(),
                    bounds,
                    // Straight from the signature just stored, so a freshly
                    // synced activity's marker lands on its start without
                    // waiting for the next load.
                    start_point: signature
                        .as_ref()
                        .map(|sig| (sig.start_point.latitude, sig.start_point.longitude)),
                },
                signature.map(Arc::new),
            ));
        }

        Ok(written)
    }

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
        let intervals_id = (!is_local_activity_key(id)).then_some(id);
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
        // On a first sync the metrics land before the activity rows, and the
        // fitness write skips a row that is not there yet. Detection and the
        // indicators read `start_date` in this same session, so the row takes
        // what the metrics already know as it is written.
        self.fill_activity_metadata_from_metrics(Some(id))?;
        Ok(())
    }

    /// Fill each hole in an activity's date, name, distance and duration from
    /// its `activity_metrics` row, for one activity or, with `None`, all of
    /// them. `COALESCE` only fills: a value already written stays.
    pub(super) fn fill_activity_metadata_from_metrics(&self, id: Option<&str>) -> SqlResult<usize> {
        const FILL: &str = "UPDATE activities SET
                duration_secs = COALESCE(duration_secs, (
                    SELECT moving_time FROM activity_metrics
                    WHERE activity_metrics.activity_id = activities.id
                )),
                distance_meters = COALESCE(distance_meters, (
                    SELECT distance FROM activity_metrics
                    WHERE activity_metrics.activity_id = activities.id
                )),
                start_date = COALESCE(start_date, (
                    SELECT date FROM activity_metrics
                    WHERE activity_metrics.activity_id = activities.id
                )),
                name = COALESCE(name, (
                    SELECT name FROM activity_metrics
                    WHERE activity_metrics.activity_id = activities.id
                ))
             WHERE (duration_secs IS NULL OR distance_meters IS NULL
                    OR start_date IS NULL OR name IS NULL)
               AND EXISTS (
                 SELECT 1 FROM activity_metrics
                 WHERE activity_metrics.activity_id = activities.id
               )";
        match id {
            // A key lookup per stored activity, not a scan of the table.
            Some(id) => self.db.execute(&format!("{FILL} AND id = ?1"), params![id]),
            None => self.db.execute(FILL, []),
        }
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
        // A stored shape that names this ride while it was absent is settled
        // against it here, the one place a stream arrives.
        super::sections::history::settle_orphaned_references_on(&self.db, id, coords)?;
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
    /// nothing is re-derived. Held points are read on the quantised grid, a
    /// legacy row included, so writing them back changes none. `point_count` is unchanged and the provenance,
    /// both whether elevation was fetched and which series it is, is set in
    /// the same statement, which is why this does not need the separate
    /// `record_elevation_state` and `record_elevation_source` passes that a
    /// replace does.
    ///
    /// Returns false, having written nothing, when there is no stored track or
    /// when the series is a different length from it. A different length means
    /// intervals.icu re-processed the activity, and the caller has to fetch the
    /// whole track instead.
    pub fn splice_track_elevation(
        &self,
        id: &str,
        elevations: &[f64],
        series: ElevationSeries,
    ) -> SqlResult<bool> {
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

        let source = elevation_source_of(&spliced, series);
        super::climb_bests::in_write_txn(&self.db, |conn| {
            conn.execute(
                "UPDATE gps_tracks SET track_data = ?, elevation_state = ?, elevation_source = ?, \
                 elevation_attempts = 0 WHERE activity_id = ?",
                params![
                    codec::serialize_track_points(&spliced),
                    i64::from(crate::persistence::ELEVATION_STATE_FETCHED),
                    i64::from(source),
                    id
                ],
            )?;
            super::climb_bests::refresh(conn, id)
        })?;
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
                    "UPDATE gps_tracks SET elevation_state = ?, elevation_attempts = 0 \
                     WHERE activity_id IN ({})",
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

    /// Record which altitude series each stored track's points carry, where
    /// `source` is one of the `ELEVATION_SOURCE_*` values.
    ///
    /// The same shape as [`Self::record_elevation_state`], and for the same
    /// reason: `store_gps_track` is `INSERT OR REPLACE`, which resets the
    /// column to unknown, so a writer that stores points records their series
    /// after them. Touches `elevation_source` alone, and an id with no track
    /// row updates nothing.
    pub fn record_elevation_source(&self, sources: &[(String, u8)]) -> SqlResult<()> {
        const CHUNK: usize = 500;
        let mut by_source: BTreeMap<u8, Vec<&String>> = BTreeMap::new();
        for (id, source) in sources {
            by_source.entry(*source).or_default().push(id);
        }

        for (source, ids) in by_source {
            let source = i64::from(source);
            for chunk in ids.chunks(CHUNK) {
                let placeholders = std::iter::repeat_n("?", chunk.len())
                    .collect::<Vec<_>>()
                    .join(",");
                let sql = format!(
                    "UPDATE gps_tracks SET elevation_source = ? WHERE activity_id IN ({})",
                    placeholders
                );
                let mut params_vec: Vec<&dyn rusqlite::ToSql> = Vec::with_capacity(chunk.len() + 1);
                params_vec.push(&source);
                params_vec.extend(chunk.iter().map(|s| *s as &dyn rusqlite::ToSql));
                self.db.execute(&sql, params_vec.as_slice())?;
            }
        }
        Ok(())
    }

    /// Settle which series a fetched track carries, given the series upstream
    /// answers with now.
    ///
    /// A track stored before the column existed holds elevation from one of
    /// the two upstream series and nothing says which. When its points carry
    /// `elevations` sample for sample, that series is the one, and it is
    /// recorded without a byte of the points moving. When they do not, the
    /// track is handed back to the elevation queue, whose splice replaces the
    /// elevation with the series a fresh ingest would choose and records it.
    /// Only a row still fetched and still unknown is touched, so an answer that
    /// crossed with a re-ingest changes nothing.
    pub fn settle_elevation_source(
        &self,
        id: &str,
        elevations: &[f64],
        series: ElevationSeries,
    ) -> SqlResult<SourceSettled> {
        let Some(points) = self.load_gps_track_from_db(id) else {
            return Ok(SourceSettled::Missing);
        };
        let fetched = i64::from(ELEVATION_STATE_FETCHED);
        let unknown = i64::from(ELEVATION_SOURCE_UNKNOWN);
        if carries_series(&points, elevations) {
            let source = i64::from(elevation_source_of(&points, series));
            let changed = self.db.execute(
                "UPDATE gps_tracks SET elevation_source = ?1 \
                 WHERE activity_id = ?2 AND elevation_state = ?3 AND elevation_source = ?4",
                params![source, id, fetched, unknown],
            )?;
            return Ok(if changed > 0 {
                SourceSettled::Recorded
            } else {
                SourceSettled::Missing
            });
        }
        let changed = self.db.execute(
            "UPDATE gps_tracks SET elevation_state = ?1, elevation_attempts = 0 \
             WHERE activity_id = ?2 AND elevation_state = ?3 AND elevation_source = ?4",
            params![i64::from(ELEVATION_STATE_UNKNOWN), id, fetched, unknown],
        )?;
        Ok(if changed > 0 {
            SourceSettled::HandedBack
        } else {
            SourceSettled::Missing
        })
    }

    /// One track's recorded altitude series, or `None` when no track is
    /// stored. Test support: the readers of the series read the column.
    #[doc(hidden)]
    pub fn elevation_source_of_track(&self, id: &str) -> Option<u8> {
        self.db
            .query_row(
                "SELECT elevation_source FROM gps_tracks WHERE activity_id = ?1",
                params![id],
                |row| row.get::<_, i64>(0),
            )
            .ok()
            .and_then(|v| u8::try_from(v).ok())
    }

    /// Count one ask that settled nothing against each track, and retire the
    /// ones that have now been asked `limit` times. Returns how many retired.
    ///
    /// The queue is derived from `elevation_state` on every call, so a row an
    /// ask leaves untouched is re-offered by every pass for the life of the
    /// install. One such row holds `elevation_backfill_remaining()` above zero,
    /// which holds section detection and vetoes the detector cutover at every
    /// launch. Counting the asks is what lets the queue end.
    ///
    /// The count is stored rather than held in the process: the passes are one
    /// per launch, so a counter that resets with the process would never reach
    /// any limit.
    ///
    /// Only a row still at `UNKNOWN` retires. A track that has since been
    /// fetched is not demoted by an ask that crossed with it, and a retired
    /// track is not retired twice.
    pub fn record_elevation_attempts(&self, ids: &[String], limit: u32) -> SqlResult<u64> {
        const CHUNK: usize = 500;
        let mut retired = 0u64;
        for chunk in ids.chunks(CHUNK) {
            let placeholders = std::iter::repeat_n("?", chunk.len())
                .collect::<Vec<_>>()
                .join(",");
            let ids_params: Vec<&dyn rusqlite::ToSql> =
                chunk.iter().map(|s| s as &dyn rusqlite::ToSql).collect();

            self.db.execute(
                &format!(
                    "UPDATE gps_tracks SET elevation_attempts = elevation_attempts + 1 \
                     WHERE activity_id IN ({})",
                    placeholders
                ),
                ids_params.as_slice(),
            )?;

            let limit = i64::from(limit);
            let unreachable = i64::from(ELEVATION_STATE_UNREACHABLE);
            let unknown = i64::from(ELEVATION_STATE_UNKNOWN);
            let mut params_vec: Vec<&dyn rusqlite::ToSql> = vec![&unreachable, &unknown, &limit];
            params_vec.extend(ids_params.iter().copied());
            retired += self.db.execute(
                &format!(
                    "UPDATE gps_tracks SET elevation_state = ? \
                     WHERE elevation_state = ? AND elevation_attempts >= ? \
                       AND activity_id IN ({})",
                    placeholders
                ),
                params_vec.as_slice(),
            )? as u64;
        }
        Ok(retired)
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
                ELEVATION_STATE_UNREACHABLE => counts.unreachable += n,
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

    /// What making an inclusive date range available offline will cost.
    ///
    /// Read rather than guessed: the byte figure scales on the moving seconds
    /// already stored for the range, because per activity the cost spans
    /// fifty-fold and per moving second it holds to about a third.
    pub fn estimate_offline_range(
        &self,
        oldest: i64,
        newest: i64,
    ) -> rusqlite::Result<crate::net::offline_prefetch::OfflineEstimate> {
        let (activities, moving_seconds) = pooled::offline_range_totals(&self.db, oldest, newest)?;
        Ok(crate::net::offline_prefetch::estimate_range(
            activities,
            moving_seconds,
        ))
    }

    /// Flag the catalogue as owing a detect. Used where a caller knows the
    /// pool moved under a run that has already reported its own result.
    pub fn mark_sections_dirty(&mut self) {
        self.sections_dirty = true;
    }

    /// Record the census: what intervals.icu says this athlete's history
    /// holds, keyed on the athlete so a second sign-in never reads the first
    /// one's coverage.
    ///
    /// The pull spans all history in one request, so an id the new census does
    /// not carry is gone upstream and its row goes with it: a row left behind
    /// would answer "already there" for an activity that no longer exists. An
    /// empty census is refused for the same reason `reconcile_against_census`
    /// refuses one, a failed request and an emptied account being
    /// indistinguishable here.
    ///
    /// `fetched_sync_date` is not upstream's to say and survives the rewrite.
    /// It records the version this device came away with, so clearing it made
    /// every window owe its download again after any sync: `window_is_covered`
    /// answered false everywhere, the feed re-downloaded pages it held, and
    /// every chart said "not downloaded yet" over a library that was fully
    /// downloaded. An id that leaves the account and returns is a new download
    /// either way, because its row went with the id.
    ///
    /// Written as an upsert of the upstream fields against a per-run stamp,
    /// then a delete of whatever this run did not stamp. `census_at`'s default
    /// has one-second resolution, so the stamp is the run's own value rather
    /// than a clock two pulls could share. Returns the transaction's result.
    pub fn record_activity_census(
        &mut self,
        athlete_id: &str,
        entries: &[ActivityCensusEntry],
    ) -> SqlResult<()> {
        if athlete_id.is_empty() || entries.is_empty() {
            return Ok(());
        }
        let tx = self.db.transaction()?;
        let stamp = census_run_stamp();
        let written = (|| -> SqlResult<()> {
            {
                let mut stmt = tx.prepare(
                    "INSERT INTO activity_census
                         (athlete_id, intervals_id, start_date_local, created, icu_sync_date,
                          has_latlng, census_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                     ON CONFLICT(athlete_id, intervals_id) DO UPDATE SET
                         start_date_local = excluded.start_date_local,
                         created = excluded.created,
                         icu_sync_date = excluded.icu_sync_date,
                         has_latlng = excluded.has_latlng,
                         census_at = excluded.census_at",
                )?;
                for entry in entries {
                    stmt.execute(params![
                        athlete_id,
                        entry.id,
                        entry.start_date_local,
                        entry.created,
                        entry.icu_sync_date,
                        entry.has_latlng,
                        stamp
                    ])?;
                }
            }
            tx.execute(
                "DELETE FROM activity_census WHERE athlete_id = ?1 AND census_at IS NOT ?2",
                params![athlete_id, stamp],
            )?;
            Ok(())
        })();
        written?;
        tx.commit()
    }

    /// Whether a date window owes nothing: every activity the census names
    /// inside it is stored locally, at the version the census names.
    ///
    /// "Stored" is a row in `activity_bodies`, which is what a window sync
    /// writes and what the feed reads. It is keyed by the local key, which for
    /// an activity this device uploaded is not the server's id, so the census
    /// id is matched against the key directly and through
    /// `activities.intervals_id`. Reading `activities` alone would answer
    /// "missing" for every synced activity whose track was never downloaded,
    /// which is most of them.
    ///
    /// The window is inclusive of both ends and compared by date, because the
    /// caller asks in days and `start_date_local` carries a time.
    ///
    /// An athlete with no census rows at all is never covered. Nothing has been
    /// pulled for them, so an empty table is ignorance rather than an empty
    /// account, and reading it as coverage is what would leave a second
    /// sign-in with an empty feed and no download to fill it.
    pub fn window_is_covered(&self, athlete_id: &str, oldest: &str, newest: &str) -> bool {
        pooled::window_is_covered(&self.db, athlete_id, oldest, newest)
    }

    /// The days inside a window that still owe a download, ascending.
    ///
    /// The owed test is the shared census predicate: a row never marked, a row
    /// whose version moved upstream, or a row with no stored body all owe it.
    ///
    /// `None` is ignorance rather than "nothing owed": no census for this
    /// athlete, or a read that failed. The caller falls back to the fixed
    /// window it used before the census existed, because an empty table is the
    /// pull not having happened and reading it as coverage is what would leave
    /// a fresh sign-in with an empty feed and no download to fill it.
    pub fn owed_dates_in_window(
        &self,
        athlete_id: &str,
        oldest: &str,
        newest: &str,
    ) -> Option<Vec<String>> {
        if athlete_id.is_empty() {
            return None;
        }
        let known: i64 = self
            .db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM activity_census WHERE athlete_id = ?)",
                params![athlete_id],
                |row| row.get(0),
            )
            .map_err(|e| log::warn!("veloqrs: [census] owed probe failed: {}", e))
            .ok()?;
        if known == 0 {
            return None;
        }
        let mut stmt = self
            .db
            .prepare(&format!(
                "SELECT DISTINCT date(c.start_date_local) FROM activity_census c
                 WHERE c.athlete_id = ?1
                   AND c.start_date_local IS NOT NULL
                   AND date(c.start_date_local) >= date(?2)
                   AND date(c.start_date_local) <= date(?3)
                   AND ({owed})
                 ORDER BY 1",
                owed = CENSUS_ROW_OWED.as_str(),
            ))
            .map_err(|e| log::warn!("veloqrs: [census] owed prepare failed: {}", e))
            .ok()?;
        let rows = stmt
            .query_map(params![athlete_id, oldest, newest], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|e| log::warn!("veloqrs: [census] owed read failed: {}", e))
            .ok()?;
        Some(rows.flatten().collect())
    }

    /// Fetched activities by date, with whether the upstream version moved.
    pub fn fetched_activity_days(&self, athlete_id: &str) -> Option<Vec<(String, String, bool)>> {
        let mut stmt = self
            .db
            .prepare(&format!(
                "SELECT date(c.start_date_local), c.intervals_id, ({CENSUS_ROW_CHANGED})
             FROM activity_census c
             WHERE c.athlete_id = ?1 AND c.start_date_local IS NOT NULL
               AND c.fetched_sync_date IS NOT NULL
             ORDER BY 1"
            ))
            .map_err(|e| log::warn!("veloqrs: [census] fetched days prepare failed: {e}"))
            .ok()?;
        let rows = stmt
            .query_map(params![athlete_id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .map_err(|e| log::warn!("veloqrs: [census] fetched days read failed: {e}"))
            .ok()?;
        rows.collect::<SqlResult<Vec<_>>>()
            .map_err(|e| log::warn!("veloqrs: [census] fetched days collect failed: {e}"))
            .ok()
    }

    /// What a date range holds, for a screen rather than for a sync.
    ///
    /// `window_is_covered` collapses to a bool because a sync only asks
    /// whether it owes the download. A chart needs the third answer: a range
    /// with nothing in it and a range nobody pulled both draw an empty axis,
    /// and every reader said "no data" for both.
    ///
    /// The owed test is `window_is_covered`'s, so the two cannot drift: a row
    /// never marked, a row whose version moved upstream since, or a row with no
    /// stored body all owe the download.
    ///
    /// Ignorance is never `Empty`. An athlete with no census at all, or no
    /// athlete at all, owes the range, because an empty table is the pull not
    /// having happened and reading it as an empty account is what would tell a
    /// fresh sign-in they had never trained.
    pub fn range_coverage(&self, athlete_id: &str, oldest: &str, newest: &str) -> RangeCoverage {
        pooled::range_coverage(&self.db, athlete_id, oldest, newest)
    }

    /// How much of the athlete's library is on the device, for the sync row.
    ///
    /// Every progress figure before this one was the current run's own queue,
    /// so a library of 1,598 rides with 400 tracks stored showed "12/12" and
    /// then nothing: the rides no pass had queued were invisible, online and
    /// off. These four are the window the athlete asked for, from the census,
    /// which is what the server says the account holds inside it.
    ///
    /// Two pairs rather than one, because they converge at different times:
    /// the activity pages arrive with the window syncs, the tracks with the GPS
    /// pass, and a row of either can be current while the other is short.
    ///
    /// An athlete with no census answers zeros. Nothing has been pulled, so
    /// every figure would be a claim about an account nobody has read, and a
    /// zero pair reads as "nothing to report" on every surface.
    pub fn library_coverage(&self, athlete_id: &str) -> LibraryCoverage {
        pooled::library_coverage(&self.db, athlete_id)
    }

    /// Record that the athlete has asked the device to hold activities back to
    /// `oldest` (`YYYY-MM-DD`). The window only ever widens, so a later, shorter
    /// ask leaves it alone, and an empty athlete records nothing.
    pub fn record_activity_window(&self, athlete_id: &str, oldest: &str) -> SqlResult<()> {
        if athlete_id.is_empty() || oldest.len() < 10 {
            return Ok(());
        }
        let oldest = &oldest[..10];
        let held = pooled::activity_window_oldest(&self.db, athlete_id);
        if oldest < held.as_str() {
            self.set_setting(&activity_window_key(athlete_id), oldest)?;
        } else if self
            .get_setting(&activity_window_key(athlete_id))?
            .is_none()
        {
            self.set_setting(&activity_window_key(athlete_id), &held)?;
        }
        Ok(())
    }

    /// Remember the tracks refused for good, against the version the census
    /// names now. An id the census does not carry for this athlete is ignored:
    /// there is no row to hold the refusal, and nothing would ask for it.
    pub fn record_track_refusals(
        &self,
        athlete_id: &str,
        refusals: &[(String, TrackRefusalKind)],
    ) -> SqlResult<()> {
        if athlete_id.is_empty() || refusals.is_empty() {
            return Ok(());
        }
        let tx = self.db.unchecked_transaction()?;
        {
            let mut stmt = tx.prepare(
                "UPDATE activity_census
                 SET track_refusal = ?3, track_refused_sync_date = icu_sync_date
                 WHERE athlete_id = ?1 AND intervals_id = ?2",
            )?;
            for (id, kind) in refusals {
                stmt.execute(params![athlete_id, id, kind.as_str()])?;
            }
        }
        tx.commit()
    }

    /// The activities whose track the engine refused for good and whose
    /// upstream version has not moved since. Asking the server again returns
    /// the same stream, so none of these is a fetch candidate.
    pub fn refused_track_ids(&self, athlete_id: &str) -> Vec<String> {
        pooled::refused_track_ids(&self.db, athlete_id)
    }

    /// Count the settled runs of each failed track against the version the
    /// census names now, and clear the count of each that landed. An id the
    /// census does not carry for this athlete is ignored.
    pub fn record_track_fetch_outcomes(
        &self,
        athlete_id: &str,
        landed: &[String],
        failed: &[String],
    ) -> SqlResult<()> {
        if athlete_id.is_empty() || (landed.is_empty() && failed.is_empty()) {
            return Ok(());
        }
        let tx = self.db.unchecked_transaction()?;
        {
            let mut clear = tx.prepare(
                "UPDATE activity_census
                 SET track_fetch_failures = 0, track_failed_sync_date = NULL
                 WHERE athlete_id = ?1 AND intervals_id = ?2 AND track_fetch_failures != 0",
            )?;
            for id in landed {
                clear.execute(params![athlete_id, id])?;
            }
            let mut bump = tx.prepare(
                "UPDATE activity_census
                 SET track_fetch_failures =
                         CASE WHEN track_failed_sync_date IS icu_sync_date
                              THEN track_fetch_failures + 1 ELSE 1 END,
                     track_failed_sync_date = icu_sync_date
                 WHERE athlete_id = ?1 AND intervals_id = ?2",
            )?;
            for id in failed {
                bump.execute(params![athlete_id, id])?;
            }
        }
        tx.commit()
    }

    /// The activities whose track failed the limit of settled runs and whose
    /// upstream version has not moved since. Not fetch candidates.
    pub fn unavailable_track_ids(&self, athlete_id: &str) -> Vec<String> {
        pooled::unavailable_track_ids(&self.db, athlete_id)
    }

    /// The census as last recorded for an athlete.
    pub fn activity_census(&self, athlete_id: &str) -> Vec<ActivityCensusEntry> {
        let mut stmt = match self.db.prepare(
            "SELECT intervals_id, start_date_local, created, icu_sync_date, has_latlng
             FROM activity_census WHERE athlete_id = ?",
        ) {
            Ok(stmt) => stmt,
            Err(e) => {
                log::warn!("veloqrs: [census] coverage read failed: {}", e);
                return Vec::new();
            }
        };
        let rows = stmt.query_map(params![athlete_id], |row| {
            Ok(ActivityCensusEntry {
                id: row.get(0)?,
                start_date_local: row.get(1)?,
                created: row.get(2)?,
                icu_sync_date: row.get(3)?,
                has_latlng: row.get(4)?,
            })
        });
        match rows {
            Ok(rows) => rows.flatten().collect(),
            Err(e) => {
                log::warn!("veloqrs: [census] coverage read failed: {}", e);
                Vec::new()
            }
        }
    }

    /// Ids this athlete's sync wrote, as the server names them, paired with
    /// the local key.
    ///
    /// Every stored activity is one, track or not. The track store is the
    /// only writer of `activities`, so a trainer ride, a swim or strength work
    /// has metrics and a body and no row there. Its key is the server's id,
    /// unless the device minted it and its upload's id sits on its body.
    ///
    /// Scoped four ways, and each one is a library wiped if it is dropped. A
    /// row with no `intervals_id`, or a `local-` key whose body carries none,
    /// was never upstream as far as this library knows, so the server not
    /// naming it says nothing. Demo rows are seeded on the device and no census
    /// carries them. A row dated after `newest` is one the census could not
    /// have named. And the comparison is against the server's own id, never
    /// against the key, or a row the device minted would read as deleted the
    /// moment it was stored.
    pub fn census_candidates(&self, newest: &str) -> Vec<(String, String)> {
        let mut stmt = match self.db.prepare(
            "SELECT a.id, a.intervals_id FROM activities a
             LEFT JOIN activity_bodies b ON b.activity_id = a.id
             LEFT JOIN activity_metrics m ON m.activity_id = a.id
             WHERE a.intervals_id IS NOT NULL
               AND a.intervals_id NOT LIKE 'demo-%'
               AND a.id NOT LIKE 'demo-%'
               AND (COALESCE(a.start_date, b.date, m.date) IS NULL
                    OR date(COALESCE(a.start_date, b.date, m.date), 'unixepoch') <= date(?1))
             UNION ALL
             SELECT k.id, COALESCE(b.intervals_id, k.id)
             FROM (SELECT activity_id AS id FROM activity_metrics
                   UNION SELECT activity_id FROM activity_bodies) k
             LEFT JOIN activity_bodies b ON b.activity_id = k.id
             LEFT JOIN activity_metrics m ON m.activity_id = k.id
             WHERE NOT EXISTS (SELECT 1 FROM activities a WHERE a.id = k.id)
               AND (substr(k.id, 1, length(?2)) != ?2 OR b.intervals_id IS NOT NULL)
               AND k.id NOT LIKE 'demo-%'
               AND (COALESCE(b.date, m.date) IS NULL
                    OR date(COALESCE(b.date, m.date), 'unixepoch') <= date(?1))",
        ) {
            Ok(stmt) => stmt,
            Err(e) => {
                log::warn!("veloqrs: [census] candidate read failed: {}", e);
                return Vec::new();
            }
        };
        let rows = stmt.query_map(params![newest, LOCAL_KEY_PREFIX], |row| {
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
    pub fn reconcile_against_census(&mut self, upstream: &[String], newest: &str) -> Vec<String> {
        if upstream.is_empty() {
            log::info!("veloqrs: [census] empty census, nothing reconciled");
            return Vec::new();
        }
        let named: std::collections::HashSet<&str> = upstream.iter().map(String::as_str).collect();
        let vanished: Vec<String> = self
            .census_candidates(newest)
            .into_iter()
            .filter(|(_, intervals_id)| !named.contains(intervals_id.as_str()))
            .map(|(key, _)| key)
            .collect();
        self.forget_returned_departures(&vanished);
        if vanished.is_empty() {
            return Vec::new();
        }

        let mut removed = Vec::with_capacity(vanished.len());
        let mut swept: Vec<Bounds> = Vec::new();
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
                        // is protected and the delete is skipped. The server's
                        // curves no longer carry it, so its sport is stamped,
                        // once for the departure rather than once per census.
                        log::info!(
                            "veloqrs: [census] {} left upstream but a section has no other member, kept",
                            key
                        );
                        if let Err(e) = self.stamp_kept_departure(&key) {
                            log::warn!(
                                "veloqrs: [census] curve stamp for kept {} failed: {}",
                                key,
                                e
                            );
                        }
                        continue;
                    }
                }
            }
            if let Err(e) = self.materialise_geometry_cut_from(&key) {
                log::warn!(
                    "veloqrs: [census] geometry versions of {} not materialised: {}",
                    key,
                    e
                );
            }
            match self.remove_departed_activity(&key) {
                Ok(bounds) => {
                    if let Some(bounds) = bounds {
                        swept.push(bounds);
                    }
                    removed.push(key);
                }
                Err(e) => log::warn!("veloqrs: [census] removal of {} failed: {}", key, e),
            }
        }
        // One sweep for the whole reconcile rather than one per activity: this
        // loop runs inside a single engine hold, and a thread apiece would each
        // overwrite the cancel token of the one before it.
        self.sweep_tiles_for(swept, "activities removed by the census");
        if !removed.is_empty() {
            log::info!(
                "veloqrs: [census] {} activities left intervals.icu and were removed",
                removed.len()
            );
        }
        removed
    }

    /// Drop the marker of every kept departure this census no longer finds
    /// gone, so one that leaves again is stamped again.
    fn forget_returned_departures(&self, vanished: &[String]) {
        let prefix = super::settings_keys::CURVE_DEPARTED_PREFIX;
        let marked: SqlResult<Vec<String>> = self
            .db
            .prepare("SELECT key FROM settings WHERE substr(key, 1, length(?1)) = ?1")
            .and_then(|mut stmt| stmt.query_map(params![prefix], |row| row.get(0))?.collect());
        let marked = match marked {
            Ok(marked) => marked,
            Err(e) => {
                log::warn!("veloqrs: [census] kept departure read failed: {}", e);
                return;
            }
        };
        for key in marked {
            let id = &key[prefix.len()..];
            if vanished.iter().any(|gone| gone == id) {
                continue;
            }
            if let Err(e) = self
                .db
                .execute("DELETE FROM settings WHERE key = ?1", params![key])
            {
                log::warn!(
                    "veloqrs: [census] kept departure {} not forgotten: {}",
                    id,
                    e
                );
            }
        }
    }

    /// Sections whose current line is sliced from this activity, through the
    /// custom anchor or the representative triple a detected section carries.
    /// Old geometry versions cut from it are not listed: they are kept
    /// readable by `materialise_geometry_cut_from`, not by moving a section.
    pub fn sections_anchored_to(&self, activity_id: &str) -> Vec<String> {
        let mut stmt = match self.db.prepare(
            "SELECT id FROM sections
             WHERE source_activity_id = ?1 OR representative_activity_id = ?1",
        ) {
            Ok(stmt) => stmt,
            Err(_) => return Vec::new(),
        };
        let rows = stmt.query_map(params![activity_id], |row| row.get::<_, String>(0));
        match rows {
            Ok(rows) => rows.flatten().collect(),
            Err(_) => Vec::new(),
        }
    }

    /// Record an upload answer, removing a provisional duplicate if sync already stored it.
    ///
    /// A row with a track keeps the id on `activities`. A row without one has
    /// no `activities` row at all, only a body and metrics, so the id goes on
    /// its body. False means no row was waiting for an id: the row already
    /// carries one, or no row has this key.
    pub fn record_upload(&mut self, activity_id: &str, intervals_id: &str) -> SqlResult<bool> {
        self.db.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            let tracked: bool = self.db.query_row(
                "SELECT EXISTS(SELECT 1 FROM activities WHERE id = ?)",
                [activity_id],
                |row| row.get(0),
            )?;
            let provisional: bool = self.db.query_row(
                if tracked {
                    "SELECT EXISTS(SELECT 1 FROM activities WHERE id = ? AND intervals_id IS NULL)"
                } else {
                    "SELECT EXISTS(SELECT 1 FROM activity_bodies
                     WHERE activity_id = ? AND intervals_id IS NULL)"
                },
                [activity_id],
                |row| row.get(0),
            )?;
            // The server's copy, however the sync stored it: claimed by a
            // tracked row, claimed by a trackless one, or a trackless one
            // keyed by the server's id because nothing claimed it then.
            let synced: Option<String> = self
                .db
                .query_row(
                    "SELECT id FROM activities WHERE intervals_id = ?1 AND id != ?2
                     UNION ALL
                     SELECT activity_id FROM activity_bodies
                     WHERE (intervals_id = ?1 OR activity_id = ?1) AND activity_id != ?2
                     LIMIT 1",
                    params![intervals_id, activity_id],
                    |row| row.get(0),
                )
                .optional()?;
            if provisional && let Some(synced) = synced {
                self.remove_uploaded_duplicate(activity_id, &synced)?;
                return Ok(true);
            }
            let changed = if tracked {
                let changed = self.db.execute(
                    "UPDATE activities SET intervals_id = ? WHERE id = ? AND intervals_id IS NULL",
                    params![intervals_id, activity_id],
                )?;
                if changed > 0 {
                    // Retired while no id named the ride, so the silence was
                    // ours. Now upstream can be asked, and the count starts over.
                    self.db.execute(
                        "UPDATE gps_tracks SET elevation_state = ?, elevation_attempts = 0
                         WHERE activity_id = ? AND elevation_state = ?",
                        params![
                            ELEVATION_STATE_UNKNOWN,
                            activity_id,
                            ELEVATION_STATE_UNREACHABLE
                        ],
                    )?;
                }
                changed
            } else {
                self.db.execute(
                    "UPDATE activity_bodies SET intervals_id = ?
                     WHERE activity_id = ? AND intervals_id IS NULL",
                    params![intervals_id, activity_id],
                )?
            };
            self.db.execute_batch("COMMIT")?;
            Ok(changed > 0)
        })();
        if result.is_err() {
            let _ = self.db.execute_batch("ROLLBACK");
        }
        result
    }

    /// Remove a duplicate inside the caller's transaction, then publish its memory tiers.
    fn remove_uploaded_duplicate(&mut self, activity_id: &str, synced_id: &str) -> SqlResult<()> {
        let result: SqlResult<()> = (|| {
            self.db.execute(
                "UPDATE recordings SET engine_activity_id = ? WHERE engine_activity_id = ?",
                params![synced_id, activity_id],
            )?;
            let memory = self.remove_activity_rows(activity_id)?;
            self.commit_activity_removal(memory)
        })();
        result?;
        let bounds = self.activity_metadata.get(activity_id).map(|m| m.bounds);
        self.forget_activity_in_memory(activity_id);
        self.rebuild_spatial_index();
        if let Some(bounds) = bounds {
            self.sweep_tiles_for(vec![bounds], "uploaded duplicate");
        }
        Ok(())
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
                "SELECT COALESCE(
                     (SELECT intervals_id FROM activities WHERE id = ?1),
                     (SELECT intervals_id FROM activity_bodies WHERE activity_id = ?1))",
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
            "SELECT activity_id, intervals_id FROM activity_bodies
             WHERE intervals_id IS NOT NULL AND activity_id IN ({placeholders})
             UNION ALL
             SELECT id, intervals_id FROM activities
             WHERE intervals_id IS NOT NULL AND id IN ({placeholders})"
        );
        let Ok(mut stmt) = self.db.prepare(&sql) else {
            return out;
        };
        let params = rusqlite::params_from_iter(activity_ids.iter().chain(activity_ids.iter()));
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
                "SELECT id FROM activities WHERE intervals_id = ?1
                 UNION ALL
                 SELECT activity_id FROM activity_bodies WHERE intervals_id = ?1
                 LIMIT 1",
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
    ///
    /// A failed read is an error and not an empty map. The two read the same
    /// to the caller, and taking a failure for "nothing claims this id" is
    /// what stores an uploaded ride a second time.
    pub fn local_ids_for_intervals_ids(
        &self,
        intervals_ids: &[String],
    ) -> SqlResult<std::collections::HashMap<String, String>> {
        let mut out = std::collections::HashMap::with_capacity(intervals_ids.len());
        if intervals_ids.is_empty() {
            return Ok(out);
        }
        let placeholders = vec!["?"; intervals_ids.len()].join(",");
        // A trackless row keeps its id on its body. The tracked rows come
        // second, so a server id both claim resolves to the row with the track.
        let sql = format!(
            "SELECT intervals_id, activity_id FROM activity_bodies
             WHERE intervals_id IN ({placeholders})
             UNION ALL
             SELECT intervals_id, id FROM activities
             WHERE intervals_id IN ({placeholders})"
        );
        let mut stmt = self.db.prepare(&sql)?;
        let params = rusqlite::params_from_iter(intervals_ids.iter().chain(intervals_ids.iter()));
        let rows = stmt.query_map(params, |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (intervals_id, local_id) = row?;
            out.insert(intervals_id, local_id);
        }
        Ok(out)
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

    /// The activities whose bounds could reach a line, padded by the same
    /// proximity threshold the matcher uses. `track_portions` already refuses
    /// a track whose points all miss that box, but it refuses it after the
    /// read and the decode, so on a real library the refusal costs one DB read
    /// and one decode per activity the athlete owns. The bounds are in memory
    /// and indexed, so the same refusal is free here. A bounding box that
    /// intersects is implied by any point inside the box, so this drops
    /// nothing the matcher would have kept.
    pub fn activities_near_polyline(&self, polyline: &[GpsPoint], pad_metres: f64) -> Vec<String> {
        let Some(bounds) = Bounds::from_points(polyline) else {
            return Vec::new();
        };
        // A degree of longitude shrinks with latitude, so the east-west pad is
        // taken at the box's own latitude rather than at the equator.
        let d_lat = pad_metres / 111_132.0;
        let d_lng = pad_metres / (111_320.0 * bounds.min_lat.to_radians().cos()).max(1.0);
        self.query_viewport(&Bounds {
            min_lat: bounds.min_lat - d_lat,
            max_lat: bounds.max_lat + d_lat,
            min_lng: bounds.min_lng - d_lng,
            max_lng: bounds.max_lng + d_lng,
        })
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

    /// Test accessor: the ids the signature LRU currently holds, in no
    /// particular order. `iter` does not promote, so asking does not change
    /// the answer, which is the whole point when the question is whether
    /// something else touched the cache.
    #[doc(hidden)]
    pub fn signature_cache_ids(&self) -> Vec<String> {
        self.signature_cache
            .iter()
            .map(|(k, _)| k.clone())
            .collect()
    }

    /// Every activity's signature the catalogue claims, in one statement.
    ///
    /// The regroup wants all of them at once and the LRU holds 200, so walking
    /// them through `get_signature` evicts what it has just loaded and reads
    /// every blob back a row at a time on any library past that size. Bypasses
    /// the cache for the same reason `get_all_map_signatures` does, and leaves
    /// what the cache already holds alone.
    pub(crate) fn load_all_signatures(&self) -> HashMap<String, Arc<RouteSignature>> {
        let mut out = HashMap::with_capacity(self.activity_metadata.len());
        let mut stmt = match self.db.prepare(
            "SELECT activity_id, points, start_point_lat, start_point_lng,
                    end_point_lat, end_point_lng, total_distance
             FROM signatures",
        ) {
            Ok(s) => s,
            Err(e) => {
                log::warn!("[load_all_signatures] query failed: {}", e);
                return out;
            }
        };
        let rows = match stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Vec<u8>>(1)?,
                GpsPoint::new(row.get(2)?, row.get(3)?),
                GpsPoint::new(row.get(4)?, row.get(5)?),
                row.get::<_, f64>(6)?,
            ))
        }) {
            Ok(rows) => rows,
            Err(e) => {
                log::warn!("[load_all_signatures] row walk failed: {}", e);
                return out;
            }
        };
        for row in rows.flatten() {
            let (id, blob, start_point, end_point, total_distance) = row;
            // A signature whose activity the catalogue no longer holds is not
            // the regroup's business, and decoding its blob is the cost this
            // is here to avoid.
            if !self.activity_metadata.contains_key(&id) {
                continue;
            }
            let Some(signature) =
                signature_from_parts(&id, &blob, start_point, end_point, total_distance)
            else {
                continue;
            };
            out.insert(id, Arc::new(signature));
        }
        out
    }

    /// Load a stored signature. A corrupt points blob names itself in the log
    /// before the read gives up, so route grouping never drops an activity in
    /// silence.
    fn load_signature_from_db(&self, id: &str) -> Option<RouteSignature> {
        pooled::signature(&self.db, id)
    }

    /// Get all map signatures in a single query.
    /// Returns lightweight flat-coord signatures for map rendering.
    /// Bypasses LRU cache since we want all rows at once.
    pub fn get_all_map_signatures(&self) -> Vec<crate::ffi_types::FfiMapSignature> {
        pooled::all_map_signatures(&self.db)
    }

    /// Get map signatures for a specific set of activity IDs.
    /// Avoids deserializing the whole `signatures` table when only a handful
    /// of activities are needed (e.g. section-detail map overlay).
    pub fn get_map_signatures_for_ids(
        &self,
        ids: &[String],
    ) -> Vec<crate::ffi_types::FfiMapSignature> {
        pooled::map_signatures_for_ids(&self.db, ids)
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

    /// Visit the stored tracks `wanted` names, once each, streaming. The
    /// callback borrows the points for the length of the call and the decoded
    /// buffer is dropped before the next row, so the whole library is never
    /// resident at once.
    ///
    /// A row outside `wanted` is skipped before its blob is read, so an
    /// unwanted track costs neither the copy out of SQLite nor the decode.
    /// The only caller ranks the sections' own members, which on a real
    /// library is a fraction of the rows.
    ///
    /// A corrupt row is logged and visited with an empty slice. The returned
    /// [`TrackWalk`] counts what the walk saw and what it lost, so a caller
    /// can tell a short result from a complete one. Every count is against
    /// `wanted`: a row nobody asked for is neither visited nor corrupt.
    pub fn for_each_track(
        &self,
        wanted: &std::collections::HashSet<&str>,
        f: impl FnMut(&str, &[GpsPoint]),
    ) -> TrackWalk {
        for_each_track_on(&self.db, wanted, f)
    }

    /// Drop one activity's cached stream, so a read goes back to the database.
    /// A fresh launch has nothing cached, which is the shape the length rule is
    /// about.
    #[doc(hidden)]
    pub fn forget_time_stream_for_test(&mut self, activity_id: &str) {
        self.time_streams.pop(&activity_id.to_string());
    }

    /// How many points one activity's stored track holds.
    ///
    /// `None` when there is no track row. Cheap: `gps_tracks` carries the count
    /// as a column, so this never decodes a blob.
    pub(crate) fn track_point_count(&self, activity_id: &str) -> Option<usize> {
        self.db
            .query_row(
                "SELECT point_count FROM gps_tracks WHERE activity_id = ?",
                params![activity_id],
                |row| row.get::<_, i64>(0),
            )
            .ok()
            .map(|n| n as usize)
    }

    /// The same, for a batch, so a pass over many portions makes one query.
    pub(crate) fn track_point_counts(
        &self,
        activity_ids: &[String],
    ) -> std::collections::HashMap<String, usize> {
        if activity_ids.is_empty() {
            return std::collections::HashMap::new();
        }
        let placeholders = vec!["?"; activity_ids.len()].join(",");
        let sql = format!(
            "SELECT activity_id, point_count FROM gps_tracks WHERE activity_id IN ({placeholders})"
        );
        let Ok(mut stmt) = self.db.prepare(&sql) else {
            return std::collections::HashMap::new();
        };
        stmt.query_map(rusqlite::params_from_iter(activity_ids.iter()), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as usize))
        })
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default()
    }

    /// Get GPS track from database (on-demand, never cached).
    pub fn get_gps_track(&self, id: &str) -> Option<Vec<GpsPoint>> {
        self.track(id).into_option("get_gps_track", id)
    }

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

    /// Store one activity's detail body over the list row a sync wrote, and
    /// its derived metrics in the same transaction.
    ///
    /// `updated_at` stays where the row already had it, because the curve
    /// sweep reads it as when the activity arrived on this device. Opening an
    /// activity is not an arrival, and moving it would refetch every curve of
    /// the activity's sport family on the next sync.
    pub fn store_activity_detail_body(
        &mut self,
        activity_id: &str,
        date: i64,
        raw: &str,
    ) -> SqlResult<()> {
        self.store_bodies_with_metrics(&[(activity_id.to_owned(), date, raw.to_owned())], true)
    }

    /// Store bodies and their derived metrics in one transaction.
    pub fn upsert_activity_bodies_with_metrics(
        &mut self,
        rows: &[(String, i64, String)],
    ) -> SqlResult<()> {
        self.store_bodies_with_metrics(rows, false)
    }

    /// `keep_arrival` leaves an existing row's `updated_at` alone, for a
    /// rewrite that is not an arrival.
    fn store_bodies_with_metrics(
        &mut self,
        rows: &[(String, i64, String)],
        keep_arrival: bool,
    ) -> SqlResult<()> {
        if rows.is_empty() {
            return Ok(());
        }
        let metrics: Vec<crate::FfiActivityMetrics> = rows
            .iter()
            .map(|(id, date, raw)| metrics_from_body(raw, *date, id))
            .collect::<SqlResult<_>>()?;
        let upsert = if keep_arrival {
            "INSERT INTO activity_bodies (activity_id, date, raw, updated_at)
             VALUES (?1, ?2, ?3, strftime('%s', 'now'))
             ON CONFLICT(activity_id) DO UPDATE SET date = excluded.date, raw = excluded.raw"
        } else {
            "INSERT INTO activity_bodies (activity_id, date, raw, updated_at)
             VALUES (?1, ?2, ?3, strftime('%s', 'now'))
             ON CONFLICT(activity_id) DO UPDATE SET
                 date=excluded.date, raw=excluded.raw, updated_at=excluded.updated_at"
        };
        self.db.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            for (id, date, raw) in rows {
                self.db.execute(upsert, params![id, date, raw])?;
            }
            self.write_activity_metrics(&metrics.iter().collect::<Vec<_>>(), true)?;
            self.db.execute_batch("COMMIT")
        })();
        if let Err(error) = result {
            let _ = self.db.execute_batch("ROLLBACK");
            return Err(error);
        }
        for metric in metrics {
            let core: ActivityMetrics = metric.into();
            self.activity_metrics.insert(core.activity_id.clone(), core);
        }
        self.invalidate_perf_cache();
        Ok(())
    }

    /// Store a fetched page and advance its census versions in one transaction.
    pub fn store_synced_activity_bodies(
        &mut self,
        athlete_id: &str,
        rows: &[(String, i64, String)],
        upstream_ids: &[String],
        metrics: Vec<ActivityMetrics>,
    ) -> SqlResult<()> {
        if rows.len() != upstream_ids.len() || rows.len() != metrics.len() {
            return Err(rusqlite::Error::InvalidParameterName(
                "synced activity page lengths differ".into(),
            ));
        }
        let inputs: Vec<_> = metrics
            .iter()
            .cloned()
            .map(super::fitness::metrics_input)
            .collect();
        self.db.execute_batch("BEGIN IMMEDIATE")?;
        let result = (|| {
            let mut body = self.db.prepare(
                "INSERT INTO activity_bodies (activity_id, date, raw, updated_at)
                 VALUES (?1, ?2, ?3, strftime('%s', 'now'))
                 ON CONFLICT(activity_id) DO UPDATE SET
                    date = excluded.date, raw = excluded.raw, updated_at = excluded.updated_at",
            )?;
            let mut invalidate = self.db.prepare(&format!(
                "DELETE FROM interval_bodies WHERE activity_id = ?3
                 AND EXISTS (SELECT 1 FROM activity_census c
                             WHERE c.athlete_id = ?1 AND c.intervals_id = ?2
                               AND c.fetched_sync_date IS NOT NULL
                               AND ({CENSUS_ROW_CHANGED}))"
            ))?;
            let mut mark = self.db.prepare(
                "UPDATE activity_census SET fetched_sync_date = icu_sync_date
                 WHERE athlete_id = ?1 AND intervals_id = ?2",
            )?;
            for ((local_id, date, raw), upstream_id) in rows.iter().zip(upstream_ids) {
                body.execute(params![local_id, date, raw])?;
                invalidate.execute(params![athlete_id, upstream_id, local_id])?;
            }
            drop(body);
            drop(invalidate);
            self.write_activity_metrics(&inputs.iter().collect::<Vec<_>>(), true)?;
            for upstream_id in upstream_ids {
                mark.execute(params![athlete_id, upstream_id])?;
            }
            self.db.execute_batch("COMMIT")
        })();
        if let Err(error) = result {
            let _ = self.db.execute_batch("ROLLBACK");
            return Err(error);
        }
        for metric in metrics {
            self.activity_metrics
                .insert(metric.activity_id.clone(), metric);
        }
        self.invalidate_perf_cache();
        Ok(())
    }

    /// One activity's untyped body, or None when the engine has not got it.
    ///
    /// `activity_bodies` is keyed by the id, so this is a primary-key lookup.
    /// The window read below is for the feed, which wants a page; a caller
    /// after a single activity that scans that page and parses every body to
    /// find one id does the whole window's JSON work in JavaScript.
    pub fn get_activity_body(&self, activity_id: &str) -> Option<String> {
        pooled::activity_body(&self.db, activity_id)
    }

    /// Untyped activity bodies over an inclusive timestamp window, newest
    /// first to match the order intervals.icu returns and the feed renders.
    pub fn get_activity_bodies(&self, oldest_ts: i64, newest_ts: i64) -> SqlResult<Vec<String>> {
        pooled::activity_bodies(&self.db, oldest_ts, newest_ts)
    }

    /// Every stored body whose activity has no `activity_metrics` row, as
    /// `(activity_id, date, raw)`.
    ///
    /// The sync writes both tables in one closure and only warns when the
    /// metrics half fails, so an activity can hold a body and no metrics row.
    /// It is then absent from every aggregate reading `activity_metrics`, which
    /// is the whole Health tab, until an unrelated resync carries it again.
    /// This is what the repair sweep reads. Ordinarily it answers nothing, so
    /// the cost is the anti-join and no rows.
    pub fn activity_bodies_without_metrics(&self) -> SqlResult<Vec<(String, i64, String)>> {
        let mut stmt = self.db.prepare(
            "SELECT b.activity_id, b.date, b.raw FROM activity_bodies b
             WHERE NOT EXISTS (
                 SELECT 1 FROM activity_metrics m WHERE m.activity_id = b.activity_id
             )
             ORDER BY b.date DESC",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?;
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
        // A new stream may time the traversals the old one could not.
        self.db.execute(
            "UPDATE section_activities SET time_empty = 0
             WHERE activity_id = ? AND time_empty = 1",
            params![activity_id],
        )?;
        Ok(())
    }

    /// Load time stream from database.
    pub(super) fn load_time_stream(&self, activity_id: &str) -> Option<Vec<u32>> {
        let mut stmt = self
            .db
            .prepare_cached("SELECT times FROM time_streams WHERE activity_id = ?")
            .ok()?;

        match stmt.query_row(params![activity_id], |row| {
            let times_blob: Vec<u8> = row.get(0)?;
            codec::deserialize(&times_blob)
                .map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, Type::Blob, e.into()))
        }) {
            Ok(times) => Some(times),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => {
                log::error!("time_streams {activity_id}: times read failed: {e}");
                None
            }
        }
    }

    /// Check which activities have no usable stored time stream.
    /// Returns list of activity IDs that need to be fetched from the API.
    pub fn get_activities_missing_time_streams(&self, activity_ids: &[String]) -> Vec<String> {
        // The cache is not consulted, so the stored row and the length rule in
        // the pooled form are the whole answer.
        pooled::activities_missing_time_streams(&self.db, activity_ids)
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

/// [`PersistentEngine::for_each_track`] over any connection, so a caller that
/// holds a read connection of its own walks the tracks without the engine lock.
pub(crate) fn for_each_track_on(
    conn: &rusqlite::Connection,
    wanted: &std::collections::HashSet<&str>,
    mut f: impl FnMut(&str, &[GpsPoint]),
) -> TrackWalk {
    let mut walk = TrackWalk::default();
    let mut stmt = match conn.prepare("SELECT activity_id, track_data FROM gps_tracks") {
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
        let id: String = match row.get(0) {
            Ok(id) => id,
            Err(e) => {
                log::warn!("[for_each_track] column read failed: {}", e);
                walk.failed += 1;
                continue;
            }
        };
        if !wanted.contains(id.as_str()) {
            continue;
        }
        let blob: Vec<u8> = match row.get(1) {
            Ok(blob) => blob,
            Err(e) => {
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

#[cfg(test)]
#[path = "tests/census_bounds.rs"]
mod census_bounds_tests;

#[cfg(test)]
#[path = "tests/activities_pool.rs"]
mod activities_pool_tests;

#[cfg(test)]
mod tests {
    use super::super::commit_counter;
    use super::*;
    use std::collections::HashSet;

    fn ride_points() -> Vec<GpsPoint> {
        vec![GpsPoint::new(46.0, 7.0), GpsPoint::new(46.001, 7.001)]
    }

    #[test]
    fn resyncing_unchanged_activities_leaves_grouping_settled() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        engine
            .add_activity("a1".into(), ride_points(), "Ride".into())
            .unwrap();
        engine.groups_dirty = false;
        engine.sections_dirty = false;

        engine
            .add_activity("a1".into(), ride_points(), "Ride".into())
            .unwrap();
        assert!(
            !engine.groups_dirty,
            "an identical re-ingest owes no regroup"
        );
        assert!(!engine.sections_dirty);

        engine
            .add_activity("a1".into(), ride_points(), "Run".into())
            .unwrap();
        assert!(engine.groups_dirty, "a sport change is owed a regroup");
    }

    #[test]
    fn a_new_or_replaced_track_marks_grouping_owed() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        engine
            .add_activity("a1".into(), ride_points(), "Ride".into())
            .unwrap();
        engine.groups_dirty = false;
        engine
            .add_activity("a2".into(), ride_points(), "Ride".into())
            .unwrap();
        assert!(engine.groups_dirty);

        engine.groups_dirty = false;
        let moved = vec![GpsPoint::new(47.0, 8.0), GpsPoint::new(47.001, 8.001)];
        engine
            .add_activity("a1".into(), moved, "Ride".into())
            .unwrap();
        assert!(engine.groups_dirty);
    }

    #[test]
    fn provisional_failure_rolls_back_every_row_and_retry_succeeds() {
        for table in [
            "activities",
            "gps_tracks",
            "signatures",
            "activity_bodies",
            "activity_metrics",
            "activity_heatmap",
        ] {
            let mut engine = PersistentEngine::in_memory().unwrap();
            engine.groups_dirty = false;
            engine.sections_dirty = false;
            engine.db.execute_batch(&format!("CREATE TRIGGER fail_provisional BEFORE INSERT ON {table} BEGIN SELECT RAISE(ABORT, 'injected failure'); END;")).unwrap();
            let body = crate::FfiActivityBody {
                activity_id: "local-test".into(),
                date: 1000.0,
                raw: r#"{"id":"local-test","name":"Ride","type":"Ride","distance":50,"moving_time":30,"elapsed_time":30}"#.into(),
            };
            let points = vec![GpsPoint::new(46.0, 7.0), GpsPoint::new(46.001, 7.001)];
            assert!(
                engine
                    .save_provisional_activity("local-test", points.clone(), &body,)
                    .is_err()
            );
            for row_table in [
                "activities",
                "activity_bodies",
                "activity_metrics",
                "activity_heatmap",
                "gps_tracks",
                "signatures",
            ] {
                let count: i64 = engine
                    .db
                    .query_row(&format!("SELECT COUNT(*) FROM {row_table}"), [], |r| {
                        r.get(0)
                    })
                    .unwrap();
                assert_eq!(count, 0, "failure at {table} left rows in {row_table}");
            }
            assert!(!engine.has_activity("local-test"));
            assert!(!engine.activity_metrics.contains_key("local-test"));
            assert!(engine.get_gps_track("local-test").is_none());
            assert!(engine.signature_cache.peek("local-test").is_none());
            assert!(!engine.groups_dirty);
            assert!(!engine.sections_dirty);
            assert!(engine.processed_activity_ids.is_empty());
            assert!(engine.db.is_autocommit());
            engine
                .db
                .execute_batch("DROP TRIGGER fail_provisional")
                .unwrap();
            engine
                .save_provisional_activity("local-test", points, &body)
                .unwrap();
            assert!(engine.has_activity("local-test"));
            assert!(engine.get_activity_body("local-test").is_some());
            assert!(engine.activity_metrics.contains_key("local-test"));
        }
    }

    #[test]
    fn provisional_empty_track_and_committed_retry_are_complete() {
        for points in [
            Vec::new(),
            vec![GpsPoint::new(46.0, 7.0), GpsPoint::new(46.001, 7.001)],
        ] {
            let mut engine = PersistentEngine::in_memory().unwrap();
            let body = crate::FfiActivityBody {
                activity_id: "local-test".into(),
                date: 1000.0,
                raw: r#"{"id":"local-test","name":"Ride","type":"Ride","distance":50,"moving_time":30,"elapsed_time":30}"#.into(),
            };
            for _ in 0..2 {
                engine
                    .save_provisional_activity("local-test", points.clone(), &body)
                    .unwrap();
                assert_eq!(
                    engine.get_activity_body("local-test").as_deref(),
                    Some(body.raw.as_str())
                );
                assert_eq!(engine.activity_metrics.len(), 1);
                let count: i64 = engine
                    .db
                    .query_row("SELECT activity_count FROM activity_heatmap", [], |r| {
                        r.get(0)
                    })
                    .unwrap();
                assert_eq!(count, 1);
                assert_eq!(engine.has_activity("local-test"), !points.is_empty());
            }
        }
    }

    #[test]
    fn provisional_rejects_mismatched_ids_before_any_write() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        let body = crate::FfiActivityBody {
            activity_id: "other".into(),
            date: 1000.0,
            raw: r#"{"id":"local-test","name":"Ride","type":"Ride","distance":50,"moving_time":30,"elapsed_time":30}"#.into(),
        };
        assert!(
            engine
                .save_provisional_activity("local-test", Vec::new(), &body)
                .is_err()
        );
        assert!(engine.activity_metrics.is_empty());
        assert!(engine.get_activity_body("local-test").is_none());
        assert!(engine.db.is_autocommit());
    }

    #[test]
    #[ignore = "manual timing of the five-second SQLite lock timeout"]
    fn provisional_locked_database_leaves_no_rows() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("provisional.db");
        let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
        let blocker = rusqlite::Connection::open(path).unwrap();
        blocker.execute_batch("BEGIN IMMEDIATE").unwrap();
        let body = crate::FfiActivityBody {
            activity_id: "local-test".into(),
            date: 1000.0,
            raw: r#"{"id":"local-test","name":"Ride","type":"Ride","distance":50,"moving_time":30,"elapsed_time":30}"#.into(),
        };
        let started = std::time::Instant::now();
        assert!(
            engine
                .save_provisional_activity("local-test", vec![GpsPoint::new(46.0, 7.0)], &body,)
                .is_err()
        );
        eprintln!("provisional SQLite lock failure: {:?}", started.elapsed());
        assert!(!engine.has_activity("local-test"));
        assert!(engine.get_activity_body("local-test").is_none());
        assert!(engine.activity_metrics.is_empty());
        assert!(engine.db.is_autocommit());
        blocker.execute_batch("ROLLBACK").unwrap();
        engine
            .save_provisional_activity("local-test", Vec::new(), &body)
            .unwrap();
    }

    #[test]
    #[ignore = "manual host timing for the save call budget"]
    fn provisional_long_ride_timing() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        let points = (0..18000)
            .map(|i| {
                GpsPoint::new(
                    46.0 + i as f64 * 0.00001,
                    7.0 + (i as f64 / 80.0).sin() * 0.002,
                )
            })
            .collect();
        let body = crate::FfiActivityBody {
            activity_id: "local-test".into(),
            date: 1000.0,
            raw: r#"{"id":"local-test","name":"Ride","type":"Ride","distance":50,"moving_time":30,"elapsed_time":30}"#.into(),
        };
        let started = std::time::Instant::now();
        engine
            .save_provisional_activity("local-test", points, &body)
            .unwrap();
        eprintln!("provisional 18000-point host save: {:?}", started.elapsed());
        assert!(engine.has_activity("local-test"));
    }

    /// An engine holding one activity with a stored track, so a removal has
    /// bounds to hand back.
    fn engine_with_track(id: &str, bounds: Bounds) -> PersistentEngine {
        let mut engine = PersistentEngine::in_memory().unwrap();
        let coords = vec![
            GpsPoint {
                latitude: bounds.min_lat,
                longitude: bounds.min_lng,
                elevation: None,
            },
            GpsPoint {
                latitude: bounds.max_lat,
                longitude: bounds.max_lng,
                elevation: None,
            },
        ];
        engine
            .add_activity(id.to_string(), coords, "Ride".to_string())
            .unwrap();
        engine
    }

    #[test]
    fn an_uploaded_duplicate_leaves_no_cached_metrics_or_time_stream() {
        let mut engine = engine_with_track("local-recording", bounds_at(46.0));
        engine
            .add_activity(
                "i4242".to_string(),
                vec![
                    GpsPoint {
                        latitude: 46.0,
                        longitude: 7.0,
                        elevation: None,
                    },
                    GpsPoint {
                        latitude: 46.1,
                        longitude: 7.1,
                        elevation: None,
                    },
                ],
                "Ride".to_string(),
            )
            .unwrap();
        engine
            .set_activity_metrics(vec![ActivityMetrics {
                activity_id: "local-recording".to_string(),
                ..Default::default()
            }])
            .unwrap();
        engine.set_time_streams_flat(&["local-recording".to_string()], &[0, 5], &[0]);
        assert!(engine.activity_metrics.contains_key("local-recording"));
        assert!(engine.time_streams.contains(&"local-recording".to_string()));
        engine.record_upload("local-recording", "i4242").unwrap();
        assert!(!engine.activity_metrics.contains_key("local-recording"));
        assert!(!engine.time_streams.contains(&"local-recording".to_string()));
    }

    /// Scenario: the `time` stream for an activity comes back empty upstream,
    /// and the fetch stores a zero-length row so the activity reads as
    /// answered rather than being asked again forever.
    ///
    /// Expected behaviour: it stays answered across a reload. The `point_count`
    /// guard beside it exists to refetch a legacy stream whose length disagrees
    /// with its track, and without the exemption it reads 0 against the track's
    /// 2 and offers the activity on every pass.
    #[test]
    fn an_empty_stream_row_reads_as_answered() {
        let mut engine = engine_with_track("a1", bounds_at(46.0));
        let ids = vec!["a1".to_string()];

        engine.set_time_streams_flat(&ids, &[], &[0]);
        // The memory cache would answer for this session, so ask the store the
        // question a relaunch asks.
        engine.time_streams.pop(&"a1".to_string());

        assert_eq!(
            engine.get_activities_missing_time_streams(&ids),
            Vec::<String>::new()
        );
    }

    /// Scenario: a stored stream longer than its track is read into the
    /// in-memory cache by a performance read, then a sync asks which
    /// activities still owe a stream.
    ///
    /// Expected behaviour: the cache does not answer for it; the length rule
    /// decides, so the activity is still owed.
    #[test]
    fn a_cached_stream_of_the_wrong_length_is_still_missing() {
        let mut engine = engine_with_track("a1", bounds_at(46.0));
        let ids = vec!["a1".to_string()];

        engine.store_time_stream("a1", &[0, 5, 10, 15, 20]).unwrap();
        assert!(engine.ensure_time_stream_loaded("a1"));
        assert!(engine.time_streams.contains(&"a1".to_string()));

        assert_eq!(engine.get_activities_missing_time_streams(&ids), ids);
    }

    /// The zero-count exemption must not swallow the case it sits beside: a
    /// stored stream whose length disagrees with its track is still offered
    /// for refetch, which is what puts every released 0.3.x row back in front
    /// of the sync.
    #[test]
    fn a_stream_shorter_than_its_track_is_still_missing() {
        let mut engine = engine_with_track("a1", bounds_at(46.0));
        let ids = vec!["a1".to_string()];

        engine.store_time_stream("a1", &[0]).unwrap();
        engine.time_streams.pop(&"a1".to_string());

        assert_eq!(engine.get_activities_missing_time_streams(&ids), ids);
    }

    /// A stream that matches its track is answered, empty row or not.
    #[test]
    fn a_stream_matching_its_track_is_answered() {
        let mut engine = engine_with_track("a1", bounds_at(46.0));
        let ids = vec!["a1".to_string()];

        engine.set_time_streams_flat(&ids, &[0, 5], &[0]);
        engine.time_streams.pop(&"a1".to_string());

        assert_eq!(
            engine.get_activities_missing_time_streams(&ids),
            Vec::<String>::new()
        );
    }

    /// Storing the empty answer twice is the same answer. The second pass must
    /// not reopen the activity, since a repeat sync is the ordinary case.
    #[test]
    fn a_repeated_empty_answer_stays_answered() {
        let mut engine = engine_with_track("a1", bounds_at(46.0));
        let ids = vec!["a1".to_string()];

        engine.set_time_streams_flat(&ids, &[], &[0]);
        engine.set_time_streams_flat(&ids, &[], &[0]);
        engine.time_streams.pop(&"a1".to_string());

        assert_eq!(
            engine.get_activities_missing_time_streams(&ids),
            Vec::<String>::new()
        );
    }

    /// An activity that was never asked has no row at all, and that is still
    /// the missing case. The exemption is on a row that exists and says zero.
    #[test]
    fn an_activity_with_no_row_is_missing() {
        let engine = engine_with_track("a1", bounds_at(46.0));
        let ids = vec!["a1".to_string()];

        assert_eq!(engine.get_activities_missing_time_streams(&ids), ids);
    }

    /// An activity with no track at all, an indoor ride, answers empty too.
    #[test]
    fn an_empty_answer_without_a_track_is_answered() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        engine
            .add_activity("a1".to_string(), Vec::new(), "VirtualRide".to_string())
            .ok();
        let ids = vec!["a1".to_string()];

        engine.set_time_streams_flat(&ids, &[], &[0]);
        engine.time_streams.pop(&"a1".to_string());

        assert_eq!(
            engine.get_activities_missing_time_streams(&ids),
            Vec::<String>::new()
        );
    }

    /// Scenario: the rows are deleted but the transaction has not committed,
    /// which is every instant between the deletes and the `COMMIT`, and the
    /// one a panic or a failed commit strands the engine in.
    ///
    /// Expected behaviour: the memory tiers still hold the activity, so a
    /// rollback leaves the two agreeing. They used to be emptied inside the
    /// transaction, and the engine is recovered from a poisoned lock rather
    /// than rebuilt, so the activity stayed on disk and gone from the feed for
    /// the rest of the session.
    #[test]
    fn the_row_deletes_leave_the_memory_tiers_alone() {
        let mut engine = engine_with_track("a1", bounds_at(47.0));

        engine.db.execute_batch("BEGIN IMMEDIATE").unwrap();
        engine.remove_activity_rows("a1").expect("rows deleted");

        assert!(
            engine.has_activity("a1"),
            "memory must still hold it while the transaction is open"
        );

        engine.db.execute_batch("ROLLBACK").unwrap();

        let rows: i64 = engine
            .db
            .query_row("SELECT COUNT(*) FROM activities", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 1, "the rollback kept the row");
        assert!(
            engine.has_activity("a1"),
            "and memory agrees with it, which is the whole point"
        );
    }

    /// The other half: a removal that commits does empty them.
    #[test]
    fn a_committed_removal_empties_the_memory_tiers() {
        let mut engine = engine_with_track("a1", bounds_at(47.0));
        engine
            .set_activity_metrics(vec![ActivityMetrics {
                activity_id: "a1".to_string(),
                date: 1000,
                moving_time: 30,
                ..Default::default()
            }])
            .unwrap();
        assert!(engine.activity_metrics.contains_key("a1"));

        engine.remove_activity("a1").expect("removed");

        assert!(!engine.has_activity("a1"));
        assert_eq!(engine.activity_count(), 0);
        assert!(!engine.activity_metrics.contains_key("a1"));
        engine
            .set_activity_metrics_extended(vec![crate::FfiActivityMetrics::from(ActivityMetrics {
                activity_id: "a1".into(),
                ..Default::default()
            })])
            .expect("metrics written again");
        let rows: i64 = engine
            .db
            .query_row(
                "SELECT COUNT(*) FROM activity_metrics WHERE activity_id = 'a1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rows, 1);
    }

    #[test]
    fn a_failed_removal_commit_keeps_the_prior_memory_generation() {
        let mut engine = engine_with_track("a1", bounds_at(47.0));
        engine
            .db
            .execute_batch(
                "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                distance_meters, is_user_defined, version, created_at, visit_count)
             VALUES ('s1', 'auto', 'Section 1', 'Ride', '[]', 400.0, 0, 1,
                '2026-01-01T00:00:00Z', 1);
             INSERT INTO section_activities (section_id, activity_id, direction,
                start_index, end_index, distance_meters)
             VALUES ('s1', 'a1', 'same', 0, 2, 400.0)",
            )
            .unwrap();
        engine.load_sections().unwrap();
        assert_eq!(engine.sections[0].activity_ids, vec!["a1"]);
        engine.section_identity_reseed();
        engine.section_identity_persist();
        assert_eq!(engine.section_identity_visible_len(), 1);
        engine
            .db
            .execute(
                "INSERT INTO processed_activities (activity_id) VALUES ('a1')",
                [],
            )
            .unwrap();
        engine.processed_activity_ids.insert("a1".to_string());
        let identity = engine.section_identity_blob();
        engine.db.commit_hook(Some(|| true));

        assert!(engine.remove_activity("a1").is_err());

        assert!(engine.has_activity("a1"));
        assert!(engine.processed_activity_ids.contains("a1"));
        assert_eq!(engine.sections[0].activity_ids, vec!["a1"]);
        assert_eq!(engine.sections[0].visit_count, 1);
        assert_eq!(engine.section_identity_blob(), identity);
        let stored_identity: Vec<u8> = engine
            .db
            .query_row(
                "SELECT blob FROM identity_state WHERE key = ?",
                [super::super::sections::SECTION_IDENTITY_KEY],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(Some(stored_identity), identity);
        let rows: i64 = engine
            .db
            .query_row(
                "SELECT COUNT(*) FROM activities WHERE id = 'a1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(rows, 1);
        engine.db.commit_hook(Some(|| false));
        engine.remove_activity("a1").unwrap();
        assert!(!engine.has_activity("a1"));
    }

    #[test]
    fn clearing_derived_activities_drops_their_metrics_from_memory() {
        let mut engine = engine_with_track("a1", bounds_at(47.0));
        engine
            .set_activity_metrics(vec![ActivityMetrics {
                activity_id: "a1".to_string(),
                ..Default::default()
            }])
            .unwrap();

        engine.clear_derived().unwrap();

        assert!(!engine.activity_metrics.contains_key("a1"));
    }

    #[test]
    fn a_failed_clear_keeps_the_prior_database_and_memory_generation() {
        let mut engine = engine_with_track("a1", bounds_at(47.0));
        engine
            .db
            .execute_batch(
                "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type)
             VALUES ('r1', 'a1', '[\"a1\"]', 'Ride');
             CREATE TRIGGER fail_clear BEFORE DELETE ON activities
             BEGIN SELECT RAISE(FAIL, 'cannot clear'); END",
            )
            .unwrap();
        assert!(crate::persistence::routes::pooled::group_by_id(&engine.db, "r1").is_some());

        assert!(engine.clear().is_err());

        let groups: i64 = engine
            .db
            .query_row(
                "SELECT COUNT(*) FROM route_groups WHERE id = 'r1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(groups, 1);
        assert!(engine.has_activity("a1"));
        assert!(crate::persistence::routes::pooled::group_by_id(&engine.db, "r1").is_some());

        engine.db.execute_batch("DROP TRIGGER fail_clear").unwrap();
        engine.db.commit_hook(Some(|| true));
        assert!(engine.clear().is_err());
        let groups: i64 = engine
            .db
            .query_row(
                "SELECT COUNT(*) FROM route_groups WHERE id = 'r1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(groups, 1);
        assert!(engine.has_activity("a1"));

        engine.db.commit_hook(Some(|| false));
        engine.clear().unwrap();
        assert!(!engine.has_activity("a1"));
    }

    fn bounds_at(lat: f64) -> Bounds {
        Bounds {
            min_lat: lat,
            max_lat: lat + 0.1,
            min_lng: 7.0,
            max_lng: 7.1,
        }
    }

    /// A tile on athlete A's ground in Lausanne, as the pass would have saved it.
    fn lausanne_tile(tiles: &std::path::Path) -> std::path::PathBuf {
        let z = 12;
        let x = crate::tiles::lon_to_tile_x(6.63, z).floor() as u32;
        let y = crate::tiles::lat_to_tile_y(46.52, z).floor() as u32;
        crate::tiles::save_tile(tiles, z, x, y, b"A's heat").expect("tile written");
        tiles
            .join(z.to_string())
            .join(x.to_string())
            .join(format!("{y}.png"))
    }

    /// Athlete B's first ride, all of it in Melbourne.
    fn melbourne_ride() -> Vec<GpsPoint> {
        (0..20)
            .map(|i| GpsPoint::new(-37.81 + f64::from(i) * 0.001, 144.96 + f64::from(i) * 0.001))
            .collect()
    }

    /// Store B's ride in the global engine and run one tile pass over it,
    /// answering how many tiles it drew. The pass slot is process-wide, so a
    /// pass another test left running is waited out rather than read as a
    /// refusal.
    fn sync_melbourne_and_draw() -> u32 {
        crate::persistence::with_persistent_engine(|e| {
            e.add_activity("b1".into(), melbourne_ride(), "Ride".into())
                .expect("B's ride stored")
        })
        .expect("engine");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
        loop {
            let handle =
                crate::persistence::with_persistent_engine(|e| e.generate_tiles_background())
                    .expect("engine");
            if let Some(handle) = handle {
                return handle.recv_blocking().expect("the pass answers");
            }
            assert!(
                std::time::Instant::now() < deadline,
                "no tile pass could start"
            );
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
    }

    /// Scenario: athlete A rode in Lausanne with the heatmap on. B signs in on
    /// the same device, accepts "Continue and delete" and syncs rides that are
    /// all in Melbourne. The wipe only marked the set dirty, and a dirty pass
    /// draws the tiles that are missing and removes none, so it never visits
    /// Lausanne and A's heat stayed on disk for B's map to serve.
    ///
    /// Expected behaviour: the wipe removes the whole set, so after it and B's
    /// first pass nothing of A's is left, and B's own ground is drawn.
    #[test]
    fn a_wipe_removes_the_previous_library_tiles() {
        let _guard = crate::test_globals::serial_global_state();
        let tmp = crate::test_globals::init_global_engine("wipe.db");
        let tiles = tmp.path().join("tiles");
        crate::persistence::with_persistent_engine(|e| {
            e.set_heatmap_tiles_path(tiles.to_string_lossy().into_owned())
        })
        .expect("engine");
        let a_tile = lausanne_tile(&tiles);

        crate::persistence::clear_all_background(None)
            .wait()
            .expect("the wipe");
        let drawn = sync_melbourne_and_draw();

        crate::persistence::with_persistent_engine(|e| e.clear_heatmap_tiles_path());
        assert!(drawn > 0, "B's pass drew nothing, so it proves nothing");
        assert!(
            !a_tile.exists(),
            "athlete A's Lausanne tile outlived the wipe"
        );
    }

    /// Scenario: the login screen wipes with the engine freshly opened, and
    /// the tiles path is set only once the heatmap turns on after sign-in, so
    /// the engine doing the wipe has no path of its own. The tiles are still
    /// on disk where the app always keeps them, and the map serves whatever
    /// file it finds there once B turns the heatmap on.
    ///
    /// Expected behaviour: the wipe removes the set in the directory it was
    /// handed, and leaves it marked so B's first pass draws the whole set.
    #[test]
    fn a_login_screen_wipe_removes_the_tiles_with_no_path_set() {
        let _guard = crate::test_globals::serial_global_state();
        let tmp = crate::test_globals::init_global_engine("login-wipe.db");
        let tiles = tmp.path().join("tiles");
        let a_tile = lausanne_tile(&tiles);
        assert!(
            crate::persistence::with_persistent_engine(|e| e.heatmap_tiles_path().is_none())
                .expect("engine"),
            "the engine has a tiles path, so this is not the login screen's wipe"
        );

        crate::persistence::clear_all_background(Some(tiles.to_string_lossy().into_owned()))
            .wait()
            .expect("the wipe");

        assert!(
            !a_tile.exists(),
            "athlete A's Lausanne tile outlived the wipe"
        );
        assert!(
            tiles.join(crate::persistence::tiles::DIRTY_MARKER).exists(),
            "the emptied set is not marked owed a draw"
        );
    }

    /// Puts a directory's permissions back when dropped, so a test that
    /// locked one leaves a temp directory its cleanup can remove.
    struct Unlock(std::path::PathBuf, u32);

    impl Drop for Unlock {
        fn drop(&mut self) {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&self.0, std::fs::Permissions::from_mode(self.1));
        }
    }

    /// Lock `dir` to `mode`, and refuse when the process can write into it
    /// anyway, since a privileged run cannot stage the failure at all.
    fn lock_dir(dir: &std::path::Path, mode: u32) -> Unlock {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(mode)).expect("chmod");
        let unlock = Unlock(dir.to_path_buf(), 0o755);
        assert!(
            std::fs::write(dir.join("probe"), b"").is_err(),
            "this process ignores directory permissions, so no failure can be staged"
        );
        unlock
    }

    /// Scenario: a zoom directory of athlete A's tiles cannot be removed during
    /// B's sign-in wipe. The wipe ignored the error, reported success, and the
    /// account change went ahead with A's tiles still on disk for B's map.
    ///
    /// Expected behaviour: the wipe fails, so the transition does not complete,
    /// and it still removed every tile it could.
    #[cfg(unix)]
    #[test]
    fn a_wipe_that_cannot_delete_a_tile_reports_failure() {
        let _guard = crate::test_globals::serial_global_state();
        let tmp = crate::test_globals::init_global_engine("stuck-wipe.db");
        let tiles = tmp.path().join("tiles");
        let a_tile = lausanne_tile(&tiles);
        crate::tiles::save_tile(&tiles, 11, 1, 1, b"A's heat").expect("tile written");
        let other = tiles.join("11").join("1").join("1.png");
        let _unlock = lock_dir(a_tile.parent().expect("column"), 0o555);

        let outcome =
            crate::persistence::clear_all_background(Some(tiles.to_string_lossy().into_owned()))
                .wait();

        assert!(
            outcome.is_err(),
            "the wipe reported success with A's tile still on disk"
        );
        assert!(a_tile.exists(), "the staged failure did not hold");
        assert!(
            !other.exists(),
            "one stuck zoom stopped the rest being removed"
        );
        assert!(
            tiles.join(crate::persistence::tiles::DIRTY_MARKER).exists(),
            "what was emptied is not marked owed a draw"
        );
    }

    /// Scenario: a zoom directory of tiles cannot be removed when the athlete
    /// taps Clear cache or turns the heatmap off. The clear logged it and
    /// answered as though the set was empty, so the settings screen said the
    /// cache was cleared with the heat still on disk.
    ///
    /// Expected behaviour: the clear fails, and it still removed every tile it
    /// could and marked the set owed a draw.
    #[cfg(unix)]
    #[test]
    fn a_clear_that_cannot_delete_a_tile_reports_failure() {
        let _guard = crate::test_globals::serial_global_state();
        let tmp = tempfile::TempDir::new().expect("tempdir");
        let tiles = tmp.path().join("tiles");
        let stuck = lausanne_tile(&tiles);
        crate::tiles::save_tile(&tiles, 11, 1, 1, b"heat").expect("tile written");
        let other = tiles.join("11").join("1").join("1.png");
        let _unlock = lock_dir(stuck.parent().expect("column"), 0o555);

        let outcome = crate::persistence::tiles::clear_tile_set(&tiles);

        assert!(
            outcome.is_err(),
            "the clear reported success with a tile still on disk"
        );
        assert!(stuck.exists(), "the staged failure did not hold");
        assert!(
            !other.exists(),
            "one stuck zoom stopped the rest being removed"
        );
        assert!(
            tiles.join(crate::persistence::tiles::DIRTY_MARKER).exists(),
            "what was emptied is not marked owed a draw"
        );
    }

    /// Scenario: an upgrade changes the tile format and one zoom directory of
    /// old-format tiles cannot be removed. The version file was stamped
    /// current anyway, so the next launch saw a current set and served the
    /// old tiles for good.
    ///
    /// Expected behaviour: the version file stays stale while the clear fails,
    /// so the next launch retries, and stamps it once the clear succeeds.
    #[cfg(unix)]
    #[test]
    fn a_failed_format_clear_leaves_the_version_unstamped_until_a_retry_succeeds() {
        let _guard = crate::test_globals::serial_global_state();
        let tmp = crate::test_globals::init_global_engine("stale-format.db");
        let tiles = tmp.path().join("tiles");
        let stuck = lausanne_tile(&tiles);
        std::fs::write(tiles.join("version.txt"), "0").expect("old version written");
        let path = tiles.to_string_lossy().into_owned();
        let read_version =
            || std::fs::read_to_string(tiles.join("version.txt")).unwrap_or_default();

        let unlock = lock_dir(stuck.parent().expect("column"), 0o555);
        crate::persistence::with_persistent_engine(|e| e.set_heatmap_tiles_path(path.clone()))
            .expect("engine");
        assert!(stuck.exists(), "the staged failure did not hold");
        assert_ne!(
            read_version().trim(),
            crate::persistence::tiles::TILE_FORMAT_VERSION,
            "the version was stamped current with old-format tiles still on disk"
        );

        drop(unlock);
        crate::persistence::with_persistent_engine(|e| e.set_heatmap_tiles_path(path.clone()))
            .expect("engine");
        crate::persistence::with_persistent_engine(|e| e.clear_heatmap_tiles_path());
        assert!(!stuck.exists(), "the retry did not clear the old tile");
        assert_eq!(
            read_version().trim(),
            crate::persistence::tiles::TILE_FORMAT_VERSION,
            "the version was not stamped after a successful clear"
        );
    }

    /// Scenario: the tiles directory cannot be listed, so Clear cache removed
    /// nothing and reported nothing wrong.
    ///
    /// Expected behaviour: the clear fails rather than reading an unlisted set
    /// as an empty one.
    #[cfg(unix)]
    #[test]
    fn a_clear_that_cannot_list_the_tiles_reports_failure() {
        let _guard = crate::test_globals::serial_global_state();
        let tmp = tempfile::TempDir::new().expect("tempdir");
        let tiles = tmp.path().join("tiles");
        let tile = lausanne_tile(&tiles);
        let _unlock = lock_dir(&tiles, 0o100);

        let outcome = crate::persistence::tiles::clear_tile_set(&tiles);

        drop(_unlock);
        assert!(
            outcome.is_err(),
            "the clear reported success over a set it could not list"
        );
        assert!(tile.exists(), "the staged failure did not hold");
    }

    /// Scenario: the tiles directory cannot be listed, so the wipe removed
    /// nothing and said nothing.
    ///
    /// Expected behaviour: the wipe fails rather than reading an unlisted set
    /// as an empty one.
    #[cfg(unix)]
    #[test]
    fn a_wipe_that_cannot_list_the_tiles_reports_failure() {
        let _guard = crate::test_globals::serial_global_state();
        let tmp = crate::test_globals::init_global_engine("unlisted-wipe.db");
        let tiles = tmp.path().join("tiles");
        let a_tile = lausanne_tile(&tiles);
        let _unlock = lock_dir(&tiles, 0o100);

        let outcome =
            crate::persistence::clear_all_background(Some(tiles.to_string_lossy().into_owned()))
                .wait();

        drop(_unlock);
        assert!(
            outcome.is_err(),
            "the wipe reported success over a set it could not list"
        );
        assert!(a_tile.exists(), "the staged failure did not hold");
    }

    /// Scenario: `remove_activity` swept the removed activity's tiles inline,
    /// under the engine write lock. A 40 km bounding box at z17 is about 10,000
    /// tiles with two `path.exists()` each, and a census reconcile calls this
    /// once per activity the athlete deleted upstream, inside one hold.
    ///
    /// Expected behaviour: the removal answers with the bounds and sweeps
    /// nothing, so a caller removing many hands one set to one detached thread
    /// rather than spawning a thread apiece, each overwriting the cancel token
    /// of the one before it.
    #[test]
    fn a_deferred_removal_hands_back_its_bounds_and_sweeps_nothing() {
        let mut engine = engine_with_track("gone", bounds_at(46.0));

        let swept = engine
            .remove_departed_activity("gone")
            .expect("the removal succeeds");

        assert_eq!(
            swept.map(|b| b.min_lat),
            Some(46.0),
            "the caller gets the ground to sweep"
        );
        assert!(
            !engine.activity_metadata.contains_key("gone"),
            "and the rows are gone all the same"
        );
    }

    /// An activity with no stored bounds owes no sweep, so the caller is handed
    /// nothing rather than a rectangle at the origin, which at z17 is a walk of
    /// the Gulf of Guinea.
    #[test]
    fn a_removal_with_no_bounds_owes_no_sweep() {
        let mut engine = engine_with_track("gone", bounds_at(46.0));
        engine.activity_metadata.remove("gone");

        assert!(engine.remove_departed_activity("gone").unwrap().is_none());
    }

    /// Scenario: an activity leaves intervals.icu. The server's curves were
    /// drawn with it, and nothing else tells the curve sweep they changed.
    ///
    /// Expected behaviour: the removal stamps its sport for the sweep, and a
    /// clear takes the stamp with the library it described.
    #[test]
    fn a_departed_activity_stamps_its_sport_for_the_curve_sweep() {
        let mut engine = engine_with_track("gone", bounds_at(46.0));
        assert!(engine.try_curve_removals_by_sport().unwrap().is_empty());

        engine.remove_departed_activity("gone").unwrap();

        let stamps = engine.try_curve_removals_by_sport().unwrap();
        assert_eq!(stamps.len(), 1);
        assert_eq!(stamps[0].0, "Ride");
        assert!(stamps[0].1.is_some_and(|at| at > 1_700_000_000));

        engine.clear().unwrap();
        assert!(engine.try_curve_removals_by_sport().unwrap().is_empty());
    }

    /// A body stored without a metrics row or a track still names its sport,
    /// so its departure refetches that family's curves.
    #[test]
    fn a_departed_body_with_no_metrics_row_stamps_its_type() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        engine
            .upsert_activity_bodies(&[(
                "body-only".to_string(),
                1_700_000_000,
                r#"{"id":"body-only","type":"Run"}"#.to_string(),
            )])
            .unwrap();

        engine.remove_departed_activity("body-only").unwrap();

        let stamps = engine.try_curve_removals_by_sport().unwrap();
        assert_eq!(stamps.len(), 1);
        assert_eq!(stamps[0].0, "Run");
    }

    /// A departure kept for a section leaves a marker beside its stamp, and
    /// both describe the library a clear takes.
    #[test]
    fn a_clear_takes_a_kept_departures_marker() {
        let mut engine = engine_with_track("gone", bounds_at(46.0));
        stamp_kept_departure(&engine.db, "gone").unwrap();
        let settings = |engine: &PersistentEngine| -> i64 {
            engine
                .db
                .query_row(
                    "SELECT COUNT(*) FROM settings
                     WHERE substr(key, 1, length(?1)) = ?1 OR substr(key, 1, length(?2)) = ?2",
                    params![
                        crate::persistence::settings_keys::CURVE_REMOVED_AT_PREFIX,
                        crate::persistence::settings_keys::CURVE_DEPARTED_PREFIX
                    ],
                    |row| row.get(0),
                )
                .unwrap()
        };
        assert_eq!(settings(&engine), 2);

        engine.clear().unwrap();

        assert_eq!(settings(&engine), 0);
    }

    /// The stamp is written in the removal's own transaction, so a removal
    /// that does not commit leaves the sweep nothing to act on.
    #[test]
    fn a_departed_removal_that_fails_stamps_nothing() {
        let mut engine = engine_with_track("gone", bounds_at(46.0));
        engine
            .db
            .execute_batch(
                "CREATE TEMP TRIGGER refuse_removal BEFORE DELETE ON activities
                 BEGIN SELECT RAISE(ABORT, 'refused'); END;",
            )
            .unwrap();

        assert!(engine.remove_departed_activity("gone").is_err());

        assert!(engine.has_activity("gone"));
        assert!(engine.try_curve_removals_by_sport().unwrap().is_empty());
    }

    /// Nothing to sweep spawns nothing: a reconcile that removed only
    /// activities with no track must not start a thread to do nothing.
    #[test]
    fn an_empty_sweep_starts_nothing() {
        let mut engine = engine_with_track("kept", bounds_at(46.0));
        engine.heatmap_tiles_path = None;

        engine.sweep_tiles_for(Vec::new(), "nothing");
        engine.sweep_tiles_for(vec![bounds_at(46.0)], "no path configured");
    }

    /// Scenario: a sync re-ingests activities it already holds, which is most
    /// of what a sync does, and `add_activities_batch` sweeps the heatmap tiles
    /// of every activity it stored.
    ///
    /// Expected behaviour: only the activities whose ground actually moved owe
    /// a sweep. The batch already decides this for the processed set, and the
    /// comment there says a verbatim re-ingest "is NOT a mutation and must stay
    /// idempotent". The tile sweep did not ask: it walked the full rectangle of
    /// every stored activity at every zoom, deleting tiles that were correct,
    /// and then marked the whole set dirty for a redraw nobody needed.
    #[test]
    fn only_new_and_mutated_activities_owe_a_tile_sweep() {
        let batch = vec![
            ("fresh".to_string(), track_at(46.0), "Ride".to_string()),
            ("changed".to_string(), track_at(47.0), "Ride".to_string()),
            ("same".to_string(), track_at(48.0), "Ride".to_string()),
        ];
        let known: HashSet<String> = ["changed".to_string(), "same".to_string()].into();
        let before: HashMap<String, SweepGround> =
            [("changed".to_string(), SweepGround::Track(track_at(47.5)))].into();

        let owed = ground_needing_tile_sweep(&batch, &known, &before);

        assert_eq!(
            owed,
            vec![
                SweepGround::Track(track_at(46.0)),
                SweepGround::Track(track_at(47.0)),
                SweepGround::Track(track_at(47.5)),
            ],
            "the unchanged re-ingest was swept, or the changed one's old ground was not"
        );
    }

    /// Expected behaviour: a batch of nothing but verbatim re-ingests owes no
    /// sweep at all, so no thread is spawned and the tile set is not marked
    /// dirty. That is the case a routine sync is mostly made of.
    #[test]
    fn a_batch_of_verbatim_re_ingests_owes_no_sweep() {
        let batch = vec![
            ("a".to_string(), track_at(46.0), "Ride".to_string()),
            ("b".to_string(), track_at(47.0), "Ride".to_string()),
        ];
        let known: HashSet<String> = ["a".to_string(), "b".to_string()].into();

        assert!(ground_needing_tile_sweep(&batch, &known, &HashMap::new()).is_empty());
    }

    /// Expected behaviour: a first sync, where the catalogue is empty, still
    /// sweeps everything. The narrowing must not read as "never sweep".
    #[test]
    fn a_first_sync_sweeps_every_activity_it_stored() {
        let batch = vec![
            ("a".to_string(), track_at(46.0), "Ride".to_string()),
            ("b".to_string(), track_at(47.0), "Ride".to_string()),
        ];

        assert_eq!(
            ground_needing_tile_sweep(&batch, &HashSet::new(), &HashMap::new()).len(),
            2
        );
    }

    fn track_at(lat: f64) -> Vec<GpsPoint> {
        vec![GpsPoint::new(lat, 7.0), GpsPoint::new(lat + 0.01, 7.01)]
    }

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

    /// Scenario: ranking wants the tracks of the few activities that have
    /// passes, and the library holds many that do not.
    ///
    /// Expected behaviour: the walk hands over only what was asked for, and
    /// never pays the blob read or the decode for the rest.
    #[test]
    fn a_track_walk_decodes_only_the_ids_it_was_asked_for() {
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
        for id in ["a1", "a2", "a3"] {
            engine
                .add_activity(id.to_string(), coords.clone(), "Ride".to_string())
                .unwrap();
        }

        let wanted: HashSet<&str> = ["a2"].into_iter().collect();
        let mut seen: Vec<(String, usize)> = Vec::new();
        let walk = engine.for_each_track(&wanted, |id, pts| seen.push((id.to_string(), pts.len())));

        assert_eq!(seen, vec![("a2".to_string(), 2)]);
        assert_eq!(walk.visited, 1);
        assert_eq!(walk.corrupt, 0);
        assert!(!walk.is_incomplete());
    }

    /// A corrupt row the caller did not ask for is not its problem, and
    /// decoding it to find out would be the cost the filter exists to avoid.
    #[test]
    fn a_corrupt_row_outside_the_wanted_set_is_not_counted() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        let coords = vec![GpsPoint {
            latitude: 46.2,
            longitude: 7.3,
            elevation: None,
        }];
        for id in ["a1", "a2"] {
            engine
                .add_activity(id.to_string(), coords.clone(), "Ride".to_string())
                .unwrap();
        }
        engine
            .db
            .execute(
                "UPDATE gps_tracks SET track_data = ? WHERE activity_id = 'a1'",
                params![vec![0xff_u8, 0xfe, 0xfd]],
            )
            .unwrap();

        let wanted: HashSet<&str> = ["a2"].into_iter().collect();
        let walk = engine.for_each_track(&wanted, |_, _| {});

        assert_eq!(walk.visited, 1);
        assert_eq!(walk.corrupt, 0);
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
        ("section_forced_matches", "activity_id"),
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
            "INSERT INTO section_forced_matches (section_id, activity_id, forced_at)
             VALUES ('s1', ?1, 0)",
            "INSERT INTO section_rank_dirty_activity (activity_id) VALUES (?1) ON CONFLICT DO NOTHING",
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

        // The ones the foreign key cascade already reaches, and `push_runs`, whose
        // `activity_id` is a label in a log line rather than the activity's
        // data: it is the newest twenty runs of the native push worker,
        // trimmed by count, and a removed activity does not unmake the run
        // that happened.
        let cascaded = [
            "gps_tracks",
            "signatures",
            "time_streams",
            "section_activities",
            "processed_activities",
            "activity_climb_bests",
            "push_runs",
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

    fn two_points() -> Vec<GpsPoint> {
        vec![
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
        ]
    }

    /// Scenario: the id reconcile answered a failed query with an empty map,
    /// which the sync reads as "no row claims this server id" and stores the
    /// activity a second time under a fresh key.
    ///
    /// Expected behaviour: the failure is the answer, so the caller can tell
    /// an unclaimed id from a lookup it never got.
    #[test]
    fn a_failed_id_reconcile_is_an_error_and_not_an_empty_map() {
        let engine = PersistentEngine::in_memory().unwrap();
        engine.db.execute_batch("DROP TABLE activities").unwrap();

        let looked_up = engine.local_ids_for_intervals_ids(&["i1".to_string()]);

        assert!(looked_up.is_err(), "the lookup had no table to read");
    }

    /// An empty request needs no query, and answers with an empty map rather
    /// than an error.
    #[test]
    fn an_empty_id_reconcile_answers_without_a_query() {
        let engine = PersistentEngine::in_memory().unwrap();

        assert_eq!(
            engine.local_ids_for_intervals_ids(&[]).expect("no query"),
            std::collections::HashMap::new()
        );
    }

    /// Scenario: `add_activities_batch` opened `BEGIN IMMEDIATE` and propagated
    /// every write error with `?`, so a failure left the connection inside the
    /// transaction. Every later `BEGIN` then failed with "cannot start a
    /// transaction within a transaction", and the first sibling that does roll
    /// back discarded everything written since.
    ///
    /// Expected behaviour: the same rollback arm every sibling writer has.
    #[test]
    fn a_failed_batch_leaves_the_connection_out_of_its_transaction() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        engine.db.execute_batch("DROP TABLE gps_tracks").unwrap();

        let failed =
            engine.add_activities_batch(vec![("a1".to_string(), two_points(), "Ride".to_string())]);

        assert!(failed.is_err(), "the write had nowhere to store the track");
        assert!(
            engine.db.is_autocommit(),
            "the rollback ran, so the next writer can begin its own"
        );
    }

    /// The in-memory catalogue is the engine's answer to what it holds, so a
    /// batch that rolled back must not leave it claiming the activity.
    #[test]
    fn a_failed_batch_adds_nothing_to_the_in_memory_catalogue() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        engine.db.execute_batch("DROP TABLE gps_tracks").unwrap();

        let _ =
            engine.add_activities_batch(vec![("a1".to_string(), two_points(), "Ride".to_string())]);

        assert!(
            !engine.activity_metadata.contains_key("a1"),
            "nothing was stored, so nothing is known"
        );
        assert!(engine.signature_cache.get(&"a1".to_string()).is_none());
    }

    #[test]
    fn a_batch_that_lands_is_still_in_the_catalogue_afterwards() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        engine
            .add_activities_batch(vec![("a1".to_string(), two_points(), "Ride".to_string())])
            .unwrap();

        assert!(engine.activity_metadata.contains_key("a1"));
        assert!(engine.db.is_autocommit());
    }

    /// Scenario: the feed's preview line is drawn from the stored track, and a
    /// re-ingest can replace that track with a different one. Nothing said
    /// which activities that happened to, so the only shape available to a
    /// reader was re-reading every card's track on every activities event.
    ///
    /// Expected behaviour: the batch reports exactly the ids whose stored
    /// track it replaced with a different one.
    #[test]
    fn a_batch_reports_the_tracks_it_replaced_with_different_ones() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        engine
            .add_activities_batch(vec![
                ("kept".to_string(), two_points(), "Ride".to_string()),
                ("moved".to_string(), two_points(), "Ride".to_string()),
            ])
            .unwrap();

        let mut elsewhere = two_points();
        elsewhere[1].latitude = 47.5;

        let mutated = engine
            .add_activities_batch(vec![
                ("kept".to_string(), two_points(), "Ride".to_string()),
                ("moved".to_string(), elsewhere, "Ride".to_string()),
                ("new".to_string(), two_points(), "Ride".to_string()),
            ])
            .unwrap();

        assert_eq!(
            mutated,
            vec!["moved".to_string()],
            "a verbatim re-ingest is not a mutation, and an activity the library did not hold is not one either"
        );
    }

    /// A first sync is every activity arriving at once, which is the batch a
    /// reader must not be told to re-read anything for.
    #[test]
    fn a_first_sync_reports_no_mutations() {
        let mut engine = PersistentEngine::in_memory().unwrap();

        let mutated = engine
            .add_activities_batch(vec![("a1".to_string(), two_points(), "Ride".to_string())])
            .unwrap();

        assert!(mutated.is_empty());
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

#[cfg(test)]
mod statement_cache_tests {
    //! Scenario: the per-row loaders call `prepare`, which parses the SQL
    //! afresh every time. A regroup over 750 activities parses the same
    //! `SELECT` 750 times, under the write lock.
    //!
    //! Expected behaviour: they go through the connection's statement cache,
    //! so the SQL is parsed once and the rest of the walk reuses it. The
    //! authorizer is what counts parses: SQLite runs it while a statement is
    //! being prepared and not when a prepared one runs again.

    use std::sync::atomic::{AtomicUsize, Ordering};

    use rusqlite::hooks::{AuthContext, Authorization};

    use super::*;

    static PREPARES: AtomicUsize = AtomicUsize::new(0);

    /// One column, because the authorizer runs once per column a statement
    /// reads and the count wanted here is of statements.
    fn count_prepares(engine: &PersistentEngine, table: &'static str, column: &'static str) {
        PREPARES.store(0, Ordering::Relaxed);
        engine.db.authorizer(Some(move |ctx: AuthContext<'_>| {
            if let rusqlite::hooks::AuthAction::Read {
                table_name,
                column_name,
                ..
            } = ctx.action
                && table_name == table
                && column_name == column
            {
                PREPARES.fetch_add(1, Ordering::Relaxed);
            }
            Authorization::Allow
        }));
    }

    fn stop_counting(engine: &PersistentEngine) {
        engine
            .db
            .authorizer(None::<fn(AuthContext<'_>) -> Authorization>);
    }

    fn engine_with(ids: &[&str]) -> PersistentEngine {
        let mut engine = PersistentEngine::in_memory().unwrap();
        for (i, id) in ids.iter().enumerate() {
            let base = 46.0 + i as f64 * 0.01;
            let coords = vec![
                GpsPoint {
                    latitude: base,
                    longitude: 7.0,
                    elevation: None,
                },
                GpsPoint {
                    latitude: base + 0.005,
                    longitude: 7.0,
                    elevation: None,
                },
            ];
            engine
                .add_activity((*id).to_string(), coords, "Ride".to_string())
                .unwrap();
        }
        engine
    }

    #[test]
    fn a_walk_of_the_signatures_parses_the_select_once() {
        let ids = ["a1", "a2", "a3", "a4"];
        let engine = engine_with(&ids);

        count_prepares(&engine, "signatures", "points");
        for id in ids {
            engine.load_signature_from_db(id);
        }
        let parses = PREPARES.load(Ordering::Relaxed);
        stop_counting(&engine);

        assert_eq!(
            parses, 1,
            "four signature loads parsed the same SELECT {parses} times"
        );
    }

    #[test]
    fn a_walk_of_the_time_streams_parses_the_select_once() {
        let ids = ["a1", "a2", "a3", "a4"];
        let mut engine = engine_with(&ids);
        for id in ids {
            engine.set_time_streams_flat(&[(*id).to_string()], &[1, 2], &[2]);
        }

        count_prepares(&engine, "time_streams", "times");
        for id in ids {
            engine.load_time_stream(id);
        }
        let parses = PREPARES.load(Ordering::Relaxed);
        stop_counting(&engine);

        assert_eq!(
            parses, 1,
            "four time-stream loads parsed the same SELECT {parses} times"
        );
    }
}
