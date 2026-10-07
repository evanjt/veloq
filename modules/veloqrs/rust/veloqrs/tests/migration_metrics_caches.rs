use super::migration_support;

use migration_support::{seed_at_version, stamp_app_schema_version};
use rusqlite::{Connection, params};
use tempfile::TempDir;
use veloqrs::PersistentEngine;

fn seed_metrics(conn: &Connection) {
    for (id, date, duration, ftp, power, hr) in [
        (
            "a1",
            1_704_067_200_i64,
            7_300,
            250,
            "[10,20,30,40,50,60,70]",
            "[1,2,3,4,5]",
        ),
        (
            "a2",
            1_704_070_800,
            3_500,
            255,
            "[11,22,33,44,55,66,77]",
            "[5,4,3,2,1]",
        ),
        (
            "a3",
            1_704_153_600,
            5_500,
            260,
            "[9,8,7,6,5,4,3]",
            "[3,4,5,6,7]",
        ),
    ] {
        conn.execute(
            "INSERT INTO activity_metrics
             (activity_id, name, date, distance, moving_time, elapsed_time,
              elevation_gain, sport_type, ftp, power_zone_times, hr_zone_times)
             VALUES (?1, 'Ride', ?2, 1000, ?3, ?3, 0, 'Ride', ?4, ?5, ?6)",
            params![id, date, duration, ftp, power, hr],
        )
        .unwrap();
    }
}

fn expected_zones() -> [(&'static str, [f64; 7], [f64; 5]); 3] {
    [
        (
            "a1",
            [10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0],
            [1.0, 2.0, 3.0, 4.0, 5.0],
        ),
        (
            "a2",
            [11.0, 22.0, 33.0, 44.0, 55.0, 66.0, 77.0],
            [5.0, 4.0, 3.0, 2.0, 1.0],
        ),
        (
            "a3",
            [9.0, 8.0, 7.0, 6.0, 5.0, 4.0, 3.0],
            [3.0, 4.0, 5.0, 6.0, 7.0],
        ),
    ]
}

fn assert_upgraded(conn: &Connection) {
    for (id, power, hr) in expected_zones() {
        let zones: (Vec<f64>, Vec<f64>) = conn
            .query_row(
                "SELECT power_z1, power_z2, power_z3, power_z4, power_z5, power_z6, power_z7,
                    hr_z1, hr_z2, hr_z3, hr_z4, hr_z5
             FROM activity_metrics WHERE activity_id = ?",
                [id],
                |row| {
                    Ok((
                        (0..7).map(|i| row.get(i).unwrap()).collect(),
                        (7..12).map(|i| row.get(i).unwrap()).collect(),
                    ))
                },
            )
            .unwrap();
        assert_eq!(zones.0, power, "{id} power zones");
        assert_eq!(zones.1, hr, "{id} HR zones");
    }
    let days: Vec<(String, i64, i64, i64)> = conn
        .prepare("SELECT date, intensity, max_duration, activity_count FROM activity_heatmap ORDER BY date")
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(
        days,
        vec![
            ("2024-01-01".into(), 4, 7_300, 2),
            ("2024-01-02".into(), 3, 5_500, 1)
        ]
    );
    let ftp: i64 = conn
        .query_row(
            "SELECT ftp FROM activity_metrics WHERE activity_id = 'a2'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(ftp, 255);
    assert!(conn.prepare("SELECT * FROM ftp_history").is_err());
    assert!(
        conn.prepare("SELECT power_zone_times FROM activity_metrics")
            .is_err()
    );
}

#[test]
fn test_pre_v4_metrics_backfill_with_stamped_and_absent_app_version() {
    let _serial_state = super::serial_state();
    for stamped in [true, false] {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("legacy.db");
        {
            let conn = seed_at_version(&path, 8);
            seed_metrics(&conn);
            if stamped {
                stamp_app_schema_version(&conn, 3);
            } else {
                conn.execute("DELETE FROM schema_info WHERE key = 'schema_version'", [])
                    .unwrap();
            }
        }
        PersistentEngine::new(path.to_str().unwrap()).unwrap();
        assert_upgraded(&Connection::open(&path).unwrap());
    }
}

#[test]
fn test_schema_12_upgrade_preserves_metrics_and_drops_unused_copies() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("released.db");
    {
        let conn = seed_at_version(&path, 12);
        seed_metrics(&conn);
        for (id, power, hr) in expected_zones() {
            conn.execute(
                "UPDATE activity_metrics SET power_z1=?2, power_z2=?3, power_z3=?4,
                 power_z4=?5, power_z5=?6, power_z6=?7, power_z7=?8,
                 hr_z1=?9, hr_z2=?10, hr_z3=?11, hr_z4=?12, hr_z5=?13
                 WHERE activity_id=?1",
                params![
                    id, power[0], power[1], power[2], power[3], power[4], power[5], power[6],
                    hr[0], hr[1], hr[2], hr[3], hr[4]
                ],
            )
            .unwrap();
        }
    }
    PersistentEngine::new(path.to_str().unwrap()).unwrap();
    assert_upgraded(&Connection::open(&path).unwrap());
}

fn heatmap_days(conn: &Connection) -> Vec<(String, i64, i64, i64)> {
    conn.prepare(
        "SELECT date, intensity, max_duration, activity_count FROM activity_heatmap ORDER BY date",
    )
    .unwrap()
    .query_map([], |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
    })
    .unwrap()
    .map(Result::unwrap)
    .collect()
}

