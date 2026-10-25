//! A Garmin original becomes a stored activity.
//!
//! The row is keyed by the Garmin id (`origin::garmin_source_key`) and made
//! from the original FIT alone: Garmin's list entry only fills what the file
//! does not say. The FIT decoder maps the file into intervals.icu's stream
//! vocabulary, and the streams then go through the readers every other track
//! goes through, so a Garmin ride and a synced one are stored by one rule.
//!
//! A file that does not decode, or a row that does not store, stores nothing
//! and is recorded against the key. The key is not stored, so the next pull
//! owes it again.

use super::wire::ListedActivity;
use crate::fit::{FitActivity, FitParseError, parse_fit_activity};
use crate::net::types::StreamDto;
use crate::persistence::PersistentEngine;
use crate::persistence::activities::FileSeries;
use crate::persistence::origin::garmin_source_key;
use crate::{FfiActivityBody, GpsPoint};
use std::path::{Path, PathBuf};

/// What storing an original did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ingested {
    /// A new row. `tracked` is whether it has a track for section detection.
    Stored { tracked: bool },
    /// The key was already stored, and nothing was written.
    AlreadyStored,
}

#[derive(Debug)]
pub enum IngestError {
    /// The file did not decode, or holds no start time.
    Fit(FitParseError),
    /// The app has not said where its documents directory is, so the FIT has
    /// nowhere to be kept. Nothing is stored and nothing is recorded: the
    /// activity is not at fault.
    NoFilesRoot,
    /// The FIT could not be written to its place.
    File(std::io::Error),
    /// The engine would not store the row.
    Storage(String),
    /// The engine this was started on has closed.
    EngineClosed,
}

impl std::fmt::Display for IngestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            IngestError::Fit(e) => write!(f, "the original did not decode: {e}"),
            IngestError::NoFilesRoot => write!(f, "the documents directory is not known yet"),
            IngestError::File(e) => write!(f, "the original could not be kept: {e}"),
            IngestError::Storage(e) => write!(f, "the activity did not store: {e}"),
            IngestError::EngineClosed => write!(f, "the engine closed"),
        }
    }
}

impl std::error::Error for IngestError {}

/// Everything one original stores, built before the engine is touched.
#[derive(Debug)]
pub struct Prepared {
    pub key: String,
    pub body: FfiActivityBody,
    /// The track, empty for an activity with no usable fix.
    pub coords: Vec<GpsPoint>,
    pub streams: Vec<StreamDto>,
    pub clock: Vec<u32>,
}

/// The wall clock minus UTC in seconds from a list entry's two start times.
fn listed_offset(listed: &ListedActivity) -> Option<i64> {
    let parse = |text: &str| {
        chrono::NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S")
            .ok()
            .map(|t| t.and_utc().timestamp())
    };
    Some(parse(listed.start_time_local.as_deref()?)? - parse(listed.start_time_gmt.as_deref()?)?)
}

