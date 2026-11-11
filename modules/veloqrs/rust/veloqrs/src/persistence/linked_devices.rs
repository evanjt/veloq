//! Browsers linked to this phone, and the phone's own identity.
//!
//! The one owner of which peers may read the library remotely. A peer is
//! allowed only while its certificate fingerprint has a row here: pairing
//! adds the row, removing it unlinks the device, and the remote service asks
//! `is_pinned` before it answers anything.

use rusqlite::{Connection, OptionalExtension, Result as SqlResult, params};

/// A browser linked to this phone.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
#[uniffi(name = "FfiLinkedDevice")]
pub struct LinkedDevice {
    pub id: String,
    /// What the browser called itself when it was linked.
    pub name: String,
    /// Unix seconds when it was linked.
    pub created_at: f64,
    /// Unix seconds of its last connection, none before the first.
    pub last_seen_at: Option<f64>,
}

/// Link a device by its certificate fingerprint, or rename it when that
/// fingerprint is already linked. Returns its id.
pub fn add(conn: &Connection, name: &str, fingerprint: &str, now: i64) -> SqlResult<String> {
    conn.prepare_cached(
        "INSERT INTO linked_devices (fingerprint, name, created_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(fingerprint) DO UPDATE SET name = excluded.name",
    )?
    .execute(params![fingerprint, name, now])?;
    conn.prepare_cached("SELECT id FROM linked_devices WHERE fingerprint = ?1")?
        .query_row(params![fingerprint], |row| row.get::<_, i64>(0))
        .map(|id| id.to_string())
}

/// Every linked device, most recently linked first.
/// Every pinned fingerprint, so the phone can wait for each linked browser.
pub fn fingerprints(conn: &Connection) -> SqlResult<Vec<String>> {
    conn.prepare_cached("SELECT fingerprint FROM linked_devices ORDER BY id")?
        .query_map([], |row| row.get(0))?
        .collect()
}

pub fn list(conn: &Connection) -> SqlResult<Vec<LinkedDevice>> {
    conn.prepare_cached(
        "SELECT id, name, created_at, last_seen_at FROM linked_devices
         ORDER BY created_at DESC, id DESC",
    )?
    .query_map([], |row| {
        Ok(LinkedDevice {
            id: row.get::<_, i64>(0)?.to_string(),
            name: row.get(1)?,
            created_at: row.get::<_, i64>(2)? as f64,
            last_seen_at: row.get::<_, Option<i64>>(3)?.map(|at| at as f64),
        })
    })?
    .collect()
}

/// The certificate fingerprint a linked device was pinned by.
pub fn fingerprint_of(conn: &Connection, id: &str) -> SqlResult<Option<String>> {
    let Ok(id) = id.parse::<i64>() else {
        return Ok(None);
    };
    conn.prepare_cached("SELECT fingerprint FROM linked_devices WHERE id = ?1")?
        .query_row(params![id], |row| row.get(0))
        .optional()
}

/// Unlink a device. Returns whether one was removed.
pub fn remove(conn: &Connection, id: &str) -> SqlResult<bool> {
    let Ok(id) = id.parse::<i64>() else {
        return Ok(false);
    };
    let removed = conn
        .prepare_cached("DELETE FROM linked_devices WHERE id = ?1")?
        .execute(params![id])?;
    Ok(removed > 0)
}

/// Whether a peer with this certificate fingerprint is a linked device.
pub fn is_pinned(conn: &Connection, fingerprint: &str) -> SqlResult<bool> {
    conn.prepare_cached("SELECT 1 FROM linked_devices WHERE fingerprint = ?1")?
        .query_row(params![fingerprint], |_| Ok(()))
        .optional()
        .map(|found| found.is_some())
}

/// Record a linked device's connection time.
pub fn touch(conn: &Connection, fingerprint: &str, now: i64) -> SqlResult<()> {
    conn.prepare_cached("UPDATE linked_devices SET last_seen_at = ?2 WHERE fingerprint = ?1")?
        .execute(params![fingerprint, now])?;
    Ok(())
}

/// The phone's stored certificate, none before the remote service first ran.
pub fn identity(conn: &Connection) -> SqlResult<Option<Vec<u8>>> {
    conn.prepare_cached("SELECT certificate FROM remote_identity WHERE id = 1")?
        .query_row([], |row| row.get(0))
        .optional()
}

/// Keep the phone's certificate, unless one is kept already: a browser that
/// pinned the first must still recognise the phone.
pub fn store_identity_if_absent(conn: &Connection, certificate: &[u8]) -> SqlResult<()> {
    conn.prepare_cached("INSERT OR IGNORE INTO remote_identity (id, certificate) VALUES (1, ?1)")?
        .execute(params![certificate])?;
    Ok(())
}
