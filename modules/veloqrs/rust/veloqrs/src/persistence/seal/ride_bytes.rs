//! Which bytes a ride packs, and how a pack's bytes become a ride again.
//!
//! This is the one owner of the `streams.bin` body. [`packed_entries`] says
//! what goes into a ride's pack entries, [`unpack_rows`] reads the rows entry
//! back and [`store_packed_ride`] writes it into a library. The pack module
//! frames and seals bytes and never chooses them.
//!
//! Every ride packs its decoded rows, so a library with no stored original for
//! a ride (every ride an account can serve again) still has its ride in the
//! pack. A ride that holds an original packs that file as well. The rows are
//! what a reinstall shows without a fetch: the stored columns of the ride's
//! rows in each table, carried as they are stored, so a track or a series is
//! written once, in the codec that stores it.
//!
//! The body is one version byte, then one postcard value, deflated:
//!
//! ```text
//! deflate( version u8 = 1 | postcard(PackedRide) )
//! ```
//!
//! A reader refuses a version it does not know by name, and version 1 stays
//! readable for good.

use std::io::Read;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use super::pack::{ENTRY_LIMIT, EntryKind};
use crate::persistence::originals::{deflate, original_of};

/// The version of the rows body this build writes.
pub const ROWS_FORMAT_VERSION: u8 = 1;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum RowsError {
    #[error("The ride's rows could not be read or written: {0}")]
    Sql(String),
    #[error("The ride's rows are version {0}, which is newer than this build reads")]
    NewerVersion(u8),
    #[error("The ride's rows are version {0}, which no build wrote")]
    UnsupportedVersion(u8),
    #[error("The ride's rows are damaged: {0}")]
    Damaged(String),
}

impl From<rusqlite::Error> for RowsError {
    fn from(e: rusqlite::Error) -> Self {
        RowsError::Sql(e.to_string())
    }
}

/// The `activities` row, less the key.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActivityRow {
    pub sport_type: String,
    pub min_lat: f64,
    pub max_lat: f64,
    pub min_lng: f64,
    pub max_lng: f64,
    pub created_at: Option<i64>,
    pub start_date: Option<i64>,
    pub name: Option<String>,
    pub distance_meters: Option<f64>,
    pub duration_secs: Option<i64>,
    pub intervals_id: Option<String>,
}

/// The `activity_bodies` row, less the key: the body as the server sent it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BodyRow {
    pub date: i64,
    pub raw: String,
    pub intervals_id: Option<String>,
}

/// The `gps_tracks` row, less the key. `track_data` is the polyline codec's
/// blob as stored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrackRow {
    pub track_data: Vec<u8>,
    pub point_count: i64,
    pub elevation_source: i64,
    pub elevation_settled_version: Option<String>,
    pub elevation_state: i64,
    pub elevation_attempts: i64,
}

/// The `time_streams` row, less the key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TimeStreamRow {
    pub times: Vec<u8>,
    pub point_count: i64,
}

/// One `activity_streams` row, less the key. `data` is the series codec's blob
/// as stored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StreamRow {
    pub kind: String,
    pub data: Vec<u8>,
    pub sample_count: i64,
}

/// What a row made from a file is compared by, beyond the start and the sport
/// the body gives.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IdentityRow {
    pub device_serial: Option<i64>,
    pub created_unix: Option<i64>,
}

/// The ride's `activity_census` row: what the server said about it when it was
/// last listed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CensusRow {
    pub athlete_id: String,
    pub intervals_id: String,
    pub start_date_local: Option<String>,
    pub created: Option<String>,
    pub icu_sync_date: Option<String>,
    pub has_latlng: bool,
    pub has_series: bool,
}

/// A ride's decoded rows, under the key it is stored by.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PackedRide {
    pub key: String,
    pub activity: Option<ActivityRow>,
    pub body: Option<BodyRow>,
    pub track: Option<TrackRow>,
    pub time_stream: Option<TimeStreamRow>,
    pub streams: Vec<StreamRow>,
    pub interval_body: Option<String>,
    pub identity: Option<IdentityRow>,
    pub census: Option<CensusRow>,
}

fn read_activity(conn: &Connection, key: &str) -> Result<Option<ActivityRow>, RowsError> {
    Ok(conn
        .prepare_cached(
            "SELECT sport_type, min_lat, max_lat, min_lng, max_lng, created_at, start_date,
                    name, distance_meters, duration_secs, intervals_id
             FROM activities WHERE id = ?1",
        )?
        .query_row(params![key], |r| {
            Ok(ActivityRow {
                sport_type: r.get(0)?,
                min_lat: r.get(1)?,
                max_lat: r.get(2)?,
                min_lng: r.get(3)?,
                max_lng: r.get(4)?,
                created_at: r.get(5)?,
                start_date: r.get(6)?,
                name: r.get(7)?,
                distance_meters: r.get(8)?,
                duration_secs: r.get(9)?,
                intervals_id: r.get(10)?,
            })
        })
        .optional()?)
}

