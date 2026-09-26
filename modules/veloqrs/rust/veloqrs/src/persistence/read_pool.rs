//! Read-only SQLite connections that no engine lock stands in front of.
//!
//! `PERSISTENT_ENGINE` is an `RwLock`, and a read closure needs its read
//! guard, so a screen read waits for whatever write is in flight: measured at
//! 200.1 ms against a writer holding for 200 ms, where the same read through a
//! second connection took 0.4 ms. The wait was never SQLite's. Under WAL
//! readers overlap the writer, so a connection of one's own is served the last
//! commit while the writer is mid-transaction.
//!
//! So this is the second access path: the write lock stays exactly as it is for
//! the call sites that mutate, and a read that only needs SQLite comes through
//! here instead, touching no engine state at all. The pool is bound to the
//! database when the engine is installed and holds nothing else, which is why
//! it can be reached without the lock that owns the engine.
//!
//! What a pooled reader cannot do is see a write that has not committed, and it
//! cannot see the engine's in-memory tier either. A caller that needs either of
//! those belongs on the write lock.

use std::sync::{LazyLock, Mutex, MutexGuard};

use rusqlite::{Connection, OpenFlags};

/// Idle connections kept for reuse. Each costs a file descriptor and a page
/// cache, and readers are short, so a handful covers the screens that overlap
/// without holding open one per thread that ever read.
const IDLE_LIMIT: usize = 4;

struct ReadPool {
    /// The database the engine is open on, set when it is installed. `None`
    /// before init and after a close, which is the one reason a read is
    /// refused rather than served.
    path: Mutex<Option<String>>,
    idle: Mutex<Vec<Connection>>,
}

static READ_POOL: LazyLock<ReadPool> = LazyLock::new(|| ReadPool {
    path: Mutex::new(None),
    idle: Mutex::new(Vec::new()),
});

/// A poisoned pool is still a valid pool: the panic happened in a caller's
/// closure, not in the `Vec`, and refusing the lock afterwards would leave
/// every later read unserved for the rest of the session. This is the recovery
/// the engine's own accessors take, for the same reason.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Point the pool at the database the engine has just opened.
///
/// Called on every path that installs an engine, including the quarantine
/// reopen, and the idle connections are dropped rather than kept: after a
/// quarantine the file they hold open has been renamed aside, so reusing one
/// would serve reads from the database that was moved away.
pub(crate) fn bind(db_path: &str) {
    lock(&READ_POOL.idle).clear();
    *lock(&READ_POOL.path) = Some(db_path.to_string());
    // What a reader is allowed to remember belongs to the database it was read
    // from, so it moves with the binding.
    super::read_cache::bind(db_path);
}

/// Forget the database and drop every idle connection. Nothing in the app
/// closes the engine, so this exists for the tests that open one on a
/// throwaway file and must not leave the next test reading it.
#[cfg(test)]
pub(crate) fn close() {
    *lock(&READ_POOL.path) = None;
    lock(&READ_POOL.idle).clear();
    super::read_cache::close();
}

/// Run `f` against a connection of this thread's own, with no engine lock
/// taken anywhere on the path.
///
/// `None` means the pool has no database: the engine is not initialised, or
/// the open failed, and there is nothing truthful to answer with. The
/// connection is returned to the pool afterwards, and a closure that panics
/// drops its connection instead, because a connection abandoned mid-statement
/// is not one to hand to the next caller.
pub fn with_read_conn<F, R>(f: F) -> Option<R>
where
    F: FnOnce(&Connection) -> R,
{
    let conn = take()?;
    let out = f(&conn);
    give_back(conn);
    Some(out)
}

fn take() -> Option<Connection> {
    if let Some(conn) = lock(&READ_POOL.idle).pop() {
        return Some(conn);
    }
    let path = lock(&READ_POOL.path).clone()?;
    match open_reader(&path) {
        Ok(conn) => Some(conn),
        Err(e) => {
            log::warn!("veloqrs: [ReadPool] read connection to '{path}': {e:?}");
            None
        }
    }
}

fn give_back(conn: Connection) {
    let mut idle = lock(&READ_POOL.idle);
    if idle.len() < IDLE_LIMIT {
        idle.push(conn);
    }
}

/// Open one reader.
///
/// `SQLITE_OPEN_READ_ONLY` is the enforcement rather than a convention: a
/// closure that reaches a write on one of these fails at the statement instead
/// of racing the writer. The file is already WAL and already exists, because
/// the engine opened it before this pool was bound, so a read-only open finds
/// the shared-memory index rather than having to create one it has no
/// permission to.
fn open_reader(path: &str) -> rusqlite::Result<Connection> {
    let conn = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_URI,
    )?;
    // Matches the write connection. A reader under WAL does not wait on the
    // writer, but it does wait on a checkpoint that is recovering the log.
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(conn)
}

