//! Chunked GPS track loading for read-only detection pools.

use crate::GpsPoint;
use crate::persistence::codec::TrackRead;
use rusqlite::Connection;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};

use super::super::SectionDetectionProgress;

/// Rows fetched per IN(...) batch, bounding the transient SQL/parse spike.
const CHUNK_SIZE: usize = 150;

/// One chunked pool load: the tracks in input order plus the load census.
pub(crate) struct LoadedPool {
    /// Non-empty tracks in `ids` order.
    pub tracks: Vec<(String, Vec<GpsPoint>)>,
    /// Ids whose row was missing or decoded to no points.
    pub empty: u32,
    /// Ids whose blob failed to decode.
    pub unreadable: u32,
    /// Rows whose blob decoded, empty tracks included. The denominator the
    /// corrupt-pool gate is measured against.
    pub readable: usize,
}

/// Load full-resolution tracks in [`CHUNK_SIZE`] batches, preserving `ids`
/// order and ticking `progress` once per id. Chunking caps the peak at
/// (resident tracks + one chunk's query buffers) rather than the full result
/// set; every track still ends up resident at once, which the all-pairs
/// detector requires. Returns None when `cancel` is raised, checked once per
/// chunk. Reads only; the census is returned, never recorded.
pub(crate) fn load_tracks_chunked(
    conn: &Connection,
    ids: &[String],
    progress: &SectionDetectionProgress,
    cancel: &AtomicBool,
) -> Option<LoadedPool> {
    let mut empty: u32 = 0;
    let mut unreadable: u32 = 0;
    let mut readable: usize = 0;
    let mut loaded: HashMap<String, Vec<GpsPoint>> = HashMap::with_capacity(ids.len());

    for chunk in ids.chunks(CHUNK_SIZE) {
        if cancel.load(Ordering::SeqCst) {
            return None;
        }
        let placeholders: String = std::iter::repeat_n("?", chunk.len())
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
                                readable += 1;
                                loaded.insert(id, track);
                            }
                            TrackRead::Missing => {}
                            TrackRead::Corrupt(_) => unreadable += 1,
                        }
                    }
                }
            }
            Err(e) => {
                log::warn!(
                    "veloqrs: [TrackPool] Batch prepare failed for chunk of {}: {:?}; skipping chunk",
                    chunk.len(),
                    e
                );
            }
        }
    }

    // Preserve the original `ids` order, tick per-track progress, and
    // classify empty vs loaded. Ids missing from the result count as empty.
    let tracks: Vec<(String, Vec<GpsPoint>)> = ids
        .iter()
        .filter_map(|id| {
            progress.increment();
            match loaded.remove(id) {
                Some(track) if !track.is_empty() => Some((id.clone(), track)),
                _ => {
                    empty += 1;
                    None
                }
            }
        })
        .collect();

    Some(LoadedPool {
        tracks,
        empty,
        unreadable,
        readable,
    })
}

/// Per-point time offsets for `tracks`, positional and in `tracks` order.
///
/// A stream is fetched separately from its track, so its length is evidence
/// rather than a guarantee: one that disagrees with the points it claims to
/// index is not in the track's index space, and the lift veto reading it
/// would judge speed off the wrong points. Such a stream, and a missing one,
/// yield an empty row, which is how the detector reads "untimed" for that
/// track alone. `bodies.rs` applies the same rule before serving a stream to
/// the scrubber, and `lift_spans_tuned` applies it again on the far side.
pub(crate) fn load_seconds_chunked(
    conn: &Connection,
    tracks: &[(String, Vec<GpsPoint>)],
) -> Vec<Vec<f64>> {
    let mut streams: HashMap<String, Vec<u32>> = HashMap::with_capacity(tracks.len());

    for chunk in tracks.chunks(CHUNK_SIZE) {
        let placeholders: String = std::iter::repeat_n("?", chunk.len())
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT activity_id, times FROM time_streams WHERE activity_id IN ({})",
            placeholders
        );
        match conn.prepare(&sql) {
            Ok(mut stmt) => {
                let params_slice: Vec<&dyn rusqlite::ToSql> = chunk
                    .iter()
                    .map(|(id, _)| id as &dyn rusqlite::ToSql)
                    .collect();
                let rows = stmt.query_map(params_slice.as_slice(), |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
                });
                if let Ok(iter) = rows {
                    for (id, blob) in iter.flatten() {
                        if let Ok(times) = crate::persistence::codec::deserialize::<Vec<u32>>(&blob)
                        {
                            streams.insert(id, times);
                        }
                    }
                }
            }
            Err(e) => {
                log::warn!(
                    "veloqrs: [TrackPool] Stream batch prepare failed for chunk of {}: {:?}; skipping chunk",
                    chunk.len(),
                    e
                );
            }
        }
    }

    tracks
        .iter()
        .map(|(id, points)| match streams.remove(id) {
            Some(times) if times.len() == points.len() => {
                times.into_iter().map(f64::from).collect()
            }
            _ => Vec::new(),
        })
        .collect()
}

