//! Reading a ledger row's stored payload into the record a screen shows.
//!
//! Storage stays free-form JSON, so a row written by any build is kept as it
//! was written. This is the one place that knows its keys: the engine parses a
//! row here once and TypeScript receives the fields typed.

use serde_json::Value;

use tracematch::GpsPoint;

use crate::{
    FfiBoundaryReason, FfiChangeReason, FfiSectionChangeSummary, FfiSectionEraRecord,
    FfiSectionEventDetails, FfiSectionLink,
};

const KIND_FORMED: &str = "formed";
const KIND_SPLIT: &str = "split";

/// The record for one row's stored payload. `kind` decides which lineage the
/// row resolves through `link`: a birth names the section it was carved from,
/// a split names the pieces it left. Absent when the row stored no payload or
/// stored something that is not a JSON object.
pub(crate) fn event_details(
    raw: Option<&str>,
    kind: &str,
    link: &mut dyn FnMut(&str) -> FfiSectionLink,
) -> Option<FfiSectionEventDetails> {
    let Value::Object(stored) = serde_json::from_str(raw?).ok()? else {
        return None;
    };
    let siblings = strings(stored.get("siblings"));
    let split_from = (kind == KIND_FORMED)
        .then(|| text(stored.get("split_from")))
        .flatten()
        .map(|id| link(&id));
    let split_into = if kind == KIND_SPLIT {
        siblings.iter().map(|id| link(id)).collect()
    } else {
        Vec::new()
    };
    Some(FfiSectionEventDetails {
        around: strings(stored.get("around")),
        fork_around: strings(stored.get("fork_around")),
        prs: era_records(&stored),
        pr_from: number(stored.get("from_time")),
        pr_to: number(stored.get("to_time")),
        pr_sport: text(stored.get("sport")),
        pr_direction: text(stored.get("direction")),
        siblings,
        version: number(stored.get("version")),
        reanchored_from: text(stored.get("from")),
        reanchored_to: text(stored.get("to")),
        moved: stored.get("moved").and_then(Value::as_bool),
        split_from,
        split_into,
        boundaries: boundary_reasons(stored.get("boundaries")),
        summary: None,
    })
}

fn text(value: Option<&Value>) -> Option<String> {
    value.and_then(Value::as_str).map(str::to_string)
}

fn number(value: Option<&Value>) -> Option<f64> {
    value.and_then(Value::as_f64)
}

