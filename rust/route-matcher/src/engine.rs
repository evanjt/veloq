//! # Route Engine
//!
//! Stateful route management engine that keeps all route data in Rust.
//! This eliminates FFI overhead for ongoing operations by maintaining state
//! on the Rust side rather than passing data back and forth with JS.
//!
//! ## Architecture
//!
//! The engine is a singleton that manages:
//! - Activities with their GPS coordinates
//! - Pre-computed route signatures
//! - Route groupings (similar routes)
//! - Frequent sections
//! - Spatial index for viewport queries
//!
//! JS/mobile code interacts through thin FFI calls that trigger computation
//! but don't require large data transfers.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use once_cell::sync::Lazy;
use rstar::{RTree, RTreeObject, AABB};

use crate::{
    GpsPoint, RouteSignature, RouteGroup, MatchConfig, Bounds,
    FrequentSection, SectionConfig,
};

#[cfg(not(feature = "parallel"))]
use crate::group_signatures;

#[cfg(feature = "parallel")]
use crate::{group_signatures_parallel, group_incremental};

// ============================================================================
// Core Types
// ============================================================================

/// Activity data stored in the engine
#[derive(Debug, Clone)]
pub struct ActivityData {
    pub id: String,
    pub coords: Vec<GpsPoint>,
    pub sport_type: String,
    pub bounds: Option<Bounds>,
}

/// Bounds wrapper for R-tree spatial indexing
#[derive(Debug, Clone)]
pub struct ActivityBounds {
    pub activity_id: String,
    pub min_lat: f64,
    pub max_lat: f64,
    pub min_lng: f64,
    pub max_lng: f64,
}

impl RTreeObject for ActivityBounds {
    type Envelope = AABB<[f64; 2]>;

    fn envelope(&self) -> Self::Envelope {
        AABB::from_corners(
            [self.min_lng, self.min_lat],
            [self.max_lng, self.max_lat],
        )
    }
}

/// Engine event types for notifying JS of changes
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "ffi", derive(uniffi::Enum))]
pub enum EngineEvent {
    ActivitiesChanged,
    GroupsChanged,
    SectionsChanged,
}

// ============================================================================
// Route Engine
// ============================================================================

/// The main stateful route engine.
///
/// Maintains all route-related state in Rust, eliminating FFI overhead
/// for ongoing operations. State is incrementally updated as activities
/// are added or removed.
pub struct RouteEngine {
    // Core state
    activities: HashMap<String, ActivityData>,
    signatures: HashMap<String, RouteSignature>,
    groups: Vec<RouteGroup>,
    sections: Vec<FrequentSection>,

    // Spatial index for viewport queries
    spatial_index: RTree<ActivityBounds>,

    // Caches
    consensus_cache: HashMap<String, Vec<GpsPoint>>,

    // Custom route names (route_id -> custom_name)
    route_names: HashMap<String, String>,

    // Dirty tracking for incremental updates
    dirty_signatures: HashSet<String>,
    /// Track which signatures are "new" (just computed, not yet grouped)
    new_signatures: HashSet<String>,
    groups_dirty: bool,
    sections_dirty: bool,
    spatial_dirty: bool,

    // Configuration
    match_config: MatchConfig,
    section_config: SectionConfig,
}

impl RouteEngine {
    /// Create a new route engine with default configuration.
    pub fn new() -> Self {
        Self {
            activities: HashMap::new(),
            signatures: HashMap::new(),
            groups: Vec::new(),
            sections: Vec::new(),
            spatial_index: RTree::new(),
            consensus_cache: HashMap::new(),
            route_names: HashMap::new(),
            dirty_signatures: HashSet::new(),
            new_signatures: HashSet::new(),
            groups_dirty: false,
            sections_dirty: false,
            spatial_dirty: false,
            match_config: MatchConfig::default(),
            section_config: SectionConfig::default(),
        }
    }

    /// Create a new route engine with custom configuration.
    pub fn with_config(match_config: MatchConfig, section_config: SectionConfig) -> Self {
        Self {
            match_config,
            section_config,
            ..Self::new()
        }
    }

    // ========================================================================
    // Activity Management
    // ========================================================================

    /// Add an activity with its GPS coordinates.
    ///
    /// The signature is computed lazily when needed. This allows batch
    /// additions to be more efficient.
    pub fn add_activity(&mut self, id: String, coords: Vec<GpsPoint>, sport_type: String) {
        let bounds = Bounds::from_points(&coords);

        let activity = ActivityData {
            id: id.clone(),
            coords,
            sport_type,
            bounds,
        };

        self.activities.insert(id.clone(), activity);
        self.dirty_signatures.insert(id);
        self.groups_dirty = true;
        self.sections_dirty = true;
        self.spatial_dirty = true;
    }

