//! Bulk GPX export: stream GPS tracks from SQLite directly into a ZIP file.
//!
//! Processes one activity at a time — peak memory is ~1 track regardless of
//! total activity count. Avoids the OOM crash from holding all GPX strings
//! in the JS heap.

use std::io::Write;

use super::PersistentRouteEngine;
use crate::GpsPoint;

/// Result of a bulk GPX export.
#[derive(Debug, Clone, serde::Serialize, uniffi::Record)]
pub struct BulkExportResult {
    pub exported: u32,
    pub skipped: u32,
    pub total_bytes: u64,
}

impl PersistentRouteEngine {
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
        let mut skipped: u32 = 0;
        let mut total_bytes: u64 = 0;

        // Query all activities with GPS tracks in one pass
        let mut stmt = self.db.prepare(
            "SELECT g.activity_id, g.track_data, m.name, m.sport_type, m.date, m.distance, m.moving_time
             FROM gps_tracks g
             LEFT JOIN activity_metrics m ON g.activity_id = m.activity_id
             ORDER BY m.date DESC"
        ).map_err(|e| format!("Query failed: {}", e))?;

        let rows = stmt.query_map([], |row| {
            let activity_id: String = row.get(0)?;
            let track_blob: Vec<u8> = row.get(1)?;
            let name: Option<String> = row.get(2)?;
            let sport_type: Option<String> = row.get(3)?;
            let date: Option<i64> = row.get(4)?;
            let distance: Option<f64> = row.get(5)?;
            let moving_time: Option<i64> = row.get(6)?;
            Ok((activity_id, track_blob, name, sport_type, date, distance, moving_time))
        }).map_err(|e| format!("Query failed: {}", e))?;

        // Metadata entries for activities.json
        let mut metadata_entries: Vec<serde_json::Value> = Vec::new();

        for row_result in rows {
            let (activity_id, track_blob, name, sport_type, date, distance, moving_time) =
                match row_result {
                    Ok(r) => r,
                    Err(_) => { skipped += 1; continue; }
                };

            // Deserialize GPS track
            let points: Vec<GpsPoint> = match rmp_serde::from_slice(&track_blob) {
                Ok(p) => p,
                Err(_) => { skipped += 1; continue; }
            };

            if points.is_empty() {
                skipped += 1;
                continue;
            }

            let display_name = name.as_deref().unwrap_or(&activity_id);
            let sport = sport_type.as_deref().unwrap_or("Unknown");
            let date_str = date.map(|ts| {
                chrono::DateTime::from_timestamp(ts, 0)
                    .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string())
                    .unwrap_or_default()
            });
            let date_prefix = date.map(|ts| {
                chrono::DateTime::from_timestamp(ts, 0)
                    .map(|dt| dt.format("%Y-%m-%d").to_string())
                    .unwrap_or_else(|| "unknown".to_string())
            }).unwrap_or_else(|| "unknown".to_string());

            // Generate GPX XML
            let gpx = generate_gpx(display_name, sport, date_str.as_deref(), &points);

            // Sanitize filename
            let safe_name: String = display_name
                .chars()
                .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
                .take(60)
                .collect();
            let filename = format!("{}_{}.gpx", date_prefix, safe_name);

