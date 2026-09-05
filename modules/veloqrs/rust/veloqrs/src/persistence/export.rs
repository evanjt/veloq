//! Bulk GPX export: stream GPS tracks from SQLite directly into a ZIP file.
//!
//! Processes one activity at a time - peak memory is ~1 track regardless of
//! total activity count. Avoids the OOM crash from holding all GPX strings
//! in the JS heap.

use std::io::Write;

use super::PersistentEngine;
use super::codec::TrackRead;
use crate::GpsPoint;

/// One activity left out of an export, with the reason it was left out. An
/// export that silently drops an unreadable track is indistinguishable from
/// one the user simply has no data for, so every skip is named.
struct SkippedActivity {
    activity_id: String,
    reason: String,
    /// The skip was a decode failure rather than an absence of data.
    unreadable: bool,
}

impl SkippedActivity {
    fn new(activity_id: &str, reason: impl Into<String>) -> Self {
        SkippedActivity {
            activity_id: activity_id.to_string(),
            reason: reason.into(),
            unreadable: false,
        }
    }

    fn unreadable(activity_id: &str, reason: &str) -> Self {
        SkippedActivity {
            activity_id: activity_id.to_string(),
            reason: format!("unreadable track: {}", reason),
            unreadable: true,
        }
    }

    fn as_json(&self) -> serde_json::Value {
        serde_json::json!({ "id": self.activity_id, "reason": self.reason })
    }
}

/// Log the unreadable skips at error, so a decode failure reaches the log even
/// when nobody opens the export.
fn log_unreadable(skipped: &[SkippedActivity]) {
    for entry in skipped.iter().filter(|s| s.unreadable) {
        log::error!(
            "[BulkExport] activity {} not exported: {}",
            entry.activity_id,
            entry.reason
        );
    }
}

/// Result of a bulk GPX export.
#[derive(Debug, Clone, serde::Serialize, uniffi::Record)]
pub struct BulkExportResult {
    pub exported: u32,
    pub skipped: u32,
    pub total_bytes: u64,
}

