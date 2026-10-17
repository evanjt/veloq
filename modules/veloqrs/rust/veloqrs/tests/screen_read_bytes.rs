//! Scenario: a screen read starts carrying a whole catalogue, a polyline per
//! row or a list that grows with the library, or starts allocating per
//! activity while returning the same answer. The statement and step gates
//! pass, because neither sees what the read hands across the FFI or builds
//! on the way, and the JavaScript thread pays for every byte it lifts.
//!
//! Expected behaviour: each read is lowered exactly as UniFFI hands it over,
//! field by field, against a library of 60 activities and one of 180. A read
//! about one item lowers the same bytes from both. A read that lists the
//! library lowers the same bytes per row it returns, within a margin, in every
//! top-level field. Allocations follow the same rule on the calling thread.
//! Ratios gate, so a new field moves the absolute numbers without failing;
//! the absolute bytes are printed as a table only.
//!
//! Run: `cargo test --test screen_read_bytes -p veloqrs -- --nocapture`

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

use tracematch::GpsPoint;
use veloqrs::sections::CreateSectionParams;
use veloqrs::{
    ActivityMetrics, FfiActivityDetailData, FfiBestEffortsData, FfiFitnessScreenData,
    FfiMapScreenData, FfiRouteDetailData, FfiRoutesScreenData, FfiRoutesScreenQuery,
    FfiSectionDetailData, FfiSectionPerformanceData, FfiStartupData, MapDistanceBand,
    PersistentEngine, UniFfiTag,
};

// ------------------------------------------------------------ allocator

// Counted per thread, so the tests of this file running in parallel do not
// count each other. Const-initialised and Drop-free, so the counter never
// allocates itself.
thread_local! {
    static ALLOCATIONS: Cell<usize> = const { Cell::new(0) };
    static ALLOCATED_BYTES: Cell<usize> = const { Cell::new(0) };
}

fn record(bytes: usize) {
    let _ = ALLOCATIONS.try_with(|n| n.set(n.get() + 1));
    let _ = ALLOCATED_BYTES.try_with(|n| n.set(n.get() + bytes));
}

