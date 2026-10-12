//! Reading a ledger row's stored payload into the record a screen shows.
//!
//! Storage stays free-form JSON, so a row written by any build is kept as it
//! was written. This is the one place that knows its keys: the engine parses a
//! row here once and TypeScript receives the fields typed.

use serde_json::Value;

use crate::{FfiSectionEraRecord, FfiSectionEventDetails, FfiSectionLink};

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
        reasons: reason_tags(stored.get("reasons")),
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

/// The tag of each boundary reason: the string itself, or the `kind` of an
/// object carrying the detector's serde tag. A reason with neither is skipped.
fn reason_tags(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| match item {
                    Value::String(tag) => Some(tag.clone()),
                    Value::Object(reason) => text(reason.get("kind")),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default()
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
    fn boundary_reasons_cross_as_their_tags() {
        let details = read(
            "recut",
            r#"{"reasons":[{"kind":"fork","through":4},"trim",{"kind":"usage_change"},{"through":2},7]}"#,
        )
        .expect("details");
        assert_eq!(details.reasons, strings(&["fork", "trim", "usage_change"]));
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
}
