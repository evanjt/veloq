//! The route regroup that runs off the engine write lock.
//!
//! Grouping, the match percentages and the save run on a connection of their
//! own, and the engine lock is taken once at the end, to adopt what was saved.
//! A detection run regroups through the same compute and save, and one slot
//! keeps a single regroup in flight between that run and the worker here.

use rusqlite::{Connection, Result as SqlResult, params};
use std::collections::{HashMap, HashSet};
#[cfg(test)]
use std::sync::mpsc;
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};
use tracematch::{Bounds, MatchConfig, RouteGroup, RouteSignature};

use super::PersistentEngine;
use super::codec::TrackRead;
use super::route_identity::{
    RouteIdentity, advance_group_generation, load_identity, note_group_commit_off_engine,
    read_group_generation, write_identity,
};
use super::routes::load_groups_from_db;
use super::sections::detection::{log_corrupt_tracks, pool_is_usable, worker_write};
use super::sections::track_pool::CorruptTrack;
use crate::{ActivityMatchInfo, GpsPoint};

/// Load all route signatures from the DB (standalone, no engine needed).
/// Returns the signatures that decoded and the ones that did not, so the
/// caller decides whether a reduced pool may be grouped over.
fn load_all_signatures(conn: &Connection) -> (Vec<RouteSignature>, Vec<CorruptTrack>) {
    let mut stmt = match conn.prepare(
        "SELECT activity_id, points, start_point_lat, start_point_lng,
                end_point_lat, end_point_lng, total_distance
         FROM signatures",
    ) {
        Ok(s) => s,
        Err(_) => return (Vec::new(), Vec::new()),
    };

    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Vec<u8>>(1)?,
            GpsPoint::new(row.get(2)?, row.get(3)?),
            GpsPoint::new(row.get(4)?, row.get(5)?),
            row.get::<_, f64>(6)?,
        ))
    });
    let rows = match rows {
        Ok(r) => r,
        Err(_) => return (Vec::new(), Vec::new()),
    };

    let mut signatures: Vec<RouteSignature> = Vec::new();
    let mut corrupt: Vec<CorruptTrack> = Vec::new();

    for (id, blob, start_point, end_point, total_distance) in rows.flatten() {
        let points: Vec<GpsPoint> = match TrackRead::from_blob(&blob) {
            TrackRead::Present(points) => points,
            TrackRead::Missing => Vec::new(),
            TrackRead::Corrupt(reason) => {
                corrupt.push(CorruptTrack {
                    activity_id: id,
                    reason,
                });
                continue;
            }
        };
        let bounds = Bounds::from_points(&points).unwrap_or(Bounds {
            min_lat: 0.0,
            max_lat: 0.0,
            min_lng: 0.0,
            max_lng: 0.0,
        });
        let center = bounds.center();
        signatures.push(RouteSignature {
            activity_id: id,
            points,
            total_distance,
            start_point,
            end_point,
            bounds,
            center,
        });
    }

    (signatures, corrupt)
}

