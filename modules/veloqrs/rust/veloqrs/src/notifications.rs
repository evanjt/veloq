//! What one activity was worth, as a sentence, built where both a native push
//! handler and JavaScript can reach it.
//!
//! The ladder and the two renderings used to be TypeScript
//! (`src/features/insights/lib/activityHighlight.ts` and
//! `activityNotificationBody.ts`). A push handler that runs with no JavaScript
//! can fetch and index an activity and then had nothing to turn that into a
//! line for the tray, and porting the ladder to Kotlin would have left iOS to
//! port it again to Swift.
//!
//! The templates stay in TypeScript, where every other string in the app
//! lives. JavaScript pushes the resolved bundle for the current locale into
//! the engine on launch and on a locale change, and a handler reads whatever
//! was last pushed. The strings are persisted rather than held in
//! memory because the handler that needs them most is the one that cold-starts
//! the process, with no JavaScript in it to push anything.

use crate::persistence::settings::NotificationTemplates;

/// Roughly what an Android lock screen shows of a body before it collapses the
/// line. iOS is more generous, around four lines, but truncates mid-word with
/// no ellipsis, so one cap serves both.
pub const NOTIFICATION_BODY_MAX: usize = 60;

/// A route or section name inside a detail clause.
const MAX_PLACE_NAME: usize = 24;

/// Below this there is no room for a name, only for a fragment of one, so the
/// activity name is dropped instead.
const MIN_NAME_TAIL: usize = 8;

/// Below this a place name is a fragment rather than a name, so the template
/// gets what is left and the cap does the rest.
const MIN_PLACE_NAME: usize = 6;

const SEPARATOR: &str = " - ";

/// The seventeen templates a sentence is built from, taken off whatever the last
/// push stored.
///
/// A struct rather than the stored map: a rung that reaches for a key the
/// bundle has not got is a compile error here instead of a dotted path on a
/// lock screen. `from_stored` is the one place the two shapes meet.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Templates {
    pub title_pr: String,
    pub title_faster: String,
    pub title_recorded: String,
    pub a_section: String,
    pub route_pr: String,
    pub route_pr_delta: String,
    pub route_pr_unnamed: String,
    pub route_pr_unnamed_delta: String,
    pub section_pr: String,
    pub section_pr_delta: String,
    pub section_pr_count: String,
    pub section_pr_many: String,
    /// The count-of-one form of `section_pr_many`, for languages whose plural clause is wrong at 1.
    pub section_pr_many_one: String,
    pub faster_on_route: String,
    pub faster_on_route_delta: String,
    /// `{{current}}` watts and `{{change}}` watts gained.
    pub ftp_milestone: String,
    /// `{{delta}}`, already carrying its unit.
    pub pace_milestone: String,
}

/// The enriched notification for one activity, and the same finding whole.
///
/// A screen has room the lock screen does not and must say the same thing, so
/// one ladder and one set of templates answer both: `body` is capped and gives
/// the place name back until the clause fits, `sentence` gives up nothing.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct FfiActivityNotification {
    /// `pr`, `faster` or `recorded`: which rung won, and so which title.
    pub tier: String,
    pub title: String,
    /// Empty when the ladder found nothing worth a push. That is how the tray
    /// decision takes the generic entry down rather than reposting the ride
    /// back at the athlete.
    pub body: String,
    /// The finding with no name given up to the cap, `None` for `none`.
    pub sentence: Option<String>,
}

/// Which rung the finding came from, and so which title goes with it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tier {
    Pr,
    Faster,
    Recorded,
}

impl Tier {
    fn as_str(self) -> &'static str {
        match self {
            Tier::Pr => "pr",
            Tier::Faster => "faster",
            Tier::Recorded => "recorded",
        }
    }

    fn title(self, strings: &Templates) -> String {
        match self {
            Tier::Pr => strings.title_pr.clone(),
            Tier::Faster => strings.title_faster.clone(),
            Tier::Recorded => strings.title_recorded.clone(),
        }
    }
}