impl PersistentEngine {
    /// Export all activities with GPS data as GPX files inside a ZIP archive.
    ///
    /// Streams one track at a time from SQLite → GPX XML → ZIP entry on disk.
    /// The ZIP file is written to `dest_path`.
    pub fn bulk_export_gpx(&self, dest_path: &str) -> Result<BulkExportResult, String> {
        let file = std::fs::File::create(dest_path)
            .map_err(|e| format!("Failed to create ZIP file: {}", e))?;

        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .compression_level(Some(6));

        let mut exported: u32 = 0;
        let mut skipped: Vec<SkippedActivity> = Vec::new();
        let trim = PrivacyTrim::from_settings(self);
        let mut total_bytes: u64 = 0;

        // Query all activities with GPS tracks in one pass
        let mut stmt = self.db.prepare(
            "SELECT g.activity_id, g.track_data, m.name, m.sport_type, m.date, m.distance, m.moving_time
             FROM gps_tracks g
             LEFT JOIN activity_metrics m ON g.activity_id = m.activity_id
             ORDER BY m.date DESC"
        ).map_err(|e| format!("Query failed: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                let activity_id: String = row.get(0)?;
                let track_blob: Vec<u8> = row.get(1)?;
                let name: Option<String> = row.get(2)?;
                let sport_type: Option<String> = row.get(3)?;
                let date: Option<i64> = row.get(4)?;
                let distance: Option<f64> = row.get(5)?;
                let moving_time: Option<i64> = row.get(6)?;
                Ok((
                    activity_id,
                    track_blob,
                    name,
                    sport_type,
                    date,
                    distance,
                    moving_time,
                ))
            })
            .map_err(|e| format!("Query failed: {}", e))?;

        // Metadata entries for activities.json
        let mut metadata_entries: Vec<serde_json::Value> = Vec::new();

        for row_result in rows {
            let (activity_id, track_blob, name, sport_type, date, distance, moving_time) =
                match row_result {
                    Ok(r) => r,
                    Err(e) => {
                        skipped.push(SkippedActivity::new(
                            "unknown",
                            format!("row read failed: {}", e),
                        ));
                        continue;
                    }
                };

            let points: Vec<GpsPoint> = match TrackRead::from_blob(&track_blob) {
                TrackRead::Present(points) => points,
                TrackRead::Missing => {
                    skipped.push(SkippedActivity::new(&activity_id, "no stored track"));
                    continue;
                }
                TrackRead::Corrupt(reason) => {
                    skipped.push(SkippedActivity::unreadable(&activity_id, &reason));
                    continue;
                }
            };

            if points.is_empty() {
                skipped.push(SkippedActivity::new(&activity_id, "track holds no points"));
                continue;
            }

            let display_name = name.as_deref().unwrap_or(&activity_id);
            let sport = sport_type.as_deref().unwrap_or("Unknown");
            let date_str = date.map(|ts| {
                chrono::DateTime::from_timestamp(ts, 0)
                    .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string())
                    .unwrap_or_default()
            });
            let date_prefix = date
                .map(|ts| {
                    chrono::DateTime::from_timestamp(ts, 0)
                        .map(|dt| dt.format("%Y-%m-%d").to_string())
                        .unwrap_or_else(|| "unknown".to_string())
                })
                .unwrap_or_else(|| "unknown".to_string());

            // The exported copy alone is shortened. The stored track and every
            // index into it are untouched.
            let points = match trim.as_ref().map(|t| t.apply(&points)) {
                Some(Some(trimmed)) => trimmed,
                Some(None) => {
                    skipped.push(SkippedActivity::new(
                        &activity_id,
                        "trimmed to fewer points than a track",
                    ));
                    continue;
                }
                None => points,
            };

            // Generate GPX XML
            let gpx = generate_gpx(display_name, sport, date_str.as_deref(), &points);

            // Sanitize filename
            let safe_name: String = display_name
                .chars()
                .map(|c| {
                    if c.is_alphanumeric() || c == '-' || c == '_' {
                        c
                    } else {
                        '_'
                    }
                })
                .take(60)
                .collect();
            let filename = format!("{}_{}.gpx", date_prefix, safe_name);

            // Write to ZIP
            if let Err(e) = zip.start_file(&filename, options) {
                log::warn!("Failed to start ZIP entry {}: {}", filename, e);
                skipped.push(SkippedActivity::new(
                    &activity_id,
                    format!("archive entry failed: {}", e),
                ));
                continue;
            }
            if let Err(e) = zip.write_all(gpx.as_bytes()) {
                log::warn!("Failed to write ZIP entry {}: {}", filename, e);
                skipped.push(SkippedActivity::new(
                    &activity_id,
                    format!("archive write failed: {}", e),
                ));
                continue;
            }

            total_bytes += gpx.len() as u64;
            exported += 1;

            // Add metadata entry
            metadata_entries.push(serde_json::json!({
                "id": activity_id,
                "name": display_name,
                "date": date_str.as_deref().unwrap_or(""),
                "sport": sport,
                "distance": distance.unwrap_or(0.0),
                "movingTime": moving_time.unwrap_or(0),
                "hasGpx": true,
            }));
        }

        // Also add activities WITHOUT GPS tracks to metadata
        let mut no_gps_stmt = self
            .db
            .prepare(
                "SELECT m.activity_id, m.name, m.sport_type, m.date, m.distance, m.moving_time
             FROM activity_metrics m
             WHERE m.activity_id NOT IN (SELECT activity_id FROM gps_tracks)
             ORDER BY m.date DESC",
            )
            .map_err(|e| format!("No-GPS query failed: {}", e))?;

