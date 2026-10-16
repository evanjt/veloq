//! The deep heatmap tiles, drawn on request, held under a byte budget.
//!
//! The pass draws the shallow zooms for the whole library and the deep ones
//! are drawn when the map asks for a tile, so what the deep zooms hold grows
//! with the ground the athlete has looked at. This index is what bounds it:
//! each deep tile's bytes on disk and when it was last read, held in memory so
//! a read costs no file write. A draw that takes the total over the budget
//! removes the tiles read longest ago, and an evicted tile is drawn again on
//! its next request.
//!
//! The bound is enforced where a deep tile is written, the one place the set
//! grows, rather than by a call someone has to remember to make.

use std::collections::HashMap;
use std::fs::Metadata;
use std::ops::RangeInclusive;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::tiles;

type TileKey = (u8, u32, u32);

/// The share of the budget an eviction brings the total down to, so the draw
/// after it does not evict again.
const EVICT_TO_PERCENT: u64 = 90;

/// The block a file system that reports no blocks for a small file is taken
/// to round it up to.
const BLOCK: u64 = 4096;

/// One deep tile held: its PNG and empty marker together, as one tile.
#[derive(Debug, Clone, Copy)]
struct Held {
    bytes: u64,
    last_read: u128,
}

/// The deep tiles of one tile set, with the total they hold on disk.
#[derive(Debug)]
pub(super) struct DeepTileIndex {
    dir: PathBuf,
    held: HashMap<TileKey, Held>,
    total: u64,
    /// The latest last read given out, so two reads in one clock tick, or a
    /// clock stepped back, still order.
    clock: u128,
}

impl DeepTileIndex {
    /// Walk the deep zooms of `dir`, taking each tile's modified time as its
    /// last read.
    pub(super) fn seed(dir: &Path, zooms: RangeInclusive<u8>) -> Self {
        let mut index = Self {
            dir: dir.to_path_buf(),
            held: HashMap::new(),
            total: 0,
            clock: 0,
        };
        for z in zooms {
            let Ok(columns) = std::fs::read_dir(dir.join(z.to_string())) else {
                continue;
            };
            for column in columns.flatten() {
                let Ok(x) = column.file_name().to_string_lossy().parse::<u32>() else {
                    continue;
                };
                let Ok(rows) = std::fs::read_dir(column.path()) else {
                    continue;
                };
                for row in rows.flatten() {
                    let name = row.file_name();
                    let name = name.to_string_lossy();
                    let Some((stem, extension)) = name.rsplit_once('.') else {
                        continue;
                    };
                    if extension != "png" && extension != tiles::EMPTY_MARKER_EXT {
                        continue;
                    }
                    let (Ok(y), Ok(meta)) = (stem.parse::<u32>(), row.metadata()) else {
                        continue;
                    };
                    let modified = meta
                        .modified()
                        .ok()
                        .and_then(|at| at.duration_since(UNIX_EPOCH).ok())
                        .map_or(0, |at| at.as_nanos());
                    let entry = index.held.entry((z, x, y)).or_insert(Held {
                        bytes: 0,
                        last_read: 0,
                    });
                    entry.bytes += bytes_on_disk(&meta);
                    entry.last_read = entry.last_read.max(modified);
                    index.total += bytes_on_disk(&meta);
                    index.clock = index.clock.max(modified);
                }
            }
        }
        index
    }

    fn tick(&mut self) -> u128 {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |at| at.as_nanos());
        self.clock = now.max(self.clock + 1);
        self.clock
    }

    /// A held tile was read.
    pub(super) fn read(&mut self, key: TileKey) {
        let now = self.tick();
        if let Some(held) = self.held.get_mut(&key) {
            held.last_read = now;
        }
    }

    /// A tile was written holding `bytes` on disk, and read by the draw that
    /// wrote it. A redraw replaces what the tile held before.
    pub(super) fn drawn(&mut self, key: TileKey, bytes: u64) {
        let last_read = self.tick();
        if let Some(old) = self.held.insert(key, Held { bytes, last_read }) {
            self.total -= old.bytes;
        }
        self.total += bytes;
    }

    /// When the total is over `budget`, the tiles to remove, read longest ago
    /// first, until it is at or under [`EVICT_TO_PERCENT`] of it. `keep` is
    /// never one of them: it is the tile just served. The returned tiles are
    /// no longer counted.
    pub(super) fn evict(&mut self, budget: u64, keep: TileKey) -> Vec<TileKey> {
        if self.total <= budget {
            return Vec::new();
        }
        let target = budget.saturating_mul(EVICT_TO_PERCENT) / 100;
        let mut oldest: Vec<(u128, TileKey)> = self
            .held
            .iter()
            .filter(|(key, _)| **key != keep)
            .map(|(key, held)| (held.last_read, *key))
            .collect();
        oldest.sort_unstable();
        let mut gone = Vec::new();
        for (_, key) in oldest {
            if self.total <= target {
                break;
            }
            if let Some(held) = self.held.remove(&key) {
                self.total -= held.bytes;
                gone.push(key);
            }
        }
        gone
    }

    #[cfg(test)]
    fn total(&self) -> u64 {
        self.total
    }
}

/// The bytes a file holds on disk: its allocated blocks, not its length. A
/// file system that keeps a small file inside its inode reports no blocks for
/// it, so the length rounded up to a block is the floor.
fn bytes_on_disk(meta: &Metadata) -> u64 {
    let rounded = meta.len().div_ceil(BLOCK) * BLOCK;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        (meta.blocks() * 512).max(rounded)
    }
    #[cfg(not(unix))]
    {
        rounded
    }
}

