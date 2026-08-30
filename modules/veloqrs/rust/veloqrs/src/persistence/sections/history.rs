//! Section history, versioned geometry, and pins: the D4 storage layer.
//!
//! Three tables keyed on the durable real section id with no foreign key to
//! the wipe-managed `sections` table, so events outlive every catalogue
//! rebuild. `section_history` holds one row per lifecycle event, kept
//! forever; the event vocabulary and `details` payload shape belong to the
//! emitter (D5), which is the only writer of event rows. `section_geometry`
//! holds independently-decodable polyline versions (codec `encode_polyline`,
//! corpus-measured ~3 B/point); `section_pins` freezes a section at a stored
//! version (revert = pin at version).
//!
//! Retention on every geometry write: version 1 (the birth geometry),
//! milestones, the pinned version, and the newest [`GEOMETRY_KEEP_RECENT`]
//! versions always survive; anything else is pruned. The 10-year budget for
//! this policy is measured in the lab (`geometry_codec`, REPORT round 10).

use rusqlite::{OptionalExtension, params};

use crate::persistence::PersistentEngine;
use crate::persistence::codec;
use tracematch::GpsPoint;

/// Newest versions always retained, besides version 1, milestones, and the
/// pinned version.
const GEOMETRY_KEEP_RECENT: usize = 3;

/// `section_geometry.encoding` for the quantised zigzag-varint stream.
const ENCODING_QUANTISED: i64 = 1;

/// `section_geometry.source` for an averaged line no single activity carries,
/// which is why its representative triple is NULL.
pub const SOURCE_CONSENSUS: &str = "consensus";

/// A line sliced whole from one activity, so re-slicing its triple reproduces
/// the stored blob and the blob is a droppable cache.
pub const SOURCE_EXACT: &str = "exact";

/// Baseline row an upgrade writes for a section that pre-dates the ledger.
pub const KIND_BASELINE: &str = "baseline";

/// First detect after the detector generation the catalogue was cut under
/// stops matching the live one.
pub const KIND_ALGORITHM_CHANGED: &str = "algorithm_changed";

/// One id gave way to another across a detector change. Written on both ids,
/// `superseded_by` on the old and `supersedes` on the new.
pub const KIND_SUPERSEDED: &str = "superseded";

/// A re-cut moved the section's record: the old best time was set over a
/// different extent, so the PR is re-based on the current one.
pub const KIND_PR_REBASED: &str = "pr_rebased";

/// The user put a stored geometry version back and pinned it there.
pub const KIND_REVERTED: &str = "reverted";

/// The `basis` every re-based PR row carries.
pub const PR_BASIS_CURRENT_EXTENT: &str = "current_extent";

/// The detector and parameters a catalogue was cut under.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DetectorGeneration {
    pub method: String,
    pub digest: String,
}

/// Where a split sibling came from: the parent it was carved out of and the
/// discriminator its birth recorded (a cardinal, or an ordinal among the
/// siblings). A read side composes the sibling's name from these in-locale.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SectionLineage {
    pub section_id: String,
    pub parent_id: String,
    pub discriminator: String,
}

/// A section the ledger remembers and the catalogue no longer holds: its
/// last event says how it left, and its stored versions still draw it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetiredSection {
    pub section_id: String,
    /// dissolved, merged or superseded.
    pub kind: String,
    pub at: String,
    /// The survivor a merge or supersession handed the ground to.
    pub into: Option<String>,
    /// Surviving geometry versions, newest last.
    pub versions: Vec<i64>,
}

/// A change the ledger recorded on a live section, for the insights feed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SectionChange {
    pub section_id: String,
    pub kind: String,
    pub at: String,
}

/// One stored geometry version, without its polyline.
#[derive(Debug, Clone, PartialEq)]
pub struct SectionGeometryVersion {
    pub version: i64,
    pub created_at: String,
    pub milestone: bool,
}

/// What one quarantine salvage carried into the fresh database, per table.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SalvageCounts {
    pub history: usize,
    pub geometry: usize,
    pub pins: usize,
    /// User-owned `sections` rows: custom, accepted, renamed, trimmed.
    pub sections: usize,
    /// `section_intents` suppressions, the disabled and deleted corridors.
    pub intents: usize,
}

/// One section lifecycle event.
#[derive(Debug, Clone, PartialEq)]
pub struct SectionHistoryEvent {
    pub id: i64,
    pub at: String,
    pub kind: String,
    pub details: Option<String>,
    pub geometry_version: Option<i64>,
}

