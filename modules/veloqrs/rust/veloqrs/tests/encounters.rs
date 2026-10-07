//! Integration tests for `get_activity_section_encounters` and PR detection.
//!
//! Strategy: spin up a real PersistentEngine (which runs migrations),
//! then insert fixtures directly via a parallel rusqlite connection. This
//! avoids the slow GPS-detection pipeline while exercising the actual SQL
//! that the production query runs.
//!
//! Run: `cargo test --test app -p veloqrs -- encounters::`

use rusqlite::{Connection, params};
use std::path::PathBuf;
use tempfile::TempDir;
use veloqrs::PersistentEngine;

struct Setup {
    engine: PersistentEngine,
    raw: Connection,
    _tmp: TempDir,
}

fn setup() -> Setup {
    let tmp = TempDir::new().expect("temp dir");
    let path: PathBuf = tmp.path().join("test.db");
    let path_str = path.to_str().unwrap().to_string();

    // Constructing the engine runs all migrations.
    let engine = PersistentEngine::new(&path_str).expect("engine new");
    let raw = Connection::open(&path).expect("raw open");

    Setup {
        engine,
        raw,
        _tmp: tmp,
    }
}

fn insert_activity(
    db: &Connection,
    id: &str,
    start_date_unix: i64,
    distance_m: f64,
    duration_s: i64,
) {
    db.execute(
        "INSERT INTO activities (id, sport_type, min_lat, max_lat, min_lng, max_lng,
                                  start_date, name, distance_meters, duration_secs)
         VALUES (?1, 'Ride', 46.0, 46.1, 7.0, 7.1, ?2, ?3, ?4, ?5)",
        params![
            id,
            start_date_unix,
            format!("Activity {}", id),
            distance_m,
            duration_s
        ],
    )
    .expect("insert activity");
}

fn insert_section(db: &Connection, id: &str, name: &str, distance_m: f64) {
    db.execute(
        "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                               distance_meters, disabled, version)
         VALUES (?1, 'auto', ?2, 'Ride', '[]', ?3, 0, 1)",
        params![id, name, distance_m],
    )
    .expect("insert section");
}

fn insert_traversal(
    db: &Connection,
    section_id: &str,
    activity_id: &str,
    direction: &str,
    start_index: i64,
    distance_m: f64,
    lap_time_s: f64,
) {
    db.execute(
        "INSERT INTO section_activities (section_id, activity_id, direction, start_index,
                                         end_index, distance_meters, lap_time, lap_pace, excluded)
         VALUES (?1, ?2, ?3, ?4, 0, ?5, ?6, ?7, 0)",
        params![
            section_id,
            activity_id,
            direction,
            start_index,
            distance_m,
            lap_time_s,
            if lap_time_s > 0.0 {
                distance_m / lap_time_s
            } else {
                0.0
            }
        ],
    )
    .expect("insert traversal");
}

// ============================================================================
// Basic shape and field mapping
// ============================================================================

#[test]
fn returns_empty_for_unknown_activity() {
    let setup = setup();
    let result = setup
        .engine
        .get_activity_section_encounters("does-not-exist");
    assert!(result.is_empty());
}

#[test]
fn one_section_one_traversal_yields_one_encounter() {
    let setup = setup();
    insert_activity(&setup.raw, "a1", 1_700_000_000, 1000.0, 300);
    insert_section(&setup.raw, "s1", "Test Climb", 800.0);
    insert_traversal(&setup.raw, "s1", "a1", "same", 0, 800.0, 240.0);

    let result = setup.engine.get_activity_section_encounters("a1");
    assert_eq!(result.len(), 1);
    let e = &result[0];
    assert_eq!(e.section_id, "s1");
    assert_eq!(e.section_name, "Test Climb");
    assert_eq!(e.direction, "same");
    assert_eq!(e.distance_meters, 800.0);
    assert_eq!(e.lap_time, 240.0);
    assert!(!e.is_pr, "a single traversal has beaten nothing");
    assert_eq!(e.history_times.len(), 1);
    assert_eq!(e.history_activity_ids.len(), 1);
    assert_eq!(e.history_activity_ids[0], "a1");
}

