//! The ladder and both renderings, against the real English templates.
//!
//! The same cases the TypeScript suite covers
//! (`src/__tests__/lib/activityNotificationBody.test.ts`), because the whole
//! point of moving this into the crate is that there is one answer rather than
//! one per language.

use super::*;

/// The real `en-AU` bundle, so a length assertion means something.
fn english() -> Templates {
    Templates {
        title_pr: "New PR".into(),
        title_faster: "Faster Than Usual".into(),
        title_recorded: "Activity Recorded".into(),
        a_section: "a section".into(),
        route_pr: "Route PR on {{name}}".into(),
        route_pr_delta: "Route PR on {{name}} ({{delta}} faster)".into(),
        route_pr_unnamed: "Route PR".into(),
        route_pr_unnamed_delta: "Route PR ({{delta}} faster)".into(),
        section_pr: "PR on {{name}}".into(),
        section_pr_delta: "PR on {{name}} ({{delta}} faster)".into(),
        section_pr_count: "PR on {{count}} sections".into(),
        section_pr_many: "PR on {{name}} and {{count}} more".into(),
        faster_on_route: "Faster than usual on {{name}}".into(),
        faster_on_route_delta: "Faster than usual on {{name}} ({{delta}} off PR)".into(),
        on_route: "On {{name}}".into(),
    }
}

fn route(
    name: &str,
    is_pr: bool,
    trend: i8,
    pr_improvement: Option<u32>,
    time_delta: Option<i32>,
) -> crate::FfiActivityRouteHighlight {
    crate::FfiActivityRouteHighlight {
        activity_id: "a1".into(),
        route_id: "r1".into(),
        route_name: name.into(),
        is_pr,
        trend,
        time_delta_seconds: time_delta,
        pr_improvement_seconds: pr_improvement,
    }
}

fn prs(count: u32, name: &str, named: bool, improvement: Option<u32>) -> SectionPrs {
    SectionPrs {
        count,
        first_name: name.into(),
        first_named: named,
        first_improvement_seconds: improvement,
    }
}

fn body_of(highlight: &Highlight, activity_name: &str) -> String {
    notification_for(highlight, activity_name, &english()).body
}

const LONG_ACTIVITY: &str = "Wednesday evening chaingang with the Thursday club, long version";
const LONG_ROUTE: &str = "The long way round past the reservoir and back over the ridge";

// ============================================================================
// The ladder
// ============================================================================

#[test]
fn a_named_route_pr_beats_everything() {
    let picked = pick_highlight(
        Some(&route("Lake Loop", true, 1, None, None)),
        &prs(1, "Climb", true, None),
        true,
        Some("Fittest in a year"),
    );

    assert_eq!(
        picked,
        Highlight::RoutePr {
            route_name: "Lake Loop".into(),
            improvement_seconds: None,
        }
    );
}

#[test]
fn a_single_section_pr_names_the_section() {
    let picked = pick_highlight(None, &prs(1, "Climb", true, Some(8)), true, None);

    assert_eq!(
        body_of(&picked, "Morning Ride"),
        "PR on Climb (8s faster) - Morning Ride"
    );
}

#[test]
fn several_section_prs_name_the_first_and_count_the_rest() {
    let picked = pick_highlight(None, &prs(3, "Climb", true, None), true, None);

    assert_eq!(body_of(&picked, ""), "PR on Climb and 2 more");
}

#[test]
fn several_unnamed_section_prs_keep_the_count_form() {
    let picked = pick_highlight(None, &prs(3, "", false, None), true, None);

    assert_eq!(body_of(&picked, ""), "PR on 3 sections");
}

#[test]
fn one_unnamed_section_pr_reads_as_a_section() {
    let picked = pick_highlight(None, &prs(1, "", false, None), true, None);

    assert_eq!(body_of(&picked, ""), "PR on a section");
}

#[test]
fn an_unnamed_route_pr_still_reads_as_a_pr() {
    let picked = pick_highlight(
        Some(&route("", true, 1, Some(75), None)),
        &SectionPrs::default(),
        true,
        None,
    );

    assert_eq!(body_of(&picked, ""), "Route PR (1:15 faster)");
}

