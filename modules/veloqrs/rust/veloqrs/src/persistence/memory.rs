//! What the engine gives back when the OS asks the process for memory.
//!
//! Everything released here is rebuilt on demand: a parked reader is opened
//! again by the next read, a page cache refills from the file, an LRU entry is
//! recomputed on its next miss and a satellite raster is fetched again. So the
//! cost of a release is time on the next read and never data.
//!
//! Two levels, because the rebuilds are not equally cheap. Below the hard level
//! the connections give back memory, which costs a page read or an open, and
//! the section evidence cache goes when its stored row holds it, which costs
//! one decode on the next detect. The hard level is the last warning before
//! the process is killed, and there the caches go too: a recompute or a
//! refetch on return is the price of not being killed.

use rusqlite::Connection;

/// Give back what the engine holds in memory and can rebuild.
///
/// The engine connection is reached through the engine lock, so this waits for
/// a write in flight and belongs off the JS thread.
pub fn release_memory(hard: bool) {
    super::read_pool::release_idle();
    super::settings_conn::release_memory();
    super::read_cache::release_memory(hard);
    super::with_persistent_engine(|engine| {
        release_connection_memory(&engine.db, "PersistentEngine");
        engine.release_evidence_cache();
        if hard {
            engine.clear_memory_caches();
        }
    });
    if hard && let Some(store) = crate::basemap::store() {
        store.release_memory();
    }
}

/// Hand back one connection's page cache and whatever else SQLite can free
/// on it without closing it.
pub(crate) fn release_connection_memory(conn: &Connection, owner: &str) {
    if let Err(e) = conn.release_memory() {
        log::warn!("veloqrs: [{owner}] releasing connection memory: {e:?}");
    }
}

/// Bytes SQLite holds on the heap across every connection in the process:
/// page caches, schemas and prepared statements.
pub fn sqlite_heap_bytes() -> u64 {
    let mut current: i64 = 0;
    let mut highwater: i64 = 0;
    // SAFETY: both out-pointers are live locals, and the call only reads
    // SQLite's own status counters under its own mutex.
    let rc = unsafe {
        rusqlite::ffi::sqlite3_status64(
            rusqlite::ffi::SQLITE_STATUS_MEMORY_USED,
            &mut current,
            &mut highwater,
            0,
        )
    };
    if rc == rusqlite::ffi::SQLITE_OK {
        u64::try_from(current).unwrap_or(0)
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_globals::{init_global_engine, serial_global_state};
    use crate::with_persistent_engine;

    /// Stand the engine in the state an apply leaves: a fold in memory, and a
    /// row that either holds it or does not.
    fn hold_folded_cache(row_holds_it: bool) {
        with_persistent_engine(|e| {
            e.cache_folded_ids.insert("a1".to_string());
            e.evidence_cache_restored = true;
            e.evidence_row_current = row_holds_it;
        })
        .unwrap();
    }

    fn cache_resident() -> bool {
        with_persistent_engine(|e| e.evidence_cache_restored && !e.cache_folded_ids.is_empty())
            .unwrap()
    }

    /// Scenario: the app goes to the background after a detect. Expected
    /// behaviour: the release below the hard level already gives back an
    /// evidence cache the stored row holds, and keeps one it does not.
    #[test]
    fn a_background_release_drops_only_a_stored_evidence_cache() {
        let _guard = serial_global_state();
        let _tmp = init_global_engine("release_evidence.db");

        hold_folded_cache(false);
        release_memory(false);
        assert!(cache_resident(), "a fold no row holds was dropped");

        hold_folded_cache(true);
        release_memory(false);
        assert!(!cache_resident(), "a stored cache stayed resident");
    }
}
