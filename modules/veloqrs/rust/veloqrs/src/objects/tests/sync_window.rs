use super::*;
use httpmock::prelude::*;

fn stored_metrics(ids: &[String]) -> Vec<crate::ActivityMetrics> {
    ids.iter()
        .map(|id| crate::ActivityMetrics {
            activity_id: id.clone(),
            ..Default::default()
        })
        .collect()
}

#[test]
fn test_owed_windows_collapsed_head_counts_days_within_runs() {
    let start = chrono::NaiveDate::from_ymd_opt(2025, 1, 1).unwrap();
    let mut dates = Vec::new();
    for run in 0..21 {
        dates.push((start + chrono::Duration::days(run * 2)).to_string());
    }
    for run in 0..10 {
        let first = start + chrono::Duration::days(43 + run * 3);
        dates.push(first.to_string());
        dates.push((first + chrono::Duration::days(1)).to_string());
    }

    let windows = owed_windows(&dates);
    assert_eq!(windows.len(), 2);
    assert_eq!(windows[0].0, dates[dates.len() - HEAD_OWED_DAYS]);
    assert_eq!(windows[0].1, *dates.last().unwrap());
}

#[test]
fn test_owed_windows_splits_a_run_at_the_head_boundary() {
    let start = chrono::NaiveDate::from_ymd_opt(2025, 1, 1).unwrap();
    let mut dates: Vec<String> = (0..30)
        .map(|run| (start + chrono::Duration::days(run * 2)).to_string())
        .collect();
    let newest = start + chrono::Duration::days(61);
    dates.extend((0..11).map(|day| (newest + chrono::Duration::days(day)).to_string()));

    let windows = owed_windows(&dates);
    assert_eq!(windows.len(), 2);
    assert_eq!(
        windows[0].0,
        (newest + chrono::Duration::days(1)).to_string()
    );
    assert_eq!(
        windows[0].1,
        (newest + chrono::Duration::days(10)).to_string()
    );
}

#[test]
fn test_failed_census_uses_fixed_window_despite_stored_rows() {
    let _guard = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("failed-census-stale.db");
    let today = chrono::Local::now().date_naive();
    let old = (today - chrono::Duration::days(20)).to_string();
    let entry = crate::net::types::ActivityCensusEntry {
        id: "a1".into(),
        start_date_local: Some(format!("{old}T08:00:00")),
        created: None,
        icu_sync_date: None,
        has_latlng: false,
    };
    crate::persistence::with_persistent_engine(|engine| {
        engine
            .record_activity_census("i1", &[entry])
            .expect("census");
    })
    .unwrap();
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(GET).path("/athlete/i1/activities");
        then.status(500);
    });
    let governor = std::sync::Arc::new(crate::governor::Governor::new(
        1000,
        Box::new(crate::governor::NoopPolicy),
    ));
    let transport =
        Transport::with_governor(server.base_url(), AuthMethod::ApiKey("k"), governor).unwrap();
    let outcome = crate::runtime::block_on(sync_activity_history_summary(
        crate::persistence::engine_install(),
        &transport,
        "i1",
    ));
    assert!(outcome.is_err());

    let windows = crate::runtime::block_on(owed_activity_windows("i1", outcome.is_ok())).windows;
    assert_eq!(
        windows
            .iter()
            .map(|window| window.range.clone())
            .collect::<Vec<_>>(),
        vec![(
            (today - chrono::Duration::days(ACTIVITY_DAYS)).to_string(),
            today.to_string()
        )]
    );
    let activities = MockServer::start();
    let new_day = (today - chrono::Duration::days(1)).to_string();
    let whole = activities.mock(|when, then| {
        when.method(GET)
            .path("/athlete/i1/activities")
            .query_param("oldest", windows[0].range.0.clone())
            .query_param("newest", windows[0].range.1.clone());
        then.status(200).json_body(serde_json::json!([{
            "id": "new", "type": "Ride", "name": "New ride",
            "start_date_local": format!("{new_day}T08:00:00")
        }]));
    });
    let governor = std::sync::Arc::new(crate::governor::Governor::new(
        1000,
        Box::new(crate::governor::NoopPolicy),
    ));
    let transport =
        Transport::with_governor(activities.base_url(), AuthMethod::ApiKey("k"), governor).unwrap();
    crate::runtime::block_on(sync_activity_windows(
        crate::persistence::engine_install(),
        &transport,
        "i1",
        &windows,
        &|| false,
    ))
    .unwrap();
    whole.assert_hits(1);
    crate::persistence::with_persistent_engine(|engine| {
        assert!(engine.get_activity_body("new").is_some());
    })
    .unwrap();
}

