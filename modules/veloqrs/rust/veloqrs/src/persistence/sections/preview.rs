//! What-if section detection over one riding area, without writing a byte.
//!
//! A preview runs the pure batch detector over the geographic component
//! containing a chosen point, on its own read-only SQLite connection, and
//! diffs the proposal against the live catalogue. The engine, the DB and the
//! evidence cache are untouched; the result leaves as one JSON payload.

use crate::FrequentSection;
use base64::Engine as _;
use once_cell::sync::Lazy;
use rusqlite::{Connection, OpenFlags};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::Instant;
use tracematch::sections::{RECUT_AGREEMENT, Tunables, mutual_overlap, shares_ground};

use super::super::{PersistentRouteEngine, SectionDetectionProgress};

/// Bin edge for the ~5 km centre grid, in degrees of latitude.
const BIN_DEG: f64 = 0.045;

/// A (min_lat, max_lat, min_lng, max_lng) box in degrees.
type DegreeBox = (f64, f64, f64, f64);

/// The one preview slot. Occupied from start until the result is taken or the
/// run ends cancelled or dead, so a second preview can never overlap the
/// first: two resident pools would double the peak memory on a phone.
pub static SECTION_PREVIEW_HANDLE: Lazy<Mutex<Option<SectionPreviewHandle>>> =
    Lazy::new(|| Mutex::new(None));

/// A ranked riding area: one occupied ~5 km bin.
#[derive(Debug, Clone)]
pub struct PreviewCentre {
    pub bin_key: String,
    pub lat: f64,
    pub lng: f64,
    pub visit_total: u32,
    pub section_count: u32,
    pub source: String,
}

/// The five caller-exposed detection knobs, overlaid onto the engine's live
/// config. Only these cross the boundary: trusting a whole caller-supplied
/// config would silently flip fields the panel never shows, `pool_sports`
/// first among them.
#[derive(Debug, Clone, Copy)]
pub struct PreviewOverlay {
    pub proximity_threshold: f64,
    pub min_section_length: f64,
    pub max_section_length: f64,
    pub min_activities: u32,
    pub divergence_threshold: f64,
}

/// How a finished preview run ended.
pub enum PreviewOutcome {
    /// The one JSON payload.
    Complete(String),
    /// Cancelled cooperatively; nothing to take.
    Cancelled,
}

/// One poll of a preview handle.
pub enum PreviewPoll {
    Running,
    Complete,
    Cancelled,
    /// The worker died without sending (panic, failed open).
    Died,
}

/// Handle for one background preview run.
pub struct SectionPreviewHandle {
    receiver: mpsc::Receiver<PreviewOutcome>,
    pub progress: SectionDetectionProgress,
    cancel: Arc<AtomicBool>,
    outcome: Option<PreviewOutcome>,
}

impl SectionPreviewHandle {
    fn pump(&mut self) {
        if self.outcome.is_none()
            && let Ok(o) = self.receiver.try_recv()
        {
            self.outcome = Some(o);
        }
    }

    /// Non-blocking poll that also reports a dead worker thread.
    pub fn poll_status(&mut self) -> PreviewPoll {
        self.pump();
        match self.outcome {
            Some(PreviewOutcome::Complete(_)) => PreviewPoll::Complete,
            Some(PreviewOutcome::Cancelled) => PreviewPoll::Cancelled,
            None => match self.receiver.try_recv() {
                Ok(o) => {
                    self.outcome = Some(o);
                    match self.outcome {
                        Some(PreviewOutcome::Complete(_)) => PreviewPoll::Complete,
                        _ => PreviewPoll::Cancelled,
                    }
                }
                Err(mpsc::TryRecvError::Empty) => PreviewPoll::Running,
                Err(mpsc::TryRecvError::Disconnected) => PreviewPoll::Died,
            },
        }
    }

    /// Take the payload once. None while running, cancelled or already taken.
    pub fn take_payload(&mut self) -> Option<String> {
        self.pump();
        match self.outcome {
            Some(PreviewOutcome::Complete(_)) => match self.outcome.take() {
                Some(PreviewOutcome::Complete(json)) => Some(json),
                _ => None,
            },
            _ => None,
        }
    }

    /// Request cooperative cancellation; the worker checks between stages.
    pub fn request_cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
    }

    /// Block for the outcome (test path; production polls).
    pub fn recv(self) -> Option<PreviewOutcome> {
        if self.outcome.is_some() {
            return self.outcome;
        }
        self.receiver.recv().ok()
    }
}

