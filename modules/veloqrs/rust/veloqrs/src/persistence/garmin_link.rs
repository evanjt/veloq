//! A Garmin row and the intervals.icu activity that holds the same ride are
//! one row.
//!
//! intervals.icu imports the athlete's Garmin rides and keeps the Garmin id as
//! the activity's `external_id`, bare, or as `garmin:<id>` when an upload of
//! ours wrote it. This module is the one place that decides which stored
//! intervals.icu activity a `src-garmin-` row belongs to, from either side:
//! when the original is stored and the sync already holds the copy, and when
//! the sync brings a copy for an original already stored.
//!
//! The Garmin id decides first. Without one, a copy that starts within
//! [`START_WINDOW_SECS`] of the original, in the same sport and within
//! [`DURATION_TOLERANCE`] of its duration, is the match. More than one
//! candidate links nothing and records the row in `garmin_link_unresolved`.
//!
//! A linked row keeps its Garmin track and streams and takes the intervals.icu
//! id, so the upload never offers it. Where intervals.icu serves its copy the
//! row takes that body and its numbers. A stub has nothing to give, so the row
//! keeps the body it was made with.

use std::collections::HashSet;

use rusqlite::{Connection, OptionalExtension, Result as SqlResult, params};

use super::PersistentEngine;
use super::origin::{garmin_id_named, garmin_id_of_source_key};
use crate::net::intervals::wire::ActivityRecord;

/// How far apart two starts may be and still be one ride, in seconds.
pub const START_WINDOW_SECS: i64 = 120;

/// How far apart two durations may be and still be one ride, as a share of the
/// longer.
pub const DURATION_TOLERANCE: f64 = 0.05;

/// How far from the original's start a stored copy is searched for by Garmin
/// id. The id alone decides, so this only bounds the read to the days around
/// the ride.
const ID_SEARCH_SECS: i64 = 24 * 60 * 60;

/// What decides whether two activities are one ride when no id names it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Shape {
    /// The start on the athlete's wall clock, as the body's `date` column
    /// stores it.
    pub start: i64,
    pub sport: Option<String>,
    pub elapsed: Option<i64>,
    pub moving: Option<i64>,
}

impl Shape {
    pub fn of(date: i64, record: &ActivityRecord) -> Self {
        Self {
            start: date,
            sport: record.activity_type.clone().filter(|t| !t.is_empty()),
            elapsed: record.elapsed_time,
            moving: record.moving_time,
        }
    }

    /// Whether the two are one ride by start, sport and duration. A side with
    /// no duration to compare is never near: a stub is matched by id.
    pub fn is_near(&self, other: &Shape) -> bool {
        if (self.start - other.start).abs() > START_WINDOW_SECS {
            return false;
        }
        if self.sport.is_none() || self.sport != other.sport {
            return false;
        }
        let (a, b) = match (self.elapsed, other.elapsed) {
            (Some(a), Some(b)) => (a, b),
            _ => match (self.moving, other.moving) {
                (Some(a), Some(b)) => (a, b),
                _ => return false,
            },
        };
        let longer = a.max(b);
        longer > 0 && ((a - b).abs() as f64) <= (longer as f64) * DURATION_TOLERANCE
    }
}

/// An intervals.icu activity a Garmin original could be.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Candidate {
    /// intervals.icu's id for it.
    pub upstream_id: String,
    /// The key it is stored under, `None` while it is only in a page being
    /// stored.
    pub key: Option<String>,
    pub shape: Shape,
    /// The Garmin id its `external_id` names, if it names one.
    pub names: Option<i64>,
}

impl Candidate {
    pub fn of(upstream_id: &str, key: Option<&str>, date: i64, record: &ActivityRecord) -> Self {
        Self {
            upstream_id: upstream_id.to_string(),
            key: key.map(str::to_string),
            shape: Shape::of(date, record),
            names: garmin_id_named(record.source.as_deref(), record.external_id.as_deref()),
        }
    }
}

/// What a Garmin original matched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Matched {
    Nothing,
    /// The intervals.icu id of the one activity.
    One(String),
    /// The intervals.icu ids of every candidate, when there were several.
    Ambiguous(Vec<String>),
}