/// Store `polyline` as the next geometry version of `section_id` and prune
/// per the retention policy. Returns the version number written. Takes a bare
/// connection so the emitter can write inside the catalogue-save transaction;
/// statements on the connection join whatever transaction is open on it.
pub(super) fn record_geometry_on(
    conn: &rusqlite::Connection,
    section_id: &str,
    polyline: &[GpsPoint],
    milestone: bool,
    reference: Option<(&str, u32, u32)>,
) -> rusqlite::Result<i64> {
    let version: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) + 1 FROM section_geometry WHERE section_id = ?",
        params![section_id],
        |row| row.get(0),
    )?;
    conn.execute(
        "INSERT INTO section_geometry
             (section_id, version, encoding, blob, milestone,
              rep_activity_id, rep_start_index, rep_end_index, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            section_id,
            version,
            ENCODING_QUANTISED,
            codec::encode_polyline(polyline),
            milestone as i64,
            reference.map(|(id, _, _)| id),
            reference.map(|(_, start, _)| start),
            reference.map(|(_, _, end)| end),
            if reference.is_some() {
                SOURCE_EXACT
            } else {
                SOURCE_CONSENSUS
            },
        ],
    )?;
    // Newest-N is by surviving version rank, not version arithmetic:
    // earlier pruning leaves gaps, so `version > max - N` would under-keep.
    conn.execute(
        "DELETE FROM section_geometry
         WHERE section_id = ?1 AND milestone = 0 AND version > 1
           AND version NOT IN (
               SELECT version FROM section_geometry WHERE section_id = ?1
               ORDER BY version DESC LIMIT ?2)
           AND version != COALESCE(
               (SELECT version FROM section_pins WHERE section_id = ?1), -1)",
        params![section_id, GEOMETRY_KEEP_RECENT as i64],
    )?;
    Ok(version)
}

/// Copy the rows `select` yields from `src` into `dst` with `insert`, one
/// at a time, skipping any row that fails to read or write. Returns the
/// rows written.
fn salvage_rows(
    src: &rusqlite::Connection,
    dst: &rusqlite::Connection,
    select: &str,
    insert: &str,
    columns: usize,
) -> usize {
    let Ok(mut stmt) = src.prepare(select) else {
        return 0;
    };
    let rows = stmt.query_map([], |row| {
        (0..columns)
            .map(|i| row.get::<_, rusqlite::types::Value>(i))
            .collect::<Result<Vec<_>, _>>()
    });
    let Ok(rows) = rows else { return 0 };
    let mut written = 0;
    for values in rows.flatten() {
        if dst
            .execute(insert, rusqlite::params_from_iter(values.iter()))
            .is_ok()
        {
            written += 1;
        }
    }
    written
}

/// The columns a table carries in BOTH databases, in the destination's order.
/// A quarantined file is one that failed to open or migrate, so its shape can
/// lag the fresh schema by any number of versions; a fixed column list would
/// salvage nothing at all from it.
fn shared_columns(
    src: &rusqlite::Connection,
    dst: &rusqlite::Connection,
    table: &str,
) -> Vec<String> {
    let names = |conn: &rusqlite::Connection| -> Vec<String> {
        let Ok(mut stmt) = conn.prepare(&format!("PRAGMA table_info({table})")) else {
            return Vec::new();
        };
        let Ok(rows) = stmt.query_map([], |row| row.get::<_, String>(1)) else {
            return Vec::new();
        };
        rows.flatten().collect()
    };
    let source: std::collections::BTreeSet<String> = names(src).into_iter().collect();
    names(dst)
        .into_iter()
        .filter(|c| source.contains(c))
        .collect()
}

/// Copy readable rows of one table across on the shared columns, `filter`
/// narrowing which rows qualify. Returns how many landed.
fn salvage_table(
    src: &rusqlite::Connection,
    dst: &rusqlite::Connection,
    table: &str,
    filter: &str,
) -> usize {
    let columns = shared_columns(src, dst, table);
    if columns.is_empty() {
        return 0;
    }
    let list = columns.join(", ");
    let placeholders = vec!["?"; columns.len()].join(", ");
    salvage_rows(
        src,
        dst,
        &format!("SELECT {list} FROM {table} {filter}"),
        &format!("INSERT OR IGNORE INTO {table} ({list}) VALUES ({placeholders})"),
        columns.len(),
    )
}