/// The geographic component containing (lat, lng): connected components of
/// activity bounding boxes padded by half `gap_m`, the same construction the
/// detector's own geo clustering uses, so the preview pool is exactly the
/// pool the detector would place around that point. Returns the member ids
/// (sorted) and the union of their padded boxes, or None when no padded box
/// contains the point. Boxes at the (0, 0, 0, 0) sentinel carry no geometry
/// and are skipped.
pub(crate) fn cluster_for(
    boxes: &[(String, tracematch::Bounds)],
    lat: f64,
    lng: f64,
    gap_m: f64,
) -> Option<(Vec<String>, DegreeBox)> {
    let pad_lat = gap_m * 0.5 / 111_132.0;
    let padded: Vec<Option<DegreeBox>> = boxes
        .iter()
        .map(|(_, b)| {
            if b.min_lat == 0.0 && b.max_lat == 0.0 && b.min_lng == 0.0 && b.max_lng == 0.0 {
                return None;
            }
            let mid = ((b.min_lat + b.max_lat) * 0.5).to_radians();
            let pad_lng = gap_m * 0.5 / (111_320.0 * mid.cos().abs().max(0.01));
            Some((
                b.min_lat - pad_lat,
                b.max_lat + pad_lat,
                b.min_lng - pad_lng,
                b.max_lng + pad_lng,
            ))
        })
        .collect();

    let mut uf: tracematch::UnionFind<usize> = tracematch::UnionFind::new();
    for i in 0..boxes.len() {
        uf.make_set(i);
    }
    for (i, a) in padded.iter().enumerate() {
        let Some(a) = a else { continue };
        for (j, b) in padded.iter().enumerate().skip(i + 1) {
            let Some(b) = b else { continue };
            if a.0 <= b.1 && b.0 <= a.1 && a.2 <= b.3 && b.2 <= a.3 {
                uf.union(&i, &j);
            }
        }
    }

    // Any padded box containing the point names the component: two boxes both
    // holding the point overlap at it, so the component is unique.
    let seed = padded.iter().enumerate().find_map(|(i, p)| {
        p.filter(|p| p.0 <= lat && lat <= p.1 && p.2 <= lng && lng <= p.3)
            .map(|_| i)
    })?;
    let root = uf.find(&seed);

    let mut ids: Vec<String> = Vec::new();
    let mut bbox = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
    for (i, p) in padded.iter().enumerate() {
        let Some(p) = p else { continue };
        if uf.find(&i) == root {
            ids.push(boxes[i].0.clone());
            bbox.0 = bbox.0.min(p.0);
            bbox.1 = bbox.1.max(p.1);
            bbox.2 = bbox.2.min(p.2);
            bbox.3 = bbox.3.max(p.3);
        }
    }
    ids.sort();
    Some((ids, bbox))
}

#[derive(serde::Serialize)]
struct PayloadPool {
    activities: u32,
    empty: u32,
    unreadable: u32,
}

#[derive(serde::Serialize)]
struct PayloadConfig {
    proximity_threshold: f64,
    min_section_length: f64,
    max_section_length: f64,
    min_activities: u32,
    divergence_threshold: f64,
}

#[derive(serde::Serialize)]
struct PayloadCounts {
    current: u32,
    proposed: u32,
    unchanged: u32,
    changed: u32,
    new: u32,
    gone: u32,
}

#[derive(serde::Serialize)]
struct PayloadSection {
    id: String,
    live_id: Option<String>,
    status: &'static str,
    name: Option<String>,
    sport: String,
    polyline: String,
    visits: u32,
    distance_m: f64,
    elevation_gain_m: Option<f64>,
    avg_grade_percent: Option<f64>,
    pinned: bool,
}

#[derive(serde::Serialize)]
struct PreviewPayload {
    pool: PayloadPool,
    elapsed_ms: u64,
    config: PayloadConfig,
    counts: PayloadCounts,
    sections: Vec<PayloadSection>,
}

fn encoded_polyline(points: &[tracematch::GpsPoint]) -> String {
    base64::engine::general_purpose::STANDARD.encode(crate::coords::encode(points))
}

