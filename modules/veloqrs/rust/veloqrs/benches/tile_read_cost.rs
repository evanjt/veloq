//! What a tile read costs on the hit path now that vector tiles are kept as
//! the host gzipped them and decompressed on every read.
//!
//! A pan reads two dozen tiles at once, each on its own WebView thread, so one
//! read is bounded by one frame at 120 Hz, 8.3 ms. The tile is the
//! size of a measured z14 vector tile, 96,213 bytes decoded, built so that it
//! compresses by about the third that tile did (62,305 bytes gzipped).
//!
//! Run with: `cargo bench --bench tile_read_cost -p veloqrs`

use criterion::{Criterion, criterion_group, criterion_main};
use std::io::Write;
use tempfile::TempDir;
use veloqrs::basemap::TileStore;

const TILE_BYTES: usize = 96_213;

/// A protobuf that opens on its layers field, with five-bit noise for a body:
/// gzip at the default level takes it to about two thirds, as it did the
/// measured tile.
fn vector_tile() -> Vec<u8> {
    let mut out = vec![0x1a];
    let mut state: u32 = 0x5eed;
    while out.len() < TILE_BYTES {
        state = state.wrapping_mul(1_103_515_245).wrapping_add(12_345);
        out.push((state >> 24) as u8 & 0x1f);
    }
    out
}

fn gzip(bytes: &[u8]) -> Vec<u8> {
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(bytes).expect("gzip");
    encoder.finish().expect("gzip")
}

fn bench_tile_read(c: &mut Criterion) {
    let tile = vector_tile();
    let sent = gzip(&tile);
    let tmp = TempDir::new().expect("tempdir");
    let store = TileStore::new(tmp.path().join("basemap-tiles"));
    store
        .put("vector", 14, 1, 1, "pbf", &tile, false)
        .expect("put");
    store
        .put("vector", 14, 1, 2, "pbf", &sent, false)
        .expect("put");
    eprintln!(
        "tile {} bytes, kept gzipped {} bytes ({:.0} %)",
        tile.len(),
        sent.len(),
        100.0 * sent.len() as f64 / tile.len() as f64
    );

    let mut group = c.benchmark_group("tile_read");
    group.bench_function("kept_plain", |b| {
        b.iter(|| store.get("vector", 14, 1, 1).expect("hit"))
    });
    group.bench_function("kept_gzipped", |b| {
        b.iter(|| store.get("vector", 14, 1, 2).expect("hit"))
    });
    group.finish();
}

criterion_group!(benches, bench_tile_read);
criterion_main!(benches);
