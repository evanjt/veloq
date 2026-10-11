//! How much of each activity's ground no earlier activity had covered.
//!
//! The ground of an activity is the set of z17 tiles its track touches, with
//! the tiles a segment crosses and none of the drawing halo (see
//! [`crate::tiles::tiles_touched_by_track`]). Its new ground is the share of
//! those tiles that no earlier activity touched, activities taken in start
//! order. The fraction is tile coverage against the activities held, not
//! metres of new road: the grid is fixed, so where a boundary falls decides
//! whether two nearby roads share a tile.
//!
//! `activity_new_ground` holds one row per dated activity with a stored
//! track, written by [`store`] from a pass over the whole library. An
//! activity's value depends on every activity before it, so the table is
//! rewritten whole and never patched. What is owed is read from the tables: a
//! dated activity with a stored track and no row. A removal clears the table,
//! since the ground it alone covered is new to the activities after it, and
//! moves the engine's [`Validity`] generation, so a pass that measured before
//! the removal has its store refused and measures again. The removal also
//! asks for a pass, started once the engine lock is released.
//!
//! A track that does not decode, or holds no valid point, has a row of zero
//! tiles: it is measured and has no fraction, and it adds nothing to the
//! ground later activities are compared against.

use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};

use rusqlite::{Connection, Result as SqlResult, params};

use super::codec::TrackRead;
use super::with_persistent_engine_for;
use crate::GpsPoint;
use crate::tiles::tiles_touched_by_track;

/// The zoom whose tile is the cell of ground. A coarser cell moves the entirely
/// new activities into the mostly new ones.
pub(crate) const GROUND_ZOOM: u8 = 17;

static RUNNING: AtomicBool = AtomicBool::new(false);

/// A pass asked for while one was running, so the running thread goes round
/// again rather than the request being lost.
static AGAIN: AtomicBool = AtomicBool::new(false);

/// Passes started back to back while rows are still owed, so a track that lands
/// mid-pass is picked up without the pass looping for ever on one that cannot
/// be measured.
const MAX_ROUNDS: usize = 3;

/// One activity's ground: how many tiles it touches and how many of those no
/// earlier activity touched.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Novelty {
    pub tiles: u32,
    pub new_tiles: u32,
}

impl Novelty {
    /// What a row of zero tiles stands for: measured, nothing to compare.
    const NONE: Novelty = Novelty {
        tiles: 0,
        new_tiles: 0,
    };

    pub(crate) fn fraction(self) -> Option<f64> {
        (self.tiles > 0).then(|| f64::from(self.new_tiles) / f64::from(self.tiles))
    }

    /// The badge the activity's card earns: entirely new ground when every
    /// tile is new, mostly new from half of them, otherwise none.
    pub(crate) fn badge(self) -> Option<crate::FfiNewGroundBadge> {
        if self.tiles == 0 {
            None
        } else if self.new_tiles == self.tiles {
            Some(crate::FfiNewGroundBadge::EntirelyNew)
        } else if u64::from(self.new_tiles) * 2 >= u64::from(self.tiles) {
            Some(crate::FfiNewGroundBadge::MostlyNew)
        } else {
            None
        }
    }
}

/// The ground covered by the activities measured so far.
#[derive(Default)]
pub(crate) struct Covered(HashSet<(u32, u32)>);

impl Covered {
    /// Measure the next activity against everything before it, then add its
    /// ground. `None` for a track that was not read, or that holds no valid
    /// point; it adds nothing.
    pub(crate) fn measure(&mut self, track: Option<&[GpsPoint]>) -> Option<Novelty> {
        let ground = tiles_touched_by_track(track?, GROUND_ZOOM);
        if ground.is_empty() {
            return None;
        }
        let new_tiles = ground.iter().filter(|tile| !self.0.contains(tile)).count();
        let tiles = ground.len();
        self.0.extend(ground);
        Some(Novelty {
            tiles: tiles as u32,
            new_tiles: new_tiles as u32,
        })
    }
}

