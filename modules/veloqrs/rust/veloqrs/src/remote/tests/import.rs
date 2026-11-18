//! The spool a linked browser's collection is written to, frame by frame.

use super::*;
use crate::remote::digest::sha256;
use tempfile::TempDir;

const FIRST: &str = "sha-256 AA:AA";
const SECOND: &str = "sha-256 BB:BB";

fn bytes(len: usize) -> Vec<u8> {
    (0..len as u32).map(|n| (n * 7 % 251) as u8).collect()
}

fn hex_of(data: &[u8]) -> String {
    sha256(&[data])
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn frame(id: u32, seq: u32, payload: &[u8]) -> Vec<u8> {
    let mut frame = vec![1, 0];
    frame.extend_from_slice(&id.to_be_bytes());
    frame.extend_from_slice(&seq.to_be_bytes());
    frame.extend_from_slice(payload);
    frame
}

fn ask(name: &str, data: &[u8]) -> Begin {
    Begin {
        name: name.into(),
        size: data.len() as u64,
        sha256: hex_of(data),
    }
}

fn send(spools: &mut Spools, browser: &str, id: u32, data: &[u8]) {
    for (seq, piece) in data.chunks(MAX_PAYLOAD).enumerate() {
        let outcome = spools.frame(browser, &frame(id, seq as u32, piece));
        assert_eq!(outcome, Frame::Appended, "frame {seq}");
    }
}

fn spool_of(root: &Path, data: &[u8]) -> PathBuf {
    root.join(IMPORTS).join(format!("{}.part", hex_of(data)))
}

#[test]
fn three_frames_then_a_commit_with_the_right_digest_hand_over_the_whole_file() {
    let root = TempDir::new().unwrap();
    let data = bytes(3 * MAX_PAYLOAD);
    let mut spools = Spools::default();
    let begun = spools
        .begin(root.path(), FIRST, &ask("rides.zip", &data))
        .unwrap();
    assert_eq!(begun.offset, 0);
    send(&mut spools, FIRST, begun.import_id, &data);
    assert_eq!(
        std::fs::metadata(spool_of(root.path(), &data))
            .unwrap()
            .len(),
        (3 * MAX_PAYLOAD) as u64
    );

    let mut handed = None;
    let id = begun.import_id;
    spools
        .commit(FIRST, id, |path| {
            handed = Some((path.to_path_buf(), std::fs::read(path).unwrap()));
            Ok(())
        })
        .unwrap();

    let (path, seen) = handed.expect("the job was handed the file");
    assert_eq!(seen, data);
    assert!(path.to_string_lossy().ends_with(".zip"), "{path:?}");
    assert!(!spool_of(root.path(), &data).exists());
}

#[test]
fn a_commit_with_the_wrong_digest_stores_nothing_and_leaves_no_spool() {
    let root = TempDir::new().unwrap();
    let data = bytes(3 * MAX_PAYLOAD);
    let mut spools = Spools::default();
    let begun = spools
        .begin(root.path(), FIRST, &ask("rides.zip", &data))
        .unwrap();
    let mut damaged = data.clone();
    damaged[100] ^= 0xff;
    send(&mut spools, FIRST, begun.import_id, &damaged);

    let mut started = false;
    let refused = spools.commit(FIRST, begun.import_id, |_| {
        started = true;
        Ok(())
    });

    assert!(refused.is_err());
    assert!(!started);
    assert_eq!(
        std::fs::read_dir(root.path().join(IMPORTS))
            .unwrap()
            .count(),
        0
    );
    assert!(spools.commit(FIRST, begun.import_id, |_| Ok(())).is_err());
}

#[test]
fn a_commit_before_every_byte_arrived_keeps_the_spool() {
    let root = TempDir::new().unwrap();
    let data = bytes(3 * MAX_PAYLOAD);
    let mut spools = Spools::default();
    let begun = spools
        .begin(root.path(), FIRST, &ask("rides.zip", &data))
        .unwrap();
    send(&mut spools, FIRST, begun.import_id, &data[..MAX_PAYLOAD]);

    assert!(spools.commit(FIRST, begun.import_id, |_| Ok(())).is_err());
    assert_eq!(
        std::fs::metadata(spool_of(root.path(), &data))
            .unwrap()
            .len(),
        MAX_PAYLOAD as u64
    );
}

#[test]
fn a_frame_for_an_unknown_id_or_out_of_order_changes_nothing() {
    let root = TempDir::new().unwrap();
    let data = bytes(3 * MAX_PAYLOAD);
    let mut spools = Spools::default();
    let begun = spools
        .begin(root.path(), FIRST, &ask("rides.zip", &data))
        .unwrap();
    let id = begun.import_id;
    send(&mut spools, FIRST, id, &data[..MAX_PAYLOAD]);
    let before = std::fs::read(spool_of(root.path(), &data)).unwrap();

    let piece = &data[MAX_PAYLOAD..2 * MAX_PAYLOAD];
    assert!(matches!(
        spools.frame(FIRST, &frame(id + 1, 1, piece)),
        Frame::Dropped(_)
    ));
    assert!(matches!(
        spools.frame(FIRST, &frame(id, 2, piece)),
        Frame::Dropped(_)
    ));
    assert!(matches!(
        spools.frame(FIRST, &frame(id, 0, piece)),
        Frame::Dropped(_)
    ));
    assert_eq!(std::fs::read(spool_of(root.path(), &data)).unwrap(), before);
    assert_eq!(spools.dropped(), 3);

    assert_eq!(spools.frame(FIRST, &frame(id, 1, piece)), Frame::Appended);
}

#[test]
fn a_frame_that_is_not_one_is_dropped() {
    let root = TempDir::new().unwrap();
    let data = bytes(2 * MAX_PAYLOAD);
    let mut spools = Spools::default();
    let id = spools
        .begin(root.path(), FIRST, &ask("rides.zip", &data))
        .unwrap()
        .import_id;
    let too_long = bytes(MAX_PAYLOAD + 1);
    let mut wrong_version = frame(id, 0, &data[..10]);
    wrong_version[0] = 2;
    for refused in [
        frame(id, 0, &too_long),
        frame(id, 0, &[]),
        wrong_version,
        vec![1, 0, 0],
    ] {
        assert!(matches!(spools.frame(FIRST, &refused), Frame::Dropped(_)));
    }
    let past_the_end = bytes(MAX_PAYLOAD);
    spools.frame(FIRST, &frame(id, 0, &past_the_end));
    spools.frame(FIRST, &frame(id, 1, &past_the_end));
    assert!(matches!(
        spools.frame(FIRST, &frame(id, 2, &[1])),
        Frame::Dropped(_)
    ));
}

#[test]
fn a_begin_again_after_three_frames_answers_the_bytes_already_there() {
    let root = TempDir::new().unwrap();
    let data = bytes(5 * MAX_PAYLOAD + 123);
    let mut spools = Spools::default();
    let first = spools
        .begin(root.path(), FIRST, &ask("rides.zip", &data))
        .unwrap();
    send(
        &mut spools,
        FIRST,
        first.import_id,
        &data[..3 * MAX_PAYLOAD],
    );

    let again = spools
        .begin(root.path(), FIRST, &ask("rides.zip", &data))
        .unwrap();
    assert_eq!(again.offset, 3 * MAX_PAYLOAD as u64);
    assert_eq!(again.offset, 49_152);
    assert_ne!(again.import_id, first.import_id);

    let late = &data[3 * MAX_PAYLOAD..4 * MAX_PAYLOAD];
    assert!(matches!(
        spools.frame(FIRST, &frame(first.import_id, 0, late)),
        Frame::Dropped(_)
    ));
    for (seq, piece) in data[again.offset as usize..]
        .chunks(MAX_PAYLOAD)
        .enumerate()
    {
        assert_eq!(
            spools.frame(FIRST, &frame(again.import_id, seq as u32, piece)),
            Frame::Appended
        );
    }
    let committed = spools.commit(FIRST, again.import_id, |path| {
        assert_eq!(std::fs::read(path).unwrap(), data);
        Ok(())
    });
    assert!(committed.is_ok());
}

#[test]
fn a_spool_survives_a_restart_of_the_registry() {
    let root = TempDir::new().unwrap();
    let data = bytes(4 * MAX_PAYLOAD);
    let mut spools = Spools::default();
    let first = spools
        .begin(root.path(), FIRST, &ask("rides.zip", &data))
        .unwrap();
    send(
        &mut spools,
        FIRST,
        first.import_id,
        &data[..2 * MAX_PAYLOAD],
    );

    let mut after_restart = Spools::default();
    let again = after_restart
        .begin(root.path(), FIRST, &ask("rides.zip", &data))
        .unwrap();
    assert_eq!(again.offset, 2 * MAX_PAYLOAD as u64);
}

#[test]
fn a_frame_from_another_browser_for_the_first_ones_import_is_dropped() {
    let root = TempDir::new().unwrap();
    let data = bytes(2 * MAX_PAYLOAD);
    let mut spools = Spools::default();
    let begun = spools
        .begin(root.path(), FIRST, &ask("rides.zip", &data))
        .unwrap();
    let id = begun.import_id;

    assert!(matches!(
        spools.frame(SECOND, &frame(id, 0, &data[..MAX_PAYLOAD])),
        Frame::Dropped(_)
    ));
    assert_eq!(
        std::fs::metadata(spool_of(root.path(), &data))
            .unwrap()
            .len(),
        0
    );
    assert!(spools.commit(SECOND, id, |_| Ok(())).is_err());
    assert!(spools.cancel(SECOND, id).is_err());
    assert!(spool_of(root.path(), &data).exists());
}

#[test]
fn a_forgotten_browser_loses_its_imports_and_their_spools_and_no_other_browsers() {
    let root = TempDir::new().unwrap();
    let removed = bytes(2 * MAX_PAYLOAD);
    let kept = bytes(MAX_PAYLOAD + 5);
    let mut spools = Spools::default();
    let gone = spools
        .begin(root.path(), FIRST, &ask("rides.zip", &removed))
        .unwrap()
        .import_id;
    send(&mut spools, FIRST, gone, &removed[..MAX_PAYLOAD]);
    let still = spools
        .begin(root.path(), SECOND, &ask("rides.zip", &kept))
        .unwrap()
        .import_id;
    send(&mut spools, SECOND, still, &kept[..MAX_PAYLOAD]);

    spools.forget(FIRST);

    assert!(!spool_of(root.path(), &removed).exists());
    assert!(matches!(
        spools.frame(FIRST, &frame(gone, 1, &removed[MAX_PAYLOAD..])),
        Frame::Dropped(_)
    ));
    assert!(spools.commit(FIRST, gone, |_| Ok(())).is_err());
    assert_eq!(
        spools.frame(SECOND, &frame(still, 1, &kept[MAX_PAYLOAD..])),
        Frame::Appended
    );
    assert!(spool_of(root.path(), &kept).exists());
}

#[test]
fn a_cancel_deletes_the_spool() {
    let root = TempDir::new().unwrap();
    let data = bytes(2 * MAX_PAYLOAD);
    let mut spools = Spools::default();
    let begun = spools
        .begin(root.path(), FIRST, &ask("rides.zip", &data))
        .unwrap();
    send(&mut spools, FIRST, begun.import_id, &data[..MAX_PAYLOAD]);

    spools.cancel(FIRST, begun.import_id).unwrap();

    assert!(!spool_of(root.path(), &data).exists());
    assert_eq!(
        spools
            .begin(root.path(), FIRST, &ask("rides.zip", &data))
            .unwrap()
            .offset,
        0
    );
}

#[test]
fn a_begin_names_what_it_will_send() {
    let root = TempDir::new().unwrap();
    let data = bytes(100);
    let mut spools = Spools::default();
    let good = ask("Rides.ZIP", &data);
    assert!(spools.begin(root.path(), FIRST, &good).is_ok());
    for refused in [
        Begin {
            sha256: "abc".into(),
            ..ask("a.zip", &data)
        },
        Begin {
            sha256: "G".repeat(64),
            ..ask("a.zip", &data)
        },
        Begin {
            sha256: hex_of(&data).to_uppercase(),
            ..ask("a.zip", &data)
        },
        Begin {
            size: 0,
            ..ask("a.zip", &data)
        },
        Begin {
            size: MAX_BYTES + 1,
            ..ask("a.zip", &data)
        },
        ask("notes.txt", &data),
        ask("", &data),
    ] {
        assert!(
            spools.begin(root.path(), FIRST, &refused).is_err(),
            "{refused:?}"
        );
    }
}

#[test]
fn a_spool_longer_than_its_begin_says_starts_again() {
    let root = TempDir::new().unwrap();
    let data = bytes(100);
    std::fs::create_dir_all(root.path().join(IMPORTS)).unwrap();
    std::fs::write(spool_of(root.path(), &data), bytes(500)).unwrap();
    let mut spools = Spools::default();
    let begun = spools
        .begin(root.path(), FIRST, &ask("a.zip", &data))
        .unwrap();
    assert_eq!(begun.offset, 0);
}

#[test]
fn a_spool_nobody_committed_is_swept_after_a_day_and_a_young_one_is_not() {
    let root = TempDir::new().unwrap();
    let dir = root.path().join(IMPORTS);
    std::fs::create_dir_all(&dir).unwrap();
    let old = dir.join("old.part");
    let young = dir.join("young.part");
    std::fs::write(&old, b"x").unwrap();
    std::fs::write(&young, b"y").unwrap();
    let now = std::time::SystemTime::now();
    std::fs::File::options()
        .write(true)
        .open(&old)
        .unwrap()
        .set_modified(now - STALE_AFTER - std::time::Duration::from_secs(60))
        .unwrap();

    assert_eq!(sweep(root.path(), now), 1);

    assert!(!old.exists());
    assert!(young.exists());
    assert_eq!(sweep(root.path().join("absent").as_path(), now), 0);
}

#[test]
fn a_frame_for_another_import_is_appended_while_a_commit_hashes() {
    use std::sync::mpsc::channel;
    use std::sync::{Arc, Mutex};

    let root = TempDir::new().unwrap();
    let first = bytes(2 * MAX_PAYLOAD);
    let second = bytes(3 * MAX_PAYLOAD + 5);
    let registry = Arc::new(Mutex::new(Spools::default()));
    let (first_id, second_id) = {
        let mut spools = registry.lock().unwrap();
        let first_id = spools
            .begin(root.path(), FIRST, &ask("a.zip", &first))
            .unwrap()
            .import_id;
        send(&mut spools, FIRST, first_id, &first);
        let second_id = spools
            .begin(root.path(), SECOND, &ask("b.zip", &second))
            .unwrap()
            .import_id;
        (first_id, second_id)
    };

    let (hashing_tx, hashing_rx) = channel();
    let (release_tx, release_rx) = channel::<()>();
    let committer = {
        let registry = Arc::clone(&registry);
        std::thread::spawn(move || {
            commit_shared(
                &registry,
                FIRST,
                first_id,
                |path| {
                    hashing_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                    digest_of(path)
                },
                |_| Ok(()),
            )
        })
    };
    hashing_rx.recv().unwrap();

    let outcome = {
        let mut spools = registry.lock().unwrap();
        spools.frame(SECOND, &frame(second_id, 0, &second[..MAX_PAYLOAD]))
    };
    assert_eq!(outcome, Frame::Appended);

    release_tx.send(()).unwrap();
    committer.join().unwrap().unwrap();
}

#[test]
fn a_commit_that_the_job_refuses_puts_the_import_back_for_a_later_commit() {
    use std::sync::Mutex;

    let root = TempDir::new().unwrap();
    let data = bytes(2 * MAX_PAYLOAD);
    let registry = Mutex::new(Spools::default());
    let id = {
        let mut spools = registry.lock().unwrap();
        let id = spools
            .begin(root.path(), FIRST, &ask("a.zip", &data))
            .unwrap()
            .import_id;
        send(&mut spools, FIRST, id, &data);
        id
    };

    let refused = commit_shared(&registry, FIRST, id, digest_of, |_| Err("busy".into()));
    assert_eq!(refused, Err("busy".to_owned()));
    assert!(spool_of(root.path(), &data).exists());

    let handed = commit_shared(&registry, FIRST, id, digest_of, |_| Ok(()));
    assert!(handed.is_ok());
}

#[test]
fn a_second_begin_from_one_browser_for_another_archive_is_refused() {
    let root = TempDir::new().unwrap();
    let first = bytes(2 * MAX_PAYLOAD);
    let second = bytes(3 * MAX_PAYLOAD);
    let mut spools = Spools::default();
    spools
        .begin(root.path(), FIRST, &ask("rides.zip", &first))
        .unwrap();

    assert!(
        spools
            .begin(root.path(), FIRST, &ask("more.zip", &second))
            .is_err()
    );
    assert!(!spool_of(root.path(), &second).exists());
    assert_eq!(spools.imports.len(), 1);
}

#[test]
fn another_browser_may_begin_its_own_import() {
    let root = TempDir::new().unwrap();
    let first = bytes(2 * MAX_PAYLOAD);
    let second = bytes(3 * MAX_PAYLOAD);
    let mut spools = Spools::default();
    spools
        .begin(root.path(), FIRST, &ask("rides.zip", &first))
        .unwrap();
    assert!(
        spools
            .begin(root.path(), SECOND, &ask("more.zip", &second))
            .is_ok()
    );
}

#[test]
fn a_begin_that_ends_and_another_may_follow() {
    let root = TempDir::new().unwrap();
    let first = bytes(2 * MAX_PAYLOAD);
    let second = bytes(3 * MAX_PAYLOAD);
    let mut spools = Spools::default();
    let begun = spools
        .begin(root.path(), FIRST, &ask("rides.zip", &first))
        .unwrap();
    spools.cancel(FIRST, begun.import_id).unwrap();
    assert!(
        spools
            .begin(root.path(), FIRST, &ask("more.zip", &second))
            .is_ok()
    );
}

#[test]
fn a_begin_larger_than_free_space_less_the_margin_is_refused() {
    let root = TempDir::new().unwrap();
    let data = bytes(3 * MAX_PAYLOAD);
    let ask = ask("rides.zip", &data);
    let mut spools = Spools::default();

    let tight = data.len() as u64 + FREE_SPACE_MARGIN - 1;
    assert!(
        spools
            .begin_with_free(root.path(), FIRST, &ask, Some(tight))
            .is_err()
    );
    assert!(!spool_of(root.path(), &data).exists());
    assert!(spools.imports.is_empty());

    let enough = data.len() as u64 + FREE_SPACE_MARGIN;
    assert!(
        spools
            .begin_with_free(root.path(), FIRST, &ask, Some(enough))
            .is_ok()
    );
}

#[test]
fn a_resumed_begin_needs_room_only_for_the_bytes_still_to_come() {
    let root = TempDir::new().unwrap();
    let data = bytes(4 * MAX_PAYLOAD);
    let mut spools = Spools::default();
    let begun = spools
        .begin_with_free(root.path(), FIRST, &ask("rides.zip", &data), None)
        .unwrap();
    send(
        &mut spools,
        FIRST,
        begun.import_id,
        &data[..2 * MAX_PAYLOAD],
    );

    let room = 2 * MAX_PAYLOAD as u64 + FREE_SPACE_MARGIN;
    assert!(
        spools
            .begin_with_free(root.path(), FIRST, &ask("rides.zip", &data), Some(room))
            .is_ok()
    );
}
