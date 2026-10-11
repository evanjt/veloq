//! How a tile is kept compared with how the map draws it.
//!
//! Tile hosts gzip vector tiles on the wire, about a third smaller than the
//! protobuf they decode to, so the store keeps the body as the host sent it
//! and every read decompresses it. The map is never handed a compressed body:
//! one served still gzipped renders blank, and no `Content-Encoding` header
//! reaches the page to say otherwise.
//!
//! Which bodies are compressed is read off the bytes, never the source or the
//! extension. Tiles kept before the store kept compressed bodies are plain and
//! sit beside compressed ones until eviction takes them, and no protobuf,
//! PNG, JPEG or WebP opens on the gzip magic.

use std::io::Read;

const GZIP_MAGIC: [u8; 2] = [0x1f, 0x8b];

/// Whether a body is a gzip stream.
pub(crate) fn is_gzip(bytes: &[u8]) -> bool {
    bytes.starts_with(&GZIP_MAGIC)
}

/// A gzip stream decompressed.
pub(crate) fn gunzip(bytes: &[u8]) -> std::io::Result<Vec<u8>> {
    let mut out = Vec::with_capacity(bytes.len() * 2);
    flate2::read::GzDecoder::new(bytes).read_to_end(&mut out)?;
    Ok(out)
}

/// A kept body as the map draws it, or `None` when it is a gzip stream that
/// does not decompress, which is no tile at all.
pub(crate) fn decode(bytes: Vec<u8>) -> Option<Vec<u8>> {
    if !is_gzip(&bytes) {
        return Some(bytes);
    }
    match gunzip(&bytes) {
        Ok(tile) => Some(tile),
        Err(e) => {
            log::warn!("[basemap] a kept tile did not decompress: {e}");
            None
        }
    }
}