/// Scenario: an install written before the sync's metrics write kept the
/// heatmap holds metrics rows with no heatmap day, and a day whose activities
/// have gone. Version 40 and 41 were each a build's last stamp, so a
/// rebuild gated on the app version below either one never reaches them.
///
/// Expected behaviour: whichever version the file opens at, the heatmap
/// afterwards is one row per metrics day, recomputed from `activity_metrics`,
/// and the orphaned day is gone.
#[test]
fn every_upgrade_rebuilds_the_heatmap_from_the_metrics() {
    let _serial_state = super::serial_state();
    for version in [12, 40, 41] {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("upgrade.db");
        {
            let conn = seed_at_version(&path, version);
            for (id, date, duration) in [
                ("a1", 1_704_067_200_i64, 7_300),
                ("a2", 1_704_070_800, 3_500),
                ("a3", 1_704_153_600, 5_500),
            ] {
                conn.execute(
                    "INSERT INTO activity_metrics
                     (activity_id, name, date, distance, moving_time, elapsed_time,
                      elevation_gain, sport_type)
                     VALUES (?1, 'Ride', ?2, 1000, ?3, ?3, 0, 'Ride')",
                    params![id, date, duration],
                )
                .unwrap();
            }
            conn.execute(
                "INSERT INTO activity_heatmap (date, intensity, max_duration, activity_count)
                 VALUES ('2023-12-25', 1, 600, 1)",
                [],
            )
            .unwrap();
        }
        PersistentEngine::new(path.to_str().unwrap()).unwrap();
        assert_eq!(
            heatmap_days(&Connection::open(&path).unwrap()),
            vec![
                ("2024-01-01".into(), 4, 7_300, 2),
                ("2024-01-02".into(), 3, 5_500, 1)
            ],
            "upgrade from {version}"
        );
    }
}

/// Scenario: a file whose migrations all ran but whose app-level version
/// record was never stamped, so it still reads below 40. No migration runs
/// for it, so nothing else rebuilds its heatmap.
///
/// Expected behaviour: the heatmap is rebuilt from `activity_metrics` on open.
#[test]
fn a_stale_app_version_over_complete_migrations_still_rebuilds_the_heatmap() {
    let _serial_state = super::serial_state();
    let dir = TempDir::new().unwrap();
    let path = dir.path().join("stale_record.db");
    {
        let conn = seed_at_version(&path, 42);
        conn.execute(
            "INSERT INTO activity_metrics
             (activity_id, name, date, distance, moving_time, elapsed_time,
              elevation_gain, sport_type)
             VALUES ('a1', 'Ride', 1704067200, 1000, 7300, 7300, 0, 'Ride')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO activity_heatmap (date, intensity, max_duration, activity_count)
             VALUES ('2023-12-25', 1, 600, 1)",
            [],
        )
        .unwrap();
        stamp_app_schema_version(&conn, 39);
    }
    PersistentEngine::new(path.to_str().unwrap()).unwrap();
    assert_eq!(
        heatmap_days(&Connection::open(&path).unwrap()),
        vec![("2024-01-01".into(), 4, 7_300, 1)]
    );
}
