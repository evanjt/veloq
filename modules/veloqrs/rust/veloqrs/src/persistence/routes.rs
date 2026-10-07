//! Route groups: loading, grouping, matching, representative routes, names.

use crate::{ActivityMatchInfo, Bounds, Direction, GpsPoint, RouteGroup, RouteSignature};
use rusqlite::{Connection, OptionalExtension, Result as SqlResult, Row, params, types::Type};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use super::record_restore::HELD_NUMBER_PREFIX;
use super::{GroupSummary, PersistentEngine, codec, get_route_word};

/// `schema_info` key holding the digest of the match rule the stored groups
/// were made under.
pub(crate) const GROUPS_MATCH_RULE_KEY: &str = "groups_match_rule";

/// The rule a grouping is made under, as the text stored beside the groups.
pub(crate) fn match_rule_digest(config: &tracematch::MatchConfig) -> String {
    format!("{config:?}")
}

/// Record the rule the groups just written were made under. Called inside the
/// transaction that writes them, so the two commit or roll back together.
pub(crate) fn stamp_groups_match_rule(
    conn: &Connection,
    config: &tracematch::MatchConfig,
) -> SqlResult<()> {
    conn.execute(
        "INSERT OR REPLACE INTO schema_info (key, value) VALUES (?, ?)",
        params![GROUPS_MATCH_RULE_KEY, match_rule_digest(config)],
    )
    .map(|_| ())
}

/// Record a rule for groups that carry none, which are groups saved before the
/// rule was stamped. They are taken to have been made under `config`.
pub(crate) fn stamp_groups_match_rule_if_absent(
    conn: &Connection,
    config: &tracematch::MatchConfig,
) -> SqlResult<()> {
    conn.execute(
        "INSERT OR IGNORE INTO schema_info (key, value) VALUES (?, ?)",
        params![GROUPS_MATCH_RULE_KEY, match_rule_digest(config)],
    )
    .map(|_| ())
}

