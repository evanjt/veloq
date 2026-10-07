//! Section name persistence.

use rusqlite::{OptionalExtension, params};
use std::collections::HashMap;

use super::super::{PersistentEngine, get_section_word};
use super::numbers::label_number;
use tracematch::sections::shares_ground;

#[cfg(test)]
#[path = "tests/section_numbers.rs"]
mod section_number_tests;

/// Why `set_section_name` changed nothing.
#[derive(Debug, PartialEq, Eq)]
pub enum SectionNameError {
    /// Another section already shows the name.
    Taken(String),
    Failed(String),
}

impl From<String> for SectionNameError {
    fn from(msg: String) -> Self {
        Self::Failed(msg)
    }
}

impl std::fmt::Display for SectionNameError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Taken(name) => write!(f, "Another section is already named {name}"),
            Self::Failed(msg) => f.write_str(msg),
        }
    }
}

impl PersistentEngine {
    // ========================================================================
    // Section Names
    // ========================================================================

    /// Set the name for a section. Pass None to clear the name.
    ///
    /// User-owned rows (custom, accepted) keep their name on the row: they are
    /// durable already. Naming an AUTO section records a durable named intent
    /// instead, auto rows are wiped and re-cut by detection, so a row name
    /// would die with the next apply. The routing decision reads the DB row,
    /// not the in-memory copy, which can lag it transiently.
    ///
    /// A name reading as a section word and a number is a handle: the section's own clears its
    /// name and any other is refused as taken, since every section holds its number beneath its
    /// name and no retry can save it.
    /// A name another section already shows is refused, and so is a
    /// name for an auto section whose line cannot be read, since the intent it
    /// would write has no ground to resolve onto. A refusal changes nothing.
    ///
    /// Naming an auto section also pins it at its current line, in the same
    /// transaction, so detection leaves what the athlete named whole. A
    /// section already pinned keeps its pin and version, and clearing a name
    /// leaves the pin: unpinning is its own action.
    ///
    /// A change of the shown name is a ledger event holding the name before and after.
    pub fn set_section_name(
        &mut self,
        section_id: &str,
        name: Option<&str>,
    ) -> Result<(), SectionNameError> {
        let before = pooled::all_section_names(&self.db).remove(section_id);
        self.db
            .execute_batch("SAVEPOINT name_edit")
            .map_err(|e| e.to_string())?;
        let written = self.write_section_name(section_id, name).and_then(|()| {
            let after = pooled::all_section_names(&self.db).remove(section_id);
            if before == after {
                return Ok(());
            }
            self.record_edit_event(
                section_id,
                super::history::KIND_RENAMED,
                serde_json::json!({ "from": before, "to": after }),
                None,
            )
            .map_err(SectionNameError::from)
        });
        let closed = match &written {
            Ok(()) => "RELEASE name_edit",
            Err(_) => "ROLLBACK TO name_edit; RELEASE name_edit",
        };
        self.db.execute_batch(closed).map_err(|e| e.to_string())?;
        written
    }

