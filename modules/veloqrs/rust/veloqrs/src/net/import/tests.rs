use super::*;
use crate::fit_synthetic::{Activity, indoor_ride, outdoor_ride};
use std::io::Write;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use tempfile::TempDir;

fn ride_at(offset_secs: i64) -> Vec<u8> {
    let mut ride: Activity = outdoor_ride();
    ride.start_unix += offset_secs;
    ride.to_fit()
}

fn zip_of(entries: &[(&str, Vec<u8>)]) -> Vec<u8> {
    let mut out = std::io::Cursor::new(Vec::new());
    let mut writer = zip::ZipWriter::new(&mut out);
    let options = zip::write::SimpleFileOptions::default();
    for (name, bytes) in entries {
        writer.start_file(*name, options).unwrap();
        writer.write_all(bytes).unwrap();
    }
    writer.finish().unwrap();
    out.into_inner()
}

fn gzip(bytes: &[u8]) -> Vec<u8> {
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    encoder.write_all(bytes).unwrap();
    encoder.finish().unwrap()
}

fn noise(len: usize) -> Vec<u8> {
    let mut state = 0x9E37_79B9_7F4A_7C15_u64;
    (0..len)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            (state >> 24) as u8
        })
        .collect()
}

fn write(dir: &Path, name: &str, bytes: &[u8]) {
    std::fs::write(dir.join(name), bytes).unwrap();
}

/// A directory of rides, one repeated under another name, a zip holding a
/// ride, a nested zip and a gzipped ride, a truncated file and noise.
fn collection(dir: &Path) {
    write(dir, "a-outdoor.fit", &outdoor_ride().to_fit());
    let mut indoor = indoor_ride();
    indoor.start_unix += 1_800;
    write(dir, "b-indoor.fit", &indoor.to_fit());
    write(dir, "c-outdoor-again.fit", &outdoor_ride().to_fit());
    let nested = zip_of(&[("deep/ride.fit", ride_at(7_200))]);
    let archive = zip_of(&[
        ("one.fit", ride_at(3_600)),
        ("inner.zip", nested),
        ("gz.fit.gz", gzip(&ride_at(10_800))),
    ]);
    write(dir, "d-archive.zip", &archive);
    write(dir, "e-truncated.fit", &outdoor_ride().to_fit()[..600]);
    write(dir, "f-noise.fit", &noise(50_000));
}

fn keys(install: u64) -> Vec<String> {
    let mut keys = test_engine(install, |e| {
        e.db.prepare("SELECT activity_id FROM activity_bodies WHERE activity_id LIKE 'src-file-%'")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .map(Result::unwrap)
            .collect::<Vec<_>>()
    })
    .unwrap();
    keys.sort();
    keys
}

fn run(install: u64, path: &Path) -> Progress {
    import_with(install, path, &AtomicBool::new(false), |_| {}).expect("the walk finished")
}

/// Scenario: the athlete hands over a directory of rides, an archive of
/// archives and some files that are not rides.
///
/// Expected behaviour: every distinct ride is stored once under a key made from
/// its bytes, the repeat is already in the library, the damaged files are
/// failed against their keys, the curves are refreshed once for the batch, and
/// no sync census can remove what was stored.
#[test]
fn a_collection_stores_each_distinct_ride_once_and_refreshes_once() {
    let _serial = crate::test_globals::serial_global_state();
    let _dir = crate::test_globals::init_global_engine("import_collection.db");
    let install = crate::persistence::engine_install();
    let files = TempDir::new().unwrap();
    collection(files.path());
    crate::net::garmin::ingest::reset_finished_batches();

    let progress = run(install, files.path());

    assert_eq!(progress.stored, 5, "{progress:#?}");
    assert_eq!(progress.already_stored, 1);
    assert_eq!(progress.failed, 2);
    assert_eq!(progress.other_format, 0);
    assert_eq!(keys(install).len(), 5);
    assert_eq!(
        crate::net::garmin::ingest::finished_batches(),
        1,
        "one refresh for the whole collection"
    );
    assert_eq!(progress.failures.len(), 2);
    for failure in &progress.failures {
        let key = failure.key.as_deref().expect("a key");
        assert!(key.starts_with("src-file-"), "{failure:?}");
        assert!(!failure.reason.is_empty());
    }
    let stored_keys = keys(install);
    let (noted, kept) = test_engine(install, |e| {
        let noted = progress
            .failures
            .iter()
            .filter(|f| {
                crate::persistence::activity_sync_failures::of(&e.db, f.key.as_deref().unwrap())
                    .unwrap()
                    .is_some()
            })
            .count();
        let kept = stored_keys
            .iter()
            .filter(|k| {
                crate::persistence::originals::original_of(&e.db, k)
                    .unwrap()
                    .is_some()
            })
            .count();
        (noted, kept)
    })
    .unwrap();
    assert_eq!(noted, 2, "each failure is recorded against its key");
    assert_eq!(kept, 5, "each stored file is kept as the ride's original");

    let removed = test_engine(install, |e| {
        e.reconcile_against_census(&["i1".to_string()], "9999-12-31")
    })
    .unwrap();
    assert!(removed.is_empty(), "a census never names a file row");
    assert_eq!(keys(install).len(), 5);
}

