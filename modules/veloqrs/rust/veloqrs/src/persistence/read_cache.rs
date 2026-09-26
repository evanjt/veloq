//! What a pooled read is allowed to remember between calls.
//!
//! A pooled read reaches SQLite and nothing else, so the LRUs the engine keeps
//! are not available to it: they belong to `PersistentEngine`, they are
//! mutated by the write path, and reaching them from a reader would put the
//! engine lock back in front of the read this whole path exists to take out
//! from behind it.
//!
//! So a read that is worth remembering is remembered here instead, beside the
//! pool and under its own lock. What makes that safe is the stamp: SQLite's
//! `PRAGMA data_version` changes whenever any **other** connection commits, so
//! a cached value is served only while the database has not moved since it was
//! filled, and the whole cache is dropped the moment it has. A reader cannot
//! serve a stale row that way, only a slightly older one it would have read
//! anyway.
//!
//! The stamp is read on a connection of this module's own, not on the caller's
//! pooled one. Two connections' `data_version` values are unrelated, so a
//! stamp taken on whichever reader happened to serve the call would compare
//! against a number from a different counter and either miss every time or,
//! worse, hit when the database had moved.

use std::num::NonZeroUsize;
use std::sync::{Arc, LazyLock, Mutex, MutexGuard};

use lru::LruCache;
use rusqlite::{Connection, OpenFlags};
use tracematch::RouteSignature;

struct ReadCache {
    /// The database, and the connection the stamp is read on. Opened on the
    /// first cached read after a bind.
    stamp: Mutex<Stamp>,
    /// The sports the map tab's filter chips offer: a `DISTINCT` over every
    /// metrics row, asked on every map read, and answered from four or five
    /// values that change only when a sync lands.
    sport_types: Mutex<Option<Vec<String>>>,
    /// Route signatures, by activity. The feed asks for one per card it draws
    /// and asks again on every scroll back, and a signature is a blob to
    /// decode rather than a row to read, so this is the one read where the
    /// saving is the parse and not the query.
    signatures: Mutex<LruCache<String, Arc<RouteSignature>>>,
    /// Consensus routes, by group. The medoid is computed over every track in
    /// the group, so this is the one cached read whose miss costs more than a
    /// query: the route tab asks for it on every open of the same route.
    consensus: Mutex<LruCache<String, Arc<Vec<tracematch::GpsPoint>>>>,
    /// Section performances, by section and sport filter. The section detail
    /// screen asks for one and the insights batch asks for many in a row, and
    /// the answer is built from every traversal of the section, so this is the
    /// engine's `perf_cache` on the reader's side of the lock.
    performances: Mutex<LruCache<String, Arc<crate::SectionPerformanceResult>>>,
    /// The corridor names an athlete gave their sections, resolved onto the
    /// catalogue. One map for the whole library, and every pooled read that
    /// names a section wants it, so it is a slot rather than an LRU.
    named_overlay: Mutex<Option<Arc<std::collections::BTreeMap<String, String>>>>,
}

/// How many signatures to keep. The feed draws a screenful and the athlete
/// scrolls back over the same cards, so a couple of hundred covers a session's
/// worth without holding a library of blobs in memory.
const SIGNATURE_CAPACITY: usize = 200;

/// How many consensus routes to keep. The athlete opens a handful of routes in
/// a sitting and each is a whole track, so this stays small.
const CONSENSUS_CAPACITY: usize = 16;

/// How many section performance results to keep. The insights batch asks for
/// a screenful of sections at once, and each result carries every traversal,
/// so this is a screenful and not a library.
const PERFORMANCE_CAPACITY: usize = 32;

#[derive(Default)]
struct Stamp {
    path: Option<String>,
    conn: Option<Connection>,
    seen: Option<i64>,
}

static READ_CACHE: LazyLock<ReadCache> = LazyLock::new(|| ReadCache {
    stamp: Mutex::new(Stamp::default()),
    sport_types: Mutex::new(None),
    signatures: Mutex::new(LruCache::new(
        NonZeroUsize::new(SIGNATURE_CAPACITY).expect("a cache with no room is a bug"),
    )),
    consensus: Mutex::new(LruCache::new(
        NonZeroUsize::new(CONSENSUS_CAPACITY).expect("a cache with no room is a bug"),
    )),
    performances: Mutex::new(LruCache::new(
        NonZeroUsize::new(PERFORMANCE_CAPACITY).expect("a cache with no room is a bug"),
    )),
    named_overlay: Mutex::new(None),
});