        let no_gps_rows = no_gps_stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<i64>>(3)?,
                    row.get::<_, Option<f64>>(4)?,
                    row.get::<_, Option<i64>>(5)?,
                ))
            })
            .map_err(|e| format!("No-GPS query failed: {}", e))?;

        for row_result in no_gps_rows {
            if let Ok((id, name, sport, date, distance, moving_time)) = row_result {
                let date_str = date.and_then(|ts| {
                    chrono::DateTime::from_timestamp(ts, 0)
                        .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string())
                });
                metadata_entries.push(serde_json::json!({
                    "id": id,
                    "name": name.as_deref().unwrap_or(&id),
                    "date": date_str.as_deref().unwrap_or(""),
                    "sport": sport.as_deref().unwrap_or("Unknown"),
                    "distance": distance.unwrap_or(0.0),
                    "movingTime": moving_time.unwrap_or(0),
                    "hasGpx": false,
                }));
                skipped.push(SkippedActivity::new(&id, "no stored track"));
            }
        }

        // Write activities.json metadata
        let meta_json =
            serde_json::to_string_pretty(&metadata_entries).unwrap_or_else(|_| "[]".to_string());
        zip.start_file("activities.json", options)
            .map_err(|e| format!("Failed to write metadata: {}", e))?;
        zip.write_all(meta_json.as_bytes())
            .map_err(|e| format!("Failed to write metadata: {}", e))?;
        total_bytes += meta_json.len() as u64;

        // The archive carries its own omissions, so a user who opens it can
        // see which activities are absent and why without reading a log.
        let skipped_json =
            serde_json::to_string_pretty(&skipped.iter().map(|s| s.as_json()).collect::<Vec<_>>())
                .unwrap_or_else(|_| "[]".to_string());
        zip.start_file("skipped.json", options)
            .map_err(|e| format!("Failed to write skip list: {}", e))?;
        zip.write_all(skipped_json.as_bytes())
            .map_err(|e| format!("Failed to write skip list: {}", e))?;
        total_bytes += skipped_json.len() as u64;

        zip.finish()
            .map_err(|e| format!("Failed to finalize ZIP: {}", e))?;

        log_unreadable(&skipped);
        log::info!(
            "[BulkExport] Exported {} activities ({} skipped), {} bytes uncompressed",
            exported,
            skipped.len(),
            total_bytes
        );

        Ok(BulkExportResult {
            exported,
            skipped: skipped.len() as u32,
            total_bytes,
        })
    }

    /// Export all activities with GPS data as a single GeoJSON FeatureCollection.
    ///
    /// Each activity becomes a Feature with a LineString geometry and properties
    /// (id, name, sport, date, distance, movingTime). Streams one track at a time.
    pub fn bulk_export_geojson(&self, dest_path: &str) -> Result<BulkExportResult, String> {
        use std::io::BufWriter;

        let file = std::fs::File::create(dest_path)
            .map_err(|e| format!("Failed to create GeoJSON file: {}", e))?;
        let mut writer = BufWriter::new(file);

        let mut exported: u32 = 0;
        let mut skipped: Vec<SkippedActivity> = Vec::new();
        let mut total_bytes: u64 = 0;

        // Write FeatureCollection header
        writer
            .write_all(b"{\"type\":\"FeatureCollection\",\"features\":[\n")
            .map_err(|e| format!("Write failed: {}", e))?;

        let mut stmt = self.db.prepare(
            "SELECT g.activity_id, g.track_data, m.name, m.sport_type, m.date, m.distance, m.moving_time
             FROM gps_tracks g
             LEFT JOIN activity_metrics m ON g.activity_id = m.activity_id
             ORDER BY m.date DESC"
        ).map_err(|e| format!("Query failed: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Vec<u8>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<i64>>(4)?,
                    row.get::<_, Option<f64>>(5)?,
                    row.get::<_, Option<i64>>(6)?,
                ))
            })
            .map_err(|e| format!("Query failed: {}", e))?;

        let mut first = true;
        for row_result in rows {
            let (activity_id, track_blob, name, sport_type, date, distance, moving_time) =
                match row_result {
                    Ok(r) => r,
                    Err(e) => {
                        skipped.push(SkippedActivity::new(
                            "unknown",
                            format!("row read failed: {}", e),
                        ));
                        continue;
                    }
                };

            let points: Vec<GpsPoint> = match TrackRead::from_blob(&track_blob) {
                TrackRead::Present(points) => points,
                TrackRead::Missing => {
                    skipped.push(SkippedActivity::new(&activity_id, "no stored track"));
                    continue;
                }
                TrackRead::Corrupt(reason) => {
                    skipped.push(SkippedActivity::unreadable(&activity_id, &reason));
                    continue;
                }
            };

            if points.is_empty() {
                skipped.push(SkippedActivity::new(&activity_id, "track holds no points"));
                continue;
            }

            let display_name = name.as_deref().unwrap_or(&activity_id);
            let sport = sport_type.as_deref().unwrap_or("Unknown");
            let date_str = date.and_then(|ts| {
                chrono::DateTime::from_timestamp(ts, 0)
                    .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string())
            });

            // Build coordinates array: [[lng, lat], ...]
            let coords: Vec<[f64; 2]> = points
                .iter()
                .filter(|p| p.latitude.is_finite() && p.longitude.is_finite())
                .map(|p| [p.longitude, p.latitude])
                .collect();

            if coords.is_empty() {
                skipped.push(SkippedActivity::new(
                    &activity_id,
                    "track holds no finite coordinates",
                ));
                continue;
            }

            let feature = serde_json::json!({
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": coords,
                },
                "properties": {
                    "id": activity_id,
                    "name": display_name,
                    "sport": sport,
                    "date": date_str.as_deref().unwrap_or(""),
                    "distance": distance.unwrap_or(0.0),
                    "movingTime": moving_time.unwrap_or(0),
                }
            });

            let feature_json = serde_json::to_string(&feature)
                .map_err(|e| format!("JSON serialization failed: {}", e))?;

            if !first {
                writer
                    .write_all(b",\n")
                    .map_err(|e| format!("Write failed: {}", e))?;
            }
            writer
                .write_all(feature_json.as_bytes())
                .map_err(|e| format!("Write failed: {}", e))?;

            total_bytes += feature_json.len() as u64;
            exported += 1;
            first = false;
        }

        // Close the feature array and carry the omissions as a foreign member,
        // so the file states what it is missing and why.
        let skipped_json =
            serde_json::to_string(&skipped.iter().map(|s| s.as_json()).collect::<Vec<_>>())
                .unwrap_or_else(|_| "[]".to_string());
        writer
            .write_all(b"\n],\"skipped\":")
            .map_err(|e| format!("Write failed: {}", e))?;
        writer
            .write_all(skipped_json.as_bytes())
            .map_err(|e| format!("Write failed: {}", e))?;
        writer
            .write_all(b"}")
            .map_err(|e| format!("Write failed: {}", e))?;
        writer.flush().map_err(|e| format!("Flush failed: {}", e))?;
        total_bytes += skipped_json.len() as u64;

        log_unreadable(&skipped);
        log::info!(
            "[BulkExport] GeoJSON exported {} activities ({} skipped), {} bytes",
            exported,
            skipped.len(),
            total_bytes
        );

        Ok(BulkExportResult {
            exported,
            skipped: skipped.len() as u32,
            total_bytes,
        })
    }
}