/// The section's record as the junction rows stand now: the fastest included
/// traversal and its activity.
fn current_pr_on(conn: &rusqlite::Connection, section_id: &str) -> Option<(String, f64)> {
    conn.query_row(
        "SELECT activity_id, lap_time FROM section_activities
         WHERE section_id = ? AND excluded = 0 AND lap_time IS NOT NULL
         ORDER BY lap_time ASC, activity_id ASC LIMIT 1",
        params![section_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )
    .optional()
    .ok()
    .flatten()
}

/// After a re-cut's junction rows are written, compare the record they hold
/// with the era snapshot the re-cut event carried and write one
/// [`KIND_PR_REBASED`] row when they differ. A record that merely gained
/// precision is not a move: times compare to the millisecond.
pub(super) fn record_pr_rebase_on(
    conn: &rusqlite::Connection,
    section_id: &str,
    recut_details: Option<&str>,
) -> rusqlite::Result<()> {
    let era: serde_json::Value = recut_details
        .and_then(|d| serde_json::from_str(d).ok())
        .unwrap_or(serde_json::Value::Null);
    let from_activity = era
        .get("pr_activity_id")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let from_time = era.get("pr_time").and_then(|v| v.as_f64());
    let now = current_pr_on(conn, section_id);
    let (to_activity, to_time) = match &now {
        Some((a, t)) => (Some(a.clone()), Some(*t)),
        None => (None, None),
    };
    let same_time = match (from_time, to_time) {
        (Some(a), Some(b)) => (a - b).abs() < 0.001,
        (None, None) => true,
        _ => false,
    };
    if from_activity == to_activity && same_time {
        return Ok(());
    }
    let details = serde_json::json!({
        "from_activity_id": from_activity,
        "from_time": from_time,
        "to_activity_id": to_activity,
        "to_time": to_time,
        "basis": PR_BASIS_CURRENT_EXTENT,
    });
    append_history_on(
        conn,
        section_id,
        KIND_PR_REBASED,
        Some(&details.to_string()),
        None,
        None,
    )?;
    Ok(())
}

/// Append one lifecycle event row at `at`, or at the current time when `at` is
/// None. An upgrade backdates its baseline row to when the catalogue it
/// describes was actually cut; a live event passes None. Returns the event row
/// id. Connection-level for the same transactional reason as
/// [`record_geometry_on`].
pub(super) fn append_history_on(
    conn: &rusqlite::Connection,
    section_id: &str,
    kind: &str,
    details: Option<&str>,
    geometry_version: Option<i64>,
    at: Option<&str>,
) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO section_history (section_id, at, kind, details, geometry_version)
         VALUES (?, COALESCE(?, datetime('now')), ?, ?, ?)",
        params![section_id, at, kind, details, geometry_version],
    )?;
    Ok(conn.last_insert_rowid())
}

/// `schema_info` key marking the one-off baseline seeding as done.
const BASELINE_MARKER_KEY: &str = "section_geometry_baseline_v1";

/// Detector every catalogue that pre-dates the generation marker was cut under.
/// The marker's only writer is a detect, and no shipped build ran one, so a
/// migrating database would otherwise present as having always been current.
const PRE_LEDGER_METHOD: &str = "corridor";

/// Digest stamped beside [`PRE_LEDGER_METHOD`]. [`super::section_config_digest`]
/// emits 16 hex digits, so this can never collide with a live config.
const PRE_LEDGER_DIGEST: &str = "pre-ledger";

/// One section awaiting its birth geometry: the stored line in whichever form
/// it survives in, its earliest member ride, and how many rides it holds.
struct PendingBaseline {
    id: String,
    blob: Option<Vec<u8>>,
    json: Option<String>,
    at: String,
    activity_count: i64,
}