    /// Add an activity from flat coordinate buffer.
    ///
    /// Coordinates are [lat1, lng1, lat2, lng2, ...].
    pub fn add_activity_flat(&mut self, id: String, flat_coords: &[f64], sport_type: String) {
        let coords: Vec<GpsPoint> = flat_coords
            .chunks_exact(2)
            .map(|chunk| GpsPoint::new(chunk[0], chunk[1]))
            .collect();
        self.add_activity(id, coords, sport_type);
    }

    /// Add multiple activities from flat coordinate buffers.
    ///
    /// This is the most efficient way to bulk-add activities from JS.
    pub fn add_activities_flat(
        &mut self,
        activity_ids: &[String],
        all_coords: &[f64],
        offsets: &[u32],
        sport_types: &[String],
    ) {
        for (i, id) in activity_ids.iter().enumerate() {
            let start = offsets[i] as usize;
            let end = offsets.get(i + 1).map(|&o| o as usize).unwrap_or(all_coords.len() / 2);

            let coords: Vec<GpsPoint> = (start..end)
                .filter_map(|j| {
                    let idx = j * 2;
                    if idx + 1 < all_coords.len() {
                        Some(GpsPoint::new(all_coords[idx], all_coords[idx + 1]))
                    } else {
                        None
                    }
                })
                .collect();

            let sport = sport_types.get(i).cloned().unwrap_or_default();
            self.add_activity(id.clone(), coords, sport);
        }
    }

    /// Remove an activity.
    ///
    /// Note: Removal requires full recomputation of groups (can't be done incrementally).
    pub fn remove_activity(&mut self, id: &str) {
        self.activities.remove(id);
        self.signatures.remove(id);
        self.dirty_signatures.remove(id);
        self.new_signatures.remove(id);
        // Force full recomputation by clearing new_signatures and groups
        self.new_signatures.clear();
        self.groups.clear();
        self.consensus_cache.clear(); // Invalidate all consensus caches
        self.groups_dirty = true;
        self.sections_dirty = true;
        self.spatial_dirty = true;
    }

    /// Remove multiple activities.
    ///
    /// Note: Removal requires full recomputation of groups (can't be done incrementally).
    pub fn remove_activities(&mut self, ids: &[String]) {
        for id in ids {
            self.activities.remove(id);
            self.signatures.remove(id);
            self.dirty_signatures.remove(id);
            self.new_signatures.remove(id);
        }
        if !ids.is_empty() {
            // Force full recomputation
            self.new_signatures.clear();
            self.groups.clear();
            self.consensus_cache.clear();
            self.groups_dirty = true;
            self.sections_dirty = true;
            self.spatial_dirty = true;
        }
    }

    /// Clear all activities and reset state.
    pub fn clear(&mut self) {
        self.activities.clear();
        self.signatures.clear();
        self.groups.clear();
        self.sections.clear();
        self.spatial_index = RTree::new();
        self.consensus_cache.clear();
        self.dirty_signatures.clear();
        self.new_signatures.clear();
        self.groups_dirty = false;
        self.sections_dirty = false;
        self.spatial_dirty = false;
    }

    /// Get all activity IDs.
    pub fn get_activity_ids(&self) -> Vec<String> {
        self.activities.keys().cloned().collect()
    }

    /// Get the number of activities.
    pub fn activity_count(&self) -> usize {
        self.activities.len()
    }

    /// Check if an activity exists.
    pub fn has_activity(&self, id: &str) -> bool {
        self.activities.contains_key(id)
    }

    // ========================================================================
    // Signature Operations
    // ========================================================================

    /// Ensure all dirty signatures are computed.
    /// Newly computed signatures are tracked in `new_signatures` for incremental grouping.
    fn ensure_signatures(&mut self) {
        if self.dirty_signatures.is_empty() {
            return;
        }

        let dirty_ids: Vec<String> = self.dirty_signatures.drain().collect();

        for id in dirty_ids {
            if let Some(activity) = self.activities.get(&id) {
                if let Some(sig) = RouteSignature::from_points(
                    &activity.id,
                    &activity.coords,
                    &self.match_config,
                ) {
                    self.signatures.insert(id.clone(), sig);
                    // Track as new signature for incremental grouping
                    self.new_signatures.insert(id);
                }
            }
        }
    }

