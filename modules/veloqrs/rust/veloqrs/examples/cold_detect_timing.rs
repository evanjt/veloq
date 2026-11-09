//! Times a cold section detect over the private corpus, from spawn to apply.
//!
//! Each repeat builds a fresh engine, stores every track, starts the detect
//! worker the way a forced re-detect does with no processed set and no
//! evidence cache, waits for it, applies the result and prints the wall time.
//!
//!     cargo run --release -p veloqrs --example cold_detect_timing -- 3

use std::time::Instant;

use tempfile::TempDir;
use veloqrs::PersistentEngine;
use veloqrs::persistence::WorkerPoll;

#[path = "../../tracematch/tests/corpus/mod.rs"]
mod corpus;

const CORPUS: &str = "fullcorpus";

fn main() {
    let repeats: usize = std::env::args()
        .nth(1)
        .and_then(|n| n.parse().ok())
        .unwrap_or(3);
    let (tracks, starts, _) = corpus::load_tracks(CORPUS, 1000);
    let points: usize = tracks.iter().map(|(_, t)| t.len()).sum();
    println!("corpus: {} tracks, {points} points", tracks.len());

    for repeat in 1..=repeats {
        let dir = TempDir::new().expect("tempdir");
        let mut engine =
            PersistentEngine::new(dir.path().join("cold.db").to_str().unwrap()).expect("engine");
        let store = Instant::now();
        for (id, track) in &tracks {
            engine
                .add_activity(id.to_string(), track.clone(), "Ride".to_string())
                .expect("add_activity");
            engine
                .update_activity_metadata(id, starts.get(id).copied(), None, None, None)
                .expect("update_activity_metadata");
        }
        let store_ms = store.elapsed().as_millis();

        let spawn = Instant::now();
        let handle = engine.detect_sections_background();
        let (main, cache) = handle.recv_state_with_cache();
        let fold_ms = spawn.elapsed().as_millis();
        let WorkerPoll::Ready((sections, processed)) = main else {
            panic!("the cold detect did not finish");
        };
        let count = sections.len();
        engine
            .apply_sections_with_cache(sections, cache)
            .expect("apply");
        engine
            .save_processed_activity_ids(&processed)
            .expect("processed");
        let total_ms = spawn.elapsed().as_millis();
        println!(
            "repeat {repeat}: store {store_ms} ms, fold {fold_ms} ms, spawn-to-apply {total_ms} ms, {count} sections, {} processed",
            processed.len()
        );
    }
}