/// Scenario: the same collection is imported again.
///
/// Expected behaviour: nothing new is stored, every ride that was stored is
/// already in the library, and the same files fail again.
#[test]
fn importing_a_collection_again_stores_nothing() {
    let _serial = crate::test_globals::serial_global_state();
    let _dir = crate::test_globals::init_global_engine("import_again.db");
    let install = crate::persistence::engine_install();
    let files = TempDir::new().unwrap();
    collection(files.path());
    run(install, files.path());

    let again = run(install, files.path());

    assert_eq!(again.stored, 0);
    assert_eq!(again.already_stored, 6);
    assert_eq!(again.failed, 2);
    assert_eq!(keys(install).len(), 5);
}

/// Scenario: a job is cancelled after two files and started again on the same
/// collection, and then a different collection is imported.
///
/// Expected behaviour: a cancel keeps what is stored, the second start goes on
/// at the third entry and stores the rest, and a different collection starts at
/// its first entry.
#[test]
fn a_cancelled_import_resumes_at_the_next_entry_of_the_same_collection() {
    let _serial = crate::test_globals::serial_global_state();
    let _dir = crate::test_globals::init_global_engine("import_resume.db");
    let install = crate::persistence::engine_install();
    let files = TempDir::new().unwrap();
    for i in 0..5 {
        write(files.path(), &format!("ride-{i}.fit"), &ride_at(i * 3_600));
    }
    let cancel = AtomicBool::new(false);

    let first = import_with(install, files.path(), &cancel, |progress| {
        if progress.seen == 2 {
            cancel.store(true, std::sync::atomic::Ordering::SeqCst);
        }
    });

    assert!(matches!(first, Err((Halt::Cancelled, _))));
    assert_eq!(keys(install).len(), 2, "what was stored stays");

    let second = run(install, files.path());

    assert_eq!(second.seen, 3, "the third entry is the first one read");
    assert_eq!(second.stored, 3);
    assert_eq!(keys(install).len(), 5);

    let other = TempDir::new().unwrap();
    for i in 0..3 {
        write(
            other.path(),
            &format!("x-{i}.fit"),
            &ride_at(100_000 + i * 3_600),
        );
    }
    let cancel = AtomicBool::new(false);
    let _ = import_with(install, other.path(), &cancel, |progress| {
        if progress.seen == 1 {
            cancel.store(true, std::sync::atomic::Ordering::SeqCst);
        }
    });
    let third = run(install, other.path());
    assert_eq!(
        third.seen, 2,
        "a cancelled collection resumes after its one file"
    );
    let unrelated = TempDir::new().unwrap();
    write(unrelated.path(), "only.fit", &ride_at(900_000));
    assert_eq!(
        run(install, unrelated.path()).seen,
        1,
        "a new collection starts clean"
    );
}

const RUN_START: i64 = 1_600_000_000;

fn iso(unix: i64) -> String {
    chrono::DateTime::from_timestamp(unix, 0)
        .unwrap()
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string()
}

