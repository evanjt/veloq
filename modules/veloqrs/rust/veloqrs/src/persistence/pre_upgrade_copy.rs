//! The copy of the library taken before a migration changes it.
//!
//! Section names, pins, cuts and recordings live only in this file, so a
//! migration that fails part way or writes wrong values must leave the old
//! shape somewhere. The copy sits beside the library as
//! `<db>.pre-upgrade-<old version>`, one generation at a time. It is written
//! only when a migration is pending on a file that already holds data. It is
//! written under a `.partial` name and renamed into place once whole, so a
//! kill mid-write leaves only the temporary name, which the next take deletes.
//! It is removed once the detector cutover that follows the upgrade is
//! promoted or reverted, since until then it is the only copy of the old
//! catalogue. The app's wipe and its device-backup exclusion find it by that
//! name (`PRE_UPGRADE_INFIX` in `databaseSidecars.ts`).
//!
//! The upgrade never waits on it: a copy that cannot be written is logged and
//! the migration runs without one, since refusing to open the library is worse
//! than opening it unprotected.

use rusqlite::{Connection, OpenFlags, OptionalExtension, Result as SqlResult, params};

/// `schema_info` key naming the copy the last upgrade of this file wrote. A
/// fresh file has none, so a library recreated beside an earlier copy never
/// removes it.
const COPY_KEY: &str = "pre_upgrade_copy";

const SUFFIXES: [&str; 4] = ["", "-wal", "-shm", "-journal"];

/// Appended to a copy's name while it is being written. Not all digits, so
/// [`earlier_copies`] never mistakes it for a generation.
const PARTIAL_SUFFIX: &str = ".partial";

fn copy_prefix(db_path: &str) -> String {
    format!("{db_path}.pre-upgrade-")
}

fn copy_path(db_path: &str, old_version: i32) -> String {
    format!("{}{old_version}", copy_prefix(db_path))
}

fn partial_path(copy: &str) -> String {
    format!("{copy}{PARTIAL_SUFFIX}")
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
    take_on(conn, old_version, free_bytes)
}

/// Whether `path` opens as a whole database at `version`. A copy cut off by a
/// kill fails here, as does one an earlier build left at another version.
fn copy_holds_version(path: &str, version: i32) -> bool {
    let Ok(conn) = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY) else {
        return false;
    };
    let user_version: SqlResult<i32> = conn.query_row("PRAGMA user_version", [], |row| row.get(0));
    if user_version.ok() != Some(version) {
        return false;
    }
    conn.query_row("PRAGMA quick_check", [], |row| row.get::<_, String>(0))
        .is_ok_and(|verdict| verdict == "ok")
}