/// Whether the stored groups were made under a rule other than `config`. Only
/// a full regroup re-evaluates pairs of activities already grouped, so a
/// changed rule rules out the incremental path. An unreadable stamp counts as
/// changed, since a full regroup is the safe side of that doubt.
pub(crate) fn groups_match_rule_changed(
    conn: &Connection,
    config: &tracematch::MatchConfig,
) -> bool {
    match conn
        .query_row(
            "SELECT value FROM schema_info WHERE key = ?",
            params![GROUPS_MATCH_RULE_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()
    {
        Ok(Some(stored)) => stored != match_rule_digest(config),
        Ok(None) => false,
        Err(error) => {
            log::warn!("veloqrs: [groups_match_rule] read failed: {error}");
            true
        }
    }
}

#[cfg(test)]
#[path = "tests/route_decode.rs"]
mod route_decode_tests;

#[cfg(test)]
#[path = "tests/route_numbers.rs"]
mod route_number_tests;

pub(super) fn decode_activity_ids(
    row: &Row<'_>,
    group_id: &str,
    json_column: usize,
    blob_column: usize,
) -> SqlResult<Vec<String>> {
    if let Some(blob) = row.get::<_, Option<Vec<u8>>>(blob_column)? {
        return codec::deserialize(&blob).map_err(|error| {
            log::error!("route_groups id={group_id}: invalid activity_ids_blob: {error}");
            rusqlite::Error::FromSqlConversionFailure(
                blob_column,
                Type::Blob,
                Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
            )
        });
    }
    let json: String = row.get(json_column)?;
    serde_json::from_str(&json).map_err(|error| {
        log::error!("route_groups id={group_id}: invalid activity_ids: {error}");
        rusqlite::Error::FromSqlConversionFailure(json_column, Type::Text, Box::new(error))
    })
}

fn decode_group_bounds(row: &Row<'_>) -> SqlResult<Option<Bounds>> {
    Ok(
        match (
            row.get::<_, Option<f64>>(3)?,
            row.get::<_, Option<f64>>(4)?,
            row.get::<_, Option<f64>>(5)?,
            row.get::<_, Option<f64>>(6)?,
        ) {
            (Some(min_lat), Some(max_lat), Some(min_lng), Some(max_lng)) => Some(Bounds {
                min_lat,
                max_lat,
                min_lng,
                max_lng,
            }),
            _ => None,
        },
    )
}

fn decode_group_row(row: &Row<'_>) -> SqlResult<RouteGroup> {
    let group_id: String = row.get(0)?;
    let activity_ids = decode_activity_ids(row, &group_id, 2, 7)?;
    Ok(RouteGroup {
        group_id,
        representative_id: row.get(1)?,
        activity_ids,
        sport_type: String::new(),
        bounds: decode_group_bounds(row)?,
        custom_name: None,
        best_time: None,
        avg_time: None,
        best_pace: None,
        best_activity_id: None,
    })
}

/// The direction of `track` against `representative`, judged by the same
/// endpoint rule the grouping applies to signatures, so a member the grouping
/// never compared against the representative still gets a measured direction.
fn endpoint_direction(
    track: &[GpsPoint],
    representative: &[GpsPoint],
    endpoint_threshold: f64,
) -> Direction {
    let signature = |points: &[GpsPoint]| {
        let (start, end) = (points[0], points[points.len() - 1]);
        let bounds = tracematch::Bounds::from_points(&[start, end]).unwrap();
        tracematch::RouteSignature {
            activity_id: String::new(),
            points: vec![start, end],
            total_distance: 0.0,
            start_point: start,
            end_point: end,
            bounds,
            center: bounds.center(),
        }
    };
    tracematch::matching::determine_direction_by_endpoints(
        &signature(track),
        &signature(representative),
        endpoint_threshold,
    )
}

/// Match percentage below which a member is a partial match of its route, not
/// an attempt in either direction. Grouping labels a member `Partial` at the
/// same threshold.
const PARTIAL_MATCH_PERCENTAGE: f64 = 70.0;

/// The direction stored for a member: `Partial` under the partial threshold,
/// otherwise the endpoint direction.
fn direction_for_percentage(percentage: f64, endpoint_direction: Direction) -> Direction {
    if percentage < PARTIAL_MATCH_PERCENTAGE {
        Direction::Partial
    } else {
        endpoint_direction
    }
}

/// Each member's match against its route's representative, measured on the
/// stored tracks rather than the simplified signatures. `seed` carries any
/// percentage already held. The direction is measured again against the
/// representative on every call, because a stored one belongs to whichever
/// representative it was measured against. Both regroup writers call this,
/// so the foreground and the worker cannot measure differently.
///
/// `only_group` narrows the work to one group, and `representative_override`
/// measures against a representative other than the stored one.
pub(super) fn measure_match_percentages(
    groups: &[RouteGroup],
    seed: &HashMap<String, Vec<ActivityMatchInfo>>,
    match_config: &tracematch::MatchConfig,
    load_track: impl Fn(&str) -> Option<Vec<GpsPoint>>,
    only_group: Option<&str>,
    representative_override: Option<&str>,
) -> HashMap<String, Vec<ActivityMatchInfo>> {
    use crate::matching::{amd_to_percentage, average_min_distance};
    use std::collections::HashMap;
    use std::time::Instant;

    let func_start = Instant::now();

    let in_scope = |group: &RouteGroup| match only_group {
        Some(id) => group.group_id == id,
        None => true,
    };

    log::info!(
        "veloqrs: [PERF] recalculate_match_percentages: {} of {} groups, parallel AMD via rayon",
        groups.iter().filter(|g| in_scope(g)).count(),
        groups.len()
    );

    // First pass: collect all activity IDs and load tracks
    // PERF: I/O bound - loads tracks SEQUENTIALLY from SQLite
    let load_start = Instant::now();
    let mut tracks: HashMap<String, Arc<Vec<GpsPoint>>> = HashMap::new();
    let mut calculated = seed.clone();
    let mut total_points_loaded: usize = 0;

    for group in groups.iter().filter(|g| in_scope(g)) {
        let representative_id = representative_override.unwrap_or(&group.representative_id);
        // Load representative track
        if let Some(track) = load_track(representative_id)
            && track.len() >= 2
        {
            total_points_loaded += track.len();
            tracks.insert(representative_id.to_string(), Arc::new(track));
        }

        // Load all member tracks in this group (use group.activity_ids,
        // not the seed, so this works even when the match
        // map is empty - e.g. after the incremental grouping path)
        for activity_id in &group.activity_ids {
            if !tracks.contains_key(activity_id)
                && let Some(track) = load_track(activity_id)
                && track.len() >= 2
            {
                total_points_loaded += track.len();
                tracks.insert(activity_id.clone(), Arc::new(track));
            }
        }
    }
    let load_ms = load_start.elapsed().as_millis();
    log::info!(
        "[RUST: PERF] Track loading: {} tracks, {} total points in {}ms (SEQUENTIAL I/O)",
        tracks.len(),
        total_points_loaded,
        load_ms
    );

    // Second pass: recalculate match percentages using AMD
    // PERF: CPU bound - O(n*m) distance calculations per pair
    // OPTIMISATION 1: Give the representative its self-match without AMD
    // OPTIMISATION 2: Parallelize with rayon
    let calc_start = Instant::now();

    type WorkItem = (String, String, Arc<Vec<GpsPoint>>, Arc<Vec<GpsPoint>>);
    let mut work_items: Vec<WorkItem> = Vec::new();
    let mut skipped_self = 0u32;

    for group in groups.iter().filter(|g| in_scope(g)) {
        let representative_id = representative_override.unwrap_or(&group.representative_id);
        if group.activity_ids.iter().any(|id| id == representative_id) {
            skipped_self += 1;
            let matches = calculated.entry(group.group_id.clone()).or_default();
            if let Some(info) = matches
                .iter_mut()
                .find(|m| m.activity_id == representative_id)
            {
                info.match_percentage = 100.0;
            } else {
                matches.push(ActivityMatchInfo {
                    activity_id: representative_id.to_string(),
                    match_percentage: 100.0,
                    direction: Direction::Same,
                });
            }
        }
        let rep_track = match tracks.get(representative_id) {
            Some(t) => t,
            None => continue,
        };

        for activity_id in &group.activity_ids {
            if activity_id == representative_id {
                continue;
            }

            let activity_track = match tracks.get(activity_id) {
                Some(t) => t,
                None => continue,
            };

            work_items.push((
                group.group_id.clone(),
                activity_id.clone(),
                Arc::clone(activity_track),
                Arc::clone(rep_track),
            ));
        }
    }

    log::info!(
        "[RUST: PERF] AMD work: {} pairs to compute, {} self-comparisons skipped",
        work_items.len(),
        skipped_self
    );

    // Parallel AMD calculation using rayon
    use rayon::prelude::*;

    let results: Vec<(String, String, f64, usize, usize, Direction)> = work_items
        .par_iter()
        .map(|(group_id, activity_id, activity_track, rep_track)| {
            let amd_1_to_2 = average_min_distance(activity_track, rep_track);
            let amd_2_to_1 = average_min_distance(rep_track, activity_track);
            let avg_amd = (amd_1_to_2 + amd_2_to_1) / 2.0;
            (
                group_id.clone(),
                activity_id.clone(),
                avg_amd,
                activity_track.len(),
                rep_track.len(),
                endpoint_direction(activity_track, rep_track, match_config.endpoint_threshold),
            )
        })
        .collect();

    let amd_calculations = (results.len() * 2) as u32;

    // Apply results back to activity_matches (upsert: create entry if missing)
    for (group_id, activity_id, avg_amd, activity_len, rep_len, direction) in results {
        let new_percentage = amd_to_percentage(
            avg_amd,
            match_config.perfect_threshold,
            match_config.zero_threshold,
        );

        let matches = calculated.entry(group_id).or_default();
        if let Some(match_info) = matches.iter_mut().find(|m| m.activity_id == activity_id) {
            log::debug!(
                "veloqrs: recalc match % for {}: {:.1}% -> {:.1}% (AMD: {:.1}m, {} vs {} points)",
                activity_id,
                match_info.match_percentage,
                new_percentage,
                avg_amd,
                activity_len,
                rep_len
            );
            match_info.match_percentage = new_percentage;
            match_info.direction = direction_for_percentage(new_percentage, direction);
        } else {
            matches.push(ActivityMatchInfo {
                activity_id,
                match_percentage: new_percentage,
                direction: direction_for_percentage(new_percentage, direction),
            });
        }
    }

    let calc_ms = calc_start.elapsed().as_millis();
    let total_ms = func_start.elapsed().as_millis();
    log::info!(
        "[RUST: PERF] AMD calculations: {} calls in {}ms (PARALLEL with rayon)",
        amd_calculations,
        calc_ms
    );
    log::info!(
        "[RUST: PERF] recalculate_match_percentages TOTAL: {}ms (load={}ms + calc={}ms)",
        total_ms,
        load_ms,
        calc_ms
    );
    calculated
}

/// Load route groups for a worker with its own database connection.
pub(super) fn load_groups_from_db(conn: &Connection) -> Vec<RouteGroup> {
    let mut stmt = match conn.prepare(
        "SELECT id, representative_id, activity_ids,
                bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
                activity_ids_blob FROM route_groups",
    ) {
        Ok(stmt) => stmt,
        Err(error) => {
            log::warn!("route_groups: failed to prepare worker query: {error}");
            return Vec::new();
        }
    };
    match stmt.query_map([], decode_group_row) {
        Ok(rows) => rows
            .filter_map(|row| match row {
                Ok(group) => Some(group),
                Err(error) => {
                    log::warn!("Skipping malformed row during group loading: {error}");
                    None
                }
            })
            .collect(),
        Err(error) => {
            log::warn!("route_groups: failed to query worker rows: {error}");
            Vec::new()
        }
    }
}
#[cfg(test)]
#[path = "tests/route_match_percentages.rs"]
mod match_percentage_regressions;

/// Each route whose representative the athlete chose, with that representative.
/// A writer that deletes and reinserts the groups reads this first and hands it
/// to [`mark_chosen_representatives`] after.
pub(super) fn chosen_representatives(conn: &Connection) -> SqlResult<Vec<(String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT id, representative_id FROM route_groups WHERE representative_chosen = 1",
    )?;
    stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect()
}

/// The routes a regroup carries the representative of: those whose
/// representative the athlete chose. Every other representative is the
/// grouping's own pick and is made again. When the record cannot be read,
/// every route in `prior` keeps its representative, so no choice is lost.
pub(super) fn routes_keeping_representative(
    conn: &Connection,
    prior: &[RouteGroup],
) -> HashSet<String> {
    match chosen_representatives(conn) {
        Ok(chosen) => chosen.into_iter().map(|(id, _)| id).collect(),
        Err(error) => {
            log::warn!("route_groups: chosen representatives unread, keeping every one: {error}");
            prior.iter().map(|group| group.group_id.clone()).collect()
        }
    }
}

/// `groups` as the incremental grouping takes them. It keeps an existing
/// group's representative while that is still a member, matched by group id,
/// so a representative the athlete did not choose is cleared and the grouping
/// makes its own pick there.
pub(super) fn groups_keeping_chosen_representatives(
    groups: &[RouteGroup],
    chosen: &HashSet<String>,
) -> Vec<RouteGroup> {
    groups
        .iter()
        .map(|group| {
            let mut group = group.clone();
            if !chosen.contains(&group.group_id) {
                group.representative_id.clear();
            }
            group
        })
        .collect()
}

/// Record again each choice in `chosen` whose route, rewritten, still holds the
/// chosen representative. A route the regroup dissolved, or one whose chosen
/// representative left it, keeps no record.
pub(super) fn mark_chosen_representatives(
    conn: &Connection,
    chosen: &[(String, String)],
) -> SqlResult<()> {
    let mut mark = conn.prepare(
        "UPDATE route_groups SET representative_chosen = 1
         WHERE id = ? AND representative_id = ?",
    )?;
    for (route_id, representative_id) in chosen {
        mark.execute(params![route_id, representative_id])?;
    }
    Ok(())
}

/// The order the route numbers are handed out in: most activities first, the
/// id closing it so two groups tied on the count do not swap numbers between
/// runs.
///
fn mint_order(a: &tracematch::RouteGroup, b: &tracematch::RouteGroup) -> std::cmp::Ordering {
    b.activity_ids
        .len()
        .cmp(&a.activity_ids.len())
        .then_with(|| a.group_id.cmp(&b.group_id))
}

/// The route word of every shipped language. A released build stored a minted
/// label in `route_names` in whichever of these was current at the time.
const SHIPPED_ROUTE_WORDS: [&str; 10] = [
    "Route",
    "Strecke",
    "Rute",
    "Ruta",
    "Trasa",
    "Rota",
    "Percorso",
    "Itinéraire",
    "ルート",
    "路线",
];

/// The number a stored name shows, when it reads as a route word and a
/// number, bare or behind a sport as released builds once minted it.
fn label_number(name: &str, route_word: &str) -> Option<u32> {
    let (label, digits) = name.rsplit_once(' ')?;
    let number: u32 = digits.parse().ok().filter(|n: &u32| *n > 0)?;
    if number.to_string() != digits {
        return None;
    }
    let word = label.rsplit_once(' ').map_or(label, |(sport, word)| {
        let sports = [
            "Ride",
            "Run",
            "Hike",
            "Walk",
            "Swim",
            "VirtualRide",
            "VirtualRun",
        ];
        if sports.contains(&sport) { word } else { label }
    });
    (word == route_word || SHIPPED_ROUTE_WORDS.contains(&word)).then_some(number)
}

fn stored_route_names(conn: &Connection) -> SqlResult<HashMap<String, String>> {
    let mut stmt = conn.prepare("SELECT route_id, custom_name FROM route_names")?;
    Ok(stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .filter_map(|row| match row {
            Ok(name) => Some(name),
            Err(error) => {
                log::warn!("Skipping malformed route name: {error:?}");
                None
            }
        })
        .collect())
}

pub(super) fn stored_route_numbers(conn: &Connection) -> SqlResult<HashMap<String, u32>> {
    let mut stmt = conn.prepare("SELECT route_id, number FROM route_numbers")?;
    Ok(stmt
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .filter_map(|row| match row {
            Ok(number) => Some(number),
            Err(error) => {
                log::warn!("Skipping malformed route number: {error:?}");
                None
            }
        })
        .collect())
}

/// The label a route with no typed name is shown under.
fn numbered_label(route_word: &str, number: u32) -> String {
    format!("{route_word} {number}")
}

/// The name every route is shown under: the one the athlete typed, otherwise
/// its number behind `route_word`.
fn route_display_names(conn: &Connection, route_word: &str) -> SqlResult<HashMap<String, String>> {
    let mut names = stored_route_names(conn)?;
    for (route_id, number) in stored_route_numbers(conn)? {
        if route_id.starts_with(HELD_NUMBER_PREFIX) {
            continue;
        }
        names
            .entry(route_id)
            .or_insert_with(|| numbered_label(route_word, number));
    }
    Ok(names)
}

/// `route_display_names` for `ids` alone, so a page of the list reads the
/// names it shows and not every route's.
fn route_display_names_for(
    conn: &Connection,
    route_word: &str,
    ids: &[&str],
) -> SqlResult<HashMap<String, String>> {
    let mut names = HashMap::new();
    let mut numbers = Vec::new();
    for chunk in ids.chunks(500) {
        let marks = vec!["?"; chunk.len()].join(",");
        let bound = rusqlite::params_from_iter(chunk.iter());
        let mut stmt = conn.prepare(&format!(
            "SELECT route_id, custom_name FROM route_names WHERE route_id IN ({marks})"
        ))?;
        for row in stmt.query_map(bound, |row| Ok((row.get(0)?, row.get(1)?)))? {
            let (id, name): (String, String) = row?;
            names.insert(id, name);
        }
        let bound = rusqlite::params_from_iter(chunk.iter());
        let mut stmt = conn.prepare(&format!(
            "SELECT route_id, number FROM route_numbers WHERE route_id IN ({marks})"
        ))?;
        for row in stmt.query_map(bound, |row| Ok((row.get(0)?, row.get(1)?)))? {
            numbers.push(row?);
        }
    }
    for (route_id, number) in numbers {
        let route_id: String = route_id;
        if route_id.starts_with(HELD_NUMBER_PREFIX) {
            continue;
        }
        names
            .entry(route_id)
            .or_insert_with(|| numbered_label(route_word, number));
    }
    Ok(names)
}

/// Give every group without a number one, within the caller's transaction.
/// A number stays with its route id when the group leaves, so a number is
/// never reissued to other ground and a group that returns keeps its own. A
/// number held for a restored route whose rides are not grouped here yet stays
/// held the same way.
///
/// A group whose stored name reads as a route word and a number holds that
/// number first when it is free, so a label kept from a released build never
/// shows beside an unnamed route minted to the same number. Every other group
/// takes the lowest number no route has held, in member-count order.
pub(super) fn mint_route_numbers(conn: &Connection, groups: &[RouteGroup]) -> SqlResult<()> {
    let numbers = stored_route_numbers(conn)?;
    let names = stored_route_names(conn)?;
    let route_word = get_route_word();
    let mut taken: HashSet<u32> = numbers.values().copied().collect();
    let mut unnumbered: Vec<&RouteGroup> = groups
        .iter()
        .filter(|group| !numbers.contains_key(&group.group_id))
        .collect();
    unnumbered.sort_by(|a, b| mint_order(a, b));

    let mut insert = conn.prepare("INSERT INTO route_numbers (route_id, number) VALUES (?, ?)")?;
    let mut rest = Vec::new();
    for group in unnumbered {
        let kept = names
            .get(&group.group_id)
            .and_then(|name| label_number(name, &route_word));
        match kept {
            Some(number) if taken.insert(number) => {
                insert.execute(params![group.group_id, number])?;
            }
            _ => rest.push(group),
        }
    }
    let mut candidate = 1;
    for group in rest {
        while taken.contains(&candidate) {
            candidate += 1;
        }
        insert.execute(params![group.group_id, candidate])?;
        taken.insert(candidate);
    }
    Ok(())
}

#[cfg(test)]
type RepresentativeWriteHook = Box<dyn FnOnce() + Send>;

#[cfg(test)]
static BEFORE_REPRESENTATIVE_WRITE: std::sync::Mutex<Option<RepresentativeWriteHook>> =
    std::sync::Mutex::new(None);

/// Run `hook` once, at the next representative write, before its transaction
/// opens and after the choice has followed the database.
#[cfg(test)]
pub(crate) fn before_next_representative_write(hook: impl FnOnce() + Send + 'static) {
    *BEFORE_REPRESENTATIVE_WRITE.lock().unwrap() = Some(Box::new(hook));
}

impl PersistentEngine {
    // ========================================================================
    // Loading
    // ========================================================================

    /// Load route groups from database.
    pub(super) fn load_groups(&mut self) -> SqlResult<()> {
        self.groups.clear();

        // Before the rows: a commit landing between the two reads then leaves
        // this engine on newer groups under an older generation, which costs a
        // background regroup its write, never the other way about.
        self.group_generation = super::route_identity::read_group_generation(&self.db)?;

        // Scope the statement to release the borrow before load_route_names
        {
            let mut stmt = self.db.prepare(
                "SELECT id, representative_id, activity_ids,
                        bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
                        activity_ids_blob
                 FROM route_groups",
            )?;

            self.groups = stmt
                .query_map([], decode_group_row)?
                .filter_map(|r| match r {
                    Ok(v) => Some(v),
                    Err(e) => {
                        log::warn!("Skipping malformed row during group loading: {:?}", e);
                        None
                    }
                })
                .collect();
        }

        // Load custom names and apply to groups
        self.load_route_names()?;

        // Load activity matches
        self.load_activity_matches()?;

        // If we have groups but no match info, force recompute to populate match percentages
        // This handles databases created before match percentage tracking was added
        let groups_count = self.groups.len();
        let matches_count = self.activity_matches.len();
        log::info!(
            "veloqrs: load_groups: {} groups, {} activity_matches entries",
            groups_count,
            matches_count
        );

        if !self.groups.is_empty() {
            stamp_groups_match_rule_if_absent(&self.db, &self.match_config)?;
        }
        if !self.groups.is_empty() && self.activity_matches.is_empty() {
            log::info!(
                "veloqrs: Forcing groups recompute: groups exist but activity_matches is empty"
            );
            self.set_groups_dirty(true);
        } else if groups_match_rule_changed(&self.db, &self.match_config) {
            log::info!(
                "veloqrs: Forcing groups recompute: the match rule changed since they were made"
            );
            self.set_groups_dirty(true);
        } else {
            self.set_groups_dirty(false);
        }

        // Backfill: ensure every group member has an activity_matches DB entry.
        // The grouping algorithm uses Union-Find which adds members transitively,
        // but only records match info for directly compared pairs.
        //
        // One prepared insert per member, not a probe and an insert. The key is
        // `(route_id, activity_id)`, so `OR IGNORE` leaves a row that already
        // carries a real percentage exactly where it was, and `changes()` is
        // the count the probe used to produce. This runs at launch and again
        // after every apply.
        let mut backfilled = 0u32;
        if let Ok(mut stmt) = self.db.prepare(
            "INSERT OR IGNORE INTO activity_matches (route_id, activity_id, match_percentage, direction)
             VALUES (?, ?, 0.0, 'same')",
        ) {
            for group in &self.groups {
                for activity_id in &group.activity_ids {
                    backfilled += stmt
                        .execute(rusqlite::params![&group.group_id, activity_id])
                        .unwrap_or(0) as u32;
                }
            }
        }
        if backfilled > 0 {
            // Reload matches to include the new entries
            self.load_activity_matches()?;
            log::info!(
                "veloqrs: Backfilled {} missing activity_matches entries from group member lists",
                backfilled
            );
        }

        // One-time migration: compute real AMD-based match percentages for
        // databases where all values are 0.0 (pre-fix data). Gated by a
        // schema_info flag so it runs exactly once per install.
        let already_migrated: bool = self
            .db
            .query_row(
                "SELECT value FROM schema_info WHERE key = 'match_pct_backfilled_v1'",
                [],
                |row| row.get::<_, String>(0),
            )
            .is_ok();

        if !already_migrated && !self.activity_matches.is_empty() {
            let rep_ids: std::collections::HashSet<&str> = self
                .groups
                .iter()
                .map(|g| g.representative_id.as_str())
                .collect();

            let has_any_nonzero = self
                .activity_matches
                .values()
                .flat_map(|matches| matches.iter())
                .any(|m| !rep_ids.contains(m.activity_id.as_str()) && m.match_percentage > 0.0);

            if !has_any_nonzero {
                log::info!(
                    "veloqrs: [migration] All non-representative match percentages are 0.0, \
                     running one-time AMD recalculation"
                );
                self.activity_matches = self.recalculate_match_percentages_from_tracks(None, None);
                match self.persist_match_percentages(None) {
                    Ok(()) => {
                        let _ = self.db.execute(
                            "INSERT OR REPLACE INTO schema_info (key, value)
                             VALUES ('match_pct_backfilled_v1', '1')",
                            [],
                        );
                    }
                    Err(e) => {
                        log::error!(
                            "veloqrs: [migration] Failed to persist match percentages: {}",
                            e
                        );
                    }
                }
            } else {
                let _ = self.db.execute(
                    "INSERT OR REPLACE INTO schema_info (key, value)
                     VALUES ('match_pct_backfilled_v1', '1')",
                    [],
                );
            }
        }

        Ok(())
    }

    /// Number any group that has no number yet, then put every group's
    /// shown name on it.
    fn load_route_names(&mut self) -> SqlResult<()> {
        mint_route_numbers(&self.db, &self.groups)?;
        self.apply_route_names()
    }

    /// Put each group's shown name on the in-memory groups, in the current
    /// route word, and drop cached groups that carry the previous one.
    pub(super) fn apply_route_names(&mut self) -> SqlResult<()> {
        let route_word = get_route_word();
        let names = route_display_names(&self.db, &route_word)?;
        for group in &mut self.groups {
            group.custom_name = names.get(&group.group_id).cloned();
        }
        self.route_names_word = route_word;
        Ok(())
    }

    // ========================================================================
    // Route Groups
    // ========================================================================

    /// How tightly rides group into routes, and the two settings rows behind
    /// it, in one place.
    ///
    /// The grouping is recomputed only when `groups_dirty` is set, and until
    /// this existed that flag was set by the activity ingestion paths alone.
    /// So the rule could change and the groups it made would stand until an
    /// unrelated import happened to dirty them. Guarded on equality for the
    /// same reason `set_section_config` is: re-sending the value already held
    /// is not a reason to regroup a whole library.
    pub fn set_match_strictness(&mut self, min_match_pct: f64, endpoint_threshold: f64) {
        if self.match_config.min_match_percentage == min_match_pct
            && self.match_config.endpoint_threshold == endpoint_threshold
        {
            return;
        }
        // Groups from before the rule was stamped were made under the rule
        // being replaced, and that has to be on record before it goes.
        if let Err(e) = stamp_groups_match_rule_if_absent(&self.db, &self.match_config) {
            log::warn!("veloqrs: [set_match_strictness] stamp failed: {}", e);
        }
        self.match_config.min_match_percentage = min_match_pct;
        self.match_config.endpoint_threshold = endpoint_threshold;
        // Logged rather than propagated, like the detector config's own
        // persist: the in-memory rule has already changed, and the loader
        // falls back to the default when a key is absent.
        for (key, value) in [
            (
                crate::persistence::settings_keys::MATCH_MIN_MATCH_PCT,
                min_match_pct,
            ),
            (
                crate::persistence::settings_keys::MATCH_ENDPOINT_THRESHOLD,
                endpoint_threshold,
            ),
        ] {
            if let Err(e) = self.set_setting(key, &value.to_string()) {
                log::warn!(
                    "veloqrs: [set_match_strictness] persist {} failed: {}",
                    key,
                    e
                );
            }
        }
        self.set_groups_dirty(true);
    }

    /// The strictness in force, as `(min_match_percentage, endpoint_threshold)`.
    pub fn match_strictness(&self) -> (f64, f64) {
        (
            self.match_config.min_match_percentage,
            self.match_config.endpoint_threshold,
        )
    }

    /// Whether the grouping is waiting to be recomputed.
    #[doc(hidden)]
    pub fn groups_are_dirty(&self) -> bool {
        self.groups_dirty
    }

    /// Get route groups, recomputing if dirty.
    pub fn get_groups(&mut self) -> &[RouteGroup] {
        if self.groups_dirty {
            self.recompute_groups();
        }
        if self.route_names_word != get_route_word()
            && let Err(error) = self.apply_route_names()
        {
            log::warn!("[get_groups] route names: {error}");
        }
        &self.groups
    }

    /// Reload groups from DB (e.g. after the background thread saved fresh
    /// groups). Clears the dirty flag so the next `get_groups()` won't
    /// re-trigger a synchronous recompute.
    pub fn reload_groups_from_db(&mut self) {
        if let Err(e) = self.load_groups_with_registry() {
            log::warn!("[reload_groups_from_db] Failed: {}", e);
        }
    }

    /// Adopt the groups and registry a background regroup has just committed,
    /// leaving a regroup that is owed still owed. The flag cannot tell the
    /// regroup this run answered from a store made while it ran, so it stays
    /// set and the next read regroups over the adopted catalogue.
    pub(crate) fn adopt_committed_groups(&mut self) {
        let dirty = self.groups_dirty;
        self.reload_groups_from_db();
        // Re-asserting a flag that was already set invalidates nothing new, so
        // the epoch stays where it was: a run reads a moved epoch as a store.
        self.groups_dirty = dirty;
    }

    /// Adopt the groups a finished detection run left in the database. The
    /// grouping stays owed when the run could not commit its regroup, and when
    /// anything marked it stale after the run captured `epoch_at_spawn`: the
    /// run grouped the library as it stood at spawn, so a store made since is
    /// in no route yet.
    pub(crate) fn adopt_run_groups(&mut self, regroup_owed: bool, epoch_at_spawn: u64) {
        let owed = regroup_owed || self.groups_dirty_epoch != epoch_at_spawn;
        self.reload_groups_from_db();
        self.set_groups_dirty(owed);
    }

    /// Adopt a group write committed on another connection that no caller
    /// adopted, as when the cutover's wait gives up and its detect commits
    /// afterwards. The engine lock runs this before handing the engine to any
    /// caller once such a write has committed, so no reader acts on the groups
    /// that commit replaced. A write runs it again where a commit can land
    /// inside the same lock hold.
    pub(crate) fn follow_committed_groups(&mut self) {
        match super::route_identity::read_group_generation(&self.db) {
            Ok(generation) if generation != self.group_generation => {
                self.adopt_committed_groups();
            }
            Ok(_) => {}
            Err(e) => {
                log::warn!(
                    "veloqrs: [follow_committed_groups] generation read failed: {}",
                    e
                );
                // Unread, so the next lock take tries again.
                super::route_identity::note_group_commit_off_engine();
            }
        }
    }

    /// Load route groups and the registry that assigns their stable ids.
    pub(super) fn load_groups_with_registry(&mut self) -> SqlResult<()> {
        self.load_groups()?;
        if !self.route_identity_restore() {
            self.route_identity_reseed();
        }
        Ok(())
    }

    /// Recompute route groups.
    fn recompute_groups(&mut self) {
        use std::time::Instant;
        let total_start = Instant::now();
        log::info!("[RUST: PERF] recompute_groups: starting...");

        // A background regroup can commit after the adopt meant for it, as the
        // cutover's detect does once its wait has given up. Remapping over the
        // groups that commit replaced would mint ids it already holds and carry
        // its names onto other routes, so the regroup starts from the commit.
        self.follow_committed_groups();

        // Phase 1: Load all signatures (Arc avoids full clone on cache hit)
        let sig_start = Instant::now();
        let activity_ids: Vec<String> = self.activity_metadata.keys().cloned().collect();
        let mut arc_sigs: Vec<std::sync::Arc<RouteSignature>> =
            Vec::with_capacity(activity_ids.len());

        // One statement for the whole library. The signature cache holds 200,
        // so asking it per activity evicts what the same walk just loaded and
        // decodes every blob again on any library past that size.
        let signatures = self.load_all_signatures();
        for id in &activity_ids {
            if let Some(sig) = signatures.get(id) {
                arc_sigs.push(std::sync::Arc::clone(sig));
            }
        }
        let sig_ms = sig_start.elapsed().as_millis();

        log::info!(
            "[RUST: PERF] Phase 1 - Load signatures: {} from {} activities in {}ms",
            arc_sigs.len(),
            activity_ids.len(),
            sig_ms
        );

        // Phase 2: Group signatures and capture match info.
        //
        // Take the incremental path when we have existing groups AND the
        // new-to-total ratio is small. `group_incremental` is O(N × M) vs
        // the full path's O(N²). For 550 activities with 3 new, that's
        // ~10× less work, and the full path dominates the wall clock
        // without it (4s of 9s on a full resync).
        let group_start = Instant::now();

        let already_grouped: std::collections::HashSet<&str> = self
            .groups
            .iter()
            .flat_map(|g| g.activity_ids.iter().map(|s| s.as_str()))
            .collect();

        let total = arc_sigs.len();
        let chosen = routes_keeping_representative(&self.db, &self.groups);
        // Incremental grouping is correct at any new-to-total ratio
        // (existing groups stay valid; we only add new edges). The
        // benchmark shows it's faster than full at every ratio measured
        // (60+90 → −37%, 154+396 → −19%). The 90% gate exists only to
        // Count new (ungrouped) sigs cheaply via Arc references - no clone yet.
        let new_count = arc_sigs
            .iter()
            .filter(|s| !already_grouped.contains(s.activity_id.as_str()))
            .count();

        // skip the partition + HashSet build when nearly everything is
        // new - full is simpler in that fresh-import case.
        // A changed rule re-evaluates pairs the incremental path never looks at.
        let use_incremental = !self.groups.is_empty()
            && new_count > 0
            && (new_count as f64) < (total as f64 * 0.9)
            && !groups_match_rule_changed(&self.db, &self.match_config);

        // Materialise owned Vecs for tracematch (needs &[RouteSignature]).
        // With Arc this is one clone per sig instead of two (cache-hit + partition).
        let result = if use_incremental {
            let new_sigs: Vec<RouteSignature> = arc_sigs
                .iter()
                .filter(|s| !already_grouped.contains(s.activity_id.as_str()))
                .map(|a| a.as_ref().clone())
                .collect();
            let existing_sigs: Vec<RouteSignature> = arc_sigs
                .iter()
                .filter(|s| already_grouped.contains(s.activity_id.as_str()))
                .map(|a| a.as_ref().clone())
                .collect();
            log::info!(
                "[RUST: PERF] Phase 2 - INCREMENTAL grouping: {} new vs {} existing",
                new_sigs.len(),
                existing_sigs.len()
            );
            tracematch::group_incremental_with_matches(
                &new_sigs,
                &groups_keeping_chosen_representatives(&self.groups, &chosen),
                &existing_sigs,
                &self.match_config,
            )
        } else {
            let signatures: Vec<RouteSignature> =
                arc_sigs.iter().map(|a| a.as_ref().clone()).collect();
            log::info!(
                "[RUST: PERF] Phase 2 - FULL grouping: {} signatures",
                signatures.len()
            );
            tracematch::group_signatures_parallel_with_matches(&signatures, &self.match_config)
        };

        let group_ms = group_start.elapsed().as_millis();
        log::info!(
            "[RUST: PERF] Phase 2 - Group signatures: {} groups in {}ms (uses simplified signatures)",
            result.groups.len(),
            group_ms
        );

        // Remap the freshly-grouped catalogue onto stable assign-once ids. The
        // grouping assigned each group the Union-Find root as its id (which the
        // full and incremental paths pick differently, re-keying to the min member
        // on a resync); the registry carries the prior stable id and the user's
        // representative onto the matching group by member overlap instead.
        let prior_groups = std::mem::take(&mut self.groups);
        let prior_matches = self.activity_matches.clone();
        let prior_identity = self.route_identity.clone();
        let (remapped, id_map) =
            self.route_identity_remap(prior_groups.clone(), result.groups, &chosen);
        self.groups = remapped;
        // A regroup rebuilds the in-memory groups from geometry; the names and
        // numbers live in `route_names` and `route_numbers` and ride back onto
        // the ids that survived.
        let names = self.get_all_route_names();
        for group in &mut self.groups {
            group.custom_name = names.get(&group.group_id).cloned();
        }
        // Re-key the grouping's match info (which carries each member's
        // direction) by the stable ids the remap assigned, or the direction
        // lookup in route highlights would miss the new id and default every
        // traversal to forward. The incremental path reports only the groups
        // that took a new member, so merge over what is already held and then
        // drop the ids the grouping no longer emits.
        for (old_id, matches) in result.activity_matches {
            let id = id_map.get(&old_id).cloned().unwrap_or(old_id);
            self.activity_matches.insert(id, matches);
        }
        let live: std::collections::HashSet<String> =
            self.groups.iter().map(|g| g.group_id.clone()).collect();
        self.activity_matches.retain(|id, _| live.contains(id));

        // Phase 3: Recalculate match percentages using ORIGINAL GPS tracks (not simplified signatures)
        // This captures actual GPS variation that was smoothed out by Douglas-Peucker
        // NOTE: This is the BOTTLENECK - see PERF logs inside this function
        self.activity_matches = self.recalculate_match_percentages_from_tracks(None, None);

        // Log match info computed
        let total_matches: usize = self.activity_matches.values().map(|v| v.len()).sum();
        log::info!(
            "[RUST: PERF] Phase 3 complete: {} groups with {} total match entries",
            self.groups.len(),
            total_matches
        );

        for group in &mut self.groups {
            group.sport_type.clear();
        }

        // Phase 4: Save to database
        let save_start = Instant::now();
        // `save_groups` writes the route registry blob in its own transaction
        // (mint counter + seniority), atomic with the groups it describes.
        if let Err(e) = self.save_groups() {
            log::error!("veloqrs: Failed to save groups to database: {}", e);
            self.groups = prior_groups;
            self.activity_matches = prior_matches;
            self.route_identity = prior_identity;
            self.set_groups_dirty(true);
            return;
        }
        let save_ms = save_start.elapsed().as_millis();
        self.set_groups_dirty(false);

        // Recompute materialised PR/trend indicators with updated route groups
        if let Err(e) = self.recompute_activity_indicators() {
            log::warn!(
                "veloqrs: [recompute_groups] Indicator recomputation failed: {}",
                e
            );
        }

        let total_ms = total_start.elapsed().as_millis();
        log::info!("[RUST: PERF] Phase 4 - Save groups: {}ms", save_ms);
        log::info!(
            "[RUST: PERF] recompute_groups TOTAL: {}ms (signatures={}ms + grouping={}ms + AMD_recalc=see_above + save={}ms)",
            total_ms,
            sig_ms,
            group_ms,
            save_ms
        );
    }

    /// Recalculate match percentages using original GPS tracks instead of simplified signatures.
    /// Uses AMD (Average Minimum Distance) for accurate track comparison.
    /// Recompute match percentages against each group's representative.
    ///
    /// `only_group` narrows the work to one group, which is what a tap that
    /// chooses a representative needs: the other groups' representatives have
    /// not moved, so their percentages cannot have changed. `None` does the whole
    /// library, which is what regrouping needs. Without the filter, choosing a
    /// representative for one route loaded and compared every track in every
    /// group, on the JS thread and under the write lock.
    fn recalculate_match_percentages_from_tracks(
        &self,
        only_group: Option<&str>,
        representative_override: Option<&str>,
    ) -> HashMap<String, Vec<ActivityMatchInfo>> {
        measure_match_percentages(
            &self.groups,
            &self.activity_matches,
            &self.match_config,
            |id| self.load_gps_track_from_db(id),
            only_group,
            representative_override,
        )
    }

    /// Write in-memory match percentages back to SQLite.
    /// Writes every match value, including a drop to zero and the representative's self-match.
    ///
    /// `only_group` matches the recompute above: write back what was just
    /// recalculated and nothing else. One transaction, not one per row: every
    /// `UPDATE` used to autocommit, which is a disk sync each, on a user tap.
    fn persist_match_percentages(&self, only_group: Option<&str>) -> SqlResult<()> {
        self.db.execute_batch("BEGIN IMMEDIATE")?;
        let result = self.write_match_percentages(only_group);
        match result {
            Ok(updated) => {
                super::commit_write_txn(&self.db)?;
                if updated > 0 {
                    log::info!("veloqrs: Persisted {} match percentages to DB", updated);
                }
                Ok(())
            }
            Err(e) => {
                // A partial write would leave percentages disagreeing with the
                // representative they were measured against.
                let _ = self.db.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    }

    fn write_match_percentages(&self, only_group: Option<&str>) -> SqlResult<u32> {
        let mut stmt = self.db.prepare(
            "UPDATE activity_matches SET match_percentage = ?, direction = ?
             WHERE route_id = ? AND activity_id = ?",
        )?;
        let mut updated = 0u32;
        for (route_id, matches) in &self.activity_matches {
            if let Some(id) = only_group
                && route_id != id
            {
                continue;
            }
            for m in matches {
                updated += stmt.execute(params![
                    m.match_percentage,
                    m.direction.to_string(),
                    route_id,
                    m.activity_id
                ])? as u32;
            }
        }
        Ok(updated)
    }

    pub(super) fn save_groups(&mut self) -> SqlResult<()> {
        // The DELETE + rebuild below must be atomic: a failure mid-way would
        // otherwise permanently drop every route group and activity match.
        self.db.execute_batch("BEGIN IMMEDIATE")?;

        let result = (|| -> SqlResult<u64> {
            // Snapshot excluded flags before wiping - user exclusions must survive recompute
            let excluded_pairs: Vec<(String, String)> = {
                let mut stmt = self.db.prepare(
                    "SELECT route_id, activity_id FROM activity_matches WHERE excluded = 1",
                )?;
                stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
                    .filter_map(|r| r.ok())
                    .collect()
            };

            let chosen = chosen_representatives(&self.db)?;
            self.db.execute("DELETE FROM route_groups", [])?;
            self.db.execute("DELETE FROM activity_matches", [])?;

            // Insert groups (dual-write: JSON for backward compat, blob for fast reads)
            let mut stmt = self.db.prepare(
                "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type,
                                            bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
                                            activity_count, activity_ids_blob)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )?;

            let mut sorted_groups: Vec<&tracematch::RouteGroup> = self.groups.iter().collect();
            sorted_groups.sort_by(|a, b| mint_order(a, b));

            for group in sorted_groups {
                let activity_ids_json = serde_json::to_string(&group.activity_ids)
                    .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
                let activity_ids_blob = codec::serialize(&group.activity_ids).ok();
                stmt.execute(params![
                    group.group_id,
                    group.representative_id,
                    activity_ids_json,
                    "",
                    group.bounds.map(|b| b.min_lat),
                    group.bounds.map(|b| b.max_lat),
                    group.bounds.map(|b| b.min_lng),
                    group.bounds.map(|b| b.max_lng),
                    group.activity_ids.len() as u32,
                    activity_ids_blob,
                ])?;
            }

            mark_chosen_representatives(&self.db, &chosen)?;
            mint_route_numbers(&self.db, &self.groups)?;

            // Insert activity matches
            let mut match_stmt = self.db.prepare(
                "INSERT OR IGNORE INTO activity_matches (route_id, activity_id, match_percentage, direction)
                 VALUES (?, ?, ?, ?)",
            )?;

            for (route_id, matches) in &self.activity_matches {
                for m in matches {
                    match_stmt.execute(params![
                        route_id,
                        m.activity_id,
                        m.match_percentage,
                        m.direction.to_string(),
                    ])?;
                }
            }

            // Ensure every group member has an activity_matches entry.
            // The grouping algorithm sometimes produces groups with activity IDs
            // that don't have corresponding match info (e.g., when activities are
            // added incrementally). Fill in missing entries with a default.
            for group in &self.groups {
                for activity_id in &group.activity_ids {
                    match_stmt.execute(params![
                        group.group_id,
                        activity_id,
                        0.0f64, // default for members not in activity_matches (representatives, tracks not loaded)
                        "same",
                    ])?;
                }
            }

            // Restore excluded flags that were snapshotted before the DELETE
            if !excluded_pairs.is_empty() {
                let mut excl_stmt = self.db.prepare(
                    "UPDATE activity_matches SET excluded = 1 WHERE route_id = ? AND activity_id = ?",
                )?;
                let mut restored = 0u32;
                for (route_id, activity_id) in &excluded_pairs {
                    restored += excl_stmt.execute(params![route_id, activity_id])? as u32;
                }
                if restored > 0 {
                    log::info!(
                        "veloqrs: Restored {} excluded flags after save_groups",
                        restored
                    );
                }
            }

            // Write the route registry blob in THIS transaction so it commits
            // atomically with the groups.
            if let Some(blob) = self.route_identity_blob() {
                self.db.execute(
                    "INSERT INTO identity_state (key, blob, updated_at)
                     VALUES (?, ?, datetime('now'))
                     ON CONFLICT(key) DO UPDATE SET blob = excluded.blob, updated_at = excluded.updated_at",
                    params![super::route_identity::ROUTE_IDENTITY_KEY, blob],
                )?;
            }

            stamp_groups_match_rule(&self.db, &self.match_config)?;

            // Advanced without a compare: this write replaces the whole
            // catalogue from memory, so a background commit landing since the
            // engine last followed is overwritten along with its generation,
            // and memory and the database agree again.
            let generation = super::route_identity::advance_group_generation(&self.db)?;
            super::route_lines::rebuild(&self.db)?;
            Ok(generation)
        })();

        let committed =
            result.and_then(|generation| self.db.execute_batch("COMMIT").map(|()| generation));
        match committed {
            Ok(generation) => {
                self.group_generation = generation;
                // A group this save numbered is shown under that number at once,
                // not only after the next load. The save has committed either way.
                if let Err(error) = self.apply_route_names() {
                    log::warn!("[save_groups] route names: {error}");
                }
                Ok(())
            }
            Err(e) => {
                let _ = self.db.execute_batch("ROLLBACK");
                Err(e)
            }
        }
    }

    // ========================================================================
    // Group Queries
    // ========================================================================

    /// Get group count from database.
    pub fn get_group_count(&self) -> u32 {
        self.db
            .query_row("SELECT COUNT(*) FROM route_groups", [], |row| row.get(0))
            .unwrap_or(0)
    }

    /// Get group summaries for the routes screen, from the one assembly the
    /// pooled read uses. A group's sports come from `activities` and fall back
    /// to `activity_metrics`, so they are known from ingest, before metrics.
    pub fn get_group_summaries(&self) -> Vec<GroupSummary> {
        pooled::group_summaries(&self.db)
    }

    // ========================================================================
    // Representative Routes
    // ========================================================================

    /// The stored representative's own track for a route group.
    pub fn get_representative_route(&self, group_id: &str) -> Option<Vec<GpsPoint>> {
        pooled::representative_route(&self.db, group_id)
    }

    // ========================================================================
    // Route Names
    // ========================================================================

    /// Set the name the athlete typed for a route. `None`, or the route's own
    /// numbered label in the current language, clears it, so the route is
    /// shown under its number again and that label follows the language.
    pub fn set_route_name(&mut self, route_id: &str, name: Option<&str>) -> SqlResult<()> {
        let route_word = get_route_word();
        let number: Option<u32> = self
            .db
            .query_row(
                "SELECT number FROM route_numbers WHERE route_id = ?",
                params![route_id],
                |row| row.get(0),
            )
            .optional()?;
        let typed =
            name.filter(|name| number.is_none_or(|n| *name != numbered_label(&route_word, n)));
        match typed {
            Some(name) => {
                self.db.execute(
                    "INSERT OR REPLACE INTO route_names (route_id, custom_name) VALUES (?, ?)",
                    params![route_id, name],
                )?;
            }
            None => {
                self.db.execute(
                    "DELETE FROM route_names WHERE route_id = ?",
                    params![route_id],
                )?;
            }
        }
        let shown = typed
            .map(str::to_string)
            .or_else(|| number.map(|n| numbered_label(&route_word, n)));
        if let Some(group) = self.groups.iter_mut().find(|g| g.group_id == route_id) {
            group.custom_name = shown;
        }
        Ok(())
    }

    /// The name a route is shown under.
    pub fn get_route_name(&self, route_id: &str) -> Option<String> {
        if self.route_names_word != get_route_word() {
            return pooled::all_route_names(&self.db).remove(route_id);
        }
        self.groups
            .iter()
            .find(|g| g.group_id == route_id)
            .and_then(|g| g.custom_name.clone())
    }

    /// The name every route is shown under, keyed by route.
    pub fn get_all_route_names(&self) -> HashMap<String, String> {
        pooled::all_route_names(&self.db)
    }

    // ========================================================================
    // Route Activity Exclusion
    // ========================================================================

    /// Exclude an activity from a route's analysis.
    /// Sets the `excluded` flag to 1 on the activity_matches row.
    pub fn exclude_activity_from_route(
        &mut self,
        route_id: &str,
        activity_id: &str,
    ) -> Result<(), String> {
        self.db
            .execute(
                "UPDATE activity_matches SET excluded = 1 WHERE route_id = ? AND activity_id = ?",
                params![route_id, activity_id],
            )
            .map_err(|e| format!("Failed to exclude activity from route: {}", e))?;
        Ok(())
    }

    /// Re-include a previously excluded activity in a route's analysis.
    /// Sets the `excluded` flag back to 0 on the activity_matches row.
    pub fn include_activity_in_route(
        &mut self,
        route_id: &str,
        activity_id: &str,
    ) -> Result<(), String> {
        self.db
            .execute(
                "UPDATE activity_matches SET excluded = 0 WHERE route_id = ? AND activity_id = ?",
                params![route_id, activity_id],
            )
            .map_err(|e| format!("Failed to include activity in route: {}", e))?;
        Ok(())
    }

    /// Get activity IDs that are excluded from a route.
    pub fn get_excluded_route_activity_ids(&self, route_id: &str) -> Vec<String> {
        pooled::excluded_route_activity_ids(&self.db, route_id)
    }

    /// Choose a route's representative. A group write committed on another
    /// connection while the match percentages are recalculated refuses the
    /// write, and the choice runs again over the catalogue that write left,
    /// a bounded number of times.
    pub fn set_route_representative(
        &mut self,
        route_id: &str,
        activity_id: &str,
    ) -> Result<(), String> {
        const ATTEMPTS: usize = 3;
        for _ in 0..ATTEMPTS {
            match self.try_set_route_representative(route_id, activity_id)? {
                RepresentativeWrite::Written => return Ok(()),
                RepresentativeWrite::Superseded => {}
            }
        }
        Err(format!(
            "Route groups kept changing while choosing a representative for {route_id}"
        ))
    }

    fn try_set_route_representative(
        &mut self,
        route_id: &str,
        activity_id: &str,
    ) -> Result<RepresentativeWrite, String> {
        self.follow_committed_groups();
        let member = self
            .groups
            .iter()
            .find(|g| g.group_id == route_id)
            .ok_or_else(|| format!("Route group {} not found", route_id))?
            .activity_ids
            .iter()
            .any(|id| id == activity_id);

        if !member {
            return Err(format!(
                "Activity {} is not a member of route {}",
                activity_id, route_id
            ));
        }

        let calculated = self
            .recalculate_match_percentages_from_tracks(Some(route_id), Some(activity_id))
            .remove(route_id)
            .unwrap_or_default();

        let Some(generation) =
            self.write_representative_selection(route_id, activity_id, &calculated)?
        else {
            return Ok(RepresentativeWrite::Superseded);
        };
        self.group_generation = generation;

        self.groups
            .iter_mut()
            .find(|group| group.group_id == route_id)
            .unwrap()
            .representative_id = activity_id.to_string();
        self.activity_matches
            .insert(route_id.to_string(), calculated);

        Ok(RepresentativeWrite::Written)
    }

    /// Write the choice and advance the generation, or `None` when a group
    /// write committed since this engine last followed the database, in which
    /// case nothing is written. Compared inside the write's own transaction,
    /// as the background regroup compares, so nothing commits in between.
    fn write_representative_selection(
        &mut self,
        route_id: &str,
        activity_id: &str,
        calculated: &[ActivityMatchInfo],
    ) -> Result<Option<u64>, String> {
        #[cfg(test)]
        {
            let hook = BEFORE_REPRESENTATIVE_WRITE.lock().unwrap().take();
            if let Some(hook) = hook {
                hook();
            }
        }
        let mut superseded = false;
        let written = self.in_write_txn(|engine| {
            let stored = super::route_identity::read_group_generation(&engine.db)
                .map_err(|error| format!("DB read failed: {error}"))?;
            if stored != engine.group_generation {
                superseded = true;
                return Err(String::from("superseded"));
            }
            let updated = engine
                .db
                .execute(
                    "UPDATE route_groups SET representative_id = ?, representative_chosen = 1
                     WHERE id = ?",
                    params![activity_id, route_id],
                )
                .map_err(|error| format!("DB update failed: {error}"))?;
            if updated != 1 {
                return Err(format!("Route group {route_id} is no longer stored"));
            }
            for item in calculated {
                engine
                    .db
                    .execute(
                        "INSERT INTO activity_matches (route_id, activity_id, match_percentage, direction)
                         VALUES (?, ?, ?, ?)
                         ON CONFLICT(route_id, activity_id) DO UPDATE SET
                             match_percentage = excluded.match_percentage,
                             direction = excluded.direction",
                        params![route_id, item.activity_id, item.match_percentage, item.direction.to_string()],
                    )
                    .map_err(|error| format!("DB update failed: {error}"))?;
            }
            let generation = super::route_identity::advance_group_generation(&engine.db)
                .map_err(|error| format!("DB update failed: {error}"))?;
            super::route_lines::replace_representative(&engine.db, route_id, activity_id, stored)
                .map_err(|error| format!("DB update failed: {error}"))?;
            Ok(generation)
        });
        match written {
            Err(_) if superseded => Ok(None),
            written => written.map(Some),
        }
    }
}

/// What became of one attempt at a representative choice.
enum RepresentativeWrite {
    Written,
    /// A group write committed between the follow and the write, so nothing
    /// was written and the choice is to run again over that write's groups.
    Superseded,
}

impl PersistentEngine {
    /// The routes each section's activities are grouped into, from the
    /// junction join, for a batch of sections in one statement. `DISTINCT`
    /// because the junction is keyed per pass, and an exclusion on either
    /// table keeps its row out, and a group under the routes list's floor is
    /// not a route. A section on no route is absent from the map.
    pub fn route_ids_for_sections(&self, section_ids: &[String]) -> HashMap<String, Vec<String>> {
        pooled::route_ids_for_sections(&self.db, section_ids)
    }

    /// The visible sections a route's activities pass through, from the same join.
    pub fn section_ids_for_route(&self, route_id: &str) -> Vec<String> {
        pooled::section_ids_for_route(&self.db, route_id)
    }
}

/// Route reads that need no engine, only its database.
///
/// The engine methods above are these same reads on the write connection, so
/// a pooled reader and a lock holder cannot answer differently.
pub(crate) mod pooled {
    /// The routes each of these sections is passed through on, from the same
    /// join the engine method used to run here.
    pub(crate) fn route_ids_for_sections(
        conn: &Connection,
        section_ids: &[String],
    ) -> HashMap<String, Vec<String>> {
        let mut out: HashMap<String, Vec<String>> = HashMap::new();
        if section_ids.is_empty() {
            return out;
        }
        let placeholders = vec!["?"; section_ids.len()].join(", ");
        let sql = format!(
            "SELECT DISTINCT sa.section_id, am.route_id
             FROM section_activities sa
             JOIN activity_matches am ON am.activity_id = sa.activity_id
             WHERE sa.section_id IN ({placeholders}) AND sa.excluded = 0 AND am.excluded = 0
             ORDER BY sa.section_id, am.route_id"
        );
        let Ok(mut stmt) = conn.prepare(&sql) else {
            return out;
        };
        let routes: std::collections::HashSet<String> = group_keys(conn, false, false)
            .into_iter()
            .filter(|g| g.activity_count >= crate::persistence::route_lines::MIN_ROUTE_ACTIVITIES)
            .map(|g| g.group_id)
            .collect();
        let rows = stmt.query_map(rusqlite::params_from_iter(section_ids.iter()), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        });
        if let Ok(rows) = rows {
            for (section_id, route_id) in rows.filter_map(|r| r.ok()) {
                if routes.contains(&route_id) {
                    out.entry(section_id).or_default().push(route_id);
                }
            }
        }
        out
    }

    use std::collections::HashMap;

    use rusqlite::{Connection, Result as SqlResult, Row, params};

    use tracematch::{GpsPoint, RouteGroup};

    use super::{decode_activity_ids, decode_group_bounds, decode_group_row};

    pub(crate) fn representative_polylines(
        conn: &Connection,
        activity_ids: &[&str],
    ) -> HashMap<String, Vec<u8>> {
        if activity_ids.is_empty() {
            return HashMap::new();
        }
        let placeholders = vec!["?"; activity_ids.len()].join(",");
        let query = format!(
            "SELECT activity_id, points FROM signatures WHERE activity_id IN ({placeholders})"
        );
        let Ok(mut stmt) = conn.prepare(&query) else {
            return HashMap::new();
        };
        let params: Vec<&dyn rusqlite::types::ToSql> = activity_ids
            .iter()
            .map(|id| id as &dyn rusqlite::types::ToSql)
            .collect();
        stmt.query_map(params.as_slice(), |row| {
            let id: String = row.get(0)?;
            let points_blob: Vec<u8> = row.get(1)?;
            let points: Vec<GpsPoint> = match super::codec::deserialize_points(&points_blob) {
                Ok(points) => points,
                Err(e) => {
                    log::error!("signatures {id}: points read failed: {e}");
                    return Ok(None);
                }
            };
            Ok(Some((
                id,
                crate::persistence::codec::encode_polyline(&points),
            )))
        })
        .map(|rows| rows.filter_map(Result::ok).flatten().collect())
        .unwrap_or_default()
    }

    /// The match rows for one route, in the shape the performance arithmetic
    /// takes them.
    ///
    /// A row whose direction will not parse is skipped, which is what
    /// `load_activity_matches` does with it.
    pub(crate) fn match_info(conn: &Connection, route_id: &str) -> Vec<crate::ActivityMatchInfo> {
        let Ok(mut stmt) = conn.prepare(
            "SELECT activity_id, match_percentage, direction FROM activity_matches
             WHERE route_id = ?",
        ) else {
            return Vec::new();
        };
        let rows = stmt.query_map(params![route_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, f64>(1)?,
                row.get::<_, String>(2)?,
            ))
        });
        let Ok(rows) = rows else {
            return Vec::new();
        };
        rows.flatten()
            .filter_map(|(activity_id, match_percentage, direction)| {
                Some(crate::ActivityMatchInfo {
                    activity_id,
                    match_percentage,
                    direction: direction.parse().ok()?,
                })
            })
            .collect()
    }

    /// Every route group, in the shape the route tab lists them in.
    ///
    /// The blob is the current encoding of the membership and the JSON column
    /// the one before it, the same order `load_groups` reads them in, so a
    /// library written by either release answers the same.
    pub(crate) fn all_groups(conn: &Connection) -> Vec<RouteGroup> {
        let names = all_route_names(conn);
        let Ok(mut stmt) = conn.prepare(
            "SELECT id, representative_id, activity_ids,
                    bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
                    activity_ids_blob
             FROM route_groups",
        ) else {
            return Vec::new();
        };
        let rows = stmt.query_map([], |row| group_from_row(row, &names));
        match rows {
            Ok(rows) => rows.flatten().collect(),
            Err(e) => {
                log::warn!("[routes] groups: {e:?}");
                Vec::new()
            }
        }
    }

    /// Every route group's summary, sport types included.
    pub(crate) fn group_summaries(conn: &Connection) -> Vec<crate::persistence::GroupSummary> {
        let mut summaries = group_keys(conn, false, true);
        fill_page_details(conn, &mut summaries);
        summaries
    }

    /// Every route group's summary from stored columns alone: the count, the
    /// bounds, the name and the representative's distance. The membership is
    /// decoded only for a group with no stored count, and the sport types are
    /// left empty for `fill_page_details`, so the search, the filters and the
    /// order read one row per group and the page alone pays for its members.
    /// The representative's distance is joined in only when `with_distances`
    /// says the order needs it, and is otherwise left for `fill_page_details`.
    pub(crate) fn group_keys(
        conn: &Connection,
        with_distances: bool,
        with_names: bool,
    ) -> Vec<crate::persistence::GroupSummary> {
        let (distance, join) = if with_distances {
            (
                "COALESCE(m.distance, 0.0)",
                "LEFT JOIN activity_metrics m ON m.activity_id = g.representative_id",
            )
        } else {
            ("0.0", "")
        };
        let names = if with_names {
            all_route_names(conn)
        } else {
            HashMap::new()
        };
        let sql = format!(
            "SELECT g.id, g.representative_id, g.activity_count,
                    g.bounds_min_lat, g.bounds_max_lat, g.bounds_min_lng, g.bounds_max_lng,
                    {distance},
                    CASE WHEN g.activity_count IS NULL THEN g.activity_ids END,
                    CASE WHEN g.activity_count IS NULL THEN g.activity_ids_blob END
             FROM route_groups g {join}"
        );
        let Ok(mut stmt) = conn.prepare(&sql) else {
            return Vec::new();
        };
        let rows = stmt.query_map([], |row| {
            let group_id: String = row.get(0)?;
            let activity_count = match row.get::<_, Option<u32>>(2)? {
                Some(count) => count,
                None => decode_activity_ids(row, &group_id, 8, 9)?.len() as u32,
            };
            Ok(crate::persistence::GroupSummary {
                custom_name: names.get(&group_id).cloned(),
                representative_id: row.get(1)?,
                activity_count,
                bounds: decode_group_bounds(row)?.map(crate::FfiBounds::from),
                distance_meters: row.get(7)?,
                sport_types: Vec::new(),
                group_id,
            })
        });
        match rows {
            Ok(rows) => rows.flatten().collect(),
            Err(e) => {
                log::warn!("[routes] groups: {e:?}");
                Vec::new()
            }
        }
    }

    /// Name the groups of a page, reading the names of those routes alone.
    pub(crate) fn name_groups(
        conn: &Connection,
        summaries: &mut [crate::persistence::GroupSummary],
    ) {
        let ids: Vec<&str> = summaries.iter().map(|s| s.group_id.as_str()).collect();
        let names = super::route_display_names_for(conn, &super::get_route_word(), &ids)
            .unwrap_or_else(|error| {
                log::warn!("[routes] route names: {error:?}");
                HashMap::new()
            });
        for summary in summaries {
            summary.custom_name = names.get(&summary.group_id).cloned();
        }
    }

    /// The sport types of the activities in each of `summaries`, and the
    /// representative's distance, read for those groups only.
    pub(crate) fn fill_page_details(
        conn: &Connection,
        summaries: &mut [crate::persistence::GroupSummary],
    ) {
        if summaries.is_empty() {
            return;
        }
        let group_ids: Vec<&str> = summaries.iter().map(|s| s.group_id.as_str()).collect();
        let members = group_members(conn, &group_ids);
        let wanted: Vec<&str> = members.values().flatten().map(String::as_str).collect();
        let sports = activity_sports(conn, &wanted);
        let representatives: Vec<&str> = summaries
            .iter()
            .map(|s| s.representative_id.as_str())
            .collect();
        let distances = activity_distances(conn, &representatives);
        for summary in summaries {
            summary.distance_meters = distances
                .get(&summary.representative_id)
                .copied()
                .unwrap_or(0.0);
            summary.sport_types = members
                .get(&summary.group_id)
                .into_iter()
                .flatten()
                .filter_map(|id| sports.get(id))
                .cloned()
                .collect::<std::collections::BTreeSet<_>>()
                .into_iter()
                .collect();
        }
    }

    fn json_array(ids: &[&str]) -> String {
        serde_json::to_string(ids).unwrap_or_else(|_| "[]".to_string())
    }

    /// The member activity ids of each listed group. A group whose stored
    /// membership will not decode is left out, as `all_groups` leaves it out.
    fn group_members(conn: &Connection, group_ids: &[&str]) -> HashMap<String, Vec<String>> {
        let Ok(mut stmt) = conn.prepare(
            "SELECT id, activity_ids, activity_ids_blob FROM route_groups
             WHERE id IN (SELECT value FROM json_each(?1))",
        ) else {
            return HashMap::new();
        };
        stmt.query_map(params![json_array(group_ids)], |row| {
            let group_id: String = row.get(0)?;
            let ids = decode_activity_ids(row, &group_id, 1, 2)?;
            Ok((group_id, ids))
        })
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
    }

    fn activity_distances(conn: &Connection, activity_ids: &[&str]) -> HashMap<String, f64> {
        let Ok(mut stmt) = conn.prepare(
            "SELECT activity_id, distance FROM activity_metrics
             WHERE activity_id IN (SELECT value FROM json_each(?1))",
        ) else {
            return HashMap::new();
        };
        stmt.query_map(params![json_array(activity_ids)], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map(|rows| rows.flatten().collect())
        .unwrap_or_default()
    }

    /// The sport of each listed activity. An activity with no GPS row is read
    /// from its metrics row, and that second read happens only when some
    /// listed activity needs it.
    fn activity_sports(conn: &Connection, activity_ids: &[&str]) -> HashMap<String, String> {
        let read = |sql: &str, ids: &[&str]| -> HashMap<String, String> {
            let Ok(mut stmt) = conn.prepare(sql) else {
                return HashMap::new();
            };
            stmt.query_map(params![json_array(ids)], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .map(|rows| rows.flatten().collect())
            .unwrap_or_default()
        };
        let mut sports = read(
            "SELECT id, sport_type FROM activities
             WHERE id IN (SELECT value FROM json_each(?1))",
            activity_ids,
        );
        let missing: Vec<&str> = activity_ids
            .iter()
            .copied()
            .filter(|id| !sports.contains_key(*id))
            .collect();
        if !missing.is_empty() {
            sports.extend(read(
                "SELECT activity_id, sport_type FROM activity_metrics
                 WHERE activity_id IN (SELECT value FROM json_each(?1))",
                &missing,
            ));
        }
        sports
    }

    /// One route group by id.
    pub(crate) fn group_by_id(conn: &Connection, group_id: &str) -> Option<RouteGroup> {
        let names = all_route_names(conn);
        conn.query_row(
            "SELECT id, representative_id, activity_ids,
                    bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng,
                    activity_ids_blob
             FROM route_groups WHERE id = ?",
            params![group_id],
            |row| group_from_row(row, &names),
        )
        .ok()
    }

    /// One `route_groups` row, with the name it is shown under.
    fn group_from_row(row: &Row<'_>, names: &HashMap<String, String>) -> SqlResult<RouteGroup> {
        let mut group = decode_group_row(row)?;
        group.custom_name = names.get(&group.group_id).cloned();
        Ok(group)
    }

    /// The stored representative's own track for a route group.
    pub(crate) fn representative_route(conn: &Connection, group_id: &str) -> Option<Vec<GpsPoint>> {
        let representative_id: String = conn
            .query_row(
                "SELECT representative_id FROM route_groups WHERE id = ?1",
                params![group_id],
                |row| row.get(0),
            )
            .ok()?;
        crate::persistence::activities::pooled::gps_track(conn, &representative_id)
    }

    /// The name every route is shown under, keyed by group: the one the
    /// athlete typed, otherwise its number behind the current route word.
    pub(crate) fn all_route_names(conn: &Connection) -> HashMap<String, String> {
        super::route_display_names(conn, &super::get_route_word()).unwrap_or_else(|error| {
            log::warn!("[routes] route names: {error:?}");
            HashMap::new()
        })
    }

    /// The names of `ids` alone, for a read that shows a few routes of many.
    pub(crate) fn route_names_for(conn: &Connection, ids: &[&str]) -> HashMap<String, String> {
        super::route_display_names_for(conn, &super::get_route_word(), ids).unwrap_or_else(
            |error| {
                log::warn!("[routes] route names: {error:?}");
                HashMap::new()
            },
        )
    }

    /// The activities the athlete took out of a route group.
    pub(crate) fn excluded_route_activity_ids(conn: &Connection, route_id: &str) -> Vec<String> {
        let mut stmt = match conn.prepare(
            "SELECT DISTINCT activity_id FROM activity_matches WHERE route_id = ? AND excluded = 1",
        ) {
            Ok(s) => s,
            Err(_) => return Vec::new(),
        };
        stmt.query_map(params![route_id], |row| row.get(0))
            .map(|rows| {
                rows.filter_map(|r| match r {
                    Ok(v) => Some(v),
                    Err(e) => {
                        log::warn!(
                            "Skipping malformed row during excluded activity loading: {:?}",
                            e
                        );
                        None
                    }
                })
                .collect()
            })
            .unwrap_or_default()
    }

    /// The sections every activity on a route passes through.
    pub(crate) fn section_ids_for_route(conn: &Connection, route_id: &str) -> Vec<String> {
        let sql = format!(
            "SELECT DISTINCT sa.section_id
             FROM activity_matches am
             JOIN section_activities sa ON sa.activity_id = am.activity_id
             JOIN sections s ON s.id = sa.section_id
             WHERE am.route_id = ? AND am.excluded = 0 AND sa.excluded = 0 AND {}
             ORDER BY sa.section_id",
            super::PersistentEngine::VISIBLE_FILTER
        );
        let Ok(mut stmt) = conn.prepare(&sql) else {
            return Vec::new();
        };
        stmt.query_map(params![route_id], |row| row.get(0))
            .map(|rows| rows.filter_map(|r| r.ok()).collect())
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    /// A signature whose points blob will not decode is left out of the
    /// polylines and the failure is logged, as the lock-holding read does.
    #[test]
    fn an_undecodable_signature_is_skipped_out_loud() {
        crate::test_log::capturing();
        let engine = PersistentEngine::in_memory().unwrap();
        engine
            .db
            .execute(
                "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng)
                 VALUES ('garbled-sig', 'Ride', 0, 0, 0, 0)",
                [],
            )
            .unwrap();
        engine
            .db
            .execute(
                "INSERT INTO signatures (activity_id, points, start_point_lat, start_point_lng,
                                         end_point_lat, end_point_lng, total_distance, point_count)
                 VALUES ('garbled-sig', x'ff', 0, 0, 0, 0, 0, 2)",
                [],
            )
            .unwrap();
        let out = super::pooled::representative_polylines(&engine.db, &["garbled-sig"]);
        assert!(out.is_empty());
        let said = crate::test_log::errors_with("signatures garbled-sig");
        assert_eq!(said.len(), 1, "{said:?}");
    }

    use rusqlite::params;

    use super::{PersistentEngine, mint_order};
    use tracematch::GpsPoint;

    fn stored_names(engine: &PersistentEngine) -> Vec<(String, String)> {
        let mut rows: Vec<(String, String)> = engine.get_all_route_names().into_iter().collect();
        rows.sort();
        rows
    }

    /// Scenario: the athlete typed "Walk Route 2" on one loop while another
    /// holds "Route 2", then the groups are loaded twice with a third unnamed
    /// group arriving between the loads.
    /// Expected behaviour: both stored names are untouched, the new group
    /// takes neither number, and the second load changes nothing.
    #[test]
    fn loading_groups_keeps_a_typed_sport_prefixed_name() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        for id in ["r_1", "r_2"] {
            engine
                .db
                .execute(
                    "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type)
                 VALUES (?, ?, '[\"a\"]', 'Walk')",
                    params![id, format!("rep_{id}")],
                )
                .unwrap();
        }
        engine.set_route_name("r_1", Some("Walk Route 2")).unwrap();
        engine.set_route_name("r_2", Some("Route 2")).unwrap();

        engine.load_groups().unwrap();
        let stored = engine.get_all_route_names();
        assert_eq!(stored.get("r_1").map(String::as_str), Some("Walk Route 2"));
        assert_eq!(stored.get("r_2").map(String::as_str), Some("Route 2"));

        engine
            .db
            .execute(
                "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type)
             VALUES ('r_3', 'rep_r_3', '[\"a\"]', 'Walk')",
                [],
            )
            .unwrap();
        engine.load_groups().unwrap();
        let with_third = stored_names(&engine);
        let third = with_third
            .iter()
            .find(|(id, _)| id == "r_3")
            .map(|(_, name)| name.as_str())
            .expect("the third group is named");
        assert_ne!(third, "Route 2");
        assert_ne!(third, "Walk Route 2");
        assert_eq!(
            with_third.iter().filter(|(_, name)| name == third).count(),
            1
        );

        engine.load_groups().unwrap();
        assert_eq!(stored_names(&engine), with_third);
        assert_eq!(
            engine.get_all_route_names().get("r_1").map(String::as_str),
            Some("Walk Route 2")
        );
    }

    #[test]
    fn renaming_a_warmed_group_updates_its_next_detail_read() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        engine
            .db
            .execute(
                "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type)
             VALUES ('r1', 'a1', '[\"a1\"]', 'Ride')",
                [],
            )
            .unwrap();
        assert_eq!(
            super::pooled::group_by_id(&engine.db, "r1")
                .unwrap()
                .custom_name,
            None
        );

        engine.set_route_name("r1", Some("Morning loop")).unwrap();

        assert_eq!(
            super::pooled::group_by_id(&engine.db, "r1")
                .unwrap()
                .custom_name
                .as_deref(),
            Some("Morning loop")
        );
    }

    #[test]
    fn loading_groups_drops_a_warmed_group_from_the_prior_generation() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        engine
            .db
            .execute(
                "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type)
             VALUES ('r1', 'a1', '[\"a1\"]', 'Ride')",
                [],
            )
            .unwrap();
        assert!(super::pooled::group_by_id(&engine.db, "r1").is_some());
        engine
            .db
            .execute("DELETE FROM route_groups WHERE id = 'r1'", [])
            .unwrap();

        engine.load_groups().unwrap();

        assert!(super::pooled::group_by_id(&engine.db, "r1").is_none());
    }

    #[test]
    fn a_failed_group_save_keeps_the_prior_catalogue_and_a_retry_due() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        let track: Vec<GpsPoint> = (0..12)
            .map(|i| GpsPoint::new(46.0 + f64::from(i) * 0.0005, 7.0))
            .collect();
        engine
            .add_activity("a1".to_string(), track.clone(), "Ride".to_string())
            .unwrap();
        engine.get_groups();
        let before: Vec<Vec<String>> = engine
            .groups
            .iter()
            .map(|group| group.activity_ids.clone())
            .collect();
        let identity = engine.route_identity_blob();
        let route_id = engine.groups[0].group_id.clone();
        let stored_before: String = engine
            .db
            .query_row(
                "SELECT activity_ids FROM route_groups WHERE id = ?",
                [&route_id],
                |row| row.get(0),
            )
            .unwrap();
        engine
            .add_activity("a2".to_string(), track, "Ride".to_string())
            .unwrap();
        engine.db.commit_hook(Some(|| true));

        engine.recompute_groups();

        assert!(engine.groups_are_dirty());
        let after: Vec<Vec<String>> = engine
            .groups
            .iter()
            .map(|group| group.activity_ids.clone())
            .collect();
        assert_eq!(after, before);
        assert_eq!(engine.route_identity_blob(), identity);
        let stored_after: String = engine
            .db
            .query_row(
                "SELECT activity_ids FROM route_groups WHERE id = ?",
                [&route_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(stored_after, stored_before);
        engine.db.commit_hook(Some(|| false));
        assert!(
            engine
                .get_groups()
                .iter()
                .any(|group| group.activity_ids.contains(&"a2".to_string()))
        );
        assert!(!engine.groups_are_dirty());
    }

    #[test]
    fn regroup_replaces_a_warmed_groups_members() {
        let mut engine = PersistentEngine::in_memory().unwrap();
        let track: Vec<GpsPoint> = (0..12)
            .map(|i| GpsPoint::new(46.0 + f64::from(i) * 0.0005, 7.0))
            .collect();
        engine
            .add_activity("a1".to_string(), track.clone(), "Ride".to_string())
            .unwrap();
        let group_id = engine.get_groups()[0].group_id.clone();
        assert_eq!(
            super::pooled::group_by_id(&engine.db, &group_id)
                .unwrap()
                .activity_ids,
            vec!["a1"]
        );

        engine
            .add_activity("a2".to_string(), track, "Ride".to_string())
            .unwrap();
        engine.get_groups();

        assert_eq!(
            super::pooled::group_by_id(&engine.db, &group_id)
                .unwrap()
                .activity_ids
                .len(),
            2
        );
    }

    #[test]
    fn every_catalogue_clear_drops_warmed_section_reads() {
        for clear in [0, 1, 2] {
            let mut engine = PersistentEngine::in_memory().unwrap();
            engine
                .db
                .execute(
                    "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                    distance_meters, is_user_defined, version, created_at)
                 VALUES ('s1', 'auto', 'Section 1', 'Ride', '[]', 400.0, 0, 1,
                    '2026-01-01T00:00:00Z')",
                    [],
                )
                .unwrap();
            engine.load_sections().unwrap();
            assert!(engine.get_section_by_id("s1").is_some());

            match clear {
                0 => engine.clear().unwrap(),
                1 => engine.clear_routes_and_sections().unwrap(),
                _ => {
                    engine.clear_derived().unwrap();
                }
            }

            assert!(engine.get_section_by_id("s1").is_none(), "clear {clear}");
        }
    }

    /// Route numbers follow member count, then stable id.
    mod numbering_order {
        use super::mint_order;
        use std::cmp::Ordering;

        fn group(id: &str, sport: &str, members: usize) -> tracematch::RouteGroup {
            tracematch::RouteGroup {
                group_id: id.to_string(),
                representative_id: format!("{id}_0"),
                activity_ids: (0..members).map(|i| format!("{id}_{i}")).collect(),
                sport_type: sport.to_string(),
                bounds: None,
                custom_name: None,
                best_time: None,
                avg_time: None,
                best_pace: None,
                best_activity_id: None,
            }
        }

        #[test]
        fn the_bigger_group_is_numbered_first() {
            assert_eq!(
                mint_order(&group("g1", "Walk", 9), &group("g2", "Ride", 2)),
                Ordering::Less
            );
        }

        #[test]
        fn sport_does_not_rank_a_group() {
            assert_eq!(
                mint_order(&group("g1", "Walk", 4), &group("g2", "Ride", 4)),
                Ordering::Less,
                "tied on members, the id settles it, not the alphabet of the sports"
            );
            assert_eq!(
                mint_order(&group("g2", "Ride", 4), &group("g1", "Walk", 4)),
                Ordering::Greater
            );
        }

        #[test]
        fn a_tie_settles_on_the_id_so_two_runs_number_the_same_way() {
            let a = group("g1", "Ride", 4);
            let b = group("g2", "Ride", 4);
            assert_eq!(mint_order(&a, &b), Ordering::Less);
            assert_eq!(mint_order(&b, &a), Ordering::Greater);
            assert_eq!(mint_order(&a, &a), Ordering::Equal);
        }
    }

    /// Two sections over three activities, four routes, with one exclusion on
    /// each side of the join: `a3`'s pass through `s2` and `a2`'s match on `r4`.
    fn engine_with_routes_and_sections() -> PersistentEngine {
        let mut engine = PersistentEngine::in_memory().unwrap();
        for id in ["a1", "a2", "a3"] {
            engine
                .add_activity(
                    id.to_string(),
                    vec![GpsPoint::new(46.2, 7.3), GpsPoint::new(46.21, 7.31)],
                    "Ride".to_string(),
                )
                .unwrap();
        }
        for sid in ["s1", "s2"] {
            engine
                .db
                .execute(
                    "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                        distance_meters, is_user_defined, version, created_at,
                        bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
                     VALUES (?, 'auto', ?, 'Ride', '[]', 400.0, 0, 1, '2026-01-01T00:00:00Z',
                        46.2, 46.21, 7.3, 7.31)",
                    params![sid, sid],
                )
                .unwrap();
        }
        for (sid, aid, excluded) in [
            ("s1", "a1", 0),
            ("s1", "a2", 0),
            ("s2", "a2", 0),
            ("s2", "a3", 1),
        ] {
            engine
                .db
                .execute(
                    "INSERT INTO section_activities (section_id, activity_id, direction,
                        start_index, end_index, distance_meters, excluded)
                     VALUES (?, ?, 'same', 0, 2, 400.0, ?)",
                    params![sid, aid, excluded],
                )
                .unwrap();
        }
        for (rid, aid, excluded) in [
            ("r1", "a1", 0),
            ("r2", "a1", 0),
            ("r2", "a2", 0),
            ("r3", "a3", 0),
            ("r4", "a2", 1),
        ] {
            engine
                .db
                .execute(
                    "INSERT INTO activity_matches (route_id, activity_id, match_percentage,
                        direction, excluded)
                     VALUES (?, ?, 100.0, 'same', ?)",
                    params![rid, aid, excluded],
                )
                .unwrap();
        }
        for rid in ["r1", "r2", "r3", "r4"] {
            engine
                .db
                .execute(
                    "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type,
                        activity_count)
                     VALUES (?, 'a1', '[]', 'Ride', 2)",
                    params![rid],
                )
                .unwrap();
        }
        // The rows above stand in for a saved regroup; a dirty flag would
        // have `get_groups` rewrite them from the activities' empty signatures.
        engine.groups_dirty = false;
        engine
    }

    #[test]
    fn a_section_read_carries_the_routes_its_activities_are_grouped_into() {
        let engine = engine_with_routes_and_sections();

        let s1 = engine.get_section("s1").unwrap();
        assert_eq!(s1.route_ids, Some(vec!["r1".to_string(), "r2".to_string()]));

        let s2 = engine.get_section("s2").unwrap();
        assert_eq!(s2.route_ids, Some(vec!["r2".to_string()]));
    }

    #[test]
    fn a_section_names_only_the_routes_the_routes_list_shows() {
        let engine = engine_with_routes_and_sections();
        engine
            .db
            .execute(
                "UPDATE route_groups SET activity_count = 1 WHERE id = 'r1'",
                [],
            )
            .unwrap();

        let s1 = engine.get_section("s1").unwrap();
        assert_eq!(s1.route_ids, Some(vec!["r2".to_string()]));

        let routes = engine.route_ids_for_sections(&["s1".to_string(), "s2".to_string()]);
        assert_eq!(routes["s1"], vec!["r2"]);
        assert_eq!(routes["s2"], vec!["r2"]);
    }

    #[test]
    fn the_section_list_carries_route_ids_on_every_row() {
        let engine = engine_with_routes_and_sections();

        let mut sections = engine.get_sections_by_type(None);
        sections.sort_by(|a, b| a.id.cmp(&b.id));

        let routes: Vec<Option<Vec<String>>> = sections.into_iter().map(|s| s.route_ids).collect();
        assert_eq!(
            routes,
            vec![
                Some(vec!["r1".to_string(), "r2".to_string()]),
                Some(vec!["r2".to_string()]),
            ]
        );
    }

    #[test]
    fn the_batch_read_names_each_section_once_per_route_and_honours_both_exclusions() {
        let engine = engine_with_routes_and_sections();

        let routes = engine.route_ids_for_sections(&["s1".to_string(), "s2".to_string()]);

        assert_eq!(routes["s1"], vec!["r1", "r2"]);
        assert_eq!(routes["s2"], vec!["r2"]);
        assert!(engine.route_ids_for_sections(&[]).is_empty());
    }

    #[test]
    fn a_route_read_names_the_visible_sections_its_activities_pass_through() {
        let engine = engine_with_routes_and_sections();

        assert_eq!(engine.section_ids_for_route("r2"), vec!["s1", "s2"]);
        assert_eq!(engine.section_ids_for_route("r1"), vec!["s1"]);
        assert!(
            engine.section_ids_for_route("r3").is_empty(),
            "a3's pass is excluded"
        );
        assert!(
            engine.section_ids_for_route("r4").is_empty(),
            "a2's match is excluded"
        );
        assert!(engine.section_ids_for_route("r9").is_empty());

        engine
            .db
            .execute("UPDATE sections SET disabled = 1 WHERE id = 's2'", [])
            .unwrap();
        assert_eq!(engine.section_ids_for_route("r2"), vec!["s1"]);
    }

    #[test]
    fn a_section_no_route_covers_carries_an_empty_list_not_none() {
        let engine = engine_with_routes_and_sections();
        engine
            .db
            .execute("DELETE FROM activity_matches", [])
            .unwrap();

        assert_eq!(engine.get_section("s1").unwrap().route_ids, Some(vec![]));
    }
}

