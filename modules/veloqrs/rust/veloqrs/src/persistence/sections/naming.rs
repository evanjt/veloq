//! Section name persistence and migration helpers.

use rusqlite::{OptionalExtension, Result as SqlResult, params};
use std::collections::{BTreeMap, HashMap};

use super::super::{PersistentRouteEngine, get_section_word};

impl PersistentRouteEngine {
    // ========================================================================
    // Section Name Migration
    // ========================================================================

    /// Migration: Generate names for sections that don't have names.
    pub(super) fn migrate_section_names(&mut self) -> SqlResult<()> {
        // Only auto sections are auto-named. Custom and accepted sections carry
        // user-managed names — a custom section legitimately keeps a NULL name and
        // must never be handed a generated "Section N" (they now share the
        // in-memory catalogue with auto sections, so this filter is what keeps the
        // migration from renaming them).
        let sections_without_names: Vec<(String, String)> = self
            .sections
            .iter()
            .filter(|s| s.name.is_none() && !s.is_user_defined)
            .map(|s| (s.id.clone(), s.sport_type.clone()))
            .collect();

        if sections_without_names.is_empty() {
            return Ok(());
        }

        log::info!(
            "tracematch: [PersistentEngine] Migrating {} sections without names",
            sections_without_names.len()
        );

        let section_word = get_section_word();

        // Collect which numbers are already taken (check both old "{Sport} Section N" and new "Section N" patterns)
        let mut taken_numbers: std::collections::HashSet<u32> = std::collections::HashSet::new();
        for section in &self.sections {
            if let Some(ref name) = section.name {
                // New pattern: "Section N"
                let prefix = format!("{} ", section_word);
                if name.starts_with(&prefix) {
                    if let Ok(num) = name[prefix.len()..].parse::<u32>() {
                        taken_numbers.insert(num);
                    }
                }
                // Old pattern: "{Sport} Section N" - still recognize for numbering
                for sport in [
                    "Ride",
                    "Run",
                    "Hike",
                    "Walk",
                    "Swim",
                    "VirtualRide",
                    "VirtualRun",
                ] {
                    let old_prefix = format!("{} {} ", sport, section_word);
                    if name.starts_with(&old_prefix) {
                        if let Ok(num) = name[old_prefix.len()..].parse::<u32>() {
                            taken_numbers.insert(num);
                        }
                    }
                }
            }
        }

        // Generate and update names for sections without names
        let mut update_stmt = self
            .db
            .prepare("UPDATE sections SET name = ? WHERE id = ?")?;

        // Track next available number (no longer per-sport)
        let mut counter: u32 = 0;

        for (section_id, _sport_type) in &sections_without_names {
            // Find next available number (skip taken numbers)
            loop {
                counter += 1;
                if !taken_numbers.contains(&counter) {
                    break;
                }
            }

            let new_name = format!("{} {}", section_word, counter);
            update_stmt.execute(params![&new_name, section_id])?;
            taken_numbers.insert(counter); // Mark this number as taken

            // Update in-memory section
            if let Some(section) = self.sections.iter_mut().find(|s| &s.id == section_id) {
                section.name = Some(new_name);
            }
        }

        log::info!(
            "tracematch: [PersistentEngine] Generated names for {} sections",
            sections_without_names.len()
        );

        Ok(())
    }