/// Diff the proposed catalogue against the scoped live one: greedy 1:1
/// pairing by descending mutual overlap among pairs sharing ground, then the
/// four-status classification. `RECUT_AGREEMENT` splits unchanged from
/// changed; unpaired rows are new or gone.
fn diff_catalogues(
    proposed: &[FrequentSection],
    live: &[FrequentSection],
    pinned: &HashSet<String>,
) -> (PayloadCounts, Vec<PayloadSection>) {
    let mut pairs: Vec<(usize, usize, f64)> = Vec::new();
    for (i, p) in proposed.iter().enumerate() {
        for (j, l) in live.iter().enumerate() {
            if shares_ground(&p.polyline, &l.polyline) {
                pairs.push((i, j, mutual_overlap(&p.polyline, &l.polyline)));
            }
        }
    }
    pairs.sort_by(|a, b| {
        b.2.total_cmp(&a.2)
            .then_with(|| (a.0, a.1).cmp(&(b.0, b.1)))
    });

    let mut proposed_match: Vec<Option<(usize, f64)>> = vec![None; proposed.len()];
    let mut live_taken: Vec<bool> = vec![false; live.len()];
    for (i, j, overlap) in pairs {
        if proposed_match[i].is_none() && !live_taken[j] {
            proposed_match[i] = Some((j, overlap));
            live_taken[j] = true;
        }
    }

    let mut counts = PayloadCounts {
        current: live.len() as u32,
        proposed: proposed.len() as u32,
        unchanged: 0,
        changed: 0,
        new: 0,
        gone: 0,
    };
    let mut rows: Vec<PayloadSection> = Vec::with_capacity(proposed.len() + live.len());

    for (i, p) in proposed.iter().enumerate() {
        let (status, live_ref) = match proposed_match[i] {
            Some((j, overlap)) if overlap >= RECUT_AGREEMENT => {
                counts.unchanged += 1;
                ("unchanged", Some(&live[j]))
            }
            Some((j, _)) => {
                counts.changed += 1;
                ("changed", Some(&live[j]))
            }
            None => {
                counts.new += 1;
                ("new", None)
            }
        };
        rows.push(PayloadSection {
            id: p.id.clone(),
            live_id: live_ref.map(|l| l.id.clone()),
            status,
            name: live_ref.and_then(|l| l.name.clone()),
            sport: p.sport_type.clone(),
            polyline: encoded_polyline(&p.polyline),
            visits: p.visit_count,
            distance_m: p.distance_meters,
            elevation_gain_m: p.elevation_gain_m,
            avg_grade_percent: p.avg_grade_percent,
            pinned: live_ref.is_some_and(|l| pinned.contains(&l.id)),
        });
    }

    for (j, l) in live.iter().enumerate() {
        if live_taken[j] {
            continue;
        }
        counts.gone += 1;
        rows.push(PayloadSection {
            id: l.id.clone(),
            live_id: None,
            status: "gone",
            name: l.name.clone(),
            sport: l.sport_type.clone(),
            polyline: encoded_polyline(&l.polyline),
            visits: l.visit_count,
            distance_m: l.distance_meters,
            elevation_gain_m: l.elevation_gain_m,
            avg_grade_percent: l.avg_grade_percent,
            pinned: pinned.contains(&l.id),
        });
    }

    (counts, rows)
}

