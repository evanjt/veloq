//! What a foreground engine does about rows another process wrote.
//!
//! The iOS notification service extension is a second process against the same
//! App Group database. It fetches a body, stores a track, writes the metrics
//! row and indexes the activity, and a foreground engine that stayed alive
//! through all of it holds tiers that predate every one of those rows with
//! nothing to say so. These tests drive two engines over one file, which is
//! that shape exactly.
//!
//! Run: `cargo test --test external_write_reload -p veloqrs`

use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::PersistentEngine;

fn coords(base: f64) -> Vec<GpsPoint> {
    (0..8)
        .map(|i| GpsPoint {
            latitude: base + f64::from(i) * 0.001,
            longitude: 7.3,
            elevation: None,
        })
        .collect()
}

/// Two engines over one file, the way the app and the extension have it.
fn two_engines(dir: &TempDir) -> (PersistentEngine, PersistentEngine) {
    let path = dir.path().join("routes.db");
    let path = path.to_str().unwrap();
    let mut foreground = PersistentEngine::new(path).expect("the app's engine");
    foreground.load().expect("the first load");
    let handler = PersistentEngine::new(path).expect("the handler's engine");
    (foreground, handler)
}

/// Scenario: the extension stores and indexes a ride while the app sits
/// suspended with its engine open.
///
/// Expected behaviour: the foreground does not see the ride until it reloads,
/// and then it does. The first half is the bug; the second is the fix, and a
/// test that only asserted the second would pass against an engine that
/// reloaded nothing because it never went stale.
#[test]
fn a_ride_another_process_wrote_appears_only_after_a_reload() {
    let dir = TempDir::new().unwrap();
    let (mut foreground, mut handler) = two_engines(&dir);
    assert_eq!(foreground.get_activity_ids().len(), 0);

    handler
        .add_activity("a1".to_string(), coords(46.2), "Ride".to_string())
        .expect("the handler's write");

    assert_eq!(
        foreground.get_activity_ids().len(),
        0,
        "the tiers are in memory, so a committed row is invisible until they are re-read"
    );

    foreground.reload_external_writes().expect("the reload");

    assert_eq!(foreground.get_activity_ids(), vec!["a1".to_string()]);
}

/// Scenario: a second push lands while the app is still away, so the token
/// moves twice before anyone reads it.
///
/// Expected behaviour: the token only ever goes up, and a foreground that
/// compares what it last saw takes both rides in one reload. A flag someone
/// has to clear would lose the second bump to the race between the read and
/// the clear.
#[test]
fn the_token_counts_every_write_and_never_goes_backwards() {
    let dir = TempDir::new().unwrap();
    let (foreground, mut handler) = two_engines(&dir);
    assert_eq!(
        foreground.external_write_token(),
        0,
        "an install with no push"
    );

    handler.note_external_write().expect("the first bump");
    assert_eq!(foreground.external_write_token(), 1);

    handler.note_external_write().expect("the second bump");
    handler.note_external_write().expect("the third bump");
    assert_eq!(foreground.external_write_token(), 3);
}

/// The foreground reads the token off its own connection, so it has to see a
/// bump the other process committed rather than a value cached at open.
#[test]
fn the_token_is_read_from_the_file_rather_than_from_memory() {
    let dir = TempDir::new().unwrap();
    let (foreground, mut handler) = two_engines(&dir);

    handler.note_external_write().expect("the bump");

    assert_eq!(foreground.external_write_token(), 1);
}

/// Scenario: the athlete moved the strictness slider while the push was in
/// flight.
///
/// Expected behaviour: the reload leaves the config alone. A handler writes no
/// config, so re-reading it could only overwrite what the athlete just set,
/// which is why the three settings loaders are not in the reload.
#[test]
fn a_reload_leaves_the_config_the_athlete_set() {
    let dir = TempDir::new().unwrap();
    let (mut foreground, _handler) = two_engines(&dir);
    let mut config = foreground.get_section_config();
    config.min_activities += 3;
    let expected = config.min_activities;
    foreground.set_section_config(config);

    foreground.reload_external_writes().expect("the reload");

    assert_eq!(foreground.get_section_config().min_activities, expected);
}

/// A reload on a file nobody has written to is a no-op that still answers,
/// which is what a foreground with no push to take does every time it runs.
#[test]
fn a_reload_with_nothing_to_take_is_not_an_error() {
    let dir = TempDir::new().unwrap();
    let (mut foreground, _handler) = two_engines(&dir);

    foreground.reload_external_writes().expect("the reload");

    assert_eq!(foreground.get_activity_ids().len(), 0);
}