/// Generate GPX 1.1 XML for a single activity.
fn generate_gpx(name: &str, sport: &str, time: Option<&str>, points: &[GpsPoint]) -> String {
    let escaped_name = escape_xml(name);
    let escaped_sport = escape_xml(sport);

    let mut gpx = String::with_capacity(points.len() * 80 + 500);
    gpx.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    gpx.push_str("<gpx version=\"1.1\" creator=\"Veloq\"\n");
    gpx.push_str("  xmlns=\"http://www.topografix.com/GPX/1/1\"\n");
    gpx.push_str("  xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\"\n");
    gpx.push_str("  xsi:schemaLocation=\"http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd\">\n");
    gpx.push_str("  <metadata>\n");
    gpx.push_str(&format!("    <name>{}</name>\n", escaped_name));
    if let Some(t) = time {
        gpx.push_str(&format!("    <time>{}</time>\n", escape_xml(t)));
    }
    gpx.push_str("  </metadata>\n");
    gpx.push_str("  <trk>\n");
    gpx.push_str(&format!("    <name>{}</name>\n", escaped_name));
    gpx.push_str(&format!("    <type>{}</type>\n", escaped_sport));
    gpx.push_str("    <trkseg>\n");

    for p in points {
        if p.latitude.is_finite() && p.longitude.is_finite() {
            gpx.push_str(&format!(
                "      <trkpt lat=\"{:.6}\" lon=\"{:.6}\">\n      </trkpt>\n",
                p.latitude, p.longitude
            ));
        }
    }

    gpx.push_str("    </trkseg>\n");
    gpx.push_str("  </trk>\n");
    gpx.push_str("</gpx>");

    gpx
}

