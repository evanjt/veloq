//! What splitting a large list page costs in live memory.
//!
//! Scenario: a bulk request answers 200 activities with their intervals in one
//! page of about 4.5 MB, the shape of the real bulk endpoint.
//! Expected behaviour: splitting it into typed records and stored bodies holds
//! no more than a small multiple of the page at its peak. A page built into a
//! whole JSON tree first costs several times the page and fails this.

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use veloqrs::net::endpoints::{split_event_page, split_page};
use veloqrs::net::types::{ActivityRecord, WellnessRecord};

// Live and peak bytes are counted per thread, so the measurement is
// deterministic while the harness runs the other tests of this file in
// parallel. Const-initialised and Drop-free, so the counter never allocates.
thread_local! {
    static LIVE_BYTES: Cell<isize> = const { Cell::new(0) };
    static PEAK_BYTES: Cell<isize> = const { Cell::new(0) };
}

fn add_bytes(delta: isize) {
    let _ = LIVE_BYTES.try_with(|live| {
        let now = live.get() + delta;
        live.set(now);
        let _ = PEAK_BYTES.try_with(|peak| peak.set(peak.get().max(now)));
    });
}

struct Counting;

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        add_bytes(layout.size() as isize);
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        add_bytes(-(layout.size() as isize));
        unsafe { System.dealloc(ptr, layout) }
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        add_bytes(new_size as isize - layout.size() as isize);
        unsafe { System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

/// Peak live bytes `f` adds above what was live when it started.
fn peak_above_start<R>(f: impl FnOnce() -> R) -> (R, isize) {
    let start = LIVE_BYTES.with(|live| live.get());
    PEAK_BYTES.with(|peak| peak.set(start));
    let out = f();
    (out, PEAK_BYTES.with(|peak| peak.get()) - start)
}

/// One activity of about 23 KB: its summary and 60 intervals of 20 fields.
fn activity(n: usize) -> String {
    let intervals: Vec<String> = (0..60)
        .map(|k| {
            let fields: Vec<String> = (0..20)
                .map(|f| format!("\"field_{f:02}\":{}.{}", n * 31 + k, f))
                .collect();
            format!("{{\"type\":\"WORK\",{}}}", fields.join(","))
        })
        .collect();
    format!(
        "{{\"id\":\"i{n}\",\"name\":\"Lakeside ride {n}\",\"type\":\"Ride\",\
         \"start_date_local\":\"2026-05-01T07:00:00\",\"moving_time\":3600,\
         \"distance\":30000.0,\"icu_intervals\":[{}]}}",
        intervals.join(",")
    )
}

fn page(items: usize, item: impl Fn(usize) -> String) -> String {
    let all: Vec<String> = (0..items).map(item).collect();
    format!("[{}]", all.join(","))
}

/// The peak may hold the stored bodies, about one page, plus one record and
/// the list of item slices. Twice the page leaves room for allocator growth.
fn assert_within_twice(page: &str, peak: isize) {
    let bound = 2 * page.len() as isize;
    assert!(
        peak < bound,
        "splitting a {} B page peaked at {} B, over {} B",
        page.len(),
        peak,
        bound
    );
}

#[test]
fn a_200_activity_page_splits_within_twice_its_size() {
    let page = page(200, activity);
    assert!(page.len() > 4_000_000, "page is {} B", page.len());
    let (split, peak) =
        peak_above_start(|| split_page::<ActivityRecord>(page.as_bytes()).expect("page splits"));
    assert_eq!(split.len(), 200);
    assert_eq!(split[199].0.id, "i199");
    assert_within_twice(&page, peak);
}

#[test]
fn a_year_of_wellness_splits_within_twice_its_size() {
    let page = page(365, |n| {
        let fields: Vec<String> = (0..40)
            .map(|f| format!("\"metric_{f:02}\":{n}.{f}"))
            .collect();
        format!("{{\"id\":\"day-{n}\",\"ctl\":50.0,{}}}", fields.join(","))
    });
    let (split, peak) =
        peak_above_start(|| split_page::<WellnessRecord>(page.as_bytes()).expect("page splits"));
    assert_eq!(split.len(), 365);
    assert_within_twice(&page, peak);
}

#[test]
fn a_page_of_resolved_events_splits_within_twice_its_size() {
    let page = page(200, |n| {
        let steps: Vec<String> = (0..80)
            .map(|k| format!("{{\"duration\":{k},\"power\":{{\"value\":{n}.{k}}}}}"))
            .collect();
        format!(
            "{{\"id\":{n},\"start_date_local\":\"2026-06-01T00:00:00\",\
             \"workout_doc\":{{\"steps\":[{}]}}}}",
            steps.join(",")
        )
    });
    let (split, peak) =
        peak_above_start(|| split_event_page(page.as_bytes()).expect("page splits"));
    assert_eq!(split.len(), 200);
    assert_within_twice(&page, peak);
}
