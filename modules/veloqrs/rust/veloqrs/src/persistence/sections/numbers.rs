//! Section numbers: the handle a section is shown under when it has no name.
//!
//! Every section holds a number from the moment its row appears, whichever
//! writer inserts it, through the trigger below. The number is stored apart
//! from the name in `section_numbers`, which detection's wipe of its own rows
//! does not touch, so a section keeps its number across every re-cut, and
//! keeps it for good once its row is gone: a number is never reissued. A
//! section with no name of its own is shown as the current language's section
//! word and its number, composed when it is read.
//!
//! A split child with no name of its own whose parent shows a typed name is
//! shown as that name and its part along the parent's line instead,
//! "Col de la Croix / 2", nesting through further splits. That name is
//! composed at read too and never stored, so renaming the parent renames the
//! children.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::Arc;

use rusqlite::{Connection, OptionalExtension, Result as SqlResult, params};

use super::super::get_section_word;

/// The section word of every shipped language, and the one an earlier build
/// of the Portuguese strings carried. A released build stored a minted label
/// on the row in whichever of these was current at the time.
const SHIPPED_SECTION_WORDS: [&str; 11] = [
    "Section",
    "Sección",
    "Abschnitt",
    "路段",
    "Afsnit",
    "セクション",
    "Sezione",
    "Odcinek",
    "Seção",
    "Seccao",
    "Sectie",
];

/// Sport words an older build put in front of a minted label.
const LABEL_SPORT_WORDS: [&str; 7] = [
    "Ride",
    "Run",
    "Hike",
    "Walk",
    "Swim",
    "VirtualRide",
    "VirtualRun",
];

/// Numbers each new row with one more than the highest number any section
/// has held. A section's number stays with its id when the section is merged
/// away, dissolved or deleted, so a number is never reissued to other ground.
/// A row whose id already holds one, re-inserted by a detection apply or a
/// replace, keeps it.
const NUMBER_TRIGGER: &str = "
CREATE TRIGGER sections_number_ai AFTER INSERT ON sections
WHEN NOT EXISTS (SELECT 1 FROM section_numbers WHERE section_id = NEW.id)
BEGIN
    INSERT INTO section_numbers (section_id, number) VALUES (NEW.id, (
        SELECT COALESCE(MAX(number), 0) + 1 FROM section_numbers
    ));
END;";

/// The label a section with no name of its own is shown under.
pub(crate) fn numbered_label(section_word: &str, number: u32) -> String {
    format!("{section_word} {number}")
}

/// The number a stored name shows, when it reads as a section word and a
/// number, bare or behind a sport as older builds minted it.
pub(crate) fn label_number(name: &str, section_word: &str) -> Option<u32> {
    let (label, digits) = name.rsplit_once(' ')?;
    let number: u32 = digits.parse().ok().filter(|n: &u32| *n > 0)?;
    if number.to_string() != digits {
        return None;
    }
    let word = label.rsplit_once(' ').map_or(label, |(sport, word)| {
        if LABEL_SPORT_WORDS.contains(&sport) {
            word
        } else {
            label
        }
    });
    (word == section_word || SHIPPED_SECTION_WORDS.contains(&word)).then_some(number)
}

/// The label of every section with no name of its own, in the current section
/// word, keyed by section.
pub(crate) fn unnamed_labels(conn: &Connection) -> BTreeMap<String, String> {
    let section_word = get_section_word();
    let read = || -> SqlResult<BTreeMap<String, String>> {
        let mut stmt = conn.prepare_cached(
            "SELECT n.section_id, n.number FROM section_numbers n
             JOIN sections s ON s.id = n.section_id
             WHERE s.name IS NULL",
        )?;
        stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                numbered_label(&section_word, row.get(1)?),
            ))
        })?
        .collect()
    };
    read().unwrap_or_else(|error| {
        log::warn!("veloqrs: [sections] numbered labels: {error}");
        BTreeMap::new()
    })
}

/// `unnamed_labels` for `ids` alone, in chunks that fit a statement.
pub(crate) fn unnamed_labels_for(conn: &Connection, ids: &[&str]) -> BTreeMap<String, String> {
    let section_word = get_section_word();
    let mut labels = BTreeMap::new();
    for chunk in ids.chunks(500) {
        let marks = vec!["?"; chunk.len()].join(",");
        let sql = format!(
            "SELECT n.section_id, n.number FROM section_numbers n
             JOIN sections s ON s.id = n.section_id
             WHERE s.name IS NULL AND n.section_id IN ({marks})"
        );
        let read = || -> SqlResult<Vec<(String, u32)>> {
            conn.prepare(&sql)?
                .query_map(rusqlite::params_from_iter(chunk.iter()), |row| {
                    Ok((row.get(0)?, row.get(1)?))
                })?
                .collect()
        };
        match read() {
            Ok(rows) => labels.extend(
                rows.into_iter()
                    .map(|(id, number)| (id, numbered_label(&section_word, number))),
            ),
            Err(error) => log::warn!("veloqrs: [sections] numbered labels: {error}"),
        }
    }
    labels
}

