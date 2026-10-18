//! The stored calendar events, read into the planned events the screens show.
//!
//! The sync stores each event body as intervals.icu sent it. The today banner,
//! its step bar and the recording's plan follow all read the same workout
//! steps, and they read them here, through one walk, so a repeat, a rest step
//! and a target mean the same thing on every surface.

use serde_json::Value;

use super::fitness::sport_settings::SportSettings;

/// What kind of entry a calendar event is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum FfiPlannedCategory {
    Workout,
    Race,
    Note,
    Target,
    Season,
    /// Every other entry: a holiday, an illness, a fitness setting.
    Other,
}

/// The measure a planned workout is prescribed in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum FfiPlanTarget {
    Power,
    HeartRate,
    Pace,
}

/// Whether a plan line is effort or recovery.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum FfiPlanLineKind {
    Work,
    Rest,
}

/// The measure one step target is set in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum FfiTargetMetric {
    Power,
    HeartRate,
    Pace,
}

/// The unit a relative target converts to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum FfiAbsoluteUnits {
    Watts,
    Bpm,
}

/// A relative target converted by the threshold the plan carries.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FfiAbsoluteTarget {
    pub low: f64,
    pub high: f64,
    pub units: FfiAbsoluteUnits,
}

/// A step's target as the plan supplied it, a single value being a range of one.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FfiStepTarget {
    pub metric: FfiTargetMetric,
    pub low: f64,
    pub high: f64,
    /// The units as the plan wrote them: `%ftp`, `w`, `power_zone` and so on.
    pub units: String,
    /// Present only when the plan carries a positive threshold to convert by.
    pub absolute: Option<FfiAbsoluteTarget>,
}

/// One line of the flat list the athlete follows.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FfiPlanLine {
    pub kind: FfiPlanLineKind,
    pub text: String,
    pub duration_seconds: Option<f64>,
    /// A prescribed distance. Any duration beside it is an estimate, not a countdown.
    pub distance_metres: Option<f64>,
    pub targets: Vec<FfiStepTarget>,
}

/// One block of the step bar, one per plan line.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FfiStepBlock {
    /// The width the block takes, in seconds of the plan.
    pub seconds: f64,
    /// The athlete's training zone, 1 to 7, that the step's target falls in.
    /// `None` for a rest step and for a step with no target a zone can be
    /// worked out from.
    pub zone: Option<u32>,
    pub rest: bool,
}

/// A calendar event as the screens read it.
#[derive(Debug, Clone, PartialEq, uniffi::Record)]
pub struct FfiPlannedEvent {
    /// The upstream event id.
    pub id: f64,
    pub name: String,
    /// The local day the event is planned for, `YYYY-MM-DD`.
    pub day: String,
    /// The activity type the event is planned as, `Ride`, `Run` and so on.
    pub sport: String,
    pub category: FfiPlannedCategory,
    pub target: Option<FfiPlanTarget>,
    /// The planned moving time, in seconds.
    pub moving_time: Option<f64>,
    pub training_load: Option<f64>,
    /// The workout's steps as the lines the athlete follows. Empty for an
    /// event that is not a workout, or a workout with nothing to follow.
    pub lines: Vec<FfiPlanLine>,
    /// The step bar, one block per line.
    pub bar: Vec<FfiStepBlock>,
}

/// The most lines one plan expands to. A repeat count past any real session
/// is a corrupt body, not a workout to list.
const MAX_LINES: usize = 500;

/// The width a block takes when its step has no duration, so it still shows.
const UNTIMED_BLOCK_SECONDS: f64 = 60.0;

/// The highest training zone a block is coloured by.
const TOP_ZONE: u32 = 7;

/// The thresholds a plan carries, which its relative targets convert by.
#[derive(Debug, Clone, Copy, Default)]
struct PlanReferences {
    ftp: Option<f64>,
    lthr: Option<f64>,
}

/// What a plan's zones are judged against: the athlete's sport settings for
/// the event's sport, and the thresholds the plan carries.
struct ZoneBasis<'a> {
    settings: &'a SportSettings,
    sport: &'a str,
    refs: PlanReferences,
}

fn positive(value: Option<&Value>) -> Option<f64> {
    value
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite() && *v > 0.0)
}

