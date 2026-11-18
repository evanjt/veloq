//! The plain library export: the athlete's record, the library's own tables
//! and every ride's packed bytes, in one zip that opens with any unzip tool.
//!
//! ```text
//! library.json              format, schema version, options, rides: [{key, source, start, kinds}]
//! record.json               the record payload, as a record backup writes it
//! tables/<name>.jsonl       a library-wide mirror table, one JSON row a line
//! tables/<name>.bin         the blob columns of that table, each row naming its offset and length
//! rides/<key>/streams.bin   the ride's decoded rows, as `seal::ride_bytes` packs them
//! rides/<key>/tables/<name>.jsonl  a ride-keyed mirror table the rows do not carry (swim lengths, pool length, strength sets, cached stream pulls), the rows of that ride, with a `.bin` beside it for blob columns
//! rides/<key>/original.fit  the ride's kept file, when one is held and asked for
//! ```
//!
//! Which table goes where is read from `tables.rs`, never listed here: record
//! tables and the record part of mixed tables travel in `record.json`, a
//! mirror table with no `activity_id` gets a table file, and a mirror table
//! keyed by a ride travels in that ride's rows, or under that ride as a table
//! file when `PACKED_RIDE_TABLES` does not name it. Every derived, identity, meta
//! and device table is left out, so the private key and the pinned devices of
//! the link are never in the file.
//!
//! A ride's rows entry is already deflated, so it is stored as it is. A kept
//! original is held as a deflate stream, and its entry is that stream copied
//! across: nothing is compressed twice.

use std::io::Cursor;

use rusqlite::types::ValueRef;
use rusqlite::{Connection, OptionalExtension};
use serde_json::{Map, Value, json};

use super::export::{BulkExportProgress, held_read};
use super::originals::{StoredOriginal, stored_original_of};
use super::record_backup::collect_record_payload;
use super::schema::SUPPORTED_SCHEMA_VERSION;
use super::seal::ride_bytes::{PACKED_RIDE_TABLES, exported_rows};
use super::tables::{TableClass, declared_tables};

/// The version of the archive layout this build writes.
pub const LIBRARY_EXPORT_FORMAT: u32 = 1;

const ROWS_ENTRY: &str = "streams.bin";
const ORIGINAL_ENTRY: &str = "original.fit";

/// What the export carries.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct LibraryExportOptions {
    /// Keep the rides that start at this Unix time, in seconds, or later. The record and
    /// the library tables are written whole whatever this says.
    pub since: Option<f64>,
    /// Write each ride's kept original file as well as its rows.
    pub originals: bool,
}

/// What a finished export wrote.
#[derive(Debug, Clone, serde::Serialize, uniffi::Record)]
#[uniffi(name = "FfiLibraryExportResult")]
#[serde(rename_all = "camelCase")]
pub struct LibraryExportResult {
    pub rides: u32,
    /// Rides whose original file is in the archive.
    pub originals: u32,
    /// Library tables written as table files.
    pub tables: u32,
    pub total_bytes: f64,
}

struct RideListing {
    key: String,
    source: String,
    start: i64,
    original: bool,
    /// The ride-keyed tables that hold a row for this ride.
    tables: Vec<&'static str>,
}

impl RideListing {
    fn kinds(&self) -> Vec<String> {
        let mut kinds = vec![ROWS_ENTRY.to_string()];
        if self.original {
            kinds.insert(0, ORIGINAL_ENTRY.to_string());
        }
        kinds.extend(self.tables.iter().map(|t| format!("tables/{t}.jsonl")));
        kinds
    }
}

fn sql(e: rusqlite::Error) -> String {
    e.to_string()
}

