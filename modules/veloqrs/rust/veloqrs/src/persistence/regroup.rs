//! The route regroup that runs off the engine write lock.
//!
//! Grouping, the match percentages and the save run on a connection of their
//! own, and the engine lock is taken once at the end, to adopt what was saved.
//! A detection run regroups through the same compute and save, and one slot
//! keeps a single regroup in flight between that run and the worker here.

use crate::poison::Recover;
use rusqlite::{Connection, Result as SqlResult};
use std::collections::{BTreeSet, HashMap, HashSet};
#[cfg(test)]
use std::sync::mpsc;
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};
use tracematch::{Bounds, MatchConfig, RouteGroup, RouteSignature};

use super::PersistentEngine;
use super::codec::TrackRead;
use super::route_identity::{
    RouteIdentity, advance_group_generation, load_identity, note_group_commit_off_engine,
    read_group_generation,
};
use super::routes::load_groups_from_db;
use super::sections::detection::{log_corrupt_tracks, pool_is_usable, worker_write};
use super::sections::track_pool::CorruptTrack;
use crate::{ActivityMatchInfo, GpsPoint};

/// Load all route signatures from the DB (standalone, no engine needed).
/// Returns the signatures that decoded and the ones that did not, so the
/// caller decides whether a reduced pool may be grouped over. A statement or
/// row that cannot be read is an error, never an empty pool.
pub(super) fn load_all_signatures(
    conn: &Connection,
) -> SqlResult<(Vec<RouteSignature>, Vec<CorruptTrack>)> {
    let mut stmt = conn.prepare(
        "SELECT activity_id, points, start_point_lat, start_point_lng,
                end_point_lat, end_point_lng, total_distance
         FROM signatures",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, Vec<u8>>(1)?,
            GpsPoint::new(row.get(2)?, row.get(3)?),
            GpsPoint::new(row.get(4)?, row.get(5)?),
            row.get::<_, f64>(6)?,
        ))
    })?;

    let mut signatures: Vec<RouteSignature> = Vec::new();
    let mut corrupt: Vec<CorruptTrack> = Vec::new();

    for row in rows {
        let (id, blob, start_point, end_point, total_distance) = row?;
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

    Ok((signatures, corrupt))
}

/// The signatures a regroup may group over, or `None` when it must keep the
/// catalogue it holds: the pool could not be read, too much of it is
/// unreadable, or nothing is left of it. Both regroup writers go through this,
/// so neither can dissolve routes and delete their names over a pool the other
/// would have refused.
pub(super) fn usable_signatures(conn: &Connection, context: &str) -> Option<Vec<RouteSignature>> {
    let (signatures, corrupt) = match load_all_signatures(conn) {
        Ok(pool) => pool,
        Err(e) => {
            log::error!(
                "veloqrs: [{context}] Keeping the existing groups: signatures unreadable: {e}"
            );
            return None;
        }
    };
    if !corrupt.is_empty() {
        log_corrupt_tracks(context, signatures.len(), &corrupt);
        if !pool_is_usable(signatures.len(), corrupt.len()) {
            log::error!(
                "veloqrs: [{context}] Keeping the existing groups: too much of the signature pool is unreadable to regroup over"
            );
            return None;
        }
    }
    if signatures.is_empty() {
        return None;
    }
    Some(signatures)
}

/// Which grouping a regroup runs over `signatures`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum GroupingMode {
    /// Only the signatures no live group holds are compared against the
    /// existing groups.
    Incremental,
    /// Every pair is evaluated again.
    Full,
}