/// The activity among `pool` that holds the Garmin ride `garmin_id` with
/// `shape`. A candidate naming another Garmin id is another ride and is never
/// a match by time.
pub fn resolve(garmin_id: i64, shape: &Shape, pool: &[Candidate]) -> Matched {
    let mut seen = HashSet::new();
    let named: Vec<&Candidate> = pool
        .iter()
        .filter(|c| c.names == Some(garmin_id) && seen.insert(c.upstream_id.as_str()))
        .collect();
    let matches = if named.is_empty() {
        let mut seen = HashSet::new();
        pool.iter()
            .filter(|c| c.names.is_none() && shape.is_near(&c.shape))
            .filter(|c| seen.insert(c.upstream_id.as_str()))
            .collect()
    } else {
        named
    };
    match matches.as_slice() {
        [] => Matched::Nothing,
        [one] => Matched::One(one.upstream_id.clone()),
        many => Matched::Ambiguous(many.iter().map(|c| c.upstream_id.clone()).collect()),
    }
}

/// A stored Garmin original that no intervals.icu activity is linked to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnlinkedOriginal {
    pub key: String,
    pub garmin_id: i64,
    pub shape: Shape,
}

fn record_of(raw: &str) -> Option<ActivityRecord> {
    serde_json::from_str(raw).ok()
}

/// The `src-garmin-` keys no intervals.icu id is stored for, whether the row
/// has a track or not.
fn unlinked_keys(conn: &Connection) -> SqlResult<Vec<String>> {
    conn.prepare_cached(
        "SELECT b.activity_id FROM activity_bodies b
         WHERE b.activity_id >= 'src-garmin-' AND b.activity_id < 'src-garmin.'
           AND b.intervals_id IS NULL
           AND NOT EXISTS (SELECT 1 FROM activities a
                           WHERE a.id = b.activity_id AND a.intervals_id IS NOT NULL)",
    )?
    .query_map([], |row| row.get::<_, String>(0))?
    .collect()
}

/// The Garmin originals with no intervals.icu activity linked to them.
pub fn unlinked_originals(conn: &Connection) -> SqlResult<Vec<UnlinkedOriginal>> {
    let mut out = Vec::new();
    for key in unlinked_keys(conn)? {
        let Some(garmin_id) = garmin_id_of_source_key(&key) else {
            continue;
        };
        if let Some(shape) = shape_of_stored(conn, &key)? {
            out.push(UnlinkedOriginal {
                key,
                garmin_id,
                shape,
            });
        }
    }
    Ok(out)
}

