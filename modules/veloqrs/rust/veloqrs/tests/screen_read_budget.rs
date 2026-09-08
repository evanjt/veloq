//! Every screen-level engine read stays flat as the library grows.
//!
//! Five of the crate's 287 exports return a Promise. Every other engine call
//! blocks the JavaScript thread for its whole duration, so a read that turns
//! into a whole-catalogue scan does not fail, it drops frames, and nothing says
//! so. One such read was found by reading the code, because nothing was
//! watching: an overlap computed in a loop over every auto section.
//!
//! Measured on an S22 against a real 490-activity library, the worst of these
//! is 27.8 ms, inside the 100 ms a tab mount allows. This keeps that true.
//!
//! **Why a ratio and not a stopwatch.** A wall-clock budget has to carry an
//! order of magnitude of headroom to survive a contended box, and headroom that
//! large catches nothing: the same reads take 0.02 to 0.4 ms here against
//! budgets that would have to sit in the hundreds. So the assertion is about
//! **growth**. The library is built at one size and again at three times that,
//! and a read that is indexed costs about the same on both. One that has become
//! linear in the catalogue costs three times as much, and a loop over sections
//! inside a loop over activities costs nine.
//!
//! That is machine-independent, which a stopwatch is not, and it is the
//! property that actually matters. It does not catch a slow creep, and it is
//! not meant to.
//!
//! **Both classes were injected and it failed on both.** A per-pair query
//! inside `get_section_summaries` measures 9.0x. One indexed query per activity
//! inside `startup_data`, a flat read turning linear, measures 2.7x against its
//! 2.5x ceiling. A blanket ceiling loose enough for the catalogue read would
//! have missed the second, which is why the ceilings are per read.
//!
//! **The ratio is only honest if both sides pay the same load.** The suite
//! failed here on 2026-09-08 with the fleet running and the dependencies newly
//! optimised. Neither was the cause: the binary passes alone under that profile
//! and passes inside the full 32-process nextest run on a quiet box. What tips
//! it is a burst of load that covers one side's samples and not the other's, so
//! the sides are now interleaved and the minimum is taken per round.
//!
//! Run: `cargo test --test screen_read_budget -p veloqrs`

use std::time::{Duration, Instant};

use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::sections::CreateSectionParams;
use veloqrs::{FfiInsightsParams, FfiTimestampRange, PersistentEngine};

const SMALL: usize = 60;
const LARGE: usize = 180;
/// One section per this many activities, so the catalogue grows with the
/// library the way a real one does.
const ACTIVITIES_PER_SECTION: usize = 4;

const POINTS_PER_TRACK: usize = 100;
const DAY: i64 = 86_400;
const NOW: i64 = 1_757_000_000;

/// How much dearer a read may get for three times the library.
///
/// One is flat, three is linear in the catalogue and nine is a per-pair query
/// inside the read. The ceiling is per read because they do
/// not all promise the same thing, and a single number would have to sit above
/// the loosest and would then catch nothing on the rest.
///
/// **Flat** is a read that pages, windows or looks up: what it returns does not
/// grow with the library, so neither should its cost. Measured at 1.0x to 1.6x,
/// and the ceiling leaves room for a contended box without leaving room for a
/// scan, which would be 3x.
const FLAT: f64 = 2.5;

/// **Linear** is a read that returns a row per catalogue entry and is meant to.
/// `get_section_summaries` is the whole visible catalogue by contract, measured
/// at 2.1x. It cannot be held to `FLAT`, and it is still held: a per-pair query
/// inside it measures 9.0x.
const LINEAR: f64 = 4.5;

/// Below this a measurement is timer noise and its ratio means nothing, so the
/// pair is reported and not asserted on. Every read here is genuinely this
/// cheap on a quiet box, which is the point, but a read that grows out of the
/// floor is caught the moment it does.
const NOISE_FLOOR: Duration = Duration::from_micros(150);