struct Counting;

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        record(layout.size());
        unsafe { System.alloc(layout) }
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        record(layout.size());
        unsafe { System.alloc_zeroed(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        record(new_size);
        unsafe { System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

/// Allocations and bytes allocated on this thread while `read` runs.
fn allocations_in<T>(read: impl FnOnce() -> T) -> (T, usize, usize) {
    let count = ALLOCATIONS.with(Cell::get);
    let bytes = ALLOCATED_BYTES.with(Cell::get);
    let value = read();
    (
        value,
        ALLOCATIONS.with(Cell::get) - count,
        ALLOCATED_BYTES.with(Cell::get) - bytes,
    )
}

// ------------------------------------------------------------ fixture

const SMALL: usize = 60;
const LARGE: usize = 180;
const ACTIVITIES_PER_SECTION: usize = 4;
const POINTS_PER_TRACK: usize = 100;
const DAY: i64 = 86_400;
const NOW: i64 = 1_757_000_000;

fn track(seed: usize) -> Vec<GpsPoint> {
    let seed = seed - seed % ACTIVITIES_PER_SECTION;
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

/// A library of `activities` rides, four to a track, with a section on every
/// track, so every route group and every section has four members whatever
/// the library's size.
fn seeded(activities: usize) -> PersistentEngine {
    let mut engine = PersistentEngine::in_memory().expect("engine");
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
        engine
            .set_activity_metrics(vec![ActivityMetrics {
                activity_id: id.clone(),
                name: format!("Ride {i}"),
                date: NOW - (i as i64) * DAY,
                distance: 12_345.0,
                moving_time: 3_600,
                elapsed_time: 3_700,
                elevation_gain: 100.0,
                sport_type: "Ride".into(),
                ..ActivityMetrics::default()
            }])
            .expect("metrics");
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
    assert!(
        !engine.get_groups().is_empty(),
        "the seed has no route groups"
    );
    engine.load().expect("load");
    engine
}

// ------------------------------------------------------------ lowering

/// The bytes UniFFI writes into the `RustBuffer` the front end lifts.
fn lowered<T: uniffi::Lower<UniFfiTag>>(value: T) -> usize {
    let mut buf = Vec::new();
    T::write(value, &mut buf);
    buf.len()
}

/// One top-level field of a read: its lowered bytes and the rows it lists,
/// `None` for a field that lists nothing and so should not grow at all.
struct Field {
    name: &'static str,
    bytes: usize,
    rows: Option<usize>,
}

/// A read's lowered result, whole and field by field.
struct Lowered {
    total: usize,
    fields: Vec<Field>,
}

impl Lowered {
    fn rows(&self) -> usize {
        self.fields.iter().filter_map(|f| f.rows).sum()
    }
}

/// Lowers each named field of `$v`, a `$ty`, and the whole of it. The record
/// is rebuilt from the listed fields, so a field added to it and left out here
/// fails to compile, naming the field. A gap between the sum and the whole
/// fails too.
macro_rules! lower {
    ($ty:ident, $v:expr; $($name:ident $(=> $rows:expr)?),* $(,)?) => {{
        let v: $ty = $v;
        let v = $ty { $($name: v.$name),* };
        let fields = vec![$(Field {
            name: stringify!($name),
            bytes: lowered(v.$name.clone()),
            rows: lower!(@rows v $(, $rows)?),
        }),*];
        Lowered { total: lowered(v), fields }
    }};
    (@rows $v:ident) => { None };
    (@rows $v:ident, $rows:expr) => { Some($rows(&$v)) };
}

fn activity_detail(v: FfiActivityDetailData) -> Lowered {
    lower!(FfiActivityDetailData, v;
        exercise_groups => |v: &FfiActivityDetailData| v.exercise_groups.len(),
        fitness_impact,
        activity_count,
        has_gps_track,
        section_count,
        route_groups => |v: &FfiActivityDetailData| v.route_groups.len(),
        representative_signature,
        matched_sections => |v: &FfiActivityDetailData| v.matched_sections.len(),
        custom_sections => |v: &FfiActivityDetailData| v.custom_sections.len(),
        encounters => |v: &FfiActivityDetailData| v.encounters.len(),
        highlights,
        section_traces => |v: &FfiActivityDetailData| v.section_traces.len(),
        pr_section_ids => |v: &FfiActivityDetailData| v.pr_section_ids.len(),
        max_hr,
        max_hr_source,
        summary,
        hr_zones => |v: &FfiActivityDetailData| v.hr_zones.len(),
        power_zones => |v: &FfiActivityDetailData| v.power_zones.len(),
        ledger_changes => |v: &FfiActivityDetailData| v.ledger_changes.len(),
        intervals_id,
    )
}

fn section_detail(v: FfiSectionDetailData) -> Lowered {
    lower!(FfiSectionDetailData, v;
        activity_count,
        section,
        retirement,
        merge_candidates => |v: &FfiSectionDetailData| v.merge_candidates.len(),
        excluded_activity_ids => |v: &FfiSectionDetailData| v.excluded_activity_ids.len(),
        has_original_bounds,
        activity_rows => |v: &FfiSectionDetailData| v.activity_rows.len(),
        map_signatures => |v: &FfiSectionDetailData| v.map_signatures.len(),
        missing_time_stream_ids => |v: &FfiSectionDetailData| v.missing_time_stream_ids.len(),
        history => |v: &FfiSectionDetailData| v.history.len(),
        geometry_versions => |v: &FfiSectionDetailData| v.geometry_versions.len(),
        pinned_version,
        can_name_from_places,
    )
}

fn performance(v: FfiSectionPerformanceData) -> Lowered {
    lower!(FfiSectionPerformanceData, v;
        sport_type,
        sport_counts => |v: &FfiSectionPerformanceData| v.sport_counts.len(),
        calendar_summary,
        performances => |v: &FfiSectionPerformanceData| v.performances.records.len(),
        chart_data => |v: &FfiSectionPerformanceData| v.chart_data.points.len(),
        excluded_points => |v: &FfiSectionPerformanceData| v.excluded_points.len(),
        lap_records => |v: &FfiSectionPerformanceData| v.lap_records.len(),
        best_forward_is_record,
        best_reverse_is_record,
        trend_curves,
        histograms,
        correlations => |v: &FfiSectionPerformanceData| v.correlations.len(),
        correlation_floor,
        curves,
        curves_pending,
        efficiency_trend,
        scatter_focus,
        record_progression => |v: &FfiSectionPerformanceData| {
            v.record_progression.forward.len() + v.record_progression.reverse.len()
        },
    )
}

fn route_detail(v: FfiRouteDetailData) -> Lowered {
    lower!(FfiRouteDetailData, v;
        activity_count,
        group,
        distance_meters,
        elevation_gain_meters,
        encoded_representative,
        excluded_activity_ids => |v: &FfiRouteDetailData| v.excluded_activity_ids.len(),
        map_signatures => |v: &FfiRouteDetailData| v.map_signatures.len(),
        missing_time_stream_ids => |v: &FfiRouteDetailData| v.missing_time_stream_ids.len(),
        can_name_from_places,
    )
}

fn map_screen(v: FfiMapScreenData) -> Lowered {
    lower!(FfiMapScreenData, v;
        activity_count,
        available_sport_types => |v: &FfiMapScreenData| v.available_sport_types.len(),
        category_counts => |v: &FfiMapScreenData| v.category_counts.len(),
        activities => |v: &FfiMapScreenData| v.activities.len(),
        route_count,
        route_lines => |v: &FfiMapScreenData| {
            v.route_lines.as_ref().and_then(|l| l.routes.as_ref()).map_or(0, Vec::len)
        },
        section_count,
        sections => |v: &FfiMapScreenData| {
            v.sections.as_ref().and_then(|l| l.sections.as_ref()).map_or(0, Vec::len)
        },
        empty_reason,
    )
}

fn routes_screen(v: FfiRoutesScreenData) -> Lowered {
    lower!(FfiRoutesScreenData, v;
        activity_count,
        group_count,
        section_count,
        oldest_date,
        newest_date,
        groups => |v: &FfiRoutesScreenData| v.groups.len(),
        sections => |v: &FfiRoutesScreenData| v.sections.len(),
        has_more_groups,
        has_more_sections,
        groups_dirty,
        filtered_group_count,
        filtered_section_count,
        unaccepted_auto_count,
        accepted_auto_count,
        custom_count,
        retired_count,
        available_sport_types => |v: &FfiRoutesScreenData| v.available_sport_types.len(),
        group_empty_reason,
        section_empty_reason,
    )
}

fn startup(v: FfiStartupData) -> Lowered {
    lower!(FfiStartupData, v;
        summary_card,
        preview_tracks => |v: &FfiStartupData| v.preview_tracks.len(),
        sparklines,
    )
}

fn fitness(v: FfiFitnessScreenData) -> Lowered {
    lower!(FfiFitnessScreenData, v;
        ftp_trend,
        ftp_trend_coverage,
        run_pace_trend,
        swim_pace_trend,
        sport_mix,
    )
}

fn best_efforts(v: FfiBestEffortsData) -> Lowered {
    lower!(FfiBestEffortsData, v;
        sports => |v: &FfiBestEffortsData| v.sports.len(),
        climbing => |v: &FfiBestEffortsData| v.climbing.len(),
    )
}

// ------------------------------------------------------------ reads

/// What a read is about, which decides the rule its bytes are held to.
#[derive(Clone, Copy, PartialEq)]
enum Shape {
    /// One activity or one section of fixed size: the same bytes whatever the
    /// library holds.
    Item,
    /// Lists rows that may grow with the library: the same bytes per row.
    Listing,
}

/// The first section and route group of a library, each with four members.
struct Ids {
    section: String,
    group: String,
}

fn ids(engine: &mut PersistentEngine) -> Ids {
    Ids {
        section: engine.get_section_summaries()[0].id.clone(),
        group: engine.get_groups()[0].group_id.clone(),
    }
}

type Read = fn(&PersistentEngine, &Ids) -> Lowered;

fn map(engine: &PersistentEngine, route_lines: bool, sections: bool) -> FfiMapScreenData {
    engine.map_screen_data(
        NOW - 365 * DAY,
        NOW,
        vec![],
        MapDistanceBand::All,
        true,
        route_lines,
        sections,
        String::new(),
    )
}

/// Every read under the gate, its shape, and how to call it and lower it.
/// The call is what the allocations are counted over; the lowering is not.
fn reads() -> Vec<(&'static str, Shape, Read)> {
    vec![
        ("activity_detail_data", Shape::Item, |e, _| {
            measure(|| e.activity_detail_data("a0", 2), activity_detail)
        }),
        ("section_detail_data", Shape::Item, |e, ids| {
            measure(|| e.section_detail_data(&ids.section), section_detail)
        }),
        ("section_detail_performance", Shape::Item, |e, ids| {
            measure(
                || e.section_detail_performance(&ids.section, 365 * 5, None, None),
                performance,
            )
        }),
        ("route_detail_data", Shape::Item, |e, ids| {
            measure(|| e.route_detail_data(&ids.group), route_detail)
        }),
        ("route_detail_performance", Shape::Item, |e, ids| {
            measure(
                || e.route_detail_performance(&ids.group, 365 * 5, None, None),
                performance,
            )
        }),
        ("map_screen_data", Shape::Listing, |e, _| {
            measure(|| map(e, false, false), map_screen)
        }),
        (
            "map_screen_data_with_route_lines",
            Shape::Listing,
            |e, _| measure(|| map(e, true, false), map_screen),
        ),
        ("map_screen_data_with_sections", Shape::Listing, |e, _| {
            measure(|| map(e, false, true), map_screen)
        }),
        ("map_screen_data_with_both", Shape::Listing, |e, _| {
            measure(|| map(e, true, true), map_screen)
        }),
        ("routes_screen_data", Shape::Listing, |e, _| {
            measure(
                || {
                    e.get_routes_screen_data(FfiRoutesScreenQuery {
                        group_limit: 10,
                        section_limit: 10,
                        min_group_activity_count: 2,
                        ..Default::default()
                    })
                },
                routes_screen,
            )
        }),
        ("startup_data", Shape::Listing, |e, _| {
            let ids: Vec<String> = (0..5).map(|i| format!("a{i}")).collect();
            measure(
                || e.startup_data(NOW - 7 * DAY, NOW, NOW - 14 * DAY, NOW - 7 * DAY, &ids),
                startup,
            )
        }),
        ("fitness_screen_data", Shape::Item, |e, _| {
            measure(|| e.fitness_screen_data("2025-09-04"), fitness)
        }),
        ("best_efforts_data", Shape::Listing, |e, _| {
            measure(
                || e.best_efforts_data(0, NOW).expect("best efforts"),
                best_efforts,
            )
        }),
    ]
}

thread_local! {
    static LAST_ALLOCATIONS: Cell<(usize, usize)> = const { Cell::new((0, 0)) };
}

/// Calls `read` counting its allocations, then lowers what it returned.
fn measure<T>(read: impl FnOnce() -> T, lower: impl FnOnce(T) -> Lowered) -> Lowered {
    let (value, count, bytes) = allocations_in(read);
    LAST_ALLOCATIONS.with(|last| last.set((count, bytes)));
    lower(value)
}

struct Measured {
    lowered: Lowered,
    allocations: usize,
    allocated_bytes: usize,
}

fn run(read: Read, engine: &PersistentEngine, ids: &Ids) -> Measured {
    // The first call warms the read cache and the statement cache, which a
    // screen pays once; the second is the one the screen repeats.
    read(engine, ids);
    let lowered = read(engine, ids);
    let (allocations, allocated_bytes) = LAST_ALLOCATIONS.with(Cell::get);
    Measured {
        lowered,
        allocations,
        allocated_bytes,
    }
}

/// How far a ratio may drift for three times the library before it fails:
/// ids and names grow a digit, and the allocator rounds.
const MARGIN: f64 = 1.2;

/// Reads whose allocations are known to grow with the library while their
/// output stays flat, because the route ids of each section they show are
/// filtered out of every route group's summary. Each must still fail the
/// allocation rule; once it passes, take it off this list so the rule holds
/// it from then on.
const ALLOCATES_PER_ROUTE_GROUP: &[&str] = &["activity_detail_data", "section_detail_data"];

struct Pair {
    name: &'static str,
    shape: Shape,
    small: Measured,
    large: Measured,
}

fn measured() -> Vec<Pair> {
    let mut small = seeded(SMALL);
    let mut large = seeded(LARGE);
    let (small_ids, large_ids) = (ids(&mut small), ids(&mut large));
    let pairs: Vec<Pair> = reads()
        .into_iter()
        .map(|(name, shape, read)| Pair {
            name,
            shape,
            small: run(read, &small, &small_ids),
            large: run(read, &large, &large_ids),
        })
        .collect();
    print_table(&pairs);
    pairs
}

fn print_table(pairs: &[Pair]) {
    println!(
        "{:<36} {:>9} {:>9} {:>7} {:>7} {:>9} {:>9}",
        "read / field", "bytes 60", "bytes 180", "rows 60", "rows 180", "allocs 60", "allocs 180"
    );
    for pair in pairs {
        let (a, b) = (&pair.small, &pair.large);
        println!(
            "{:<36} {:>9} {:>9} {:>7} {:>7} {:>9} {:>9}",
            pair.name,
            a.lowered.total,
            b.lowered.total,
            a.lowered.rows(),
            b.lowered.rows(),
            a.allocations,
            b.allocations
        );
        for (fa, fb) in a.lowered.fields.iter().zip(&b.lowered.fields) {
            let rows = |f: &Field| f.rows.map_or(String::new(), |r| r.to_string());
            println!(
                "  {:<34} {:>9} {:>9} {:>7} {:>7}",
                fa.name,
                fa.bytes,
                fb.bytes,
                rows(fa),
                rows(fb)
            );
        }
    }
}

/// The field whose bytes grew the most between the two libraries.
fn grown_field(pair: &Pair) -> &'static str {
    pair.small
        .lowered
        .fields
        .iter()
        .zip(&pair.large.lowered.fields)
        .max_by_key(|(a, b)| b.bytes as isize - a.bytes as isize)
        .map_or("none", |(a, _)| a.name)
}

/// The most any listed field's rows grew by, and at least one: what a
/// read's work may grow by.
fn row_growth(pair: &Pair) -> f64 {
    pair.small
        .lowered
        .fields
        .iter()
        .zip(&pair.large.lowered.fields)
        .filter_map(|(a, b)| match (a.rows, b.rows) {
            (Some(ra), Some(rb)) if ra > 0 => Some(rb as f64 / ra as f64),
            _ => None,
        })
        .fold(1.0, f64::max)
}

#[test]
fn every_field_of_a_read_is_in_its_table() {
    for pair in measured() {
        for side in [&pair.small, &pair.large] {
            let sum: usize = side.lowered.fields.iter().map(|f| f.bytes).sum();
            assert_eq!(
                sum, side.lowered.total,
                "{} lowers {} bytes and its listed fields {sum}: a field is missing from \
                 its table here, so no rule holds it",
                pair.name, side.lowered.total
            );
        }
    }
}

#[test]
fn a_read_about_one_item_lowers_the_same_bytes_whatever_the_library() {
    for pair in measured().iter().filter(|p| p.shape == Shape::Item) {
        let (a, b) = (pair.small.lowered.total, pair.large.lowered.total);
        assert_eq!(
            a,
            b,
            "{} lowers {a} bytes against {SMALL} activities and {b} against {LARGE}; \
             `{}` grew. A read about one item carries something that grows with the \
             library, and the front end lifts every byte of it on the JavaScript thread.",
            pair.name,
            grown_field(pair)
        );
    }
}

#[test]
fn a_listing_lowers_no_more_bytes_per_row_for_a_larger_library() {
    for pair in measured().iter().filter(|p| p.shape == Shape::Listing) {
        for (fa, fb) in pair
            .small
            .lowered
            .fields
            .iter()
            .zip(&pair.large.lowered.fields)
        {
            let (allowed, what) = match (fa.rows, fb.rows) {
                (Some(ra), Some(rb)) if ra > 0 => (
                    fa.bytes as f64 / ra as f64 * rb as f64 * MARGIN,
                    format!("{ra} rows and {rb} rows"),
                ),
                (Some(0), Some(rb)) if rb > 0 => panic!(
                    "{}.{} lists nothing against {SMALL} activities and {rb} rows against \
                     {LARGE}, so the fixture cannot hold its bytes per row",
                    pair.name, fa.name
                ),
                _ => (fa.bytes as f64 * MARGIN, "no rows".to_string()),
            };
            assert!(
                fb.bytes as f64 <= allowed,
                "{}.{} lowers {} bytes against {SMALL} activities and {} against {LARGE} \
                 for {what}, over the {allowed:.0} its rows allow. Each row carries more as \
                 the library grows, and the front end lifts every byte on the JavaScript thread.",
                pair.name,
                fa.name,
                fa.bytes,
                fb.bytes
            );
        }
    }
}

#[test]
fn no_read_allocates_faster_than_the_rows_it_returns() {
    for pair in measured() {
        // An item read's work stays level, whatever its rows did.
        let growth = match pair.shape {
            Shape::Item => 1.0,
            Shape::Listing => row_growth(&pair),
        };
        let (a, b) = (&pair.small, &pair.large);
        // The count, not the bytes: a list's capacity doubles, so the bytes
        // it allocates step by powers of two while its rows grow smoothly.
        let within = b.allocations as f64 <= a.allocations as f64 * growth * MARGIN;
        if ALLOCATES_PER_ROUTE_GROUP.contains(&pair.name) {
            assert!(
                !within,
                "{} now allocates no faster than its rows; take it off \
                 ALLOCATES_PER_ROUTE_GROUP so this rule holds it",
                pair.name
            );
            continue;
        }
        assert!(
            within,
            "{} makes {} allocations of {} bytes against {SMALL} activities and {} of {} \
             against {LARGE}, while its rows grew {growth:.1}x. It allocates per activity, \
             section or group it does not return.",
            pair.name, a.allocations, a.allocated_bytes, b.allocations, b.allocated_bytes
        );
    }
}
