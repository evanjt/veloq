//! Scenario: the Routes list calls `get_summaries_with_count` on every open,
//! and an aggregation over the junction table inside it would make the open
//! cost grow with every activity ever matched to a section, while nothing
//! else failed.
//!
//! Expected behaviour: the count and the summaries (and the sport-filtered
//! variant the sport tabs use) execute the same number of SQLite virtual
//! machine steps against a library with four times the junction rows, because
//! they are column reads. `get_sections` returns the loaded sections and costs
//! no more steps for the extra junction rows either. The steps
//! come from SQLite's progress handler, which reads no clock.

use std::sync::atomic::{AtomicUsize, Ordering};

use rusqlite::params;

use crate::PersistentEngine;

const SECTIONS: usize = 40;
const FEW_ACTIVITIES_PER_SECTION: usize = 5;
const MANY_ACTIVITIES_PER_SECTION: usize = 20;

type Read = fn(&mut PersistentEngine) -> usize;

static STEPS: AtomicUsize = AtomicUsize::new(0);

fn count_step() -> bool {
    STEPS.fetch_add(1, Ordering::SeqCst);
    false
}

/// The virtual machine steps `read` costs on `engine`'s connection.
fn steps_in<T>(
    engine: &mut PersistentEngine,
    read: impl FnOnce(&mut PersistentEngine) -> T,
) -> usize {
    STEPS.store(0, Ordering::SeqCst);
    engine.db.progress_handler(1, Some(count_step));
    let result = read(engine);
    engine.db.progress_handler(1, None::<fn() -> bool>);
    std::hint::black_box(result);
    STEPS.load(Ordering::SeqCst)
}

fn seeded(sections: usize, activities_per_section: usize) -> PersistentEngine {
    let mut engine = PersistentEngine::in_memory().expect("engine");
    let sports = ["Ride", "Run", "Hike", "Walk", "Swim"];
    {
        let tx = engine.db.transaction().expect("tx");
        for s in 0..sections {
            let sport = sports[s % sports.len()];
            let sid = format!("sec_{s}");
            let poly =
                "[{\"latitude\":46.2,\"longitude\":7.3},{\"latitude\":46.21,\"longitude\":7.31}]";
            tx.execute(
                "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                    distance_meters, is_user_defined, version, created_at,
                    bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
                 VALUES (?, 'auto', ?, ?, ?, 3000.0, 0, 1, '2026-01-01T00:00:00Z',
                    46.2, 46.21, 7.3, 7.31)",
                params![sid, format!("Section {s}"), sport, poly],
            )
            .expect("insert section");
            for a in 0..activities_per_section {
                let aid = format!("act_{s}_{a}");
                tx.execute(
                    "INSERT OR IGNORE INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng)
                     VALUES (?, ?, 46.2, 46.21, 7.3, 7.31)",
                    params![aid, sport],
                )
                .expect("insert activity");
                tx.execute(
                    "INSERT OR IGNORE INTO activity_metrics (activity_id, name, date, distance,
                        moving_time, elapsed_time, elevation_gain, sport_type)
                     VALUES (?, ?, 1735689600, 3000.0, 600, 600, 10.0, ?)",
                    params![aid, aid, sport],
                )
                .expect("insert metrics");
                tx.execute(
                    "INSERT INTO section_activities (section_id, activity_id, direction,
                        start_index, end_index, distance_meters, lap_time, lap_pace)
                     VALUES (?, ?, 'same', 0, 100, 3000.0, 600.0, 5.0)",
                    params![sid, aid],
                )
                .expect("insert junction");
            }
        }
        tx.commit().expect("commit seed");
    }
    engine.load().expect("load");
    engine
}

#[test]
fn the_summaries_read_costs_the_same_however_many_activities_a_section_holds() {
    let mut few = seeded(SECTIONS, FEW_ACTIVITIES_PER_SECTION);
    let mut many = seeded(SECTIONS, MANY_ACTIVITIES_PER_SECTION);

    let reads: [(&str, Read); 2] = [
        ("summaries and count", |e| {
            e.get_section_count() as usize + e.get_section_summaries().len()
        }),
        ("summaries for a sport", |e| {
            e.get_section_summaries_for_sport("Ride").len()
        }),
    ];
    for (name, read) in reads {
        let on_few = steps_in(&mut few, read);
        let on_many = steps_in(&mut many, read);
        assert!(on_few > 0, "{name} ran no statement");
        assert!(
            on_many <= on_few,
            "{name} took {on_many} steps against {MANY_ACTIVITIES_PER_SECTION} activities per section \
             and {on_few} against {FEW_ACTIVITIES_PER_SECTION}: it is aggregating over the junction \
             table rather than reading a column"
        );
    }
    assert_eq!(many.get_section_summaries().len(), SECTIONS);
}

#[test]
fn get_sections_costs_no_more_for_the_extra_junction_rows() {
    let mut few = seeded(SECTIONS, FEW_ACTIVITIES_PER_SECTION);
    let mut many = seeded(SECTIONS, MANY_ACTIVITIES_PER_SECTION);

    let on_few = steps_in(&mut few, |e| e.get_sections().len());
    let on_many = steps_in(&mut many, |e| e.get_sections().len());

    assert!(
        on_many <= on_few,
        "get_sections took {on_many} steps against {MANY_ACTIVITIES_PER_SECTION} activities per \
         section and {on_few} against {FEW_ACTIVITIES_PER_SECTION}: its cost follows the junction rows"
    );
    assert_eq!(many.get_sections().len(), SECTIONS);
}