/// A ~1 km line, each activity in its own place so the bins do not collapse
/// into one and the sections have distinguishable ground.
fn track(seed: usize) -> Vec<GpsPoint> {
    let base_lat = 46.0 + (seed % 20) as f64 * 0.05;
    let base_lng = 7.0 + (seed / 20) as f64 * 0.05;
    (0..POINTS_PER_TRACK)
        .map(|i| GpsPoint {
            latitude: base_lat + i as f64 * 0.0001,
            longitude: base_lng,
            elevation: Some(500.0 + i as f64),
        })
        .collect()
}

fn seeded(dir: &TempDir, name: &str, activities: usize) -> PersistentEngine {
    let path = dir.path().join(name);
    let mut engine = PersistentEngine::new(path.to_str().expect("utf-8 path")).expect("engine");
    for i in 0..activities {
        let id = format!("a{i}");
        engine
            .add_activity(id.clone(), track(i), "Ride".into())
            .expect("add activity");
        engine
            .update_activity_metadata(
                &id,
                Some(NOW - (i as i64) * DAY),
                Some("ride"),
                Some(12_345.0),
                Some(3_600),
            )
            .expect("metadata");
        // The catalogue is what `insights_data` and the routes screen spend
        // their time on, so a library with no sections would guard the wrong
        // half of every read here.
        if i % ACTIVITIES_PER_SECTION == 0 {
            engine
                .create_section(CreateSectionParams {
                    sport_type: "Ride".into(),
                    polyline: track(i),
                    distance_meters: 1_100.0,
                    name: Some(format!("Section {i}")),
                    source_activity_id: Some(id.clone()),
                    start_index: Some(0),
                    end_index: Some(POINTS_PER_TRACK as u32 - 1),
                })
                .expect("create section");
        }
    }
    engine.load().expect("load");
    engine
}

fn insights_params() -> FfiInsightsParams {
    let week = 7 * DAY;
    FfiInsightsParams {
        current_start: NOW - week,
        current_end: NOW,
        prev_start: NOW - 2 * week,
        prev_end: NOW - week,
        chronic_start: NOW - 4 * week,
        today_start: NOW - DAY,
        include_sections: true,
        ranked_limit: 20,
        active_window_days: 180,
        efficiency_per_sport: 5,
        efficiency_limit: 10,
        efficiency_min_efforts: 3,
        strength_month: FfiTimestampRange {
            start_ts: NOW - 30 * DAY,
            end_ts: NOW,
        },
        strength_weeks: vec![FfiTimestampRange {
            start_ts: NOW - week,
            end_ts: NOW,
        }],
    }
}

/// Which library a sample was taken against.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Side {
    Small,
    Large,
}

const ROUNDS: usize = 5;