fn read_body(conn: &Connection, key: &str) -> Result<Option<BodyRow>, RowsError> {
    Ok(conn
        .prepare_cached(
            "SELECT date, raw, intervals_id FROM activity_bodies WHERE activity_id = ?1",
        )?
        .query_row(params![key], |r| {
            Ok(BodyRow {
                date: r.get(0)?,
                raw: r.get(1)?,
                intervals_id: r.get(2)?,
            })
        })
        .optional()?)
}

fn read_track(conn: &Connection, key: &str) -> Result<Option<TrackRow>, RowsError> {
    Ok(conn
        .prepare_cached(
            "SELECT track_data, point_count, elevation_source, elevation_settled_version,
                    elevation_state, elevation_attempts
             FROM gps_tracks WHERE activity_id = ?1",
        )?
        .query_row(params![key], |r| {
            Ok(TrackRow {
                track_data: r.get(0)?,
                point_count: r.get(1)?,
                elevation_source: r.get(2)?,
                elevation_settled_version: r.get(3)?,
                elevation_state: r.get(4)?,
                elevation_attempts: r.get(5)?,
            })
        })
        .optional()?)
}

fn read_time_stream(conn: &Connection, key: &str) -> Result<Option<TimeStreamRow>, RowsError> {
    Ok(conn
        .prepare_cached("SELECT times, point_count FROM time_streams WHERE activity_id = ?1")?
        .query_row(params![key], |r| {
            Ok(TimeStreamRow {
                times: r.get(0)?,
                point_count: r.get(1)?,
            })
        })
        .optional()?)
}