/// One rung's finding. Every seconds field is a real comparison or `None`: a
/// claim the engine could not support is absent rather than zero.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Highlight {
    /// A personal best over a matched route the athlete has named.
    RoutePr {
        route_name: String,
        improvement_seconds: Option<u32>,
    },
    /// A personal best over one section. `named` is false for an unnamed one.
    SectionPr {
        section_name: String,
        named: bool,
        improvement_seconds: Option<u32>,
    },
    /// Personal bests over several sections at once.
    SectionPrMany {
        section_name: String,
        named: bool,
        count: u32,
    },
    /// A personal best over a route with no name to show.
    RoutePrUnnamed { improvement_seconds: Option<u32> },
    /// Faster than the running average of prior traversals. `gap_seconds` is
    /// the gap still to close on the all-time best, never an improvement on it.
    FasterOnRoute {
        route_name: String,
        gap_seconds: Option<u32>,
    },
    /// The athlete's FTP crossed the milestone step on the day of this ride.
    FtpMilestone {
        current_watts: u16,
        change_watts: u32,
    },
    /// The athlete's critical pace improved on the day of this ride. `delta`
    /// is the saving with its unit, such as `12s/km`.
    PaceMilestone { delta: String },
    /// Nothing worth a push, so there is no notification.
    None,
}

impl Highlight {
    fn tier(&self) -> Tier {
        match self {
            Highlight::RoutePr { .. }
            | Highlight::SectionPr { .. }
            | Highlight::SectionPrMany { .. }
            | Highlight::RoutePrUnnamed { .. } => Tier::Pr,
            Highlight::FasterOnRoute { .. } => Tier::Faster,
            Highlight::FtpMilestone { .. } | Highlight::PaceMilestone { .. } | Highlight::None => {
                Tier::Recorded
            }
        }
    }
}

// ============================================================================
// Rendering
// ============================================================================

/// What JavaScript's `String.prototype.length` counts, which is what every
/// cap here was sized against. A name with an emoji in it is two units per
/// emoji to `.length` and one `char` to Rust, and the two renderings have to
/// cut in the same place or the screen and the lock screen disagree.
fn units(value: &str) -> usize {
    value.chars().map(char::len_utf16).sum()
}

/// Trim to `max` units, marking the cut, so a name never runs off the end
/// silently.
fn trim(value: &str, max: usize) -> String {
    if units(value) <= max {
        return value.to_string();
    }
    // `max - 1` leaves room for the ellipsis. A cut that would land inside a
    // surrogate pair takes the whole character rather than half of one.
    let mut taken = 0usize;
    let mut out = String::new();
    for c in value.chars() {
        let next = taken + c.len_utf16();
        if next > max.saturating_sub(1) {
            break;
        }
        out.push(c);
        taken = next;
    }
    format!("{}\u{2026}", out.trim_end())
}

/// Substitute `{{name}}`, `{{delta}}` and `{{count}}` into a template.
///
/// The bundles carry no plural suffixes, checked across all seventeen: every
/// count template is one flat string, so i18next's plural resolution is not
/// something this has to reproduce.
fn interpolate(template: &str, params: &[(&str, &str)]) -> String {
    let mut out = template.to_string();
    for (key, value) in params {
        out = out.replace(&format!("{{{{{key}}}}}"), value);
    }
    out
}

/// A detail clause that fits, by giving the place name back to the template
/// until it does.
///
/// `MAX_PLACE_NAME` was sized against the English templates, and a translated
/// one is longer: "Faster than usual on X (2:34 off PR)" is 56 characters in
/// English and 72 in Portuguese, so the clause cleared the cap on its own with
/// no name left to give and the lock screen dropped the delta. The delta is
/// the finding, so the name yields to it, and the clause is only cut outright
/// when there is no name left to take.
fn fit_detail(render: impl Fn(&str) -> String, raw_name: &str) -> String {
    let mut cap = MAX_PLACE_NAME;
    let mut out = render(&trim(raw_name, cap));
    while units(&out) > NOTIFICATION_BODY_MAX && cap > MIN_PLACE_NAME {
        cap = MIN_PLACE_NAME.max(cap.saturating_sub(units(&out) - NOTIFICATION_BODY_MAX));
        out = render(&trim(raw_name, cap));
    }
    out
}

/// The finding whole: the full place name and no cap.
fn whole(render: impl Fn(&str) -> String, raw_name: &str) -> String {
    render(raw_name)
}

