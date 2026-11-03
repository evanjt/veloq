-- The library a 0.4.0 install leaves on disk, at user_version 79.
-- Written by `examples/released_library.rs` on an engine whose migrations,
-- schema hooks, stored encodings and write paths are the 0.4.0 tag's, then
-- `sqlite3 .dump` with the user_version the dump leaves out appended. The one
-- later write, the pass count on a retirement event, is taken back out of
-- history row 4, since 0.4.0 did not record it.
-- Never regenerate it from a later build: it stands for what 0.4.0 wrote.
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE schema_info (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
INSERT INTO schema_info VALUES('named_backfill_done','1');
INSERT INTO schema_info VALUES('legacy_suppression_backfill_done','1');
INSERT INTO schema_info VALUES('orphan_superseded_repair_done','1');
INSERT INTO schema_info VALUES('section_geometry_baseline_v1','2026-11-03 07:15:53');
INSERT INTO schema_info VALUES('content_ids_v1','1');
INSERT INTO schema_info VALUES('indicator_version','7');
INSERT INTO schema_info VALUES('pass_rule_version','4');
INSERT INTO schema_info VALUES('schema_version','79');
INSERT INTO schema_info VALUES('last_migration','2026-11-03 07:15:53');
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
INSERT INTO activities VALUES('lib-ride-1','Ride',46.20000000000000284,46.20238000000000511,7.349999999999999645,7.361899999999999444,1793690153,1761000000,'Morning loop',1200.0,240,'lib-ride-1');
INSERT INTO activities VALUES('lib-ride-2','Ride',46.20000000000000284,46.20238000000000511,7.349999999999999645,7.361899999999999444,1793690153,1761086400,'Lunch loop',1200.0,240,'lib-ride-2');
INSERT INTO activities VALUES('lib-ride-3','Ride',46.20000000000000284,46.20238000000000511,7.349999999999999645,7.361899999999999444,1793690153,1761172800,'Evening loop',1200.0,240,'lib-ride-3');
INSERT INTO activities VALUES('lib-run-1','Run',46.25,46.25157999999999703,7.400000000000000355,7.407900000000000596,1793690153,1761259200,'Lakeside run',1200.0,240,'lib-run-1');
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
INSERT INTO signatures VALUES('lib-ride-1',X'c00f000000020080d3872ce09b81079825f8b901',46.20000000000000284,7.349999999999999645,46.20238000000000511,7.361899999999999444,953.308669203843693,2);
INSERT INTO signatures VALUES('lib-ride-2',X'c00f000000020080d3872ce09b81079825f8b901',46.20000000000000284,7.349999999999999645,46.20238000000000511,7.361899999999999444,953.308669203843693,2);
INSERT INTO signatures VALUES('lib-ride-3',X'c00f000000020080d3872ce09b81079825f8b901',46.20000000000000284,7.349999999999999645,46.20238000000000511,7.361899999999999444,953.308669203843693,2);
INSERT INTO signatures VALUES('lib-run-1',X'c00e0000000200a0e08d2c80a98707d818b87b',46.25,7.400000000000000355,46.25157999999999703,7.407900000000000596,632.3412790923410967,2);
CREATE TABLE gps_tracks (
    activity_id TEXT PRIMARY KEY,
    track_data BLOB NOT NULL,
    point_count INTEGER NOT NULL, elevation_source INTEGER NOT NULL DEFAULT 0, elevation_settled_version TEXT, elevation_state INTEGER NOT NULL DEFAULT 0, elevation_attempts INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (activity_id) REFERENCES activities(id) ON DELETE CASCADE
);
INSERT INTO gps_tracks VALUES('lib-ride-1',X'c0e8010000780180d3872ce09b8107904e28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a',120,0,NULL,0,0);
INSERT INTO gps_tracks VALUES('lib-ride-2',X'c0e8010000780180d3872ce09b8107904e28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a',120,0,NULL,0,0);
INSERT INTO gps_tracks VALUES('lib-ride-3',X'c0e8010000780180d3872ce09b8107904e28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a',120,0,NULL,0,0);
INSERT INTO gps_tracks VALUES('lib-run-1',X'c0480100005001a0e08d2c80a98707e05d28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a',80,0,NULL,0,0);
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
INSERT INTO route_groups VALUES('lib-route-1','lib-ride-1','["lib-ride-1","lib-ride-2","lib-ride-3"]','Ride',46.20000000000000284,46.20239999999999725,7.349999999999999645,7.361900000000000332,3,NULL,0);
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
INSERT INTO activity_matches VALUES('lib-route-1','lib-ride-1',100.0,'same',0);
INSERT INTO activity_matches VALUES('lib-route-1','lib-ride-2',97.5,'same',0);
INSERT INTO activity_matches VALUES('lib-route-1','lib-ride-3',96.0,'same',0);
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
INSERT INTO activity_metrics VALUES('lib-ride-1','Morning loop',1761000000,1200.0,240,260,30.0,142,210,'Ride',18.0,250,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0);
INSERT INTO activity_metrics VALUES('lib-ride-2','Lunch loop',1761086400,1200.0,240,260,30.0,142,210,'Ride',18.0,250,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0);
INSERT INTO activity_metrics VALUES('lib-ride-3','Evening loop',1761172800,1200.0,240,260,30.0,142,210,'Ride',18.0,250,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0);
INSERT INTO activity_metrics VALUES('lib-run-1','Lakeside run',1761259200,1200.0,240,260,30.0,142,210,'Run',18.0,250,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0);
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
INSERT INTO settings VALUES('__activity_body_fields','id,name,type,start_date_local,moving_time,elapsed_time,distance,total_elevation_gain,average_speed,max_speed,average_heartrate,max_heartrate,icu_average_watts,icu_pm_p_max,average_cadence,calories,icu_training_load,icu_intensity,decoupling,has_weather,average_weather_temp,icu_ftp,stream_types,skyline_chart_bytes,description,source,external_id,_note,icu_pm_ftp_watts,icu_zone_times,icu_hr_zone_times,icu_power_zones,icu_hr_zones,icu_rolling_ftp,icu_rolling_ftp_delta',1793690153);
INSERT INTO settings VALUES('__detector_cutover','unified-1',1793690153);
INSERT INTO settings VALUES('unit_system','metric',1793690153);
INSERT INTO settings VALUES('__athlete_id','demo',1793690153);
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
INSERT INTO identity_state VALUES('section_identity',X'05c7581f0000edd97b5054d71d07702ddae0f8cac35633065fcd243491ccee1250a90d04e8200d4e8805934ea8eb61efd9ddb37befb9cb39675796a821f1915a99c686d8a8618c49817df05a4511f3d00d60135c494c256d4c6c46da8cd8a8ad6dcc34d2d1767617167f9d93fed3e95fddfbd7e5eefddc7dcc395feef7dcad41bb970bcc3027fcb966176248e35b5f75a61c5408e7baeac16617c39cbb1936db4924f7bc35b675306c710b33b2318c354c4524f762666c3ba06166c366cd2ddc48355b555d679109a35b28fe1a2735d8cc90207a24f7745c1d16ba56c9854eb1d9ae3352a3533317d8c507269ff5790827952a7ec6cfcd86e866dcec77e9aa5725149f9db07c935f458208b78223794577361f9a3a333da0ead4367a28cdce420bfa1a0258c59ee83bd248ded3e7621f07425fc5a9377408eb86533aba01bc2081fe49bfb47541e84b3bbf6710c02b32d85a71c77508df2eebdf7205c0af243050b6305c08e127db5baba6df0c6b63eedfbe63e01fc3ea7608bfec79bee2bb004e92bc63f0576d737e032099798d15fd00c054096c79841dbf13c2fb0ce52604e03419fc62691582b0d0b6346d2380b74a60eb9e1b697e08d7ec9d9bba07c05912d896dfdbff1708ab07af7fd105e01c19fc7c9b271bc2faa9e73e3d0de05d12d8fec2a38b364018ff10378dd5da0512d89133ebbd3e08dff1361f9a0ae0dd3238f4f15353211c0a6ddb772f80e912183d691584d1b15408e06209dc6fc4a77703e8f8f6bc473d6b0134c8e099fb9f1e82303a70d603f8a0041ea8fdeb6298008e1fd67dab6417804b25b033bdeb2398000ea5e7ab2587005c2e83a7d66f8609e0d878ed93451f0098278107abf30d30011cbb0d47a75f06b050020f2db8e5f730011c9db67dd7a600b84206df19d80613c031b077d367f7005822815d7a7d164c00c7f087d6f7f3012c95c0c3b39ff8034c00e737a615bfbe06c032193c36efe730019c77152c6eaa01f00909ecb67e960313c0995d3373c74b005648e0911981f330019ca5a1bf3dd509e05a19ecd2eb61023863bf0e808a04bebe262b17268073cbbceec72e016897c037268f5c8409e07ca5fce5efa702a8ca605b78174c00e791ba8de97703e892c037cbb716c204709eee4577e4012864f0fa23576002382f8f14dcf80980d512f856d36d0de74002a8a9c67bfee40570bd041e2df95d314c0075917dcae04e00e3ff20e13dc0d1ab0d5fc2045097efbd746c3f809b25ef78aca1f2559800eaea0fdf0fbe07e04f25305c98be1226805a35edc0cecf01ac93c18b97476002a8db0b763ef34d007748e0dbf59dcd3001d4a69a6a7511802f4a60cff7bcab6002a8c7f63ff9782e80bb64f08f0ffd1326807ae6c243f94f02d82081bddb27b5ac8503e0eafc8519eb00dc27817da6138fc304d066ac9e34a71ec04619fc78470a4c002dbd6e382504a05f028f3f5b1e8209a0e5f7f6fff92480ad12f8ebfbe656c004d02a465acf5c003024831f0ca5c204d0d6199f3f3e19c0831218bf53b8f90e59fb859d851602d82d81ef2e54114c00ad251a3a00be2983fda6e93001b4e3bf5dbaf5c7008625b0dff5f7233001b473d3e7567900ec93c01373deb2de0bbfe348c18d8a17007c5706c39b6e87094067d50c15b50378520223f615476102d007f6f7994e00784a024fde3ac3011380aeb8e04b1b067050060f0fce8609402df37f362505c08f2470c0bcbb172600ddb05abd3a1fc0b331d812ad5ec26cd1dd54a404ad847161e618d38941860561583123110e26aa1baff5b9305508b5d5fa74a6108ad4897e055b08271edcd3142b74131b99be8e8f77b9677d0c23d54c9423c82d74b371c9b2ccec65066356a66999c91cef7b3e8e2dd1e6f6e984d9affda7f31a29d27038c05d3a13655e176e5c45149cac8a709024ab6262ad205915e3eb21c9aa98582c4a56c5c4ec4856c5d1d991ac8a634ba9c9aa98981dc9aa383a3b9255716c7624ab62627624abe2e8ecf8ffa98add0c471f13622a90201efcb045100f11de62655f277c6515a2361c6e418913787d502595198c2838c338be6b1adfcd0c8d9d5daab3e82fcbebb704c70e152be3279a825c20268aa982ab67f93155627ba5ed0ae102510b5e8905663c92b721be8a1b50088b57cb468e342cbfa6f17f70cdccffea9ac1582b2f8895f2affb6aed633f4f194316cc6b83169d5a8982a90547722f9d8c6e0321bd9263167f2a1abf5a1bf260866cf8472e869192786cdbead2091585987222bc3b9ab805a938dc467839c7ac105b09c54a4f800b54495422bc0916c494118b3dfa74f8b9f6c433ad2244e8caf0f8df253ae72bc31dc8632b6248c1a598593015e10e0d558303ad5c30446c764131e7e126a78a380f37135e42aca2a79121ea0cfb3c9871a2d38901b74b41022b0f8b70c0c2707cf7cc774c06537686d19861c82c332cc93166e564653e605a667a3033cb949d7dbfc190633034db18f2605edb185de678717c647dcdc00cc446ae9b6618fd1aa1d1c591aa09cd88e96eaad4fe0b','2026-11-03 07:15:53');
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
INSERT INTO section_activities VALUES('auto_1793690153292__00000','lib-ride-1','same',20,80,470.0,61.0,7.704918032786885363,0,NULL,1.0,NULL,0,0,0,NULL);
INSERT INTO section_activities VALUES('auto_1793690153292__00000','lib-ride-2','same',20,80,470.0,58.5,8.034188034188034066,0,NULL,1.0,NULL,0,0,0,NULL);
INSERT INTO section_activities VALUES('auto_1793690153292__00000','lib-ride-3','same',20,80,470.0,63.20000000000000284,7.436708860759493334,0,NULL,1.0,NULL,0,0,0,NULL);
INSERT INTO section_activities VALUES('custom_1793690153295__00000','lib-run-1','same',10,60,390.0,95.0,4.099999999999999644,0,NULL,1.0,NULL,0,0,0,NULL);
CREATE TABLE section_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id TEXT NOT NULL,
    at TEXT NOT NULL DEFAULT (datetime('now')),
    kind TEXT NOT NULL,
    details TEXT,
    geometry_version INTEGER
);
INSERT INTO section_history VALUES(1,'auto_1793690153292__00000','2026-11-03 07:15:53','superseded','{"overlap_fraction":1.0,"superseded_by":"custom_1793690153293__00000"}',NULL);
INSERT INTO section_history VALUES(2,'custom_1793690153293__00000','2026-11-03 07:15:53','superseded','{"overlap_fraction":1.0,"supersedes":"auto_1793690153292__00000"}',NULL);
INSERT INTO section_history VALUES(3,'custom_1793690153293__00000','2026-11-03 07:15:53','archived','{"created_at":"2026-11-03T07:15:53.293892797+00:00","distance_meters":470.0,"name":"Old drag","sport_type":"Ride","visit_count":3}',1);
INSERT INTO section_history VALUES(4,'custom_1793690153293__00000','2026-11-03 07:15:53','superseded','{"distance_meters":470.0,"name":"Old drag","overlap_fraction":null,"superseded_by":"auto_1793690153292__00000"}',NULL);
INSERT INTO section_history VALUES(5,'auto_1793690153292__00000','2026-11-03 07:15:53','superseded','{"overlap_fraction":null,"supersedes":"custom_1793690153293__00000"}',NULL);
INSERT INTO section_history VALUES(6,'auto_1793690153292__00000','2026-11-03 07:15:53','renamed','{"from":"Section 1","to":"Vineyard climb"}',NULL);
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
    source TEXT CHECK(source IS NULL OR source IN ('exact', 'consensus', 'orphaned')), point_count INTEGER,
    PRIMARY KEY (section_id, version)
);
INSERT INTO section_geometry VALUES('custom_1793690153293__00000',1,'2026-11-03 07:15:53',1,X'3c01a0d9872c80bb8107d84f28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a',1,'lib-ride-1',20,81,'orphaned',NULL);
INSERT INTO section_geometry VALUES('auto_1793690153292__00000',1,'2026-11-03 07:15:53',1,X'3c01a0d9872c80bb8107d84f28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a',1,NULL,NULL,NULL,'consensus',NULL);
CREATE TABLE section_pins (
    section_id TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO section_pins VALUES('auto_1793690153292__00000',1,'2026-11-03 07:15:53');
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
INSERT INTO section_numbers VALUES('auto_1793690153292__00000',1);
INSERT INTO section_numbers VALUES('custom_1793690153293__00000',2);
INSERT INTO section_numbers VALUES('custom_1793690153295__00000',3);
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
INSERT INTO section_rank_inputs VALUES('auto_1793690153292__00000','Ride',3,1761172800,0.4819672131147541006,-0.03606557377049184749,1,0.3992911138638188807,58.5,1761086400.0,61.0,0);
INSERT INTO section_rank_inputs VALUES('custom_1793690153295__00000','Run',1,1761259200,0.5,NULL,NULL,0.0,95.0,1761259200.0,95.0,0);
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
INSERT INTO route_line_layer VALUES(1,0,1,X'01c11f000000010b6c69622d726f7574652d3101010f020080d3872ce09b81079825f8b901');
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
INSERT INTO section_intents VALUES('ni_1793690153320_auto_1793690153292__00000','named',NULL,'2026-11-03 07:15:53','Vineyard climb','Ride',X'c0f80000003c01a0d9872c80bb8107d84f28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a');
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
             , "original_polyline_blob" BLOB);