#[test]
fn encounter_carries_custom_type_without_an_id_prefix() {
    let setup = setup();
    insert_activity(&setup.raw, "a1", 1_700_000_000, 1000.0, 300);
    insert_section(&setup.raw, "foreign-id", "Hand drawn", 800.0);
    setup
        .raw
        .execute(
            "UPDATE sections SET section_type = 'custom' WHERE id = 'foreign-id'",
            [],
        )
        .expect("mark custom");
    insert_traversal(&setup.raw, "foreign-id", "a1", "same", 0, 800.0, 240.0);

    let encounters = setup.engine.get_activity_section_encounters("a1");
    assert_eq!(encounters.len(), 1);
    assert_eq!(encounters[0].section_type, "custom");
}

#[test]
fn forward_and_reverse_yield_two_independent_encounters() {
    let setup = setup();
    insert_activity(&setup.raw, "a1", 1_700_000_000, 2000.0, 600);
    insert_section(&setup.raw, "s1", "Loop", 500.0);
    insert_traversal(&setup.raw, "s1", "a1", "same", 0, 500.0, 150.0);
    insert_traversal(&setup.raw, "s1", "a1", "reverse", 1000, 500.0, 160.0);

    let result = setup.engine.get_activity_section_encounters("a1");
    assert_eq!(result.len(), 2, "one entry per (section, direction)");

    let same = result.iter().find(|e| e.direction == "same").unwrap();
    let rev = result.iter().find(|e| e.direction == "reverse").unwrap();
    assert_eq!(same.lap_time, 150.0);
    assert_eq!(rev.lap_time, 160.0);
    assert!(!same.is_pr);
    assert!(
        !rev.is_pr,
        "each direction stands alone, and neither has beaten anything"
    );
}

#[test]
fn history_arrays_are_aligned_in_length() {
    let setup = setup();
    insert_section(&setup.raw, "s1", "Repeated", 500.0);
    for i in 0..5 {
        let id = format!("a{}", i);
        insert_activity(&setup.raw, &id, 1_700_000_000 + i * 86_400, 500.0, 200);
        insert_traversal(&setup.raw, "s1", &id, "same", 0, 500.0, 200.0 - i as f64);
    }

    let result = setup.engine.get_activity_section_encounters("a4");
    assert_eq!(result.len(), 1);
    let e = &result[0];
    assert_eq!(
        e.history_times.len(),
        e.history_activity_ids.len(),
        "history arrays must be aligned"
    );
    assert_eq!(e.history_times.len(), 5);
    assert_eq!(e.visit_count, 5);
}

#[test]
fn excluded_traversals_are_filtered_out() {
    let setup = setup();
    insert_activity(&setup.raw, "a1", 1_700_000_000, 1000.0, 300);
    insert_section(&setup.raw, "s1", "Climb", 800.0);
    insert_traversal(&setup.raw, "s1", "a1", "same", 0, 800.0, 240.0);
    setup
        .raw
        .execute(
            "UPDATE section_activities SET excluded = 1 WHERE activity_id = 'a1'",
            [],
        )
        .expect("update excluded");

    let result = setup.engine.get_activity_section_encounters("a1");
    assert!(result.is_empty(), "excluded traversals must not appear");
}

#[test]
fn disabled_sections_are_filtered_out() {
    let setup = setup();
    insert_activity(&setup.raw, "a1", 1_700_000_000, 1000.0, 300);
    insert_section(&setup.raw, "s1", "Hidden", 800.0);
    insert_traversal(&setup.raw, "s1", "a1", "same", 0, 800.0, 240.0);
    setup
        .raw
        .execute("UPDATE sections SET disabled = 1 WHERE id = 's1'", [])
        .expect("disable section");

    let result = setup.engine.get_activity_section_encounters("a1");
    assert!(result.is_empty(), "disabled sections must not appear");
}

// ============================================================================
// PR detection. A record is beaten, not matched and not nearly matched: the
// 0.5 % band these two tests were written for is retired, so each keeps its
// case and asserts the opposite of what it used to.
// ============================================================================

