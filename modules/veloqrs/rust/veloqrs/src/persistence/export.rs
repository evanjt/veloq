//! Bulk GPX export: stream GPS tracks from SQLite directly into a ZIP file.
//!
//! Processes one activity at a time - peak memory is ~1 track regardless of
//! total activity count. Avoids the OOM crash from holding all GPX strings
//! in the JS heap.

use std::io::Write;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

use rusqlite::{OpenFlags, Result as SqlResult};

use super::PersistentEngine;
use super::codec::TrackRead;
use crate::GpsPoint;

/// Why an activity is not in an export. The athlete acts on each differently:
/// a trainer ride has nothing to export, a trimmed ride is the privacy setting
/// doing its job, and a failure is a fault worth reporting.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SkipReason {
    NoTrack,
    Trimmed,
    Failed,
}

/// One activity left out of an export, with the reason it was left out. An
/// export that silently drops an unreadable track is indistinguishable from
/// one the user simply has no data for, so every skip is named.
struct SkippedActivity {
    activity_id: String,
    reason: String,
    kind: SkipReason,
    /// The skip was a decode failure rather than an absence of data.
    unreadable: bool,
}

impl SkippedActivity {
    fn new(activity_id: &str, kind: SkipReason, reason: impl Into<String>) -> Self {
        SkippedActivity {
            activity_id: activity_id.to_string(),
            reason: reason.into(),
            kind,
            unreadable: false,
        }
    }

