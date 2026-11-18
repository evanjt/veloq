//! The spool a linked client reads a library export from.

use super::*;
use crate::remote::digest::sha256;
use crate::remote::import::STALE_AFTER;
use std::sync::mpsc;
use std::time::Duration;
use tempfile::TempDir;

const FIRST: &str = "sha-256 AA:AA";
const SECOND: &str = "sha-256 BB:BB";

fn unmeasured() -> FreeProbe {
    Arc::new(|| None)
}

/// A finished archive of `data` the build thread has already hashed.
fn built(data: &[u8], rides: u32) -> Built {
    Ok(Archive {
        result: result(rides),
        digest: Ok(sha256(&[data])),
    })
}

fn archive(len: usize) -> Vec<u8> {
    (0..len as u32).map(|n| (n * 7 % 251) as u8).collect()
}

fn result(rides: u32) -> LibraryExportResult {
    LibraryExportResult {
        rides,
        originals: 0,
        tables: 0,
        total_bytes: 0.0,
    }
}

/// A build the test finishes by sending on the returned end.
fn held_build(
    data: &[u8],
) -> (
    mpsc::Sender<Built>,
    impl FnOnce(&Path, Arc<BulkExportProgress>) -> Poll + use<>,
) {
    let (finish, finished) = mpsc::channel::<Built>();
    let data = data.to_vec();
    let start = move |dest: &Path, _: Arc<BulkExportProgress>| -> Poll {
        std::fs::write(dest, &data).unwrap();
        Box::new(move || finished.try_recv().ok())
    };
    (finish, start)
}

fn begin_ready(spools: &Mutex<Spools>, root: &Path, device: &str, data: &[u8]) -> (String, Status) {
    let (finish, start) = held_build(data);
    let id = spools
        .lock()
        .unwrap()
        .begin(root, device, unmeasured(), start)
        .unwrap();
    finish.send(built(data, 3)).unwrap();
    let status = status_shared(spools, device, &id).unwrap();
    (id, status)
}

fn read_all(spools: &Mutex<Spools>, device: &str, id: &str, from: u64, size: u64) -> Vec<u8> {
    let mut joined = Vec::new();
    let mut at = from;
    while at < size {
        let piece = read_shared(spools, device, id, at, MAX_READ).unwrap();
        at += piece.len() as u64;
        joined.extend(piece);
    }
    joined
}

#[test]
fn a_finished_export_reads_back_whole_and_matches_its_digest() {
    let root = TempDir::new().unwrap();
    let spools = Mutex::new(Spools::default());
    let data = archive(2 * MAX_READ as usize + 5);
    let (id, status) = begin_ready(&spools, root.path(), FIRST, &data);

    assert_eq!(status.state, "ready");
    assert_eq!(status.bytes, data.len() as u64);
    assert_eq!(status.rides, 3);
    let digest: String = sha256(&[&data])
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    assert_eq!(status.sha256.as_deref(), Some(digest.as_str()));

    let joined = read_all(&spools, FIRST, &id, 0, status.bytes);
    assert_eq!(joined, data);
}

#[test]
fn a_read_from_the_clients_own_count_after_a_dropped_link_joins_identical_bytes() {
    let root = TempDir::new().unwrap();
    let spools = Mutex::new(Spools::default());
    let data = archive(MAX_READ as usize + 1000);
    let (id, status) = begin_ready(&spools, root.path(), FIRST, &data);

    let half = data.len() as u64 / 2;
    let mut joined = Vec::new();
    joined.extend(read_shared(&spools, FIRST, &id, 0, half).unwrap());
    // The link drops, the client asks for the same id and digest again.
    let again = status_shared(&spools, FIRST, &id).unwrap();
    assert_eq!(again.sha256, status.sha256);
    joined.extend(read_all(&spools, FIRST, &id, half, status.bytes));
    assert_eq!(joined, data);
}

