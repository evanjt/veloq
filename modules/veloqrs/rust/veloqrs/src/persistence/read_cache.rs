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
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard};

use lru::LruCache;
use rusqlite::{Connection, OpenFlags};
use tracematch::RouteSignature;

struct ReadCache {
    generation: AtomicU64,
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
    /// Section performances, by section and sport filter. The section detail
    /// screen asks for one and the insights batch asks for many in a row, and
    /// the answer is built from every traversal of the section, so this is the
    /// engine's `perf_cache` on the reader's side of the lock.
    performances: Mutex<LruCache<String, Arc<crate::SectionPerformanceResult>>>,
    /// Section lap delta curves, keyed as `performances` is and built from
    /// them. Each lap costs a track and a stream decode, and the section
    /// screen asks again on every time chip, which only filters this set.
    lap_curves: Mutex<LruCache<String, Arc<Option<crate::FfiSectionLapCurves>>>>,
    sections: Mutex<LruCache<String, Arc<tracematch::FrequentSection>>>,
    /// The corridors an athlete named, resolved onto the catalogue: the name
    /// per section and the corridor listing. One value for the whole library,
    /// and every pooled read that names a section or lists corridors wants
    /// it, so it is a slot rather than an LRU.
    named_overlay: Mutex<Option<Arc<crate::persistence::sections::named::NamedOverlay>>>,
    /// Each live split child's parent and part. Every pooled name read in a
    /// library holding an unnamed split child composes from it, and building
    /// it walks the whole ledger, so it is a slot like the overlay.
    split_lineage: Mutex<Option<Arc<crate::persistence::sections::numbers::SplitLineage>>>,
}

/// How many signatures to keep. The feed draws a screenful and the athlete
/// scrolls back over the same cards, so a couple of hundred covers a session's
/// worth without holding a library of blobs in memory.
const SIGNATURE_CAPACITY: usize = 200;

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
    generation: AtomicU64::new(0),
    stamp: Mutex::new(Stamp::default()),
    sport_types: Mutex::new(None),
    signatures: Mutex::new(LruCache::new(
        NonZeroUsize::new(SIGNATURE_CAPACITY).expect("a cache with no room is a bug"),
    )),
    performances: Mutex::new(LruCache::new(
        NonZeroUsize::new(PERFORMANCE_CAPACITY).expect("a cache with no room is a bug"),
    )),
    lap_curves: Mutex::new(LruCache::new(
        NonZeroUsize::new(PERFORMANCE_CAPACITY).expect("a cache with no room is a bug"),
    )),
    sections: Mutex::new(LruCache::new(
        NonZeroUsize::new(32).expect("a cache with no room is a bug"),
    )),
    named_overlay: Mutex::new(None),
    split_lineage: Mutex::new(None),
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
    #[cfg(test)]
    hold_clear();
    READ_CACHE.generation.fetch_add(1, Ordering::AcqRel);
    *lock(&READ_CACHE.sport_types) = None;
    lock(&READ_CACHE.signatures).clear();
    lock(&READ_CACHE.performances).clear();
    lock(&READ_CACHE.lap_curves).clear();
    lock(&READ_CACHE.sections).clear();
    *lock(&READ_CACHE.named_overlay) = None;
    *lock(&READ_CACHE.split_lineage) = None;
}

/// A clear on one thread, held before it empties anything, so a test can read
/// from another thread inside that window.
#[cfg(test)]
type ClearHold = (
    std::thread::ThreadId,
    std::sync::mpsc::Sender<()>,
    std::sync::mpsc::Receiver<()>,
);

#[cfg(test)]
static CLEAR_HOLD: Mutex<Option<ClearHold>> = Mutex::new(None);

/// Hold this thread's next clear until the receiver it returns is answered.
/// Scoped to the calling thread, so a clear any other test runs passes.
#[cfg(test)]
fn pause_next_clear_on_this_thread() -> (std::sync::mpsc::Receiver<()>, std::sync::mpsc::Sender<()>)
{
    let (entered_tx, entered_rx) = std::sync::mpsc::channel();
    let (resume_tx, resume_rx) = std::sync::mpsc::channel();
    *lock(&CLEAR_HOLD) = Some((std::thread::current().id(), entered_tx, resume_rx));
    (entered_rx, resume_tx)
}

