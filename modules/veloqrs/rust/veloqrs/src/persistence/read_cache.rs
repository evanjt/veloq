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
    /// Weighed by curve bytes, since one long route's curves outweigh a
    /// screenful of performance results.
    lap_curves: Mutex<LapCurveSlot>,
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
    /// The map's section overlay, every line encoded. Building it decodes and
    /// re-encodes the whole catalogue, and the map asks again each time the
    /// layer is shown, so a slot holds it until something commits.
    map_sections: Mutex<Option<Arc<Vec<crate::FfiMapSection>>>>,
}

/// How many signatures to keep. The feed draws a screenful and the athlete
/// scrolls back over the same cards, so a couple of hundred covers a session's
/// worth without holding a library of blobs in memory.
const SIGNATURE_CAPACITY: usize = 200;

/// How many section performance results to keep. The insights batch asks for
/// a screenful of sections at once, and each result carries every traversal,
/// so this is a screenful and not a library.
const PERFORMANCE_CAPACITY: usize = 32;

/// How many bytes of lap curves to keep. One long route ridden fifty times
/// carries about 0.9 MB of curves, so this holds the open screen and the few
/// before it rather than a session's browsing.
const LAP_CURVE_BUDGET: usize = 4 * 1024 * 1024;

/// The curve data an entry holds: four bytes for each point of every lap's
/// delta and split delta, which is all that grows with the route.
fn lap_curve_bytes(curves: &Option<crate::FfiSectionLapCurves>) -> usize {
    let Some(curves) = curves else { return 0 };
    [&curves.forward, &curves.reverse]
        .into_iter()
        .flatten()
        .flat_map(|direction| &direction.laps)
        .map(|lap| (lap.delta_secs.len() + lap.split_delta_secs.len()) * size_of::<f32>())
        .sum()
}

type LapCurves = Arc<Option<crate::FfiSectionLapCurves>>;

/// Lap curves by key, least recent evicted first until what is held fits
/// [`LAP_CURVE_BUDGET`]. The entry just put is never evicted, so a screen
/// whose curves alone outweigh the budget is still served, held by itself.
struct LapCurveSlot {
    entries: LruCache<String, (LapCurves, usize)>,
    bytes: usize,
}

impl LapCurveSlot {
    fn new() -> Self {
        Self {
            entries: LruCache::unbounded(),
            bytes: 0,
        }
    }
}

/// A keyed slot [`cached_by_key`] can serve from.
trait KeyedSlot<V> {
    fn get(&mut self, key: &str) -> Option<&Arc<V>>;
    fn put(&mut self, key: String, value: Arc<V>);
    fn clear(&mut self);
}

impl<V> KeyedSlot<V> for LruCache<String, Arc<V>> {
    fn get(&mut self, key: &str) -> Option<&Arc<V>> {
        LruCache::get(self, key)
    }
    fn put(&mut self, key: String, value: Arc<V>) {
        LruCache::put(self, key, value);
    }
    fn clear(&mut self) {
        LruCache::clear(self);
    }
}

impl KeyedSlot<Option<crate::FfiSectionLapCurves>> for LapCurveSlot {
    fn get(&mut self, key: &str) -> Option<&LapCurves> {
        self.entries.get(key).map(|(value, _)| value)
    }
    fn put(&mut self, key: String, value: LapCurves) {
        let weight = lap_curve_bytes(&value);
        if let Some((_, old)) = self.entries.put(key, (value, weight)) {
            self.bytes -= old;
        }
        self.bytes += weight;
        while self.bytes > LAP_CURVE_BUDGET && self.entries.len() > 1 {
            let Some((_, (_, evicted))) = self.entries.pop_lru() else {
                break;
            };
            self.bytes -= evicted;
        }
    }
    fn clear(&mut self) {
        self.entries.clear();
        self.bytes = 0;
    }
}

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
    lap_curves: Mutex::new(LapCurveSlot::new()),
    sections: Mutex::new(LruCache::new(
        NonZeroUsize::new(32).expect("a cache with no room is a bug"),
    )),
    named_overlay: Mutex::new(None),
    split_lineage: Mutex::new(None),
    map_sections: Mutex::new(None),
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
    *lock(&READ_CACHE.map_sections) = None;
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