fn io(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn stop_if_cancelled(progress: &BulkExportProgress) -> Result<(), String> {
    progress.stop_reason().map_or(Ok(()), Err)
}

/// Every ride the library holds a body for, oldest first, and whether an
/// original is kept whole for it. Rides go through `activity_bodies`, which
/// holds every ride, not `activities`, which holds only those with a track.
fn list_rides(
    conn: &Connection,
    options: LibraryExportOptions,
) -> Result<Vec<RideListing>, String> {
    let ride_tables = ride_tables(conn)?;
    let mut statement = conn
        .prepare(
            "SELECT b.activity_id, b.date, b.intervals_id, o.source
             FROM activity_bodies b
             LEFT JOIN ride_originals o ON o.activity_id = b.activity_id
             WHERE (?1 IS NULL OR b.date >= ?1)
             ORDER BY b.date, b.activity_id",
        )
        .map_err(sql)?;
    let rows = statement
        .query_map([options.since], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .map_err(sql)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(sql)?;
    let mut rides = Vec::with_capacity(rows.len());
    for (key, start, intervals_id, kept_from) in rows {
        // An original that no longer matches its digest is not listed, so the
        // index says what the archive holds.
        let original = options.originals
            && kept_from.is_some()
            && stored_original_of(conn, &key).map_err(sql)?.is_some();
        let source = kept_from.unwrap_or_else(|| {
            if intervals_id.is_some() {
                "intervals.icu".to_string()
            } else {
                "unknown".to_string()
            }
        });
        let mut tables = Vec::new();
        for table in &ride_tables {
            if ride_has_rows(conn, table, &key)? {
                tables.push(*table);
            }
        }
        rides.push(RideListing {
            key,
            source,
            start,
            original,
            tables,
        });
    }
    Ok(rides)
}

fn has_column(conn: &Connection, table: &str, column: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2",
        [table, column],
        |r| r.get::<_, i64>(0),
    )
    .map(|n| n > 0)
    .map_err(sql)
}

fn table_exists(conn: &Connection, table: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table],
        |_| Ok(()),
    )
    .optional()
    .map(|found| found.is_some())
    .map_err(sql)
}

/// The mirror tables that are written as table files: the ones the
/// declaration calls mirror and no ride owns. A ride owns the rows of a table
/// that names it in `activity_id`, and `activities` itself, whose key is `id`.
fn library_tables(conn: &Connection) -> Result<Vec<&'static str>, String> {
    let mut names = Vec::new();
    for table in declared_tables() {
        if table.class != TableClass::Mirror || table.name == "activities" {
            continue;
        }
        if table_exists(conn, table.name)? && !has_column(conn, table.name, "activity_id")? {
            names.push(table.name);
        }
    }
    names.sort_unstable();
    Ok(names)
}

/// The mirror tables keyed by a ride whose rows the ride's packed bytes do not
/// carry, each written under the ride it belongs to.
pub(crate) fn ride_tables(conn: &Connection) -> Result<Vec<&'static str>, String> {
    let mut names = Vec::new();
    for table in declared_tables() {
        if table.class != TableClass::Mirror
            || table.name == "activities"
            || PACKED_RIDE_TABLES.contains(&table.name)
        {
            continue;
        }
        if table_exists(conn, table.name)? && has_column(conn, table.name, "activity_id")? {
            names.push(table.name);
        }
    }
    names.sort_unstable();
    Ok(names)
}

fn ride_has_rows(conn: &Connection, table: &str, key: &str) -> Result<bool, String> {
    conn.query_row(
        &format!("SELECT EXISTS (SELECT 1 FROM {table} WHERE activity_id = ?1)"),
        [key],
        |r| r.get::<_, bool>(0),
    )
    .map_err(sql)
}

/// One table as JSON lines, with its blob columns moved into a second buffer
/// and each row naming where its bytes are. `None` for a table with no rows.
/// `key` limits it to one ride's rows.
fn table_files(
    conn: &Connection,
    table: &str,
    key: Option<&str>,
) -> Result<Option<(Vec<u8>, Vec<u8>)>, String> {
    let mut statement = conn
        .prepare(&format!(
            "SELECT * FROM {table}{}",
            if key.is_some() {
                " WHERE activity_id = ?1"
            } else {
                ""
            }
        ))
        .map_err(sql)?;
    let columns: Vec<String> = statement.column_names().map(str::to_string).collect();
    let mut rows = match key {
        Some(key) => statement.query([key]),
        None => statement.query([]),
    }
    .map_err(sql)?;
    let mut lines = Vec::new();
    let mut blobs = Vec::new();
    let mut any = false;
    while let Some(row) = rows.next().map_err(sql)? {
        any = true;
        let mut values = Map::new();
        for (index, name) in columns.iter().enumerate() {
            let value = match row.get_ref(index).map_err(sql)? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(n) => Value::from(n),
                ValueRef::Real(n) => Value::from(n),
                ValueRef::Text(bytes) => Value::String(String::from_utf8_lossy(bytes).into_owned()),
                ValueRef::Blob(bytes) => {
                    let offset = blobs.len();
                    blobs.extend_from_slice(bytes);
                    json!({ "blob": { "offset": offset, "len": bytes.len() } })
                }
            };
            values.insert(name.clone(), value);
        }
        serde_json::to_writer(&mut lines, &values).map_err(io)?;
        lines.push(b'\n');
    }
    Ok(any.then_some((lines, blobs)))
}

