use std::collections::BTreeSet;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tracematch::GpsPoint;
use tracematch::sections::{NamedCandidate, score_named_candidate, select_candidate, trim_core};

use super::{PersistentEngine, codec, sections};

#[cfg(test)]
#[path = "tests/restored_numbers.rs"]
mod restored_number_tests;

/// Restored records still waiting for their activity or ground.
pub(crate) const PENDING_KEY: &str = "__record_restore_pending";
/// Activities a restored record names that this library has not fetched yet.
pub(crate) const OWED_KEY: &str = "__record_activities_owed";
/// Activities the server answered 404 for, never asked for again.
pub(crate) const UNAVAILABLE_KEY: &str = "__record_activities_unavailable";
/// How many history rows no section of this library could take, once detection
/// had settled. They are in the backup file and are not restored.
pub(crate) const NOT_RESTORED_KEY: &str = "__record_restore_not_restored";
/// An accepted import whose placement has not committed yet. It is written in
/// a commit of its own before placement starts and removed in placement's
/// commit, so a storage failure or a killed process leaves it here to resume.
pub(crate) const PAUSED_IMPORT_KEY: &str = "__record_import_paused";
/// What a number held for a restored route or section whose ground is not
/// here yet is keyed by in `route_numbers` and `section_numbers`, in place of
/// a local id. Holding it there is what keeps every minting path off it.
pub(crate) const HELD_NUMBER_PREFIX: &str = "restored:";

fn id_set_from_conn(conn: &Connection, key: &str) -> Result<BTreeSet<String>, String> {
    let raw: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = ?", [key], |row| {
            row.get(0)
        })
        .optional()
        .map_err(|e| e.to_string())?;
    match raw {
        Some(raw) if !raw.is_empty() => {
            serde_json::from_str(&raw).map_err(|e| format!("Unreadable {key}: {e}"))
        }
        _ => Ok(BTreeSet::new()),
    }
}

