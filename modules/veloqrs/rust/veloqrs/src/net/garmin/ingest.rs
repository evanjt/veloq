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
use crate::persistence::file_track_checks::{FileTrackCheck, server_records_of};
use crate::persistence::origin::{FILE_KEY_PREFIX, garmin_source_key};
use crate::persistence::ride_identity::{self, Existing, RideIdentity};
use crate::{FfiActivityBody, GpsPoint};

/// What storing an original did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Ingested {
    /// A new row. `tracked` is whether it has a track for section detection.
    Stored { tracked: bool },
    /// The key was already stored, and nothing was written.
    AlreadyStored,
    /// The ride is one the library already holds under another key. No row
    /// was stored; the file is kept as that row's original when it is the
    /// fuller one.
    Linked { to: String },
}

#[derive(Debug)]
pub enum IngestError {
    /// The file did not decode, or holds no start time.
    Fit(FitParseError),
    /// The engine would not store the row.
    Storage(String),
    /// The engine this was started on has closed.
    EngineClosed,
}

impl std::fmt::Display for IngestError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            IngestError::Fit(e) => write!(f, "the original did not decode: {e}"),
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
    /// The sport the row is stored under and the start in Unix seconds, UTC,
    /// that the file's thresholds are dated by.
    pub sport: String,
    pub start_unix: i64,
    /// The thresholds and profile the file carries, if any.
    pub thresholds: Option<crate::fit::FitThresholds>,
    /// The interval body the file's laps make, none for a file with fewer
    /// than two laps.
    pub laps: Option<String>,
    /// What the library compares this ride to its rows by.
    pub identity: RideIdentity,
    /// How many samples the file's clock holds: the length of the index an
    /// interval of a stored body addresses, a lap's `end_index` being one of
    /// its positions. Zero for a file with no clock.
    pub samples: usize,
    /// What the original's bytes are, as the originals table names it.
    pub format: &'static str,
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
/// the file nor the list entry gives is left out, never written as zero. A
/// file with no list entry behind it is named by its sport.
fn body_of(
    key: &str,
    sport: &str,
    activity: &FitActivity,
    listed: Option<&ListedActivity>,
    stream_types: &[String],
) -> FfiActivityBody {
    let offset = activity
        .utc_offset_secs
        .or_else(|| listed.and_then(listed_offset))
        .unwrap_or(0);
    let local = chrono::DateTime::from_timestamp(activity.start_unix + offset, 0)
        .unwrap_or_default()
        .naive_utc();
    let totals = &activity.totals;
    let moving = totals.moving_secs.or(listed.and_then(|l| l.duration));
    let elapsed = totals
        .elapsed_secs
        .or(listed.and_then(|l| l.elapsed_duration));
    let distance = totals.distance.or(listed.and_then(|l| l.distance));
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
            .and_then(|l| l.activity_name.as_deref())
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
    prepare_with(garmin_source_key(listed.activity_id), fit, Some(listed))
}

/// [`prepare`] for a file with no list entry behind it, under the key its
/// source mints. The file alone says everything the row holds.
pub fn prepare_file(key: &str, fit: &[u8]) -> Result<Prepared, IngestError> {
    prepare_with(key.to_string(), fit, None)
}

fn prepare_with(
    key: String,
    fit: &[u8],
    listed: Option<&ListedActivity>,
) -> Result<Prepared, IngestError> {
    let activity = parse_fit_activity(fit).map_err(IngestError::Fit)?;
    prepare_activity(key, &activity, listed, "fit")
}

/// Build what a decoded activity stores, whichever file format it was read
/// from. `format` names the original's bytes in the originals table.
pub fn prepare_activity(
    key: String,
    activity: &FitActivity,
    listed: Option<&ListedActivity>,
    format: &'static str,
) -> Result<Prepared, IngestError> {
    let sport = crate::sport::from_fit(activity.sport, activity.sub_sport);
    let raw = activity.streams();
    let samples = raw
        .iter()
        .find(|s| s.kind == "time")
        .map_or(0, |s| s.data.len());
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
    let body = body_of(&key, sport, activity, listed, &stream_types);
    let identity = RideIdentity {
        device_serial: activity.serial_number,
        created_unix: activity.time_created,
        start_local: body.date as i64,
        sport: sport.to_string(),
    };
    Ok(Prepared {
        key,
        body,
        identity,
        samples,
        coords,
        streams,
        clock,
        sport: sport.to_string(),
        start_unix: activity.start_unix,
        laps: crate::persistence::intervals::lap_body(activity),
        thresholds: activity.thresholds.clone(),
        format,
    })
}