impl PersistentRouteEngine {
    /// Ranked riding areas at ~5 km. The sections substrate (bounds cache +
    /// visit counts) speaks for the catalogue when any auto section carries
    /// bounds; otherwise activity boxes stand in, with the (0, 0, 0, 0)
    /// sentinel filtered. Ordered visit_total DESC then bin_key ASC.
    pub fn preview_centres(&self, limit: u32) -> Vec<PreviewCentre> {
        let mut members: Vec<(f64, f64, u32)> = Vec::new();
        let mut source = "sections";

        if let Ok(mut stmt) = self.db.prepare(
            "SELECT bounds_min_lat, bounds_max_lat, bounds_min_lng, bounds_max_lng, visit_count
             FROM sections WHERE section_type = 'auto' AND bounds_min_lat IS NOT NULL",
        ) {
            let rows = stmt.query_map([], |row| {
                Ok((
                    row.get::<_, f64>(0)?,
                    row.get::<_, f64>(1)?,
                    row.get::<_, f64>(2)?,
                    row.get::<_, f64>(3)?,
                    row.get::<_, u32>(4)?,
                ))
            });
            if let Ok(rows) = rows {
                for (min_lat, max_lat, min_lng, max_lng, visits) in rows.flatten() {
                    members.push(((min_lat + max_lat) * 0.5, (min_lng + max_lng) * 0.5, visits));
                }
            }
        }

        if members.is_empty() {
            source = "activities";
            if let Ok(mut stmt) = self
                .db
                .prepare("SELECT min_lat, max_lat, min_lng, max_lng FROM activities")
            {
                let rows = stmt.query_map([], |row| {
                    Ok((
                        row.get::<_, f64>(0)?,
                        row.get::<_, f64>(1)?,
                        row.get::<_, f64>(2)?,
                        row.get::<_, f64>(3)?,
                    ))
                });
                if let Ok(rows) = rows {
                    for (min_lat, max_lat, min_lng, max_lng) in rows.flatten() {
                        if min_lat == 0.0 && max_lat == 0.0 && min_lng == 0.0 && max_lng == 0.0 {
                            continue;
                        }
                        members.push(((min_lat + max_lat) * 0.5, (min_lng + max_lng) * 0.5, 1));
                    }
                }
            }
        }

        struct Bin {
            lat_sum: f64,
            lng_sum: f64,
            visit_total: u32,
            section_count: u32,
            n: u32,
        }
        let mut bins: HashMap<String, Bin> = HashMap::new();
        for (lat, lng, visits) in members {
            let key = format!(
                "{}:{}",
                (lat / BIN_DEG).floor() as i64,
                (lng / BIN_DEG).floor() as i64
            );
            let bin = bins.entry(key).or_insert(Bin {
                lat_sum: 0.0,
                lng_sum: 0.0,
                visit_total: 0,
                section_count: 0,
                n: 0,
            });
            bin.lat_sum += lat;
            bin.lng_sum += lng;
            bin.visit_total += visits;
            if source == "sections" {
                bin.section_count += 1;
            }
            bin.n += 1;
        }

        let mut centres: Vec<PreviewCentre> = bins
            .into_iter()
            .map(|(bin_key, b)| PreviewCentre {
                bin_key,
                lat: b.lat_sum / f64::from(b.n),
                lng: b.lng_sum / f64::from(b.n),
                visit_total: b.visit_total,
                section_count: b.section_count,
                source: source.to_string(),
            })
            .collect();
        centres.sort_by(|a, b| {
            b.visit_total
                .cmp(&a.visit_total)
                .then_with(|| a.bin_key.cmp(&b.bin_key))
        });
        centres.truncate(limit as usize);
        centres
    }

