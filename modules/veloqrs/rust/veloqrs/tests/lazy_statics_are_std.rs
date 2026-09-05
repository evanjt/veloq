//! One lazy static, `std::sync::LazyLock`.
//!
//! The crate had both: eight `once_cell::sync::Lazy` sites beside eleven std
//! `LazyLock` and `OnceLock` ones, which is a choice every new static has to
//! make and nothing to make it on. `LazyLock` has been stable since 1.80 and
//! this crate is edition 2024, so the external one buys nothing.
//!
//! Run: `cargo test --test lazy_statics_are_std -p veloqrs`

use std::fs;
use std::path::{Path, PathBuf};

fn crate_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn rust_sources(dir: &Path, found: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(dir).expect("read the source tree") {
        let path = entry.expect("entry").path();
        if path.is_dir() {
            rust_sources(&path, found);
        } else if path.extension().is_some_and(|e| e == "rs") {
            found.push(path);
        }
    }
}

#[test]
fn no_source_file_reaches_for_once_cell() {
    let mut sources = Vec::new();
    rust_sources(&crate_root().join("src"), &mut sources);
    rust_sources(&crate_root().join("tests"), &mut sources);
    assert!(sources.len() > 50, "the source sweep found almost nothing");

    // This file names the crate it bans, in the prose saying why.
    let guard = Path::new(file!()).file_name().expect("this file's name");
    let offenders: Vec<String> = sources
        .iter()
        .filter(|path| path.file_name() != Some(guard))
        .filter(|path| fs::read_to_string(path).is_ok_and(|s| s.contains("once_cell")))
        .map(|path| path.display().to_string())
        .collect();

    assert!(
        offenders.is_empty(),
        "these still use once_cell rather than std::sync::LazyLock: {offenders:?}"
    );
}

#[test]
fn the_manifest_does_not_declare_once_cell() {
    let manifest = fs::read_to_string(crate_root().join("Cargo.toml")).expect("Cargo.toml");
    let declared = manifest
        .lines()
        .map(str::trim)
        .any(|line| line.starts_with("once_cell ") || line.starts_with("once_cell="));

    assert!(!declared, "veloqrs/Cargo.toml still declares `once_cell`");
}