/// The finding first, the activity name second.
///
/// The name used to lead, so a long one plus a user-renamed route pushed the
/// PR and its delta past the collapse, and the athlete saw only what they had
/// just uploaded. The detail is never truncated: it is the only reason the
/// enrichment pipeline exists. The name gives way, and is dropped outright
/// when what is left of it would be a fragment.
fn compose(detail: &str, activity_name: &str) -> String {
    // No name means no activity to describe: the ingest failed and the only
    // string available used to be the notification's own title.
    if activity_name.is_empty() {
        return detail.to_string();
    }
    let room = NOTIFICATION_BODY_MAX
        .saturating_sub(units(detail))
        .saturating_sub(units(SEPARATOR));
    if room < MIN_NAME_TAIL {
        return detail.to_string();
    }
    format!("{detail}{SEPARATOR}{}", trim(activity_name, room))
}

/// Format a time difference compactly: "12s" under a minute, "1:05" at or
/// above. Unsigned; the surrounding wording carries direction.
fn format_duration_delta(seconds: u32) -> String {
    if seconds < 60 {
        return format!("{seconds}s");
    }
    let hours = seconds / 3600;
    let minutes = (seconds % 3600) / 60;
    let secs = seconds % 60;
    if hours > 0 {
        format!("{hours}:{minutes:02}:{secs:02}")
    } else {
        format!("{minutes}:{secs:02}")
    }
}

/// An unnamed section reads as "a section" rather than as an empty name.
fn section_place<'a>(name: &'a str, named: bool, strings: &'a Templates) -> &'a str {
    if named { name } else { &strings.a_section }
}

fn render(
    highlight: &Highlight,
    strings: &Templates,
    fit: impl Fn(&dyn Fn(&str) -> String, &str) -> String,
) -> Option<String> {
    match highlight {
        Highlight::RoutePr {
            route_name,
            improvement_seconds,
        } => Some(fit(
            &|place| match improvement_seconds {
                Some(delta) => interpolate(
                    &strings.route_pr_delta,
                    &[("name", place), ("delta", &format_duration_delta(*delta))],
                ),
                None => interpolate(&strings.route_pr, &[("name", place)]),
            },
            route_name,
        )),
        Highlight::SectionPr {
            section_name,
            named,
            improvement_seconds,
        } => Some(fit(
            &|place| match improvement_seconds {
                Some(delta) => interpolate(
                    &strings.section_pr_delta,
                    &[("name", place), ("delta", &format_duration_delta(*delta))],
                ),
                None => interpolate(&strings.section_pr, &[("name", place)]),
            },
            section_place(section_name, *named, strings),
        )),
        Highlight::SectionPrMany {
            section_name,
            named,
            count,
        } => Some(if *named {
            let rest = count - 1;
            fit(
                &|place| {
                    if rest == 1 {
                        interpolate(&strings.section_pr_many_one, &[("name", place)])
                    } else {
                        interpolate(
                            &strings.section_pr_many,
                            &[("name", place), ("count", &rest.to_string())],
                        )
                    }
                },
                section_name,
            )
        } else {
            interpolate(&strings.section_pr_count, &[("count", &count.to_string())])
        }),
        Highlight::RoutePrUnnamed {
            improvement_seconds,
        } => Some(match improvement_seconds {
            Some(delta) => interpolate(
                &strings.route_pr_unnamed_delta,
                &[("delta", &format_duration_delta(*delta))],
            ),
            None => strings.route_pr_unnamed.clone(),
        }),
        Highlight::FasterOnRoute {
            route_name,
            gap_seconds,
        } => Some(fit(
            &|place| match gap_seconds {
                Some(delta) => interpolate(
                    &strings.faster_on_route_delta,
                    &[("name", place), ("delta", &format_duration_delta(*delta))],
                ),
                None => interpolate(&strings.faster_on_route, &[("name", place)]),
            },
            route_name,
        )),
        Highlight::FtpMilestone {
            current_watts,
            change_watts,
        } => Some(interpolate(
            &strings.ftp_milestone,
            &[
                ("current", &current_watts.to_string()),
                ("change", &change_watts.to_string()),
            ],
        )),
        Highlight::PaceMilestone { delta } => {
            Some(interpolate(&strings.pace_milestone, &[("delta", delta)]))
        }
        Highlight::None => None,
    }
}