#[cfg(test)]
fn hold_clear() {
    let hold = {
        let mut slot = lock(&CLEAR_HOLD);
        if slot
            .as_ref()
            .is_some_and(|(thread, _, _)| *thread == std::thread::current().id())
        {
            slot.take()
        } else {
            None
        }
    };
    if let Some((_, entered, resume)) = hold {
        let _ = entered.send(());
        let _ = resume.recv();
    }
}

fn cache_generation() -> Option<u64> {
    super::read_pool::reader_current().then(|| READ_CACHE.generation.load(Ordering::Acquire))
}

fn generation_current(generation: u64) -> bool {
    super::read_pool::reader_current()
        && READ_CACHE.generation.load(Ordering::Acquire) == generation
}

/// Forget the database and everything held for it when the engine closes.
pub(crate) fn close() {
    clear();
    *lock(&READ_CACHE.stamp) = Stamp::default();
}

/// The sports the map filter offers, cached until the database moves.
pub fn sport_types(fill: impl FnOnce() -> Vec<String>) -> Vec<String> {
    cached(&READ_CACHE.sport_types, fill)
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
    cached_by_key(&READ_CACHE.performances, key, fill)
}

/// One section's lap delta curves under one sport filter, cached until the
/// database moves. `None` is an answer like any other: a section with no lap
/// to compare stays so until a write moves the stamp.
pub fn lap_curves(
    key: &str,
    fill: impl FnOnce() -> Option<crate::FfiSectionLapCurves>,
) -> Arc<Option<crate::FfiSectionLapCurves>> {
    cached_by_key(&READ_CACHE.lap_curves, key, fill)
}

/// Serve one keyed entry, filling it on a miss, under the same rules as
/// [`cached`].
fn cached_by_key<V>(
    slot: &Mutex<LruCache<String, Arc<V>>>,
    key: &str,
    fill: impl FnOnce() -> V,
) -> Arc<V> {
    if !super::read_pool::reader_current() {
        return Arc::new(fill());
    }
    database_moved();
    let Some(generation) = cache_generation() else {
        return Arc::new(fill());
    };
    {
        let mut cache = lock(slot);
        if generation_current(generation)
            && let Some(hit) = cache.get(key)
        {
            return Arc::clone(hit);
        }
    }
    let value = Arc::new(fill());
    let mut cache = lock(slot);
    if generation_current(generation) {
        cache.put(key.to_string(), Arc::clone(&value));
    }
    value
}

/// One raw section, cached until the database moves. Names are overlaid only
/// after this read so a rename never bakes an old name into the value.
pub fn section(
    section_id: &str,
    fill: impl FnOnce() -> Option<tracematch::FrequentSection>,
) -> Option<Arc<tracematch::FrequentSection>> {
    if !super::read_pool::reader_current() {
        return fill().map(Arc::new);
    }
    if database_moved() {
        clear();
    }
    let generation = cache_generation()?;
    {
        let mut cache = lock(&READ_CACHE.sections);
        if generation_current(generation)
            && let Some(hit) = cache.get(section_id)
        {
            return Some(Arc::clone(hit));
        }
    }
    let value = Arc::new(fill()?);
    let mut cache = lock(&READ_CACHE.sections);
    if generation_current(generation) {
        cache.put(section_id.to_string(), Arc::clone(&value));
    }
    Some(value)
}