#[test]
fn a_short_section_near_miss_is_not_a_record() {
    // 5s sprint section. Best is 4.99s, this attempt 5.00s. The retired band
    // called 0.2 % off a record.
    let setup = setup();
    insert_section(&setup.raw, "s1", "Sprint", 50.0);
    insert_activity(&setup.raw, "a_best", 1_700_000_000, 50.0, 5);
    insert_traversal(&setup.raw, "s1", "a_best", "same", 0, 50.0, 4.99);
    insert_activity(&setup.raw, "a_now", 1_700_086_400, 50.0, 5);
    insert_traversal(&setup.raw, "s1", "a_now", "same", 0, 50.0, 5.0);

    let r = setup.engine.get_activity_section_encounters("a_now");
    assert_eq!(r.len(), 1);
    assert!(!r[0].is_pr, "5.00s did not beat 4.99s, so it is no record");
}

#[test]
fn a_long_section_near_miss_is_not_a_record_either() {
    // 30 minute climb. Best 1799s, this attempt 1800s. The retired band scaled
    // with the effort, so a whole second off half an hour read as a record.
    // The length of the effort no longer buys the badge.
    let setup = setup();
    insert_section(&setup.raw, "s1", "Long Climb", 5000.0);
    insert_activity(&setup.raw, "a_best", 1_700_000_000, 5000.0, 1800);
    insert_traversal(&setup.raw, "s1", "a_best", "same", 0, 5000.0, 1799.0);
    insert_activity(&setup.raw, "a_now", 1_700_086_400, 5000.0, 1800);
    insert_traversal(&setup.raw, "s1", "a_now", "same", 0, 5000.0, 1800.0);

    let r = setup.engine.get_activity_section_encounters("a_now");
    assert_eq!(r.len(), 1);
    assert!(
        !r[0].is_pr,
        "1800.0s did not beat 1799.0s, however long the climb"
    );
}

/// Expected behaviour: the site is not simply switched off. An attempt that
/// beats the best still earns the badge, at either length of effort.
#[test]
fn beating_the_best_is_still_a_record_on_the_encounter_list() {
    for (metres, best, now) in [(50.0_f64, 4.99_f64, 4.90_f64), (5000.0, 1799.0, 1790.0)] {
        let setup = setup();
        insert_section(&setup.raw, "s1", "Section", metres);
        insert_activity(&setup.raw, "a_best", 1_700_000_000, metres, best as i64);
        insert_traversal(&setup.raw, "s1", "a_best", "same", 0, metres, best);
        insert_activity(&setup.raw, "a_now", 1_700_086_400, metres, now as i64);
        insert_traversal(&setup.raw, "s1", "a_now", "same", 0, metres, now);

        let r = setup.engine.get_activity_section_encounters("a_now");
        assert_eq!(r.len(), 1);
        assert!(r[0].is_pr, "{now} beat {best} over {metres} m");
    }
}

/// Expected behaviour: a first-ever traversal has beaten nothing, and a lapped
/// session's own laps are not a history to beat.
#[test]
fn a_first_traversal_is_not_a_record_however_many_laps_it_holds() {
    let setup = setup();
    insert_section(&setup.raw, "s1", "Oval", 400.0);
    insert_activity(&setup.raw, "a_only", 1_700_000_000, 400.0, 300);
    insert_traversal(&setup.raw, "s1", "a_only", "same", 0, 400.0, 110.0);
    insert_traversal(&setup.raw, "s1", "a_only", "same", 200, 400.0, 90.0);

    let r = setup.engine.get_activity_section_encounters("a_only");
    assert_eq!(r.len(), 1);
    assert!(!r[0].is_pr, "one session has beaten nothing but itself");
}

#[test]
fn not_pr_when_outside_relative_tolerance() {
    // 100s section. Best 90s, this 100s = 11% slower → not PR.
    let setup = setup();
    insert_section(&setup.raw, "s1", "Section", 500.0);
    insert_activity(&setup.raw, "a_best", 1_700_000_000, 500.0, 100);
    insert_traversal(&setup.raw, "s1", "a_best", "same", 0, 500.0, 90.0);
    insert_activity(&setup.raw, "a_now", 1_700_086_400, 500.0, 110);
    insert_traversal(&setup.raw, "s1", "a_now", "same", 0, 500.0, 100.0);

    let r = setup.engine.get_activity_section_encounters("a_now");
    assert_eq!(r.len(), 1);
    assert!(!r[0].is_pr, "11% slower must not be PR");
}

