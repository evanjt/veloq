//! Schema management: migrations, version tracking, and data population.

use crate::GpsPoint;
use rusqlite::{Connection, Result as SqlResult, params};
use rusqlite_migration::{M, Migrations};
use std::collections::{HashMap, HashSet};

use super::{PersistentEngine, codec, sections};

/// App-level schema version, written to `schema_info` after the migration
/// pass and read by the post-migration hooks. `PRAGMA user_version` is the
/// other record, the one `rusqlite_migration` skips on, and it ends one for
/// one with the migration list. Hooks <= 7 are dead code for any user on 0.2.2+.
pub const SUPPORTED_SCHEMA_VERSION: i32 = 62;

/// The migration that drops the cutover archive tables, counted from one. The
/// open carries their rows into the ledger before it runs.
const ARCHIVE_DROP_MIGRATION: usize = 54;

const HEATMAP_INTENSITY: &str = "CASE
    WHEN MAX(moving_time) > 7200 THEN 4
    WHEN MAX(moving_time) > 5400 THEN 3
    WHEN MAX(moving_time) > 3600 THEN 2
    WHEN MAX(moving_time) > 0 THEN 1
    ELSE 0 END";

fn heatmap_insert(predicate: &str) -> String {
    format!(
        "INSERT INTO activity_heatmap (date, intensity, max_duration, activity_count)
         SELECT date(date, 'unixepoch'), {HEATMAP_INTENSITY}, MAX(moving_time), COUNT(*)
         FROM activity_metrics {predicate} GROUP BY date(date, 'unixepoch')"
    )
}

pub(super) fn recompute_heatmap_day(conn: &Connection, timestamp: i64) -> SqlResult<()> {
    let Some(date): Option<String> =
        conn.query_row("SELECT date(?1, 'unixepoch')", [timestamp], |row| {
            row.get(0)
        })?
    else {
        return Ok(());
    };
    conn.execute("DELETE FROM activity_heatmap WHERE date = ?", [&date])?;
    let start = timestamp.div_euclid(86_400) * 86_400;
    conn.execute(
        &heatmap_insert("WHERE date >= ?1 AND date < ?2"),
        params![start, start + 86_400],
    )?;
    Ok(())
}

pub(super) fn recompute_all_heatmap(conn: &Connection) -> SqlResult<()> {
    conn.execute("DELETE FROM activity_heatmap", [])?;
    conn.execute(&heatmap_insert(""), [])?;
    Ok(())
}

/// Marks the refusal to open a database a later build wrote, so the init
/// failover can tell it apart from corruption and leave the file alone.
pub(crate) const FORWARD_SCHEMA_MARKER: &str = "database schema is newer than this build";

/// `schema_info` key whose presence suspends the summary recount the
/// `section_activities` insert triggers make. A bulk save sets it, writes its
/// rows, recounts them once with [`recount_section_summaries`] and removes it,
/// all inside one transaction, so a rollback takes the key with it.
pub(crate) const SECTION_SUMMARY_BULK_KEY: &str = "section_summary_bulk";

/// The `WHEN` clause that honours [`SECTION_SUMMARY_BULK_KEY`].
const SUMMARY_TRIGGER_GUARD: &str =
    "WHEN NOT EXISTS (SELECT 1 FROM schema_info WHERE key = 'section_summary_bulk')";

/// Recount `visit_count`, `activity_count` and `sport_types` for every section
/// `predicate` selects, the same aggregates the triggers keep row by row.
pub(crate) fn recount_section_summaries(conn: &Connection, predicate: &str) -> SqlResult<usize> {
    conn.execute(
        &format!(
            "UPDATE sections SET
                 visit_count = (
                     SELECT COUNT(*) FROM section_activities sa
                     WHERE sa.section_id = sections.id AND sa.excluded = 0),
                 activity_count = (
                     SELECT COUNT(DISTINCT activity_id) FROM section_activities sa
                     WHERE sa.section_id = sections.id AND sa.excluded = 0),
                 sport_types = (
                     SELECT GROUP_CONCAT(DISTINCT a.sport_type) FROM section_activities sa
                     JOIN activities a ON a.id = sa.activity_id
                     WHERE sa.section_id = sections.id AND sa.excluded = 0)
             WHERE {predicate}"
        ),
        [],
    )
}

/// Whether the named trigger exists and its body carries the bulk guard.
fn trigger_has_guard(conn: &Connection, name: &str) -> bool {
    conn.query_row(
        "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?",
        params![name],
        |row| row.get::<_, String>(0),
    )
    .map(|sql| sql.contains(SECTION_SUMMARY_BULK_KEY))
    .unwrap_or(false)
}

/// Names the refusal of a file whose pragma claims migrations that left no
/// tables, so a caller can tell it from an ordinary migration failure.
pub(crate) const OVERSTATED_SCHEMA_MARKER: &str = "schema version overstated";

/// The init outcome for an open the schema check refused, or `None` when the
/// failure is not one of its refusals.
///
/// Both refusals are about the version records, not the bytes, so the file is
/// healthy as far as SQLite goes and the remedy is never to replace it: the
/// init path returns this outcome before it reaches the quarantine.
pub(crate) fn refused_outcome(e: &rusqlite::Error) -> Option<crate::objects::init::FfiInitOutcome> {
    use crate::objects::init::FfiInitOutcome;
    let message = e.to_string();
    if message.contains(FORWARD_SCHEMA_MARKER) {
        Some(FfiInitOutcome::ForwardSchema)
    } else if message.contains(OVERSTATED_SCHEMA_MARKER) {
        Some(FfiInitOutcome::VersionMismatch)
    } else {
        None
    }
}

impl PersistentEngine {
    pub(super) const SCHEMA_VERSION: i32 = SUPPORTED_SCHEMA_VERSION;

