//! Record-only backup payload and its ZIP container.

use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use rusqlite::{Connection, OpenFlags, OptionalExtension, types::ValueRef};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::{PersistentEngine, codec};

pub(crate) const RECORD_VERSION: u32 = 1;

/// What every temporary file and directory the record writer makes starts
/// with. Each sits beside its destination, so a kill before the rename leaves
/// it in a directory the app owns, under a name the wipe deletes
/// (`RECORD_TEMP_PREFIX` in `platformRecord.ts`).
pub(crate) const RECORD_TEMP_PREFIX: &str = "veloq-record-";

/// Largest inflated `record.json` a restore will read, far above any real
/// record, so a small archive cannot inflate until the allocator aborts.
pub(crate) const RECORD_JSON_LIMIT: u64 = 64 * 1024 * 1024;

/// The file a record zip is written into before it replaces `destination`.
fn record_temporary(destination: &Path) -> Result<tempfile::NamedTempFile, String> {
    let parent = destination.parent().ok_or("Backup path has no parent")?;
    tempfile::Builder::new()
        .prefix(RECORD_TEMP_PREFIX)
        .tempfile_in(parent)
        .map_err(|e| e.to_string())
}

/// The directory an older library is copied into for conversion, beside the
/// record it becomes rather than in the system temporary directory, which no
/// wipe reaches.
fn conversion_directory(destination: &Path) -> Result<tempfile::TempDir, String> {
    let parent = destination.parent().ok_or("Backup path has no parent")?;
    tempfile::Builder::new()
        .prefix(RECORD_TEMP_PREFIX)
        .tempdir_in(parent)
        .map_err(|e| e.to_string())
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct RecordPayload {
    pub(crate) version: u32,
    #[serde(default)]
    pub(crate) athlete_id: Option<String>,
    pub(crate) entries: Vec<RecordRow>,
    /// The intervals.icu id each device-minted key the entries name was
    /// uploaded as, so a restore where the sync stored the ride under that id
    /// places the record on it.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub(crate) upstream_ids: BTreeMap<String, String>,
    /// When the record was written, RFC 3339 in UTC. The file's own time is
    /// not kept by every restore that carries it back, so a record dates
    /// itself. A record written before this field reads as `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) written_at: Option<String>,
    /// The settings the writer had and left out for where the file was going,
    /// by key. A restore unsets each one rather than keep the value the
    /// restoring library held. A record written before this field, or for a
    /// destination that leaves nothing out, names none.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub(crate) left_out: Vec<String>,
}

/// Where a record backup is going, which decides what it may hold.
///
/// The wire carries the variant's position, so the order here is the contract:
/// append, never reorder. The discriminants start at one so no member is
/// falsy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
#[repr(u8)]
pub enum RecordScope {
    /// Storage only this app reads: its own documents, the Google Drive app
    /// folder, the iCloud Drive app folder, the athlete's WebDAV server.
    Whole = 1,
    /// A folder on the device's shared storage, which other apps and a
    /// connected computer can read. It leaves out the export privacy home.
    SharedStorage = 2,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct RecordRow {
    pub(crate) table: String,
    pub(crate) values: Map<String, Value>,
    #[serde(default)]
    pub(crate) ground: Option<RecordGround>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct RecordGround {
    pub(crate) rep_activity_id: Option<String>,
    pub(crate) rep_start_index: Option<i64>,
    pub(crate) rep_end_index: Option<i64>,
    pub(crate) point_count: Option<i64>,
    pub(crate) polyline_json: Option<String>,
    /// A route's members, which a restore resolves its group by. A route has
    /// no line of its own and its representative is whichever member the
    /// grouping picked on that device.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) activity_ids: Option<Vec<String>>,
}

fn table_exists(db: &Connection, table: &str) -> Result<bool, String> {
    db.query_row(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |_| Ok(()),
    )
    .optional()
    .map(|found| found.is_some())
    .map_err(|e| e.to_string())
}

fn column_exists(db: &Connection, table: &str, column: &str) -> Result<bool, String> {
    db.query_row(
        "SELECT 1 FROM pragma_table_info(?1) WHERE name = ?2",
        [table, column],
        |_| Ok(()),
    )
    .optional()
    .map(|found| found.is_some())
    .map_err(|e| e.to_string())
}

/// The point lists a record carries as JSON text: the blob column the library
/// stores each in, and the key the record has always written it under. A
/// record file stays one format whichever column the row's line was read from.
const LINE_COLUMNS: &[(&str, &str, &str)] = &[
    ("section_intents", "polyline_blob", "polyline_json"),
    (
        "sections",
        "original_polyline_blob",
        "original_polyline_json",
    ),
];

fn rows(db: &Connection, table: &str, filter: &str) -> Result<Vec<RecordRow>, String> {
    if !table_exists(db, table)? {
        return Ok(Vec::new());
    }
    let sql = format!("SELECT * FROM {table} WHERE {filter}");
    let mut statement = db.prepare(&sql).map_err(|e| e.to_string())?;
    let columns: Vec<String> = statement
        .column_names()
        .iter()
        .map(|s| (*s).to_string())
        .collect();
    let results = statement
        .query_map([], |row| {
            let mut values = Map::new();
            let mut lines = Vec::new();
            for (index, key) in columns.iter().enumerate() {
                let value = match row.get_ref(index)? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(n) => Value::from(n),
                    ValueRef::Real(n) => Value::from(n),
                    ValueRef::Text(bytes) => {
                        Value::String(String::from_utf8_lossy(bytes).into_owned())
                    }
                    ValueRef::Blob(bytes) => {
                        if let Some((_, _, json_key)) = LINE_COLUMNS
                            .iter()
                            .find(|(t, blob_key, _)| *t == table && blob_key == key)
                        {
                            match codec::deserialize_points(bytes) {
                                Ok(points) => {
                                    if let Ok(json) = serde_json::to_string(&points) {
                                        lines.push((json_key.to_string(), Value::String(json)));
                                    }
                                }
                                Err(error) => {
                                    let id: String = row.get("id")?;
                                    log::error!("{table} {id}: {key} read failed: {error}");
                                }
                            }
                        }
                        continue;
                    }
                };
                values.insert(key.clone(), value);
            }
            // A decoded blob wins over its JSON column; an undecodable blob leaves the JSON intact.
            values.extend(lines);
            Ok(RecordRow {
                table: table.to_string(),
                values,
                ground: None,
            })
        })
        .map_err(|e| e.to_string())?;
    results
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|e| e.to_string())
}

pub(crate) fn string<'a>(values: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    values.get(key).and_then(Value::as_str)
}

pub(crate) fn integer(values: &Map<String, Value>, key: &str) -> Option<i64> {
    values.get(key).and_then(Value::as_i64)
}

fn geometry_ground(
    db: &Connection,
    section_id: &str,
    version: Option<i64>,
) -> Result<Option<RecordGround>, String> {
    if !table_exists(db, "section_geometry")? {
        return Ok(None);
    }
    let mut statement = db
        .prepare(
            "SELECT rep_activity_id, rep_start_index, rep_end_index, point_count, blob
         FROM section_geometry WHERE section_id = ?1 AND (?2 IS NULL OR version = ?2)
         ORDER BY version DESC LIMIT 1",
        )
        .map_err(|e| e.to_string())?;
    statement
        .query_row((section_id, version), |row| {
            let blob: Vec<u8> = row.get(4)?;
            let polyline_json = if blob.is_empty() {
                None
            } else {
                codec::decode_polyline(&blob).and_then(|points| serde_json::to_string(&points).ok())
            };
            Ok(RecordGround {
                rep_activity_id: row.get(0)?,
                rep_start_index: row.get(1)?,
                rep_end_index: row.get(2)?,
                point_count: row.get(3)?,
                polyline_json,
                activity_ids: None,
            })
        })
        .optional()
        .map_err(|e| e.to_string())
}

fn section_ground(
    db: &Connection,
    section_id: &str,
    version: Option<i64>,
) -> Result<Option<RecordGround>, String> {
    let geometry = geometry_ground(db, section_id, version)?;
    if geometry.as_ref().is_some_and(|ground| {
        ground.rep_activity_id.is_some()
            && ground.rep_start_index.is_some()
            && ground.rep_end_index.is_some()
    }) {
        return Ok(geometry);
    }
    // A row that names a version keeps that version's line. The section row
    // itself takes the cut's own triple over a latest version that has none,
    // which is the baseline an upgrade wrote for a hand-cut.
    if version.is_some() && geometry.is_some() {
        return Ok(geometry);
    }
    match section_row_ground(db, section_id)? {
        Some(mut row)
            if row.rep_activity_id.is_some()
                && row.rep_start_index.is_some()
                && row.rep_end_index.is_some() =>
        {
            if row.polyline_json.is_none() {
                row.polyline_json = geometry.and_then(|ground| ground.polyline_json);
            }
            Ok(Some(row))
        }
        row => Ok(geometry.or(row)),
    }
}