/// A GPX of `points` fixes a second apart, a run by its type, with heart rate
/// in a prefixed extension when `timed` and no `time` elements when not.
fn gpx_of(points: i64, timed: bool) -> String {
    let mut out = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<gpx version=\"1.1\" creator=\"test\" \
         xmlns=\"http://www.topografix.com/GPX/1/1\" \
         xmlns:gpxtpx=\"http://www.garmin.com/xmlschemas/TrackPointExtension/v1\">\n\
         <trk><name>Morning</name><type>running</type><trkseg>\n",
    );
    for i in 0..points {
        let time = if timed {
            format!("<time>{}</time>", iso(RUN_START + i))
        } else {
            String::new()
        };
        out.push_str(&format!(
            "<trkpt lat=\"{:.6}\" lon=\"7.000000\"><ele>{}</ele>{time}\
             <extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>{}</gpxtpx:hr>\
             </gpxtpx:TrackPointExtension></extensions></trkpt>\n",
            46.0 + i as f64 * 0.0001,
            500 + i,
            140 + i
        ));
    }
    out.push_str("</trkseg></trk></gpx>\n");
    out
}

/// A TCX of `points` trackpoints a second apart, a ride by its sport.
fn tcx_of(points: i64) -> String {
    let mut out = String::from(
        "<?xml version=\"1.0\"?>\n<TrainingCenterDatabase \
         xmlns=\"http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2\">\n\
         <Activities><Activity Sport=\"Biking\"><Id>x</Id><Lap StartTime=\"2020-09-13T12:26:40Z\">\
         <Track>\n",
    );
    for i in 0..points {
        out.push_str(&format!(
            "<Trackpoint><Time>{}</Time><Position><LatitudeDegrees>{:.6}</LatitudeDegrees>\
             <LongitudeDegrees>8.000000</LongitudeDegrees></Position>\
             <AltitudeMeters>{}</AltitudeMeters><DistanceMeters>{}</DistanceMeters>\
             <HeartRateBpm><Value>{}</Value></HeartRateBpm><Cadence>85</Cadence>\
             <Extensions><TPX xmlns=\"http://www.garmin.com/xmlschemas/ActivityExtension/v2\">\
             <Watts>{}</Watts></TPX></Extensions></Trackpoint>\n",
            iso(RUN_START + 3_600 + i),
            47.0 + i as f64 * 0.0001,
            400 + i,
            i * 10,
            130 + i,
            200 + i
        ));
    }
    out.push_str("</Track></Lap></Activity></Activities></TrainingCenterDatabase>\n");
    out
}

/// Scenario: entries are named wrongly or are not rides.
///
/// Expected behaviour: a FIT with no `.fit` name is found by its header, a GPX
/// and a TCX are read by their root element whatever the file is named, an
/// unknown file is skipped and not failed, and a resource-fork entry is
/// ignored. A GPX or TCX with no points is failed with a reason.
#[test]
fn entries_are_classified_by_name_then_by_header() {
    let _serial = crate::test_globals::serial_global_state();
    let _dir = crate::test_globals::init_global_engine("import_classify.db");
    let install = crate::persistence::engine_install();
    let files = TempDir::new().unwrap();
    write(files.path(), "renamed.bin", &ride_at(0));
    write(files.path(), "track.gpx", b"<?xml version=\"1.0\"?><gpx/>");
    write(files.path(), "renamed.dat", gpx_of(5, true).as_bytes());
    write(
        files.path(),
        "session.TCX",
        b"<?xml version=\"1.0\"?><TrainingCenterDatabase/>",
    );
    write(files.path(), "notes.txt", b"a note");
    write(files.path(), "._renamed.fit", &noise(100));
    write(files.path(), "ride.FIT.GZ", &gzip(&ride_at(7_200)));

    let progress = run(install, files.path());

    assert_eq!(progress.stored, 3, "{progress:?}");
    assert_eq!(progress.other_format, 0);
    assert_eq!(progress.skipped, 1);
    assert_eq!(progress.failed, 2);
}