    /// Migration: Strip sport type prefixes from auto-generated section names.
    /// "Walk Section 1" → "Section 1", with conflict resolution.
    pub(super) fn migrate_strip_sport_prefixes(&mut self) -> SqlResult<()> {
        let section_word = get_section_word();
        let sports = [
            "Ride",
            "Run",
            "Hike",
            "Walk",
            "Swim",
            "VirtualRide",
            "VirtualRun",
        ];

        // Find sections with old-style "{Sport} {Word} N" names. Auto sections
        // only: a user-managed (custom/accepted) name is never rewritten, even if
        // it happens to match the old auto pattern.
        let mut renames: Vec<(String, String, u32)> = Vec::new(); // (section_id, new_name, number)
        for section in &self.sections {
            if section.is_user_defined {
                continue;
            }
            if let Some(ref name) = section.name {
                for sport in &sports {
                    let prefix = format!("{} {} ", sport, section_word);
                    if name.starts_with(&prefix) {
                        if let Ok(num) = name[prefix.len()..].parse::<u32>() {
                            let new_name = format!("{} {}", section_word, num);
                            renames.push((section.id.clone(), new_name, num));
                        }
                        break;
                    }
                }
            }
        }

        if renames.is_empty() {
            return Ok(());
        }

        // Collect new-style names already in use to detect conflicts
        let mut used_numbers: std::collections::HashSet<u32> = std::collections::HashSet::new();
        for section in &self.sections {
            if let Some(ref name) = section.name {
                let prefix = format!("{} ", section_word);
                if name.starts_with(&prefix) {
                    if let Ok(num) = name[prefix.len()..].parse::<u32>() {
                        used_numbers.insert(num);
                    }
                }
            }
        }

        // Resolve conflicts: if two old names map to same number, renumber the one with fewer activities
        let mut number_to_sections: BTreeMap<u32, Vec<(String, u32)>> = BTreeMap::new();
        for (id, _, num) in &renames {
            let activity_count = self
                .sections
                .iter()
                .find(|s| &s.id == id)
                .map(|s| s.activity_ids.len() as u32)
                .unwrap_or(0);
            number_to_sections
                .entry(*num)
                .or_default()
                .push((id.clone(), activity_count));
        }

        let mut update_stmt = self
            .db
            .prepare("UPDATE sections SET name = ? WHERE id = ?")?;
        let mut next_counter = renames.iter().map(|(_, _, n)| *n).max().unwrap_or(0);

        for (num, mut section_ids) in number_to_sections {
            // Most activities keeps the number, section id settles a draw.
            section_ids.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));

            for (i, (section_id, _)) in section_ids.iter().enumerate() {
                let final_num = if i == 0 && !used_numbers.contains(&num) {
                    // First (most activities) gets the original number if available
                    used_numbers.insert(num);
                    num
                } else {
                    // Conflict: find next available number
                    loop {
                        next_counter += 1;
                        if !used_numbers.contains(&next_counter) {
                            break;
                        }
                    }
                    used_numbers.insert(next_counter);
                    next_counter
                };

                let new_name = format!("{} {}", section_word, final_num);
                update_stmt.execute(params![&new_name, section_id])?;

                // Update in-memory
                if let Some(section) = self.sections.iter_mut().find(|s| &s.id == section_id) {
                    section.name = Some(new_name);
                }
            }
        }

        log::info!(
            "tracematch: [PersistentEngine] Stripped sport prefixes from {} section names",
            renames.len()
        );

        Ok(())
    }

    // ========================================================================
    // Section Names
    // ========================================================================

    /// Set the name for a section. Pass None to clear the name.
    ///
    /// User-owned rows (custom, accepted) keep their name on the row: they are
    /// durable already. Naming an AUTO section records a durable named intent
    /// instead — auto rows are wiped and re-cut by detection, so a row name
    /// would die with the next apply. The routing decision reads the DB row,
    /// not the in-memory copy, which can lag it transiently.
    pub fn set_section_name(&mut self, section_id: &str, name: Option<&str>) -> SqlResult<()> {
        let row: Option<(String, bool)> = self
            .db
            .query_row(
                "SELECT section_type, is_user_defined FROM sections WHERE id = ?",
                params![section_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let Some((section_type, is_user_defined)) = row else {
            return Ok(());
        };
        // A name is the user taking the section over; a pin holding an
        // older line would fight that.
        self.drop_section_pin(section_id);

        if is_user_defined || section_type == "custom" {
            self.db.execute(
                "UPDATE sections SET name = ? WHERE id = ?",
                params![name, section_id],
            )?;
            if let Some(section) = self.sections.iter_mut().find(|s| s.id == section_id) {
                section.name = name.map(str::to_string);
            }
            return Ok(());
        }

        match name {
            Some(n) => self.upsert_named_intent_for(section_id, n)?,
            None => self.delete_named_intent_for(section_id)?,
        }
        Ok(())
    }

    /// Get all section names, with corridor-name precedence: a user-defined
    /// row keeps its own name, an auto row shows its resolved corridor name
    /// over the generated one.
    pub fn get_all_section_names(&self) -> HashMap<String, String> {
        self.sections
            .iter()
            .filter_map(|s| {
                let name = if s.is_user_defined {
                    s.name.clone()
                } else {
                    self.named_overlay_name(&s.id).or_else(|| s.name.clone())
                };
                name.map(|n| (s.id.clone(), n))
            })
            .collect()
    }
}