/// Compute route groups from DB signatures and save them back, and say what
/// became of the save. Runs on the background thread so it doesn't block the
/// JS thread.
///
/// `existing_groups` is the catalogue the engine held at `generation`. When a
/// group write has committed since, the save is refused and the committed
/// catalogue is what the run goes on with: it is newer than this grouping, and
/// the next foreground regroup starts from it.
pub(crate) fn recompute_and_save_groups(
    conn: &Connection,
    install: u64,
    match_config: &MatchConfig,
    existing_groups: &[RouteGroup],
    generation: u64,
) -> (Vec<RouteGroup>, GroupSave) {
    let start = Instant::now();

    let (signatures, corrupt) = load_all_signatures(conn);
    let sig_ms = start.elapsed().as_millis();

    if !corrupt.is_empty() {
        log_corrupt_tracks("BG Groups", signatures.len(), &corrupt);
        if !pool_is_usable(signatures.len(), corrupt.len()) {
            log::error!(
                "veloqrs: [BG Groups] Keeping the existing groups: too much of the signature pool is unreadable to regroup over"
            );
            return (existing_groups.to_vec(), GroupSave::Kept);
        }
    }

    if signatures.is_empty() {
        return (existing_groups.to_vec(), GroupSave::Kept);
    }

    let already_grouped: HashSet<&str> = existing_groups
        .iter()
        .flat_map(|g| g.activity_ids.iter().map(|s| s.as_str()))
        .collect();
    let (new_sigs, existing_sigs): (Vec<_>, Vec<_>) = signatures
        .iter()
        .cloned()
        .partition(|s| !already_grouped.contains(s.activity_id.as_str()));

    let total = signatures.len();
    let chosen = super::routes::routes_keeping_representative(conn, existing_groups);
    let use_incremental = !existing_groups.is_empty()
        && !new_sigs.is_empty()
        && (new_sigs.len() as f64) < (total as f64 * 0.9)
        && !super::routes::groups_match_rule_changed(conn, match_config);

    let group_start = Instant::now();
    let result = if use_incremental {
        log::info!(
            "[BG Groups] INCREMENTAL: {} new vs {} existing",
            new_sigs.len(),
            existing_sigs.len()
        );
        tracematch::group_incremental_with_matches(
            &new_sigs,
            &super::routes::groups_keeping_chosen_representatives(existing_groups, &chosen),
            &existing_sigs,
            match_config,
        )
    } else {
        log::info!("[BG Groups] FULL: {} signatures", signatures.len());
        tracematch::group_signatures_parallel_with_matches(&signatures, match_config)
    };
    let group_ms = group_start.elapsed().as_millis();

    // The same assign-once remap the foreground writer runs. Without it this
    // path persists the raw Union-Find roots, re-keying the catalogue behind the
    // stable ids `route_names` and `activity_matches` are keyed on, and the user's
    // route names are orphaned by whichever writer happened to run last.
    let mut identity = load_identity(conn, existing_groups);
    let (mut groups, id_map) = identity.remap(existing_groups.to_vec(), result.groups, &chosen);

    for group in &mut groups {
        group.sport_type.clear();
    }

    // Measured here, before the write lock is taken: the percentages read every
    // member's stored track, and the lock is held only for the rows.
    let matches = measure_group_matches(
        conn,
        &groups,
        result.activity_matches,
        &id_map,
        match_config,
    );

    let save = match save_groups_to_db(
        conn,
        install,
        &groups,
        &identity,
        &matches,
        match_config,
        generation,
    ) {
        Ok(GroupSave::Superseded) => {
            log::info!(
                "[BG Groups] A newer catalogue committed during the run, keeping it over this grouping"
            );
            return (load_groups_from_db(conn), GroupSave::Superseded);
        }
        Ok(save) => save,
        Err(e) => {
            log::error!("[BG Groups] Save failed: {}", e);
            GroupSave::Kept
        }
    };

    let total_ms = start.elapsed().as_millis();
    log::info!(
        "[BG Groups] Done: {} groups in {}ms (sigs={}ms, grouping={}ms)",
        groups.len(),
        total_ms,
        sig_ms,
        group_ms
    );

    (groups, save)
}