/// The finding as a lock-screen clause, or `None` when there is nothing to say.
pub fn highlight_detail(highlight: &Highlight, strings: &Templates) -> Option<String> {
    render(highlight, strings, |r, name| fit_detail(r, name))
}

/// The same finding with nothing given up, for a screen.
pub fn highlight_sentence(highlight: &Highlight, strings: &Templates) -> Option<String> {
    render(highlight, strings, |r, name| whole(r, name))
}

/// Build the notification for a resolved finding: title, capped body, and the
/// sentence whole.
pub fn notification_for(
    highlight: &Highlight,
    activity_name: &str,
    strings: &Templates,
) -> FfiActivityNotification {
    let tier = highlight.tier();
    // The cap binds on what is posted, not on the name alone. A clause with no
    // name left to give up is cut here rather than by the lock screen.
    let clause = highlight_detail(highlight, strings).map(|d| trim(&d, NOTIFICATION_BODY_MAX));
    FfiActivityNotification {
        tier: tier.as_str().to_string(),
        title: tier.title(strings),
        body: clause
            .map(|c| compose(&c, activity_name))
            .unwrap_or_default(),
        sentence: highlight_sentence(highlight, strings),
    }
}

// ============================================================================
// The ladder
// ============================================================================

/// Seconds this activity's section PR improved on another outing in its direction.
fn section_pr_delta(
    result: &crate::types::SectionPerformanceResult,
    activity_id: &str,
) -> Option<u32> {
    for best in [
        result.best_forward_record.as_ref(),
        result.best_reverse_record.as_ref(),
    ]
    .into_iter()
    .flatten()
    {
        if best.activity_id != activity_id {
            continue;
        }
        let rival = crate::persistence::records::section_record_rival(result, best);
        if crate::persistence::records::is_personal_record(best.best_time, rival) {
            return rival.map(|time| (time - best.best_time) as u32);
        }
    }
    None
}

/// What the section performance queries came back with, reduced to what the
/// ladder asks of them: how many of this activity's sections it holds the best
/// time on, and which one is named first.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SectionPrs {
    pub count: u32,
    pub first_name: String,
    pub first_named: bool,
    pub first_improvement_seconds: Option<u32>,
}

/// Walk the priority ladder, over what the engine answered rather than over
/// the engine.
///
/// A route PR, then a section PR, then a multi-section PR, then an unnamed
/// route PR, then faster than usual, then a known route, then a fitness
/// milestone. There is no floor rung: a distance-and-time line tells the
/// athlete what they already know they did, and it fired on every activity, so
/// an athlete who commutes five days a week got five pushes worth nothing.
///
/// `milestone` is the fitness step this activity caused, if any, found by
/// [`fitness_milestone_pooled`] from the engine's own rows.
pub fn pick_highlight(
    route: Option<&crate::FfiActivityRouteHighlight>,
    sections: &SectionPrs,
    announce_prs: bool,
    milestone: Option<Highlight>,
) -> Highlight {
    // Achievements first, gated by the PR category preference, then the
    // matched-route identity, then plain traversal counts.
    if announce_prs {
        if let Some(r) = route.filter(|r| r.is_pr && !r.route_name.is_empty()) {
            return Highlight::RoutePr {
                route_name: r.route_name.clone(),
                improvement_seconds: r.pr_improvement_seconds.filter(|s| *s > 0),
            };
        }
        if sections.count == 1 {
            return Highlight::SectionPr {
                section_name: sections.first_name.clone(),
                named: sections.first_named,
                improvement_seconds: sections.first_improvement_seconds,
            };
        }
        if sections.count > 1 {
            return Highlight::SectionPrMany {
                section_name: sections.first_name.clone(),
                named: sections.first_named,
                count: sections.count,
            };
        }
        if let Some(r) = route.filter(|r| r.is_pr) {
            return Highlight::RoutePrUnnamed {
                improvement_seconds: r.pr_improvement_seconds.filter(|s| *s > 0),
            };
        }
    }

    if let Some(r) = route.filter(|r| r.trend > 0 && !r.route_name.is_empty()) {
        return Highlight::FasterOnRoute {
            route_name: r.route_name.clone(),
            gap_seconds: r.time_delta_seconds.filter(|s| *s > 0).map(|s| s as u32),
        };
    }
    // A named route with no verdict on the time, and riding through a section,
    // are not results. Only notable rides notify, so this stops here rather
    // than announcing that the ride happened.

    milestone.unwrap_or(Highlight::None)
}

