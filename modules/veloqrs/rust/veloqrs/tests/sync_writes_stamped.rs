//! Scenario: a sync pass is between its fetch and its write when the athlete
//! restores a backup. `destroy` cancels cooperatively, so a pass already past
//! its last check is not stopped, and an unstamped write puts the old
//! library's rows into the restored database.
//!
//! Expected behaviour: every write the sync service makes goes through
//! `with_persistent_engine_blocking_for`, which discards the work when the
//! install it was fetched under is no longer the open one. The reads do not:
//! a read should see the engine that is open now.
//!
//! This is a source check rather than a behavioural one because the passes are
//! private async functions with a network transport in front of them, and the
//! property is "no site is left behind", which is a property of the file.

/// Engine methods that write. A closure naming one of these is a write, and a
/// write belongs to the install it was fetched under.
const WRITES: [&str; 13] = [
    ".upsert_", ".set_", ".record_", ".store_", ".delete_", ".clear_", ".insert_", ".mark_",
    ".retire_", ".prune_", ".update_", ".save_", ".remove_",
];

const SYNC: &str = include_str!("../src/objects/sync.rs");

/// The text of one call, from its opening parenthesis to the matching close,
/// so the closure body comes with it.
fn call_at(source: &str, open: usize) -> &str {
    let mut depth = 0usize;
    for (offset, ch) in source[open..].char_indices() {
        match ch {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    return &source[open..open + offset + 1];
                }
            }
            _ => {}
        }
    }
    &source[open..]
}

fn line_of(source: &str, at: usize) -> usize {
    source[..at].matches('\n').count() + 1
}

#[test]
fn every_sync_write_takes_the_stamped_engine() {
    let needle = "with_persistent_engine_blocking(";
    let mut unstamped_writes = Vec::new();
    let mut at = 0usize;
    while let Some(found) = SYNC[at..].find(needle) {
        let start = at + found;
        let open = start + needle.len() - 1;
        let body = call_at(SYNC, open);
        if let Some(write) = WRITES.iter().find(|w| body.contains(**w)) {
            unstamped_writes.push(format!(
                "objects/sync.rs:{} ({write})",
                line_of(SYNC, start)
            ));
        }
        at = open + 1;
    }

    assert!(
        unstamped_writes.is_empty(),
        "these sync writes take the unstamped engine, so a restore mid-pass \
         cannot discard them: {unstamped_writes:?}"
    );
}

/// The other half of the claim: the stamped helper is what the writes moved
/// to, rather than the sites having been deleted or the writes inlined.
#[test]
fn the_stamped_helper_is_used() {
    assert!(
        SYNC.matches("with_persistent_engine_blocking_for(install,")
            .count()
            >= 7,
        "the sync service should take the stamped engine for every write it makes"
    );
}
