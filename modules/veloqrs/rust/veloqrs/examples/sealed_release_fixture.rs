//! Writes the sealed archive a released build produces, for the restore
//! fixture of that release.
//!
//! Run it from a checkout of the release tag, so the record writer, its record
//! version and the seal are the ones that shipped:
//!
//!   cargo run -p veloqrs --example sealed_release_fixture -- /tmp/work \
//!     tests/fixtures/sealed/releases/<release>.sealed
//!
//! Then add the release to `SEALED_RELEASES` in `tests/migration_support/mod.rs`.
//! The library is seeded with the same three settings and one section name
//! every time, and sealed with the fixed secret and randomness under
//! `tests/fixtures/sealed/v1/`, so two releases' archives differ only where the
//! writer does. Every name is invented, since the fixture is committed to a
//! public repository.

use std::io::Read;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use veloqrs::PersistentEngine;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::{RecordScope, engine_install, with_persistent_engine};

#[path = "../tests/migration_support/sealed.rs"]
mod sealed;

fn main() {
    let mut args = std::env::args().skip(1);
    let (Some(work), Some(output)) = (args.next(), args.next()) else {
        panic!("usage: sealed_release_fixture <empty work directory> <output.sealed>");
    };
    let work = std::path::PathBuf::from(work);
    std::fs::create_dir_all(&work).expect("create the work directory");
    let library = work.join("library.db");
    assert!(!library.exists(), "{} exists", library.display());

    let mut engine = PersistentEngine::new(library.to_str().expect("utf-8 path")).expect("open");
    sealed::seed_record(&mut engine);
    drop(engine);

    assert!(persistent_engine_init(
        library.to_str().expect("utf-8 path").to_string()
    ));
    let zip_path = work.join("record.zip");
    let handle = with_persistent_engine(|engine| {
        engine.record_backup_background(
            zip_path.to_str().expect("utf-8 path"),
            RecordScope::Whole,
            engine_install(),
            Arc::new(AtomicBool::new(false)),
        )
    })
    .expect("the engine is open");
    handle
        .recv_blocking()
        .expect("the backup worker answered")
        .expect("the record was written");

    let mut record_zip = Vec::new();
    std::fs::File::open(&zip_path)
        .expect("open the record zip")
        .read_to_end(&mut record_zip)
        .expect("read the record zip");
    let archive = sealed::seal_with_fixed_keys(&record_zip);
    std::fs::write(&output, &archive).expect("write the archive");
    println!("{output}: {} bytes", archive.len());
}