#[test]
fn a_read_is_clamped_to_the_end_and_past_it_or_too_long_is_an_error() {
    let root = TempDir::new().unwrap();
    let spools = Mutex::new(Spools::default());
    let data = archive(100);
    let (id, _) = begin_ready(&spools, root.path(), FIRST, &data);

    assert_eq!(
        read_shared(&spools, FIRST, &id, 90, 50).unwrap(),
        data[90..]
    );
    assert!(read_shared(&spools, FIRST, &id, 100, 1).is_err());
    assert!(read_shared(&spools, FIRST, &id, 1000, 1).is_err());
    assert!(read_shared(&spools, FIRST, &id, 0, 0).is_err());
    assert!(read_shared(&spools, FIRST, &id, 0, MAX_READ + 1).is_err());
}

#[test]
fn a_read_on_a_building_export_is_an_error_and_status_says_building() {
    let root = TempDir::new().unwrap();
    let spools = Mutex::new(Spools::default());
    let (_finish, start) = held_build(&archive(10));
    let id = spools
        .lock()
        .unwrap()
        .begin(root.path(), FIRST, unmeasured(), start)
        .unwrap();

    assert!(read_shared(&spools, FIRST, &id, 0, 10).is_err());
    let status = status_shared(&spools, FIRST, &id).unwrap();
    assert_eq!(status.state, "building");
    assert_eq!(status.sha256, None);
}

#[test]
fn a_second_begin_while_one_builds_is_busy_and_another_device_is_not() {
    let root = TempDir::new().unwrap();
    let spools = Mutex::new(Spools::default());
    let (_finish, start) = held_build(&archive(10));
    spools
        .lock()
        .unwrap()
        .begin(root.path(), FIRST, unmeasured(), start)
        .unwrap();

    let (_other, again) = held_build(&archive(10));
    let refused = spools
        .lock()
        .unwrap()
        .begin(root.path(), FIRST, unmeasured(), again)
        .unwrap_err();
    assert!(refused.starts_with("busy"), "{refused}");

    let (_third, other_device) = held_build(&archive(10));
    assert!(
        spools
            .lock()
            .unwrap()
            .begin(root.path(), SECOND, unmeasured(), other_device)
            .is_ok()
    );
}

#[test]
fn a_begin_over_a_finished_export_replaces_it_and_deletes_its_file() {
    let root = TempDir::new().unwrap();
    let spools = Mutex::new(Spools::default());
    let (old, _) = begin_ready(&spools, root.path(), FIRST, &archive(10));
    let old_file = spool_dir(root.path()).join(format!("{old}.zip"));
    assert!(old_file.exists());

    let (new, _) = begin_ready(&spools, root.path(), FIRST, &archive(20));
    assert_ne!(old, new);
    assert!(!old_file.exists());
    assert!(read_shared(&spools, FIRST, &old, 0, 1).is_err());
}

#[test]
fn another_device_cannot_read_or_end_an_export() {
    let root = TempDir::new().unwrap();
    let spools = Mutex::new(Spools::default());
    let (id, _) = begin_ready(&spools, root.path(), FIRST, &archive(10));

    assert!(read_shared(&spools, SECOND, &id, 0, 1).is_err());
    assert!(status_shared(&spools, SECOND, &id).is_err());
    assert!(spools.lock().unwrap().done(SECOND, &id).is_err());
    assert!(read_shared(&spools, FIRST, &id, 0, 1).is_ok());
}

#[test]
fn done_and_removing_the_device_delete_the_spool_file() {
    let root = TempDir::new().unwrap();
    let spools = Mutex::new(Spools::default());
    let (id, _) = begin_ready(&spools, root.path(), FIRST, &archive(10));
    let file = spool_dir(root.path()).join(format!("{id}.zip"));
    assert!(file.exists());
    spools.lock().unwrap().done(FIRST, &id).unwrap();
    assert!(!file.exists());
    assert!(spools.lock().unwrap().done(FIRST, &id).is_err());

    let (id, _) = begin_ready(&spools, root.path(), FIRST, &archive(10));
    let (_, _) = begin_ready(&spools, root.path(), SECOND, &archive(10));
    let file = spool_dir(root.path()).join(format!("{id}.zip"));
    spools.lock().unwrap().forget(FIRST);
    assert!(!file.exists());
    assert_eq!(spools.lock().unwrap().exports.len(), 1);
}