#[test]
fn pr_independent_per_direction() {
    // One earlier attempt each way, beaten forward and not beaten in reverse,
    // so the two directions are judged against their own histories.
    let setup = setup();
    insert_section(&setup.raw, "s1", "Loop", 500.0);
    insert_activity(&setup.raw, "a_old", 1_700_000_000, 500.0, 100);
    insert_traversal(&setup.raw, "s1", "a_old", "same", 0, 500.0, 120.0);
    insert_traversal(&setup.raw, "s1", "a_old", "reverse", 100, 500.0, 80.0);
    insert_activity(&setup.raw, "a_now", 1_700_086_400, 500.0, 100);
    insert_traversal(&setup.raw, "s1", "a_now", "same", 0, 500.0, 100.0);
    insert_traversal(&setup.raw, "s1", "a_now", "reverse", 100, 500.0, 95.0);

    let r = setup.engine.get_activity_section_encounters("a_now");
    let same = r.iter().find(|e| e.direction == "same").unwrap();
    let rev = r.iter().find(|e| e.direction == "reverse").unwrap();
    assert!(same.is_pr, "forward 100s beat the forward best of 120s");
    assert!(
        !rev.is_pr,
        "reverse 95s did not beat the reverse best of 80s"
    );
}

// --- One encounter per (section, direction) ---
//
// The junction holds a row per lap; laps themselves are the FfiSectionLap
// surface.

#[test]
fn a_lapped_section_is_one_encounter_carrying_the_fastest_lap() {
    let s = setup();
    insert_activity(&s.raw, "act_intervals", 1_700_000_000, 10_000.0, 3_000);
    insert_section(&s.raw, "sec_oval", "Oval", 400.0);

    // Deliberately not in time order, and the slowest lap is written last.
    insert_traversal(&s.raw, "sec_oval", "act_intervals", "same", 0, 400.0, 110.0);
    insert_traversal(
        &s.raw,
        "sec_oval",
        "act_intervals",
        "same",
        100,
        400.0,
        90.0,
    );
    insert_traversal(
        &s.raw,
        "sec_oval",
        "act_intervals",
        "same",
        200,
        400.0,
        105.0,
    );

    let encounters = s.engine.get_activity_section_encounters("act_intervals");

    assert_eq!(
        encounters.len(),
        1,
        "three laps of one section are one encounter, got {encounters:?}"
    );
    assert_eq!(
        encounters[0].lap_time, 90.0,
        "the encounter must be represented by the fastest lap"
    );
    assert_eq!(
        encounters[0].visit_count, 3,
        "the count still reports every pass"
    );
}

#[test]
fn opposite_directions_stay_separate_encounters() {
    let s = setup();
    insert_activity(&s.raw, "act_out_and_back", 1_700_000_000, 10_000.0, 3_000);
    insert_section(&s.raw, "sec_strip", "Strip", 400.0);

    insert_traversal(
        &s.raw,
        "sec_strip",
        "act_out_and_back",
        "same",
        0,
        400.0,
        100.0,
    );
    insert_traversal(
        &s.raw,
        "sec_strip",
        "act_out_and_back",
        "reverse",
        200,
        400.0,
        95.0,
    );

    let encounters = s.engine.get_activity_section_encounters("act_out_and_back");

    assert_eq!(
        encounters.len(),
        2,
        "an out-and-back is two encounters, not one collapsed pair"
    );
}