/// The string elements of a list; anything else in it, or a value that is not
/// a list, is skipped.
fn strings(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// The era's records: a list of entries naming their sport and direction on
/// a current row, a map of sport to record on one written before records were
/// held per direction, a single `pr_time` on one written before they were held
/// per sport.
fn era_records(stored: &serde_json::Map<String, Value>) -> Vec<FfiSectionEraRecord> {
    let mut records: Vec<FfiSectionEraRecord> = match stored.get("prs") {
        Some(Value::Array(entries)) => entries
            .iter()
            .filter_map(|entry| {
                Some(FfiSectionEraRecord {
                    sport: text(entry.get("sport")),
                    direction: text(entry.get("direction")),
                    time: number(entry.get("time"))?,
                })
            })
            .collect(),
        Some(Value::Object(by_sport)) => by_sport
            .iter()
            .filter_map(|(sport, record)| {
                Some(FfiSectionEraRecord {
                    sport: Some(sport.clone()),
                    direction: None,
                    time: number(record.get("time"))?,
                })
            })
            .collect(),
        _ => {
            return number(stored.get("pr_time"))
                .map(|time| FfiSectionEraRecord {
                    sport: None,
                    direction: None,
                    time,
                })
                .into_iter()
                .collect();
        }
    };
    records.sort_by(|a, b| (&a.sport, &a.direction).cmp(&(&b.sport, &b.direction)));
    records
}

/// Why the detector cut the line, one entry per record the change stored:
/// its serde tag and, for a seam clip, how much of the line it took. An entry
/// with no tag is skipped.
fn boundary_reasons(value: Option<&Value>) -> Vec<FfiBoundaryReason> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    Some(FfiBoundaryReason {
                        kind: text(item.get("kind"))?,
                        clipped_metres: number(item.get("clipped_metres")),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The kinds a detector run writes, which get a headline. A row the athlete
/// made, and the baseline and algorithm rows, carry none.
const SUMMARISED: [&str; 8] = [
    "formed",
    "restored",
    "split",
    "recut",
    "dissolved",
    "merged",
    "superseded",
    "absorbed",
];

/// How far an end of the line has to move between two versions to count as
/// moved. Re-drawing the same ground from another ride shifts an end by a few
/// metres, and the detector does not narrate that.
const END_MOVED_METRES: f64 = 25.0;

/// What the row did to the line, from the version before and the row's own
/// version, and the one record the detector stored nearest the part that moved.
/// Absent for a kind that is not a detector change. `before` is empty when no
/// earlier version is stored, and `after` when the row has no line.
///
/// A record is the reason only when it sits within the matcher's reach of the
/// part that moved: a record stored without a place, by a build before
/// records carried one, is the reason only when it is the row's only record.
pub(crate) fn change_summary(
    raw: Option<&str>,
    kind: &str,
    before: &[GpsPoint],
    after: &[GpsPoint],
    link: &mut dyn FnMut(&str) -> FfiSectionLink,
) -> Option<FfiSectionChangeSummary> {
    if !SUMMARISED.contains(&kind) {
        return None;
    }
    let stored = match raw.and_then(|r| serde_json::from_str(r).ok()) {
        Some(Value::Object(stored)) => stored,
        _ => serde_json::Map::new(),
    };
    let records: Vec<&Value> = stored
        .get("boundaries")
        .and_then(Value::as_array)
        .map(|items| items.iter().collect())
        .unwrap_or_default();
    let has_line = |line: &[GpsPoint]| line.len() >= 2;
    let mut summary = FfiSectionChangeSummary {
        length_before: has_line(before).then(|| length(before)),
        length_after: has_line(after).then(|| length(after)),
        ..Default::default()
    };
    if !has_line(after) {
        return Some(summary);
    }
    let found = match kind {
        "recut" if has_line(before) => {
            let start_moved = apart(&before[0], &after[0]);
            let end_moved = apart(&before[before.len() - 1], &after[after.len() - 1]);
            let (moved, places) = match (start_moved, end_moved) {
                (false, false) => return Some(summary),
                (true, false) => ("start", vec![(&after[0], &before[0])]),
                (false, true) => (
                    "end",
                    vec![(&after[after.len() - 1], &before[before.len() - 1])],
                ),
                (true, true) => (
                    "both",
                    vec![
                        (&after[0], &before[0]),
                        (&after[after.len() - 1], &before[before.len() - 1]),
                    ],
                ),
            };
            summary.moved = Some(moved.to_string());
            nearest_to_ends(&records, &places)
        }
        "split" => split_point(&records, after)
            .inspect(|&(_, along)| {
                summary.moved = Some("split".to_string());
                summary.at_metres = along;
            })
            .map(|(record, _)| record),
        _ => None,
    };
    if matches!(kind, "recut" | "split") {
        summary.reason = found.and_then(|record| reason(record, link));
    }
    Some(summary)
}

/// The record nearest any of the places an end moved between, `(now, was)`.
/// Records are tried in the detector's order, so two at one distance read as
/// the first.
fn nearest_to_ends<'a>(
    records: &[&'a Value],
    places: &[(&GpsPoint, &GpsPoint)],
) -> Option<&'a Value> {
    if let Some(lone) = lone_unplaced(records) {
        return Some(lone);
    }
    let mut best: Option<(f64, &'a Value)> = None;
    for record in records {
        let Some(at) = place(record) else { continue };
        let reach = reach_of(record);
        let gap = places
            .iter()
            .flat_map(|(now, was)| [now, was])
            .map(|p| tracematch::geo_utils::haversine_distance(&at, p))
            .fold(f64::INFINITY, f64::min);
        if gap <= reach && best.is_none_or(|(g, _)| gap < g) {
            best = Some((gap, record));
        }
    }
    best.map(|(_, record)| record)
}

/// The record a split was cut at and how far along the line that is: the fork
/// lying on the line, else the placed record nearest it. A lone record with no
/// place is the reason without a point.
fn split_point<'a>(records: &[&'a Value], line: &[GpsPoint]) -> Option<(&'a Value, Option<f64>)> {
    if let Some(lone) = lone_unplaced(records) {
        return Some((lone, None));
    }
    let mut best: Option<(bool, f64, f64, &'a Value)> = None;
    for record in records {
        let Some(at) = place(record) else { continue };
        let Some((gap, along)) = project(line, &at) else {
            continue;
        };
        if gap > reach_of(record) {
            continue;
        }
        let fork = text(record.get("kind")).as_deref() == Some("fork");
        let better = best
            .is_none_or(|(was_fork, g, _, _)| (fork && !was_fork) || (fork == was_fork && gap < g));
        if better {
            best = Some((fork, gap, along, record));
        }
    }
    best.map(|(_, _, along, record)| (record, Some(along)))
}

/// The row's only record when it carries no place.
fn lone_unplaced<'a>(records: &[&'a Value]) -> Option<&'a Value> {
    match records {
        [only] if place(only).is_none() => Some(only),
        _ => None,
    }
}

fn place(record: &Value) -> Option<GpsPoint> {
    Some(GpsPoint::new(
        number(record.get("latitude"))?,
        number(record.get("longitude"))?,
    ))
}

