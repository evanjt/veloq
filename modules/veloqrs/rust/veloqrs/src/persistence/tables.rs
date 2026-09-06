//! What each table holds, declared once.
//!
//! Four delete lists and one backup each answered this on their own. `clear()`
//! is a negative list, the detection wipe is a positive predicate,
//! `clear_routes_and_sections` is a third list and retention a fourth, and the
//! backup was the whole database file because nothing said which tables were
//! worth protecting. A table added next year lands in some of those and not
//! others, silently.
//!
//! So a table says what it is here, and the delete lists, the backup and the
//! tests read it. `every_table_declares_an_owner` holds this to `sqlite_master`
//! in both directions: a new table with no line here fails, and a line here for
//! a table a migration dropped fails too.
//!
//! The classes are decidable rather than a matter of taste:
//!
//! - `Mirror` is a copy of something intervals.icu holds. A sync refills it,
//!   no computation can.
//! - `Derived` is recomputable on device from mirror and record rows. Losing
//!   it costs time, never information.
//! - `Record` is athlete work that exists nowhere else. Losing it is data loss
//!   and it is exactly what a backup carries.
//! - `Meta` is the store's own version and configuration, which is why it is
//!   the only class that survives a logout.

/// What a table holds, and therefore who may delete it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TableClass {
    /// A copy of intervals.icu. Refilled by a sync.
    Mirror,
    /// Recomputable on device. Losing it costs time, not information.
    Derived,
    /// Athlete work that exists nowhere else.
    Record,
    /// The store's own version and configuration.
    Meta,
}

/// One table's declaration.
pub struct Table {
    pub name: &'static str,
    pub class: TableClass,
    /// Why it is that class, in one line.
    pub reason: &'static str,
    /// Set on a derived table that also carries an athlete decision, naming
    /// the part a delete would destroy. A consumer that reads `class` alone
    /// and ignores this throws that decision away.
    pub record_part: Option<&'static str>,
}

const fn t(name: &'static str, class: TableClass, reason: &'static str) -> Table {
    Table {
        name,
        class,
        reason,
        record_part: None,
    }
}

const fn mixed(
    name: &'static str,
    class: TableClass,
    reason: &'static str,
    record_part: &'static str,
) -> Table {
    Table {
        name,
        class,
        reason,
        record_part: Some(record_part),
    }
}

use TableClass::{Derived, Meta, Mirror, Record};

/// Every table in the schema, in the order `sqlite_master` lists them.
static TABLES: &[Table] = &[
    t(
        "activities",
        Mirror,
        "the activity list as intervals.icu holds it",
    ),
    t(
        "activity_bodies",
        Mirror,
        "the detail body the server sent, re-fetchable",
    ),
    t(
        "activity_heatmap",
        Derived,
        "per-day intensity, recomputed from the tracks",
    ),
    t(
        "activity_indicators",
        Derived,
        "computed flags shown on a feed card",
    ),
    mixed(
        "activity_matches",
        Derived,
        "route membership, re-cut by every detect",
        "the `excluded` column is the athlete taking one attempt out of a route",
    ),
    t(
        "activity_metrics",
        Derived,
        "parsed out of the bodies above",
    ),
    t(
        "activity_streams",
        Mirror,
        "the server's series, quantised; a fetch refills it",
    ),
    t(
        "athlete_profile",
        Mirror,
        "the athlete record intervals.icu holds",
    ),
    t(
        "calendar_event_bodies",
        Mirror,
        "planned workouts as the server sent them",
    ),
    t("curve_bodies", Mirror, "the server's power and pace curves"),
    t(
        "evidence_cache",
        Derived,
        "why a section was cut, recomputed with it",
    ),
    t(
        "exercise_sets",
        Mirror,
        "strength sets as intervals.icu holds them",
    ),
    t(
        "fit_file_status",
        Derived,
        "bookkeeping for the local FIT parse",
    ),
    t("ftp_history", Mirror, "dated FTP readings from the server"),
    t(
        "gps_tracks",
        Mirror,
        "the track intervals.icu holds, re-downloadable",
    ),
    t(
        "identity_state",
        Record,
        "the section id registry and its tombstones, which every athlete decision hangs off",
    ),
    t(
        "interval_bodies",
        Mirror,
        "lap and interval bodies from the server",
    ),
    t(
        "overlap_cache",
        Derived,
        "a pairwise answer the detector recomputes",
    ),
    t(
        "pace_history",
        Mirror,
        "dated pace readings from the server",
    ),
    t(
        "processed_activities",
        Derived,
        "which activities a detect has already seen",
    ),
    t(
        "route_groups",
        Derived,
        "grouping output, re-cut by every detect",
    ),
    t("route_names", Record, "names the athlete typed"),
    t("schema_info", Meta, "the schema version"),
    mixed(
        "section_activities",
        Derived,
        "the laps a detect cut, re-cut by the next one",
        "the `excluded` column is the athlete taking one lap out of a section",
    ),
    t(
        "section_catalogue_archive",
        Record,
        "a frozen snapshot of what the catalogue once was; re-cutting cannot reproduce it",
    ),
    t(
        "section_catalogue_archive_members",
        Record,
        "the archived catalogue's rows, with the lap data denormalised into them",
    ),
    t("section_geometry", Derived, "the shapes a detect drew"),
    t(
        "section_history",
        Record,
        "the ledger of what happened to a section and when",
    ),
    t(
        "section_intents",
        Record,
        "hand cuts, trims and the athlete's own sections",
    ),
    t("section_pins", Record, "sections the athlete pinned"),
    mixed(
        "sections",
        Derived,
        "the catalogue a detect cuts",
        "rows the detector did not draw, which `DERIVED_SECTION_PREDICATE` is what excludes",
    ),
    t("settings", Meta, "the store's own configuration"),
    t("signatures", Derived, "computed from the tracks"),
    t(
        "sport_settings",
        Record,
        "per-sport preferences the athlete set",
    ),
    t(
        "stream_bodies",
        Mirror,
        "raw server payloads, budget-trimmed and re-fetchable",
    ),
    t(
        "time_streams",
        Mirror,
        "the server's time series for a track",
    ),
    t("wellness", Mirror, "the wellness rows intervals.icu holds"),
];

/// Every declaration, in schema order.
pub fn declared_tables() -> &'static [Table] {
    TABLES
}

/// What a table holds, or `None` for a name the declaration does not carry.
pub fn class_of(name: &str) -> Option<TableClass> {
    TABLES.iter().find(|t| t.name == name).map(|t| t.class)
}

/// Every table of one class, in schema order.
pub fn tables_of(class: TableClass) -> impl Iterator<Item = &'static str> {
    TABLES
        .iter()
        .filter(move |t| t.class == class)
        .map(|t| t.name)
}