#[test]
fn test_widened_window_requests_only_owed_day() {
    let _guard = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("widened-window-owed.db");
    let held = "2025-01-02";
    let owed = "2025-06-03";
    let entries: Vec<_> = [("a1", held), ("a2", owed)]
        .into_iter()
        .map(|(id, day)| crate::net::types::ActivityCensusEntry {
            id: id.into(),
            start_date_local: Some(format!("{day}T08:00:00")),
            created: None,
            icu_sync_date: Some(format!("{day}T09:00:00Z")),
            has_latlng: false,
        })
        .collect();
    crate::persistence::with_persistent_engine(|engine| {
        engine
            .record_activity_census("i1", &entries)
            .expect("census");
        engine
            .store_synced_activity_bodies(
                "i1",
                &[("a1".into(), 0, "{}".into())],
                &["a1".into()],
                stored_metrics(&["a1".into()]),
            )
            .unwrap();
    })
    .unwrap();
    let server = MockServer::start();
    let one = server.mock(|when, then| {
        when.method(GET)
            .path("/athlete/i1/activities")
            .query_param("oldest", owed)
            .query_param("newest", owed);
        then.status(200).json_body(serde_json::json!([]));
    });
    let whole = server.mock(|when, then| {
        when.method(GET)
            .path("/athlete/i1/activities")
            .query_param("oldest", "2025-01-01")
            .query_param("newest", "2025-12-31");
        then.status(200).json_body(serde_json::json!([]));
    });
    let governor = std::sync::Arc::new(crate::governor::Governor::new(
        1000,
        Box::new(crate::governor::NoopPolicy),
    ));
    let transport =
        Transport::with_governor(server.base_url(), AuthMethod::ApiKey("k"), governor).unwrap();
    let svc = SyncService::new();
    svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
    assert!(svc.try_begin());
    crate::runtime::block_on(perform_window_sync(
        &svc,
        crate::persistence::engine_install(),
        transport,
        "i1".into(),
        "2025-01-01",
        "2025-12-31",
    ));
    one.assert_hits(1);
    whole.assert_hits(0);
}

#[test]
fn test_widened_window_without_census_requests_whole_span() {
    let _guard = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("widened-window-no-census.db");
    let server = MockServer::start();
    let whole = server.mock(|when, then| {
        when.method(GET)
            .path("/athlete/i1/activities")
            .query_param("oldest", "2025-01-01")
            .query_param("newest", "2025-12-31");
        then.status(200).json_body(serde_json::json!([]));
    });
    let governor = std::sync::Arc::new(crate::governor::Governor::new(
        1000,
        Box::new(crate::governor::NoopPolicy),
    ));
    let transport =
        Transport::with_governor(server.base_url(), AuthMethod::ApiKey("k"), governor).unwrap();
    let svc = SyncService::new();
    svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
    assert!(svc.try_begin());
    crate::runtime::block_on(perform_window_sync(
        &svc,
        crate::persistence::engine_install(),
        transport,
        "i1".into(),
        "2025-01-01",
        "2025-12-31",
    ));
    whole.assert_hits(1);
    assert_eq!(svc.snapshot().completed, 1);
}