fn finite(value: Option<&Value>) -> Option<f64> {
    value.and_then(Value::as_f64).filter(|v| v.is_finite())
}

/// A step is rest when the plan says so, or when its text starts with the word.
fn is_rest(step: &Value) -> bool {
    if step.get("intensity").and_then(Value::as_str) == Some("rest") {
        return true;
    }
    let text = step.get("text").and_then(Value::as_str).unwrap_or("");
    let lower = text.to_lowercase();
    lower.strip_prefix("rest").is_some_and(|after| {
        after
            .chars()
            .next()
            .is_none_or(|c| !(c.is_alphanumeric() || c == '_'))
    })
}

/// The low and high of a supplied target, a single value being a range of one.
fn supplied_range(supplied: &Value) -> Option<(f64, f64)> {
    if !supplied.is_object() {
        return None;
    }
    let value = finite(supplied.get("value"));
    let start = finite(supplied.get("start")).or(value);
    let end = finite(supplied.get("end")).or(value).or(start);
    let (start, end) = (start?, end?);
    Some((start.min(end), start.max(end)))
}

fn target(
    metric: FfiTargetMetric,
    supplied: &Value,
    refs: PlanReferences,
) -> Option<FfiStepTarget> {
    let (low, high) = supplied_range(supplied)?;
    let units = supplied
        .get("units")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    // Pace is left as supplied: converting it needs the threshold's unit and
    // which way the percentage runs, and a wrong pace is worse than none.
    let reference = match units.as_str() {
        "%ftp" => refs.ftp.map(|ftp| (ftp, FfiAbsoluteUnits::Watts)),
        "%lthr" => refs.lthr.map(|lthr| (lthr, FfiAbsoluteUnits::Bpm)),
        _ => None,
    };
    let absolute = reference.map(|(by, units)| FfiAbsoluteTarget {
        low: (low * by / 100.0).round(),
        high: (high * by / 100.0).round(),
        units,
    });
    Some(FfiStepTarget {
        metric,
        low,
        high,
        units,
        absolute,
    })
}

fn step_targets(step: &Value, refs: PlanReferences) -> Vec<FfiStepTarget> {
    [
        (FfiTargetMetric::Power, "power"),
        (FfiTargetMetric::HeartRate, "hr"),
        (FfiTargetMetric::Pace, "pace"),
    ]
    .into_iter()
    .filter_map(|(metric, key)| target(metric, step.get(key)?, refs))
    .collect()
}

/// The midpoint of a supplied range, read as a number of the units it names.
fn midpoint(supplied: Option<&Value>) -> Option<f64> {
    let (low, high) = supplied_range(supplied?)?;
    Some((low + high) / 2.0)
}

/// A zone the plan names outright, as `power_zone` or `hr_zone` units do.
fn named_zone(supplied: Option<&Value>, units: &str) -> Option<u32> {
    let supplied = supplied?;
    if supplied.get("units").and_then(Value::as_str) != Some(units) {
        return None;
    }
    let zone = midpoint(Some(supplied))?.round();
    (zone >= 1.0).then(|| (zone as u32).min(TOP_ZONE))
}

/// A reading in the plan's own units, converted to absolute where the units
/// are relative to a threshold the plan or the settings carry.
fn absolute_reading(
    supplied: Option<&Value>,
    absolute: &[&str],
    relative: (&str, Option<f64>),
) -> Option<f64> {
    let supplied = supplied?;
    let units = supplied.get("units").and_then(Value::as_str).unwrap_or("");
    let mid = midpoint(Some(supplied))?;
    if absolute.contains(&units) {
        return Some(mid);
    }
    let (relative_units, threshold) = relative;
    (units == relative_units)
        .then(|| threshold.map(|t| mid * t / 100.0))
        .flatten()
}