/// Borrowed view of [`load_seconds_chunked`]'s rows, the shape the detector
/// takes. Separate because the owned rows have to outlive the view.
pub(crate) fn seconds_view(seconds: &[Vec<f64>]) -> Vec<&[f64]> {
    seconds.iter().map(Vec::as_slice).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::PersistentEngine;

    fn track(id: &str, points: usize) -> (String, Vec<GpsPoint>) {
        (
            id.to_string(),
            (0..points)
                .map(|i| GpsPoint::new(40.0 + i as f64 * 0.0001, 10.0))
                .collect(),
        )
    }

    /// One flat call per the FFI shape: ids, all times concatenated, offsets.
    /// `time_streams` cascades off `activities`, so the row has to exist.
    fn store(engine: &mut PersistentEngine, streams: &[(&str, &[u32])]) {
        for (id, _) in streams {
            engine
                .db
                .execute(
                    "INSERT OR IGNORE INTO activities
                     (id, sport_type, min_lat, max_lat, min_lng, max_lng)
                     VALUES (?, 'Ride', 40.0, 40.1, 10.0, 10.1)",
                    rusqlite::params![id],
                )
                .unwrap();
        }
        let ids: Vec<String> = streams.iter().map(|(id, _)| id.to_string()).collect();
        let mut all: Vec<u32> = Vec::new();
        let mut offsets: Vec<u32> = Vec::new();
        for (_, times) in streams {
            offsets.push(all.len() as u32);
            all.extend_from_slice(times);
        }
        engine.set_time_streams_flat(&ids, &all, &offsets);
    }

    #[test]
    fn a_stored_stream_is_returned_in_pool_order_as_seconds() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        store(&mut engine, &[("a2", &[0, 5, 10]), ("a1", &[0, 7, 14])]);

        let pool = vec![track("a1", 3), track("a2", 3)];
        let seconds = load_seconds_chunked(&engine.db, &pool);

        assert_eq!(seconds, vec![vec![0.0, 7.0, 14.0], vec![0.0, 5.0, 10.0]]);
    }

    #[test]
    fn a_track_with_no_stored_stream_holds_the_untimed_row() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        store(&mut engine, &[("a1", &[0, 5, 10])]);

        let pool = vec![track("a1", 3), track("a2", 3), track("a3", 3)];
        let seconds = load_seconds_chunked(&engine.db, &pool);

        assert_eq!(seconds.len(), 3);
        assert_eq!(seconds[0], vec![0.0, 5.0, 10.0]);
        assert!(seconds[1].is_empty(), "a2 has no stream");
        assert!(seconds[2].is_empty(), "a3 has no stream");
    }

    /// A stream is fetched separately from its track, so a shorter or longer
    /// one indexes different points. Reading it would judge speed off the
    /// wrong samples, which is worse than judging on geometry alone.
    #[test]
    fn a_stream_of_the_wrong_length_is_dropped_rather_than_misaligned() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        store(
            &mut engine,
            &[
                ("short", &[0, 5]),
                ("long", &[0, 5, 10, 15]),
                ("exact", &[0, 5, 10]),
            ],
        );

        let pool = vec![track("short", 3), track("long", 3), track("exact", 3)];
        let seconds = load_seconds_chunked(&engine.db, &pool);

        assert!(seconds[0].is_empty(), "two times cannot index three points");
        assert!(
            seconds[1].is_empty(),
            "four times cannot index three points"
        );
        assert_eq!(seconds[2], vec![0.0, 5.0, 10.0]);
    }

    #[test]
    fn an_empty_pool_asks_nothing_and_returns_nothing() {
        let engine = PersistentEngine::in_memory().unwrap();
        assert!(load_seconds_chunked(&engine.db, &[]).is_empty());
    }

    /// The ids are queried in `CHUNK_SIZE` batches, so a pool that straddles
    /// a batch boundary must still come back whole and in order.
    #[test]
    fn a_pool_past_one_chunk_stays_positional_across_the_boundary() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        let count = CHUNK_SIZE * 2 + 7;
        let ids: Vec<String> = (0..count).map(|i| format!("a{i}")).collect();
        let times: Vec<Vec<u32>> = (0..count).map(|i| vec![0, i as u32 + 1]).collect();
        let flat: Vec<(&str, &[u32])> = ids
            .iter()
            .zip(times.iter())
            .map(|(id, t)| (id.as_str(), t.as_slice()))
            .collect();
        store(&mut engine, &flat);

        let pool: Vec<(String, Vec<GpsPoint>)> = ids.iter().map(|id| track(id, 2)).collect();
        let seconds = load_seconds_chunked(&engine.db, &pool);

        assert_eq!(seconds.len(), count);
        for (i, row) in seconds.iter().enumerate() {
            assert_eq!(row, &vec![0.0, i as f64 + 1.0], "row {i} out of step");
        }
    }

    #[test]
    fn the_view_borrows_every_row_including_the_untimed_ones() {
        let owned = vec![vec![0.0, 5.0], Vec::new(), vec![1.0]];
        let view = seconds_view(&owned);

        assert_eq!(view.len(), 3);
        assert_eq!(view[0], [0.0, 5.0]);
        assert!(view[1].is_empty());
        assert_eq!(view[2], [1.0]);
    }
}
