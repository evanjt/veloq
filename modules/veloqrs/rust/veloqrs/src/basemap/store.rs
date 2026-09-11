//! The tile tree and its per-source sidecar index.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};

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

/// A `<source>/<z>/<x>/<y>.<ext>` tile tree Rust owns.
///
/// Satellite, vector and terrain DEM share the tree and are separated by the
/// leading source directory, so each carries its own budget without three
/// stores to wire up.
#[derive(Debug)]
pub struct TileStore {
    root: PathBuf,
    sources: Mutex<HashMap<String, SourceIndex>>,
    /// The read clock for the whole tree. Seeded from the highest clock any
    /// sidecar carries as each is loaded, and written back into every sidecar
    /// it stamps, so it survives a restart without a file of its own.
    clock: AtomicU64,
}

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
        }
    }

    /// The next read stamp, from the clock the whole tree shares.
    fn next_stamp(&self) -> u64 {
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
            return None;
        }
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
                index.sidecar.clock = stamp;
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
    /// A satellite raster is drawn and dropped rather than kept, so this
    /// reports success without writing anything. See [`is_kept_offline`].
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
        if !is_kept_offline(source) {
            return Ok(());
        }
        let key = tile_key(z, x, y);
        let path = self.tile_path(source, z, x, y, ext);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        write_atomically(&path, bytes)?;

        let stamp = self.next_stamp();
        let mut sources = self.lock();
        let index = self.index_for(&mut sources, source);
        // A tile re-stored under a different extension leaves its old file
        // behind, which the index would then never count or evict.
        if let Some(previous) = index.sidecar.entries.get(&key) {
            if previous.ext != ext {
                let _ = std::fs::remove_file(self.tile_path(source, z, x, y, &previous.ext));
            }
        }
        index.sidecar.clock = stamp;
        index.sidecar.entries.insert(
            key,
            Entry {
                ext: ext.to_string(),
                bytes: bytes.len() as u64,
                stamp,
                pinned,
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
        Ok(())
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
    pub fn clear(&self) -> io::Result<u32> {
        let mut removed = 0;
        for source in self.sources_on_disk() {
            removed += self.clear_source(&source)?;
        }
        match std::fs::remove_dir_all(&self.root) {
            Ok(()) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
        self.lock().clear();
        Ok(removed)
    }

    /// Drop every tile of one source and leave the others standing.
    pub fn clear_source(&self, source: &str) -> io::Result<u32> {
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

    /// Bring one source under `budget` bytes, least recently read first.
    ///
    /// Opportunistic tiles are scrubbed before the pinned pre-seed, so
    /// browsing elsewhere cannot cost the athlete the ground they downloaded.
    /// The budget is still a hard cap: once nothing opportunistic is left, the
    /// oldest pinned tiles go too, because the store must never be the reason
    /// a device runs out of storage.
    /// Bring the whole tree under one byte budget, least recently read first
    /// across every source and the pinned pre-seed last.
    ///
    /// One pool rather than a share each: a share protects a quiet source's
    /// stale tiles from a busy source's fresh ones, which is the opposite of
    /// what an athlete with one number in settings asked for.
    pub fn evict_to(&self, budget: u64) -> io::Result<u32> {
        let sources_on_disk = self.sources_on_disk();
        let mut sources = self.lock();

        // (source, key, pinned, stamp, bytes) for the whole tree, oldest read
        // first and every pinned tile behind every opportunistic one.
        let mut order: Vec<(String, String, bool, u64, u64)> = Vec::new();
        let mut total: u64 = 0;
        for source in &sources_on_disk {
            let index = self.index_for(&mut sources, source);
            for (key, entry) in &index.sidecar.entries {
                total += entry.bytes;
                order.push((
                    source.clone(),
                    key.clone(),
                    entry.pinned,
                    entry.stamp,
                    entry.bytes,
                ));
            }
        }
        if total <= budget {
            return Ok(0);
        }
        order.sort_by(|a, b| (a.2, a.3).cmp(&(b.2, b.3)));

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
        if let Ok(entries) = std::fs::read_dir(&self.root) {
            for entry in entries.flatten() {
                if !entry.path().is_dir() {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().to_string();
                if !sources.contains(&name) {
                    sources.push(name);
                }
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

/// Install `bytes` at `path` through a temp file and a rename, so a kill
/// mid-write leaves the previous file rather than a truncated one.
fn write_atomically(path: &Path, bytes: &[u8]) -> io::Result<()> {
    // The counter keeps two writers of the same tile off each other's temp
    // file, which would otherwise interleave into one truncated rename.
    static NEXT_TEMP: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let ticket = NEXT_TEMP.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let temp = path.with_extension(format!(
        "{}.{}.tmp",
        path.extension().and_then(|e| e.to_str()).unwrap_or(""),
        ticket
    ));
    std::fs::write(&temp, bytes)?;
    match std::fs::rename(&temp, path) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = std::fs::remove_file(&temp);
            Err(e)
        }
    }
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
