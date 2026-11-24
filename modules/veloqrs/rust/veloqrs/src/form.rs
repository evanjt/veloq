//! Form, the one owner: its zone edges, the number in the unit the athlete
//! reads it in, the zone that number falls in and the text it prints as.
//!
//! The wellness reads, the summary card and the widget snapshot all state
//! form, and the screens draw what they are handed. A day is judged once here,
//! so two surfaces never name different zones or print different figures for
//! the same loads.
//!
//! Form is rounded fitness less rounded fatigue, so it agrees with the two
//! loads printed beside it. Under the percentage setting it is that over
//! rounded fitness. A day missing a load has no form, and under the
//! percentage setting neither has a day whose fitness rounds to zero, since
//! there is nothing to divide by.

use crate::widget_snapshot::js_round;

/// Where the form zones change, on the intervals.icu TSB boundaries: below the
/// first is high risk, then optimal, grey zone, fresh, and from the last
/// transition. The same four edges serve absolute TSB and a share of fitness.
/// Natives draw the bands from these and never hold a copy.
pub(crate) const FORM_ZONE_BOUNDS: [i32; 4] = [-30, -10, 5, 25];

/// [`FORM_ZONE_BOUNDS`] as the floats the wellness read carries.
pub(crate) const FORM_ZONE_EDGES: [f64; 4] = {
    let [a, b, c, d] = FORM_ZONE_BOUNDS;
    [a as f64, b as f64, c as f64, d as f64]
};

/// One day's form: the number in the athlete's unit, its zone and its text.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct FormReading {
    pub value: f64,
    pub zone: &'static str,
    pub text: String,
}

/// One day's form in the unit the athlete reads it in, with its zone and text.
/// A day missing a load has none, and a percentage needs a fitness to divide
/// by, so a day whose fitness rounds to zero has none under that setting
/// rather than the absolute number beside a zone of another unit.
pub(crate) fn form_reading(
    ctl: Option<f64>,
    atl: Option<f64>,
    as_percent: bool,
) -> Option<FormReading> {
    let value = form_in_unit(ctl, atl, as_percent)?;
    Some(FormReading {
        value,
        zone: zone_of(value),
        text: text_of(value, as_percent),
    })
}

/// One day's form number in the athlete's unit, see [`form_reading`].
pub(crate) fn form_in_unit(ctl: Option<f64>, atl: Option<f64>, as_percent: bool) -> Option<f64> {
    let fitness = ctl.filter(|v| v.is_finite())?.round();
    let fatigue = atl.filter(|v| v.is_finite())?.round();
    let tsb = fitness - fatigue;
    if !as_percent {
        return Some(tsb);
    }
    (fitness != 0.0).then(|| tsb / fitness * 100.0)
}

/// The band a form number in the athlete's unit falls in.
pub(crate) fn zone_of(value: f64) -> &'static str {
    let [high_risk, optimal, grey, fresh] = FORM_ZONE_EDGES;
    if value < high_risk {
        "highRisk"
    } else if value < optimal {
        "optimal"
    } else if value < grey {
        "greyZone"
    } else if value < fresh {
        "fresh"
    } else {
        "transition"
    }
}

/// A form number in the athlete's unit as printed: the whole signed figure,
/// with a percent sign under the percentage setting.
pub(crate) fn text_of(value: f64, as_percent: bool) -> String {
    let n = js_round(value);
    let n = if n == 0.0 { 0.0 } else { n };
    let sign = if n > 0.0 { "+" } else { "" };
    let suffix = if as_percent { "%" } else { "" };
    format!("{sign}{n}{suffix}")
}

/// The band for an already-stated form against its day's fitness, on the
/// denominator the athlete chose. A percentage needs fitness, so a day with
/// none has no zone under that setting.
pub(crate) fn form_zone(tsb: f64, fitness: Option<f64>, as_percent: bool) -> Option<&'static str> {
    in_unit(tsb, fitness, as_percent).map(zone_of)
}

/// The text for an already-stated form against its day's fitness, absent
/// where a percentage has no fitness to divide by.
pub(crate) fn form_text(tsb: f64, fitness: Option<f64>, as_percent: bool) -> Option<String> {
    in_unit(tsb, fitness, as_percent).map(|value| text_of(value, as_percent))
}

fn in_unit(tsb: f64, fitness: Option<f64>, as_percent: bool) -> Option<f64> {
    if !as_percent {
        return Some(tsb);
    }
    let fitness = fitness.filter(|f| *f != 0.0 && !f.is_nan())?;
    Some(tsb / fitness * 100.0)
}

#[cfg(test)]
#[path = "form/tests.rs"]
mod tests;