const MEASURABLE: &str = "FROM activities a
     JOIN gps_tracks g ON g.activity_id = a.id
     WHERE a.start_date IS NOT NULL";

/// Every dated activity with a stored track, in start order, measured against
/// the ones before it. Tracks are decoded one at a time, so the library's
/// geometry is never held at once.
pub(crate) fn measure_library(conn: &Connection) -> SqlResult<Vec<(String, Novelty)>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT a.id, g.track_data {MEASURABLE} ORDER BY a.start_date, a.id"
    ))?;
    let mut rows = stmt.query([])?;
    let mut covered = Covered::default();
    let mut measured = Vec::new();
    while let Some(row) = rows.next()? {
        let id: String = row.get(0)?;
        let blob: Vec<u8> = row.get(1)?;
        let novelty = match TrackRead::from_blob(&blob) {
            TrackRead::Present(points) => covered.measure(Some(&points)),
            _ => None,
        };
        measured.push((id, novelty.unwrap_or(Novelty::NONE)));
    }
    Ok(measured)
}

/// How many times the engine's table was cleared, and whether a clear is
/// waiting for the engine lock to be released before a pass is started.
/// Both are read and written under the engine lock.
#[derive(Debug, Default)]
pub(crate) struct Validity {
    generation: u64,
    restart: bool,
}

impl Validity {
    /// Read before a measurement and handed back to [`store`] with it.
    pub(crate) fn generation(&self) -> u64 {
        self.generation
    }

    /// Whether a clear asked for a pass, forgetting the request.
    pub(crate) fn take_restart(&mut self) -> bool {
        std::mem::take(&mut self.restart)
    }
}

/// Replace the table with `measured`, taken when the generation was
/// `measured_at`. A measurement older than a clear counted the removed
/// activity's ground as covered, so it is refused and nothing is written:
/// `false` says to measure again. An activity removed since it was measured
/// with no clear between is skipped rather than failing the foreign key.
pub(crate) fn store(
    conn: &Connection,
    validity: &Validity,
    measured_at: u64,
    measured: &[(String, Novelty)],
) -> SqlResult<bool> {
    if validity.generation != measured_at {
        return Ok(false);
    }
    super::climb_bests::in_write_txn(conn, |conn| {
        conn.execute("DELETE FROM activity_new_ground", [])?;
        let mut insert = conn.prepare_cached(
            "INSERT INTO activity_new_ground (activity_id, tiles, new_tiles)
             SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM activities WHERE id = ?1)",
        )?;
        for (id, novelty) in measured {
            insert.execute(params![id, novelty.tiles, novelty.new_tiles])?;
        }
        Ok(true)
    })
}

/// Forget every value, because an activity left and the ones after it were
/// measured against its ground. A pass in flight has its store refused, and a
/// new one is asked for. A clear rolled back afterwards costs one measurement.
pub(crate) fn invalidate(conn: &Connection, validity: &mut Validity) -> SqlResult<()> {
    conn.execute("DELETE FROM activity_new_ground", [])?;
    validity.generation += 1;
    validity.restart = true;
    Ok(())
}

/// How many dated activities with a stored track hold no row.
pub(crate) fn owed_count(conn: &Connection) -> SqlResult<u64> {
    conn.query_row(
        &format!(
            "SELECT COUNT(*) {MEASURABLE}
               AND NOT EXISTS (SELECT 1 FROM activity_new_ground n WHERE n.activity_id = a.id)"
        ),
        [],
        |row| row.get::<_, i64>(0),
    )
    .map(|count| count.max(0) as u64)
}

pub(crate) mod pooled {
    use rusqlite::Connection;

    use super::Novelty;