            // Write to ZIP
            if let Err(e) = zip.start_file(&filename, options) {
                log::warn!("Failed to start ZIP entry {}: {}", filename, e);
                skipped += 1;
                continue;
            }
            if let Err(e) = zip.write_all(gpx.as_bytes()) {
                log::warn!("Failed to write ZIP entry {}: {}", filename, e);
                skipped += 1;
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
        let mut no_gps_stmt = self.db.prepare(
            "SELECT m.activity_id, m.name, m.sport_type, m.date, m.distance, m.moving_time
             FROM activity_metrics m
             WHERE m.activity_id NOT IN (SELECT activity_id FROM gps_tracks)
             ORDER BY m.date DESC"
        ).map_err(|e| format!("No-GPS query failed: {}", e))?;

        let no_gps_rows = no_gps_stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<i64>>(3)?,
                row.get::<_, Option<f64>>(4)?,
                row.get::<_, Option<i64>>(5)?,
            ))
        }).map_err(|e| format!("No-GPS query failed: {}", e))?;

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
                skipped += 1;
            }
        }

        // Write activities.json metadata
        let meta_json = serde_json::to_string_pretty(&metadata_entries)
            .unwrap_or_else(|_| "[]".to_string());
        zip.start_file("activities.json", options)
            .map_err(|e| format!("Failed to write metadata: {}", e))?;
        zip.write_all(meta_json.as_bytes())
            .map_err(|e| format!("Failed to write metadata: {}", e))?;
        total_bytes += meta_json.len() as u64;

        zip.finish().map_err(|e| format!("Failed to finalize ZIP: {}", e))?;

        log::info!(
            "[BulkExport] Exported {} activities ({} skipped), {} bytes uncompressed",
            exported, skipped, total_bytes
        );

        Ok(BulkExportResult { exported, skipped, total_bytes })
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
        let mut skipped: u32 = 0;
        let mut total_bytes: u64 = 0;

        // Write FeatureCollection header
        writer.write_all(b"{\"type\":\"FeatureCollection\",\"features\":[\n")
            .map_err(|e| format!("Write failed: {}", e))?;

        let mut stmt = self.db.prepare(
            "SELECT g.activity_id, g.track_data, m.name, m.sport_type, m.date, m.distance, m.moving_time
             FROM gps_tracks g
             LEFT JOIN activity_metrics m ON g.activity_id = m.activity_id
             ORDER BY m.date DESC"
        ).map_err(|e| format!("Query failed: {}", e))?;

        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Vec<u8>>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<i64>>(4)?,
                row.get::<_, Option<f64>>(5)?,
                row.get::<_, Option<i64>>(6)?,
            ))
        }).map_err(|e| format!("Query failed: {}", e))?;

        let mut first = true;
        for row_result in rows {
            let (activity_id, track_blob, name, sport_type, date, distance, moving_time) =
                match row_result {
                    Ok(r) => r,
                    Err(_) => { skipped += 1; continue; }
                };

            let points: Vec<GpsPoint> = match rmp_serde::from_slice(&track_blob) {
                Ok(p) => p,
                Err(_) => { skipped += 1; continue; }
            };

            if points.is_empty() {
                skipped += 1;
                continue;
            }

            let display_name = name.as_deref().unwrap_or(&activity_id);
            let sport = sport_type.as_deref().unwrap_or("Unknown");
            let date_str = date.and_then(|ts| {
                chrono::DateTime::from_timestamp(ts, 0)
                    .map(|dt| dt.format("%Y-%m-%dT%H:%M:%SZ").to_string())
            });

            // Build coordinates array: [[lng, lat], ...]
            let coords: Vec<[f64; 2]> = points.iter()
                .filter(|p| p.latitude.is_finite() && p.longitude.is_finite())
                .map(|p| [p.longitude, p.latitude])
                .collect();

            if coords.is_empty() {
                skipped += 1;
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
                writer.write_all(b",\n")
                    .map_err(|e| format!("Write failed: {}", e))?;
            }
            writer.write_all(feature_json.as_bytes())
                .map_err(|e| format!("Write failed: {}", e))?;

            total_bytes += feature_json.len() as u64;
            exported += 1;
            first = false;
        }

        // Close FeatureCollection
        writer.write_all(b"\n]}")
            .map_err(|e| format!("Write failed: {}", e))?;
        writer.flush()
            .map_err(|e| format!("Flush failed: {}", e))?;

        log::info!(
            "[BulkExport] GeoJSON exported {} activities ({} skipped), {} bytes",
            exported, skipped, total_bytes
        );

        Ok(BulkExportResult { exported, skipped, total_bytes })
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
