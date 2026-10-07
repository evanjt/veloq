//! The ladder and both renderings, against the real English templates.

use super::*;
use crate::persistence::PersistentEngine;

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
        section_pr_many_one: "PR on {{name}} and one more".into(),
        faster_on_route: "Faster than usual on {{name}}".into(),
        faster_on_route_delta: "Faster than usual on {{name}} ({{delta}} off PR)".into(),
        ftp_milestone: "Cycling eFTP: {{current}}W (+{{change}}W)".into(),
        pace_milestone: "Pace improved {{delta}}".into(),
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
        Some(Highlight::FtpMilestone {
            current_watts: 285,
            change_watts: 12,
        }),
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
fn two_section_prs_use_the_count_of_one_form() {
    let french = Templates {
        section_pr_many: "PR sur {{name}} et {{count}} autres".into(),
        section_pr_many_one: "PR sur {{name}} et un autre".into(),
        ..english()
    };
    let two = pick_highlight(None, &prs(2, "Climb", true, None), true, None);
    let three = pick_highlight(None, &prs(3, "Climb", true, None), true, None);

    assert_eq!(
        highlight_detail(&two, &french).as_deref(),
        Some("PR sur Climb et un autre")
    );
    assert_eq!(
        highlight_detail(&three, &french).as_deref(),
        Some("PR sur Climb et 2 autres")
    );
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
        Some(&route("Lake Loop", true, 1, Some(12), None)),
        &prs(2, "Climb", true, None),
        false,
        None,
    );

    assert_eq!(body_of(&picked, ""), "Faster than usual on Lake Loop");
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

    assert_eq!(picked, Highlight::None);
}

#[test]
fn a_milestone_is_the_last_rung_there_is() {
    let picked = pick_highlight(
        None,
        &SectionPrs::default(),
        true,
        Some(Highlight::FtpMilestone {
            current_watts: 285,
            change_watts: 12,
        }),
    );

    assert_eq!(
        body_of(&picked, "Morning Ride"),
        "Cycling eFTP: 285W (+12W) - Morning Ride"
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

/// Scenario: an athlete names their commute and rides it daily, none of them a
/// PR and none faster than average.
///
/// Expected behaviour: a named route is not a result on its own, so nothing
/// is raised.
#[test]
fn an_unremarkable_ride_on_a_named_route_raises_nothing() {
    let picked = pick_highlight(
        Some(&route("Work", false, 0, None, None)),
        &SectionPrs::default(),
        true,
        None,
    );

    assert_eq!(picked, Highlight::None);
}

#[test]
fn a_short_name_is_kept_when_there_is_room_for_it() {
    let picked = pick_highlight(
        Some(&route("Lake Loop", false, 1, None, None)),
        &SectionPrs::default(),
        true,
        None,
    );

    assert_eq!(
        body_of(&picked, "Ride"),
        "Faster than usual on Lake Loop - Ride"
    );
}

#[test]
fn a_name_that_lands_exactly_on_the_cap_is_kept_whole() {
    let picked = pick_highlight(
        Some(&route("Lake Loop", false, 1, None, None)),
        &SectionPrs::default(),
        true,
        None,
    );
    let detail = "Faster than usual on Lake Loop - ";
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
    verbose.faster_on_route =
        "On the route known to everyone in the whole club as {{name}}, once again".into();
    let picked = pick_highlight(
        Some(&route(LONG_ROUTE, false, 1, None, None)),
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
        Some(&route("Lake Loop", false, 1, None, None)),
        &SectionPrs::default(),
        true,
        None,
    );

    assert_eq!(body_of(&picked, ""), "Faster than usual on Lake Loop");
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
            Some(Highlight::PaceMilestone {
                delta: "12s/km".into(),
            }),
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

    assert_eq!(
        crate::persistence::settings::notification_templates_from(&engine.db).expect("the read"),
        None,
        "nothing pushed yet"
    );

    engine
        .set_notification_templates("en-AU", &stored_pairs())
        .expect("the write");

    let stored = crate::persistence::settings::notification_templates_from(&engine.db)
        .expect("the read")
        .expect("the bundle");
    assert_eq!(templates_from_stored(&stored), Some(english()));
}

/// Scenario: a native push handler cold-starts the process on an install whose
/// JavaScript has never pushed a bundle, so there is none to read.
///
/// Expected behaviour: no notification rather than a body of raw keys.
#[test]
fn no_stored_bundle_means_no_notification_rather_than_raw_keys() {
    let tmp = tempfile::TempDir::new().expect("tempdir");
    let engine =
        PersistentEngine::new(&tmp.path().join("routes.db").to_string_lossy()).expect("the engine");

    assert_eq!(
        build_notification_pooled(&engine.db, "a1", "Ride", true, false),
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
    pairs.retain(|(key, _)| key != "notifications.activityBody.fasterOnRoute");
    let stored = crate::persistence::settings::NotificationTemplates {
        locale: "en-AU".into(),
        templates: pairs.into_iter().collect(),
    };

    assert_eq!(templates_from_stored(&stored), None);
}

/// The seventeen keys the push site resolves, as it stores them.
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
            "notifications.activityBody.sectionPrManyOne",
            t.section_pr_many_one,
        ),
        (
            "notifications.activityBody.fasterOnRoute",
            t.faster_on_route,
        ),
        (
            "notifications.activityBody.fasterOnRouteDelta",
            t.faster_on_route_delta,
        ),
        ("insights.ftpIncrease", t.ftp_milestone),
        ("insights.paceImproved", t.pace_milestone),
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
    let engine =
        PersistentEngine::new(&tmp.path().join("routes.db").to_string_lossy()).expect("the engine");
    engine
        .set_notification_templates("en-AU", &stored_pairs())
        .expect("the write");

    let built =
        build_notification_pooled(&engine.db, "a1", "Morning Ride", true, false).expect("a built");

    assert_eq!(built.body, "");
    assert_eq!(built.tier, "recorded");
    assert_eq!(built.sentence, None);
}

// ============================================================================
// Every rung, every locale
// ============================================================================

/// The locale every fallback chain ends at, as the app's bundle loader has it.
const ROOT_LOCALE: &str = "en-GB";

/// The first bundle in `chain` holding a string at `path`, the way i18next
/// reads a key through a fallback chain: a regional bundle carries only what
/// differs from its base, so a key it omits is read from the next one.
fn resolved<'a>(chain: &'a [&serde_json::Value], path: &[&str]) -> Option<&'a str> {
    chain.iter().find_map(|bundle| {
        path.iter()
            .try_fold(*bundle, |node, key| node.get(key))
            .and_then(|v| v.as_str())
    })
}