    fn unreadable(activity_id: &str, reason: &str) -> Self {
        SkippedActivity {
            activity_id: activity_id.to_string(),
            reason: format!("unreadable track: {}", reason),
            kind: SkipReason::Failed,
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

/// A stored start as the athlete's wall clock, with no zone.
///
/// Sync stores `start_date_local`, a naive local time, as if it were UTC, so
/// the value is no instant. A trailing `Z` would claim one and move every ride
/// by the athlete's offset in whatever reads the file.
fn wall_clock(ts: i64) -> Option<String> {
    chrono::DateTime::from_timestamp(ts, 0).map(|dt| dt.format("%Y-%m-%dT%H:%M:%S").to_string())
}

/// `name`, or the first free `name_2`, `name_3` and so on. Two rides share a
/// stem whenever a watch names both legs of a commute alike, and the archive
/// refuses a repeated entry. `written` holds names uppercased, because a
/// case-insensitive filesystem, the default on macOS and Windows, extracts
/// `Ride.gpx` and `ride.gpx` to one file. Lowercasing would keep a final `ς`
/// apart from `σ`, which both uppercase to `Σ`.
fn unique_entry(written: &mut std::collections::HashSet<String>, stem: &str) -> String {
    let mut name = format!("{stem}.gpx");
    let mut n = 2;
    while written.contains(&name.to_uppercase()) {
        name = format!("{stem}_{n}.gpx");
        n += 1;
    }
    written.insert(name.to_uppercase());
    name
}

/// Result of a bulk export, with every skip counted under its reason.
#[derive(Debug, Clone, serde::Serialize, uniffi::Record)]
pub struct BulkExportResult {
    pub exported: u32,
    /// Activities with no stored track, such as trainer rides.
    pub no_track: u32,
    /// Tracks the privacy trim left too short to export.
    pub trimmed: u32,
    /// Tracks that could not be read or written.
    pub failed: u32,
    pub total_bytes: f64,
}

impl BulkExportResult {
    fn tally(exported: u32, skipped: &[SkippedActivity], total_bytes: u64) -> Self {
        let count = |kind| skipped.iter().filter(|s| s.kind == kind).count() as u32;
        BulkExportResult {
            exported,
            no_track: count(SkipReason::NoTrack),
            trimmed: count(SkipReason::Trimmed),
            failed: count(SkipReason::Failed),
            total_bytes: total_bytes as f64,
        }
    }
}

/// Which file a bulk export writes.
///
/// The wire carries the variant's position, so the order here is the contract:
/// append, never reorder. The discriminants start at one so no member is
/// falsy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
#[repr(u8)]
pub enum BulkExportFormat {
    /// A ZIP of one GPX file per activity, plus its metadata and skip list.
    Gpx = 1,
    /// One GeoJSON FeatureCollection holding every track.
    GeoJson = 2,
}

/// How far a running export has got. The export thread writes it and the
/// polling thread reads it, so the counts are atomics rather than a field on
/// the result nobody can see until the end.
///
/// `visited` moves for every stored track the writer takes, written or
/// skipped, because `total` counts every stored track. The result says which
/// were left out and why.
#[derive(Default)]
pub struct BulkExportProgress {
    visited: AtomicU32,
    total: AtomicU32,
}

impl BulkExportProgress {
    /// Tracks visited so far, and how many the export expects to visit.
    pub fn read(&self) -> (u32, u32) {
        (
            self.visited.load(Ordering::Relaxed),
            self.total.load(Ordering::Relaxed),
        )
    }

    /// One more stored track taken, whatever became of it.
    fn visit(&self) {
        self.visited.fetch_add(1, Ordering::Relaxed);
    }

    /// The row count is one cheap query and it is what makes a progress bar
    /// possible. A failure to count is not a failure to export, so it leaves
    /// the total at zero.
    fn set_total_from(&self, db: &rusqlite::Connection) {
        if let Ok(count) = db.query_row("SELECT COUNT(*) FROM gps_tracks", [], |row| {
            row.get::<_, i64>(0)
        }) {
            self.total.store(count.max(0) as u32, Ordering::Relaxed);
        }
    }
}

impl PersistentEngine {
    /// Export all activities with GPS data as GPX files inside a ZIP archive.
    ///
    /// Streams one track at a time from SQLite → GPX XML → ZIP entry on disk.
    /// The ZIP file is written to `dest_path`.
    pub fn bulk_export_gpx(&self, dest_path: &str) -> Result<BulkExportResult, String> {
        export_gpx(
            &self.db,
            PrivacyTrim::from_settings(self),
            dest_path,
            &BulkExportProgress::default(),
        )
    }

    /// Export all activities with GPS data as a single GeoJSON FeatureCollection.
    ///
    /// Each activity becomes a Feature with a LineString geometry and properties
    /// (id, name, sport, date, distance, movingTime). Streams one track at a time.
    pub fn bulk_export_geojson(&self, dest_path: &str) -> Result<BulkExportResult, String> {
        export_geojson(
            &self.db,
            PrivacyTrim::from_settings(self),
            dest_path,
            &BulkExportProgress::default(),
        )
    }
}

/// A GPX file ready to share: the name to save it under and its XML.
#[derive(Debug, Clone, uniffi::Record)]
pub struct GpxFile {
    pub filename: String,
    pub content: String,
}

/// The sport written for a track that carries none.
const UNKNOWN_SPORT: &str = "Unknown";

/// The part of a file name taken from an activity's name: letters and digits
/// of any script, `-` and `_`, everything else an underscore, at most 60
/// characters.
fn gpx_file_stem(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .take(60)
        .collect()
}

/// The one GPX file a single share writes, from points already trimmed for
/// privacy.
fn gpx_file_from_points(
    name: &str,
    sport: Option<&str>,
    time: Option<&str>,
    points: &[GpsPoint],
) -> GpxFile {
    GpxFile {
        filename: format!("{}.gpx", gpx_file_stem(name)),
        content: generate_gpx(name, sport, time, points),
    }
}

/// The GPX file for one shared track with the configured export privacy trim
/// applied, or `None` when the trim leaves too little to be a track.
pub(crate) fn single_gpx_file_from(
    conn: &rusqlite::Connection,
    name: &str,
    sport: Option<&str>,
    time: Option<&str>,
    points: &[GpsPoint],
) -> Option<GpxFile> {
    let finite: Vec<GpsPoint> = points
        .iter()
        .filter(|p| p.latitude.is_finite() && p.longitude.is_finite())
        .cloned()
        .collect();
    if finite.is_empty() {
        return None;
    }
    let kept = trim_points_for_export_from(conn, &finite)?;
    Some(gpx_file_from_points(name, sport, time, &kept))
}

/// Generate GPX 1.1 XML for a single activity. A missing sport is written as
/// `Unknown`, and a point's elevation is written when it is finite.
fn generate_gpx(
    name: &str,
    sport: Option<&str>,
    time: Option<&str>,
    points: &[GpsPoint],
) -> String {
    let escaped_name = escape_xml(name);
    let escaped_sport = escape_xml(sport.unwrap_or(UNKNOWN_SPORT));

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
                "      <trkpt lat=\"{:.6}\" lon=\"{:.6}\">\n",
                p.latitude, p.longitude
            ));
            if let Some(ele) = p.elevation.filter(|e| e.is_finite()) {
                gpx.push_str(&format!("        <ele>{}</ele>\n", ele));
            }
            gpx.push_str("      </trkpt>\n");
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

#[cfg(test)]
mod gpx_writer_tests {
    use super::*;

    fn fix(lat: f64, lon: f64, ele: Option<f64>) -> GpsPoint {
        GpsPoint {
            latitude: lat,
            longitude: lon,
            elevation: ele,
        }
    }

    #[test]
    fn coordinates_are_written_to_six_places() {
        let gpx = generate_gpx(
            "Ride",
            Some("Ride"),
            None,
            &[fix(46.51963400000001, 6.632273, None)],
        );
        assert!(gpx.contains("lat=\"46.519634\" lon=\"6.632273\""), "{gpx}");
    }

    #[test]
    fn a_missing_sport_is_written_as_unknown() {
        let gpx = generate_gpx("Ride", None, None, &[fix(1.0, 2.0, None)]);
        assert!(gpx.contains("<type>Unknown</type>"));
    }

    #[test]
    fn elevation_is_written_when_a_point_carries_it() {
        let gpx = generate_gpx(
            "Ride",
            Some("Ride"),
            None,
            &[fix(1.0, 2.0, Some(35.5)), fix(1.1, 2.1, None)],
        );
        assert_eq!(gpx.matches("<ele>35.5</ele>").count(), 1);
        assert_eq!(gpx.matches("<ele>").count(), 1);
    }

    #[test]
    fn a_non_finite_elevation_is_left_out() {
        let gpx = generate_gpx(
            "Ride",
            Some("Ride"),
            None,
            &[
                fix(1.0, 2.0, Some(f64::NAN)),
                fix(1.0, 2.0, Some(f64::INFINITY)),
            ],
        );
        assert!(!gpx.contains("<ele>"));
    }

    #[test]
    fn non_finite_coordinates_are_dropped() {
        let gpx = generate_gpx(
            "Ride",
            Some("Ride"),
            None,
            &[
                fix(f64::NAN, 2.0, None),
                fix(1.0, f64::INFINITY, None),
                fix(3.0, 4.0, None),
            ],
        );
        assert_eq!(gpx.matches("<trkpt").count(), 1);
    }

    #[test]
    fn markup_in_name_sport_and_time_is_escaped() {
        let gpx = generate_gpx(
            "A & <B> \"C\" 'D'",
            Some("<Ride>"),
            Some("2026-01-01T10:00:00&"),
            &[],
        );
        assert!(gpx.contains("<name>A &amp; &lt;B&gt; &quot;C&quot; &apos;D&apos;</name>"));
        assert!(gpx.contains("<type>&lt;Ride&gt;</type>"));
        assert!(gpx.contains("<time>2026-01-01T10:00:00&amp;</time>"));
        assert!(!gpx.contains("<B>"));
    }

    #[test]
    fn a_file_stem_keeps_letters_of_any_script() {
        assert_eq!(gpx_file_stem("朝のライド"), "朝のライド");
        assert_eq!(gpx_file_stem("a b/c.d"), "a_b_c_d");
    }

    #[test]
    fn a_file_stem_is_at_most_sixty_characters() {
        assert_eq!(gpx_file_stem(&"x".repeat(100)).chars().count(), 60);
    }

    #[test]
    fn a_single_file_is_named_for_the_ride_and_carries_its_track() {
        let file = gpx_file_from_points(
            "朝のライド",
            None,
            Some("2026-09-22T07:00:00"),
            &[fix(46.5, 6.6, None), fix(46.6, 6.7, None)],
        );
        assert_eq!(file.filename, "朝のライド.gpx");
        assert!(file.content.contains("<time>2026-09-22T07:00:00</time>"));
        assert!(file.content.contains("<type>Unknown</type>"));
        assert_eq!(file.content.matches("<trkpt").count(), 2);
    }
}

// ============================================================================
// Clear rollback snapshot
// ============================================================================

/// Pages copied per snapshot step, and the pause between steps. Small steps
/// keep the writer's commits from waiting on the copy: in WAL mode a reader
/// never blocks a writer, and the pause leaves the engine's connections room
/// between steps.
const SNAPSHOT_PAGES_PER_STEP: i32 = 100;
const SNAPSHOT_STEP_PAUSE: std::time::Duration = std::time::Duration::from_millis(10);

/// How many times a commit from another connection may restart the stepped
/// copy before it takes the rest in one step.
const SNAPSHOT_MAX_RESTARTS: u32 = 3;

/// What a snapshot copy did, so a test can bound the work and not the time.
#[derive(Debug, Default, PartialEq, Eq)]
struct SnapshotCopyStats {
    steps: u32,
    restarts: u32,
}

/// Copy `source` into `dest` with `sqlite3_backup`.
///
/// A commit from another connection restarts a stepped copy from the first
/// page, so under continuous commits it can run for ever. Each restart is
/// counted, and after `max_restarts` the remaining pages are copied in one
/// step: one read transaction, a consistent snapshot of the file as of its
/// start, which in WAL mode does not block the writer and cannot be
/// restarted. `between_steps` runs after every stepped copy, before the pause.
fn copy_with_restart_bound(
    source: &rusqlite::Connection,
    dest: &mut rusqlite::Connection,
    max_restarts: u32,
    mut between_steps: impl FnMut(),
) -> Result<SnapshotCopyStats, String> {
    use rusqlite::backup::StepResult;

    let copy = rusqlite::backup::Backup::new(source, dest)
        .map_err(|e| format!("Failed to init backup: {}", e))?;
    let mut stats = SnapshotCopyStats::default();
    let mut remaining = i32::MAX;
    loop {
        let pages = if stats.restarts >= max_restarts {
            -1
        } else {
            SNAPSHOT_PAGES_PER_STEP
        };
        let step = copy
            .step(pages)
            .map_err(|e| format!("Backup failed: {}", e))?;
        stats.steps += 1;
        match step {
            StepResult::Done => return Ok(stats),
            StepResult::More => {
                let now = copy.progress().remaining;
                if now > remaining {
                    stats.restarts += 1;
                }
                remaining = now;
            }
            _ => {}
        }
        between_steps();
        std::thread::sleep(SNAPSHOT_STEP_PAUSE);
    }
}

/// Copy the database file to `dest_path` from a connection of its own.
fn copy_database_snapshot(db_path: &str, dest_path: &str) -> Result<(), String> {
    let source = rusqlite::Connection::open(db_path)
        .map_err(|e| format!("Failed to open backup source: {}", e))?;
    // A write on the engine's connection locks the file for its commit. Wait
    // it out rather than failing the backup on a transient busy.
    source
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("Failed to set backup busy timeout: {}", e))?;
    let mut dest = rusqlite::Connection::open(dest_path)
        .map_err(|e| format!("Failed to open backup destination: {}", e))?;
    copy_with_restart_bound(&source, &mut dest, SNAPSHOT_MAX_RESTARTS, || {}).map(|_| ())
}

#[cfg(test)]
mod snapshot_copy_tests {
    use super::*;