fn take_on(
    conn: &Connection,
    old_version: i32,
    free: impl Fn(&str) -> Option<u64>,
) -> Option<String> {
    let db_path = db_path(conn)?;
    let dest = copy_path(&db_path, old_version);
    let partial = partial_path(&dest);
    // Only a copy that was killed mid-write leaves this name behind, and it is
    // never a whole copy, so it goes before anything else is decided.
    remove_copy(&partial);
    match holds_data(conn) {
        Ok(true) => {}
        Ok(false) => return None,
        Err(e) => {
            log::warn!("veloqrs: [Schema] Pre-upgrade copy skipped: {}", e);
            return None;
        }
    }
    // A copy at this version is from an earlier attempt at this same upgrade,
    // which died before stamping the new version. The file may be part
    // migrated now, so the earlier copy is the one that holds the old shape,
    // provided it is whole. One that is not is replaced.
    if std::path::Path::new(&dest).is_file() {
        if copy_holds_version(&dest, old_version) {
            log::info!(
                "veloqrs: [Schema] Keeping '{}' from an earlier attempt at this upgrade",
                dest
            );
            return Some(dest);
        }
        log::warn!(
            "veloqrs: [Schema] Replacing '{}': it is not a whole copy at version {}",
            dest,
            old_version
        );
        remove_copy(&dest);
    }
    // A copy the volume cannot hold is not started, so it never fills the
    // volume partway through and leaves a partial file behind.
    let needed = copy_space_needed(&db_path);
    if let Some(available) = free(&db_path).filter(|available| *available < needed) {
        log::warn!(
            "veloqrs: [Schema] Pre-upgrade copy skipped: {} bytes free beside the library, {} needed. Upgrading without a copy",
            available,
            needed
        );
        return None;
    }
    let started = std::time::Instant::now();
    let written = write_copy(conn, &partial)
        .and_then(|()| std::fs::rename(&partial, &dest).map_err(|e| e.to_string()));
    match written {
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
            remove_copy(&partial);
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
/// this file wrote, unless the detector cutover still owes its switch. A copy
/// left behind costs space and nothing else, so a failure here never fails the
/// open.
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
    // The detector cutover runs after this open, and until it is promoted or
    // reverted the copy is the only one holding the old catalogue.
    if crate::persistence::cutover::pooled::cutover_is_owed(conn) {
        return Ok(());
    }
    // Only a name this module writes beside this file, whatever the row says.
    if db_path(conn).is_some_and(|db| copy.starts_with(&copy_prefix(&db))) {
        remove_copy(&copy);
    }
    conn.execute("DELETE FROM schema_info WHERE key = ?1", params![COPY_KEY])?;
    Ok(())
}

/// Bytes the copy needs on the volume: two library sizes with the sidecars.
/// The copy takes one, and the second is headroom for the migration that
/// follows it.
fn copy_space_needed(db_path: &str) -> u64 {
    let size =
        |suffix: &str| std::fs::metadata(format!("{db_path}{suffix}")).map_or(0, |meta| meta.len());
    2 * size("") + size("-wal") + size("-shm")
}

/// Free bytes on the volume holding `db_path`, `None` when it cannot be read.
fn free_bytes(db_path: &str) -> Option<u64> {
    #[cfg(unix)]
    {
        let path = std::ffi::CString::new(db_path).ok()?;
        let mut stat = std::mem::MaybeUninit::<libc::statvfs>::uninit();
        // SAFETY: `path` is NUL-terminated and `stat` is a valid out-pointer
        // that `statvfs` fills in when it returns zero.
        if unsafe { libc::statvfs(path.as_ptr(), stat.as_mut_ptr()) } != 0 {
            return None;
        }
        // SAFETY: a zero return from `statvfs` means the struct is initialised.
        let stat = unsafe { stat.assume_init() };
        // The block count and its size have per-platform widths, so the product
        // is taken wide and narrowed once.
        let bytes = u128::from(stat.f_bavail) * u128::from(stat.f_frsize);
        Some(u64::try_from(bytes).unwrap_or(u64::MAX))
    }
    #[cfg(not(unix))]
    {
        let _ = db_path;
        None
    }
}

/// Names the bytes an upgrade needs when a write failed for want of space.
///
/// The code stays `DiskFull`, so the open still classifies the failure as
/// storage and leaves the library where it is. Only the message changes.
pub(super) fn explain_shortfall(e: rusqlite::Error, db_path: &str) -> rusqlite::Error {
    explain_shortfall_on(e, db_path, free_bytes)
}

fn explain_shortfall_on(
    e: rusqlite::Error,
    db_path: &str,
    free: impl Fn(&str) -> Option<u64>,
) -> rusqlite::Error {
    if !super::is_disk_full(&e) {
        return e;
    }
    let rusqlite::Error::SqliteFailure(code, message) = e else {
        return e;
    };
    let needed = copy_space_needed(db_path);
    let available = match free(db_path) {
        Some(bytes) => format!("{bytes} bytes are free"),
        None => "the free space could not be read".to_string(),
    };
    let base = message.unwrap_or_else(|| "database or disk is full".to_string());
    rusqlite::Error::SqliteFailure(
        code,
        Some(format!(
            "{base}: the upgrade needs {needed} bytes free beside the library, {available}"
        )),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::ffi;
    use std::path::Path;
    use tempfile::TempDir;

    /// A library with enough rows that its size is not in doubt.
    fn library_beside(dir: &TempDir) -> (String, Connection) {
        let path = dir.path().join("routes.db").to_string_lossy().into_owned();
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "PRAGMA user_version = 12;
             CREATE TABLE activities (id INTEGER PRIMARY KEY, body BLOB);
             WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 200)
             INSERT INTO activities (body) SELECT randomblob(4096) FROM n;",
        )
        .unwrap();
        (path, conn)
    }

    fn disk_full() -> rusqlite::Error {
        rusqlite::Error::SqliteFailure(ffi::Error::new(ffi::SQLITE_FULL), None)
    }

    #[test]
    fn a_copy_that_does_not_fit_beside_the_library_is_skipped() {
        let dir = TempDir::new().unwrap();
        let (path, conn) = library_beside(&dir);
        let needed = copy_space_needed(&path);

        let taken = take_on(&conn, 12, |_| Some(needed - 1));

        assert_eq!(taken, None);
        assert!(!Path::new(&copy_path(&path, 12)).exists());
    }

    #[test]
    fn a_copy_that_exactly_fits_is_taken() {
        let dir = TempDir::new().unwrap();
        let (path, conn) = library_beside(&dir);
        let needed = copy_space_needed(&path);

        let taken = take_on(&conn, 12, |_| Some(needed));

        assert_eq!(taken, Some(copy_path(&path, 12)));
        assert!(Path::new(&copy_path(&path, 12)).is_file());
    }

    #[test]
    fn a_copy_is_taken_when_the_free_space_cannot_be_read() {
        let dir = TempDir::new().unwrap();
        let (path, conn) = library_beside(&dir);

        let taken = take_on(&conn, 12, |_| None);

        assert_eq!(taken, Some(copy_path(&path, 12)));
    }

    #[test]
    fn the_space_a_copy_needs_is_two_library_sizes_and_the_sidecars() {
        let dir = TempDir::new().unwrap();
        let (path, _conn) = library_beside(&dir);
        let main = std::fs::metadata(&path).unwrap().len();
        std::fs::write(format!("{path}-wal"), vec![0u8; 1000]).unwrap();
        std::fs::write(format!("{path}-shm"), vec![0u8; 300]).unwrap();

        assert_eq!(copy_space_needed(&path), 2 * main + 1000 + 300);
    }

    #[test]
    fn a_migration_out_of_space_names_the_bytes_it_needs() {
        let dir = TempDir::new().unwrap();
        let (path, _conn) = library_beside(&dir);
        let needed = copy_space_needed(&path);

        let explained = explain_shortfall_on(disk_full(), &path, |_| Some(1024));

        assert_eq!(
            explained.sqlite_error_code(),
            Some(rusqlite::ErrorCode::DiskFull)
        );
        let rusqlite::Error::SqliteFailure(_, Some(message)) = explained else {
            panic!("the explanation carries no message");
        };
        assert!(message.contains(&format!("{needed} bytes")), "{message}");
        assert!(message.contains("1024 bytes"), "{message}");
    }

    #[test]
    fn an_error_that_is_not_out_of_space_passes_through_unchanged() {
        let dir = TempDir::new().unwrap();
        let (path, _conn) = library_beside(&dir);
        let corrupt = rusqlite::Error::SqliteFailure(ffi::Error::new(ffi::SQLITE_CORRUPT), None);

        let explained = explain_shortfall_on(corrupt, &path, |_| Some(1024));

        assert_eq!(
            explained.sqlite_error_code(),
            Some(rusqlite::ErrorCode::DatabaseCorrupt)
        );
        assert!(matches!(explained, rusqlite::Error::SqliteFailure(_, None)));
    }
}