/// The best of a few rounds, taking both sides in every round.
///
/// A descheduled sample inflates one side of the ratio and would fail the suite
/// for the box rather than for the code, and the minimum is what keeps that
/// out. The minimum alone is not enough: measuring one side to exhaustion and
/// then the other lets a burst of load cover the whole of the second phase and
/// none of the first, and every sample on that side then carries it. So the
/// sides are interleaved and a burst has to outlast every round of both to
/// reach the ratio.
fn best_pair(mut sample: impl FnMut(Side) -> Duration) -> (Duration, Duration) {
    let mut small = Duration::MAX;
    let mut large = Duration::MAX;
    for _ in 0..ROUNDS {
        small = small.min(sample(Side::Small));
        large = large.min(sample(Side::Large));
    }
    (small, large)
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

/// Assert one read does not get dearer than the library it reads.
fn holds<T>(
    name: &str,
    ceiling: f64,
    small: &mut PersistentEngine,
    large: &mut PersistentEngine,
    mut read: impl FnMut(&mut PersistentEngine) -> T,
) {
    let (a, b) = best_pair(|side| {
        let engine: &mut PersistentEngine = match side {
            Side::Small => small,
            Side::Large => large,
        };
        let t = Instant::now();
        std::hint::black_box(read(engine));
        t.elapsed()
    });
    if a < NOISE_FLOOR && b < NOISE_FLOOR {
        println!(
            "{name}: {:.3} ms to {:.3} ms, both under the floor",
            ms(a),
            ms(b)
        );
        return;
    }
    let growth = b.as_secs_f64() / a.as_secs_f64().max(f64::MIN_POSITIVE);
    println!(
        "{name}: {:.3} ms to {:.3} ms, {growth:.1}x for 3x the library",
        ms(a),
        ms(b)
    );
    assert!(
        growth <= ceiling,
        "{name} cost {growth:.1}x more for three times the library, \
         {:.3} ms against {:.3} ms. It is scanning rather than looking up, and \
         it blocks the JavaScript thread for every millisecond of it. \
         Its ceiling is {ceiling:.1}x. Raising that is not the fix.",
        ms(b),
        ms(a)
    );
}

#[test]
fn no_screen_read_grows_faster_than_the_library() {
    let dir = TempDir::new().expect("tempdir");
    let mut small = seeded(&dir, "small.db", SMALL);
    let mut large = seeded(&dir, "large.db", LARGE);
    let params = insights_params();
    let week = 7 * DAY;

    holds("stats", FLAT, &mut small, &mut large, |e| e.stats());
    holds("activity_count", FLAT, &mut small, &mut large, |e| {
        e.activity_count()
    });
    holds(
        "get_section_summaries",
        LINEAR,
        &mut small,
        &mut large,
        |e| e.get_section_summaries(),
    );
    holds("map_screen_data", FLAT, &mut small, &mut large, |e| {
        e.map_screen_data(NOW - 365 * DAY, NOW, vec![])
    });
    holds("routes_screen_data", FLAT, &mut small, &mut large, |e| {
        e.get_routes_screen_data(20, 0, 20, 0, 2, false, false, f64::NAN, f64::NAN)
    });
    holds("startup_data", FLAT, &mut small, &mut large, |e| {
        e.startup_data(NOW - week, NOW, NOW - 2 * week, NOW - week, &[])
    });
    holds("activity_detail_data", FLAT, &mut small, &mut large, |e| {
        e.activity_detail_data("a0", 2)
    });
    // The one with the least headroom on the device, and the one that grows
    // with the catalogue. If only one read is ever guarded it is this.
    holds("insights_data", FLAT, &mut small, &mut large, |e| {
        e.insights_data(&params)
    });
}

/// Scenario: the box is quiet for the first half of the measurement and busy
/// for the second. Expected behaviour: the ratio is the code's, not the load's.
///
/// This is the shape that failed the suite on 2026-09-08 with the fleet
/// running, and it is not a ceiling that was too tight. Measuring the small
/// library to exhaustion and then the large one puts every large sample inside
/// the burst, so the minimum carries it and a flat read reads as a growing one.
#[test]
fn a_burst_over_the_second_half_does_not_read_as_growth() {
    let quiet = Duration::from_micros(1_000);
    let loaded = Duration::from_micros(3_000);
    // Ten samples are taken either way, so the burst covers the same calls in
    // both shapes and only their order differs.
    let calls = std::cell::Cell::new(0usize);
    let script = |_side| {
        calls.set(calls.get() + 1);
        if calls.get() > ROUNDS { loaded } else { quiet }
    };

    let mut small = Duration::MAX;
    let mut large = Duration::MAX;
    for _ in 0..ROUNDS {
        small = small.min(script(Side::Small));
    }
    for _ in 0..ROUNDS {
        large = large.min(script(Side::Large));
    }
    let sequential = large.as_secs_f64() / small.as_secs_f64();
    assert!(
        sequential > FLAT,
        "the phase-separated shape is meant to be the one that fails here, \
         it read {sequential:.1}x against a ceiling of {FLAT:.1}x"
    );

    calls.set(0);
    let (small, large) = best_pair(script);
    let interleaved = large.as_secs_f64() / small.as_secs_f64();
    assert!(
        (interleaved - 1.0).abs() < 0.01,
        "a burst both sides pay for equally is not growth, got {interleaved:.2}x \
         from {:.3} ms and {:.3} ms",
        ms(small),
        ms(large)
    );
}