/// The label `section_id` is shown under when it has no name of its own: its
/// split name when it has one, its numbered label otherwise. `overlay` holds
/// the corridor name of each auto section, which a parent shows over its row.
pub(crate) fn unnamed_label(
    conn: &Connection,
    section_id: &str,
    overlay: &BTreeMap<String, String>,
) -> Option<String> {
    let label = numbered_unnamed_label(conn, section_id)?;
    if !has_split_birth(conn, section_id) {
        return Some(label);
    }
    let lineage = split_lineage(conn);
    let section_word = get_section_word();
    Some(
        split_name(section_id, &lineage, |id| {
            typed_name(conn, id, overlay, &section_word)
        })
        .unwrap_or(label),
    )
}

fn numbered_unnamed_label(conn: &Connection, section_id: &str) -> Option<String> {
    conn.prepare_cached(
        "SELECT n.number FROM section_numbers n
         JOIN sections s ON s.id = n.section_id
         WHERE n.section_id = ? AND s.name IS NULL",
    )
    .and_then(|mut stmt| {
        stmt.query_row(params![section_id], |row| row.get::<_, u32>(0))
            .optional()
    })
    .unwrap_or_else(|error| {
        log::warn!("veloqrs: [sections] numbered label for {section_id}: {error}");
        None
    })
    .map(|number| numbered_label(&get_section_word(), number))
}

/// Replace the numbered label of every unnamed split child in `labels` whose
/// parent shows a typed name with its split name. `labels` holds the numbered
/// label of each section with no name of its own and `overlay` the corridor
/// name of each auto section; a section in `overlay` shows that name, so it is
/// left alone. `lineage` reads the ledger's lineages, asked only when an
/// unnamed section was born of a split.
pub(crate) fn compose_split_labels(
    conn: &Connection,
    labels: &mut BTreeMap<String, String>,
    overlay: &BTreeMap<String, String>,
    lineage: impl FnOnce() -> Arc<SplitLineage>,
) {
    if labels.is_empty() || !any_unnamed_split_birth(conn) {
        return;
    }
    let lineage = lineage();
    let section_word = get_section_word();
    let composed: Vec<(String, String)> = labels
        .keys()
        .filter(|id| lineage.contains_key(id.as_str()) && !overlay.contains_key(*id))
        .filter_map(|id| {
            split_name(id, &lineage, |id| {
                typed_name(conn, id, overlay, &section_word)
            })
            .map(|name| (id.clone(), name))
        })
        .collect();
    labels.extend(composed);
}

/// The split name of `section_id`: its parent's shown name and its part,
/// "{parent} / {part}", the parent's own shown name composed the same way
/// when it is an unnamed split child itself. `typed` gives the name a section
/// shows of its own, if any. `None` when the chain reaches a section with no
/// typed name, a section that is gone, or loops.
fn split_name(
    section_id: &str,
    lineage: &SplitLineage,
    typed: impl Fn(&str) -> Option<String>,
) -> Option<String> {
    let mut parts = Vec::new();
    let mut seen = HashSet::new();
    let mut id = section_id;
    loop {
        if id != section_id
            && let Some(name) = typed(id)
        {
            let mut composed = name;
            for part in parts.iter().rev() {
                composed = format!("{composed} / {part}");
            }
            return Some(composed);
        }
        if !seen.insert(id) {
            return None;
        }
        let (parent, part) = lineage.get(id)?;
        parts.push(*part);
        id = parent;
    }
}

/// The name `section_id` shows of its own: its corridor name or its row's
/// name, unless that reads as a numbered handle.
fn typed_name(
    conn: &Connection,
    section_id: &str,
    overlay: &BTreeMap<String, String>,
    section_word: &str,
) -> Option<String> {
    overlay
        .get(section_id)
        .cloned()
        .or_else(|| {
            conn.prepare_cached("SELECT name FROM sections WHERE id = ?")
                .and_then(|mut stmt| {
                    stmt.query_row(params![section_id], |row| row.get::<_, Option<String>>(0))
                        .optional()
                })
                .unwrap_or_else(|error| {
                    log::warn!("veloqrs: [sections] name of {section_id}: {error}");
                    None
                })
                .flatten()
        })
        .filter(|name| label_number(name, section_word).is_none())
}

/// Each live split child's parent and part, keyed by child.
pub(crate) type SplitLineage = HashMap<String, (String, u32)>;

/// Each live split child's parent and part, from the ledger.
pub(crate) fn split_lineage(conn: &Connection) -> SplitLineage {
    super::history::pooled::section_lineages(conn)
        .into_iter()
        .map(|l| (l.section_id, (l.parent_id, l.part)))
        .collect()
}