/// The match rows the worker's grouping owes: each member's direction from the
/// grouping, re-keyed through the id map onto the stable route ids, over the
/// rows already stored, then every percentage measured from the stored tracks.
/// The incremental arm reports only the routes that took a new member, so the
/// stored rows carry the rest.
fn measure_group_matches(
    conn: &Connection,
    groups: &[RouteGroup],
    reported: HashMap<String, Vec<ActivityMatchInfo>>,
    id_map: &HashMap<String, String>,
    match_config: &MatchConfig,
) -> HashMap<String, Vec<ActivityMatchInfo>> {
    let mut held: HashMap<String, Vec<ActivityMatchInfo>> = HashMap::new();
    if let Ok(mut stmt) = conn
        .prepare("SELECT route_id, activity_id, match_percentage, direction FROM activity_matches")
    {
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, f64>(2)?,
                row.get::<_, String>(3)?,
            ))
        });
        for (route_id, activity_id, match_percentage, direction) in
            rows.into_iter().flatten().flatten()
        {
            if let Ok(direction) = direction.parse() {
                held.entry(route_id).or_default().push(ActivityMatchInfo {
                    activity_id,
                    match_percentage,
                    direction,
                });
            }
        }
    }
    for (old_id, matches) in reported {
        let entry = held
            .entry(id_map.get(&old_id).cloned().unwrap_or(old_id))
            .or_default();
        for info in matches {
            entry.retain(|m| m.activity_id != info.activity_id);
            entry.push(info);
        }
    }
    let live: HashSet<&str> = groups.iter().map(|g| g.group_id.as_str()).collect();
    held.retain(|id, _| live.contains(id.as_str()));
    for group in groups {
        if let Some(entry) = held.get_mut(&group.group_id) {
            let members: HashSet<&str> = group.activity_ids.iter().map(|s| s.as_str()).collect();
            entry.retain(|m| members.contains(m.activity_id.as_str()));
        }
    }
    super::routes::measure_match_percentages(
        groups,
        &held,
        match_config,
        |id| match conn
            .query_row(
                "SELECT track_data FROM gps_tracks WHERE activity_id = ?",
                [id],
                |row| row.get::<_, Vec<u8>>(0),
            )
            .map(|blob| TrackRead::from_blob(&blob))
        {
            Ok(TrackRead::Present(points)) => Some(points),
            _ => None,
        },
        None,
        None,
    )
}

/// What became of a background group write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum GroupSave {
    Committed,
    /// A group write committed after the run's snapshot, so nothing was written.
    /// That write need not have regrouped: a representative choice does not, so
    /// the regroup this run was for is still owed.
    Superseded,
    /// Nothing was written: the pool was empty or unusable, or the save failed.
    Kept,
}

/// Save route groups and the registry that keyed them to DB (standalone, no
/// engine needed). One transaction: a failure mid-way would otherwise leave the
/// catalogue half-written, or the groups committed under ids the registry does
/// not know, which is the crash window the registry reconcile exists to heal.
///
/// The generation is compared inside that transaction, so no group write can
/// commit between the comparison and this one.
pub(crate) fn save_groups_to_db(
    conn: &Connection,
    install: u64,
    groups: &[RouteGroup],
    identity: &RouteIdentity,
    matches: &HashMap<String, Vec<ActivityMatchInfo>>,
    match_config: &MatchConfig,
    generation: u64,
) -> SqlResult<GroupSave> {
    #[cfg(test)]
    hold_group_write(conn, install, groups.len());
    let mut superseded = false;
    let written = worker_write(conn, install, || {
        if read_group_generation(conn)? != generation {
            superseded = true;
            return Err(rusqlite::Error::InvalidQuery);
        }
        save_groups_txn(conn, groups, identity, matches)?;
        super::routes::stamp_groups_match_rule(conn, match_config)?;
        advance_group_generation(conn)?;
        super::route_lines::rebuild(conn).map(|_| ())
    });
    match written {
        Err(_) if superseded => Ok(GroupSave::Superseded),
        Err(e) => Err(e),
        Ok(()) => {
            note_group_commit_off_engine();
            Ok(GroupSave::Committed)
        }
    }
}

#[cfg(test)]
type GroupWriteHold = (String, u64, mpsc::Sender<usize>, mpsc::Receiver<()>);

#[cfg(test)]
static GROUP_WRITE_HOLD: std::sync::Mutex<Option<GroupWriteHold>> = std::sync::Mutex::new(None);

#[cfg(test)]
pub(crate) fn pause_next_group_write(
    path: &std::path::Path,
    install: u64,
) -> (mpsc::Receiver<usize>, mpsc::Sender<()>) {
    let (entered_tx, entered_rx) = mpsc::channel();
    let (resume_tx, resume_rx) = mpsc::channel();
    *GROUP_WRITE_HOLD.lock().unwrap() = Some((
        path.to_string_lossy().into_owned(),
        install,
        entered_tx,
        resume_rx,
    ));
    (entered_rx, resume_tx)
}