INSERT INTO sections VALUES('auto_1793690153292__00000','auto',NULL,'Ride',NULL,470.0,NULL,0.9000000000000000222,3,NULL,NULL,NULL,1,0,NULL,NULL,NULL,NULL,'2026-11-03T07:15:53.292435266+00:00',NULL,46.2004000000000019,46.20157999999999988,7.351999999999999424,7.357899999999999885,NULL,0,NULL,NULL,X'c0f80000003c01a0d9872c80bb8107d84f28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a',NULL,3,NULL,NULL,'consensus',NULL,NULL,3,'Ride',NULL,NULL,NULL,NULL,0,NULL,NULL,NULL);
INSERT INTO sections VALUES('custom_1793690153295__00000','custom','Lake sprint','Run',NULL,390.0,'lib-run-1',NULL,NULL,NULL,NULL,NULL,1,1,NULL,'lib-run-1',10,60,'2026-11-03T07:15:53.295497793+00:00',NULL,46.25019999999999954,46.25117999999999797,7.40100000000000069,7.405899999999999928,NULL,0,NULL,NULL,X'c0d00000003201b0e38d2cd0b88707c45e28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a28c8010a',NULL,1,10,61,'exact',NULL,NULL,1,'Run',NULL,NULL,NULL,NULL,0,NULL,NULL,NULL);
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
COMMIT;
PRAGMA user_version=79;