fn escape_xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

// ============================================================================
// Database backup
// ============================================================================

/// Pages copied per backup step, and the pause between steps. Small steps keep
/// the source unlocked between them, so a write during the copy waits for one
/// step and not for the whole file.
const BACKUP_PAGES_PER_STEP: i32 = 100;
const BACKUP_STEP_PAUSE: std::time::Duration = std::time::Duration::from_millis(10);

/// Copy the database file to `dest_path` from a connection of its own.
fn run_backup(db_path: &str, dest_path: &str) -> Result<(), String> {
    let source = rusqlite::Connection::open(db_path)
        .map_err(|e| format!("Failed to open backup source: {}", e))?;
    // A write on the engine's connection locks the file for its commit. Wait
    // it out rather than failing the backup on a transient busy.
    source
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("Failed to set backup busy timeout: {}", e))?;
    let mut dest = rusqlite::Connection::open(dest_path)
        .map_err(|e| format!("Failed to open backup destination: {}", e))?;
    let copy = rusqlite::backup::Backup::new(&source, &mut dest)
        .map_err(|e| format!("Failed to init backup: {}", e))?;
    copy.run_to_completion(BACKUP_PAGES_PER_STEP, BACKUP_STEP_PAUSE, None)
        .map_err(|e| format!("Backup failed: {}", e))
}

impl PersistentEngine {
    /// Start an atomic SQLite backup on a background thread.
    ///
    /// The copy opens its own connection to the same file, so it never takes
    /// the engine lock: a 400-activity library takes over a second to copy,
    /// and on the calling thread that is a second of dropped frames. A write
    /// landing mid-copy restarts it, which is how `sqlite3_backup` keeps the
    /// copy a consistent snapshot rather than a torn one.
    pub fn backup_database_background(&self, dest_path: &str) -> super::BackupHandle {
        let db_path = self.db_path.clone();
        let dest_path = dest_path.to_string();
        let (tx, rx) = std::sync::mpsc::channel();

        std::thread::spawn(move || {
            let result = run_backup(&db_path, &dest_path);
            match &result {
                Ok(()) => log::info!("[backup] Database backed up to {}", dest_path),
                Err(e) => log::error!("[backup] Backup to {} failed: {}", dest_path, e),
            }
            tx.send(result).ok();
        });

        super::BackupHandle { receiver: rx }
    }
}

/// Where the athlete lives, and how much of a track around it never leaves the
/// device in an export.
///
/// A ride's first and last fix are the most repeated coordinates in a library,
/// so an export handed to a coach or attached to a support thread carries the
/// door. Trimming happens here and nowhere else: the stored track, the
/// reference triple and every `start_index` are untouched, so the detector's
/// output does not move and a section's geometry on the device is unchanged.
#[derive(Debug, Clone, Copy)]
pub struct PrivacyTrim {
    pub home_lat: f64,
    pub home_lng: f64,
    /// Metres. Zero is off, which is exactly the behaviour before this existed.
    pub radius_m: f64,
}

/// Fewer points than this is not a track, so the activity is named in the skip
/// ledger rather than exported as a degenerate one.
const MIN_EXPORTABLE_POINTS: usize = 2;