/// How many connections are parked. Test-only: the pool's behaviour is what
/// matters to a caller, its size is what a test needs to see reuse happening.
#[cfg(test)]
pub(crate) fn idle_len() -> usize {
    lock(&READ_POOL.idle).len()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    // The pool is process-wide and so is the engine that binds it, so these
    // take the crate lock rather than one of their own.

    /// A bound pool on a throwaway database with one table. The `TempDir` is
    /// returned so the caller keeps the file alive.
    fn bound_pool(name: &str) -> (TempDir, Connection) {
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join(name);
        let path = path.to_str().expect("utf-8").to_string();
        let writer = Connection::open(&path).expect("write connection");
        writer
            .pragma_update_and_check(None, "journal_mode", "WAL", |_| Ok(()))
            .expect("wal");
        writer
            .execute("CREATE TABLE names (id TEXT PRIMARY KEY)", [])
            .expect("create");
        bind(&path);
        (dir, writer)
    }

    /// Scenario: a write batch is part-way through a transaction when a screen
    /// read arrives.
    ///
    /// Expected behaviour: the reader is served the last commit, not the
    /// uncommitted row, and it is served straight away rather than waiting for
    /// the transaction to end. This is the cost of the second access path and
    /// the reason a caller that must read its own writes stays on the write
    /// lock.
    #[test]
    fn a_reader_is_served_the_last_commit_and_never_a_write_in_flight() {
        let _serial = crate::test_globals::serial_global_state();
        let (_dir, writer) = bound_pool("in_flight.db");
        writer
            .execute("INSERT INTO names (id) VALUES ('committed')", [])
            .expect("commit one row");

        writer.execute("BEGIN IMMEDIATE", []).expect("begin");
        writer
            .execute("INSERT INTO names (id) VALUES ('in flight')", [])
            .expect("insert");

        let during: i64 = with_read_conn(|conn| {
            conn.query_row("SELECT COUNT(*) FROM names", [], |row| row.get(0))
                .expect("count")
        })
        .expect("bound");
        assert_eq!(
            during, 1,
            "an uncommitted row must be invisible to a reader"
        );

        writer.execute("COMMIT", []).expect("commit");
        let after: i64 = with_read_conn(|conn| {
            conn.query_row("SELECT COUNT(*) FROM names", [], |row| row.get(0))
                .expect("count")
        })
        .expect("bound");
        assert_eq!(after, 2, "the commit must be visible to the next read");

        close();
    }

    /// Two readers overlap, which is the shape that panicked rusqlite when
    /// they shared one connection: `Connection` keeps its statement cache in a
    /// `RefCell`, so two threads inside `prepare` on one of them panic rather
    /// than queue.
    #[test]
    fn two_readers_run_at_once_on_connections_of_their_own() {
        let _serial = crate::test_globals::serial_global_state();
        let (_dir, _writer) = bound_pool("overlap.db");

        std::thread::scope(|scope| {
            for _ in 0..2 {
                scope.spawn(|| {
                    for _ in 0..50 {
                        let count: i64 = with_read_conn(|conn| {
                            conn.query_row("SELECT COUNT(*) FROM names", [], |row| row.get(0))
                                .expect("count")
                        })
                        .expect("bound");
                        assert_eq!(count, 0);
                    }
                });
            }
        });

        close();
    }

    /// A connection is handed back rather than opened per read, or every screen
    /// read pays an open and the pool is a pool in name only.
    #[test]
    fn a_connection_is_returned_for_the_next_reader() {
        let _serial = crate::test_globals::serial_global_state();
        let (_dir, _writer) = bound_pool("reuse.db");
        assert_eq!(idle_len(), 0, "a fresh bind parks nothing");

        with_read_conn(|conn| {
            conn.query_row("SELECT 1", [], |row| row.get::<_, i64>(0))
                .expect("query")
        })
        .expect("bound");
        assert_eq!(idle_len(), 1, "the connection must come back to the pool");

        close();
    }

    #[test]
    fn a_read_before_init_is_refused_rather_than_answered() {
        let _serial = crate::test_globals::serial_global_state();
        close();
        assert!(
            with_read_conn(|_| ()).is_none(),
            "an unbound pool has no database and nothing truthful to answer with"
        );
    }
}
