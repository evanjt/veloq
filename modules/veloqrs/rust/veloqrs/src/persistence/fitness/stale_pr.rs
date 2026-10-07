//! Which sections a fitness gain makes worth revisiting.
//!
//! The selection is over rows, not over the engine, so the engine path and the
//! pooled path answer the same thing from the same code. Only the per-sport
//! read differs, and it is handed in.

use std::collections::HashSet;

/// Per-sport-category fitness improvement used by stale-PR detection.
///
/// `previous` is the athlete's fitness on the day the section record was set,
/// read per section, not a value from a fixed window. The cycling input is
/// intervals.icu's eFTP, an estimate off the power curve, so a rise there is a
/// measurement rather than an edit on the website.
pub(crate) struct FitnessGain {
    pub(crate) metric: &'static str, // "power" | "pace"
    pub(crate) current: f64,
    pub(crate) previous: f64,
    pub(crate) gain_percent: f64,
    pub(crate) unit: &'static str, // "W" | "/km" | "/100m"
}

/// What a sport's fitness is now, before any record is looked at.
///
/// The gain is per section from here, because the value it is measured
/// against is the one on the record's own date.
struct CurrentFitness {
    metric: &'static str,
    unit: &'static str,
    current: f64,
}

fn cycling_now(ftp: &crate::FfiFtpTrend) -> Option<CurrentFitness> {
    let current = ftp.latest_ftp? as f64;
    (current.is_finite() && current > 0.0).then_some(CurrentFitness {
        metric: "power",
        unit: "W",
        current,
    })
}

fn pace_now(pace: &crate::FfiPaceTrend, unit: &'static str) -> Option<CurrentFitness> {
    let current = pace.latest_pace?;
    (current.is_finite() && current > 0.0).then_some(CurrentFitness {
        metric: "pace",
        unit,
        current,
    })
}

/// The gain from the fitness held when the record was set to the fitness now.
fn gain_since(now: &CurrentFitness, then: f64, min_gain_percent: f64) -> Option<FitnessGain> {
    if !then.is_finite() || then <= 0.0 || now.current <= then {
        return None;
    }
    let gain = ((now.current - then) / then) * 100.0;
    if gain < min_gain_percent {
        return None;
    }
    Some(FitnessGain {
        metric: now.metric,
        current: now.current,
        previous: then,
        gain_percent: (gain * 10.0).round() / 10.0,
        unit: now.unit,
    })
}

fn gain_for_sport<'a>(
    sport: &str,
    cycling: Option<&'a CurrentFitness>,
    running: Option<&'a CurrentFitness>,
    swimming: Option<&'a CurrentFitness>,
) -> Option<&'a CurrentFitness> {
    if crate::sport::is_cycling(sport) {
        cycling
    } else if crate::sport::is_running(sport) {
        running
    } else if crate::sport::is_swimming(sport) {
        swimming
    } else {
        None
    }
}

/// What the caller asks for, as scalars rather than as four arguments that
/// have twice been passed in the wrong order.
pub(crate) struct StalePrRequest<'a> {
    pub(crate) stale_threshold_days: u32,
    pub(crate) min_gain_percent: f64,
    pub(crate) max_opportunities: u32,
    /// Fewest traversals a section needs to be offered, so a card never
    /// rests on a section the repetition gate would reject by itself.
    pub(crate) min_traversals: u32,
    /// Sections already carrying a recent record, as (section, exact sport
    /// type). A record in one sport says nothing about the same ground in
    /// another, so only the sport that set it is excluded.
    pub(crate) exclude_section_sports: &'a HashSet<(String, String)>,
    /// Sections excluded in every sport, for a caller that names no sport.
    pub(crate) exclude_sections: &'a HashSet<String>,
}

/// The trends the gains are read off, whichever path read them.
pub(crate) struct StalePrTrends<'a> {
    pub(crate) ftp: &'a crate::FfiFtpTrend,
    pub(crate) run_pace: &'a crate::FfiPaceTrend,
    pub(crate) swim_pace: &'a crate::FfiPaceTrend,
}