    /// The new ground of each of `activity_ids` that has a fraction.
    pub(crate) fn new_ground_of(
        conn: &Connection,
        activity_ids: &[String],
    ) -> Vec<crate::FfiActivityNewGround> {
        if activity_ids.is_empty() {
            return Vec::new();
        }
        let placeholders = vec!["?"; activity_ids.len()].join(",");
        let sql = format!(
            "SELECT activity_id, tiles, new_tiles FROM activity_new_ground
             WHERE tiles > 0 AND activity_id IN ({placeholders})"
        );
        let read = || -> rusqlite::Result<Vec<crate::FfiActivityNewGround>> {
            let mut stmt = conn.prepare_cached(&sql)?;
            let rows = stmt.query_map(rusqlite::params_from_iter(activity_ids.iter()), |row| {
                let novelty = Novelty {
                    tiles: row.get(1)?,
                    new_tiles: row.get(2)?,
                };
                Ok(crate::FfiActivityNewGround {
                    activity_id: row.get(0)?,
                    fraction: novelty.fraction().unwrap_or(0.0),
                    tiles: novelty.tiles,
                    new_tiles: novelty.new_tiles,
                    badge: novelty.badge(),
                })
            })?;
            rows.collect()
        };
        read().unwrap_or_else(|e| {
            log::warn!("veloqrs: [new-ground] read failed: {e}");
            Vec::new()
        })
    }
}

/// Measure and store until nothing is owed, a few rounds at most. The library is
/// read through the pool and only the write takes the engine lock, so a sync or
/// a read waits for rows being inserted and not for the walk. A store refused
/// for a removal mid-walk measures again.
fn run_pass(install: u64) {
    for _ in 0..MAX_ROUNDS {
        let Some(measured_at) =
            with_persistent_engine_for(install, |engine| engine.new_ground.generation())
        else {
            return;
        };
        let measured = match crate::objects::error::with_reader(measure_library) {
            Ok(Ok(measured)) => measured,
            Ok(Err(error)) => {
                log::warn!("veloqrs: [new-ground] measure failed: {error}");
                return;
            }
            Err(_) => return,
        };
        match with_persistent_engine_for(install, |engine| {
            store(&engine.db, &engine.new_ground, measured_at, &measured)
        }) {
            // The feed and the detail read the values with the highlights, and
            // the pass lands after they first read, so they are asked to read
            // again.
            Some(Ok(true)) => crate::objects::observer::notify(
                crate::objects::observer::Announcement::ActivitiesStored,
            ),
            Some(Ok(false)) => continue,
            Some(Err(error)) => {
                log::warn!("veloqrs: [new-ground] store failed: {error}");
                return;
            }
            None => return,
        }
        match crate::objects::error::with_reader(owed_count) {
            Ok(Ok(0)) | Err(_) => return,
            Ok(Ok(_)) => {}
            Ok(Err(_)) => return,
        }
    }
}

/// Start a pass on a thread of its own when rows are owed. The count reads
/// through the pool, so an empty queue costs one query and no thread, and it is
/// safe to ask whenever a track lands, an activity leaves or the library opens.
/// Asked while a pass runs, that pass goes round again once it ends.
pub fn start_pass() {
    if !owed() {
        return;
    }
    // Before the claim: a running pass reads it after clearing its own claim,
    // so a request refused the claim is never missed.
    AGAIN.store(true, Ordering::SeqCst);
    if !claim() {
        return;
    }
    crate::threads::spawn_named("veloq-ground", || {
        loop {
            AGAIN.store(false, Ordering::SeqCst);
            if owed() {
                run_pass(super::engine_install());
            }
            RUNNING.store(false, Ordering::SeqCst);
            if !AGAIN.load(Ordering::SeqCst) || !claim() {
                return;
            }
        }
    });
}

fn owed() -> bool {
    matches!(crate::objects::error::with_reader(owed_count), Ok(Ok(count)) if count > 0)
}

fn claim() -> bool {
    RUNNING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_ok()
}

#[cfg(test)]
#[path = "tests/new_ground.rs"]
mod tests;
