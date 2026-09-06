//! Four delete lists and one backup each answered "what is record and what is
//! cache" on their own, so a table added next year is safe in one of them and
//! forgotten by the other three. `persistence::tables` is the single answer,
//! and this holds it to the schema the way `clear_wipes_every_table` holds the
//! logout delete: driven from `sqlite_master`, never from a hand-kept list.

use std::collections::BTreeSet;

use rusqlite::Connection;
use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::persistence::tables::{TableClass, declared_tables};

fn schema_tables() -> (TempDir, BTreeSet<String>) {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("owners.db");
    PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    let conn = Connection::open(&path).expect("second connection");
    let mut stmt = conn
        .prepare(
            "SELECT name FROM sqlite_master
             WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .expect("read schema");
    let names = stmt
        .query_map([], |r| r.get::<_, String>(0))
        .expect("query")
        .map(|r| r.expect("name"))
        .collect();
    (dir, names)
}

#[test]
fn every_table_in_the_schema_declares_an_owner() {
    let (_dir, present) = schema_tables();
    assert!(present.len() > 20, "schema looks unmigrated: {present:?}");

    let declared: BTreeSet<String> = declared_tables()
        .iter()
        .map(|t| t.name.to_string())
        .collect();

    let undeclared: Vec<&String> = present.difference(&declared).collect();
    assert!(
        undeclared.is_empty(),
        "these tables say nothing about what they hold, so no delete list or \
         backup can decide about them: {undeclared:?}"
    );
}

#[test]
fn the_declaration_names_no_table_the_schema_lost() {
    let (_dir, present) = schema_tables();
    let stale: Vec<&'static str> = declared_tables()
        .iter()
        .map(|t| t.name)
        .filter(|n| !present.contains(*n))
        .collect();
    assert!(
        stale.is_empty(),
        "declared but not in the schema, so a migration dropped them and the \
         declaration was not followed: {stale:?}"
    );
}

#[test]
fn no_table_is_declared_twice() {
    let names: Vec<&'static str> = declared_tables().iter().map(|t| t.name).collect();
    let unique: BTreeSet<&'static str> = names.iter().copied().collect();
    assert_eq!(
        names.len(),
        unique.len(),
        "a table declared twice can be read as two different things"
    );
}

/// The logout delete keeps exactly what the declaration calls `Meta` or
/// `Device`. Without this the survivor list is a second, quieter declaration.
#[test]
fn only_meta_and_device_tables_survive_the_logout_delete() {
    let (_dir, present) = schema_tables();
    let path_dir = TempDir::new().expect("tempdir");
    let path = path_dir.path().join("clear.db");
    let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
    engine.set_setting("__a_setting", "kept").expect("setting");
    engine.clear().expect("clear");

    let conn = Connection::open(&path).expect("second connection");
    for name in &present {
        let count: i64 = conn
            .query_row(&format!("SELECT count(*) FROM \"{name}\""), [], |r| {
                r.get(0)
            })
            .unwrap_or(0);
        let class = veloqrs::persistence::tables::class_of(name)
            .unwrap_or_else(|| panic!("{name} declares no owner"));
        if count > 0 {
            assert!(
                class == TableClass::Meta || class == TableClass::Device,
                "{name} has rows after clear(), so it is not derived, mirror or record"
            );
        }
    }
}

/// A record table is the only kind whose loss is not recoverable, so the
/// classes must be spelled out rather than left to a reader of the delete
/// lists.
#[test]
fn every_class_is_used_and_the_record_set_is_named() {
    let record: Vec<&'static str> = declared_tables()
        .iter()
        .filter(|t| t.class == TableClass::Record)
        .map(|t| t.name)
        .collect();
    assert_eq!(
        record,
        vec![
            "identity_state",
            "route_names",
            "section_catalogue_archive",
            "section_catalogue_archive_members",
            "section_history",
            "section_intents",
            "section_pins",
            "sport_settings",
        ],
        "the record set changed, which changes what a backup has to carry"
    );

    for class in [
        TableClass::Mirror,
        TableClass::Record,
        TableClass::Derived,
        TableClass::Meta,
        TableClass::Device,
    ] {
        assert!(
            declared_tables().iter().any(|t| t.class == class),
            "{class:?} is declared by nothing, so it is a class with no meaning"
        );
    }
}

/// Two tables are derived rows carrying one athlete decision apiece. A
/// consumer that treats them as purely derived throws that decision away, so
/// the declaration says so rather than leaving it to `B322`'s reader.
#[test]
fn a_derived_table_holding_an_athlete_decision_says_so() {
    let mixed: Vec<(&'static str, &'static str)> = declared_tables()
        .iter()
        .filter_map(|t| t.record_part.map(|p| (t.name, p)))
        .collect();
    let names: Vec<&'static str> = mixed.iter().map(|(n, _)| *n).collect();
    assert_eq!(
        names,
        vec!["activity_matches", "section_activities", "sections"]
    );
    for (name, part) in mixed {
        assert!(
            !part.is_empty(),
            "{name} claims a record part and does not say what it is"
        );
    }
}