/// Give memory back when the OS asks for it: the stamp connection's page
/// cache always, and every cached value at the hard level, where a recompute on
/// the next read is worth the memory.
pub(crate) fn release_memory(hard: bool) {
    if let Some(conn) = lock(&READ_CACHE.stamp).conn.as_ref() {
        super::release_connection_memory(conn, "ReadCache");
    }
    if hard {
        clear();
    }
}

/// Forget the database and everything held for it when the engine closes.
pub(crate) fn close() {
    clear();
    *lock(&READ_CACHE.stamp) = Stamp::default();
}

/// The database state a read on `conn` is answered in, as a number that moves
/// whenever anything commits and never repeats while the process lives.
///
/// A caller that read a layer under one stamp and is handed the same stamp
/// again holds that layer still: no commit has landed in between, and a bind
/// to another database moves it too. `None` when the cache cannot vouch for
/// `conn`, so no read on it can be skipped.
///
/// Take it before the rows it stamps. A commit after it then moves the next
/// stamp, so the rows are never older than the stamp they are held under.
pub fn stamp(conn: &Connection) -> Option<u64> {
    if !serves(conn) {
        return None;
    }
    cache_generation()
}

/// The map's section overlay, cached until the database moves.
pub fn map_sections(
    conn: &Connection,
    fill: impl FnOnce() -> Vec<crate::FfiMapSection>,
) -> Arc<Vec<crate::FfiMapSection>> {
    cached(conn, &READ_CACHE.map_sections, || Arc::new(fill()))
}

/// The sports the map filter offers, cached until the database moves.
pub fn sport_types(conn: &Connection, fill: impl FnOnce() -> Vec<String>) -> Vec<String> {
    cached(conn, &READ_CACHE.sport_types, fill)
}

/// One section's performances under one sport filter, cached until the
/// database moves.
///
/// An empty result is cached like any other: a section with no traversals is a
/// real answer, and the next detect that gives it one moves the stamp.
pub fn performances(
    conn: &Connection,
    key: &str,
    fill: impl FnOnce() -> crate::SectionPerformanceResult,
) -> Arc<crate::SectionPerformanceResult> {
    cached_by_key(conn, &READ_CACHE.performances, key, fill)
}

/// One section's lap delta curves under one sport filter, cached until the
/// database moves. `None` is an answer like any other: a section with no lap
/// to compare stays so until a write moves the stamp.
pub fn lap_curves(
    conn: &Connection,
    key: &str,
    fill: impl FnOnce() -> Option<crate::FfiSectionLapCurves>,
) -> Arc<Option<crate::FfiSectionLapCurves>> {
    cached_by_key(conn, &READ_CACHE.lap_curves, key, fill)
}

/// One route's or section's lap delta curves if they are held for the
/// database as it stands, without computing them. `None` when they are not
/// held, or when the cache cannot vouch for `conn`.
pub fn held_lap_curves(
    conn: &Connection,
    key: &str,
) -> Option<Arc<Option<crate::FfiSectionLapCurves>>> {
    if !serves(conn) {
        return None;
    }
    let generation = cache_generation()?;
    let mut cache = lock(&READ_CACHE.lap_curves);
    if !generation_current(generation) {
        return None;
    }
    cache.get(key).map(Arc::clone)
}

/// The bytes of curve data the lap-curve slot holds.
#[cfg(test)]
fn held_bytes() -> usize {
    lock(&READ_CACHE.lap_curves).bytes
}

