//! The whole-library exports, called the way the app calls them: on the
//! export thread, over its own read-only connection.

use veloqrs::PersistentEngine;
use veloqrs::persistence::{BulkExportFormat, BulkExportResult};

pub trait BulkExport {
    fn bulk_export_gpx(&self, dest_path: &str) -> Result<BulkExportResult, String>;
    fn bulk_export_geojson(&self, dest_path: &str) -> Result<BulkExportResult, String>;
}

impl BulkExport for PersistentEngine {
    fn bulk_export_gpx(&self, dest_path: &str) -> Result<BulkExportResult, String> {
        run(self, BulkExportFormat::Gpx, dest_path)
    }

    fn bulk_export_geojson(&self, dest_path: &str) -> Result<BulkExportResult, String> {
        run(self, BulkExportFormat::GeoJson, dest_path)
    }
}

fn run(
    engine: &PersistentEngine,
    format: BulkExportFormat,
    dest_path: &str,
) -> Result<BulkExportResult, String> {
    engine
        .bulk_export_background(format, dest_path, Default::default())?
        .recv_blocking()
        .unwrap_or_else(|| Err("Export thread died without a result".to_string()))
}
