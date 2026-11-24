//! Pace text for the speeds a section read carries, written once here so the
//! front end prints the engine's text and works none out.

use crate::widget_snapshot::sport_pace_text;
use crate::{
    CalendarDirectionBest, CalendarSummary, DirectionStats, FfiAttemptHistogram, FfiFocusRange,
    FfiPaceText, FfiSectionChartPoint, FfiSectionPerformanceData, FfiSectionPerformanceResult,
    SectionPerformanceRecord,
};

/// A speed as text for a sport read as a pace, `None` for any other sport.
fn text_of(speed: f64, sport: &str) -> Option<FfiPaceText> {
    sport_pace_text(speed, sport).map(|(metric_text, imperial_text)| FfiPaceText {
        metric_text,
        imperial_text,
    })
}

fn stamp_points(points: &mut [FfiSectionChartPoint], sport: &str) {
    for point in points {
        point.speed_pace = text_of(point.speed, sport);
    }
}

fn stamp_records(records: &mut [SectionPerformanceRecord], sport: &str) {
    for record in records {
        record.best_pace_text = text_of(record.best_pace, sport);
        record.avg_pace_text = text_of(record.avg_pace, sport);
    }
}

fn stamp_record(record: &mut Option<SectionPerformanceRecord>, sport: &str) {
    stamp_records(
        record
            .as_mut()
            .map(std::slice::from_mut)
            .unwrap_or_default(),
        sport,
    );
}

fn stamp_stats(stats: &mut Option<DirectionStats>, sport: &str) {
    if let Some(stats) = stats {
        stats.avg_pace_text = stats.avg_speed.and_then(|speed| text_of(speed, sport));
    }
}

fn stamp_best(best: &mut Option<CalendarDirectionBest>, sport: &str) {
    if let Some(best) = best {
        best.best_pace_text = text_of(best.best_pace, sport);
    }
}

fn stamp_calendar(calendar: &mut CalendarSummary, sport: &str) {
    stamp_best(&mut calendar.forward_pr, sport);
    stamp_best(&mut calendar.reverse_pr, sport);
    for year in &mut calendar.years {
        stamp_best(&mut year.forward, sport);
        stamp_best(&mut year.reverse, sport);
        for month in &mut year.months {
            stamp_best(&mut month.forward, sport);
            stamp_best(&mut month.reverse, sport);
        }
    }
}

fn stamp_performances(performances: &mut FfiSectionPerformanceResult, sport: &str) {
    stamp_records(&mut performances.records, sport);
    stamp_record(&mut performances.best_forward_record, sport);
    stamp_record(&mut performances.best_reverse_record, sport);
    stamp_stats(&mut performances.forward_stats, sport);
    stamp_stats(&mut performances.reverse_stats, sport);
}

fn stamp_focus(focus: &mut Option<FfiFocusRange>, sport: &str) {
    if let Some(range) = focus {
        range.low_pace = text_of(range.low, sport);
        range.mid_pace = text_of((range.low + range.high) / 2.0, sport);
        range.high_pace = text_of(range.high, sport);
    }
}

fn stamp_histogram(histogram: &mut Option<FfiAttemptHistogram>, sport: &str) {
    if let Some(histogram) = histogram {
        histogram.edge_pace = histogram.edge_speeds.as_ref().and_then(|speeds| {
            crate::widget_snapshot::reads_as_pace(sport)
                .then(|| speeds.iter().map(|&speed| text_of(speed, sport)).collect())
        });
    }
}

/// Writes pace text on every speed of a section read, for the sport it
/// answers. A read with no sport, or a sport read as a speed, carries none.
pub(crate) fn stamp_detail(data: &mut FfiSectionPerformanceData) {
    let Some(sport) = data.sport_type.clone() else {
        return;
    };
    stamp_points(&mut data.chart_data.points, &sport);
    stamp_points(&mut data.excluded_points, &sport);
    stamp_performances(&mut data.performances, &sport);
    stamp_records(&mut data.lap_records, &sport);
    stamp_focus(&mut data.scatter_focus.forward, &sport);
    stamp_focus(&mut data.scatter_focus.reverse, &sport);
    stamp_histogram(&mut data.histograms.forward, &sport);
    stamp_histogram(&mut data.histograms.reverse, &sport);
    if let Some(calendar) = &mut data.calendar_summary {
        stamp_calendar(calendar, &sport);
    }
}
