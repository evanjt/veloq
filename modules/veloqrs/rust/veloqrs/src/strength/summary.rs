//! How a recorded strength session goes up to intervals.icu: whether it is a
//! file or a manual entry, and the plain-text summary of its sets that goes in
//! the upload's description.

use super::catalogue;
use crate::persistence::strength_sessions::{SessionExercise, SessionSet, StrengthSession};

/// Whether a set counts toward the summary and the file: done, and not a
/// warm-up.
fn is_working(set: &SessionSet) -> bool {
    set.done && !set.warm_up
}

/// The upload kind a recording row of this session takes: `fit` when the
/// session has a done working set, so intervals.icu reads the sets from the
/// file, and `manual` when it has none, so the manual entry form's body stands
/// in.
pub fn recording_kind(session: Option<&StrengthSession>) -> &'static str {
    let has_sets =
        session.is_some_and(|s| s.exercises.iter().any(|e| e.sets.iter().any(is_working)));
    if has_sets { "fit" } else { "manual" }
}

/// A number without a trailing `.0`, to one decimal.
fn plain(value: f64) -> String {
    let tenths = (value * 10.0).round() / 10.0;
    if tenths.fract() == 0.0 {
        format!("{tenths:.0}")
    } else {
        format!("{tenths}")
    }
}

/// One set as written in a line: reps, then `× weight` when it has one, or the
/// hold's seconds when it has no reps.
fn set_text(set: &SessionSet) -> String {
    match (set.reps, set.weight_kg, set.duration_secs) {
        (Some(reps), Some(kg), _) => format!("{reps} × {}", plain(kg)),
        (Some(reps), None, _) => reps.to_string(),
        (None, _, Some(secs)) => format!("{} s", plain(secs)),
        (None, Some(kg), None) => plain(kg),
        (None, None, None) => "1".to_string(),
    }
}

/// An exercise's line, `None` when it has no working set.
fn exercise_line(exercise: &SessionExercise) -> Option<String> {
    let sets: Vec<&SessionSet> = exercise.sets.iter().filter(|s| is_working(s)).collect();
    if sets.is_empty() {
        return None;
    }
    let name = exercise
        .exercise_name
        .and_then(|name| catalogue::display_name(exercise.exercise_category, name))
        .unwrap_or_else(|| "Exercise".to_string());
    let unit = if sets
        .iter()
        .any(|s| s.weight_kg.is_some() && s.reps.is_some())
    {
        " kg"
    } else {
        ""
    };
    let texts: Vec<String> = sets.into_iter().map(set_text).collect();
    Some(format!("{name}: {}{unit}", texts.join(", ")))
}