    /// Get a signature for an activity.
    pub fn get_signature(&mut self, id: &str) -> Option<&RouteSignature> {
        // Ensure signature is computed
        if self.dirty_signatures.contains(id) {
            self.ensure_signatures();
        }
        self.signatures.get(id)
    }

    /// Get all signatures.
    pub fn get_all_signatures(&mut self) -> Vec<&RouteSignature> {
        self.ensure_signatures();
        self.signatures.values().collect()
    }

    /// Get signature points for an activity as JSON.
    /// Returns empty string if activity not found.
    pub fn get_signature_points_json(&mut self, id: &str) -> String {
        if let Some(sig) = self.get_signature(id) {
            serde_json::to_string(&sig.points).unwrap_or_else(|_| "[]".to_string())
        } else {
            "[]".to_string()
        }
    }

    /// Get signature points for multiple activities as JSON.
    /// Returns a map of activity_id -> points array.
    pub fn get_signatures_for_group_json(&mut self, group_id: &str) -> String {
        self.ensure_groups();

        // Find the group
        let activity_ids: Vec<String> = self.groups
            .iter()
            .find(|g| g.group_id == group_id)
            .map(|g| g.activity_ids.clone())
            .unwrap_or_default();

        // Build map of activity_id -> points
        let mut result: std::collections::HashMap<String, Vec<GpsPoint>> = std::collections::HashMap::new();
        for id in &activity_ids {
            if let Some(sig) = self.get_signature(id) {
                result.insert(id.clone(), sig.points.clone());
            }
        }

        serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string())
    }

    // ========================================================================
    // Grouping
    // ========================================================================

    /// Ensure groups are computed.
    ///
    /// Uses incremental grouping when:
    /// - We have existing groups (not starting fresh)
    /// - We have new signatures to add
    ///
    /// Falls back to full grouping when:
    /// - No existing groups (first computation)
    /// - Activity removal requires full recomputation
    fn ensure_groups(&mut self) {
        if !self.groups_dirty {
            return;
        }

        self.ensure_signatures();

        #[cfg(feature = "parallel")]
        {
            // Check if we can use incremental grouping
            let can_use_incremental = !self.groups.is_empty()
                && !self.new_signatures.is_empty()
                && self.signatures.len() > self.new_signatures.len();

            if can_use_incremental {
                // Incremental: only compare new signatures vs existing + new vs new
                // This is O(n×m) instead of O(n²)
                let new_sigs: Vec<RouteSignature> = self.new_signatures
                    .iter()
                    .filter_map(|id| self.signatures.get(id).cloned())
                    .collect();

                let existing_sigs: Vec<RouteSignature> = self.signatures
                    .iter()
                    .filter(|(id, _)| !self.new_signatures.contains(*id))
                    .map(|(_, sig)| sig.clone())
                    .collect();

                self.groups = group_incremental(
                    &new_sigs,
                    &self.groups,
                    &existing_sigs,
                    &self.match_config,
                );
            } else {
                // Full recomputation needed
                let signatures: Vec<RouteSignature> = self.signatures.values().cloned().collect();
                self.groups = group_signatures_parallel(&signatures, &self.match_config);
            }
        }

        #[cfg(not(feature = "parallel"))]
        {
            // Non-parallel: always use full grouping (incremental requires rayon)
            let signatures: Vec<RouteSignature> = self.signatures.values().cloned().collect();
            self.groups = group_signatures(&signatures, &self.match_config);
        }

        // Clear new signatures tracker - they're now part of groups
        self.new_signatures.clear();

        // Populate sport_type and custom_name for each group
        for group in &mut self.groups {
            if let Some(activity) = self.activities.get(&group.representative_id) {
                group.sport_type = activity.sport_type.clone();
            }
            // Apply custom name if one exists
            if let Some(name) = self.route_names.get(&group.group_id) {
                group.custom_name = Some(name.clone());
            }
        }

        self.groups_dirty = false;
    }

    /// Get all route groups.
    pub fn get_groups(&mut self) -> &[RouteGroup] {
        self.ensure_groups();
        &self.groups
    }

    // ========================================================================
    // Route Names
    // ========================================================================

    /// Set a custom name for a route.
    /// Pass empty string to clear the custom name.
    pub fn set_route_name(&mut self, route_id: &str, name: &str) {
        if name.is_empty() {
            self.route_names.remove(route_id);
            // Update in-memory group
            if let Some(group) = self.groups.iter_mut().find(|g| g.group_id == route_id) {
                group.custom_name = None;
            }
        } else {
            self.route_names.insert(route_id.to_string(), name.to_string());
            // Update in-memory group
            if let Some(group) = self.groups.iter_mut().find(|g| g.group_id == route_id) {
                group.custom_name = Some(name.to_string());
            }
        }
    }

    /// Get the custom name for a route.
    /// Returns None if no custom name is set.
    pub fn get_route_name(&self, route_id: &str) -> Option<&String> {
        self.route_names.get(route_id)
    }

    /// Get the group containing a specific activity.
    pub fn get_group_for_activity(&mut self, activity_id: &str) -> Option<&RouteGroup> {
        self.ensure_groups();
        self.groups.iter().find(|g| g.activity_ids.contains(&activity_id.to_string()))
    }

    /// Get groups as JSON string (for efficient FFI).
    pub fn get_groups_json(&mut self) -> String {
        self.ensure_groups();
        serde_json::to_string(&self.groups).unwrap_or_else(|_| "[]".to_string())
    }

    // ========================================================================
    // Sections
    // ========================================================================

    /// Ensure sections are detected.
    fn ensure_sections(&mut self) {
        if !self.sections_dirty {
            return;
        }

        self.ensure_groups();

        // Build tracks from activities
        let tracks: Vec<(String, Vec<GpsPoint>)> = self.activities
            .values()
            .map(|a| (a.id.clone(), a.coords.clone()))
            .collect();

        // Build sport type map
        let sport_map: HashMap<String, String> = self.activities
            .values()
            .map(|a| (a.id.clone(), a.sport_type.clone()))
            .collect();

        self.sections = crate::sections::detect_sections_from_tracks(
            &tracks,
            &sport_map,
            &self.groups,
            &self.section_config,
        );

        self.sections_dirty = false;
    }

    /// Get all detected sections.
    pub fn get_sections(&mut self) -> &[FrequentSection] {
        self.ensure_sections();
        &self.sections
    }

    /// Get sections filtered by sport type.
    pub fn get_sections_for_sport(&mut self, sport_type: &str) -> Vec<&FrequentSection> {
        self.ensure_sections();
        self.sections
            .iter()
            .filter(|s| s.sport_type == sport_type)
            .collect()
    }

    /// Get sections as JSON string (for efficient FFI).
    pub fn get_sections_json(&mut self) -> String {
        self.ensure_sections();
        serde_json::to_string(&self.sections).unwrap_or_else(|_| "[]".to_string())
    }

    // ========================================================================
    // Spatial Queries
    // ========================================================================

    /// Ensure spatial index is built.
    fn ensure_spatial_index(&mut self) {
        if !self.spatial_dirty {
            return;
        }

        let bounds: Vec<ActivityBounds> = self.activities
            .values()
            .filter_map(|a| {
                a.bounds.map(|b| ActivityBounds {
                    activity_id: a.id.clone(),
                    min_lat: b.min_lat,
                    max_lat: b.max_lat,
                    min_lng: b.min_lng,
                    max_lng: b.max_lng,
                })
            })
            .collect();

        self.spatial_index = RTree::bulk_load(bounds);
        self.spatial_dirty = false;
    }

    /// Query activities within a viewport.
    pub fn query_viewport(&mut self, bounds: &Bounds) -> Vec<String> {
        self.ensure_spatial_index();

        let search_bounds = AABB::from_corners(
            [bounds.min_lng, bounds.min_lat],
            [bounds.max_lng, bounds.max_lat],
        );

        self.spatial_index
            .locate_in_envelope_intersecting(&search_bounds)
            .map(|b| b.activity_id.clone())
            .collect()
    }

    /// Query activities within a viewport (raw coordinates).
    pub fn query_viewport_raw(
        &mut self,
        min_lat: f64,
        max_lat: f64,
        min_lng: f64,
        max_lng: f64,
    ) -> Vec<String> {
        self.query_viewport(&Bounds { min_lat, max_lat, min_lng, max_lng })
    }

    /// Find activities near a point.
    pub fn find_nearby(&mut self, lat: f64, lng: f64, radius_degrees: f64) -> Vec<String> {
        self.query_viewport_raw(
            lat - radius_degrees,
            lat + radius_degrees,
            lng - radius_degrees,
            lng + radius_degrees,
        )
    }

    // ========================================================================
    // Consensus Route
    // ========================================================================

    /// Get or compute the consensus route for a group.
    ///
    /// The consensus route is the "average" path of all activities in the group.
    pub fn get_consensus_route(&mut self, group_id: &str) -> Option<Vec<GpsPoint>> {
        // Check cache first
        if let Some(cached) = self.consensus_cache.get(group_id) {
            return Some(cached.clone());
        }

        // Find the group
        self.ensure_groups();
        let group = self.groups.iter().find(|g| g.group_id == group_id)?;

        if group.activity_ids.is_empty() {
            return None;
        }

        // Get all tracks for this group
        let tracks: Vec<&Vec<GpsPoint>> = group.activity_ids
            .iter()
            .filter_map(|id| self.activities.get(id).map(|a| &a.coords))
            .collect();

        if tracks.is_empty() {
            return None;
        }

        // Simple consensus: use the medoid (track closest to all others)
        // This produces a smooth, real GPS trace rather than averaged points
        let consensus = self.compute_medoid_track(&tracks);

        // Cache the result
        self.consensus_cache.insert(group_id.to_string(), consensus.clone());

        Some(consensus)
    }

    /// Compute the medoid track (the track most representative of the group).
    fn compute_medoid_track(&self, tracks: &[&Vec<GpsPoint>]) -> Vec<GpsPoint> {
        if tracks.is_empty() {
            return vec![];
        }
        if tracks.len() == 1 {
            return tracks[0].clone();
        }

        // Find track with minimum total distance to all other tracks
        let mut best_idx = 0;
        let mut best_total_dist = f64::MAX;

        for (i, track_i) in tracks.iter().enumerate() {
            let total_dist: f64 = tracks.iter().enumerate()
                .filter(|(j, _)| *j != i)
                .map(|(_, track_j)| self.track_distance(track_i, track_j))
                .sum();

            if total_dist < best_total_dist {
                best_total_dist = total_dist;
                best_idx = i;
            }
        }

        tracks[best_idx].clone()
    }

    /// Compute distance between two tracks using AMD.
    fn track_distance(&self, track1: &[GpsPoint], track2: &[GpsPoint]) -> f64 {
        if track1.is_empty() || track2.is_empty() {
            return f64::MAX;
        }

        // Sample points for efficiency
        let sample_size = 20.min(track1.len().min(track2.len()));
        let step1 = track1.len() / sample_size;
        let step2 = track2.len() / sample_size;

        let sampled1: Vec<&GpsPoint> = (0..sample_size).map(|i| &track1[i * step1]).collect();
        let sampled2: Vec<&GpsPoint> = (0..sample_size).map(|i| &track2[i * step2]).collect();

        // Average minimum distance
        let amd: f64 = sampled1.iter()
            .map(|p1| {
                sampled2.iter()
                    .map(|p2| crate::geo_utils::haversine_distance(p1, p2))
                    .fold(f64::MAX, f64::min)
            })
            .sum::<f64>() / sample_size as f64;

        amd
    }

    // ========================================================================
    // Configuration
    // ========================================================================

    /// Update match configuration.
    ///
    /// This invalidates all computed state and requires full recomputation.
    pub fn set_match_config(&mut self, config: MatchConfig) {
        self.match_config = config;
        // Invalidate all computed state
        self.dirty_signatures = self.activities.keys().cloned().collect();
        self.new_signatures.clear();
        self.groups.clear();
        self.groups_dirty = true;
        self.sections_dirty = true;
    }

    /// Update section configuration.
    pub fn set_section_config(&mut self, config: SectionConfig) {
        self.section_config = config;
        self.sections_dirty = true;
    }

    /// Get current match configuration.
    pub fn get_match_config(&self) -> &MatchConfig {
        &self.match_config
    }

    /// Get current section configuration.
    pub fn get_section_config(&self) -> &SectionConfig {
        &self.section_config
    }

    // ========================================================================
    // Activity Bounds & Signatures Export
    // ========================================================================

    /// Get all activity bounds info for map display.
    /// Returns activity id, bounds, type, and distance.
    pub fn get_all_activity_bounds_info(&self) -> Vec<ActivityBoundsInfo> {
        self.activities
            .values()
            .filter_map(|activity| {
                let bounds = activity.bounds?;
                let distance = self.compute_track_distance(&activity.coords);
                Some(ActivityBoundsInfo {
                    id: activity.id.clone(),
                    bounds: [
                        [bounds.min_lat, bounds.min_lng],
                        [bounds.max_lat, bounds.max_lng],
                    ],
                    activity_type: activity.sport_type.clone(),
                    distance,
                })
            })
            .collect()
    }

    /// Get all activity bounds as JSON.
    pub fn get_all_activity_bounds_json(&self) -> String {
        let info = self.get_all_activity_bounds_info();
        serde_json::to_string(&info).unwrap_or_else(|_| "[]".to_string())
    }

    /// Get all signatures info for trace rendering.
    /// Returns activity_id -> {points, center}.
    pub fn get_all_signatures_info(&mut self) -> std::collections::HashMap<String, SignatureInfo> {
        self.ensure_signatures();
        self.signatures
            .iter()
            .map(|(id, sig)| {
                (
                    id.clone(),
                    SignatureInfo {
                        points: sig.points.clone(),
                        center: sig.center.clone(),
                    },
                )
            })
            .collect()
    }

    /// Get all signatures as JSON.
    pub fn get_all_signatures_json(&mut self) -> String {
        let info = self.get_all_signatures_info();
        serde_json::to_string(&info).unwrap_or_else(|_| "{}".to_string())
    }

    /// Compute total distance of a GPS track in meters.
    fn compute_track_distance(&self, coords: &[GpsPoint]) -> f64 {
        if coords.len() < 2 {
            return 0.0;
        }
        coords
            .windows(2)
            .map(|pair| crate::geo_utils::haversine_distance(&pair[0], &pair[1]))
            .sum()
    }

    // ========================================================================
    // Statistics
    // ========================================================================

    /// Get engine statistics.
    pub fn stats(&mut self) -> EngineStats {
        self.ensure_groups();
        self.ensure_sections();

        EngineStats {
            activity_count: self.activities.len() as u32,
            signature_count: self.signatures.len() as u32,
            group_count: self.groups.len() as u32,
            section_count: self.sections.len() as u32,
            cached_consensus_count: self.consensus_cache.len() as u32,
        }
    }
}