#[test]
fn test_failed_body_write_keeps_changed_day_owed() {
    let _guard = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("failed-body-owed.db");
    let day = "2025-06-03";
    let entry = crate::net::types::ActivityCensusEntry {
        id: "a1".into(),
        start_date_local: Some(format!("{day}T08:00:00")),
        created: None,
        icu_sync_date: Some(format!("{day}T09:00:00Z")),
        has_latlng: false,
    };
    crate::persistence::with_persistent_engine(|engine| {
        engine.record_activity_census("i1", std::slice::from_ref(&entry)).expect("census");
        engine
            .store_synced_activity_bodies(
                "i1",
                &[("a1".into(), 0, "old".into())],
                &["a1".into()],
                stored_metrics(&["a1".into()]),
            )
            .unwrap();
        let mut moved = entry;
        moved.icu_sync_date = Some(format!("{day}T10:00:00Z"));
        engine.record_activity_census("i1", &[moved]).expect("census");
        engine.db.execute_batch("CREATE TRIGGER reject_body BEFORE UPDATE ON activity_bodies BEGIN SELECT RAISE(ABORT, 'body full'); END;").unwrap();
    }).unwrap();
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(GET).path("/athlete/i1/activities");
        then.status(200).json_body(serde_json::json!([{
            "id": "a1", "type": "Ride", "name": "New name",
            "start_date_local": "2025-06-03T08:00:00"
        }]));
    });
    let governor = std::sync::Arc::new(crate::governor::Governor::new(
        1000,
        Box::new(crate::governor::NoopPolicy),
    ));
    let transport =
        Transport::with_governor(server.base_url(), AuthMethod::ApiKey("k"), governor).unwrap();
    let result = crate::runtime::block_on(sync_activity_window(
        crate::persistence::engine_install(),
        &transport,
        "i1",
        day,
        day,
        None,
        &|| false,
    ));
    assert!(matches!(result, Err(NetError::Storage(_))));
    let svc = SyncService::new();
    svc.set_credentials(AuthKind::ApiKey, "secret".into(), "i1".into());
    assert!(svc.try_begin());
    crate::runtime::block_on(perform_window_sync(
        &svc,
        crate::persistence::engine_install(),
        transport,
        "i1".into(),
        day,
        day,
    ));
    let status = svc.snapshot();
    assert_eq!(status.completed, 0);
    assert!(status.last_error.is_some());
    crate::persistence::with_persistent_engine(|engine| {
        assert_eq!(
            engine.owed_dates_in_window("i1", day, day),
            Some(vec![day.into()])
        );
    })
    .unwrap();
}

#[test]
fn test_failed_metrics_write_rolls_back_body_and_leaves_summary_owed() {
    let _guard = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("failed-metrics-owed.db");
    let day = "2025-06-04";
    let entry = crate::net::types::ActivityCensusEntry {
        id: "a1".into(),
        start_date_local: Some(format!("{day}T08:00:00")),
        created: None,
        icu_sync_date: Some(format!("{day}T09:00:00Z")),
        has_latlng: false,
    };
    crate::persistence::with_persistent_engine(|engine| {
        engine.record_activity_census("i1", &[entry]).expect("census");
        engine.db.execute_batch("CREATE TRIGGER reject_metrics BEFORE INSERT ON activity_metrics BEGIN SELECT RAISE(ABORT, 'metrics full'); END;").unwrap();
    }).unwrap();
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(GET).path("/athlete/i1/activities");
        then.status(200).json_body(serde_json::json!([{
            "id": "a1", "type": "Ride", "name": "Ride",
            "start_date_local": "2025-06-04T08:00:00"
        }]));
    });
    let governor = std::sync::Arc::new(crate::governor::Governor::new(
        1000,
        Box::new(crate::governor::NoopPolicy),
    ));
    let transport =
        Transport::with_governor(server.base_url(), AuthMethod::ApiKey("k"), governor).unwrap();
    crate::runtime::block_on(sync_activity_window(
        crate::persistence::engine_install(),
        &transport,
        "i1",
        day,
        day,
        None,
        &|| false,
    ))
    .expect_err("metrics failure must fail the page");
    crate::persistence::with_persistent_engine(|engine| {
        assert!(engine.get_activity_body("a1").is_none());
        assert_eq!(
            engine.owed_dates_in_window("i1", day, day),
            Some(vec![day.into()])
        );
    })
    .unwrap();
}

#[test]
fn test_changed_summary_invalidates_stored_interval_body() {
    let _guard = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("changed-interval-body.db");
    let day = "2025-06-03";
    let mut entry = crate::net::types::ActivityCensusEntry {
        id: "a1".into(),
        start_date_local: Some(format!("{day}T08:00:00")),
        created: None,
        icu_sync_date: Some(format!("{day}T09:00:00Z")),
        has_latlng: false,
    };
    crate::persistence::with_persistent_engine(|engine| {
        engine
            .record_activity_census("i1", std::slice::from_ref(&entry))
            .expect("census");
        engine
            .store_synced_activity_bodies(
                "i1",
                &[("a1".into(), 0, "old".into())],
                &["a1".into()],
                stored_metrics(&["a1".into()]),
            )
            .unwrap();
        engine.set_interval_body("a1", "old intervals").unwrap();
        entry.icu_sync_date = Some(format!("{day}T10:00:00Z"));
        engine
            .record_activity_census("i1", &[entry])
            .expect("census");
    })
    .unwrap();
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(GET).path("/athlete/i1/activities");
        then.status(200).json_body(serde_json::json!([{
            "id": "a1", "type": "Ride", "name": "New name",
            "start_date_local": "2025-06-03T08:00:00"
        }]));
    });
    let intervals = server.mock(|when, then| {
        when.method(GET).path("/activity/a1/intervals");
        then.status(200)
            .json_body(serde_json::json!({"icu_intervals": []}));
    });
    let governor = std::sync::Arc::new(crate::governor::Governor::new(
        1000,
        Box::new(crate::governor::NoopPolicy),
    ));
    let transport =
        Transport::with_governor(server.base_url(), AuthMethod::ApiKey("k"), governor).unwrap();
    crate::runtime::block_on(sync_activity_window(
        crate::persistence::engine_install(),
        &transport,
        "i1",
        day,
        day,
        None,
        &|| false,
    ))
    .unwrap();
    crate::persistence::with_persistent_engine(|engine| {
        assert_eq!(engine.get_interval_body("a1").unwrap(), None);
    })
    .unwrap();
    crate::runtime::block_on(sync_interval_bodies(
        crate::persistence::engine_install(),
        &transport,
        &|| false,
        &|_, _| {},
    ))
    .unwrap();
    intervals.assert_hits(1);
    crate::persistence::with_persistent_engine(|engine| {
        assert!(engine.get_interval_body("a1").unwrap().is_some());
    })
    .unwrap();
}

