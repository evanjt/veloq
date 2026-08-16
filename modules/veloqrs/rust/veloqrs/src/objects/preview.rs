use super::error::{VeloqError, with_engine, with_engine_read};
use crate::persistence::persistent_engine_ffi::SECTION_DETECTION_HANDLE;
use crate::persistence::sections::preview::{PreviewOverlay, PreviewPoll, SECTION_PREVIEW_HANDLE};
use log::info;
use std::sync::Arc;

/// A ranked riding area: one occupied ~5 km bin of the user's library.
#[derive(Debug, Clone, uniffi::Record)]
pub struct FfiPreviewCentre {
    /// "lat_bin:lng_bin" at ~5 km, an order-free ranking key.
    pub bin_key: String,
    pub lat: f64,
    pub lng: f64,
    /// Sum of section visit counts in the bin, or activity count on fallback.
    pub visit_total: u32,
    /// 0 on the activities fallback.
    pub section_count: u32,
    /// "sections" | "activities"
    pub source: String,
}

#[derive(uniffi::Object)]
pub struct SectionPreview {
    pub(crate) _private: (),
}

#[uniffi::export]
impl SectionPreview {
    #[uniffi::constructor]
    pub fn new() -> Arc<Self> {
        Arc::new(Self { _private: () })
    }

    /// Ranked riding areas. Sections substrate (bounds cache + visit_count)
    /// when any auto section carries bounds, activity-bbox bins otherwise
    /// ((0, 0, 0, 0) sentinel filtered). Ordered visit_total DESC, bin_key ASC.
    pub fn centres(&self, limit: u32) -> Result<Vec<FfiPreviewCentre>, VeloqError> {
        // Write lock, not read: centres queries SQLite and the read lock is
        // memory-only by invariant.
        with_engine(|e| {
            e.preview_centres(limit)
                .into_iter()
                .map(|c| FfiPreviewCentre {
                    bin_key: c.bin_key,
                    lat: c.lat,
                    lng: c.lng,
                    visit_total: c.visit_total,
                    section_count: c.section_count,
                    source: c.source,
                })
                .collect()
        })
    }

    /// Resolve the whole geo component containing (lat, lng) and start the
    /// pure preview detect over it. Only the five exposed fields of `config`
    /// overlay the engine's live config. Returns false when a preview or real
    /// detect is running, detection is suspended for a backfill, or no
    /// activity covers the point.
    pub fn start(
        &self,
        lat: f64,
        lng: f64,
        config: crate::FfiSectionConfig,
    ) -> Result<bool, VeloqError> {
        if crate::persistence::detection_suspended() {
            info!("tracematch: [SectionPreview] Start refused: detection is suspended");
            return Ok(false);
        }

        // The slot mutex is held across reap, check, spawn and install, so two
        // concurrent starts cannot both pass the emptiness check.
        let mut slot = SECTION_PREVIEW_HANDLE
            .lock()
            .map_err(|_| VeloqError::LockFailed)?;

        // Reap a terminal run first: a cancelled, dead or complete-but-untaken
        // preview must not occupy the slot forever once its poller has gone
        // away. A fresh start supersedes an untaken payload, which was cut for
        // parameters the caller has already abandoned.
        if let Some(handle) = slot.as_mut() {
            match handle.poll_status() {
                PreviewPoll::Running => {
                    info!(
                        "tracematch: [SectionPreview] Start refused: a preview is already running"
                    );
                    return Ok(false);
                }
                PreviewPoll::Complete | PreviewPoll::Cancelled | PreviewPoll::Died => {
                    *slot = None;
                }
            }
        }

        // Checked under the preview slot lock so a real detect observed here
        // is current as of this start; a detect that begins mid-spawn merely
        // overlaps a read-only run, it cannot corrupt anything.
        {
            let detect_guard = SECTION_DETECTION_HANDLE
                .lock()
                .map_err(|_| VeloqError::LockFailed)?;
            if detect_guard.is_some() {
                info!("tracematch: [SectionPreview] Start refused: a real detect is running");
                return Ok(false);
            }
        }

        let overlay = PreviewOverlay {
            proximity_threshold: config.proximity_threshold,
            min_section_length: config.min_section_length,
            max_section_length: config.max_section_length,
            min_activities: config.min_activities,
            divergence_threshold: config.divergence_threshold,
        };

        match with_engine_read(|e| e.preview_detect_background(lat, lng, overlay))? {
            Some(handle) => {
                *slot = Some(handle);
                info!("tracematch: [SectionPreview] Preview started");
                Ok(true)
            }
            None => {
                info!("tracematch: [SectionPreview] Start refused: no activity covers the point");
                Ok(false)
            }
        }
    }

    /// "idle" | "running" | "complete" | "cancelled" | "error"
    pub fn poll(&self) -> Result<String, VeloqError> {
        let mut slot = SECTION_PREVIEW_HANDLE
            .lock()
            .map_err(|_| VeloqError::LockFailed)?;
        let Some(handle) = slot.as_mut() else {
            return Ok("idle".to_string());
        };
        Ok(match handle.poll_status() {
            PreviewPoll::Running => "running".to_string(),
            // The slot stays occupied until take_result so the payload
            // cannot be lost between polls.
            PreviewPoll::Complete => "complete".to_string(),
            PreviewPoll::Cancelled => {
                *slot = None;
                "cancelled".to_string()
            }
            PreviewPoll::Died => {
                *slot = None;
                log::error!("tracematch: [SectionPreview] Preview thread died without a result");
                "error".to_string()
            }
        })
    }

    pub fn get_progress(&self) -> Result<Option<crate::FfiDetectionProgress>, VeloqError> {
        let slot = SECTION_PREVIEW_HANDLE
            .lock()
            .map_err(|_| VeloqError::LockFailed)?;
        Ok(slot.as_ref().map(|handle| {
            let phase = handle.progress.get_phase();
            let completed = handle.progress.get_completed();
            let total = handle.progress.get_total();
            let percent = handle.progress.get_percent();
            crate::FfiDetectionProgress {
                phase,
                completed,
                total,
                percent,
            }
        }))
    }

    /// The one JSON payload, once. None while running or after taken.
    pub fn take_result(&self) -> Result<Option<String>, VeloqError> {
        let mut slot = SECTION_PREVIEW_HANDLE
            .lock()
            .map_err(|_| VeloqError::LockFailed)?;
        let Some(handle) = slot.as_mut() else {
            return Ok(None);
        };
        match handle.take_payload() {
            Some(json) => {
                *slot = None;
                Ok(Some(json))
            }
            None => Ok(None),
        }
    }

    /// Cooperative: aborts within one load chunk; once inside the detect the
    /// run completes and is discarded.
    pub fn cancel(&self) -> Result<(), VeloqError> {
        let slot = SECTION_PREVIEW_HANDLE
            .lock()
            .map_err(|_| VeloqError::LockFailed)?;
        if let Some(handle) = slot.as_ref() {
            handle.request_cancel();
            info!("tracematch: [SectionPreview] Cancel requested");
        }
        Ok(())
    }
}