fn read_streams(conn: &Connection, key: &str) -> Result<Vec<StreamRow>, RowsError> {
    Ok(conn
        .prepare_cached(
            "SELECT kind, data, sample_count FROM activity_streams
             WHERE activity_id = ?1 ORDER BY kind",
        )?
        .query_map(params![key], |r| {
            Ok(StreamRow {
                kind: r.get(0)?,
                data: r.get(1)?,
                sample_count: r.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?)
}

fn read_interval_body(conn: &Connection, key: &str) -> Result<Option<String>, RowsError> {
    Ok(conn
        .prepare_cached("SELECT raw FROM interval_bodies WHERE activity_id = ?1")?
        .query_row(params![key], |r| r.get(0))
        .optional()?)
}

fn read_identity(conn: &Connection, key: &str) -> Result<Option<IdentityRow>, RowsError> {
    Ok(conn
        .prepare_cached(
            "SELECT device_serial, created_unix FROM ride_identity
             WHERE activity_id = ?1 AND (device_serial IS NOT NULL OR created_unix IS NOT NULL)",
        )?
        .query_row(params![key], |r| {
            Ok(IdentityRow {
                device_serial: r.get(0)?,
                created_unix: r.get(1)?,
            })
        })
        .optional()?)
}

fn read_census(conn: &Connection, key: &str) -> Result<Option<CensusRow>, RowsError> {
    Ok(conn
        .prepare_cached(
            "SELECT athlete_id, intervals_id, start_date_local, created, icu_sync_date,
                    has_latlng, has_series
             FROM activity_census
             WHERE intervals_id IN (
                 ?1,
                 (SELECT intervals_id FROM activities WHERE id = ?1),
                 (SELECT intervals_id FROM activity_bodies WHERE activity_id = ?1))
             ORDER BY athlete_id, intervals_id LIMIT 1",
        )?
        .query_row(params![key], |r| {
            Ok(CensusRow {
                athlete_id: r.get(0)?,
                intervals_id: r.get(1)?,
                start_date_local: r.get(2)?,
                created: r.get(3)?,
                icu_sync_date: r.get(4)?,
                has_latlng: r.get(5)?,
                has_series: r.get(6)?,
            })
        })
        .optional()?)
}

/// The rows the library holds for `key`, or `None` when it holds neither an
/// `activities` row nor a body for it.
fn collect_ride(conn: &Connection, key: &str) -> Result<Option<PackedRide>, RowsError> {
    let activity = read_activity(conn, key)?;
    let body = read_body(conn, key)?;
    if activity.is_none() && body.is_none() {
        return Ok(None);
    }
    Ok(Some(PackedRide {
        key: key.to_string(),
        activity,
        body,
        track: read_track(conn, key)?,
        time_stream: read_time_stream(conn, key)?,
        streams: read_streams(conn, key)?,
        interval_body: read_interval_body(conn, key)?,
        identity: read_identity(conn, key)?,
        census: read_census(conn, key)?,
    }))
}

/// Deflate a rows body.
///
/// # Errors
///
/// Fails when the encoder does, which a write to memory does not.
pub fn deflate_rows(body: &[u8]) -> Result<Vec<u8>, RowsError> {
    deflate(body).map_err(|e| RowsError::Damaged(e.to_string()))
}

/// Inflate a rows body, refusing one that inflates past the pack's entry limit.
///
/// # Errors
///
/// Fails when the bytes are not a deflate stream or inflate past the limit.
pub fn inflate_rows(bytes: &[u8]) -> Result<Vec<u8>, RowsError> {
    let mut out = Vec::new();
    let read = flate2::read::DeflateDecoder::new(bytes)
        .take(ENTRY_LIMIT + 1)
        .read_to_end(&mut out)
        .map_err(|e| RowsError::Damaged(e.to_string()))?;
    if read as u64 > ENTRY_LIMIT {
        return Err(RowsError::Damaged("the rows inflate past the limit".into()));
    }
    Ok(out)
}

/// The bytes of the rows entry for `ride`.
fn pack_rows(ride: &PackedRide) -> Result<Vec<u8>, RowsError> {
    let body = postcard::to_extend(ride, vec![ROWS_FORMAT_VERSION])
        .map_err(|e| RowsError::Damaged(e.to_string()))?;
    deflate_rows(&body)
}

/// The ride-keyed mirror tables whose rows [`PackedRide`] carries. Every other
/// mirror table keyed by `activity_id` is written beside the pack by the plain
/// library export.
pub const PACKED_RIDE_TABLES: &[&str] = &[
    "activity_bodies",
    "gps_tracks",
    "time_streams",
    "activity_streams",
    "interval_bodies",
];

/// The deflated rows entry for `key` as the plain export writes it: the same
/// rows without the identity row, whose device serial the export keeps out.
///
/// # Errors
///
/// Fails when a table cannot be read or the rows cannot be encoded.
pub fn exported_rows(conn: &Connection, key: &str) -> Result<Option<Vec<u8>>, RowsError> {
    collect_ride(conn, key)?
        .map(|ride| {
            pack_rows(&PackedRide {
                identity: None,
                ..ride
            })
        })
        .transpose()
}

/// The deflated rows entry for `key`, without reading its original. `None`
/// for a key the library holds nothing for.
///
/// # Errors
///
/// Fails when a table cannot be read or the rows cannot be encoded.
pub fn packed_rows(conn: &Connection, key: &str) -> Result<Option<Vec<u8>>, RowsError> {
    collect_ride(conn, key)?
        .map(|ride| pack_rows(&ride))
        .transpose()
}

/// What a ride puts in its pack: the original under `original.fit` when one is
/// kept, then the decoded rows under `streams.bin`. Empty for a key the
/// library holds nothing for.
///
/// # Errors
///
/// Fails when a table cannot be read or the rows cannot be encoded.
pub fn packed_entries(
    conn: &Connection,
    key: &str,
) -> Result<Vec<(EntryKind, Vec<u8>)>, RowsError> {
    let Some(rows) = packed_rows(conn, key)? else {
        return Ok(Vec::new());
    };
    let mut entries = Vec::with_capacity(2);
    if let Some(original) = original_of(conn, key)? {
        entries.push((EntryKind::OriginalFit, original));
    }
    entries.push((EntryKind::StreamsBin, rows));
    Ok(entries)
}

/// Read a rows entry back into the ride it was packed from.
///
/// # Errors
///
/// Names a version this build does not read, and refuses bytes that do not
/// inflate, do not decode, or carry anything after the ride.
pub fn unpack_rows(bytes: &[u8]) -> Result<PackedRide, RowsError> {
    let body = inflate_rows(bytes)?;
    let Some((&version, rest)) = body.split_first() else {
        return Err(RowsError::Damaged("the rows are empty".into()));
    };
    match version {
        0 => return Err(RowsError::UnsupportedVersion(version)),
        ROWS_FORMAT_VERSION => {}
        newer => return Err(RowsError::NewerVersion(newer)),
    }
    let (ride, left) = postcard::take_from_bytes::<PackedRide>(rest)
        .map_err(|e| RowsError::Damaged(e.to_string()))?;
    if !left.is_empty() {
        return Err(RowsError::Damaged("bytes follow the ride".into()));
    }
    Ok(ride)
}

/// Whether the library already holds the ride: a row under its key, or one
/// that carries the intervals id it carries.
fn is_held(conn: &Connection, ride: &PackedRide) -> Result<bool, RowsError> {
    let intervals_id = ride
        .activity
        .as_ref()
        .and_then(|a| a.intervals_id.as_deref())
        .or_else(|| ride.body.as_ref().and_then(|b| b.intervals_id.as_deref()));
    Ok(conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM activities
                        WHERE id = ?1 OR (?2 IS NOT NULL AND intervals_id = ?2))
             OR EXISTS (SELECT 1 FROM activity_bodies
                        WHERE activity_id = ?1 OR (?2 IS NOT NULL AND intervals_id = ?2))",
        params![ride.key, intervals_id],
        |r| r.get(0),
    )?)
}

fn write_ride(conn: &Connection, ride: &PackedRide) -> Result<(), RowsError> {
    let key = ride.key.as_str();
    if let Some(a) = &ride.activity {
        conn.execute(
            "INSERT INTO activities
                (id, sport_type, min_lat, max_lat, min_lng, max_lng, created_at, start_date,
                 name, distance_meters, duration_secs, intervals_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                key,
                a.sport_type,
                a.min_lat,
                a.max_lat,
                a.min_lng,
                a.max_lng,
                a.created_at,
                a.start_date,
                a.name,
                a.distance_meters,
                a.duration_secs,
                a.intervals_id
            ],
        )?;
    }
    if let Some(b) = &ride.body {
        conn.execute(
            "INSERT INTO activity_bodies (activity_id, date, raw, intervals_id)
             VALUES (?1, ?2, ?3, ?4)",
            params![key, b.date, b.raw, b.intervals_id],
        )?;
    }
    if let Some(i) = &ride.identity {
        conn.execute(
            "UPDATE ride_identity SET device_serial = ?2, created_unix = ?3
             WHERE activity_id = ?1",
            params![key, i.device_serial, i.created_unix],
        )?;
    }
    // A track and a time index hang off the `activities` row.
    if ride.activity.is_some() {
        if let Some(t) = &ride.track {
            conn.execute(
                "INSERT INTO gps_tracks
                    (activity_id, track_data, point_count, elevation_source,
                     elevation_settled_version, elevation_state, elevation_attempts)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    key,
                    t.track_data,
                    t.point_count,
                    t.elevation_source,
                    t.elevation_settled_version,
                    t.elevation_state,
                    t.elevation_attempts
                ],
            )?;
        }
        if let Some(t) = &ride.time_stream {
            conn.execute(
                "INSERT INTO time_streams (activity_id, times, point_count) VALUES (?1, ?2, ?3)",
                params![key, t.times, t.point_count],
            )?;
        }
    }
    for s in &ride.streams {
        conn.execute(
            "INSERT INTO activity_streams (activity_id, kind, data, sample_count)
             VALUES (?1, ?2, ?3, ?4)",
            params![key, s.kind, s.data, s.sample_count],
        )?;
    }
    if let Some(raw) = &ride.interval_body {
        conn.execute(
            "INSERT INTO interval_bodies (activity_id, raw) VALUES (?1, ?2)",
            params![key, raw],
        )?;
    }
    if let Some(c) = &ride.census {
        // `fetched_sync_date` is the version this device came away with, so the
        // next census pull owes the ride only when that version moves. A row a
        // pull wrote first is marked fetched only when it names the same
        // version.
        conn.execute(
            "INSERT INTO activity_census
                (athlete_id, intervals_id, start_date_local, created, icu_sync_date,
                 fetched_sync_date, has_latlng, has_series)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7)
             ON CONFLICT(athlete_id, intervals_id) DO UPDATE SET
                 fetched_sync_date = excluded.fetched_sync_date
             WHERE activity_census.fetched_sync_date IS NULL
               AND activity_census.icu_sync_date IS excluded.icu_sync_date",
            params![
                c.athlete_id,
                c.intervals_id,
                c.start_date_local,
                c.created,
                c.icu_sync_date,
                c.has_latlng,
                c.has_series
            ],
        )?;
    }
    Ok(())
}

/// Write a packed ride under the key it was packed with. Returns `false`, and
/// writes nothing, when the library already holds that ride. The key is never
/// re-minted.
///
/// The ride's file, when it was packed with one, is not part of the rows: the
/// caller keeps it through `keep_original`.
///
/// # Errors
///
/// Fails when a row cannot be written, in which case none of the ride is.
pub fn store_packed_ride(conn: &Connection, ride: &PackedRide) -> Result<bool, RowsError> {
    if is_held(conn, ride)? {
        return Ok(false);
    }
    conn.execute_batch("SAVEPOINT store_packed_ride")?;
    match write_ride(conn, ride) {
        Ok(()) => {
            conn.execute_batch("RELEASE store_packed_ride")?;
            Ok(true)
        }
        Err(e) => {
            conn.execute_batch("ROLLBACK TO store_packed_ride; RELEASE store_packed_ride")?;
            Err(e)
        }
    }
}

#[cfg(test)]
#[path = "ride_bytes_tests.rs"]
mod tests;