#[test]
fn the_pr_category_off_suppresses_prs_but_keeps_route_identity() {
    let picked = pick_highlight(
        Some(&route("Lake Loop", true, 0, Some(12), None)),
        &prs(2, "Climb", true, None),
        false,
        None,
    );

    assert_eq!(body_of(&picked, ""), "On Lake Loop");
}

#[test]
fn an_upward_trend_without_a_pr_reads_faster_than_usual() {
    let picked = pick_highlight(
        Some(&route("Lake Loop", false, 1, None, Some(45))),
        &SectionPrs::default(),
        true,
        None,
    );

    assert_eq!(
        body_of(&picked, ""),
        "Faster than usual on Lake Loop (45s off PR)"
    );
}

/// The gap is what is left to close on the best, so a zero or negative one is
/// not a gap and the plain form is what is true.
#[test]
fn the_trend_rung_never_claims_a_time_it_does_not_have() {
    let picked = pick_highlight(
        Some(&route("Lake Loop", false, 1, None, Some(-30))),
        &SectionPrs::default(),
        true,
        None,
    );

    assert_eq!(body_of(&picked, ""), "Faster than usual on Lake Loop");
}

#[test]
fn a_downward_trend_is_never_surfaced() {
    let picked = pick_highlight(
        Some(&route("Lake Loop", false, -1, None, None)),
        &SectionPrs::default(),
        true,
        None,
    );

    assert_eq!(body_of(&picked, ""), "On Lake Loop");
}

#[test]
fn a_milestone_is_the_last_rung_there_is() {
    let picked = pick_highlight(
        None,
        &SectionPrs::default(),
        true,
        Some("Fittest in a year"),
    );

    assert_eq!(
        body_of(&picked, "Morning Ride"),
        "Fittest in a year - Morning Ride"
    );
    assert_eq!(picked.tier(), Tier::Recorded);
}

/// No floor rung. A distance-and-time line tells the athlete what they already
/// know they did, and it fired on every commute.
#[test]
fn a_ride_with_nothing_in_it_says_nothing() {
    let picked = pick_highlight(None, &SectionPrs::default(), true, None);

    assert_eq!(picked, Highlight::None);
    assert_eq!(body_of(&picked, LONG_ACTIVITY), "");
    assert_eq!(
        notification_for(&picked, LONG_ACTIVITY, &english()).sentence,
        None
    );
}

#[test]
fn a_milestone_the_athlete_switched_off_is_not_passed_in_and_says_nothing() {
    let picked = pick_highlight(None, &SectionPrs::default(), true, None);

    assert_eq!(body_of(&picked, "Morning Ride"), "");
}

// ============================================================================
// The cap
// ============================================================================

#[test]
fn the_whole_route_pr_clause_and_its_delta_stay_inside_the_cap() {
    let picked = pick_highlight(
        Some(&route(LONG_ROUTE, true, 1, Some(12), None)),
        &SectionPrs::default(),
        true,
        None,
    );

    let body = body_of(&picked, LONG_ACTIVITY);

    assert!(units(&body) <= NOTIFICATION_BODY_MAX, "{body}");
    assert!(body.starts_with("Route PR on "), "{body}");
    assert!(body.contains("(12s faster)"), "{body}");
}

#[test]
fn the_route_name_is_truncated_and_the_delta_never_is() {
    let picked = pick_highlight(
        Some(&route(LONG_ROUTE, true, 1, Some(12), None)),
        &SectionPrs::default(),
        true,
        None,
    );

    let body = body_of(&picked, "Ride");

    assert!(body.contains('\u{2026}'), "{body}");
    assert!(!body.contains("back over the ridge"), "{body}");
    assert!(body.contains("(12s faster)"), "{body}");
}

#[test]
fn the_activity_name_is_dropped_rather_than_cutting_into_the_finding() {
    let picked = pick_highlight(
        Some(&route(LONG_ROUTE, true, 1, Some(12), None)),
        &SectionPrs::default(),
        true,
        None,
    );

    assert!(!body_of(&picked, LONG_ACTIVITY).contains("Wednesday"));
}