impl PrivacyTrim {
    /// The trim the athlete has configured, or none. Both halves are needed:
    /// a radius with no home cannot trim anything, and a home with no radius
    /// is not a request to.
    pub fn from_settings(engine: &PersistentEngine) -> Option<Self> {
        let read = |key: &str| {
            engine
                .get_setting(key)
                .ok()
                .flatten()
                .and_then(|v| v.parse::<f64>().ok())
        };
        let radius_m = read(super::settings_keys::EXPORT_PRIVACY_RADIUS_M)?;
        if radius_m <= 0.0 {
            return None;
        }
        Some(Self {
            home_lat: read(super::settings_keys::EXPORT_HOME_LAT)?,
            home_lng: read(super::settings_keys::EXPORT_HOME_LNG)?,
            radius_m,
        })
    }

    /// The track as it should be exported, or `None` when trimming leaves too
    /// little to be a track.
    ///
    /// Only the ends are trimmed. A loop that passes the door mid-ride keeps
    /// those points, because removing them would cut the track in two and the
    /// thing being protected is where the ride starts and stops.
    pub fn apply(&self, points: &[GpsPoint]) -> Option<Vec<GpsPoint>> {
        if self.radius_m <= 0.0 || points.is_empty() {
            return Some(points.to_vec());
        }

        let inside = |p: &GpsPoint| {
            super::haversine_distance_meters(p.latitude, p.longitude, self.home_lat, self.home_lng)
                <= self.radius_m
        };

        let first = points.iter().position(|p| !inside(p))?;
        let last = points.iter().rposition(|p| !inside(p))?;
        let kept = &points[first..=last];
        (kept.len() >= MIN_EXPORTABLE_POINTS).then(|| kept.to_vec())
    }
}

#[cfg(test)]
mod privacy_trim_tests {
    use super::*;

    const HOME_LAT: f64 = 46.2333;
    const HOME_LNG: f64 = 7.36;

    /// Roughly `metres` north of home.
    fn north(metres: f64) -> GpsPoint {
        GpsPoint {
            latitude: HOME_LAT + metres / 111_320.0,
            longitude: HOME_LNG,
            elevation: None,
        }
    }

    fn trim(radius_m: f64) -> PrivacyTrim {
        PrivacyTrim {
            home_lat: HOME_LAT,
            home_lng: HOME_LNG,
            radius_m,
        }
    }

    /// Distance from home in metres, to the nearest ten, since the helper that
    /// builds the fixture converts metres to degrees approximately.
    fn distances(points: &[GpsPoint]) -> Vec<i64> {
        points
            .iter()
            .map(|p| {
                let m = super::super::haversine_distance_meters(
                    p.latitude,
                    p.longitude,
                    HOME_LAT,
                    HOME_LNG,
                );
                (m / 10.0).round() as i64 * 10
            })
            .collect()
    }

    #[test]
    fn a_track_that_starts_and_ends_at_the_door_loses_both_ends() {
        let track: Vec<GpsPoint> = [10.0, 60.0, 300.0, 900.0, 400.0, 50.0, 5.0]
            .iter()
            .map(|m| north(*m))
            .collect();

        let exported = trim(100.0).apply(&track).expect("the ride survives a trim");

        assert_eq!(distances(&exported), vec![300, 900, 400]);
    }

    #[test]
    fn a_track_that_never_approaches_home_is_untouched() {
        let track: Vec<GpsPoint> = [800.0, 1200.0, 1500.0].iter().map(|m| north(*m)).collect();

        assert_eq!(trim(100.0).apply(&track).unwrap(), track);
    }

    #[test]
    fn a_radius_of_zero_is_exactly_the_old_behaviour() {
        let track: Vec<GpsPoint> = [5.0, 10.0, 400.0].iter().map(|m| north(*m)).collect();

        assert_eq!(trim(0.0).apply(&track).unwrap(), track);
    }

