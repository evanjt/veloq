use super::SettingsManager;
use crate::test_globals::{init_global_engine, serial_global_state};

#[test]
fn test_backup_screen_data_reads_stored_home_and_radius() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("settings.db");
    let settings = SettingsManager::new();

    let empty = settings.backup_screen_data().unwrap();
    assert_eq!(
        (empty.home_lat, empty.home_lng, empty.radius_m),
        (None, None, None)
    );
    assert!(empty.suggestion.is_none());

    settings
        .set_setting("__export_home_lat".into(), "46.2".into())
        .unwrap();
    settings
        .set_setting("__export_home_lng".into(), "7.35".into())
        .unwrap();
    settings
        .set_setting("__export_privacy_radius_m".into(), "250".into())
        .unwrap();
    let data = settings.backup_screen_data().unwrap();
    assert_eq!(data.home_lat.as_deref(), Some("46.2"));
    assert_eq!(data.home_lng.as_deref(), Some("7.35"));
    assert_eq!(data.radius_m.as_deref(), Some("250"));
    assert!(data.suggestion.is_none());
}

#[test]
fn test_cache_screen_data_tracks_retention_write() {
    let _guard = serial_global_state();
    let _tmp = init_global_engine("settings.db");
    let settings = SettingsManager::new();

    let empty = settings.cache_screen_data().unwrap();
    assert_eq!(
        (empty.stream_retention_days, empty.stream_store_bytes),
        (0.0, 0.0)
    );
    settings.set_stream_retention_days(30.0).unwrap();
    let updated = settings.cache_screen_data().unwrap();
    assert_eq!(updated.stream_retention_days, 30.0);
    assert_eq!(updated.stream_store_bytes, 0.0);
}

#[test]
fn test_background_jobs_data_reads_a_recorded_run() {
    use crate::persistence::job_runs::{BackgroundJob, JobRun, RunOutcome, record_job_run};

    let _guard = serial_global_state();
    let _tmp = init_global_engine("settings.db");
    let settings = SettingsManager::new();

    let empty = settings.background_jobs_data().unwrap();
    assert!(empty.runs.is_empty());
    assert_eq!(empty.detection_awaiting, Some(0));
    assert!(!empty.cutover_owed);

    crate::objects::error::with_engine(|engine| {
        record_job_run(
            &engine.db,
            &JobRun {
                job: BackgroundJob::StreamBackfill,
                finished_at: 1_791_000_000_000,
                outcome: RunOutcome::Partial,
                handled: 2,
                added: 0,
                changed: 1,
                retired: 0,
                failed: 1,
            },
        )
    })
    .unwrap();
    let data = settings.background_jobs_data().unwrap();
    assert_eq!(
        data.runs,
        vec![crate::FfiJobRun {
            job: "streamBackfill".into(),
            finished_at: 1_791_000_000_000.0,
            outcome: "partial".into(),
            handled: 2,
            added: 0,
            changed: 1,
            retired: 0,
            failed: 1,
        }]
    );
}