    /// Start a preview run over the component containing (lat, lng).
    ///
    /// Snapshots everything the worker needs from memory under the read lock,
    /// then spawns. The worker opens its own read-only connection, loads the
    /// component's pool, runs the pure batch detector and diffs against the
    /// live catalogue scoped to the component. A detection-suspension guard
    /// rides with the worker so no real detect can overlap the run.
    ///
    /// Returns None when no activity's padded box contains the point.
    pub fn preview_detect_background(
        &self,
        lat: f64,
        lng: f64,
        overlay: PreviewOverlay,
    ) -> Option<SectionPreviewHandle> {
        let boxes: Vec<(String, tracematch::Bounds)> = self
            .activity_metadata
            .values()
            .map(|m| (m.id.clone(), m.bounds))
            .collect();
        let (component_ids, padded_bbox) =
            cluster_for(&boxes, lat, lng, Tunables::DEFAULT.cluster_gap_m)?;

        let mut effective_config = self.section_config.clone();
        effective_config.proximity_threshold = overlay.proximity_threshold;
        effective_config.min_section_length = overlay.min_section_length;
        effective_config.max_section_length = overlay.max_section_length;
        effective_config.min_activities = overlay.min_activities;
        effective_config.divergence_threshold = overlay.divergence_threshold;

        let sport_map: HashMap<String, String> = self
            .activity_metadata
            .values()
            .map(|m| (m.id.clone(), m.sport_type.clone()))
            .collect();

        // Live auto sections whose ground can intersect the component. The
        // diff omits everything outside, so far-away sections never surface
        // as gone.
        let live_scoped: Vec<FrequentSection> = self
            .sections
            .iter()
            .filter(|s| !s.is_user_defined)
            .filter(|s| {
                let b = tracematch::geo_utils::compute_bounds(&s.polyline);
                b.min_lat <= padded_bbox.1
                    && padded_bbox.0 <= b.max_lat
                    && b.min_lng <= padded_bbox.3
                    && padded_bbox.2 <= b.max_lng
            })
            .cloned()
            .collect();

        let db_path = self.db_path.clone();
        let (tx, rx) = mpsc::channel();
        let cancel = Arc::new(AtomicBool::new(false));
        let cancel_worker = Arc::clone(&cancel);
        let progress = SectionDetectionProgress::new();
        progress.set_phase("loading", component_ids.len() as u32);
        let progress_worker = progress.clone();

        // Held for the whole run and dropped by the worker, so a real detect
        // refuses while a preview is in flight.
        let suspend = super::conditioning::suspend_detection();

        thread::spawn(move || {
            let _suspend = suspend;
            let started = Instant::now();

            let conn = match Connection::open_with_flags(
                &db_path,
                OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
            ) {
                Ok(c) => {
                    let _ = c.busy_timeout(std::time::Duration::from_secs(5));
                    c
                }
                Err(e) => {
                    log::error!("tracematch: [SectionPreview] Failed to open read-only DB: {e:?}");
                    return;
                }
            };

            // Durable pin intent, read here so the snapshot never touches
            // SQLite under the engine's read lock.
            let pinned: HashSet<String> = conn
                .prepare("SELECT section_id FROM section_pins")
                .ok()
                .and_then(|mut stmt| {
                    stmt.query_map([], |row| row.get::<_, String>(0))
                        .map(|rows| rows.flatten().collect())
                        .ok()
                })
                .unwrap_or_default();

            // Occasion floor input, same query and epoch floor as the real
            // detect. Dates before 2000 read as unknown.
            let mut start_epochs: HashMap<String, i64> = HashMap::new();
            if let Ok(mut stmt) =
                conn.prepare("SELECT id, start_date FROM activities WHERE start_date >= 946684800")
            {
                let rows = stmt.query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
                });
                if let Ok(rows) = rows {
                    for (id, e) in rows.flatten() {
                        start_epochs.insert(id, e);
                    }
                }
            }

            let Some(pool) = super::track_pool::load_tracks_chunked(
                &conn,
                &component_ids,
                &progress_worker,
                &cancel_worker,
            ) else {
                tx.send(PreviewOutcome::Cancelled).ok();
                return;
            };
            if cancel_worker.load(Ordering::SeqCst) {
                tx.send(PreviewOutcome::Cancelled).ok();
                return;
            }

            log::info!(
                "tracematch: [SectionPreview] Pool loaded: {} tracks ({} empty, {} unreadable) of {} component ids",
                pool.tracks.len(),
                pool.empty,
                pool.unreadable,
                component_ids.len()
            );

            progress_worker.set_phase("analyzing", pool.tracks.len() as u32);

            // Seconds stay empty to mirror the real detect, which passes
            // none; if that call ever carries real seconds this one must
            // change with it or proposals stop matching what a Keep applies.
            let detection = tracematch::detect_sections_unified_dated(
                &pool.tracks,
                &[],
                &sport_map,
                &start_epochs,
                &effective_config,
                &Tunables::DEFAULT,
            );

            // Past this point the detect has already run to completion; a
            // cancel now discards the result rather than aborting work.
            if cancel_worker.load(Ordering::SeqCst) {
                tx.send(PreviewOutcome::Cancelled).ok();
                return;
            }

            progress_worker.set_phase("diffing", 1);
            let (counts, sections) = diff_catalogues(&detection.sections, &live_scoped, &pinned);

            let payload = PreviewPayload {
                pool: PayloadPool {
                    activities: pool.tracks.len() as u32,
                    empty: pool.empty,
                    unreadable: pool.unreadable,
                },
                elapsed_ms: started.elapsed().as_millis() as u64,
                config: PayloadConfig {
                    proximity_threshold: effective_config.proximity_threshold,
                    min_section_length: effective_config.min_section_length,
                    max_section_length: effective_config.max_section_length,
                    min_activities: effective_config.min_activities,
                    divergence_threshold: effective_config.divergence_threshold,
                },
                counts,
                sections,
            };

            progress_worker.set_phase("complete", 1);
            progress_worker.increment();
            match serde_json::to_string(&payload) {
                Ok(json) => {
                    tx.send(PreviewOutcome::Complete(json)).ok();
                }
                Err(e) => {
                    log::error!("tracematch: [SectionPreview] Payload serialisation failed: {e}");
                }
            }
        });

        Some(SectionPreviewHandle {
            receiver: rx,
            progress,
            cancel,
            outcome: None,
        })
    }
}