fn section_row_ground(db: &Connection, section_id: &str) -> Result<Option<RecordGround>, String> {
    if !table_exists(db, "sections")? {
        return Ok(None);
    }
    let ground = db
        .query_row(
            "SELECT representative_activity_id, rep_start_index, rep_end_index,
                 source_activity_id, start_index, end_index, polyline_blob, polyline_json,
                 section_type = 'custom' AND geometry_source IS NOT 'consensus'
             FROM sections WHERE id = ?1",
            [section_id],
            |row| {
                let blob: Option<Vec<u8>> = row.get(6)?;
                let fallback: Option<String> = row.get(7)?;
                let polyline_json = blob
                    .as_deref()
                    .and_then(|bytes| {
                        codec::decode_polyline_row(Some(bytes), fallback.as_deref()).ok()
                    })
                    .and_then(|points| serde_json::to_string(&points).ok())
                    .or(fallback);
                // Only a hand-cut is a slice of one ride. Its rep triple is
                // half-open and its own columns are inclusive, so their end
                // moves on by one to name the same slice.
                let exact_cut: bool = row.get(8)?;
                let half_open: (Option<String>, Option<i64>, Option<i64>) =
                    (row.get(0)?, row.get(1)?, row.get(2)?);
                let inclusive: (Option<String>, Option<i64>, Option<i64>) =
                    (row.get(3)?, row.get(4)?, row.get(5)?);
                let (rep_activity_id, rep_start_index, rep_end_index) = match (half_open, inclusive)
                {
                    (_, (id, start, end)) if !exact_cut => (id, start, end),
                    ((Some(id), Some(start), Some(end)), _) if end > start => {
                        (Some(id), Some(start), Some(end))
                    }
                    (_, (Some(id), Some(start), Some(end))) if end > start => {
                        (Some(id), Some(start), Some(end + 1))
                    }
                    (_, (id, start, end)) => (id, start, end),
                };
                let ground = RecordGround {
                    rep_activity_id,
                    rep_start_index,
                    rep_end_index,
                    point_count: None,
                    polyline_json,
                    activity_ids: None,
                };
                Ok((ground, exact_cut))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some((mut ground, exact_cut)) = ground else {
        return Ok(None);
    };
    if exact_cut
        && let Some(activity_id) = ground.rep_activity_id.as_deref()
        && table_exists(db, "gps_tracks")?
    {
        ground.point_count = db
            .query_row(
                "SELECT point_count FROM gps_tracks WHERE activity_id = ?1",
                [activity_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .flatten();
    }
    Ok(Some(ground))
}

fn row_ground(db: &Connection, row: &RecordRow) -> Result<Option<RecordGround>, String> {
    let values = &row.values;
    match row.table.as_str() {
        "section_intents" => Ok(Some(RecordGround {
            rep_activity_id: None,
            rep_start_index: None,
            rep_end_index: None,
            point_count: None,
            polyline_json: string(values, "polyline_json").map(str::to_string),
            activity_ids: None,
        })),
        "section_activities" => Ok(Some(RecordGround {
            rep_activity_id: string(values, "activity_id").map(str::to_string),
            rep_start_index: integer(values, "start_index"),
            rep_end_index: integer(values, "end_index"),
            point_count: None,
            polyline_json: None,
            activity_ids: None,
        })),
        "sections" => string(values, "id").map_or(Ok(None), |id| section_ground(db, id, None)),
        "section_numbers" => {
            string(values, "section_id").map_or(Ok(None), |id| section_ground(db, id, None))
        }
        "section_history" => string(values, "section_id").map_or(Ok(None), |id| {
            section_ground(db, id, integer(values, "geometry_version"))
        }),
        "section_pins" => string(values, "section_id").map_or(Ok(None), |id| {
            section_ground(db, id, integer(values, "version"))
        }),
        "section_forced_matches" => {
            string(values, "section_id").map_or(Ok(None), |id| section_ground(db, id, None))
        }
        "route_names" | "route_numbers" | "activity_matches" => {
            let Some(route_id) = string(values, "route_id") else {
                return Ok(None);
            };
            if !table_exists(db, "route_groups")? {
                return Ok(None);
            }
            let blob_column = if column_exists(db, "route_groups", "activity_ids_blob")? {
                "activity_ids_blob"
            } else {
                "NULL"
            };
            let group: Option<(String, Vec<String>)> = db
                .query_row(
                    &format!(
                        "SELECT representative_id, activity_ids, {blob_column}
                         FROM route_groups WHERE id = ?1"
                    ),
                    [route_id],
                    |row| {
                        Ok((
                            row.get(0)?,
                            super::routes::decode_activity_ids(row, route_id, 1, 2)?,
                        ))
                    },
                )
                .optional()
                .map_err(|e| e.to_string())?;
            Ok(group.map(|(rep_activity_id, members)| RecordGround {
                rep_activity_id: Some(rep_activity_id),
                rep_start_index: None,
                rep_end_index: None,
                point_count: None,
                polyline_json: None,
                activity_ids: Some(members),
            }))
        }
        _ => Ok(None),
    }
}

/// Put the numbered section's type on its number row, so a restore looks for
/// a hand-cut among hand-cuts and a detected section among detected ones.
fn carry_section_type(db: &Connection, row: &mut RecordRow) -> Result<(), String> {
    let Some(id) = string(&row.values, "section_id") else {
        return Ok(());
    };
    let section_type: Option<String> = db
        .query_row(
            "SELECT section_type FROM sections WHERE id = ?1",
            [id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(section_type) = section_type {
        row.values
            .insert("section_type".to_string(), Value::String(section_type));
    }
    Ok(())
}

/// The tables a record backup carries, each with the rows of it that are the
/// athlete's, in the order a restore places them.
///
/// It is the declaration's `Record` set, the record part of each mixed table,
/// and the settings. `identity_state` is not here: its ids and tombstones name
/// this library's sections, and a restored library rebuilds its own registry
/// from what it places. A past catalogue state needs no table of its own, it is
/// an `archived` row of `section_history` grounded on the version it names.
/// No activity is carried, so an activity with no intervals.icu copy would not
/// survive a restore.
pub(crate) const RECORD_TABLES: &[(&str, &str)] = &[
    // Which settings travel is `is_record_setting`, applied to every row read.
    ("settings", "1 = 1"),
    ("route_names", "1 = 1"),
    (
        "sections",
        concat!(
            "section_type = 'custom' OR is_user_defined != 0 OR name IS NOT NULL OR ",
            crate::persistence::sections::has_original_line!()
        ),
    ),
    ("section_intents", "1 = 1"),
    ("section_history", "1 = 1"),
    ("section_pins", "1 = 1"),
    ("section_forced_matches", "1 = 1"),
    ("section_activities", "excluded != 0"),
    ("activity_matches", "excluded != 0"),
    // After the sections, so a restore has recreated a hand-cut before
    // its number looks for it. The numbers of retired sections and routes
    // travel too, so a restore keeps them off new ground. A number a restore holds for
    // ground this library lacks rides in the waiting records instead.
    ("section_numbers", "section_id NOT LIKE 'restored:%'"),
    ("route_numbers", "route_id NOT LIKE 'restored:%'"),
];

/// The internal settings a record backup carries: the athlete's choices that
/// happen to sit behind the `__` prefix. Every other `__` key is this
/// library's own state, so neither a backup writes it nor a restore places
/// it.
const RECORD_INTERNAL_SETTINGS: &[&str] = &[
    "__athlete_id",
    "__match_min_match_pct",
    "__match_endpoint_threshold",
    "__section_proximity_threshold",
    "__section_min_length",
    "__section_min_activities",
    "__section_config_json",
    "__detection_enabled",
    "__export_home_lat",
    "__export_home_lng",
    "__export_privacy_radius_m",
    "__stream_retention_days",
    "__auto_backup_enabled",
    super::settings_keys::GARMIN_CONNECTOR_ENABLED,
];

/// The export privacy home, which a record for shared storage leaves out.
/// The coordinates say where the athlete lives, and a shared folder is read
/// by other apps and by a computer the phone is connected to. The radius says
/// nothing on its own, so it travels.
pub(crate) const EXPORT_HOME: &[&str] = &[
    super::settings_keys::EXPORT_HOME_LAT,
    super::settings_keys::EXPORT_HOME_LNG,
];

/// What a record for shared storage leaves out.
const SHARED_STORAGE_LEFT_OUT: &[&str] = EXPORT_HOME;

/// The settings without the `__` prefix that belong to this library or
/// install rather than to the athlete, so neither a backup writes them nor a
/// restore places them. The upload grant is the scope of this install's OAuth
/// token, which only the server that granted it can state. The last clean
/// sync is a sync this library ran, and the oldest activity date and the
/// per-year counts are the server's answer, which the next sync writes again.
/// The terrain cleanup flag, the What's New record, the support prompt's state
/// and the usage record (days of use, a clean sync seen) are this install's own
/// bookkeeping.
const DEVICE_SETTINGS: &[&str] = &[
    "veloq-upload-permission",
    super::settings_keys::SYNC_LAST_SUCCESS_AT,
    super::settings_keys::HELD_BACK_IN_LAST_DOWNLOAD,
    crate::objects::sync::OLDEST_ACTIVITY_DATE_KEY,
    crate::objects::sync::ACTIVITY_YEAR_COUNTS_KEY,
    "veloq-terrain-override-cleanup-done",
    "veloq-whats-new-seen",
    "veloq-support-store",
    "veloq-usage",
    // The Garmin connector's choices belong to this device with its key.
    "veloq-garmin-key-expiry",
    "veloq-garmin-feed",
    "veloq-garmin-upload",
];

/// Whether a settings row under `key` belongs in a record backup. The writer
/// and the restore both ask this, so a file the writer never produced cannot
/// place a key the writer would have left out.
pub(crate) fn is_record_setting(key: &str) -> bool {
    // What the Garmin pull has fetched is the originals on this device.
    if DEVICE_SETTINGS.contains(&key) || crate::net::garmin::pull::SETTING_KEYS.contains(&key) {
        return false;
    }
    !key.starts_with("__")
        || key.starts_with(super::activities::ACTIVITY_WINDOW_KEY_PREFIX)
        || RECORD_INTERNAL_SETTINGS.contains(&key)
}

/// Whether a row read from a library belongs in its record backup, past the
/// table's own filter.
fn carried(row: &RecordRow) -> bool {
    row.table != "settings"
        || row
            .values
            .get("key")
            .and_then(Value::as_str)
            .is_some_and(is_record_setting)
}

/// The row a converted `.veloq` file holds for a name it keeps by old id only.
pub(crate) const LEGACY_SECTION_NAME: &str = "legacy_section_name";

/// The rows a converted `.veloq` file holds for a section it disabled or
/// superseded, kept by old id only. Auto section ids are positional, so one
/// names unrelated ground in another library and is never applied by id.
pub(crate) const LEGACY_SECTION_DISABLED: &str = "legacy_section_disabled";
pub(crate) const LEGACY_SECTION_SUPERSEDED: &str = "legacy_section_superseded";

/// Whether a row of `table` travels between libraries: a table a backup
/// carries, or a legacy row kept by old id. Anything else, such as another
/// build's registry, is this library's own and is neither placed nor kept.
pub(crate) fn travels(table: &str) -> bool {
    matches!(
        table,
        LEGACY_SECTION_NAME | LEGACY_SECTION_DISABLED | LEGACY_SECTION_SUPERSEDED
    ) || RECORD_TABLES.iter().any(|(name, _)| *name == table)
}

fn setting(db: &Connection, key: &str) -> Result<Option<String>, String> {
    db.query_row("SELECT value FROM settings WHERE key = ?1", [key], |row| {
        row.get(0)
    })
    .optional()
    .map_err(|e| e.to_string())
}

/// The upload id of every key minted here that the entries name, a recording
/// or an import. A key never uploaded has none and is left out.
fn upstream_ids(
    db: &Connection,
    entries: &[RecordRow],
) -> Result<BTreeMap<String, String>, String> {
    let mut keys = BTreeSet::new();
    for row in entries {
        let mut value = serde_json::to_value(row).map_err(|e| e.to_string())?;
        super::record_restore::for_each_activity_key(&mut value, &mut |key| {
            if super::origin::origin_of(key).minted_here() {
                keys.insert(key.clone());
            }
        });
    }
    let mut sources = Vec::new();
    for (table, key_column) in [("activities", "id"), ("activity_bodies", "activity_id")] {
        if table_exists(db, table)? && column_exists(db, table, "intervals_id")? {
            sources.push(format!(
                "SELECT intervals_id FROM {table} WHERE {key_column} = ?1 AND intervals_id IS NOT NULL"
            ));
        }
    }
    let mut upstream = BTreeMap::new();
    if sources.is_empty() {
        return Ok(upstream);
    }
    let sql = format!("{} LIMIT 1", sources.join(" UNION ALL "));
    let mut statement = db.prepare(&sql).map_err(|e| e.to_string())?;
    for key in keys {
        let id: Option<String> = statement
            .query_row([&key], |row| row.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some(id) = id {
            upstream.insert(key, id);
        }
    }
    Ok(upstream)
}

/// Read only the athlete's decisions from one consistent SQLite snapshot,
/// whole.
pub(crate) fn collect_record_payload(db: &Connection) -> Result<RecordPayload, String> {
    collect_record_payload_for(db, RecordScope::Whole)
}

/// Read the athlete's decisions for a record going to `scope`.
pub(crate) fn collect_record_payload_for(
    db: &Connection,
    scope: RecordScope,
) -> Result<RecordPayload, String> {
    let mut athlete_id = if table_exists(db, "settings")? {
        setting(db, "__athlete_id")?
    } else {
        None
    };
    let mut entries = Vec::new();
    for &(table, filter) in RECORD_TABLES {
        for mut row in rows(db, table, filter)?.into_iter().filter(carried) {
            row.ground = row_ground(db, &row)?;
            if table == "section_numbers" {
                carry_section_type(db, &mut row)?;
            }
            entries.push(row);
        }
    }
    // Rows still owed to this library ride along, so a backup taken while a
    // restore waits or an import is paused never drops what they carry.
    if table_exists(db, "settings")? {
        let mut owed: Vec<RecordRow> = Vec::new();
        if let Some(raw) = setting(db, super::record_restore::PENDING_KEY)? {
            owed.extend(
                serde_json::from_str::<Vec<RecordRow>>(&raw)
                    .map_err(|e| format!("Unreadable pending record: {e}"))?,
            );
        }
        if let Some(raw) = setting(db, super::record_restore::PAUSED_IMPORT_KEY)? {
            let paused: RecordPayload =
                serde_json::from_str(&raw).map_err(|e| format!("Unreadable paused import: {e}"))?;
            athlete_id = athlete_id.or(paused.athlete_id);
            owed.extend(paused.entries);
        }
        let mut seen: HashSet<String> = entries
            .iter()
            .map(serde_json::to_string)
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;
        for row in owed
            .into_iter()
            .filter(|row| travels(&row.table) && carried(row))
        {
            let key = serde_json::to_string(&row).map_err(|e| e.to_string())?;
            if seen.insert(key) {
                entries.push(row);
            }
        }
    }
    let left_out = leave_out(&mut entries, scope);
    let upstream_ids = upstream_ids(db, &entries)?;
    Ok(RecordPayload {
        version: RECORD_VERSION,
        athlete_id,
        entries,
        upstream_ids,
        written_at: Some(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
        left_out,
    })
}

/// Take out of `entries` the settings `scope` may not hold, answering their
/// keys when any was there. A library that never held them leaves nothing
/// out, so a restore from its file has nothing to ask the athlete to set.
fn leave_out(entries: &mut Vec<RecordRow>, scope: RecordScope) -> Vec<String> {
    let keys: &[&str] = match scope {
        RecordScope::Whole => return Vec::new(),
        RecordScope::SharedStorage => SHARED_STORAGE_LEFT_OUT,
    };
    let before = entries.len();
    entries.retain(|row| !names_setting(row, keys));
    if entries.len() == before {
        return Vec::new();
    }
    keys.iter().map(|key| (*key).to_string()).collect()
}

/// Whether `row` is a settings row under one of `keys`.
pub(crate) fn names_setting(row: &RecordRow, keys: &[&str]) -> bool {
    row.table == "settings" && string(&row.values, "key").is_some_and(|key| keys.contains(&key))
}

/// Write one deflated JSON entry beside `path`, ready to replace it.
fn stage_record_zip(
    payload: &RecordPayload,
    path: &str,
) -> Result<tempfile::NamedTempFile, String> {
    let mut temporary = record_temporary(Path::new(path))?;
    {
        let mut zip = zip::ZipWriter::new(temporary.as_file_mut());
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .compression_level(Some(6));
        zip.start_file("record.json", options)
            .map_err(|e| e.to_string())?;
        serde_json::to_writer(&mut zip, payload).map_err(|e| e.to_string())?;
        zip.finish().map_err(|e| e.to_string())?;
    }
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    Ok(temporary)
}

/// Write one deflated JSON entry, replacing the destination after completion.
pub(crate) fn write_record_zip(payload: &RecordPayload, path: &str) -> Result<(), String> {
    stage_record_zip(payload, path)?
        .persist(path)
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Whether the athlete stopped the run, as the error that ends it.
fn stop_if_cancelled(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::SeqCst) {
        return Err(super::export::JOB_CANCELLED.to_string());
    }
    Ok(())
}

/// Publish under the engine lock so a wipe either removes or refuses the zip.
/// A stop that lands while the lock is awaited drops the temporary unrenamed,
/// so the destination keeps whatever it held before.
fn write_record_zip_for(
    install: u64,
    payload: &RecordPayload,
    path: &str,
    cancel: &AtomicBool,
) -> Result<(), String> {
    let temporary = stage_record_zip(payload, path)?;
    super::with_persistent_engine_for(install, |_| {
        stop_if_cancelled(cancel)?;
        temporary
            .persist(path)
            .map(|_| ())
            .map_err(|e| e.to_string())
    })
    .unwrap_or_else(|| Err("The library changed while the backup was written".to_string()))
}

/// Read a record backup and reject versions this build cannot restore.
pub(crate) fn read_record_zip(path: &str) -> Result<RecordPayload, String> {
    let file = File::open(path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    if archive.len() != 1 {
        return Err("Record backup must contain one entry".to_string());
    }
    let entry = archive.by_name("record.json").map_err(|e| e.to_string())?;
    let too_large = || format!("Record backup is over the {RECORD_JSON_LIMIT} byte size limit");
    if entry.size() > RECORD_JSON_LIMIT {
        return Err(too_large());
    }
    // The declared size is the archive's own claim, so the read is bounded too.
    let mut json = Vec::new();
    entry
        .take(RECORD_JSON_LIMIT + 1)
        .read_to_end(&mut json)
        .map_err(|e| e.to_string())?;
    if json.len() as u64 > RECORD_JSON_LIMIT {
        return Err(too_large());
    }
    let payload: RecordPayload = serde_json::from_slice(&json).map_err(|e| e.to_string())?;
    check_record_version(payload.version)?;
    Ok(payload)
}

/// Refuse a record format this build cannot restore, whichever path the
/// payload arrived by.
pub(crate) fn check_record_version(version: u32) -> Result<(), String> {
    if version > RECORD_VERSION {
        return Err(format!(
            "Record backup version {version} is newer than supported version {RECORD_VERSION}"
        ));
    }
    if version != RECORD_VERSION {
        return Err(format!("Unsupported record backup version {version}"));
    }
    Ok(())
}

/// Export a live database without exposing its mirror tables, refusing the
/// final rename once `install` is no longer the open library.
fn write_record_from_database(
    install: u64,
    source_path: &str,
    dest_path: &str,
    scope: RecordScope,
    cancel: &AtomicBool,
) -> Result<(), String> {
    stop_if_cancelled(cancel)?;
    let payload = {
        // Taken before the connection opens so it drops after it closes: the
        // read is one snapshot, and the suspension waits for it to end.
        let _read = super::suspension::begin_read()
            .ok_or_else(|| "The backup was refused while the engine is suspended".to_string())?;
        let db = Connection::open_with_flags(source_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| e.to_string())?;
        db.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        db.execute_batch("BEGIN DEFERRED")
            .map_err(|e| e.to_string())?;
        let payload = collect_record_payload_for(&db, scope)?;
        db.execute_batch("COMMIT").map_err(|e| e.to_string())?;
        payload
    };
    stop_if_cancelled(cancel)?;
    write_record_zip_for(install, &payload, dest_path, cancel)
}

/// Migrate an older SQLite backup in a temporary copy, then export its record.
pub(crate) fn convert_legacy_database(source_path: &str, dest_path: &str) -> Result<(), String> {
    let directory = conversion_directory(Path::new(dest_path))?;
    let copy_path = directory.path().join("import.db");
    let source = Connection::open_with_flags(source_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    let mut copy = Connection::open(&copy_path).map_err(|e| e.to_string())?;
    let backup = rusqlite::backup::Backup::new(&source, &mut copy).map_err(|e| e.to_string())?;
    backup
        .run_to_completion(100, std::time::Duration::from_millis(10), None)
        .map_err(|e| e.to_string())?;
    drop(backup);
    drop(copy);
    let engine = PersistentEngine::new(copy_path.to_str().ok_or("Invalid temporary path")?)
        .map_err(|e| e.to_string())?;
    let payload = collect_record_payload(&engine.db)?;
    write_record_zip(&payload, dest_path)
}

impl PersistentEngine {
    /// Export the record on a worker thread, independent of the JS thread.
    ///
    /// `install` is the library the backup was asked of, and the zip is only
    /// put in place while it is still the one open.
    ///
    /// `scope` is where the zip is going, which decides what it leaves out.
    ///
    /// `cancel` is the run's own latch. Set, the worker stops at its next stage
    /// and the destination is left as it was.
    pub fn record_backup_background(
        &self,
        dest_path: &str,
        scope: RecordScope,
        install: u64,
        cancel: Arc<AtomicBool>,
    ) -> super::BackupHandle {
        let source_path = self.db_path.clone();
        let dest_path = dest_path.to_string();
        let (tx, rx) = std::sync::mpsc::channel();
        crate::threads::spawn_named("veloq-record", move || {
            let result =
                write_record_from_database(install, &source_path, &dest_path, scope, &cancel);
            let _ = tx.send(result);
        });
        super::BackupHandle { receiver: rx }
    }
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    /// Expected behaviour: the Garmin connector's choices stay on the device
    /// and no record backup carries or restores them.
    #[test]
    fn the_garmin_connector_settings_never_travel() {
        for key in [
            "veloq-garmin-key-expiry",
            "veloq-garmin-feed",
            "veloq-garmin-upload",
        ]
        .into_iter()
        .chain(crate::net::garmin::pull::SETTING_KEYS)
        {
            assert!(!super::is_record_setting(key), "{key} travelled");
        }
    }

    /// Scenario: the athlete connected a Garmin key, then backs up and restores
    /// onto a new phone, which holds no key.
    /// Expected behaviour: the record carries the flag that says a key was
    /// connected, so the connector can ask for it again, and no other Garmin
    /// value travels with it.
    #[test]
    fn a_connected_garmin_connector_travels_as_a_flag_and_nothing_else() {
        let from = crate::persistence::PersistentEngine::in_memory().unwrap();
        from.set_setting("__garmin_connector_enabled", "true")
            .unwrap();
        from.set_setting("veloq-garmin-key-expiry", "2027-10-25")
            .unwrap();
        from.set_setting("veloq-garmin-feed", "true").unwrap();
        from.set_setting("veloq-garmin-upload", "true").unwrap();

        let payload = collect_record_payload(&from.db).unwrap();
        let carried: Vec<String> = payload
            .entries
            .iter()
            .filter(|row| row.table == "settings")
            .filter_map(|row| row.values.get("key").and_then(serde_json::Value::as_str))
            .filter(|key| key.contains("garmin"))
            .map(str::to_string)
            .collect();
        assert_eq!(carried, vec!["__garmin_connector_enabled".to_string()]);

        let mut to = crate::persistence::PersistentEngine::in_memory().unwrap();
        to.restore_record_json(&serde_json::to_string(&payload).unwrap())
            .unwrap();
        assert_eq!(
            to.get_setting("__garmin_connector_enabled")
                .unwrap()
                .as_deref(),
            Some("true")
        );
    }

    use super::{
        RECORD_JSON_LIMIT, RECORD_TEMP_PREFIX, collect_record_payload, conversion_directory,
        convert_legacy_database, read_record_zip, record_temporary, write_record_zip,
    };

    #[test]
    fn test_rows_undecodable_line_logs_and_carries_json() {
        crate::test_log::capturing();
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE section_intents (id TEXT, polyline_blob BLOB, polyline_json TEXT);
             INSERT INTO section_intents VALUES ('garbled-line', x'ff', '[]');",
        )
        .unwrap();

        let records = super::rows(&db, "section_intents", "1 = 1").unwrap();
        assert_eq!(records[0].values["polyline_json"], "[]");
        assert_eq!(
            crate::test_log::errors_with("section_intents garbled-line").len(),
            1
        );
    }

    /// Whether `left` sits beside `destination` under the name the wipe deletes.
    fn left_where_the_wipe_reaches(left: &std::path::Path, destination: &std::path::Path) -> bool {
        left.parent() == destination.parent()
            && left
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with(RECORD_TEMP_PREFIX))
    }

    fn files_in(dir: &std::path::Path) -> Vec<String> {
        std::fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn test_record_backup_started_before_a_wipe_leaves_no_zip_behind() {
        let _guard = crate::test_globals::serial_global_state();
        let library = crate::test_globals::init_global_engine("record-source.db");
        let source = library.path().join("record-source.db");
        let install = crate::persistence::engine_install();
        let documents = tempfile::tempdir().unwrap();
        let destination = documents.path().join("veloq-decisions.zip");

        crate::persistence::invalidate_engine_install();
        let outcome = super::write_record_from_database(
            install,
            source.to_str().unwrap(),
            destination.to_str().unwrap(),
            super::RecordScope::Whole,
            &std::sync::atomic::AtomicBool::new(false),
        );

        assert!(outcome.is_err());
        assert!(
            files_in(documents.path()).is_empty(),
            "{:?}",
            files_in(documents.path())
        );
    }

    #[test]
    fn test_record_backup_on_the_open_library_writes_its_zip() {
        let _guard = crate::test_globals::serial_global_state();
        let library = crate::test_globals::init_global_engine("record-source.db");
        let source = library.path().join("record-source.db");
        let install = crate::persistence::engine_install();
        let documents = tempfile::tempdir().unwrap();
        let destination = documents.path().join("veloq-decisions.zip");

        super::write_record_from_database(
            install,
            source.to_str().unwrap(),
            destination.to_str().unwrap(),
            super::RecordScope::Whole,
            &std::sync::atomic::AtomicBool::new(false),
        )
        .unwrap();

        assert_eq!(
            files_in(documents.path()),
            vec!["veloq-decisions.zip".to_string()]
        );
        read_record_zip(destination.to_str().unwrap()).unwrap();
    }

    fn settings_in(path: &std::path::Path) -> std::collections::BTreeMap<String, String> {
        read_record_zip(path.to_str().unwrap())
            .unwrap()
            .entries
            .into_iter()
            .filter(|row| row.table == "settings")
            .filter_map(|row| {
                Some((
                    super::string(&row.values, "key")?.to_string(),
                    super::string(&row.values, "value")?.to_string(),
                ))
            })
            .collect()
    }

    /// Scenario: the athlete has set a home for export privacy, and the record
    /// is written once for storage only this app reads and once for a shared
    /// folder other apps and a connected computer can read.
    ///
    /// Expected behaviour: the shared copy holds no home coordinates and names
    /// them as left out, the other holds them, and both keep the radius.
    #[test]
    fn test_record_backup_for_shared_storage_leaves_the_export_home_out() {
        use crate::persistence::settings_keys::{
            EXPORT_HOME_LAT, EXPORT_HOME_LNG, EXPORT_PRIVACY_RADIUS_M,
        };
        let _guard = crate::test_globals::serial_global_state();
        let library = crate::test_globals::init_global_engine("record-home.db");
        let source = library.path().join("record-home.db");
        Connection::open(&source)
            .unwrap()
            .execute(
                "INSERT INTO settings (key, value) VALUES (?1, '46.2044'), (?2, '6.1432'), (?3, '250')",
                [EXPORT_HOME_LAT, EXPORT_HOME_LNG, EXPORT_PRIVACY_RADIUS_M],
            )
            .unwrap();
        let install = crate::persistence::engine_install();
        let documents = tempfile::tempdir().unwrap();
        let write = |name: &str, scope: super::RecordScope| {
            let destination = documents.path().join(name);
            super::write_record_from_database(
                install,
                source.to_str().unwrap(),
                destination.to_str().unwrap(),
                scope,
                &std::sync::atomic::AtomicBool::new(false),
            )
            .unwrap();
            destination
        };

        let whole = write("whole.zip", super::RecordScope::Whole);
        let shared = write("shared.zip", super::RecordScope::SharedStorage);

        let whole_settings = settings_in(&whole);
        assert_eq!(
            whole_settings.get(EXPORT_HOME_LAT).map(String::as_str),
            Some("46.2044")
        );
        assert_eq!(
            whole_settings.get(EXPORT_HOME_LNG).map(String::as_str),
            Some("6.1432")
        );
        assert!(
            read_record_zip(whole.to_str().unwrap())
                .unwrap()
                .left_out
                .is_empty()
        );

        let shared_settings = settings_in(&shared);
        assert!(!shared_settings.contains_key(EXPORT_HOME_LAT));
        assert!(!shared_settings.contains_key(EXPORT_HOME_LNG));
        assert_eq!(
            shared_settings
                .get(EXPORT_PRIVACY_RADIUS_M)
                .map(String::as_str),
            Some("250")
        );
        let raw = std::fs::read(&shared).unwrap();
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(raw)).unwrap();
        let mut json = String::new();
        std::io::Read::read_to_string(&mut archive.by_name("record.json").unwrap(), &mut json)
            .unwrap();
        assert!(
            !json.contains("46.2044") && !json.contains("6.1432"),
            "the shared copy names no home coordinate anywhere"
        );
        assert_eq!(
            read_record_zip(shared.to_str().unwrap()).unwrap().left_out,
            vec![EXPORT_HOME_LAT.to_string(), EXPORT_HOME_LNG.to_string()]
        );
    }

    /// Scenario: a library with no export privacy home is written for a
    /// shared folder.
    ///
    /// Expected behaviour: nothing was left out, so the file names nothing as
    /// left out and a restore from it asks the athlete to set nothing again.
    #[test]
    fn test_record_backup_for_shared_storage_without_a_home_leaves_nothing_out() {
        let payload =
            super::collect_record_payload_for(&fixture(), super::RecordScope::SharedStorage)
                .unwrap();
        assert!(payload.left_out.is_empty());
    }

    /// Scenario: the athlete stops a record backup while it waits to put its
    /// zip in place.
    /// Expected behaviour: it answers cancelled and leaves neither the zip nor
    /// its temporary behind.
    #[test]
    fn test_record_backup_cancelled_while_running_leaves_nothing_behind() {
        let _guard = crate::test_globals::serial_global_state();
        let library = crate::test_globals::init_global_engine("record-source.db");
        let source = library.path().join("record-source.db");
        let install = crate::persistence::engine_install();
        let documents = tempfile::tempdir().unwrap();
        let destination = documents.path().join("veloq-decisions.zip");
        let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));

        // The lock holds the worker short of its rename, so the stop lands on
        // a run that is certainly still going.
        let (holding, held) = std::sync::mpsc::channel();
        let (release, released) = std::sync::mpsc::channel::<()>();
        let writer = std::thread::spawn(move || {
            crate::persistence::with_persistent_engine(|_| {
                holding.send(()).ok();
                released.recv().ok();
            })
            .expect("engine");
        });
        held.recv().expect("the writer took the lock");
        let worker = {
            let cancel = std::sync::Arc::clone(&cancel);
            let source = source.to_str().unwrap().to_string();
            let destination = destination.to_str().unwrap().to_string();
            std::thread::spawn(move || {
                super::write_record_from_database(
                    install,
                    &source,
                    &destination,
                    super::RecordScope::Whole,
                    &cancel,
                )
            })
        };
        cancel.store(true, std::sync::atomic::Ordering::SeqCst);
        release.send(()).ok();
        writer.join().expect("writer thread");
        let outcome = worker.join().expect("record worker");

        assert_eq!(
            outcome.err().as_deref(),
            Some(crate::persistence::export::JOB_CANCELLED)
        );
        assert!(
            files_in(documents.path()).is_empty(),
            "{:?}",
            files_in(documents.path())
        );
    }

    #[test]
    fn test_record_zip_killed_before_rename_leaves_its_temporary_where_the_wipe_reaches() {
        let dir = tempfile::tempdir().unwrap();
        let destination = dir.path().join("veloq-decisions.zip");

        // A kill runs no destructor, so the file stays as `keep` leaves it.
        let (_, left) = record_temporary(&destination).unwrap().keep().unwrap();

        assert!(left.exists());
        assert!(left_where_the_wipe_reaches(&left, &destination), "{left:?}");
    }

    #[test]
    fn test_legacy_conversion_killed_part_way_leaves_its_copy_where_the_wipe_reaches() {
        let dir = tempfile::tempdir().unwrap();
        let restores = dir.path().join("restores");
        std::fs::create_dir(&restores).unwrap();
        let destination = restores.join("restore-legacy-1-1.zip");

        let left = conversion_directory(&destination).unwrap().keep();

        assert!(left.is_dir());
        assert!(left_where_the_wipe_reaches(&left, &destination), "{left:?}");
    }

    #[test]
    fn test_legacy_conversion_leaves_nothing_beside_its_record() {
        let dir = tempfile::tempdir().unwrap();
        let source_path = dir.path().join("released.db");
        let mut source = Connection::open(&source_path).unwrap();
        super::PersistentEngine::migrations()
            .to_version(&mut source, 12)
            .unwrap();
        drop(source);
        let restores = dir.path().join("restores");
        std::fs::create_dir(&restores).unwrap();
        let record_path = restores.join("restore-legacy-1-1.zip");

        convert_legacy_database(source_path.to_str().unwrap(), record_path.to_str().unwrap())
            .unwrap();

        let names: Vec<_> = std::fs::read_dir(&restores)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(
            names,
            vec![std::ffi::OsString::from("restore-legacy-1-1.zip")]
        );
    }

    #[test]
    fn test_schema_12_import_converts_decisions_without_touching_source() {
        let dir = tempfile::tempdir().unwrap();
        let source_path = dir.path().join("released.db");
        let record_path = dir.path().join("record.zip");
        let mut source = Connection::open(&source_path).unwrap();
        super::PersistentEngine::migrations()
            .to_version(&mut source, 12)
            .unwrap();
        source.execute_batch(
            "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng)
             VALUES ('ride-1', 'Ride', 1, 1, 1, 1);
             INSERT INTO sections (id, section_type, name, sport_type, polyline_json, distance_meters,
                 source_activity_id, start_index, end_index)
             VALUES ('old-section', 'custom', 'Hill', 'Ride', '[]', 100, 'ride-1', 2, 8);
             INSERT INTO section_activities (section_id, activity_id, start_index, end_index, excluded)
             VALUES ('old-section', 'ride-1', 2, 8, 1);
             INSERT INTO route_groups (id, representative_id, activity_ids, sport_type)
             VALUES ('old-route', 'ride-1', '[\"ride-1\"]', 'Ride');
             INSERT INTO route_names (route_id, custom_name) VALUES ('old-route', 'Loop');",
        )
        .unwrap();
        drop(source);

        convert_legacy_database(source_path.to_str().unwrap(), record_path.to_str().unwrap())
            .unwrap();
        let record = read_record_zip(record_path.to_str().unwrap()).unwrap();
        assert!(record.entries.iter().any(|entry| entry.table == "sections"
            && entry.values.get("name").and_then(serde_json::Value::as_str) == Some("Hill")));
        assert!(record.entries.iter().any(|entry| {
            entry.table == "section_activities"
                && entry
                    .values
                    .get("excluded")
                    .and_then(serde_json::Value::as_i64)
                    == Some(1)
        }));
        assert!(record.entries.iter().any(|entry| {
            entry.table == "route_names"
                && entry
                    .ground
                    .as_ref()
                    .and_then(|ground| ground.rep_activity_id.as_deref())
                    == Some("ride-1")
        }));
        let source = Connection::open(source_path).unwrap();
        let activities: i64 = source
            .query_row("SELECT COUNT(*) FROM activities", [], |row| row.get(0))
            .unwrap();
        assert_eq!(activities, 1);
        let version: i64 = source
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, 12);
    }

    fn fixture() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE settings (key TEXT, value TEXT, updated_at TEXT);
             CREATE TABLE section_history (id INTEGER, section_id TEXT, at TEXT, kind TEXT, details TEXT, geometry_version INTEGER);
             CREATE TABLE section_geometry (section_id TEXT, version INTEGER, rep_activity_id TEXT, rep_start_index INTEGER, rep_end_index INTEGER, point_count INTEGER, blob BLOB);
             CREATE TABLE section_pins (section_id TEXT, version INTEGER, created_at TEXT);
             CREATE TABLE identity_state (key TEXT, blob BLOB);
             INSERT INTO settings VALUES ('__athlete_id', 'athlete-1', '1');
             INSERT INTO settings VALUES ('units', 'metric', '1');
             INSERT INTO settings VALUES ('__record_restore_pending', '[]', '1');
             INSERT INTO settings VALUES ('__detector_cutover', 'local-only', '1');
             INSERT INTO settings VALUES ('__section_config_json', '{}', '1');
             INSERT INTO settings VALUES ('__auto_backup_enabled', '1', '1');
             INSERT INTO section_history VALUES (1, 'old-section', '2026-01-01', 'formed', '{\"activity_ids\":[\"ride-1\"]}', 7);
             INSERT INTO section_history VALUES (2, 'old-section', '2026-01-02', 'archived', '{\"source\":\"catalogue\"}', 7);
             INSERT INTO section_geometry VALUES ('old-section', 7, 'ride-1', 10, 40, 100, X'');
             INSERT INTO section_pins VALUES ('old-section', 7, '2026-01-02');
             INSERT INTO identity_state VALUES ('registry', X'010203');",
        )
        .unwrap();
        db
    }

    #[test]
    fn test_record_backup_carries_full_ledger_and_pin_reference_without_local_registry() {
        let db = fixture();
        let payload = collect_record_payload(&db).unwrap();
        assert_eq!(payload.version, 1);
        assert_eq!(payload.athlete_id.as_deref(), Some("athlete-1"));
        assert_eq!(
            payload
                .entries
                .iter()
                .filter(|r| r.table == "section_history")
                .count(),
            2
        );
        let pin = payload
            .entries
            .iter()
            .find(|r| r.table == "section_pins")
            .unwrap();
        let ground = pin.ground.as_ref().unwrap();
        assert_eq!(ground.rep_activity_id.as_deref(), Some("ride-1"));
        assert_eq!(ground.rep_start_index, Some(10));
        assert_eq!(ground.rep_end_index, Some(40));
        assert_eq!(ground.point_count, Some(100));
        assert!(!payload.entries.iter().any(|r| r.table == "identity_state"));
        assert!(
            !payload
                .entries
                .iter()
                .any(|r| r.values.get("key").and_then(|v| v.as_str())
                    == Some("__record_restore_pending"))
        );
        assert!(!payload.entries.iter().any(|r| r.values.get("key").and_then(|v| v.as_str()) == Some("__detector_cutover")));
        assert!(
            payload
                .entries
                .iter()
                .any(|r| r.values.get("key").and_then(|v| v.as_str())
                    == Some("__section_config_json"))
        );
    }

    /// Scenario: a trimmed section's original line and a section intent's
    /// footprint are stored as quantised blobs, which a row read skips.
    ///
    /// Expected behaviour: the record carries both as the JSON it has always
    /// carried, a legacy JSON row reads the same, and a restore stores them
    /// back as blobs.
    #[test]
    fn test_record_backup_carries_blob_lines_as_json_and_restores_them_as_blobs() {
        use crate::persistence::codec;
        use tracematch::GpsPoint;

        let line: Vec<GpsPoint> = (0..12)
            .map(|i| GpsPoint::new(46.0 + f64::from(i) * 0.0005, 7.0))
            .collect();
        let quantised = codec::deserialize_points(&codec::serialize_track_points(&line)).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let source =
            crate::persistence::PersistentEngine::new(dir.path().join("a.db").to_str().unwrap())
                .unwrap();
        source
            .db
            .execute(
                "INSERT INTO sections (id, section_type, sport_type, polyline_blob,
                                       distance_meters, is_user_defined, original_polyline_blob)
                 VALUES ('trimmed', 'auto', 'Ride', ?1, 500.0, 1, ?2)",
                rusqlite::params![
                    codec::serialize_track_points(&line[2..10]),
                    codec::serialize_track_points(&line)
                ],
            )
            .unwrap();
        source
            .db
            .execute(
                "INSERT INTO section_intents (id, kind, polyline_blob, name, sport_type)
                 VALUES ('hidden', 'disabled', ?1, NULL, NULL)",
                [codec::serialize_track_points(&line)],
            )
            .unwrap();
        source
            .db
            .execute(
                "INSERT INTO section_intents (id, kind, polyline_json, name, sport_type)
                 VALUES ('legacy', 'disabled', ?1, NULL, NULL)",
                [serde_json::to_string(&line).unwrap()],
            )
            .unwrap();

        let payload = collect_record_payload(&source.db).unwrap();
        let carried = |table: &str, id: &str, key: &str| -> Vec<GpsPoint> {
            let row = payload
                .entries
                .iter()
                .find(|r| {
                    r.table == table && r.values.get("id").and_then(|v| v.as_str()) == Some(id)
                })
                .unwrap_or_else(|| panic!("{table} {id} is in the record"));
            let json = row.values.get(key).and_then(|v| v.as_str()).expect(key);
            serde_json::from_str(json).unwrap()
        };
        assert_eq!(
            carried("sections", "trimmed", "original_polyline_json"),
            quantised
        );
        assert_eq!(
            carried("section_intents", "hidden", "polyline_json"),
            quantised
        );
        assert_eq!(carried("section_intents", "legacy", "polyline_json"), line);

        let mut target =
            crate::persistence::PersistentEngine::new(dir.path().join("b.db").to_str().unwrap())
                .unwrap();
        target
            .restore_record_json(&serde_json::to_string(&payload).unwrap())
            .unwrap();
        let (blob, json): (Vec<u8>, Option<String>) = target
            .db
            .query_row(
                "SELECT polyline_blob, polyline_json FROM section_intents WHERE id = 'ri_hidden'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(codec::deserialize_points(&blob).unwrap(), quantised);
        assert_eq!(json, None);
    }

    #[test]
    fn test_record_backup_carries_the_automatic_backup_switch() {
        let payload = collect_record_payload(&fixture()).unwrap();
        assert!(payload.entries.iter().any(|r| {
            r.values.get("key").and_then(|v| v.as_str()) == Some("__auto_backup_enabled")
                && r.values.get("value").and_then(|v| v.as_str()) == Some("1")
        }));
    }

    /// One row in `table` with a placeholder in every column that must have
    /// a value, and the athlete's exclusion set where the table has one, so
    /// the writer's own filter is all that decides whether it travels.
    fn placeholder_row(db: &Connection, table: &str) -> rusqlite::Result<usize> {
        let columns: Vec<(String, String)> = db
            .prepare(&format!(
                "SELECT name, type FROM pragma_table_info('{table}')
                 WHERE (\"notnull\" = 1 AND dflt_value IS NULL) OR (pk > 0 AND type = 'TEXT')
                    OR name = 'excluded'"
            ))
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        let names: Vec<&str> = columns.iter().map(|(name, _)| name.as_str()).collect();
        let values: Vec<String> = columns
            .iter()
            .map(|(name, kind)| match (name.as_str(), kind.as_str()) {
                ("kind", _) => "'named'".to_string(),
                ("section_type", _) => "'custom'".to_string(),
                ("activity_ids", _) => "'[\"ride-1\"]'".to_string(),
                (_, "INTEGER") => "1".to_string(),
                (_, "REAL") => "1.0".to_string(),
                (_, "BLOB") => "X'00'".to_string(),
                _ => "'placeholder'".to_string(),
            })
            .collect();
        db.execute(
            &format!(
                "INSERT INTO {table} ({}) VALUES ({})",
                names.join(", "),
                values.join(", ")
            ),
            [],
        )
    }

    #[test]
    fn test_record_backup_carries_every_table_declared_record_and_nothing_library_local() {
        use crate::persistence::tables::{TableClass, class_of, declared_tables, tables_of};

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("manifest.db");
        drop(super::PersistentEngine::new(path.to_str().unwrap()).unwrap());
        let db = Connection::open(&path).unwrap();
        db.execute_batch("PRAGMA foreign_keys = OFF").unwrap();
        let mixed: Vec<&str> = declared_tables()
            .iter()
            .filter(|t| t.record_part.is_some())
            .map(|t| t.name)
            .collect();
        let held: Vec<&str> = declared_tables()
            .iter()
            .filter(|t| t.class != TableClass::Meta && t.class != TableClass::Device)
            .map(|t| t.name)
            .collect();
        // A table the declaration calls record has to take its row. Any other
        // takes one where its own constraints allow, so a writer that read it
        // would be seen carrying it.
        for table in &held {
            let record = class_of(table) == Some(TableClass::Record) || mixed.contains(table);
            if let Err(e) = placeholder_row(&db, table)
                && record
            {
                panic!("placeholder row in {table}: {e}");
            }
        }

        let payload = collect_record_payload(&db).unwrap();
        let carried: std::collections::BTreeSet<&str> = payload
            .entries
            .iter()
            .map(|row| row.table.as_str())
            .filter(|table| *table != "settings")
            .collect();
        let declared: std::collections::BTreeSet<&str> =
            tables_of(TableClass::Record).chain(mixed).collect();

        assert_eq!(
            carried, declared,
            "the tables a backup carries are the ones the declaration calls record"
        );
        assert!(!carried.contains("identity_state"));
    }

    #[test]
    fn test_record_backup_omits_the_section_health_check_stamp() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("stamp.db");
        drop(super::PersistentEngine::new(path.to_str().unwrap()).unwrap());
        let db = Connection::open(&path).unwrap();
        db.execute(
            "INSERT INTO settings (key, value) VALUES (?1, '1'), ('unit_system', 'metric')",
            [crate::persistence::settings_keys::SECTION_HEALTH_CHECK_DONE],
        )
        .unwrap();

        let payload = collect_record_payload(&db).unwrap();
        let keys: Vec<String> = payload
            .entries
            .iter()
            .filter(|row| row.table == "settings")
            .filter_map(|row| super::string(&row.values, "key").map(str::to_string))
            .collect();

        assert!(keys.contains(&"unit_system".to_string()));
        assert!(
            !keys.contains(
                &crate::persistence::settings_keys::SECTION_HEALTH_CHECK_DONE.to_string()
            ),
            "a restored library must start with the health check unspent: {keys:?}"
        );
    }

    /// Scenario: a library has synced and shown its prompts, and holds an
    /// athlete's preference beside that state.
    ///
    /// Expected behaviour: the preference travels, and the sync's own record
    /// of this library, the server's counts and this install's prompt state
    /// stay behind, so an import never states a sync the library did not run.
    #[test]
    fn test_record_backup_leaves_this_library_sync_and_prompt_state_behind() {
        use crate::objects::sync::{ACTIVITY_YEAR_COUNTS_KEY, OLDEST_ACTIVITY_DATE_KEY};
        use crate::persistence::settings_keys::SYNC_LAST_SUCCESS_AT;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("synced.db");
        drop(super::PersistentEngine::new(path.to_str().unwrap()).unwrap());
        let db = Connection::open(&path).unwrap();
        let local = [
            SYNC_LAST_SUCCESS_AT,
            OLDEST_ACTIVITY_DATE_KEY,
            ACTIVITY_YEAR_COUNTS_KEY,
            "veloq-terrain-override-cleanup-done",
            "veloq-whats-new-seen",
            "veloq-support-store",
            "veloq-usage",
        ];
        for key in local.iter().chain(&["veloq-resolved-unit-system"]) {
            db.execute(
                "INSERT INTO settings (key, value) VALUES (?1, 'stored')",
                [key],
            )
            .unwrap();
        }

        let payload = collect_record_payload(&db).unwrap();
        let keys: Vec<String> = payload
            .entries
            .iter()
            .filter(|row| row.table == "settings")
            .filter_map(|row| super::string(&row.values, "key").map(str::to_string))
            .collect();

        assert!(keys.contains(&"veloq-resolved-unit-system".to_string()));
        for key in local {
            assert!(
                !keys.contains(&key.to_string()),
                "{key} travelled: {keys:?}"
            );
        }
    }

    #[test]
    fn test_record_backup_carries_forced_matches_grounded_on_their_section() {
        let db = fixture();
        db.execute_batch(
            "CREATE TABLE section_forced_matches (section_id TEXT, activity_id TEXT, forced_at INTEGER);
             INSERT INTO section_forced_matches VALUES ('old-section', 'attached-ride', 1700000000);",
        )
        .unwrap();
        let payload = collect_record_payload(&db).unwrap();
        let forced = payload
            .entries
            .iter()
            .find(|r| r.table == "section_forced_matches")
            .expect("the force-match record is in the backup");
        assert_eq!(
            forced.values.get("activity_id").and_then(|v| v.as_str()),
            Some("attached-ride")
        );
        assert_eq!(
            forced.values.get("forced_at").and_then(|v| v.as_i64()),
            Some(1_700_000_000)
        );
        let ground = forced
            .ground
            .as_ref()
            .expect("a ground to re-key the section");
        assert_eq!(ground.rep_activity_id.as_deref(), Some("ride-1"));
        assert_eq!(ground.rep_start_index, Some(10));
        assert_eq!(ground.rep_end_index, Some(40));
    }

    #[test]
    fn test_record_zip_is_deflated_and_replaces_only_after_complete_write() {
        let db = fixture();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("record.zip");
        std::fs::write(&path, b"prior").unwrap();
        let payload = collect_record_payload(&db).unwrap();
        write_record_zip(&payload, path.to_str().unwrap()).unwrap();
        let read = read_record_zip(path.to_str().unwrap()).unwrap();
        assert_eq!(read.entries.len(), payload.entries.len());
        let file = std::fs::File::open(&path).unwrap();
        let mut zip = zip::ZipArchive::new(file).unwrap();
        assert_eq!(zip.len(), 1);
        let entry = zip.by_name("record.json").unwrap();
        assert_eq!(entry.compression(), zip::CompressionMethod::Deflated);
    }

    /// Scenario: a record zip comes back through the platform's restore, which
    /// rewrites the file's modification time to a date in January 1970.
    ///
    /// Expected behaviour: the zip still says when it was written, from its
    /// own content, and a zip written before it carried that reads as unknown.
    #[test]
    fn test_record_zip_carries_the_time_it_was_written_past_a_lost_file_time() {
        let db = fixture();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("record.zip");
        let before = chrono::Utc::now();
        let payload = collect_record_payload(&db).unwrap();
        write_record_zip(&payload, path.to_str().unwrap()).unwrap();
        let after = chrono::Utc::now();
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_790_856))
            .unwrap();

        let read = read_record_zip(path.to_str().unwrap()).unwrap();
        let written_at = read.written_at.expect("the zip names no time of writing");
        let written_at = chrono::DateTime::parse_from_rfc3339(&written_at)
            .unwrap()
            .with_timezone(&chrono::Utc);
        let second = chrono::Duration::seconds(1);
        assert!(
            written_at >= before - second && written_at <= after + second,
            "written at {written_at}, between {before} and {after}"
        );

        let older: super::RecordPayload =
            serde_json::from_str(r#"{"version":1,"athlete_id":"athlete-1","entries":[]}"#).unwrap();
        assert_eq!(older.written_at, None);
    }

    /// Write a record zip whose one entry inflates to `len` spaces.
    fn spaces_zip(path: &std::path::Path, len: u64) {
        use std::io::Write;
        let file = std::fs::File::create(path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("record.json", options).unwrap();
        let chunk = vec![b' '; 1 << 20];
        let mut left = len;
        while left > 0 {
            let n = left.min(chunk.len() as u64) as usize;
            zip.write_all(&chunk[..n]).unwrap();
            left -= n as u64;
        }
        zip.finish().unwrap();
    }

    /// Overwrite the declared uncompressed size in the local and central headers.
    fn declare_size(path: &std::path::Path, size: u32) {
        let mut bytes = std::fs::read(path).unwrap();
        let find = |bytes: &[u8], signature: [u8; 4]| {
            bytes.windows(4).rposition(|w| w == signature).unwrap()
        };
        let local = find(&bytes, [0x50, 0x4b, 0x03, 0x04]);
        bytes[local + 22..local + 26].copy_from_slice(&size.to_le_bytes());
        let central = find(&bytes, [0x50, 0x4b, 0x01, 0x02]);
        bytes[central + 24..central + 28].copy_from_slice(&size.to_le_bytes());
        std::fs::write(path, bytes).unwrap();
    }

    #[test]
    fn test_record_zip_inflating_past_the_limit_is_refused_by_its_declared_size() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("record.zip");
        spaces_zip(&path, RECORD_JSON_LIMIT + 1);
        assert!(std::fs::metadata(&path).unwrap().len() < RECORD_JSON_LIMIT / 100);
        let err = read_record_zip(path.to_str().unwrap()).err().unwrap();
        assert!(err.contains("size limit"), "{err}");
    }

    #[test]
    fn test_record_zip_understating_its_size_is_refused_once_reading_passes_its_declared_size() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("record.zip");
        spaces_zip(&path, RECORD_JSON_LIMIT + 1);
        declare_size(&path, 16);
        let file = std::fs::File::open(&path).unwrap();
        let mut zip = zip::ZipArchive::new(file).unwrap();
        assert_eq!(zip.by_name("record.json").unwrap().size(), 16);
        let err = read_record_zip(path.to_str().unwrap()).err().unwrap();
        assert!(err.contains("declared uncompressed size"), "{err}");
    }

    /// Scenario: a record zip's one entry is a symbolic link named
    /// `record.json` whose target is a valid record outside the archive.
    ///
    /// Expected behaviour: the restore reads the entry's own bytes, never the
    /// file the link points at, refuses it, and leaves the target directory
    /// as it was.
    #[test]
    fn test_record_zip_whose_entry_is_a_symlink_out_of_the_archive_is_refused() {
        let db = fixture();
        let dir = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let target = outside.path().join("record.json");
        let payload = collect_record_payload(&db).unwrap();
        let valid = serde_json::to_vec(&payload).unwrap();
        std::fs::write(&target, &valid).unwrap();

        let path = dir.path().join("record.zip");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        zip.add_symlink(
            "record.json",
            target.to_str().unwrap(),
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
        zip.finish().unwrap();

        assert!(read_record_zip(path.to_str().unwrap()).is_err());
        let left: Vec<_> = std::fs::read_dir(outside.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(left, vec![std::ffi::OsString::from("record.json")]);
        assert_eq!(std::fs::read(&target).unwrap(), valid);
        let beside: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(beside, vec![std::ffi::OsString::from("record.zip")]);
    }

    #[test]
    fn test_record_zip_at_exactly_the_limit_is_read_past_the_size_check() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("record.zip");
        spaces_zip(&path, RECORD_JSON_LIMIT);
        let err = read_record_zip(path.to_str().unwrap()).err().unwrap();
        assert!(!err.contains("size limit"), "{err}");
    }

    #[test]
    fn test_record_backup_carries_dormant_rows_after_partial_restore() {
        let db = fixture();
        let dormant = serde_json::json!([{
            "table": "section_pins",
            "values": {"section_id": "dormant-section", "version": 2},
            "ground": {
                "rep_activity_id": "old-ride",
                "rep_start_index": 5,
                "rep_end_index": 20,
                "point_count": 90,
                "polyline_json": null
            }
        }]);
        db.execute(
            "UPDATE settings SET value = ?1 WHERE key = '__record_restore_pending'",
            [dormant.to_string()],
        )
        .unwrap();
        let payload = collect_record_payload(&db).unwrap();
        let pending = payload
            .entries
            .iter()
            .find(|row| {
                row.values
                    .get("section_id")
                    .and_then(|value| value.as_str())
                    == Some("dormant-section")
            })
            .expect("dormant pin must survive another backup");
        assert_eq!(
            pending.ground.as_ref().unwrap().rep_activity_id.as_deref(),
            Some("old-ride")
        );
        assert!(
            !payload.entries.iter().any(|row| row
                .values
                .get("key")
                .and_then(|value| value.as_str())
                == Some("__record_restore_pending"))
        );
    }

    /// The library's pin row as a backup reads it, so a paused import can name
    /// the same row and the merge can be seen to keep it once.
    fn library_pin(db: &Connection) -> serde_json::Value {
        let payload = collect_record_payload(db).unwrap();
        let pin = payload
            .entries
            .iter()
            .find(|row| row.table == "section_pins")
            .unwrap();
        serde_json::to_value(pin).unwrap()
    }

    fn pause_import(db: &Connection, athlete_id: Option<&str>, entries: serde_json::Value) {
        let paused = serde_json::json!({
            "version": 1,
            "athlete_id": athlete_id,
            "entries": entries,
        });
        db.execute(
            "INSERT INTO settings VALUES ('__record_import_paused', ?1, '1')",
            [paused.to_string()],
        )
        .unwrap();
    }

    fn rows_naming<'a>(
        payload: &'a super::RecordPayload,
        table: &str,
        id: &str,
    ) -> Vec<&'a super::RecordRow> {
        payload
            .entries
            .iter()
            .filter(|row| {
                row.table == table
                    && ["id", "section_id"]
                        .iter()
                        .any(|key| row.values.get(*key).and_then(|v| v.as_str()) == Some(id))
            })
            .collect()
    }

    #[test]
    fn test_record_backup_carries_a_paused_import_with_nothing_placed() {
        let db = fixture();
        let pin = library_pin(&db);
        pause_import(
            &db,
            Some("athlete-1"),
            serde_json::json!([
                {
                    "table": "sections",
                    "values": {"id": "hand-cut-climb", "section_type": "custom", "name": "Quarry climb"},
                    "ground": null
                },
                {
                    "table": "section_intents",
                    "values": {"id": "intent-climb", "section_id": "hand-cut-climb"},
                    "ground": null
                },
                {
                    "table": "identity_state",
                    "values": {"key": "registry"},
                    "ground": null
                },
                pin,
            ]),
        );

        let payload = collect_record_payload(&db).unwrap();

        assert_eq!(rows_naming(&payload, "sections", "hand-cut-climb").len(), 1);
        assert_eq!(
            rows_naming(&payload, "section_intents", "intent-climb").len(),
            1
        );
        assert_eq!(
            rows_naming(&payload, "section_pins", "old-section").len(),
            1
        );
        assert!(
            !payload
                .entries
                .iter()
                .any(|row| row.table == "identity_state")
        );
        assert!(!payload.entries.iter().any(|row| {
            row.values.get("key").and_then(|value| value.as_str()) == Some("__record_import_paused")
        }));
        assert_eq!(payload.athlete_id.as_deref(), Some("athlete-1"));
    }

    #[test]
    fn test_record_backup_takes_the_paused_import_athlete_when_the_library_has_none() {
        let db = fixture();
        db.execute("DELETE FROM settings WHERE key = '__athlete_id'", [])
            .unwrap();
        pause_import(&db, Some("athlete-7"), serde_json::json!([]));

        let payload = collect_record_payload(&db).unwrap();

        assert_eq!(payload.athlete_id.as_deref(), Some("athlete-7"));
    }

    #[test]
    fn test_record_backup_rejects_an_unreadable_paused_import() {
        let db = fixture();
        db.execute(
            "INSERT INTO settings VALUES ('__record_import_paused', 'broken', '1')",
            [],
        )
        .unwrap();
        assert!(
            collect_record_payload(&db)
                .unwrap_err()
                .contains("Unreadable paused import")
        );
    }

    #[test]
    fn test_record_backup_rejects_unreadable_dormant_rows() {
        let db = fixture();
        db.execute(
            "UPDATE settings SET value = ?1 WHERE key = '__record_restore_pending'",
            ["broken"],
        )
        .unwrap();
        assert!(
            collect_record_payload(&db)
                .unwrap_err()
                .contains("Unreadable pending record")
        );
    }
}