#[test]
fn a_short_name_is_kept_when_there_is_room_for_it() {
    let picked = pick_highlight(
        Some(&route("Lake Loop", false, 0, None, None)),
        &SectionPrs::default(),
        true,
        None,
    );

    assert_eq!(body_of(&picked, "Ride"), "On Lake Loop - Ride");
}

#[test]
fn a_name_that_lands_exactly_on_the_cap_is_kept_whole() {
    let picked = pick_highlight(
        Some(&route("Lake Loop", false, 0, None, None)),
        &SectionPrs::default(),
        true,
        None,
    );
    let detail = "On Lake Loop - ";
    let name = "x".repeat(NOTIFICATION_BODY_MAX - detail.len());

    let body = body_of(&picked, &name);

    assert_eq!(body, format!("{detail}{name}"));
    assert_eq!(units(&body), NOTIFICATION_BODY_MAX);
    assert!(!body.contains('\u{2026}'));
}

/// The activity name is what is left of the line, and a fragment of one is
/// worth less than the space it takes, so it goes whole or not at all.
#[test]
fn a_name_with_less_than_a_tail_of_room_is_dropped_rather_than_left_a_fragment() {
    let picked = pick_highlight(
        Some(&route(LONG_ROUTE, true, 1, Some(3665), None)),
        &SectionPrs::default(),
        true,
        None,
    );

    let body = body_of(&picked, "Morning Ride");

    assert!(body.ends_with("(1:01:05 faster)"), "{body}");
    assert!(!body.contains(" - "), "{body}");
    assert!(units(&body) <= NOTIFICATION_BODY_MAX, "{body}");
}

/// Scenario: a translated template is longer than the English it was sized
/// against, so the clause clears the cap with no name left to give.
///
/// Expected behaviour: the delta survives and the place name is what yields.
#[test]
fn a_longer_translation_gives_up_the_place_name_and_keeps_the_delta() {
    let mut portuguese = english();
    portuguese.faster_on_route_delta =
        "Mais rapido do que o habitual em {{name}} ({{delta}} do recorde)".into();
    let picked = pick_highlight(
        Some(&route(LONG_ROUTE, false, 1, None, Some(154))),
        &SectionPrs::default(),
        true,
        None,
    );

    let body = notification_for(&picked, "Ride", &portuguese).body;

    assert!(body.contains("(2:34 do recorde)"), "{body}");
    assert!(body.contains('\u{2026}'), "{body}");
}

/// Scenario: a clause that has given its place name back to `MIN_PLACE_NAME`
/// and is still over the cap.
///
/// Expected behaviour: it is cut here rather than by the lock screen, so the
/// cut is marked.
#[test]
fn a_clause_with_no_name_left_to_give_is_cut_rather_than_collapsed() {
    let mut verbose = english();
    verbose.on_route =
        "On the route known to everyone in the whole club as {{name}}, once again".into();
    let picked = pick_highlight(
        Some(&route(LONG_ROUTE, false, 0, None, None)),
        &SectionPrs::default(),
        true,
        None,
    );

    let body = notification_for(&picked, "Ride", &verbose).body;

    assert_eq!(units(&body), NOTIFICATION_BODY_MAX);
    assert!(body.ends_with('\u{2026}'), "{body}");
}

// ============================================================================
// An activity with no name
// ============================================================================

/// Scenario: the fetch returned nothing, which it does on three paths: no
/// credentials, the metadata poll exhausting its 15 s, and any thrown
/// exception. There is no name to put in the body.
///
/// Expected behaviour: the body carries whatever the engine still knows and
/// nothing else. It used to fall back to the notification's own title, so the
/// athlete got "Activity Recorded" over "Activity Recorded", which is strictly
/// worse than the generic notification it replaced.
#[test]
fn a_nameless_activity_is_the_finding_alone_with_no_dangling_separator() {
    let picked = pick_highlight(
        Some(&route("Lake Loop", false, 0, None, None)),
        &SectionPrs::default(),
        true,
        None,
    );

    assert_eq!(body_of(&picked, ""), "On Lake Loop");
}

#[test]
fn a_nameless_activity_with_no_finding_is_empty() {
    let picked = pick_highlight(None, &SectionPrs::default(), true, None);

    assert_eq!(body_of(&picked, ""), "");
}

// ============================================================================
// The title follows the ladder
// ============================================================================