#[cfg(test)]
fn hold_group_write(conn: &Connection, install: u64, group_count: usize) {
    let hold = {
        let mut slot = GROUP_WRITE_HOLD.lock().unwrap();
        if slot.as_ref().is_some_and(|(path, held_install, _, _)| {
            conn.path() == Some(path.as_str()) && *held_install == install
        }) {
            slot.take()
        } else {
            None
        }
    };
    if let Some((_, _, entered, resume)) = hold {
        let _ = entered.send(group_count);
        let _ = resume.recv();
    }
}

fn save_groups_txn(
    conn: &Connection,
    groups: &[RouteGroup],
    identity: &RouteIdentity,
    matches: &HashMap<String, Vec<ActivityMatchInfo>>,
) -> SqlResult<()> {
    let chosen = super::routes::chosen_representatives(conn)?;
    conn.execute("DELETE FROM route_groups", [])?;
    let mut stmt = conn.prepare(
        "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type,
            bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
            activity_ids_blob)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )?;
    for group in groups {
        let activity_ids_json = serde_json::to_string(&group.activity_ids).unwrap_or_default();
        let activity_ids_blob = super::codec::serialize(&group.activity_ids).ok();
        let (min_lat, max_lat, min_lng, max_lng) = match &group.bounds {
            Some(b) => (
                Some(b.min_lat),
                Some(b.max_lat),
                Some(b.min_lng),
                Some(b.max_lng),
            ),
            None => (None, None, None, None),
        };
        stmt.execute(params![
            group.group_id,
            group.representative_id,
            activity_ids_json,
            "",
            min_lat,
            max_lat,
            min_lng,
            max_lng,
            activity_ids_blob,
        ])?;
    }
    drop(stmt);
    super::routes::mark_chosen_representatives(conn, &chosen)?;

    // A name outlives its route only while the id survives. The remap keeps that
    // id, so this drops only the names of routes the regroup actually dissolved.
    let live: HashSet<&str> = groups.iter().map(|g| g.group_id.as_str()).collect();
    let named: Vec<String> = {
        let mut stmt = conn.prepare("SELECT route_id FROM route_names")?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
        rows.filter_map(|r| r.ok()).collect()
    };
    let mut delete_name = conn.prepare("DELETE FROM route_names WHERE route_id = ?")?;
    for id in named.iter().filter(|id| !live.contains(id.as_str())) {
        delete_name.execute(params![id])?;
    }
    drop(delete_name);
    super::routes::mint_route_numbers(conn, groups)?;

    // The match rows are rewritten whole, as the foreground writer does, so a
    // member that left a route leaves no row naming it. The athlete's exclusions
    // are the one record in them and ride across for every pair that survives.
    let excluded: Vec<(String, String)> = {
        let mut stmt =
            conn.prepare("SELECT route_id, activity_id FROM activity_matches WHERE excluded = 1")?;
        let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        rows.filter_map(|r| r.ok()).collect()
    };
    conn.execute("DELETE FROM activity_matches", [])?;
    let mut insert = conn.prepare(
        "INSERT OR IGNORE INTO activity_matches (route_id, activity_id, match_percentage, direction)
         VALUES (?, ?, ?, ?)",
    )?;
    for group in groups {
        let members: HashSet<&str> = group.activity_ids.iter().map(|s| s.as_str()).collect();
        for m in matches.get(&group.group_id).into_iter().flatten() {
            if members.contains(m.activity_id.as_str()) {
                insert.execute(params![
                    group.group_id,
                    m.activity_id,
                    m.match_percentage,
                    m.direction.to_string(),
                ])?;
            }
        }
        // A member the grouping reported no pair for, or whose track is unreadable.
        for id in &group.activity_ids {
            insert.execute(params![group.group_id, id, 0.0f64, "same"])?;
        }
    }
    drop(insert);
    let mut exclude = conn.prepare(
        "UPDATE activity_matches SET excluded = 1 WHERE route_id = ? AND activity_id = ?",
    )?;
    for (route_id, activity_id) in &excluded {
        exclude.execute(params![route_id, activity_id])?;
    }
    drop(exclude);

    write_identity(conn, identity)
}