/// Serve one keyed entry, filling it on a miss, under the same rules as
/// [`cached`].
fn cached_by_key<V>(
    conn: &Connection,
    slot: &Mutex<impl KeyedSlot<V>>,
    key: &str,
    fill: impl FnOnce() -> V,
) -> Arc<V> {
    if !serves(conn) {
        return Arc::new(fill());
    }
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
    conn: &Connection,
    section_id: &str,
    fill: impl FnOnce() -> Option<tracematch::FrequentSection>,
) -> Option<Arc<tracematch::FrequentSection>> {
    if !serves(conn) {
        return fill().map(Arc::new);
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
    conn: &Connection,
    fill: impl FnOnce() -> crate::persistence::sections::named::NamedOverlay,
) -> Arc<crate::persistence::sections::named::NamedOverlay> {
    if !serves(conn) {
        return Arc::new(fill());
    }
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
    conn: &Connection,
    fill: impl FnOnce() -> crate::persistence::sections::numbers::SplitLineage,
) -> Arc<crate::persistence::sections::numbers::SplitLineage> {
    if !serves(conn) {
        return Arc::new(fill());
    }
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
    conn: &Connection,
    activity_id: &str,
    fill: impl FnOnce() -> Option<RouteSignature>,
) -> Option<Arc<RouteSignature>> {
    if !serves(conn) {
        return fill().map(Arc::new);
    }
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
fn cached<T: Clone>(conn: &Connection, slot: &Mutex<Option<T>>, fill: impl FnOnce() -> T) -> T {
    if !serves(conn) {
        return fill();
    }
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

/// Whether this cache may answer a read on `conn`, after dropping what it
/// holds if the bound database has moved.
///
/// Only a connection to the bound database is served. Everything here was
/// filled from that database's rows and is keyed by ids alone, so a read on
/// any other database, an engine opened apart from the pool or one held in
/// memory, would be answered with another library's rows. Such a read goes
/// to its own database. The paths compared are the ones SQLite resolved for
/// each connection, which an in-memory database leaves empty.
fn serves(conn: &Connection) -> bool {
    if !super::read_pool::reader_current() {
        return false;
    }
    let mut stamp = lock(&READ_CACHE.stamp);
    let on_bound = stamp_connection(&mut stamp)
        .and_then(Connection::path)
        .is_some_and(|bound| !bound.is_empty() && conn.path() == Some(bound));
    if on_bound {
        database_moved_under(&mut stamp);
    }
    on_bound
}

/// The connection the stamp is read on, opened on first use after a bind.
fn stamp_connection(stamp: &mut Stamp) -> Option<&Connection> {
    if stamp.conn.is_none() {
        let path = stamp.path.clone()?;
        match Connection::open_with_flags(
            &path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        ) {
            Ok(conn) => stamp.conn = Some(conn),
            Err(e) => {
                log::warn!("veloqrs: [ReadCache] stamp connection to '{path}': {e:?}");
                return None;
            }
        }
    }
    stamp.conn.as_ref()
}

#[cfg(test)]
fn database_moved() -> bool {
    database_moved_under(&mut lock(&READ_CACHE.stamp))
}

/// Clear cached values before publishing a new database stamp.
///
/// A stamp that cannot be read is reported as moved: the honest answer to "is
/// this still current" with no way to ask is no, and the cost of that is one
/// query nobody saved.
fn database_moved_under(stamp: &mut Stamp) -> bool {
    let current: Option<i64> = stamp_connection(stamp).and_then(|conn| {
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
            sport_types(&writer, || {
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
        let first_conn = Connection::open(&first).expect("first");
        bind(&first);
        assert_eq!(
            sport_types(&first_conn, || vec!["Ride".to_string()]),
            vec!["Ride"]
        );

        let second = dir.path().join("second.db");
        let second = second.to_str().expect("utf-8").to_string();
        let second_conn = Connection::open(&second).expect("second");
        bind(&second);

        assert_eq!(
            sport_types(&second_conn, Vec::new),
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
                sport_types(conn, || {
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
                sport_types(conn, || {
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
                sport_types(conn, || {
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
                sport_types(conn, || {
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
                sport_types(conn, || {
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
                sport_types(conn, || {
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
                sport_types(conn, || {
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
            sport_types(conn, || {
                vec![
                    conn.query_row("SELECT name FROM sports", [], |row| row.get(0))
                        .unwrap(),
                ]
            })
        });
        assert_eq!(current.unwrap(), vec!["new"], "old reader filled new cache");
        read_pool::close();
    }

    fn long_route_curves(laps: usize, points: usize) -> crate::FfiSectionLapCurves {
        crate::FfiSectionLapCurves {
            grid_step_m: 10.0,
            split_step_m: 1000.0,
            section_length_m: points as f64 * 10.0,
            forward: Some(crate::FfiDirectionDeltas {
                reference_activity_id: "lap-0".to_string(),
                reference_source: crate::FfiReferenceSource::Record,
                laps: (0..laps)
                    .map(|i| crate::FfiLapDelta {
                        activity_id: format!("lap-{i}"),
                        start_index: 0,
                        activity_date: i as f64,
                        delta_secs: vec![0.0; points].into(),
                        split_delta_secs: vec![0.0; points / 100].into(),
                        end_delta_secs: Some(0.0),
                    })
                    .collect(),
                missing: Vec::new(),
                peak_delta_secs: 0.0,
            }),
            reverse: None,
        }
    }

    /// Scenario: one session opens 33 long, often-ridden routes in turn, each
    /// carrying about 0.8 MB of lap curves, with nothing written between.
    ///
    /// Expected behaviour: the slot holds no more curve data than its budget,
    /// and the route opened last is still served without recomputing.
    #[test]
    fn lap_curves_are_held_within_a_byte_budget() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("read_cache.db");
        Connection::open(&path)
            .unwrap()
            .execute_batch("CREATE TABLE t (x INTEGER)")
            .unwrap();
        read_pool::bind(path.to_str().unwrap());

        let one = lap_curve_bytes(&Some(long_route_curves(50, 4_000)));
        assert!(one > 780_000, "each entry is about 0.8 MB, got {one}");
        for i in 0..33 {
            read_pool::with_read_conn(|conn| {
                lap_curves(conn, &format!("route:trail-{i}"), || {
                    Some(long_route_curves(50, 4_000))
                })
            })
            .unwrap();
            assert!(
                held_bytes() <= LAP_CURVE_BUDGET,
                "after {} routes the slot holds {} bytes",
                i + 1,
                held_bytes()
            );
        }
        let newest =
            read_pool::with_read_conn(|conn| held_lap_curves(conn, "route:trail-32")).unwrap();
        assert!(newest.is_some(), "the route just opened must stay held");
        let oldest =
            read_pool::with_read_conn(|conn| held_lap_curves(conn, "route:trail-0")).unwrap();
        assert!(oldest.is_none(), "the first route must have been evicted");
        read_pool::close();
    }

    /// Scenario: a single route's curves outweigh the whole budget.
    ///
    /// Expected behaviour: they are still held, alone, so the screen that
    /// asked keeps being served; anything held before them is evicted.
    #[test]
    fn an_entry_over_the_budget_is_held_alone() {
        let _serial = crate::test_globals::serial_global_state();
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("read_cache.db");
        Connection::open(&path)
            .unwrap()
            .execute_batch("CREATE TABLE t (x INTEGER)")
            .unwrap();
        read_pool::bind(path.to_str().unwrap());

        let read = |key: &str, laps: usize| {
            read_pool::with_read_conn(|conn| {
                lap_curves(conn, key, || Some(long_route_curves(laps, 4_000)))
            })
            .unwrap()
        };
        read("route:short", 2);
        read("route:none", 0);
        read("route:huge", 400);
        let held = |key: &str| {
            read_pool::with_read_conn(|conn| held_lap_curves(conn, key))
                .unwrap()
                .is_some()
        };
        assert!(held("route:huge"));
        assert!(!held("route:short"));
        assert!(!held("route:none"));
        read("route:short", 2);
        assert!(held("route:short"));
        assert!(
            !held("route:huge"),
            "the oversize entry gives way to the next"
        );
        read_pool::close();
    }
}