#[test]
fn an_untimed_lap_never_displaces_a_timed_one() {
    let s = setup();
    insert_activity(&s.raw, "act_mixed", 1_700_000_000, 10_000.0, 3_000);
    insert_section(&s.raw, "sec_oval", "Oval", 400.0);

    // A zero lap_time sorts ahead of every real time on a naive ascending sort.
    insert_traversal(&s.raw, "sec_oval", "act_mixed", "same", 0, 400.0, 0.0);
    insert_traversal(&s.raw, "sec_oval", "act_mixed", "same", 100, 400.0, 95.0);

    let encounters = s.engine.get_activity_section_encounters("act_mixed");

    assert_eq!(encounters.len(), 1, "one section, one encounter");
    assert_eq!(
        encounters[0].lap_time, 95.0,
        "the timed lap must represent the encounter"
    );
}

fn insert_traversal_with_null_pace(
    db: &Connection,
    section_id: &str,
    activity_id: &str,
    distance_m: f64,
    lap_time_s: Option<f64>,
) {
    db.execute(
        "INSERT INTO section_activities (section_id, activity_id, direction, start_index,
                                         end_index, distance_meters, lap_time, lap_pace, excluded)
         VALUES (?1, ?2, 'same', 0, 0, ?3, ?4, NULL, 0)",
        params![section_id, activity_id, distance_m, lap_time_s],
    )
    .expect("insert traversal");
}

#[test]
fn a_timed_lap_without_a_stored_pace_reads_distance_over_time() {
    let s = setup();
    insert_activity(&s.raw, "act_nopace", 1_700_000_000, 5_000.0, 1_500);
    insert_section(&s.raw, "sec_flat", "Flat", 1_000.0);
    insert_traversal_with_null_pace(&s.raw, "sec_flat", "act_nopace", 1_000.0, Some(200.0));

    let encounters = s.engine.get_activity_section_encounters("act_nopace");

    assert_eq!(encounters.len(), 1);
    assert_eq!(encounters[0].lap_time, 200.0);
    assert_eq!(encounters[0].lap_pace, 5.0);
}

#[test]
fn an_untimed_lap_without_a_stored_pace_reads_zero_for_both() {
    let s = setup();
    insert_activity(&s.raw, "act_untimed", 1_700_000_000, 5_000.0, 1_500);
    insert_section(&s.raw, "sec_flat", "Flat", 1_000.0);
    insert_traversal_with_null_pace(&s.raw, "sec_flat", "act_untimed", 1_000.0, None);

    let encounters = s.engine.get_activity_section_encounters("act_untimed");

    assert_eq!(encounters.len(), 1);
    assert_eq!(encounters[0].lap_time, 0.0);
    assert_eq!(encounters[0].lap_pace, 0.0);
}

// ============================================================================
// Complete traversals: the record rule the section screen applies
// ============================================================================

fn insert_measured_traversal(
    db: &Connection,
    section_id: &str,
    activity_id: &str,
    direction: &str,
    start_index: i64,
    lap_time_s: f64,
    coverage: f64,
) {
    insert_traversal(
        db,
        section_id,
        activity_id,
        direction,
        start_index,
        2_000.0,
        lap_time_s,
    );
    db.execute(
        "UPDATE section_activities SET coverage = ?1
         WHERE section_id = ?2 AND activity_id = ?3 AND start_index = ?4",
        params![coverage, section_id, activity_id, start_index],
    )
    .expect("set coverage");
}

/// Scenario: a 2 km section with a full lap of 380 s from another ride, and
/// one activity whose `same` row covers 60 per cent of the section at 230 s.
///
/// Expected behaviour: the fragment is no record, as the section screen and
/// the feed say, and it is no rival either, so a later full lap of 370 s
/// that beats only full laps keeps its trophy.
#[test]
fn a_fragment_neither_takes_a_trophy_nor_denies_one() {
    let s = setup();
    insert_activity(&s.raw, "full_a", 1_700_000_000, 10_000.0, 3_000);
    insert_activity(&s.raw, "frag", 1_700_100_000, 10_000.0, 3_000);
    insert_activity(&s.raw, "full_b", 1_700_200_000, 10_000.0, 3_000);
    insert_section(&s.raw, "sec_long", "Long Climb", 2_000.0);
    insert_measured_traversal(&s.raw, "sec_long", "full_a", "same", 0, 380.0, 1.0);
    insert_measured_traversal(&s.raw, "sec_long", "frag", "same", 0, 230.0, 0.6);
    insert_measured_traversal(&s.raw, "sec_long", "full_b", "same", 0, 370.0, 1.0);

    let frag = s.engine.get_activity_section_encounters("frag");
    assert_eq!(frag.len(), 1);
    assert!(!frag[0].is_complete);
    assert!(
        frag.iter().all(|e| !e.is_pr),
        "a fragment takes no trophy: {frag:?}"
    );

    let full_b = s.engine.get_activity_section_encounters("full_b");
    assert_eq!(full_b.len(), 1);
    assert!(full_b[0].is_complete);
    assert!(full_b[0].is_pr, "370 s beats the only other full lap");
    assert_eq!(
        full_b[0].history_times,
        vec![380.0, 370.0],
        "the fragment is not in the history"
    );
}