/// Where a stored file's original is kept.
#[derive(Debug, Clone, Copy)]
pub enum Kept<'a> {
    /// Nowhere: Garmin holds the original and serves it again.
    Nowhere,
    /// The originals table, under `source`, for an upload that reads it back
    /// or a ride no connector can serve again.
    Table { source: &'a str },
}

/// Store the row, and keep the original where `kept` says. A row that fails
/// to store takes a kept original back out, and an original that cannot be
/// kept stores no row.
///
/// The curves, the fitness series and the ride's scores are not worked out
/// here: they fold in every ride, so a caller storing a batch calls
/// [`finish_batch`] once after it.
pub fn store(
    engine: &mut PersistentEngine,
    prepared: &Prepared,
    fit: &[u8],
    kept: Kept<'_>,
) -> Result<Ingested, IngestError> {
    if engine.has_stored_activity(&prepared.key) {
        return Ok(Ingested::AlreadyStored);
    }
    match kept {
        Kept::Nowhere => {}
        Kept::Table { source } => {
            crate::persistence::originals::keep_original(
                &engine.db,
                &prepared.key,
                source,
                prepared.format,
                fit,
                chrono::Utc::now().timestamp(),
            )
            .map_err(|e| IngestError::Storage(e.to_string()))?;
        }
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
            if let Err(e) = ride_identity::record(&engine.db, &prepared.key, &prepared.identity) {
                log::warn!(
                    "veloqrs: [garmin] identity of {} not kept: {}",
                    prepared.key,
                    e
                );
            }
            if let Some(laps) = &prepared.laps
                && let Err(e) = engine.set_interval_body(&prepared.key, laps)
            {
                log::warn!("veloqrs: [garmin] laps of {} not kept: {}", prepared.key, e);
            }
            let kept = prepared.thresholds.as_ref().map(|found| {
                crate::persistence::fitness::sport_settings::record_file_thresholds(
                    &engine.db,
                    &prepared.sport,
                    prepared.start_unix,
                    found,
                )
            });
            if let Some(Err(e)) = kept {
                log::warn!(
                    "veloqrs: [garmin] thresholds of {} not kept: {}",
                    prepared.key,
                    e
                );
            }
            Ok(Ingested::Stored {
                tracked: !prepared.coords.is_empty(),
            })
        }
        Err(e) => {
            match kept {
                Kept::Nowhere => {}
                Kept::Table { .. } => {
                    let _ = crate::persistence::originals::drop_original(&engine.db, &prepared.key);
                }
            }
            Err(IngestError::Storage(e.to_string()))
        }
    }
}