/// The training zone a work step's target falls in for this athlete. Power
/// comes first: the resolved watts the plan carries, else the target itself,
/// placed in the sport's power zones at the plan's FTP, else the set one.
/// Heart rate goes through the live heart rate lookup. Pace has no zone.
fn step_zone(step: &Value, basis: &ZoneBasis) -> Option<u32> {
    let entry = basis.settings.entry_for(basis.sport);
    let ftp = basis.refs.ftp.or_else(|| {
        entry
            .and_then(|e| e.ftp)
            .filter(|f| f.is_finite() && *f > 0.0)
    });
    let power = step.get("power");
    let power_zone = named_zone(power, "power_zone").or_else(|| {
        let watts = midpoint(step.get("_power"))
            .filter(|w| *w > 0.0)
            .or_else(|| absolute_reading(power, &["w", "W", "watts"], ("%ftp", ftp)))?;
        entry?.zone_for_power(watts, ftp?)
    });
    if power_zone.is_some() {
        return power_zone.map(|zone| zone.min(TOP_ZONE));
    }
    let lthr = basis.refs.lthr.or_else(|| {
        entry
            .and_then(|e| e.lthr)
            .filter(|l| l.is_finite() && *l > 0.0)
    });
    let hr = step.get("hr");
    named_zone(hr, "hr_zone")
        .or_else(|| {
            let bpm = midpoint(step.get("_hr"))
                .filter(|b| *b > 0.0)
                .or_else(|| absolute_reading(hr, &["bpm"], ("%lthr", lthr)))?;
            super::screens::hr_zone_in(basis.settings, basis.sport, bpm)
        })
        .map(|zone| zone.min(TOP_ZONE))
}

fn walk(
    steps: &[Value],
    basis: &ZoneBasis,
    lines: &mut Vec<FfiPlanLine>,
    bar: &mut Vec<FfiStepBlock>,
) {
    for step in steps {
        if lines.len() >= MAX_LINES {
            return;
        }
        if !step.is_object() {
            continue;
        }
        // A repeat's own duration and distance are its children's sum, not a step.
        if let Some(children) = step
            .get("steps")
            .and_then(Value::as_array)
            .filter(|c| !c.is_empty())
        {
            let reps = match step.get("reps") {
                None | Some(Value::Null) => 1.0,
                Some(reps) => reps.as_f64().unwrap_or(0.0),
            };
            let mut pass = 0.0;
            while pass < reps && lines.len() < MAX_LINES {
                let before = lines.len();
                walk(children, basis, lines, bar);
                // A pass that adds nothing adds nothing the next time either.
                if lines.len() == before {
                    break;
                }
                pass += 1.0;
            }
            continue;
        }
        let text = step
            .get("text")
            .and_then(Value::as_str)
            .map(str::trim)
            .unwrap_or("")
            .to_string();
        let duration_seconds = positive(step.get("duration"));
        let distance_metres = positive(step.get("distance"));
        let targets = step_targets(step, basis.refs);
        if text.is_empty()
            && duration_seconds.is_none()
            && distance_metres.is_none()
            && targets.is_empty()
        {
            continue;
        }
        let rest = is_rest(step);
        bar.push(FfiStepBlock {
            seconds: duration_seconds.unwrap_or(UNTIMED_BLOCK_SECONDS),
            zone: if rest { None } else { step_zone(step, basis) },
            rest,
        });
        lines.push(FfiPlanLine {
            kind: if rest {
                FfiPlanLineKind::Rest
            } else {
                FfiPlanLineKind::Work
            },
            text,
            duration_seconds,
            distance_metres,
            targets,
        });
    }
}

/// A workout's steps as the flat list the athlete follows and the step bar
/// beside it. Repeats expand in order, a repeat with no count runs once, and
/// a step with no text, duration, distance or target is no line. A rest line
/// exists only where the plan has a rest step: the plan prescribes no rest
/// between lines, so none is made up.
fn expand_plan(
    doc: &Value,
    settings: &SportSettings,
    sport: &str,
) -> (Vec<FfiPlanLine>, Vec<FfiStepBlock>) {
    let (mut lines, mut bar) = (Vec::new(), Vec::new());
    let Some(steps) = doc.get("steps").and_then(Value::as_array) else {
        return (lines, bar);
    };
    let basis = ZoneBasis {
        settings,
        sport,
        refs: PlanReferences {
            ftp: positive(doc.get("ftp")),
            lthr: positive(doc.get("lthr")),
        },
    };
    walk(steps, &basis, &mut lines, &mut bar);
    (lines, bar)
}