#[test]
fn the_four_pr_rungs_are_titled_as_prs() {
    for picked in [
        pick_highlight(
            Some(&route("Lake Loop", true, 1, None, None)),
            &SectionPrs::default(),
            true,
            None,
        ),
        pick_highlight(
            Some(&route("", true, 1, None, None)),
            &SectionPrs::default(),
            true,
            None,
        ),
        pick_highlight(None, &prs(1, "Climb", true, None), true, None),
        pick_highlight(None, &prs(4, "Climb", true, None), true, None),
    ] {
        assert_eq!(
            notification_for(&picked, "Ride", &english()).title,
            "New PR",
            "{picked:?}"
        );
    }
}

#[test]
fn the_trend_rung_is_titled_faster_than_usual() {
    let picked = pick_highlight(
        Some(&route("Lake Loop", false, 1, None, None)),
        &SectionPrs::default(),
        true,
        None,
    );

    let built = notification_for(&picked, "Ride", &english());
    assert_eq!(built.tier, "faster");
    assert_eq!(built.title, "Faster Than Usual");
}

#[test]
fn route_identity_milestones_and_nothing_are_all_titled_recorded() {
    for picked in [
        pick_highlight(
            Some(&route("Lake Loop", false, 0, None, None)),
            &SectionPrs::default(),
            true,
            None,
        ),
        pick_highlight(
            None,
            &SectionPrs::default(),
            true,
            Some("Fittest in a year"),
        ),
        pick_highlight(None, &SectionPrs::default(), true, None),
    ] {
        let built = notification_for(&picked, "Ride", &english());
        assert_eq!(built.tier, "recorded", "{picked:?}");
        assert_eq!(built.title, "Activity Recorded", "{picked:?}");
    }
}

/// Suppressing PRs drops the title with the body: the athlete who switched
/// them off must not be told "New PR" over a route-identity line.
#[test]
fn suppressing_prs_drops_the_title_to_the_tier_the_body_came_from() {
    let picked = pick_highlight(
        Some(&route("Lake Loop", true, 1, Some(12), None)),
        &prs(2, "Climb", true, None),
        false,
        None,
    );

    let built = notification_for(&picked, "Ride", &english());
    assert_eq!(built.tier, "faster");
    assert_eq!(built.body, "Faster than usual on Lake Loop - Ride");
}

// ============================================================================
// The sentence a screen shows
// ============================================================================

/// A screen has room the lock screen does not, and it must say the same thing.
#[test]
fn the_sentence_gives_up_no_part_of_the_place_name() {
    let picked = pick_highlight(
        Some(&route(LONG_ROUTE, true, 1, Some(12), None)),
        &SectionPrs::default(),
        true,
        None,
    );

    let built = notification_for(&picked, LONG_ACTIVITY, &english());

    assert_eq!(
        built.sentence.as_deref(),
        Some(
            "Route PR on The long way round past the reservoir and back over the ridge (12s faster)"
        )
    );
    assert!(built.body.contains('\u{2026}'));
}

// ============================================================================
// Formatting
// ============================================================================

#[test]
fn a_delta_under_a_minute_is_seconds_and_above_it_is_m_ss() {
    assert_eq!(format_duration_delta(0), "0s");
    assert_eq!(format_duration_delta(12), "12s");
    assert_eq!(format_duration_delta(59), "59s");
    assert_eq!(format_duration_delta(60), "1:00");
    assert_eq!(format_duration_delta(154), "2:34");
    assert_eq!(format_duration_delta(3665), "1:01:05");
}

/// Every cap here was sized against JavaScript's `String.length`, which counts
/// UTF-16 units, so a name with an emoji in it has to cut in the same place as
/// the TypeScript renderer did or the screen and the lock screen disagree.
#[test]
fn the_cap_counts_what_javascript_counts() {
    assert_eq!(units("Lake Loop"), 9);
    assert_eq!(units("caf\u{e9}"), 4);
    assert_eq!(units("\u{1f6b4}"), 2);

    // A cut that would land inside a surrogate pair takes the whole character.
    let trimmed = trim("\u{1f6b4}\u{1f6b4}\u{1f6b4}", 5);
    assert_eq!(trimmed, "\u{1f6b4}\u{1f6b4}\u{2026}");
    assert_eq!(units(&trimmed), 5);
}