/// Counting the statements a regroup runs is how the signature load proves it
/// reads the table once rather than once per activity.
#[cfg(test)]
mod regroup_signature_reads {
    use std::sync::Mutex;

    use super::PersistentEngine;
    use tracematch::GpsPoint;

    static SQL: Mutex<Vec<String>> = Mutex::new(Vec::new());

    fn record(sql: &str) {
        SQL.lock()
            .unwrap_or_else(|e| e.into_inner())
            .push(sql.to_string());
    }

    fn reset() {
        SQL.lock().unwrap_or_else(|e| e.into_inner()).clear();
    }

    /// Statements that read one activity's signature row, the per-activity
    /// shape the LRU miss runs.
    fn per_activity_reads() -> usize {
        SQL.lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .filter(|sql| sql.contains("FROM signatures WHERE activity_id ="))
            .count()
    }

    fn track(seed: f64) -> Vec<GpsPoint> {
        (0..12)
            .map(|i| GpsPoint {
                latitude: 46.0 + seed * 0.01 + f64::from(i) * 0.0005,
                longitude: 7.0 + seed * 0.01,
                elevation: None,
            })
            .collect()
    }

    fn engine_with(activities: usize) -> PersistentEngine {
        let mut engine = PersistentEngine::in_memory().unwrap();
        let batch: Vec<(String, Vec<GpsPoint>, String)> = (0..activities)
            .map(|i| {
                (
                    format!("a{i}"),
                    track(f64::from(i as u32)),
                    "Ride".to_string(),
                )
            })
            .collect();
        engine.add_activities_batch(batch).unwrap();
        engine
    }

    /// Scenario: the signature cache holds 200 entries and a regroup walks
    /// every activity through it, so past 200 the walk evicts what it just
    /// loaded and every regroup decodes every blob one row at a time.
    ///
    /// Expected behaviour: the regroup reads the signatures it needs in one
    /// statement, so a library twice the cache size costs no per-row reads.
    #[test]
    fn a_regroup_past_the_cache_size_reads_no_signature_row_by_itself() {
        let mut engine = engine_with(400);
        engine.db.trace(Some(record));

        reset();
        let grouped = engine.get_groups().len();

        assert_eq!(
            per_activity_reads(),
            0,
            "the regroup read signatures one row at a time"
        );
        assert!(grouped > 0, "the regroup produced no groups at all");

        // The second pass is the one the cache was supposed to serve, and the
        // one that used to pay the whole walk again.
        reset();
        engine.groups_dirty = true;
        let again = engine.get_groups().len();

        assert_eq!(
            per_activity_reads(),
            0,
            "the second regroup read row by row"
        );
        assert_eq!(again, grouped, "the same library grouped differently");
        engine.db.trace(None);
    }
}