fn category(raw: Option<&str>) -> FfiPlannedCategory {
    match raw.unwrap_or("") {
        "WORKOUT" => FfiPlannedCategory::Workout,
        "RACE" | "RACE_A" | "RACE_B" | "RACE_C" => FfiPlannedCategory::Race,
        "NOTE" => FfiPlannedCategory::Note,
        "TARGET" => FfiPlannedCategory::Target,
        "SEASON" | "SEASON_START" => FfiPlannedCategory::Season,
        _ => FfiPlannedCategory::Other,
    }
}

fn plan_target(raw: Option<&str>) -> Option<FfiPlanTarget> {
    match raw? {
        "POWER" => Some(FfiPlanTarget::Power),
        "HR" => Some(FfiPlanTarget::HeartRate),
        "PACE" => Some(FfiPlanTarget::Pace),
        _ => None,
    }
}

/// One stored event body as the screens read it. `None` when the body does
/// not parse or has no numeric id or dated start.
fn planned_event(raw: &str, settings: &SportSettings) -> Option<FfiPlannedEvent> {
    let event: Value = serde_json::from_str(raw).ok()?;
    let id = event.get("id").and_then(|id| {
        id.as_f64()
            .or_else(|| id.as_str().and_then(|s| s.parse::<f64>().ok()))
    })?;
    let day = event
        .get("start_date_local")
        .and_then(Value::as_str)
        .and_then(|start| start.get(..10))?
        .to_string();
    let text = |key: &str| event.get(key).and_then(Value::as_str);
    let sport = text("type").unwrap_or("").to_string();
    let category = category(text("category"));
    let (lines, bar) = match (category, event.get("workout_doc")) {
        (FfiPlannedCategory::Workout, Some(doc)) => expand_plan(doc, settings, &sport),
        _ => (Vec::new(), Vec::new()),
    };
    Some(FfiPlannedEvent {
        id,
        name: text("name").unwrap_or("").to_string(),
        day,
        sport,
        category,
        target: plan_target(text("target")),
        moving_time: positive(event.get("moving_time")),
        training_load: positive(event.get("icu_training_load")),
        lines,
        bar,
    })
}

pub(crate) mod pooled {
    use rusqlite::{Connection, Result};

    use super::{FfiPlannedEvent, SportSettings, planned_event};