/// The intervals.icu activity body the row is stored with. A figure neither
/// the file nor the list entry gives is left out, never written as zero.
fn body_of(
    key: &str,
    sport: &str,
    activity: &FitActivity,
    listed: &ListedActivity,
    stream_types: &[String],
) -> FfiActivityBody {
    let offset = activity
        .utc_offset_secs
        .or_else(|| listed_offset(listed))
        .unwrap_or(0);
    let local = chrono::DateTime::from_timestamp(activity.start_unix + offset, 0)
        .unwrap_or_default()
        .naive_utc();
    let totals = &activity.totals;
    let moving = totals.moving_secs.or(listed.duration);
    let elapsed = totals.elapsed_secs.or(listed.elapsed_duration);
    let distance = totals.distance.or(listed.distance);
    let average_speed = totals.avg_speed.or_else(|| {
        distance
            .zip(moving)
            .filter(|(_, t)| *t > 0.0)
            .map(|(d, t)| d / t)
    });

    let mut raw = serde_json::Map::new();
    raw.insert("id".into(), key.into());
    raw.insert(
        "name".into(),
        listed
            .activity_name
            .as_deref()
            .filter(|name| !name.trim().is_empty())
            .unwrap_or(sport)
            .into(),
    );
    raw.insert("type".into(), sport.into());
    raw.insert(
        "start_date_local".into(),
        local.format("%Y-%m-%dT%H:%M:%S").to_string().into(),
    );
    // Whole seconds, as the body from intervals.icu carries them.
    for (name, seconds) in [("moving_time", moving), ("elapsed_time", elapsed)] {
        if let Some(seconds) = seconds.filter(|s| s.is_finite()) {
            raw.insert(name.into(), (seconds.round() as i64).into());
        }
    }
    let mut put = |name: &str, value: Option<f64>| {
        if let Some(value) = value.filter(|v| v.is_finite()) {
            raw.insert(name.into(), value.into());
        }
    };
    put("distance", distance);
    put("total_elevation_gain", totals.ascent);
    put("average_speed", average_speed);
    put("max_speed", totals.max_speed);
    put("average_heartrate", totals.avg_heart_rate);
    put("max_heartrate", totals.max_heart_rate);
    put("icu_average_watts", totals.avg_power);
    put("average_cadence", totals.avg_cadence);
    put("calories", totals.calories);
    raw.insert("stream_types".into(), stream_types.into());
    FfiActivityBody {
        activity_id: key.to_string(),
        date: (activity.start_unix + offset) as f64,
        raw: serde_json::Value::Object(raw).to_string(),
    }
}

/// Decode the original and build what it stores, touching nothing.
///
/// The series are the decoder's, in intervals.icu's names, reduced by the
/// readers a downloaded track goes through: with a usable fix they take the
/// track's index and the clock is the track's, and with none they stay in the
/// file's own samples with their `time`.
pub fn prepare(listed: &ListedActivity, fit: &[u8]) -> Result<Prepared, IngestError> {
    let key = garmin_source_key(listed.activity_id);
    let activity = parse_fit_activity(fit).map_err(IngestError::Fit)?;
    let sport = crate::sport::from_fit(activity.sport, activity.sub_sport);
    let raw = activity.streams();
    let stream_types: Vec<String> = raw.iter().map(|s| s.kind.clone()).collect();

    let mut coords = Vec::new();
    let mut streams = Vec::new();
    let mut clock = Vec::new();
    if raw.iter().any(|s| s.kind == "latlng") {
        let json = serde_json::to_vec(&raw).map_err(|e| IngestError::Storage(e.to_string()))?;
        let result = crate::http::track_from_streams_body(&key, &json, true);
        match crate::ffi::usable_track(&result) {
            Ok(points) => {
                coords = points;
                streams = result.streams;
                clock = result.times;
            }
            Err(refusal) if crate::ffi::counts_as_failure(&refusal) => {
                return Err(IngestError::Storage(format!(
                    "the original's streams did not decode: {refusal:?}"
                )));
            }
            Err(_) => {}
        }
    }
    if coords.is_empty() {
        let without_fix: Vec<StreamDto> = raw.into_iter().filter(|s| s.kind != "latlng").collect();
        streams = crate::net::types::trackless_series(&without_fix);
    }
    let body = body_of(&key, sport, &activity, listed, &stream_types);
    Ok(Prepared {
        key,
        body,
        coords,
        streams,
        clock,
    })
}

