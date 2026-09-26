//! What saving a recorded ride pays inside `add_activity`, measured rather than
//! estimated.
//!
//! `writeProvisionalActivity` hands the whole recorded track to
//! `engine.addActivities`, which the delegate runs inline on the JS thread
//! (`modules/veloqrs/src/delegates/activities.ts`). A save is a one-shot tap,
//! so the budget is 200 ms for everything the thread does, and the two JS legs
//! either side of this call, building the FIT and encoding its base64, already
//! spend 56 to 75 ms between them.
//!
//! Two things scale here and they scale on different axes: the track goes
//! through an encode and an insert, and `rebuild_spatial_index` bulk-loads the
//! R-tree over the **whole library** on every add. So the ride is timed against
//! libraries of several sizes.
//!
//! The database goes on disk, not in the default temp directory, which on this
//! machine is a tmpfs: a commit there never reaches storage and the number then
//! measures the encode alone. Both are reported, because the gap between them
//! is what a phone's flash charges for the commit.
//!
//! Ignored by default: it builds a library per size.
//! Run: `cargo test --test recording_save_add_cost -p veloqrs -- --ignored --nocapture`

use std::time::Instant;

use tempfile::TempDir;
use veloqrs::{GpsPoint, PersistentEngine};

/// A three-hour ride at one sample per second, which is what the recorder
/// collects and what `streams.latlng` carries into the add.
const RIDE_POINTS: usize = 3 * 60 * 60;

/// Library sizes to add the ride into. 480 is about Evan's own library.
const LIBRARY_SIZES: &[usize] = &[0, 120, 480, 1000];

fn track(seed: usize, points: usize) -> Vec<GpsPoint> {
    let base_lat = 46.5 + (seed as f64) * 0.01;
    let base_lng = 6.6 + (seed as f64) * 0.01;
    (0..points)
        .map(|i| GpsPoint {
            latitude: base_lat + (i as f64) * 0.00001,
            longitude: base_lng + (i as f64) * 0.00001,
            elevation: None,
        })
        .collect()
}

/// Where the database goes. `None` is the default temp directory, a tmpfs here.
fn dir_on(disk: Option<&str>) -> TempDir {
    match disk {
        Some(base) => TempDir::new_in(base).expect("tempdir on disk"),
        None => TempDir::new().expect("tempdir"),
    }
}

#[test]
#[ignore = "builds a library per size; run it deliberately"]
fn what_a_saved_ride_pays_inside_add_activity() {
    // Somewhere under the checkout, which is on real storage.
    let on_disk = concat!(env!("CARGO_MANIFEST_DIR"), "/../target");
    std::fs::create_dir_all(on_disk).expect("target dir");

    println!("library  tmpfs_ms  disk_ms");
    for &size in LIBRARY_SIZES {
        let tmpfs = add_ms(size, None);
        let disk = add_ms(size, Some(on_disk));
        println!("{size:>7}  {tmpfs:>8.1}  {disk:>7.1}");
    }
}

/// Build a library of `size`, then time one three-hour ride going into it.
fn add_ms(size: usize, disk: Option<&str>) -> f64 {
    {
        let dir = dir_on(disk);
        let path = dir.path().join("recording.db");
        let mut engine = PersistentEngine::new(path.to_str().unwrap()).expect("engine");
        engine.load().expect("load");

        // The library the ride lands in. Short tracks: what they cost to
        // insert is not what is being measured, only how many the R-tree holds.
        for i in 0..size {
            engine
                .add_activity(format!("i{i}"), track(i, 60), "Ride".to_string())
                .expect("add_activity");
        }

        let ride = track(9_999, RIDE_POINTS);
        let start = Instant::now();
        engine
            .add_activity("local-ride".to_string(), ride, "Ride".to_string())
            .expect("add_activity");
        let ms = start.elapsed().as_secs_f64() * 1000.0;

        assert_eq!(
            engine.activity_count(),
            size + 1,
            "library did not take the adds"
        );
        let stored = engine
            .get_gps_track("local-ride")
            .expect("the ride has a track");
        assert_eq!(
            stored.len(),
            RIDE_POINTS,
            "the ride's track did not round-trip"
        );

        ms
    }
}
