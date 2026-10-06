//! The tile tree and its per-source sidecar index.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, Once};

use crate::atomic_file::write_atomically;

/// The sidecar beside each source's tree. Named so it cannot collide with a
/// zoom directory, which is always numeric.
const INDEX_FILE: &str = "index.json";

/// Bumped when the sidecar's shape changes. An index written by a different
/// version is discarded and rebuilt from the tree rather than misread.
const INDEX_VERSION: u32 = 1;

/// Tile reads and opportunistic writes before the sidecar goes back to disk.
/// Both are recoverable: a lost read costs eviction order for a handful of
/// tiles, and a lost write is rebuilt from the file that is already there.
/// Writing the whole sidecar per tile would cost a JSON encode on every pan.
const FLUSH_EVERY: u32 = 32;

/// What the index remembers about one tile. `stamp` is a logical clock rather
/// than a wall time: it only ever has to order reads, and a device whose clock
/// moves backwards would otherwise pin the wrong tiles at the front of the
/// eviction queue. The clock is the store's, not the source's, so a stamp
/// orders a tile against every other tile in the tree and not only against its
/// own source's.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Entry {
    ext: String,
    bytes: u64,
    stamp: u64,
    pinned: bool,
    /// Held over from a vector segment the source has since left. Served and
    /// evicted like an opportunistic tile, but never re-pinned in place, so the
    /// next pre-seed fetches the current segment's tile instead. Absent from a
    /// sidecar written before it existed, which reads as `false`.
    #[serde(default)]
    superseded: bool,
}

/// One source's sidecar, as it is written to disk.
#[derive(Debug, Default, Serialize, Deserialize)]
struct Sidecar {
    version: u32,
    clock: u64,
    entries: HashMap<String, Entry>,
}

/// One source's sidecar plus what is owed to disk.
#[derive(Debug, Default)]
struct SourceIndex {
    sidecar: Sidecar,
    dirty: bool,
    since_flush: u32,
}

/// How often one source was asked for a tile and how it was answered.
///
/// A satellite source never holds a tile on disk, so it counts fetches and
/// memory hits only: a miss there would read as the store failing when it is
/// doing what it is for.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TileCounts {
    pub hits: u64,
    pub misses: u64,
    pub fetches: u64,
}

/// One source's counts as the Developer Dashboard reads them.
///
/// The counts are `f64` because a `u64` crosses the binding as a bigint, which
/// the JavaScript side cannot add to a number.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct SourceTileCounts {
    pub source: String,
    pub hits: f64,
    pub misses: f64,
    pub fetches: f64,
}

/// A `<source>/<z>/<x>/<y>.<ext>` tile tree Rust owns.
///
/// Vector, ground and terrain DEM share the tree, separated by the leading
/// source directory, and share one byte budget under [`TileStore::evict_to`].
/// Satellite is never kept on disk: see [`is_kept_offline`]. It is held in a
/// bounded in-memory cache instead, see [`SatelliteCache`].
#[derive(Debug)]
pub struct TileStore {
    root: PathBuf,
    sources: Mutex<HashMap<String, SourceIndex>>,
    /// The read clock for the whole tree. Seeded from the highest clock any
    /// sidecar on disk carries before the first stamp is handed out, and
    /// written back into every sidecar it stamps, so it survives a restart
    /// without a file of its own.
    clock: AtomicU64,
    /// Whether the clock has been seeded from the sidecars on disk.
    seeded: Once,
    /// The ceiling the athlete set, in bytes. `NO_BUDGET` until one is handed
    /// over, which leaves the tree unbounded.
    budget: AtomicU64,
    /// Raised by every [`clear`](Self::clear), so a writer that began before
    /// one can tell its tiles are the ones the clear was meant to take.
    generation: AtomicU64,
    /// Reads and fetch-throughs since start or the last reset, per source.
    counts: Mutex<HashMap<String, TileCounts>>,
    /// Satellite rasters served this session, in memory only.
    satellite: Mutex<SatelliteCache>,
}

/// The bytes the satellite cache may hold before it evicts.
const SATELLITE_CACHE_CAP: u64 = 32 * 1024 * 1024;

/// A satellite raster's regional source and `z/x/y`.
type SatelliteKey = (String, u8, u32, u32);