impl Default for RouteEngine {
    fn default() -> Self {
        Self::new()
    }
}

/// Engine statistics for monitoring.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct EngineStats {
    pub activity_count: u32,
    pub signature_count: u32,
    pub group_count: u32,
    pub section_count: u32,
    pub cached_consensus_count: u32,
}

/// Activity bounds info for map display
#[derive(Debug, Clone, serde::Serialize)]
pub struct ActivityBoundsInfo {
    pub id: String,
    pub bounds: [[f64; 2]; 2],  // [[minLat, minLng], [maxLat, maxLng]]
    pub activity_type: String,
    pub distance: f64,  // meters, computed from coords
}

/// Signature info for trace rendering
#[derive(Debug, Clone, serde::Serialize)]
pub struct SignatureInfo {
    pub points: Vec<GpsPoint>,
    pub center: GpsPoint,
}

// ============================================================================
// Global Singleton
// ============================================================================

/// Global engine instance.
///
/// This singleton allows FFI calls to access a shared engine without
/// passing state back and forth across the FFI boundary.
pub static ENGINE: Lazy<Mutex<RouteEngine>> = Lazy::new(|| {
    Mutex::new(RouteEngine::new())
});

/// Get a lock on the global engine.
pub fn with_engine<F, R>(f: F) -> R
where
    F: FnOnce(&mut RouteEngine) -> R,
{
    let mut engine = ENGINE.lock().unwrap();
    f(&mut engine)
}