/// The resolved corridor overlay, cached until the database moves.
///
/// An empty overlay is cached like any other answer: a library with no named
/// intents is the common one, and the fill short-circuits it with a single
/// `EXISTS` probe rather than resolving a catalogue nobody has named.
pub fn named_overlay(
    fill: impl FnOnce() -> crate::persistence::sections::named::NamedOverlay,
) -> Arc<crate::persistence::sections::named::NamedOverlay> {
    if !super::read_pool::reader_current() {
        return Arc::new(fill());
    }
    database_moved();
    let Some(generation) = cache_generation() else {
        return Arc::new(fill());
    };
    {
        let cache = lock(&READ_CACHE.named_overlay);
        if generation_current(generation)
            && let Some(hit) = cache.as_ref()
        {
            return Arc::clone(hit);
        }
    }
    let value = Arc::new(fill());
    let mut cache = lock(&READ_CACHE.named_overlay);
    if generation_current(generation) {
        *cache = Some(Arc::clone(&value));
    }
    value
}

/// Each live split child's parent and part, cached until the database moves.
pub fn split_lineage(
    fill: impl FnOnce() -> crate::persistence::sections::numbers::SplitLineage,
) -> Arc<crate::persistence::sections::numbers::SplitLineage> {
    if !super::read_pool::reader_current() {
        return Arc::new(fill());
    }
    database_moved();
    let Some(generation) = cache_generation() else {
        return Arc::new(fill());
    };
    {
        let cache = lock(&READ_CACHE.split_lineage);
        if generation_current(generation)
            && let Some(hit) = cache.as_ref()
        {
            return Arc::clone(hit);
        }
    }
    let value = Arc::new(fill());
    let mut cache = lock(&READ_CACHE.split_lineage);
    if generation_current(generation) {
        *cache = Some(Arc::clone(&value));
    }
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
    if !super::read_pool::reader_current() {
        return fill().map(Arc::new);
    }
    database_moved();
    let Some(generation) = cache_generation() else {
        return fill().map(Arc::new);
    };
    {
        let mut cache = lock(&READ_CACHE.signatures);
        if generation_current(generation)
            && let Some(hit) = cache.get(activity_id)
        {
            return Some(Arc::clone(hit));
        }
    }
    let value = Arc::new(fill()?);
    let mut cache = lock(&READ_CACHE.signatures);
    if generation_current(generation) {
        cache.put(activity_id.to_string(), Arc::clone(&value));
    }
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
    if !super::read_pool::reader_current() {
        return fill();
    }
    database_moved();
    let Some(generation) = cache_generation() else {
        return fill();
    };
    {
        let cache = lock(slot);
        if generation_current(generation)
            && let Some(value) = cache.clone()
        {
            return value;
        }
    }
    let value = fill();
    let mut cache = lock(slot);
    if generation_current(generation) {
        *cache = Some(value.clone());
    }
    value
}