/// Whether `section_id` was born of a split, through the ledger's section
/// index, so a section that was not costs no walk of the ledger.
fn has_split_birth(conn: &Connection, section_id: &str) -> bool {
    conn.prepare_cached(
        "SELECT EXISTS(SELECT 1 FROM section_history
                       WHERE section_id = ? AND kind = 'formed'
                         AND details LIKE '%split_from%')",
    )
    .and_then(|mut stmt| stmt.query_row(params![section_id], |row| row.get(0)))
    .unwrap_or(false)
}

/// Whether any section with no name of its own was born of a split, walking
/// the catalogue and the ledger's section index rather than the whole ledger.
fn any_unnamed_split_birth(conn: &Connection) -> bool {
    conn.prepare_cached(
        "SELECT EXISTS(SELECT 1 FROM sections s CROSS JOIN section_history h
                       ON h.section_id = s.id
                       WHERE s.name IS NULL AND h.kind = 'formed'
                         AND h.details LIKE '%split_from%')",
    )
    .and_then(|mut stmt| stmt.query_row([], |row| row.get(0)))
    .unwrap_or(false)
}

/// Create the numbering trigger and number every row that has none.
///
/// `release_minted_labels` is the one-off conversion of a library a build
/// before numbers wrote: a detected section's stored label, in any shipped
/// section word, becomes its number and the row is left unnamed, unless a
/// named intent carries the same name, in which case the athlete chose it.
/// A name kept as a name that reads as a section word and a number holds that
/// number first when it is free, so no unnamed section is shown beside it
/// under the same label; a released label then holds its own number when that
/// is still free. Every other row takes the lowest free number, oldest first.
pub(crate) fn ensure_section_numbers(
    conn: &Connection,
    release_minted_labels: bool,
) -> SqlResult<()> {
    conn.execute_batch("DROP TRIGGER IF EXISTS sections_number_ai;")?;
    conn.execute_batch(NUMBER_TRIGGER)?;
    let tx = conn.unchecked_transaction()?;
    let section_word = get_section_word();
    let rows: Vec<(String, bool, Option<String>, bool)> = {
        let mut stmt = tx.prepare(
            "SELECT s.id, s.section_type = 'auto', s.name,
                    EXISTS (SELECT 1 FROM section_intents i
                            WHERE i.kind = 'named' AND i.name = s.name)
             FROM sections s
             WHERE s.id NOT IN (SELECT section_id FROM section_numbers)
             ORDER BY s.created_at, s.id",
        )?;
        stmt.query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
        })?
        .collect::<SqlResult<_>>()?
    };
    if rows.is_empty() {
        return Ok(());
    }

    let mut released = Vec::new();
    let mut kept = Vec::new();
    let mut rest = Vec::new();
    for (id, auto, name, intended) in rows {
        match name.as_deref().and_then(|n| label_number(n, &section_word)) {
            Some(number) if release_minted_labels && auto && !intended => {
                tx.execute("UPDATE sections SET name = NULL WHERE id = ?", params![id])?;
                released.push((id, number));
            }
            Some(number) => kept.push((id, number)),
            None => rest.push(id),
        }
    }

    let mut taken: HashSet<u32> = {
        let mut stmt = tx.prepare("SELECT number FROM section_numbers")?;
        stmt.query_map([], |row| row.get(0))?
            .collect::<SqlResult<_>>()?
    };
    let mut insert =
        tx.prepare("INSERT INTO section_numbers (section_id, number) VALUES (?, ?)")?;
    let mut unclaimed = Vec::new();
    for (id, number) in kept.into_iter().chain(released) {
        if taken.insert(number) {
            insert.execute(params![id, number])?;
        } else {
            unclaimed.push(id);
        }
    }
    let mut candidate = 1;
    for id in rest.into_iter().chain(unclaimed) {
        while taken.contains(&candidate) {
            candidate += 1;
        }
        insert.execute(params![id, candidate])?;
        taken.insert(candidate);
    }
    drop(insert);
    tx.commit()
}

#[cfg(test)]
mod tests {
    use super::label_number;

    #[test]
    fn a_label_reads_in_any_shipped_word_bare_or_behind_a_sport() {
        assert_eq!(label_number("Section 7", "Section"), Some(7));
        assert_eq!(label_number("Ride Section 7", "Section"), Some(7));
        assert_eq!(label_number("Abschnitt 4", "Section"), Some(4));
        assert_eq!(label_number("Seccao 2", "Seção"), Some(2));
        assert_eq!(label_number("セクション 3", "Section"), Some(3));
    }

    #[test]
    fn a_name_that_only_ends_in_a_number_is_not_a_label() {
        assert_eq!(label_number("Lakeside loop", "Section"), None);
        assert_eq!(label_number("Section", "Section"), None);
        assert_eq!(label_number("Section 0", "Section"), None);
        assert_eq!(label_number("Section 07", "Section"), None);
        assert_eq!(label_number("Route 66", "Section"), None);
        assert_eq!(label_number("Harbour Section 4", "Section"), None);
    }
}

#[cfg(test)]
#[path = "tests/split_names.rs"]
mod split_name_tests;

#[cfg(test)]
#[path = "tests/visible_count.rs"]
mod visible_count_tests;
