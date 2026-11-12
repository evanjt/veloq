//! Browsers linked to this phone, and the phone's own identity.
//!
//! The one owner of which peers may read the library remotely. A peer is
//! allowed only while its certificate fingerprint has a row here: pairing
//! adds the row, removing it unlinks the device, and the remote service asks
//! `is_pinned` before it answers anything.

use rusqlite::{Connection, OptionalExtension, Result as SqlResult, params};

/// A browser linked to this phone.
#[derive(Debug, Clone, PartialEq, serde::Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
#[uniffi(name = "FfiLinkedDevice")]
pub struct LinkedDevice {
    pub id: String,
    /// What the browser called itself when it was linked.
    pub name: String,
    /// Unix seconds when it was linked.
    pub created_at: f64,
    /// Unix seconds of its last connection, none before the first.
    pub last_seen_at: Option<f64>,
    /// Unix seconds when its current connection came up, none while it is not
    /// connected.
    pub connected_since: Option<f64>,
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

/// Every pinned fingerprint, so the phone can wait for each linked browser.
pub fn fingerprints(conn: &Connection) -> SqlResult<Vec<String>> {
    conn.prepare_cached("SELECT fingerprint FROM linked_devices ORDER BY id")?
        .query_map([], |row| row.get(0))?
        .collect()
}

/// The Unix seconds a connection came up, from the connections that are up
/// now, keyed by fingerprint. When one browser holds two, the earlier.
pub fn connected_since(connections: &[(String, i64)], fingerprint: &str) -> Option<f64> {
    connections
        .iter()
        .find(|(connected, _)| connected == fingerprint)
        .map(|(_, since)| *since as f64)
}

/// Every linked device, most recently linked first, each with when its
/// current connection came up according to `connections`.
pub fn list(conn: &Connection, connections: &[(String, i64)]) -> SqlResult<Vec<LinkedDevice>> {
    conn.prepare_cached(
        "SELECT id, fingerprint, name, created_at, last_seen_at FROM linked_devices
         ORDER BY created_at DESC, id DESC",
    )?
    .query_map([], |row| {
        let fingerprint: String = row.get(1)?;
        Ok(LinkedDevice {
            id: row.get::<_, i64>(0)?.to_string(),
            connected_since: connected_since(connections, &fingerprint),
            name: row.get(2)?,
            created_at: row.get::<_, i64>(3)? as f64,
            last_seen_at: row.get::<_, Option<i64>>(4)?.map(|at| at as f64),
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

/// The id of the device pinned by a fingerprint.
pub fn id_of(conn: &Connection, fingerprint: &str) -> SqlResult<Option<String>> {
    conn.prepare_cached("SELECT id FROM linked_devices WHERE fingerprint = ?1")?
        .query_row(params![fingerprint], |row| row.get::<_, i64>(0))
        .optional()
        .map(|id| id.map(|id| id.to_string()))
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

/// How many writes the log keeps.
pub const WRITE_LOG_ROWS: i64 = 200;

/// One write a linked browser made, as the athlete reads it.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteWrite {
    pub device_id: String,
    /// The protocol method, such as `section.rename`.
    pub method: String,
    /// What the write changed: a section id, for a section rename.
    pub target_id: String,
    /// The write in words, naming its target and its new value.
    pub summary: String,
    /// Unix seconds.
    pub at: f64,
}

/// Log one write made by the browser pinned by `fingerprint`, and keep only
/// the last [`WRITE_LOG_ROWS`] rows. A fingerprint with no linked device
/// logs nothing.
pub fn record_write(
    conn: &Connection,
    fingerprint: &str,
    method: &str,
    target_id: &str,
    summary: &str,
    now: i64,
) -> SqlResult<()> {
    let logged = conn
        .prepare_cached(
            "INSERT INTO remote_writes (device_id, method, target_id, summary, at)
             SELECT id, ?2, ?3, ?4, ?5 FROM linked_devices WHERE fingerprint = ?1",
        )?
        .execute(params![fingerprint, method, target_id, summary, now])?;
    if logged > 0 {
        conn.prepare_cached(
            "DELETE FROM remote_writes WHERE id <=
                (SELECT id FROM remote_writes ORDER BY id DESC LIMIT 1 OFFSET ?1)",
        )?
        .execute(params![WRITE_LOG_ROWS])?;
    }
    Ok(())
}

/// The most recent writes one linked device made, newest first.
pub fn recent_writes(
    conn: &Connection,
    device_id: &str,
    limit: u32,
) -> SqlResult<Vec<RemoteWrite>> {
    let Ok(device) = device_id.parse::<i64>() else {
        return Ok(Vec::new());
    };
    conn.prepare_cached(
        "SELECT device_id, method, target_id, summary, at FROM remote_writes
         WHERE device_id = ?1 ORDER BY id DESC LIMIT ?2",
    )?
    .query_map(params![device, limit], |row| {
        Ok(RemoteWrite {
            device_id: row.get::<_, i64>(0)?.to_string(),
            method: row.get(1)?,
            target_id: row.get(2)?,
            summary: row.get(3)?,
            at: row.get::<_, i64>(4)? as f64,
        })
    })?
    .collect()
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

#[cfg(test)]
mod tests {
    use super::connected_since;

    #[test]
    fn a_connected_browser_reads_when_its_connection_came_up() {
        let up = vec![
            ("aa".to_owned(), 1_700_000_100),
            ("bb".to_owned(), 1_700_000_200),
        ];
        assert_eq!(connected_since(&up, "bb"), Some(1_700_000_200.0));
    }

    #[test]
    fn a_browser_with_no_open_connection_reads_none() {
        let up = vec![("aa".to_owned(), 1_700_000_100)];
        assert_eq!(connected_since(&up, "cc"), None);
        assert_eq!(connected_since(&[], "aa"), None);
    }

    #[test]
    fn a_browser_with_two_open_connections_reads_the_earlier() {
        let up = vec![
            ("aa".to_owned(), 1_700_000_100),
            ("aa".to_owned(), 1_700_000_300),
        ];
        assert_eq!(connected_since(&up, "aa"), Some(1_700_000_100.0));
    }
}