/// How far a record may sit from the part that moved. The detector measured it
/// on its grid before the drawn end was clipped back, so a seam clip adds the
/// metres it took.
fn reach_of(record: &Value) -> f64 {
    tracematch::SectionConfig::default().proximity_threshold
        + number(record.get("clipped_metres")).unwrap_or(0.0)
}

/// A stored record as the one reason a row shows. A kind this build does not
/// explain reads as no reason.
fn reason(record: &Value, link: &mut dyn FnMut(&str) -> FfiSectionLink) -> Option<FfiChangeReason> {
    let kind = text(record.get("kind"))?;
    let count = |key: &str| record.get(key).and_then(Value::as_u64).map(|n| n as u32);
    let (count_of, of, metres) = match kind.as_str() {
        "usage_change" => (count("mismatched"), count("shared"), None),
        "fork" => (count("branch_leavers"), count("through"), None),
        "terminus" => (count("ending"), count("through"), None),
        "traffic_cliff" => {
            let thick = count("thick");
            (
                thick
                    .zip(count("thin"))
                    .map(|(thick, thin)| thick.saturating_sub(thin)),
                thick,
                None,
            )
        }
        "low_support" => (None, count("floor"), None),
        "trim" => (None, None, number(record.get("dropped_metres"))),
        "seam_clip" => (None, None, number(record.get("clipped_metres"))),
        "pass_end" => (None, None, None),
        _ => return None,
    };
    let neighbour = strings(record.get("neighbours")).first().map(|id| link(id));
    Some(FfiChangeReason {
        kind,
        count: count_of,
        of,
        metres,
        neighbour,
    })
}

fn apart(a: &GpsPoint, b: &GpsPoint) -> bool {
    tracematch::geo_utils::haversine_distance(a, b) > END_MOVED_METRES
}

fn length(line: &[GpsPoint]) -> f64 {
    line.windows(2)
        .map(|pair| tracematch::geo_utils::haversine_distance(&pair[0], &pair[1]))
        .sum()
}