/// Refuse a record naming another athlete than the one this library holds.
pub(crate) fn check_record_athlete_from_conn(
    conn: &Connection,
    imported: Option<&str>,
) -> Result<(), String> {
    let current: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?",
            [super::settings::settings_keys::ATHLETE_ID],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let (Some(current), Some(imported)) = (current, imported)
        && current != imported
    {
        return Err("Record belongs to another athlete".to_string());
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RecordPayload {
    version: u32,
    #[serde(default)]
    athlete_id: Option<String>,
    entries: Vec<RecordRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RecordRow {
    table: String,
    values: Map<String, Value>,
    #[serde(default)]
    ground: Option<RecordGround>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RecordGround {
    rep_activity_id: Option<String>,
    rep_start_index: Option<i64>,
    rep_end_index: Option<i64>,
    point_count: Option<i64>,
    polyline_json: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    activity_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnplacedRecord {
    pub kind: String,
    pub name: Option<String>,
    pub reason: String,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct RestoreRecordResult {
    pub placed: u32,
    pub unplaced: u32,
    /// History rows given up on in this pass, counted into `NOT_RESTORED_KEY`.
    pub not_restored: u32,
    pub missing_activity_ids: Vec<String>,
}

fn paused_import_from_conn(conn: &Connection) -> Result<Option<RecordPayload>, String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?",
            [PAUSED_IMPORT_KEY],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    raw.map(|raw| serde_json::from_str(&raw).map_err(|e| format!("Unreadable paused import: {e}")))
        .transpose()
}

/// The athlete a paused import names, for the signed-in check before it resumes.
pub(crate) fn paused_import_athlete_from_conn(conn: &Connection) -> Result<Option<String>, String> {
    Ok(paused_import_from_conn(conn)?.and_then(|payload| payload.athlete_id))
}

/// The records waiting to be placed. A row an earlier build kept for a table
/// that does not travel is left out, so it is neither listed nor placed.
fn pending_record_rows_from_conn(conn: &Connection) -> Result<Vec<RecordRow>, String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?",
            [PENDING_KEY],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    match raw {
        Some(raw) => serde_json::from_str::<Vec<RecordRow>>(&raw)
            .map(|rows| {
                rows.into_iter()
                    .filter(|row| super::record_backup::travels(&row.table))
                    .collect()
            })
            .map_err(|e| format!("Unreadable pending record: {e}")),
        None => Ok(Vec::new()),
    }
}

/// Backup-settings read on a pooled SQLite connection.
pub(crate) fn unplaced_records_from_conn(conn: &Connection) -> Result<Vec<UnplacedRecord>, String> {
    let mut records = Vec::new();
    if paused_import_from_conn(conn)?.is_some() {
        records.push(UnplacedRecord {
            kind: "import".to_string(),
            name: None,
            reason: "import_paused".to_string(),
        });
    }
    let unavailable = id_set_from_conn(conn, UNAVAILABLE_KEY)?;
    for row in pending_record_rows_from_conn(conn)? {
        if is_number_row(&row) {
            continue;
        }
        let missing = match row
            .ground
            .as_ref()
            .and_then(|ground| ground.rep_activity_id.as_deref())
        {
            Some(id) => conn
                .query_row(
                    "SELECT 1 FROM gps_tracks WHERE activity_id = ?",
                    [id],
                    |_| Ok(()),
                )
                .optional()
                .map_err(|e| e.to_string())?
                .is_none()
                .then_some(id),
            None => None,
        };
        records.push(UnplacedRecord {
            kind: row.table,
            name: string(&row.values, "name")
                .or_else(|| string(&row.values, "custom_name"))
                .map(str::to_owned),
            reason: match missing {
                Some(id) if unavailable.contains(id) => "activity_unavailable",
                Some(_) => "activity_pending",
                None => "ground_not_detected",
            }
            .to_string(),
        });
    }
    records.extend(
        sections::named::compute::compute_overlay(conn)
            .corridors
            .into_iter()
            .filter(|corridor| {
                corridor.section_id.is_none() && corridor.intent_id.starts_with("ri_")
            })
            .map(|corridor| UnplacedRecord {
                kind: "name".to_string(),
                name: Some(corridor.name),
                reason: "ground_not_detected".to_string(),
            }),
    );
    Ok(records)
}

impl PersistentEngine {
    /// Restore a validated record payload, retaining rows that cannot yet be placed.
    ///
    /// The payload is refused before any write when it cannot be read, is a
    /// newer format, names another athlete or holds a row whose content can
    /// never be placed. Once accepted it is committed as the paused import,
    /// carrying any import already paused, and then placed in one transaction
    /// that also removes it. A failure there is storage, so it leaves the
    /// library as it was and the import paused, and an import of no entries
    /// resumes it.
    pub fn restore_record_json(&mut self, json: &str) -> Result<RestoreRecordResult, String> {
        let payload: RecordPayload =
            serde_json::from_str(json).map_err(|e| format!("Unreadable record payload: {e}"))?;
        if payload.version != 1 {
            return Err(format!("Unsupported record version {}", payload.version));
        }
        check_record_athlete_from_conn(&self.db, payload.athlete_id.as_deref())?;
        for row in &payload.entries {
            check_record_row(row)?;
        }
        let payload = match paused_import_from_conn(&self.db)? {
            Some(paused) => {
                if let (Some(earlier), Some(later)) = (&paused.athlete_id, &payload.athlete_id)
                    && earlier != later
                {
                    return Err("Record belongs to another athlete".to_string());
                }
                // The later file's rows come last, so its values are the ones
                // that stand where both name the same thing.
                let mut entries = readable_rows(paused.entries);
                entries.extend(payload.entries);
                RecordPayload {
                    version: payload.version,
                    athlete_id: payload.athlete_id.or(paused.athlete_id),
                    entries,
                }
            }
            None => payload,
        };
        self.set_setting(
            PAUSED_IMPORT_KEY,
            &serde_json::to_string(&payload).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        self.place_import(payload)
    }

    /// Every record, the athlete id and the removal of the paused import commit
    /// together or not at all, so a retry finds the import whole.
    fn place_import(&mut self, payload: RecordPayload) -> Result<RestoreRecordResult, String> {
        self.in_write_txn(|engine| {
            let mut entries = engine.pending_record_rows()?;
            entries.extend(payload.entries);
            let entries = distinct_rows(readable_rows(entries))?;
            if let Some(athlete_id) = payload.athlete_id.as_deref() {
                engine
                    .set_setting(super::settings::settings_keys::ATHLETE_ID, athlete_id)
                    .map_err(|e| e.to_string())?;
            }
            let result = engine.place_record_rows(entries, false)?;
            engine
                .delete_setting(PAUSED_IMPORT_KEY)
                .map_err(|e| e.to_string())?;
            // An imported library has no marker, so nothing in it rings.
            engine
                .delete_setting(super::settings::settings_keys::FEED_RINGS)
                .map_err(|e| e.to_string())?;
            Ok(result)
        })
    }

    /// Drop the paused import, at the athlete's word. The library and the
    /// records already waiting are untouched.
    pub fn discard_paused_import(&self) -> Result<(), String> {
        self.delete_setting(PAUSED_IMPORT_KEY)
            .map_err(|e| e.to_string())
    }

    /// Reconsider every unresolved record after an activity or catalogue change.
    pub fn retry_record_restore(&mut self) -> Result<RestoreRecordResult, String> {
        let entries = self.pending_record_rows()?;
        if entries.is_empty() {
            return Ok(RestoreRecordResult::default());
        }
        let entries = readable_rows(entries);
        self.in_write_txn(|engine| engine.place_record_rows(entries, false))
    }

    /// Reconsider every unresolved record once detection has cut the
    /// catalogue. History whose ground is stored but which no section of this
    /// library covers will not be placed by anything later, so it is counted
    /// as not restored and left in the backup file.
    pub fn settle_record_restore(&mut self) -> Result<RestoreRecordResult, String> {
        let entries = self.pending_record_rows()?;
        if entries.is_empty() {
            return Ok(RestoreRecordResult::default());
        }
        let entries = readable_rows(entries);
        self.in_write_txn(|engine| engine.place_record_rows(entries, true))
    }

    /// History rows a restore reported as not restored.
    pub fn not_restored_history_count(&self) -> Result<u32, String> {
        Ok(self
            .get_setting(NOT_RESTORED_KEY)
            .map_err(|e| e.to_string())?
            .and_then(|raw| raw.parse().ok())
            .unwrap_or(0))
    }

    /// Records awaiting their source activity or a matching local corridor.
    pub fn unplaced_records(&self) -> Result<Vec<UnplacedRecord>, String> {
        unplaced_records_from_conn(&self.db)
    }

    /// Activities restored records still need fetched, owed until one lands
    /// or the server answers 404 for it.
    pub fn owed_record_activities(&self) -> Result<Vec<String>, String> {
        Ok(id_set_from_conn(&self.db, OWED_KEY)?
            .into_iter()
            .filter(|id| !self.has_activity(id))
            .collect())
    }

    /// The server has no such activity: stop asking for it.
    pub fn mark_record_activity_unavailable(&mut self, activity_id: &str) -> Result<(), String> {
        let mut owed = id_set_from_conn(&self.db, OWED_KEY)?;
        let mut unavailable = id_set_from_conn(&self.db, UNAVAILABLE_KEY)?;
        owed.remove(activity_id);
        unavailable.insert(activity_id.to_string());
        self.write_id_set(OWED_KEY, &owed)?;
        self.write_id_set(UNAVAILABLE_KEY, &unavailable)
    }

    fn write_id_set(&self, key: &str, ids: &BTreeSet<String>) -> Result<(), String> {
        self.set_setting(key, &serde_json::to_string(ids).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())
    }

    fn pending_record_rows(&self) -> Result<Vec<RecordRow>, String> {
        pending_record_rows_from_conn(&self.db)
    }

    fn place_record_rows(
        &mut self,
        entries: Vec<RecordRow>,
        settled: bool,
    ) -> Result<RestoreRecordResult, String> {
        // A pinned section is the athlete's own, so its history keeps waiting
        // for the pin to land.
        let pinned: BTreeSet<String> = entries
            .iter()
            .filter(|row| row.table == "section_pins")
            .filter_map(|row| string(&row.values, "section_id").map(str::to_owned))
            .collect();
        let mut result = RestoreRecordResult::default();
        let mut pending = Vec::new();
        let mut missing = BTreeSet::new();
        let mut numbered = BTreeSet::new();
        let mut routes_touched = false;
        let imported_names: BTreeSet<String> = entries
            .iter()
            .filter_map(|row| match row.table.as_str() {
                "section_intents" if string(&row.values, "kind") == Some("named") => {
                    string(&row.values, "id").map(|id| format!("ri_{id}"))
                }
                "sections" if string(&row.values, "section_type") != Some("custom") => {
                    string(&row.values, "id").map(|id| format!("ri_section_{id}"))
                }
                _ => None,
            })
            .collect();
        for row in entries {
            if !super::record_backup::travels(&row.table) {
                log::warn!(
                    "[record] Skipped a {} row, which no library imports",
                    row.table
                );
                continue;
            }
            for id in record_activity_ids(&row) {
                if !self.has_activity(&id) {
                    missing.insert(id);
                }
            }
            routes_touched |= matches!(row.table.as_str(), "route_names" | "route_numbers");
            if is_number_row(&row) {
                if !self.place_number(&row, &mut numbered)? {
                    pending.push(row);
                }
                continue;
            }
            if self.place_record_row(&row)? {
                result.placed += 1;
            } else if settled && self.history_has_no_section(&row, &pinned)? {
                result.not_restored += 1;
            } else {
                pending.push(row);
            }
        }
        if routes_touched {
            self.apply_route_names().map_err(|e| e.to_string())?;
        }
        let unresolved_names: BTreeSet<String> = self
            .get_named_corridors()
            .into_iter()
            .filter(|corridor| corridor.section_id.is_none())
            .map(|corridor| corridor.intent_id)
            .collect();
        let restored_unresolved_names = imported_names.intersection(&unresolved_names).count();
        result.placed = result
            .placed
            .saturating_sub(restored_unresolved_names as u32);
        // A held number is not a decision left to place: the athlete has
        // nothing to do about it, and it lands with its ground.
        let waiting = pending.iter().filter(|row| !is_number_row(row)).count();
        result.unplaced = (waiting + restored_unresolved_names) as u32;
        let unavailable = id_set_from_conn(&self.db, UNAVAILABLE_KEY)?;
        let mut owed = id_set_from_conn(&self.db, OWED_KEY)?;
        owed.extend(missing.iter().cloned());
        owed.retain(|id| !unavailable.contains(id) && !self.has_activity(id));
        self.write_id_set(OWED_KEY, &owed)?;
        if result.not_restored > 0 {
            let total = self.not_restored_history_count()? + result.not_restored;
            self.set_setting(NOT_RESTORED_KEY, &total.to_string())
                .map_err(|e| e.to_string())?;
        }
        result.missing_activity_ids = missing.into_iter().collect();
        self.set_setting(
            PENDING_KEY,
            &serde_json::to_string(&pending).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        Ok(result)
    }

    fn place_record_row(&mut self, row: &RecordRow) -> Result<bool, String> {
        match row.table.as_str() {
            "settings" => {
                let (Some(key), Some(value)) =
                    (string(&row.values, "key"), string(&row.values, "value"))
                else {
                    return Ok(false);
                };
                if [
                    PENDING_KEY,
                    OWED_KEY,
                    UNAVAILABLE_KEY,
                    PAUSED_IMPORT_KEY,
                    super::settings::settings_keys::ATHLETE_ID,
                ]
                .contains(&key)
                {
                    return Ok(true);
                }
                self.set_setting(key, value).map_err(|e| e.to_string())?;
                Ok(true)
            }
            "section_intents" => {
                let (Some(id), Some(kind), Some(points)) = (
                    string(&row.values, "id"),
                    string(&row.values, "kind"),
                    intent_line(row)?,
                ) else {
                    return Ok(false);
                };
                if points.len() < 2 {
                    return Ok(false);
                }
                self.db
                    .execute(
                        "INSERT INTO section_intents (id, kind, polyline_blob, name, sport_type)
                     VALUES (?1, ?2, ?3, ?4, ?5)
                     ON CONFLICT(id, kind) DO UPDATE SET polyline_blob = excluded.polyline_blob,
                         polyline_json = NULL,
                         name = excluded.name, sport_type = excluded.sport_type",
                        params![
                            format!("ri_{id}"),
                            kind,
                            codec::serialize_track_points(&points),
                            string(&row.values, "name"),
                            string(&row.values, "sport_type")
                        ],
                    )
                    .map_err(|e| e.to_string())?;
                Ok(true)
            }
            "section_pins" => self.place_pin(row),
            "section_forced_matches" => self.place_forced_match(row),
            "section_history" => self.place_history(row),
            super::record_backup::LEGACY_SECTION_NAME => {
                // The legacy file carries only an old section ID. Keep its name
                // pending until a recovery route can identify the ground.
                Ok(false)
            }
            "sections" => self.place_section(row),
            "route_names" => self.place_route_name(row),
            "section_activities" => self.place_section_exclusion(row),
            "activity_matches" => self.place_route_exclusion(row),
            _ => Ok(false),
        }
    }

    fn place_section(&mut self, row: &RecordRow) -> Result<bool, String> {
        let Some(ground) = row.ground.as_ref() else {
            return Ok(false);
        };
        let user_defined = integer(&row.values, "is_user_defined") == Some(1)
            || string(&row.values, "original_polyline_json").is_some();
        if string(&row.values, "section_type") == Some("auto") && user_defined {
            let Some(points) = ground_line(&self.db, ground) else {
                return Ok(false);
            };
            if matching_section(&self.db, &points, MatchScope::UserAuto)?.is_some() {
                return Ok(true);
            }
            let Some(sport_type) = string(&row.values, "sport_type") else {
                return Ok(false);
            };
            let original = original_line(row)?;
            if original.as_ref().is_some_and(|undo| undo.len() < 2) {
                return Ok(false);
            }
            let params = crate::sections::CreateSectionParams {
                sport_type: sport_type.to_string(),
                polyline: points,
                distance_meters: row
                    .values
                    .get("distance_meters")
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0),
                name: string(&row.values, "name").map(str::to_owned),
                source_activity_id: None,
                start_index: None,
                end_index: None,
            };
            let id = self.create_section(params)?;
            self.db
                .execute(
                    "UPDATE sections SET original_polyline_blob = ?1,
                     representative_activity_id = ?2, rep_start_index = ?3,
                     rep_end_index = ?4 WHERE id = ?5",
                    params![
                        original.as_deref().map(codec::serialize_track_points),
                        ground.rep_activity_id,
                        ground.rep_start_index,
                        ground.rep_end_index,
                        id
                    ],
                )
                .map_err(|e| e.to_string())?;
            return Ok(true);
        }
        if string(&row.values, "section_type") != Some("custom") {
            let Some(name) = string(&row.values, "name") else {
                return Ok(false);
            };
            let Some(points) = ground_line(&self.db, ground) else {
                return Ok(false);
            };
            let source_id = string(&row.values, "id").unwrap_or("unnamed");
            self.db
                .execute(
                    "INSERT INTO section_intents (id, kind, polyline_blob, name, sport_type)
                 VALUES (?1, 'named', ?2, ?3, ?4)
                 ON CONFLICT(id, kind) DO UPDATE SET name = excluded.name,
                     polyline_blob = excluded.polyline_blob, polyline_json = NULL",
                    params![
                        format!("ri_section_{source_id}"),
                        codec::serialize_track_points(&points),
                        name,
                        string(&row.values, "sport_type")
                    ],
                )
                .map_err(|e| e.to_string())?;
            return Ok(true);
        }
        let Some(CutGround {
            source,
            range,
            points,
        }) = cut_line(&self.db, ground)
        else {
            return Ok(false);
        };
        if matching_section(&self.db, &points, MatchScope::Custom)?.is_some() {
            return Ok(true);
        }
        let Some(sport_type) = string(&row.values, "sport_type") else {
            return Ok(false);
        };
        let params = crate::sections::CreateSectionParams {
            sport_type: sport_type.to_string(),
            polyline: points,
            distance_meters: row
                .values
                .get("distance_meters")
                .and_then(Value::as_f64)
                .unwrap_or(0.0),
            name: string(&row.values, "name").map(str::to_owned),
            source_activity_id: Some(source),
            start_index: range.map(|(start, _)| start),
            end_index: range.map(|(_, end)| end - 1),
        };
        self.create_section(params)?;
        Ok(true)
    }

    fn place_route_name(&self, row: &RecordRow) -> Result<bool, String> {
        let Some(name) = string(&row.values, "custom_name") else {
            return Ok(false);
        };
        let Some(route_id) = row
            .ground
            .as_ref()
            .map(|ground| route_group(&self.db, ground))
            .transpose()?
            .flatten()
        else {
            return Ok(false);
        };
        self.db
            .execute(
                "INSERT INTO route_names (route_id, custom_name) VALUES (?, ?)
             ON CONFLICT(route_id) DO UPDATE SET custom_name = excluded.custom_name",
                params![route_id, name],
            )
            .map_err(|e| e.to_string())?;
        Ok(true)
    }

    /// Give a restored number back to the route or section on its ground.
    ///
    /// Whatever local row holds the number now moves to the lowest free one
    /// in the same write, so no read sees two holders. With no ground here
    /// yet the number is held under the record's own key until it lands. A
    /// local row takes one restored number per placement, so two old numbers
    /// whose ground resolves to it do not displace each other.
    fn place_number(
        &self,
        row: &RecordRow,
        numbered: &mut BTreeSet<(NumberStore, String)>,
    ) -> Result<bool, String> {
        let Some((store, source_id, number)) = number_row(row) else {
            return Ok(true);
        };
        let held = format!("{HELD_NUMBER_PREFIX}{}:{source_id}", store.kind());
        let local = match (store, row.ground.as_ref()) {
            (_, None) => None,
            (NumberStore::Routes, Some(ground)) => route_group(&self.db, ground)?,
            (NumberStore::Sections, Some(ground)) => {
                let scope = if string(&row.values, "section_type") == Some("custom") {
                    MatchScope::Custom
                } else {
                    MatchScope::Auto
                };
                match ground_line(&self.db, ground) {
                    Some(points) => matching_section(&self.db, &points, scope)?,
                    None => None,
                }
            }
        }
        .filter(|id| !numbered.contains(&(store, id.clone())));
        let Some(local) = local else {
            hold_number(&self.db, store, &held, number)?;
            return Ok(false);
        };
        self.db
            .execute(
                &format!("DELETE FROM {} WHERE {} = ?1", store.table(), store.key()),
                [&held],
            )
            .map_err(|e| e.to_string())?;
        hold_number(&self.db, store, &local, number)?;
        numbered.insert((store, local));
        Ok(true)
    }

    fn place_section_exclusion(&self, row: &RecordRow) -> Result<bool, String> {
        if integer(&row.values, "excluded") != Some(1) {
            return Ok(true);
        }
        let Some(ground) = row.ground.as_ref() else {
            return Ok(false);
        };
        let Some(points) = ground_line(&self.db, ground) else {
            return Ok(false);
        };
        let Some(section_id) = matching_section(&self.db, &points, MatchScope::Any)? else {
            return Ok(false);
        };
        let Some(activity_id) = string(&row.values, "activity_id") else {
            return Ok(false);
        };
        let Some(start) = integer(&row.values, "start_index") else {
            return Ok(false);
        };
        let changed = self.db.execute(
            "UPDATE section_activities SET excluded = 1 WHERE section_id = ?1 AND activity_id = ?2 AND start_index = ?3",
            params![section_id, activity_id, start],
        ).map_err(|e| e.to_string())?;
        Ok(changed > 0)
    }

    fn place_route_exclusion(&self, row: &RecordRow) -> Result<bool, String> {
        if integer(&row.values, "excluded") != Some(1) {
            return Ok(true);
        }
        let Some(route_id) = row
            .ground
            .as_ref()
            .map(|ground| route_group(&self.db, ground))
            .transpose()?
            .flatten()
        else {
            return Ok(false);
        };
        let Some(activity_id) = string(&row.values, "activity_id") else {
            return Ok(false);
        };
        let changed = self
            .db
            .execute(
                "UPDATE activity_matches SET excluded = 1 WHERE route_id = ?1 AND activity_id = ?2",
                params![route_id, activity_id],
            )
            .map_err(|e| e.to_string())?;
        Ok(changed > 0)
    }

    fn place_pin(&mut self, row: &RecordRow) -> Result<bool, String> {
        let Some(ground) = row.ground.as_ref() else {
            return Ok(false);
        };
        if ground_reference(ground).is_none() {
            return self.place_line_pin(row, ground);
        }
        let Some((reference, points)) = exact_line(&self.db, ground) else {
            return Ok(false);
        };
        let section_id = match matching_section(&self.db, &points, MatchScope::Any)? {
            Some(id) => id,
            None => {
                let sport_type: Option<String> = self
                    .db
                    .query_row(
                        "SELECT sport_type FROM activities WHERE id = ?",
                        [reference.0],
                        |r| r.get(0),
                    )
                    .optional()
                    .map_err(|e| e.to_string())?;
                let Some(sport_type) = sport_type else {
                    return Ok(false);
                };
                let id = self.create_section(crate::sections::CreateSectionParams {
                    sport_type,
                    distance_meters: tracematch::matching::calculate_route_distance(&points),
                    polyline: points.clone(),
                    name: None,
                    source_activity_id: None,
                    start_index: None,
                    end_index: None,
                })?;
                self.db
                    .execute(
                        "UPDATE sections SET representative_activity_id = ?1,
                         rep_start_index = ?2, rep_end_index = ?3, geometry_source = 'exact'
                     WHERE id = ?4",
                        params![reference.0, reference.1, reference.2, id],
                    )
                    .map_err(|e| e.to_string())?;
                id
            }
        };
        let Some(imported_version) = integer(&row.values, "version") else {
            return Ok(false);
        };
        let version =
            store_restored_geometry(&self.db, &section_id, imported_version, ground, &points)?;
        self.db
            .execute(
                "INSERT INTO section_pins (section_id, version) VALUES (?1, ?2)
             ON CONFLICT(section_id) DO UPDATE SET version = excluded.version",
                params![section_id, version],
            )
            .map_err(|e| e.to_string())?;
        Ok(true)
    }

    /// A consensus version names no ride, so its line is its only ground: it
    /// lands on the local section that line resolves to, or waits for one.
    fn place_line_pin(&mut self, row: &RecordRow, ground: &RecordGround) -> Result<bool, String> {
        let Some(points) = ground_line(&self.db, ground) else {
            return Ok(false);
        };
        let Some(section_id) = matching_section(&self.db, &points, MatchScope::Any)? else {
            return Ok(false);
        };
        let Some(imported_version) = integer(&row.values, "version") else {
            return Ok(false);
        };
        let version =
            store_restored_geometry(&self.db, &section_id, imported_version, ground, &points)?;
        self.db
            .execute(
                "INSERT INTO section_pins (section_id, version) VALUES (?1, ?2)
             ON CONFLICT(section_id) DO UPDATE SET version = excluded.version",
                params![section_id, version],
            )
            .map_err(|e| e.to_string())?;
        Ok(true)
    }

    /// A force-match lands on the local section its ground resolves to, once
    /// the ride is here: the ride is cut at the forced bar and the record
    /// kept, with the time it was first attached.
    fn place_forced_match(&mut self, row: &RecordRow) -> Result<bool, String> {
        let Some(ground) = row.ground.as_ref() else {
            return Ok(false);
        };
        let (Some(activity_id), Some(forced_at)) = (
            string(&row.values, "activity_id"),
            integer(&row.values, "forced_at"),
        ) else {
            return Ok(false);
        };
        let Some(points) = ground_line(&self.db, ground) else {
            return Ok(false);
        };
        let Some(section_id) = matching_section(&self.db, &points, MatchScope::Any)? else {
            return Ok(false);
        };
        if !self.rematch_activity_to_section(activity_id, &section_id)? {
            return Ok(false);
        }
        self.db
            .execute(
                "INSERT INTO section_forced_matches (section_id, activity_id, forced_at)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(section_id, activity_id) DO UPDATE SET forced_at = excluded.forced_at",
                params![section_id, activity_id, forced_at],
            )
            .map_err(|e| e.to_string())?;
        Ok(true)
    }

    /// Whether a history row's ground is stored here and no section of this
    /// library covers it, for a section the athlete never pinned.
    fn history_has_no_section(
        &self,
        row: &RecordRow,
        pinned: &BTreeSet<String>,
    ) -> Result<bool, String> {
        if row.table != "section_history"
            || string(&row.values, "section_id").is_some_and(|id| pinned.contains(id))
        {
            return Ok(false);
        }
        let Some(points) = row.ground.as_ref().and_then(|g| ground_line(&self.db, g)) else {
            return Ok(false);
        };
        Ok(matching_section(&self.db, &points, MatchScope::Any)?.is_none())
    }

    fn place_history(&self, row: &RecordRow) -> Result<bool, String> {
        let Some(ground) = row.ground.as_ref() else {
            return Ok(false);
        };
        let Some(points) = ground_line(&self.db, ground) else {
            return Ok(false);
        };
        let Some(section_id) = matching_section(&self.db, &points, MatchScope::Any)? else {
            return Ok(false);
        };
        let (Some(at), Some(kind)) = (string(&row.values, "at"), string(&row.values, "kind"))
        else {
            return Ok(false);
        };
        let details = string(&row.values, "details");
        let version = integer(&row.values, "geometry_version")
            .map(|imported| {
                store_restored_geometry(&self.db, &section_id, imported, ground, &points)
            })
            .transpose()?;
        self.db
            .execute(
                "INSERT INTO section_history (section_id, at, kind, details, geometry_version)
             SELECT ?1, ?2, ?3, ?4, ?5 WHERE NOT EXISTS (
                 SELECT 1 FROM section_history WHERE section_id = ?1 AND at = ?2 AND kind = ?3
                   AND details IS ?4 AND geometry_version IS ?5)",
                params![section_id, at, kind, details, version],
            )
            .map_err(|e| e.to_string())?;
        Ok(true)
    }
}

/// A named intent's line, or `None` when the row lacks what placing it needs.
fn intent_line(row: &RecordRow) -> Result<Option<Vec<GpsPoint>>, String> {
    let (Some(_), Some(_), Some(polyline)) = (
        string(&row.values, "id"),
        string(&row.values, "kind"),
        string(&row.values, "polyline_json"),
    ) else {
        return Ok(None);
    };
    serde_json::from_str(polyline)
        .map(Some)
        .map_err(|e| format!("Unreadable section line: {e}"))
}

/// The undo line an edited auto section carries, when it carries one.
fn original_line(row: &RecordRow) -> Result<Option<Vec<GpsPoint>>, String> {
    string(&row.values, "original_polyline_json")
        .map(|original| {
            serde_json::from_str(original)
                .map_err(|e| format!("Unreadable original section ground: {e}"))
        })
        .transpose()
}

/// Refuse a row whose own content no library could ever place.
///
/// Placement reads these lines through the same two helpers, so a row that
/// passes here fails placement only on storage, and only storage pauses an
/// import.
fn check_record_row(row: &RecordRow) -> Result<(), String> {
    match row.table.as_str() {
        "section_intents" => intent_line(row).map(drop),
        "sections" if string(&row.values, "section_type") == Some("auto") => {
            original_line(row).map(drop)
        }
        "section_numbers" | "route_numbers" => number_row(row)
            .map(drop)
            .ok_or_else(|| format!("Unreadable {} row", row.table)),
        _ => Ok(()),
    }
}

/// The content check a restore of this payload runs, writing nothing.
pub(crate) fn check_record_rows_json(json: &str) -> Result<(), String> {
    let payload: RecordPayload =
        serde_json::from_str(json).map_err(|e| format!("Unreadable record payload: {e}"))?;
    payload.entries.iter().try_for_each(check_record_row)
}

/// Rows an earlier build stored, paused or waiting, less any that fail on
/// content: such a row can never be placed, and carried along it would stop
/// every later import.
fn readable_rows(rows: Vec<RecordRow>) -> Vec<RecordRow> {
    rows.into_iter()
        .filter(|row| match check_record_row(row) {
            Ok(()) => true,
            Err(reason) => {
                log::warn!("[record] Dropped a stored {} row: {reason}", row.table);
                false
            }
        })
        .collect()
}

/// One row per serialised form, first occurrence kept, so importing the same
/// record again adds nothing to what is waiting.
fn distinct_rows(rows: Vec<RecordRow>) -> Result<Vec<RecordRow>, String> {
    let mut seen = std::collections::HashSet::new();
    let mut distinct = Vec::with_capacity(rows.len());
    for row in rows {
        if seen.insert(serde_json::to_string(&row).map_err(|e| e.to_string())?) {
            distinct.push(row);
        }
    }
    Ok(distinct)
}

/// The two number stores, each a key column and a number unique across it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum NumberStore {
    Routes,
    Sections,
}

impl NumberStore {
    fn table(self) -> &'static str {
        match self {
            NumberStore::Routes => "route_numbers",
            NumberStore::Sections => "section_numbers",
        }
    }

    fn key(self) -> &'static str {
        match self {
            NumberStore::Routes => "route_id",
            NumberStore::Sections => "section_id",
        }
    }

    fn kind(self) -> &'static str {
        match self {
            NumberStore::Routes => "route",
            NumberStore::Sections => "section",
        }
    }
}

fn is_number_row(row: &RecordRow) -> bool {
    matches!(row.table.as_str(), "section_numbers" | "route_numbers")
}

/// The store, the backed-up library's id and the number a number row carries.
fn number_row(row: &RecordRow) -> Option<(NumberStore, &str, u32)> {
    let store = match row.table.as_str() {
        "route_numbers" => NumberStore::Routes,
        "section_numbers" => NumberStore::Sections,
        _ => return None,
    };
    let id = string(&row.values, store.key())?;
    let number = integer(&row.values, "number")
        .and_then(|n| u32::try_from(n).ok())
        .filter(|n| *n > 0)?;
    Some((store, id, number))
}

/// Make `holder` the one holder of `number`, giving up any number it held,
/// and move whoever held `number` to the lowest number nobody holds.
fn hold_number(
    conn: &Connection,
    store: NumberStore,
    holder: &str,
    number: u32,
) -> Result<(), String> {
    let (table, key) = (store.table(), store.key());
    let current: Option<String> = conn
        .query_row(
            &format!("SELECT {key} FROM {table} WHERE number = ?1"),
            [number],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if current.as_deref() == Some(holder) {
        return Ok(());
    }
    conn.execute(&format!("DELETE FROM {table} WHERE {key} = ?1"), [holder])
        .map_err(|e| e.to_string())?;
    if let Some(current) = current {
        let fresh = lowest_free_number(conn, store)?;
        conn.execute(
            &format!("UPDATE {table} SET number = ?1 WHERE {key} = ?2"),
            params![fresh, current],
        )
        .map_err(|e| e.to_string())?;
    }
    conn.execute(
        &format!("INSERT INTO {table} ({key}, number) VALUES (?1, ?2)"),
        params![holder, number],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn lowest_free_number(conn: &Connection, store: NumberStore) -> Result<u32, String> {
    let mut stmt = conn
        .prepare(&format!(
            "SELECT number FROM {} ORDER BY number",
            store.table()
        ))
        .map_err(|e| e.to_string())?;
    let held = stmt
        .query_map([], |row| row.get::<_, u32>(0))
        .map_err(|e| e.to_string())?;
    let mut candidate = 1;
    for number in held {
        let number = number.map_err(|e| e.to_string())?;
        if number > candidate {
            break;
        }
        candidate = number + 1;
    }
    Ok(candidate)
}

fn string<'a>(values: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    values.get(key)?.as_str()
}

fn integer(values: &Map<String, Value>, key: &str) -> Option<i64> {
    values.get(key)?.as_i64()
}

fn record_activity_ids(row: &RecordRow) -> Vec<String> {
    let mut ids = Vec::new();
    if let Some(id) = row
        .ground
        .as_ref()
        .and_then(|g| g.rep_activity_id.as_deref())
    {
        ids.push(id.to_string());
    }
    if matches!(
        row.table.as_str(),
        "sections" | "section_activities" | "activity_matches" | "section_forced_matches"
    ) {
        for key in [
            "activity_id",
            "source_activity_id",
            "representative_activity_id",
        ] {
            if let Some(id) = string(&row.values, key) {
                ids.push(id.to_string());
            }
        }
    }
    if row.table == "section_history" {
        let details = row.values.get("details").and_then(|value| match value {
            Value::String(raw) => serde_json::from_str::<Value>(raw).ok(),
            Value::Object(_) => Some(value.clone()),
            _ => None,
        });
        if let Some(details) = details.as_ref() {
            collect_ledger_activity_ids(details, &mut ids);
        }
    }
    ids
}

fn collect_ledger_activity_ids(value: &Value, ids: &mut Vec<String>) {
    let Value::Object(fields) = value else { return };
    for (key, value) in fields {
        match key.as_str() {
            "pr_activity_id" | "activity_id" | "rep_activity_id" | "source_activity_id" => {
                if let Some(id) = value.as_str() {
                    ids.push(id.to_string());
                }
            }
            "around" | "fork_around" | "activity_ids" => {
                if let Some(values) = value.as_array() {
                    ids.extend(values.iter().filter_map(Value::as_str).map(str::to_string));
                }
            }
            _ => collect_ledger_activity_ids(value, ids),
        }
    }
}

/// An archived section state the record carried whose ground is readable here
/// but covered by no local section yet.
struct PendingArchived {
    row: RecordRow,
    section_id: String,
    version: i64,
    points: Vec<GpsPoint>,
}

fn pending_archived(conn: &Connection) -> Vec<PendingArchived> {
    let Ok(rows) = pending_record_rows_from_conn(conn) else {
        return Vec::new();
    };
    rows.into_iter()
        .filter_map(|row| {
            if row.table != "section_history"
                || string(&row.values, "kind") != Some(sections::KIND_ARCHIVED)
            {
                return None;
            }
            let section_id = string(&row.values, "section_id")?.to_string();
            let version = integer(&row.values, "geometry_version")?;
            let points = ground_line(conn, row.ground.as_ref()?)?;
            if matches!(
                matching_section(conn, &points, MatchScope::Any),
                Ok(Some(_))
            ) {
                return None;
            }
            Some(PendingArchived {
                row,
                section_id,
                version,
                points,
            })
        })
        .collect()
}

/// The pending archived states as retired sections, so the athlete can roll
/// back to one before any local section stands on its ground.
pub(crate) fn pending_retired_sections(conn: &Connection) -> Vec<sections::RetiredSection> {
    let mut retired: Vec<sections::RetiredSection> = Vec::new();
    for state in pending_archived(conn) {
        let at = string(&state.row.values, "at")
            .unwrap_or_default()
            .to_string();
        match retired
            .iter_mut()
            .find(|r| r.section_id == state.section_id)
        {
            Some(existing) => {
                existing.versions.push(state.version);
                existing.at = existing.at.clone().max(at);
            }
            None => retired.push(sections::RetiredSection {
                section_id: state.section_id,
                kind: "superseded".to_string(),
                at,
                into: None,
                versions: vec![state.version],
            }),
        }
    }
    for r in &mut retired {
        r.versions.sort_unstable();
    }
    retired
}

/// The line of one pending archived state, for drawing it before it is placed.
pub(crate) fn pending_archived_line(
    conn: &Connection,
    section_id: &str,
    version: i64,
) -> Option<Vec<GpsPoint>> {
    pending_archived(conn)
        .into_iter()
        .find(|s| s.section_id == section_id && s.version == version)
        .map(|s| s.points)
}

impl PersistentEngine {
    /// Place a pending archived state under its own id: its geometry is stored
    /// from the row's ground, its ledger row is written and the pending row is
    /// dropped. False when no pending state names that id and version. The
    /// caller then recreates the section from the ledger row, as it does for
    /// any retired section.
    pub(crate) fn adopt_pending_archived_state(
        &mut self,
        section_id: &str,
        version: i64,
    ) -> Result<bool, String> {
        let Some(state) = pending_archived(&self.db)
            .into_iter()
            .find(|s| s.section_id == section_id && s.version == version)
        else {
            return Ok(false);
        };
        let live: bool = self
            .db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sections WHERE id = ?)",
                [section_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if live {
            return Ok(false);
        }
        let (Some(ground), Some(at), Some(kind)) = (
            state.row.ground.as_ref(),
            string(&state.row.values, "at"),
            string(&state.row.values, "kind"),
        ) else {
            return Ok(false);
        };
        let stored = store_restored_geometry(&self.db, section_id, version, ground, &state.points)?;
        self.db
            .execute(
                "INSERT INTO section_history (section_id, at, kind, details, geometry_version)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    section_id,
                    at,
                    kind,
                    string(&state.row.values, "details"),
                    stored
                ],
            )
            .map_err(|e| e.to_string())?;
        let remaining: Vec<RecordRow> = self
            .pending_record_rows()?
            .into_iter()
            .filter(|row| {
                !(row.table == "section_history"
                    && string(&row.values, "section_id") == Some(section_id)
                    && integer(&row.values, "geometry_version") == Some(version)
                    && string(&row.values, "kind") == Some(sections::KIND_ARCHIVED))
            })
            .collect();
        self.set_setting(
            PENDING_KEY,
            &serde_json::to_string(&remaining).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        Ok(true)
    }
}

/// A section's reference (activity id, start and end index) and the line rebuilt from it.
type ReferencedLine<'a> = ((&'a str, u32, u32), Vec<GpsPoint>);

fn ground_reference(ground: &RecordGround) -> Option<(&str, u32, u32)> {
    sections::geometry::reference(
        ground.rep_activity_id.as_deref(),
        ground.rep_start_index.and_then(|n| u32::try_from(n).ok()),
        ground.rep_end_index.and_then(|n| u32::try_from(n).ok()),
    )
}

fn exact_line<'a>(
    conn: &rusqlite::Connection,
    ground: &'a RecordGround,
) -> Option<ReferencedLine<'a>> {
    let reference = ground_reference(ground)?;
    let points = sections::geometry::rebuild_counted(conn, reference, ground.point_count)?;
    Some((reference, points))
}