#[cfg(test)]
thread_local! {
    static FINISHED_BATCHES: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

/// The batches finished on this thread since [`reset_finished_batches`].
#[cfg(test)]
pub(crate) fn finished_batches() -> usize {
    FINISHED_BATCHES.with(std::cell::Cell::get)
}

#[cfg(test)]
pub(crate) fn reset_finished_batches() {
    FINISHED_BATCHES.with(|n| n.set(0));
}

/// What the stored rides of a batch owe the library, worked out once for the
/// whole batch: each ride's scores, against the thresholds every file of the
/// batch has recorded by now, then the local curves and the fitness series,
/// which fold in every ride and so grow with the library.
///
/// A batch of one is a push or a swap; a window of rides or a whole import is
/// one batch.
pub fn finish_batch(engine: &mut PersistentEngine, keys: &[String]) {
    #[cfg(test)]
    FINISHED_BATCHES.with(|n| n.set(n.get() + 1));
    for key in keys {
        if let Err(e) = engine.settle_ride_metrics(key) {
            log::warn!("veloqrs: [garmin] metrics of {key} not worked out: {e}");
        }
    }
    if let Err(e) = crate::persistence::fitness::curves_local::refresh(
        &engine.db,
        chrono::Utc::now().timestamp(),
    ) {
        log::warn!(
            "veloqrs: [garmin] curves after a batch of {} not worked out: {e}",
            keys.len()
        );
    }
    if let Err(e) = crate::persistence::fitness::fitness_series::refresh(
        &engine.db,
        &crate::persistence::wellness::today_iso(),
    ) {
        log::warn!(
            "veloqrs: [garmin] fitness after a batch of {} not worked out: {e}",
            keys.len()
        );
    }
}

/// [`finish_batch`] on the library open at `install`. `false` when it has
/// closed.
pub fn finish_batch_for(install: u64, keys: &[String]) -> bool {
    crate::persistence::with_persistent_engine_for(install, |e| finish_batch(e, keys)).is_some()
}

/// The stored rows that hold the ride a prepared file records. A file that did
/// not decode holds none.
pub fn same_ride(engine: &PersistentEngine, prepared: &Result<Prepared, IngestError>) -> Existing {
    let Ok(prepared) = prepared else {
        return Existing::Nothing;
    };
    ride_identity::existing_ride_for(&engine.db, &prepared.identity).unwrap_or_else(|e| {
        log::warn!(
            "veloqrs: [garmin] the library was not asked for {}: {e}",
            prepared.key
        );
        Existing::Nothing
    })
}

/// A file whose ride the library holds as the row `row`: no row is stored.
/// The file becomes that row's original when it keeps none, or when the file
/// holds a message or field the kept one lacks.
///
/// A row that holds no track and no series takes the file's, so the ride is not
/// owed a download of what the athlete has just handed over, when the file's
/// record count is the server's. The intervals of a stored body address the
/// server's samples and the last of them ends at its record count, so a file
/// with any other count is not that recording and its series stay owed. With no
/// interval body there is no count to contradict, and the file is taken; an
/// interval body that arrives later is held against it.
pub fn link_to_row(
    engine: &mut PersistentEngine,
    row: &str,
    source: &str,
    fit: &[u8],
    prepared: &Result<Prepared, IngestError>,
) -> Result<Ingested, IngestError> {
    let storage = |e: rusqlite::Error| IngestError::Storage(e.to_string());
    let fuller =
        match crate::persistence::originals::original_of(&engine.db, row).map_err(storage)? {
            None => true,
            Some(kept) => crate::fit::holds_more_than(fit, &kept).unwrap_or(false),
        };
    if fuller {
        crate::persistence::originals::keep_original(
            &engine.db,
            row,
            source,
            "fit",
            fit,
            chrono::Utc::now().timestamp(),
        )
        .map_err(storage)?;
    }
    if let Ok(prepared) = prepared {
        supply_series(engine, row, prepared);
    }
    Ok(Ingested::Linked {
        to: row.to_string(),
    })
}

/// Store the track and series of a file for the row that holds the same ride,
/// when the row has none and the file's record count is the server's. The
/// check is recorded on the row either way. A failure is logged: the row stays
/// as it was and the download stays owed.
fn supply_series(engine: &mut PersistentEngine, row: &str, prepared: &Prepared) {
    let file_records = u32::try_from(prepared.samples).unwrap_or(u32::MAX);
    let server_records = engine
        .get_interval_body(row)
        .ok()
        .flatten()
        .as_deref()
        .and_then(server_records_of);
    let mut check = FileTrackCheck {
        file_records,
        server_records,
        supplied: false,
    };
    if check.mismatched() {
        log::info!(
            "veloqrs: [garmin] the file of {row} holds {file_records} records and the server {}, so its series stay owed",
            server_records.unwrap_or_default()
        );
    } else {
        let series = FileSeries {
            streams: &prepared.streams,
            clock: &prepared.clock,
        };
        match engine.store_file_series_for_row(row, &prepared.coords, &series) {
            Ok(stored) => check.supplied = stored,
            Err(e) => log::warn!("veloqrs: [garmin] the file's series of {row} not stored: {e}"),
        }
    }
    // A row whose track a file supplied earlier keeps that mark.
    check.supplied |= engine
        .file_track_check(row)
        .is_some_and(|earlier| earlier.supplied);
    if let Err(e) = engine.record_file_track_check(row, &check) {
        log::warn!("veloqrs: [garmin] the file check of {row} not recorded: {e}");
    }
}

/// A Garmin original whose ride was read from a file first is that file's
/// row, not a second one. A match with any other kind of row is left to the
/// Garmin link, which goes by Garmin's id alone.
fn linked_to_file_row(
    engine: &mut PersistentEngine,
    prepared: &Result<Prepared, IngestError>,
    fit: &[u8],
) -> Option<Result<Ingested, IngestError>> {
    match same_ride(engine, prepared) {
        Existing::One(row) if row.starts_with(FILE_KEY_PREFIX) => {
            Some(link_to_row(engine, &row, "garmin", fit, prepared))
        }
        _ => None,
    }
}

/// Settle one original's preparation against the engine: store it and clear
/// the activity's failure, or record why it could not be and store nothing.
pub fn settle(
    engine: &mut PersistentEngine,
    key: &str,
    kept: Kept<'_>,
    fit: &[u8],
    prepared: Result<Prepared, IngestError>,
) -> Result<Ingested, IngestError> {
    let outcome = prepared.and_then(|prepared| store(engine, &prepared, fit, kept));
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
/// engine. A stored row is a batch of one.
pub fn ingest_into(
    engine: &mut PersistentEngine,
    keep: bool,
    listed: &ListedActivity,
    fit: &[u8],
) -> Result<Ingested, IngestError> {
    let key = garmin_source_key(listed.activity_id);
    if engine.has_stored_activity(&key) {
        return Ok(Ingested::AlreadyStored);
    }
    let kept = if keep {
        Kept::Table { source: "garmin" }
    } else {
        Kept::Nowhere
    };
    let prepared = prepare(listed, fit);
    if let Some(linked) = linked_to_file_row(engine, &prepared, fit) {
        return linked;
    }
    let ingested = settle(engine, &key, kept, fit, prepared)?;
    if matches!(ingested, Ingested::Stored { .. }) {
        finish_batch(engine, &[key]);
    }
    Ok(ingested)
}

/// Store the original of one listed activity in the library open at
/// `install`, and queue section detection for a new row with a track.
///
/// The original is kept only when `keep_for_upload` is set, which is the case
/// for an upload that reads it back. Otherwise nothing is kept.
///
/// The decode runs before the engine is taken, so the lock is held for the
/// writes alone.
pub fn ingest_original(
    install: u64,
    listed: &ListedActivity,
    fit: &[u8],
    keep_for_upload: bool,
) -> Result<Ingested, IngestError> {
    ingest_original_in_batch(install, listed, fit, keep_for_upload, true)
}

/// [`ingest_original`] for a caller storing a batch of rides, which passes
/// `finish` false and calls [`finish_batch`] over the keys it stored when the
/// batch ends.
pub fn ingest_original_in_batch(
    install: u64,
    listed: &ListedActivity,
    fit: &[u8],
    keep_for_upload: bool,
    finish: bool,
) -> Result<Ingested, IngestError> {
    let key = garmin_source_key(listed.activity_id);
    let stored =
        crate::persistence::with_persistent_engine_for(install, |e| e.has_stored_activity(&key))
            .ok_or(IngestError::EngineClosed)?;
    if stored {
        return Ok(Ingested::AlreadyStored);
    }
    let prepared = prepare(listed, fit);
    let ingested = crate::persistence::with_persistent_engine_for(install, |e| {
        let kept = if keep_for_upload {
            Kept::Table { source: "garmin" }
        } else {
            Kept::Nowhere
        };
        if let Some(linked) = linked_to_file_row(e, &prepared, fit) {
            return linked;
        }
        let ingested = settle(e, &key, kept, fit, prepared)?;
        if finish && matches!(ingested, Ingested::Stored { .. }) {
            finish_batch(e, std::slice::from_ref(&key));
        }
        Ok::<_, IngestError>(ingested)
    })
    .ok_or(IngestError::EngineClosed)??;
    if keep_for_upload
        && matches!(ingested, Ingested::Stored { .. })
        && let Some(athlete) = crate::objects::sync::signed_in_athlete()
    {
        crate::net::upload_recording::offer_garmin_originals(
            install,
            &athlete,
            chrono::Utc::now().timestamp_millis(),
            &mut false,
        );
    }
    if ingested == (Ingested::Stored { tracked: true }) {
        use crate::persistence::sections::conditioning;
        conditioning::note_stored_for(install, 1);
        conditioning::condition_pending();
    }
    Ok(ingested)
}

#[cfg(test)]
mod tests;
