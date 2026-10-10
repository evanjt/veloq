//! A write connection for the settings table that no engine lock stands in
//! front of.
//!
//! A preference is written from the JavaScript thread, and through the engine
//! `Mutex` that write waits for whatever holds it: a sync batch, a detection
//! run, a wipe. On a tap that is a frozen screen for the whole length of the
//! holder's work. The settings rows mirror no engine state, so the write has
//! no reason to wait there. It takes a connection of its own and waits only
//! for SQLite's write lock, which a writer holds for its transaction and not
//! for its whole run.
//!
//! The connection is bound to the database the read pool is bound to, and is
//! opened again whenever that binding moves, so a write after a quarantine or a
//! restore lands in the file the engine now has open.

use std::sync::{Mutex, MutexGuard};

use rusqlite::{Connection, OpenFlags};

struct Writer {
    generation: u64,
    conn: Connection,
}

static WRITER: Mutex<Option<Writer>> = Mutex::new(None);

/// A poisoned slot still holds a usable connection or none, and refusing it
/// would drop every later preference for the rest of the session.
fn lock() -> MutexGuard<'static, Option<Writer>> {
    WRITER.lock().unwrap_or_else(|e| e.into_inner())
}

/// Run `f` against the settings write connection. `None` when no engine is
/// installed or the connection cannot be opened.
pub(crate) fn with_settings_conn<F, R>(f: F) -> Option<R>
where
    F: FnOnce(&Connection) -> R,
{
    let _write = super::suspension::begin_write()?;
    let (generation, path) = super::read_pool::binding()?;
    let mut slot = lock();
    if slot.as_ref().is_none_or(|w| w.generation != generation) {
        *slot = None;
        match open_writer(&path) {
            Ok(conn) => *slot = Some(Writer { generation, conn }),
            Err(e) => {
                log::warn!("veloqrs: [SettingsConn] write connection to '{path}': {e:?}");
                return None;
            }
        }
    }
    slot.as_ref().map(|w| f(&w.conn))
}

/// Drop the connection, as the read pool drops its idle ones, so none stays
/// open on a file a quarantine or a restore has moved aside.
pub(crate) fn forget() {
    *lock() = None;
}

/// Hand back the page cache the connection holds. The connection itself stays
/// open, because the next preference write is a tap away.
pub(crate) fn release_memory() {
    if let Some(writer) = lock().as_ref() {
        super::release_connection_memory(&writer.conn, "SettingsConn");
    }
}

/// The file already exists and is already WAL, because the engine opened it
/// before the read pool was bound, so this neither creates it nor converts it.
fn open_writer(path: &str) -> rusqlite::Result<Connection> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_URI,
    )?;
    // The engine's connection waits this long for another writer, and this
    // one waits for the engine's transactions the same way.
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    super::apply_write_pragmas(&conn)?;
    Ok(conn)
}