/// The bytes a tile's PNG and empty marker hold on disk.
fn tile_bytes(dir: &Path, (z, x, y): TileKey) -> u64 {
    [
        tile_path(dir, (z, x, y), "png"),
        tile_path(dir, (z, x, y), tiles::EMPTY_MARKER_EXT),
    ]
    .iter()
    .filter_map(|path| std::fs::metadata(path).ok())
    .map(|meta| bytes_on_disk(&meta))
    .sum()
}

fn tile_path(dir: &Path, (z, x, y): TileKey, extension: &str) -> PathBuf {
    dir.join(z.to_string())
        .join(x.to_string())
        .join(format!("{y}.{extension}"))
}

/// The index of the tile set the map reads, seeded on first use. One set is
/// served at a time, so one index is held.
static DEEP_TILES: Mutex<Option<DeepTileIndex>> = Mutex::new(None);

fn deep_tiles() -> MutexGuard<'static, Option<DeepTileIndex>> {
    DEEP_TILES.lock().unwrap_or_else(|e| e.into_inner())
}

/// The index of `dir`, walked from the tree when none is held for it. The
/// walk holds the lock, so a read that arrives meanwhile waits for it once.
fn index_for<'a>(
    held: &'a mut Option<DeepTileIndex>,
    dir: &Path,
    zooms: RangeInclusive<u8>,
) -> &'a mut DeepTileIndex {
    if held.as_ref().is_none_or(|index| index.dir != dir) {
        *held = Some(DeepTileIndex::seed(dir, zooms));
    }
    held.as_mut().expect("seeded above")
}

/// Walk `dir` into the index now, so the first tile the map asks for does not
/// wait on it.
pub(super) fn seed(dir: &Path, zooms: RangeInclusive<u8>) {
    index_for(&mut deep_tiles(), dir, zooms);
}

/// Drop the index, for a tree that was cleared or opened again. The next use
/// walks the tree as it then stands.
pub(super) fn forget() {
    *deep_tiles() = None;
}

/// The map read a deep tile the set holds.
pub(super) fn tile_read(dir: &Path, zooms: RangeInclusive<u8>, key: TileKey) {
    index_for(&mut deep_tiles(), dir, zooms).read(key);
}

/// A deep tile was written: count it, and when that takes the set over
/// `budget`, remove the tiles read longest ago.
///
/// A tile a sweep deleted is still counted until it is drawn again or
/// evicted, so the total can overstate the disk and never understates it.
pub(super) fn tile_drawn(dir: &Path, zooms: RangeInclusive<u8>, key: TileKey, budget: u64) {
    let mut held = deep_tiles();
    let index = index_for(&mut held, dir, zooms);
    index.drawn(key, tile_bytes(dir, key));
    for gone in index.evict(budget, key) {
        for extension in ["png", tiles::EMPTY_MARKER_EXT] {
            match std::fs::remove_file(tile_path(dir, gone, extension)) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => log::warn!("[heatmap] Could not evict a deep tile: {e}"),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    const ZOOMS: RangeInclusive<u8> = 15..=17;

    /// A 2 KB tile, one block on disk.
    fn write_tile(dir: &Path, key: TileKey, modified: u64) {
        tiles::save_tile(dir, key.0, key.1, key.2, &[7u8; 2048]).expect("tile");
        let file = std::fs::File::options()
            .write(true)
            .open(tile_path(dir, key, "png"))
            .expect("open");
        file.set_modified(UNIX_EPOCH + Duration::from_secs(modified))
            .expect("mtime");
    }

    #[test]
    fn a_seeded_index_evicts_by_modified_time_down_to_ninety_percent() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let dir = tmp.path();
        for k in 0..10u32 {
            write_tile(dir, (16, 100, k), 1_000 + u64::from(k));
        }
        tiles::save_tile(dir, 14, 1, 1, &[7u8; 2048]).expect("shallow tile");
        let mut index = DeepTileIndex::seed(dir, ZOOMS);
        assert_eq!(
            index.total(),
            10 * BLOCK,
            "the shallow zooms are not counted"
        );

        index.drawn((17, 1, 1), BLOCK);
        let gone = index.evict(10 * BLOCK, (17, 1, 1));

        assert_eq!(gone, vec![(16, 100, 0), (16, 100, 1)]);
        assert_eq!(index.total(), 9 * BLOCK);
    }

    #[test]
    fn a_read_moves_a_tile_behind_the_rest_and_the_tile_served_is_never_evicted() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let dir = tmp.path();
        for k in 0..4u32 {
            write_tile(dir, (16, 100, k), 1_000 + u64::from(k));
        }
        let mut index = DeepTileIndex::seed(dir, ZOOMS);
        index.read((16, 100, 0));

        // Over a budget smaller than the tile kept, everything else goes.
        let gone = index.evict(BLOCK / 2, (16, 100, 1));

        assert_eq!(gone, vec![(16, 100, 2), (16, 100, 3), (16, 100, 0)]);
        assert_eq!(index.total(), BLOCK);
    }

    #[test]
    fn a_redraw_replaces_what_the_tile_held() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let mut index = DeepTileIndex::seed(tmp.path(), ZOOMS);
        index.drawn((15, 1, 1), BLOCK);
        index.drawn((15, 1, 1), 2 * BLOCK);
        index.drawn((15, 1, 1), 0);
        assert_eq!(index.total(), 0);
        assert!(index.evict(0, (15, 2, 2)).is_empty());
    }

    #[test]
    fn under_the_budget_nothing_is_evicted() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let dir = tmp.path();
        write_tile(dir, (16, 1, 1), 1_000);
        let mut index = DeepTileIndex::seed(dir, ZOOMS);
        assert!(index.evict(BLOCK, (16, 9, 9)).is_empty());
        assert_eq!(index.total(), BLOCK);
    }
}