/// Scenario: an archive is a bomb: an entry inflates past the largest file the
/// import reads.
///
/// Expected behaviour: the entry is failed with a reason and the job goes on.
#[test]
fn an_entry_that_inflates_past_the_limit_is_failed_not_read() {
    let _serial = crate::test_globals::serial_global_state();
    let _dir = crate::test_globals::init_global_engine("import_bomb.db");
    let install = crate::persistence::engine_install();
    let files = TempDir::new().unwrap();
    let huge = gzip(&vec![0u8; walk::MAX_ENTRY_BYTES as usize + 1]);
    write(files.path(), "bomb.fit.gz", &huge);
    write(files.path(), "ride.fit", &ride_at(0));

    let progress = run(install, files.path());

    assert_eq!(progress.failed, 1);
    assert_eq!(progress.stored, 1);
}

/// Scenario: the Garmin pass and an import run at once.
///
/// Expected behaviour: one importer at a time, so the second is refused.
#[test]
fn only_one_import_runs_at_a_time() {
    let _serial = crate::test_globals::serial_global_state();
    let first = claim().expect("free");
    assert!(claim().is_none());
    drop(first);
    assert!(claim().is_some());
}

/// Scenario: the screen polls an import that is running, then one that ended,
/// and asks for a second import and a cancel in between.
///
/// Expected behaviour: a poll while the job runs reports running with the
/// counts so far, a second start is refused, a cancel ends the job at its next
/// file with the cancelled halt, and a poll after a finished job reports done
/// with the final counts and the failures by name.
#[test]
fn the_screen_reads_a_running_cancelled_and_finished_import() {
    use crate::ffi_types::{FfiImportHalt, FfiImportPhase, FfiImportProgress};
    let _serial = crate::test_globals::serial_global_state();
    let _dir = crate::test_globals::init_global_engine("import_progress.db");
    let install = crate::persistence::engine_install();

    assert_eq!(
        FfiImportProgress::from(Snapshot::default()).phase,
        FfiImportPhase::Idle
    );

    let files = TempDir::new().unwrap();
    for i in 0..40 {
        write(
            files.path(),
            &format!("ride-{i:02}.fit"),
            &ride_at(i * 3_600),
        );
    }
    assert!(start(install, files.path().to_path_buf()));
    assert!(
        !start(install, files.path().to_path_buf()),
        "a second job is refused while one runs"
    );
    let running = FfiImportProgress::from(progress_now());
    assert_eq!(running.phase, FfiImportPhase::Running);
    cancel();
    let cancelled = wait_until_ended();
    assert_eq!(cancelled.phase, FfiImportPhase::Cancelled);
    assert_eq!(cancelled.halt, Some(FfiImportHalt::Cancelled));
    assert!(cancelled.seen < 40, "the job ended before the last file");
    assert_eq!(cancelled.seen, cancelled.stored);

    let rest = TempDir::new().unwrap();
    write(rest.path(), "ride.fit", &ride_at(500_000));
    write(rest.path(), "broken.fit", &noise(50_000));
    assert!(start(install, rest.path().to_path_buf()));
    let done = wait_until_ended();
    assert_eq!(done.phase, FfiImportPhase::Done);
    assert_eq!(done.halt, None);
    assert_eq!((done.seen, done.stored, done.failed), (2, 1, 1));
    assert_eq!(done.failures.len(), 1);
    assert!(done.failures[0].name.ends_with("broken.fit"));
    assert!(!done.failures[0].reason.is_empty());
}

fn wait_until_ended() -> crate::ffi_types::FfiImportProgress {
    use crate::ffi_types::{FfiImportPhase, FfiImportProgress};
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
    loop {
        let read = FfiImportProgress::from(progress_now());
        if read.phase != FfiImportPhase::Running {
            return read;
        }
        assert!(std::time::Instant::now() < deadline, "the job never ended");
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}

fn device_ride(start_offset: i64, serial: u32, created: i64) -> Vec<u8> {
    let mut ride: Activity = outdoor_ride();
    ride.start_unix += start_offset;
    ride.device = Some((1, 3_990));
    ride.serial = Some(serial);
    ride.time_created = Some(created);
    ride.to_fit()
}

fn originals_held(install: u64) -> Vec<(String, usize)> {
    let mut held = test_engine(install, |e| {
        e.db.prepare("SELECT activity_id, raw_len FROM ride_originals")
            .unwrap()
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)? as usize))
            })
            .unwrap()
            .map(Result::unwrap)
            .collect::<Vec<_>>()
    })
    .unwrap();
    held.sort();
    held
}

