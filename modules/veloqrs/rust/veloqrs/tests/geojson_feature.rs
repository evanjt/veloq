//! A GeoJSON export feature is written straight to its writer, without a JSON
//! tree per coordinate, and its bytes stay what the export has always written.
//!
//! Run: `cargo test --test geojson_feature -p veloqrs`

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::io::Write;
use tracematch::GpsPoint;
use veloqrs::persistence::{GeoJsonFeature, write_geojson_feature};

// ------------------------------------------------------------ allocator

// Counted per thread, so the other tests of this file running in parallel do
// not reach the measurement. Const-initialised and Drop-free, so the counter
// itself never allocates.
thread_local! {
    static LIVE_BYTES: Cell<isize> = const { Cell::new(0) };
    static PEAK_BYTES: Cell<isize> = const { Cell::new(0) };
    static ALLOCATIONS: Cell<usize> = const { Cell::new(0) };
}

fn add_bytes(delta: isize) {
    let _ = LIVE_BYTES.try_with(|live| {
        live.set(live.get() + delta);
        let _ = PEAK_BYTES.try_with(|peak| peak.set(peak.get().max(live.get())));
    });
}

fn count_allocation() {
    let _ = ALLOCATIONS.try_with(|n| n.set(n.get() + 1));
}

struct Counting;

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        count_allocation();
        add_bytes(layout.size() as isize);
        unsafe { System.alloc(layout) }
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        add_bytes(-(layout.size() as isize));
        unsafe { System.dealloc(ptr, layout) }
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        count_allocation();
        add_bytes(new_size as isize - layout.size() as isize);
        unsafe { System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

struct Measured {
    allocations: usize,
    peak_bytes: isize,
}

/// Run `f` and report the allocations it made and its peak live bytes above
/// the live bytes it started with.
fn measure(f: impl FnOnce()) -> Measured {
    let start_live = LIVE_BYTES.with(|live| live.get());
    PEAK_BYTES.with(|peak| peak.set(start_live));
    let start_count = ALLOCATIONS.with(|n| n.get());
    f();
    Measured {
        allocations: ALLOCATIONS.with(|n| n.get()) - start_count,
        peak_bytes: PEAK_BYTES.with(|peak| peak.get()) - start_live,
    }
}

/// A writer that keeps only the byte count, so the measurement holds no copy
/// of the output.
#[derive(Default)]
struct ByteCount(u64);

impl Write for ByteCount {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0 += buf.len() as u64;
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

// ------------------------------------------------------------ fixtures

fn pt(lat: f64, lng: f64) -> GpsPoint {
    GpsPoint {
        latitude: lat,
        longitude: lng,
        elevation: None,
    }
}

fn track(n: usize) -> Vec<GpsPoint> {
    (0..n)
        .map(|i| pt(-33.85 + i as f64 * 0.000_09, 151.21 + i as f64 * 0.000_113))
        .collect()
}

fn feature(points: &[GpsPoint]) -> GeoJsonFeature<'_> {
    GeoJsonFeature {
        id: "lantern-7",
        name: "Harbour \"loop\"",
        sport: "Ride",
        date: "2026-03-14T07:30:00",
        distance: 12_345.5,
        moving_time: 2_400,
        points,
    }
}

fn written(feature: &GeoJsonFeature) -> String {
    let mut out = Vec::new();
    let n = write_geojson_feature(&mut out, feature).expect("write");
    assert_eq!(
        n,
        out.len() as u64,
        "the returned count is the bytes written"
    );
    String::from_utf8(out).expect("utf-8")
}

// ------------------------------------------------------------ tests

/// The keys come out sorted, as the export has always written them, and a
/// point with a non-finite coordinate is left out of the line.
#[test]
fn a_feature_keeps_the_bytes_the_export_has_always_written() {
    let points = vec![
        pt(-33.5, 151.25),
        pt(f64::NAN, 151.0),
        pt(-33.000001, 151.123456),
        pt(-34.0, f64::INFINITY),
    ];
    assert_eq!(
        written(&feature(&points)),
        concat!(
            r#"{"geometry":{"coordinates":[[151.25,-33.5],[151.123456,-33.000001]],"type":"LineString"},"#,
            r#""properties":{"date":"2026-03-14T07:30:00","distance":12345.5,"id":"lantern-7","#,
            r#""movingTime":2400,"name":"Harbour \"loop\"","sport":"Ride"},"type":"Feature"}"#,
        )
    );
}

#[test]
fn an_empty_date_and_zero_figures_are_written_as_values() {
    let points = vec![pt(1.0, 2.0)];
    let mut f = feature(&points);
    f.date = "";
    f.distance = 0.0;
    f.moving_time = 0;
    assert_eq!(
        written(&f),
        concat!(
            r#"{"geometry":{"coordinates":[[2.0,1.0]],"type":"LineString"},"#,
            r#""properties":{"date":"","distance":0.0,"id":"lantern-7","movingTime":0,"#,
            r#""name":"Harbour \"loop\"","sport":"Ride"},"type":"Feature"}"#,
        )
    );
}

#[test]
fn a_long_feature_is_written_without_a_value_per_coordinate() {
    let points = track(10_800);
    let f = feature(&points);
    let mut sink = ByteCount::default();
    let mut returned = 0;
    let cost = measure(|| {
        returned = write_geojson_feature(&mut sink, &f).expect("write");
    });
    assert_eq!(returned, sink.0);
    assert!(
        cost.allocations < 64,
        "{} allocations for {} points",
        cost.allocations,
        points.len()
    );
    assert!(
        (cost.peak_bytes as u64) < 2 * sink.0,
        "peak {} bytes for {} bytes of feature",
        cost.peak_bytes,
        sink.0
    );

    let text = written(&f);
    let parsed: serde_json::Value = serde_json::from_str(&text).expect("valid JSON");
    let coords = parsed["geometry"]["coordinates"]
        .as_array()
        .expect("coordinates");
    assert_eq!(coords.len(), points.len());
    assert_eq!(coords[10_799][0].as_f64(), Some(points[10_799].longitude));
    assert_eq!(coords[10_799][1].as_f64(), Some(points[10_799].latitude));
}