/// How far a re-sliced point may sit from the carried line and still be the
/// same point, in metres. Wide enough for the polyline codec's rounding.
const CARRIED_LINE_TOLERANCE_M: f64 = 1.0;

fn carried_line(ground: &RecordGround) -> Option<Vec<GpsPoint>> {
    serde_json::from_str::<Vec<GpsPoint>>(ground.polyline_json.as_deref()?)
        .ok()
        .filter(|points| points.len() >= 2)
}

/// Where a restored hand-cut lands: its source ride, its half-open range when
/// the ride still indexes it, and its line.
struct CutGround {
    source: String,
    range: Option<(u32, u32)>,
    points: Vec<GpsPoint>,
}

/// A hand-cut's ground, or `None` while the source ride is not stored here
/// and the server has not answered that it is gone.
///
/// A counted triple rebuilds as it stands. An uncounted one, which is what an
/// older backup carries, is trusted only where its slice is the carried line
/// point for point. Anything else keeps the ride and takes the carried line,
/// and a triple with neither count nor line is trusted where it indexes the ride.
fn cut_line(conn: &rusqlite::Connection, ground: &RecordGround) -> Option<CutGround> {
    let source = ground
        .rep_activity_id
        .as_deref()
        .filter(|id| !id.is_empty())?;
    if let Some(((_, start, end), points)) = exact_line(conn, ground) {
        return Some(CutGround {
            source: source.to_string(),
            range: Some((start, end)),
            points,
        });
    }
    let stored: bool = conn
        .query_row(
            "SELECT 1 FROM gps_tracks WHERE activity_id = ?",
            [source],
            |_| Ok(()),
        )
        .optional()
        .ok()
        .flatten()
        .is_some();
    if !stored {
        // A ride the server no longer has never arrives, so its line is all
        // the ground the cut will ever have.
        let gone = id_set_from_conn(conn, UNAVAILABLE_KEY)
            .ok()?
            .contains(source);
        return gone
            .then(|| carried_line(ground))
            .flatten()
            .map(|points| CutGround {
                source: source.to_string(),
                range: None,
                points,
            });
    }
    let Some(carried) = carried_line(ground) else {
        // A `.veloq` file kept only the triple, so with no count and no line a
        // slice that indexes the stored ride is all the ground it can name.
        if ground.point_count.is_some() {
            return None;
        }
        let reference = ground_reference(ground)?;
        let points = sections::geometry::rebuild(conn, reference)?;
        return Some(CutGround {
            source: source.to_string(),
            range: Some((reference.1, reference.2)),
            points,
        });
    };
    if ground.point_count.is_none()
        && let Some(reference) = ground_reference(ground)
        && let Some(slice) = sections::geometry::rebuild(conn, reference)
        && slice.len() == carried.len()
        && slice.iter().zip(&carried).all(|(a, b)| {
            tracematch::geo_utils::haversine_distance(a, b) <= CARRIED_LINE_TOLERANCE_M
        })
    {
        return Some(CutGround {
            source: source.to_string(),
            range: Some((reference.1, reference.2)),
            points: slice,
        });
    }
    Some(CutGround {
        source: source.to_string(),
        range: None,
        points: carried,
    })
}

