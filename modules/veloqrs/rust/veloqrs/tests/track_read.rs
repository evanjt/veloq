//! Track reads report why a blob failed instead of degrading to an empty track.
//!
//! Every stored format is pinned by bytes written here, not by calling the
//! current writer, so a change to the writer cannot quietly redefine what the
//! reader must accept.
//!
//! Run: `cargo test --test track_read -p veloqrs`

use rusqlite::{Connection, params};
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::path::PathBuf;
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentRouteEngine;
use veloqrs::persistence::codec::{TrackRead, encode_polyline};

// ------------------------------------------------------------ allocator

// Live bytes are counted per thread, not per process, so the measurement is
// deterministic while the harness runs the other tests of this file in
// parallel. Const-initialised and Drop-free, so the counter itself never
// allocates and is readable for the whole life of the thread.
thread_local! {
    static LIVE_BYTES: Cell<isize> = const { Cell::new(0) };
}

fn add_bytes(delta: isize) {
    let _ = LIVE_BYTES.try_with(|live| live.set(live.get() + delta));
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

fn live_bytes() -> isize {
    LIVE_BYTES.try_with(|live| live.get()).unwrap_or(0)
}

// ------------------------------------------------------------ fixtures

fn pt(lat: f64, lng: f64, ele: Option<f64>) -> GpsPoint {
    GpsPoint {
        latitude: lat,
        longitude: lng,
        elevation: ele,
    }
}

fn track(n: usize, with_elevation: bool) -> Vec<GpsPoint> {
    (0..n)
        .map(|i| {
            pt(
                46.2 + i as f64 * 0.000_09,
                7.36 - i as f64 * 0.000_113,
                with_elevation.then_some(500.0 + i as f64 * 0.7),
            )
        })
        .collect()
}

fn write_varint(out: &mut Vec<u8>, mut v: u64) {
    loop {
        let b = (v & 0x7f) as u8;
        v >>= 7;
        if v == 0 {
            out.push(b);
            return;
        }
        out.push(b | 0x80);
    }
}

/// postcard `Vec<{f64, f64, Option<f64>}>`: varint length, then per point two
/// little-endian f64s and an option discriminant.
fn postcard_body(points: &[GpsPoint]) -> Vec<u8> {
    let mut out = Vec::new();
    write_varint(&mut out, points.len() as u64);
    for p in points {
        out.extend_from_slice(&p.latitude.to_le_bytes());
        out.extend_from_slice(&p.longitude.to_le_bytes());
        match p.elevation {
            None => out.push(0),
            Some(e) => {
                out.push(1);
                out.extend_from_slice(&e.to_le_bytes());
            }
        }
    }
    out
}

/// The shipped frame: tag 0xC1, then the body length as little-endian u32.
fn framed_postcard(points: &[GpsPoint]) -> Vec<u8> {
    let body = postcard_body(points);
    let mut out = vec![0xC1];
    out.extend_from_slice(&(body.len() as u32).to_le_bytes());
    out.extend_from_slice(&body);
    out
}

/// msgpack array of structs-as-arrays, each f64 written as 0xcb plus eight
/// big-endian bytes. Elevation is omitted where absent, which is what
/// `skip_serializing_if` on `GpsPoint` produced.
fn rmp_blob(points: &[GpsPoint]) -> Vec<u8> {
    assert!(points.len() < 16, "fixture uses fixarray only");
    let mut out = vec![0x90 | points.len() as u8];
    for p in points {
        let fields = if p.elevation.is_some() { 3 } else { 2 };
        out.push(0x90 | fields);
        for v in [Some(p.latitude), Some(p.longitude), p.elevation]
            .into_iter()
            .flatten()
        {
            out.push(0xcb);
            out.extend_from_slice(&v.to_be_bytes());
        }
    }
    out
}

// ------------------------------------------------------------ setup

struct Setup {
    engine: PersistentRouteEngine,
    raw: Connection,
    path: PathBuf,
    _tmp: TempDir,
}

fn setup() -> Setup {
    let tmp = TempDir::new().expect("temp dir");
    let path: PathBuf = tmp.path().join("test.db");
    let engine = PersistentRouteEngine::new(path.to_str().unwrap()).expect("engine new");
    let raw = Connection::open(&path).expect("raw open");
    Setup {
        engine,
        raw,
        path,
        _tmp: tmp,
    }
}

impl Setup {
    fn add(&mut self, id: &str, points: Vec<GpsPoint>) {
        self.engine
            .add_activities_batch(vec![(id.to_string(), points, "Ride".to_string())])
            .expect("add activity");
    }

    /// Replace a stored track blob with exact bytes, leaving the activity row
    /// intact.
    fn set_blob(&self, id: &str, bytes: &[u8]) {
        let n = self
            .raw
            .execute(
                "UPDATE gps_tracks SET track_data = ? WHERE activity_id = ?",
                params![bytes, id],
            )
            .expect("blob update");
        assert_eq!(n, 1, "expected one gps_tracks row for {id}");
    }

    /// Write a non-blob value into `track_data`, which is what a column read
    /// cannot hand back as bytes.
    fn set_unreadable_column(&self, id: &str) {
        let n = self
            .raw
            .execute(
                "UPDATE gps_tracks SET track_data = 42 WHERE activity_id = ?",
                params![id],
            )
            .expect("column update");
        assert_eq!(n, 1, "expected one gps_tracks row for {id}");
    }

    /// A second engine over the same file, with empty caches, so a read comes
    /// from the stored bytes.
    fn reopen(&self) -> PersistentRouteEngine {
        PersistentRouteEngine::new(self.path.to_str().unwrap()).expect("engine reopen")
    }

    fn set_signature_blob(&self, id: &str, bytes: &[u8]) {
        let n = self
            .raw
            .execute(
                "UPDATE signatures SET points = ? WHERE activity_id = ?",
                params![bytes, id],
            )
            .expect("signature update");
        assert_eq!(n, 1, "expected one signatures row for {id}");
    }
}

fn corrupt_reason(read: &TrackRead) -> String {
    match read {
        TrackRead::Corrupt(reason) => reason.clone(),
        other => panic!("expected Corrupt, got {other:?}"),
    }
}

// ------------------------------------------------------------ formats

#[test]
fn framed_postcard_blob_reads_present() {
    let mut s = setup();
    let points = track(6, true);
    s.add("a1", points.clone());
    s.set_blob("a1", &framed_postcard(&points));
    assert_eq!(s.engine.track("a1"), TrackRead::Present(points));
}

#[test]
fn unframed_postcard_blob_reads_present() {
    let mut s = setup();
    let points = track(6, true);
    s.add("a1", points.clone());
    s.set_blob("a1", &postcard_body(&points));
    assert_eq!(s.engine.track("a1"), TrackRead::Present(points));
}

#[test]
fn rmp_blob_reads_present() {
    let mut s = setup();
    let points = track(4, true);
    s.add("a1", points.clone());
    s.set_blob("a1", &rmp_blob(&points));
    assert_eq!(s.engine.track("a1"), TrackRead::Present(points));
}

/// A point with no elevation is two msgpack fields, not three.
#[test]
fn rmp_blob_without_elevation_reads_present() {
    let mut s = setup();
    let points = track(4, false);
    s.add("a1", points.clone());
    s.set_blob("a1", &rmp_blob(&points));
    assert_eq!(s.engine.track("a1"), TrackRead::Present(points));
}

// ------------------------------------------------------------ failures

#[test]
fn missing_row_is_distinct_from_corrupt() {
    let mut s = setup();
    s.add("a1", track(4, true));
    s.set_blob("a1", b"not a track at all");

    assert_eq!(s.engine.track("never-synced"), TrackRead::Missing);
    assert!(matches!(s.engine.track("a1"), TrackRead::Corrupt(_)));
}

#[test]
fn corrupt_bytes_name_the_failed_step_and_the_blob() {
    let mut s = setup();
    s.add("a1", track(4, true));
    let mut blob = framed_postcard(&track(4, true));
    blob.truncate(blob.len() - 3);
    s.set_blob("a1", &blob);

    let reason = corrupt_reason(&s.engine.track("a1"));
    assert!(
        reason.contains("framed postcard"),
        "reason must name the step that failed: {reason}"
    );
    assert!(
        reason.contains("0xc1") && reason.contains(&format!("{} B", blob.len())),
        "reason must carry the first byte and the blob length: {reason}"
    );
}

/// The quantised polyline stream opens on a varint count, so no container
/// claims it. It must be refused rather than mis-parsed.
#[test]
fn quantised_blob_reports_an_unrecognised_container() {
    let mut s = setup();
    s.add("a1", track(4, true));
    let blob = encode_polyline(&track(500, true));
    s.set_blob("a1", &blob);

    let reason = corrupt_reason(&s.engine.track("a1"));
    assert!(
        reason.starts_with("unrecognised container"),
        "reason must say the container was not recognised: {reason}"
    );
    assert!(
        reason.contains(&format!("first byte 0x{:02x}", blob[0])),
        "reason must carry the first byte: {reason}"
    );
}

/// A quantised blob whose leading varint lands in the msgpack fixarray range
/// is the one shape that could decode as a short array and return the wrong
/// points. It must fail instead.
#[test]
fn quantised_blob_with_an_array_header_byte_is_not_mis_parsed() {
    let blob = encode_polyline(&track(400, true));
    assert_eq!(blob[0], 0x90, "fixture must exercise the fixarray range");

    let mut s = setup();
    s.add("a1", track(4, true));
    s.set_blob("a1", &blob);
    assert!(matches!(s.engine.track("a1"), TrackRead::Corrupt(_)));
}

/// The reason reaches the log, so it must describe the container and nothing
/// about where the athlete was.
#[test]
fn corrupt_reason_carries_no_coordinates() {
    let mut s = setup();
    let points = track(4, true);
    s.add("a1", points.clone());
    let mut blob = postcard_body(&points);
    blob.truncate(blob.len() - 4);
    s.set_blob("a1", &blob);

    let reason = corrupt_reason(&s.engine.track("a1"));
    for fragment in ["46.2", "7.36", "500."] {
        assert!(
            !reason.contains(fragment),
            "reason leaked a coordinate ({fragment}): {reason}"
        );
    }
}

// ------------------------------------------------------------ batch reads

#[test]
fn tracks_batch_labels_every_requested_id() {
    let mut s = setup();
    let good = track(5, true);
    s.add("a1", good.clone());
    s.add("a2", track(5, true));
    s.set_blob("a2", b"\x2c junk that claims nothing");

    let ids = vec!["a1".to_string(), "a2".to_string(), "a3".to_string()];
    let reads = s.engine.tracks_batch(&ids);

    assert_eq!(
        reads.iter().map(|(id, _)| id.clone()).collect::<Vec<_>>(),
        ids
    );
    assert_eq!(reads[0].1, TrackRead::Present(good));
    assert!(matches!(reads[1].1, TrackRead::Corrupt(_)));
    assert_eq!(reads[2].1, TrackRead::Missing);
}

/// Scenario: the query itself fails, here because the table is gone.
/// Expected behaviour: both entry points call it the same thing, and neither
/// reports a stored activity as one that was never synced.
#[test]
fn a_failed_query_reads_the_same_way_one_at_a_time_and_in_a_batch() {
    let mut s = setup();
    s.add("a1", track(5, true));
    s.raw
        .execute_batch("DROP TABLE gps_tracks")
        .expect("drop gps_tracks");

    let single = s.engine.track("a1");
    let batch = s.engine.tracks_batch(&["a1".to_string()]);

    assert!(matches!(single, TrackRead::Corrupt(_)), "got {single:?}");
    assert!(
        matches!(batch[0].1, TrackRead::Corrupt(_)),
        "a query failure must not read as never synced: {:?}",
        batch[0].1
    );
}

/// A repeated id is a stored row on every occurrence, never `Missing` on the
/// second one.
#[test]
fn tracks_batch_answers_a_repeated_id_the_same_way_twice() {
    let mut s = setup();
    let good = track(5, true);
    s.add("a1", good.clone());

    let ids = vec!["a1".to_string(), "a2".to_string(), "a1".to_string()];
    let reads = s.engine.tracks_batch(&ids);

    assert_eq!(
        reads.iter().map(|(id, _)| id.clone()).collect::<Vec<_>>(),
        ids
    );
    assert_eq!(reads[0].1, TrackRead::Present(good.clone()));
    assert_eq!(reads[1].1, TrackRead::Missing);
    assert_eq!(reads[2].1, TrackRead::Present(good));
}

#[test]
fn for_each_track_visits_every_activity_exactly_once() {
    let mut s = setup();
    for i in 0..7 {
        s.add(&format!("a{i}"), track(5, true));
    }
    s.set_blob("a3", b"\x2c junk that claims nothing");

    let mut seen: Vec<(String, usize)> = Vec::new();
    s.engine
        .for_each_track(|id, points| seen.push((id.to_string(), points.len())));

    seen.sort();
    assert_eq!(seen.len(), 7);
    assert_eq!(
        seen.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>(),
        vec!["a0", "a1", "a2", "a3", "a4", "a5", "a6"]
    );
    assert_eq!(
        seen.iter().find(|(id, _)| id == "a3").unwrap().1,
        0,
        "a corrupt row is still visited, with no points"
    );
}

/// Scenario: one row holds a value the column read cannot return as bytes.
/// Expected behaviour: the walk carries on over the remaining rows and its
/// summary counts the loss, so a short heatmap cannot pass for a complete one.
#[test]
fn a_row_the_driver_cannot_read_is_counted_not_hidden() {
    let mut s = setup();
    for i in 0..5 {
        s.add(&format!("a{i}"), track(5, true));
    }
    s.set_unreadable_column("a2");
    s.set_blob("a4", b"\x2c junk that claims nothing");

    let mut seen: Vec<String> = Vec::new();
    let walk = s.engine.for_each_track(|id, _| seen.push(id.to_string()));

    seen.sort();
    assert_eq!(seen, vec!["a0", "a1", "a3", "a4"]);
    assert_eq!(walk.visited, 4);
    assert_eq!(walk.corrupt, 1);
    assert_eq!(walk.failed, 1);
    assert!(walk.is_incomplete());
}

/// A walk over sound rows reports nothing lost.
#[test]
fn a_clean_walk_reports_no_failures() {
    let mut s = setup();
    for i in 0..3 {
        s.add(&format!("a{i}"), track(5, true));
    }

    let walk = s.engine.for_each_track(|_, _| {});
    assert_eq!(walk.visited, 3);
    assert_eq!(walk.corrupt, 0);
    assert_eq!(walk.failed, 0);
    assert!(!walk.is_incomplete());
}

// ------------------------------------------------------------ signatures

/// Scenario: the route-grouping read hits a signature whose points blob is
/// unreadable.
/// Expected behaviour: the read gives up rather than returning a signature
/// with no points, which would group the activity against an empty geometry.
#[test]
fn a_corrupt_signature_yields_no_signature_at_all() {
    let mut s = setup();
    s.add("a1", track(40, true));
    s.add("a2", track(40, true));
    s.set_signature_blob("a2", b"\x2c junk that claims nothing");

    let mut fresh = s.reopen();
    assert!(
        !fresh
            .get_signature("a1")
            .expect("stored signature")
            .points
            .is_empty(),
        "the fixture must store a signature with points"
    );
    assert!(fresh.get_signature("a2").is_none());
}

/// Scenario: the heatmap walks the whole library.
/// Expected behaviour: peak live memory tracks one decoded track, not all of
/// them, so nothing the callback saw survives the call.
#[test]
fn for_each_track_holds_one_track_at_a_time() {
    const ACTIVITIES: usize = 20;
    const POINTS: usize = 400;

    let mut s = setup();
    for i in 0..ACTIVITIES {
        s.add(&format!("a{i}"), track(POINTS, true));
    }

    // Warm the SQLite page cache so the measured pass allocates only what the
    // decode itself needs.
    s.engine.for_each_track(|_, _| {});

    let baseline = live_bytes();
    let mut peak = 0isize;
    let mut visited = 0usize;
    s.engine.for_each_track(|_, points| {
        assert_eq!(points.len(), POINTS);
        visited += 1;
        peak = peak.max(live_bytes() - baseline);
    });

    assert_eq!(visited, ACTIVITIES);
    let one_track = (POINTS * size_of::<GpsPoint>()) as isize;
    assert!(
        peak < one_track * 4,
        "peak of {peak} B over a {} B baseline exceeds four tracks ({one_track} B each); \
         the walk is retaining decoded tracks",
        baseline
    );
    assert!(
        live_bytes() - baseline < one_track,
        "the walk left a track behind"
    );
}