/// Group `signatures` over the catalogue held in `existing_groups`, and say
/// which grouping ran. The one pipeline both regroup writers run: seed from
/// the groups that still have live members, split the pool into signatures
/// already grouped and new ones, and group incrementally unless there is
/// nothing to seed from, nothing new, nearly everything is new, or the match
/// rule changed (which re-evaluates pairs the incremental path never looks at).
pub(super) fn group_pool(
    signatures: &[RouteSignature],
    existing_groups: &[RouteGroup],
    chosen: &HashSet<String>,
    rule_changed: bool,
    match_config: &MatchConfig,
) -> (tracematch::GroupingResult, GroupingMode) {
    let live: HashSet<&str> = signatures.iter().map(|s| s.activity_id.as_str()).collect();
    let seed_groups = super::routes::groups_of_live_members(existing_groups, &live);
    let already_grouped: HashSet<&str> = seed_groups
        .iter()
        .flat_map(|g| g.activity_ids.iter().map(|s| s.as_str()))
        .collect();
    let (existing_sigs, new_sigs): (Vec<_>, Vec<_>) = signatures
        .iter()
        .cloned()
        .partition(|s| already_grouped.contains(s.activity_id.as_str()));

    let incremental = !seed_groups.is_empty()
        && !new_sigs.is_empty()
        && (new_sigs.len() as f64) < (signatures.len() as f64 * 0.9)
        && !rule_changed;
    if incremental {
        log::info!(
            "[regroup] INCREMENTAL: {} new vs {} existing",
            new_sigs.len(),
            existing_sigs.len()
        );
        let result = tracematch::group_incremental_with_matches(
            &new_sigs,
            &super::routes::groups_keeping_chosen_representatives(&seed_groups, chosen),
            &existing_sigs,
            match_config,
        );
        (result, GroupingMode::Incremental)
    } else {
        log::info!("[regroup] FULL: {} signatures", signatures.len());
        let result = tracematch::group_signatures_parallel_with_matches(signatures, match_config);
        (result, GroupingMode::Full)
    }
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
    moved_tracks: &HashSet<String>,
) -> (Vec<RouteGroup>, GroupSave) {
    let start = Instant::now();

    // Grouping signatures an earlier matcher built would stamp them with the
    // current rule, and nothing would group them again.
    let Some(behind) = read_piece(|| super::routes::signatures_behind_matcher(conn)) else {
        return (existing_groups.to_vec(), GroupSave::Kept);
    };
    if behind {
        let rebuilt = worker_write(conn, install, || {
            super::routes::rebuild_signatures(conn, match_config).map(|_| ())
        });
        if let Err(e) = rebuilt {
            log::error!("[BG Groups] Keeping the existing groups: signature rebuild failed: {e}");
            return (existing_groups.to_vec(), GroupSave::Kept);
        }
    }

    let Some(signatures) = read_piece(|| usable_signatures(conn, "BG Groups")).flatten() else {
        return (existing_groups.to_vec(), GroupSave::Kept);
    };
    let sig_ms = start.elapsed().as_millis();

    let Some((chosen, rule_changed)) = read_piece(|| {
        (
            super::routes::routes_keeping_representative(conn, existing_groups),
            super::routes::groups_match_rule_changed(conn, match_config),
        )
    }) else {
        return (existing_groups.to_vec(), GroupSave::Kept);
    };

    let group_start = Instant::now();
    let (result, _) = group_pool(
        &signatures,
        existing_groups,
        &chosen,
        rule_changed,
        match_config,
    );
    let group_ms = group_start.elapsed().as_millis();

    // The same assign-once remap the foreground writer runs. Without it this
    // path persists the raw Union-Find roots, re-keying the catalogue behind the
    // stable ids `route_names` and `activity_matches` are keyed on, and the user's
    // route names are orphaned by whichever writer happened to run last.
    let Some(mut identity) = read_piece(|| load_identity(conn, existing_groups)) else {
        return (existing_groups.to_vec(), GroupSave::Kept);
    };
    let (mut groups, id_map) = identity.remap(existing_groups.to_vec(), result.groups, &chosen);

    for group in &mut groups {
        group.sport_type.clear();
    }

    // Measured here, before the write lock is taken: the percentages read the
    // stored tracks of the routes owed a measurement, and the lock is held only
    // for the rows.
    let measured_against: &[RouteGroup] = if rule_changed { &[] } else { existing_groups };
    let Some(matches) = measure_group_matches(
        conn,
        measured_against,
        &groups,
        result.activity_matches,
        &id_map,
        match_config,
        moved_tracks,
    ) else {
        return (existing_groups.to_vec(), GroupSave::Kept);
    };

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

/// Run one read of the library under a suspension read hold, or `None` when
/// the engine is suspended and this thread may not wait. The hold covers the
/// read and ends with it, so a pass that groups or measures between reads
/// holds no read mark while it does.
fn read_piece<T>(read: impl FnOnce() -> T) -> Option<T> {
    let _hold = super::suspension::begin_read()?;
    Some(read())
}

/// Every stored match row, by route.
fn stored_matches(conn: &Connection) -> HashMap<String, Vec<ActivityMatchInfo>> {
    let mut held: HashMap<String, Vec<ActivityMatchInfo>> = HashMap::new();
    let Ok(mut stmt) = conn
        .prepare("SELECT route_id, activity_id, match_percentage, direction FROM activity_matches")
    else {
        return held;
    };
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, f64>(2)?,
            row.get::<_, String>(3)?,
        ))
    });
    for (route_id, activity_id, match_percentage, direction) in rows.into_iter().flatten().flatten()
    {
        if let Ok(direction) = direction.parse() {
            held.entry(route_id).or_default().push(ActivityMatchInfo {
                activity_id,
                match_percentage,
                direction,
            });
        }
    }
    held
}