/// Scenario: a platform exports a ride again, written by another program with
/// its own serial number and creation time and the session's start unchanged,
/// and the athlete imports both files. A different ride starts 61 s later.
///
/// Expected behaviour: the second file is counted as already in the library
/// and stores no row; the ride 61 s later is a row of its own.
#[test]
fn a_ride_written_again_with_the_same_start_is_one_row() {
    let _serial = crate::test_globals::serial_global_state();
    let _dir = crate::test_globals::init_global_engine("import_same_ride.db");
    let install = crate::persistence::engine_install();
    let files = TempDir::new().unwrap();
    write(
        files.path(),
        "a-device.fit",
        &device_ride(0, 3_912_345_678, 1_773_470_000),
    );
    write(
        files.path(),
        "b-exported.fit",
        &device_ride(0, 17, 1_773_479_999),
    );
    write(
        files.path(),
        "c-next.fit",
        &device_ride(61, 3_912_345_678, 1_773_480_500),
    );

    let progress = run(install, files.path());

    assert_eq!(progress.stored, 2, "{progress:#?}");
    assert_eq!(progress.already_stored, 1);
    assert_eq!(progress.ambiguous, 0);
    assert_eq!(keys(install).len(), 2);
}

/// Scenario: a head unit's own file and a copy of it that was started
/// differently (a trimmed start) share the device's serial number and creation
/// time.
///
/// Expected behaviour: the device pair decides before the start does, so the
/// copy is already in the library.
#[test]
fn the_same_device_pair_is_one_ride_whatever_the_start() {
    let _serial = crate::test_globals::serial_global_state();
    let _dir = crate::test_globals::init_global_engine("import_same_device.db");
    let install = crate::persistence::engine_install();
    let files = TempDir::new().unwrap();
    write(
        files.path(),
        "a.fit",
        &device_ride(0, 3_912_345_678, 1_773_470_000),
    );
    write(
        files.path(),
        "b.fit",
        &device_ride(600, 3_912_345_678, 1_773_470_000),
    );

    let progress = run(install, files.path());

    assert_eq!(progress.stored, 1, "{progress:#?}");
    assert_eq!(progress.already_stored, 1);
}

/// Scenario: the library already holds two rows that start within a minute of
/// each other, and a file is imported that starts between them.
///
/// Expected behaviour: neither row is chosen, so the file is stored as a row of
/// its own and counted as ambiguous.
#[test]
fn a_file_two_rows_could_be_stores_a_row_and_counts_the_ambiguity() {
    let _serial = crate::test_globals::serial_global_state();
    let _dir = crate::test_globals::init_global_engine("import_ambiguous.db");
    let install = crate::persistence::engine_install();
    let held = TempDir::new().unwrap();
    write(held.path(), "a.fit", &ride_at(-50));
    write(held.path(), "b.fit", &ride_at(50));
    assert_eq!(run(install, held.path()).stored, 2);

    let more = TempDir::new().unwrap();
    write(more.path(), "c.fit", &ride_at(0));
    let progress = run(install, more.path());

    assert_eq!(progress.stored, 1, "{progress:#?}");
    assert_eq!(progress.ambiguous, 1);
    assert_eq!(keys(install).len(), 3);
}

/// Scenario: a ride that intervals.icu already synced is imported as a file,
/// once as a copy that holds nothing more and once as a file with a message
/// the stored original lacks.
///
/// Expected behaviour: neither stores a row; the first is kept as the synced
/// row's original because it keeps none, the second replaces the kept one
/// because it holds more, and a third file that holds less changes nothing.
#[test]
fn a_synced_ride_keeps_the_fuller_file_as_its_original() {
    let _serial = crate::test_globals::serial_global_state();
    let _dir = crate::test_globals::init_global_engine("import_synced_ride.db");
    let install = crate::persistence::engine_install();
    let start = outdoor_ride().start_unix + 7_200;
    test_engine(install, |e| {
        e.db.execute(
            "INSERT INTO activity_bodies (activity_id, date, raw) VALUES ('i77', ?1, '{\"type\":\"Ride\"}')",
            [start],
        )
        .unwrap();
    })
    .unwrap();
    let plain = outdoor_ride().to_fit();
    let mut fuller = outdoor_ride();
    fuller.laps = vec![crate::fit_synthetic::Lap {
        start: 0,
        elapsed_secs: 30.0,
        ..Default::default()
    }];
    let fuller = fuller.to_fit();

    for (name, bytes, expected_len) in [
        ("1-plain.fit", &plain, plain.len()),
        ("2-fuller.fit", &fuller, fuller.len()),
        ("3-plain-again.fit", &ride_at(1), fuller.len()),
    ] {
        let files = TempDir::new().unwrap();
        write(files.path(), name, bytes);
        let progress = run(install, files.path());
        assert_eq!(progress.stored, 0, "{name}: {progress:#?}");
        assert_eq!(progress.already_stored, 1, "{name}");
        assert_eq!(
            originals_held(install),
            vec![("i77".to_string(), expected_len)],
            "{name}"
        );
    }
    assert!(keys(install).is_empty());
}

