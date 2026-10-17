//! The copy of the library taken before a migration changes it.
//!
//! Section names, pins, cuts and recordings live only in this file, so a
//! migration that fails part way or writes wrong values must leave the old
//! shape somewhere. The copy sits beside the library as
//! `<db>.pre-upgrade-<old version>`, one generation at a time. It is written
//! only when a migration is pending on a file that already holds data, and
//! removed by the next open that has nothing to migrate. The app's wipe and
//! its device-backup exclusion find it by that name (`PRE_UPGRADE_INFIX` in
//! `databaseSidecars.ts`).
//!
//! The upgrade never waits on it: a copy that cannot be written is logged and
//! the migration runs without one, since refusing to open the library is worse
//! than opening it unprotected.

use rusqlite::{Connection, OptionalExtension, Result as SqlResult, params};

/// `schema_info` key naming the copy the last upgrade of this file wrote. A
/// fresh file has none, so a library recreated beside an earlier copy never
/// removes it.
const COPY_KEY: &str = "pre_upgrade_copy";

const SUFFIXES: [&str; 3] = ["", "-wal", "-shm"];

fn copy_prefix(db_path: &str) -> String {
    format!("{db_path}.pre-upgrade-")
}

fn copy_path(db_path: &str, old_version: i32) -> String {
    format!("{}{old_version}", copy_prefix(db_path))
}

/// The file the connection is open on, `None` for an in-memory database.
fn db_path(conn: &Connection) -> Option<String> {
    conn.path()
        .filter(|path| !path.is_empty())
        .map(str::to_string)
}

/// Whether the file holds anything beyond the `schema_info` table that opening
/// it creates. An empty file is a fresh install and has nothing to protect.
fn holds_data(conn: &Connection) -> SqlResult<bool> {
    conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM sqlite_master
             WHERE type = 'table' AND name <> 'schema_info' AND name NOT LIKE 'sqlite_%')",
        [],
        |row| row.get(0),
    )
}

fn remove_copy(path: &str) {
    for suffix in SUFFIXES {
        let file = format!("{path}{suffix}");
        match std::fs::remove_file(&file) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => log::warn!("veloqrs: [Schema] Could not remove '{}': {}", file, e),
        }
    }
}

/// Every earlier generation beside the library, by its main file's path.
fn earlier_copies(db_path: &str) -> Vec<String> {
    let path = std::path::Path::new(db_path);
    let (Some(dir), Some(name)) = (path.parent(), path.file_name()) else {
        return Vec::new();
    };
    let dir = if dir.as_os_str().is_empty() {
        std::path::Path::new(".")
    } else {
        dir
    };
    let stem = format!("{}.pre-upgrade-", name.to_string_lossy());
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|n| {
            n.strip_prefix(&stem)
                .is_some_and(|v| !v.is_empty() && v.bytes().all(|b| b.is_ascii_digit()))
        })
        .map(|n| dir.join(n).to_string_lossy().into_owned())
        .collect()
}

/// Copy the open library with `sqlite3_backup` in one step, which reads it
/// inside a single transaction, so the copy is consistent under WAL.
fn write_copy(conn: &Connection, dest_path: &str) -> Result<(), String> {
    use rusqlite::backup::{Backup, StepResult};

    let mut dest = Connection::open(dest_path).map_err(|e| e.to_string())?;
    let copy = Backup::new(conn, &mut dest).map_err(|e| e.to_string())?;
    match copy.step(-1).map_err(|e| e.to_string())? {
        StepResult::Done => Ok(()),
        other => Err(format!("stopped before the end: {other:?}")),
    }
}

/// Take the copy before a migration pass. Returns the path written, which
/// [`record`] stamps once the pass succeeds. `None` for a fresh install, an
/// in-memory database, or a copy that failed.
pub(super) fn take(conn: &Connection, old_version: i32) -> Option<String> {
    let db_path = db_path(conn)?;
    match holds_data(conn) {
        Ok(true) => {}
        Ok(false) => return None,
        Err(e) => {
            log::warn!("veloqrs: [Schema] Pre-upgrade copy skipped: {}", e);
            return None;
        }
    }
    let dest = copy_path(&db_path, old_version);
    // A copy at this version is from an earlier attempt at this same upgrade,
    // which died before stamping the new version. The file may be part
    // migrated now, so the earlier copy is the one that holds the old shape.
    if std::path::Path::new(&dest).is_file() {
        log::info!(
            "veloqrs: [Schema] Keeping '{}' from an earlier attempt at this upgrade",
            dest
        );
        return Some(dest);
    }
    let started = std::time::Instant::now();
    match write_copy(conn, &dest) {
        Ok(()) => {
            log::info!(
                "veloqrs: [Schema] Copied the library to '{}' before migrating, {}ms",
                dest,
                crate::elapsed_ms(started)
            );
            for earlier in earlier_copies(&db_path) {
                if earlier != dest {
                    remove_copy(&earlier);
                }
            }
            Some(dest)
        }
        Err(e) => {
            log::error!(
                "veloqrs: [Schema] Could not copy the library before migrating, upgrading without a copy: {}",
                e
            );
            // A destination that opened and then failed holds a partial file.
            remove_copy(&dest);
            None
        }
    }
}

/// Stamp the copy an upgrade that succeeded wrote, so the next open removes it.
pub(super) fn record(conn: &Connection, copy: &str) -> SqlResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO schema_info (key, value) VALUES (?1, ?2)",
        params![COPY_KEY, copy],
    )?;
    Ok(())
}

/// On an open with nothing to migrate, remove the copy the last upgrade of
/// this file wrote: the file has since opened on its new version. A copy left
/// behind costs space and nothing else, so a failure here never fails the open.
pub(super) fn release(conn: &Connection) {
    if let Err(e) = release_recorded(conn) {
        log::warn!(
            "veloqrs: [Schema] Could not release the pre-upgrade copy: {}",
            e
        );
    }
}

fn release_recorded(conn: &Connection) -> SqlResult<()> {
    let copy: Option<String> = conn
        .query_row(
            "SELECT value FROM schema_info WHERE key = ?1",
            params![COPY_KEY],
            |row| row.get(0),
        )
        .optional()?;
    let Some(copy) = copy else {
        return Ok(());
    };
    // Only a name this module writes beside this file, whatever the row says.
    if db_path(conn).is_some_and(|db| copy.starts_with(&copy_prefix(&db))) {
        remove_copy(&copy);
    }
    conn.execute("DELETE FROM schema_info WHERE key = ?1", params![COPY_KEY])?;
    Ok(())
}