/// A least-recently-used cache of satellite rasters, keyed on the regional
/// source and `z/x/y`.
///
/// It exists because one satellite preview renders twice and each render asks
/// for the same tiles. It is never written anywhere and is gone with the
/// process, so imagery still never reaches the offline pool on disk.
#[derive(Debug)]
struct SatelliteCache {
    cap: u64,
    bytes: u64,
    tick: u64,
    tiles: HashMap<SatelliteKey, (u64, Vec<u8>)>,
    /// Tick to key, so the oldest read is the first entry.
    order: BTreeMap<u64, SatelliteKey>,
}

impl SatelliteCache {
    fn new(cap: u64) -> Self {
        Self {
            cap,
            bytes: 0,
            tick: 0,
            tiles: HashMap::new(),
            order: BTreeMap::new(),
        }
    }

    fn get(&mut self, source: &str, z: u8, x: u32, y: u32) -> Option<Vec<u8>> {
        let key = (source.to_string(), z, x, y);
        let (old, bytes) = self.tiles.get(&key)?;
        let (old, bytes) = (*old, bytes.clone());
        self.tick += 1;
        self.order.remove(&old);
        self.order.insert(self.tick, key.clone());
        if let Some(entry) = self.tiles.get_mut(&key) {
            entry.0 = self.tick;
        }
        Some(bytes)
    }

    fn put(&mut self, source: &str, z: u8, x: u32, y: u32, bytes: &[u8]) {
        let key = (source.to_string(), z, x, y);
        self.remove(&key);
        let len = bytes.len() as u64;
        if len > self.cap {
            return;
        }
        while self.bytes + len > self.cap {
            let Some((&oldest, _)) = self.order.iter().next() else {
                break;
            };
            if let Some(gone) = self.order.remove(&oldest) {
                self.remove(&gone);
            }
        }
        self.tick += 1;
        self.order.insert(self.tick, key.clone());
        self.tiles.insert(key, (self.tick, bytes.to_vec()));
        self.bytes += len;
    }

    fn remove(&mut self, key: &SatelliteKey) {
        if let Some((tick, bytes)) = self.tiles.remove(key) {
            self.order.remove(&tick);
            self.bytes -= bytes.len() as u64;
        }
    }

    fn clear_source(&mut self, source: &str) {
        let going: Vec<_> = self
            .tiles
            .keys()
            .filter(|(s, ..)| s == source)
            .cloned()
            .collect();
        for key in going {
            self.remove(&key);
        }
    }

    fn clear(&mut self) {
        self.tiles.clear();
        self.order.clear();
        self.bytes = 0;
    }
}

/// What [`TileStore::budget`] holds before a budget is set.
const NO_BUDGET: u64 = u64::MAX;

/// The source prefix satellite imagery is served under, one per region.
const SATELLITE_PREFIX: &str = "satellite";

/// Whether a source's tiles are kept on disk at all.
///
/// Satellite rasters are not. Offline the map falls back to the vector
/// basemap, so imagery the athlete cannot reach with the radio off would only
/// spend the pool the vector basemap needs, and it is the heaviest source
/// there is: one city of imagery outweighs a country of vector tiles.
pub fn is_kept_offline(source: &str) -> bool {
    source != SATELLITE_PREFIX && !source.starts_with(&format!("{SATELLITE_PREFIX}-"))
}