    /// Database migrations, tracked in `__rusqlite_migrations` table.
    /// M1–M11: shipped in 0.2.2 (PRAGMA user_version = 11).
    /// M12: consolidated 0.2.2 → 0.3.0 upgrade.
    /// M13: untyped wellness body.
    /// M14: untyped activity bodies.
    /// M15: untyped curve, interval and calendar bodies.
    /// M16: bounded activity stream body cache.
    /// M17: section history, geometry versions and pins.
    /// M18: persisted evidence cache.
    /// M19: section enrichment and ranking columns.
    /// M20: settled FIT verdict, replacing the has_sets bit a failure poisoned.
    /// M21: durable per-activity stream store, sized by the athlete.
    /// M22: how much of its section a traversal covers, for the record rule.
    /// M23: activity_matches indexed by activity, for the section-to-route join.
    /// M24: the intervals.icu id as metadata beside the key, not as the key.
    /// M56: per-section ranking inputs kept as a running summary.
    /// M57: the visible section count kept as a stored row.
    /// M58: the route lines the map draws, built once per group write.
    /// M59: each climbing activity's best window per length.
    /// M60: a trim's original line and an intent's footprint as quantised blobs.
    /// M61: which altitude series each stored track's points carry.
    /// M62: each background job's last run, one row per job.
    /// M54: the cutover archive tables dropped, their rows carried into the
    /// section ledger first by [`Self::init_schema`].
    /// The nullable `polyline_json` rebuild is a pragma-guarded hook, not a
    /// numbered migration, so the version stays one for one with the SQL.
    pub(super) fn migrations() -> Migrations<'static> {
        Migrations::new(Self::migration_scripts().into_iter().map(M::up).collect())
    }

    /// The migration SQL in application order. Exposed so migration tests can
    /// seed a database at an arbitrary released version by applying a prefix of
    /// this exact list, rather than hand-copying `include_str!` lines that then
    /// drift from what ships.
    #[doc(hidden)]
    pub fn migration_scripts() -> Vec<&'static str> {
        vec![
            include_str!("../migrations/001_initial_schema.sql"),
            include_str!("../migrations/002_unified_sections.sql"),
            include_str!("../migrations/003_drop_section_names.sql"),
            include_str!("../migrations/004_extend_activity_metrics.sql"),
            include_str!("../migrations/005_profile_and_settings.sql"),
            include_str!("../migrations/006_processed_activities.sql"),
            include_str!("../migrations/007_cache_section_performances.sql"),
            include_str!("../migrations/008_cache_all_performance_metrics.sql"),
            include_str!("../migrations/009_section_bounds_cache.sql"),
            include_str!("../migrations/010_route_groups_activity_count.sql"),
            include_str!("../migrations/011_pace_history.sql"),
            include_str!("../migrations/012_v030.sql"),
            include_str!("../migrations/013_wellness_raw_body.sql"),
            include_str!("../migrations/014_activity_bodies.sql"),
            include_str!("../migrations/015_curve_interval_calendar_bodies.sql"),
            include_str!("../migrations/016_stream_bodies.sql"),
            include_str!("../migrations/017_b4_core.sql"),
            include_str!("../migrations/018_evidence_cache.sql"),
            include_str!("../migrations/019_enrichment.sql"),
            include_str!("../migrations/020_fit_status_failures.sql"),
            include_str!("../migrations/021_activity_streams.sql"),
            include_str!("../migrations/022_portion_coverage.sql"),
            include_str!("../migrations/023_activity_matches_activity_index.sql"),
            include_str!("../migrations/024_activity_intervals_id.sql"),
            include_str!("../migrations/025_recordings.sql"),
            include_str!("../migrations/026_recording_reconciled.sql"),
            include_str!("../migrations/027_recording_athlete.sql"),
            include_str!("../migrations/028_attempt_store.sql"),
            include_str!("../migrations/029_stream_backfill.sql"),
            include_str!("../migrations/030_activity_metrics_date_index.sql"),
            include_str!("../migrations/031_activity_start_date_index.sql"),
            include_str!("../migrations/032_section_lift_intent.sql"),
            include_str!("../migrations/033_activity_rolling_ftp.sql"),
            include_str!("../migrations/034_activity_census.sql"),
            include_str!("../migrations/035_activity_census_fetched.sql"),
            include_str!("../migrations/036_activity_census_has_latlng.sql"),
            include_str!("../migrations/037_recording_kind.sql"),
            include_str!("../migrations/038_pace_history_window.sql"),
            include_str!("../migrations/039_push_runs.sql"),
            include_str!("../migrations/040_lap_power.sql"),
            include_str!("../migrations/041_remove_unused_metrics_copies.sql"),
            include_str!("../migrations/042_rebuild_activity_heatmap.sql"),
            include_str!("../migrations/043_recording_notes_rpe.sql"),
            include_str!("../migrations/044_activity_bodies_intervals_id.sql"),
            include_str!("../migrations/045_hr_zone_six_and_seven.sql"),
            include_str!("../migrations/046_route_numbers.sql"),
            include_str!("../migrations/047_section_numbers.sql"),
            include_str!("../migrations/048_section_forced_matches.sql"),
            include_str!("../migrations/049_census_track_refusal.sql"),
            include_str!("../migrations/050_lap_series_empty.sql"),
            include_str!("../migrations/051_hr_zone_top_backfill.sql"),
            include_str!("../migrations/052_route_representative_chosen.sql"),
            include_str!("../migrations/053_census_track_failures.sql"),
            include_str!("../migrations/054_catalogue_archive_in_ledger.sql"),
            include_str!("../migrations/055_lap_time_empty.sql"),
            include_str!("../migrations/056_section_rank_inputs.sql"),
            include_str!("../migrations/057_section_visible_count.sql"),
            include_str!("../migrations/058_route_line_layer.sql"),
            include_str!("../migrations/059_activity_climb_bests.sql"),
            include_str!("../migrations/060_section_line_blobs.sql"),
            include_str!("../migrations/061_gps_track_elevation_source.sql"),
            include_str!("../migrations/062_job_runs.sql"),
        ]
    }

    /// The tables each prefix of the migrations leaves behind, entry `n` for
    /// migrations `1..=n`, read from the migration SQL itself rather than from
    /// a list beside it: a hand-kept map drifts, and what this has to describe
    /// is exactly what those files do.
    ///
    /// Creates add, drops remove and a rename moves the name, in file order,
    /// so a table a later migration rebuilt under a temporary name is not
    /// claimed. Index and trigger DDL is not a table and is passed over.
    pub(super) fn tables_after_each() -> Vec<std::collections::BTreeSet<String>> {
        let mut tables: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
        let mut after = vec![tables.clone()];
        for script in Self::migration_scripts() {
            // Comments first: a statement here nearly always opens with a
            // `--` line, and its words would otherwise be the ones matched.
            let stripped: String = script
                .lines()
                .map(|line| line.split("--").next().unwrap_or(""))
                .collect::<Vec<&str>>()
                .join("\n");
            for statement in stripped.split(';') {
                let words: Vec<String> = statement
                    .split_whitespace()
                    .map(|w| w.trim_matches(['"', '`', '\'', '(']).to_lowercase())
                    .collect();
                let w: Vec<&str> = words.iter().map(String::as_str).collect();
                match w.as_slice() {
                    ["create", "table", "if", "not", "exists", name, ..]
                    | ["create", "table", name, ..] => {
                        tables.insert((*name).to_string());
                    }
                    ["drop", "table", "if", "exists", name, ..] | ["drop", "table", name, ..] => {
                        tables.remove(*name);
                    }
                    ["alter", "table", from, "rename", "to", to, ..] => {
                        tables.remove(*from);
                        tables.insert((*to).to_string());
                    }
                    _ => {}
                }
            }
            after.push(tables.clone());
        }
        after
    }

    /// Refuse a file whose `PRAGMA user_version` claims migrations that did not
    /// leave their tables behind.
    ///
    /// Diagnosis only. The message names both version records and the tables
    /// the pragma implies but the file does not hold, because the failure it
    /// replaces named whichever table the pass reached first and nothing about
    /// why it was reached.
    ///
    /// The tables it expects are the ones every prefix from the pragma's to
    /// this build's holds. A table a later migration drops can be missing from
    /// a file whose pragma understates what ran, so its absence says nothing
    /// about an overstatement.
    fn refuse_an_overstated_version(conn: &Connection, app_version: i32) -> SqlResult<()> {
        let pragma: i64 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        if pragma <= 0 {
            return Ok(());
        }
        let after = Self::tables_after_each();
        let from = (pragma as usize).min(after.len() - 1);
        let mut expected = after[from].clone();
        for later in &after[from + 1..] {
            expected.retain(|table| later.contains(table));
        }
        if expected.is_empty() {
            return Ok(());
        }
        let mut present: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
        {
            let mut stmt = conn.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")?;
            for row in stmt.query_map([], |row| row.get::<_, String>(0))? {
                present.insert(row?);
            }
        }
        // A file that has not been migrated at all is not this: the pragma is
        // zero there, and this only fires when it names work that left nothing.
        let missing: Vec<&str> = expected
            .iter()
            .filter(|t| !present.contains(*t))
            .map(String::as_str)
            .collect();
        if missing.is_empty() {
            return Ok(());
        }
        Err(rusqlite::Error::ToSqlConversionFailure(Box::new(
            std::io::Error::other(format!(
                "{}: user_version {} implies {} tables, schema_info {}, and these are absent: {}. \
                 The migration pass would skip the files that create them and fail on the first \
                 one it assumes. Nothing here repairs it.",
                OVERSTATED_SCHEMA_MARKER,
                pragma,
                expected.len(),
                app_version,
                missing.join(", "),
            )),
        )))
    }

    /// Keeps the SQLite error a migration pass hit, so a busy file stays
    /// retryable instead of reading as a corrupt one.
    fn migration_error(e: rusqlite_migration::Error) -> rusqlite::Error {
        match e {
            rusqlite_migration::Error::RusqliteError { err, .. } => err,
            other => rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::other(
                other.to_string(),
            ))),
        }
    }

    /// Initialise the database schema using migrations.
    pub(super) fn init_schema(conn: &mut Connection) -> SqlResult<()> {
        // Create schema_info table if not exists (for app-level version tracking)
        conn.execute(
            "CREATE TABLE IF NOT EXISTS schema_info (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )?;

        // Get current schema version (0 if not set = pre-0.1.0 database)
        let current_version: i32 = conn
            .query_row(
                "SELECT CAST(value AS INTEGER) FROM schema_info WHERE key = 'schema_version'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        log::info!(
            "veloqrs: [Schema] Current version: {}, Target version: {}",
            current_version,
            Self::SCHEMA_VERSION
        );

        // Migrations only run upward, so a file a later build wrote is missing
        // nothing the app can add: it has columns this code does not know and
        // lacks none it does. Opening it fails at query time instead, one
        // feature at a time. Refuse it whole, and leave the file where it is.
        //
        // Either record can be the one ahead. A later build stamps
        // `schema_info` only after its pass, so a kill between the two leaves
        // the pragma ahead and the app record at this build's version, and the
        // migration library would refuse that file without saying why.
        let applied_migrations: i64 =
            conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;
        let known_migrations = Self::migration_scripts().len() as i64;
        if current_version > Self::SCHEMA_VERSION || applied_migrations > known_migrations {
            return Err(rusqlite::Error::ToSqlConversionFailure(Box::new(
                std::io::Error::other(format!(
                    "{}: file is schema_info {} and user_version {}, this build supports {} and {}",
                    FORWARD_SCHEMA_MARKER,
                    current_version,
                    applied_migrations,
                    Self::SCHEMA_VERSION,
                    known_migrations
                )),
            )));
        }

        // A pragma that overstates what ran makes the pass skip the file that
        // creates a table and reach the one that alters it, and the failure
        // names that table rather than the version records behind it. Diagnose
        // it here, before the pass: the repair is not this build's to make,
        // and the migration bytes are checksummed so no numbered file can be
        // rewritten to cover for it.
        Self::refuse_an_overstated_version(conn, current_version)?;

        // Run all pending migrations
        let migrations_started = std::time::Instant::now();
        if current_version < 4 && applied_migrations < 40 {
            let scripts = Self::migration_scripts();
            Migrations::new(scripts[..39].iter().copied().map(M::up).collect())
                .to_latest(conn)
                .map_err(Self::migration_error)?;
            Self::populate_all_performance_caches(conn)?;
        }
        // 054 drops the cutover archive tables, and what they hold is carried
        // into the ledger by Rust that no SQL file can run. So the files
        // before it run first, the rows move, and the drop runs after.
        if applied_migrations < ARCHIVE_DROP_MIGRATION as i64 {
            let scripts = Self::migration_scripts();
            Migrations::new(
                scripts[..ARCHIVE_DROP_MIGRATION - 1]
                    .iter()
                    .copied()
                    .map(M::up)
                    .collect(),
            )
            .to_latest(conn)
            .map_err(Self::migration_error)?;
            // The ledger and live-row columns the carry reads and writes,
            // which older files gain only from these hooks.
            Self::ensure_section_geometry_provenance(conn)?;
            Self::ensure_sections_geometry_provenance(conn)?;
            let carried = super::cutover::carry_legacy_archive_into_ledger(conn)?;
            if carried > 0 {
                log::info!(
                    "veloqrs: [Migration] Carried {carried} archived sections into the ledger"
                );
            }
        }
        Self::migrations()
            .to_latest(conn)
            .map_err(Self::migration_error)?;

        // Update schema version
        conn.execute(
            "INSERT OR REPLACE INTO schema_info (key, value) VALUES ('schema_version', ?)",
            params![Self::SCHEMA_VERSION.to_string()],
        )?;

        // Record migration timestamp
        conn.execute(
            "INSERT OR REPLACE INTO schema_info (key, value) VALUES ('last_migration', datetime('now'))",
            [],
        )?;

        let migrations_ms = crate::elapsed_ms(migrations_started);
        let hooks_started = std::time::Instant::now();

        if current_version < 12 {
            Self::migrate_polyline_json_to_blob(conn)?;
            Self::migrate_route_group_ids_to_blob(conn)?;
        }

        // The visit_count denormalisation column and its recompute
        // triggers live here rather than in 017.sql because ADD COLUMN is not
        // idempotent under the raw repeated apply that migration_017_is_rerunnable
        // does. The hook is pragma-guarded and self-healing, so it is safe to run
        // unconditionally after every migration pass.
        Self::ensure_visit_count_denormalisation(conn)?;
        Self::ensure_section_summary_denormalisation(conn)?;
        Self::ensure_section_intents_named_shape(conn)?;
        Self::repair_orphan_supersession(conn)?;
        Self::ensure_section_geometry_provenance(conn)?;
        Self::ensure_sections_geometry_provenance(conn)?;
        Self::backfill_custom_section_reference(conn)?;
        Self::ensure_wellness_raw_column(conn)?;
        Self::ensure_gps_track_elevation_state(conn)?;
        Self::ensure_gps_track_elevation_attempts(conn)?;
        Self::ensure_gps_track_elevation_source(conn)?;
        Self::ensure_section_elevation_columns(conn)?;
        Self::ensure_sections_polyline_nullable(conn)?;
        Self::ensure_section_geometry_baseline(conn, current_version);
        Self::ensure_content_ids(conn)?;
        // After every rebuild of `sections`, which drops the numbering trigger.
        // Below 47 the rows carry the labels a build before numbers minted.
        sections::numbers::ensure_section_numbers(conn, current_version < 47)?;
        Self::ensure_section_rank_triggers(conn)?;
        Self::ensure_section_visible_count(conn)?;

        // Migration 042 rebuilds the heatmap for files that run it. A file
        // whose migrations are already complete but whose app record lags
        // runs nothing, so it is rebuilt here.
        if current_version < 40 && applied_migrations >= 42 {
            recompute_all_heatmap(conn)?;
        }

        // A new file holds no activity body, so none was fetched with another
        // field set. Unstamped, its first sync would refetch the library it
        // had just downloaded. A file an older build wrote stays unstamped,
        // and that is what makes its next sync refetch.
        if current_version == 0 {
            conn.execute(
                "INSERT OR IGNORE INTO settings (key, value, updated_at)
                 VALUES (?1, ?2, strftime('%s', 'now'))",
                params![
                    super::settings_keys::ACTIVITY_BODY_FIELDS,
                    crate::net::types::stored_activity_fields()
                ],
            )?;
        }

        // Post-migration data population for pre-0.2.2 databases.
        // Users on 0.2.2+ (schema_version >= 7) skip this block entirely.
        if current_version < 7 {
            if current_version < 3 {
                let needs_population: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM section_activities WHERE lap_time IS NULL",
                    [],
                    |row| row.get(0),
                )?;
                if needs_population > 0 {
                    log::info!(
                        "veloqrs: [Migration] Populating performance cache for {} section portions...",
                        needs_population
                    );
                    Self::populate_performance_cache(conn)?;
                }
            }
            if current_version < 5 {
                Self::populate_section_bounds(conn)?;
            }
            if current_version < 6 {
                Self::populate_route_group_counts(conn)?;
            }
        }

        // The first launch after an update is the one a user waits on, and a
        // field report of a slow one is unactionable without a split between
        // the SQL chain and these hooks. Only an upgrade reports: an ordinary
        // launch migrates nothing, so a timing there would read as one.
        if current_version < Self::SCHEMA_VERSION {
            log::info!(
                "veloqrs: [Schema] Migration complete from version {} to {}, migrations {}ms, hooks {}ms",
                current_version,
                Self::SCHEMA_VERSION,
                migrations_ms,
                crate::elapsed_ms(hooks_started)
            );
        }

        Ok(())
    }

    /// Move section geometry out of `polyline_json` and into the blob columns.
    /// A post-migration hook, so it runs after the SQL chain, for databases
    /// below version 12.
    fn migrate_polyline_json_to_blob(conn: &Connection) -> SqlResult<()> {
        let mut stmt = conn.prepare(
            "SELECT id, polyline_json, point_density_json FROM sections WHERE polyline_blob IS NULL AND polyline_json IS NOT NULL",
        )?;
        let rows: Vec<(String, String, Option<String>)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
            .filter_map(|r| r.ok())
            .collect();

        if rows.is_empty() {
            return Ok(());
        }

        log::info!(
            "veloqrs: [Migration] Converting {} section polylines from JSON to binary...",
            rows.len()
        );

        let mut update_stmt = conn.prepare(
            "UPDATE sections SET polyline_blob = ?, point_density_blob = ? WHERE id = ?",
        )?;

        let mut converted = 0u32;
        for (id, polyline_json, density_json) in &rows {
            let polyline_blob: Option<Vec<u8>> =
                serde_json::from_str::<Vec<GpsPoint>>(polyline_json)
                    .ok()
                    .map(|pts| super::codec::serialize_track_points(&pts));

            let density_blob: Option<Vec<u8>> = density_json
                .as_deref()
                .and_then(|j| serde_json::from_str::<Vec<u32>>(j).ok())
                .and_then(|d| super::codec::serialize(&d).ok());

            update_stmt.execute(params![polyline_blob, density_blob, id])?;
            converted += 1;
        }

        log::info!(
            "veloqrs: [Migration] Converted {}/{} section polylines to binary",
            converted,
            rows.len()
        );
        Ok(())
    }

    fn migrate_route_group_ids_to_blob(conn: &Connection) -> SqlResult<()> {
        let mut stmt = conn
            .prepare("SELECT id, activity_ids FROM route_groups WHERE activity_ids_blob IS NULL")?;
        let rows: Vec<(String, String)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .filter_map(|r| r.ok())
            .collect();

        if rows.is_empty() {
            return Ok(());
        }

        log::info!(
            "veloqrs: [Migration] Converting {} route group activity_ids from JSON to binary...",
            rows.len()
        );

        let mut update =
            conn.prepare("UPDATE route_groups SET activity_ids_blob = ? WHERE id = ?")?;

        let mut converted = 0u32;
        for (id, json) in &rows {
            if let Ok(ids) = serde_json::from_str::<Vec<String>>(json)
                && let Ok(blob) = codec::serialize(&ids)
            {
                update.execute(rusqlite::params![blob, id])?;
                converted += 1;
            }
        }

        log::info!(
            "veloqrs: [Migration] Converted {}/{} route group activity_ids to binary",
            converted,
            rows.len()
        );
        Ok(())
    }

    /// Add `wellness.raw` when a `user_version` overstating what was applied
    /// skipped migration 013. Keyed on column presence, not on the version.
    fn ensure_wellness_raw_column(conn: &Connection) -> SqlResult<()> {
        if conn.prepare("SELECT raw FROM wellness LIMIT 0").is_err() {
            conn.execute("ALTER TABLE wellness ADD COLUMN raw TEXT", [])?;
        }
        Ok(())
    }

    /// Add `gps_tracks.elevation_state`, the per-activity elevation provenance:
    /// 0 unknown, 1 fetched, 2 unavailable upstream. Default 0, so a row stored
    /// before the column existed reads as unknown rather than as a claim that
    /// its points carry elevation.
    ///
    /// Lives in a hook rather than in 017.sql because `ALTER TABLE ADD COLUMN`
    /// is not idempotent and that file is applied repeatedly by
    /// `migration_017_is_rerunnable`. Keyed on column presence, so it is safe to
    /// run after every migration pass.
    fn ensure_gps_track_elevation_state(conn: &Connection) -> SqlResult<()> {
        if conn
            .prepare("SELECT elevation_state FROM gps_tracks LIMIT 0")
            .is_err()
        {
            conn.execute(
                "ALTER TABLE gps_tracks ADD COLUMN elevation_state INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }
        Ok(())
    }

    /// Add `gps_tracks.elevation_attempts`, how many asks have settled nothing
    /// for this track. Default 0, so a row stored before the column existed
    /// starts its count from the next ask rather than from a number nobody
    /// recorded.
    ///
    /// The count has to survive the process: the backfill runs about once per
    /// launch, so a counter held in memory would never reach the limit that
    /// retires a track, and the queue would stay above zero for ever.
    ///
    /// Lives in a hook rather than in a numbered migration for the same reason
    /// [`Self::ensure_gps_track_elevation_state`] does: `ALTER TABLE ADD
    /// COLUMN` is not idempotent and 017 reruns.
    fn ensure_gps_track_elevation_attempts(conn: &Connection) -> SqlResult<()> {
        if conn
            .prepare("SELECT elevation_attempts FROM gps_tracks LIMIT 0")
            .is_err()
        {
            conn.execute(
                "ALTER TABLE gps_tracks ADD COLUMN elevation_attempts INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }
        Ok(())
    }

    /// Add `gps_tracks.elevation_source` when a `user_version` overstating
    /// what was applied skipped the numbered file that adds it. Keyed on column
    /// presence, not on the version, so it is safe to run on every open.
    fn ensure_gps_track_elevation_source(conn: &Connection) -> SqlResult<()> {
        if conn
            .prepare("SELECT elevation_source FROM gps_tracks LIMIT 0")
            .is_err()
        {
            conn.execute(
                "ALTER TABLE gps_tracks ADD COLUMN elevation_source INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }
        Ok(())
    }

    /// Add the nullable elevation pair to `sections`. NULL means the row
    /// predates elevation metadata; the next detect's wipe-and-reinsert
    /// fills auto rows lazily. Keyed on column presence because
    /// `ALTER TABLE ADD COLUMN` is not idempotent and 017 reruns.
    fn ensure_section_elevation_columns(conn: &Connection) -> SqlResult<()> {
        if conn
            .prepare("SELECT elevation_gain_m FROM sections LIMIT 0")
            .is_err()
        {
            conn.execute("ALTER TABLE sections ADD COLUMN elevation_gain_m REAL", [])?;
            conn.execute("ALTER TABLE sections ADD COLUMN avg_grade_percent REAL", [])?;
        }
        Ok(())
    }

    /// Every index on `sections` as `CREATE INDEX IF NOT EXISTS`, so a rebuild
    /// can replay what a migration added without naming it here. Indexes
    /// SQLite made itself for a UNIQUE or PRIMARY KEY have no `sql` and come
    /// back with the table definition.
    fn sections_index_ddl(conn: &Connection) -> SqlResult<Vec<String>> {
        conn.prepare(
            "SELECT sql FROM sqlite_master
             WHERE type = 'index' AND tbl_name = 'sections' AND sql IS NOT NULL",
        )?
        .query_map([], |row| row.get::<_, String>(0))?
        .map(|sql| sql.map(|sql| sql.replacen("CREATE INDEX ", "CREATE INDEX IF NOT EXISTS ", 1)))
        .collect()
    }

    /// Add to `to` any column `from` carries that the rebuild's fixed DDL does
    /// not name, so a migration written after this hook keeps its data and its
    /// indexes. NOT NULL without a default cannot be added to a populated
    /// table, so that column is added nullable rather than failing the swap.
    fn carry_forward_columns(conn: &Connection, from: &str, to: &str) -> SqlResult<()> {
        let existing: Vec<String> = conn
            .prepare(&format!("PRAGMA table_info({to})"))?
            .query_map([], |row| row.get::<_, String>(1))?
            .collect::<SqlResult<_>>()?;
        let source: Vec<(String, String, i64, Option<String>)> = conn
            .prepare(&format!("PRAGMA table_info({from})"))?
            .query_map([], |row| {
                Ok((row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
            })?
            .collect::<SqlResult<_>>()?;
        for (name, kind, notnull, default) in source {
            if existing.contains(&name) {
                continue;
            }
            let mut ddl = format!("ALTER TABLE {to} ADD COLUMN \"{name}\" {kind}");
            if let Some(default) = &default {
                ddl.push_str(&format!(" DEFAULT {default}"));
                if notnull != 0 {
                    ddl.push_str(" NOT NULL");
                }
            }
            conn.execute(&ddl, [])?;
            log::info!("veloqrs: [Schema] carried {name} through the sections rebuild");
        }
        Ok(())
    }

    /// Columns the two tables share, in the destination's order.
    fn shared_columns(conn: &Connection, from: &str, to: &str) -> SqlResult<String> {
        let names = |table: &str| -> SqlResult<Vec<String>> {
            conn.prepare(&format!("PRAGMA table_info({table})"))?
                .query_map([], |row| row.get::<_, String>(1))?
                .collect()
        };
        let source = names(from)?;
        let shared: Vec<String> = names(to)?
            .into_iter()
            .filter(|name| source.contains(name))
            .collect();
        Ok(shared.join(", "))
    }

    /// Rebuild `sections` so `polyline_json` is nullable. The blob has been
    /// the geometry since 0.3.0 and the column has carried a placeholder
    /// since; a NOT NULL column that every write must fill with nothing is a
    /// trap for the next writer. SQLite cannot drop a constraint in place, so
    /// this is a copy-swap. Foreign keys go off around it, outside the
    /// transaction where the pragma is a no-op: with them on, dropping a
    /// referenced table cascades a delete into every junction row.
    fn ensure_sections_polyline_nullable(conn: &Connection) -> SqlResult<()> {
        let not_null = conn
            .prepare("PRAGMA table_info(sections)")?
            .query_map([], |row| {
                Ok((row.get::<_, String>(1)?, row.get::<_, i64>(3)?))
            })?
            .filter_map(|r| r.ok())
            .any(|(name, notnull)| name == "polyline_json" && notnull != 0);
        if !not_null {
            return Ok(());
        }
        conn.pragma_update(None, "foreign_keys", "OFF")?;
        let rebuilt = Self::rebuild_sections_nullable(conn);
        let restored = conn.pragma_update(None, "foreign_keys", "ON");
        rebuilt?;
        restored
    }

    /// One transaction: a leftover from a torn run is dropped first, the old
    /// table survives any failure, and the swap is atomic.
    fn rebuild_sections_nullable(conn: &Connection) -> SqlResult<()> {
        // Both the copied columns and the replayed indexes are read off the
        // live table, so a column or index a later migration adds survives a
        // rebuild that predates it.
        let index_ddl = Self::sections_index_ddl(conn)?;
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(
            "DROP TABLE IF EXISTS sections_rebuild;
             CREATE TABLE sections_rebuild (
                 id TEXT PRIMARY KEY,
                 section_type TEXT NOT NULL CHECK(section_type IN ('auto', 'custom')),
                 name TEXT,
                 sport_type TEXT NOT NULL,
                 polyline_json TEXT,
                 distance_meters REAL NOT NULL,
                 representative_activity_id TEXT,
                 confidence REAL,
                 observation_count INTEGER,
                 average_spread REAL,
                 point_density_json TEXT,
                 scale TEXT,
                 version INTEGER DEFAULT 1,
                 is_user_defined INTEGER DEFAULT 0,
                 stability REAL,
                 source_activity_id TEXT,
                 start_index INTEGER,
                 end_index INTEGER,
                 created_at TEXT NOT NULL DEFAULT (datetime('now')),
                 updated_at TEXT,
                 bounds_min_lat REAL,
                 bounds_max_lat REAL,
                 bounds_min_lng REAL,
                 bounds_max_lng REAL,
                 original_polyline_json TEXT,
                 disabled INTEGER NOT NULL DEFAULT 0,
                 superseded_by TEXT DEFAULT NULL,
                 consensus_state_blob BLOB,
                 polyline_blob BLOB,
                 point_density_blob BLOB,
                 visit_count INTEGER NOT NULL DEFAULT 0,
                 rep_start_index INTEGER,
                 rep_end_index INTEGER,
                 geometry_source TEXT
                     CHECK(geometry_source IS NULL
                           OR geometry_source IN ('exact', 'consensus', 'orphaned')),
                 elevation_gain_m REAL,
                 avg_grade_percent REAL,
                 activity_count INTEGER NOT NULL DEFAULT 0,
                 sport_types TEXT,
                 elevation_loss_m REAL,
                 max_grade_percent REAL,
                 straightness REAL,
                 klass TEXT,
                 is_lift INTEGER NOT NULL DEFAULT 0,
                 rank_score REAL,
                 sport_rank_score REAL
             );",
        )?;
        Self::carry_forward_columns(&tx, "sections", "sections_rebuild")?;
        let columns = Self::shared_columns(&tx, "sections", "sections_rebuild")?;
        tx.execute(
            &format!("INSERT INTO sections_rebuild ({columns}) SELECT {columns} FROM sections"),
            [],
        )?;
        // The visit_count triggers name `sections` in their bodies, and a
        // RENAME re-parses every trigger; with the table gone that fails.
        // They come back through `ensure_visit_count_denormalisation` below.
        tx.execute_batch(
            "DROP TRIGGER IF EXISTS section_activities_visit_count_ai;
             DROP TRIGGER IF EXISTS section_activities_visit_count_ad;
             DROP TRIGGER IF EXISTS section_activities_visit_count_au;
             DROP TRIGGER IF EXISTS section_activities_visit_count_amove;
             DROP TRIGGER IF EXISTS section_activities_summary_ai;
             DROP TRIGGER IF EXISTS section_activities_summary_ad;
             DROP TRIGGER IF EXISTS section_activities_summary_au;
             DROP TRIGGER IF EXISTS section_activities_summary_amove;
             DROP TABLE sections;
             ALTER TABLE sections_rebuild RENAME TO sections;
             CREATE INDEX IF NOT EXISTS idx_sections_type ON sections(section_type);
             CREATE INDEX IF NOT EXISTS idx_sections_sport ON sections(sport_type);
             CREATE INDEX IF NOT EXISTS idx_sections_disabled ON sections(disabled);
             CREATE INDEX IF NOT EXISTS idx_sections_superseded ON sections(superseded_by);",
        )?;
        for ddl in &index_ddl {
            tx.execute_batch(ddl)?;
        }
        tx.commit()?;
        Self::ensure_visit_count_denormalisation(conn)?;
        Self::ensure_section_summary_denormalisation(conn)?;
        let violations: i64 =
            conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
                row.get(0)
            })?;
        if violations > 0 {
            log::warn!(
                "veloqrs: [Schema] {} foreign key rows dangling after the sections rebuild",
                violations
            );
        }
        Ok(())
    }

    /// Add the `section_geometry` provenance triple. Keyed on column presence,
    /// because 017 creates the table only when absent and so cannot reach one a
    /// database already carries. Nullable throughout: a corridor-era version is
    /// an averaged line belonging to no single activity.
    fn ensure_section_geometry_provenance(conn: &Connection) -> SqlResult<()> {
        let table_exists = conn
            .prepare("SELECT section_id FROM section_geometry LIMIT 0")
            .is_ok();
        // Probes the last column added, inside one transaction, so a torn run
        // leaves nothing and the next open retries.
        if table_exists
            && conn
                .prepare("SELECT rep_end_index FROM section_geometry LIMIT 0")
                .is_err()
        {
            conn.execute_batch(
                "BEGIN;
                 ALTER TABLE section_geometry ADD COLUMN rep_activity_id TEXT;
                 ALTER TABLE section_geometry ADD COLUMN rep_start_index INTEGER;
                 ALTER TABLE section_geometry ADD COLUMN rep_end_index INTEGER;
                 COMMIT;",
            )?;
        }
        // Separately probed: a database that took the triple from an earlier
        // build has the columns above and not this one.
        if table_exists
            && conn
                .prepare("SELECT source FROM section_geometry LIMIT 0")
                .is_err()
        {
            conn.execute(
                "ALTER TABLE section_geometry ADD COLUMN source TEXT
                 CHECK(source IS NULL OR source IN ('exact', 'consensus', 'orphaned'))",
                [],
            )?;
        }
        // The count of the stream a version was sliced from, checked before a
        // re-slice. Backfilled from the track while it is still stored; a
        // version whose stream is gone stays NULL, which reads as unverifiable.
        if table_exists
            && conn
                .prepare("SELECT point_count FROM section_geometry LIMIT 0")
                .is_err()
        {
            conn.execute_batch(
                "BEGIN;
                 ALTER TABLE section_geometry ADD COLUMN point_count INTEGER;
                 UPDATE section_geometry
                 SET point_count = (SELECT point_count FROM gps_tracks
                                    WHERE activity_id = section_geometry.rep_activity_id)
                 WHERE rep_activity_id IS NOT NULL;
                 COMMIT;",
            )?;
        }
        Ok(())
    }

    /// Add the live row's provenance triple. `section_geometry` carries one per
    /// stored version; these carry it for the geometry a section holds now, so a
    /// read can re-slice the stored stream instead of decoding the cached blob.
    fn ensure_sections_geometry_provenance(conn: &Connection) -> SqlResult<()> {
        // Probes the last column added, inside one transaction, so a torn run
        // leaves nothing and the next open retries.
        if conn
            .prepare("SELECT geometry_source FROM sections LIMIT 0")
            .is_err()
        {
            conn.execute_batch(
                "BEGIN;
                 ALTER TABLE sections ADD COLUMN rep_start_index INTEGER;
                 ALTER TABLE sections ADD COLUMN rep_end_index INTEGER;
                 ALTER TABLE sections ADD COLUMN geometry_source TEXT
                     CHECK(geometry_source IS NULL
                           OR geometry_source IN ('exact', 'consensus', 'orphaned'));
                 COMMIT;",
            )?;
        }
        Ok(())
    }

    /// Move a hand-cut section's source range across to the reference triple.
    ///
    /// `create_section` wrote `source_activity_id`, `start_index` and
    /// `end_index` and left the triple the resolver reads empty, so every
    /// section the athlete cut from a ride reads as having no provenance and
    /// cannot re-slice the stream it came from. The source range is inclusive
    /// and the triple is half-open, hence the `+ 1`. Scoped to rows that carry
    /// a source range that spans more than one point and no triple, which no
    /// other writer produces, and rerunnable because the same predicate stops
    /// matching once it has run.
    fn backfill_custom_section_reference(conn: &Connection) -> SqlResult<()> {
        let repaired = conn.execute(
            "UPDATE sections
                SET rep_start_index = start_index,
                    rep_end_index = end_index + 1,
                    geometry_source = 'exact'
              WHERE source_activity_id IS NOT NULL
                AND source_activity_id <> ''
                AND start_index IS NOT NULL
                AND end_index > start_index
                AND rep_start_index IS NULL",
            [],
        )?;
        if repaired > 0 {
            log::info!(
                "veloqrs: [Migration] Gave {repaired} hand-cut sections their reference triple"
            );
        }
        Ok(())
    }

    /// Give every pre-ledger section a birth geometry version and one backdated
    /// event, so the first change to it has a prior to sit beside. One-shot and
    /// non-fatal: this runs on the open that quarantines a database it cannot
    /// migrate, and a missing baseline is a thinner history, not a broken one.
    fn ensure_section_geometry_baseline(conn: &Connection, schema_from: i32) {
        match sections::history::seed_baseline_geometry_on(conn, schema_from) {
            Ok((0, 0)) => {}
            // A skipped section has an undecodable or empty line, which no
            // later open can improve on, so the marker still lands and the
            // count is the only record that it was passed over.
            Ok((seeded, skipped)) => log::info!(
                "veloqrs: [Migration] Seeded baseline geometry for {seeded} sections, skipped {skipped}"
            ),
            Err(e) => log::warn!("veloqrs: [Migration] Baseline geometry seeding failed: {e}"),
        }
    }

    /// Add the visit_count column, backfill it once, and create the
    /// recompute triggers. Idempotent and self-healing: the column is added only
    /// when absent (SQLite has no ADD COLUMN IF NOT EXISTS), the backfill runs only
    /// on that first add (a fresh column is all-zero), and the triggers use
    /// CREATE ... IF NOT EXISTS, except the insert trigger, which is recreated
    /// once when it predates the bulk guard. get_section_summaries then reads visit_count
    /// straight off the row instead of a per-open GROUP BY over the junction; the
    /// triggers keep it correct on every section_activities write,
    /// including the merge paths that reassign rows with UPDATE ... SET
    /// section_id (both sides recompute) and foreign-key cascade deletes
    /// (recursive_triggers only gates trigger re-entry, not user triggers
    /// under FK actions; probed live). remove_activity still recomputes the
    /// affected sections as a redundant backstop.
    fn ensure_visit_count_denormalisation(conn: &Connection) -> SqlResult<()> {
        let has_column = conn
            .prepare("SELECT visit_count FROM sections LIMIT 0")
            .is_ok();
        // A database opened by a build whose trigger set missed row moves can
        // hold counts a merge left behind, so repair alongside the first add.
        let has_move_trigger: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master
                 WHERE type = 'trigger' AND name = 'section_activities_visit_count_amove'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);
        if !has_column {
            conn.execute(
                "ALTER TABLE sections ADD COLUMN visit_count INTEGER NOT NULL DEFAULT 0",
                [],
            )?;
        }
        if !has_column || !has_move_trigger {
            conn.execute(
                "UPDATE sections SET visit_count = (
                    SELECT COUNT(*) FROM section_activities sa
                    WHERE sa.section_id = sections.id AND sa.excluded = 0
                )",
                [],
            )?;
        }
        if !trigger_has_guard(conn, "section_activities_visit_count_ai") {
            conn.execute_batch("DROP TRIGGER IF EXISTS section_activities_visit_count_ai")?;
        }
        conn.execute_batch(&format!(
            "CREATE TRIGGER IF NOT EXISTS section_activities_visit_count_ai
             AFTER INSERT ON section_activities {SUMMARY_TRIGGER_GUARD} BEGIN
                 UPDATE sections SET visit_count = (
                     SELECT COUNT(*) FROM section_activities
                     WHERE section_id = NEW.section_id AND excluded = 0
                 ) WHERE id = NEW.section_id;
             END;
             CREATE TRIGGER IF NOT EXISTS section_activities_visit_count_ad
             AFTER DELETE ON section_activities BEGIN
                 UPDATE sections SET visit_count = (
                     SELECT COUNT(*) FROM section_activities
                     WHERE section_id = OLD.section_id AND excluded = 0
                 ) WHERE id = OLD.section_id;
             END;
             CREATE TRIGGER IF NOT EXISTS section_activities_visit_count_au
             AFTER UPDATE OF excluded ON section_activities BEGIN
                 UPDATE sections SET visit_count = (
                     SELECT COUNT(*) FROM section_activities
                     WHERE section_id = NEW.section_id AND excluded = 0
                 ) WHERE id = NEW.section_id;
             END;
             CREATE TRIGGER IF NOT EXISTS section_activities_visit_count_amove
             AFTER UPDATE OF section_id ON section_activities BEGIN
                 UPDATE sections SET visit_count = (
                     SELECT COUNT(*) FROM section_activities
                     WHERE section_id = NEW.section_id AND excluded = 0
                 ) WHERE id = NEW.section_id;
                 UPDATE sections SET visit_count = (
                     SELECT COUNT(*) FROM section_activities
                     WHERE section_id = OLD.section_id AND excluded = 0
                 ) WHERE id = OLD.section_id;
             END;"
        ))?;
        Ok(())
    }

    /// Denormalise the two summary aggregates the section list reads on
    /// every render, `activity_count` (distinct included activities) and
    /// `sport_types` (their sports, comma-joined), onto the row, kept by
    /// triggers beside the visit_count ones so a junction change updates the
    /// summary in the same statement.
    fn ensure_section_summary_denormalisation(conn: &Connection) -> SqlResult<()> {
        let has_columns = conn
            .prepare("SELECT activity_count, sport_types FROM sections LIMIT 0")
            .is_ok();
        if !has_columns {
            conn.execute_batch(
                "ALTER TABLE sections ADD COLUMN activity_count INTEGER NOT NULL DEFAULT 0;
                 ALTER TABLE sections ADD COLUMN sport_types TEXT;",
            )?;
        }
        let has_trigger: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM sqlite_master
                 WHERE type = 'trigger' AND name = 'section_activities_summary_ai'",
                [],
                |row| row.get(0),
            )
            .unwrap_or(false);
        let has_guard = trigger_has_guard(conn, "section_activities_summary_ai");
        if has_columns && has_trigger && has_guard {
            return Ok(());
        }
        recount_section_summaries(conn, "1")?;
        // One body, four firings: the recount for whichever section the row
        // touched, on insert, delete, exclusion flip and section move.
        let recount = |key: &str| {
            format!(
                "UPDATE sections SET
                     activity_count = (
                         SELECT COUNT(DISTINCT activity_id) FROM section_activities
                         WHERE section_id = {key} AND excluded = 0),
                     sport_types = (
                         SELECT GROUP_CONCAT(DISTINCT a.sport_type) FROM section_activities sa
                         JOIN activities a ON a.id = sa.activity_id
                         WHERE sa.section_id = {key} AND sa.excluded = 0)
                 WHERE id = {key};"
            )
        };
        conn.execute_batch(&format!(
            "DROP TRIGGER IF EXISTS section_activities_summary_ai;
             DROP TRIGGER IF EXISTS section_activities_summary_ad;
             DROP TRIGGER IF EXISTS section_activities_summary_au;
             DROP TRIGGER IF EXISTS section_activities_summary_amove;
             CREATE TRIGGER section_activities_summary_ai
             AFTER INSERT ON section_activities {SUMMARY_TRIGGER_GUARD} BEGIN {new_} END;
             CREATE TRIGGER section_activities_summary_ad
             AFTER DELETE ON section_activities BEGIN {old} END;
             CREATE TRIGGER section_activities_summary_au
             AFTER UPDATE OF excluded ON section_activities BEGIN {new_} END;
             CREATE TRIGGER section_activities_summary_amove
             AFTER UPDATE OF section_id ON section_activities BEGIN {new_} {old} END;",
            new_ = recount("NEW.section_id"),
            old = recount("OLD.section_id"),
        ))?;
        Ok(())
    }

    /// The triggers that keep the stored ranking inputs honest: any change to a
    /// traversal, to what makes one complete or a section visible, to an
    /// activity's date or sport, marks the section for a recompute.
    ///
    /// They are made on every open and not by the migration, because the
    /// rebuilds of `sections` and `section_activities` drop the triggers on
    /// those tables, and a trigger body that names a table a rebuild has
    /// dropped makes the rename fail. Each inserts with `ON CONFLICT DO
    /// NOTHING` and not `OR IGNORE`: a statement that fires a trigger imposes
    /// its own conflict policy on the trigger's inserts, so an `INSERT OR
    /// REPLACE` on the junction would otherwise fail on a section already
    /// marked.
    fn ensure_section_rank_triggers(conn: &Connection) -> SqlResult<()> {
        conn.execute_batch(
            r#"CREATE TRIGGER IF NOT EXISTS section_rank_dirty_sections_au
AFTER UPDATE OF distance_meters, disabled, superseded_by ON sections BEGIN
    INSERT INTO section_rank_dirty (section_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
END;

CREATE TRIGGER IF NOT EXISTS section_rank_dirty_sections_ad AFTER DELETE ON sections BEGIN
    DELETE FROM section_rank_inputs WHERE section_id = OLD.id;
    DELETE FROM section_rank_dirty WHERE section_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS section_rank_dirty_sa_ai AFTER INSERT ON section_activities BEGIN
    INSERT INTO section_rank_dirty (section_id) VALUES (NEW.section_id) ON CONFLICT DO NOTHING;
END;

CREATE TRIGGER IF NOT EXISTS section_rank_dirty_sa_ad AFTER DELETE ON section_activities BEGIN
    INSERT INTO section_rank_dirty (section_id) VALUES (OLD.section_id) ON CONFLICT DO NOTHING;
END;

CREATE TRIGGER IF NOT EXISTS section_rank_dirty_sa_au AFTER UPDATE ON section_activities BEGIN
    INSERT INTO section_rank_dirty (section_id) VALUES (OLD.section_id) ON CONFLICT DO NOTHING;
    INSERT INTO section_rank_dirty (section_id) VALUES (NEW.section_id) ON CONFLICT DO NOTHING;
END;

CREATE TRIGGER IF NOT EXISTS section_rank_dirty_metrics_ai AFTER INSERT ON activity_metrics BEGIN
    INSERT INTO section_rank_dirty_activity (activity_id) VALUES (NEW.activity_id) ON CONFLICT DO NOTHING;
END;

CREATE TRIGGER IF NOT EXISTS section_rank_dirty_metrics_au AFTER UPDATE OF date ON activity_metrics BEGIN
    INSERT INTO section_rank_dirty_activity (activity_id) VALUES (NEW.activity_id) ON CONFLICT DO NOTHING;
END;

CREATE TRIGGER IF NOT EXISTS section_rank_dirty_metrics_sport_au AFTER UPDATE OF sport_type ON activity_metrics BEGIN
    INSERT INTO section_rank_dirty_activity (activity_id) VALUES (NEW.activity_id) ON CONFLICT DO NOTHING;
END;

CREATE TRIGGER IF NOT EXISTS section_rank_dirty_metrics_ad AFTER DELETE ON activity_metrics BEGIN
    INSERT INTO section_rank_dirty_activity (activity_id) VALUES (OLD.activity_id) ON CONFLICT DO NOTHING;
END;

CREATE TRIGGER IF NOT EXISTS section_rank_dirty_activities_au AFTER UPDATE OF sport_type ON activities BEGIN
    INSERT INTO section_rank_dirty_activity (activity_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
END;"#,
        )
    }

    /// The stored visible section count, its triggers and the index that lists
    /// the sections with no name of their own.
    ///
    /// Made on every open, like the ranking triggers, because a rebuild of
    /// `sections` drops the triggers and the index and copies its rows without
    /// firing them. The count is reseeded here for the same reason. A writer
    /// that replaces a section row would skip the delete trigger, so sections
    /// are written by insert, upsert or update only.
    fn ensure_section_visible_count(conn: &Connection) -> SqlResult<()> {
        conn.execute_batch(
            r#"CREATE INDEX IF NOT EXISTS idx_sections_unnamed ON sections(id) WHERE name IS NULL;

CREATE TRIGGER IF NOT EXISTS section_visible_count_ai
AFTER INSERT ON sections WHEN NEW.disabled = 0 AND NEW.superseded_by IS NULL BEGIN
    INSERT INTO section_visible_count (id, n) VALUES (1, 1)
    ON CONFLICT(id) DO UPDATE SET n = n + 1;
END;

CREATE TRIGGER IF NOT EXISTS section_visible_count_ad
AFTER DELETE ON sections WHEN OLD.disabled = 0 AND OLD.superseded_by IS NULL BEGIN
    INSERT INTO section_visible_count (id, n) VALUES (1, -1)
    ON CONFLICT(id) DO UPDATE SET n = n - 1;
END;

CREATE TRIGGER IF NOT EXISTS section_visible_count_au
AFTER UPDATE OF disabled, superseded_by ON sections BEGIN
    INSERT INTO section_visible_count (id, n) VALUES (1,
        (NEW.disabled = 0 AND NEW.superseded_by IS NULL)
        - (OLD.disabled = 0 AND OLD.superseded_by IS NULL))
    ON CONFLICT(id) DO UPDATE SET n = n
        + (NEW.disabled = 0 AND NEW.superseded_by IS NULL)
        - (OLD.disabled = 0 AND OLD.superseded_by IS NULL);
END;

INSERT INTO section_visible_count (id, n)
SELECT 1, COUNT(*) FROM sections WHERE disabled = 0 AND superseded_by IS NULL
ON CONFLICT(id) DO UPDATE SET n = excluded.n;"#,
        )
    }

    /// Re-mint every clock-minted section id as a content id and re-key
    /// every table that holds it, once, in one transaction. Ids used to be
    /// `s_<millis>__<seq>`: unique, but two devices cutting the same ground
    /// could never agree. A content id is the global cell of the section's
    /// heart, so they can. Foreign keys are deferred to the
    /// commit, so parents and children move in any order.
    fn ensure_content_ids(conn: &Connection) -> SqlResult<()> {
        const MARKER: &str = "content_ids_v1";
        let done: Option<String> = conn
            .query_row(
                "SELECT value FROM schema_info WHERE key = ?",
                params![MARKER],
                |row| row.get(0),
            )
            .ok();
        if done.is_some() {
            return Ok(());
        }
        let has_columns = conn
            .prepare("SELECT polyline_blob, polyline_json FROM sections LIMIT 0")
            .is_ok();
        if !has_columns {
            return Ok(());
        }
        // The triple arrived later than the blob. A database old enough to
        // reach here without it has nothing to rebuild from, so the read is
        // the blob alone on that path and the resolver's on every other.
        let has_reference = conn
            .prepare("SELECT rep_start_index FROM sections LIMIT 0")
            .is_ok();

        // Every clock-minted auto id with the line to anchor it, oldest
        // first so a shared cell resolves in first-seen order.
        type ClockMinted = (
            String,
            Option<Vec<u8>>,
            Option<String>,
            Option<String>,
            Option<u32>,
            Option<u32>,
        );
        let mut stmt = conn.prepare(if has_reference {
            "SELECT id, polyline_blob, polyline_json,
                    representative_activity_id, rep_start_index, rep_end_index
             FROM sections
             WHERE id GLOB 's_[0-9]*__[0-9]*'
             ORDER BY created_at, id"
        } else {
            "SELECT id, polyline_blob, polyline_json,
                    NULL, NULL, NULL
             FROM sections
             WHERE id GLOB 's_[0-9]*__[0-9]*'
             ORDER BY created_at, id"
        })?;
        let rows: Vec<ClockMinted> = stmt
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);

        let mut taken: std::collections::BTreeSet<String> = conn
            .prepare("SELECT id FROM sections")?
            .query_map([], |row| row.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect();
        let mut renames: Vec<(String, String)> = Vec::new();
        for (old, blob, json, rep_id, start, end) in rows {
            // The blob is a cache, and the new id is a function of the line.
            // A cleared cache would leave the row on its clock-minted id for
            // ever, which is the one id two devices can never agree on.
            let reference = sections::geometry::reference(rep_id.as_deref(), start, end);
            let Ok(polyline) =
                sections::geometry::line(conn, blob.as_deref(), json.as_deref(), reference)
            else {
                continue;
            };
            let Some(new) = sections::content_id_for(&polyline, &taken) else {
                continue;
            };
            taken.remove(&old);
            taken.insert(new.clone());
            renames.push((old, new));
        }

        let tx = conn.unchecked_transaction()?;
        tx.execute("PRAGMA defer_foreign_keys = ON", [])?;
        for (old, new) in &renames {
            for sql in [
                "UPDATE sections SET id = ?2 WHERE id = ?1",
                "UPDATE sections SET superseded_by = ?2 WHERE superseded_by = ?1",
                "UPDATE section_activities SET section_id = ?2 WHERE section_id = ?1",
                "UPDATE section_history SET section_id = ?2 WHERE section_id = ?1",
                "UPDATE section_geometry SET section_id = ?2 WHERE section_id = ?1",
                "UPDATE section_pins SET section_id = ?2 WHERE section_id = ?1",
                "UPDATE section_intents SET id = ?2 WHERE id = ?1",
                "UPDATE activity_indicators SET target_id = ?2
                 WHERE target_id = ?1 AND indicator_type IN ('section_pr', 'section_trend')",
            ] {
                tx.execute(sql, params![old, new])?;
            }
        }
        // The registry blob names the old ids; it reseeds from the rows.
        tx.execute(
            "DELETE FROM identity_state WHERE key = ?",
            params![sections::SECTION_IDENTITY_KEY],
        )?;
        tx.execute(
            "INSERT OR REPLACE INTO schema_info (key, value) VALUES (?, '1')",
            params![MARKER],
        )?;
        tx.commit()?;
        if !renames.is_empty() {
            log::info!(
                "veloqrs: [Schema] Re-keyed {} sections to content ids",
                renames.len()
            );
        }
        Ok(())
    }

    /// Backfill legacy auto-section names once. Migration 017 creates the
    /// named intent columns and 032 widens its key to `(id, kind)`.
    fn ensure_section_intents_named_shape(conn: &Connection) -> SqlResult<()> {
        let backfill_done: Option<String> = conn
            .query_row(
                "SELECT value FROM schema_info WHERE key = 'named_backfill_done'",
                [],
                |row| row.get(0),
            )
            .ok();
        if backfill_done.is_none() {
            Self::backfill_named_intents(conn)?;
            conn.execute(
                "INSERT OR REPLACE INTO schema_info (key, value) VALUES ('named_backfill_done', '1')",
                [],
            )?;
        }
        Self::backfill_legacy_suppression_intents(conn)
    }

    /// Give every row hidden or replaced before suppression intents existed a
    /// disabled intent, once. Older builds recorded both only on the row, and
    /// the cutover's cold detect reads suppression from intents alone, so a
    /// hidden section's ground would come back under a new id.
    fn backfill_legacy_suppression_intents(conn: &Connection) -> SqlResult<()> {
        const MARKER: &str = "legacy_suppression_backfill_done";
        let done: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_info WHERE key = ?)",
            params![MARKER],
            |row| row.get(0),
        )?;
        if done {
            return Ok(());
        }
        let has_reference = conn
            .prepare("SELECT rep_start_index, rep_end_index FROM sections LIMIT 0")
            .is_ok();
        let query = if has_reference {
            "SELECT id, polyline_json, polyline_blob,
                    representative_activity_id, rep_start_index, rep_end_index
             FROM sections WHERE disabled = 1 OR superseded_by IS NOT NULL"
        } else {
            "SELECT id, polyline_json, polyline_blob, NULL, NULL, NULL
             FROM sections WHERE disabled = 1 OR superseded_by IS NOT NULL"
        };
        type SuppressedRow = (
            String,
            Option<String>,
            Option<Vec<u8>>,
            Option<String>,
            Option<u32>,
            Option<u32>,
        );
        let rows: Vec<SuppressedRow> = conn
            .prepare(query)?
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            })?
            .flatten()
            .collect();
        let tx = conn.unchecked_transaction()?;
        let mut promoted = 0usize;
        for (id, polyline_json, blob, rep_id, start, end) in rows {
            let reference = super::sections::geometry::reference(rep_id.as_deref(), start, end);
            let Ok(polyline) = super::sections::geometry::line(
                conn,
                blob.as_deref(),
                polyline_json.as_deref(),
                reference,
            ) else {
                continue;
            };
            if polyline.is_empty() {
                continue;
            }
            promoted += tx.execute(
                "INSERT OR IGNORE INTO section_intents (id, kind, polyline_blob, created_at)
                 VALUES (?, 'disabled', ?, datetime('now'))",
                params![id, codec::serialize_track_points(&polyline)],
            )?;
        }
        tx.execute(
            "INSERT INTO schema_info (key, value) VALUES (?, '1')",
            params![MARKER],
        )?;
        tx.commit()?;
        if promoted > 0 {
            log::info!(
                "veloqrs: [Schema] Promoted {promoted} legacy hidden sections to disabled intents"
            );
        }
        Ok(())
    }

    fn repair_orphan_supersession(conn: &Connection) -> SqlResult<()> {
        const MARKER: &str = "orphan_superseded_repair_done";
        let done: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM schema_info WHERE key = ?)",
            params![MARKER],
            |row| row.get(0),
        )?;
        if done {
            return Ok(());
        }
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "UPDATE sections SET superseded_by = NULL
             WHERE superseded_by IS NOT NULL
               AND NOT EXISTS (
                   SELECT 1 FROM sections owner WHERE owner.id = sections.superseded_by
               )",
            [],
        )?;
        tx.execute(
            "INSERT INTO schema_info (key, value) VALUES (?, '1')",
            params![MARKER],
        )?;
        tx.commit()
    }

    /// Promote legacy user names on auto rows into named intents. Before named
    /// corridors, `set_section_name` wrote plain row names that die with the
    /// row on the next re-cut; any auto-row name that is not a section
    /// handle ("<word> N", legacy "<sport> <word> N", in any shipped
    /// language) is user data and becomes a durable intent seeded with the
    /// row's footprint.
    fn backfill_named_intents(conn: &Connection) -> SqlResult<()> {
        Self::promote_legacy_named_rows(conn, conn, true)?;
        Ok(())
    }

    pub(crate) fn promote_legacy_named_rows(
        source: &Connection,
        destination: &Connection,
        clear_source_names: bool,
    ) -> SqlResult<usize> {
        use super::sections::is_section_handle;

        let has_reference = source
            .prepare("SELECT rep_start_index, rep_end_index FROM sections LIMIT 0")
            .is_ok();
        let query = if has_reference {
            "SELECT id, name, polyline_json, sport_type, polyline_blob,
                    representative_activity_id, rep_start_index, rep_end_index
             FROM sections WHERE section_type = 'auto' AND is_user_defined = 0
               AND name IS NOT NULL"
        } else {
            "SELECT id, name, polyline_json, sport_type, polyline_blob,
                    NULL, NULL, NULL
             FROM sections WHERE section_type = 'auto' AND is_user_defined = 0
               AND name IS NOT NULL"
        };
        let mut stmt = source.prepare(query)?;
        type NamedRow = (
            String,
            String,
            Option<String>,
            String,
            Option<Vec<u8>>,
            Option<String>,
            Option<u32>,
            Option<u32>,
        );
        let rows: Vec<NamedRow> = stmt
            .query_map([], |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                ))
            })?
            .flatten()
            .collect();
        let mut promoted = 0usize;
        for (section_id, name, polyline_json, sport_type, polyline_blob, rep_id, start, end) in rows
        {
            if is_section_handle(&name) {
                continue;
            }
            let reference = super::sections::geometry::reference(rep_id.as_deref(), start, end);
            // A line that reads as empty would give the intent no footprint,
            // and one without a footprint never resolves, so the row keeps
            // its name instead.
            let Ok(polyline) = super::sections::geometry::line(
                source,
                polyline_blob.as_deref(),
                polyline_json.as_deref(),
                reference,
            ) else {
                continue;
            };
            if polyline.is_empty() {
                continue;
            }
            destination.execute(
                "INSERT OR IGNORE INTO section_intents (id, kind, polyline_blob, created_at, name, sport_type)
                 VALUES (?, 'named', ?, datetime('now'), ?, ?)",
                params![
                    format!("ni_bf_{section_id}"),
                    codec::serialize_track_points(&polyline),
                    name,
                    sport_type
                ],
            )?;
            // The intent is the name's home now; a surviving row copy would
            // resurface after an unname and make the name unremovable.
            if clear_source_names {
                source.execute(
                    "UPDATE sections SET name = NULL WHERE id = ?",
                    params![section_id],
                )?;
            }
            promoted += 1;
        }
        if promoted > 0 {
            log::info!(
                "veloqrs: [Schema] Promoted {promoted} legacy section names to named intents"
            );
        }
        Ok(promoted)
    }

    /// Populate performance cache for all existing section portions.
    /// Called during migration from schema v2 to v3.
    fn populate_performance_cache(conn: &Connection) -> SqlResult<()> {
        // Get all unique section IDs that need population
        let section_ids: Vec<String> = conn
            .prepare("SELECT DISTINCT section_id FROM section_activities WHERE lap_time IS NULL")?
            .query_map([], |row| row.get(0))?
            .collect::<Result<Vec<String>, _>>()?;

        let total_sections = section_ids.len();
        log::info!(
            "veloqrs: [Migration] Found {} sections needing performance cache population",
            total_sections
        );

        let mut total_portions = 0;
        let mut populated_portions = 0;

        for (section_idx, section_id) in section_ids.iter().enumerate() {
            if section_idx % 10 == 0 && section_idx > 0 {
                log::info!(
                    "veloqrs: [Migration] Progress: {}/{} sections, {} portions populated",
                    section_idx,
                    total_sections,
                    populated_portions
                );
            }

            // Get all portions for this section that need population
            let portions: Vec<(String, u32, u32, f64)> = conn
                .prepare(
                    "SELECT activity_id, start_index, end_index, distance_meters
                     FROM section_activities
                     WHERE section_id = ? AND lap_time IS NULL",
                )?
                .query_map([section_id], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;

            total_portions += portions.len();

            // Load time streams for all activities in this section
            let activity_ids: HashSet<String> =
                portions.iter().map(|(id, _, _, _)| id.clone()).collect();

            let mut time_streams: HashMap<String, Vec<u32>> = HashMap::new();
            // The track's length is the index space the portions are in, and a
            // stream of any other length is not in it.
            let mut track_points: HashMap<String, usize> = HashMap::new();
            for activity_id in &activity_ids {
                if let Ok(points) = conn.query_row(
                    "SELECT point_count FROM gps_tracks WHERE activity_id = ?",
                    [activity_id],
                    |row| row.get::<_, i64>(0),
                ) {
                    track_points.insert(activity_id.clone(), points as usize);
                }
                if let Ok(stream) = conn.query_row(
                    "SELECT times FROM time_streams WHERE activity_id = ?",
                    [activity_id],
                    |row| {
                        let bytes: Vec<u8> = row.get(0)?;
                        let times: Vec<u32> = codec::deserialize(&bytes).map_err(|e| {
                            log::error!("time_streams {activity_id}: times decode failed: {e}");
                            rusqlite::Error::FromSqlConversionFailure(
                                0,
                                rusqlite::types::Type::Blob,
                                e.into(),
                            )
                        })?;
                        Ok(times)
                    },
                ) {
                    time_streams.insert(activity_id.clone(), stream);
                }
            }

            // Calculate and update each portion
            let mut update_stmt = conn.prepare(
                "UPDATE section_activities
                 SET lap_time = ?, lap_pace = ?
                 WHERE section_id = ? AND activity_id = ? AND start_index = ?",
            )?;

            for (activity_id, start_idx, end_idx, distance) in portions {
                // Calculate performance metrics
                let (lap_time, lap_pace) = super::sections::compute_lap_time_from_stream(
                    time_streams.get(&activity_id).map(Vec::as_slice),
                    track_points.get(&activity_id).copied(),
                    start_idx,
                    end_idx,
                    distance,
                );

                update_stmt.execute(params![
                    lap_time,
                    lap_pace,
                    section_id,
                    activity_id,
                    start_idx,
                ])?;

                if lap_time.is_some() {
                    populated_portions += 1;
                }
            }
        }

        log::info!(
            "veloqrs: [Migration] Performance cache population complete: {}/{} portions populated",
            populated_portions,
            total_portions
        );

        Ok(())
    }

    /// Populate section bounds columns from polyline JSON during migration to v5.
    fn populate_section_bounds(conn: &Connection) -> SqlResult<()> {
        let sections: Vec<(String, String)> = conn
            .prepare(
                "SELECT id, polyline_json FROM sections
                 WHERE bounds_min_lat IS NULL AND polyline_json IS NOT NULL",
            )?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;

        if sections.is_empty() {
            return Ok(());
        }

        log::info!(
            "veloqrs: [Migration] Populating bounds for {} sections...",
            sections.len()
        );

        let mut update_stmt = conn.prepare(
            "UPDATE sections SET bounds_min_lat=?, bounds_max_lat=?, bounds_min_lng=?, bounds_max_lng=? WHERE id=?"
        )?;

        let mut populated = 0;
        for (id, polyline_json) in &sections {
            if let Ok(points) = serde_json::from_str::<Vec<GpsPoint>>(polyline_json)
                && points.len() >= 2
            {
                let bounds = tracematch::geo_utils::compute_bounds(&points);
                update_stmt.execute(params![
                    bounds.min_lat,
                    bounds.max_lat,
                    bounds.min_lng,
                    bounds.max_lng,
                    id,
                ])?;
                populated += 1;
            }
        }

        log::info!(
            "veloqrs: [Migration] Populated bounds for {}/{} sections",
            populated,
            sections.len()
        );

        Ok(())
    }

    /// Backfill activity_count column on route_groups from activity_ids JSON.
    fn populate_route_group_counts(conn: &Connection) -> SqlResult<()> {
        let groups: Vec<(String, String)> = conn
            .prepare("SELECT id, activity_ids FROM route_groups WHERE activity_count IS NULL")?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;

        if groups.is_empty() {
            return Ok(());
        }

        log::info!(
            "veloqrs: [Migration] Backfilling activity_count for {} route groups...",
            groups.len()
        );

        let mut update_stmt =
            conn.prepare("UPDATE route_groups SET activity_count = ? WHERE id = ?")?;

        for (id, activity_ids_json) in &groups {
            let count = serde_json::from_str::<Vec<String>>(activity_ids_json)
                .map(|ids| ids.len() as i64)
                .unwrap_or(0);
            update_stmt.execute(params![count, id])?;
        }

        log::info!(
            "veloqrs: [Migration] Backfilled activity_count for {} route groups",
            groups.len()
        );

        Ok(())
    }

    /// Populate all performance caches for migration from schema v3 to v4.
    /// Consolidates zone distributions, FTP history, and heatmap intensity.
    fn populate_all_performance_caches(conn: &Connection) -> SqlResult<()> {
        log::info!("veloqrs: [Migration] Populating all performance caches...");

        // Part 1: Zone distribution cache
        log::info!("veloqrs: [Migration]   - Populating zone cache from JSON blobs...");
        let mut stmt = conn.prepare(
            "SELECT activity_id, power_zone_times, hr_zone_times FROM activity_metrics
             WHERE power_zone_times IS NOT NULL OR hr_zone_times IS NOT NULL",
        )?;

        let mut update_stmt = conn.prepare(
            "UPDATE activity_metrics
             SET power_z1=?, power_z2=?, power_z3=?, power_z4=?, power_z5=?, power_z6=?, power_z7=?,
                 hr_z1=?, hr_z2=?, hr_z3=?, hr_z4=?, hr_z5=?
             WHERE activity_id=?",
        )?;

        let activities: Vec<(String, Option<String>, Option<String>)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
            .collect::<Result<Vec<_>, _>>()?;

        for (id, power_json, hr_json) in activities {
            let power_zones: Vec<f64> = power_json
                .and_then(|json| serde_json::from_str(&json).ok())
                .unwrap_or_else(|| vec![0.0; 7]);
            let hr_zones: Vec<f64> = hr_json
                .and_then(|json| serde_json::from_str(&json).ok())
                .unwrap_or_else(|| vec![0.0; 5]);

            update_stmt.execute(params![
                power_zones.first().unwrap_or(&0.0),
                power_zones.get(1).unwrap_or(&0.0),
                power_zones.get(2).unwrap_or(&0.0),
                power_zones.get(3).unwrap_or(&0.0),
                power_zones.get(4).unwrap_or(&0.0),
                power_zones.get(5).unwrap_or(&0.0),
                power_zones.get(6).unwrap_or(&0.0),
                hr_zones.first().unwrap_or(&0.0),
                hr_zones.get(1).unwrap_or(&0.0),
                hr_zones.get(2).unwrap_or(&0.0),
                hr_zones.get(3).unwrap_or(&0.0),
                hr_zones.get(4).unwrap_or(&0.0),
                id,
            ])?;
        }

        // Part 2: FTP history cache
        log::info!("veloqrs: [Migration]   - Populating FTP history cache...");
        conn.execute("DELETE FROM ftp_history", [])?;
        conn.execute(
            "INSERT INTO ftp_history (date, ftp, activity_id, sport_type)
             SELECT date, ftp, activity_id, sport_type
             FROM activity_metrics
             WHERE ftp IS NOT NULL
             ORDER BY date DESC",
            [],
        )?;

        // Part 3: Heatmap intensity cache
        log::info!("veloqrs: [Migration]   - Populating heatmap intensity cache...");
        recompute_all_heatmap(conn)?;

        log::info!("veloqrs: [Migration] All performance caches populated successfully");
        Ok(())
    }
}

#[cfg(test)]
#[path = "tests/schema.rs"]
mod tests;
