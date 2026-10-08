use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use super::*;
use crate::test_globals::{init_global_engine, seeded_global_engine, serial_global_state};

fn stored_polyline(section_id: &str) -> Vec<f64> {
    with_reader(|conn| crate::persistence::sections::pooled::section_polyline(conn, section_id))
        .expect("reader")
}

fn track_latitudes(activity_id: &str) -> Vec<f64> {
    crate::persistence::with_persistent_engine(|e| e.get_gps_track(activity_id))
        .expect("engine")
        .expect("track")
        .iter()
        .map(|point| point.latitude)
        .collect()
}

fn latitudes(polyline: &[f64]) -> Vec<f64> {
    polyline.iter().step_by(2).copied().collect()
}

fn trim(section_id: &str, start_index: u32, end_index: u32) -> FfiSectionBoundsEdit {
    FfiSectionBoundsEdit::Trim {
        section_id: section_id.into(),
        start_index,
        end_index,
    }
}

/// Scenario: the athlete trims a section, resets it, then expands it past
/// its original ends, each through the one async edit.
///
/// Expected behaviour: every edit resolves with the rides it took out, and the
/// stored line is the slice the edit named.
#[test]
fn each_bounds_edit_resolves_with_the_line_it_named() {
    let _guard = serial_global_state();
    let _tmp = seeded_global_engine();
    let sections = SectionManager::new();
    let track = track_latitudes("a0");
    let id = sections
        .create("Ride".into(), None, "a0".into(), 1, 6)
        .expect("custom section");

    let departed =
        crate::runtime::block_on(sections.run_section_bounds_edit(trim(&id, 0, 4))).expect("trim");
    assert!(departed.is_empty(), "a0 still runs the trimmed line");
    assert_eq!(latitudes(&stored_polyline(&id)), track[1..=5].to_vec());

    let departed = crate::runtime::block_on(sections.run_section_bounds_edit(
        FfiSectionBoundsEdit::Reset {
            section_id: id.clone(),
        },
    ))
    .expect("reset");
    assert!(departed.is_empty());
    assert_eq!(latitudes(&stored_polyline(&id)), track[1..=6].to_vec());

    let departed = crate::runtime::block_on(sections.run_section_bounds_edit(
        FfiSectionBoundsEdit::Expand {
            section_id: id.clone(),
            activity_id: "a0".into(),
            start_index: 0,
            end_index: 7,
        },
    ))
    .expect("expand");
    assert!(departed.is_empty());
    assert_eq!(latitudes(&stored_polyline(&id)), track);
}

/// Scenario: an edit fails inside the editor, here a trim to one point.
///
/// Expected behaviour: it resolves as an error, the line is unchanged, and the
/// slot is free for the next edit.
#[test]
fn a_refused_edit_resolves_as_an_error_and_frees_the_slot() {
    let _guard = serial_global_state();
    let _tmp = seeded_global_engine();
    let sections = SectionManager::new();
    let id = sections
        .create("Ride".into(), None, "a0".into(), 0, 7)
        .expect("custom section");
    let before = stored_polyline(&id);

    let refused = crate::runtime::block_on(sections.run_section_bounds_edit(trim(&id, 3, 3)));
    assert!(refused.is_err(), "one point is not a line");
    assert_eq!(stored_polyline(&id), before);

    crate::runtime::block_on(sections.run_section_bounds_edit(trim(&id, 0, 5)))
        .expect("the slot is free after a refusal");
}

/// Scenario: a second edit is issued while the first is waiting on the engine.
///
/// Expected behaviour: the second is refused as busy without waiting, and the
/// first still completes once the engine is free.
#[test]
fn a_second_edit_while_one_runs_is_refused() {
    let _guard = serial_global_state();
    let _tmp = seeded_global_engine();
    let sections = SectionManager::new();
    let id = sections
        .create("Ride".into(), None, "a0".into(), 0, 7)
        .expect("custom section");

    let first = crate::persistence::with_persistent_engine(|_held| {
        let first_id = id.clone();
        let first = std::thread::spawn(move || {
            crate::runtime::block_on(
                SectionManager::new().run_section_bounds_edit(trim(&first_id, 0, 5)),
            )
        });
        let deadline = Instant::now() + Duration::from_secs(5);
        while !SECTION_EDIT_IN_FLIGHT.load(Ordering::SeqCst) {
            assert!(
                Instant::now() < deadline,
                "the first edit never took the slot"
            );
            std::thread::yield_now();
        }

        let second = crate::runtime::block_on(sections.run_section_bounds_edit(trim(&id, 1, 6)));
        assert!(
            matches!(second, Err(VeloqError::Busy { .. })),
            "the second edit must be refused, got {second:?}"
        );
        first
    })
    .expect("engine");

    first
        .join()
        .expect("first edit thread")
        .expect("first edit");
    assert_eq!(
        latitudes(&stored_polyline(&id)),
        track_latitudes("a0")[0..=5]
    );
}

/// Scenario: an edit is issued against one library and a restore installs
/// another before the edit reaches the engine.
///
/// Expected behaviour: the edit resolves as an error and the restored
/// library's section is not written.
#[test]
fn an_edit_from_a_replaced_install_writes_nothing() {
    let _guard = serial_global_state();
    let _old = seeded_global_engine();
    let stale = crate::persistence::engine_install();

    let _new = init_global_engine("restored.db");
    crate::persistence::with_persistent_engine(|engine| {
        engine
            .add_activity(
                "a0".into(),
                (0..8)
                    .map(|i| tracematch::GpsPoint::new(46.2 + f64::from(i) * 0.001, 7.35))
                    .collect(),
                "Ride".into(),
            )
            .expect("add activity");
    })
    .expect("engine");
    let sections = SectionManager::new();
    let id = sections
        .create("Ride".into(), None, "a0".into(), 0, 7)
        .expect("custom section");
    let before = stored_polyline(&id);

    let slot = InFlight::claim(&SECTION_EDIT_IN_FLIGHT, "taken").expect("slot");
    let outcome = crate::runtime::block_on(bounds_edit_for(stale, trim(&id, 0, 5), slot));

    assert!(
        outcome.is_err(),
        "an edit from a replaced install must fail"
    );
    assert_eq!(stored_polyline(&id), before);
    assert!(
        !SECTION_EDIT_IN_FLIGHT.load(Ordering::SeqCst),
        "a discarded edit frees the slot"
    );

    crate::runtime::block_on(sections.run_section_bounds_edit(trim(&id, 0, 5)))
        .expect("the same edit against the open library is written");
    assert_ne!(stored_polyline(&id), before);
}