/// The app's fallback chain for each locale, read from `LOCALE_FALLBACKS`
/// rather than copied here, so a bundle stored as overrides is checked with
/// the strings an athlete actually reads.
fn fallback_chains() -> std::collections::HashMap<String, Vec<String>> {
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../../src/i18n/types.ts");
    let source = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("the fallback map at {}: {e}", path.display()));
    let start = source
        .find("export const LOCALE_FALLBACKS")
        .unwrap_or_else(|| panic!("{} has no LOCALE_FALLBACKS", path.display()));
    let block = &source[start..];
    let block = &block[..block.find("\n};").expect("the fallback map closes")];
    let unquote = |s: &str| s.trim().trim_matches('\'').to_string();
    let mut chains = std::collections::HashMap::new();
    for line in block.lines().skip(1) {
        let line = line.trim();
        let Some((key, rest)) = line.split_once(':') else {
            continue;
        };
        let Some(list) = rest.trim().strip_prefix('[') else {
            continue;
        };
        let list = list.split(']').next().unwrap_or("");
        chains.insert(
            unquote(key),
            list.split(',')
                .map(unquote)
                .filter(|s| !s.is_empty())
                .collect(),
        );
    }
    assert!(
        !chains.is_empty(),
        "no fallback chains in {}",
        path.display()
    );
    chains
}