    const ROWS: i64 = 600;

    fn source_in(dir: &std::path::Path) -> rusqlite::Connection {
        let conn = rusqlite::Connection::open(dir.join("live.db")).unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        conn.execute_batch("CREATE TABLE bulk (id INTEGER PRIMARY KEY, blob BLOB)")
            .unwrap();
        for _ in 0..ROWS {
            conn.execute("INSERT INTO bulk (blob) VALUES (zeroblob(4096))", [])
                .unwrap();
        }
        conn
    }

    fn count(conn: &rusqlite::Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM bulk", [], |r| r.get(0))
            .unwrap()
    }

    /// Scenario: another connection commits after every step.
    /// Expected behaviour: restarts stop at the bound, the copy finishes, and
    /// it holds a whole snapshot, with no more rows than the writer committed.
    #[test]
    fn continuous_commits_restart_the_copy_only_up_to_the_bound() {
        let dir = tempfile::TempDir::new().unwrap();
        let source = source_in(dir.path());
        let writer = rusqlite::Connection::open(dir.path().join("live.db")).unwrap();
        let mut dest = rusqlite::Connection::open(dir.path().join("copy.db")).unwrap();

        let mut commits = 0;
        let stats = copy_with_restart_bound(&source, &mut dest, 2, || {
            commits += 1;
            assert!(commits < 200, "the copy kept restarting");
            writer
                .execute("INSERT INTO bulk (blob) VALUES (zeroblob(4096))", [])
                .unwrap();
        })
        .unwrap();

        assert_eq!(stats.restarts, 2);
        let copied = count(&dest);
        assert!(copied >= ROWS && copied <= ROWS + commits);
        let integrity: String = dest
            .query_row("PRAGMA integrity_check", [], |r| r.get(0))
            .unwrap();
        assert_eq!(integrity, "ok");
    }

    #[test]
    fn an_idle_source_copies_without_a_restart() {
        let dir = tempfile::TempDir::new().unwrap();
        let source = source_in(dir.path());
        let mut dest = rusqlite::Connection::open(dir.path().join("copy.db")).unwrap();

        let stats = copy_with_restart_bound(&source, &mut dest, 2, || {}).unwrap();

        assert_eq!(stats.restarts, 0);
        assert!(stats.steps > 1);
        assert_eq!(count(&dest), ROWS);
    }

    #[test]
    fn an_empty_database_copies() {
        let dir = tempfile::TempDir::new().unwrap();
        let source = rusqlite::Connection::open(dir.path().join("live.db")).unwrap();
        let mut dest = rusqlite::Connection::open(dir.path().join("copy.db")).unwrap();

        copy_with_restart_bound(&source, &mut dest, 2, || {}).unwrap();
    }
}

impl PersistentEngine {
    /// Start the rollback snapshot of a destructive clear: an atomic SQLite
    /// copy on a background thread.
    ///
    /// The copy opens its own connection to the same file, so it never takes
    /// the engine lock: a 400-activity library takes over a second to copy,
    /// and on the calling thread that is a second of dropped frames. A commit
    /// landing mid-copy restarts it, which is how `sqlite3_backup` keeps the
    /// copy a consistent snapshot rather than a torn one. After a few
    /// restarts the rest is copied in one step, so continuous commits cannot
    /// keep the copy running.
    pub fn clear_snapshot_background(&self, dest_path: &str) -> super::BackupHandle {
        let db_path = self.db_path.clone();
        let dest_path = dest_path.to_string();
        let (tx, rx) = std::sync::mpsc::channel();

        crate::threads::spawn_named("veloq-backup", move || {
            let result = copy_database_snapshot(&db_path, &dest_path);
            match &result {
                Ok(()) => log::info!("[snapshot] Database copied to {}", dest_path),
                Err(e) => log::error!("[snapshot] Copy to {} failed: {}", dest_path, e),
            }
            tx.send(result).ok();
        });

        super::BackupHandle { receiver: rx }
    }