/// Clear cached values before publishing a new database stamp.
///
/// A stamp that cannot be read is reported as moved: the honest answer to "is
/// this still current" with no way to ask is no, and the cost of that is one
/// query nobody saved.
fn database_moved() -> bool {
    let mut stamp = lock(&READ_CACHE.stamp);
    if stamp.conn.is_none() {
        let Some(path) = stamp.path.clone() else {
            clear();
            return true;
        };
        match Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        ) {
            Ok(conn) => stamp.conn = Some(conn),
            Err(e) => {
                log::warn!("veloqrs: [ReadCache] stamp connection to '{path}': {e:?}");
                clear();
                return true;
            }
        }
    }

    let current: Option<i64> = stamp.conn.as_ref().and_then(|conn| {
        conn.query_row("PRAGMA data_version", [], |row| row.get(0))
            .ok()
    });
    let Some(current) = current else {
        clear();
        return true;
    };

    let moved = stamp.seen != Some(current);
    if moved {
        clear();
    }
    stamp.seen = Some(current);
    moved
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::read_pool;
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

    #[test]
    fn an_old_reader_cannot_repopulate_the_cache_after_rebind() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().unwrap();
        let old_path = dir.path().join("old.db");
        let new_path = dir.path().join("new.db");
        let old = Connection::open(&old_path).unwrap();
        let new = Connection::open(&new_path).unwrap();
        for (conn, name) in [(&old, "old"), (&new, "new")] {
            conn.execute("CREATE TABLE sports (name TEXT)", []).unwrap();
            conn.execute("INSERT INTO sports VALUES (?1)", [name])
                .unwrap();
        }
        let old_path = old_path.to_str().unwrap().to_string();
        let new_path = new_path.to_str().unwrap().to_string();
        read_pool::bind(&old_path);

        let (entered, held) = std::sync::mpsc::channel();
        let (release, resume) = std::sync::mpsc::channel();
        let reader = std::thread::spawn(move || {
            read_pool::with_read_conn(|conn| {
                sport_types(|| {
                    let name: String = conn
                        .query_row("SELECT name FROM sports", [], |row| row.get(0))
                        .unwrap();
                    entered.send(()).unwrap();
                    resume.recv().unwrap();
                    vec![name]
                })
            })
            .unwrap()
        });
        held.recv().unwrap();
        read_pool::close();
        read_pool::bind(&new_path);
        let read_new = || {
            read_pool::with_read_conn(|conn| {
                sport_types(|| {
                    vec![
                        conn.query_row("SELECT name FROM sports", [], |row| row.get(0))
                            .unwrap(),
                    ]
                })
            })
            .unwrap()
        };
        assert_eq!(read_new(), vec!["new"]);
        release.send(()).unwrap();
        assert_eq!(reader.join().unwrap(), vec!["old"]);
        assert_eq!(read_new(), vec!["new"], "old fill entered the new cache");
        read_pool::close();
    }

    #[test]
    fn a_fill_started_before_a_commit_cannot_replace_the_new_value() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("read_cache.db");
        let writer = Connection::open(&path).unwrap();
        writer
            .execute_batch("CREATE TABLE sports (name TEXT); INSERT INTO sports VALUES ('Ride')")
            .unwrap();
        let path = path.to_str().unwrap().to_string();
        read_pool::bind(&path);

        let (entered, held) = std::sync::mpsc::channel();
        let (release, resume) = std::sync::mpsc::channel();
        let old = std::thread::spawn(move || {
            read_pool::with_read_conn(|conn| {
                sport_types(|| {
                    let name = conn
                        .query_row("SELECT name FROM sports", [], |row| row.get(0))
                        .unwrap();
                    entered.send(()).unwrap();
                    resume.recv().unwrap();
                    vec![name]
                })
            })
            .unwrap()
        });
        held.recv().unwrap();
        writer
            .execute("INSERT INTO sports VALUES ('Run')", [])
            .unwrap();
        let read = || {
            read_pool::with_read_conn(|conn| {
                sport_types(|| {
                    conn.prepare("SELECT name FROM sports ORDER BY name")
                        .unwrap()
                        .query_map([], |row| row.get(0))
                        .unwrap()
                        .map(Result::unwrap)
                        .collect()
                })
            })
            .unwrap()
        };
        assert_eq!(read(), vec!["Ride", "Run"]);
        release.send(()).unwrap();
        assert_eq!(old.join().unwrap(), vec!["Ride"]);
        assert_eq!(read(), vec!["Ride", "Run"]);
        read_pool::close();
    }

    #[test]
    fn a_new_stamp_is_never_visible_with_a_precommit_cached_value() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("read_cache.db");
        let writer = Connection::open(&path).unwrap();
        writer
            .execute_batch("CREATE TABLE sports (name TEXT); INSERT INTO sports VALUES ('Ride')")
            .unwrap();
        let path = path.to_str().unwrap().to_string();
        read_pool::bind(&path);
        let read = || {
            read_pool::with_read_conn(|conn| {
                sport_types(|| {
                    conn.prepare("SELECT name FROM sports ORDER BY name")
                        .unwrap()
                        .query_map([], |row| row.get(0))
                        .unwrap()
                        .map(Result::unwrap)
                        .collect()
                })
            })
            .unwrap()
        };
        assert_eq!(read(), vec!["Ride"]);
        writer
            .execute("INSERT INTO sports VALUES ('Run')", [])
            .unwrap();

        assert!(database_moved());

        assert_eq!(read(), vec!["Ride", "Run"]);
        read_pool::close();
    }

    /// Scenario: a commit lands, and one thread's read notices the move and
    /// starts dropping the cache while another thread reads.
    ///
    /// Expected behaviour: the second reader never sees the new stamp beside
    /// the value cached before the commit. The clear runs before the stamp is
    /// published, both under the stamp lock, so the second reader either
    /// waits for the clear or sees the move itself.
    #[test]
    fn a_reader_racing_the_clear_never_gets_the_precommit_value() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("read_cache.db");
        let writer = Connection::open(&path).unwrap();
        writer
            .execute_batch("CREATE TABLE sports (name TEXT); INSERT INTO sports VALUES ('Ride')")
            .unwrap();
        let path = path.to_str().unwrap().to_string();
        read_pool::bind(&path);
        fn read() -> Vec<String> {
            read_pool::with_read_conn(|conn| {
                sport_types(|| {
                    conn.prepare("SELECT name FROM sports ORDER BY name")
                        .unwrap()
                        .query_map([], |row| row.get(0))
                        .unwrap()
                        .map(Result::unwrap)
                        .collect()
                })
            })
            .unwrap()
        }
        assert_eq!(read(), vec!["Ride"]);
        writer
            .execute("INSERT INTO sports VALUES ('Run')", [])
            .unwrap();

        let (armed_tx, armed_rx) = std::sync::mpsc::channel();
        let noticing = std::thread::spawn(move || {
            armed_tx.send(pause_next_clear_on_this_thread()).unwrap();
            read()
        });
        let (entered, resume) = armed_rx.recv().unwrap();
        entered
            .recv_timeout(std::time::Duration::from_secs(5))
            .expect("the noticing read reached its clear");

        let (racing_tx, racing_rx) = std::sync::mpsc::channel();
        let racing = std::thread::spawn(move || racing_tx.send(read()).unwrap());
        // A reader that is correctly held waits on the stamp lock until the
        // clear finishes, so this times out. One that is not answers at once.
        let early = racing_rx
            .recv_timeout(std::time::Duration::from_millis(500))
            .ok();
        resume.send(()).unwrap();
        let racing_read = early.unwrap_or_else(|| racing_rx.recv().unwrap());
        racing.join().unwrap();

        assert_eq!(
            racing_read,
            vec!["Ride", "Run"],
            "a read during the clear served the value cached before the commit"
        );
        assert_eq!(noticing.join().unwrap(), vec!["Ride", "Run"]);
        read_pool::close();
    }

    #[test]
    fn test_sport_types_rejects_old_reader_starting_after_rebind() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().unwrap();
        let old_path = dir.path().join("old.db");
        let new_path = dir.path().join("new.db");
        for (path, name) in [(&old_path, "old"), (&new_path, "new")] {
            let writer = Connection::open(path).unwrap();
            writer
                .execute("CREATE TABLE sports (name TEXT)", [])
                .unwrap();
            writer
                .execute("INSERT INTO sports VALUES (?1)", [name])
                .unwrap();
        }
        read_pool::bind(old_path.to_str().unwrap());

        let (entered, held) = std::sync::mpsc::channel();
        let (release, resume) = std::sync::mpsc::channel();
        let reader = std::thread::spawn(move || {
            read_pool::with_read_conn(|conn| {
                entered.send(()).unwrap();
                resume.recv().unwrap();
                sport_types(|| {
                    vec![
                        conn.query_row("SELECT name FROM sports", [], |row| row.get(0))
                            .unwrap(),
                    ]
                })
            })
            .unwrap()
        });
        held.recv().unwrap();
        read_pool::close();
        read_pool::bind(new_path.to_str().unwrap());
        release.send(()).unwrap();
        assert_eq!(reader.join().unwrap(), vec!["old"]);

        let current = read_pool::with_read_conn(|conn| {
            sport_types(|| {
                vec![
                    conn.query_row("SELECT name FROM sports", [], |row| row.get(0))
                        .unwrap(),
                ]
            })
        });
        assert_eq!(current.unwrap(), vec!["new"], "old reader filled new cache");
        read_pool::close();
    }
}