fn le16(out: &mut Vec<u8>, n: u16) {
    out.extend_from_slice(&n.to_le_bytes());
}

fn le32(out: &mut Vec<u8>, n: u32) {
    out.extend_from_slice(&n.to_le_bytes());
}

/// A one-entry zip whose entry is `original`'s stored deflate stream as it is,
/// so the writer can take it across without compressing it again. The
/// archive's own crate has no call for a stream that was deflated elsewhere,
/// and reads this one back as it would any other.
fn archive_of(original: &StoredOriginal) -> Result<Vec<u8>, String> {
    let name = b"o";
    let compressed = u32::try_from(original.body.len()).map_err(io)?;
    let raw = u32::try_from(original.raw_len).map_err(io)?;
    // 1980-01-01: the zip epoch, since the stored file keeps no date.
    let date = 0x0021;
    let mut out = Vec::with_capacity(original.body.len() + 128);
    le32(&mut out, 0x0403_4b50);
    le16(&mut out, 20);
    le16(&mut out, 0);
    le16(&mut out, 8);
    le16(&mut out, 0);
    le16(&mut out, date);
    le32(&mut out, original.crc32);
    le32(&mut out, compressed);
    le32(&mut out, raw);
    le16(&mut out, name.len() as u16);
    le16(&mut out, 0);
    out.extend_from_slice(name);
    out.extend_from_slice(&original.body);
    let directory = out.len();
    le32(&mut out, 0x0201_4b50);
    le16(&mut out, 20);
    le16(&mut out, 20);
    le16(&mut out, 0);
    le16(&mut out, 8);
    le16(&mut out, 0);
    le16(&mut out, date);
    le32(&mut out, original.crc32);
    le32(&mut out, compressed);
    le32(&mut out, raw);
    le16(&mut out, name.len() as u16);
    le16(&mut out, 0);
    le16(&mut out, 0);
    le16(&mut out, 0);
    le16(&mut out, 0);
    le32(&mut out, 0);
    le32(&mut out, 0);
    out.extend_from_slice(name);
    let size = out.len() - directory;
    le32(&mut out, 0x0605_4b50);
    le16(&mut out, 0);
    le16(&mut out, 0);
    le16(&mut out, 1);
    le16(&mut out, 1);
    le32(&mut out, u32::try_from(size).map_err(io)?);
    le32(&mut out, u32::try_from(directory).map_err(io)?);
    le16(&mut out, 0);
    Ok(out)
}

fn write_original(
    zip: &mut zip::ZipWriter<std::fs::File>,
    name: &str,
    original: &StoredOriginal,
) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(archive_of(original)?)).map_err(io)?;
    let file = archive.by_index_raw(0).map_err(io)?;
    zip.raw_copy_file_rename(file, name).map_err(io)
}

