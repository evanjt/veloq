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
                    "tracematch: [TrackPool] Batch prepare failed for chunk of {}: {:?}; skipping chunk",
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