/// The same poison recovery the pool and the engine take: the panic was in a
/// caller's closure, and refusing the lock afterwards would leave every later
/// read unserved for the session.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Point the cache at the database the pool has just been bound to, and drop
/// everything held for the last one.
pub(crate) fn bind(db_path: &str) {
    clear();
    let mut stamp = lock(&READ_CACHE.stamp);
    stamp.path = Some(db_path.to_string());
    stamp.conn = None;
    stamp.seen = None;
}

/// Drop every cached value. The stamp connection stays: it is the thing that
/// says whether the next fill is still current.
pub(crate) fn clear() {
    *lock(&READ_CACHE.sport_types) = None;
    lock(&READ_CACHE.signatures).clear();
    lock(&READ_CACHE.consensus).clear();
    lock(&READ_CACHE.performances).clear();
    *lock(&READ_CACHE.named_overlay) = None;
}

/// Forget the database and everything held for it. Nothing in the app closes
/// the engine, so this is for the tests that bind a throwaway one.
#[cfg(test)]
pub(crate) fn close() {
    clear();
    *lock(&READ_CACHE.stamp) = Stamp::default();
}

/// The sports the map filter offers, cached until the database moves.
pub fn sport_types(fill: impl FnOnce() -> Vec<String>) -> Vec<String> {
    cached(&READ_CACHE.sport_types, fill)
}

/// One route group's consensus line, cached until the database moves.
///
/// `None` is not cached, for the same reason a missing signature is not: a
/// group with no track yet gets one, and that write moves the stamp.
pub fn consensus(
    group_id: &str,
    fill: impl FnOnce() -> Option<Vec<tracematch::GpsPoint>>,
) -> Option<Arc<Vec<tracematch::GpsPoint>>> {
    if database_moved() {
        clear();
    }
    if let Some(hit) = lock(&READ_CACHE.consensus).get(group_id) {
        return Some(Arc::clone(hit));
    }
    let value = Arc::new(fill()?);
    lock(&READ_CACHE.consensus).put(group_id.to_string(), Arc::clone(&value));
    Some(value)
}

/// One section's performances under one sport filter, cached until the
/// database moves.
///
/// An empty result is cached like any other: a section with no traversals is a
/// real answer, and the next detect that gives it one moves the stamp.
pub fn performances(
    key: &str,
    fill: impl FnOnce() -> crate::SectionPerformanceResult,
) -> Arc<crate::SectionPerformanceResult> {
    if database_moved() {
        clear();
    }
    if let Some(hit) = lock(&READ_CACHE.performances).get(key) {
        return Arc::clone(hit);
    }
    let value = Arc::new(fill());
    lock(&READ_CACHE.performances).put(key.to_string(), Arc::clone(&value));
    value
}

/// The section display names the corridor overlay resolves, cached until the
/// database moves.
///
/// An empty map is cached like any other answer: a library with no named
/// intents is the common one, and the fill short-circuits it with a single
/// `EXISTS` probe rather than resolving a catalogue nobody has named.
pub fn named_overlay(
    fill: impl FnOnce() -> std::collections::BTreeMap<String, String>,
) -> Arc<std::collections::BTreeMap<String, String>> {
    if database_moved() {
        clear();
    }
    if let Some(hit) = lock(&READ_CACHE.named_overlay).as_ref() {
        return Arc::clone(hit);
    }
    let value = Arc::new(fill());
    *lock(&READ_CACHE.named_overlay) = Some(Arc::clone(&value));
    value
}

/// One activity's signature, cached until the database moves.
///
/// `None` is not cached: an activity with no signature yet gets one when
/// detection catches up, and that write moves the stamp anyway, so the only
/// thing caching the absence would buy is a stale empty card.
pub fn signature(
    activity_id: &str,
    fill: impl FnOnce() -> Option<RouteSignature>,
) -> Option<Arc<RouteSignature>> {
    if database_moved() {
        clear();
    }
    if let Some(hit) = lock(&READ_CACHE.signatures).get(activity_id) {
        return Some(Arc::clone(hit));
    }
    let value = Arc::new(fill()?);
    lock(&READ_CACHE.signatures).put(activity_id.to_string(), Arc::clone(&value));
    Some(value)
}

