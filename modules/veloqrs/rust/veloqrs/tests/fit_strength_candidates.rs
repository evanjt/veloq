//! Scenario: a Garmin watch that recognises exercises writes `category` as a
//! list of up to three candidates ranked by confidence, and puts `unknown`
//! first when it could not recognise a set. Reading past `unknown` to the next
//! slot labels that set with its least likely candidate.
//!
//! Expected behaviour: the parser keeps the top candidate, so the one set the
//! watch could not name stays unknown rather than becoming a curl.
//!
//! The fixture is the athlete's own fenix 7 file for `i183105434`, pulled from
//! `/activity/{id}/file` on intervals.icu. It holds training data and stays
//! under the gitignored `tests/fixtures/private/`, so the test is skipped
//! wherever the file is absent.

use std::path::PathBuf;

use veloqrs::fit::parse_fit_sets;

const FIXTURE: &str = "tests/fixtures/private/garmin_strength_i183105434.fit";
const UNKNOWN: u16 = 0xFFFE;
const INVALID: u16 = 0xFFFF;

fn fixture() -> Option<Vec<u8>> {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(FIXTURE);
    match std::fs::read(&path) {
        Ok(bytes) => Some(bytes),
        Err(_) => {
            eprintln!("skipped: {} is not present", path.display());
            None
        }
    }
}

#[test]
fn the_top_candidate_names_each_set_and_unknown_stays_unknown() {
    let Some(data) = fixture() else { return };
    let sets = parse_fit_sets(&data);
    assert_eq!(sets.len(), 22);

    let active: Vec<u16> = sets
        .iter()
        .filter(|s| s.set_type == 0)
        .map(|s| s.exercise_category)
        .collect();
    // Three bench press, three rows, three bench press, one the watch could
    // not name, one sit up. The file ranks `[65534, 65534, 7]` for the tenth.
    assert_eq!(active, vec![0, 0, 0, 23, 23, 23, 0, 0, 0, UNKNOWN, 27]);
}

#[test]
fn a_rest_set_carries_no_category() {
    let Some(data) = fixture() else { return };
    let sets = parse_fit_sets(&data);

    let rests: Vec<&_> = sets.iter().filter(|s| s.set_type == 1).collect();
    assert_eq!(rests.len(), 11);
    assert!(rests.iter().all(|s| s.exercise_category == INVALID));
    assert!(
        rests
            .iter()
            .all(|s| s.repetitions.is_none() && s.weight_kg.is_none())
    );
}

#[test]
fn the_unnamed_set_keeps_its_work() {
    let Some(data) = fixture() else { return };
    let sets = parse_fit_sets(&data);

    let unnamed = sets
        .iter()
        .find(|s| s.exercise_category == UNKNOWN)
        .expect("one set the watch could not name");
    assert_eq!(unnamed.repetitions, Some(20));
    assert_eq!(unnamed.weight_kg, Some(5.0));
    assert_eq!(unnamed.set_order, 18);
}
