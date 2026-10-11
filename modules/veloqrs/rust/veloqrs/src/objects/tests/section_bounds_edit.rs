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

/// A ride over the same road as `a0`, sampled ten times as densely and running
/// a little past both of its ends.
fn add_ride_over_a0(activity_id: &str) {
    let track: Vec<tracematch::GpsPoint> = (0..90)
        .map(|i| tracematch::GpsPoint::new(46.1995 + f64::from(i) * 0.0001, 7.35))
        .collect();
    crate::persistence::with_persistent_engine(|engine| {
        engine
            .add_activity(activity_id.into(), track, "Ride".into())
            .expect("add activity");
    })
    .expect("engine");
}

fn set_reference(section_id: &str, activity_id: &str) -> FfiSectionBoundsEdit {
    FfiSectionBoundsEdit::SetReference {
        section_id: section_id.into(),
        activity_id: activity_id.into(),
    }
}

/// Scenario: the athlete makes another ride the section's reference, then
/// resets the reference, each through the one async edit.
///
/// Expected behaviour: setting it stores a stretch of that ride's track and
/// marks the section user-defined; resetting it puts the line the section
/// was drawn on back and clears the mark.
#[test]
fn set_and_reset_reference_run_as_section_edits() {
    let _guard = serial_global_state();
    let _tmp = seeded_global_engine();
    add_ride_over_a0("b0");
    let other = track_latitudes("b0");
    let sections = SectionManager::new();
    let id = sections
        .create("Ride".into(), None, "a0".into(), 0, 7)
        .expect("custom section");
    let drawn = stored_polyline(&id);

    crate::runtime::block_on(sections.run_section_bounds_edit(set_reference(&id, "b0")))
        .expect("set reference");
    let info = sections.get_reference_info(id.clone()).expect("reference");
    assert_eq!(info.activity_id, "b0");
    assert!(info.is_user_defined);
    let line = latitudes(&stored_polyline(&id));
    assert!(
        line.len() > 8,
        "the line is the denser ride's, got {line:?}"
    );
    assert!(
        other
            .windows(line.len())
            .any(|stretch| stretch == line.as_slice()),
        "the line is one stretch of the reference ride"
    );

    crate::runtime::block_on(sections.run_section_bounds_edit(
        FfiSectionBoundsEdit::ResetReference {
            section_id: id.clone(),
        },
    ))
    .expect("reset reference");
    assert_eq!(stored_polyline(&id), drawn);
    assert!(
        !sections
            .get_reference_info(id.clone())
            .expect("reference")
            .is_user_defined
    );
}

/// Scenario: a reference is set or reset while a bounds edit is waiting on
/// the engine.
///
/// Expected behaviour: both are refused as busy without waiting, and the
/// running edit still completes.
#[test]
fn a_reference_edit_while_a_bounds_edit_runs_is_refused() {
    let _guard = serial_global_state();
    let _tmp = seeded_global_engine();
    add_ride_over_a0("b0");
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

        for edit in [
            set_reference(&id, "b0"),
            FfiSectionBoundsEdit::ResetReference {
                section_id: id.clone(),
            },
        ] {
            let refused = crate::runtime::block_on(sections.run_section_bounds_edit(edit));
            assert!(
                matches!(refused, Err(VeloqError::Busy { .. })),
                "a reference edit must be refused, got {refused:?}"
            );
        }
        first
    })
    .expect("engine");

    first
        .join()
        .expect("first edit thread")
        .expect("first edit");
    let info = sections.get_reference_info(id.clone()).expect("reference");
    assert_eq!(info.activity_id, "a0");
}

fn section_exists(section_id: &str) -> bool {
    with_reader(|conn| {
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM sections WHERE id = ?)",
            [section_id],
            |row| row.get::<_, bool>(0),
        )
        .expect("query")
    })
    .expect("reader")
}

fn revert(section_id: &str, version: f64) -> FfiSectionBoundsEdit {
    FfiSectionBoundsEdit::Revert {
        section_id: section_id.into(),
        version,
    }
}