fn ground_line(conn: &rusqlite::Connection, ground: &RecordGround) -> Option<Vec<GpsPoint>> {
    exact_line(conn, ground)
        .map(|(_, points)| points)
        .or_else(|| carried_line(ground))
}

fn store_restored_geometry(
    conn: &rusqlite::Connection,
    section_id: &str,
    imported_version: i64,
    ground: &RecordGround,
    points: &[GpsPoint],
) -> Result<i64, String> {
    let mut stmt = conn
        .prepare("SELECT version, blob FROM section_geometry WHERE section_id = ? ORDER BY version")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([section_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, Vec<u8>>(1)?))
        })
        .map_err(|e| e.to_string())?;
    let mut occupied = false;
    let mut maximum = 0;
    let mut matching = None;
    for row in rows {
        let (version, blob) = row.map_err(|e| e.to_string())?;
        maximum = maximum.max(version);
        occupied |= version == imported_version;
        if codec::decode_polyline(&blob).as_deref() == Some(points) {
            matching = Some(version);
            if version == imported_version {
                break;
            }
        }
    }
    drop(stmt);
    if let Some(version) = matching {
        return Ok(version);
    }
    let version = if occupied {
        maximum + 1
    } else {
        imported_version
    };
    let reference = ground_reference(ground);
    let source = if exact_line(conn, ground).is_some() {
        "exact"
    } else if reference.is_some() {
        "orphaned"
    } else {
        "consensus"
    };
    conn.execute(
        "INSERT INTO section_geometry (section_id, version, encoding, blob, milestone,
             rep_activity_id, rep_start_index, rep_end_index, source, point_count)
         VALUES (?1, ?2, 1, ?3, 1, ?4, ?5, ?6, ?7, ?8)",
        params![
            section_id,
            version,
            codec::encode_polyline(points),
            reference.map(|r| r.0),
            reference.map(|r| r.1),
            reference.map(|r| r.2),
            source,
            ground.point_count
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(version)
}

/// The local route group a restored route decision belongs to, by membership.
///
/// A group holding the old representative wins, since that ride defined the
/// route the athlete named. Otherwise the group sharing the most of the old
/// members does, ties to the lowest id. No shared member means no ground here
/// yet, and the decision waits.
fn route_group(conn: &Connection, ground: &RecordGround) -> Result<Option<String>, String> {
    let representative = ground.rep_activity_id.as_deref();
    let mut members: BTreeSet<&str> = ground
        .activity_ids
        .iter()
        .flatten()
        .map(String::as_str)
        .collect();
    members.extend(representative);
    if members.is_empty() {
        return Ok(None);
    }
    let mut stmt = conn
        .prepare(
            "SELECT id, representative_id, activity_ids, activity_ids_blob FROM route_groups
             ORDER BY id",
        )
        .map_err(|e| e.to_string())?;
    let groups = stmt
        .query_map([], |row| {
            let id: String = row.get(0)?;
            let mut local = super::routes::decode_activity_ids(row, &id, 2, 3)?;
            local.push(row.get(1)?);
            Ok((id, local))
        })
        .map_err(|e| e.to_string())?;
    let mut best: Option<(bool, usize, String)> = None;
    for group in groups {
        let Ok((id, local)) = group else { continue };
        let holds_representative = representative.is_some_and(|rep| local.iter().any(|a| a == rep));
        let shared = local
            .iter()
            .map(String::as_str)
            .collect::<BTreeSet<_>>()
            .intersection(&members)
            .count();
        if shared == 0 {
            continue;
        }
        if best
            .as_ref()
            .is_none_or(|(rep, count, _)| (holds_representative, shared) > (*rep, *count))
        {
            best = Some((holds_representative, shared, id));
        }
    }
    Ok(best.map(|(_, _, id)| id))
}

#[derive(Clone, Copy)]
enum MatchScope {
    Any,
    Custom,
    UserAuto,
    Auto,
}