/// Two `partial` rows from different activities are fragments of different
/// ground, and the faster one is no record of the section.
#[test]
fn a_partial_row_takes_no_trophy() {
    let s = setup();
    insert_activity(&s.raw, "p1", 1_700_000_000, 10_000.0, 3_000);
    insert_activity(&s.raw, "p2", 1_700_100_000, 10_000.0, 3_000);
    insert_section(&s.raw, "sec_long", "Long Climb", 2_000.0);
    insert_traversal(&s.raw, "sec_long", "p1", "partial", 0, 400.0, 60.0);
    insert_traversal(&s.raw, "sec_long", "p2", "partial", 0, 300.0, 40.0);

    let p2 = s.engine.get_activity_section_encounters("p2");
    assert_eq!(p2.len(), 1);
    assert!(!p2[0].is_complete);
    assert!(p2[0].history_times.is_empty());
    assert_eq!(p2[0].visit_count, 0);
    assert!(p2.iter().all(|e| !e.is_pr), "{p2:?}");
}

/// An activity that crossed the full section and also left a faster
/// fragment row in the same direction is represented by its full lap.
#[test]
fn a_full_lap_represents_an_activity_over_its_own_fragment() {
    let s = setup();
    insert_activity(&s.raw, "rival", 1_700_000_000, 10_000.0, 3_000);
    insert_activity(&s.raw, "both", 1_700_100_000, 10_000.0, 3_000);
    insert_section(&s.raw, "sec_long", "Long Climb", 2_000.0);
    insert_measured_traversal(&s.raw, "sec_long", "rival", "same", 0, 400.0, 1.0);
    insert_measured_traversal(&s.raw, "sec_long", "both", "same", 0, 230.0, 0.6);
    insert_measured_traversal(&s.raw, "sec_long", "both", "same", 100, 390.0, 1.0);

    let both = s.engine.get_activity_section_encounters("both");
    assert_eq!(both.len(), 1);
    assert_eq!(both[0].lap_time, 390.0, "the full lap, not the fragment");
    assert!(both[0].is_pr, "390 s beats the rival's full 400 s");
}

#[test]
fn a_full_lap_represents_an_activity_over_a_partial_direction_row() {
    let s = setup();
    insert_activity(&s.raw, "both", 1_700_100_000, 10_000.0, 3_000);
    insert_section(&s.raw, "sec_long", "Long Climb", 2_000.0);
    insert_traversal(&s.raw, "sec_long", "both", "partial", 0, 700.0, 200.0);
    insert_measured_traversal(&s.raw, "sec_long", "both", "same", 100, 390.0, 1.0);

    let both = s.engine.get_activity_section_encounters("both");
    assert_eq!(both.len(), 1);
    assert_eq!(both[0].direction, "same");
    assert!(both[0].is_complete);
}

// ============================================================================
// Order along the track
// ============================================================================

#[test]
fn encounters_come_back_in_start_index_order_not_id_order() {
    let setup = setup();
    insert_activity(&setup.raw, "a1", 1_700_000_000, 5000.0, 1200);
    insert_section(&setup.raw, "s_a", "Late", 800.0);
    insert_section(&setup.raw, "s_b", "Early", 800.0);
    insert_traversal(&setup.raw, "s_a", "a1", "same", 300, 800.0, 240.0);
    insert_traversal(&setup.raw, "s_b", "a1", "same", 50, 800.0, 240.0);

    let result = setup.engine.get_activity_section_encounters("a1");
    let ids: Vec<&str> = result.iter().map(|e| e.section_id.as_str()).collect();
    assert_eq!(ids, ["s_b", "s_a"]);
    assert_eq!(result[0].start_index, 50);
    assert_eq!(result[1].start_index, 300);
}

