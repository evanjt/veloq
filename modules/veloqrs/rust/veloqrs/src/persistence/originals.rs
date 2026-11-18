//! Where a ride's original bytes live.
//!
//! The decoded rows are lossy: the decoder reads some of a file's messages and
//! quantises what it keeps. A ride no connector can serve again (an imported
//! file, a recording, a library with no account) has no other copy of its
//! original, so the file is kept here, deflated, beside the rows decoded from
//! it. `ride_originals` holds one row per activity key and nothing else reads
//! or writes it.
//!
//! The body is inflated and checked against its `sha256` on every read, so a
//! damaged row answers `None` rather than a wrong file.

use std::io::{Read, Write};

use flate2::Compression;
use flate2::read::DeflateDecoder;
use flate2::write::DeflateEncoder;
use rusqlite::{Connection, OptionalExtension, Result as SqlResult, params};

use crate::remote::digest::sha256;

/// Deflate level of the stored body.
const LEVEL: u32 = 9;

pub(crate) fn deflate(bytes: &[u8]) -> std::io::Result<Vec<u8>> {
    let mut encoder = DeflateEncoder::new(Vec::new(), Compression::new(LEVEL));
    encoder.write_all(bytes)?;
    encoder.finish()
}

/// Keep `bytes` as the original of `key`, replacing the one before. `source`
/// names where the ride came from and `format` what the bytes are (`"fit"`).
pub fn keep_original(
    conn: &Connection,
    key: &str,
    source: &str,
    format: &str,
    bytes: &[u8],
    kept_at: i64,
) -> SqlResult<()> {
    let body = deflate(bytes).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
    let digest = sha256(&[bytes]);
    conn.execute(
        "INSERT OR REPLACE INTO ride_originals
            (activity_id, source, format, raw_len, sha256, body, kept_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            key,
            source,
            format,
            bytes.len() as i64,
            digest.as_slice(),
            body,
            kept_at
        ],
    )?;
    Ok(())
}

/// A kept original as it is stored: the deflated body with what a reader needs
/// to check and place it, so a writer can copy the body without compressing it
/// again.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredOriginal {
    /// Where the ride came from, as kept.
    pub source: String,
    /// The length of the file once inflated.
    pub raw_len: u64,
    /// CRC-32 of the inflated file.
    pub crc32: u32,
    /// The raw deflate stream, as stored.
    pub body: Vec<u8>,
}

/// Inflate `body` and hold it to the length and digest kept beside it.
fn verified(key: &str, raw_len: i64, digest: &[u8], body: &[u8]) -> Option<Vec<u8>> {
    let mut bytes = Vec::with_capacity(usize::try_from(raw_len).unwrap_or(0));
    if DeflateDecoder::new(body).read_to_end(&mut bytes).is_err()
        || bytes.len() as i64 != raw_len
        || sha256(&[bytes.as_slice()]).as_slice() != digest
    {
        log::warn!("veloqrs: [originals] The kept original of {key} does not match its digest");
        return None;
    }
    Some(bytes)
}

/// The original of `key`, inflated. `None` when none is kept, or when the
/// stored body no longer inflates to the bytes that were kept.
pub fn original_of(conn: &Connection, key: &str) -> SqlResult<Option<Vec<u8>>> {
    let row = conn
        .prepare_cached("SELECT raw_len, sha256, body FROM ride_originals WHERE activity_id = ?1")?
        .query_row(params![key], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, Vec<u8>>(1)?,
                r.get::<_, Vec<u8>>(2)?,
            ))
        })
        .optional()?;
    let Some((raw_len, digest, body)) = row else {
        return Ok(None);
    };
    Ok(verified(key, raw_len, &digest, &body))
}

/// The original of `key` as stored, checked against its digest. `None` when
/// none is kept or the stored body does not match what was kept.
pub fn stored_original_of(conn: &Connection, key: &str) -> SqlResult<Option<StoredOriginal>> {
    let row = conn
        .prepare_cached(
            "SELECT source, raw_len, sha256, body FROM ride_originals WHERE activity_id = ?1",
        )?
        .query_row(params![key], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, Vec<u8>>(2)?,
                r.get::<_, Vec<u8>>(3)?,
            ))
        })
        .optional()?;
    let Some((source, raw_len, digest, body)) = row else {
        return Ok(None);
    };
    let Some(bytes) = verified(key, raw_len, &digest, &body) else {
        return Ok(None);
    };
    Ok(Some(StoredOriginal {
        source,
        raw_len: bytes.len() as u64,
        crc32: crc32fast::hash(&bytes),
        body,
    }))
}

/// Drop the original of `key`, if one is kept.
pub fn drop_original(conn: &Connection, key: &str) -> SqlResult<()> {
    conn.execute(
        "DELETE FROM ride_originals WHERE activity_id = ?1",
        params![key],
    )?;
    Ok(())
}

/// The bytes the kept originals take on disk, for the storage screen.
pub fn originals_bytes(conn: &Connection) -> SqlResult<i64> {
    conn.query_row(
        "SELECT COALESCE(SUM(length(body)), 0) FROM ride_originals",
        [],
        |r| r.get(0),
    )
}

#[cfg(test)]
#[path = "tests/originals.rs"]
mod tests;
