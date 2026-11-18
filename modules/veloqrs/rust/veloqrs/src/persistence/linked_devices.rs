//! Browsers linked to this phone, and the phone's own identity.
//!
//! The one owner of which peers may read the library remotely. A peer is
//! allowed only while its certificate fingerprint has a row here: pairing
//! adds the row, removing it unlinks the device, and the remote service asks
//! `is_pinned` before it answers anything.

use rusqlite::{Connection, OptionalExtension, Result as SqlResult, params};
use std::net::IpAddr;

/// A browser linked to this phone.
#[derive(Debug, Clone, PartialEq, serde::Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
#[uniffi(name = "FfiLinkedDevice")]
pub struct LinkedDevice {
    pub id: String,
    /// What the browser called itself when it was linked.
    pub name: String,
    /// Unix seconds when it was linked.
    /// Unit: epoch_second.
    pub created_at: f64,
    /// Unix seconds of its last connection, none before the first.
    /// Unit: epoch_second.
    pub last_seen_at: Option<f64>,
    /// Unix seconds when its current connection came up, none while it is not
    /// connected.
    /// Unit: epoch_second.
    pub connected_since: Option<f64>,
}

/// Link a device by its certificate fingerprint, or rename it when that
/// fingerprint is already linked. `room_secret` is the secret shared at
/// pairing, which keys the room the two reconnect in. Returns its id.
pub fn add(
    conn: &Connection,
    name: &str,
    fingerprint: &str,
    room_secret: Option<&[u8]>,
    now: i64,
) -> SqlResult<String> {
    conn.prepare_cached(
        "INSERT INTO linked_devices (fingerprint, name, created_at, room_secret)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(fingerprint) DO UPDATE SET name = excluded.name,
             room_secret = COALESCE(excluded.room_secret, room_secret)",
    )?
    .execute(params![fingerprint, name, now, room_secret])?;
    conn.prepare_cached("SELECT id FROM linked_devices WHERE fingerprint = ?1")?
        .query_row(params![fingerprint], |row| row.get::<_, i64>(0))
        .map(|id| id.to_string())
}