    #[test]
    fn a_ride_entirely_inside_the_radius_is_not_exported() {
        let track: Vec<GpsPoint> = [10.0, 40.0, 20.0].iter().map(|m| north(*m)).collect();

        assert!(trim(100.0).apply(&track).is_none());
    }

    #[test]
    fn a_trim_that_leaves_one_point_is_not_a_track() {
        let track: Vec<GpsPoint> = [10.0, 500.0, 20.0].iter().map(|m| north(*m)).collect();

        assert!(trim(100.0).apply(&track).is_none());
    }

    /// A loop that passes the door mid-ride keeps those points. Removing them
    /// would cut the track in two, and what is protected is where it starts.
    #[test]
    fn a_pass_through_home_mid_ride_is_kept() {
        let track: Vec<GpsPoint> = [900.0, 20.0, 800.0].iter().map(|m| north(*m)).collect();

        let exported = trim(100.0).apply(&track).unwrap();

        assert_eq!(distances(&exported), vec![900, 20, 800]);
    }

    #[test]
    fn an_empty_track_stays_empty_rather_than_failing() {
        assert_eq!(trim(100.0).apply(&[]).unwrap().len(), 0);
    }
}

/// A home the athlete can confirm, and how sure the guess is.
#[derive(Debug, Clone, uniffi::Record)]
pub struct SuggestedHome {
    pub latitude: f64,
    pub longitude: f64,
    /// Rides whose first or last fix falls in the cluster.
    pub activity_count: u32,
    /// Endpoints in the cluster, of every endpoint in the library.
    pub endpoint_share: f64,
}

/// The cell edge the suggestion clusters on, and the radius the trim defaults
/// to. A ride's endpoints scatter by tens of metres around one door, so a
/// hundred is wide enough to gather them and narrow enough not to swallow the
/// next street.
const HOME_CELL_M: f64 = 100.0;

impl PersistentEngine {
    /// Where the athlete's rides start and finish most often, or none when
    /// there is not enough to guess from.
    ///
    /// A guess, not an answer: it is offered for confirmation and the trim
    /// stays off until someone confirms it. Endpoints are the first and last
    /// fix of every stored track, which is the pair a bulk export would carry.
    pub fn suggest_export_home(&self) -> Option<SuggestedHome> {
        let endpoints = self.track_endpoints();
        if endpoints.len() < 2 {
            return None;
        }

        // A cell grid rather than a clustering pass: the question is which
        // hundred metres, and every endpoint is one row.
        let mut cells: std::collections::HashMap<(i64, i64), Vec<(f64, f64)>> =
            std::collections::HashMap::new();
        let lat_cell = HOME_CELL_M / 111_320.0;
        for (lat, lng) in &endpoints {
            let lng_cell = HOME_CELL_M / (111_320.0 * lat.to_radians().cos().abs().max(0.01));
            cells
                .entry(((lat / lat_cell) as i64, (lng / lng_cell) as i64))
                .or_default()
                .push((*lat, *lng));
        }

        // Ties go to the lower cell key, so the same library suggests the same
        // home every time it is asked.
        let (_, densest) = cells
            .into_iter()
            .max_by_key(|(key, points)| (points.len(), std::cmp::Reverse(*key)))?;
        if densest.len() < 2 {
            return None;
        }

        // The cell picks the neighbourhood, distance picks the cluster. A door
        // near a cell edge scatters its endpoints across two cells, so counting
        // the cell alone undercounts it and pulls the centre to one side.
        let seed_lat = densest.iter().map(|(lat, _)| lat).sum::<f64>() / densest.len() as f64;
        let seed_lng = densest.iter().map(|(_, lng)| lng).sum::<f64>() / densest.len() as f64;
        let cluster: Vec<&(f64, f64)> = endpoints
            .iter()
            .filter(|(lat, lng)| {
                super::haversine_distance_meters(*lat, *lng, seed_lat, seed_lng) <= HOME_CELL_M
            })
            .collect();
        if cluster.len() < 2 {
            return None;
        }

        let count = cluster.len() as f64;
        Some(SuggestedHome {
            latitude: cluster.iter().map(|(lat, _)| lat).sum::<f64>() / count,
            longitude: cluster.iter().map(|(_, lng)| lng).sum::<f64>() / count,
            activity_count: cluster.len() as u32,
            endpoint_share: count / endpoints.len() as f64,
        })
    }

