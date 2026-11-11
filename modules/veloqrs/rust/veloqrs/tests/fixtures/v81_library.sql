-- The library a 0.4.1 install leaves on disk, at user_version 81.
-- Written by `examples/released_library.rs` on an engine whose migrations,
-- schema hooks, stored encodings and write paths are the 0.4.1 release's, then
-- `sqlite3 .dump` with the user_version the dump leaves out appended.
-- Never regenerate it from a later build: it stands for what 0.4.1 wrote.
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE schema_info (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
INSERT INTO schema_info VALUES('named_backfill_done','1');
INSERT INTO schema_info VALUES('legacy_suppression_backfill_done','1');
INSERT INTO schema_info VALUES('orphan_superseded_repair_done','1');
INSERT INTO schema_info VALUES('section_geometry_baseline_v1','2026-11-11 07:23:31');
INSERT INTO schema_info VALUES('content_ids_v1','1');
INSERT INTO schema_info VALUES('indicator_version','7');
INSERT INTO schema_info VALUES('pass_rule_version','4');
INSERT INTO schema_info VALUES('schema_version','81');
INSERT INTO schema_info VALUES('last_migration','2026-11-11 07:23:31');
INSERT INTO schema_info VALUES('groups_match_rule','MatchConfig { perfect_threshold: 15.0, zero_threshold: 100.0, min_match_percentage: 55.0, min_route_distance: 500.0, max_distance_diff_ratio: 0.25, endpoint_threshold: 250.0, resample_count: 50, resample_spacing_meters: 50.0, min_resample_points: 20, max_resample_points: 200, simplification_tolerance: 0.0001, max_simplified_points: 100 }');
INSERT INTO schema_info VALUES('match_pct_backfilled_v1','1');
CREATE TABLE activities (
    id TEXT PRIMARY KEY,
    sport_type TEXT NOT NULL,
    min_lat REAL NOT NULL,
    max_lat REAL NOT NULL,
    min_lng REAL NOT NULL,
    max_lng REAL NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    start_date INTEGER,
    name TEXT,
    distance_meters REAL,
    duration_secs INTEGER
, intervals_id TEXT);
INSERT INTO activities VALUES('lib-ride-1','Ride',46.2,46.20238000000001,7.35,7.361899999999999,1794381811,1761000000,'Morning loop',1200,240,'lib-ride-1');
INSERT INTO activities VALUES('lib-ride-2','Ride',46.2,46.20238000000001,7.35,7.361899999999999,1794381811,1761086400,'Lunch loop',1200,240,'lib-ride-2');
INSERT INTO activities VALUES('lib-ride-3','Ride',46.2,46.20238000000001,7.35,7.361899999999999,1794381811,1761172800,'Evening loop',1200,240,'lib-ride-3');
INSERT INTO activities VALUES('lib-run-1','Run',46.25,46.25158,7.4,7.407900000000001,1794381811,1761259200,'Lakeside run',1200,240,'lib-run-1');
CREATE TABLE signatures (
    activity_id TEXT PRIMARY KEY,
    points BLOB NOT NULL,
    start_point_lat REAL NOT NULL,
    start_point_lng REAL NOT NULL,
    end_point_lat REAL NOT NULL,
    end_point_lng REAL NOT NULL,
    total_distance REAL NOT NULL,
    point_count INTEGER NOT NULL,
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);
INSERT INTO signatures VALUES('lib-ride-1',x'c013000000020180d3872ce09b8107904e9825f8b901a609',46.2,7.35,46.20238000000001,7.361899999999999,953.3086692038437,2);
INSERT INTO signatures VALUES('lib-ride-2',x'c013000000020180d3872ce09b8107904e9825f8b901a609',46.2,7.35,46.20238000000001,7.361899999999999,953.3086692038437,2);
INSERT INTO signatures VALUES('lib-ride-3',x'c013000000020180d3872ce09b8107904e9825f8b901a609',46.2,7.35,46.20238000000001,7.361899999999999,953.3086692038437,2);
INSERT INTO signatures VALUES('lib-run-1',x'c0120000000201a0e08d2c80a98707e05dd818b87b9606',46.25,7.4,46.25158,7.407900000000001,632.3412790923411,2);
CREATE TABLE gps_tracks (
    activity_id TEXT PRIMARY KEY,
    track_data BLOB NOT NULL,
    point_count INTEGER NOT NULL, elevation_source INTEGER NOT NULL DEFAULT 0, elevation_settled_version TEXT, elevation_state INTEGER NOT NULL DEFAULT 0, elevation_attempts INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);
INSERT INTO gps_tracks VALUES('lib-ride-1',x'c0e8010000780180d3872ce09b8107904e28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a',120,0,NULL,0,0);
INSERT INTO gps_tracks VALUES('lib-ride-2',x'c0e8010000780180d3872ce09b8107904e28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a',120,0,NULL,0,0);
INSERT INTO gps_tracks VALUES('lib-ride-3',x'c0e8010000780180d3872ce09b8107904e28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a',120,0,NULL,0,0);
INSERT INTO gps_tracks VALUES('lib-run-1',x'c0480100005001a0e08d2c80a98707e05d28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a',80,0,NULL,0,0);
CREATE TABLE route_groups (
    id TEXT PRIMARY KEY,
    representative_id TEXT NOT NULL,
    activity_ids TEXT NOT NULL,
    sport_type TEXT NOT NULL,
    bounds_min_lat REAL,
    bounds_max_lat REAL,
    bounds_min_lng REAL,
    bounds_max_lng REAL
, activity_count INTEGER, activity_ids_blob BLOB, representative_chosen INTEGER NOT NULL DEFAULT 0);
INSERT INTO route_groups VALUES('lib-route-1','lib-ride-1','["lib-ride-1","lib-ride-2","lib-ride-3"]','Ride',46.2,46.2024,7.35,7.3619,3,NULL,0);
CREATE TABLE route_names (
    route_id TEXT PRIMARY KEY,
    custom_name TEXT NOT NULL
);
INSERT INTO route_names VALUES('lib-route-1','Vineyard loop');
CREATE TABLE activity_matches (
    route_id TEXT NOT NULL,
    activity_id TEXT NOT NULL,
    match_percentage REAL NOT NULL,
    direction TEXT NOT NULL, excluded INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (route_id, activity_id)
);
INSERT INTO activity_matches VALUES('lib-route-1','lib-ride-1',100,'same',0);
INSERT INTO activity_matches VALUES('lib-route-1','lib-ride-2',97.5,'same',0);
INSERT INTO activity_matches VALUES('lib-route-1','lib-ride-3',96,'same',0);
CREATE TABLE activity_metrics (
    activity_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    date INTEGER NOT NULL,
    distance REAL NOT NULL,
    moving_time INTEGER NOT NULL,
    elapsed_time INTEGER NOT NULL,
    elevation_gain REAL NOT NULL,
    avg_hr INTEGER,
    avg_power INTEGER,
    sport_type TEXT NOT NULL
, training_load REAL, ftp INTEGER, power_z1 REAL DEFAULT 0, power_z2 REAL DEFAULT 0, power_z3 REAL DEFAULT 0, power_z4 REAL DEFAULT 0, power_z5 REAL DEFAULT 0, power_z6 REAL DEFAULT 0, power_z7 REAL DEFAULT 0, hr_z1 REAL DEFAULT 0, hr_z2 REAL DEFAULT 0, hr_z3 REAL DEFAULT 0, hr_z4 REAL DEFAULT 0, hr_z5 REAL DEFAULT 0, hr_z6 REAL DEFAULT 0, hr_z7 REAL DEFAULT 0);
INSERT INTO activity_metrics VALUES('lib-ride-1','Morning loop',1761000000,1200,240,260,30,142,210,'Ride',18,250,0,0,0,0,0,0,0,0,0,0,0,0,0,0);
INSERT INTO activity_metrics VALUES('lib-ride-2','Lunch loop',1761086400,1200,240,260,30,142,210,'Ride',18,250,0,0,0,0,0,0,0,0,0,0,0,0,0,0);
INSERT INTO activity_metrics VALUES('lib-ride-3','Evening loop',1761172800,1200,240,260,30,142,210,'Ride',18,250,0,0,0,0,0,0,0,0,0,0,0,0,0,0);
INSERT INTO activity_metrics VALUES('lib-run-1','Lakeside run',1761259200,1200,240,260,30,142,210,'Run',18,250,0,0,0,0,0,0,0,0,0,0,0,0,0,0);
CREATE TABLE time_streams (
    activity_id TEXT PRIMARY KEY,
    times BLOB NOT NULL,
    point_count INTEGER NOT NULL,
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);
CREATE TABLE overlap_cache (
    activity_a TEXT NOT NULL,
    activity_b TEXT NOT NULL,
    has_overlap INTEGER NOT NULL,
    overlap_data BLOB,
    computed_at INTEGER NOT NULL,
    PRIMARY KEY (activity_a, activity_b)
);
CREATE TABLE athlete_profile (
    id TEXT PRIMARY KEY DEFAULT 'current',
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE sport_settings (
    id TEXT PRIMARY KEY DEFAULT 'current',
    data TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE processed_activities (
    activity_id TEXT PRIMARY KEY,
    processed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE activity_heatmap (
    date TEXT PRIMARY KEY,
    intensity INTEGER NOT NULL,
    max_duration INTEGER NOT NULL,
    activity_count INTEGER NOT NULL
);
INSERT INTO activity_heatmap VALUES('2025-10-20',1,240,1);
INSERT INTO activity_heatmap VALUES('2025-10-21',1,240,1);
INSERT INTO activity_heatmap VALUES('2025-10-22',1,240,1);
INSERT INTO activity_heatmap VALUES('2025-10-23',1,240,1);
CREATE TABLE exercise_sets (
    activity_id TEXT NOT NULL,
    set_order INTEGER NOT NULL,
    exercise_category INTEGER NOT NULL,
    exercise_name INTEGER,
    set_type INTEGER NOT NULL,
    repetitions INTEGER,
    weight_kg REAL,
    duration_secs REAL,
    start_time INTEGER,
    PRIMARY KEY (activity_id, set_order)
);
CREATE TABLE fit_file_status (
    activity_id TEXT PRIMARY KEY,
    processed_at INTEGER NOT NULL,
    has_sets INTEGER NOT NULL DEFAULT 0
, outcome TEXT NOT NULL DEFAULT 'parsed');
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
INSERT INTO settings VALUES('__activity_body_fields','id,name,type,start_date_local,moving_time,elapsed_time,distance,total_elevation_gain,average_speed,max_speed,average_heartrate,max_heartrate,icu_average_watts,icu_pm_p_max,average_cadence,calories,icu_training_load,icu_intensity,decoupling,has_weather,average_weather_temp,icu_ftp,stream_types,skyline_chart_bytes,description,source,external_id,_note,icu_pm_ftp_watts,icu_zone_times,icu_hr_zone_times,icu_power_zones,icu_hr_zones,icu_rolling_ftp,icu_rolling_ftp_delta',1794381811);
INSERT INTO settings VALUES('__detector_cutover','unified-1',1794381811);
INSERT INTO settings VALUES('unit_system','metric',1794381811);
INSERT INTO settings VALUES('__athlete_id','demo',1794381811);
CREATE TABLE activity_indicators (
    activity_id TEXT NOT NULL,
    indicator_type TEXT NOT NULL CHECK(indicator_type IN (
        'section_pr', 'route_pr', 'section_trend', 'route_trend'
    )),
    target_id TEXT NOT NULL,
    target_name TEXT NOT NULL DEFAULT '',
    direction TEXT NOT NULL DEFAULT 'same',
    lap_time REAL,
    trend INTEGER NOT NULL DEFAULT 0,
    computed_at INTEGER NOT NULL,
    PRIMARY KEY (activity_id, indicator_type, target_id, direction)
);
CREATE TABLE wellness (
    -- ISO-8601 YYYY-MM-DD day key (matches WellnessData.id in TS)
    date TEXT PRIMARY KEY,
    -- Training load metrics (either ctl/atl or ctlLoad/atlLoad depending on
    -- the intervals.icu athlete's settings - TS callers already coalesce
    -- these, so we store whichever is provided in the single column).
    ctl REAL,
    atl REAL,
    ramp_rate REAL,
    -- Recovery + vitals
    hrv REAL,
    resting_hr REAL,
    weight REAL,
    sleep_secs INTEGER,
    sleep_score REAL,
    -- Self-report (0-5 intervals.icu scale)
    soreness INTEGER,
    fatigue INTEGER,
    stress INTEGER,
    mood INTEGER,
    motivation INTEGER,
    -- Cache bookkeeping
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
, raw TEXT);
CREATE TABLE activity_bodies (
    activity_id TEXT PRIMARY KEY,
    -- Start time as epoch seconds, so range queries do not parse JSON.
    date INTEGER NOT NULL,
    raw TEXT NOT NULL,
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
, intervals_id TEXT);
CREATE TABLE curve_bodies (
    -- 'power' or 'pace'
    kind TEXT NOT NULL,
    sport TEXT NOT NULL,
    days INTEGER NOT NULL,
    -- Gradient-adjusted pace. Always 0 for power curves.
    gap INTEGER NOT NULL DEFAULT 0,
    raw TEXT NOT NULL,
    updated_at INTEGER DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (kind, sport, days, gap)
);
CREATE TABLE interval_bodies (
    activity_id TEXT PRIMARY KEY,
    raw TEXT NOT NULL,
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);
CREATE TABLE calendar_event_bodies (
    event_id TEXT PRIMARY KEY,
    -- Event day as epoch seconds, so range queries do not parse JSON.
    date INTEGER NOT NULL,
    raw TEXT NOT NULL,
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);
CREATE TABLE stream_bodies (
    activity_id TEXT NOT NULL,
    -- The requested series, comma-joined and sorted. A latlng-only preview and
    -- a full chart pull are different payloads for the same activity.
    types TEXT NOT NULL,
    raw TEXT NOT NULL,
    updated_at INTEGER DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (activity_id, types)
);
CREATE TABLE identity_state (
    key TEXT PRIMARY KEY,
    blob BLOB NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO identity_state VALUES('section_identity',x'05c7701f0000edd97b5054d71d07702ddae2f84a1bdb9031f86a26a18964f62e5128b581001da4c109b560d209753dec3dbb7b76ef3d7739e7ecca1235243e522bd3d8105bb58c352db00f5eab28621eba016c8248622a69636233d266c4466d6d63a6918eb6b3bbb0f8cb9cf49f4effeadebf2e77efe7ee63cef972bfe76e0b397c5c608639e1cfb6b811433adff6a22be5904a3837342fb6b819e6dcc3b0c54106f32ed8625b27c3568fb0203bc358c7540ce65dca8a6d0775ccecd8a27b840769169b66186c70caf8168ebfc6492db630248831987726ae8e0843afe2c2a0d8e23018a935a8850bece643d3cff9bd84932a0d3f1de016537453b604dc86e6d308c5e7a6acd81cd09020c2a3e2c1fce23b5b0ecf9c9b11d40c6a1f3f94ee60e145fd8d41ac616ff41de960fe53e7631f07427fe5e9970d08eb47533a7b00bc288181693fb37743e84fbfb07718c0ab32d85679fb0d085f2b1fd87a15c04f253058be385204e1fb3bdaaa67df0aeb62ee33df31f8cf516d07849ff43e57f90d00a749de31f4ebf6b4df0248e65e67c5df013055025b1f6127ee84f03e53851901384b063fcea9461016d973d23701789b04b6edbd991e8070edbef9a97b019c2781ed057d037f85b066f8c6c7dd00a6c9e047dbbdcb216c9879fe833300de25811dcf3fba642384f10f71cb58ad5b24819db9f3deec87f0755fcbe19900de2d8323ef3d3913c291f0f6fdf702982181d1935643181d4b45002e95c0030a3eb30740e7d7163cea5d07a04906cfdeffd40884d181b301c00725f060dddf96c204707eb7feaba5bb01cc91c0ae8cee77610238d5de4fb30f03b842064f6fd80213c0b9e9fafb4bde06305f020fd51498600238f7988ecdbe026091041e5ef4a53fc0047076d9f75f9f01e04a197c7d683b4c00e7d0becd1fde0360a904761b0dcb60023847dfb1bd55006099041eb9e3f13fc204707d6156c94b6b012c97c1e30b7e0213c07557e1d2e65a001f97c01edb87b930015ccb6be7eefc3980951278744ef0024c005759f8ef4f7601b84e06bb8d069800aed8af03a02a812fad5d960713c0b57541cff72e03e890c097a78f5d8209e0fa65c52fbe9d0aa02683ed91dd30015c47eb3765dc0da05b025fa9d8560413c075a60fdd9e0fa090c11b8f5c8509e0ba325678f38700d648e0abcd5f6e3c0f12404b55eef9b30fc00d1278acf4f7253001b4258e19c3bb008cff8384f700c7ae357e0213405bb1eff2f103006e91bce3f1c6aa176102686bde792bf426803f92c04851c62a98005af5ac83bb3e02b05e062f5d198309a0ed28dcf5f41701dc2981af3574b5c004d09a6b6bb42500be2081bddff2ad8609a01d3ff0c4637900ee96c13f3df42f9800dad98b0f153c0160a304f6ed98d6ba0e0e806b0b1767ae0770bf04f69b4f3e0613409fb3665a5a03804d32f8dece1498007a46fd684a18c080049e78a6220c13402fe81bf8cb2900db24f037f7cdaf8409a0578eb59dbd08605806df1e498509a0af579e3b311dc0431218bf53b8f50e59ffa983851703d823816f2cd6104c00bd351a3a00be228303e6d93001f413bfcbd9f60300231238e0fec7519800faf9d9f3abbd00f64be0c9b4576df7c2ef385678b3f27900df90c1c8e6afc004a0f36a478a3b003c2581838e95c76002d0070ef49b4f02785a024fdd36c7091380aebce84f1f057058068f0cdf0113805a17fe78460a80ef4ae090654f1f4c00ba718d766d2180e762b0355abd84c56a78a84809d908e3c2c231a653430c0bc2b06a4122124a54375ee77763aa126aaff31b4c25146953032ab6124ebcb8b73956e8a63631633d9fec72cff819469a85a8479147181625fb9b0f66e528398a62ca562cf1bee7e7d81a6d6e1f4c49fbd57f3aaf89221d4782dc6d3051ee73e3a6d544c5c9aa080749b22a26d60a925531be1e92ac8a89c5a264554ccc8e64551c9f1dc9aa38b1949aac8a89d991ac8ae3b3235915276647b22a266647b22a8ecf8eff9faad8c370f43121a60209e2c50f5b05f112e12b51f777c15756236ac791eecf1cc45ecc38567b5b5102f2869046aa32195171a632b96b9edccd0a4f9c5d66b0e82fce1bb686260e95a893279a435c20264aa88a6be6053055637b651d2ae102512b5e8505667c307f637c7537a81216af9c4d1ce9587e4de57f70cdacffea9aa1585b2f8c95f5cffb6a1d133f4f394356cceb425683da888aa9150fe65d3e15dd86c24615c72cfeb4347eb576e4c50cd9f1f7dd0c2335f138b7cd6d102a8a30e544f87636732bd270a49df00a8e5911b6118ad5de2017a88a6844f8122c8429235647f4a9f1b31d89675dc588d05591c9bf4b0dce57453a91d75ecc908acb30b3622a229d3aaa0107dab86088d81d8262ce23cd2e0d711e6921bc94d8446f1343d415f147071731e8d4a0c7ad2281d5874524686538be7bf6eb66937979a6a2642a4ab9293bd79c959ba53c60ca56149369d972d3fd2653aec9d46267c88b795d5374f9e385c991f5390333181bb91e9aa9047442a38b26d5535a10333c54adfb37','2026-11-11 07:23:31');
CREATE TABLE IF NOT EXISTS "section_activities" (
    section_id TEXT NOT NULL,
    activity_id TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT 'same',
    start_index INTEGER NOT NULL DEFAULT 0,
    end_index INTEGER NOT NULL DEFAULT 0,
    distance_meters REAL NOT NULL DEFAULT 0,
    lap_time REAL,
    lap_pace REAL,
    excluded INTEGER NOT NULL DEFAULT 0,
    avg_hr REAL, coverage REAL, avg_power REAL, hr_empty INTEGER NOT NULL DEFAULT 0, power_empty INTEGER NOT NULL DEFAULT 0, time_empty INTEGER NOT NULL DEFAULT 0, projected_m REAL,
    PRIMARY KEY (section_id, activity_id, start_index),
    FOREIGN KEY (section_id) REFERENCES sections(id) ON DELETE CASCADE,
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);
INSERT INTO section_activities VALUES('auto_1794381811071__00000','lib-ride-1','same',20,80,470,61,7.704918032786885,0,NULL,1,NULL,0,0,0,NULL);
INSERT INTO section_activities VALUES('auto_1794381811071__00000','lib-ride-2','same',20,80,470,58.5,8.034188034188034,0,NULL,1,NULL,0,0,0,NULL);
INSERT INTO section_activities VALUES('auto_1794381811071__00000','lib-ride-3','same',20,80,470,63.2,7.436708860759493,0,NULL,1,NULL,0,0,0,NULL);
INSERT INTO section_activities VALUES('custom_1794381811072__00001','lib-run-1','same',10,60,390,95,4.1,0,NULL,1,NULL,0,0,0,NULL);
CREATE TABLE section_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id TEXT NOT NULL,
    at TEXT NOT NULL DEFAULT (datetime('now')),
    kind TEXT NOT NULL,
    details TEXT,
    geometry_version INTEGER
);
INSERT INTO section_history VALUES(1,'auto_1794381811071__00000','2026-11-11 07:23:31','superseded','{"overlap_fraction":1.0,"superseded_by":"custom_1794381811072__00000"}',NULL);
INSERT INTO section_history VALUES(2,'custom_1794381811072__00000','2026-11-11 07:23:31','superseded','{"overlap_fraction":1.0,"supersedes":"auto_1794381811071__00000"}',NULL);
INSERT INTO section_history VALUES(3,'custom_1794381811072__00000','2026-11-11 07:23:31','archived','{"created_at":"2026-11-11T07:23:31.072103809+00:00","distance_meters":470.0,"name":"Old drag","sport_type":"Ride","visit_count":3}',1);
INSERT INTO section_history VALUES(4,'custom_1794381811072__00000','2026-11-11 07:23:31','superseded','{"distance_meters":470.0,"name":"Old drag","overlap_fraction":null,"superseded_by":"auto_1794381811071__00000","visit_count":3}',NULL);
INSERT INTO section_history VALUES(5,'auto_1794381811071__00000','2026-11-11 07:23:31','superseded','{"overlap_fraction":null,"supersedes":"custom_1794381811072__00000"}',NULL);
INSERT INTO section_history VALUES(6,'auto_1794381811071__00000','2026-11-11 07:23:31','renamed','{"from":"Section 1","to":"Vineyard climb"}',NULL);
CREATE TABLE section_geometry (
    section_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    encoding INTEGER NOT NULL DEFAULT 1,
    blob BLOB NOT NULL,
    milestone INTEGER NOT NULL DEFAULT 0,
    rep_activity_id TEXT,
    rep_start_index INTEGER,
    rep_end_index INTEGER,
    source TEXT CHECK(source IS NULL OR source IN ('exact', 'consensus', 'orphaned')), point_count INTEGER, rep_reversed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (section_id, version)
);
INSERT INTO section_geometry VALUES('custom_1794381811072__00000',1,'2026-11-11 07:23:31',1,x'3c01a0d9872c80bb8107d84f28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a',1,'lib-ride-1',20,81,'orphaned',NULL,0);
INSERT INTO section_geometry VALUES('auto_1794381811071__00000',1,'2026-11-11 07:23:31',1,x'3c01a0d9872c80bb8107d84f28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a',1,NULL,NULL,NULL,'consensus',NULL,0);
CREATE TABLE section_pins (
    section_id TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO section_pins VALUES('auto_1794381811071__00000',1,'2026-11-11 07:23:31');
CREATE TABLE evidence_cache (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    config_digest TEXT NOT NULL,
    folded_ids BLOB NOT NULL,
    cache BLOB NOT NULL,
    updated_at INTEGER NOT NULL
, dirty_clusters INTEGER);
CREATE TABLE activity_streams (
    activity_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    data BLOB NOT NULL,
    sample_count INTEGER NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (activity_id, kind)
);
CREATE TABLE recordings (
    id TEXT PRIMARY KEY,
    fit_path TEXT NOT NULL,
    streams_path TEXT,
    activity_type TEXT NOT NULL,
    name TEXT NOT NULL,
    start_time INTEGER NOT NULL,
    duration_seconds INTEGER NOT NULL,
    distance_meters REAL NOT NULL,
    elevation_gain REAL,
    avg_heartrate REAL,
    paired_event_id INTEGER,
    created_at INTEGER NOT NULL,
    upload_status TEXT NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_attempt_at INTEGER,
    last_error TEXT,
    intervals_activity_id TEXT,
    engine_activity_id TEXT
, engine_reconciled INTEGER NOT NULL DEFAULT 0, athlete_id TEXT, kind TEXT NOT NULL DEFAULT 'fit', notes TEXT, rpe INTEGER, rpe_sent INTEGER NOT NULL DEFAULT 0, upload_in_doubt INTEGER NOT NULL DEFAULT 0);
CREATE TABLE job_attempts (
    -- `kind` plus its ordered discriminants, joined by colons, which is the
    -- vocabulary `spawn_once` already writes at seven call sites. A key over an
    -- unbounded list is the count and a hash of it, never the list.
    key TEXT PRIMARY KEY,

    -- Failures behind this key. Zero for a key that has only ever been claimed,
    -- so a lease a restart frees is not also in a backoff.
    attempts INTEGER NOT NULL DEFAULT 0,

    -- When the last attempt started or ended, in epoch milliseconds. The
    -- backoff is measured from it.
    last_attempt_at INTEGER,

    -- What the last failure said, for a caller that has to show it.
    last_error TEXT,

    -- Why the last attempt was refused, named from the `FfiStartOutcome`
    -- taxonomy so nothing re-derives it from an error string.
    last_refusal TEXT,

    -- The lease, and it is a generation rather than a deadline. The engine
    -- mints one at init, and a row is held only while this equals the current
    -- generation, so every row a dead process left behind is free the moment
    -- the next launch mints, whether that process exited cleanly, was killed or
    -- panicked. A deadline alone would strand a row for its whole duration
    -- after a crash, which is the failure sections/conditioning.rs argues
    -- against in writing.
    --
    -- The within-run stall is a second mechanism and not this one. It is not
    -- built here: nothing yet holds a lease long enough for it to matter, and a
    -- deadline nobody needs is a column that lies.
    lease_gen INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE activity_stream_backfill (
    activity_id TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
, withheld INTEGER NOT NULL DEFAULT 0, settled_version TEXT);
CREATE TABLE eftp_changes (
    activity_id TEXT PRIMARY KEY,
    date INTEGER NOT NULL,
    eftp REAL NOT NULL,
    delta REAL NOT NULL,
    activity_name TEXT NOT NULL
);
CREATE TABLE activity_census (
    athlete_id TEXT NOT NULL,
    intervals_id TEXT NOT NULL,
    start_date_local TEXT,
    created TEXT,
    icu_sync_date TEXT,
    census_at TEXT NOT NULL DEFAULT (datetime('now')), fetched_sync_date TEXT, has_latlng INTEGER NOT NULL DEFAULT 0, track_refusal TEXT, track_refused_sync_date TEXT, track_fetch_failures INTEGER NOT NULL DEFAULT 0, track_failed_sync_date TEXT, has_series INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (athlete_id, intervals_id)
);
CREATE TABLE IF NOT EXISTS "pace_history" (
    date INTEGER NOT NULL,
    sport_type TEXT NOT NULL,
    critical_speed REAL NOT NULL,
    d_prime REAL,
    r2 REAL,
    window_days INTEGER,
    PRIMARY KEY (date, sport_type, window_days)
);
CREATE TABLE push_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    activity_id TEXT NOT NULL,
    outcome TEXT NOT NULL,
    detail TEXT
, posted_title TEXT, posted_body TEXT);
CREATE TABLE route_numbers (
    route_id TEXT PRIMARY KEY NOT NULL,
    number INTEGER NOT NULL UNIQUE CHECK (number > 0)
);
INSERT INTO route_numbers VALUES('lib-route-1',1);
CREATE TABLE section_numbers (
    section_id TEXT PRIMARY KEY NOT NULL,
    number INTEGER NOT NULL UNIQUE CHECK (number > 0)
);
INSERT INTO section_numbers VALUES('auto_1794381811071__00000',1);
INSERT INTO section_numbers VALUES('custom_1794381811072__00000',2);
INSERT INTO section_numbers VALUES('custom_1794381811072__00001',3);
CREATE TABLE section_forced_matches (
    section_id TEXT NOT NULL,
    activity_id TEXT NOT NULL,
    forced_at INTEGER NOT NULL,
    PRIMARY KEY (section_id, activity_id)
);
CREATE TABLE section_rank_inputs (
    section_id TEXT NOT NULL,
    sport_type TEXT NOT NULL,
    traversal_count INTEGER NOT NULL,
    last_date INTEGER NOT NULL,
    improvement_score REAL NOT NULL,
    improvement_change REAL,
    improvement_basis INTEGER,
    anomaly_score REAL NOT NULL,
    best_time_secs REAL NOT NULL,
    best_date REAL,
    median_recent_secs REAL NOT NULL,
    trend INTEGER NOT NULL,
    PRIMARY KEY (section_id, sport_type)
) WITHOUT ROWID;
INSERT INTO section_rank_inputs VALUES('auto_1794381811071__00000','Ride',3,1761172800,0.4819672131147541,-0.03606557377049185,1,0.3992911138638189,58.5,1761086400,61,0);
INSERT INTO section_rank_inputs VALUES('custom_1794381811072__00001','Run',1,1761259200,0.5,NULL,NULL,0,95,1761259200,95,0);
CREATE TABLE section_rank_dirty (
    section_id TEXT PRIMARY KEY
) WITHOUT ROWID;
CREATE TABLE section_rank_dirty_activity (
    activity_id TEXT PRIMARY KEY
) WITHOUT ROWID;
CREATE TABLE route_line_layer (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    generation INTEGER NOT NULL,
    route_count INTEGER NOT NULL,
    layer BLOB NOT NULL
);
INSERT INTO route_line_layer VALUES(1,0,1,x'01c123000000010b6c69622d726f7574652d31010113020180d3872ce09b8107904e9825f8b901a609');
CREATE TABLE activity_climb_bests (
    activity_id TEXT NOT NULL,
    window_s INTEGER NOT NULL,
    start_idx INTEGER NOT NULL,
    end_idx INTEGER NOT NULL,
    vam REAL NOT NULL,
    PRIMARY KEY (activity_id, window_s),
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS "section_intents" (
    id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('disabled', 'deleted', 'named', 'fixed', 'lift')),
    polyline_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    name TEXT,
    sport_type TEXT,
    polyline_blob BLOB,
    PRIMARY KEY (id, kind)
);
INSERT INTO section_intents VALUES('ni_1794381811075_auto_1794381811071__00000','named',NULL,'2026-11-11 07:23:31','Vineyard climb','Ride',x'c0f80000003c01a0d9872c80bb8107d84f28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a');
CREATE TABLE job_runs (
    -- detection, elevationBackfill, streamBackfill or cutover.
    job TEXT NOT NULL PRIMARY KEY,

    -- When the run finished, in epoch milliseconds.
    finished_at INTEGER NOT NULL,

    -- complete, partial, failed, paused or stopped.
    outcome TEXT NOT NULL,

    -- Items the run took on.
    handled INTEGER NOT NULL DEFAULT 0,

    added INTEGER NOT NULL DEFAULT 0,
    changed INTEGER NOT NULL DEFAULT 0,
    retired INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE activity_new_ground (
    activity_id TEXT NOT NULL PRIMARY KEY,
    tiles INTEGER NOT NULL,
    new_tiles INTEGER NOT NULL,
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE TABLE section_list_counts (
    section_type TEXT NOT NULL,
    user_defined INTEGER NOT NULL,
    removed INTEGER NOT NULL,
    n INTEGER NOT NULL,
    PRIMARY KEY (section_type, user_defined, removed)
) WITHOUT ROWID;
INSERT INTO section_list_counts VALUES('auto',0,0,1);
INSERT INTO section_list_counts VALUES('custom',1,0,1);
CREATE TABLE route_group_sizes (
    activity_count INTEGER NOT NULL PRIMARY KEY,
    n INTEGER NOT NULL
) WITHOUT ROWID;
INSERT INTO route_group_sizes VALUES(3,1);
CREATE TABLE swim_lengths (
    activity_id TEXT NOT NULL,
    length_index INTEGER NOT NULL,
    start_time INTEGER,
    elapsed_secs REAL,
    timer_secs REAL,
    length_type INTEGER,
    swim_stroke INTEGER,
    total_strokes INTEGER,
    avg_speed REAL,
    PRIMARY KEY (activity_id, length_index)
);
CREATE TABLE pool_swims (
    activity_id TEXT PRIMARY KEY,
    pool_length_m REAL
);
CREATE TABLE activity_sync_failures (
    activity_id TEXT PRIMARY KEY,
    message TEXT NOT NULL,
    failed_at INTEGER NOT NULL
);
CREATE TABLE activity_held_back (
    activity_id TEXT PRIMARY KEY,
    source TEXT,
    external_id TEXT
);
CREATE TABLE garmin_link_unresolved (
    activity_id TEXT PRIMARY KEY,
    candidates INTEGER NOT NULL
);
CREATE TABLE retired_ground_lines (
    section_id TEXT NOT NULL,
    side INTEGER NOT NULL,
    fingerprint INTEGER NOT NULL,
    PRIMARY KEY (section_id, side)
) WITHOUT ROWID;
CREATE TABLE retired_ground_pairs (
    retired_id TEXT NOT NULL,
    current_id TEXT NOT NULL,
    overlap REAL NOT NULL,
    PRIMARY KEY (retired_id, current_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS "sections" (
                 id TEXT PRIMARY KEY,
                 section_type TEXT NOT NULL CHECK(section_type IN ('auto', 'custom')),
                 name TEXT,
                 sport_type TEXT NOT NULL,
                 polyline_json TEXT,
                 distance_meters REAL NOT NULL,
                 representative_activity_id TEXT,
                 confidence REAL,
                 observation_count INTEGER,
                 average_spread REAL,
                 point_density_json TEXT,
                 scale TEXT,
                 version INTEGER DEFAULT 1,
                 is_user_defined INTEGER DEFAULT 0,
                 stability REAL,
                 source_activity_id TEXT,
                 start_index INTEGER,
                 end_index INTEGER,
                 created_at TEXT NOT NULL DEFAULT (datetime('now')),
                 updated_at TEXT,
                 bounds_min_lat REAL,
                 bounds_max_lat REAL,
                 bounds_min_lng REAL,
                 bounds_max_lng REAL,
                 original_polyline_json TEXT,
                 disabled INTEGER NOT NULL DEFAULT 0,
                 superseded_by TEXT DEFAULT NULL,
                 consensus_state_blob BLOB,
                 polyline_blob BLOB,
                 point_density_blob BLOB,
                 visit_count INTEGER NOT NULL DEFAULT 0,
                 rep_start_index INTEGER,
                 rep_end_index INTEGER,
                 geometry_source TEXT
                     CHECK(geometry_source IS NULL
                           OR geometry_source IN ('exact', 'consensus', 'orphaned')),
                 elevation_gain_m REAL,
                 avg_grade_percent REAL,
                 activity_count INTEGER NOT NULL DEFAULT 0,
                 sport_types TEXT,
                 elevation_loss_m REAL,
                 max_grade_percent REAL,
                 straightness REAL,
                 klass TEXT,
                 is_lift INTEGER NOT NULL DEFAULT 0,
                 rank_score REAL,
                 sport_rank_score REAL
             , "original_polyline_blob" BLOB, "rep_reversed" INTEGER DEFAULT 0 NOT NULL);
INSERT INTO sections VALUES('auto_1794381811071__00000','auto',NULL,'Ride',NULL,470,NULL,0.9,3,NULL,NULL,NULL,1,0,NULL,NULL,NULL,NULL,'2026-11-11T07:23:31.071100560+00:00',NULL,46.2004,46.20158,7.351999999999999,7.3579,NULL,0,NULL,NULL,x'c0f80000003c01a0d9872c80bb8107d84f28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a',NULL,3,NULL,NULL,'consensus',NULL,NULL,3,'Ride',NULL,NULL,NULL,NULL,0,NULL,NULL,NULL,0);
INSERT INTO sections VALUES('custom_1794381811072__00001','custom','Lake sprint','Run',NULL,390,'lib-run-1',NULL,NULL,NULL,NULL,NULL,1,1,NULL,'lib-run-1',10,60,'2026-11-11T07:23:31.072988528+00:00',NULL,46.2502,46.25118,7.401000000000001,7.4059,NULL,0,NULL,NULL,x'c0d00000003201b0e38d2cd0b88707c45e28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a',NULL,1,10,61,'exact',NULL,NULL,1,'Run',NULL,NULL,NULL,NULL,0,NULL,NULL,NULL,0);
PRAGMA writable_schema=ON;
CREATE TABLE IF NOT EXISTS sqlite_sequence(name,seq);
DELETE FROM sqlite_sequence;
INSERT INTO sqlite_sequence VALUES('section_history',6);
CREATE TRIGGER section_activities_visit_count_ai
             AFTER INSERT ON section_activities WHEN NOT EXISTS (SELECT 1 FROM schema_info WHERE key = 'section_summary_bulk') BEGIN
                 UPDATE sections SET visit_count = (SELECT COUNT(*) FROM section_activities sa
         JOIN sections s ON s.id = sa.section_id
         WHERE sa.section_id = NEW.section_id AND sa.excluded = 0 AND sa.direction != 'partial' AND (CASE WHEN sa.coverage IS NOT NULL THEN sa.coverage >= 0.9 WHEN s.distance_meters IS NULL OR s.distance_meters <= 0 THEN 1 ELSE sa.distance_meters >= s.distance_meters * 0.7 END)) WHERE id = NEW.section_id;
             END;
CREATE TRIGGER section_activities_visit_count_ad
             AFTER DELETE ON section_activities BEGIN
                 UPDATE sections SET visit_count = (SELECT COUNT(*) FROM section_activities sa
         JOIN sections s ON s.id = sa.section_id
         WHERE sa.section_id = OLD.section_id AND sa.excluded = 0 AND sa.direction != 'partial' AND (CASE WHEN sa.coverage IS NOT NULL THEN sa.coverage >= 0.9 WHEN s.distance_meters IS NULL OR s.distance_meters <= 0 THEN 1 ELSE sa.distance_meters >= s.distance_meters * 0.7 END)) WHERE id = OLD.section_id;
             END;
CREATE TRIGGER section_activities_visit_count_au
             AFTER UPDATE OF excluded, direction, coverage, distance_meters ON section_activities
             WHEN NOT EXISTS (SELECT 1 FROM schema_info WHERE key = 'section_summary_bulk') BEGIN
                 UPDATE sections SET visit_count = (SELECT COUNT(*) FROM section_activities sa
         JOIN sections s ON s.id = sa.section_id
         WHERE sa.section_id = NEW.section_id AND sa.excluded = 0 AND sa.direction != 'partial' AND (CASE WHEN sa.coverage IS NOT NULL THEN sa.coverage >= 0.9 WHEN s.distance_meters IS NULL OR s.distance_meters <= 0 THEN 1 ELSE sa.distance_meters >= s.distance_meters * 0.7 END)) WHERE id = NEW.section_id;
             END;
CREATE TRIGGER section_activities_visit_count_amove
             AFTER UPDATE OF section_id ON section_activities BEGIN
                 UPDATE sections SET visit_count = (SELECT COUNT(*) FROM section_activities sa
         JOIN sections s ON s.id = sa.section_id
         WHERE sa.section_id = NEW.section_id AND sa.excluded = 0 AND sa.direction != 'partial' AND (CASE WHEN sa.coverage IS NOT NULL THEN sa.coverage >= 0.9 WHEN s.distance_meters IS NULL OR s.distance_meters <= 0 THEN 1 ELSE sa.distance_meters >= s.distance_meters * 0.7 END)) WHERE id = NEW.section_id;
                 UPDATE sections SET visit_count = (SELECT COUNT(*) FROM section_activities sa
         JOIN sections s ON s.id = sa.section_id
         WHERE sa.section_id = OLD.section_id AND sa.excluded = 0 AND sa.direction != 'partial' AND (CASE WHEN sa.coverage IS NOT NULL THEN sa.coverage >= 0.9 WHEN s.distance_meters IS NULL OR s.distance_meters <= 0 THEN 1 ELSE sa.distance_meters >= s.distance_meters * 0.7 END)) WHERE id = OLD.section_id;
             END;
CREATE TRIGGER section_activities_visit_count_section_au
             AFTER UPDATE OF distance_meters ON sections BEGIN
                 UPDATE sections SET visit_count = (SELECT COUNT(*) FROM section_activities sa
         JOIN sections s ON s.id = sa.section_id
         WHERE sa.section_id = NEW.id AND sa.excluded = 0 AND sa.direction != 'partial' AND (CASE WHEN sa.coverage IS NOT NULL THEN sa.coverage >= 0.9 WHEN s.distance_meters IS NULL OR s.distance_meters <= 0 THEN 1 ELSE sa.distance_meters >= s.distance_meters * 0.7 END)) WHERE id = NEW.id;
             END;
CREATE TRIGGER section_activities_summary_ai
             AFTER INSERT ON section_activities WHEN NOT EXISTS (SELECT 1 FROM schema_info WHERE key = 'section_summary_bulk') BEGIN UPDATE sections SET
                     activity_count = (
                         SELECT COUNT(DISTINCT activity_id) FROM section_activities
                         WHERE section_id = NEW.section_id AND excluded = 0),
                     sport_types = (SELECT GROUP_CONCAT(DISTINCT COALESCE(am.sport_type, a.sport_type)) FROM section_activities sa
         JOIN activities a ON a.id = sa.activity_id
         LEFT JOIN activity_metrics am ON am.activity_id = sa.activity_id
         WHERE sa.section_id = NEW.section_id)
                 WHERE id = NEW.section_id; END;
CREATE TRIGGER section_activities_summary_ad
             AFTER DELETE ON section_activities BEGIN UPDATE sections SET
                     activity_count = (
                         SELECT COUNT(DISTINCT activity_id) FROM section_activities
                         WHERE section_id = OLD.section_id AND excluded = 0),
                     sport_types = (SELECT GROUP_CONCAT(DISTINCT COALESCE(am.sport_type, a.sport_type)) FROM section_activities sa
         JOIN activities a ON a.id = sa.activity_id
         LEFT JOIN activity_metrics am ON am.activity_id = sa.activity_id
         WHERE sa.section_id = OLD.section_id)
                 WHERE id = OLD.section_id; END;
CREATE TRIGGER section_activities_summary_au
             AFTER UPDATE OF excluded ON section_activities BEGIN UPDATE sections SET
                     activity_count = (
                         SELECT COUNT(DISTINCT activity_id) FROM section_activities
                         WHERE section_id = NEW.section_id AND excluded = 0),
                     sport_types = (SELECT GROUP_CONCAT(DISTINCT COALESCE(am.sport_type, a.sport_type)) FROM section_activities sa
         JOIN activities a ON a.id = sa.activity_id
         LEFT JOIN activity_metrics am ON am.activity_id = sa.activity_id
         WHERE sa.section_id = NEW.section_id)
                 WHERE id = NEW.section_id; END;
CREATE TRIGGER section_activities_summary_amove
             AFTER UPDATE OF section_id ON section_activities BEGIN UPDATE sections SET
                     activity_count = (
                         SELECT COUNT(DISTINCT activity_id) FROM section_activities
                         WHERE section_id = NEW.section_id AND excluded = 0),
                     sport_types = (SELECT GROUP_CONCAT(DISTINCT COALESCE(am.sport_type, a.sport_type)) FROM section_activities sa
         JOIN activities a ON a.id = sa.activity_id
         LEFT JOIN activity_metrics am ON am.activity_id = sa.activity_id
         WHERE sa.section_id = NEW.section_id)
                 WHERE id = NEW.section_id; UPDATE sections SET
                     activity_count = (
                         SELECT COUNT(DISTINCT activity_id) FROM section_activities
                         WHERE section_id = OLD.section_id AND excluded = 0),
                     sport_types = (SELECT GROUP_CONCAT(DISTINCT COALESCE(am.sport_type, a.sport_type)) FROM section_activities sa
         JOIN activities a ON a.id = sa.activity_id
         LEFT JOIN activity_metrics am ON am.activity_id = sa.activity_id
         WHERE sa.section_id = OLD.section_id)
                 WHERE id = OLD.section_id; END;
CREATE TRIGGER activity_metrics_sports_ai
             AFTER INSERT ON activity_metrics WHEN NOT EXISTS (SELECT 1 FROM schema_info WHERE key = 'section_summary_bulk') BEGIN UPDATE sections SET sport_types = (SELECT GROUP_CONCAT(DISTINCT COALESCE(am.sport_type, a.sport_type)) FROM section_activities sa
         JOIN activities a ON a.id = sa.activity_id
         LEFT JOIN activity_metrics am ON am.activity_id = sa.activity_id
         WHERE sa.section_id = sections.id)
                 WHERE id IN (SELECT section_id FROM section_activities
                              WHERE activity_id = NEW.activity_id); END;
CREATE TRIGGER activity_metrics_sports_au
             AFTER UPDATE OF sport_type ON activity_metrics BEGIN UPDATE sections SET sport_types = (SELECT GROUP_CONCAT(DISTINCT COALESCE(am.sport_type, a.sport_type)) FROM section_activities sa
         JOIN activities a ON a.id = sa.activity_id
         LEFT JOIN activity_metrics am ON am.activity_id = sa.activity_id
         WHERE sa.section_id = sections.id)
                 WHERE id IN (SELECT section_id FROM section_activities
                              WHERE activity_id = NEW.activity_id); END;
CREATE TRIGGER section_rank_dirty_sections_au
AFTER UPDATE OF distance_meters, disabled, superseded_by ON sections BEGIN
    INSERT INTO section_rank_dirty (section_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
END;
CREATE TRIGGER section_rank_dirty_sections_ad AFTER DELETE ON sections BEGIN
    DELETE FROM section_rank_inputs WHERE section_id = OLD.id;
    DELETE FROM section_rank_dirty WHERE section_id = OLD.id;
END;
CREATE TRIGGER section_rank_dirty_sa_ai AFTER INSERT ON section_activities BEGIN
    INSERT INTO section_rank_dirty (section_id) VALUES (NEW.section_id) ON CONFLICT DO NOTHING;
END;
CREATE TRIGGER section_rank_dirty_sa_ad AFTER DELETE ON section_activities BEGIN
    INSERT INTO section_rank_dirty (section_id) VALUES (OLD.section_id) ON CONFLICT DO NOTHING;
END;
CREATE TRIGGER section_rank_dirty_sa_au AFTER UPDATE ON section_activities BEGIN
    INSERT INTO section_rank_dirty (section_id) VALUES (OLD.section_id) ON CONFLICT DO NOTHING;
    INSERT INTO section_rank_dirty (section_id) VALUES (NEW.section_id) ON CONFLICT DO NOTHING;
END;
CREATE TRIGGER section_rank_dirty_metrics_ai AFTER INSERT ON activity_metrics BEGIN
    INSERT INTO section_rank_dirty_activity (activity_id) VALUES (NEW.activity_id) ON CONFLICT DO NOTHING;
END;
CREATE TRIGGER section_rank_dirty_metrics_au AFTER UPDATE OF date ON activity_metrics BEGIN
    INSERT INTO section_rank_dirty_activity (activity_id) VALUES (NEW.activity_id) ON CONFLICT DO NOTHING;
END;
CREATE TRIGGER section_rank_dirty_metrics_sport_au AFTER UPDATE OF sport_type ON activity_metrics BEGIN
    INSERT INTO section_rank_dirty_activity (activity_id) VALUES (NEW.activity_id) ON CONFLICT DO NOTHING;
END;
CREATE TRIGGER section_rank_dirty_metrics_ad AFTER DELETE ON activity_metrics BEGIN
    INSERT INTO section_rank_dirty_activity (activity_id) VALUES (OLD.activity_id) ON CONFLICT DO NOTHING;
END;
CREATE TRIGGER section_rank_dirty_activities_au AFTER UPDATE OF sport_type ON activities BEGIN
    INSERT INTO section_rank_dirty_activity (activity_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
END;
CREATE TRIGGER section_list_counts_ai AFTER INSERT ON sections BEGIN
    INSERT INTO section_list_counts (section_type, user_defined, removed, n)
    VALUES (NEW.section_type, COALESCE(NEW.is_user_defined, 0) != 0,
            NEW.disabled != 0 OR NEW.superseded_by IS NOT NULL, 1)
    ON CONFLICT(section_type, user_defined, removed) DO UPDATE SET n = n + 1;
END;
CREATE TRIGGER section_list_counts_ad AFTER DELETE ON sections BEGIN
    INSERT INTO section_list_counts (section_type, user_defined, removed, n)
    VALUES (OLD.section_type, COALESCE(OLD.is_user_defined, 0) != 0,
            OLD.disabled != 0 OR OLD.superseded_by IS NOT NULL, -1)
    ON CONFLICT(section_type, user_defined, removed) DO UPDATE SET n = n - 1;
END;
CREATE TRIGGER section_list_counts_au
AFTER UPDATE OF section_type, is_user_defined, disabled, superseded_by ON sections BEGIN
    INSERT INTO section_list_counts (section_type, user_defined, removed, n)
    VALUES (OLD.section_type, COALESCE(OLD.is_user_defined, 0) != 0,
            OLD.disabled != 0 OR OLD.superseded_by IS NOT NULL, -1)
    ON CONFLICT(section_type, user_defined, removed) DO UPDATE SET n = n - 1;
    INSERT INTO section_list_counts (section_type, user_defined, removed, n)
    VALUES (NEW.section_type, COALESCE(NEW.is_user_defined, 0) != 0,
            NEW.disabled != 0 OR NEW.superseded_by IS NOT NULL, 1)
    ON CONFLICT(section_type, user_defined, removed) DO UPDATE SET n = n + 1;
END;
CREATE TRIGGER route_group_sizes_ai
AFTER INSERT ON route_groups WHEN NEW.activity_count IS NOT NULL BEGIN
    INSERT INTO route_group_sizes (activity_count, n) VALUES (NEW.activity_count, 1)
    ON CONFLICT(activity_count) DO UPDATE SET n = n + 1;
END;
CREATE TRIGGER route_group_sizes_ad
AFTER DELETE ON route_groups WHEN OLD.activity_count IS NOT NULL BEGIN
    INSERT INTO route_group_sizes (activity_count, n) VALUES (OLD.activity_count, -1)
    ON CONFLICT(activity_count) DO UPDATE SET n = n - 1;
END;
CREATE TRIGGER route_group_sizes_au_old
AFTER UPDATE OF activity_count ON route_groups WHEN OLD.activity_count IS NOT NULL BEGIN
    INSERT INTO route_group_sizes (activity_count, n) VALUES (OLD.activity_count, -1)
    ON CONFLICT(activity_count) DO UPDATE SET n = n - 1;
END;
CREATE TRIGGER route_group_sizes_au_new
AFTER UPDATE OF activity_count ON route_groups WHEN NEW.activity_count IS NOT NULL BEGIN
    INSERT INTO route_group_sizes (activity_count, n) VALUES (NEW.activity_count, 1)
    ON CONFLICT(activity_count) DO UPDATE SET n = n + 1;
END;
CREATE TRIGGER sections_number_ai AFTER INSERT ON sections
WHEN NOT EXISTS (SELECT 1 FROM section_numbers WHERE section_id = NEW.id)
BEGIN
    INSERT INTO section_numbers (section_id, number) VALUES (NEW.id, (
        SELECT COALESCE(MAX(number), 0) + 1 FROM section_numbers
    ));
END;
CREATE INDEX idx_activities_sport ON activities(sport_type);
CREATE INDEX idx_activities_bounds ON activities(min_lat, max_lat, min_lng, max_lng);
CREATE INDEX idx_activity_matches_route ON activity_matches(route_id);
CREATE INDEX idx_overlap_cache_a ON overlap_cache(activity_a);
CREATE INDEX idx_overlap_cache_b ON overlap_cache(activity_b);
CREATE INDEX idx_heatmap_date ON activity_heatmap(date);
CREATE INDEX idx_exercise_sets_activity ON exercise_sets(activity_id);
CREATE INDEX idx_activity_indicators_activity ON activity_indicators(activity_id);
CREATE INDEX idx_activity_indicators_target ON activity_indicators(target_id);
CREATE INDEX idx_wellness_date_desc ON wellness(date DESC);
CREATE INDEX idx_activity_metrics_sport_date
    ON activity_metrics(sport_type, date DESC);
CREATE INDEX idx_activity_bodies_date ON activity_bodies(date DESC);
CREATE INDEX idx_calendar_event_bodies_date ON calendar_event_bodies(date);
CREATE INDEX idx_stream_bodies_updated ON stream_bodies(updated_at);
CREATE INDEX idx_section_activities_activity
    ON section_activities(activity_id);
CREATE INDEX idx_section_activities_perf
    ON section_activities(section_id, excluded, lap_time);
CREATE INDEX idx_section_history_section
    ON section_history(section_id, at);
CREATE INDEX idx_section_history_at
    ON section_history(at);
CREATE INDEX idx_activity_streams_activity
    ON activity_streams(activity_id);
CREATE INDEX idx_section_activities_coverage
    ON section_activities(section_id, coverage);
CREATE INDEX idx_activity_matches_activity ON activity_matches(activity_id, route_id);
CREATE UNIQUE INDEX idx_activities_intervals_id
    ON activities(intervals_id) WHERE intervals_id IS NOT NULL;
CREATE INDEX idx_recordings_created_at ON recordings(created_at DESC);
CREATE INDEX idx_recordings_upload_status ON recordings(upload_status);
CREATE INDEX idx_recordings_athlete_id ON recordings(athlete_id);
CREATE INDEX idx_job_attempts_lease_gen ON job_attempts(lease_gen);
CREATE INDEX idx_activity_metrics_date ON activity_metrics(date);
CREATE INDEX idx_activities_start_date
    ON activities (start_date)
    WHERE start_date IS NOT NULL;
CREATE INDEX idx_eftp_changes_date ON eftp_changes(date);
CREATE INDEX idx_activity_census_date
    ON activity_census(athlete_id, start_date_local);
CREATE INDEX idx_pace_history_sport_date ON pace_history(sport_type, date DESC);
CREATE INDEX idx_push_runs_ts ON push_runs(ts DESC, id DESC);
CREATE UNIQUE INDEX idx_activity_bodies_intervals_id
    ON activity_bodies(intervals_id) WHERE intervals_id IS NOT NULL;
CREATE INDEX idx_section_forced_matches_activity
    ON section_forced_matches(activity_id);
CREATE INDEX idx_section_geometry_orphaned
    ON section_geometry(rep_activity_id) WHERE source = 'orphaned';
CREATE INDEX idx_activity_census_trackless_series
    ON activity_census(intervals_id) WHERE has_series = 1 AND has_latlng = 0;
CREATE INDEX idx_retired_ground_pairs_current ON retired_ground_pairs(current_id);
CREATE INDEX idx_sections_type ON sections(section_type);
CREATE INDEX idx_sections_sport ON sections(sport_type);
CREATE INDEX idx_sections_disabled ON sections(disabled);
CREATE INDEX idx_sections_superseded ON sections(superseded_by);
CREATE INDEX idx_sections_rank_score ON sections(rank_score);
CREATE INDEX idx_sections_klass ON sections(klass);
CREATE INDEX idx_sections_unnamed ON sections(id) WHERE name IS NULL;
CREATE INDEX idx_sections_list_visits
    ON sections((disabled != 0 OR superseded_by IS NOT NULL), visit_count DESC, id);
CREATE INDEX idx_sections_list_distance
    ON sections((disabled != 0 OR superseded_by IS NOT NULL), distance_meters DESC, id);
CREATE INDEX idx_sections_list_signature
    ON sections((disabled != 0 OR superseded_by IS NOT NULL), COALESCE(rank_score, -1.0) DESC, id);
CREATE INDEX idx_route_groups_activity_count
    ON route_groups(activity_count DESC);
PRAGMA writable_schema=OFF;
COMMIT;
PRAGMA user_version=81;