    /// Start a bulk export on a background thread, on a connection of its own.
    ///
    /// Reading a whole library into a file takes seconds. On the calling
    /// thread that is seconds of dropped frames, and under the engine's write
    /// lock it is seconds of stalled writes for every sync landing behind it,
    /// so the export gets the same treatment as the backup: its own thread and
    /// its own connection. Only the privacy trim is read here, because it is
    /// one setting and it decides what the file may contain.
    pub fn bulk_export_background(
        &self,
        format: BulkExportFormat,
        dest_path: &str,
    ) -> super::BulkExportHandle {
        let db_path = self.db_path.clone();
        let dest_path = dest_path.to_string();
        let trim = PrivacyTrim::from_settings(self);
        let progress = Arc::new(BulkExportProgress::default());
        let worker_progress = Arc::clone(&progress);
        let (tx, rx) = std::sync::mpsc::channel();

        crate::threads::spawn_named("veloq-export", move || {
            let result = open_export_connection(&db_path).and_then(|db| match format {
                BulkExportFormat::Gpx => export_gpx(&db, trim, &dest_path, &worker_progress),
                BulkExportFormat::GeoJson => {
                    export_geojson(&db, trim, &dest_path, &worker_progress)
                }
            });
            if let Err(e) = &result {
                log::error!("[BulkExport] Export to {} failed: {}", dest_path, e);
            }
            tx.send(result).ok();
        });

        super::BulkExportHandle {
            receiver: rx,
            progress,
        }
    }
}

/// A read-only connection for the export thread. The engine's own connection
/// stays free, and a write landing mid-export is waited out rather than
/// failing the export on a transient busy.
fn open_export_connection(db_path: &str) -> Result<rusqlite::Connection, String> {
    let db = rusqlite::Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|e| format!("Failed to open export source: {}", e))?;
    db.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("Failed to set export busy timeout: {}", e))?;
    Ok(db)
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
        Self::from_reader(|key| {
            engine
                .get_setting(key)
                .ok()
                .flatten()
                .and_then(|v| v.parse::<f64>().ok())
        })
    }

    /// The same trim, read through a connection, for a single export that
    /// takes no engine lock.
    pub fn from_connection(conn: &rusqlite::Connection) -> Option<Self> {
        Self::from_reader(|key| {
            super::settings::setting_from(conn, key)
                .ok()
                .flatten()
                .and_then(|v| v.parse::<f64>().ok())
        })
    }

    fn from_reader(read: impl Fn(&str) -> Option<f64>) -> Option<Self> {
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

        // A fix with no position is neither inside nor outside the radius, and
        // would stop the trim at the door, so the writers drop it first.
        let finite: Vec<GpsPoint> = points
            .iter()
            .filter(|p| p.latitude.is_finite() && p.longitude.is_finite())
            .cloned()
            .collect();
        let points = finite.as_slice();

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

/// The points of a single export with the configured privacy trim applied, or
/// `None` when the trim leaves too little to be a track. With no trim
/// configured the points come back whole.
pub(crate) fn trim_points_for_export_from(
    conn: &rusqlite::Connection,
    points: &[GpsPoint],
) -> Option<Vec<GpsPoint>> {
    match PrivacyTrim::from_connection(conn) {
        Some(trim) => trim.apply(points),
        None => Some(points.to_vec()),
    }
}

/// What the trim would do to the library as it stands.
///
/// A radius in metres means nothing on its own. The number that makes the
/// setting concrete is how many rides it reaches, and how many it would leave
/// out of the archive altogether.
#[derive(Debug, Clone, uniffi::Record)]
pub struct ExportPrivacyPreview {
    /// Activities an export would write at all, the denominator.
    pub with_track: u32,
    /// Activities whose first or last fix lies inside the radius, so the
    /// exported copy is shorter than the stored one.
    pub touched: u32,
    /// Activities the export would leave out and name in the skip ledger.
    pub dropped: u32,
}

/// Metres of latitude per degree, close enough to bound a search box.
const METRES_PER_DEGREE_LAT: f64 = 111_320.0;

/// Longitude degrees spanning `radius_m` at this latitude, bounded so a
/// latitude near the pole widens the box rather than dividing by zero.
fn lng_span_degrees(lat: f64, radius_m: f64) -> f64 {
    let shrink = lat.to_radians().cos().abs().max(1e-6);
    (radius_m / (METRES_PER_DEGREE_LAT * shrink)).min(180.0)
}

/// What a trim at this home and radius would do to the current library.
///
/// Reads stored endpoints and bounding boxes only, so the count costs one
/// query over two small tables rather than a decode of every track.
///
/// `dropped` is deliberately conservative. A bounding box lying wholly
/// inside the circle guarantees every point is trimmed, but a box that
/// pokes out only guarantees one surviving point where the export needs
/// two, so a ride can still be dropped without being counted here. The
/// skip ledger the export writes stays the authoritative list.
pub(crate) fn export_privacy_preview_from(
    conn: &rusqlite::Connection,
    home_lat: f64,
    home_lng: f64,
    radius_m: f64,
) -> SqlResult<ExportPrivacyPreview> {
    let with_track: u32 =
        conn.query_row("SELECT COUNT(*) FROM gps_tracks", [], |row| row.get(0))?;

    if radius_m.is_nan() || radius_m <= 0.0 || !home_lat.is_finite() || !home_lng.is_finite() {
        return Ok(ExportPrivacyPreview {
            with_track,
            touched: 0,
            dropped: 0,
        });
    }

    let lat_span = radius_m / METRES_PER_DEGREE_LAT;
    let lng_span = lng_span_degrees(home_lat, radius_m);
    let (lat_lo, lat_hi) = (home_lat - lat_span, home_lat + lat_span);
    let (lng_lo, lng_hi) = (home_lng - lng_span, home_lng + lng_span);

    // The box is a prefilter: an endpoint outside it cannot be inside the
    // circle, and every candidate is measured again below.
    let mut stmt = conn.prepare(
        "SELECT s.start_point_lat, s.start_point_lng, s.end_point_lat, s.end_point_lng,
                a.min_lat, a.max_lat, a.min_lng, a.max_lng
         FROM signatures s
         JOIN gps_tracks g ON g.activity_id = s.activity_id
         JOIN activities a ON a.id = s.activity_id
         WHERE (s.start_point_lat BETWEEN ?1 AND ?2 AND s.start_point_lng BETWEEN ?3 AND ?4)
            OR (s.end_point_lat BETWEEN ?1 AND ?2 AND s.end_point_lng BETWEEN ?3 AND ?4)",
    )?;

    let rows = stmt.query_map([lat_lo, lat_hi, lng_lo, lng_hi], |row| {
        Ok((
            row.get::<_, f64>(0)?,
            row.get::<_, f64>(1)?,
            row.get::<_, f64>(2)?,
            row.get::<_, f64>(3)?,
            row.get::<_, f64>(4)?,
            row.get::<_, f64>(5)?,
            row.get::<_, f64>(6)?,
            row.get::<_, f64>(7)?,
        ))
    })?;

    let inside = |lat: f64, lng: f64| {
        super::haversine_distance_meters(lat, lng, home_lat, home_lng) <= radius_m
    };

    let mut touched: u32 = 0;
    let mut dropped: u32 = 0;
    for row in rows {
        let (start_lat, start_lng, end_lat, end_lng, min_lat, max_lat, min_lng, max_lng) = row?;
        if !inside(start_lat, start_lng) && !inside(end_lat, end_lng) {
            continue;
        }
        touched += 1;
        let corners = [
            (min_lat, min_lng),
            (min_lat, max_lng),
            (max_lat, min_lng),
            (max_lat, max_lng),
        ];
        if corners.iter().all(|(lat, lng)| inside(*lat, *lng)) {
            dropped += 1;
        }
    }

    Ok(ExportPrivacyPreview {
        with_track,
        touched,
        dropped,
    })
}

impl PersistentEngine {
    /// What a trim at this home and radius would do to the current library.
    /// The count is `export_privacy_preview_from` over the engine's connection.
    pub fn export_privacy_preview(
        &self,
        home_lat: f64,
        home_lng: f64,
        radius_m: f64,
    ) -> SqlResult<ExportPrivacyPreview> {
        export_privacy_preview_from(&self.db, home_lat, home_lng, radius_m)
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

/// Where the athlete's rides start and finish most often, or none when
/// there is not enough to guess from.
///
/// A guess, not an answer: it is offered for confirmation and the trim
/// stays off until someone confirms it. Endpoints are the first and last
/// fix of every stored track, which is the pair a bulk export would carry.
pub(crate) fn suggest_export_home_from(conn: &rusqlite::Connection) -> Option<SuggestedHome> {
    let endpoints = track_endpoints(conn);
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

/// The first and last fix of every stored track, as columns.
///
/// `signatures` holds both endpoints already, and the privacy preview this
/// suggestion is offered for reads them from there, so reading the same
/// rows keeps the suggestion and the trim looking at one set of
/// activities. Decoding every `gps_tracks` blob instead was a full-table
/// decode from a settings-row mount, for two points a row.
fn track_endpoints(conn: &rusqlite::Connection) -> Vec<(f64, f64)> {
    let Ok(mut stmt) = conn.prepare(
        "SELECT s.start_point_lat, s.start_point_lng, s.end_point_lat, s.end_point_lng
         FROM signatures s
         JOIN gps_tracks g ON g.activity_id = s.activity_id",
    ) else {
        return Vec::new();
    };
    let Ok(rows) = stmt.query_map([], |row| {
        Ok((
            row.get::<_, f64>(0)?,
            row.get::<_, f64>(1)?,
            row.get::<_, f64>(2)?,
            row.get::<_, f64>(3)?,
        ))
    }) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for (start_lat, start_lng, end_lat, end_lng) in rows.flatten() {
        out.push((start_lat, start_lng));
        out.push((end_lat, end_lng));
    }
    out
}

impl PersistentEngine {
    /// Where the athlete's rides start and finish most often, or none when
    /// there is not enough to guess from. The guess is
    /// `suggest_export_home_from` over the engine's connection.
    pub fn suggest_export_home(&self) -> Option<SuggestedHome> {
        suggest_export_home_from(&self.db)
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

    /// The suggestion and the trim it is offered for now read the same rows,
    /// so an activity the trim cannot see cannot pull the suggested door.
    #[test]
    fn an_activity_with_no_signature_does_not_move_the_suggestion() {
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
        engine
            .add_activity(
                "elsewhere".into(),
                vec![away(40.0), away(41.0), away(40.5)],
                "Ride".into(),
            )
            .expect("add");
        engine
            .db
            .execute("DELETE FROM signatures WHERE activity_id = 'elsewhere'", [])
            .unwrap();

        let home = engine.suggest_export_home().expect("a home to confirm");

        assert_eq!(home.activity_count, 8, "both ends of the four signed rides");
        assert!(home.endpoint_share > 0.9, "and nothing else counted");
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

/// An activity with no row in `gps_tracks`, such as a trainer ride.
struct Trackless {
    id: String,
    name: Option<String>,
    sport: Option<String>,
    date: Option<i64>,
    distance: Option<f64>,
    moving_time: Option<i64>,
}

/// Every activity with no stored track. Both writers name these in their skip
/// ledger, so the two formats count the same library the same way.
fn trackless_activities(db: &rusqlite::Connection) -> Result<Vec<Trackless>, String> {
    let mut stmt = db
        .prepare(
            "SELECT m.activity_id, m.name, m.sport_type, m.date, m.distance, m.moving_time
             FROM activity_metrics m
             WHERE m.activity_id NOT IN (SELECT activity_id FROM gps_tracks)
             ORDER BY m.date DESC",
        )
        .map_err(|e| format!("No-GPS query failed: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Trackless {
                id: row.get(0)?,
                name: row.get(1)?,
                sport: row.get(2)?,
                date: row.get(3)?,
                distance: row.get(4)?,
                moving_time: row.get(5)?,
            })
        })
        .map_err(|e| format!("No-GPS query failed: {}", e))?;
    Ok(rows.flatten().collect())
}

/// The gpx writer, taking the connection rather than the engine, so a
/// background thread can run it on a connection of its own.
fn export_gpx(
    db: &rusqlite::Connection,
    trim: Option<PrivacyTrim>,
    dest_path: &str,
    progress: &BulkExportProgress,
) -> Result<BulkExportResult, String> {
    let file = std::fs::File::create(dest_path)
        .map_err(|e| format!("Failed to create ZIP file: {}", e))?;

    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .compression_level(Some(6));

    progress.set_total_from(db);
    let mut exported: u32 = 0;
    let mut skipped: Vec<SkippedActivity> = Vec::new();
    let mut total_bytes: u64 = 0;

    // Query all activities with GPS tracks in one pass
    let mut stmt = db.prepare(
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
    let mut entry_names = std::collections::HashSet::new();

    for row_result in rows {
        progress.visit();
        let (activity_id, track_blob, name, sport_type, date, distance, moving_time) =
            match row_result {
                Ok(r) => r,
                Err(e) => {
                    skipped.push(SkippedActivity::new(
                        "unknown",
                        SkipReason::Failed,
                        format!("row read failed: {}", e),
                    ));
                    continue;
                }
            };

        let points: Vec<GpsPoint> = match TrackRead::from_blob(&track_blob) {
            TrackRead::Present(points) => points,
            TrackRead::Missing => {
                skipped.push(SkippedActivity::new(
                    &activity_id,
                    SkipReason::NoTrack,
                    "no stored track",
                ));
                continue;
            }
            TrackRead::Corrupt(reason) => {
                skipped.push(SkippedActivity::unreadable(&activity_id, &reason));
                continue;
            }
        };

        if points.is_empty() {
            skipped.push(SkippedActivity::new(
                &activity_id,
                SkipReason::NoTrack,
                "track holds no points",
            ));
            continue;
        }

        let display_name = name.as_deref().unwrap_or(&activity_id);
        let date_str = date.and_then(wall_clock);
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
                    SkipReason::Trimmed,
                    "trimmed to fewer points than a track",
                ));
                continue;
            }
            None => points,
        };

        // The same test the GeoJSON writer makes, so the two count it alike.
        if !points
            .iter()
            .any(|p| p.latitude.is_finite() && p.longitude.is_finite())
        {
            skipped.push(SkippedActivity::new(
                &activity_id,
                SkipReason::Failed,
                "track holds no finite coordinates",
            ));
            continue;
        }

        // Generate GPX XML
        let gpx = generate_gpx(
            display_name,
            sport_type.as_deref(),
            date_str.as_deref(),
            &points,
        );

        let safe_name = gpx_file_stem(display_name);
        let filename = unique_entry(&mut entry_names, &format!("{date_prefix}_{safe_name}"));

        // Write to ZIP
        if let Err(e) = zip.start_file(&filename, options) {
            log::warn!("Failed to start ZIP entry {}: {}", filename, e);
            skipped.push(SkippedActivity::new(
                &activity_id,
                SkipReason::Failed,
                format!("archive entry failed: {}", e),
            ));
            continue;
        }
        if let Err(e) = zip.write_all(gpx.as_bytes()) {
            log::warn!("Failed to write ZIP entry {}: {}", filename, e);
            skipped.push(SkippedActivity::new(
                &activity_id,
                SkipReason::Failed,
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
            "sport": sport_type.as_deref().unwrap_or(UNKNOWN_SPORT),
            "distance": distance.unwrap_or(0.0),
            "movingTime": moving_time.unwrap_or(0),
            "hasGpx": true,
        }));
    }

    // Also add activities WITHOUT GPS tracks to metadata
    for Trackless {
        id,
        name,
        sport,
        date,
        distance,
        moving_time,
    } in trackless_activities(db)?
    {
        let date_str = date.and_then(wall_clock);
        metadata_entries.push(serde_json::json!({
            "id": id,
            "name": name.as_deref().unwrap_or(&id),
            "date": date_str.as_deref().unwrap_or(""),
            "sport": sport.as_deref().unwrap_or("Unknown"),
            "distance": distance.unwrap_or(0.0),
            "movingTime": moving_time.unwrap_or(0),
            "hasGpx": false,
        }));
        skipped.push(SkippedActivity::new(
            &id,
            SkipReason::NoTrack,
            "no stored track",
        ));
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

    Ok(BulkExportResult::tally(exported, &skipped, total_bytes))
}

/// The geojson writer, taking the connection rather than the engine, so a
/// background thread can run it on a connection of its own.
fn export_geojson(
    db: &rusqlite::Connection,
    trim: Option<PrivacyTrim>,
    dest_path: &str,
    progress: &BulkExportProgress,
) -> Result<BulkExportResult, String> {
    use std::io::BufWriter;

    let file = std::fs::File::create(dest_path)
        .map_err(|e| format!("Failed to create GeoJSON file: {}", e))?;
    let mut writer = BufWriter::new(file);

    progress.set_total_from(db);
    let mut exported: u32 = 0;
    let mut skipped: Vec<SkippedActivity> = Vec::new();
    let mut total_bytes: u64 = 0;

    // Write FeatureCollection header
    writer
        .write_all(b"{\"type\":\"FeatureCollection\",\"features\":[\n")
        .map_err(|e| format!("Write failed: {}", e))?;

    let mut stmt = db.prepare(
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
        progress.visit();
        let (activity_id, track_blob, name, sport_type, date, distance, moving_time) =
            match row_result {
                Ok(r) => r,
                Err(e) => {
                    skipped.push(SkippedActivity::new(
                        "unknown",
                        SkipReason::Failed,
                        format!("row read failed: {}", e),
                    ));
                    continue;
                }
            };

        let points: Vec<GpsPoint> = match TrackRead::from_blob(&track_blob) {
            TrackRead::Present(points) => points,
            TrackRead::Missing => {
                skipped.push(SkippedActivity::new(
                    &activity_id,
                    SkipReason::NoTrack,
                    "no stored track",
                ));
                continue;
            }
            TrackRead::Corrupt(reason) => {
                skipped.push(SkippedActivity::unreadable(&activity_id, &reason));
                continue;
            }
        };

        if points.is_empty() {
            skipped.push(SkippedActivity::new(
                &activity_id,
                SkipReason::NoTrack,
                "track holds no points",
            ));
            continue;
        }

        let display_name = name.as_deref().unwrap_or(&activity_id);
        let sport = sport_type.as_deref().unwrap_or(UNKNOWN_SPORT);
        let date_str = date.and_then(wall_clock);

        // The exported copy alone is shortened. The stored track and every
        // index into it are untouched. The setting names no format, so this is
        // the same trim the GPX writer applies to the same rows.
        let points = match trim.as_ref().map(|t| t.apply(&points)) {
            Some(Some(trimmed)) => trimmed,
            Some(None) => {
                skipped.push(SkippedActivity::new(
                    &activity_id,
                    SkipReason::Trimmed,
                    "trimmed to fewer points than a track",
                ));
                continue;
            }
            None => points,
        };

        // Build coordinates array: [[lng, lat], ...]
        let coords: Vec<[f64; 2]> = points
            .iter()
            .filter(|p| p.latitude.is_finite() && p.longitude.is_finite())
            .map(|p| [p.longitude, p.latitude])
            .collect();

        if coords.is_empty() {
            skipped.push(SkippedActivity::new(
                &activity_id,
                SkipReason::Failed,
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

    for trackless in trackless_activities(db)? {
        skipped.push(SkippedActivity::new(
            &trackless.id,
            SkipReason::NoTrack,
            "no stored track",
        ));
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

    Ok(BulkExportResult::tally(exported, &skipped, total_bytes))
}

#[cfg(test)]
mod bulk_export_tests {
    use super::*;
    use std::io::Read;
    use tempfile::TempDir;

    #[test]
    fn test_export_connection_rejects_writes() {
        let dir = TempDir::new().unwrap();
        let engine = engine(&dir);
        let db = open_export_connection(&engine.db_path).expect("export connection");

        let tables: i64 = db
            .query_row("SELECT COUNT(*) FROM sqlite_master", [], |row| row.get(0))
            .expect("read schema");
        assert!(tables > 0);
        assert!(
            db.execute("CREATE TABLE export_write_probe (id INTEGER)", [])
                .is_err()
        );
    }

    const HOME_LAT: f64 = 46.2333;
    const HOME_LNG: f64 = 7.36;

    /// 2026-09-22 07:00 on the athlete's wall clock, stored the way sync
    /// stores `start_date_local`: the naive time read as if it were UTC.
    const SEVEN_AM: i64 = 1_790_060_400;

    fn north(metres: f64) -> GpsPoint {
        GpsPoint {
            latitude: HOME_LAT + metres / 111_320.0,
            longitude: HOME_LNG,
            elevation: None,
        }
    }

    fn engine(dir: &TempDir) -> PersistentEngine {
        let path = dir.path().join("routes.db");
        PersistentEngine::new(path.to_str().unwrap()).expect("engine")
    }

    fn ride(engine: &mut PersistentEngine, id: &str, name: &str, date: i64, metres: &[f64]) {
        engine
            .add_activity(
                id.into(),
                metres.iter().map(|m| north(*m)).collect(),
                "Ride".into(),
            )
            .expect("add ride");
        metrics(engine, id, name, date);
    }

    fn metrics(engine: &PersistentEngine, id: &str, name: &str, date: i64) {
        engine
            .db
            .execute(
                "INSERT OR REPLACE INTO activity_metrics
                 (activity_id, name, date, distance, moving_time, elapsed_time, elevation_gain, sport_type)
                 VALUES (?1, ?2, ?3, 1000.0, 600, 600, 0.0, 'Ride')",
                rusqlite::params![id, name, date],
            )
            .expect("metrics row");
    }

    fn set_home(engine: &PersistentEngine, radius_m: f64) {
        for (key, value) in [
            ("__export_home_lat", HOME_LAT),
            ("__export_home_lng", HOME_LNG),
            ("__export_privacy_radius_m", radius_m),
        ] {
            engine
                .set_setting(key, &value.to_string())
                .expect("setting");
        }
    }

    fn archive_entry(zip_path: &std::path::Path, name: &str) -> String {
        let file = std::fs::File::open(zip_path).expect("open zip");
        let mut archive = zip::ZipArchive::new(file).expect("read zip");
        let mut body = String::new();
        archive
            .by_name(name)
            .unwrap_or_else(|_| panic!("no {name} in the archive"))
            .read_to_string(&mut body)
            .expect("read entry");
        body
    }

    fn gpx_entries(zip_path: &std::path::Path) -> Vec<String> {
        let file = std::fs::File::open(zip_path).expect("open zip");
        let archive = zip::ZipArchive::new(file).expect("read zip");
        let mut names: Vec<String> = archive
            .file_names()
            .filter(|n| n.ends_with(".gpx"))
            .map(str::to_string)
            .collect();
        names.sort();
        names
    }

    fn assert_both_exported(names: [&str; 2]) {
        let dir = TempDir::new().unwrap();
        let mut engine = engine(&dir);
        ride(
            &mut engine,
            "leg-out",
            names[0],
            SEVEN_AM,
            &[900.0, 1400.0, 2000.0],
        );
        ride(
            &mut engine,
            "leg-back",
            names[1],
            SEVEN_AM + 36_000,
            &[2000.0, 1400.0, 900.0],
        );

        let dest = dir.path().join("export.zip");
        let result = engine
            .bulk_export_gpx(dest.to_str().unwrap())
            .expect("gpx export");

        assert_eq!(result.exported, 2);
        assert_eq!(result.failed, 0);
        let entries = gpx_entries(&dest);
        assert_eq!(entries.len(), 2, "{entries:?}");
        assert_ne!(
            entries[0].to_uppercase(),
            entries[1].to_uppercase(),
            "a case-insensitive filesystem extracts {entries:?} to one file"
        );
        let meta: serde_json::Value =
            serde_json::from_str(&archive_entry(&dest, "activities.json")).unwrap();
        assert_eq!(meta.as_array().unwrap().len(), 2);
        let skipped: serde_json::Value =
            serde_json::from_str(&archive_entry(&dest, "skipped.json")).unwrap();
        assert_eq!(skipped, serde_json::json!([]));
    }

    #[test]
    fn two_rides_with_one_name_on_one_day_are_both_in_the_archive() {
        assert_both_exported(["Morning Ride", "Morning Ride"]);
    }

    #[test]
    fn names_the_sanitiser_folds_together_are_both_in_the_archive() {
        assert_both_exported(["Ride #1", "Ride @1"]);
    }

    #[test]
    fn names_that_differ_only_in_case_are_two_files_once_extracted() {
        assert_both_exported(["Morning Ride", "Morning ride"]);
    }

    /// Lowercasing alone keeps a word-final sigma apart from a medial one,
    /// while a case-insensitive filesystem folds both to one capital.
    #[test]
    fn names_that_differ_only_in_greek_sigma_are_two_files_once_extracted() {
        assert_both_exported(["ΟΔΟΣ", "Οδος"]);
    }

    #[test]
    fn names_that_differ_past_sixty_characters_are_both_in_the_archive() {
        let stem = "A".repeat(60);
        assert_both_exported([&format!("{stem} out"), &format!("{stem} back")]);
    }

    #[test]
    fn every_exported_time_is_the_stored_wall_clock_with_no_zone() {
        let dir = TempDir::new().unwrap();
        let mut engine = engine(&dir);
        ride(
            &mut engine,
            "sydney",
            "Harbour loop",
            SEVEN_AM,
            &[900.0, 1400.0, 2000.0],
        );
        metrics(&engine, "trainer", "Trainer", SEVEN_AM);

        let zip = dir.path().join("export.zip");
        engine.bulk_export_gpx(zip.to_str().unwrap()).expect("gpx");
        let gpx = archive_entry(&zip, &gpx_entries(&zip)[0]);
        assert!(
            gpx.contains("<time>2026-09-22T07:00:00</time>"),
            "the GPX metadata time: {gpx}"
        );
        let meta: serde_json::Value =
            serde_json::from_str(&archive_entry(&zip, "activities.json")).unwrap();
        for row in meta.as_array().unwrap() {
            assert_eq!(row["date"], "2026-09-22T07:00:00", "{row}");
        }

        let geojson = dir.path().join("export.geojson");
        engine
            .bulk_export_geojson(geojson.to_str().unwrap())
            .expect("geojson");
        let doc: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&geojson).unwrap()).unwrap();
        assert_eq!(
            doc["features"][0]["properties"]["date"],
            "2026-09-22T07:00:00"
        );
    }

    /// Two trainer rides, three rides wholly inside the home radius and one
    /// unreadable track. The counts differ so a writer that swaps two reasons
    /// fails, and neither writer may call a trimmed ride GPS-less.
    fn mixed_library(dir: &TempDir) -> PersistentEngine {
        let mut engine = engine(dir);
        ride(
            &mut engine,
            "outdoor",
            "Outdoor",
            SEVEN_AM,
            &[900.0, 1400.0, 2000.0],
        );
        for id in ["doorstep-1", "doorstep-2", "doorstep-3"] {
            ride(
                &mut engine,
                id,
                "Doorstep",
                SEVEN_AM,
                &[5.0, 30.0, 60.0, 20.0],
            );
        }
        ride(
            &mut engine,
            "garbled",
            "Garbled",
            SEVEN_AM,
            &[900.0, 1400.0, 2000.0],
        );
        engine
            .db
            .execute(
                "UPDATE gps_tracks SET track_data = ?1 WHERE activity_id = 'garbled'",
                rusqlite::params![vec![0x7fu8, 1, 2, 3, 4, 5, 6, 7]],
            )
            .expect("garble");
        metrics(&engine, "trainer", "Trainer", SEVEN_AM);
        metrics(&engine, "trainer-2", "Trainer", SEVEN_AM);
        set_home(&engine, 100.0);
        engine
    }

    /// A stored track whose every point is non-finite has nothing to draw. The
    /// GPX writer used to write an empty segment and count it exported, while
    /// the GeoJSON writer counted it failed.
    #[test]
    fn both_writers_fail_a_track_with_no_finite_point() {
        let dir = TempDir::new().unwrap();
        let mut engine = engine(&dir);
        ride(
            &mut engine,
            "outdoor",
            "Outdoor",
            SEVEN_AM,
            &[900.0, 1400.0, 2000.0],
        );
        ride(
            &mut engine,
            "nowhere",
            "Nowhere",
            SEVEN_AM,
            &[900.0, 1400.0, 2000.0],
        );
        let nan = GpsPoint {
            latitude: f64::NAN,
            longitude: f64::NAN,
            elevation: None,
        };
        let blob = super::super::codec::serialize_points(&[nan, nan]).expect("blob");
        engine
            .db
            .execute(
                "UPDATE gps_tracks SET track_data = ?1 WHERE activity_id = 'nowhere'",
                rusqlite::params![blob],
            )
            .expect("store non-finite track");

        let zip = dir.path().join("export.zip");
        let gpx = engine.bulk_export_gpx(zip.to_str().unwrap()).expect("gpx");
        let geojson = dir.path().join("export.geojson");
        let json = engine
            .bulk_export_geojson(geojson.to_str().unwrap())
            .expect("geojson");

        assert_eq!((gpx.exported, gpx.failed), (1, 1), "gpx");
        assert_eq!((json.exported, json.failed), (1, 1), "geojson");
        assert_eq!(gpx_entries(&zip).len(), 1);
    }

    /// The total counts every stored track, so the count has to move for a
    /// track the writer skips as well, or a run with skips ends short of it.
    #[test]
    fn progress_reaches_its_total_when_tracks_are_skipped() {
        let dir = TempDir::new().unwrap();
        let engine = mixed_library(&dir);
        let stored: u32 = engine
            .db
            .query_row("SELECT COUNT(*) FROM gps_tracks", [], |row| row.get(0))
            .expect("count tracks");

        let gpx_progress = BulkExportProgress::default();
        let gpx = export_gpx(
            &engine.db,
            PrivacyTrim::from_settings(&engine),
            dir.path().join("export.zip").to_str().unwrap(),
            &gpx_progress,
        )
        .expect("gpx");
        let json_progress = BulkExportProgress::default();
        let json = export_geojson(
            &engine.db,
            PrivacyTrim::from_settings(&engine),
            dir.path().join("export.geojson").to_str().unwrap(),
            &json_progress,
        )
        .expect("geojson");

        assert_eq!(stored, 5);
        assert_eq!(gpx_progress.read(), (stored, stored), "gpx");
        assert_eq!(json_progress.read(), (stored, stored), "geojson");
        assert_eq!((gpx.exported, gpx.trimmed, gpx.failed), (1, 3, 1), "gpx");
        assert_eq!(
            (json.exported, json.trimmed, json.failed),
            (1, 3, 1),
            "geojson"
        );
    }

    /// One ride exported both ways, with a non-finite first fix ahead of the
    /// door points, so the two writers must make the same trim.
    #[test]
    fn a_ride_exports_the_same_track_singly_and_in_bulk() {
        let dir = TempDir::new().unwrap();
        let mut engine = engine(&dir);
        ride(
            &mut engine,
            "door-ride",
            "Morning ride",
            SEVEN_AM,
            &[0.0, 30.0, 60.0, 900.0, 1400.0, 2000.0, 60.0, 30.0],
        );
        let stored = engine.get_gps_track("door-ride").expect("stored track");
        let mut with_gap = vec![GpsPoint {
            latitude: f64::NAN,
            longitude: f64::NAN,
            elevation: None,
        }];
        with_gap.extend(stored.iter().cloned());
        let blob = super::super::codec::serialize_points(&with_gap).expect("blob");
        engine
            .db
            .execute(
                "UPDATE gps_tracks SET track_data = ?1 WHERE activity_id = 'door-ride'",
                rusqlite::params![blob],
            )
            .expect("store track");
        set_home(&engine, 100.0);

        let single = single_gpx_file_from(
            &engine.db,
            "Morning ride",
            Some("Ride"),
            Some("2026-09-22T07:00:00"),
            &with_gap,
        )
        .expect("single file");
        let dest = dir.path().join("export.zip");
        engine
            .bulk_export_gpx(dest.to_str().unwrap())
            .expect("bulk");
        let entries = gpx_entries(&dest);
        assert_eq!(entries.len(), 1, "{entries:?}");
        let bulk = archive_entry(&dest, &entries[0]);

        let lines = |gpx: &str, tag: &str| -> Vec<String> {
            gpx.lines()
                .filter(|l| l.trim_start().starts_with(tag))
                .map(|l| l.trim().to_string())
                .collect()
        };
        for tag in ["<trkpt", "<type>", "<time>", "<ele>"] {
            assert_eq!(lines(&single.content, tag), lines(&bulk, tag), "{tag}");
        }
        assert_eq!(lines(&single.content, "<trkpt").len(), 3);
        assert_eq!(single.filename, "Morning_ride.gpx");
        assert_eq!(entries[0], "2026-09-22_Morning_ride.gpx");
    }

    #[test]
    fn the_gpx_result_names_each_skip_reason_apart() {
        let dir = TempDir::new().unwrap();
        let engine = mixed_library(&dir);
        let dest = dir.path().join("export.zip");
        let result = engine.bulk_export_gpx(dest.to_str().unwrap()).expect("gpx");

        assert_eq!(result.exported, 1);
        assert_eq!(result.no_track, 2);
        assert_eq!(result.trimmed, 3);
        assert_eq!(result.failed, 1);
    }

    #[test]
    fn the_geojson_result_counts_the_same_skips_as_the_gpx_one() {
        let dir = TempDir::new().unwrap();
        let engine = mixed_library(&dir);
        let dest = dir.path().join("export.geojson");
        let result = engine
            .bulk_export_geojson(dest.to_str().unwrap())
            .expect("geojson");

        assert_eq!(result.exported, 1);
        assert_eq!(result.no_track, 2);
        assert_eq!(result.trimmed, 3);
        assert_eq!(result.failed, 1);
        let doc: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&dest).unwrap()).unwrap();
        let ids: Vec<&str> = doc["skipped"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s["id"].as_str().unwrap())
            .collect();
        assert!(
            ids.contains(&"trainer"),
            "the ledger names the trainer ride: {ids:?}"
        );
    }
}