#[test]
fn a_template_keeps_a_placeholder_it_was_given_no_value_for() {
    assert_eq!(
        interpolate("On {{name}} in {{city}}", &[("name", "Lake Loop")]),
        "On Lake Loop in {{city}}"
    );
}

// ============================================================================
// The bundle
// ============================================================================

#[test]
fn a_stored_bundle_comes_back_as_it_went_in() {
    let tmp = tempfile::TempDir::new().expect("tempdir");
    let engine =
        PersistentEngine::new(&tmp.path().join("routes.db").to_string_lossy()).expect("the engine");

    assert_eq!(stored_templates(&engine), None, "nothing pushed yet");

    engine
        .set_notification_templates("en-AU", &stored_pairs())
        .expect("the write");

    assert_eq!(stored_templates(&engine), Some(english()));
}

/// Scenario: a native push handler cold-starts the process on an install whose
/// JavaScript has never pushed a bundle, so there is none to read.
///
/// Expected behaviour: no notification rather than a body of raw keys.
#[test]
fn no_stored_bundle_means_no_notification_rather_than_raw_keys() {
    let tmp = tempfile::TempDir::new().expect("tempdir");
    let mut engine =
        PersistentEngine::new(&tmp.path().join("routes.db").to_string_lossy()).expect("the engine");

    assert_eq!(
        build_notification(&mut engine, "a1", "Ride", true, None),
        None
    );
}

/// Scenario: the push site stored a bundle that is missing a key, which is an
/// older or newer push site than this reader.
///
/// Expected behaviour: none, so the caller posts nothing. A partial bundle
/// renders the missing rung as its own dotted path on a lock screen.
#[test]
fn a_bundle_missing_a_key_reads_as_none_rather_than_a_dotted_path() {
    let mut pairs = stored_pairs();
    pairs.retain(|(key, _)| key != "notifications.activityBody.onRoute");
    let stored = crate::persistence::settings::NotificationTemplates {
        locale: "en-AU".into(),
        templates: pairs.into_iter().collect(),
    };

    assert_eq!(templates_from_stored(&stored), None);
}

/// The fifteen keys the push site resolves, as it stores them.
fn stored_pairs() -> Vec<(String, String)> {
    let t = english();
    [
        ("notifications.activityPr.title", t.title_pr),
        ("notifications.activityFaster.title", t.title_faster),
        ("notifications.activityRecorded.title", t.title_recorded),
        ("notifications.activityBody.aSection", t.a_section),
        ("notifications.activityBody.routePr", t.route_pr),
        ("notifications.activityBody.routePrDelta", t.route_pr_delta),
        (
            "notifications.activityBody.routePrUnnamed",
            t.route_pr_unnamed,
        ),
        (
            "notifications.activityBody.routePrUnnamedDelta",
            t.route_pr_unnamed_delta,
        ),
        ("notifications.activityBody.sectionPr", t.section_pr),
        (
            "notifications.activityBody.sectionPrDelta",
            t.section_pr_delta,
        ),
        (
            "notifications.activityBody.sectionPrCount",
            t.section_pr_count,
        ),
        (
            "notifications.activityBody.sectionPrMany",
            t.section_pr_many,
        ),
        (
            "notifications.activityBody.fasterOnRoute",
            t.faster_on_route,
        ),
        (
            "notifications.activityBody.fasterOnRouteDelta",
            t.faster_on_route_delta,
        ),
        ("notifications.activityBody.onRoute", t.on_route),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v))
    .collect()
}

/// Scenario: the ladder against a real engine with an empty library, which is
/// what a handler sees when the activity it was woken for is not indexed.
#[test]
fn the_ladder_answers_nothing_for_an_activity_the_engine_does_not_hold() {
    let tmp = tempfile::TempDir::new().expect("tempdir");
    let mut engine =
        PersistentEngine::new(&tmp.path().join("routes.db").to_string_lossy()).expect("the engine");
    engine
        .set_notification_templates("en-AU", &stored_pairs())
        .expect("the write");

    let built = build_notification(&mut engine, "a1", "Morning Ride", true, None).expect("a built");

    assert_eq!(built.body, "");
    assert_eq!(built.tier, "recorded");
    assert_eq!(built.sentence, None);
}