/// Scenario: a collection holds one GPX with heart rate in an extension and
/// one TCX with heart rate, cadence and power, ten points each, and a GPX
/// whose points carry no times.
///
/// Expected behaviour: the first two are stored as rows under file keys with a
/// track, a start from the first point, the sport the file names and the
/// original kept in its own format; the third is failed with a reason.
#[test]
fn gpx_and_tcx_files_are_stored_as_rides() {
    let _serial = crate::test_globals::serial_global_state();
    let _dir = crate::test_globals::init_global_engine("import_gpx_tcx.db");
    let install = crate::persistence::engine_install();
    let files = TempDir::new().unwrap();
    write(files.path(), "a-run.gpx", gpx_of(10, true).as_bytes());
    write(files.path(), "b-ride.tcx", tcx_of(10).as_bytes());
    write(files.path(), "c-untimed.gpx", gpx_of(10, false).as_bytes());

    let progress = run(install, files.path());

    assert_eq!(progress.stored, 2, "{progress:#?}");
    assert_eq!(progress.failed, 1);
    let failure = &progress.failures[0];
    assert!(failure.name.ends_with("c-untimed.gpx"));
    assert!(failure.reason.contains("timestamps"), "{failure:?}");
    let stored = keys(install);
    assert_eq!(stored.len(), 2);
    let rows = test_engine(install, |e| {
        stored
            .iter()
            .map(|key| {
                let (raw, format): (String, String) =
                    e.db.query_row(
                        "SELECT b.raw, o.format FROM activity_bodies b
                         JOIN ride_originals o ON o.activity_id = b.activity_id
                         WHERE b.activity_id = ?1",
                        [key],
                        |r| Ok((r.get(0)?, r.get(1)?)),
                    )
                    .unwrap();
                (
                    serde_json::from_str::<serde_json::Value>(&raw).unwrap(),
                    format,
                )
            })
            .collect::<Vec<_>>()
    })
    .unwrap();
    let find = |sport: &str| rows.iter().find(|(raw, _)| raw["type"] == sport).unwrap();
    let (run_raw, run_format) = find("Run");
    assert_eq!(run_format, "gpx");
    assert_eq!(
        run_raw["start_date_local"],
        iso(RUN_START).trim_end_matches('Z')
    );
    assert_eq!(run_raw["moving_time"], 9);
    assert!(run_raw["average_heartrate"].as_f64().unwrap() > 140.0);
    let (ride_raw, ride_format) = find("Ride");
    assert_eq!(ride_format, "tcx");
    assert_eq!(ride_raw["distance"], 90.0);
    assert!(ride_raw["icu_average_watts"].as_f64().unwrap() > 200.0);
    assert!(ride_raw["average_cadence"].as_f64().unwrap() > 80.0);
    let tracked = test_engine(install, |e| {
        stored
            .iter()
            .filter(|k| {
                e.db.query_row(
                    "SELECT count(*) FROM gps_tracks WHERE activity_id = ?1",
                    [k],
                    |r| r.get::<_, i64>(0),
                )
                .unwrap_or(0)
                    > 0
            })
            .count()
    })
    .unwrap();
    assert_eq!(tracked, 2, "each row has its track");

    let again = run(install, files.path());
    assert_eq!(again.stored, 0);
    assert_eq!(again.already_stored, 2, "the same bytes are one row");
}
