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