#[test]
fn test_launch_plans_old_changed_rows_without_old_never_fetched_rows() {
    let _guard = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("old-changed-row.db");
    let old = (chrono::Local::now().date_naive() - chrono::Duration::days(365)).to_string();
    let unchanged = (chrono::Local::now().date_naive() - chrono::Duration::days(366)).to_string();
    let never = (chrono::Local::now().date_naive() - chrono::Duration::days(367)).to_string();
    let mut entries: Vec<_> = [
        ("changed", &old),
        ("same", &unchanged),
        ("same-old-day", &old),
        ("never", &never),
        ("never-same-day", &old),
    ]
    .into_iter()
    .map(|(id, day)| crate::net::types::ActivityCensusEntry {
        id: id.into(),
        start_date_local: Some(format!("{day}T08:00:00")),
        created: None,
        icu_sync_date: Some(format!("{day}T09:00:00Z")),
        has_latlng: false,
    })
    .collect();
    crate::persistence::with_persistent_engine(|engine| {
        engine
            .record_activity_census("i1", &entries)
            .expect("census");
        engine
            .store_synced_activity_bodies(
                "i1",
                &[
                    ("changed".into(), 0, "{}".into()),
                    ("same".into(), 0, "{}".into()),
                    ("same-old-day".into(), 0, r#"{"name":"Stored"}"#.into()),
                ],
                &["changed".into(), "same".into(), "same-old-day".into()],
                stored_metrics(&["changed".into(), "same".into(), "same-old-day".into()]),
            )
            .unwrap();
        engine
            .set_activity_metrics(vec![crate::ActivityMetrics {
                activity_id: "same-old-day".into(),
                name: "Stored".into(),
                distance: 123.0,
                ..Default::default()
            }])
            .unwrap();
        entries[0].icu_sync_date = Some(format!("{old}T10:00:00Z"));
        engine
            .record_activity_census("i1", &entries)
            .expect("census");
    })
    .unwrap();

    let windows = crate::runtime::block_on(owed_activity_windows("i1", true)).windows;
    assert_eq!(windows[0].range, (old.clone(), old.clone()));
    assert_eq!(windows.len(), 1);
    let server = MockServer::start();
    let changed = server.mock(|when, then| {
        when.method(GET)
            .path("/athlete/i1/activities")
            .query_param("oldest", old.clone())
            .query_param("newest", old.clone());
        then.status(200).json_body(serde_json::json!([
            {
                "id": "changed", "type": "Ride", "name": "Edited", "distance": 200.0,
                "start_date_local": format!("{old}T08:00:00")
            },
            {
                "id": "same-old-day", "type": "Ride", "name": "Still fetched", "distance": 456.0,
                "start_date_local": format!("{old}T08:30:00")
            },
            {
                "id": "never-same-day", "type": "Ride", "name": "Outside library",
                "start_date_local": format!("{old}T09:00:00")
            }
        ]));
    });
    let all = server.mock(|when, then| {
        when.method(GET).path("/athlete/i1/activities");
        then.status(200).json_body(serde_json::json!([]));
    });
    let governor = std::sync::Arc::new(crate::governor::Governor::new(
        1000,
        Box::new(crate::governor::NoopPolicy),
    ));
    let transport =
        Transport::with_governor(server.base_url(), AuthMethod::ApiKey("k"), governor).unwrap();
    crate::runtime::block_on(sync_activity_windows(
        crate::persistence::engine_install(),
        &transport,
        "i1",
        &windows,
        &|| false,
    ))
    .unwrap();
    changed.assert_hits(1);
    all.assert_hits(0);
    crate::persistence::with_persistent_engine(|engine| {
        assert!(
            engine
                .get_activity_body("changed")
                .unwrap()
                .contains("Edited")
        );
        assert!(
            engine
                .get_activity_body("same-old-day")
                .unwrap()
                .contains("Stored")
        );
        assert_eq!(engine.activity_metrics["changed"].name, "Edited");
        assert_eq!(engine.activity_metrics["changed"].distance, 200.0);
        assert_eq!(engine.activity_metrics["same-old-day"].name, "Stored");
        assert_eq!(engine.activity_metrics["same-old-day"].distance, 123.0);
        assert!(engine.get_activity_body("never-same-day").is_none());
        assert!(!engine.activity_metrics.contains_key("never-same-day"));
        assert_eq!(
            engine.owed_dates_in_window("i1", &old, &old),
            Some(vec![old.clone()])
        );
    })
    .unwrap();
    assert!(
        crate::runtime::block_on(owed_activity_windows("i1", true))
            .windows
            .is_empty()
    );
}

#[test]
fn test_old_changed_head_prefetch_keeps_never_fetched_body_outside_library() {
    let _guard = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("old-changed-head.db");
    let today = chrono::Local::now().date_naive();
    let oldest = (today - chrono::Duration::days(366)).to_string();
    let newest = (today - chrono::Duration::days(365)).to_string();
    let mut entries: Vec<_> = [
        ("old-changed", &oldest),
        ("new-changed", &newest),
        ("never", &newest),
    ]
    .into_iter()
    .map(|(id, day)| crate::net::types::ActivityCensusEntry {
        id: id.into(),
        start_date_local: Some(format!("{day}T08:00:00")),
        created: None,
        icu_sync_date: Some("old".into()),
        has_latlng: false,
    })
    .collect();
    crate::persistence::with_persistent_engine(|engine| {
        engine.record_activity_census("i1", &entries).unwrap();
        engine
            .store_synced_activity_bodies(
                "i1",
                &[
                    ("old-changed".into(), 0, "old".into()),
                    ("new-changed".into(), 0, "old".into()),
                ],
                &["old-changed".into(), "new-changed".into()],
                stored_metrics(&["old-changed".into(), "new-changed".into()]),
            )
            .unwrap();
        for entry in &mut entries[..2] {
            entry.icu_sync_date = Some("new".into());
        }
        engine.record_activity_census("i1", &entries).unwrap();
    })
    .unwrap();

    let windows = crate::runtime::block_on(owed_activity_windows("i1", true)).windows;
    assert_eq!(windows.len(), 1);
    assert_eq!(windows[0].range, (oldest.clone(), newest.clone()));
    let server = MockServer::start();
    let head = server.mock(|when, then| {
        when.method(GET)
            .path("/athlete/i1/activities")
            .query_param("oldest", oldest.clone())
            .query_param("newest", newest.clone());
        then.status(200).json_body(serde_json::json!([
            {"id": "old-changed", "type": "Ride", "name": "Old edited",
             "start_date_local": format!("{oldest}T08:00:00")},
            {"id": "new-changed", "type": "Ride", "name": "New edited",
             "start_date_local": format!("{newest}T08:00:00")},
            {"id": "never", "type": "Ride", "name": "Outside library",
             "start_date_local": format!("{newest}T09:00:00")}
        ]));
    });
    let governor = std::sync::Arc::new(crate::governor::Governor::new(
        1000,
        Box::new(crate::governor::NoopPolicy),
    ));
    let transport =
        Transport::with_governor(server.base_url(), AuthMethod::ApiKey("k"), governor).unwrap();
    crate::runtime::block_on(sync_newest_activities(
        crate::persistence::engine_install(),
        &transport,
        "i1",
        &windows,
        &|| false,
    ))
    .unwrap();
    head.assert_hits(1);
    crate::persistence::with_persistent_engine(|engine| {
        assert!(
            engine
                .get_activity_body("old-changed")
                .unwrap()
                .contains("Old edited")
        );
        assert!(
            engine
                .get_activity_body("new-changed")
                .unwrap()
                .contains("New edited")
        );
        assert!(engine.get_activity_body("never").is_none());
        assert!(!engine.activity_metrics.contains_key("never"));
    })
    .unwrap();
}

#[test]
fn test_scattered_old_changes_keep_unchanged_days_outside_windows() {
    let _guard = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("scattered-old-changes.db");
    let today = chrono::Local::now().date_naive();
    let mut entries: Vec<_> = (0..31)
        .map(|offset| {
            let day = (today - chrono::Duration::days(400 + offset * 2)).to_string();
            crate::net::types::ActivityCensusEntry {
                id: format!("changed-{offset}"),
                start_date_local: Some(format!("{day}T08:00:00")),
                created: None,
                icu_sync_date: Some("old".into()),
                has_latlng: false,
            }
        })
        .collect();
    let never_day = (today - chrono::Duration::days(401)).to_string();
    let unchanged_day = (today - chrono::Duration::days(403)).to_string();
    for (id, day) in [("never", &never_day), ("unchanged", &unchanged_day)] {
        entries.push(crate::net::types::ActivityCensusEntry {
            id: id.into(),
            start_date_local: Some(format!("{day}T08:00:00")),
            created: None,
            icu_sync_date: Some("old".into()),
            has_latlng: false,
        });
    }
    crate::persistence::with_persistent_engine(|engine| {
        engine
            .record_activity_census("i1", &entries)
            .expect("census");
        let rows: Vec<_> = entries
            .iter()
            .filter(|entry| entry.id != "never")
            .map(|entry| (entry.id.clone(), 0, "held".into()))
            .collect();
        let ids: Vec<_> = rows.iter().map(|row| row.0.clone()).collect();
        engine
            .store_synced_activity_bodies("i1", &rows, &ids, stored_metrics(&ids))
            .unwrap();
        let mut changed = entries.clone();
        for entry in &mut changed {
            if entry.id.starts_with("changed-") {
                entry.icu_sync_date = Some("new".into());
            }
        }
        engine
            .record_activity_census("i1", &changed)
            .expect("census");
    })
    .unwrap();

    let windows = crate::runtime::block_on(owed_activity_windows("i1", true)).windows;
    assert_eq!(windows.len(), 31);
    for ActivityWindow {
        range: (start, end),
        ..
    } in &windows
    {
        assert_eq!(start, end);
        assert_ne!(start, &never_day);
        assert_ne!(start, &unchanged_day);
    }
    let server = MockServer::start();
    let dates: Vec<_> = entries[..31]
        .iter()
        .map(|entry| entry.start_date_local.as_ref().unwrap()[..10].to_string())
        .rev()
        .collect();
    let collapsed = owed_windows(&dates);
    let wide: Vec<_> = collapsed
        .iter()
        .map(|(oldest, newest)| {
            server.mock(|when, then| {
                when.method(GET)
                    .path("/athlete/i1/activities")
                    .query_param("oldest", oldest)
                    .query_param("newest", newest);
                then.status(200).json_body(serde_json::json!([{
                    "id": "unchanged", "type": "Ride", "name": "Rewritten",
                    "start_date_local": format!("{unchanged_day}T08:00:00")
                }]));
            })
        })
        .collect();
    let exact = server.mock(|when, then| {
        when.method(GET).path("/athlete/i1/activities");
        then.status(200).json_body(serde_json::json!([]));
    });
    let governor = std::sync::Arc::new(crate::governor::Governor::new(
        1000,
        Box::new(crate::governor::NoopPolicy),
    ));
    let transport =
        Transport::with_governor(server.base_url(), AuthMethod::ApiKey("k"), governor).unwrap();
    crate::runtime::block_on(sync_activity_windows(
        crate::persistence::engine_install(),
        &transport,
        "i1",
        &windows,
        &|| false,
    ))
    .unwrap();
    for request in wide {
        request.assert_hits(0);
    }
    exact.assert_hits(31);
    crate::persistence::with_persistent_engine(|engine| {
        assert_eq!(engine.get_activity_body("unchanged"), Some("held".into()));
        assert!(engine.get_activity_body("never").is_none());
    })
    .unwrap();
}

#[test]
fn test_many_scattered_old_changes_use_one_request_per_changed_day() {
    let _guard = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("many-old-changes.db");
    let today = chrono::Local::now().date_naive();
    let entries: Vec<_> = (0..317)
        .map(|offset| {
            let day = (today - chrono::Duration::days(400 + offset * 2)).to_string();
            crate::net::types::ActivityCensusEntry {
                id: format!("changed-{offset}"),
                start_date_local: Some(format!("{day}T08:00:00")),
                created: None,
                icu_sync_date: Some("old".into()),
                has_latlng: false,
            }
        })
        .collect();
    crate::persistence::with_persistent_engine(|engine| {
        engine
            .record_activity_census("i1", &entries)
            .expect("census");
        let rows: Vec<_> = entries
            .iter()
            .map(|entry| (entry.id.clone(), 0, "{}".into()))
            .collect();
        let ids: Vec<_> = entries.iter().map(|entry| entry.id.clone()).collect();
        engine
            .store_synced_activity_bodies("i1", &rows, &ids, stored_metrics(&ids))
            .unwrap();
        let mut changed = entries.clone();
        for entry in &mut changed {
            entry.icu_sync_date = Some("new".into());
        }
        engine
            .record_activity_census("i1", &changed)
            .expect("census");
    })
    .unwrap();

    let windows = crate::runtime::block_on(owed_activity_windows("i1", true)).windows;
    assert_eq!(windows.len(), 317);
    assert!(
        windows
            .iter()
            .all(|window| window.range.0 == window.range.1)
    );
}

fn transport_to(base: String) -> Transport {
    let governor = std::sync::Arc::new(crate::governor::Governor::new(
        1000,
        Box::new(crate::governor::NoopPolicy),
    ));
    Transport::with_governor(base, AuthMethod::ApiKey("k"), governor).unwrap()
}

/// What intervals.icu does with `fields`: a name it was not asked for is not
/// in the answer.
pub(super) fn asks_for_decoupling(req: &HttpMockRequest) -> bool {
    req.query_params.as_ref().is_some_and(|q| {
        q.iter()
            .any(|(k, v)| k == "fields" && v.split(',').any(|field| field == "decoupling"))
    })
}

/// A new database holds no body at all, so none was fetched with another field
/// set, and the first sync must not refetch what it is about to store.
#[test]
fn test_a_fresh_database_is_at_the_current_field_set() {
    let _guard = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("fields-fresh.db");
    let stamp = crate::persistence::with_persistent_engine(|engine| {
        engine
            .get_setting(crate::persistence::settings_keys::ACTIVITY_BODY_FIELDS)
            .unwrap()
    })
    .unwrap();
    assert_eq!(stamp, Some(crate::net::types::stored_activity_fields()));
    assert!(
        crate::runtime::block_on(owed_activity_windows("i1", true))
            .fields
            .is_none()
    );
}

/// Scenario: the Fitness card reads intervals.icu's stored decoupling from the
/// stored body, and the window sync wrote every body without it, then wrote
/// over the one a detail open had fetched.
///
/// Expected behaviour: the list page carries the value into the stored body,
/// and a later page keeps the value the detail open wrote.
#[test]
fn test_a_list_page_stores_the_decoupling_it_asked_for() {
    let _guard = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("fields-decoupling.db");
    let day = (chrono::Local::now().date_naive() - chrono::Duration::days(2)).to_string();
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(GET)
            .path("/athlete/i1/activities")
            .matches(asks_for_decoupling);
        then.status(200).json_body(serde_json::json!([{
            "id": "ride", "type": "Ride", "name": "Long ride",
            "start_date_local": format!("{day}T08:00:00"), "decoupling": 3.4
        }]));
    });
    server.mock(|when, then| {
        when.method(GET).path("/athlete/i1/activities");
        then.status(200).json_body(serde_json::json!([{
            "id": "ride", "type": "Ride", "name": "Long ride",
            "start_date_local": format!("{day}T08:00:00")
        }]));
    });
    let sync = || {
        crate::runtime::block_on(sync_activity_window(
            crate::persistence::engine_install(),
            &transport_to(server.base_url()),
            "i1",
            &day,
            &day,
            None,
            &|| false,
        ))
        .expect("the window")
    };
    let decoupling = || {
        crate::persistence::with_persistent_engine(|engine| {
            let body = engine.get_activity_body("ride").expect("stored");
            serde_json::from_str::<serde_json::Value>(&body).unwrap()["decoupling"].as_f64()
        })
        .unwrap()
    };

    sync();
    assert_eq!(decoupling(), Some(3.4));

    crate::persistence::with_persistent_engine(|engine| {
        let date = start_date_to_timestamp(Some(&format!("{day}T08:00:00"))).unwrap();
        let detail = serde_json::json!({
            "id": "ride", "type": "Ride", "name": "Long ride",
            "start_date_local": format!("{day}T08:00:00"), "decoupling": 3.4,
            "description": "opened"
        });
        engine
            .store_activity_detail_body("ride", date, &detail.to_string())
            .unwrap();
    })
    .unwrap();
    sync();
    assert_eq!(decoupling(), Some(3.4));
}