// ============================================================================
// Every rung, every locale
// ============================================================================

/// The seventeen bundles the app ships, read from the tree rather than copied
/// here, so a template edited in one of them is checked by this.
///
/// A missing directory fails rather than skipping: a guard that goes quiet
/// when it cannot find its input is worth less than no guard at all.
fn every_locale() -> Vec<(String, Templates)> {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../../src/i18n/locales");
    let entries = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("the locale bundles at {}: {e}", dir.display()));
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let raw = std::fs::read_to_string(&path).expect("the bundle");
        let json: serde_json::Value = serde_json::from_str(&raw).expect("the bundle parses");
        let n = &json["notifications"];
        let body = &n["activityBody"];
        let at = |v: &serde_json::Value, k: &str| -> String {
            v[k].as_str()
                .unwrap_or_else(|| panic!("{} is missing {k}", path.display()))
                .to_string()
        };
        out.push((
            path.file_stem().unwrap().to_string_lossy().to_string(),
            Templates {
                title_pr: at(&n["activityPr"], "title"),
                title_faster: at(&n["activityFaster"], "title"),
                title_recorded: at(&n["activityRecorded"], "title"),
                a_section: at(body, "aSection"),
                route_pr: at(body, "routePr"),
                route_pr_delta: at(body, "routePrDelta"),
                route_pr_unnamed: at(body, "routePrUnnamed"),
                route_pr_unnamed_delta: at(body, "routePrUnnamedDelta"),
                section_pr: at(body, "sectionPr"),
                section_pr_delta: at(body, "sectionPrDelta"),
                section_pr_count: at(body, "sectionPrCount"),
                section_pr_many: at(body, "sectionPrMany"),
                faster_on_route: at(body, "fasterOnRoute"),
                faster_on_route_delta: at(body, "fasterOnRouteDelta"),
                on_route: at(body, "onRoute"),
            },
        ));
    }
    assert!(!out.is_empty(), "no bundles at {}", dir.display());
    out
}

/// Long enough that the place-name cap is what decides, in every language.
const LONG_PLACE: &str = "Reservoir ridge and the long way back again";

/// Every rung the ladder can reach, with a place name no template can fit
/// whole and a delta of 2:34 where the rung carries one.
fn every_rung() -> Vec<(&'static str, Highlight, bool)> {
    vec![
        (
            "routePrDelta",
            Highlight::RoutePr {
                route_name: LONG_PLACE.into(),
                improvement_seconds: Some(154),
            },
            true,
        ),
        (
            "routePr",
            Highlight::RoutePr {
                route_name: LONG_PLACE.into(),
                improvement_seconds: None,
            },
            false,
        ),
        (
            "routePrUnnamedDelta",
            Highlight::RoutePrUnnamed {
                improvement_seconds: Some(154),
            },
            true,
        ),
        (
            "routePrUnnamed",
            Highlight::RoutePrUnnamed {
                improvement_seconds: None,
            },
            false,
        ),
        (
            "sectionPrDelta",
            Highlight::SectionPr {
                section_name: LONG_PLACE.into(),
                named: true,
                improvement_seconds: Some(154),
            },
            true,
        ),
        (
            "sectionPr",
            Highlight::SectionPr {
                section_name: LONG_PLACE.into(),
                named: true,
                improvement_seconds: None,
            },
            false,
        ),
        (
            "sectionPrUnnamed",
            Highlight::SectionPr {
                section_name: String::new(),
                named: false,
                improvement_seconds: None,
            },
            false,
        ),
        (
            "sectionPrMany",
            Highlight::SectionPrMany {
                section_name: LONG_PLACE.into(),
                named: true,
                count: 3,
            },
            false,
        ),
        (
            "sectionPrCount",
            Highlight::SectionPrMany {
                section_name: String::new(),
                named: false,
                count: 3,
            },
            false,
        ),
        (
            "fasterOnRouteDelta",
            Highlight::FasterOnRoute {
                route_name: LONG_PLACE.into(),
                gap_seconds: Some(154),
            },
            true,
        ),
        (
            "fasterOnRoute",
            Highlight::FasterOnRoute {
                route_name: LONG_PLACE.into(),
                gap_seconds: None,
            },
            false,
        ),
        (
            "onRoute",
            Highlight::OnRoute {
                route_name: LONG_PLACE.into(),
            },
            false,
        ),
        (
            "milestone",
            Highlight::Milestone {
                title: "Functional threshold power is up by five watts on the twelve week trend"
                    .into(),
            },
            false,
        ),
    ]
}