impl TileStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self {
            root: root.into(),
            sources: Mutex::new(HashMap::new()),
            clock: AtomicU64::new(0),
            seeded: Once::new(),
            budget: AtomicU64::new(NO_BUDGET),
            generation: AtomicU64::new(0),
            counts: Mutex::new(HashMap::new()),
            satellite: Mutex::new(SatelliteCache::new(SATELLITE_CACHE_CAP)),
        }
    }

    /// Set the byte cap of the in-memory satellite cache.
    pub fn with_satellite_cache_cap(self, cap: u64) -> Self {
        *self.satellite_cache() = SatelliteCache::new(cap);
        self
    }

    fn satellite_cache(&self) -> std::sync::MutexGuard<'_, SatelliteCache> {
        self.satellite.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn count(&self, source: &str, bump: impl FnOnce(&mut TileCounts)) {
        let mut counts = self.counts.lock().unwrap_or_else(|e| e.into_inner());
        bump(counts.entry(source.to_string()).or_default());
    }

    /// Record a tile that was fetched from the host because the store did not
    /// hold it.
    pub fn record_fetch(&self, source: &str) {
        self.count(source, |c| c.fetches += 1);
    }

    /// One source's counts, zero for a source never asked for.
    pub fn tile_counts(&self, source: &str) -> TileCounts {
        let counts = self.counts.lock().unwrap_or_else(|e| e.into_inner());
        counts.get(source).copied().unwrap_or_default()
    }

    /// Every source's counts, ordered by source name.
    pub fn all_tile_counts(&self) -> Vec<(String, TileCounts)> {
        let counts = self.counts.lock().unwrap_or_else(|e| e.into_inner());
        let mut all: Vec<_> = counts.iter().map(|(s, c)| (s.clone(), *c)).collect();
        all.sort_by(|a, b| a.0.cmp(&b.0));
        all
    }

    /// Every source's counts for the dashboard table, ordered by source name.
    pub fn source_tile_counts(&self) -> Vec<SourceTileCounts> {
        self.all_tile_counts()
            .into_iter()
            .map(|(source, c)| SourceTileCounts {
                source,
                hits: c.hits as f64,
                misses: c.misses as f64,
                fetches: c.fetches as f64,
            })
            .collect()
    }

    /// Zero every counter.
    pub fn reset_tile_counts(&self) {
        self.counts
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
    }

    /// The count of clears so far. A long write pass reads it before it starts
    /// and stores through [`put_in_generation`](Self::put_in_generation), so a
    /// clear that lands mid-pass is not followed by tiles it took.
    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }

    /// The next read stamp, from the clock the whole tree shares.
    ///
    /// Sources load on first touch, so a clock raised only as each loads would
    /// stamp a read after a restart below tiles a source not yet loaded read
    /// in the last session. Every sidecar's clock is read once, before the
    /// first stamp, instead. It reads the files without the lock, since a
    /// caller may hold it.
    fn next_stamp(&self) -> u64 {
        self.seeded.call_once(|| {
            for source in sources_under(&self.root) {
                if let Some(clock) = sidecar_clock(&self.root, &source) {
                    self.clock.fetch_max(clock, Ordering::Relaxed);
                }
            }
        });
        self.clock.fetch_add(1, Ordering::Relaxed) + 1
    }

    /// Where the tree lives. The caller chose it, so it is worth reading back.
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The tile's bytes, or `None` when the store does not hold it. A hit
    /// moves the tile to the back of the eviction queue.
    ///
    /// The lock is dropped for the read, the way `put` drops it for the write.
    /// One mutex covers every source, and a map pan asks for dozens of tiles at
    /// once on as many threads, so holding it across the file read made every
    /// one of them queue behind the slowest.
    pub fn get(&self, source: &str, z: u8, x: u32, y: u32) -> Option<Vec<u8>> {
        if !is_kept_offline(source) {
            let found = self.satellite_cache().get(source, z, x, y);
            if found.is_some() {
                self.count(source, |c| c.hits += 1);
            }
            return found;
        }
        let found = self.get_counted(source, z, x, y);
        self.count(source, |c| {
            if found.is_some() {
                c.hits += 1
            } else {
                c.misses += 1
            }
        });
        found
    }

    fn get_counted(&self, source: &str, z: u8, x: u32, y: u32) -> Option<Vec<u8>> {
        let key = tile_key(z, x, y);
        let ext = {
            let mut sources = self.lock();
            let index = self.index_for(&mut sources, source);
            index.sidecar.entries.get(&key)?.ext.clone()
        };

        let path = self.tile_path(source, z, x, y, &ext);
        let read = std::fs::read(&path);

        let stamp = self.next_stamp();
        let mut sources = self.lock();
        let index = self.index_for(&mut sources, source);
        match read {
            Ok(bytes) => {
                index.sidecar.clock = index.sidecar.clock.max(stamp);
                if let Some(entry) = index.sidecar.entries.get_mut(&key) {
                    entry.stamp = stamp;
                    // A file the OS truncated under us is not the tile the
                    // index promised, so the byte count follows what was read.
                    entry.bytes = bytes.len() as u64;
                }
                index.dirty = true;
                index.since_flush += 1;
                if index.since_flush >= FLUSH_EVERY {
                    let _ = write_sidecar(&self.root, source, &index.sidecar);
                    index.dirty = false;
                    index.since_flush = 0;
                }
                Some(bytes)
            }
            Err(_) => {
                // The index outlived the file. Forget it rather than answer
                // with a tile that is not there, and stop counting its bytes.
                //
                // Only if it is still the same file: a `put` that landed while
                // the lock was down may have re-stored this key under another
                // extension, and forgetting that entry would strand the tile it
                // just wrote.
                let replaced = index
                    .sidecar
                    .entries
                    .get(&key)
                    .is_some_and(|entry| entry.ext != ext);
                if !replaced {
                    index.sidecar.entries.remove(&key);
                    index.dirty = true;
                }
                None
            }
        }
    }

    /// Store a tile. `pinned` marks the pre-seeded offline base, which is
    /// evicted only once every opportunistic tile is gone.
    ///
    /// A satellite raster is held in the in-memory cache and never written, so
    /// this reports success without touching the disk. See [`is_kept_offline`].
    // One tile's key, bytes and pin, as `put_tile` receives them over the FFI.
    #[allow(clippy::too_many_arguments)]
    pub fn put(
        &self,
        source: &str,
        z: u8,
        x: u32,
        y: u32,
        ext: &str,
        bytes: &[u8],
        pinned: bool,
    ) -> io::Result<()> {
        self.put_inner(None, source, z, x, y, ext, bytes, pinned)
            .map(|_| ())
    }

    /// [`put`](Self::put) for a writer that began at `generation`. Stores
    /// nothing, and answers `false`, when a clear has run since, and leaves no
    /// directory of the tile behind.
    #[allow(clippy::too_many_arguments)]
    pub fn put_in_generation(
        &self,
        generation: u64,
        source: &str,
        z: u8,
        x: u32,
        y: u32,
        ext: &str,
        bytes: &[u8],
        pinned: bool,
    ) -> io::Result<bool> {
        self.put_inner(Some(generation), source, z, x, y, ext, bytes, pinned)
    }

    #[allow(clippy::too_many_arguments)]
    fn put_inner(
        &self,
        generation: Option<u64>,
        source: &str,
        z: u8,
        x: u32,
        y: u32,
        ext: &str,
        bytes: &[u8],
        pinned: bool,
    ) -> io::Result<bool> {
        let stale = || generation.is_some_and(|began| began != self.generation());
        if !is_kept_offline(source) {
            let mut cache = self.satellite_cache();
            if stale() {
                return Ok(false);
            }
            cache.put(source, z, x, y, bytes);
            return Ok(true);
        }
        if stale() {
            return Ok(false);
        }
        let key = tile_key(z, x, y);
        let path = self.tile_path(source, z, x, y, ext);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        write_atomically(&path, bytes)?;

        let mut sources = self.lock();
        if stale() {
            drop(sources);
            let _ = std::fs::remove_file(&path);
            self.remove_empty_dirs_above(&path);
            return Ok(false);
        }
        // Loaded before the stamp is taken, so the stamp is newer than every
        // tile the source already holds.
        let index = self.index_for(&mut sources, source);
        let stamp = self.next_stamp();
        // A tile re-stored under a different extension leaves its old file
        // behind, which the index would then never count or evict.
        if let Some(previous) = index.sidecar.entries.get(&key)
            && previous.ext != ext
        {
            let _ = std::fs::remove_file(self.tile_path(source, z, x, y, &previous.ext));
        }
        index.sidecar.clock = index.sidecar.clock.max(stamp);
        index.sidecar.entries.insert(
            key,
            Entry {
                ext: ext.to_string(),
                bytes: bytes.len() as u64,
                stamp,
                pinned,
                superseded: false,
            },
        );
        index.dirty = true;
        index.since_flush += 1;
        // A pinned tile goes back to disk at once. Nothing in a plain tree
        // says a tile is pinned, so a sidecar lost before the next flush would
        // demote the pre-seed to opportunistic and evict it first.
        if pinned || index.since_flush >= FLUSH_EVERY {
            write_sidecar(&self.root, source, &index.sidecar)?;
            index.dirty = false;
            index.since_flush = 0;
        }
        drop(sources);
        // Every write, so no put leaves the tree over the ceiling. The tile is
        // already kept, and a tile that could not be evicted is not a reason
        // to refuse the one that was stored.
        if let Err(e) = self.enforce_budget() {
            log::warn!("[basemap] could not bring the store under its budget: {e}");
        }
        Ok(true)
    }

    /// Mark a tile the store already holds as part of the pinned pre-seed, and
    /// answer what it costs. `None` when the store does not hold it, or holds
    /// only a [superseded](Self::supersede) copy, which is the pre-seed's
    /// signal to fetch it. A superseded copy stays on disk and keeps serving
    /// until the fetch replaces it.
    ///
    /// The file is checked rather than taken on the sidecar's word, and an
    /// entry that outlived its file is forgotten the way a miss in [`get`]
    /// forgets one. A pre-seed that trusted the index would skip a tile that is
    /// not on disk and leave a hole nothing fills.
    ///
    /// [`get`]: Self::get
    pub fn pin(&self, source: &str, z: u8, x: u32, y: u32) -> Option<u64> {
        if !is_kept_offline(source) {
            return None;
        }
        let key = tile_key(z, x, y);
        // The lock is dropped for the stat, the way `get` drops it for the
        // read: one mutex covers every source, and a pan running beside the
        // pass should not queue behind it.
        let ext = {
            let mut sources = self.lock();
            let index = self.index_for(&mut sources, source);
            let entry = index.sidecar.entries.get(&key)?;
            if entry.superseded {
                return None;
            }
            entry.ext.clone()
        };
        let present = self.tile_path(source, z, x, y, &ext).exists();

        let mut sources = self.lock();
        let index = self.index_for(&mut sources, source);
        if !present {
            // Only if it is still the same file: a `put` that landed while the
            // lock was down may have re-stored this key under another
            // extension, and forgetting that entry would strand the tile.
            if index
                .sidecar
                .entries
                .get(&key)
                .is_some_and(|e| e.ext == ext)
            {
                index.sidecar.entries.remove(&key);
                index.dirty = true;
            }
            return None;
        }
        let entry = index.sidecar.entries.get_mut(&key)?;
        let bytes = entry.bytes;
        if entry.pinned {
            return Some(bytes);
        }
        entry.pinned = true;
        // Straight back to disk, for the reason `put` writes a pinned tile at
        // once: nothing in a plain tree says a tile is pinned, so a sidecar
        // lost before the next flush would demote the whole pre-seed.
        let _ = write_sidecar(&self.root, source, &index.sidecar);
        index.dirty = false;
        index.since_flush = 0;
        Some(bytes)
    }

    /// Return a source's former seed to ordinary eviction before rebuilding
    /// its ranked set under a possibly smaller budget.
    pub fn unpin_source(&self, source: &str) {
        let mut sources = self.lock();
        let index = self.index_for(&mut sources, source);
        for entry in index.sidecar.entries.values_mut() {
            if entry.pinned {
                entry.pinned = false;
                index.dirty = true;
            }
        }
    }

    /// Bytes held for one source. Zero for a source that holds nothing.
    pub fn size_of(&self, source: &str) -> u64 {
        let mut sources = self.lock();
        let index = self.index_for(&mut sources, source);
        index.sidecar.entries.values().map(|e| e.bytes).sum()
    }

    /// Bytes held across every source. Answered from the sidecars, so it needs
    /// no WebView and no network.
    pub fn size(&self) -> u64 {
        self.sources_on_disk()
            .iter()
            .map(|source| self.size_of(source))
            .sum()
    }

    /// Drop every tile in the store, pinned pre-seed included. Clear cache
    /// means clear cache.
    ///
    /// The root directory stays, emptied, so what the host set on it, the
    /// excluded-from-backup attribute, outlives the clear.
    pub fn clear(&self) -> io::Result<u32> {
        // Raised under the lock a put checks it beneath, so a put either lands
        // before the clear and is taken by it, or sees the new generation.
        self.generation.fetch_add(1, Ordering::SeqCst);
        drop(self.lock());
        self.satellite_cache().clear();
        let mut removed = 0;
        for source in self.sources_on_disk() {
            removed += self.clear_source(&source)?;
        }
        match std::fs::read_dir(&self.root) {
            Ok(entries) => {
                for entry in entries {
                    let path = entry?.path();
                    if path.is_dir() {
                        std::fs::remove_dir_all(&path)?;
                    } else {
                        std::fs::remove_file(&path)?;
                    }
                }
            }
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
        self.lock().clear();
        Ok(removed)
    }

    /// Remove the empty directories a tile path leaves, up to the root.
    fn remove_empty_dirs_above(&self, path: &Path) {
        let mut dir = path.parent();
        while let Some(d) = dir {
            if d == self.root || !d.starts_with(&self.root) || std::fs::remove_dir(d).is_err() {
                break;
            }
            dir = d.parent();
        }
    }

    /// Drop every tile of one source and leave the others standing.
    pub fn clear_source(&self, source: &str) -> io::Result<u32> {
        self.satellite_cache().clear_source(source);
        let removed = {
            let mut sources = self.lock();
            let index = self.index_for(&mut sources, source);
            let removed = index.sidecar.entries.len() as u32;
            index.sidecar.entries.clear();
            index.dirty = false;
            index.since_flush = 0;
            removed
        };
        match std::fs::remove_dir_all(self.root.join(source)) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
        self.lock().remove(source);
        Ok(removed)
    }

    /// Drop every tile of one source that is not part of the pinned pre-seed.
    /// Answers how many went.
    ///
    /// For a source whose segment changed, use [`supersede`](Self::supersede),
    /// which also demotes the pinned tiles.
    pub fn clear_opportunistic(&self, source: &str) -> io::Result<u32> {
        let mut sources = self.lock();
        let index = self.index_for(&mut sources, source);
        let going: Vec<(String, String)> = index
            .sidecar
            .entries
            .iter()
            .filter(|(_, entry)| !entry.pinned)
            .map(|(key, entry)| (key.clone(), entry.ext.clone()))
            .collect();
        for (key, ext) in &going {
            index.sidecar.entries.remove(key);
            if let Some((z, x, y)) = parse_tile_key(key) {
                let _ = std::fs::remove_file(self.tile_path(source, z, x, y, ext));
            }
        }
        if !going.is_empty() {
            write_sidecar(&self.root, source, &index.sidecar)?;
            index.dirty = false;
            index.since_flush = 0;
        }
        Ok(going.len() as u32)
    }

    /// A source's vector segment changed. Drop its opportunistic tiles, and
    /// demote its pinned ones to superseded: they keep serving until evicted
    /// or replaced, but [`pin`](Self::pin) no longer accepts them, so the next
    /// pre-seed fetches the current segment's tile in their place. A tile
    /// already superseded by an earlier change goes with the opportunistic
    /// ones. Answers how many tiles were dropped and how many demoted.
    pub fn supersede(&self, source: &str) -> io::Result<(u32, u32)> {
        let mut sources = self.lock();
        let index = self.index_for(&mut sources, source);
        let going: Vec<(String, String)> = index
            .sidecar
            .entries
            .iter()
            .filter(|(_, entry)| !entry.pinned)
            .map(|(key, entry)| (key.clone(), entry.ext.clone()))
            .collect();
        for (key, ext) in &going {
            index.sidecar.entries.remove(key);
            if let Some((z, x, y)) = parse_tile_key(key) {
                let _ = std::fs::remove_file(self.tile_path(source, z, x, y, ext));
            }
        }
        let mut demoted = 0;
        for entry in index.sidecar.entries.values_mut() {
            entry.pinned = false;
            entry.superseded = true;
            demoted += 1;
        }
        if !going.is_empty() || demoted > 0 {
            write_sidecar(&self.root, source, &index.sidecar)?;
            index.dirty = false;
            index.since_flush = 0;
        }
        Ok((going.len() as u32, demoted))
    }

    /// Drop every tile that is not part of the pinned pre-seed, across every
    /// source. What the athlete's Clear cache means: the pre-seed is the
    /// offline ground they asked to keep. Answers how many tiles went.
    pub fn clear_all_opportunistic(&self) -> io::Result<u32> {
        let mut removed = 0;
        for source in self.sources_on_disk() {
            removed += self.clear_opportunistic(&source)?;
        }
        Ok(removed)
    }

    /// Keep the tree under `bytes` from now on, and bring it under at once.
    /// Answers how many tiles went.
    ///
    /// Kept across a [`clear`](Self::clear): the ceiling is the athlete's
    /// setting, not something the tiles carry.
    pub fn set_budget(&self, bytes: u64) -> io::Result<u32> {
        self.budget.store(bytes, Ordering::Relaxed);
        self.evict_to(bytes)
    }

    /// The ceiling in force, or `None` when none has been set.
    pub fn budget(&self) -> Option<u64> {
        match self.budget.load(Ordering::Relaxed) {
            NO_BUDGET => None,
            bytes => Some(bytes),
        }
    }

    /// Bring the tree under the ceiling in force, if one is set and the tree
    /// is over it. Answers how many tiles went.
    pub fn enforce_budget(&self) -> io::Result<u32> {
        match self.budget() {
            Some(budget) => self.evict_to(budget),
            None => Ok(0),
        }
    }

    /// Bring the whole tree under one byte budget, least recently read first
    /// across every source and the pinned pre-seed last.
    ///
    /// One pool rather than a share each: a share protects a quiet source's
    /// stale tiles from a busy source's fresh ones, which is the opposite of
    /// what an athlete with one number in settings asked for. Opportunistic
    /// tiles are scrubbed before the pinned pre-seed, so browsing elsewhere
    /// cannot cost the athlete the ground they downloaded. The budget is still
    /// a hard cap: once nothing opportunistic is left, the oldest pinned tiles
    /// go too, because the store must never be the reason a device runs out
    /// of storage.
    pub fn evict_to(&self, budget: u64) -> io::Result<u32> {
        let sources_on_disk = self.sources_on_disk();
        let mut sources = self.lock();

        // Totalled before anything is ordered: every `put` asks, and a tree
        // under its budget should cost a sum and not a copy of every key.
        let mut total: u64 = 0;
        for source in &sources_on_disk {
            let index = self.index_for(&mut sources, source);
            total += index.sidecar.entries.values().map(|e| e.bytes).sum::<u64>();
        }
        if total <= budget {
            return Ok(0);
        }

        // (source, key, pinned, stamp, bytes) for the whole tree, oldest read
        // first and every pinned tile behind every opportunistic one.
        let mut order: Vec<(String, String, bool, u64, u64)> = Vec::new();
        for source in &sources_on_disk {
            let index = self.index_for(&mut sources, source);
            for (key, entry) in &index.sidecar.entries {
                order.push((
                    source.clone(),
                    key.clone(),
                    entry.pinned,
                    entry.stamp,
                    entry.bytes,
                ));
            }
        }
        order.sort_by_key(|a| (a.2, a.3));

        let mut removed = 0;
        let mut touched: Vec<String> = Vec::new();
        for (source, key, _, _, bytes) in order {
            if total <= budget {
                break;
            }
            let index = self.index_for(&mut sources, &source);
            let Some(entry) = index.sidecar.entries.remove(&key) else {
                continue;
            };
            index.dirty = true;
            if !touched.contains(&source) {
                touched.push(source.clone());
            }
            if let Some((z, x, y)) = parse_tile_key(&key) {
                let _ = std::fs::remove_file(self.tile_path(&source, z, x, y, &entry.ext));
            }
            total = total.saturating_sub(bytes);
            removed += 1;
        }

        for source in touched {
            let index = self.index_for(&mut sources, &source);
            write_sidecar(&self.root, &source, &index.sidecar)?;
            index.dirty = false;
            index.since_flush = 0;
        }
        Ok(removed)
    }

    /// Write back any read stamps the store is still holding in memory.
    pub fn flush(&self) -> io::Result<()> {
        let mut sources = self.lock();
        for (source, index) in sources.iter_mut() {
            if !index.dirty {
                continue;
            }
            write_sidecar(&self.root, source, &index.sidecar)?;
            index.dirty = false;
            index.since_flush = 0;
        }
        Ok(())
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<String, SourceIndex>> {
        self.sources.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn index_for<'a>(
        &self,
        sources: &'a mut HashMap<String, SourceIndex>,
        source: &str,
    ) -> &'a mut SourceIndex {
        if !sources.contains_key(source) {
            let loaded = load_or_rebuild(&self.root, source);
            // Seed the tree's clock past everything this sidecar already
            // holds, so a stamp handed out now is newer than any stamp on
            // disk. Sidecars written before the clock was the tree's carry
            // per-source stamps, which order their own source correctly and
            // each other only roughly: a tile read after the upgrade takes a
            // tree-wide stamp and the ordering repairs itself as it is used.
            self.clock
                .fetch_max(loaded.sidecar.clock, Ordering::Relaxed);
            sources.insert(source.to_string(), loaded);
        }
        sources
            .get_mut(source)
            .expect("the index was just inserted")
    }

    fn tile_path(&self, source: &str, z: u8, x: u32, y: u32, ext: &str) -> PathBuf {
        self.root
            .join(source)
            .join(z.to_string())
            .join(x.to_string())
            .join(format!("{}.{}", y, ext))
    }

    /// Every source directory under the root, whether or not it has been read
    /// into memory this session.
    fn sources_on_disk(&self) -> Vec<String> {
        let mut sources: Vec<String> = self.lock().keys().cloned().collect();
        for name in sources_under(&self.root) {
            if !sources.contains(&name) {
                sources.push(name);
            }
        }
        sources.sort();
        sources
    }
}