/// Two fetched activities, one inside the launch window and one a year back,
/// stored with a body that predates `decoupling` in the field set, and the
/// census agreeing with both. The stamp is gone, as on a database an older
/// build wrote.
pub(super) fn upgraded_library(recent: &str, old: &str) {
    let entries: Vec<_> = [("recent", recent), ("old", old)]
        .into_iter()
        .map(|(id, day)| crate::net::types::ActivityCensusEntry {
            id: id.into(),
            start_date_local: Some(format!("{day}T08:00:00")),
            created: None,
            icu_sync_date: Some("v1".into()),
            has_latlng: false,
        })
        .collect();
    crate::persistence::with_persistent_engine(|engine| {
        engine.record_activity_census("i1", &entries).unwrap();
        let rows: Vec<(String, i64, String)> = [("recent", recent), ("old", old)]
            .into_iter()
            .map(|(id, day)| {
                let start = format!("{day}T08:00:00");
                let date = start_date_to_timestamp(Some(&start)).unwrap();
                let body = serde_json::json!({"id": id, "type": "Ride", "start_date_local": start});
                (id.to_string(), date, body.to_string())
            })
            .collect();
        let ids: Vec<String> = rows.iter().map(|row| row.0.clone()).collect();
        engine
            .store_synced_activity_bodies("i1", &rows, &ids, stored_metrics(&ids))
            .unwrap();
        engine
            .delete_setting(crate::persistence::settings_keys::ACTIVITY_BODY_FIELDS)
            .unwrap();
    })
    .unwrap();
}