/// Whether a regroup is in flight, on the worker below or inside a detection
/// run. Two at once would each group the same library and the second write
/// would be refused over the first, so the second does nothing instead.
static REGROUP_SLOT: (Mutex<bool>, Condvar) = (Mutex::new(false), Condvar::new());

/// The one regroup in flight. Dropping it frees the slot, however its holder
/// ended.
pub(crate) struct RegroupClaim(());

/// Take the slot, or `None` while another regroup holds it.
pub(crate) fn claim_regroup() -> Option<RegroupClaim> {
    let mut held = REGROUP_SLOT.0.lock().unwrap_or_else(|e| e.into_inner());
    if *held {
        return None;
    }
    *held = true;
    Some(RegroupClaim(()))
}

impl Drop for RegroupClaim {
    fn drop(&mut self) {
        *REGROUP_SLOT.0.lock().unwrap_or_else(|e| e.into_inner()) = false;
        REGROUP_SLOT.1.notify_all();
    }
}

/// Wait until no regroup is in flight, and say whether that happened within
/// `limit`.
#[cfg(test)]
pub(crate) fn wait_for_regroup(limit: Duration) -> bool {
    let held = REGROUP_SLOT.0.lock().unwrap_or_else(|e| e.into_inner());
    let (_held, wait) = REGROUP_SLOT
        .1
        .wait_timeout_while(held, limit, |held| *held)
        .unwrap_or_else(|e| e.into_inner());
    !wait.timed_out()
}

/// Passes one schedule runs at most. A pass that ends with the regroup still
/// owed runs one more, and a second that also ends owed leaves the flag for the
/// next store to schedule, so a library that never stops syncing cannot keep
/// the worker spinning.
const MAX_PASSES: usize = 2;

/// What a regroup pass reads from the engine, taken under the lock hold that
/// schedules it.
#[doc(hidden)]
pub struct RegroupSnapshot {
    install: u64,
    db_path: String,
    match_config: MatchConfig,
    groups: Vec<RouteGroup>,
    generation: u64,
    epoch: u64,
}

/// What became of a pass's compute and save, for the swap to adopt.
#[doc(hidden)]
pub struct RegroupComputed {
    install: u64,
    epoch: u64,
    save: GroupSave,
}

/// What a swap held the engine lock for, and whether the regroup is still
/// owed after it.
#[doc(hidden)]
#[derive(Debug, Clone, Copy)]
pub struct RegroupSwap {
    pub adopt: Duration,
    pub indicators: Duration,
    pub owed: bool,
}

impl RegroupSnapshot {
    /// Group the library, measure the match percentages and save the result,
    /// on a connection of this pass's own and with no engine lock held.
    #[doc(hidden)]
    pub fn compute(&self) -> RegroupComputed {
        let start = Instant::now();
        let save = match Connection::open(&self.db_path) {
            Ok(conn) => {
                let _ = conn.busy_timeout(Duration::from_secs(5));
                let _ = super::apply_write_pragmas(&conn);
                recompute_and_save_groups(
                    &conn,
                    self.install,
                    &self.match_config,
                    &self.groups,
                    self.generation,
                )
                .1
            }
            Err(e) => {
                log::warn!("veloqrs: [regroup] Failed to open DB: {:?}", e);
                GroupSave::Kept
            }
        };
        log::info!(
            "[RUST: PERF] regroup compute: {}ms ({:?})",
            start.elapsed().as_millis(),
            save
        );
        RegroupComputed {
            install: self.install,
            epoch: self.epoch,
            save,
        }
    }
}

/// A regroup whose snapshot is taken and whose slot is held, waiting to be
/// started once the lock hold that took it has ended. Started inside that hold,
/// its compute could read the database before the hold's own writes commit.
#[must_use = "a scheduled regroup runs only once started"]
pub struct ScheduledRegroup {
    claim: RegroupClaim,
    snapshot: RegroupSnapshot,
}

impl ScheduledRegroup {
    /// Run the passes on a thread of their own.
    pub fn start(self) {
        crate::threads::spawn_background("veloq-regroup", move || self.run());
    }