/// Write the birth geometry of every section that pre-dates the ledger.
///
/// A database upgraded onto the history tables carries sections with no
/// versions and no events, so the first change to any of them has nothing to
/// sit beside. This writes each one's current polyline as version 1, a
/// milestone by construction, and appends one `baseline` event backdated to the
/// section's earliest member ride rather than to upgrade day.
///
/// The row is `consensus` with a NULL triple: the line was cut by a detector
/// that never recorded which activity it came from, and claiming a triple that
/// was never checked would put a wrong line under a prior-versus-current
/// overlay. Runs once, guarded on [`BASELINE_MARKER_KEY`]; a fresh install
/// marks itself done over an empty catalogue and never seeds.
///
/// Seeding a non-empty catalogue also stamps the generation marker at
/// [`PRE_LEDGER_METHOD`], because the catalogue it just described was cut by
/// that detector and nothing else will ever say so. Without it the first
/// detect under a new detector sees no generation change and the flip goes
/// unexplained for exactly the users the ledger exists for.
///
/// Returns the number of sections seeded and the number skipped for an
/// undecodable or empty polyline.
pub(in crate::persistence) fn seed_baseline_geometry_on(
    conn: &rusqlite::Connection,
    schema_from: i32,
) -> rusqlite::Result<(usize, usize)> {
    let done: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM schema_info WHERE key = ?)",
        params![BASELINE_MARKER_KEY],
        |row| row.get(0),
    )?;
    if done {
        return Ok((0, 0));
    }

    // One transaction over the whole seed, marker included, so a kill mid-run
    // leaves no half-written ledger and the next open starts over.
    let tx = conn.unchecked_transaction()?;
    let conn = &*tx;

    let stored_detector: Option<String> = conn
        .query_row(
            "SELECT value FROM schema_info WHERE key = ?",
            params![super::CATALOGUE_METHOD_KEY],
            |row| row.get(0),
        )
        .optional()?;

    // Backdating reads the member rides, so a section whose junction rows are
    // gone falls back to now rather than claiming a date it cannot support.
    let mut stmt = conn.prepare(
        "SELECT s.id, s.polyline_blob, s.polyline_json,
                COALESCE(
                    (SELECT datetime(MIN(a.start_date), 'unixepoch')
                     FROM section_activities sa JOIN activities a ON a.id = sa.activity_id
                     WHERE sa.section_id = s.id),
                    datetime('now')),
                (SELECT COUNT(*) FROM section_activities sa WHERE sa.section_id = s.id)
         FROM sections s
         WHERE NOT EXISTS (SELECT 1 FROM section_geometry g WHERE g.section_id = s.id)",
    )?;
    let rows: Vec<PendingBaseline> = stmt
        .query_map([], |row| {
            Ok(PendingBaseline {
                id: row.get(0)?,
                blob: row.get(1)?,
                json: row.get(2)?,
                at: row.get(3)?,
                activity_count: row.get(4)?,
            })
        })?
        .filter_map(|r| r.ok())
        .collect();
    drop(stmt);

    let detector = stored_detector
        .clone()
        .or_else(|| (!rows.is_empty()).then(|| PRE_LEDGER_METHOD.to_string()));

    let mut seeded = 0usize;
    let mut skipped = 0usize;
    for PendingBaseline {
        id,
        blob,
        json,
        at,
        activity_count,
    } in rows
    {
        let Ok(polyline) = codec::decode_polyline_row(blob.as_deref(), json.as_deref()) else {
            skipped += 1;
            continue;
        };
        if polyline.is_empty() {
            skipped += 1;
            continue;
        }
        conn.execute(
            "INSERT INTO section_geometry
                 (section_id, version, created_at, encoding, blob, milestone, source)
             VALUES (?, 1, ?, ?, ?, 1, ?)",
            params![
                id,
                at,
                ENCODING_QUANTISED,
                codec::encode_polyline(&polyline),
                SOURCE_CONSENSUS,
            ],
        )?;
        let details = serde_json::json!({
            "source": "upgrade",
            "schema_from": schema_from,
            "detector": detector,
            "activity_count": activity_count,
        })
        .to_string();
        append_history_on(conn, &id, KIND_BASELINE, Some(&details), Some(1), Some(&at))?;
        seeded += 1;
    }

    // The catalogue just described was cut by the pre-ledger detector, and a
    // save under the live one would otherwise be the first thing to name a
    // generation, hiding the change it is about to make.
    if seeded > 0 && stored_detector.is_none() {
        for (key, value) in [
            (super::CATALOGUE_METHOD_KEY, PRE_LEDGER_METHOD),
            (super::CATALOGUE_CONFIG_DIGEST_KEY, PRE_LEDGER_DIGEST),
        ] {
            conn.execute(
                "INSERT OR REPLACE INTO schema_info (key, value) VALUES (?, ?)",
                params![key, value],
            )?;
        }
    }

    conn.execute(
        "INSERT OR REPLACE INTO schema_info (key, value) VALUES (?, datetime('now'))",
        params![BASELINE_MARKER_KEY],
    )?;
    tx.commit()?;
    Ok((seeded, skipped))
}

/// The generation stored beside a catalogue, absent until a save records one.
pub(super) fn stored_generation_on(conn: &rusqlite::Connection) -> Option<DetectorGeneration> {
    let value = |key: &str| -> Option<String> {
        conn.query_row(
            "SELECT value FROM schema_info WHERE key = ?",
            params![key],
            |row| row.get(0),
        )
        .ok()
    };
    Some(DetectorGeneration {
        method: value(super::CATALOGUE_METHOD_KEY)?,
        digest: value(super::CATALOGUE_CONFIG_DIGEST_KEY)?,
    })
}