/// The nearest point of `line` to `at`: its distance from `at` and how far
/// along the line it lies, both in metres. Planar within a segment, which is
/// exact enough over the few hundred metres a segment spans.
fn project(line: &[GpsPoint], at: &GpsPoint) -> Option<(f64, f64)> {
    const METRES_PER_DEGREE: f64 = 111_194.9;
    let mut travelled = 0.0;
    let mut best: Option<(f64, f64)> = None;
    for pair in line.windows(2) {
        let (a, b) = (&pair[0], &pair[1]);
        let lon_scale = a.latitude.to_radians().cos().abs().max(0.01);
        let (dx, dy) = (
            (b.longitude - a.longitude) * lon_scale,
            b.latitude - a.latitude,
        );
        let (tx, ty) = (
            (at.longitude - a.longitude) * lon_scale,
            at.latitude - a.latitude,
        );
        let length_sq = dx * dx + dy * dy;
        let fraction = if length_sq > 0.0 {
            ((tx * dx + ty * dy) / length_sq).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let gap = ((tx - fraction * dx).powi(2) + (ty - fraction * dy).powi(2)).sqrt()
            * METRES_PER_DEGREE;
        let segment = tracematch::geo_utils::haversine_distance(a, b);
        let along = travelled + fraction * segment;
        if best.is_none_or(|(g, _)| gap < g) {
            best = Some((gap, along));
        }
        travelled += segment;
    }
    best
}

/// Fold the record moves a re-cut wrote beside it onto its summary, so the
/// re-cut row says whose record moved and by how much. A `pr_rebased` row
/// folds onto the nearest earlier re-cut row of the same instant, in
/// `events` order, and keeps a pointer to it. A rebase row with no such re-cut
/// stays as it was.
pub(crate) fn fold_record_moves(events: &mut [crate::FfiSectionHistoryEvent]) {
    let mut recut: Option<usize> = None;
    for index in 0..events.len() {
        match events[index].kind.as_str() {
            "recut" => recut = Some(index),
            "pr_rebased" => {
                let Some(target) = recut.filter(|&t| events[t].at == events[index].at) else {
                    continue;
                };
                let (id, moved) = {
                    let event = &events[index];
                    let Some(details) = event.details.as_ref() else {
                        continue;
                    };
                    (
                        events[target].id,
                        crate::FfiRecordMove {
                            sport: details.pr_sport.clone(),
                            direction: details.pr_direction.clone(),
                            from: details.pr_from,
                            to: details.pr_to,
                        },
                    )
                };
                if let Some(summary) = events[target]
                    .details
                    .as_mut()
                    .and_then(|d| d.summary.as_mut())
                {
                    summary.records.push(moved);
                }
                if let Some(details) = events[index].details.as_mut() {
                    details.summary = Some(FfiSectionChangeSummary {
                        folded_into: Some(id),
                        ..Default::default()
                    });
                }
            }
            _ => recut = None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(kind: &str, raw: &str) -> Option<FfiSectionEventDetails> {
        event_details(Some(raw), kind, &mut |id| FfiSectionLink {
            id: id.to_string(),
            name: Some(format!("name of {id}")),
            available: id != "gone",
        })
    }

    fn strings(ids: &[&str]) -> Vec<String> {
        ids.iter().map(|id| id.to_string()).collect()
    }

    #[test]
    fn a_birth_from_a_split_resolves_its_parent() {
        let details = read(
            "formed",
            r#"{"split_from":"parent","discriminator":"2","line_order":2,"around":["a1"]}"#,
        )
        .expect("details");
        assert_eq!(
            details.split_from,
            Some(FfiSectionLink {
                id: "parent".into(),
                name: Some("name of parent".into()),
                available: true,
            })
        );
        assert_eq!(details.around, strings(&["a1"]));
        assert!(details.split_into.is_empty());
    }

    #[test]
    fn a_split_resolves_every_piece_it_left_in_order() {
        let details = read(
            "split",
            r#"{"prs":{"Ride":{"activity_id":"r1","time":65.5}},"siblings":["c1","gone"],"fork_around":["f1"]}"#,
        )
        .expect("details");
        assert_eq!(details.siblings, strings(&["c1", "gone"]));
        let linked: Vec<(&str, bool)> = details
            .split_into
            .iter()
            .map(|l| (l.id.as_str(), l.available))
            .collect();
        assert_eq!(linked, vec![("c1", true), ("gone", false)]);
        assert_eq!(details.fork_around, strings(&["f1"]));
        assert!(details.split_from.is_none());
    }

    #[test]
    fn a_lineage_key_on_another_kind_resolves_no_link() {
        let details = read("recut", r#"{"split_from":"parent","siblings":["c1"]}"#).expect("d");
        assert!(details.split_from.is_none());
        assert!(details.split_into.is_empty());
        assert_eq!(details.siblings, strings(&["c1"]));
    }

    #[test]
    fn a_recut_reads_one_record_per_sport_in_sport_order() {
        let details = read(
            "recut",
            r#"{"prs":{"Run":{"activity_id":"r1","time":250.0},
                "Ride":{"activity_id":"b1","time":65.0},
                "Walk":{"activity_id":"w1","time":"slow"}}}"#,
        )
        .expect("details");
        assert_eq!(
            details.prs,
            vec![
                FfiSectionEraRecord {
                    sport: Some("Ride".into()),
                    direction: None,
                    time: 65.0
                },
                FfiSectionEraRecord {
                    sport: Some("Run".into()),
                    direction: None,
                    time: 250.0
                },
            ]
        );
    }

    #[test]
    fn a_recut_reads_one_record_per_sport_and_direction_in_that_order() {
        let details = read(
            "recut",
            r#"{"prs":[
                {"sport":"Ride","direction":"same","activity_id":"up","time":580.0},
                {"sport":"Ride","direction":"reverse","activity_id":"down","time":200.0},
                {"sport":"Run","direction":"same","activity_id":"r1","time":"slow"},
                {"sport":"Walk","activity_id":"w1","time":900.0}]}"#,
        )
        .expect("details");
        assert_eq!(
            details.prs,
            vec![
                FfiSectionEraRecord {
                    sport: Some("Ride".into()),
                    direction: Some("reverse".into()),
                    time: 200.0
                },
                FfiSectionEraRecord {
                    sport: Some("Ride".into()),
                    direction: Some("same".into()),
                    time: 580.0
                },
                FfiSectionEraRecord {
                    sport: Some("Walk".into()),
                    direction: None,
                    time: 900.0
                },
            ]
        );
    }

    #[test]
    fn a_rebased_record_reads_its_direction() {
        let details = read(
            "pr_rebased",
            r#"{"sport":"Ride","direction":"same","from_time":600.0,"to_time":580.0}"#,
        )
        .expect("details");
        assert_eq!(details.pr_sport.as_deref(), Some("Ride"));
        assert_eq!(details.pr_direction.as_deref(), Some("same"));
    }

    #[test]
    fn a_row_from_before_records_were_per_sport_reads_one_unlabelled_record() {
        let details = read("dissolved", r#"{"pr_time":412.5}"#).expect("details");
        assert_eq!(
            details.prs,
            vec![FfiSectionEraRecord {
                sport: None,
                direction: None,
                time: 412.5
            }]
        );
    }

    #[test]
    fn a_rebased_record_reads_both_ends_and_its_sport() {
        let details = read(
            "pr_rebased",
            r#"{"sport":"Run","from_activity_id":"a","from_time":250.0,"to_activity_id":"b","to_time":240.0,"basis":"current_extent"}"#,
        )
        .expect("details");
        assert_eq!(details.pr_sport.as_deref(), Some("Run"));
        assert_eq!(details.pr_direction, None);
        assert_eq!(details.pr_from, Some(250.0));
        assert_eq!(details.pr_to, Some(240.0));
    }

    #[test]
    fn a_rebase_with_no_record_on_one_side_reads_that_side_absent() {
        let details = read(
            "pr_rebased",
            r#"{"sport":"Run","from_time":null,"to_time":240.0}"#,
        )
        .expect("d");
        assert_eq!(details.pr_from, None);
        assert_eq!(details.pr_to, Some(240.0));
    }

    #[test]
    fn a_reanchor_reads_the_activities_it_moved_between_and_whether_it_moved() {
        let details = read(
            "reference_reanchored",
            r#"{"from":"a1","to":"a3","cause":"activity_removed"}"#,
        )
        .expect("details");
        assert_eq!(details.reanchored_from.as_deref(), Some("a1"));
        assert_eq!(details.reanchored_to.as_deref(), Some("a3"));
        assert_eq!(details.moved, None);

        let anchored = read("reference_anchored", r#"{"moved":false}"#).expect("details");
        assert_eq!(anchored.moved, Some(false));
    }

    #[test]
    fn a_revert_reads_its_version() {
        let details = read("reverted", r#"{"version":3}"#).expect("details");
        assert_eq!(details.version, Some(3.0));
    }

    #[test]
    fn boundary_reasons_cross_as_the_identity_writer_stores_them() {
        let details = read(
            "recut",
            r#"{"fork_around":["f1"],"boundaries":[
                {"kind":"fork","through":4,"needed":2.0,"branch_leavers":3},
                {"kind":"seam_clip","clipped_metres":120.5,"kept_metres":400.0},
                {"kind":"traffic_cliff","thin":2,"thick":9}]}"#,
        )
        .expect("details");
        assert_eq!(
            details.boundaries,
            vec![
                FfiBoundaryReason {
                    kind: "fork".into(),
                    clipped_metres: None,
                },
                FfiBoundaryReason {
                    kind: "seam_clip".into(),
                    clipped_metres: Some(120.5),
                },
                FfiBoundaryReason {
                    kind: "traffic_cliff".into(),
                    clipped_metres: None,
                },
            ]
        );
    }

    #[test]
    fn a_boundary_reason_without_a_kind_is_skipped_and_the_rest_still_reads() {
        let details = read(
            "formed",
            r#"{"boundaries":[{"through":2},7,"trim",{"kind":"seam_clip","clipped_metres":"far"},
                {"kind":"pass_end","requeued_cells":3}]}"#,
        )
        .expect("details");
        let kinds: Vec<(&str, Option<f64>)> = details
            .boundaries
            .iter()
            .map(|b| (b.kind.as_str(), b.clipped_metres))
            .collect();
        assert_eq!(kinds, vec![("seam_clip", None), ("pass_end", None)]);
    }

    #[test]
    fn a_change_with_no_boundary_reason_reads_none() {
        let details = read("formed", r#"{"around":["a1"]}"#).expect("details");
        assert!(details.boundaries.is_empty());
    }

    #[test]
    fn a_row_from_before_the_snapshot_was_trimmed_still_reads() {
        let details = read(
            "split",
            r#"{"prs":{"Ride":{"activity_id":"r1","time":65.0}},"avg_time":105.6,
                "visits_per_month":3.0,"unknown_future_key":{"a":1},"siblings":["c1"]}"#,
        )
        .expect("details");
        assert_eq!(details.prs.len(), 1);
        assert_eq!(details.siblings, strings(&["c1"]));
    }

    #[test]
    fn wrongly_typed_values_read_as_absent_and_the_rest_still_reads() {
        let details = read(
            "recut",
            r#"{"around":"a1","fork_around":["f1",2,null],"pr_time":"fast","version":"3",
                "from":7,"moved":"no","prs":[1,2]}"#,
        )
        .expect("details");
        assert!(details.around.is_empty());
        assert_eq!(details.fork_around, strings(&["f1"]));
        assert!(details.prs.is_empty());
        assert_eq!(details.version, None);
        assert_eq!(details.reanchored_from, None);
        assert_eq!(details.moved, None);
    }

    #[test]
    fn an_empty_object_reads_as_an_empty_record() {
        assert_eq!(
            read("formed", "{}"),
            Some(FfiSectionEventDetails::default())
        );
    }

    #[test]
    fn no_payload_and_unreadable_payloads_read_as_absent() {
        let mut link = |id: &str| FfiSectionLink {
            id: id.into(),
            name: None,
            available: true,
        };
        assert_eq!(event_details(None, "formed", &mut link), None);
        assert_eq!(read("formed", "not json a1"), None);
        assert_eq!(read("formed", r#"["a1"]"#), None);
        assert_eq!(read("formed", "null"), None);
    }

    const METRES_PER_DEGREE: f64 = 111_194.9;

    /// A line due north from the origin, `from` to `to` metres along the
    /// meridian, a point every 20 m.
    fn line(from: f64, to: f64) -> Vec<GpsPoint> {
        let steps = ((to - from) / 20.0).round() as usize;
        (0..=steps)
            .map(|i| {
                let metres = from + (to - from) * i as f64 / steps as f64;
                GpsPoint::new(metres / METRES_PER_DEGREE, 0.0)
            })
            .collect()
    }

    fn metres_to_lat(metres: f64) -> f64 {
        metres / METRES_PER_DEGREE
    }

    fn summarise(
        kind: &str,
        raw: &str,
        before: &[GpsPoint],
        after: &[GpsPoint],
    ) -> Option<FfiSectionChangeSummary> {
        change_summary(Some(raw), kind, before, after, &mut |id| FfiSectionLink {
            id: id.to_string(),
            name: Some(format!("name of {id}")),
            available: true,
        })
    }

    fn close(actual: Option<f64>, expected: f64) {
        let actual = actual.expect("a number");
        assert!((actual - expected).abs() < 2.0, "{actual} vs {expected}");
    }

    fn reason_of(summary: &FfiSectionChangeSummary) -> &FfiChangeReason {
        summary.reason.as_ref().expect("a reason")
    }

    #[test]
    fn a_recut_that_lengthens_the_end_reads_the_end_and_the_cliff_beside_it() {
        let raw = format!(
            r#"{{"boundaries":[
                {{"kind":"usage_change","shared":12,"mismatched":9,"latitude":{start},"longitude":0.0}},
                {{"kind":"traffic_cliff","thin":4,"thick":15,"latitude":{end},"longitude":0.0}}]}}"#,
            start = metres_to_lat(0.0),
            end = metres_to_lat(1480.0),
        );
        let summary = summarise("recut", &raw, &line(0.0, 1240.0), &line(0.0, 1480.0)).expect("s");
        assert_eq!(summary.moved.as_deref(), Some("end"));
        close(summary.length_before, 1240.0);
        close(summary.length_after, 1480.0);
        let reason = reason_of(&summary);
        assert_eq!(reason.kind, "traffic_cliff");
        assert_eq!((reason.count, reason.of), (Some(11), Some(15)));
        assert!(summary.at_metres.is_none());
    }

    #[test]
    fn a_recut_that_shortens_the_start_reads_the_start_and_its_reason() {
        let raw = format!(
            r#"{{"boundaries":[
                {{"kind":"terminus","through":14,"needed":3.0,"ending":6,"latitude":{start},"longitude":0.0}},
                {{"kind":"traffic_cliff","thin":4,"thick":15,"latitude":{end},"longitude":0.0}}]}}"#,
            start = metres_to_lat(300.0),
            end = metres_to_lat(1240.0),
        );
        let summary =
            summarise("recut", &raw, &line(0.0, 1240.0), &line(300.0, 1240.0)).expect("s");
        assert_eq!(summary.moved.as_deref(), Some("start"));
        close(summary.length_after, 940.0);
        let reason = reason_of(&summary);
        assert_eq!(reason.kind, "terminus");
        assert_eq!((reason.count, reason.of), (Some(6), Some(14)));
    }

    #[test]
    fn a_recut_that_moves_both_ends_reads_both_and_the_first_record_at_either() {
        let raw = format!(
            r#"{{"boundaries":[
                {{"kind":"fork","through":14,"needed":2.0,"branch_leavers":8,"latitude":{near_start},"longitude":0.0}},
                {{"kind":"usage_change","shared":12,"mismatched":9,"latitude":{near_end},"longitude":0.0}}]}}"#,
            near_start = metres_to_lat(-250.0),
            near_end = metres_to_lat(1700.0),
        );
        let summary =
            summarise("recut", &raw, &line(0.0, 1240.0), &line(-250.0, 1700.0)).expect("s");
        assert_eq!(summary.moved.as_deref(), Some("both"));
        assert_eq!(reason_of(&summary).kind, "fork");
    }

    #[test]
    fn a_split_reads_the_point_along_the_line_and_the_neighbour_it_turns_onto() {
        let raw = format!(
            r#"{{"siblings":["col-y"],"boundaries":[
                {{"kind":"seam_clip","clipped_metres":40.0,"kept_metres":900.0,"latitude":{far},"longitude":0.0}},
                {{"kind":"fork","through":14,"needed":2.0,"branch_leavers":8,"latitude":{fork},"longitude":0.0,
                  "neighbours":["col-y"]}}]}}"#,
            far = metres_to_lat(60.0),
            fork = metres_to_lat(1200.0),
        );
        let summary = summarise("split", &raw, &[], &line(0.0, 2000.0)).expect("s");
        assert_eq!(summary.moved.as_deref(), Some("split"));
        close(summary.at_metres, 1200.0);
        let reason = reason_of(&summary);
        assert_eq!(reason.kind, "fork");
        assert_eq!((reason.count, reason.of), (Some(8), Some(14)));
        assert_eq!(
            reason.neighbour.as_ref().and_then(|n| n.name.as_deref()),
            Some("name of col-y")
        );
    }

    #[test]
    fn a_trim_and_a_seam_clip_read_the_metres_they_took() {
        let at_end = metres_to_lat(1000.0);
        let trim = format!(
            r#"{{"boundaries":[{{"kind":"trim","kept_metres":1000.0,"dropped_metres":120.0,
                "latitude":{at_end},"longitude":0.0,"neighbours":["col-x"]}}]}}"#
        );
        let summary = summarise("recut", &trim, &line(0.0, 1120.0), &line(0.0, 1000.0)).expect("s");
        let reason = reason_of(&summary);
        assert_eq!((reason.kind.as_str(), reason.metres), ("trim", Some(120.0)));
        let clip = format!(
            r#"{{"boundaries":[{{"kind":"seam_clip","clipped_metres":40.0,"kept_metres":1000.0,
                "latitude":{},"longitude":0.0}}]}}"#,
            metres_to_lat(1040.0)
        );
        let summary = summarise("recut", &clip, &line(0.0, 1040.0), &line(0.0, 1000.0)).expect("s");
        let reason = reason_of(&summary);
        assert_eq!(
            (reason.kind.as_str(), reason.metres),
            ("seam_clip", Some(40.0))
        );
    }

    #[test]
    fn a_support_cut_reads_its_floor_and_no_ride_count() {
        let raw = format!(
            r#"{{"boundaries":[{{"kind":"low_support","floor":3,"dropped_cells":2,
                "latitude":{},"longitude":0.0}}]}}"#,
            metres_to_lat(940.0)
        );
        let summary = summarise("recut", &raw, &line(0.0, 1240.0), &line(0.0, 940.0)).expect("s");
        let reason = reason_of(&summary);
        assert_eq!(reason.kind, "low_support");
        assert_eq!((reason.count, reason.of), (None, Some(3)));
    }

    #[test]
    fn a_row_with_no_record_reads_no_reason() {
        let summary = summarise("recut", "{}", &line(0.0, 1240.0), &line(0.0, 1480.0)).expect("s");
        assert_eq!(summary.moved.as_deref(), Some("end"));
        assert!(summary.reason.is_none());
    }

    #[test]
    fn a_record_of_an_unknown_kind_reads_no_reason_rather_than_failing() {
        let raw = format!(
            r#"{{"boundaries":[{{"kind":"from_a_later_build","latitude":{},"longitude":0.0}},
                {{"kind":"backoff","represented":5,"probed":6,"latitude":{},"longitude":0.0}}]}}"#,
            metres_to_lat(1480.0),
            metres_to_lat(1480.0)
        );
        let summary = summarise("recut", &raw, &line(0.0, 1240.0), &line(0.0, 1480.0)).expect("s");
        assert!(summary.reason.is_none());
    }

    #[test]
    fn a_record_far_from_the_part_that_moved_is_not_its_reason() {
        let raw = format!(
            r#"{{"boundaries":[{{"kind":"traffic_cliff","thin":4,"thick":15,"latitude":{},"longitude":0.0}}]}}"#,
            metres_to_lat(300.0)
        );
        let summary = summarise("recut", &raw, &line(0.0, 1240.0), &line(0.0, 1480.0)).expect("s");
        assert!(summary.reason.is_none());
    }

    #[test]
    fn a_row_written_before_records_carried_a_place_names_a_lone_record_only() {
        let lone = r#"{"boundaries":[{"kind":"traffic_cliff","thin":4,"thick":15}]}"#;
        let summary = summarise("recut", lone, &line(0.0, 1240.0), &line(0.0, 1480.0)).expect("s");
        assert_eq!(reason_of(&summary).kind, "traffic_cliff");
        let two = r#"{"boundaries":[{"kind":"traffic_cliff","thin":4,"thick":15},
            {"kind":"usage_change","shared":12,"mismatched":9}]}"#;
        let summary = summarise("recut", two, &line(0.0, 1240.0), &line(0.0, 1480.0)).expect("s");
        assert!(summary.reason.is_none());
    }

    #[test]
    fn a_line_that_did_not_move_at_either_end_reads_no_part_and_no_reason() {
        let raw = format!(
            r#"{{"boundaries":[{{"kind":"traffic_cliff","thin":4,"thick":15,"latitude":{},"longitude":0.0}}]}}"#,
            metres_to_lat(1240.0)
        );
        let summary = summarise("recut", &raw, &line(0.0, 1240.0), &line(0.0, 1250.0)).expect("s");
        assert!(summary.moved.is_none());
        assert!(summary.reason.is_none());
    }

    #[test]
    fn a_recut_with_no_earlier_version_reads_its_length_and_no_part() {
        let summary = summarise("recut", "{}", &[], &line(0.0, 1480.0)).expect("s");
        assert!(summary.length_before.is_none());
        close(summary.length_after, 1480.0);
        assert!(summary.moved.is_none());
    }

    #[test]
    fn a_birth_reads_its_length_and_no_reason() {
        let raw = format!(
            r#"{{"boundaries":[{{"kind":"traffic_cliff","thin":4,"thick":15,"latitude":{},"longitude":0.0}}]}}"#,
            metres_to_lat(1480.0)
        );
        let summary = summarise("formed", &raw, &[], &line(0.0, 1480.0)).expect("s");
        close(summary.length_after, 1480.0);
        assert!(summary.reason.is_none());
    }

    #[test]
    fn rows_the_athlete_made_and_the_bookkeeping_rows_read_no_summary() {
        for kind in [
            "trimmed",
            "renamed",
            "reverted",
            "accepted",
            "baseline",
            "algorithm_changed",
        ] {
            assert_eq!(
                summarise(kind, "{}", &line(0.0, 1.0), &line(0.0, 2.0)),
                None,
                "{kind}"
            );
        }
    }

    fn event(
        id: f64,
        at: &str,
        kind: &str,
        details: Option<FfiSectionEventDetails>,
    ) -> crate::FfiSectionHistoryEvent {
        crate::FfiSectionHistoryEvent {
            id,
            at: at.to_string(),
            kind: kind.to_string(),
            details,
            geometry_version: None,
        }
    }

    fn rebase(sport: &str, from: Option<f64>, to: Option<f64>) -> FfiSectionEventDetails {
        FfiSectionEventDetails {
            pr_sport: Some(sport.into()),
            pr_direction: Some("same".into()),
            pr_from: from,
            pr_to: to,
            ..Default::default()
        }
    }

    fn recut_with_summary() -> FfiSectionEventDetails {
        FfiSectionEventDetails {
            summary: Some(FfiSectionChangeSummary::default()),
            ..Default::default()
        }
    }

    #[test]
    fn record_moves_written_with_a_recut_fold_onto_it() {
        let mut events = vec![
            event(1.0, "2026-01-01 10:00:00", "formed", None),
            event(
                2.0,
                "2026-01-02 10:00:00",
                "recut",
                Some(recut_with_summary()),
            ),
            event(
                3.0,
                "2026-01-02 10:00:00",
                "pr_rebased",
                Some(rebase("Ride", Some(600.0), Some(580.0))),
            ),
            event(
                4.0,
                "2026-01-02 10:00:00",
                "pr_rebased",
                Some(rebase("Run", None, Some(250.0))),
            ),
        ];
        fold_record_moves(&mut events);
        let recut = events[1]
            .details
            .as_ref()
            .and_then(|d| d.summary.as_ref())
            .expect("summary");
        assert_eq!(
            recut.records,
            vec![
                crate::FfiRecordMove {
                    sport: Some("Ride".into()),
                    direction: Some("same".into()),
                    from: Some(600.0),
                    to: Some(580.0)
                },
                crate::FfiRecordMove {
                    sport: Some("Run".into()),
                    direction: Some("same".into()),
                    from: None,
                    to: Some(250.0)
                },
            ]
        );
        for folded in [2, 3] {
            let summary = events[folded]
                .details
                .as_ref()
                .and_then(|d| d.summary.as_ref())
                .expect("summary");
            assert_eq!(summary.folded_into, Some(2.0));
        }
    }

    #[test]
    fn a_rebase_from_another_instant_or_with_no_recut_before_it_stays_alone() {
        let mut events = vec![
            event(
                1.0,
                "2026-01-02 10:00:00",
                "recut",
                Some(recut_with_summary()),
            ),
            event(
                2.0,
                "2026-01-03 09:00:00",
                "pr_rebased",
                Some(rebase("Ride", Some(600.0), Some(580.0))),
            ),
            event(
                3.0,
                "2026-01-04 09:00:00",
                "pr_rebased",
                Some(rebase("Ride", Some(580.0), Some(570.0))),
            ),
        ];
        fold_record_moves(&mut events);
        let recut = events[0]
            .details
            .as_ref()
            .and_then(|d| d.summary.as_ref())
            .expect("summary");
        assert!(recut.records.is_empty());
        assert!(
            events[1]
                .details
                .as_ref()
                .and_then(|d| d.summary.as_ref())
                .is_none()
        );
        assert!(
            events[2]
                .details
                .as_ref()
                .and_then(|d| d.summary.as_ref())
                .is_none()
        );
    }
}