impl Drop for TileStore {
    fn drop(&mut self) {
        let _ = self.flush();
    }
}

/// Every source directory under `root`.
fn sources_under(root: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .collect()
}

/// The clock one source's sidecar carries, without reading its entries into
/// an index. `None` when there is no sidecar this version reads.
fn sidecar_clock(root: &Path, source: &str) -> Option<u64> {
    #[derive(Deserialize)]
    struct ClockOnly {
        version: u32,
        clock: u64,
    }
    let body = std::fs::read(root.join(source).join(INDEX_FILE)).ok()?;
    let sidecar: ClockOnly = serde_json::from_slice(&body).ok()?;
    (sidecar.version == INDEX_VERSION).then_some(sidecar.clock)
}

fn tile_key(z: u8, x: u32, y: u32) -> String {
    format!("{}/{}/{}", z, x, y)
}

fn parse_tile_key(key: &str) -> Option<(u8, u32, u32)> {
    let mut parts = key.split('/');
    let z = parts.next()?.parse().ok()?;
    let x = parts.next()?.parse().ok()?;
    let y = parts.next()?.parse().ok()?;
    Some((z, x, y))
}

fn write_sidecar(root: &Path, source: &str, sidecar: &Sidecar) -> io::Result<()> {
    let dir = root.join(source);
    std::fs::create_dir_all(&dir)?;
    let body = serde_json::to_vec(&Sidecar {
        version: INDEX_VERSION,
        clock: sidecar.clock,
        entries: sidecar.entries.clone(),
    })
    .map_err(io::Error::other)?;
    write_atomically(&dir.join(INDEX_FILE), &body)
}