fn shape_of_stored(conn: &Connection, key: &str) -> SqlResult<Option<Shape>> {
    let row: Option<(i64, String)> = conn
        .query_row(
            "SELECT date, raw FROM activity_bodies WHERE activity_id = ?1",
            params![key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    Ok(row.and_then(|(date, raw)| Some(Shape::of(date, &record_of(&raw)?))))
}

/// The stored intervals.icu activities that could be the original `garmin_id`
/// with `shape`: those that start near it, and those that name its id.
///
/// A key minted here is never one, since its ride is an upload or a file of
/// ours and not intervals.icu's import of a Garmin ride.
fn stored_pool(conn: &Connection, shape: &Shape) -> SqlResult<Vec<Candidate>> {
    let mut stmt = conn.prepare_cached(
        "SELECT activity_id, date, raw FROM activity_bodies
         WHERE date BETWEEN ?1 AND ?2
           AND activity_id NOT LIKE 'local-%'
           AND activity_id NOT LIKE 'src-%'
           AND activity_id NOT LIKE 'demo-%'",
    )?;
    let rows = stmt
        .query_map(
            params![shape.start - ID_SEARCH_SECS, shape.start + ID_SEARCH_SECS],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )?
        .collect::<SqlResult<Vec<_>>>()?;
    Ok(rows
        .into_iter()
        .filter_map(|(key, date, raw)| {
            let record = record_of(&raw)?;
            Some(Candidate::of(&key, Some(&key), date, &record))
        })
        .collect())
}

/// What the stored intervals.icu activities say about the original `key`.
pub fn server_copy_of(
    conn: &Connection,
    key: &str,
) -> SqlResult<Option<(Matched, Vec<Candidate>)>> {
    let Some(garmin_id) = garmin_id_of_source_key(key) else {
        return Ok(None);
    };
    let Some(shape) = shape_of_stored(conn, key)? else {
        return Ok(None);
    };
    let pool = stored_pool(conn, &shape)?;
    Ok(Some((resolve(garmin_id, &shape, &pool), pool)))
}

/// Record that the original matched `candidates` activities and was linked to
/// none of them.
pub fn mark_unresolved(conn: &Connection, key: &str, candidates: usize) -> SqlResult<()> {
    conn.prepare_cached(
        "INSERT OR REPLACE INTO garmin_link_unresolved (activity_id, candidates) VALUES (?1, ?2)",
    )?
    .execute(params![key, candidates as i64])
    .map(|_| ())
}

pub fn clear_unresolved(conn: &Connection, key: &str) -> SqlResult<()> {
    conn.prepare_cached("DELETE FROM garmin_link_unresolved WHERE activity_id = ?1")?
        .execute(params![key])
        .map(|_| ())
}

/// How many candidates the original matched when it was last left unlinked for
/// being ambiguous, `None` when it is not marked.
pub fn unresolved_candidates(conn: &Connection, key: &str) -> SqlResult<Option<usize>> {
    conn.prepare_cached("SELECT candidates FROM garmin_link_unresolved WHERE activity_id = ?1")?
        .query_row(params![key], |row| row.get::<_, i64>(0))
        .optional()
        .map(|n| n.map(|n| n as usize))
}

/// The Garmin originals no intervals.icu activity holds: unlinked and not
/// ambiguous. This is the only list an upload of an original may draw from.
pub fn originals_to_offer(conn: &Connection) -> SqlResult<Vec<String>> {
    let mut out = Vec::new();
    for key in unlinked_keys(conn)? {
        if unresolved_candidates(conn, &key)?.is_none() {
            out.push(key);
        }
    }
    Ok(out)
}

/// Give the stored original `key` the intervals.icu id `intervals_id`, on its
/// track row or, with none, its body, as an upload's answer does.
fn name_original(conn: &Connection, key: &str, intervals_id: &str) -> SqlResult<()> {
    let tracked: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM activities WHERE id = ?1)",
        params![key],
        |row| row.get(0),
    )?;
    if tracked {
        conn.execute(
            "UPDATE activities SET intervals_id = ?2 WHERE id = ?1 AND intervals_id IS NULL",
            params![key, intervals_id],
        )?;
    } else {
        conn.execute(
            "UPDATE activity_bodies SET intervals_id = ?2
             WHERE activity_id = ?1 AND intervals_id IS NULL",
            params![key, intervals_id],
        )?;
    }
    clear_unresolved(conn, key)
}

/// Whether `raw` is a stub that would be stored over the Garmin original
/// `key`, which has nothing to take from it.
pub fn stub_for_original(key: &str, raw: &str) -> bool {
    garmin_id_of_source_key(key).is_some() && record_of(raw).is_some_and(|r| r.is_held_back())
}

/// One page of intervals.icu activities as the sync is about to store it.
pub struct IncomingActivity<'a> {
    pub upstream_id: &'a str,
    pub date: i64,
    pub raw: &'a str,
}

