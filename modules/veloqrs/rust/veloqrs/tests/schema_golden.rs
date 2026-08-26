//! Golden schema snapshots, one artefact per SCHEMA_VERSION.
//!
//! One side of the comparison must be a checked-in artefact. A schema derived
//! from the same `include_str!` list as the other side moves with it, so an
//! edited `DEFAULT` inside 012 changes both and compares equal.
//!
//! The comparison is semantic, not textual. Columns come from
//! `pragma table_info`, indexes and foreign keys from their pragmas, and the
//! DDL that is only available as text (indexes, triggers, views) is whitespace
//! and quote normalised. SQLite stores DDL verbatim, so a raw string compare
//! would fail on a reindented migration while missing a renamed column.
//!
//! Regenerate after an intended schema change:
//!   UPDATE_GOLDEN=1 cargo test -p veloqrs --test schema_golden

mod migration_support;

use migration_support::*;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use tempfile::TempDir;
use veloqrs::PersistentRouteEngine;

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/schema")
}

fn updating() -> bool {
    std::env::var("UPDATE_GOLDEN").is_ok_and(|v| v == "1")
}

// ---------------------------------------------------------------------------
// Canonical form
// ---------------------------------------------------------------------------

/// Collapse the incidental parts of a DDL string: run-length whitespace, the
/// optional `IF NOT EXISTS`, and identifier quoting. Anything that survives is
/// a real difference in what the statement builds.
fn normalise_ddl(sql: &str) -> String {
    let mut out = String::with_capacity(sql.len());
    let mut in_literal = false;
    let mut last_was_space = false;

    for ch in sql.chars() {
        if ch == '\'' {
            in_literal = !in_literal;
            out.push(ch);
            last_was_space = false;
            continue;
        }
        if in_literal {
            out.push(ch);
            continue;
        }
        match ch {
            '"' | '`' | '[' | ']' => {}
            c if c.is_whitespace() => {
                if !last_was_space {
                    out.push(' ');
                    last_was_space = true;
                }
            }
            c => {
                out.push(c);
                last_was_space = false;
            }
        }
    }

    let trimmed = out.trim().to_string();
    let folded = trimmed.replace("IF NOT EXISTS ", "");
    folded
        .replace(" ( ", "(")
        .replace(" )", ")")
        .replace("( ", "(")
}

#[derive(Debug)]
struct Column {
    name: String,
    decl_type: String,
    notnull: i64,
    default: Option<String>,
    pk: i64,
}

fn columns(conn: &Connection, table: &str) -> Vec<Column> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info(\"{table}\")"))
        .expect("prepare table_info");
    let mut cols: Vec<Column> = stmt
        .query_map([], |r| {
            Ok(Column {
                name: r.get(1)?,
                decl_type: r.get(2)?,
                notnull: r.get(3)?,
                default: r.get(4)?,
                pk: r.get(5)?,
            })
        })
        .expect("query table_info")
        .collect::<Result<_, _>>()
        .expect("read table_info");
    // Sorted by name, not by cid: a column added by ALTER lands at the end
    // while the same column written into a consolidated CREATE lands mid-table.
    // That ordering carries no meaning for any query.
    cols.sort_by(|a, b| a.name.cmp(&b.name));
    cols
}

fn index_columns(conn: &Connection, index: &str) -> Vec<String> {
    let Ok(mut stmt) = conn.prepare(&format!("PRAGMA index_info(\"{index}\")")) else {
        return Vec::new();
    };
    stmt.query_map([], |r| r.get::<_, Option<String>>(2))
        .map(|rows| {
            rows.filter_map(|r| r.ok())
                .map(|name| name.unwrap_or_else(|| "<expr>".to_string()))
                .collect()
        })
        .unwrap_or_default()
}

fn index_lines(conn: &Connection, table: &str) -> Vec<String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA index_list(\"{table}\")"))
        .expect("prepare index_list");
    let mut rows: Vec<(String, i64, String, i64)> = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
            ))
        })
        .expect("query index_list")
        .collect::<Result<_, _>>()
        .expect("read index_list");
    rows.sort_by(|a, b| a.0.cmp(&b.0));

    rows.into_iter()
        .map(|(name, unique, origin, partial)| {
            let cols = index_columns(conn, &name).join(",");
            // Auto-index names are positional (sqlite_autoindex_t_1) and shift
            // when an unrelated constraint is added, so key them by columns.
            let label = if name.starts_with("sqlite_autoindex_") {
                format!("auto({cols})")
            } else {
                name
            };
            format!(
                "  index {label} unique={unique} origin={origin} partial={partial} cols=[{cols}]"
            )
        })
        .collect()
}