/// The seventeen bundles the app ships, read from the tree rather than copied
/// here, so a template edited in one of them is checked by this. Each is
/// resolved through its fallback chain, so a regional bundle holding only its
/// overrides is checked with the strings it inherits.
///
/// A missing directory fails rather than skipping: a guard that goes quiet
/// when it cannot find its input is worth less than no guard at all.
fn every_locale() -> Vec<(String, Templates)> {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../../src/i18n/locales");
    let entries = std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("the locale bundles at {}: {e}", dir.display()));
    let mut bundles = std::collections::BTreeMap::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let raw = std::fs::read_to_string(&path).expect("the bundle");
        let json: serde_json::Value = serde_json::from_str(&raw).expect("the bundle parses");
        bundles.insert(
            path.file_stem().unwrap().to_string_lossy().to_string(),
            json,
        );
    }
    assert!(!bundles.is_empty(), "no bundles at {}", dir.display());

    let chains = fallback_chains();
    let mut out = Vec::new();
    for locale in bundles.keys() {
        let mut names = chains
            .get(locale)
            .unwrap_or_else(|| panic!("{locale} has no fallback chain"))
            .clone();
        names.push(ROOT_LOCALE.to_string());
        let mut chain: Vec<&serde_json::Value> = Vec::new();
        for name in &names {
            let bundle = bundles
                .get(name)
                .unwrap_or_else(|| panic!("{locale} falls back to {name}, which has no bundle"));
            if !chain.iter().any(|b| std::ptr::eq(*b, bundle)) {
                chain.push(bundle);
            }
        }
        let at = |path: &[&str]| -> String {
            resolved(&chain, path)
                .unwrap_or_else(|| panic!("{locale} resolves no {}", path.join(".")))
                .to_string()
        };
        let body = |key: &str| at(&["notifications", "activityBody", key]);
        out.push((
            locale.clone(),
            Templates {
                title_pr: at(&["notifications", "activityPr", "title"]),
                title_faster: at(&["notifications", "activityFaster", "title"]),
                title_recorded: at(&["notifications", "activityRecorded", "title"]),
                a_section: body("aSection"),
                route_pr: body("routePr"),
                route_pr_delta: body("routePrDelta"),
                route_pr_unnamed: body("routePrUnnamed"),
                route_pr_unnamed_delta: body("routePrUnnamedDelta"),
                section_pr: body("sectionPr"),
                section_pr_delta: body("sectionPrDelta"),
                section_pr_count: body("sectionPrCount"),
                section_pr_many: body("sectionPrMany"),
                section_pr_many_one: body("sectionPrManyOne"),
                faster_on_route: body("fasterOnRoute"),
                faster_on_route_delta: body("fasterOnRouteDelta"),
                ftp_milestone: at(&["insights", "ftpIncrease"]),
                pace_milestone: at(&["insights", "paceImproved"]),
            },
        ));
    }
    out
}