// ============================================================================
// FFI Exports
// ============================================================================

#[cfg(feature = "ffi")]
pub mod engine_ffi {
    use super::*;
    use log::info;

    /// Initialize the engine (call once at app startup).
    #[uniffi::export]
    pub fn engine_init() {
        crate::init_logging();
        info!("[RouteEngine] Initialized");
    }

    /// Clear all engine state.
    #[uniffi::export]
    pub fn engine_clear() {
        with_engine(|e| e.clear());
        info!("[RouteEngine] Cleared");
    }

    /// Add activities from flat coordinate buffers.
    #[uniffi::export]
    pub fn engine_add_activities(
        activity_ids: Vec<String>,
        all_coords: Vec<f64>,
        offsets: Vec<u32>,
        sport_types: Vec<String>,
    ) {
        info!(
            "[RouteEngine] Adding {} activities ({} coords)",
            activity_ids.len(),
            all_coords.len() / 2
        );

        with_engine(|e| {
            e.add_activities_flat(&activity_ids, &all_coords, &offsets, &sport_types);
        });
    }

    /// Remove activities.
    #[uniffi::export]
    pub fn engine_remove_activities(activity_ids: Vec<String>) {
        info!("[RouteEngine] Removing {} activities", activity_ids.len());
        with_engine(|e| e.remove_activities(&activity_ids));
    }