fn foreign_key_lines(conn: &Connection, table: &str) -> Vec<String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA foreign_key_list(\"{table}\")"))
        .expect("prepare foreign_key_list");
    let mut rows: Vec<String> = stmt
        .query_map([], |r| {
            let target: String = r.get(2)?;
            let from: Option<String> = r.get(3)?;
            let to: Option<String> = r.get(4)?;
            let on_update: String = r.get(5)?;
            let on_delete: String = r.get(6)?;
            Ok(format!(
                "  fk {} -> {}.{} on_update={} on_delete={}",
                from.unwrap_or_else(|| "<rowid>".into()),
                target,
                to.unwrap_or_else(|| "<pk>".into()),
                on_update,
                on_delete
            ))
        })
        .expect("query foreign_key_list")
        .collect::<Result<_, _>>()
        .expect("read foreign_key_list");
    rows.sort();
    rows
}

/// Every schema object in one deterministic block of text.
fn canonical_schema(conn: &Connection) -> String {
    let mut stmt = conn
        .prepare(
            "SELECT type, name, COALESCE(sql, '') FROM sqlite_master
             WHERE name NOT LIKE 'sqlite_%'
             ORDER BY type, name",
        )
        .expect("prepare sqlite_master query");
    let objects: Vec<(String, String, String)> = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .expect("query sqlite_master")
        .collect::<Result<_, _>>()
        .expect("read sqlite_master");

    let mut lines: Vec<String> = Vec::new();

    let mut tables: Vec<&str> = objects
        .iter()
        .filter(|(kind, _, _)| kind == "table")
        .map(|(_, name, _)| name.as_str())
        .collect();
    tables.sort_unstable();

    for table in tables {
        lines.push(format!("table {table}"));
        for col in columns(conn, table) {
            lines.push(format!(
                "  column {} type={} notnull={} default={} pk={}",
                col.name,
                if col.decl_type.is_empty() {
                    "<none>"
                } else {
                    &col.decl_type
                },
                col.notnull,
                col.default.as_deref().unwrap_or("<none>"),
                col.pk
            ));
        }
        lines.extend(index_lines(conn, table));
        lines.extend(foreign_key_lines(conn, table));
    }

    for (kind, name, sql) in &objects {
        // Index DDL is kept as text as well as pragma form: the pragmas do not
        // expose the WHERE clause of a partial index or a collation.
        if kind == "table" || sql.is_empty() {
            continue;
        }
        lines.push(format!("{kind} {name} :: {}", normalise_ddl(sql)));
    }

    lines.push(format!("user_version {}", user_version(conn)));
    lines.join("\n") + "\n"
}

// ---------------------------------------------------------------------------
// Golden compare
// ---------------------------------------------------------------------------

fn diff(expected: &str, actual: &str) -> String {
    let exp: Vec<&str> = expected.lines().collect();
    let act: Vec<&str> = actual.lines().collect();

    let missing: Vec<&str> = exp.iter().filter(|l| !act.contains(*l)).copied().collect();
    let added: Vec<&str> = act.iter().filter(|l| !exp.contains(*l)).copied().collect();

    let mut report = String::new();
    if !missing.is_empty() {
        report.push_str("only in golden (lost or changed):\n");
        for line in missing.iter().take(40) {
            report.push_str(&format!("  - {line}\n"));
        }
        if missing.len() > 40 {
            report.push_str(&format!("  ... {} more\n", missing.len() - 40));
        }
    }
    if !added.is_empty() {
        report.push_str("only in the live schema (new or changed):\n");
        for line in added.iter().take(40) {
            report.push_str(&format!("  + {line}\n"));
        }
        if added.len() > 40 {
            report.push_str(&format!("  ... {} more\n", added.len() - 40));
        }
    }
    if report.is_empty() {
        report.push_str("line sets match but their order differs\n");
    }
    report
}

fn compare_to_golden(name: &str, actual: &str) {
    let path = fixture_dir().join(format!("{name}.txt"));

    if updating() {
        std::fs::create_dir_all(fixture_dir()).expect("create fixture dir");
        std::fs::write(&path, actual).expect("write golden");
        eprintln!("UPDATE_GOLDEN: rewrote {}", path.display());
        return;
    }

    let expected = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "golden {} is missing ({e}). It is checked in on purpose. \
             Regenerate deliberately with UPDATE_GOLDEN=1 and read the diff before committing.",
            path.display()
        )
    });

    assert!(
        expected == actual,
        "schema drifted from golden {}\n\n{}\nRegenerate with UPDATE_GOLDEN=1 once the change is intended.",
        path.display(),
        diff(&expected, actual)
    );
}

fn fresh_engine_schema() -> (TempDir, String) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("fresh.db");
    {
        let _engine = PersistentRouteEngine::new(path.to_str().unwrap()).expect("fresh engine");
    }
    let conn = Connection::open(&path).expect("reopen fresh");
    let dump = canonical_schema(&conn);
    (dir, dump)
}