#[test]
fn out_and_back_orders_by_first_crossing_not_the_longer_pass() {
    let setup = setup();
    insert_activity(&setup.raw, "a1", 1_700_000_000, 9000.0, 2400);
    insert_section(&setup.raw, "s_out", "Out and back", 1200.0);
    insert_section(&setup.raw, "s_mid", "Middle", 800.0);
    // The return leg is the longer pass, and it starts later than s_mid.
    insert_traversal(&setup.raw, "s_out", "a1", "same", 100, 900.0, 300.0);
    insert_traversal(&setup.raw, "s_out", "a1", "reverse", 700, 1200.0, 360.0);
    insert_traversal(&setup.raw, "s_mid", "a1", "same", 400, 800.0, 240.0);

    let result = setup.engine.get_activity_section_encounters("a1");
    let order: Vec<(&str, &str)> = result
        .iter()
        .map(|e| (e.section_id.as_str(), e.direction.as_str()))
        .collect();
    assert_eq!(
        order,
        [("s_out", "same"), ("s_mid", "same"), ("s_out", "reverse")]
    );
}

#[test]
fn a_lapped_pair_is_placed_at_its_first_lap() {
    let setup = setup();
    insert_activity(&setup.raw, "a1", 1_700_000_000, 9000.0, 2400);
    insert_section(&setup.raw, "s_lap", "Lapped", 800.0);
    insert_section(&setup.raw, "s_one", "Once", 800.0);
    // The faster lap is the second one, but the pair is first crossed at 100.
    insert_traversal(&setup.raw, "s_lap", "a1", "same", 100, 800.0, 300.0);
    insert_traversal(&setup.raw, "s_lap", "a1", "same", 900, 800.0, 240.0);
    insert_traversal(&setup.raw, "s_one", "a1", "same", 500, 800.0, 240.0);

    let result = setup.engine.get_activity_section_encounters("a1");
    let ids: Vec<&str> = result.iter().map(|e| e.section_id.as_str()).collect();
    assert_eq!(ids, ["s_lap", "s_one"]);
    assert_eq!(result[0].start_index, 100);
}

/// Scenario: five rides over one section at 100, 110, 110, 120 and 130 s.
///
/// Expected behaviour: places follow one plus the number strictly faster, a
/// tie for second is second for both, fourth and a lone outing take none, and
/// the trophy is exactly first place.
#[test]
fn encounters_carry_the_podium_place_and_the_trophy_is_first() {
    let s = setup();
    insert_section(&s.raw, "sec", "Ridge", 800.0);
    for (i, (id, t)) in [
        ("r1", 100.0),
        ("r2", 110.0),
        ("r3", 110.0),
        ("r4", 120.0),
        ("r5", 130.0),
    ]
    .into_iter()
    .enumerate()
    {
        insert_activity(&s.raw, id, 1_700_000_000 + i as i64 * 86_400, 5_000.0, 900);
        insert_traversal(&s.raw, "sec", id, "same", 0, 800.0, t);
    }
    let rank = |id: &str| {
        let r = s.engine.get_activity_section_encounters(id);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].is_pr, r[0].rank == Some(1), "{id}");
        r[0].rank
    };
    assert_eq!(rank("r1"), Some(1));
    assert_eq!(rank("r2"), Some(2));
    assert_eq!(rank("r3"), Some(2));
    assert_eq!(rank("r4"), None);
    assert_eq!(rank("r5"), None);

    insert_section(&s.raw, "solo", "Lone", 800.0);
    insert_activity(&s.raw, "lone", 1_700_900_000, 5_000.0, 900);
    insert_traversal(&s.raw, "solo", "lone", "same", 0, 800.0, 90.0);
    assert_eq!(
        s.engine.get_activity_section_encounters("lone")[0].rank,
        None
    );
}