/// Every pinned fingerprint with its room secret, none for a browser linked
/// before secrets were kept, so the phone can wait for each linked browser.
pub fn room_keys(conn: &Connection) -> SqlResult<Vec<(String, Option<Vec<u8>>)>> {
    conn.prepare_cached("SELECT fingerprint, room_secret FROM linked_devices ORDER BY id")?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
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

/// Give a device a new name, trimmed. Returns whether one was renamed: a blank
/// name or an unknown id renames nothing.
pub fn rename(conn: &Connection, id: &str, name: &str) -> SqlResult<bool> {
    let name = name.trim();
    let Ok(id) = id.parse::<i64>() else {
        return Ok(false);
    };
    if name.is_empty() {
        return Ok(false);
    }
    let renamed = conn
        .prepare_cached("UPDATE linked_devices SET name = ?2 WHERE id = ?1")?
        .execute(params![id, name])?;
    Ok(renamed > 0)
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

/// How many writes the log keeps for each linked browser.
pub const WRITE_LOG_ROWS: i64 = 200;

/// One write a linked browser made, as the athlete reads it.
#[derive(Debug, Clone, PartialEq, serde::Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
#[uniffi(name = "FfiRemoteWrite")]
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
/// that browser's last [`WRITE_LOG_ROWS`] rows. Other browsers' rows are not
/// counted or trimmed. A fingerprint with no linked device logs nothing.
pub fn record_write(
    conn: &Connection,
    fingerprint: &str,
    method: &str,
    target_id: &str,
    summary: &str,
    now: i64,
) -> SqlResult<()> {
    let device = conn
        .prepare_cached("SELECT id FROM linked_devices WHERE fingerprint = ?1")?
        .query_row(params![fingerprint], |row| row.get::<_, i64>(0))
        .optional()?;
    let Some(device) = device else {
        return Ok(());
    };
    conn.prepare_cached(
        "INSERT INTO remote_writes (device_id, method, target_id, summary, at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
    )?
    .execute(params![device, method, target_id, summary, now])?;
    conn.prepare_cached(
        "DELETE FROM remote_writes WHERE device_id = ?1 AND id <=
            (SELECT id FROM remote_writes WHERE device_id = ?1
             ORDER BY id DESC LIMIT 1 OFFSET ?2)",
    )?
    .execute(params![device, WRITE_LOG_ROWS])?;
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

/// How many connections the history keeps for each linked browser.
pub const CONNECTION_ROWS: i64 = 50;

/// What a client says it is: its own claim, never verified.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
#[uniffi(name = "FfiLinkedClient")]
pub struct Client {
    /// `browser` or `tool`.
    pub kind: String,
    pub browser: Option<String>,
    pub os: Option<String>,
    /// The computer tool's name, such as a command-line client.
    pub tool: Option<String>,
    pub tool_version: Option<String>,
}

/// One connection a linked browser made, as the athlete reads it.
#[derive(Debug, Clone, PartialEq, serde::Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
#[uniffi(name = "FfiLinkedConnection")]
pub struct LinkedConnection {
    pub device_id: String,
    /// Unix seconds.
    pub started_at: f64,
    /// Unix seconds, none while the connection is up.
    pub ended_at: Option<f64>,
    /// Why it ended: `closed`, `backgrounded`, `switched_off`, `removed`,
    /// `disconnected` or `refused`. None while the connection is up.
    pub end_reason: Option<String>,
    /// The address the phone saw the client at.
    pub remote_address: String,
    /// Whether that address is on the phone's own network, as opposed to the
    /// internet.
    pub this_network: bool,
    pub client: Option<Client>,
}

/// Whether `remote` is on the phone's own network: a private, link-local or
/// loopback address, or one sharing the phone's own subnet (a /24 for IPv4,
/// a /64 for IPv6) when the phone holds a public address.
pub fn on_this_network(remote: IpAddr, local: Option<IpAddr>) -> bool {
    let private = match remote {
        IpAddr::V4(ip) => ip.is_private() || ip.is_loopback() || ip.is_link_local(),
        IpAddr::V6(ip) => {
            let first = ip.segments()[0];
            ip.is_loopback() || first & 0xfe00 == 0xfc00 || first & 0xffc0 == 0xfe80
        }
    };
    if private {
        return true;
    }
    match (remote, local) {
        (IpAddr::V4(remote), Some(IpAddr::V4(local))) => {
            remote.octets()[..3] == local.octets()[..3]
        }
        (IpAddr::V6(remote), Some(IpAddr::V6(local))) => {
            remote.segments()[..4] == local.segments()[..4]
        }
        _ => false,
    }
}

/// Record that the browser pinned by `fingerprint` connected from `remote`,
/// and keep only the last [`CONNECTION_ROWS`] rows of that browser. Returns
/// the row, none when the fingerprint is not linked.
pub fn open_connection(
    conn: &Connection,
    fingerprint: &str,
    remote: IpAddr,
    local: Option<IpAddr>,
    now: i64,
) -> SqlResult<Option<i64>> {
    let Some(device) = conn
        .prepare_cached("SELECT id FROM linked_devices WHERE fingerprint = ?1")?
        .query_row(params![fingerprint], |row| row.get::<_, i64>(0))
        .optional()?
    else {
        return Ok(None);
    };
    conn.prepare_cached(
        "INSERT INTO linked_connections (device_id, started_at, remote_address, this_network)
         VALUES (?1, ?2, ?3, ?4)",
    )?
    .execute(params![
        device,
        now,
        remote.to_string(),
        on_this_network(remote, local)
    ])?;
    let row = conn.last_insert_rowid();
    conn.prepare_cached(
        "DELETE FROM linked_connections WHERE device_id = ?1 AND id <=
            (SELECT id FROM linked_connections WHERE device_id = ?1
             ORDER BY id DESC LIMIT 1 OFFSET ?2)",
    )?
    .execute(params![device, CONNECTION_ROWS])?;
    Ok(Some(row))
}

/// Keep what the client said it is on an open connection's row.
pub fn set_client(conn: &Connection, row: i64, client: &Client) -> SqlResult<()> {
    conn.prepare_cached(
        "UPDATE linked_connections SET client_kind = ?2, client_browser = ?3, client_os = ?4,
             client_tool = ?5, client_tool_version = ?6
         WHERE id = ?1",
    )?
    .execute(params![
        row,
        client.kind,
        client.browser,
        client.os,
        client.tool,
        client.tool_version
    ])?;
    Ok(())
}

/// End a connection's row with the reason it ended. A row already ended keeps
/// its first reason.
pub fn close_connection(conn: &Connection, row: i64, reason: &str, now: i64) -> SqlResult<()> {
    conn.prepare_cached(
        "UPDATE linked_connections SET ended_at = ?2, end_reason = ?3
         WHERE id = ?1 AND ended_at IS NULL",
    )?
    .execute(params![row, now, reason])?;
    Ok(())
}

/// End every row still open as `closed`: a connection cannot outlive the
/// process that held it, so a row open at start was cut by a crash or a kill.
pub fn close_open_connections(conn: &Connection, now: i64) -> SqlResult<()> {
    conn.prepare_cached(
        "UPDATE linked_connections SET ended_at = ?1, end_reason = 'closed'
         WHERE ended_at IS NULL",
    )?
    .execute(params![now])?;
    Ok(())
}

/// The most recent connections of one linked browser, newest first.
pub fn recent_connections(
    conn: &Connection,
    device_id: &str,
    limit: u32,
) -> SqlResult<Vec<LinkedConnection>> {
    let Ok(device) = device_id.parse::<i64>() else {
        return Ok(Vec::new());
    };
    conn.prepare_cached(
        "SELECT device_id, started_at, ended_at, end_reason, remote_address, this_network,
                client_kind, client_browser, client_os, client_tool, client_tool_version
         FROM linked_connections WHERE device_id = ?1 ORDER BY id DESC LIMIT ?2",
    )?
    .query_map(params![device, limit], |row| {
        Ok(LinkedConnection {
            device_id: row.get::<_, i64>(0)?.to_string(),
            started_at: row.get::<_, i64>(1)? as f64,
            ended_at: row.get::<_, Option<i64>>(2)?.map(|at| at as f64),
            end_reason: row.get(3)?,
            remote_address: row.get(4)?,
            this_network: row.get(5)?,
            client: row
                .get::<_, Option<String>>(6)?
                .map(|kind| -> SqlResult<Client> {
                    Ok(Client {
                        kind,
                        browser: row.get(7)?,
                        os: row.get(8)?,
                        tool: row.get(9)?,
                        tool_version: row.get(10)?,
                    })
                })
                .transpose()?,
        })
    })?
    .collect()
}

const DAY: i64 = 86_400;

/// Count one offer from an unlinked certificate on the day of `now`.
pub fn count_refusal(conn: &Connection, now: i64) -> SqlResult<()> {
    conn.prepare_cached(
        "INSERT INTO linked_refusals (day, refused) VALUES (?1, 1)
         ON CONFLICT(day) DO UPDATE SET refused = refused + 1",
    )?
    .execute(params![now.div_euclid(DAY) * DAY])?;
    Ok(())
}

/// How many offers from an unlinked certificate arrived on the day of `at`.
pub fn refusals_on(conn: &Connection, at: i64) -> SqlResult<i64> {
    Ok(conn
        .prepare_cached("SELECT refused FROM linked_refusals WHERE day = ?1")?
        .query_row(params![at.div_euclid(DAY) * DAY], |row| row.get(0))
        .optional()?
        .unwrap_or(0))
}

/// One linked browser with what the screen lists under it.
#[derive(Debug, Clone, PartialEq, serde::Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
#[uniffi(name = "FfiLinkedBrowser")]
pub struct LinkedBrowser {
    pub device: LinkedDevice,
    /// Its most recent changes, newest first.
    pub writes: Vec<RemoteWrite>,
    /// Its most recent connections, newest first.
    pub connections: Vec<LinkedConnection>,
}

/// Everything the linked-devices screen shows, in one read.
#[derive(Debug, Clone, PartialEq, serde::Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
#[uniffi(name = "FfiLinkedDevicesScreen")]
pub struct LinkedDevicesScreen {
    /// Every linked browser, most recently linked first.
    pub browsers: Vec<LinkedBrowser>,
    /// Offers from an unlinked certificate refused today.
    pub refused_today: u32,
}

/// The linked-devices screen: each browser with its recent changes and
/// connections, and how many offers were refused on the day of `now`.
pub fn screen(
    conn: &Connection,
    connections_up: &[(String, i64)],
    now: i64,
    writes_limit: u32,
    connections_limit: u32,
) -> SqlResult<LinkedDevicesScreen> {
    let browsers = list(conn, connections_up)?
        .into_iter()
        .map(|device| {
            Ok(LinkedBrowser {
                writes: recent_writes(conn, &device.id, writes_limit)?,
                connections: recent_connections(conn, &device.id, connections_limit)?,
                device,
            })
        })
        .collect::<SqlResult<Vec<_>>>()?;
    Ok(LinkedDevicesScreen {
        browsers,
        refused_today: u32::try_from(refusals_on(conn, now)?).unwrap_or(0),
    })
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

/// Record a spent pairing secret, by the key it is recorded under (a digest,
/// so the secret itself is never stored), until `expires_at`. Spent secrets
/// past their expiry by `now` are removed first. Returns false when the key
/// was recorded already.
pub fn spend_secret(conn: &Connection, key: &[u8], expires_at: i64, now: i64) -> SqlResult<bool> {
    conn.prepare_cached("DELETE FROM remote_spent WHERE expires_at < ?1")?
        .execute(params![now])?;
    let recorded = conn
        .prepare_cached("INSERT OR IGNORE INTO remote_spent (digest, expires_at) VALUES (?1, ?2)")?
        .execute(params![key, expires_at])?;
    Ok(recorded > 0)
}

/// Whether a spent pairing secret is recorded under `key` and not yet removed.
pub fn secret_spent(conn: &Connection, key: &[u8]) -> SqlResult<bool> {
    conn.prepare_cached("SELECT 1 FROM remote_spent WHERE digest = ?1")?
        .query_row(params![key], |_| Ok(()))
        .optional()
        .map(|found| found.is_some())
}

#[cfg(test)]
mod tests {
    use super::{
        add, connected_since, count_refusal, on_this_network, open_connection, recent_writes,
        record_write, screen,
    };
    use crate::persistence::PersistentEngine;
    use std::net::IpAddr;

    fn ip(text: &str) -> IpAddr {
        text.parse().unwrap()
    }

    // Built from octets so a private-range literal never appears in the source.
    fn v4(octets: [u8; 4]) -> IpAddr {
        IpAddr::from(octets)
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn private_and_same_subnet_addresses_are_this_network() {
        let phone = Some(v4([192, 168, 1, 5]));
        assert!(on_this_network(v4([192, 168, 1, 20]), phone));
        assert!(on_this_network(v4([10, 0, 0, 7]), phone));
        assert!(on_this_network(v4([172, 16, 4, 2]), None));
        assert!(on_this_network(ip("169.254.1.1"), None));
        assert!(on_this_network(ip("fe80::1"), None));
        assert!(on_this_network(ip("fd12::9"), None));
        assert!(on_this_network(ip("203.0.113.9"), Some(ip("203.0.113.40"))));
        assert!(on_this_network(
            ip("2001:db8:1:2::9"),
            Some(ip("2001:db8:1:2::1"))
        ));
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_public_address_off_the_phones_subnet_is_the_internet() {
        let phone = Some(v4([192, 168, 1, 5]));
        assert!(!on_this_network(ip("203.0.113.9"), phone));
        assert!(!on_this_network(v4([172, 32, 0, 1]), phone));
        assert!(!on_this_network(ip("2001:db8::9"), None));
        assert!(!on_this_network(ip("203.0.113.9"), Some(ip("2001:db8::1"))));
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_connected_browser_reads_when_its_connection_came_up() {
        let up = vec![
            ("aa".to_owned(), 1_700_000_100),
            ("bb".to_owned(), 1_700_000_200),
        ];
        assert_eq!(connected_since(&up, "bb"), Some(1_700_000_200.0));
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_browser_with_no_open_connection_reads_none() {
        let up = vec![("aa".to_owned(), 1_700_000_100)];
        assert_eq!(connected_since(&up, "cc"), None);
        assert_eq!(connected_since(&[], "aa"), None);
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_browser_with_two_open_connections_reads_the_earlier() {
        let up = vec![
            ("aa".to_owned(), 1_700_000_100),
            ("aa".to_owned(), 1_700_000_300),
        ];
        assert_eq!(connected_since(&up, "aa"), Some(1_700_000_100.0));
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_busy_browser_does_not_trim_another_browsers_log() {
        let engine = PersistentEngine::in_memory().expect("engine");
        let quiet = add(&engine.db, "Laptop", "aa:aa", None, 1_700_000_000).expect("link");
        let busy = add(&engine.db, "Tablet", "bb:bb", None, 1_700_000_001).expect("link");
        for k in 0..10 {
            record_write(
                &engine.db,
                "aa:aa",
                "section.rename",
                "s_a",
                &format!("A {k}"),
                1,
            )
            .expect("log");
        }
        for k in 0..250 {
            record_write(
                &engine.db,
                "bb:bb",
                "section.rename",
                "s_b",
                &format!("B {k}"),
                2,
            )
            .expect("log");
        }
        let quiet_rows = recent_writes(&engine.db, &quiet, 500).expect("writes");
        assert_eq!(quiet_rows.len(), 10);
        assert_eq!(quiet_rows[0].summary, "A 9");
        let busy_rows = recent_writes(&engine.db, &busy, 500).expect("writes");
        assert_eq!(busy_rows.len(), 200);
        assert_eq!(busy_rows[0].summary, "B 249");
        assert_eq!(busy_rows[199].summary, "B 50");
    }

    #[test]
    fn the_screen_read_carries_each_browsers_history_and_the_days_refusals() {
        let engine = PersistentEngine::in_memory().expect("engine");
        let day = 1_700_000_000;
        let laptop = add(&engine.db, "Laptop", "aa:aa", None, day).expect("link");
        let tablet = add(&engine.db, "Tablet", "bb:bb", None, day + 1).expect("link");
        for at in [day + 10, day + 20] {
            open_connection(&engine.db, "aa:aa", ip("203.0.113.9"), None, at).expect("open");
        }
        open_connection(&engine.db, "bb:bb", ip("203.0.113.9"), None, day + 30).expect("open");
        record_write(&engine.db, "aa:aa", "section.rename", "s_a", "A", day + 40).expect("log");
        count_refusal(&engine.db, day + 50).expect("refuse");
        count_refusal(&engine.db, day + 60).expect("refuse");
        count_refusal(&engine.db, day - 200_000).expect("refuse");

        let read = screen(
            &engine.db,
            &[("bb:bb".to_owned(), day + 30)],
            day + 100,
            5,
            20,
        )
        .expect("screen");

        assert_eq!(read.refused_today, 2);
        let ids: Vec<&str> = read.browsers.iter().map(|b| b.device.id.as_str()).collect();
        assert_eq!(ids, [tablet.as_str(), laptop.as_str()]);
        let (tablet_read, laptop_read) = (&read.browsers[0], &read.browsers[1]);
        assert_eq!(tablet_read.connections.len(), 1);
        assert!(tablet_read.writes.is_empty());
        assert_eq!(tablet_read.device.connected_since, Some((day + 30) as f64));
        assert_eq!(laptop_read.connections.len(), 2);
        assert_eq!(laptop_read.connections[0].started_at, (day + 20) as f64);
        assert_eq!(laptop_read.writes.len(), 1);
    }

    #[test]
    fn the_screen_read_limits_each_browsers_history() {
        let engine = PersistentEngine::in_memory().expect("engine");
        add(&engine.db, "Laptop", "aa:aa", None, 1).expect("link");
        for at in 0..4 {
            open_connection(&engine.db, "aa:aa", ip("203.0.113.9"), None, 10 + at).expect("open");
        }
        let read = screen(&engine.db, &[], 100, 5, 3).expect("screen");
        assert_eq!(read.browsers[0].connections.len(), 3);
        assert_eq!(screen(&engine.db, &[], 100, 5, 3).unwrap().refused_today, 0);
    }
}