    fn run(self) {
        let ScheduledRegroup {
            claim,
            mut snapshot,
        } = self;
        for pass in 1..=MAX_PASSES {
            let computed = snapshot.compute();
            #[cfg(test)]
            hold_regroup_swap();
            // Stamped with the install the snapshot was taken against, so a
            // swap that outlived its library is refused by the lock.
            let next = super::with_persistent_engine_for(computed.install, |engine| {
                let swap = engine.swap_regroup(&computed);
                (swap.owed && pass < MAX_PASSES).then(|| engine.regroup_snapshot())
            })
            .flatten();
            match next {
                Some(next) => snapshot = next,
                None => break,
            }
        }
        drop(claim);
    }
}

impl PersistentEngine {
    /// The inputs a regroup pass works from, as this engine holds them now.
    #[doc(hidden)]
    pub fn regroup_snapshot(&self) -> RegroupSnapshot {
        RegroupSnapshot {
            install: super::engine_install(),
            db_path: self.db_path.clone(),
            match_config: self.match_config.clone(),
            groups: self.groups.clone(),
            generation: self.group_generation,
            epoch: self.groups_dirty_epoch,
        }
    }

    /// Take the regroup slot and a snapshot under the lock hold the caller
    /// already has, for a worker the caller starts once that hold has ended.
    ///
    /// `None` when nothing is owed, or when a regroup is already in flight: a
    /// detection run that captured the flag decides at its apply what is still
    /// owed, and a worker pass reads a store made during it from the epoch.
    #[doc(hidden)]
    pub fn schedule_regroup(&mut self) -> Option<ScheduledRegroup> {
        if !self.groups_dirty {
            return None;
        }
        let claim = claim_regroup()?;
        Some(ScheduledRegroup {
            claim,
            snapshot: self.regroup_snapshot(),
        })
    }

    /// Adopt what a pass saved, in one lock hold: the groups it committed, or
    /// the catalogue already held when it committed nothing, with the regroup
    /// left owed unless the pass committed and nothing was stored since its
    /// snapshot. Then the indicators the new groups change.
    #[doc(hidden)]
    pub fn swap_regroup(&mut self, computed: &RegroupComputed) -> RegroupSwap {
        let committed = computed.save == GroupSave::Committed;
        let adopt_start = Instant::now();
        self.adopt_run_groups(!committed, computed.epoch);
        let adopt = adopt_start.elapsed();
        let indicators_start = Instant::now();
        if committed && let Err(e) = self.recompute_activity_indicators() {
            log::warn!("veloqrs: [regroup] Indicator recomputation failed: {}", e);
        }
        let indicators = indicators_start.elapsed();
        log::info!(
            "[RUST: PERF] regroup swap: {}ms (adopt={}ms, indicators={}ms, owed={})",
            (adopt + indicators).as_millis(),
            adopt.as_millis(),
            indicators.as_millis(),
            self.groups_dirty
        );
        RegroupSwap {
            adopt,
            indicators,
            owed: self.groups_dirty,
        }
    }
}

#[cfg(test)]
type SwapHold = (mpsc::Sender<()>, mpsc::Receiver<()>);

#[cfg(test)]
static REGROUP_SWAP_HOLD: Mutex<Option<SwapHold>> = Mutex::new(None);

/// Hold the next worker pass after its compute and before its swap takes the
/// lock. The first receiver hears the pass arrive, the sender lets it go on.
#[cfg(test)]
pub(crate) fn pause_next_regroup_swap() -> (mpsc::Receiver<()>, mpsc::Sender<()>) {
    let (entered_tx, entered_rx) = mpsc::channel();
    let (resume_tx, resume_rx) = mpsc::channel();
    *REGROUP_SWAP_HOLD.lock().unwrap() = Some((entered_tx, resume_rx));
    (entered_rx, resume_tx)
}

#[cfg(test)]
fn hold_regroup_swap() {
    let hold = REGROUP_SWAP_HOLD.lock().unwrap().take();
    if let Some((entered, resume)) = hold {
        let _ = entered.send(());
        let _ = resume.recv();
    }
}

#[cfg(test)]
#[path = "tests/regroup_worker.rs"]
mod regroup_worker_tests;