    fn write_section_name(
        &mut self,
        section_id: &str,
        name: Option<&str>,
    ) -> Result<(), SectionNameError> {
        let row: Option<(String, bool)> = self
            .db
            .query_row(
                "SELECT section_type, is_user_defined FROM sections WHERE id = ?",
                params![section_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let Some((section_type, is_user_defined)) = row else {
            return Ok(());
        };
        let name = match name.and_then(|n| label_number(n, &get_section_word()).map(|v| (n, v))) {
            Some((n, typed)) => {
                if self.section_number(section_id)? != Some(typed) {
                    return Err(SectionNameError::Taken(n.to_string()));
                }
                None
            }
            None => name,
        };
        if let Some(n) = name
            && self.name_shown_by_another_section(section_id, n)?
        {
            return Err(SectionNameError::Taken(n.to_string()));
        }

        if is_user_defined || section_type == "custom" {
            self.db
                .execute(
                    "UPDATE sections SET name = ? WHERE id = ?",
                    params![name, section_id],
                )
                .map_err(|e| e.to_string())?;
            if let Some(section) = self.sections.iter_mut().find(|s| s.id == section_id) {
                section.name = name.map(str::to_string);
            }
        } else {
            match name {
                Some(n) => {
                    self.db
                        .execute_batch("SAVEPOINT name_and_pin")
                        .map_err(|e| e.to_string())?;
                    let written = self
                        .upsert_named_intent_for(section_id, n)
                        .and_then(|()| self.pin_at_current_geometry(section_id));
                    let closed = match &written {
                        Ok(()) => "RELEASE name_and_pin",
                        Err(_) => "ROLLBACK TO name_and_pin; RELEASE name_and_pin",
                    };
                    self.db.execute_batch(closed).map_err(|e| e.to_string())?;
                    written?;
                }
                None => {
                    self.delete_named_intent_for(section_id)
                        .map_err(|e| e.to_string())?;
                    // A name kept on the row goes too, so the section is shown
                    // under its number again.
                    self.db
                        .execute(
                            "UPDATE sections SET name = NULL WHERE id = ?",
                            params![section_id],
                        )
                        .map_err(|e| e.to_string())?;
                    if let Some(section) = self.sections.iter_mut().find(|s| s.id == section_id) {
                        section.name = None;
                    }
                }
            }
            // The list reads the cached overlay and never refreshes it, so
            // resolving here is what puts the new name on the next read.
            // Without it a rename showed the name it replaced until some other
            // screen resolved the overlay.
            self.ensure_named_overlay();
        }
        Ok(())
    }

    fn section_number(&self, section_id: &str) -> Result<Option<u32>, String> {
        self.db
            .query_row(
                "SELECT number FROM section_numbers WHERE section_id = ?",
                params![section_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())
    }

    /// Whether a section other than `section_id` shows `name`: a user-owned
    /// row by its own name, an auto row by its corridor name or, lacking one,
    /// its row name. Hidden rows count, since enabling one would show both.
    /// A dormant named corridor counts too, unless it is on this section's own
    /// ground (a rename relabels that one), since it shows its name again once
    /// its ground is detected.
    fn name_shown_by_another_section(&self, section_id: &str, name: &str) -> Result<bool, String> {
        self.ensure_named_overlay();
        let overlay = self.named_overlay_cached_names();
        if overlay
            .iter()
            .any(|(id, shown)| id != section_id && shown == name)
        {
            return Ok(true);
        }
        let own_line = self.stored_section_polyline(section_id).unwrap_or_default();
        if self.get_named_corridors().iter().any(|c| {
            c.section_id.is_none()
                && c.name == name
                && (own_line.is_empty() || !shares_ground(&own_line, &c.footprint))
        }) {
            return Ok(true);
        }
        let mut stmt = self
            .db
            .prepare("SELECT id FROM sections WHERE name = ? AND id != ?")
            .map_err(|e| e.to_string())?;
        let holders: Vec<String> = stmt
            .query_map(params![name, section_id], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .collect::<rusqlite::Result<_>>()
            .map_err(|e| e.to_string())?;
        // An auto row a corridor name resolves onto shows that name instead of
        // the one it stores.
        Ok(holders.iter().any(|id| !overlay.contains_key(id)))
    }

    /// The name every section is shown under: a user-defined row its own
    /// name, an auto row its resolved corridor name over its row's, and a
    /// section with neither its numbered label.
    pub fn get_all_section_names(&self) -> HashMap<String, String> {
        self.ensure_named_overlay();
        let shown = self.named_overlay_cached_names();
        self.sections
            .iter()
            .filter_map(|s| {
                let name = if s.is_user_defined {
                    s.name.clone().or_else(|| shown.get(&s.id).cloned())
                } else {
                    shown.get(&s.id).cloned().or_else(|| s.name.clone())
                };
                name.map(|n| (s.id.clone(), n))
            })
            .collect()
    }
}

/// The names a pooled reader sees, over committed rows.
pub(crate) mod pooled {
    use std::collections::HashMap;

    use rusqlite::Connection;

    /// [`PersistentEngine::get_all_section_names`](super::PersistentEngine::get_all_section_names)
    /// over rows: a user-defined section keeps its own name, an auto one
    /// shows its overlay name over the one its row stores, and a section with
    /// neither is left out.
    pub(crate) fn all_section_names(conn: &Connection) -> HashMap<String, String> {
        let shown = crate::persistence::sections::named::pooled::overlay_names(conn);
        let Ok(mut stmt) = conn.prepare("SELECT id, name, is_user_defined FROM sections") else {
            return HashMap::new();
        };
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<i32>>(2)?.unwrap_or(0) != 0,
            ))
        });
        let Ok(rows) = rows else {
            return HashMap::new();
        };
        rows.filter_map(Result::ok)
            .filter_map(|(id, own, user_defined)| {
                let name = if user_defined {
                    own.or_else(|| shown.get(&id).cloned())
                } else {
                    shown.get(&id).cloned().or(own)
                };
                name.map(|n| (id, n))
            })
            .collect()
    }
}