/// The smallest FTP step, in watts, that is a milestone.
const MIN_FTP_STEP_WATTS: i32 = 5;

/// The fitness step an activity caused, read from committed rows.
///
/// A step is the activity's own: FTP counts only on the ride whose day first
/// carries a thirty day rise of [`MIN_FTP_STEP_WATTS`] or more, judged by the
/// trend as it stood that day against the day before, and pace only on the
/// ride whose day holds the snapshot that improved it. A later ride sees the
/// same standing step and finds no crossing, so one step is announced once.
/// FTP is judged for cycling, running pace for runs and swim pace for swims.
pub fn fitness_milestone_pooled(
    conn: &rusqlite::Connection,
    activity_id: &str,
) -> Option<Highlight> {
    use crate::persistence::fitness::derivations::pooled as fitness;
    let (sport, date): (String, i64) = conn
        .query_row(
            "SELECT sport_type, date FROM activity_metrics WHERE activity_id = ?",
            [activity_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok()?;
    let day = chrono::DateTime::from_timestamp(date, 0)?.date_naive();

    if crate::sport::is_cycling(&sport) {
        let on = fitness::ftp_trend_to(conn, &day.format("%Y-%m-%d").to_string());
        let before = fitness::ftp_trend_to(
            conn,
            &(day - chrono::Duration::days(1))
                .format("%Y-%m-%d")
                .to_string(),
        );
        let step = on.delta_watts.filter(|d| *d >= MIN_FTP_STEP_WATTS)?;
        let standing = before.delta_watts.is_some_and(|d| d >= MIN_FTP_STEP_WATTS);
        if standing {
            return None;
        }
        return Some(Highlight::FtpMilestone {
            current_watts: on.latest_ftp?,
            change_watts: step as u32,
        });
    }

    let (family, unit) = if crate::sport::is_running(&sport) {
        ("Run", "s/km")
    } else if crate::sport::is_swimming(&sport) {
        ("Swim", "s/100m")
    } else {
        return None;
    };
    let day_start = day.and_hms_opt(0, 0, 0)?.and_utc().timestamp();
    let trend = fitness::pace_trend_through(conn, family, day_start + 86_399);
    let snapshot = trend.latest_date? as i64;
    if snapshot < day_start {
        return None;
    }
    let seconds = trend.delta_seconds?.round() as i64;
    let percent = trend.gain_percent?.round() as i64;
    (seconds > 0 && percent > 0).then(|| Highlight::PaceMilestone {
        delta: format!("{seconds}{unit}"),
    })
}

/// What this activity did on every section it matched.
///
/// Takes the sections and a way to ask for one section's performances, so the
/// same walk serves a lock holder and a pooled reader and the two cannot
/// drift apart.
fn section_prs_from(
    sections: &[crate::sections::Section],
    activity_id: &str,
    mut performances: impl FnMut(&str) -> crate::types::SectionPerformanceResult,
) -> SectionPrs {
    let mut prs = SectionPrs::default();
    let mut first = true;
    for section in sections {
        let perf = performances(&section.id);
        let Some(improvement) = section_pr_delta(&perf, activity_id) else {
            continue;
        };
        prs.count += 1;
        if first {
            first = false;
            let name = section.name.clone().unwrap_or_default();
            prs.first_named = !name.is_empty();
            prs.first_name = name;
            prs.first_improvement_seconds = Some(improvement);
        }
    }
    prs
}

fn detection_enabled_from(conn: &rusqlite::Connection) -> bool {
    !matches!(
        crate::persistence::settings::setting_from(
            conn,
            crate::persistence::settings::settings_keys::DETECTION_ENABLED
        )
        .ok()
        .flatten()
        .as_deref(),
        Some("0")
    )
}

/// The notification highlight, read from committed SQLite rows.
///
/// A push can arrive while a sync page commits. Every read uses committed rows
/// so the handler does not wait for the engine lock.
pub fn resolve_highlight_pooled(
    conn: &rusqlite::Connection,
    activity_id: &str,
    announce_prs: bool,
    announce_milestones: bool,
) -> Highlight {
    let milestone = announce_milestones
        .then(|| fitness_milestone_pooled(conn, activity_id))
        .flatten();
    // Route matching off means no route or section rung: a section the athlete
    // kept would otherwise still announce itself for a feature they switched off.
    if !detection_enabled_from(conn) {
        return pick_highlight(None, &SectionPrs::default(), announce_prs, milestone);
    }
    let ids = [activity_id.to_string()];
    let route = crate::persistence::fitness::derivations::pooled::route_highlights(conn, &ids)
        .into_iter()
        .find(|h| h.activity_id == activity_id);
    let names = crate::persistence::sections::named::pooled::overlay_names(conn);
    let sections = crate::persistence::sections::queries::pooled::sections_for_activity(
        conn,
        activity_id,
        &names,
    );
    let sport = crate::persistence::sections::queries::pooled::sport_of_activity(conn, activity_id);
    let prs = section_prs_from(&sections, activity_id, |id| {
        crate::persistence::fitness::performances::pooled::section_performances(
            conn,
            id,
            sport.as_deref(),
        )
    });
    pick_highlight(route.as_ref(), &prs, announce_prs, milestone)
}

/// The templates the last push stored, as the renderer wants them.
///
/// `None` when a key is missing, which is a bundle written by an older or
/// newer push site rather than anything a lock screen should be shown. The
/// caller posts nothing, and the generic tray entry stands.
/// The key of the plain "an activity arrived" title.
///
/// Named because the push fallback reaches for it on its own: when the ladder
/// produced no sentence there is still an entry to post, and this is the only
/// string in the bundle that says so without claiming anything.
pub const RECORDED_TITLE_KEY: &str = "notifications.activityRecorded.title";

pub fn templates_from_stored(stored: &NotificationTemplates) -> Option<Templates> {
    let at = |key: &str| stored.templates.get(key).cloned();
    Some(Templates {
        title_pr: at("notifications.activityPr.title")?,
        title_faster: at("notifications.activityFaster.title")?,
        title_recorded: at(RECORDED_TITLE_KEY)?,
        a_section: at("notifications.activityBody.aSection")?,
        route_pr: at("notifications.activityBody.routePr")?,
        route_pr_delta: at("notifications.activityBody.routePrDelta")?,
        route_pr_unnamed: at("notifications.activityBody.routePrUnnamed")?,
        route_pr_unnamed_delta: at("notifications.activityBody.routePrUnnamedDelta")?,
        section_pr: at("notifications.activityBody.sectionPr")?,
        section_pr_delta: at("notifications.activityBody.sectionPrDelta")?,
        section_pr_count: at("notifications.activityBody.sectionPrCount")?,
        section_pr_many: at("notifications.activityBody.sectionPrMany")?,
        section_pr_many_one: at("notifications.activityBody.sectionPrManyOne")?,
        faster_on_route: at("notifications.activityBody.fasterOnRoute")?,
        faster_on_route_delta: at("notifications.activityBody.fasterOnRouteDelta")?,
        ftp_milestone: at("insights.ftpIncrease")?,
        pace_milestone: at("insights.paceImproved")?,
    })
}

/// The whole path from SQLite alone, for a push handler that must not wait.
pub fn build_notification_pooled(
    conn: &rusqlite::Connection,
    activity_id: &str,
    activity_name: &str,
    announce_prs: bool,
    announce_milestones: bool,
) -> Option<FfiActivityNotification> {
    let stored = crate::persistence::settings::notification_templates_from(conn).ok()??;
    let strings = templates_from_stored(&stored)?;
    let highlight = resolve_highlight_pooled(conn, activity_id, announce_prs, announce_milestones);
    Some(notification_for(&highlight, activity_name, &strings))
}

#[cfg(test)]
mod tests;