fn write_entries(
    conn: &Connection,
    dest: &str,
    options: LibraryExportOptions,
    progress: &BulkExportProgress,
) -> Result<LibraryExportResult, String> {
    let file = std::fs::File::create(dest).map_err(io)?;
    let mut zip = zip::ZipWriter::new(file);
    let deflated = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .compression_level(Some(6));
    let stored =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);

    let rides = held_read(|| list_rides(conn, options))?;
    progress.set_total(u32::try_from(rides.len()).unwrap_or(u32::MAX));
    let tables = held_read(|| library_tables(conn))?;

    let listed: Vec<Value> = rides
        .iter()
        .map(|r| json!({ "key": r.key, "source": r.source, "start": r.start, "kinds": r.kinds() }))
        .collect();
    zip.start_file("library.json", deflated).map_err(io)?;
    serde_json::to_writer(
        &mut zip,
        &json!({
            "format": LIBRARY_EXPORT_FORMAT,
            "schemaVersion": SUPPORTED_SCHEMA_VERSION,
            "writtenAt": chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            "options": { "since": options.since, "originals": options.originals },
            "rides": listed,
        }),
    )
    .map_err(io)?;

    stop_if_cancelled(progress)?;
    let record = held_read(|| collect_record_payload(conn))?;
    zip.start_file("record.json", deflated).map_err(io)?;
    serde_json::to_writer(&mut zip, &record).map_err(io)?;

    let mut written_tables = 0u32;
    for table in tables {
        stop_if_cancelled(progress)?;
        let Some((lines, blobs)) = held_read(|| table_files(conn, table, None))? else {
            continue;
        };
        zip.start_file(format!("tables/{table}.jsonl"), deflated)
            .map_err(io)?;
        std::io::Write::write_all(&mut zip, &lines).map_err(io)?;
        if !blobs.is_empty() {
            zip.start_file(format!("tables/{table}.bin"), deflated)
                .map_err(io)?;
            std::io::Write::write_all(&mut zip, &blobs).map_err(io)?;
        }
        written_tables += 1;
    }

    let mut originals = 0u32;
    for ride in &rides {
        stop_if_cancelled(progress)?;
        let (rows, original) = held_read(|| {
            let rows = exported_rows(conn, &ride.key).map_err(io)?;
            let original = if ride.original {
                stored_original_of(conn, &ride.key).map_err(sql)?
            } else {
                None
            };
            Ok((rows, original))
        })?;
        let rows = rows.ok_or_else(|| format!("The ride {} has no rows to export", ride.key))?;
        // Already deflated by the packer, so stored.
        zip.start_file(format!("rides/{}/{ROWS_ENTRY}", ride.key), stored)
            .map_err(io)?;
        std::io::Write::write_all(&mut zip, &rows).map_err(io)?;
        for table in &ride.tables {
            let Some((lines, blobs)) = held_read(|| table_files(conn, table, Some(&ride.key)))?
            else {
                continue;
            };
            let base = format!("rides/{}/tables/{table}", ride.key);
            zip.start_file(format!("{base}.jsonl"), deflated)
                .map_err(io)?;
            std::io::Write::write_all(&mut zip, &lines).map_err(io)?;
            if !blobs.is_empty() {
                zip.start_file(format!("{base}.bin"), deflated)
                    .map_err(io)?;
                std::io::Write::write_all(&mut zip, &blobs).map_err(io)?;
            }
        }
        if let Some(original) = original {
            write_original(
                &mut zip,
                &format!("rides/{}/{ORIGINAL_ENTRY}", ride.key),
                &original,
            )?;
            originals += 1;
        }
        progress.visit();
    }

    let file = zip.finish().map_err(io)?;
    file.sync_all().map_err(io)?;
    let total_bytes = file.metadata().map_err(io)?.len();
    Ok(LibraryExportResult {
        rides: u32::try_from(rides.len()).unwrap_or(u32::MAX),
        originals,
        tables: written_tables,
        total_bytes: total_bytes as f64,
    })
}

/// Write the library to `dest` as one zip, reading through `conn`.
///
/// The export reads in short holds, one table or one ride at a time, so a
/// suspension never waits on the whole run. A stop asked for, or any failure,
/// leaves nothing at `dest`: a half-written archive opens as a shorter library
/// than the athlete has.
///
/// # Errors
///
/// Fails when a table cannot be read or the file cannot be written, and with
/// [`super::export::JOB_CANCELLED`] when the run was stopped.
pub fn write_library_export(
    conn: &Connection,
    dest: &str,
    options: LibraryExportOptions,
    progress: &BulkExportProgress,
) -> Result<LibraryExportResult, String> {
    let outcome = write_entries(conn, dest, options, progress);
    if outcome.is_err() {
        let _ = std::fs::remove_file(dest);
    }
    outcome
}