/// Scenario: the place-name cap was sized against the English templates, and a
/// translated one is longer, so a composed clause can clear the cap on its own
/// with no name left to give.
///
/// Expected behaviour: giving the place name back is enough, in every locale
/// and on every rung. Asserting on the finished body would prove nothing,
/// since the last thing `notification_for` does is cut it to the cap: what has
/// to hold is that the clause fits before that cut, because past it the lock
/// screen loses the end of the finding rather than the end of a name.
#[test]
fn giving_the_place_name_back_makes_every_rung_fit_in_every_locale() {
    for (locale, strings) in every_locale() {
        for (rung, highlight, _) in every_rung() {
            // The milestone rung carries the insight generator's own sentence
            // rather than a template, so there is no place name to give back
            // and the final cut is the only thing holding it. It is covered by
            // the body test below.
            if matches!(highlight, Highlight::Milestone { .. }) {
                continue;
            }
            let detail = highlight_detail(&highlight, &strings).expect("a clause");
            assert!(
                units(&detail) <= NOTIFICATION_BODY_MAX,
                "{locale}/{rung}: {} units, {detail}",
                units(&detail)
            );
        }
    }
}

/// And the body that carries it, with an activity name and without one.
#[test]
fn every_rung_fits_the_cap_in_every_locale() {
    for (locale, strings) in every_locale() {
        for (rung, highlight, _) in every_rung() {
            for activity_name in ["Wednesday evening chaingang with the Thursday club", ""] {
                let body = notification_for(&highlight, activity_name, &strings).body;
                assert!(
                    units(&body) <= NOTIFICATION_BODY_MAX,
                    "{locale}/{rung} with name {activity_name:?}: {} units, {body}",
                    units(&body)
                );
            }
        }
    }
}

/// The delta clause is what an Android lock screen must not drop: it is the
/// only reason the enrichment pipeline exists, so where a rung carries one it
/// survives whatever else does not.
#[test]
fn every_rung_with_a_delta_keeps_it_in_every_locale() {
    for (locale, strings) in every_locale() {
        for (rung, highlight, has_delta) in every_rung() {
            if !has_delta {
                continue;
            }
            let body = notification_for(
                &highlight,
                "Wednesday evening chaingang with the Thursday club",
                &strings,
            )
            .body;
            assert!(body.contains("2:34"), "{locale}/{rung}: {body}");
        }
    }
}

/// Scenario: the ladder now has two paths, one holding the engine lock and one
/// reading from a pooled connection, and only the second is reached from a
/// push.
///
/// Expected behaviour: they answer the same for the same library. Two paths to
/// one notification is how a tray entry starts disagreeing with the screen the
/// athlete opens from it.
mod parity {
    use crate::notifications::{resolve_highlight, resolve_highlight_pooled};
    use crate::persistence::PersistentEngine;
    use crate::test_globals::serial_global_state;
    use rusqlite::params;
    use tempfile::TempDir;
    use tracematch::GpsPoint;