/// Keep the shape `section_id` carries right now as a milestone and return its
/// version.
///
/// `current` is the line on the section row, which is the authority. Only when
/// the newest stored version already encodes to it is that version milestoned;
/// otherwise the section drifted without an event (an adopted batch geometry
/// does exactly that) and the stored line is stale, so `current` is written as
/// a new milestone version. None when there is neither.
pub(super) fn milestone_prior_geometry_on(
    conn: &rusqlite::Connection,
    section_id: &str,
    current: Option<&[GpsPoint]>,
) -> rusqlite::Result<Option<i64>> {
    let newest: Option<(i64, Vec<u8>)> = conn
        .query_row(
            "SELECT version, blob FROM section_geometry
             WHERE section_id = ?1
               AND version = (SELECT MAX(version) FROM section_geometry WHERE section_id = ?1)",
            params![section_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let current = current.filter(|points| !points.is_empty());
    // The outgoing line's provenance is whatever the row still says it is.
    let reference: Option<(String, u32, u32)> = conn
        .query_row(
            "SELECT representative_activity_id, rep_start_index, rep_end_index
             FROM sections WHERE id = ? AND geometry_source = 'exact'",
            params![section_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<u32>>(1)?,
                    row.get::<_, Option<u32>>(2)?,
                ))
            },
        )
        .optional()?
        .and_then(|(id, start, end)| Some((id?, start?, end?)));
    let reference = reference.as_ref().map(|(id, s, e)| (id.as_str(), *s, *e));
    match (newest, current) {
        (Some((_, blob)), Some(points)) if codec::encode_polyline(points) != blob => Ok(Some(
            record_geometry_on(conn, section_id, points, true, reference)?,
        )),
        (Some((version, _)), _) => {
            conn.execute(
                "UPDATE section_geometry SET milestone = 1 WHERE section_id = ? AND version = ?",
                params![section_id, version],
            )?;
            Ok(Some(version))
        }
        (None, Some(points)) => Ok(Some(record_geometry_on(
            conn, section_id, points, true, reference,
        )?)),
        (None, None) => Ok(None),
    }
}

/// Keep the shape a section held under the outgoing detector, then record that
/// the detector changed. The milestone runs first because the save that
/// follows overwrites the row and the "before" line has to already be stored.
pub(super) fn record_algorithm_change_on(
    conn: &rusqlite::Connection,
    section_id: &str,
    prior_polyline: Option<&[GpsPoint]>,
    from: Option<&DetectorGeneration>,
    to: &DetectorGeneration,
) -> rusqlite::Result<i64> {
    let prior_version = milestone_prior_geometry_on(conn, section_id, prior_polyline)?;
    let details = serde_json::json!({
        "from_method": from.map(|g| g.method.clone()),
        "to_method": to.method,
        "config_digest_from": from.map(|g| g.digest.clone()),
        "config_digest_to": to.digest,
        "prior_version": prior_version,
    })
    .to_string();
    append_history_on(
        conn,
        section_id,
        KIND_ALGORITHM_CHANGED,
        Some(&details),
        prior_version,
        None,
    )
}

/// Record that `old_id` gave way to `new_id`, on both ids, so the ledger reads
/// forwards from the retired section and backwards from its replacement.
pub(super) fn append_superseded_pair_on(
    conn: &rusqlite::Connection,
    old_id: &str,
    new_id: &str,
    overlap_fraction: Option<f64>,
) -> rusqlite::Result<(i64, i64)> {
    let old_details = serde_json::json!({
        "superseded_by": new_id,
        "overlap_fraction": overlap_fraction,
    })
    .to_string();
    let new_details = serde_json::json!({
        "supersedes": old_id,
        "overlap_fraction": overlap_fraction,
    })
    .to_string();
    let old_event = append_history_on(
        conn,
        old_id,
        KIND_SUPERSEDED,
        Some(&old_details),
        None,
        None,
    )?;
    let new_event = append_history_on(
        conn,
        new_id,
        KIND_SUPERSEDED,
        Some(&new_details),
        None,
        None,
    )?;
    Ok((old_event, new_event))
}

impl PersistentEngine {
    /// The generation the stored catalogue was cut under, when it disagrees
    /// with the live config. None on a catalogue nothing has saved yet, and
    /// None while the two agree.
    ///
    /// A seeded generation names the detector and not its parameters, so it is
    /// compared on method alone. Reading its sentinel digest as a real one
    /// would tell every migrating user their algorithm changed, including the
    /// ones staying on the detector they already had.
    pub fn detector_generation_change(&self) -> Option<(DetectorGeneration, DetectorGeneration)> {
        let stored = stored_generation_on(&self.db)?;
        let live = DetectorGeneration {
            method: super::DETECTOR_METHOD.to_string(),
            digest: super::section_config_digest(&self.section_config),
        };
        let changed = if stored.digest == PRE_LEDGER_DIGEST {
            stored.method != live.method
        } else {
            stored != live
        };
        changed.then_some((stored, live))
    }

