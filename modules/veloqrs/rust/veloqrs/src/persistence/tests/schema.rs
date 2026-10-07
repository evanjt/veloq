use super::*;

#[test]
fn test_pre_v4_backfill_populates_zone_ftp_and_heatmap_caches() {
    let mut conn = Connection::open_in_memory().unwrap();
    let scripts = PersistentEngine::migration_scripts();
    Migrations::new(scripts[..8].iter().copied().map(M::up).collect())
        .to_latest(&mut conn)
        .unwrap();
    for (id, date, duration, ftp) in [
        ("a1", 1_704_067_200_i64, 7_300, 250),
        ("a2", 1_704_070_800, 3_500, 255),
        ("a3", 1_704_153_600, 5_500, 260),
    ] {
        conn.execute(
            "INSERT INTO activity_metrics
             (activity_id, name, date, distance, moving_time, elapsed_time,
              elevation_gain, sport_type, ftp, power_zone_times, hr_zone_times)
             VALUES (?1, 'Ride', ?2, 1000, ?3, ?3, 0, 'Ride', ?4,
                     '[10,20,30,40,50,60,70]', '[1,2,3,4,5]')",
            params![id, date, duration, ftp],
        )
        .unwrap();
    }

    PersistentEngine::populate_all_performance_caches(&conn).unwrap();

    let zones: (f64, f64, f64) = conn
        .query_row(
            "SELECT power_z1, power_z7, hr_z5 FROM activity_metrics WHERE activity_id = 'a1'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(zones, (10.0, 70.0, 5.0));
    let ftp_rows: Vec<(String, i64)> = conn
        .prepare("SELECT activity_id, ftp FROM ftp_history ORDER BY activity_id")
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(
        ftp_rows,
        vec![("a1".into(), 250), ("a2".into(), 255), ("a3".into(), 260)]
    );
    let heatmap: Vec<(String, i64, i64, i64)> = conn
        .prepare("SELECT date, intensity, max_duration, activity_count FROM activity_heatmap ORDER BY date")
        .unwrap()
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert_eq!(
        heatmap,
        vec![
            ("2024-01-01".into(), 4, 7_300, 2),
            ("2024-01-02".into(), 3, 5_500, 1)
        ]
    );
}

/// Scenario: a library still at schema 2 upgrades, and the migration times
/// every section lap that has none from the stored stream.
///
/// Expected behaviour: the lap is timed the way every live reader times it.
/// The end index is half-open, so 1..5 on a ten-second stream is 30 s and a
/// lap running to the last point is timed rather than dropped, and a stream
/// that is not its track's length gives no time rather than the shifted
/// window, since what the migration writes stands.
#[test]
fn the_pre_v3_lap_cache_times_laps_the_way_the_live_readers_do() {
    let mut conn = Connection::open_in_memory().unwrap();
    let scripts = PersistentEngine::migration_scripts();
    Migrations::new(scripts.iter().copied().map(M::up).collect())
        .to_latest(&mut conn)
        .unwrap();
    conn.execute_batch("PRAGMA foreign_keys = OFF").unwrap();
    // Both tracks hold eight points. a2 kept the raw stream, three samples longer.
    for (id, samples) in [("a1", 8u32), ("a2", 11)] {
        let times: Vec<u32> = (0..samples).map(|i| i * 10).collect();
        conn.execute(
            "INSERT INTO time_streams (activity_id, times, point_count) VALUES (?1, ?2, ?3)",
            params![id, codec::serialize(&times).unwrap(), samples],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO gps_tracks (activity_id, track_data, point_count) VALUES (?1, x'00', 8)",
            params![id],
        )
        .unwrap();
    }
    for (activity, start, end) in [("a1", 1, 5), ("a1", 2, 8), ("a2", 1, 5)] {
        conn.execute(
            "INSERT INTO section_activities (section_id, activity_id, direction,
                 start_index, end_index, distance_meters)
             VALUES ('s0', ?1, 'same', ?2, ?3, 400.0)",
            params![activity, start, end],
        )
        .unwrap();
    }

    PersistentEngine::populate_performance_cache(&conn).unwrap();

    let lap = |activity: &str, start: u32| -> Option<f64> {
        conn.query_row(
            "SELECT lap_time FROM section_activities WHERE activity_id = ?1 AND start_index = ?2",
            params![activity, start],
            |row| row.get(0),
        )
        .unwrap()
    };
    assert_eq!(lap("a1", 1), Some(30.0), "half-open end");
    assert_eq!(
        lap("a1", 2),
        Some(50.0),
        "a lap to the track's end is timed"
    );
    assert_eq!(
        lap("a2", 1),
        None,
        "a stream off its track's length gives no time"
    );
}

