//! Persistence integration stress tests.
//!
//! Tests the full pipeline: SQLite ingest -> section detection -> query.
//! Uses synthetic data from tracematch for deterministic, scalable testing.
//!
//! Run with: `cd modules/veloqrs/rust/veloqrs && cargo test --test persistence_stress`
//! (requires tracematch synthetic feature, enabled via dev-dependencies)
//!
//! Heavy tests are `#[ignore]` by default. Run them with:
//!   `cargo test --test persistence_stress -- --ignored --nocapture`
//! Or in release mode (recommended):
//!   `cargo test --test persistence_stress --release -- --ignored --nocapture`

use std::time::Instant;
use tempfile::TempDir;
use tracematch::synthetic::SyntheticScenario;
use veloqrs::PersistentRouteEngine;

/// Helper: create engine with temp DB, ingest synthetic activities, return engine + temp dir.
fn setup_engine_with_activities(
    scenario: &SyntheticScenario,
) -> (PersistentRouteEngine, TempDir) {
    let tmp_dir = TempDir::new().expect("failed to create temp dir");
    let db_path = tmp_dir.path().join("test.db");
    let mut engine =
        PersistentRouteEngine::new(db_path.to_str().unwrap()).expect("failed to create engine");

    let dataset = scenario.generate();

    for (id, track) in &dataset.tracks {
        let sport = dataset
            .sport_types
            .get(id)
            .cloned()
            .unwrap_or_else(|| "Ride".to_string());
        engine
            .add_activity(id.clone(), track.clone(), sport)
            .expect("failed to add activity");
    }

    (engine, tmp_dir)
}

/// Helper: run section detection synchronously on an engine.
fn detect_and_apply(engine: &mut PersistentRouteEngine) -> usize {
    let handle = engine.detect_sections_background(None);
    let sections = handle.recv().unwrap_or_default();
    let count = sections.len();
    engine
        .apply_sections(sections)
        .expect("failed to apply sections");
    count
}

// ============================================================================
// Test: Full Pipeline at 100 Activities
// ============================================================================

#[test]
#[ignore] // ~3min in debug, ~5s in release
fn test_ingest_100_detect_query() {
    let scenario = SyntheticScenario::with_activity_count(100, 10_000.0, 0.8);
    let (mut engine, _tmp) = setup_engine_with_activities(&scenario);

    // Verify ingestion
    let ids = engine.get_activity_ids();
    assert_eq!(ids.len(), 100, "Expected 100 activities ingested");

    // Detect sections
    let start = Instant::now();
    let section_count = detect_and_apply(&mut engine);
    let detect_time = start.elapsed();

    println!(
        "100 activities: {} sections detected in {:?}",
        section_count, detect_time
    );

    // Should find at least some sections (80% overlap on 10km corridor)
    assert!(
        section_count > 0,
        "Expected at least 1 section with 80% overlap"
    );

    // Query sections
    let start = Instant::now();
    let sections = engine.get_sections();
    let query_time = start.elapsed();
    println!(
        "get_sections(): {} sections in {:?}",
        sections.len(),
        query_time
    );
    assert_eq!(sections.len(), section_count);

    // Query summaries
    let start = Instant::now();
    let summaries = engine.get_section_summaries();
    let summary_time = start.elapsed();
    println!(
        "get_section_summaries(): {} summaries in {:?}",
        summaries.len(),
        summary_time
    );
    assert_eq!(summaries.len(), section_count);

    // Query section count
    let db_count = engine.get_section_count();
    assert_eq!(db_count as usize, section_count);
}

// ============================================================================
// Test: Full Pipeline at 500 Activities (larger scale)
// ============================================================================

#[test]
#[ignore] // ~30min in debug, ~2min in release
fn test_ingest_500_detect_query() {
    let scenario = SyntheticScenario::with_activity_count(500, 10_000.0, 0.5);
    let (mut engine, _tmp) = setup_engine_with_activities(&scenario);

    let ids = engine.get_activity_ids();
    assert_eq!(ids.len(), 500);

    let start = Instant::now();
    let section_count = detect_and_apply(&mut engine);
    let detect_time = start.elapsed();

    println!(
        "500 activities: {} sections detected in {:?}",
        section_count, detect_time
    );

    // Query all
    let sections = engine.get_sections();
    assert_eq!(sections.len(), section_count);

    let summaries = engine.get_section_summaries();
    assert_eq!(summaries.len(), section_count);
}

// ============================================================================
// Test: SQLite File Size at Scale
// ============================================================================