    /// Milestone the outgoing shape and append `algorithm_changed`. Returns the
    /// event row id.
    pub fn record_section_algorithm_change(
        &mut self,
        section_id: &str,
        prior_polyline: Option<&[GpsPoint]>,
        from: Option<&DetectorGeneration>,
        to: &DetectorGeneration,
    ) -> rusqlite::Result<i64> {
        record_algorithm_change_on(&self.db, section_id, prior_polyline, from, to)
    }

    /// Append the `superseded` pair linking a retired id to its replacement.
    pub fn record_section_superseded(
        &mut self,
        old_id: &str,
        new_id: &str,
        overlap_fraction: Option<f64>,
    ) -> rusqlite::Result<(i64, i64)> {
        append_superseded_pair_on(&self.db, old_id, new_id, overlap_fraction)
    }

    /// Store `polyline` as the next geometry version of `section_id` and
    /// prune per the retention policy. Returns the version number written.
    pub fn record_section_geometry(
        &mut self,
        section_id: &str,
        polyline: &[GpsPoint],
        milestone: bool,
        reference: Option<(&str, u32, u32)>,
    ) -> rusqlite::Result<i64> {
        record_geometry_on(&self.db, section_id, polyline, milestone, reference)
    }

    /// One stored geometry version with the reference it was sliced from:
    /// `(polyline, Some((activity, start, end)))` for an exact version, `None`
    /// reference for an averaged one. None when the version is absent, pruned,
    /// or carries an unknown encoding.
    pub fn section_geometry_version(
        &self,
        section_id: &str,
        version: i64,
    ) -> Option<(Vec<GpsPoint>, Option<(String, u32, u32)>)> {
        let row: (i64, Vec<u8>, Option<String>, Option<u32>, Option<u32>) = self
            .db
            .query_row(
                "SELECT encoding, blob, rep_activity_id, rep_start_index, rep_end_index
                 FROM section_geometry WHERE section_id = ? AND version = ?",
                params![section_id, version],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .optional()
            .ok()
            .flatten()?;
        if row.0 != ENCODING_QUANTISED {
            return None;
        }
        let polyline = codec::decode_polyline(&row.1)?;
        let reference = match (row.2, row.3, row.4) {
            (Some(id), Some(start), Some(end)) => Some((id, start, end)),
            _ => None,
        };
        Some((polyline, reference))
    }

    /// Decode one stored geometry version. None when the version is absent,
    /// pruned, or carries an unknown encoding.
    pub fn section_geometry_polyline(
        &self,
        section_id: &str,
        version: i64,
    ) -> Option<Vec<GpsPoint>> {
        let (encoding, blob): (i64, Vec<u8>) = self
            .db
            .query_row(
                "SELECT encoding, blob FROM section_geometry
                 WHERE section_id = ? AND version = ?",
                params![section_id, version],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .ok()
            .flatten()?;
        if encoding != ENCODING_QUANTISED {
            return None;
        }
        codec::decode_polyline(&blob)
    }

    /// Every section that left the catalogue through a fired retirement and
    /// still has a ledger, newest departure first.
    pub fn retired_sections(&self) -> Vec<RetiredSection> {
        let Ok(mut stmt) = self.db.prepare(
            "SELECT h.section_id, h.kind, h.at, h.details FROM section_history h
             WHERE h.id IN (SELECT MAX(id) FROM section_history GROUP BY section_id)
               AND h.kind IN ('dissolved', 'merged', 'superseded')
               AND h.section_id NOT IN (SELECT id FROM sections)
             ORDER BY h.id DESC",
        ) else {
            return Vec::new();
        };
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        });
        let Ok(iter) = rows else { return Vec::new() };
        iter.flatten()
            .map(|(section_id, kind, at, details)| {
                let d: serde_json::Value = details
                    .as_deref()
                    .and_then(|d| serde_json::from_str(d).ok())
                    .unwrap_or(serde_json::Value::Null);
                let into = d
                    .get("into")
                    .or_else(|| d.get("superseded_by"))
                    .and_then(|v| v.as_str())
                    .map(str::to_string);
                let versions = self
                    .section_geometry_versions(&section_id)
                    .into_iter()
                    .map(|v| v.version)
                    .collect();
                RetiredSection {
                    section_id,
                    kind,
                    at,
                    into,
                    versions,
                }
            })
            .collect()
    }