#[test]
fn a_key_resolves_from_the_first_bundle_in_the_chain_that_holds_it() {
    let regional = serde_json::json!({ "n": { "title": "Regional" } });
    let base = serde_json::json!({ "n": { "title": "Base", "body": "Base body" } });
    let chain = [&regional, &base];

    assert_eq!(resolved(&chain, &["n", "title"]), Some("Regional"));
    assert_eq!(resolved(&chain, &["n", "body"]), Some("Base body"));
    assert_eq!(resolved(&chain, &["n", "missing"]), None);
    assert_eq!(resolved(&[], &["n", "title"]), None);
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
            "ftpMilestone",
            Highlight::FtpMilestone {
                current_watts: 285,
                change_watts: 12,
            },
            false,
        ),
        (
            "paceMilestone",
            Highlight::PaceMilestone {
                delta: "154s/km".into(),
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

/// The pooled reader uses committed rows and the athlete's section names.
mod pooled_highlight {
    use crate::notifications::{resolve_highlight_pooled, section_prs_from};
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
        let db = tmp.path().join("notification_pooled.db");
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

    #[test]
    fn test_pooled_section_pr_single_outing_has_no_pr() {
        let _serial = serial_global_state();
        let tmp = TempDir::new().unwrap();
        let engine = engine_with_a_section_pr(&tmp);
        let announced = resolve_highlight_pooled(&engine.db, "a1", true, false);
        assert_eq!(
            announced,
            crate::notifications::Highlight::None,
            "the first outing has no rival to beat"
        );
        assert_eq!(
            resolve_highlight_pooled(&engine.db, "a1", false, false),
            crate::notifications::Highlight::None
        );
    }

    #[test]
    fn test_section_notification_first_outing_has_no_pr() {
        let _serial = serial_global_state();
        let tmp = TempDir::new().unwrap();
        let mut engine = engine_with_a_section_pr(&tmp);
        let sections = engine.get_sections_for_activity("a1");
        let prs = section_prs_from(&sections, "a1", |id| engine.get_section_performances(id));
        assert_eq!(prs.count, 0);
    }

    fn add_section_outing(engine: &mut PersistentEngine, id: &str, direction: &str, time: f64) {
        let coords: Vec<GpsPoint> = (0..8)
            .map(|i| GpsPoint::new(46.2 + f64::from(i) * 0.001, 7.3))
            .collect();
        engine
            .add_activity(id.to_string(), coords, "Ride".to_string())
            .unwrap();
        let mut second = engine.activity_metrics.get("a1").unwrap().clone();
        second.activity_id = id.to_string();
        second.name = id.to_string();
        second.date += 86_400;
        engine.set_activity_metrics(vec![second]).unwrap();
        engine
            .db
            .execute(
                "INSERT INTO section_activities (section_id, activity_id, direction, start_index, end_index, distance_meters, lap_time, lap_pace)
                 VALUES ('s0', ?1, ?2, 1, 5, 400.0, ?3, ?4)",
                params![id, direction, time, 400.0 / time],
            )
            .unwrap();
    }

    #[test]
    fn test_section_notification_same_direction_requires_strict_beat() {
        let _serial = serial_global_state();
        let tmp = TempDir::new().unwrap();
        let mut engine = engine_with_a_section_pr(&tmp);
        let old_time = engine.get_section_performances("s0").records[0].best_time;
        add_section_outing(&mut engine, "a2", "same", old_time - 1.0);
        let sections = engine.get_sections_for_activity("a2");
        let beat = section_prs_from(&sections, "a2", |id| engine.get_section_performances(id));
        assert_eq!(beat.count, 1);

        add_section_outing(&mut engine, "a3", "same", old_time - 1.0);
        let tied = section_prs_from(&sections, "a2", |id| engine.get_section_performances(id));
        assert_eq!(tied.count, 0, "the earlier of two tied efforts");
        let sections = engine.get_sections_for_activity("a3");
        let later = section_prs_from(&sections, "a3", |id| engine.get_section_performances(id));
        assert_eq!(later.count, 0, "the later of two tied efforts");
    }

    #[test]
    fn test_section_notification_first_reverse_outing_has_no_pr() {
        let _serial = serial_global_state();
        let tmp = TempDir::new().unwrap();
        let mut engine = engine_with_a_section_pr(&tmp);
        add_section_outing(&mut engine, "a2", "reverse", 2.0);
        let sections = engine.get_sections_for_activity("a2");
        let prs = section_prs_from(&sections, "a2", |id| engine.get_section_performances(id));
        assert_eq!(prs.count, 0);
    }

    #[test]
    fn test_section_notification_out_and_back_compares_forward_lap() {
        let _serial = serial_global_state();
        let tmp = TempDir::new().unwrap();
        let mut engine = engine_with_a_section_pr(&tmp);
        let old_time = engine.get_section_performances("s0").records[0].best_time;
        engine
            .db
            .execute(
                "INSERT INTO section_activities (section_id, activity_id, direction, start_index, end_index, distance_meters, lap_time, lap_pace)
                 VALUES ('s0', 'a1', 'reverse', 5, 7, 400.0, ?1, ?2)",
                params![old_time - 2.0, 400.0 / (old_time - 2.0)],
            )
            .unwrap();
        add_section_outing(&mut engine, "a2", "same", old_time - 1.0);
        let sections = engine.get_sections_for_activity("a2");
        let prs = section_prs_from(&sections, "a2", |id| engine.get_section_performances(id));
        assert_eq!(prs.count, 1);
        assert_eq!(prs.first_improvement_seconds, Some(1));
    }

    #[test]
    fn an_empty_library_has_no_pooled_highlight() {
        let _serial = serial_global_state();
        let tmp = TempDir::new().unwrap();
        let db = tmp.path().join("notification_pooled_empty.db");
        let db_path = db.to_str().unwrap();
        crate::persistence::read_pool::bind(db_path);
        let engine = PersistentEngine::new(db_path).unwrap();
        assert_eq!(
            resolve_highlight_pooled(&engine.db, "a1", true, false),
            crate::notifications::Highlight::None
        );
    }

    /// The corridor name an athlete gave is resolved from the intent rather
    /// than read off the row, so a pooled ladder that skipped the overlay
    /// would name the section differently in the tray.
    #[test]
    fn the_pooled_highlight_uses_the_name_the_athlete_gave() {
        let _serial = serial_global_state();
        let tmp = TempDir::new().unwrap();
        let mut engine = engine_with_a_section_pr(&tmp);
        let old_time = engine.get_section_performances("s0").records[0].best_time;
        add_section_outing(&mut engine, "a0", "same", old_time + 1.0);
        engine
            .set_section_name("s0", Some("Col de la Forclaz"))
            .unwrap();
        let announced = resolve_highlight_pooled(&engine.db, "a1", true, false);
        assert!(
            format!("{announced:?}").contains("Col de la Forclaz"),
            "the overlay name reaches the tray: {announced:?}"
        );
    }

    #[test]
    fn a_kept_section_pr_is_not_announced_while_route_matching_is_off() {
        let _serial = serial_global_state();
        let tmp = TempDir::new().unwrap();
        let mut engine = engine_with_a_section_pr(&tmp);
        let old_time = engine.get_section_performances("s0").records[0].best_time;
        add_section_outing(&mut engine, "a0", "same", old_time + 1.0);
        assert_ne!(
            resolve_highlight_pooled(&engine.db, "a1", true, false),
            crate::notifications::Highlight::None,
            "the section PR is announced while detection is on"
        );
        engine.set_detection_enabled(false).unwrap();
        assert_eq!(
            resolve_highlight_pooled(&engine.db, "a1", true, false),
            crate::notifications::Highlight::None
        );
    }
}

/// The fitness step a ride caused, found by the engine from its own rows.
mod fitness_milestone {
    use crate::notifications::{Highlight, fitness_milestone_pooled, resolve_highlight_pooled};
    use crate::persistence::PersistentEngine;

    /// 2023-11-14 UTC, the day every ride here is dated.
    const RIDE_DATE: i64 = 1_699_920_000;
    const DAY: i64 = 86_400;

    fn engine_with_rides(rides: &[(&str, &str, i64)]) -> PersistentEngine {
        let mut engine = PersistentEngine::in_memory().unwrap();
        let rows = rides
            .iter()
            .map(|(id, sport, date)| crate::ActivityMetrics {
                activity_id: id.to_string(),
                name: id.to_string(),
                date: *date,
                distance: 1000.0,
                moving_time: 300,
                elapsed_time: 300,
                elevation_gain: 0.0,
                avg_hr: None,
                avg_power: None,
                sport_type: sport.to_string(),
                training_load: None,
                ftp: None,
                power_zone_times: None,
                hr_zone_times: None,
            })
            .collect();
        engine.set_activity_metrics(rows).unwrap();
        engine
    }

    fn day_string(offset: i64) -> String {
        chrono::DateTime::from_timestamp(RIDE_DATE + offset * DAY, 0)
            .unwrap()
            .format("%Y-%m-%d")
            .to_string()
    }

    /// One eFTP per day from `days_before` days before the ride to `days_after`
    /// after it, the value given by `eftp_on(offset)`.
    fn write_eftp(
        engine: &PersistentEngine,
        days_before: i64,
        days_after: i64,
        eftp_on: impl Fn(i64) -> u32,
    ) {
        for offset in -days_before..=days_after {
            let raw = format!(
                r#"{{"sportInfo":[{{"type":"Ride","eftp":{}}}]}}"#,
                eftp_on(offset)
            );
            engine
                .db
                .execute(
                    "INSERT INTO wellness (date, raw) VALUES (?, ?)",
                    rusqlite::params![day_string(offset), raw],
                )
                .unwrap();
        }
    }

    /// Scenario: eFTP sat at 250 W for six weeks and reads 256 W on the day of
    /// the ride, a six watt rise on thirty days earlier.
    ///
    /// Expected behaviour: that ride carries the milestone with the current
    /// figure and the rise, and a ride the next day, with the same rise still
    /// standing, does not announce it a second time.
    #[test]
    fn the_ride_that_crosses_the_ftp_step_carries_it_once() {
        let engine = engine_with_rides(&[
            ("crossing", "Ride", RIDE_DATE + 3_600),
            ("next-day", "Ride", RIDE_DATE + DAY + 3_600),
        ]);
        write_eftp(&engine, 45, 1, |offset| if offset >= 0 { 256 } else { 250 });

        assert_eq!(
            fitness_milestone_pooled(&engine.db, "crossing"),
            Some(Highlight::FtpMilestone {
                current_watts: 256,
                change_watts: 6
            })
        );
        assert_eq!(fitness_milestone_pooled(&engine.db, "next-day"), None);
    }

    #[test]
    fn a_rise_under_the_step_is_not_a_milestone() {
        let engine = engine_with_rides(&[("ride", "Ride", RIDE_DATE + 3_600)]);
        write_eftp(&engine, 45, 0, |offset| if offset >= 0 { 254 } else { 250 });

        assert_eq!(fitness_milestone_pooled(&engine.db, "ride"), None);
    }

    #[test]
    fn a_fall_in_ftp_is_not_a_milestone() {
        let engine = engine_with_rides(&[("ride", "Ride", RIDE_DATE + 3_600)]);
        write_eftp(&engine, 45, 0, |offset| if offset >= 0 { 240 } else { 250 });

        assert_eq!(fitness_milestone_pooled(&engine.db, "ride"), None);
    }

    #[test]
    fn a_run_does_not_carry_the_cycling_step() {
        let engine = engine_with_rides(&[("run", "Run", RIDE_DATE + 3_600)]);
        write_eftp(&engine, 45, 0, |offset| if offset >= 0 { 256 } else { 250 });

        assert_eq!(fitness_milestone_pooled(&engine.db, "run"), None);
    }

    #[test]
    fn an_unknown_activity_has_no_milestone() {
        let engine = engine_with_rides(&[]);
        write_eftp(&engine, 45, 0, |offset| if offset >= 0 { 256 } else { 250 });

        assert_eq!(fitness_milestone_pooled(&engine.db, "missing"), None);
    }

    /// Expected behaviour: the switch gates the milestone in the ladder the
    /// push handlers call, and a ride that crosses nothing keeps the ladder's
    /// other rungs.
    #[test]
    fn the_switch_gates_the_milestone_in_the_ladder() {
        let engine = engine_with_rides(&[("ride", "Ride", RIDE_DATE + 3_600)]);
        write_eftp(&engine, 45, 0, |offset| if offset >= 0 { 256 } else { 250 });

        assert!(matches!(
            resolve_highlight_pooled(&engine.db, "ride", true, true),
            Highlight::FtpMilestone { .. }
        ));
        assert_eq!(
            resolve_highlight_pooled(&engine.db, "ride", true, false),
            Highlight::None
        );
    }

    /// Scenario: the sync's snapshot on the day of a run raised critical
    /// speed from 4.00 to 4.10 m/s, about six seconds off the kilometre.
    ///
    /// Expected behaviour: that run carries the pace milestone with the saving
    /// in seconds per kilometre. A run the next day, with no newer snapshot,
    /// does not, and neither does a run on a day the snapshot got slower.
    #[test]
    fn the_run_on_the_day_of_an_improving_snapshot_carries_the_pace_step() {
        let engine = engine_with_rides(&[
            ("run", "Run", RIDE_DATE + 3_600),
            ("next-day", "Run", RIDE_DATE + DAY + 3_600),
        ]);
        engine.save_pace_snapshot("Run", 4.00, None, None, RIDE_DATE - 7 * DAY, 42);
        engine.save_pace_snapshot("Run", 4.10, None, None, RIDE_DATE + 1_800, 42);

        assert_eq!(
            fitness_milestone_pooled(&engine.db, "run"),
            Some(Highlight::PaceMilestone {
                delta: "6s/km".into()
            })
        );
        assert_eq!(fitness_milestone_pooled(&engine.db, "next-day"), None);
    }

    #[test]
    fn a_slower_snapshot_is_not_a_pace_milestone() {
        let engine = engine_with_rides(&[("run", "Run", RIDE_DATE + 3_600)]);
        engine.save_pace_snapshot("Run", 4.10, None, None, RIDE_DATE - 7 * DAY, 42);
        engine.save_pace_snapshot("Run", 4.00, None, None, RIDE_DATE + 1_800, 42);

        assert_eq!(fitness_milestone_pooled(&engine.db, "run"), None);
    }

    #[test]
    fn a_swim_reports_its_saving_per_hundred_metres() {
        let engine = engine_with_rides(&[("swim", "Swim", RIDE_DATE + 3_600)]);
        engine.save_pace_snapshot("Swim", 1.00, None, None, RIDE_DATE - 7 * DAY, 42);
        engine.save_pace_snapshot("Swim", 1.05, None, None, RIDE_DATE + 1_800, 42);

        assert_eq!(
            fitness_milestone_pooled(&engine.db, "swim"),
            Some(Highlight::PaceMilestone {
                delta: "5s/100m".into()
            })
        );
    }
}