    /// The calendar events stored over an inclusive window, oldest first. A
    /// body that does not parse, or has no id or day, is skipped.
    pub(crate) fn planned_events(
        conn: &Connection,
        oldest_ts: i64,
        newest_ts: i64,
    ) -> Result<Vec<FfiPlannedEvent>> {
        let bodies =
            crate::persistence::bodies::pooled::calendar_event_bodies(conn, oldest_ts, newest_ts)?;
        let settings = SportSettings::read(conn);
        Ok(bodies
            .iter()
            .filter_map(|raw| planned_event(raw, &settings))
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;
    use tempfile::TempDir;

    use serde_json::json;

    use super::*;
    use crate::persistence::PersistentEngine;

    const DAY: i64 = 1_767_312_000;

    fn engine_and_reader() -> (TempDir, PersistentEngine, Connection) {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("calendar.db");
        let engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
        let reader = Connection::open(path).unwrap();
        (dir, engine, reader)
    }

    fn store(engine: &mut PersistentEngine, events: &[Value]) {
        let rows: Vec<(String, i64, String)> = events
            .iter()
            .enumerate()
            .map(|(i, event)| (i.to_string(), DAY + i as i64, event.to_string()))
            .collect();
        engine
            .replace_calendar_events(DAY, DAY + 86_399, &rows)
            .unwrap();
    }

    fn day_events() -> Vec<Value> {
        vec![
            serde_json::json!({
                "id": 7001, "name": "Lantern hill repeats", "category": "WORKOUT",
                "start_date_local": "2026-01-02T00:00:00", "type": "Ride",
                "moving_time": 840, "icu_training_load": 21, "target": "POWER",
                "workout_doc": { "ftp": 180, "steps": [{ "reps": 2, "steps": [
                    { "duration": 300, "power": { "value": 110, "units": "%ftp" },
                      "_power": { "value": 198 } },
                    { "duration": 120, "text": "Rest" }
                ]}]}
            }),
            serde_json::json!({
                "id": 7002, "name": "Oil the chain", "category": "NOTE",
                "start_date_local": "2026-01-02T00:00:00", "type": "Ride"
            }),
            serde_json::json!({
                "id": 7003, "name": "Weekly load", "category": "TARGET",
                "start_date_local": "2026-01-02T00:00:00", "type": "Ride"
            }),
        ]
    }

    #[test]
    fn a_workout_reads_as_lines_and_zoned_blocks_beside_a_note_and_a_target() {
        let (_dir, mut engine, reader) = engine_and_reader();
        engine
            .set_sport_settings(
                r#"[{"types":["Ride"],"ftp":250,"power_zones":[55,75,90,105,120,150,999]}]"#,
            )
            .unwrap();
        store(&mut engine, &day_events());

        let events = pooled::planned_events(&reader, DAY, DAY + 86_399).unwrap();
        assert_eq!(events.len(), 3);

        let workout = &events[0];
        assert_eq!(workout.id, 7001.0);
        assert_eq!(workout.name, "Lantern hill repeats");
        assert_eq!(workout.day, "2026-01-02");
        assert_eq!(workout.sport, "Ride");
        assert_eq!(workout.category, FfiPlannedCategory::Workout);
        assert_eq!(workout.target, Some(FfiPlanTarget::Power));
        assert_eq!(workout.moving_time, Some(840.0));
        assert_eq!(workout.training_load, Some(21.0));
        assert_eq!(
            workout.lines.iter().map(|l| l.kind).collect::<Vec<_>>(),
            vec![
                FfiPlanLineKind::Work,
                FfiPlanLineKind::Rest,
                FfiPlanLineKind::Work,
                FfiPlanLineKind::Rest
            ]
        );
        assert_eq!(
            workout.lines[0].targets,
            vec![FfiStepTarget {
                metric: FfiTargetMetric::Power,
                low: 110.0,
                high: 110.0,
                units: "%ftp".into(),
                absolute: Some(FfiAbsoluteTarget {
                    low: 198.0,
                    high: 198.0,
                    units: FfiAbsoluteUnits::Watts
                }),
            }]
        );
        // 198 W is 110 % of the plan's own 180 W FTP, not of the 250 W setting.
        assert_eq!(
            workout.bar,
            vec![
                FfiStepBlock {
                    seconds: 300.0,
                    zone: Some(5),
                    rest: false
                },
                FfiStepBlock {
                    seconds: 120.0,
                    zone: None,
                    rest: true
                },
                FfiStepBlock {
                    seconds: 300.0,
                    zone: Some(5),
                    rest: false
                },
                FfiStepBlock {
                    seconds: 120.0,
                    zone: None,
                    rest: true
                },
            ]
        );

        let note = &events[1];
        assert_eq!(note.category, FfiPlannedCategory::Note);
        assert!(note.lines.is_empty() && note.bar.is_empty());
        assert_eq!(note.target, None);
        let target = &events[2];
        assert_eq!(target.category, FfiPlannedCategory::Target);
        assert!(target.lines.is_empty() && target.bar.is_empty());
    }

    fn expand(doc: Value) -> Vec<FfiPlanLine> {
        expand_plan(&doc, &SportSettings::default(), "Ride").0
    }

    fn texts(lines: &[FfiPlanLine]) -> Vec<(FfiPlanLineKind, &str)> {
        lines.iter().map(|l| (l.kind, l.text.as_str())).collect()
    }

    fn bar(doc: Value, settings: &str, sport: &str) -> Vec<FfiStepBlock> {
        expand_plan(&doc, &SportSettings::parse(Some(settings)), sport).1
    }

    fn zones(blocks: &[FfiStepBlock]) -> Vec<Option<u32>> {
        blocks.iter().map(|b| b.zone).collect()
    }

    const RIDE_ZONES: &str = r#"[{"types":["Ride"],"ftp":200,"lthr":160,"power_zones":[55,75,90,105,120,150,999],
            "hr_zones":[120,140,150,160,170,180,190]}]"#;

    use FfiPlanLineKind::{Rest, Work};

    #[test]
    fn lines_keep_their_order_text_and_duration() {
        let lines = expand(json!({"steps":[{"text":" Squats ","duration":60},{"text":"Press"}]}));
        assert_eq!(texts(&lines), vec![(Work, "Squats"), (Work, "Press")]);
        assert_eq!(lines[0].duration_seconds, Some(60.0));
        assert_eq!(lines[1].duration_seconds, None);
        assert!(lines[1].targets.is_empty());
    }