/// Store the row, and keep the original at `path` when one is given. A
/// `None` path keeps nothing: Garmin holds the original and serves it again.
/// A row that fails to store takes a kept file back out, and a file that
/// cannot be written stores no row.
pub fn store(
    engine: &mut PersistentEngine,
    prepared: &Prepared,
    fit: &[u8],
    path: Option<&Path>,
) -> Result<Ingested, IngestError> {
    if engine.has_stored_activity(&prepared.key) {
        return Ok(Ingested::AlreadyStored);
    }
    if let Some(path) = path {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(IngestError::File)?;
        }
        crate::atomic_file::write_atomically(path, fit).map_err(IngestError::File)?;
    }
    let series = FileSeries {
        streams: &prepared.streams,
        clock: &prepared.clock,
    };
    match engine.save_file_activity(&prepared.key, &prepared.coords, &prepared.body, &series) {
        Ok(()) => {
            // The row is stored whether or not it links, and a later sync
            // links it when this does not.
            if let Err(e) = engine.link_garmin_original(&prepared.key) {
                log::warn!("veloqrs: [garmin] link of {} failed: {}", prepared.key, e);
            }
            Ok(Ingested::Stored {
                tracked: !prepared.coords.is_empty(),
            })
        }
        Err(e) => {
            if let Some(path) = path {
                let _ = std::fs::remove_file(path);
            }
            Err(IngestError::Storage(e.to_string()))
        }
    }
}

/// Settle one original's preparation against the engine: store it and clear
/// the activity's failure, or record why it could not be and store nothing.
pub fn settle(
    engine: &mut PersistentEngine,
    key: &str,
    path: Option<&Path>,
    fit: &[u8],
    prepared: Result<Prepared, IngestError>,
) -> Result<Ingested, IngestError> {
    let outcome = prepared.and_then(|prepared| store(engine, &prepared, fit, path));
    match &outcome {
        Ok(_) => crate::persistence::activity_sync_failures::clear(&engine.db, key),
        Err(e @ (IngestError::Fit(_) | IngestError::Storage(_))) => {
            crate::persistence::activity_sync_failures::record(
                &engine.db,
                key,
                &e.to_string(),
                crate::persistence::attempts::now_ms(),
            )
        }
        Err(_) => {}
    }
    outcome
}

/// [`prepare`] and [`settle`] in one call, for a caller already holding the
/// engine.
pub fn ingest_into(
    engine: &mut PersistentEngine,
    path: Option<&Path>,
    listed: &ListedActivity,
    fit: &[u8],
) -> Result<Ingested, IngestError> {
    let key = garmin_source_key(listed.activity_id);
    if engine.has_stored_activity(&key) {
        return Ok(Ingested::AlreadyStored);
    }
    settle(engine, &key, path, fit, prepare(listed, fit))
}

/// Store the original of one listed activity in the library open at
/// `install`, and queue section detection for a new row with a track.
///
/// The original is kept on the phone only when `keep_for_upload` is set, which
/// is the case for an upload that reads it back. Otherwise nothing is written.
///
/// The decode runs before the engine is taken, so the lock is held for the
/// writes alone.
pub fn ingest_original(
    install: u64,
    listed: &ListedActivity,
    fit: &[u8],
    keep_for_upload: bool,
) -> Result<Ingested, IngestError> {
    let key = garmin_source_key(listed.activity_id);
    let path: Option<PathBuf> = keep_for_upload
        .then(|| {
            crate::net::upload_recording::source_fit_file(&key).ok_or(IngestError::NoFilesRoot)
        })
        .transpose()?;
    let stored =
        crate::persistence::with_persistent_engine_for(install, |e| e.has_stored_activity(&key))
            .ok_or(IngestError::EngineClosed)?;
    if stored {
        return Ok(Ingested::AlreadyStored);
    }
    let prepared = prepare(listed, fit);
    let ingested = crate::persistence::with_persistent_engine_for(install, |e| {
        settle(e, &key, path.as_deref(), fit, prepared)
    })
    .ok_or(IngestError::EngineClosed)??;
    if ingested == (Ingested::Stored { tracked: true }) {
        use crate::persistence::sections::conditioning;
        conditioning::note_stored_for(install, 1);
        conditioning::condition_pending();
    }
    Ok(ingested)
}

#[cfg(test)]
mod tests;
