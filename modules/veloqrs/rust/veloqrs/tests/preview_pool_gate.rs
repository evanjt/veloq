//! A preview refuses the pool a real detect would refuse.
//!
//! The preview detector reads the same stored tracks the real detect cuts
//! over, so a pool too unreadable to cut must not still yield proposals. The
//! refusal reaches the caller as its own poll status rather than an empty
//! result.
//!
//! Coordinates here are synthetic.
//!
//! Run: `cargo test --test preview_pool_gate -p veloqrs`

use std::time::{Duration, Instant};

use rusqlite::{Connection, params};
use tempfile::TempDir;
use tracematch::GpsPoint;
use veloqrs::FfiSectionConfig;
use veloqrs::objects::SectionPreview;
use veloqrs::persistence::persistent_engine_ffi::persistent_engine_init;
use veloqrs::persistence::with_persistent_engine;

/// Not framed postcard, not unframed postcard, not an rmp array header: no
/// container claims it, so every decode path reports it as unreadable.
const UNDECODABLE: &[u8] = &[0x7f, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07];

const ACTIVITIES: usize = 12;

/// Past both bars of the gate: over the eight-row floor and well over the
/// ten percent ceiling.
const CORRUPT: usize = 9;

fn line_track(jitter: f64) -> Vec<GpsPoint> {
    (0..200)
        .map(|i| GpsPoint {
            latitude: 46.0 + f64::from(i) * 0.0001,
            longitude: 7.0 + jitter,
            elevation: None,
        })
        .collect()
}

fn seed_engine() {
    with_persistent_engine(|engine| {
        for i in 0..ACTIVITIES {
            let id = format!("ride_{i}");
            engine
                .add_activity(id.clone(), line_track(i as f64 * 0.00002), "Ride".into())
                .expect("add activity");
            engine
                .update_activity_metadata(
                    &id,
                    Some(1_700_000_000 - i as i64 * 14 * 86_400),
                    None,
                    None,
                    None,
                )
                .expect("metadata");
        }
    })
    .expect("engine installed");
}

fn corrupt_tracks(path: &std::path::Path) {
    let conn = Connection::open(path).expect("raw open");
    for i in 0..CORRUPT {
        let n = conn
            .execute(
                "UPDATE gps_tracks SET track_data = ? WHERE activity_id = ?",
                params![UNDECODABLE, format!("ride_{i}")],
            )
            .expect("blob update");
        assert_eq!(n, 1, "expected one gps_tracks row for ride_{i}");
    }
}

#[test]
fn a_preview_over_an_unusable_pool_refuses() {
    let dir = TempDir::new().expect("tempdir");
    let path = dir.path().join("routes.db");
    assert!(persistent_engine_init(
        path.to_str().expect("utf-8 path").to_string()
    ));

    seed_engine();
    corrupt_tracks(&path);

    let cfg = with_persistent_engine(|engine| engine.get_section_config()).expect("config");
    let ffi_cfg = FfiSectionConfig::from(&cfg);

    let preview = SectionPreview::new();
    assert!(
        preview.start(46.01, 7.0, ffi_cfg).expect("start call"),
        "the preview must start before it can refuse the pool"
    );

    let deadline = Instant::now() + Duration::from_secs(120);
    let status = loop {
        let status = preview.poll().expect("poll");
        if status != "running" {
            break status;
        }
        assert!(Instant::now() < deadline, "preview never ended");
        std::thread::sleep(Duration::from_millis(50));
    };

    assert_eq!(
        status, "pool_unusable",
        "an unreadable pool must refuse rather than propose"
    );
    assert!(
        preview.take_result().expect("take call").is_none(),
        "a refused preview yields no payload"
    );
    assert_eq!(
        preview.poll().expect("poll after refusal"),
        "idle",
        "the refusal must clear the slot"
    );
}