fn upgraded_from_schema(seed: u32) -> (TempDir, String) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join(format!("from_v{seed}.db"));
    drop(seed_at_version(&path, seed));
    {
        let _engine = PersistentRouteEngine::new(path.to_str().unwrap()).expect("upgraded engine");
    }
    let conn = Connection::open(&path).expect("reopen upgraded");
    let dump = canonical_schema(&conn);
    (dir, dump)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/// The golden is named for the version it describes, so adding a migration
/// asks for a new artefact instead of quietly rewriting the old one.
fn fresh_golden_name() -> String {
    format!("v{:02}_fresh", latest_version())
}

#[test]
fn fresh_install_matches_its_golden() {
    let (_dir, dump) = fresh_engine_schema();
    compare_to_golden(&fresh_golden_name(), &dump);
}

#[test]
fn seed_at_v7_matches_golden() {
    let dir = TempDir::new().expect("tempdir");
    let conn = seed_at_version(&dir.path().join("v7.db"), 7);
    compare_to_golden("v07", &canonical_schema(&conn));
}

#[test]
fn seed_at_v12_matches_golden() {
    let dir = TempDir::new().expect("tempdir");
    let conn = seed_at_version(&dir.path().join("v12.db"), 12);
    compare_to_golden("v12", &canonical_schema(&conn));
}

/// The path every released 0.3.0 to 0.3.8 install takes. A user upgrading must
/// end on exactly the schema a new install gets, not merely on the same
/// version number.
#[test]
fn upgrade_from_v12_lands_on_the_fresh_schema() {
    let (_a, upgraded) = upgraded_from_schema(12);
    compare_to_golden(&fresh_golden_name(), &upgraded);

    let (_b, fresh) = fresh_engine_schema();
    assert!(
        upgraded == fresh,
        "upgrading a v12 database gives a different schema than a fresh install\n\n{}",
        diff(&fresh, &upgraded)
    );
}

/// 0.2.2 stamped `schema_version = 7` while sitting on `user_version = 11`, so
/// the oldest supported upgrade needs its own run.
#[test]
fn upgrade_from_v11_stamped_seven_lands_on_the_fresh_schema() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("v11.db");
    let conn = seed_at_version(&path, 11);
    stamp_app_schema_version(&conn, 7);
    drop(conn);
    {
        let _engine = PersistentRouteEngine::new(path.to_str().unwrap()).expect("upgraded engine");
    }
    let conn = Connection::open(&path).expect("reopen");
    let upgraded = canonical_schema(&conn);

    let (_b, fresh) = fresh_engine_schema();
    assert!(
        upgraded == fresh,
        "upgrading a 0.2.2-shaped database gives a different schema than a fresh install\n\n{}",
        diff(&fresh, &upgraded)
    );
}

/// The old table-list assertion stopped at the tables migration 012 created and
/// silently ignored everything 013 to 017 add, `section_pins` among them.
#[test]
fn fresh_install_carries_every_table_including_the_post_012_ones() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("fresh.db");
    {
        let _engine = PersistentRouteEngine::new(path.to_str().unwrap()).expect("fresh engine");
    }
    let conn = Connection::open(&path).expect("reopen");
    let tables = tables_at(&conn);

    // Named individually so a dropped table names itself in the failure rather
    // than showing up as a count that moved.
    let required = [
        "activities",
        "activity_bodies",
        "activity_heatmap",
        "activity_indicators",
        "activity_matches",
        "activity_metrics",
        "athlete_profile",
        "calendar_event_bodies",
        "curve_bodies",
        "exercise_sets",
        "fit_file_status",
        "ftp_history",
        "gps_tracks",
        "identity_state",
        "interval_bodies",
        "overlap_cache",
        "pace_history",
        "processed_activities",
        "route_groups",
        "route_names",
        "schema_info",
        "section_activities",
        "section_geometry",
        "section_history",
        "section_intents",
        "section_pins",
        "sections",
        "settings",
        "signatures",
        "sport_settings",
        "stream_bodies",
        "time_streams",
        "wellness",
    ];
    for table in required {
        assert!(
            tables.contains(&table.to_string()),
            "fresh install is missing table '{table}'. Present: {tables:?}"
        );
    }

    // section_pins had no existence assertion anywhere, so pin an interrogation
    // of its shape too. Losing the columns would leave pins unreadable while
    // the table itself still existed.
    let pin_columns = columns_of(&conn, "section_pins");
    for column in ["section_id", "version", "created_at"] {
        assert!(
            pin_columns.contains(&column.to_string()),
            "section_pins is missing '{column}'. Present: {pin_columns:?}"
        );
    }
    assert_eq!(
        row_count(&conn, "section_pins"),
        Some(0),
        "section_pins must exist and be readable on a fresh install"
    );
}