/// Read a source's sidecar, or derive one by walking its tree.
///
/// A rebuild recovers the bytes and a plausible read order from file times,
/// but it cannot recover which tiles were pinned: nothing in a plain tree says
/// so. The pre-seed is therefore opportunistic until it is written again,
/// which is why seeding re-pins rather than skipping tiles it already holds.
fn load_or_rebuild(root: &Path, source: &str) -> SourceIndex {
    let path = root.join(source).join(INDEX_FILE);
    if let Ok(body) = std::fs::read(&path) {
        match serde_json::from_slice::<Sidecar>(&body) {
            Ok(sidecar) if sidecar.version == INDEX_VERSION => {
                return SourceIndex {
                    sidecar,
                    dirty: false,
                    since_flush: 0,
                };
            }
            Ok(_) => log::warn!(
                "[basemap] Sidecar for {} is a version we do not read",
                source
            ),
            Err(e) => log::warn!("[basemap] Sidecar for {} did not parse: {}", source, e),
        }
    }
    rebuild_from_tree(root, source)
}

fn rebuild_from_tree(root: &Path, source: &str) -> SourceIndex {
    let base = root.join(source);
    let mut found: Vec<(std::time::SystemTime, String, Entry)> = Vec::new();

    for (z, z_dir) in numbered_children(&base) {
        for (x, x_dir) in numbered_children(&z_dir) {
            let Ok(entries) = std::fs::read_dir(&x_dir) else {
                continue;
            };
            for entry in entries.flatten() {
                let path = entry.path();
                let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                    continue;
                };
                let Ok(y) = stem.parse::<u32>() else { continue };
                let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
                    continue;
                };
                let Ok(meta) = entry.metadata() else { continue };
                if !meta.is_file() {
                    continue;
                }
                let modified = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
                found.push((
                    modified,
                    tile_key(z, x, y),
                    Entry {
                        ext: ext.to_string(),
                        bytes: meta.len(),
                        stamp: 0,
                        pinned: false,
                        superseded: false,
                    },
                ));
            }
        }
    }

    // Oldest file first, so the read order a rebuild invents is at least the
    // order the tiles arrived in.
    found.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.cmp(&b.1)));

    let mut sidecar = Sidecar {
        version: INDEX_VERSION,
        clock: 0,
        entries: HashMap::with_capacity(found.len()),
    };
    for (_, key, mut entry) in found {
        sidecar.clock += 1;
        entry.stamp = sidecar.clock;
        sidecar.entries.insert(key, entry);
    }

    if sidecar.entries.is_empty() {
        return SourceIndex::default();
    }
    log::info!(
        "[basemap] Rebuilt the {} sidecar from {} tiles on disk",
        source,
        sidecar.entries.len()
    );
    SourceIndex {
        sidecar,
        dirty: true,
        since_flush: 0,
    }
}

/// Child directories whose name is a number, which is every level of a
/// `z/x/y` tree and nothing else the store writes.
fn numbered_children<T: std::str::FromStr>(dir: &Path) -> Vec<(T, PathBuf)> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            name.parse::<T>().ok().map(|n| (n, e.path()))
        })
        .collect()
}