/// Serve one slot, filling it on a miss.
///
/// The value is cloned out rather than lent, so the guard is dropped before
/// the caller touches it and a slow caller never holds the cache shut. The
/// fill runs outside the guard for the same reason: it queries SQLite, and
/// holding the slot across that would serialise every reader behind the first
/// miss.
fn cached<T: Clone>(slot: &Mutex<Option<T>>, fill: impl FnOnce() -> T) -> T {
    if database_moved() {
        clear();
    }
    if let Some(value) = lock(slot).clone() {
        return value;
    }
    let value = fill();
    *lock(slot) = Some(value.clone());
    value
}

/// Whether anything has committed since the last look.
///
/// A stamp that cannot be read is reported as moved: the honest answer to "is
/// this still current" with no way to ask is no, and the cost of that is one
/// query nobody saved.
fn database_moved() -> bool {
    let mut stamp = lock(&READ_CACHE.stamp);
    if stamp.conn.is_none() {
        let Some(path) = stamp.path.clone() else {
            return true;
        };
        match Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        ) {
            Ok(conn) => stamp.conn = Some(conn),
            Err(e) => {
                log::warn!("veloqrs: [ReadCache] stamp connection to '{path}': {e:?}");
                return true;
            }
        }
    }

    let current: Option<i64> = stamp.conn.as_ref().and_then(|conn| {
        conn.query_row("PRAGMA data_version", [], |row| row.get(0))
            .ok()
    });
    let Some(current) = current else {
        return true;
    };

    let moved = stamp.seen != Some(current);
    stamp.seen = Some(current);
    moved
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tempfile::TempDir;

    /// Scenario: the map tab is read twice with nothing written in between,
    /// then read again after a sync commits.
    ///
    /// Expected behaviour: the second read is served from the cache without
    /// asking SQLite, and the commit drops it, so the third read sees what was
    /// written rather than what was remembered.
    #[test]
    fn a_cached_read_is_filled_once_and_dropped_by_a_commit() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().expect("tempdir");
        let path = dir.path().join("read_cache.db");
        let path = path.to_str().expect("utf-8").to_string();
        let writer = Connection::open(&path).expect("write connection");
        writer
            .pragma_update_and_check(None, "journal_mode", "WAL", |_| Ok(()))
            .expect("wal");
        writer
            .execute("CREATE TABLE sports (name TEXT)", [])
            .expect("create");
        writer
            .execute("INSERT INTO sports (name) VALUES ('Ride')", [])
            .expect("seed");
        bind(&path);

        let fills = AtomicUsize::new(0);
        let read = || {
            sport_types(|| {
                fills.fetch_add(1, Ordering::SeqCst);
                let mut stmt = writer
                    .prepare("SELECT name FROM sports ORDER BY name")
                    .expect("prepare");
                let rows = stmt.query_map([], |row| row.get(0)).expect("query");
                rows.flatten().collect()
            })
        };

        assert_eq!(read(), vec!["Ride".to_string()]);
        assert_eq!(fills.load(Ordering::SeqCst), 1);

        assert_eq!(read(), vec!["Ride".to_string()]);
        assert_eq!(
            fills.load(Ordering::SeqCst),
            1,
            "nothing committed, so the second read must not ask SQLite again"
        );

        writer
            .execute("INSERT INTO sports (name) VALUES ('Run')", [])
            .expect("write");

        assert_eq!(read(), vec!["Ride".to_string(), "Run".to_string()]);
        assert_eq!(
            fills.load(Ordering::SeqCst),
            2,
            "a commit must drop what was cached before it"
        );

        close();
    }

    /// A bind points the cache at a different database, so nothing the last
    /// one filled may be served for it.
    #[test]
    fn a_bind_drops_what_the_last_database_filled() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().expect("tempdir");
        let first = dir.path().join("first.db");
        let first = first.to_str().expect("utf-8").to_string();
        Connection::open(&first).expect("first");
        bind(&first);
        assert_eq!(sport_types(|| vec!["Ride".to_string()]), vec!["Ride"]);

        let second = dir.path().join("second.db");
        let second = second.to_str().expect("utf-8").to_string();
        Connection::open(&second).expect("second");
        bind(&second);

        assert_eq!(
            sport_types(Vec::new),
            Vec::<String>::new(),
            "the new database has to be asked, not the old one's answer served"
        );

        close();
    }
}