#[test]
fn forgetting_a_device_stops_its_build_and_deletes_the_partial_file() {
    let root = TempDir::new().unwrap();
    let spools = Mutex::new(Spools::default());
    let (_finish, start) = held_build(&archive(10));
    let id = spools
        .lock()
        .unwrap()
        .begin(root.path(), FIRST, unmeasured(), start)
        .unwrap();
    let part = spool_dir(root.path()).join(format!("{id}.zip.part"));
    assert!(part.exists());
    spools.lock().unwrap().forget(FIRST);
    assert!(!part.exists());
}

#[test]
fn a_failed_build_reports_failed_with_its_reason_and_leaves_no_file() {
    let root = TempDir::new().unwrap();
    let spools = Mutex::new(Spools::default());
    let (finish, start) = held_build(&archive(10));
    let id = spools
        .lock()
        .unwrap()
        .begin(root.path(), FIRST, unmeasured(), start)
        .unwrap();
    finish
        .send(Err("a table could not be read".into()))
        .unwrap();

    let status = status_shared(&spools, FIRST, &id).unwrap();
    assert_eq!(status.state, "failed");
    assert_eq!(status.error.as_deref(), Some("a table could not be read"));
    assert!(read_shared(&spools, FIRST, &id, 0, 1).is_err());
    assert!(
        !spool_dir(root.path())
            .join(format!("{id}.zip.part"))
            .exists()
    );
}

#[test]
fn a_begin_without_room_beyond_the_margin_is_refused() {
    let root = TempDir::new().unwrap();
    let mut spools = Spools::default();
    let (_finish, start) = held_build(&archive(10));
    let refused = spools
        .begin(
            root.path(),
            FIRST,
            Arc::new(|| Some(FREE_SPACE_MARGIN)),
            start,
        )
        .unwrap_err();
    assert!(refused.contains("free space"), "{refused}");
}

#[test]
fn sweep_deletes_a_day_old_spool_and_keeps_a_fresh_one() {
    let root = TempDir::new().unwrap();
    let spools = Mutex::new(Spools::default());
    let (stale, _) = begin_ready(&spools, root.path(), FIRST, &archive(10));
    let (fresh, _) = begin_ready(&spools, root.path(), SECOND, &archive(10));
    let stale_file = spool_dir(root.path()).join(format!("{stale}.zip"));
    let fresh_file = spool_dir(root.path()).join(format!("{fresh}.zip"));

    let now = SystemTime::now() + STALE_AFTER + Duration::from_secs(60);
    File::options()
        .write(true)
        .open(&fresh_file)
        .unwrap()
        .set_modified(now - Duration::from_secs(60))
        .unwrap();
    assert_eq!(sweep(root.path(), now), 1);
    assert!(!stale_file.exists());
    assert!(fresh_file.exists());
}

#[test]
fn reading_a_spool_counts_as_using_it_so_a_sweep_keeps_it() {
    let root = TempDir::new().unwrap();
    let spools = Mutex::new(Spools::default());
    let (id, _) = begin_ready(&spools, root.path(), FIRST, &archive(10));
    let file = spool_dir(root.path()).join(format!("{id}.zip"));
    File::options()
        .write(true)
        .open(&file)
        .unwrap()
        .set_modified(SystemTime::now() - STALE_AFTER - Duration::from_secs(3600))
        .unwrap();

    read_shared(&spools, FIRST, &id, 0, 1).unwrap();
    assert_eq!(sweep(root.path(), SystemTime::now()), 0);
    assert!(file.exists());
}