    /// Get all activity IDs.
    #[uniffi::export]
    pub fn engine_get_activity_ids() -> Vec<String> {
        with_engine(|e| e.get_activity_ids())
    }

    /// Get activity count.
    #[uniffi::export]
    pub fn engine_get_activity_count() -> u32 {
        with_engine(|e| e.activity_count() as u32)
    }

    /// Get route groups as JSON.
    #[uniffi::export]
    pub fn engine_get_groups_json() -> String {
        with_engine(|e| e.get_groups_json())
    }

    /// Get sections as JSON.
    #[uniffi::export]
    pub fn engine_get_sections_json() -> String {
        with_engine(|e| e.get_sections_json())
    }

    /// Get signature points for all activities in a group.
    /// Returns JSON: { "activity_id": [{"latitude": x, "longitude": y}, ...], ... }
    #[uniffi::export]
    pub fn engine_get_signatures_for_group_json(group_id: String) -> String {
        with_engine(|e| e.get_signatures_for_group_json(&group_id))
    }

    /// Set a custom name for a route.
    /// Pass empty string to clear the custom name.
    #[uniffi::export]
    pub fn engine_set_route_name(route_id: String, name: String) {
        with_engine(|e| e.set_route_name(&route_id, &name))
    }

    /// Get the custom name for a route.
    /// Returns empty string if no custom name is set.
    #[uniffi::export]
    pub fn engine_get_route_name(route_id: String) -> String {
        with_engine(|e| e.get_route_name(&route_id).cloned().unwrap_or_default())
    }

