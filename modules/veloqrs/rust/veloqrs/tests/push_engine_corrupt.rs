use std::fs;

use tempfile::TempDir;
use veloqrs::persistence::persistent_engine_ffi::open_for_push_if_closed;

#[test]
fn push_open_does_not_quarantine_the_database() {
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let bytes = b"invalid SQLite header";
    fs::write(&path, bytes).unwrap();

    assert_eq!(
        open_for_push_if_closed(path.to_string_lossy().into_owned()),
        None
    );
    assert_eq!(fs::read(&path).unwrap(), bytes);
    let names: Vec<_> = fs::read_dir(dir.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    assert!(names.iter().all(|name| !name.contains(".corrupt-")));
}