/// Scenario: a library holds an export spool and is wiped.
/// Expected behaviour: the spool file and its directory are gone, and the
/// registry no longer lists the export.
#[test]
fn clear_deletes_every_spool_of_a_library_export() {
    let root = TempDir::new().unwrap();
    let db_path = root.path().join("routes.db");
    let mut engine = crate::persistence::PersistentEngine::new(db_path.to_str().unwrap()).unwrap();
    let spools = Mutex::new(Spools::default());
    let (id, _) = begin_ready(&spools, root.path(), FIRST, &archive(10));
    let file = spool_dir(root.path()).join(format!("{id}.zip"));
    assert!(file.exists());

    engine.clear().unwrap();

    assert!(!file.exists());
    assert!(!spool_dir(root.path()).exists());
}

/// Scenario: the volume holding the spools drops to the margin while the
/// writer is between rides.
/// Expected behaviour: the build reports failed and no partial file stays.
#[test]
fn a_build_that_outgrows_the_free_space_fails_and_leaves_no_file() {
    use std::sync::atomic::AtomicU64;
    let root = TempDir::new().unwrap();
    let mut spools = Spools::default();
    let free = Arc::new(AtomicU64::new(FREE_SPACE_MARGIN + 1024));
    let probe_free = Arc::clone(&free);
    let probe: FreeProbe = Arc::new(move || Some(probe_free.load(Ordering::SeqCst)));
    let (stopped, saw_stop) = mpsc::channel::<Option<String>>();
    let writer_free = Arc::clone(&free);
    let id = spools
        .begin(root.path(), FIRST, probe, move |dest, progress| {
            std::fs::write(dest, archive(100)).unwrap();
            assert_eq!(progress.stop_reason(), None);
            // The writer fills the volume, then reaches its next ride.
            writer_free.store(FREE_SPACE_MARGIN, Ordering::SeqCst);
            let reason = progress.stop_reason();
            let outcome: Built = Err(reason.clone().unwrap_or_default());
            std::fs::remove_file(dest).unwrap();
            stopped.send(reason).unwrap();
            let mut outcome = Some(outcome);
            Box::new(move || outcome.take())
        })
        .unwrap();
    assert!(saw_stop.recv().unwrap().is_some());

    let spools = Mutex::new(spools);
    let status = status_shared(&spools, FIRST, &id).unwrap();
    assert_eq!(status.state, "failed");
    assert!(status.error.unwrap().contains("free space"));
    let dir = spool_dir(root.path());
    assert_eq!(std::fs::read_dir(dir).unwrap().count(), 0);
}

/// Expected behaviour: the digest on a ready export is the one the build
/// thread supplied, so `export.status` reads nothing of the archive. The
/// supplied digest differs from the file's, so a hash on the calling thread
/// would show.
#[test]
fn status_on_a_ready_export_reports_the_builds_digest_without_hashing() {
    let root = TempDir::new().unwrap();
    let spools = Mutex::new(Spools::default());
    let (finish, start) = held_build(&archive(50));
    let id = spools
        .lock()
        .unwrap()
        .begin(root.path(), FIRST, unmeasured(), start)
        .unwrap();
    finish
        .send(Ok(Archive {
            result: result(1),
            digest: Ok([0xAB; 32]),
        }))
        .unwrap();

    let status = status_shared(&spools, FIRST, &id).unwrap();
    assert_eq!(status.state, "ready");
    assert_eq!(status.sha256, Some("ab".repeat(32)));
    assert_eq!(status.bytes, 50);
}

#[test]
fn a_digest_that_could_not_be_read_fails_the_export_and_deletes_the_file() {
    let root = TempDir::new().unwrap();
    let spools = Mutex::new(Spools::default());
    let (finish, start) = held_build(&archive(10));
    let id = spools
        .lock()
        .unwrap()
        .begin(root.path(), FIRST, unmeasured(), start)
        .unwrap();
    finish
        .send(Ok(Archive {
            result: result(1),
            digest: Err(std::io::Error::other("unreadable")),
        }))
        .unwrap();

    let status = status_shared(&spools, FIRST, &id).unwrap();
    assert_eq!(status.state, "failed");
    assert_eq!(
        std::fs::read_dir(spool_dir(root.path())).unwrap().count(),
        0
    );
}