/// The match rows the worker's grouping owes. A route that kept its members,
/// its representative and their tracks since `previous` keeps the rows already
/// stored. Every other route takes each member's direction from the grouping,
/// re-keyed through the id map onto the stable route ids, over the rows already
/// stored, then has its percentages measured from the stored tracks.
fn measure_group_matches(
    conn: &Connection,
    previous: &[RouteGroup],
    groups: &[RouteGroup],
    reported: HashMap<String, Vec<ActivityMatchInfo>>,
    id_map: &HashMap<String, String>,
    match_config: &MatchConfig,
    moved_tracks: &HashSet<String>,
) -> Option<HashMap<String, Vec<ActivityMatchInfo>>> {
    let refused = std::cell::Cell::new(false);
    let mut held = read_piece(|| stored_matches(conn))?;
    let owed = super::routes::groups_owing_measurement(previous, groups, &held, moved_tracks);
    for (old_id, matches) in reported {
        let id = id_map.get(&old_id).cloned().unwrap_or(old_id);
        if !owed.contains(&id) {
            continue;
        }
        let entry = held.entry(id).or_default();
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
    let measured = super::routes::measure_match_percentages(
        groups,
        &held,
        match_config,
        |id| {
            let Some(read) = read_piece(|| super::codec::read_track(conn, id)) else {
                refused.set(true);
                return None;
            };
            match read {
                TrackRead::Present(points) => Some(points),
                _ => None,
            }
        },
        Some(&owed),
        None,
    );
    (!refused.get()).then_some(measured)
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

impl GroupSave {
    /// Whether the regroup the run was for is still owed. Only a committed
    /// write settles it: a refused or failed one leaves stored rides out of
    /// their routes.
    pub(crate) fn owes_regroup(self) -> bool {
        self != GroupSave::Committed
    }
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
        super::routes::write_group_catalogue(conn, groups, identity, matches, match_config)?;
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

/// The libraries with a regroup in flight, on the worker below or inside a
/// detection run, by database path. Two at once on one library would each
/// group it and the second write would be refused over the first, so the
/// second does nothing instead. A regroup on another library groups other
/// rows and has nothing to wait for.
static REGROUP_SLOT: (Mutex<BTreeSet<String>>, Condvar) =
    (Mutex::new(BTreeSet::new()), Condvar::new());

/// The one regroup in flight on a library. Dropping it frees the slot,
/// however its holder ended.
pub(crate) struct RegroupClaim(String);

/// Take the library's slot, or `None` while another regroup holds it.
pub(crate) fn claim_regroup(db_path: &str) -> Option<RegroupClaim> {
    let mut held = REGROUP_SLOT.0.lock_recover();
    if !held.insert(db_path.to_owned()) {
        return None;
    }
    Some(RegroupClaim(db_path.to_owned()))
}

/// Whether a regroup holds the library's slot now, on the worker or inside a
/// detection run, which is what a screen reads to say routes are being
/// computed.
pub(crate) fn regroup_in_flight(db_path: &str) -> bool {
    REGROUP_SLOT.0.lock_recover().contains(db_path)
}

impl Drop for RegroupClaim {
    fn drop(&mut self) {
        REGROUP_SLOT.0.lock_recover().remove(&self.0);
        REGROUP_SLOT.1.notify_all();
    }
}

/// Wait until no regroup is in flight on the library, and say whether that
/// happened within `limit`.
pub(crate) fn wait_for_regroup(db_path: &str, limit: Duration) -> bool {
    let held = REGROUP_SLOT.0.lock_recover();
    let (_held, wait) = REGROUP_SLOT
        .1
        .wait_timeout_while(held, limit, |held| held.contains(db_path))
        .unwrap_or_else(|e| e.into_inner());
    !wait.timed_out()
}

/// Wait until no regroup is in flight on any library, for a caller that holds
/// no path.
#[cfg(test)]
pub(crate) fn wait_for_every_regroup(limit: Duration) -> bool {
    let held = REGROUP_SLOT.0.lock_recover();
    let (_held, wait) = REGROUP_SLOT
        .1
        .wait_timeout_while(held, limit, |held| !held.is_empty())
        .unwrap_or_else(|e| e.into_inner());
    !wait.timed_out()
}

/// Wait, up to `limit`, until the library's route groups hold every activity
/// it has stored, and say whether they do.
///
/// A store only schedules the regroup that adds its activity to a route, so a
/// reader that answers for that activity at once reads it in none. This waits
/// on the regroup in flight, and when the flag is still set once it ends, as
/// it is when a detection run held the slot over a store it did not capture,
/// schedules the next and waits on that. `false` is the limit passing, or the
/// library closing or moving under the wait, and the caller reads what has
/// committed.
pub(crate) fn settle_regroup(install: u64, limit: Duration) -> bool {
    let deadline = Instant::now() + limit;
    let Some((_, db_path)) = super::read_pool::binding() else {
        return false;
    };
    loop {
        if !wait_for_regroup(&db_path, deadline.saturating_duration_since(Instant::now())) {
            return false;
        }
        let owed = super::with_persistent_engine_for(install, |engine| {
            if !engine.groups_dirty || !engine.detection_enabled() {
                Owed::Nothing
            } else if Instant::now() >= deadline {
                Owed::Late
            } else {
                // `None` is another regroup taking the slot since the wait.
                Owed::Pass(engine.schedule_regroup().map(Box::new))
            }
        });
        match owed {
            Some(Owed::Nothing) => return true,
            None | Some(Owed::Late) => return false,
            Some(Owed::Pass(Some(scheduled))) => scheduled.start(),
            Some(Owed::Pass(None)) => {}
        }
    }
}

/// What a settling reader finds once no regroup is in flight.
enum Owed {
    Nothing,
    Late,
    Pass(Option<Box<ScheduledRegroup>>),
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
    /// The members whose stored track was replaced before this snapshot.
    moved_tracks: HashSet<String>,
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
                    &self.moved_tracks,
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
            moved_tracks: self.moved_tracks.keys().cloned().collect(),
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
        let claim = claim_regroup(&self.db_path)?;
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
        let committed = !computed.save.owes_regroup();
        let adopt_start = Instant::now();
        self.adopt_run_groups(computed.save.owes_regroup(), computed.epoch);
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

#[cfg(test)]
#[path = "tests/foreground_regroup_guard.rs"]
mod foreground_regroup_guard_tests;

#[cfg(test)]
#[path = "tests/group_pool.rs"]
mod group_pool_tests;