/// Scenario: the athlete trims a section, then puts its first stored version
/// back through the one async edit.
///
/// Expected behaviour: the stored line is the chosen version's, and the
/// section is pinned to that version.
#[test]
fn a_revert_runs_as_a_section_edit_and_pins_the_version() {
    let _guard = serial_global_state();
    let _tmp = seeded_global_engine();
    let sections = SectionManager::new();
    let id = sections
        .create("Ride".into(), None, "a0".into(), 0, 7)
        .expect("custom section");
    let drawn = stored_polyline(&id);
    crate::runtime::block_on(sections.run_section_bounds_edit(trim(&id, 1, 5))).expect("trim");
    assert_ne!(stored_polyline(&id), drawn);

    let versions = sections
        .get_geometry_versions(id.clone())
        .expect("versions");
    assert!(versions.len() >= 2, "a trim stores a second version");
    let first = versions
        .iter()
        .map(|v| v.version)
        .fold(f64::INFINITY, f64::min);

    let departed = crate::runtime::block_on(sections.run_section_bounds_edit(revert(&id, first)))
        .expect("revert");
    assert!(departed.is_empty(), "a0 still runs the drawn line");
    assert_eq!(stored_polyline(&id), drawn);
    assert_eq!(
        sections.get_pinned_version(id.clone()).expect("pinned"),
        Some(first)
    );
}

/// Scenario: the athlete asks for a version the section never stored.
///
/// Expected behaviour: the edit resolves as an error, the line is unchanged,
/// and the slot is free for the next edit.
#[test]
fn a_revert_to_a_missing_version_is_refused_and_frees_the_slot() {
    let _guard = serial_global_state();
    let _tmp = seeded_global_engine();
    let sections = SectionManager::new();
    let id = sections
        .create("Ride".into(), None, "a0".into(), 0, 7)
        .expect("custom section");
    let before = stored_polyline(&id);

    let refused = crate::runtime::block_on(sections.run_section_bounds_edit(revert(&id, 999.0)));
    assert!(refused.is_err(), "no version 999 was stored");
    assert_eq!(stored_polyline(&id), before);
    assert_eq!(
        sections.get_pinned_version(id.clone()).expect("pinned"),
        None
    );

    crate::runtime::block_on(sections.run_section_bounds_edit(trim(&id, 0, 5)))
        .expect("the slot is free after a refusal");
}

/// Scenario: the athlete merges one section into another through the async
/// merge.
///
/// Expected behaviour: the secondary is gone, the primary is kept, and the
/// outcome names the primary.
#[test]
fn a_merge_runs_off_the_thread_and_names_the_kept_section() {
    let _guard = serial_global_state();
    let _tmp = seeded_global_engine();
    let sections = SectionManager::new();
    let primary = sections
        .create("Ride".into(), None, "a0".into(), 0, 7)
        .expect("primary");
    let secondary = sections
        .create("Ride".into(), None, "a0".into(), 1, 6)
        .expect("secondary");

    let outcome =
        crate::runtime::block_on(sections.run_section_merge(primary.clone(), secondary.clone()))
            .expect("merge");
    assert_eq!(outcome.section_id, primary);
    assert!(outcome.departed.is_empty(), "a0 runs the kept line");
    assert!(section_exists(&primary));
    assert!(!section_exists(&secondary), "the secondary is deleted");

    let refused = crate::runtime::block_on(sections.run_section_merge(primary.clone(), primary));
    assert!(refused.is_err(), "a section does not merge with itself");
    crate::runtime::block_on(sections.run_section_bounds_edit(trim(&outcome.section_id, 0, 5)))
        .expect("the slot is free after a refused merge");
}

/// Scenario: a revert or a merge is issued while a bounds edit is waiting on
/// the engine.
///
/// Expected behaviour: both are refused as busy without waiting, the
/// secondary survives, and the running edit still completes.
#[test]
fn a_revert_or_merge_while_a_bounds_edit_runs_is_refused() {
    let _guard = serial_global_state();
    let _tmp = seeded_global_engine();
    let sections = SectionManager::new();
    let id = sections
        .create("Ride".into(), None, "a0".into(), 0, 7)
        .expect("custom section");
    let other = sections
        .create("Ride".into(), None, "a0".into(), 1, 6)
        .expect("other section");

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

        let reverted = crate::runtime::block_on(sections.run_section_bounds_edit(revert(&id, 1.0)));
        assert!(
            matches!(reverted, Err(VeloqError::Busy { .. })),
            "a revert must be refused, got {reverted:?}"
        );
        let merged =
            crate::runtime::block_on(sections.run_section_merge(id.clone(), other.clone()));
        assert!(
            matches!(merged, Err(VeloqError::Busy { .. })),
            "a merge must be refused, got {merged:?}"
        );
        first
    })
    .expect("engine");

    first
        .join()
        .expect("first edit thread")
        .expect("first edit");
    assert!(section_exists(&other), "a refused merge deletes nothing");
    assert_eq!(
        sections.get_pinned_version(id.clone()).expect("pinned"),
        None
    );
    assert_eq!(
        latitudes(&stored_polyline(&id)),
        track_latitudes("a0")[0..=5]
    );
}