/// The sections a fitness gain makes worth revisiting, best-visited first.
///
/// `stale_sections` is the per-sport read, handed in because the engine has it
/// through its own connection and the pooled path through the pool's. Nothing
/// else here touches a database.
pub(crate) fn opportunities(
    trends: &StalePrTrends<'_>,
    sport_types: &[String],
    request: &StalePrRequest<'_>,
    mut stale_sections: impl FnMut(&str) -> Vec<(crate::FfiRankedSection, Option<f64>)>,
    mut fitness_at: impl FnMut(&str, f64) -> Option<f64>,
) -> Vec<crate::FfiStalePrOpportunity> {
    let cycling = cycling_now(trends.ftp);
    let running = pace_now(trends.run_pace, "/km");
    let swimming = pace_now(trends.swim_pace, "/100m");

    if cycling.is_none() && running.is_none() && swimming.is_none() {
        return Vec::new();
    }

    let mut out: Vec<crate::FfiStalePrOpportunity> = Vec::new();
    for sport in sport_types {
        let Some(now) =
            gain_for_sport(sport, cycling.as_ref(), running.as_ref(), swimming.as_ref())
        else {
            continue;
        };

        // Relevance order is discarded below, so a cut by rank would only
        // hide eligible sections: ranking favours recent traversals, the
        // opposite of what staleness selects for. The staleness itself is
        // the cut, and it belongs in the query rather than in this loop,
        // which used to walk every section of every sport to keep a few.
        for (section, best_date) in stale_sections(sport) {
            if request.exclude_sections.contains(&section.section_id)
                || request
                    .exclude_section_sports
                    .contains(&(section.section_id.clone(), sport.clone()))
            {
                continue;
            }
            if section.traversal_count == 0
                || section.traversal_count < request.min_traversals
                || !section.best_time_secs.is_finite()
            {
                continue;
            }
            // The query bounds the latest traversal by a whole number of days
            // back from now; `days_since_last` is a calendar count, so the
            // boundary case is still checked here.
            if section.days_since_last < request.stale_threshold_days {
                continue;
            }
            // The fitness the record was set at, read at the record's own date.
            // No date, or no fitness recorded by then, and the card has nothing
            // to compare: it said "PR set at 250W" about a day the athlete may
            // never have ridden the section.
            let Some(then) = best_date.and_then(|date| fitness_at(sport, date)) else {
                continue;
            };
            let Some(gain) = gain_since(now, then, request.min_gain_percent) else {
                continue;
            };

            out.push(crate::FfiStalePrOpportunity {
                section_id: section.section_id,
                section_name: section.section_name,
                best_time_secs: section.best_time_secs,
                traversal_count: section.traversal_count,
                days_since_last: section.days_since_last,
                fitness_metric: gain.metric.to_string(),
                current_value: gain.current,
                previous_value: gain.previous,
                gain_percent: gain.gain_percent,
                unit: gain.unit.to_string(),
                sport_type: sport.clone(),
                // Straight across from the ranked section this was built from,
                // which already carries them.
                recent_efforts: section.recent_efforts,
                best_activity_id: section.best_activity_id,
            });
        }
    }

    out.sort_by_key(|b| std::cmp::Reverse(b.traversal_count));
    out.truncate(request.max_opportunities as usize);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A day, epoch seconds, so a record's date reads as one in a test.
    fn day(iso: &str) -> f64 {
        chrono::NaiveDate::parse_from_str(iso, "%Y-%m-%d")
            .expect("date")
            .and_hms_opt(0, 0, 0)
            .expect("midnight")
            .and_utc()
            .timestamp() as f64
    }

    fn ranked(
        id: &str,
        days_since_last: u32,
        traversals: u32,
    ) -> (crate::FfiRankedSection, Option<f64>) {
        (
            crate::FfiRankedSection {
                recent_efforts: Vec::new(),
                best_activity_id: None,
                section_id: id.to_string(),
                section_name: id.to_string(),
                relevance_score: 0.0,
                recency_score: 0.0,
                improvement_score: 0.0,
                improvement_change: None,
                improvement_basis: None,
                anomaly_score: 0.0,
                engagement_score: 0.0,
                traversal_count: traversals,
                best_time_secs: 300.0,
                median_recent_secs: 320.0,
                days_since_last,
                trend: 0,
                latest_is_pr: false,
            },
            Some(day("2026-03-01")),
        )
    }

    fn ftp(latest: Option<u16>, previous: Option<u16>) -> crate::FfiFtpTrend {
        crate::FfiFtpTrend {
            changes: Vec::new(),
            history: Vec::new(),
            latest_ftp: latest,
            latest_date: None,
            previous_ftp: previous,
            previous_date: None,
            delta_watts: None,
            sample_count: 0,
        }
    }

    fn flat_pace() -> crate::FfiPaceTrend {
        crate::FfiPaceTrend {
            history: Vec::new(),
            latest_pace: None,
            latest_date: None,
            previous_pace: None,
            previous_date: None,
            gain_percent: None,
            delta_seconds: None,
            glyph: None,
            sample_count: 0,
        }
    }

    fn request<'a>(exclude: &'a std::collections::HashSet<(String, String)>) -> StalePrRequest<'a> {
        static NO_SECTIONS: std::sync::LazyLock<std::collections::HashSet<String>> =
            std::sync::LazyLock::new(std::collections::HashSet::new);
        StalePrRequest {
            stale_threshold_days: 30,
            min_gain_percent: 3.0,
            max_opportunities: 10,
            min_traversals: 2,
            exclude_section_sports: exclude,
            exclude_sections: &NO_SECTIONS,
        }
    }

    fn pair(section: &str, sport: &str) -> (String, String) {
        (section.to_string(), sport.to_string())
    }

    /// Scenario: the screen used to pass the sections already carrying a PR
    /// card, capped at what it surfaces. The engine takes the exclusion off
    /// `recent_prs` instead, which is the whole list.
    ///
    /// Expected behaviour: an excluded section is not offered, whatever its
    /// staleness, and one that is not excluded still is.
    #[test]
    fn an_excluded_section_is_not_offered_and_the_rest_are() {
        let ftp = ftp(Some(285), Some(250));
        let pace = flat_pace();
        let trends = StalePrTrends {
            ftp: &ftp,
            run_pace: &pace,
            swim_pace: &pace,
        };
        let sports = vec!["Ride".to_string()];
        let sections = vec![ranked("kept", 90, 6), ranked("carded", 120, 9)];

        let exclude: std::collections::HashSet<(String, String)> =
            [pair("carded", "Ride")].into_iter().collect();
        let out = opportunities(
            &trends,
            &sports,
            &request(&exclude),
            |_| sections.clone(),
            |_, _| Some(250.0),
        );

        assert_eq!(
            out.iter()
                .map(|o| o.section_id.as_str())
                .collect::<Vec<_>>(),
            vec!["kept"],
        );
        assert_eq!(out[0].sport_type, "Ride", "the card names the sport");
    }

    /// A section inside the staleness window is not stale, whatever the query
    /// answered: the bound is on whole days back and `days_since_last` is a
    /// calendar count.
    #[test]
    fn a_section_visited_inside_the_window_is_not_offered() {
        let ftp = ftp(Some(285), Some(250));
        let pace = flat_pace();
        let trends = StalePrTrends {
            ftp: &ftp,
            run_pace: &pace,
            swim_pace: &pace,
        };
        let sports = vec!["Ride".to_string()];
        let sections = vec![ranked("fresh", 29, 6), ranked("stale", 30, 6)];
        let exclude = std::collections::HashSet::<(String, String)>::new();

        let out = opportunities(
            &trends,
            &sports,
            &request(&exclude),
            |_| sections.clone(),
            |_, _| Some(250.0),
        );

        assert_eq!(
            out.iter()
                .map(|o| o.section_id.as_str())
                .collect::<Vec<_>>(),
            vec!["stale"],
        );
    }

    /// Scenario: a section ridden once beside one ridden eight times. The
    /// thin one would fail the repetition floor as a card of its own and,
    /// grouped, would take the other down with it.
    ///
    /// Expected behaviour: only the section at or above the floor is offered.
    #[test]
    fn a_section_under_the_traversal_floor_is_not_offered() {
        let ftp = ftp(Some(285), Some(250));
        let pace = flat_pace();
        let trends = StalePrTrends {
            ftp: &ftp,
            run_pace: &pace,
            swim_pace: &pace,
        };
        let sports = vec!["Ride".to_string()];
        let sections = vec![ranked("thin", 90, 1), ranked("busy", 90, 8)];
        let exclude = std::collections::HashSet::<(String, String)>::new();

        let out = opportunities(
            &trends,
            &sports,
            &request(&exclude),
            |_| sections.clone(),
            |_, _| Some(250.0),
        );

        assert_eq!(
            out.iter()
                .map(|o| o.section_id.as_str())
                .collect::<Vec<_>>(),
            vec!["busy"],
        );
    }

    /// No gain in any sport is no reads at all: the per-sport query is the
    /// expensive half and there is nothing for it to qualify.
    #[test]
    fn no_fitness_gain_reads_no_sections() {
        let flat_ftp = ftp(None, None);
        let pace = flat_pace();
        let trends = StalePrTrends {
            ftp: &flat_ftp,
            run_pace: &pace,
            swim_pace: &pace,
        };
        let sports = vec!["Ride".to_string()];
        let exclude = std::collections::HashSet::<(String, String)>::new();
        let mut reads = 0;

        let out = opportunities(
            &trends,
            &sports,
            &request(&exclude),
            |_| {
                reads += 1;
                vec![ranked("stale", 90, 6)]
            },
            |_, _| Some(250.0),
        );

        assert!(out.is_empty());
        assert_eq!(reads, 0, "nothing qualifies, so nothing is read");
    }

    fn run_and_ride_trends() -> (crate::FfiFtpTrend, crate::FfiPaceTrend) {
        let mut run = flat_pace();
        run.latest_pace = Some(300.0);
        (ftp(Some(285), Some(250)), run)
    }

    fn offered(
        exclude: &std::collections::HashSet<(String, String)>,
        whole: &std::collections::HashSet<String>,
    ) -> Vec<(String, String)> {
        let (ftp, run) = run_and_ride_trends();
        let swim = flat_pace();
        let trends = StalePrTrends {
            ftp: &ftp,
            run_pace: &run,
            swim_pace: &swim,
        };
        let sports = vec!["Ride".to_string(), "Run".to_string()];
        let mut req = request(exclude);
        req.exclude_sections = whole;
        opportunities(
            &trends,
            &sports,
            &req,
            |_| vec![ranked("cedar_hill", 90, 6)],
            |_, _| Some(250.0),
        )
        .into_iter()
        .map(|o| (o.section_id, o.sport_type))
        .collect()
    }

    /// Scenario: a recent Ride record on Cedar Hill, and an old Run record on
    /// the same ground whose fitness has since improved.
    ///
    /// Expected behaviour: only the Ride is suppressed; the Run is still offered.
    #[test]
    fn a_record_in_one_sport_does_not_exclude_the_same_section_in_another() {
        let none = std::collections::HashSet::new();
        let exclude: std::collections::HashSet<(String, String)> =
            [pair("cedar_hill", "Ride")].into_iter().collect();
        assert_eq!(offered(&exclude, &none), vec![pair("cedar_hill", "Run")]);
    }

    #[test]
    fn an_exclusion_for_another_section_suppresses_neither_sport() {
        let none = std::collections::HashSet::new();
        let exclude: std::collections::HashSet<(String, String)> =
            [pair("elm_row", "Ride")].into_iter().collect();
        assert_eq!(
            offered(&exclude, &none),
            vec![pair("cedar_hill", "Ride"), pair("cedar_hill", "Run")]
        );
        assert_eq!(
            offered(&Default::default(), &none),
            vec![pair("cedar_hill", "Ride"), pair("cedar_hill", "Run")]
        );
    }

    #[test]
    fn a_section_wide_exclusion_suppresses_every_sport() {
        let whole: std::collections::HashSet<String> =
            ["cedar_hill".to_string()].into_iter().collect();
        assert!(offered(&Default::default(), &whole).is_empty());
    }

    fn gain(unit: &'static str) -> CurrentFitness {
        CurrentFitness {
            metric: "power",
            unit,
            current: 1.0,
        }
    }

    /// Scenario: the record was set in March at an eFTP of 230, the athlete is
    /// at 262 now, and thirty days ago they were at 250.
    ///
    /// Expected behaviour: the card is measured from 230, the value on the
    /// record's own day. It used to read "PR set at 250W", a number from a day
    /// the athlete may never have ridden the section.
    #[test]
    fn the_gain_is_measured_from_the_fitness_on_the_records_own_day() {
        let ftp = ftp(Some(262), Some(250));
        let pace = flat_pace();
        let trends = StalePrTrends {
            ftp: &ftp,
            run_pace: &pace,
            swim_pace: &pace,
        };
        let sports = vec!["Ride".to_string()];
        let mut section = ranked("col", 90, 6);
        section.1 = Some(day("2026-03-01"));
        let exclude = std::collections::HashSet::<(String, String)>::new();

        let out = opportunities(
            &trends,
            &sports,
            &request(&exclude),
            |_| vec![section.clone()],
            |sport, at| {
                assert_eq!(sport, "Ride");
                assert_eq!(at, day("2026-03-01"), "read at the record's date");
                Some(230.0)
            },
        );

        assert_eq!(out.len(), 1);
        assert_eq!(out[0].previous_value, 230.0);
        assert_eq!(out[0].current_value, 262.0);
        assert_eq!(out[0].gain_percent, 13.9);
    }

    /// A record set at the fitness the athlete still holds is no opportunity,
    /// however stale the section is. Under the window rule it was offered
    /// whenever the last thirty days had moved.
    #[test]
    fn a_record_set_at_todays_fitness_is_not_offered() {
        let ftp = ftp(Some(262), Some(250));
        let pace = flat_pace();
        let trends = StalePrTrends {
            ftp: &ftp,
            run_pace: &pace,
            swim_pace: &pace,
        };
        let sports = vec!["Ride".to_string()];
        let exclude = std::collections::HashSet::<(String, String)>::new();

        let out = opportunities(
            &trends,
            &sports,
            &request(&exclude),
            |_| vec![ranked("col", 90, 6)],
            |_, _| Some(261.0),
        );

        assert!(out.is_empty(), "a one-watt gain is under the threshold");
    }

    /// Nothing recorded by the record's day, or no date at all, is no card:
    /// there is no honest number to put after "PR set at".
    #[test]
    fn a_record_with_no_fitness_behind_it_is_not_offered() {
        let ftp = ftp(Some(262), Some(250));
        let pace = flat_pace();
        let trends = StalePrTrends {
            ftp: &ftp,
            run_pace: &pace,
            swim_pace: &pace,
        };
        let sports = vec!["Ride".to_string()];
        let exclude = std::collections::HashSet::<(String, String)>::new();
        let mut dateless = ranked("dateless", 90, 6);
        dateless.1 = None;

        let unread = opportunities(
            &trends,
            &sports,
            &request(&exclude),
            |_| vec![dateless.clone()],
            |_, _| Some(200.0),
        );
        assert!(unread.is_empty(), "no date, no comparison");

        let unrecorded = opportunities(
            &trends,
            &sports,
            &request(&exclude),
            |_| vec![ranked("early", 90, 6)],
            |_, _| None,
        );
        assert!(
            unrecorded.is_empty(),
            "no fitness by that day, no comparison"
        );
    }

    // Scenario: an e-bike ride moved the FTP chart and contributed nothing to
    // the fitness gain the chart was meant to explain, because the two lists
    // disagreed on whether it was cycling.
    #[test]
    fn every_cycling_sport_takes_the_cycling_gain() {
        let cycling = gain("W");
        let running = gain("/km");
        let swimming = gain("/100m");
        for sport in crate::sport::CYCLING {
            let got = gain_for_sport(sport, Some(&cycling), Some(&running), Some(&swimming));
            assert_eq!(got.map(|g| g.unit), Some("W"), "{sport}");
        }
        for sport in crate::sport::RUNNING {
            let got = gain_for_sport(sport, Some(&cycling), Some(&running), Some(&swimming));
            assert_eq!(got.map(|g| g.unit), Some("/km"), "{sport}");
        }
        for sport in crate::sport::SWIMMING {
            let got = gain_for_sport(sport, Some(&cycling), Some(&running), Some(&swimming));
            assert_eq!(got.map(|g| g.unit), Some("/100m"), "{sport}");
        }
        assert!(gain_for_sport("Walk", Some(&cycling), Some(&running), Some(&swimming)).is_none());
        assert!(gain_for_sport("", Some(&cycling), Some(&running), Some(&swimming)).is_none());
    }
}
