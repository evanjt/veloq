//! The seed and the fixed keys behind the sealed archive of each release.
//!
//! One owner for both sides: `examples/sealed_release_fixture.rs` writes an
//! archive from a release tag with `seed_record` and `seal_with_fixed_keys`,
//! and `every_released_sealed_archive_restores` checks a restore against the
//! same `SEEDED_SETTINGS` and `SEEDED_SECTION_NAME`. The seed is the same
//! three settings rows and one section name every time, so a diff between two
//! releases' archives shows only the writer's change.

#![allow(dead_code)]

use std::path::{Path, PathBuf};
use veloqrs::persistence::seal::{
    Dek, Kind, Randomness, SealError, Sealing, WrapBy, seal, wrap_dek,
};
use veloqrs::sections::CreateSectionParams;
use veloqrs::{GpsPoint, PersistentEngine};

/// The settings rows the seed writes, none of which a device keeps for itself.
pub const SEEDED_SETTINGS: [(&str, &str); 3] = [
    ("fixture_unit_system", "metric"),
    ("fixture_week_start", "monday"),
    ("fixture_map_style", "terrain"),
];

/// The name the seed gives its one custom section.
pub const SEEDED_SECTION_NAME: &str = "Fixture hill";

/// The ride the section is cut from, which a restore needs to place it.
pub const SEEDED_RIDE: &str = "fixture-ride-1";

/// The directory holding the fixed secret, recovery key and randomness every
/// release's archive is sealed with.
pub fn keys_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sealed/v1")
}

/// A gently climbing line of `count` points, one every ~8 m.
fn line(count: usize) -> Vec<GpsPoint> {
    (0..count)
        .map(|i| {
            let mut point = GpsPoint::new(46.2 + i as f64 * 0.00002, 7.35 + i as f64 * 0.0001);
            point.elevation = Some(500.0 + i as f64 * 0.5);
            point
        })
        .collect()
}

/// The ride the seeded section is cut from, in a library that holds nothing
/// else. A restore target holds it too, since a section is placed on ground.
pub fn seed_ride(engine: &mut PersistentEngine) {
    engine
        .add_activity(SEEDED_RIDE.to_string(), line(120), "Ride".to_string())
        .expect("add the ride");
}

/// The athlete's own decisions the archive carries: three settings and a
/// named custom section.
pub fn seed_record(engine: &mut PersistentEngine) {
    seed_ride(engine);
    for (key, value) in SEEDED_SETTINGS {
        engine.set_setting(key, value).expect("write a setting");
    }
    engine
        .create_section(CreateSectionParams {
            sport_type: "Ride".to_string(),
            polyline: line(120)[20..80].to_vec(),
            distance_meters: 470.0,
            name: Some(SEEDED_SECTION_NAME.to_string()),
            source_activity_id: Some(SEEDED_RIDE.to_string()),
            start_index: Some(20),
            end_index: Some(80),
        })
        .expect("create the section");
}

/// Randomness that reads a fixed byte string in order, so a seal repeats.
pub struct Stream {
    bytes: Vec<u8>,
    at: usize,
}

impl Stream {
    pub fn new(bytes: Vec<u8>) -> Self {
        Self { bytes, at: 0 }
    }
}

impl Randomness for Stream {
    fn fill(&mut self, out: &mut [u8]) -> Result<(), SealError> {
        let end = self.at + out.len();
        assert!(end <= self.bytes.len(), "the fixed randomness ran out");
        out.copy_from_slice(&self.bytes[self.at..end]);
        self.at = end;
        Ok(())
    }
}

fn text(name: &str) -> String {
    let path = keys_dir().join(name);
    std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("{}: {e}", path.display()))
        .trim_end_matches('\n')
        .to_string()
}

fn unhex(name: &str) -> Vec<u8> {
    let text = text(name);
    (0..text.len())
        .step_by(2)
        .map(|at| u8::from_str_radix(&text[at..at + 2], 16).expect("hex"))
        .collect()
}

/// The secret every released archive opens with.
pub fn secret() -> String {
    text("secret.txt")
}

/// Seal a record zip the way the current writer does, under the fixed data
/// key, salt and nonces, with a wrap for the secret and one for the recovery
/// key.
pub fn seal_with_fixed_keys(record_zip: &[u8]) -> Vec<u8> {
    let nonces = unhex("nonces.hex");
    let secret = secret();
    let recovery = text("recovery.txt");
    let mut sealing = Sealing::new(
        secret.as_bytes(),
        &mut Stream::new(
            [
                unhex("dek.hex"),
                unhex("key_id.hex"),
                unhex("salt.hex"),
                nonces[..12].to_vec(),
            ]
            .concat(),
        ),
    )
    .expect("a sealing under the fixed keys");
    let dek: &Dek = &sealing.dek;
    let recovery_wrap = wrap_dek(
        dek,
        &sealing.key_id,
        WrapBy::Recovery,
        recovery.as_bytes(),
        &sealing.kdf,
        &mut Stream::new(nonces[12..24].to_vec()),
    )
    .expect("wrap the key for the recovery key");
    sealing.wraps.push(recovery_wrap);
    seal(
        record_zip,
        Kind::Record,
        &sealing,
        &mut Stream::new(nonces[24..36].to_vec()),
    )
    .expect("seal the record zip")
}