    /// Query activities in viewport.
    #[uniffi::export]
    pub fn engine_query_viewport(
        min_lat: f64,
        max_lat: f64,
        min_lng: f64,
        max_lng: f64,
    ) -> Vec<String> {
        with_engine(|e| e.query_viewport_raw(min_lat, max_lat, min_lng, max_lng))
    }

    /// Find activities near a point.
    #[uniffi::export]
    pub fn engine_find_nearby(lat: f64, lng: f64, radius_degrees: f64) -> Vec<String> {
        with_engine(|e| e.find_nearby(lat, lng, radius_degrees))
    }

    /// Get consensus route for a group as flat coordinates.
    #[uniffi::export]
    pub fn engine_get_consensus_route(group_id: String) -> Vec<f64> {
        with_engine(|e| {
            e.get_consensus_route(&group_id)
                .map(|points| {
                    points.iter().flat_map(|p| vec![p.latitude, p.longitude]).collect()
                })
                .unwrap_or_default()
        })
    }

    /// Get engine statistics.
    #[uniffi::export]
    pub fn engine_get_stats() -> EngineStats {
        with_engine(|e| e.stats())
    }

    /// Set match configuration.
    #[uniffi::export]
    pub fn engine_set_match_config(config: crate::MatchConfig) {
        with_engine(|e| e.set_match_config(config));
    }

    /// Set section configuration.
    #[uniffi::export]
    pub fn engine_set_section_config(config: crate::SectionConfig) {
        with_engine(|e| e.set_section_config(config));
    }

    /// Get all activity bounds info as JSON for map display.
    /// Returns: [{"id": "...", "bounds": [[minLat, minLng], [maxLat, maxLng]], "activity_type": "...", "distance": ...}, ...]
    #[uniffi::export]
    pub fn engine_get_all_activity_bounds_json() -> String {
        with_engine(|e| e.get_all_activity_bounds_json())
    }

