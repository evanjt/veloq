//! Whether a ride is already in the library, decided in one place.
//!
//! A library holds a ride once, whichever way it arrives: synced from
//! intervals.icu, pulled from Garmin, recorded on the phone or read from a
//! file. `ride_identity` keeps what two rows are compared by. The start and
//! the sport follow the stored body through the table's triggers, so every
//! writer of a body is covered, and the store of a file adds the recording
//! device's serial number and the time the file was created ([`record`]).
//!
//! [`existing_ride_for`] asks in two steps. A file that carries both device
//! figures is the ride of the row with the same pair, which is how a head
//! unit's own file and a copy of it are one ride. Failing that, the ride is the
//! row that started within [`START_TOLERANCE_SECS`] with the same sport: a
//! file written again by another program has its own serial and creation time
//! and keeps the session's start. A start is read on the athlete's wall clock,
//! as `activity_bodies.date` holds it, since an intervals.icu body carries no
//! other.
//!
//! More than one candidate links nothing: the caller stores the file as a row
//! of its own and counts the ambiguity, as the Garmin link does.

use rusqlite::{Connection, Result as SqlResult, params};

/// How far apart two starts may be for one ride. Two devices recording one
/// ride start seconds apart, and two rides of one athlete are further apart
/// than a minute.
pub const START_TOLERANCE_SECS: i64 = 60;

/// What a stored ride is compared by.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RideIdentity {
    /// The recording device's serial number, from the file's `file_id`.
    pub device_serial: Option<u64>,
    /// When that file was created, in Unix seconds.
    pub created_unix: Option<i64>,
    /// The start on the athlete's wall clock, in seconds.
    pub start_local: i64,
    pub sport: String,
}

impl RideIdentity {
    /// The device pair, when the file carries both halves.
    fn device(&self) -> Option<(u64, i64)> {
        self.device_serial.zip(self.created_unix)
    }
}

/// The rows a ride matched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Existing {
    Nothing,
    /// The key of the one row that holds the ride.
    One(String),
    /// The keys of every candidate, when there were several.
    Ambiguous(Vec<String>),
}

impl Existing {
    fn of(mut keys: Vec<String>) -> Self {
        keys.sort();
        keys.dedup();
        match keys.len() {
            0 => Self::Nothing,
            1 => Self::One(keys.remove(0)),
            _ => Self::Ambiguous(keys),
        }
    }
}

fn keys_of(conn: &Connection, sql: &str, args: impl rusqlite::Params) -> SqlResult<Vec<String>> {
    conn.prepare_cached(sql)?
        .query_map(args, |row| row.get::<_, String>(0))?
        .collect()
}

/// The stored row that holds the ride `identity` describes, if there is
/// exactly one.
pub fn existing_ride_for(conn: &Connection, identity: &RideIdentity) -> SqlResult<Existing> {
    if let Some((serial, created)) = identity.device() {
        let by_device = keys_of(
            conn,
            "SELECT i.activity_id FROM ride_identity i
             JOIN activity_bodies b ON b.activity_id = i.activity_id
             WHERE i.device_serial = ?1 AND i.created_unix = ?2",
            params![serial as i64, created],
        )?;
        if !by_device.is_empty() {
            return Ok(Existing::of(by_device));
        }
    }
    let by_start = keys_of(
        conn,
        "SELECT i.activity_id FROM ride_identity i
         JOIN activity_bodies b ON b.activity_id = i.activity_id
         WHERE i.start_local BETWEEN ?1 AND ?2 AND i.sport = ?3",
        params![
            identity.start_local - START_TOLERANCE_SECS,
            identity.start_local + START_TOLERANCE_SECS,
            identity.sport
        ],
    )?;
    Ok(Existing::of(by_start))
}

/// Note the device figures of the file the row `key` was made from. The start
/// and the sport are the body's, kept by the table's triggers, so a row with no
/// body yet is given them here.
pub fn record(conn: &Connection, key: &str, identity: &RideIdentity) -> SqlResult<()> {
    conn.prepare_cached(
        "INSERT INTO ride_identity (activity_id, device_serial, created_unix, start_local, sport)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(activity_id) DO UPDATE SET
             device_serial = excluded.device_serial, created_unix = excluded.created_unix",
    )?
    .execute(params![
        key,
        identity.device_serial.map(|n| n as i64),
        identity.created_unix,
        identity.start_local,
        identity.sport
    ])
    .map(|_| ())
}

#[cfg(test)]
#[path = "tests/ride_identity.rs"]
mod tests;