/// The description an upload carries: one line per exercise, then the
/// athlete's own notes. `summary` off leaves the notes alone. `None` when
/// there is nothing to say. Weights are in kilograms, as stored.
pub fn description(
    session: &StrengthSession,
    summary: bool,
    notes: Option<&str>,
) -> Option<String> {
    let lines: Vec<String> = if summary {
        session.exercises.iter().filter_map(exercise_line).collect()
    } else {
        Vec::new()
    };
    let notes = notes.map(str::trim).filter(|n| !n.is_empty());
    let mut parts = Vec::new();
    if !lines.is_empty() {
        parts.push(lines.join("\n"));
    }
    parts.extend(notes.map(str::to_string));
    (!parts.is_empty()).then(|| parts.join("\n\n"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::persistence::strength_sessions::SessionKind;

    fn exercise_named(key: &str, sets: Vec<SessionSet>) -> SessionExercise {
        let (category, name) = crate::strength::catalogue::all()
            .find(|e| e.label_key == key)
            .map(|e| (e.category, e.name))
            .expect("the catalogue holds the exercise");
        SessionExercise {
            exercise_category: category,
            exercise_name: Some(name),
            sets,
            ..SessionExercise::default()
        }
    }

    fn done(reps: u32, kg: f64) -> SessionSet {
        SessionSet {
            reps: Some(reps),
            weight_kg: Some(kg),
            done: true,
            ..SessionSet::default()
        }
    }

    fn session(exercises: Vec<SessionExercise>) -> StrengthSession {
        StrengthSession {
            id: "s".into(),
            kind: SessionKind::Finished,
            name: None,
            activity_key: Some("ride".into()),
            intervals_id: None,
            started_at: Some(0),
            ended_at: Some(10),
            last_used_at: None,
            created_at: 0,
            exercises,
            groups: vec![],
            rests: vec![],
            current_exercise: None,
            current_set: None,
            rest_started_at: None,
            heart_rate: Vec::new(),
            notes: Vec::new(),
        }
    }

    fn fixture() -> StrengthSession {
        session(vec![
            exercise_named(
                "incline_dumbbell_bench_press",
                vec![
                    SessionSet {
                        warm_up: true,
                        ..done(15, 10.0)
                    },
                    done(12, 20.0),
                    done(10, 20.0),
                    done(8, 10.0),
                    SessionSet {
                        reps: Some(6),
                        weight_kg: Some(30.0),
                        done: false,
                        ..SessionSet::default()
                    },
                ],
            ),
            exercise_named("barbell_bench_press", vec![done(5, 62.5), done(5, 62.5)]),
        ])
    }

    #[test]
    fn one_line_per_exercise_with_working_sets_only() {
        assert_eq!(
            description(&fixture(), true, None).as_deref(),
            Some(
                "Incline Dumbbell Bench Press: 12 × 20, 10 × 20, 8 × 10 kg\n\
                 Barbell Bench Press: 5 × 62.5, 5 × 62.5 kg"
            )
        );
    }

    #[test]
    fn the_notes_follow_the_summary_after_a_blank_line() {
        let text = description(&fixture(), true, Some("Felt strong")).unwrap();
        assert!(text.ends_with("kg\n\nFelt strong"), "{text}");
    }

    #[test]
    fn with_the_summary_off_only_the_notes_go() {
        assert_eq!(
            description(&fixture(), false, Some("Felt strong")).as_deref(),
            Some("Felt strong")
        );
        assert_eq!(description(&fixture(), false, None), None);
        assert_eq!(description(&fixture(), false, Some("  ")), None);
    }

    #[test]
    fn a_bodyweight_set_shows_reps_and_a_hold_shows_seconds() {
        let held = SessionSet {
            duration_secs: Some(45.0),
            done: true,
            ..SessionSet::default()
        };
        let reps_only = SessionSet {
            reps: Some(12),
            done: true,
            ..SessionSet::default()
        };
        let text = description(
            &session(vec![
                exercise_named("barbell_bench_press", vec![reps_only]),
                exercise_named("abs_jabs", vec![held]),
            ]),
            true,
            None,
        )
        .unwrap();
        assert_eq!(text, "Barbell Bench Press: 12\nAbs Jabs: 45 s");
    }

    #[test]
    fn a_session_with_no_done_set_has_no_summary() {
        let undone = session(vec![exercise_named(
            "barbell_bench_press",
            vec![SessionSet {
                reps: Some(5),
                ..SessionSet::default()
            }],
        )]);
        assert_eq!(description(&undone, true, None), None);
        assert_eq!(
            description(&undone, true, Some("note")).as_deref(),
            Some("note")
        );
    }

    #[test]
    fn a_session_with_sets_goes_as_a_file_and_one_without_as_a_manual_entry() {
        assert_eq!(recording_kind(Some(&fixture())), "fit");
        assert_eq!(recording_kind(Some(&session(vec![]))), "manual");
        assert_eq!(recording_kind(None), "manual");
        let warm_only = session(vec![exercise_named(
            "barbell_bench_press",
            vec![SessionSet {
                warm_up: true,
                ..done(10, 20.0)
            }],
        )]);
        assert_eq!(recording_kind(Some(&warm_only)), "manual");
    }
}