    /// Visible changes on live sections in the last `days`, newest first:
    /// the re-cuts, splits, restores and reverts a feed can point at. A
    /// section's birth and its record re-basing are not changes to it.
    pub fn recent_section_changes(&self, days: u32) -> Vec<SectionChange> {
        let Ok(mut stmt) = self.db.prepare(
            "SELECT h.section_id, h.kind, h.at FROM section_history h
             JOIN sections s ON s.id = h.section_id
             WHERE h.kind IN ('recut', 'split', 'restored', 'reverted')
               AND h.at >= datetime('now', ?)
             ORDER BY h.id DESC",
        ) else {
            return Vec::new();
        };
        let window = format!("-{days} days");
        let rows = stmt.query_map(params![window], |row| {
            Ok(SectionChange {
                section_id: row.get(0)?,
                kind: row.get(1)?,
                at: row.get(2)?,
            })
        });
        rows.map(|iter| iter.flatten().collect())
            .unwrap_or_default()
    }

    /// Every live section born as a split sibling, with its parent and
    /// discriminator. The newest birth row wins when a section was carved
    /// more than once.
    pub fn section_lineages(&self) -> Vec<SectionLineage> {
        let Ok(mut stmt) = self.db.prepare(
            "SELECT h.section_id, h.details FROM section_history h
             JOIN sections s ON s.id = h.section_id
             WHERE h.kind = 'formed' AND h.details LIKE '%split_from%'
             ORDER BY h.id",
        ) else {
            return Vec::new();
        };
        let rows = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        });
        let Ok(iter) = rows else { return Vec::new() };
        let mut by_id: std::collections::BTreeMap<String, SectionLineage> =
            std::collections::BTreeMap::new();
        for (section_id, details) in iter.flatten() {
            let Ok(v) = serde_json::from_str::<serde_json::Value>(&details) else {
                continue;
            };
            let (Some(parent), Some(disc)) = (
                v.get("split_from").and_then(|x| x.as_str()),
                v.get("discriminator").and_then(|x| x.as_str()),
            ) else {
                continue;
            };
            by_id.insert(
                section_id.clone(),
                SectionLineage {
                    section_id,
                    parent_id: parent.to_string(),
                    discriminator: disc.to_string(),
                },
            );
        }
        by_id.into_values().collect()
    }

    /// The surviving versions of one section, oldest first, polylines
    /// excluded.
    pub fn section_geometry_versions(&self, section_id: &str) -> Vec<SectionGeometryVersion> {
        let Ok(mut stmt) = self.db.prepare(
            "SELECT version, created_at, milestone FROM section_geometry
             WHERE section_id = ? ORDER BY version",
        ) else {
            return Vec::new();
        };
        let rows = stmt.query_map(params![section_id], |row| {
            Ok(SectionGeometryVersion {
                version: row.get(0)?,
                created_at: row.get(1)?,
                milestone: row.get::<_, i64>(2)? != 0,
            })
        });
        rows.map(|iter| iter.flatten().collect())
            .unwrap_or_default()
    }

    /// Append one lifecycle event at the current time. Returns the event row id.
    pub fn append_section_history(
        &mut self,
        section_id: &str,
        kind: &str,
        details: Option<&str>,
        geometry_version: Option<i64>,
    ) -> rusqlite::Result<i64> {
        append_history_on(&self.db, section_id, kind, details, geometry_version, None)
    }

    /// Append one lifecycle event at `at`, for a row that records something
    /// which happened before this call.
    pub fn append_section_history_at(
        &mut self,
        section_id: &str,
        kind: &str,
        details: Option<&str>,
        geometry_version: Option<i64>,
        at: &str,
    ) -> rusqlite::Result<i64> {
        append_history_on(
            &self.db,
            section_id,
            kind,
            details,
            geometry_version,
            Some(at),
        )
    }

    /// Every event of one section, oldest first.
    pub fn section_history(&self, section_id: &str) -> Vec<SectionHistoryEvent> {
        let Ok(mut stmt) = self.db.prepare(
            "SELECT id, at, kind, details, geometry_version FROM section_history
             WHERE section_id = ? ORDER BY id",
        ) else {
            return Vec::new();
        };
        let rows = stmt.query_map(params![section_id], |row| {
            Ok(SectionHistoryEvent {
                id: row.get(0)?,
                at: row.get(1)?,
                kind: row.get(2)?,
                details: row.get(3)?,
                geometry_version: row.get(4)?,
            })
        });
        rows.map(|iter| iter.flatten().collect())
            .unwrap_or_default()
    }

    /// Pin `section_id` at a stored geometry version. Returns false without
    /// writing when that version does not exist (absent or already pruned) -
    /// a pin must always be restorable.
    pub fn pin_section_geometry(
        &mut self,
        section_id: &str,
        version: i64,
    ) -> rusqlite::Result<bool> {
        let exists: bool = self.db.query_row(
            "SELECT EXISTS(SELECT 1 FROM section_geometry WHERE section_id = ? AND version = ?)",
            params![section_id, version],
            |row| row.get(0),
        )?;
        if !exists {
            return Ok(false);
        }
        self.db.execute(
            "INSERT INTO section_pins (section_id, version) VALUES (?, ?)
             ON CONFLICT(section_id) DO UPDATE SET
                 version = excluded.version, created_at = datetime('now')",
            params![section_id, version],
        )?;
        Ok(true)
    }

    /// Drop the pin; the formerly pinned version becomes prunable on the
    /// next geometry write like any other.
    pub fn unpin_section_geometry(&mut self, section_id: &str) -> rusqlite::Result<()> {
        self.db.execute(
            "DELETE FROM section_pins WHERE section_id = ?",
            params![section_id],
        )?;
        Ok(())
    }

    /// Drop a section's pin. Every promotion mutation calls this: a user who
    /// accepts, renames, trims, re-references or re-matches a section has
    /// taken it over, and a pin that then holds an older line would fight
    /// the edit they just made.
    pub(crate) fn drop_section_pin(&self, section_id: &str) {
        let _ = self.db.execute(
            "DELETE FROM section_pins WHERE section_id = ?",
            params![section_id],
        );
    }

    /// Copy every readable row a rebuild cannot re-derive out of a quarantined
    /// database into this one. Best effort, row by row, so one torn page costs
    /// its rows and nothing else.
    ///
    /// The ledger (`section_history`, `section_geometry`, `section_pins`) plus
    /// the two catalogue tables that hold user intent rather than detector
    /// output: the user-owned `sections` rows (drawn, accepted, renamed,
    /// trimmed or re-referenced) and the `section_intents` suppressions, whose
    /// whole contract is that a removed corridor never re-emerges.
    ///
    /// Junction rows are deliberately NOT salvaged. `section_activities` has an
    /// `ON DELETE CASCADE` foreign key to `activities`, which the fresh
    /// database has none of until the next sync, so every insert would be
    /// rejected. The ingest attach tier (`attach_stored_activity`) matches each
    /// re-synced activity against the whole catalogue, custom sections
    /// included, so the members come back as the library does.
    pub fn salvage_ledger_from(&self, corrupt_path: &str) -> SalvageCounts {
        let Ok(src) = rusqlite::Connection::open_with_flags(
            corrupt_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        ) else {
            return SalvageCounts::default();
        };
        let history = salvage_rows(
            &src,
            &self.db,
            "SELECT section_id, at, kind, details, geometry_version FROM section_history ORDER BY id",
            "INSERT OR IGNORE INTO section_history (section_id, at, kind, details, geometry_version)
             VALUES (?, ?, ?, ?, ?)",
            5,
        );
        let geometry = salvage_rows(
            &src,
            &self.db,
            "SELECT section_id, version, created_at, encoding, blob, milestone,
                    rep_activity_id, rep_start_index, rep_end_index, source
             FROM section_geometry ORDER BY section_id, version",
            "INSERT OR IGNORE INTO section_geometry
                 (section_id, version, created_at, encoding, blob, milestone,
                  rep_activity_id, rep_start_index, rep_end_index, source)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            10,
        );
        let pins = salvage_rows(
            &src,
            &self.db,
            "SELECT section_id, version, created_at FROM section_pins",
            "INSERT OR IGNORE INTO section_pins (section_id, version, created_at) VALUES (?, ?, ?)",
            3,
        );
        // Ownership is any of the three marks a promotion leaves, matching the
        // predicate the detection wipe spares and `durable_intent_rows` reads.
        // Guarded on the source's own shape: an older file may lack a column,
        // and one missing name would fail the whole statement.
        let owned = [
            "section_type = 'custom'",
            "is_user_defined = 1",
            "original_polyline_json IS NOT NULL",
        ];
        let present = shared_columns(&src, &self.db, "sections");
        let predicate: Vec<&str> = owned
            .iter()
            .copied()
            .filter(|clause| present.iter().any(|c| clause.starts_with(c.as_str())))
            .collect();
        let sections = if predicate.is_empty() {
            0
        } else {
            salvage_table(
                &src,
                &self.db,
                "sections",
                &format!("WHERE {}", predicate.join(" OR ")),
            )
        };
        let intents = salvage_table(&src, &self.db, "section_intents", "");

        SalvageCounts {
            history,
            geometry,
            pins,
            sections,
            intents,
        }
    }

    /// The pinned version of one section, if any.
    pub fn pinned_section_version(&self, section_id: &str) -> Option<i64> {
        self.db
            .query_row(
                "SELECT version FROM section_pins WHERE section_id = ?",
                params![section_id],
                |row| row.get(0),
            )
            .optional()
            .ok()
            .flatten()
    }
}