    /// One ride over one section it holds the record on.
    ///
    /// File-backed rather than in-memory, and serial, because the pooled
    /// overlay goes through `read_cache`, whose invalidation stamp is one
    /// process-wide `PRAGMA data_version` against a path. An in-memory engine
    /// has no path to stamp, so it reads whatever another test's database left
    /// in the slot and a rename here would not be seen.
    fn engine_with_a_section_pr(tmp: &TempDir) -> PersistentEngine {
        let db = tmp.path().join("notification_parity.db");
        let db_path = db.to_str().unwrap();
        // File-backed is only half of it: nothing but `persistent_engine_init`
        // binds, so a test opening its own database leaves the stamp pointing
        // at whatever ran last and the slot holding that library's overlay.
        crate::persistence::read_pool::bind(db_path);
        let mut engine = PersistentEngine::new(db_path).unwrap();
        let coords: Vec<GpsPoint> = (0..8)
            .map(|i| GpsPoint {
                latitude: 46.2 + f64::from(i) * 0.001,
                longitude: 7.3,
                elevation: None,
            })
            .collect();
        engine
            .add_activity("a1".to_string(), coords.clone(), "Ride".to_string())
            .unwrap();
        let polyline = serde_json::to_string(
            &coords
                .iter()
                .map(|p| [p.latitude, p.longitude])
                .collect::<Vec<[f64; 2]>>(),
        )
        .unwrap();
        engine
            .db
            .execute(
                "INSERT INTO sections (id, section_type, name, sport_type, polyline_json,
                    distance_meters, is_user_defined, version, created_at,
                    bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng)
                 VALUES ('s0', 'auto', 'Climb 1', 'Ride', ?, 400.0, 0, 1,
                    '2026-01-01T00:00:00Z', 46.2, 46.21, 7.3, 7.31)",
                params![polyline],
            )
            .unwrap();
        engine
            .db
            .execute(
                "INSERT INTO section_activities (section_id, activity_id, direction,
                    start_index, end_index, distance_meters)
                 VALUES ('s0', 'a1', 'same', 1, 5, 400.0)",
                [],
            )
            .unwrap();
        // A lap has to have a time before it can be a record, and the metrics
        // row is what dates it.
        engine
            .set_activity_metrics(vec![crate::ActivityMetrics {
                activity_id: "a1".to_string(),
                name: "Morning Ride".to_string(),
                date: 1_700_000_000,
                distance: 400.0,
                moving_time: 8,
                elapsed_time: 8,
                elevation_gain: 0.0,
                avg_hr: None,
                avg_power: None,
                sport_type: "Ride".to_string(),
                training_load: None,
                ftp: None,
                power_zone_times: None,
                hr_zone_times: None,
            }])
            .unwrap();
        engine.set_time_streams_flat(&["a1".to_string()], &(0..8).collect::<Vec<u32>>(), &[0]);
        engine
    }

    fn both_paths(
        engine: &mut PersistentEngine,
        announce_prs: bool,
    ) -> crate::notifications::Highlight {
        let through_the_pool = resolve_highlight_pooled(&engine.db, "a1", announce_prs, None);
        let through_the_lock = resolve_highlight(engine, "a1", announce_prs, None);
        assert_eq!(through_the_pool, through_the_lock);
        through_the_pool
    }

    #[test]
    fn the_two_ladders_agree_on_a_library_with_a_section() {
        let _serial = serial_global_state();
        let tmp = TempDir::new().unwrap();
        let mut engine = engine_with_a_section_pr(&tmp);
        // Agreeing on `None` would prove nothing, so the section case has to
        // reach a highlight before the equality above means anything.
        let announced = both_paths(&mut engine, true);
        assert_ne!(
            announced,
            crate::notifications::Highlight::None,
            "the ride holds the record on the section it traversed"
        );
        both_paths(&mut engine, false);
    }

    #[test]
    fn the_two_ladders_agree_on_an_empty_library() {
        let _serial = serial_global_state();
        let tmp = TempDir::new().unwrap();
        let db = tmp.path().join("notification_parity_empty.db");
        let db_path = db.to_str().unwrap();
        crate::persistence::read_pool::bind(db_path);
        let mut engine = PersistentEngine::new(db_path).unwrap();
        both_paths(&mut engine, true);
    }

    /// The corridor name an athlete gave is resolved from the intent rather
    /// than read off the row, so a pooled ladder that skipped the overlay
    /// would name the section differently in the tray.
    #[test]
    fn the_two_ladders_agree_on_the_name_the_athlete_gave() {
        let _serial = serial_global_state();
        let tmp = TempDir::new().unwrap();
        let mut engine = engine_with_a_section_pr(&tmp);
        engine
            .set_section_name("s0", Some("Col de la Forclaz"))
            .unwrap();
        let announced = both_paths(&mut engine, true);
        assert!(
            format!("{announced:?}").contains("Col de la Forclaz"),
            "the overlay name reaches the tray on both paths: {announced:?}"
        );
    }
}