    /// The first and last fix of every stored track.
    fn track_endpoints(&self) -> Vec<(f64, f64)> {
        let Ok(mut stmt) = self.db.prepare("SELECT track_data FROM gps_tracks") else {
            return Vec::new();
        };
        let Ok(rows) = stmt.query_map([], |row| row.get::<_, Vec<u8>>(0)) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        for blob in rows.flatten() {
            let TrackRead::Present(points) = TrackRead::from_blob(&blob) else {
                continue;
            };
            if let (Some(first), Some(last)) = (points.first(), points.last()) {
                out.push((first.latitude, first.longitude));
                out.push((last.latitude, last.longitude));
            }
        }
        out
    }
}

#[cfg(test)]
mod suggested_home_tests {
    use super::*;
    use tempfile::TempDir;

    const HOME_LAT: f64 = 46.2333;
    const HOME_LNG: f64 = 7.36;

    fn near_home(offset_m: f64) -> GpsPoint {
        GpsPoint {
            latitude: HOME_LAT + offset_m / 111_320.0,
            longitude: HOME_LNG,
            elevation: None,
        }
    }

    fn away(km: f64) -> GpsPoint {
        GpsPoint {
            latitude: HOME_LAT + km * 1000.0 / 111_320.0,
            longitude: HOME_LNG,
            elevation: None,
        }
    }

    fn engine(dir: &TempDir) -> PersistentEngine {
        let path = dir.path().join("routes.db");
        PersistentEngine::new(path.to_str().unwrap()).expect("engine")
    }

    #[test]
    fn the_door_every_ride_starts_at_is_the_suggestion() {
        let dir = TempDir::new().unwrap();
        let mut engine = engine(&dir);
        for (i, offset) in [5.0, 20.0, 40.0, 15.0].iter().enumerate() {
            engine
                .add_activity(
                    format!("ride{i}"),
                    vec![near_home(*offset), away(3.0), near_home(offset + 10.0)],
                    "Ride".into(),
                )
                .expect("add");
        }

        let home = engine.suggest_export_home().expect("a home to confirm");

        let metres = super::super::haversine_distance_meters(
            home.latitude,
            home.longitude,
            HOME_LAT,
            HOME_LNG,
        );
        assert!(metres < 100.0, "the suggestion is {metres} m from the door");
        assert_eq!(home.activity_count, 8, "both ends of all four rides");
        assert!(home.endpoint_share > 0.9);
    }

    #[test]
    fn a_library_with_nothing_to_cluster_suggests_nothing() {
        let dir = TempDir::new().unwrap();
        let mut engine = engine(&dir);
        engine
            .add_activity("only".into(), vec![away(5.0), away(9.0)], "Ride".into())
            .expect("add");

        assert!(engine.suggest_export_home().is_none());
    }

    #[test]
    fn an_empty_library_suggests_nothing_rather_than_a_point_at_zero() {
        let dir = TempDir::new().unwrap();
        assert!(engine(&dir).suggest_export_home().is_none());
    }

    /// The same library answers the same way twice, so a confirmation screen
    /// does not offer a different home on a second visit.
    #[test]
    fn the_suggestion_is_stable() {
        let dir = TempDir::new().unwrap();
        let mut engine = engine(&dir);
        for i in 0..4 {
            engine
                .add_activity(
                    format!("r{i}"),
                    vec![near_home(f64::from(i) * 10.0), away(2.0)],
                    "Ride".into(),
                )
                .expect("add");
        }

        let first = engine.suggest_export_home().expect("home");
        let second = engine.suggest_export_home().expect("home");
        assert_eq!(first.latitude, second.latitude);
        assert_eq!(first.longitude, second.longitude);
    }
}