fn matching_section(
    conn: &rusqlite::Connection,
    footprint: &[GpsPoint],
    scope: MatchScope,
) -> Result<Option<String>, String> {
    let core = trim_core(footprint);
    let mut stmt = conn
        .prepare(
            "SELECT id, polyline_blob, polyline_json, created_at FROM sections
         WHERE disabled = 0 AND (?1 = 0 OR (?1 = 1 AND section_type = 'custom')
             OR (?1 = 2 AND section_type = 'auto' AND is_user_defined = 1)
             OR (?1 = 3 AND section_type = 'auto'))",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(
            [match scope {
                MatchScope::Any => 0,
                MatchScope::Custom => 1,
                MatchScope::UserAuto => 2,
                MatchScope::Auto => 3,
            }],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<Vec<u8>>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;
    let mut candidates = Vec::new();
    for row in rows {
        let (id, blob, json, created_at) = row.map_err(|e| e.to_string())?;
        let Ok(line) = codec::decode_polyline_row(blob.as_deref(), json.as_deref()) else {
            continue;
        };
        let Some(score) = score_named_candidate(&core, footprint, &line) else {
            continue;
        };
        candidates.push((id, created_at, score));
    }
    let scored: Vec<NamedCandidate> = candidates
        .iter()
        .map(|(id, created_at, score)| NamedCandidate {
            score: *score,
            created_at,
            id,
        })
        .collect();
    Ok(select_candidate(&scored).map(|(index, _)| candidates[index].0.clone()))
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use tempfile::TempDir;
    use tracematch::GpsPoint;

    use super::PersistentEngine;

    fn ride() -> Vec<GpsPoint> {
        (0..80)
            .map(|i| GpsPoint {
                latitude: 46.2 + f64::from(i) * 0.000_09,
                longitude: 7.36 + f64::from(i) * 0.000_11,
                elevation: None,
            })
            .collect()
    }

    #[test]
    fn test_restore_pin_waits_for_its_activity_and_then_places_on_local_ground() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("restore.db").to_str().unwrap()).unwrap();
        let line = ride();
        let payload = json!({
            "version": 1,
            "entries": [{
                "table": "section_pins",
                "values": {"section_id": "foreign-id", "version": 7},
                "ground": {
                    "rep_activity_id": "old-ride",
                    "rep_start_index": 10,
                    "rep_end_index": 40,
                    "point_count": 80,
                    "polyline_json": serde_json::to_string(&line[10..40]).unwrap()
                }
            }]
        });
        let result = engine.restore_record_json(&payload.to_string()).unwrap();
        assert_eq!(result.unplaced, 1);
        assert_eq!(result.missing_activity_ids, ["old-ride"]);

        engine
            .add_activity("old-ride".to_string(), line, "Ride".to_string())
            .unwrap();
        engine.db.execute(
            "INSERT INTO sections (id, section_type, sport_type, polyline_json, distance_meters) VALUES ('local-id', 'auto', 'Ride', ?1, 1000)",
            [serde_json::to_string(&ride()[10..40]).unwrap()],
        ).unwrap();
        let result = engine.retry_record_restore().unwrap();
        assert_eq!(result.placed, 1);
        let pinned: (String, i64) = engine
            .db
            .query_row("SELECT section_id, version FROM section_pins", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .unwrap();
        assert_eq!(pinned, ("local-id".to_string(), 7));
        let line_blob: Vec<u8> = engine
            .db
            .query_row(
                "SELECT blob FROM section_geometry WHERE section_id = 'local-id' AND version = 7",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let stored = engine.get_gps_track("old-ride").unwrap();
        assert_eq!(
            crate::persistence::codec::decode_polyline(&line_blob).unwrap(),
            stored[10..40]
        );
    }

    #[test]
    fn test_restore_forced_match_waits_for_its_ride_then_cuts_and_records_it() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("forced.db").to_str().unwrap()).unwrap();
        let line = ride();
        let section_line = line[10..40].to_vec();
        let section_id = engine
            .create_section(crate::sections::CreateSectionParams {
                sport_type: "Ride".to_string(),
                polyline: section_line.clone(),
                distance_meters: tracematch::matching::calculate_route_distance(&section_line),
                name: Some("Hill".to_string()),
                source_activity_id: None,
                start_index: None,
                end_index: None,
            })
            .unwrap();
        let payload = json!({"version": 1, "entries": [{
            "table": "section_forced_matches",
            "values": {"section_id": "foreign-id", "activity_id": "attached-ride",
                "forced_at": 1_700_000_000},
            "ground": {"polyline_json": serde_json::to_string(&section_line).unwrap()}
        }]});
        let result = engine.restore_record_json(&payload.to_string()).unwrap();
        assert_eq!(result.placed, 0);
        assert_eq!(result.unplaced, 1);
        assert_eq!(result.missing_activity_ids, ["attached-ride"]);

        engine
            .add_activity("attached-ride".to_string(), line, "Ride".to_string())
            .unwrap();
        engine
            .db
            .execute(
                "DELETE FROM section_activities WHERE activity_id = 'attached-ride'",
                [],
            )
            .unwrap();
        let result = engine.retry_record_restore().unwrap();
        assert_eq!((result.placed, result.unplaced), (1, 0));
        let record: (String, i64) = engine
            .db
            .query_row(
                "SELECT section_id, forced_at FROM section_forced_matches
                 WHERE activity_id = 'attached-ride'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(record, (section_id.clone(), 1_700_000_000));
        let rows: i64 = engine
            .db
            .query_row(
                "SELECT COUNT(*) FROM section_activities
                 WHERE section_id = ?1 AND activity_id = 'attached-ride'",
                [&section_id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(rows > 0);
    }

    fn history_payload(section_id: &str, extra: Vec<serde_json::Value>) -> serde_json::Value {
        let line = serde_json::to_string(&ride()[10..40]).unwrap();
        let mut entries = vec![json!({
            "table": "section_history",
            "values": {"section_id": section_id, "at": "2025-01-01 00:00:00",
                "kind": "dissolved", "details": "{}"},
            "ground": {"polyline_json": line}
        })];
        entries.extend(extra);
        json!({"version": 1, "entries": entries})
    }

    fn history_rows(engine: &PersistentEngine) -> i64 {
        engine
            .db
            .query_row("SELECT COUNT(*) FROM section_history", [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn test_history_without_a_section_is_kept_until_detection_settles() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("history-wait.db").to_str().unwrap()).unwrap();
        let payload = history_payload("gone-id", vec![]);
        let result = engine.restore_record_json(&payload.to_string()).unwrap();
        assert_eq!(
            (result.placed, result.unplaced, result.not_restored),
            (0, 1, 0)
        );
        assert_eq!(engine.retry_record_restore().unwrap().not_restored, 0);
        assert_eq!(pending_rows(&engine), 1);
    }

    #[test]
    fn test_settled_detection_reports_history_with_no_section_as_not_restored() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("history-drop.db").to_str().unwrap()).unwrap();
        let payload = history_payload("gone-id", vec![]);
        engine.restore_record_json(&payload.to_string()).unwrap();
        let result = engine.settle_record_restore().unwrap();
        assert_eq!((result.unplaced, result.not_restored), (0, 1));
        assert_eq!(pending_rows(&engine), 0);
        assert_eq!(history_rows(&engine), 0);
        assert_eq!(engine.not_restored_history_count().unwrap(), 1);
        assert!(engine.unplaced_records().unwrap().is_empty());
        engine.settle_record_restore().unwrap();
        assert_eq!(engine.not_restored_history_count().unwrap(), 1);
    }

    #[test]
    fn test_settled_detection_keeps_history_of_a_pinned_section_waiting() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("history-pinned.db").to_str().unwrap()).unwrap();
        let pin = json!({
            "table": "section_pins",
            "values": {"section_id": "pinned-id", "version": 1},
            "ground": {"rep_activity_id": "absent-ride", "rep_start_index": 0,
                "rep_end_index": 20, "point_count": null, "polyline_json": null}
        });
        let payload = history_payload("pinned-id", vec![pin]);
        engine.restore_record_json(&payload.to_string()).unwrap();
        let result = engine.settle_record_restore().unwrap();
        assert_eq!(result.not_restored, 0);
        assert_eq!(pending_rows(&engine), 2);
    }

    #[test]
    fn test_restore_forced_match_without_a_matching_section_stays_waiting() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("forced-none.db").to_str().unwrap()).unwrap();
        let line = ride();
        engine
            .add_activity(
                "attached-ride".to_string(),
                line.clone(),
                "Ride".to_string(),
            )
            .unwrap();
        let payload = json!({"version": 1, "entries": [{
            "table": "section_forced_matches",
            "values": {"section_id": "foreign-id", "activity_id": "attached-ride",
                "forced_at": 1_700_000_000},
            "ground": {"polyline_json": serde_json::to_string(&line[10..40]).unwrap()}
        }]});
        let result = engine.restore_record_json(&payload.to_string()).unwrap();
        assert_eq!((result.placed, result.unplaced), (0, 1));
        let kept: i64 = engine
            .db
            .query_row("SELECT COUNT(*) FROM section_forced_matches", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(kept, 0);
    }

    #[test]
    fn test_restore_pin_builds_durable_section_without_detection() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("pin-only.db").to_str().unwrap()).unwrap();
        engine
            .add_activity("old-ride".to_string(), ride(), "Ride".to_string())
            .unwrap();
        let stored = engine.get_gps_track("old-ride").unwrap();
        let payload = json!({"version": 1, "entries": [{
            "table": "section_pins", "values": {"section_id": "foreign-id", "version": 7},
            "ground": {"rep_activity_id": "old-ride", "rep_start_index": 10,
                "rep_end_index": 40, "point_count": 80,
                "polyline_json": serde_json::to_string(&stored[10..40]).unwrap()}
        }]});
        assert_eq!(
            engine
                .restore_record_json(&payload.to_string())
                .unwrap()
                .placed,
            1
        );
        let (id, kind, durable, version): (String, String, i64, i64) = engine
            .db
            .query_row(
                "SELECT s.id, s.section_type, s.is_user_defined, p.version
             FROM sections s JOIN section_pins p ON p.section_id = s.id",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_ne!(id, "foreign-id");
        assert_eq!((kind.as_str(), durable, version), ("auto", 1, 7));
        assert_eq!(engine.stored_section_polyline(&id).unwrap(), stored[10..40]);
        let (activity, start, end, blob): (String, u32, u32, Vec<u8>) = engine
            .db
            .query_row(
                "SELECT rep_activity_id, rep_start_index, rep_end_index, blob
             FROM section_geometry WHERE section_id = ? AND version = 7",
                [&id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!((activity.as_str(), start, end), ("old-ride", 10, 40));
        assert_eq!(
            crate::persistence::codec::decode_polyline(&blob).unwrap(),
            stored[10..40]
        );
        assert_eq!(
            engine
                .restore_record_json(&payload.to_string())
                .unwrap()
                .unplaced,
            0
        );
        let section_count: i64 = engine
            .db
            .query_row("SELECT COUNT(*) FROM sections", [], |r| r.get(0))
            .unwrap();
        assert_eq!(section_count, 1);
    }

    #[test]
    fn test_restore_named_intent_reports_dormancy_until_ground_exists() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("names.db").to_str().unwrap()).unwrap();
        let line = serde_json::to_string(&ride()[10..40]).unwrap();
        engine
            .db
            .execute(
                "INSERT INTO section_intents (id, kind, polyline_json, name, sport_type)
             VALUES ('local-name', 'named', ?1, 'Existing name', 'Ride')",
                [line.clone()],
            )
            .unwrap();
        let payload = json!({
            "version": 1,
            "entries": [{
                "table": "section_intents",
                "values": {"id": "foreign-id", "kind": "named", "name": "Morning climb",
                    "sport_type": "Ride", "polyline_json": line}
            }]
        });
        let result = engine.restore_record_json(&payload.to_string()).unwrap();
        assert_eq!(result.unplaced, 1);
        assert_eq!(engine.unplaced_records().unwrap().len(), 1);
        assert_eq!(
            engine.unplaced_records().unwrap()[0].name.as_deref(),
            Some("Morning climb")
        );
        engine.db.execute(
            "INSERT INTO sections (id, section_type, sport_type, polyline_json, distance_meters)
             VALUES ('local-id', 'auto', 'Ride', ?1, 1000)",
            [serde_json::to_string(&ride()[10..40]).unwrap()],
        ).unwrap();
        assert!(engine.unplaced_records().unwrap().is_empty());
    }

    #[test]
    fn test_restore_ledger_waits_outside_retired_sections_then_rekeys_by_ground() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("ledger.db").to_str().unwrap()).unwrap();
        let payload = json!({
            "version": 1,
            "entries": [{
                "table": "section_history",
                "values": {"section_id": "foreign-id", "at": "2025-01-01 00:00:00",
                    "kind": "dissolved", "details": "{}", "geometry_version": 2},
                "ground": {"rep_activity_id": null, "rep_start_index": null,
                    "rep_end_index": null, "point_count": null,
                    "polyline_json": serde_json::to_string(&ride()[10..40]).unwrap()}
            }]
        });
        let result = engine.restore_record_json(&payload.to_string()).unwrap();
        assert_eq!(result.unplaced, 1);
        let ghost_count: i64 = engine
            .db
            .query_row("SELECT COUNT(*) FROM section_history", [], |r| r.get(0))
            .unwrap();
        assert_eq!(ghost_count, 0);
        engine.db.execute(
            "INSERT INTO sections (id, section_type, sport_type, polyline_json, distance_meters)
             VALUES ('local-id', 'auto', 'Ride', ?1, 1000)",
            [serde_json::to_string(&ride()[10..40]).unwrap()],
        ).unwrap();
        assert_eq!(engine.retry_record_restore().unwrap().placed, 1);
        let local_id: String = engine
            .db
            .query_row("SELECT section_id FROM section_history", [], |r| r.get(0))
            .unwrap();
        assert_eq!(local_id, "local-id");
    }

    #[test]
    fn test_restore_fetches_activities_named_by_a_placed_ledger_row() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("ledger-ids.db").to_str().unwrap()).unwrap();
        engine
            .add_activity("recent".to_string(), ride(), "Ride".to_string())
            .unwrap();
        let line = serde_json::to_string(&ride()[10..40]).unwrap();
        engine.db.execute(
            "INSERT INTO sections (id, section_type, sport_type, polyline_json, distance_meters)
             VALUES ('local-id', 'auto', 'Ride', ?1, 1000)", [&line]
        ).unwrap();
        let details = json!({
            "pr_activity_id": "old-pr",
            "around": ["recent", "old-around"],
            "fork_around": ["old-fork"],
            "activity_ids": ["old-legacy", "old-pr"],
            "split_from": "foreign-section"
        })
        .to_string();
        let payload = json!({"version": 1, "entries": [{
            "table": "section_history",
            "values": {"section_id": "foreign-section", "at": "2025-01-01 00:00:00",
                "kind": "recut", "details": details, "geometry_version": null},
            "ground": {"rep_activity_id": null, "rep_start_index": null,
                "rep_end_index": null, "point_count": null, "polyline_json": line}
        }]});
        let result = engine.restore_record_json(&payload.to_string()).unwrap();
        assert_eq!(result.placed, 1);
        assert_eq!(result.unplaced, 0);
        assert_eq!(
            result.missing_activity_ids,
            ["old-around", "old-fork", "old-legacy", "old-pr"]
        );
    }

    #[test]
    fn test_restore_pin_does_not_reuse_a_local_version_for_other_ground() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("versions.db").to_str().unwrap()).unwrap();
        engine
            .add_activity("old-ride".to_string(), ride(), "Ride".to_string())
            .unwrap();
        let stored = engine.get_gps_track("old-ride").unwrap();
        let local_line = serde_json::to_string(&stored[10..40]).unwrap();
        engine.db.execute(
            "INSERT INTO sections (id, section_type, sport_type, polyline_json, distance_meters)
             VALUES ('local-id', 'auto', 'Ride', ?1, 1000)", [local_line.clone()]
        ).unwrap();
        let other_blob = crate::persistence::codec::encode_polyline(&stored[40..70]);
        engine.db.execute(
            "INSERT INTO section_geometry (section_id, version, blob) VALUES ('local-id', 7, ?1)",
            [other_blob]
        ).unwrap();
        let payload = json!({
            "version": 1,
            "entries": [{
                "table": "section_pins", "values": {"section_id": "foreign-id", "version": 7},
                "ground": {"rep_activity_id": "old-ride", "rep_start_index": 10,
                    "rep_end_index": 40, "point_count": 80, "polyline_json": local_line}
            }]
        });
        assert_eq!(
            engine
                .restore_record_json(&payload.to_string())
                .unwrap()
                .placed,
            1
        );
        let version: i64 = engine
            .db
            .query_row(
                "SELECT version FROM section_pins WHERE section_id = 'local-id'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let line_blob: Vec<u8> = engine
            .db
            .query_row(
                "SELECT blob FROM section_geometry WHERE section_id = 'local-id' AND version = ?",
                [version],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            crate::persistence::codec::decode_polyline(&line_blob).unwrap(),
            stored[10..40]
        );
    }

    #[test]
    fn test_restore_custom_cut_waits_for_source_then_uses_its_slice() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("cuts.db").to_str().unwrap()).unwrap();
        let payload = json!({
            "version": 1,
            "entries": [{
                "table": "sections",
                "values": {"id": "foreign-cut", "section_type": "custom", "sport_type": "Ride",
                    "name": "My climb", "distance_meters": 1000},
                "ground": {"rep_activity_id": "old-ride", "rep_start_index": 10,
                    "rep_end_index": 40, "point_count": 80, "polyline_json": null}
            }]
        });
        assert_eq!(
            engine
                .restore_record_json(&payload.to_string())
                .unwrap()
                .unplaced,
            1
        );
        engine
            .add_activity("old-ride".to_string(), ride(), "Ride".to_string())
            .unwrap();
        assert_eq!(engine.retry_record_restore().unwrap().placed, 1);
        let (id, start, end): (String, u32, u32) = engine
            .db
            .query_row(
                "SELECT id, start_index, end_index FROM sections WHERE section_type = 'custom'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_ne!(id, "foreign-cut");
        assert_eq!((start, end), (10, 39));
        assert_eq!(
            engine.stored_section_polyline(&id).unwrap(),
            engine.get_gps_track("old-ride").unwrap()[10..40]
        );
    }

    #[test]
    fn test_restore_refuses_future_version_and_other_athlete_before_writing() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("guard.db").to_str().unwrap()).unwrap();
        engine.set_setting("__athlete_id", "athlete-one").unwrap();
        let rows = json!([{"table": "settings", "values": {"key": "units", "value": "miles"}}]);
        assert!(
            engine
                .restore_record_json(
                    &json!({
                        "version": 2, "athlete_id": "athlete-one", "entries": rows
                    })
                    .to_string()
                )
                .is_err()
        );
        assert!(
            engine
                .restore_record_json(
                    &json!({
                        "version": 1, "athlete_id": "athlete-two", "entries": rows
                    })
                    .to_string()
                )
                .is_err()
        );
        assert_eq!(engine.get_setting("units").unwrap(), None);
        assert!(engine.unplaced_records().unwrap().is_empty());
    }

    #[test]
    fn test_restore_trimmed_auto_section_keeps_undo_geometry() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("trim.db").to_str().unwrap()).unwrap();
        let original = serde_json::to_string(&ride()[10..40]).unwrap();
        let trimmed = serde_json::to_string(&ride()[15..35]).unwrap();
        let payload = json!({
            "version": 1,
            "entries": [{
                "table": "sections",
                "values": {"id": "foreign-trim", "section_type": "auto", "sport_type": "Ride",
                    "is_user_defined": 1, "original_polyline_json": original,
                    "distance_meters": 700.0},
                "ground": {"rep_activity_id": null, "rep_start_index": null,
                    "rep_end_index": null, "point_count": null, "polyline_json": trimmed}
            }]
        });
        assert_eq!(
            engine
                .restore_record_json(&payload.to_string())
                .unwrap()
                .placed,
            1
        );
        type Placed = (String, String, i64, Vec<u8>, Option<String>);
        let (id, kind, edited, undo, undo_json): Placed = engine
            .db
            .query_row(
                "SELECT id, section_type, is_user_defined, original_polyline_blob,
                        original_polyline_json FROM sections",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .unwrap();
        assert_ne!(id, "foreign-trim");
        assert_eq!((kind.as_str(), edited), ("auto", 1));
        assert_eq!(undo_json, None, "the undo line is stored as a blob");
        assert_eq!(
            crate::persistence::codec::deserialize_points(&undo).unwrap(),
            crate::persistence::codec::deserialize_points(
                &crate::persistence::codec::serialize_track_points(&ride()[10..40])
            )
            .unwrap()
        );
        assert!(engine.has_original_bounds(&id));
    }

    #[test]
    fn test_restore_history_rekeys_colliding_geometry_version() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("history-version.db").to_str().unwrap()).unwrap();
        let line = serde_json::to_string(&ride()[10..40]).unwrap();
        engine.db.execute(
            "INSERT INTO sections (id, section_type, sport_type, polyline_json, distance_meters)
             VALUES ('local-id', 'auto', 'Ride', ?1, 1000)", [line.clone()]
        ).unwrap();
        engine.db.execute(
            "INSERT INTO section_geometry (section_id, version, blob) VALUES ('local-id', 7, ?1)",
            [crate::persistence::codec::encode_polyline(&ride()[40..70])]
        ).unwrap();
        let payload = json!({"version": 1, "entries": [{
            "table": "section_history",
            "values": {"section_id": "foreign-id", "at": "2025-01-01 00:00:00",
                "kind": "recut", "details": "{}", "geometry_version": 7},
            "ground": {"rep_activity_id": null, "rep_start_index": null,
                "rep_end_index": null, "point_count": null, "polyline_json": line}
        }]});
        assert_eq!(
            engine
                .restore_record_json(&payload.to_string())
                .unwrap()
                .placed,
            1
        );
        let version: i64 = engine
            .db
            .query_row(
                "SELECT geometry_version FROM section_history WHERE section_id = 'local-id'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_ne!(version, 7);
        let blob: Vec<u8> = engine
            .db
            .query_row(
                "SELECT blob FROM section_geometry WHERE section_id = 'local-id' AND version = ?",
                [version],
                |r| r.get(0),
            )
            .unwrap();
        let expected: Vec<GpsPoint> =
            serde_json::from_str(&serde_json::to_string(&ride()[10..40]).unwrap()).unwrap();
        let canonical = crate::persistence::codec::decode_polyline(
            &crate::persistence::codec::encode_polyline(&expected),
        )
        .unwrap();
        assert_eq!(
            crate::persistence::codec::decode_polyline(&blob).unwrap(),
            canonical
        );
    }

    fn custom_cut(engine: &PersistentEngine) -> (String, u32, u32) {
        engine
            .db
            .query_row(
                "SELECT id, start_index, end_index FROM sections WHERE section_type = 'custom'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap()
    }

    #[test]
    fn test_live_hand_cut_backed_up_restores_its_range_on_a_fresh_library() {
        let dir = TempDir::new().unwrap();
        let mut source =
            PersistentEngine::new(dir.path().join("source.db").to_str().unwrap()).unwrap();
        source
            .add_activity("ride-1".to_string(), ride(), "Ride".to_string())
            .unwrap();
        let track = source.get_gps_track("ride-1").unwrap();
        source
            .create_section(crate::sections::CreateSectionParams {
                sport_type: "Ride".to_string(),
                polyline: track[10..41].to_vec(),
                distance_meters: 1000.0,
                name: Some("My climb".to_string()),
                source_activity_id: Some("ride-1".to_string()),
                start_index: Some(10),
                end_index: Some(40),
            })
            .unwrap();
        let payload =
            crate::persistence::record_backup::collect_record_payload(&source.db).unwrap();

        let mut restored =
            PersistentEngine::new(dir.path().join("restored.db").to_str().unwrap()).unwrap();
        restored
            .add_activity("ride-1".to_string(), ride(), "Ride".to_string())
            .unwrap();
        let result = restored
            .restore_record_json(&serde_json::to_string(&payload).unwrap())
            .unwrap();
        assert_eq!(result.unplaced, 0);
        let (id, start, end) = custom_cut(&restored);
        assert_eq!((start, end), (10, 40));
        assert_eq!(
            restored.stored_section_polyline(&id).unwrap(),
            track[10..41]
        );
    }

    #[test]
    fn test_schema_12_hand_cut_converted_restores_its_range() {
        let dir = TempDir::new().unwrap();
        let legacy_path = dir.path().join("released.db");
        let record_path = dir.path().join("record.zip");
        let mut legacy = rusqlite::Connection::open(&legacy_path).unwrap();
        PersistentEngine::migrations()
            .to_version(&mut legacy, 12)
            .unwrap();
        let line = serde_json::to_string(&ride()[2..9]).unwrap();
        legacy
            .execute(
                "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                     distance_meters, source_activity_id, start_index, end_index)
                 VALUES ('old-cut', 'custom', 'Hill', 'Ride', ?1, 100, 'ride-1', 2, 8)",
                [line],
            )
            .unwrap();
        drop(legacy);
        crate::persistence::record_backup::convert_legacy_database(
            legacy_path.to_str().unwrap(),
            record_path.to_str().unwrap(),
        )
        .unwrap();
        let payload =
            crate::persistence::record_backup::read_record_zip(record_path.to_str().unwrap())
                .unwrap();

        let mut restored =
            PersistentEngine::new(dir.path().join("restored.db").to_str().unwrap()).unwrap();
        restored
            .add_activity("ride-1".to_string(), ride(), "Ride".to_string())
            .unwrap();
        let result = restored
            .restore_record_json(&serde_json::to_string(&payload).unwrap())
            .unwrap();
        assert_eq!(result.unplaced, 0);
        let (id, start, end) = custom_cut(&restored);
        assert_eq!((start, end), (2, 8));
        assert_eq!(
            restored.stored_section_polyline(&id).unwrap(),
            restored.get_gps_track("ride-1").unwrap()[2..9]
        );
    }

    /// The entry `convertLegacyBackupToRecord` writes for a `.veloq` custom
    /// section: a half-open triple with neither a point count nor a line.
    fn legacy_json_cut(end: u32) -> String {
        json!({"version": 1, "athlete_id": null, "entries": [{
            "table": "sections",
            "values": {"name": "Hill", "sport_type": "Ride", "section_type": "custom",
                "source_activity_id": "ride-1", "start_index": 12, "end_index": end - 1},
            "ground": {"rep_activity_id": "ride-1", "rep_start_index": 12,
                "rep_end_index": end, "point_count": null, "polyline_json": null}
        }]})
        .to_string()
    }

    #[test]
    fn test_legacy_json_cut_lands_once_its_ride_is_stored() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("veloq-json.db").to_str().unwrap()).unwrap();
        let payload = legacy_json_cut(49);
        assert_eq!(
            engine.restore_record_json(&payload).unwrap().unplaced,
            1,
            "the ride may still arrive by id"
        );

        engine
            .add_activity("ride-1".to_string(), ride(), "Ride".to_string())
            .unwrap();
        assert_eq!(engine.retry_record_restore().unwrap().unplaced, 0);
        let (id, start, end) = custom_cut(&engine);
        assert_eq!((start, end), (12, 48));
        assert_eq!(
            engine.stored_section_polyline(&id).unwrap(),
            engine.get_gps_track("ride-1").unwrap()[12..49]
        );

        assert_eq!(engine.restore_record_json(&payload).unwrap().unplaced, 0);
        let cuts: i64 = engine
            .db
            .query_row(
                "SELECT COUNT(*) FROM sections WHERE section_type = 'custom'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cuts, 1, "a second import of the same file adds no cut");
    }

    #[test]
    fn test_restored_cut_keeps_a_name_another_section_already_shows() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("name-clash.db").to_str().unwrap()).unwrap();
        engine
            .add_activity("ride-1".to_string(), ride(), "Ride".to_string())
            .unwrap();
        let existing = engine
            .create_section(crate::sections::CreateSectionParams {
                sport_type: "Ride".to_string(),
                polyline: ride()[60..70].to_vec(),
                distance_meters: 100.0,
                name: Some("Section 7".to_string()),
                source_activity_id: Some("ride-1".to_string()),
                start_index: Some(60),
                end_index: Some(69),
            })
            .unwrap();

        let payload = legacy_json_cut(49).replace("Hill", "Section 7");
        let result = engine.restore_record_json(&payload).unwrap();
        assert_eq!(result.unplaced, 0);

        let names: Vec<(String, Option<String>)> = engine
            .db
            .prepare("SELECT id, name FROM sections WHERE section_type = 'custom'")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(
            names.len(),
            2,
            "the restored cut lands beside the existing one"
        );
        assert!(names.iter().any(|(id, _)| *id == existing));
        assert!(
            names
                .iter()
                .all(|(_, name)| name.as_deref() == Some("Section 7"))
        );
    }

    #[test]
    fn test_legacy_json_cut_past_its_ride_stays_unplaced() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("veloq-json-range.db").to_str().unwrap())
                .unwrap();
        engine
            .add_activity("ride-1".to_string(), ride(), "Ride".to_string())
            .unwrap();
        let result = engine.restore_record_json(&legacy_json_cut(81)).unwrap();
        assert_eq!(
            result.unplaced, 1,
            "a range the ride cannot hold names no line"
        );
        let cuts: i64 = engine
            .db
            .query_row(
                "SELECT COUNT(*) FROM sections WHERE section_type = 'custom'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cuts, 0);
    }

    #[test]
    fn test_hand_cut_whose_source_is_gone_lands_by_its_line() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("gone-cut.db").to_str().unwrap()).unwrap();
        let line = ride()[10..40].to_vec();
        let payload = json!({"version": 1, "entries": [{
            "table": "sections",
            "values": {"id": "foreign-cut", "section_type": "custom", "sport_type": "Ride",
                "name": "My climb", "distance_meters": 1000},
            "ground": {"rep_activity_id": "gone-ride", "rep_start_index": 10,
                "rep_end_index": 40, "point_count": 80,
                "polyline_json": serde_json::to_string(&line).unwrap()}
        }]});
        let waiting = engine.restore_record_json(&payload.to_string()).unwrap();
        assert_eq!(waiting.unplaced, 1, "the source may still arrive");

        engine
            .mark_record_activity_unavailable("gone-ride")
            .unwrap();
        assert_eq!(engine.retry_record_restore().unwrap().unplaced, 0);
        let (id, source): (String, String) = engine
            .db
            .query_row(
                "SELECT id, source_activity_id FROM sections WHERE section_type = 'custom'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(source, "gone-ride");
        assert_eq!(
            engine.stored_section_polyline(&id).unwrap().len(),
            line.len()
        );
    }

    #[test]
    fn test_ledger_row_keeps_the_line_of_the_version_it_names() {
        let dir = TempDir::new().unwrap();
        let mut source =
            PersistentEngine::new(dir.path().join("ledger-version.db").to_str().unwrap()).unwrap();
        source
            .add_activity("ride-1".to_string(), ride(), "Ride".to_string())
            .unwrap();
        let track = source.get_gps_track("ride-1").unwrap();
        let id = source
            .create_section(crate::sections::CreateSectionParams {
                sport_type: "Ride".to_string(),
                polyline: track[10..41].to_vec(),
                distance_meters: 1000.0,
                name: Some("My climb".to_string()),
                source_activity_id: Some("ride-1".to_string()),
                start_index: Some(10),
                end_index: Some(40),
            })
            .unwrap();
        let older = track[20..60].to_vec();
        source
            .db
            .execute(
                "INSERT INTO section_geometry (section_id, version, encoding, blob, milestone)
                 VALUES (?1, 1, 1, ?2, 1)",
                rusqlite::params![&id, crate::persistence::codec::encode_polyline(&older)],
            )
            .unwrap();
        source
            .db
            .execute(
                "INSERT INTO section_history (section_id, at, kind, details, geometry_version)
                 VALUES (?1, '2025-01-01 00:00:00', 'recut', '{}', 1)",
                [&id],
            )
            .unwrap();
        let payload =
            crate::persistence::record_backup::collect_record_payload(&source.db).unwrap();
        let ledger = payload
            .entries
            .iter()
            .find(|row| row.table == "section_history")
            .unwrap();
        let carried: Vec<GpsPoint> = serde_json::from_str(
            ledger
                .ground
                .as_ref()
                .unwrap()
                .polyline_json
                .as_deref()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(carried.len(), older.len());
        assert!(ledger.ground.as_ref().unwrap().rep_activity_id.is_none());
    }

    /// A library whose cutover retired `old-climb` over `ride-1`'s 10..40,
    /// with its own registry and a tombstone for that id, backed up.
    fn archived_state_payload(dir: &TempDir) -> serde_json::Value {
        let mut source =
            PersistentEngine::new(dir.path().join("archived-source.db").to_str().unwrap()).unwrap();
        source
            .add_activity("ride-1".to_string(), ride(), "Ride".to_string())
            .unwrap();
        let track = source.get_gps_track("ride-1").unwrap();
        let version = crate::persistence::sections::history::record_archived_geometry_on(
            &source.db,
            "old-climb",
            &track[10..40],
            Some(("ride-1", 10, 40)),
        )
        .unwrap();
        crate::persistence::sections::history::append_history_on(
            &source.db,
            "old-climb",
            crate::persistence::sections::KIND_ARCHIVED,
            Some("{\"token\":\"cutover-1\",\"name\":\"Old climb\",\"sport_type\":\"Ride\"}"),
            version,
            Some("2025-03-01 00:00:00"),
        )
        .unwrap();
        source
            .db
            .execute(
                "INSERT INTO identity_state (key, blob) VALUES ('section_identity', X'01')",
                [],
            )
            .unwrap();
        let mut payload = serde_json::to_value(
            crate::persistence::record_backup::collect_record_payload(&source.db).unwrap(),
        )
        .unwrap();
        // A file written by another build may still carry the registry by its
        // old ids, with the tombstone that would block this library's mint.
        payload["entries"].as_array_mut().unwrap().push(json!({
            "table": "identity_state",
            "values": {"key": "section_identity", "tombstones": ["old-climb"]},
            "ground": null
        }));
        payload
    }

    fn ledger_ids(engine: &PersistentEngine) -> Vec<(String, String)> {
        let mut stmt = engine
            .db
            .prepare("SELECT section_id, kind FROM section_history ORDER BY id")
            .unwrap();
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    }

    #[test]
    fn test_archived_state_restores_by_ground_and_pins_without_old_identity() {
        let dir = TempDir::new().unwrap();
        let payload = archived_state_payload(&dir);

        let mut restored =
            PersistentEngine::new(dir.path().join("archived-new.db").to_str().unwrap()).unwrap();
        restored
            .add_activity("ride-1".to_string(), ride(), "Ride".to_string())
            .unwrap();
        restored
            .db
            .execute(
                "INSERT INTO sections (id, section_type, sport_type, polyline_json, distance_meters)
                 VALUES ('here-climb', 'auto', 'Ride', ?1, 1000)",
                [serde_json::to_string(&ride()[10..40]).unwrap()],
            )
            .unwrap();
        let result = restored.restore_record_json(&payload.to_string()).unwrap();

        assert_eq!(result.unplaced, 0);
        assert_eq!(
            ledger_ids(&restored),
            [("here-climb".to_string(), "archived".to_string())]
        );
        let version: i64 = restored
            .db
            .query_row(
                "SELECT geometry_version FROM section_history WHERE kind = 'archived'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(
            restored
                .pin_section_geometry("here-climb", version)
                .unwrap()
        );
        assert_eq!(restored.pinned_section_version("here-climb"), Some(version));
        let imported_identity: i64 = restored
            .db
            .query_row(
                "SELECT COUNT(*) FROM identity_state WHERE key = 'section_identity'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(imported_identity, 0);
        assert_eq!(pending_rows(&restored), 0);
        let next = crate::persistence::record_backup::collect_record_payload(&restored.db).unwrap();
        assert!(!next.entries.iter().any(|row| row.table == "identity_state"));
    }

    #[test]
    fn test_archived_state_without_its_ground_stays_dormant_and_not_retired() {
        let dir = TempDir::new().unwrap();
        let payload = archived_state_payload(&dir);

        let mut restored =
            PersistentEngine::new(dir.path().join("archived-empty.db").to_str().unwrap()).unwrap();
        let result = restored.restore_record_json(&payload.to_string()).unwrap();

        assert_eq!(result.unplaced, 1);
        assert_eq!(result.missing_activity_ids, ["ride-1"]);
        assert!(ledger_ids(&restored).is_empty());
        assert!(restored.retired_sections().is_empty());
        assert_eq!(pending_rows(&restored), 1);
        let next = crate::persistence::record_backup::collect_record_payload(&restored.db).unwrap();
        assert!(next.entries.iter().any(|row| row.table == "section_history"
            && row.values.get("kind").and_then(|k| k.as_str()) == Some("archived")));
    }

    #[test]
    fn test_archived_state_with_a_ride_and_no_section_rolls_back_into_a_live_section() {
        let dir = TempDir::new().unwrap();
        let payload = archived_state_payload(&dir);

        let mut restored =
            PersistentEngine::new(dir.path().join("archived-rollback.db").to_str().unwrap())
                .unwrap();
        restored
            .add_activity("ride-1".to_string(), ride(), "Ride".to_string())
            .unwrap();
        let result = restored.restore_record_json(&payload.to_string()).unwrap();
        assert_eq!(result.unplaced, 1);
        assert_eq!(pending_rows(&restored), 1);

        let retired = restored.retired_sections();
        assert_eq!(retired.len(), 1);
        let (section_id, version) = (retired[0].section_id.clone(), retired[0].versions[0]);
        assert_eq!(
            restored
                .section_geometry_polyline(&section_id, version)
                .unwrap(),
            restored.get_gps_track("ride-1").unwrap()[10..40].to_vec()
        );

        restored
            .revert_section_to_version(&section_id, version)
            .unwrap();

        let (name, count): (Option<String>, i64) = restored
            .db
            .query_row(
                "SELECT name, (SELECT COUNT(*) FROM sections) FROM sections WHERE id = ?",
                [&section_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(name.as_deref(), Some("Old climb"));
        assert_eq!(count, 1);
        assert_eq!(restored.pinned_section_version(&section_id), Some(version));
        assert_eq!(pending_rows(&restored), 0);
        assert!(restored.retired_sections().is_empty());
    }

    #[test]
    fn test_archived_state_whose_ground_is_absent_is_not_offered_as_retired() {
        let dir = TempDir::new().unwrap();
        let payload = archived_state_payload(&dir);
        let mut restored =
            PersistentEngine::new(dir.path().join("archived-not-offered.db").to_str().unwrap())
                .unwrap();
        restored.restore_record_json(&payload.to_string()).unwrap();

        assert!(restored.retired_sections().is_empty());
        assert!(restored.revert_section_to_version("old-climb", 1).is_err());
        assert_eq!(pending_rows(&restored), 1);
    }

    #[test]
    fn test_waiting_registry_row_from_an_earlier_build_is_neither_listed_nor_carried() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("waiting-identity.db").to_str().unwrap())
                .unwrap();
        store_raw(
            &engine,
            super::PENDING_KEY,
            &json!([{
                "table": "identity_state",
                "values": {"key": "section_identity", "tombstones": ["old-climb"]},
                "ground": null
            }]),
        );

        assert!(engine.unplaced_records().unwrap().is_empty());
        let result = engine.retry_record_restore().unwrap();
        assert_eq!((result.placed, result.unplaced), (0, 0));
        let next = crate::persistence::record_backup::collect_record_payload(&engine.db).unwrap();
        assert!(!next.entries.iter().any(|row| row.table == "identity_state"));
    }

    #[test]
    fn test_line_only_pin_places_on_matching_ground() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("line-pin.db").to_str().unwrap()).unwrap();
        let line = serde_json::to_string(&ride()[10..40]).unwrap();
        engine
            .db
            .execute(
                "INSERT INTO sections (id, section_type, sport_type, polyline_json, distance_meters)
                 VALUES ('local-id', 'auto', 'Ride', ?1, 1000)",
                [&line],
            )
            .unwrap();
        let payload = json!({"version": 1, "entries": [{
            "table": "section_pins", "values": {"section_id": "foreign-id", "version": 3},
            "ground": {"rep_activity_id": null, "rep_start_index": null,
                "rep_end_index": null, "point_count": null, "polyline_json": line}
        }]});
        let result = engine.restore_record_json(&payload.to_string()).unwrap();
        assert_eq!((result.placed, result.unplaced), (1, 0));
        let (version, source, blob): (i64, String, Vec<u8>) = engine
            .db
            .query_row(
                "SELECT g.version, g.source, g.blob FROM section_pins p
                 JOIN section_geometry g ON g.section_id = p.section_id AND g.version = p.version
                 WHERE p.section_id = 'local-id'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!((version, source.as_str()), (3, "consensus"));
        let expected: Vec<GpsPoint> = serde_json::from_str(&line).unwrap();
        let stored = crate::persistence::codec::decode_polyline(&blob).unwrap();
        assert_eq!(stored.len(), expected.len());
    }

    #[test]
    fn test_line_only_pin_without_ground_stays_dormant() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("line-pin-wait.db").to_str().unwrap()).unwrap();
        let payload = json!({"version": 1, "entries": [{
            "table": "section_pins", "values": {"section_id": "foreign-id", "version": 3},
            "ground": {"rep_activity_id": null, "rep_start_index": null,
                "rep_end_index": null, "point_count": null,
                "polyline_json": serde_json::to_string(&ride()[10..40]).unwrap()}
        }]});
        let result = engine.restore_record_json(&payload.to_string()).unwrap();
        assert_eq!((result.placed, result.unplaced), (0, 1));
        let sections: i64 = engine
            .db
            .query_row("SELECT COUNT(*) FROM sections", [], |r| r.get(0))
            .unwrap();
        assert_eq!(sections, 0);
    }

    #[test]
    fn test_repeated_import_keeps_one_dormant_row() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("repeat.db").to_str().unwrap()).unwrap();
        let payload = json!({"version": 1, "entries": [{
            "table": "section_pins", "values": {"section_id": "foreign-id", "version": 7},
            "ground": {"rep_activity_id": "old-ride", "rep_start_index": 10,
                "rep_end_index": 40, "point_count": 80, "polyline_json": null}
        }]})
        .to_string();
        for _ in 0..3 {
            let result = engine.restore_record_json(&payload).unwrap();
            assert_eq!(result.unplaced, 1);
        }
        assert_eq!(engine.unplaced_records().unwrap().len(), 1);
        assert_eq!(engine.retry_record_restore().unwrap().unplaced, 1);
    }

    #[test]
    fn test_route_name_and_exclusion_land_on_a_group_with_another_representative() {
        let dir = TempDir::new().unwrap();
        let source =
            PersistentEngine::new(dir.path().join("routes-source.db").to_str().unwrap()).unwrap();
        source
            .db
            .execute_batch(
                "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type)
                 VALUES ('old-route', 'ride-a', '[\"ride-a\",\"ride-b\",\"ride-c\"]', 'Ride');
                 INSERT INTO route_names (route_id, custom_name) VALUES ('old-route', 'Loop');
                 INSERT INTO activity_matches (route_id, activity_id, match_percentage, direction, excluded)
                 VALUES ('old-route', 'ride-c', 90, 'same', 1);",
            )
            .unwrap();
        let payload =
            crate::persistence::record_backup::collect_record_payload(&source.db).unwrap();

        let mut restored =
            PersistentEngine::new(dir.path().join("routes-restored.db").to_str().unwrap()).unwrap();
        restored
            .db
            .execute_batch(
                "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type)
                 VALUES ('other-route', 'ride-x', '[\"ride-x\",\"ride-y\"]', 'Ride');
                 INSERT INTO route_groups (id, representative_id, activity_ids, sport_type)
                 VALUES ('new-route', 'ride-b', '[\"ride-b\",\"ride-c\",\"ride-a\"]', 'Ride');
                 INSERT INTO activity_matches (route_id, activity_id, match_percentage, direction)
                 VALUES ('new-route', 'ride-c', 90, 'same');",
            )
            .unwrap();
        let result = restored
            .restore_record_json(&serde_json::to_string(&payload).unwrap())
            .unwrap();
        assert_eq!(result.unplaced, 0);
        let name: String = restored
            .db
            .query_row(
                "SELECT custom_name FROM route_names WHERE route_id = 'new-route'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(name, "Loop");
        let excluded: i64 = restored
            .db
            .query_row(
                "SELECT excluded FROM activity_matches WHERE route_id = 'new-route'
                 AND activity_id = 'ride-c'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(excluded, 1);
    }

    #[test]
    fn test_route_name_waits_when_no_local_group_shares_a_member() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("routes-wait.db").to_str().unwrap()).unwrap();
        engine
            .db
            .execute(
                "INSERT INTO route_groups (id, representative_id, activity_ids, sport_type)
                 VALUES ('other-route', 'ride-x', '[\"ride-x\"]', 'Ride')",
                [],
            )
            .unwrap();
        let payload = json!({"version": 1, "entries": [{
            "table": "route_names", "values": {"route_id": "old-route", "custom_name": "Loop"},
            "ground": {"rep_activity_id": "ride-a", "rep_start_index": null,
                "rep_end_index": null, "point_count": null, "polyline_json": null,
                "activity_ids": ["ride-a", "ride-b"]}
        }]});
        let result = engine.restore_record_json(&payload.to_string()).unwrap();
        assert_eq!(result.unplaced, 1);
        let names: i64 = engine
            .db
            .query_row("SELECT COUNT(*) FROM route_names", [], |r| r.get(0))
            .unwrap();
        assert_eq!(names, 0);
    }

    #[test]
    fn legacy_id_only_name_does_not_rename_unrelated_local_ground() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("legacy-name.db").to_str().unwrap()).unwrap();
        let line = serde_json::to_string(&ride()[10..40]).unwrap();
        engine.db.execute(
            "INSERT INTO sections (id, section_type, sport_type, polyline_json, distance_meters)
             VALUES ('old-id', 'auto', 'Ride', ?1, 1000)",
            [line],
        ).unwrap();
        let payload = json!({"version": 1, "entries": [{
            "table": "legacy_section_name",
            "values": {"section_id": "old-id", "name": "Other library's name"},
            "ground": null
        }]});
        let result = engine.restore_record_json(&payload.to_string()).unwrap();
        assert_eq!(result.unplaced, 1);
        let local_name: Option<String> = engine
            .db
            .query_row("SELECT name FROM sections WHERE id = 'old-id'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(local_name, None);
    }

    /// Storage refuses the restore's progress write, the write after a
    /// preference has already landed inside the restore.
    fn fail_progress_writes(engine: &PersistentEngine) {
        engine
            .db
            .execute_batch(
                "CREATE TEMP TRIGGER refuse_progress BEFORE INSERT ON settings
                 WHEN NEW.key = '__record_restore_pending'
                 BEGIN SELECT RAISE(ABORT, 'database or disk is full'); END",
            )
            .unwrap();
    }

    fn paused(engine: &PersistentEngine) -> bool {
        engine
            .unplaced_records()
            .unwrap()
            .iter()
            .any(|record| record.reason == "import_paused")
    }

    /// An import of no entries, which carries whatever import is paused.
    fn resume(engine: &mut PersistentEngine) -> Result<super::RestoreRecordResult, String> {
        engine.restore_record_json(r#"{"version": 1, "entries": []}"#)
    }

    fn pending_rows(engine: &PersistentEngine) -> usize {
        engine.pending_record_rows().unwrap().len()
    }

    fn import_with_dormant_name(unit: &str) -> serde_json::Value {
        json!({"version": 1, "entries": [
            {"table": "settings", "values": {"key": "veloq-unit-preference", "value": unit}},
            {"table": "legacy_section_name", "values": {"section_id": "old", "name": "Col"}}
        ]})
    }

    /// Scenario: storage fills between an imported preference and the
    /// restore's progress write, and the app is killed before anyone retries.
    ///
    /// Expected behaviour: nothing of the import is half-applied, the import
    /// is paused rather than lost, and the next launch resumes it from the
    /// database alone, exactly once.
    #[test]
    fn test_failed_import_pauses_and_resumes_once_after_restart() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("paused.db");
        {
            let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
            fail_progress_writes(&engine);
            let failed =
                engine.restore_record_json(&import_with_dormant_name("imperial").to_string());
            assert!(failed.is_err(), "the progress write was refused");
            assert_eq!(
                engine.get_setting("veloq-unit-preference").unwrap(),
                None,
                "the preference landed without its progress"
            );
            assert_eq!(pending_rows(&engine), 0);
            assert!(paused(&engine), "the import was lost rather than paused");
        }

        let mut engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
        assert!(
            paused(&engine),
            "the paused import did not survive a restart"
        );
        let resumed = resume(&mut engine).expect("the paused import to resume");
        assert_eq!((resumed.placed, resumed.unplaced), (1, 1));
        assert_eq!(
            engine
                .get_setting("veloq-unit-preference")
                .unwrap()
                .as_deref(),
            Some("imperial")
        );
        assert!(!paused(&engine));
        assert_eq!(pending_rows(&engine), 1);

        assert_eq!(resume(&mut engine).unwrap().placed, 0);
        assert_eq!(
            pending_rows(&engine),
            1,
            "a second resume added the record again"
        );
    }

    /// Scenario: storage stays full on the first retry, then frees up.
    ///
    /// Expected behaviour: the failed retry keeps the import paused, and the
    /// next one completes it.
    #[test]
    fn test_paused_import_stays_paused_until_a_retry_commits() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("retry.db").to_str().unwrap()).unwrap();
        fail_progress_writes(&engine);
        assert!(
            engine
                .restore_record_json(&import_with_dormant_name("imperial").to_string())
                .is_err()
        );
        assert!(resume(&mut engine).is_err());
        assert!(paused(&engine));
        assert_eq!(engine.get_setting("veloq-unit-preference").unwrap(), None);

        engine
            .db
            .execute_batch("DROP TRIGGER temp.refuse_progress")
            .unwrap();
        let resumed = resume(&mut engine).unwrap();
        assert_eq!(resumed.placed, 1);
        assert!(!paused(&engine));
    }

    #[test]
    fn test_restore_places_the_automatic_backup_switch() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("switch.db").to_str().unwrap()).unwrap();
        let record = json!({"version": 1, "entries": [
            {"table": "settings", "values": {"key": "__auto_backup_enabled", "value": "1"}}
        ]});
        engine.restore_record_json(&record.to_string()).unwrap();
        assert_eq!(
            engine
                .get_setting("__auto_backup_enabled")
                .unwrap()
                .as_deref(),
            Some("1")
        );
    }

    /// Scenario: an import is paused, and the athlete picks another file.
    ///
    /// Expected behaviour: the new import carries the paused records with it,
    /// so neither file's records are dropped, and its own values win.
    #[test]
    fn test_new_import_carries_a_paused_one() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("carry.db").to_str().unwrap()).unwrap();
        fail_progress_writes(&engine);
        let first = json!({"version": 1, "entries": [
            {"table": "settings", "values": {"key": "veloq-theme-preference", "value": "dark"}},
            {"table": "settings", "values": {"key": "veloq-unit-preference", "value": "imperial"}}
        ]});
        assert!(engine.restore_record_json(&first.to_string()).is_err());
        engine
            .db
            .execute_batch("DROP TRIGGER temp.refuse_progress")
            .unwrap();

        let second = json!({"version": 1, "entries": [
            {"table": "settings", "values": {"key": "veloq-unit-preference", "value": "metric"}}
        ]});
        engine.restore_record_json(&second.to_string()).unwrap();
        assert_eq!(
            engine
                .get_setting("veloq-theme-preference")
                .unwrap()
                .as_deref(),
            Some("dark")
        );
        assert_eq!(
            engine
                .get_setting("veloq-unit-preference")
                .unwrap()
                .as_deref(),
            Some("metric")
        );
        assert!(!paused(&engine));
    }

    /// Expected behaviour: a file refused for its format or its owner is
    /// refused before the first write, and leaves no paused import behind.
    #[test]
    fn test_refused_import_is_not_paused() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("refused.db").to_str().unwrap()).unwrap();
        engine.set_setting("__athlete_id", "athlete-1").unwrap();
        for payload in [
            "{not json".to_string(),
            json!({"version": 2, "entries": []}).to_string(),
            json!({"version": 1, "athlete_id": "athlete-2", "entries": []}).to_string(),
        ] {
            assert!(engine.restore_record_json(&payload).is_err());
            assert!(!paused(&engine), "refused payload paused: {payload}");
        }
    }

    /// Expected behaviour: a library wipe takes a paused import with it, as it
    /// takes the records already waiting, so the next athlete inherits none.
    #[test]
    fn test_library_wipe_drops_a_paused_import() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("wipe.db").to_str().unwrap()).unwrap();
        fail_progress_writes(&engine);
        assert!(
            engine
                .restore_record_json(&import_with_dormant_name("imperial").to_string())
                .is_err()
        );
        engine
            .db
            .execute_batch("DROP TRIGGER temp.refuse_progress")
            .unwrap();
        engine.clear().unwrap();
        assert!(!paused(&engine));
        assert_eq!(resume(&mut engine).unwrap().placed, 0);
        assert_eq!(engine.get_setting("veloq-unit-preference").unwrap(), None);
    }

    fn unreadable_intent() -> serde_json::Value {
        json!({"table": "section_intents",
               "values": {"id": "x", "kind": "named", "polyline_json": "not json"}})
    }

    /// An auto section the athlete edited, whose saved undo line is unreadable.
    fn unreadable_original() -> serde_json::Value {
        json!({"table": "sections",
               "values": {"id": "s", "section_type": "auto", "sport_type": "Ride",
                          "original_polyline_json": "not json"},
               "ground": {"polyline_json": serde_json::to_string(&ride()[..30]).unwrap()}})
    }

    /// Store a paused import or waiting rows the way an earlier build could,
    /// carrying a row that fails on content.
    fn store_raw(engine: &PersistentEngine, key: &str, value: &serde_json::Value) {
        engine.set_setting(key, &value.to_string()).unwrap();
    }

    /// Scenario: a hand-edited or damaged file carries one row whose line does
    /// not parse.
    ///
    /// Expected behaviour: the file is refused before any write and nothing is
    /// paused, so the next file imports as if it had never been picked.
    #[test]
    fn test_unreadable_row_is_refused_before_it_pauses() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("content.db").to_str().unwrap()).unwrap();
        for bad in [unreadable_intent(), unreadable_original()] {
            let payload = json!({"version": 1, "entries": [
                {"table": "settings", "values": {"key": "veloq-theme-preference", "value": "dark"}},
                bad
            ]});
            assert!(engine.restore_record_json(&payload.to_string()).is_err());
            assert!(!paused(&engine), "a content failure paused: {payload}");
            assert_eq!(
                engine.get_setting("veloq-theme-preference").unwrap(),
                None,
                "a refused file wrote a row"
            );
        }

        let valid = json!({"version": 1, "entries": [
            {"table": "settings", "values": {"key": "veloq-unit-preference", "value": "imperial"}}
        ]});
        let result = engine.restore_record_json(&valid.to_string()).unwrap();
        assert_eq!(result.placed, 1);
        assert_eq!(
            engine
                .get_setting("veloq-unit-preference")
                .unwrap()
                .as_deref(),
            Some("imperial")
        );
    }

    /// Scenario: an earlier build paused an import carrying a row that can
    /// never be placed.
    ///
    /// Expected behaviour: resuming places what can be read and drops the
    /// unreadable row, so the import is no longer paused and the next file
    /// imports.
    #[test]
    fn test_paused_unreadable_row_no_longer_blocks_later_imports() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("stuck.db").to_str().unwrap()).unwrap();
        store_raw(
            &engine,
            super::PAUSED_IMPORT_KEY,
            &json!({"version": 1, "entries": [
                unreadable_intent(),
                {"table": "settings", "values": {"key": "veloq-theme-preference", "value": "dark"}}
            ]}),
        );
        let resumed = resume(&mut engine).expect("resume past the unreadable row");
        assert_eq!(resumed.placed, 1);
        assert!(!paused(&engine));
        assert_eq!(
            engine
                .get_setting("veloq-theme-preference")
                .unwrap()
                .as_deref(),
            Some("dark")
        );

        store_raw(
            &engine,
            super::PAUSED_IMPORT_KEY,
            &json!({"version": 1, "entries": [unreadable_original()]}),
        );
        let next = json!({"version": 1, "entries": [
            {"table": "settings", "values": {"key": "veloq-unit-preference", "value": "imperial"}}
        ]});
        engine
            .restore_record_json(&next.to_string())
            .expect("a new file imports past a paused unreadable row");
        assert!(!paused(&engine));
        assert_eq!(
            engine
                .get_setting("veloq-unit-preference")
                .unwrap()
                .as_deref(),
            Some("imperial")
        );
    }

    /// Scenario: a waiting row an earlier build stored fails on content once
    /// its ground arrives.
    ///
    /// Expected behaviour: neither the retry nor a later import is blocked by
    /// it, and the row is not kept waiting for ever.
    #[test]
    fn test_waiting_unreadable_row_blocks_neither_retry_nor_import() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("waiting.db").to_str().unwrap()).unwrap();
        store_raw(&engine, super::PENDING_KEY, &json!([unreadable_original()]));
        engine
            .retry_record_restore()
            .expect("retry past the unreadable row");
        assert_eq!(pending_rows(&engine), 0);

        store_raw(&engine, super::PENDING_KEY, &json!([unreadable_intent()]));
        let next = json!({"version": 1, "entries": [
            {"table": "settings", "values": {"key": "veloq-unit-preference", "value": "imperial"}}
        ]});
        engine
            .restore_record_json(&next.to_string())
            .expect("an import past a waiting unreadable row");
        assert!(!paused(&engine));
        assert_eq!(pending_rows(&engine), 0);
    }

    /// Scenario: an import is paused, and the athlete would rather not have it
    /// than wait for it.
    ///
    /// Expected behaviour: Discard removes the paused import and nothing else,
    /// so none of its rows land on a later resume, and records already waiting
    /// keep waiting.
    #[test]
    fn test_discarded_paused_import_changes_nothing_else() {
        let dir = TempDir::new().unwrap();
        let mut engine =
            PersistentEngine::new(dir.path().join("discard.db").to_str().unwrap()).unwrap();
        engine
            .restore_record_json(
                &json!({"version": 1, "entries": [
                    {"table": "legacy_section_name", "values": {"section_id": "old", "name": "Col"}}
                ]})
                .to_string(),
            )
            .unwrap();
        assert_eq!(pending_rows(&engine), 1);
        store_raw(
            &engine,
            super::PAUSED_IMPORT_KEY,
            &import_with_dormant_name("imperial"),
        );
        assert!(paused(&engine));

        engine.discard_paused_import().unwrap();
        assert!(!paused(&engine));
        assert_eq!(
            pending_rows(&engine),
            1,
            "the discard took a waiting record"
        );
        assert_eq!(resume(&mut engine).unwrap().placed, 0);
        assert_eq!(engine.get_setting("veloq-unit-preference").unwrap(), None);

        engine
            .discard_paused_import()
            .expect("a discard with nothing paused is a no-op");
    }
}
