//! The name the geocoder gave a route or section, kept apart from any name the
//! athlete typed.
//!
//! An item is queued for a name the moment the engine first numbers it, and
//! only while geocoding is on, so turning geocoding on starts no pass over the
//! library. Sections are queued by the numbering trigger in
//! `sections::numbers`, which every writer of a section row goes through, and
//! routes by `routes::mint_route_numbers`. The naming pass that fills the rows
//! is `net::place_names`.
//!
//! What is shown is the typed name, else the geocoded name while geocoding is
//! on, else the numbered label. Turning geocoding off keeps the rows and stops
//! showing them.

use std::collections::HashMap;

use rusqlite::{Connection, OptionalExtension, Result as SqlResult, params};
use serde::{Deserialize, Serialize};

use super::settings::{geocoding_enabled_from, setting_from, settings_keys};

/// What a geocoded name belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum NamedKind {
    Route,
    Section,
}

impl NamedKind {
    pub fn as_str(self) -> &'static str {
        match self {
            NamedKind::Route => "route",
            NamedKind::Section => "section",
        }
    }

    fn parse(raw: &str) -> Option<Self> {
        match raw {
            "route" => Some(NamedKind::Route),
            "section" => Some(NamedKind::Section),
            _ => None,
        }
    }
}

/// The moment now in epoch milliseconds, as SQL, for the numbering trigger.
pub(crate) const NOW_MS_SQL: &str = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)";

/// The statement that queues a section the numbering trigger has just
/// numbered, when it has no name of its own and geocoding is on. Run inside
/// that trigger, so it reads `NEW`.
pub(crate) fn queue_new_section_sql() -> String {
    format!(
        "INSERT OR IGNORE INTO geocoded_names (kind, item_id, queued_at)
        SELECT 'section', NEW.id, {NOW_MS_SQL}
        WHERE NEW.name IS NULL
          AND (SELECT value FROM settings WHERE key = '{}') = '1';",
        settings_keys::GEOCODING_ENABLED
    )
}

/// Queue a route the engine has just numbered, when geocoding is on. An item
/// already queued or named keeps its row.
pub(crate) fn queue_new_route(conn: &Connection, route_id: &str) -> SqlResult<()> {
    if !geocoding_enabled_from(conn) {
        return Ok(());
    }
    conn.execute(
        &format!(
            "INSERT OR IGNORE INTO geocoded_names (kind, item_id, queued_at)
             VALUES ('route', ?1, {NOW_MS_SQL})"
        ),
        params![route_id],
    )?;
    Ok(())
}

/// The geocoded name of every item of `kind` that has one, keyed by id, or
/// nothing while geocoding is off.
pub(crate) fn shown_geocoded_names(conn: &Connection, kind: NamedKind) -> HashMap<String, String> {
    if !geocoding_enabled_from(conn) {
        return HashMap::new();
    }
    let read = || -> SqlResult<HashMap<String, String>> {
        let mut stmt = conn.prepare_cached(
            "SELECT item_id, name FROM geocoded_names WHERE kind = ?1 AND name IS NOT NULL",
        )?;
        stmt.query_map(params![kind.as_str()], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect()
    };
    read().unwrap_or_else(|error| {
        log::warn!("veloqrs: [geocoded names] reading names: {error}");
        HashMap::new()
    })
}

/// The geocoded name of one item, or `None` while geocoding is off.
pub(crate) fn shown_geocoded_name(conn: &Connection, kind: NamedKind, id: &str) -> Option<String> {
    if !geocoding_enabled_from(conn) {
        return None;
    }
    conn.prepare_cached(
        "SELECT name FROM geocoded_names WHERE kind = ?1 AND item_id = ?2 AND name IS NOT NULL",
    )
    .and_then(|mut stmt| {
        stmt.query_row(params![kind.as_str(), id], |row| row.get(0))
            .optional()
    })
    .unwrap_or_else(|error| {
        log::warn!("veloqrs: [geocoded names] reading the name of {id}: {error}");
        None
    })
}

/// The items still waiting for a lookup, oldest first.
pub(crate) fn queued(conn: &Connection) -> SqlResult<Vec<(NamedKind, String)>> {
    let mut stmt = conn.prepare(
        "SELECT kind, item_id FROM geocoded_names
         WHERE named_at IS NULL ORDER BY queued_at, kind, item_id",
    )?;
    let rows = stmt.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get(1)?)))?;
    let mut out = Vec::new();
    for row in rows {
        let (kind, id) = row?;
        if let Some(kind) = NamedKind::parse(&kind) {
            out.push((kind, id));
        }
    }
    Ok(out)
}

/// Settle a queued item with what its lookup came to: a name, or `None` for a
/// lookup that found no place or failed, which is not asked again. An item
/// already settled keeps what it has.
pub(crate) fn settle(
    conn: &Connection,
    kind: NamedKind,
    id: &str,
    name: Option<&str>,
    now_ms: i64,
) -> SqlResult<bool> {
    let changed = conn.execute(
        "UPDATE geocoded_names SET name = ?3, named_at = ?4
         WHERE kind = ?1 AND item_id = ?2 AND named_at IS NULL",
        params![kind.as_str(), id, name, now_ms],
    )?;
    Ok(changed > 0)
}

/// Take an item off the queue without a lookup: it has gone, or the athlete
/// typed a name for it.
pub(crate) fn unqueue(conn: &Connection, kind: NamedKind, id: &str) -> SqlResult<()> {
    conn.execute(
        "DELETE FROM geocoded_names WHERE kind = ?1 AND item_id = ?2 AND named_at IS NULL",
        params![kind.as_str(), id],
    )?;
    Ok(())
}

/// The words a geocoded name is put together with, in the language the app
/// runs in, and that language's tag, which the lookups are asked in.
///
/// Stored durably by the app whenever its language is resolved, so a naming
/// pass in a process with no JavaScript alive still names in the athlete's
/// language. `loop` holds `{{place}}`, `journey` holds `{{start}}` and
/// `{{end}}`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlaceNameWords {
    pub locale: String,
    #[serde(rename = "loop")]
    pub loop_name: String,
    pub journey: String,
}

impl PlaceNameWords {
    /// The name of a route or section that starts and ends at one place.
    pub fn looped(&self, place: &str) -> String {
        self.loop_name.replace("{{place}}", place)
    }

    /// The name of one that starts at one place and ends at another.
    pub fn journey(&self, start: &str, end: &str) -> String {
        self.journey
            .replace("{{start}}", start)
            .replace("{{end}}", end)
    }

    fn usable(&self) -> bool {
        !self.locale.trim().is_empty()
            && self.loop_name.contains("{{place}}")
            && self.journey.contains("{{start}}")
            && self.journey.contains("{{end}}")
    }
}

/// The words the app last stored, or `None` before it stored any or when
/// what it stored cannot put a name together.
pub fn place_name_words_from(conn: &Connection) -> Option<PlaceNameWords> {
    let raw = setting_from(conn, settings_keys::PLACE_NAME_WORDS)
        .ok()
        .flatten()?;
    serde_json::from_str::<PlaceNameWords>(&raw)
        .ok()
        .filter(PlaceNameWords::usable)
}

#[cfg(test)]
#[path = "tests/geocoded_names.rs"]
mod tests;
