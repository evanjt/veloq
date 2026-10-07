//! Wellness-correlation diagnostics over a Veloq database copy.
//!
//! Runs the section performance read over every section and sport, whole
//! history, and reports per section the attempt count per direction and the
//! state of each wellness variable, then totals. It asserts nothing in CI.
//!
//! The engine opens the file read-write and may migrate it, so point it at a
//! copy, never at the only copy of a library.
//!
//! Usage:
//!   VELOQ_DB=/path/to/copy.db cargo run -p veloqrs --example section_correlation_audit

use std::collections::BTreeMap;

use veloqrs::persistence::PersistentEngine;
use veloqrs::{FfiCorrelation, FfiSectionCorrelation};

#[cfg(test)]
#[path = "tests/section_correlation_audit.rs"]
mod tests;

/// Complete pairs below which no estimate may appear.
const FLOOR: u32 = 10;

fn db_path(value: Option<String>) -> Result<String, &'static str> {
    value
        .filter(|path| !path.is_empty())
        .ok_or("set VELOQ_DB to a copy of a Veloq database")
}

fn state(result: &FfiCorrelation) -> &'static str {
    match result {
        FfiCorrelation::TooFew { .. } => "TooFew",
        FfiCorrelation::Undefined { .. } => "Undefined",
        FfiCorrelation::Inconclusive { .. } => "Inconclusive",
        FfiCorrelation::Mover { .. } => "Mover",
    }
}

fn pairs(result: &FfiCorrelation) -> u32 {
    match result {
        FfiCorrelation::TooFew { n }
        | FfiCorrelation::Undefined { n }
        | FfiCorrelation::Inconclusive { n, .. }
        | FfiCorrelation::Mover { n, .. } => *n,
    }
}

/// Every way a correlation breaks the panel's rules: an estimate on fewer
/// pairs than the floor, a `Mover` whose interval holds zero, an
/// `Inconclusive` whose interval excludes it.
fn violations(correlations: &[FfiSectionCorrelation]) -> Vec<String> {
    let mut out = Vec::new();
    for c in correlations {
        let label = format!("{}/{}", c.direction, c.variable);
        match &c.result {
            FfiCorrelation::Mover { n, low, high, .. } => {
                if *n < FLOOR {
                    out.push(format!("{label}: Mover on {n} pairs"));
                }
                if *low <= 0.0 && *high >= 0.0 {
                    out.push(format!("{label}: Mover interval spans zero"));
                }
            }
            FfiCorrelation::Inconclusive { n, low, high, .. } => {
                if *n < FLOOR {
                    out.push(format!("{label}: Inconclusive on {n} pairs"));
                }
                if !(*low <= 0.0 && *high >= 0.0) {
                    out.push(format!("{label}: Inconclusive interval excludes zero"));
                }
            }
            FfiCorrelation::TooFew { .. } | FfiCorrelation::Undefined { .. } => {}
        }
    }
    out
}

#[derive(Default)]
struct Totals {
    reads: usize,
    any_mover: usize,
    any_inconclusive: usize,
    only_unshown: usize,
    no_variable: usize,
    pairs_per_variable: BTreeMap<String, Vec<u32>>,
    violations: Vec<String>,
}

impl Totals {
    fn add(&mut self, label: &str, correlations: &[FfiSectionCorrelation]) {
        self.reads += 1;
        let has = |name: &str| correlations.iter().any(|c| state(&c.result) == name);
        if correlations.is_empty() {
            self.no_variable += 1;
        } else if has("Mover") {
            self.any_mover += 1;
        } else if has("Inconclusive") {
            self.any_inconclusive += 1;
        } else {
            self.only_unshown += 1;
        }
        for c in correlations {
            self.pairs_per_variable
                .entry(c.variable.clone())
                .or_default()
                .push(pairs(&c.result));
        }
        self.violations.extend(
            violations(correlations)
                .into_iter()
                .map(|v| format!("{label} {v}")),
        );
    }
}

fn main() {
    let path = match db_path(std::env::var("VELOQ_DB").ok()) {
        Ok(path) if std::path::Path::new(&path).exists() => path,
        Ok(path) => return eprintln!("{path} not found"),
        Err(error) => return eprintln!("{error}"),
    };
    let engine = PersistentEngine::new(&path).expect("open DB");
    let mut totals = Totals::default();

    for (index, section) in engine.get_section_summaries().iter().enumerate() {
        for sport in &section.sport_types {
            let data = engine.section_detail_performance(&section.id, 0, Some(sport));
            let label = format!("section {index} {sport}");
            let cell = |direction: &str| {
                data.chart_data
                    .points
                    .iter()
                    .filter(|p| p.direction == direction)
                    .map(|p| p.activity_id.as_str())
                    .collect::<std::collections::BTreeSet<_>>()
                    .len()
            };
            let states: Vec<String> = data
                .correlations
                .iter()
                .map(|c| {
                    format!(
                        "{}/{}={}({})",
                        c.direction,
                        c.variable,
                        state(&c.result),
                        pairs(&c.result)
                    )
                })
                .collect();
            println!(
                "{label}: attempts same={} reverse={} {}",
                cell("same"),
                cell("reverse"),
                states.join(" ")
            );
            totals.add(&label, &data.correlations);
        }
    }

    println!("\nsection reads: {}", totals.reads);
    println!("with a Mover: {}", totals.any_mover);
    println!(
        "with an Inconclusive and no Mover: {}",
        totals.any_inconclusive
    );
    println!("only TooFew or Undefined: {}", totals.only_unshown);
    println!("no variable recorded: {}", totals.no_variable);
    for (variable, mut ns) in totals.pairs_per_variable {
        ns.sort_unstable();
        println!(
            "n per {variable}: count {} min {} median {} max {}",
            ns.len(),
            ns[0],
            ns[ns.len() / 2],
            ns[ns.len() - 1]
        );
    }
    println!("invariant violations: {}", totals.violations.len());
    for v in &totals.violations {
        println!("  {v}");
    }
}