    #[test]
    fn a_repeat_expands_in_order_and_is_never_a_line_of_its_own() {
        let lines = expand(json!({"steps":[
            {"text":"Warm up","duration":600,"warmup":true},
            {"reps":2,"duration":360,"distance":1600,"steps":[
                {"text":"Hard","duration":240,"distance":1200},
                {"text":"Float","duration":120,"intensity":"rest"}]}]}));
        assert_eq!(
            texts(&lines),
            vec![
                (Work, "Warm up"),
                (Work, "Hard"),
                (Rest, "Float"),
                (Work, "Hard"),
                (Rest, "Float")
            ]
        );
        assert_eq!(
            lines.iter().map(|l| l.distance_metres).collect::<Vec<_>>(),
            vec![None, Some(1200.0), None, Some(1200.0), None]
        );
    }

    #[test]
    fn nested_repeats_multiply() {
        let lines =
            expand(json!({"steps":[{"reps":2,"steps":[{"reps":3,"steps":[{"text":"Curl"}]}]}]}));
        assert_eq!(lines.len(), 6);
    }

    #[test]
    fn rest_is_named_by_intensity_or_by_the_word_and_never_invented() {
        let lines = expand(json!({"steps":[
            {"text":"A","duration":10},{"text":"B","duration":10},
            {"duration":45,"intensity":"rest"},
            {"text":"rest easy","duration":30},{"text":"Restore","duration":30},
            {"text":"REST","duration":30}]}));
        assert_eq!(
            lines.iter().map(|l| l.kind).collect::<Vec<_>>(),
            vec![Work, Work, Rest, Rest, Work, Rest]
        );
    }

    #[test]
    fn an_empty_step_a_zero_repeat_and_a_step_that_is_not_an_object_are_no_lines() {
        let lines =
            expand(json!({"steps":[{},{"reps":0,"steps":[{"text":"X"}]},null,3,"x",{"text":"Y"}]}));
        assert_eq!(texts(&lines), vec![(Work, "Y")]);
        assert!(expand(json!({"steps":[]})).is_empty());
        assert!(expand(json!({"steps":"not a list"})).is_empty());
        assert!(expand(json!({})).is_empty());
    }

    #[test]
    fn a_repeat_without_a_count_runs_once_and_one_with_no_children_is_dropped() {
        assert_eq!(expand(json!({"steps":[{"steps":[{"text":"X"}]}]})).len(), 1);
        assert_eq!(
            expand(json!({"steps":[{"reps":3,"steps":[],"text":"Lone"}]})).len(),
            1
        );
    }

    #[test]
    fn a_plan_stops_at_its_line_cap_and_a_huge_repeat_of_nothing_ends() {
        let lines =
            expand(json!({"steps":[{"reps":1_000_000,"steps":[{"text":"A"},{"text":"B"}]}]}));
        assert_eq!(lines.len(), MAX_LINES);
        assert!(expand(json!({"steps":[{"reps":1e15,"steps":[{}]}]})).is_empty());
    }