#[test]
fn test_heatmap_rebuild_migration_matches_the_live_writer_at_every_boundary() {
    let mut conn = Connection::open_in_memory().unwrap();
    let scripts = PersistentEngine::migration_scripts();
    Migrations::new(scripts[..41].iter().copied().map(M::up).collect())
        .to_latest(&mut conn)
        .unwrap();
    let durations = [
        0, 1, 3_599, 3_600, 3_601, 5_399, 5_400, 5_401, 7_199, 7_200, 7_201,
    ];
    for (i, duration) in durations.iter().enumerate() {
        conn.execute(
            "INSERT INTO activity_metrics
             (activity_id, name, date, distance, moving_time, elapsed_time,
              elevation_gain, sport_type)
             VALUES (?1, 'Ride', ?2, 1000, ?3, ?3, 0, 'Ride')",
            params![
                format!("a{i}"),
                1_704_067_200_i64 + i as i64 * 86_400,
                duration
            ],
        )
        .unwrap();
    }
    let read = |conn: &Connection| -> Vec<(String, i64, i64, i64)> {
        conn.prepare(
            "SELECT date, intensity, max_duration, activity_count
             FROM activity_heatmap ORDER BY date",
        )
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect()
    };

    recompute_all_heatmap(&conn).unwrap();
    let live = read(&conn);
    assert_eq!(live.len(), durations.len());

    conn.execute_batch(scripts[41]).unwrap();
    assert_eq!(read(&conn), live);
}

fn legacy_row(conn: &Connection, id: &str, lat: f64, flags: &str) {
    let polyline: Vec<tracematch::GpsPoint> = (0..20)
        .map(|i| tracematch::GpsPoint::new(lat + i as f64 * 0.0005, 7.0))
        .collect();
    conn.execute(
        "INSERT INTO sections (id, section_type, sport_type, polyline_json, distance_meters)
         VALUES (?, 'auto', 'Ride', ?, 900.0)",
        params![id, serde_json::to_string(&polyline).unwrap()],
    )
    .unwrap();
    if !flags.is_empty() {
        conn.execute(
            &format!("UPDATE sections SET {flags} WHERE id = ?"),
            params![id],
        )
        .unwrap();
    }
}

fn suppression_intents(conn: &Connection) -> Vec<(String, String)> {
    conn.prepare("SELECT id, kind FROM section_intents WHERE kind != 'named' ORDER BY id")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

/// Scenario: a 0.3.x library hid a section with `disabled = 1` and replaced
/// another through `superseded_by`; neither wrote an intent, and the cold
/// detect at the cutover would otherwise re-emit the ground under a new id.
#[test]
fn legacy_disabled_and_superseded_rows_gain_a_disabled_intent_once() {
    let engine = PersistentEngine::in_memory().unwrap();
    let conn = &engine.db;
    legacy_row(conn, "hidden", 46.0, "disabled = 1");
    legacy_row(conn, "successor", 46.1, "");
    legacy_row(conn, "replaced", 46.2, "superseded_by = 'successor'");
    legacy_row(conn, "shown", 46.3, "");
    conn.execute(
        "DELETE FROM schema_info WHERE key = 'legacy_suppression_backfill_done'",
        [],
    )
    .unwrap();

    PersistentEngine::ensure_section_intents_named_shape(conn).unwrap();

    let expected = vec![
        ("hidden".to_string(), "disabled".to_string()),
        ("replaced".to_string(), "disabled".to_string()),
    ];
    assert_eq!(suppression_intents(conn), expected);
    let (footprint, json): (Vec<u8>, Option<String>) = conn
        .query_row(
            "SELECT polyline_blob, polyline_json FROM section_intents WHERE id = 'hidden'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    let points = crate::persistence::codec::deserialize_points(&footprint).unwrap();
    assert_eq!(points.len(), 20);
    assert_eq!(json, None);

    // Enabling clears the intent; a second open must not bring it back.
    conn.execute("UPDATE sections SET disabled = 0 WHERE id = 'hidden'", [])
        .unwrap();
    engine.clear_section_intent("hidden");
    PersistentEngine::ensure_section_intents_named_shape(conn).unwrap();
    assert_eq!(
        suppression_intents(conn),
        vec![("replaced".to_string(), "disabled".to_string())]
    );
}