#[test]
fn test_sqlite_file_size() {
    println!("\nSQLite File Size vs Activity Count:");
    println!("{:<12} {:<15}", "Activities", "DB Size");
    println!("{:<12} {:<15}", "----------", "--------");

    for count in [100, 250, 500] {
        let scenario = SyntheticScenario::with_activity_count(count, 5_000.0, 0.5);
        let tmp_dir = TempDir::new().unwrap();
        let db_path = tmp_dir.path().join("test.db");
        let mut engine = PersistentRouteEngine::new(db_path.to_str().unwrap()).unwrap();

        let dataset = scenario.generate();
        for (id, track) in &dataset.tracks {
            let sport = dataset.sport_types.get(id).cloned().unwrap_or_default();
            engine.add_activity(id.clone(), track.clone(), sport).unwrap();
        }

        // Force flush to disk
        drop(engine);

        let file_size = std::fs::metadata(&db_path)
            .map(|m| m.len())
            .unwrap_or(0);

        let size_str = if file_size > 1_000_000 {
            format!("{:.1} MB", file_size as f64 / 1_000_000.0)
        } else {
            format!("{:.0} KB", file_size as f64 / 1_000.0)
        };

        println!("{:<12} {:<15}", count, size_str);
    }
}

// ============================================================================
// Test: Section Query Scaling
// ============================================================================

#[test]
#[ignore] // ~20min in debug, ~1min in release
fn test_get_sections_query_scaling() {
    // Use multi-corridor scenario to generate more sections
    let scenario = SyntheticScenario::multi_corridor();
    let (mut engine, _tmp) = setup_engine_with_activities(&scenario);

    let start = Instant::now();
    let section_count = detect_and_apply(&mut engine);
    let detect_time = start.elapsed();

    println!(
        "\nMulti-corridor (300 activities, 5 corridors): {} sections in {:?}",
        section_count, detect_time
    );

    // Measure repeated queries
    for i in 0..3 {
        let start = Instant::now();
        let sections = engine.get_sections();
        let query_time = start.elapsed();
        println!(
            "  get_sections() call {}: {} sections in {:?}",
            i + 1,
            sections.len(),
            query_time
        );
    }

    // Measure summary queries
    for i in 0..3 {
        let start = Instant::now();
        let summaries = engine.get_section_summaries();
        let query_time = start.elapsed();
        println!(
            "  get_section_summaries() call {}: {} summaries in {:?}",
            i + 1,
            summaries.len(),
            query_time
        );
    }
}

// ============================================================================
// Test: Long Section 70km End-to-End
// ============================================================================

#[test]
#[ignore] // ~15min in debug, ~1min in release
fn test_long_section_70km() {
    let scenario = SyntheticScenario::long_sections();
    let dataset = scenario.generate();

    // Verify synthetic data has a ~70km corridor
    assert_eq!(dataset.expected_sections.len(), 1);
    let expected_length = dataset.expected_sections[0].length_meters;
    assert!(
        expected_length > 60_000.0 && expected_length < 80_000.0,
        "Expected ~70km corridor, got {}m",
        expected_length
    );

    let (mut engine, _tmp) = setup_engine_with_activities(&scenario);

    let start = Instant::now();
    let section_count = detect_and_apply(&mut engine);
    let detect_time = start.elapsed();

    println!(
        "\n70km corridor (200 activities): {} sections in {:?}",
        section_count, detect_time
    );

    // Should find at least one section
    assert!(
        section_count > 0,
        "Expected sections from 70km corridor with 60% overlap"
    );

    // Check section lengths — at least one should be substantial
    let sections = engine.get_sections();
    let max_length = sections
        .iter()
        .map(|s| s.distance_meters)
        .fold(0.0f64, f64::max);

    println!(
        "  Longest detected section: {:.1}km (expected ~70km corridor)",
        max_length / 1000.0
    );

    // The algorithm may split the 70km corridor into multiple sections,
    // but the total coverage should be significant
    let total_section_length: f64 = sections.iter().map(|s| s.distance_meters).sum();
    println!(
        "  Total section coverage: {:.1}km across {} sections",
        total_section_length / 1000.0,
        sections.len()
    );

    // Verify section polyline quality: the longest section should have reasonable point density
    if let Some(longest) = sections.iter().max_by(|a, b| {
        a.distance_meters
            .partial_cmp(&b.distance_meters)
            .unwrap_or(std::cmp::Ordering::Equal)
    }) {
        let points = longest.polyline.len();
        let km = longest.distance_meters / 1000.0;
        println!(
            "  Longest section: {:.1}km with {} polyline points ({:.0} pts/km)",
            km,
            points,
            points as f64 / km
        );
        assert!(points > 10, "Section polyline should have reasonable detail");
    }

    // Verify summaries match
    let summaries = engine.get_section_summaries();
    assert_eq!(summaries.len(), section_count);
}