    #[test]
    fn a_step_with_only_a_distance_or_only_a_target_is_a_line() {
        let lines = expand(
            json!({"steps":[{"distance":1000},{"pace":{"start":90,"end":95,"units":"%pace"}}]}),
        );
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].distance_metres, Some(1000.0));
        assert_eq!(lines[1].targets.len(), 1);
        assert_eq!(
            lines[1].targets[0].absolute, None,
            "pace is never converted"
        );
    }

    #[test]
    fn a_relative_target_converts_only_by_a_positive_threshold_the_plan_carries() {
        let step = json!({"duration":600,"hr":{"start":75,"end":85,"units":"%lthr"}});
        let [with] = expand(json!({"lthr":170,"steps":[step.clone()]}))
            .try_into()
            .unwrap();
        assert_eq!(
            with.targets[0].absolute,
            Some(FfiAbsoluteTarget {
                low: 128.0,
                high: 145.0,
                units: FfiAbsoluteUnits::Bpm
            })
        );
        for lthr in [json!(null), json!(0), json!(-1), json!("170")] {
            let [without] = expand(json!({"lthr":lthr,"steps":[step.clone()]}))
                .try_into()
                .unwrap();
            assert_eq!(without.targets[0].absolute, None, "{lthr}");
            assert_eq!(
                (without.targets[0].low, without.targets[0].high),
                (75.0, 85.0)
            );
        }
    }

    #[test]
    fn power_converts_relative_to_ftp_and_keeps_watts_and_zones_as_supplied() {
        let lines = expand(json!({"ftp":250,"steps":[
            {"duration":300,"power":{"value":105,"units":"%ftp"}},
            {"duration":300,"power":{"start":220,"end":200,"units":"w"}},
            {"duration":300,"power":{"value":2,"units":"power_zone"}},
            {"duration":60,"power":{"units":"%ftp"}}]}));
        assert_eq!(
            lines[0].targets[0].absolute,
            Some(FfiAbsoluteTarget {
                low: 263.0,
                high: 263.0,
                units: FfiAbsoluteUnits::Watts
            })
        );
        let watts = &lines[1].targets[0];
        assert_eq!(
            (watts.low, watts.high, watts.units.as_str()),
            (200.0, 220.0, "w")
        );
        assert_eq!(watts.absolute, None);
        assert_eq!(lines[2].targets[0].units, "power_zone");
        assert!(
            lines[3].targets.is_empty(),
            "a target with no number is left out"
        );
    }

    #[test]
    fn a_block_is_zoned_from_the_plan_ftp_else_the_set_one() {
        let doc = |ftp: Value| {
            json!({"ftp":ftp,"steps":[
            {"duration":300,"power":{"value":110,"units":"%ftp"},"_power":{"value":198}},
            {"duration":300,"power":{"value":95,"units":"%ftp"}}]})
        };
        // 198 W of the plan's 180 W is zone 5; 95 % of 180 W is zone 4.
        assert_eq!(
            zones(&bar(doc(json!(180)), RIDE_ZONES, "Ride")),
            vec![Some(5), Some(4)]
        );
        // With no plan FTP, 198 W of the set 200 W is zone 4, and 95 % of it zone 4.
        assert_eq!(
            zones(&bar(doc(json!(null)), RIDE_ZONES, "Ride")),
            vec![Some(4), Some(4)]
        );
    }

    #[test]
    fn a_ramp_is_zoned_at_its_midpoint() {
        let blocks = bar(
            json!({"ftp":200,"steps":[{"duration":600,"ramp":true,"_power":{"start":100,"end":200}}]}),
            RIDE_ZONES,
            "Ride",
        );
        assert_eq!(zones(&blocks), vec![Some(2)], "150 W is 75 % of 200 W");
    }

    #[test]
    fn a_named_zone_is_the_zone() {
        let blocks = bar(
            json!({"steps":[{"duration":60,"power":{"value":3,"units":"power_zone"}},
                            {"duration":60,"hr":{"value":9,"units":"hr_zone"}}]}),
            "[]",
            "Ride",
        );
        assert_eq!(zones(&blocks), vec![Some(3), Some(7)]);
    }

    #[test]
    fn heart_rate_is_zoned_through_the_live_heart_rate_lookup() {
        let blocks = bar(
            json!({"lthr":150,"steps":[
                {"duration":60,"_hr":{"value":145}},
                {"duration":60,"hr":{"value":165,"units":"bpm"}},
                {"duration":60,"hr":{"value":100,"units":"%lthr"}}]}),
            RIDE_ZONES,
            "Ride",
        );
        let lookup = |bpm| {
            super::super::screens::hr_zone_in(&SportSettings::parse(Some(RIDE_ZONES)), "Ride", bpm)
        };
        assert_eq!(
            zones(&blocks),
            vec![lookup(145.0), lookup(165.0), lookup(150.0)]
        );
        assert_eq!(zones(&blocks), vec![Some(3), Some(5), Some(4)]);
    }

    #[test]
    fn a_relative_heart_rate_with_no_plan_threshold_is_zoned_at_the_set_lthr() {
        // The shape the live account sends: %lthr ranges, no resolved bpm and
        // no threshold on the plan itself.
        let doc = json!({"steps":[
            {"duration":600,"hr":{"start":90,"end":100,"units":"%lthr"}},
            {"duration":600,"pace":{"start":300,"end":310,"units":"secs/km"}}]});
        let settings = r#"[{"types":["Run"],"lthr":160,"hr_zones":[120,140,150,160,170,180,190]}]"#;
        let (lines, blocks) = expand_plan(&doc, &SportSettings::parse(Some(settings)), "Run");
        // 95 % of 160 bpm is 152 bpm, zone 4.
        assert_eq!(zones(&blocks), vec![Some(4), None]);
        assert_eq!(
            lines[0].targets[0].absolute, None,
            "the line converts only by the plan's own threshold"
        );
    }

    #[test]
    fn rest_pace_and_an_untargeted_step_take_no_zone_and_an_untimed_step_still_shows() {
        let blocks = bar(
            json!({"ftp":200,"steps":[
                {"duration":120,"text":"Rest","_power":{"value":100}},
                {"duration":300,"pace":{"value":95,"units":"%pace"}},
                {"text":"Spin easy"},
                {"duration":300,"_power":{"value":198}}]}),
            "[]",
            "Ride",
        );
        assert_eq!(
            blocks,
            vec![
                FfiStepBlock {
                    seconds: 120.0,
                    zone: None,
                    rest: true
                },
                FfiStepBlock {
                    seconds: 300.0,
                    zone: None,
                    rest: false
                },
                FfiStepBlock {
                    seconds: UNTIMED_BLOCK_SECONDS,
                    zone: None,
                    rest: false
                },
                FfiStepBlock {
                    seconds: 300.0,
                    zone: None,
                    rest: false
                },
            ],
            "with no power zones set, watts place in no zone"
        );
    }

    #[test]
    fn categories_and_targets_read_from_the_wire_and_a_body_without_id_or_day_is_skipped() {
        let settings = SportSettings::default();
        let event = |category: &str, target: Value| {
            planned_event(
                &json!({"id":1,"start_date_local":"2026-01-02T07:30:00","category":category,
                        "target":target,"workout_doc":{"steps":[{"text":"A","duration":60}]}})
                .to_string(),
                &settings,
            )
            .unwrap()
        };
        for (raw, category) in [
            ("WORKOUT", FfiPlannedCategory::Workout),
            ("RACE_A", FfiPlannedCategory::Race),
            ("NOTE", FfiPlannedCategory::Note),
            ("TARGET", FfiPlannedCategory::Target),
            ("SEASON_START", FfiPlannedCategory::Season),
            ("HOLIDAY", FfiPlannedCategory::Other),
        ] {
            let read = event(raw, json!(null));
            assert_eq!(read.category, category, "{raw}");
            assert_eq!(
                read.lines.is_empty(),
                category != FfiPlannedCategory::Workout,
                "{raw}"
            );
            assert_eq!(read.day, "2026-01-02");
        }
        assert_eq!(
            event("WORKOUT", json!("HR")).target,
            Some(FfiPlanTarget::HeartRate)
        );
        assert_eq!(
            event("WORKOUT", json!("PACE")).target,
            Some(FfiPlanTarget::Pace)
        );
        assert_eq!(event("WORKOUT", json!("SPEED")).target, None);
        assert_eq!(event("WORKOUT", json!(null)).moving_time, None);

        assert!(
            planned_event(r#"{"start_date_local":"2026-01-02T00:00:00"}"#, &settings).is_none()
        );
        assert!(planned_event(r#"{"id":4,"start_date_local":7}"#, &settings).is_none());
        assert!(planned_event("{", &settings).is_none());
        assert_eq!(
            planned_event(
                r#"{"id":"42","start_date_local":"2026-01-02T00:00:00"}"#,
                &settings
            )
            .unwrap()
            .id,
            42.0
        );
    }

    #[test]
    fn a_cancelled_event_is_gone_after_the_window_is_replaced() {
        let (_dir, mut engine, reader) = engine_and_reader();
        store(&mut engine, &day_events());
        store(&mut engine, &day_events()[1..2]);
        let events = pooled::planned_events(&reader, DAY, DAY + 86_399).unwrap();
        assert_eq!(
            events.iter().map(|e| e.id).collect::<Vec<_>>(),
            vec![7002.0]
        );
    }
}