/// Scenario: a build adds a field to the list request. The census owes nothing
/// for a library it agrees with, so the launch sync asked for no window and
/// every stored body kept the old field set for good.
///
/// Expected behaviour: the plan refetches every stored activity, limited to the
/// ids already fetched, outside the census marks, and names the field set to
/// record once it lands. Days the census owes are not asked for twice.
#[test]
fn test_an_older_field_set_plans_one_refetch_of_every_stored_activity() {
    let _guard = crate::test_globals::serial_global_state();
    let _tmp = crate::test_globals::init_global_engine("fields-plan.db");
    let today = chrono::Local::now().date_naive();
    let recent = (today - chrono::Duration::days(3)).to_string();
    let old = (today - chrono::Duration::days(365)).to_string();
    upgraded_library(&recent, &old);

    let plan = crate::runtime::block_on(owed_activity_windows("i1", true));
    assert_eq!(
        plan.fields,
        Some(crate::net::types::stored_activity_fields())
    );
    let ranges: Vec<_> = plan.windows.iter().map(|w| w.range.clone()).collect();
    assert_eq!(
        ranges,
        vec![(recent.clone(), recent.clone()), (old.clone(), old.clone())]
    );
    let eligible: Vec<_> = plan
        .windows
        .iter()
        .map(|w| w.eligible_ids.clone().expect("limited to what is stored"))
        .collect();
    assert_eq!(
        eligible,
        vec![
            HashSet::from(["recent".to_string()]),
            HashSet::from(["old".to_string()])
        ]
    );

    // A census that failed plans the fixed window and nothing to record.
    assert!(
        crate::runtime::block_on(owed_activity_windows("i1", false))
            .fields
            .is_none()
    );
}

/// The refetch asks in bounded spans, so a library of years is not one request
/// carrying all of it, and never one request per scattered day either.
#[test]
fn test_refetch_windows_span_at_most_the_bound() {
    let start = chrono::NaiveDate::from_ymd_opt(2024, 1, 1).unwrap();
    let fetched: Vec<(String, String, bool)> = (0..200)
        .map(|i| {
            (
                (start + chrono::Duration::days(i * 2)).to_string(),
                format!("a{i}"),
                false,
            )
        })
        .collect();
    let windows = refetch_windows(&fetched, &BTreeSet::new());
    assert_eq!(windows.len(), 5);
    let mut seen = HashSet::new();
    for window in &windows {
        let from = chrono::NaiveDate::parse_from_str(&window.range.0, "%Y-%m-%d").unwrap();
        let to = chrono::NaiveDate::parse_from_str(&window.range.1, "%Y-%m-%d").unwrap();
        assert!((to - from).num_days() < REFETCH_SPAN_DAYS);
        seen.extend(window.eligible_ids.clone().unwrap());
    }
    assert_eq!(seen.len(), 200);
    assert!(windows[0].range.1 > windows[1].range.1, "newest first");
}