    /// Get all signatures as JSON for trace rendering.
    /// Returns: {"activity_id": {"points": [{latitude, longitude}, ...], "center": {latitude, longitude}}, ...}
    #[uniffi::export]
    pub fn engine_get_all_signatures_json() -> String {
        with_engine(|e| e.get_all_signatures_json())
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_coords() -> Vec<GpsPoint> {
        (0..10)
            .map(|i| GpsPoint::new(51.5074 + i as f64 * 0.001, -0.1278))
            .collect()
    }

    #[test]
    fn test_engine_add_activity() {
        let mut engine = RouteEngine::new();
        engine.add_activity("test-1".to_string(), sample_coords(), "cycling".to_string());

        assert_eq!(engine.activity_count(), 1);
        assert!(engine.has_activity("test-1"));
    }

    #[test]
    fn test_engine_add_flat() {
        let mut engine = RouteEngine::new();
        let flat_coords: Vec<f64> = sample_coords()
            .iter()
            .flat_map(|p| vec![p.latitude, p.longitude])
            .collect();

        engine.add_activity_flat("test-1".to_string(), &flat_coords, "cycling".to_string());

        assert_eq!(engine.activity_count(), 1);
    }

    #[test]
    fn test_engine_get_signature() {
        let mut engine = RouteEngine::new();
        engine.add_activity("test-1".to_string(), sample_coords(), "cycling".to_string());

        let sig = engine.get_signature("test-1");
        assert!(sig.is_some());
        assert_eq!(sig.unwrap().activity_id, "test-1");
    }

    #[test]
    fn test_engine_grouping() {
        let mut engine = RouteEngine::new();
        let coords = sample_coords();

        engine.add_activity("test-1".to_string(), coords.clone(), "cycling".to_string());
        engine.add_activity("test-2".to_string(), coords.clone(), "cycling".to_string());

        let groups = engine.get_groups();
        assert_eq!(groups.len(), 1); // Both should be in same group
        assert_eq!(groups[0].activity_ids.len(), 2);
    }

    #[test]
    fn test_engine_viewport_query() {
        let mut engine = RouteEngine::new();
        engine.add_activity("test-1".to_string(), sample_coords(), "cycling".to_string());

        // Query containing the activity
        let results = engine.query_viewport_raw(51.5, 51.52, -0.15, -0.10);
        assert_eq!(results.len(), 1);

        // Query not containing the activity
        let results = engine.query_viewport_raw(40.0, 41.0, -75.0, -74.0);
        assert!(results.is_empty());
    }

    #[test]
    fn test_engine_remove() {
        let mut engine = RouteEngine::new();
        engine.add_activity("test-1".to_string(), sample_coords(), "cycling".to_string());
        engine.add_activity("test-2".to_string(), sample_coords(), "cycling".to_string());

        engine.remove_activity("test-1");

        assert_eq!(engine.activity_count(), 1);
        assert!(!engine.has_activity("test-1"));
        assert!(engine.has_activity("test-2"));
    }

    #[test]
    fn test_engine_clear() {
        let mut engine = RouteEngine::new();
        engine.add_activity("test-1".to_string(), sample_coords(), "cycling".to_string());
        engine.clear();

        assert_eq!(engine.activity_count(), 0);
    }

    #[test]
    fn test_engine_incremental_grouping() {
        let mut engine = RouteEngine::new();
        let coords = sample_coords();

        // Add initial activities and trigger grouping
        engine.add_activity("test-1".to_string(), coords.clone(), "cycling".to_string());
        engine.add_activity("test-2".to_string(), coords.clone(), "cycling".to_string());

        // Trigger initial grouping
        let groups = engine.get_groups();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].activity_ids.len(), 2);

        // Add more activities (should use incremental grouping)
        engine.add_activity("test-3".to_string(), coords.clone(), "cycling".to_string());

        // Add a different route that shouldn't match
        let different_coords: Vec<GpsPoint> = (0..10)
            .map(|i| GpsPoint::new(40.7128 + i as f64 * 0.001, -74.0060))  // NYC instead of London
            .collect();
        engine.add_activity("test-4".to_string(), different_coords, "cycling".to_string());

        // Verify grouping results
        let groups = engine.get_groups();

        // Should have 2 groups: one with test-1,2,3 (similar routes) and one with test-4 (different location)
        assert_eq!(groups.len(), 2);

        // Find the group with more activities (the London routes)
        let large_group = groups.iter().find(|g| g.activity_ids.len() == 3);
        assert!(large_group.is_some(), "Should have a group with 3 activities");

        // Find the group with single activity (the NYC route)
        let small_group = groups.iter().find(|g| g.activity_ids.len() == 1);
        assert!(small_group.is_some(), "Should have a group with 1 activity");
        assert!(small_group.unwrap().activity_ids.contains(&"test-4".to_string()));
    }

    #[test]
    fn test_engine_new_signatures_tracking() {
        let mut engine = RouteEngine::new();
        let coords = sample_coords();

        // Add activity - should be tracked as new
        engine.add_activity("test-1".to_string(), coords.clone(), "cycling".to_string());
        assert!(engine.dirty_signatures.contains("test-1"));

        // Trigger signature computation
        let _sig = engine.get_signature("test-1");
        assert!(engine.dirty_signatures.is_empty());
        assert!(engine.new_signatures.contains("test-1"));

        // Trigger grouping - should clear new_signatures
        let _groups = engine.get_groups();
        assert!(engine.new_signatures.is_empty());
    }
}