/// Link the stored originals to the activities of a page that no row claims
/// yet, and answer which stored key now claims which of them.
///
/// Runs inside the sync's write, before it resolves the page's keys, so a
/// linked page lands on the original's row. An original with several
/// candidates, among the page and what is stored, is marked and linked to
/// none of them. A candidate that two originals both match links neither.
pub fn link_incoming(
    conn: &Connection,
    unclaimed: &[IncomingActivity<'_>],
) -> SqlResult<Vec<(String, String)>> {
    if unclaimed.is_empty() {
        return Ok(Vec::new());
    }
    let originals = unlinked_originals(conn)?;
    if originals.is_empty() {
        return Ok(Vec::new());
    }
    let incoming: Vec<Candidate> = unclaimed
        .iter()
        .filter_map(|a| {
            Some(Candidate::of(
                a.upstream_id,
                None,
                a.date,
                &record_of(a.raw)?,
            ))
        })
        .collect();
    let in_page: HashSet<&str> = incoming.iter().map(|c| c.upstream_id.as_str()).collect();

    let mut proposals: Vec<(&UnlinkedOriginal, String)> = Vec::new();
    for original in &originals {
        let mut pool = stored_pool(conn, &original.shape)?;
        let stored: HashSet<String> = pool.iter().map(|c| c.upstream_id.clone()).collect();
        pool.extend(
            incoming
                .iter()
                .filter(|c| !stored.contains(&c.upstream_id))
                .cloned(),
        );
        match resolve(original.garmin_id, &original.shape, &pool) {
            Matched::One(id) if in_page.contains(id.as_str()) && !stored.contains(&id) => {
                proposals.push((original, id));
            }
            Matched::Ambiguous(ids) if ids.iter().any(|id| in_page.contains(id.as_str())) => {
                mark_unresolved(conn, &original.key, ids.len())?;
            }
            _ => {}
        }
    }

    let mut linked = Vec::new();
    for (original, id) in &proposals {
        let rivals = proposals.iter().filter(|(_, other)| other == id).count();
        if rivals > 1 {
            mark_unresolved(conn, &original.key, rivals)?;
            continue;
        }
        name_original(conn, &original.key, id)?;
        linked.push((id.clone(), original.key.clone()));
    }
    Ok(linked)
}

/// What linking one stored original did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Linked {
    /// Not a Garmin original, or not stored.
    NotAnOriginal,
    /// It already carries an intervals.icu id.
    Already,
    /// No stored activity holds it. The sync may still bring one.
    Nothing,
    /// Several do, so none is linked and the row is marked.
    Ambiguous(usize),
    /// The copy is held by a section nothing else can carry, so both stay.
    Kept,
    /// It now carries this intervals.icu id, and the copy stored under its own
    /// key is gone.
    To(String),
}

impl PersistentEngine {
    /// Link the stored Garmin original `key` to the intervals.icu activity the
    /// sync already stored for it, if there is exactly one.
    pub fn link_garmin_original(&mut self, key: &str) -> SqlResult<Linked> {
        if garmin_id_of_source_key(key).is_none() {
            return Ok(Linked::NotAnOriginal);
        }
        if self.intervals_id(key).is_some() {
            return Ok(Linked::Already);
        }
        let Some((matched, pool)) = server_copy_of(&self.db, key)? else {
            return Ok(Linked::NotAnOriginal);
        };
        match matched {
            Matched::Nothing => {
                clear_unresolved(&self.db, key)?;
                Ok(Linked::Nothing)
            }
            Matched::Ambiguous(ids) => {
                mark_unresolved(&self.db, key, ids.len())?;
                Ok(Linked::Ambiguous(ids.len()))
            }
            Matched::One(upstream_id) => {
                let copy = pool
                    .iter()
                    .find(|c| c.upstream_id == upstream_id)
                    .and_then(|c| c.key.clone())
                    .unwrap_or_else(|| upstream_id.clone());
                let (date, raw): (i64, String) = self.db.query_row(
                    "SELECT date, raw FROM activity_bodies WHERE activity_id = ?1",
                    params![copy],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )?;
                let served = record_of(&raw).is_some_and(|r| !r.is_held_back());
                let absorbed = self.absorb_server_copy(
                    key,
                    &copy,
                    &upstream_id,
                    served.then_some((date, raw.as_str())),
                )?;
                if absorbed {
                    clear_unresolved(&self.db, key)?;
                    Ok(Linked::To(upstream_id))
                } else {
                    Ok(Linked::Kept)
                }
            }
        }
    }
}

#[cfg(test)]
#[path = "tests/garmin_link.rs"]
mod tests;
