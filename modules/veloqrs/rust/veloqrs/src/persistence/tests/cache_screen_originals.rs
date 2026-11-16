//! The storage readout counts the originals the engine keeps.

use super::cache_screen_data;
use crate::persistence::PersistentEngine;
use crate::persistence::originals::{drop_original, keep_original, originals_bytes};

fn engine() -> (tempfile::TempDir, PersistentEngine) {
    let dir = tempfile::TempDir::new().unwrap();
    let path = dir.path().join("routes.db");
    let engine = PersistentEngine::new(path.to_str().unwrap()).unwrap();
    (dir, engine)
}

/// Scenario: two originals are kept, then one is dropped.
///
/// Expected behaviour: the readout carries the bytes the originals owner
/// reports, none for an empty library, and follows a drop.
#[test]
fn the_storage_read_carries_the_bytes_the_originals_take() {
    let (_dir, engine) = engine();
    assert_eq!(
        cache_screen_data(&engine.db).unwrap().original_store_bytes,
        0.0
    );

    let body: Vec<u8> = (0..4096u32)
        .map(|n| (n.wrapping_mul(2_654_435_761) >> 24) as u8)
        .collect();
    keep_original(&engine.db, "src-a", "import", "fit", &body, 1).unwrap();
    keep_original(&engine.db, "src-b", "import", "fit", &body, 2).unwrap();

    let both = originals_bytes(&engine.db).unwrap();
    assert!(both > 0);
    assert_eq!(
        cache_screen_data(&engine.db).unwrap().original_store_bytes,
        both as f64
    );

    drop_original(&engine.db, "src-a").unwrap();
    let one = originals_bytes(&engine.db).unwrap();
    assert!(one < both);
    assert_eq!(
        cache_screen_data(&engine.db).unwrap().original_store_bytes,
        one as f64
    );
}
