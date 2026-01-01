//! # Adaptive Consensus Section Detection
//!
//! Detects frequently-traveled road sections using FULL GPS tracks.
//! Produces smooth, natural polylines that evolve and refine over time
//! as more tracks are observed.
//!
//! ## Algorithm
//! 1. Load full GPS tracks (1000s of points per activity)
//! 2. Find overlapping portions using R-tree spatial indexing
//! 3. Cluster overlaps that represent the same physical section
//! 4. Select initial medoid as the starting reference
//! 5. Compute consensus polyline via weighted averaging of all tracks
//! 6. Track per-point confidence based on observation density
//! 7. Adapt section boundaries based on where tracks consistently overlap
//!
//! ## Consensus Algorithm
//! - Normalize all tracks to common parameterization (by distance)
//! - At each position, collect nearby points from all tracks
//! - Compute weighted average: weight = 1 / (distance_to_reference + epsilon)
//! - Higher observation density → higher confidence → tighter future matching
//!
//! ## Adaptive Boundaries
//! - Track where each activity's overlap starts/ends relative to section
//! - Section can grow if tracks consistently extend beyond current bounds
//! - Section contracts if tracks consistently end before current bounds

mod rtree;
mod overlap;
mod medoid;
mod consensus;
mod postprocess;
mod traces;
mod portions;

use std::collections::{HashMap, HashSet};
use serde::{Deserialize, Serialize};
use crate::{GpsPoint, RouteGroup};
use crate::geo_utils::polyline_length;
#[cfg(feature = "parallel")]
use rayon::prelude::*;
use log::info;

// Re-export internal utilities for use across submodules
pub(crate) use rtree::{IndexedPoint, build_rtree, bounds_overlap_tracks};
pub(crate) use overlap::{FullTrackOverlap, OverlapCluster, find_full_track_overlap, cluster_overlaps};
pub(crate) use medoid::select_medoid;
pub(crate) use consensus::compute_consensus_polyline;
pub(crate) use postprocess::{split_folding_sections, merge_nearby_sections, remove_overlapping_sections, split_high_variance_sections};
pub(crate) use traces::extract_all_activity_traces;
pub(crate) use portions::compute_activity_portions;

/// Scale preset for multi-scale section detection
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct ScalePreset {
    /// Scale name: "short", "medium", "long"
    pub name: String,
    /// Minimum section length for this scale (meters)
    pub min_length: f64,
    /// Maximum section length for this scale (meters)
    pub max_length: f64,
    /// Minimum activities required at this scale (can be lower for short sections)
    pub min_activities: u32,
}

impl ScalePreset {
    pub fn short() -> Self {
        Self {
            name: "short".to_string(),
            min_length: 100.0,
            max_length: 500.0,
            min_activities: 2,
        }
    }

    pub fn medium() -> Self {
        Self {
            name: "medium".to_string(),
            min_length: 500.0,
            max_length: 2000.0,
            min_activities: 2,
        }
    }

    pub fn long() -> Self {
        Self {
            name: "long".to_string(),
            min_length: 2000.0,
            max_length: 5000.0,
            min_activities: 3,
        }
    }

    pub fn default_presets() -> Vec<Self> {
        vec![Self::short(), Self::medium(), Self::long()]
    }
}

/// Configuration for section detection
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct SectionConfig {
    /// Maximum distance between tracks to consider overlapping (meters)
    pub proximity_threshold: f64,
    /// Minimum overlap length to consider a section (meters)
    pub min_section_length: f64,
    /// Maximum section length (meters) - prevents sections from becoming full routes
    pub max_section_length: f64,
    /// Minimum number of activities that must share an overlap
    pub min_activities: u32,
    /// Tolerance for clustering similar overlaps (meters)
    pub cluster_tolerance: f64,
    /// Number of sample points for AMD comparison (not for output!)
    pub sample_points: u32,
    /// Detection mode: "discovery" (lower thresholds) or "conservative"
    pub detection_mode: String,
    /// Include potential sections with only 1-2 activities as suggestions
    pub include_potentials: bool,
    /// Scale presets for multi-scale detection (empty = single-scale with min/max_section_length)
    pub scale_presets: Vec<ScalePreset>,
    /// Preserve hierarchical sections (don't deduplicate short sections inside longer ones)
    pub preserve_hierarchy: bool,
}

impl Default for SectionConfig {
    fn default() -> Self {
        Self {
            proximity_threshold: 50.0,   // 50m - handles GPS error + wide roads + opposite sides
            min_section_length: 200.0,   // 200m minimum section (used when scale_presets is empty)
            max_section_length: 5000.0,  // 5km max (used when scale_presets is empty)
            min_activities: 3,           // Need 3+ activities (used when scale_presets is empty)
            cluster_tolerance: 80.0,     // 80m for clustering similar overlaps
            sample_points: 50,           // For AMD comparison only
            detection_mode: "discovery".to_string(),
            include_potentials: true,
            scale_presets: ScalePreset::default_presets(),
            preserve_hierarchy: true,
        }
    }
}

impl SectionConfig {
    /// Create a discovery-mode config (lower thresholds, more sections)
    pub fn discovery() -> Self {
        Self {
            detection_mode: "discovery".to_string(),
            include_potentials: true,
            scale_presets: ScalePreset::default_presets(),
            preserve_hierarchy: true,
            ..Default::default()
        }
    }

    /// Create a conservative config (higher thresholds, fewer sections)
    pub fn conservative() -> Self {
        Self {
            detection_mode: "conservative".to_string(),
            include_potentials: false,
            min_activities: 4,
            scale_presets: vec![ScalePreset::medium(), ScalePreset::long()],
            preserve_hierarchy: false,
            ..Default::default()
        }
    }

    /// Create a legacy single-scale config (for backward compatibility)
    pub fn legacy() -> Self {
        Self {
            detection_mode: "legacy".to_string(),
            include_potentials: false,
            scale_presets: vec![],  // Empty = use min/max_section_length directly
            preserve_hierarchy: false,
            min_activities: 3,
            ..Default::default()
        }
    }
}

/// Each activity's portion of a section (for pace comparison)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct SectionPortion {
    /// Activity ID
    pub activity_id: String,
    /// Start index into the activity's FULL GPS track
    pub start_index: u32,
    /// End index into the activity's FULL GPS track
    pub end_index: u32,
    /// Distance of this portion in meters
    pub distance_meters: f64,
    /// Direction relative to representative: "same" or "reverse"
    pub direction: String,
}

/// A frequently-traveled section with adaptive consensus representation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct FrequentSection {
    /// Unique section ID
    pub id: String,
    /// Custom name (user-defined, None if not set)
    pub name: Option<String>,
    /// Sport type ("Run", "Ride", etc.)
    pub sport_type: String,
    /// The consensus polyline - refined from all overlapping tracks
    /// Initially the medoid, evolves via weighted averaging as more tracks are added
    pub polyline: Vec<GpsPoint>,
    /// Which activity provided the initial representative polyline (medoid)
    pub representative_activity_id: String,
    /// All activity IDs that traverse this section
    pub activity_ids: Vec<String>,
    /// Each activity's portion (start/end indices, distance, direction)
    pub activity_portions: Vec<SectionPortion>,
    /// Route group IDs that include this section
    pub route_ids: Vec<String>,
    /// Number of times traversed
    pub visit_count: u32,
    /// Section length in meters
    pub distance_meters: f64,
    /// Pre-computed GPS traces for each activity's overlapping portion
    /// Key is activity ID, value is the GPS points within proximity of section
    pub activity_traces: HashMap<String, Vec<GpsPoint>>,
    /// Confidence score (0.0-1.0) based on observation density
    /// Higher confidence = more tracks observed, tighter consensus
    pub confidence: f64,
    /// Number of observations (tracks) used to compute consensus
    pub observation_count: u32,
    /// Average spread (meters) of track observations from consensus line
    /// Lower spread = more consistent track alignment
    pub average_spread: f64,
    /// Per-point observation density (how many activities pass through each point)
    /// Used for detecting high-traffic portions that should become separate sections
    pub point_density: Vec<u32>,
    /// Scale at which this section was detected: "short", "medium", "long", or "legacy"
    pub scale: Option<String>,
}

/// A potential section detected from 1-2 activities.
/// These are suggestions that users can promote to full sections.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct PotentialSection {
    /// Unique section ID
    pub id: String,
    /// Sport type ("Run", "Ride", etc.)
    pub sport_type: String,
    /// The polyline from the representative activity
    pub polyline: Vec<GpsPoint>,
    /// Activity IDs that traverse this potential section (1-2)
    pub activity_ids: Vec<String>,
    /// Number of times traversed (1-2)
    pub visit_count: u32,
    /// Section length in meters
    pub distance_meters: f64,
    /// Confidence score (0.0-1.0), lower than FrequentSection
    pub confidence: f64,
    /// Scale at which this was detected
    pub scale: String,
}

/// Result of multi-scale section detection
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct MultiScaleSectionResult {
    /// Confirmed sections (min_activities met)
    pub sections: Vec<FrequentSection>,
    /// Potential sections (1-2 activities, suggestions for user)
    pub potentials: Vec<PotentialSection>,
    /// Statistics about detection
    pub stats: DetectionStats,
}

/// Statistics from section detection
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct DetectionStats {
    /// Total activities processed
    pub activities_processed: u32,
    /// Total overlaps found across all scales
    pub overlaps_found: u32,
    /// Sections per scale
    pub sections_by_scale: HashMap<String, u32>,
    /// Potentials per scale
    pub potentials_by_scale: HashMap<String, u32>,
}

/// Process a single cluster into a FrequentSection.
fn process_cluster(
    idx: usize,
    cluster: OverlapCluster,
    sport_type: &str,
    track_map: &HashMap<String, Vec<GpsPoint>>,
    activity_to_route: &HashMap<&str, &str>,
    config: &SectionConfig,
    scale_name: Option<&str>,
) -> Option<FrequentSection> {
    // Select medoid - an ACTUAL GPS trace
    let (representative_id, representative_polyline) = select_medoid(&cluster);

    if representative_polyline.is_empty() {
        return None;
    }

    let distance_meters = polyline_length(&representative_polyline);

    // Filter by max length - sections shouldn't be whole routes
    if distance_meters > config.max_section_length {
        return None;
    }

    // Compute activity portions for pace comparison
    let activity_portions = compute_activity_portions(
        &cluster,
        &representative_polyline,
        track_map,
        config,
    );

    // Collect route IDs
    let route_ids: Vec<String> = cluster.activity_ids
        .iter()
        .filter_map(|aid| activity_to_route.get(aid.as_str()).map(|s| s.to_string()))
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();

    // Pre-compute activity traces
    let activity_id_vec: Vec<String> = cluster.activity_ids.iter().cloned().collect();
    let activity_traces = extract_all_activity_traces(
        &activity_id_vec,
        &representative_polyline,
        track_map,
    );

    // Collect all traces for consensus computation
    let all_traces: Vec<Vec<GpsPoint>> = activity_traces.values().cloned().collect();

    // Compute consensus polyline from all overlapping tracks
    let consensus = compute_consensus_polyline(
        &representative_polyline,
        &all_traces,
        config.proximity_threshold,
    );

    // Use consensus polyline and update distance
    let consensus_distance = polyline_length(&consensus.polyline);

    Some(FrequentSection {
        id: format!("sec_{}_{}", sport_type.to_lowercase(), idx),
        name: None,
        sport_type: sport_type.to_string(),
        polyline: consensus.polyline,
        representative_activity_id: representative_id,
        activity_ids: cluster.activity_ids.into_iter().collect(),
        activity_portions,
        route_ids,
        visit_count: cluster.overlaps.len() as u32 + 1,
        distance_meters: consensus_distance,
        activity_traces,
        confidence: consensus.confidence,
        observation_count: consensus.observation_count,
        average_spread: consensus.average_spread,
        point_density: consensus.point_density,
        scale: scale_name.map(|s| s.to_string()),
    })
}

/// Detect frequent sections from FULL GPS tracks.
/// This is the main entry point for section detection.
pub fn detect_sections_from_tracks(
    tracks: &[(String, Vec<GpsPoint>)],  // (activity_id, full_gps_points)
    sport_types: &HashMap<String, String>,
    groups: &[RouteGroup],
    config: &SectionConfig,
) -> Vec<FrequentSection> {
    info!(
        "[Sections] Detecting from {} full GPS tracks",
        tracks.len()
    );

    if tracks.len() < config.min_activities as usize {
        return vec![];
    }

    // Filter to only groups with 2+ activities (these are the ones shown in Routes list)
    let significant_groups: Vec<&RouteGroup> = groups
        .iter()
        .filter(|g| g.activity_ids.len() >= 2)
        .collect();

    // Build activity_id -> route_id mapping (only for significant groups)
    let activity_to_route: HashMap<&str, &str> = significant_groups
        .iter()
        .flat_map(|g| g.activity_ids.iter().map(|aid| (aid.as_str(), g.group_id.as_str())))
        .collect();

    // Debug: log the groups we received
    info!(
        "[Sections] Received {} groups, {} with 2+ activities, {} total activity mappings",
        groups.len(),
        significant_groups.len(),
        activity_to_route.len()
    );

    // Build track lookup
    let track_map: HashMap<String, Vec<GpsPoint>> = tracks
        .iter()
        .map(|(id, pts)| (id.clone(), pts.clone()))
        .collect();

    // Group tracks by sport type
    let mut tracks_by_sport: HashMap<String, Vec<(&str, &[GpsPoint])>> = HashMap::new();
    for (activity_id, points) in tracks {
        let sport = sport_types
            .get(activity_id)
            .cloned()
            .unwrap_or_else(|| "Unknown".to_string());
        tracks_by_sport
            .entry(sport)
            .or_default()
            .push((activity_id.as_str(), points.as_slice()));
    }

    let mut all_sections: Vec<FrequentSection> = Vec::new();
    let mut section_counter = 0;

    // Process each sport type
    for (sport_type, sport_tracks) in &tracks_by_sport {
        if sport_tracks.len() < config.min_activities as usize {
            continue;
        }

        info!(
            "[Sections] Processing {} {} tracks",
            sport_tracks.len(),
            sport_type
        );

        // Build R-trees for all tracks
        let rtree_start = std::time::Instant::now();
        let rtrees: Vec<rstar::RTree<IndexedPoint>> = sport_tracks
            .iter()
            .map(|(_, pts)| build_rtree(pts))
            .collect();
        info!("[Sections] Built {} R-trees in {}ms", rtrees.len(), rtree_start.elapsed().as_millis());

        // Find pairwise overlaps - PARALLELIZED with rayon
        let overlap_start = std::time::Instant::now();

        // Generate all pairs
        let pairs: Vec<(usize, usize)> = (0..sport_tracks.len())
            .flat_map(|i| ((i + 1)..sport_tracks.len()).map(move |j| (i, j)))
            .collect();

        let total_pairs = pairs.len();

        // Process pairs (parallel if feature enabled)
        #[cfg(feature = "parallel")]
        let overlaps: Vec<FullTrackOverlap> = pairs
            .into_par_iter()
            .filter_map(|(i, j)| {
                let (id_a, track_a) = sport_tracks[i];
                let (id_b, track_b) = sport_tracks[j];

                // Quick bounding box check
                if !bounds_overlap_tracks(track_a, track_b, config.proximity_threshold) {
                    return None;
                }

                // Find overlap using R-tree
                find_full_track_overlap(
                    id_a, track_a,
                    id_b, track_b,
                    &rtrees[j],
                    config,
                )
            })
            .collect();

        #[cfg(not(feature = "parallel"))]
        let overlaps: Vec<FullTrackOverlap> = pairs
            .into_iter()
            .filter_map(|(i, j)| {
                let (id_a, track_a) = sport_tracks[i];
                let (id_b, track_b) = sport_tracks[j];

                // Quick bounding box check
                if !bounds_overlap_tracks(track_a, track_b, config.proximity_threshold) {
                    return None;
                }

                // Find overlap using R-tree
                find_full_track_overlap(
                    id_a, track_a,
                    id_b, track_b,
                    &rtrees[j],
                    config,
                )
            })
            .collect();

        info!(
            "[Sections] Found {} pairwise overlaps for {} ({} pairs) in {}ms",
            overlaps.len(),
            sport_type,
            total_pairs,
            overlap_start.elapsed().as_millis()
        );

        // Cluster overlaps
        let cluster_start = std::time::Instant::now();
        let clusters = cluster_overlaps(overlaps, config);

        // Filter to clusters with enough activities
        let significant_clusters: Vec<_> = clusters
            .into_iter()
            .filter(|c| c.activity_ids.len() >= config.min_activities as usize)
            .collect();

        info!(
            "[Sections] {} significant clusters ({}+ activities) for {} in {}ms",
            significant_clusters.len(),
            config.min_activities,
            sport_type,
            cluster_start.elapsed().as_millis()
        );

        // Convert clusters to sections - PARALLELIZED with rayon
        let section_convert_start = std::time::Instant::now();

        // Prepare data for parallel processing
        let cluster_data: Vec<_> = significant_clusters
            .into_iter()
            .enumerate()
            .collect();

        // Process clusters (parallel if feature enabled)
        #[cfg(feature = "parallel")]
        let sport_sections: Vec<FrequentSection> = cluster_data
            .into_par_iter()
            .filter_map(|(idx, cluster)| {
                process_cluster(idx, cluster, sport_type, &track_map, &activity_to_route, config, None)
            })
            .collect();

        #[cfg(not(feature = "parallel"))]
        let sport_sections: Vec<FrequentSection> = cluster_data
            .into_iter()
            .filter_map(|(idx, cluster)| {
                process_cluster(idx, cluster, sport_type, &track_map, &activity_to_route, config, None)
            })
            .collect();

        info!(
            "[Sections] Converted {} sections for {} in {}ms",
            sport_sections.len(),
            sport_type,
            section_convert_start.elapsed().as_millis()
        );

        // Post-process step 1: Split sections that fold back on themselves (out-and-back)
        let fold_start = std::time::Instant::now();
        let split_sections = split_folding_sections(sport_sections, config);
        info!(
            "[Sections] After fold splitting: {} sections in {}ms",
            split_sections.len(),
            fold_start.elapsed().as_millis()
        );

        // Post-process step 2: Merge sections that are nearby (reversed, parallel, GPS drift)
        let merge_start = std::time::Instant::now();
        let merged_sections = merge_nearby_sections(split_sections, config);
        info!(
            "[Sections] After nearby merge: {} sections in {}ms",
            merged_sections.len(),
            merge_start.elapsed().as_millis()
        );

        // Post-process step 3: Remove sections that contain or are contained by others
        let dedup_start = std::time::Instant::now();
        let deduped_sections = remove_overlapping_sections(merged_sections, config);
        info!(
            "[Sections] After dedup: {} unique sections in {}ms",
            deduped_sections.len(),
            dedup_start.elapsed().as_millis()
        );

        // Post-process step 4: Split sections with high-traffic portions
        // This creates new sections from portions that are used by many activities
        let split_start = std::time::Instant::now();
        let final_sections = split_high_variance_sections(deduped_sections, &track_map, config);
        info!(
            "[Sections] After density splitting: {} sections in {}ms",
            final_sections.len(),
            split_start.elapsed().as_millis()
        );

        // Re-number sections
        for (i, mut section) in final_sections.into_iter().enumerate() {
            section.id = format!("sec_{}_{}", sport_type.to_lowercase(), section_counter + i);
            all_sections.push(section);
        }
        section_counter += all_sections.len();
    }

    // Sort by visit count (most visited first)
    all_sections.sort_by(|a, b| b.visit_count.cmp(&a.visit_count));

    info!(
        "[Sections] Detected {} total sections",
        all_sections.len()
    );

    all_sections
}

/// Detect sections at multiple scales with support for potential sections.
/// This is the new flagship entry point for section detection.
pub fn detect_sections_multiscale(
    tracks: &[(String, Vec<GpsPoint>)],
    sport_types: &HashMap<String, String>,
    groups: &[RouteGroup],
    config: &SectionConfig,
) -> MultiScaleSectionResult {
    info!(
        "[MultiScale] Detecting from {} tracks with {} scale presets",
        tracks.len(),
        config.scale_presets.len()
    );

    let mut all_sections: Vec<FrequentSection> = Vec::new();
    let mut all_potentials: Vec<PotentialSection> = Vec::new();
    let mut stats = DetectionStats {
        activities_processed: tracks.len() as u32,
        overlaps_found: 0,
        sections_by_scale: HashMap::new(),
        potentials_by_scale: HashMap::new(),
    };

    // If no scale presets, fall back to legacy single-scale detection
    if config.scale_presets.is_empty() {
        let sections = detect_sections_from_tracks(tracks, sport_types, groups, config);
        stats.sections_by_scale.insert("legacy".to_string(), sections.len() as u32);
        return MultiScaleSectionResult {
            sections,
            potentials: vec![],
            stats,
        };
    }

    // Build shared data structures once
    let track_map: HashMap<String, Vec<GpsPoint>> = tracks
        .iter()
        .map(|(id, pts)| (id.clone(), pts.clone()))
        .collect();

    let significant_groups: Vec<&RouteGroup> = groups
        .iter()
        .filter(|g| g.activity_ids.len() >= 2)
        .collect();

    let activity_to_route: HashMap<&str, &str> = significant_groups
        .iter()
        .flat_map(|g| g.activity_ids.iter().map(|aid| (aid.as_str(), g.group_id.as_str())))
        .collect();

    // Group tracks by sport type
    let mut tracks_by_sport: HashMap<String, Vec<(&str, &[GpsPoint])>> = HashMap::new();
    for (activity_id, points) in tracks {
        let sport = sport_types
            .get(activity_id)
            .cloned()
            .unwrap_or_else(|| "Unknown".to_string());
        tracks_by_sport
            .entry(sport)
            .or_default()
            .push((activity_id.as_str(), points.as_slice()));
    }

    // Process each scale preset
    for preset in &config.scale_presets {
        info!(
            "[MultiScale] Processing {} scale: {}-{}m, min {} activities",
            preset.name, preset.min_length, preset.max_length, preset.min_activities
        );

        let scale_config = SectionConfig {
            min_section_length: preset.min_length,
            max_section_length: preset.max_length,
            min_activities: preset.min_activities,
            ..config.clone()
        };

        let mut scale_sections = 0u32;
        let mut scale_potentials = 0u32;

        // Process each sport type
        for (sport_type, sport_tracks) in &tracks_by_sport {
            // For potentials, we only need 1 activity; for sections, use preset.min_activities
            let min_tracks_for_processing = if config.include_potentials { 1 } else { preset.min_activities as usize };
            if sport_tracks.len() < min_tracks_for_processing {
                continue;
            }

            // Build R-trees
            let rtrees: Vec<rstar::RTree<IndexedPoint>> = sport_tracks
                .iter()
                .map(|(_, pts)| build_rtree(pts))
                .collect();

            // Generate pairs and find overlaps
            let pairs: Vec<(usize, usize)> = (0..sport_tracks.len())
                .flat_map(|i| ((i + 1)..sport_tracks.len()).map(move |j| (i, j)))
                .collect();

            #[cfg(feature = "parallel")]
            let overlaps: Vec<FullTrackOverlap> = pairs
                .into_par_iter()
                .filter_map(|(i, j)| {
                    let (id_a, track_a) = sport_tracks[i];
                    let (id_b, track_b) = sport_tracks[j];
                    if !bounds_overlap_tracks(track_a, track_b, scale_config.proximity_threshold) {
                        return None;
                    }
                    find_full_track_overlap(id_a, track_a, id_b, track_b, &rtrees[j], &scale_config)
                })
                .collect();

            #[cfg(not(feature = "parallel"))]
            let overlaps: Vec<FullTrackOverlap> = pairs
                .into_iter()
                .filter_map(|(i, j)| {
                    let (id_a, track_a) = sport_tracks[i];
                    let (id_b, track_b) = sport_tracks[j];
                    if !bounds_overlap_tracks(track_a, track_b, scale_config.proximity_threshold) {
                        return None;
                    }
                    find_full_track_overlap(id_a, track_a, id_b, track_b, &rtrees[j], &scale_config)
                })
                .collect();

            stats.overlaps_found += overlaps.len() as u32;

            // Cluster overlaps
            let clusters = cluster_overlaps(overlaps, &scale_config);

            // Separate into confirmed sections and potential sections
            let (significant, potential): (Vec<_>, Vec<_>) = clusters
                .into_iter()
                .partition(|c| c.activity_ids.len() >= preset.min_activities as usize);

            // Process confirmed sections
            #[cfg(feature = "parallel")]
            let sport_sections: Vec<FrequentSection> = significant
                .into_par_iter()
                .enumerate()
                .filter_map(|(idx, cluster)| {
                    process_cluster(idx, cluster, sport_type, &track_map, &activity_to_route, &scale_config, Some(&preset.name))
                })
                .collect();

            #[cfg(not(feature = "parallel"))]
            let sport_sections: Vec<FrequentSection> = significant
                .into_iter()
                .enumerate()
                .filter_map(|(idx, cluster)| {
                    process_cluster(idx, cluster, sport_type, &track_map, &activity_to_route, &scale_config, Some(&preset.name))
                })
                .collect();

            scale_sections += sport_sections.len() as u32;
            all_sections.extend(sport_sections);

            // Process potential sections if enabled
            if config.include_potentials {
                for (idx, cluster) in potential.into_iter().enumerate() {
                    // Only include clusters with 1-2 activities
                    let activity_count = cluster.activity_ids.len();
                    if activity_count >= 1 && activity_count < preset.min_activities as usize {
                        if let Some((_rep_id, rep_polyline)) = Some(select_medoid(&cluster)) {
                            if !rep_polyline.is_empty() {
                                let distance = polyline_length(&rep_polyline);
                                if distance >= preset.min_length && distance <= preset.max_length {
                                    all_potentials.push(PotentialSection {
                                        id: format!("pot_{}_{}_{}", preset.name, sport_type.to_lowercase(), idx),
                                        sport_type: sport_type.to_string(),
                                        polyline: rep_polyline,
                                        activity_ids: cluster.activity_ids.into_iter().collect(),
                                        visit_count: activity_count as u32,
                                        distance_meters: distance,
                                        confidence: 0.3 + (activity_count as f64 * 0.2), // 0.5 for 1, 0.7 for 2
                                        scale: preset.name.clone(),
                                    });
                                    scale_potentials += 1;
                                }
                            }
                        }
                    }
                }
            }
        }

        stats.sections_by_scale.insert(preset.name.clone(), scale_sections);
        stats.potentials_by_scale.insert(preset.name.clone(), scale_potentials);

        info!(
            "[MultiScale] {} scale: {} sections, {} potentials",
            preset.name, scale_sections, scale_potentials
        );
    }

    // Apply post-processing
    let fold_start = std::time::Instant::now();
    let split_sections = split_folding_sections(all_sections, config);
    info!("[MultiScale] After fold splitting: {} sections in {}ms", split_sections.len(), fold_start.elapsed().as_millis());

    let merge_start = std::time::Instant::now();
    let merged_sections = merge_nearby_sections(split_sections, config);
    info!("[MultiScale] After nearby merge: {} sections in {}ms", merged_sections.len(), merge_start.elapsed().as_millis());

    // Use hierarchical deduplication if preserve_hierarchy is true
    let dedup_start = std::time::Instant::now();
    let deduped_sections = if config.preserve_hierarchy {
        remove_overlapping_sections_hierarchical(merged_sections, config)
    } else {
        remove_overlapping_sections(merged_sections, config)
    };
    info!("[MultiScale] After dedup: {} sections in {}ms", deduped_sections.len(), dedup_start.elapsed().as_millis());

    let split_start = std::time::Instant::now();
    let final_sections = split_high_variance_sections(deduped_sections, &track_map, config);
    info!("[MultiScale] After density splitting: {} sections in {}ms", final_sections.len(), split_start.elapsed().as_millis());

    // Sort sections by visit count
    let mut sorted_sections = final_sections;
    sorted_sections.sort_by(|a, b| b.visit_count.cmp(&a.visit_count));

    // Sort potentials by confidence
    let mut sorted_potentials = all_potentials;
    sorted_potentials.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap_or(std::cmp::Ordering::Equal));

    info!(
        "[MultiScale] Final: {} sections, {} potentials",
        sorted_sections.len(),
        sorted_potentials.len()
    );

    MultiScaleSectionResult {
        sections: sorted_sections,
        potentials: sorted_potentials,
        stats,
    }
}

/// Deduplication that preserves hierarchical sections.
/// Short sections inside longer ones are kept if they're at different scales.
fn remove_overlapping_sections_hierarchical(
    mut sections: Vec<FrequentSection>,
    config: &SectionConfig,
) -> Vec<FrequentSection> {
    if sections.len() <= 1 {
        return sections;
    }

    // Sort by length descending
    sections.sort_by(|a, b| b.distance_meters.partial_cmp(&a.distance_meters).unwrap_or(std::cmp::Ordering::Equal));

    let mut keep = vec![true; sections.len()];

    for i in 0..sections.len() {
        if !keep[i] {
            continue;
        }

        for j in (i + 1)..sections.len() {
            if !keep[j] {
                continue;
            }

            // Check if shorter section (j) is contained in longer section (i)
            let containment = compute_polyline_containment(
                &sections[j].polyline,
                &sections[i].polyline,
                config.proximity_threshold,
            );

            // Length ratio
            let length_ratio = sections[j].distance_meters / sections[i].distance_meters;

            // Only remove if:
            // 1. >90% contained
            // 2. Same length class (ratio > 0.7) - meaning it's a true duplicate, not hierarchical
            // 3. Same scale OR no scale info
            let same_scale = match (&sections[i].scale, &sections[j].scale) {
                (Some(a), Some(b)) => a == b,
                _ => true, // If either has no scale, treat as same
            };

            if containment > 0.9 && length_ratio > 0.7 && same_scale {
                keep[j] = false;
            }
        }
    }

    sections
        .into_iter()
        .zip(keep)
        .filter_map(|(s, k)| if k { Some(s) } else { None })
        .collect()
}

/// Compute what fraction of polyline A is contained within proximity of polyline B
fn compute_polyline_containment(
    polyline_a: &[GpsPoint],
    polyline_b: &[GpsPoint],
    proximity_threshold: f64,
) -> f64 {
    use crate::geo_utils::haversine_distance;

    if polyline_a.is_empty() || polyline_b.is_empty() {
        return 0.0;
    }

    let mut contained_count = 0;
    for point_a in polyline_a {
        let min_dist = polyline_b
            .iter()
            .map(|point_b| haversine_distance(point_a, point_b))
            .fold(f64::MAX, |a, b| a.min(b));

        if min_dist <= proximity_threshold {
            contained_count += 1;
        }
    }

    contained_count as f64 / polyline_a.len() as f64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geo_utils::{haversine_distance, compute_center};
    use medoid::resample_by_distance;

    fn make_point(lat: f64, lng: f64) -> GpsPoint {
        GpsPoint::new(lat, lng)
    }

    #[test]
    fn test_haversine_distance() {
        let p1 = make_point(51.5074, -0.1278); // London
        let p2 = make_point(48.8566, 2.3522);   // Paris
        let dist = haversine_distance(&p1, &p2);
        // London to Paris is about 344 km
        assert!(dist > 340_000.0 && dist < 350_000.0);
    }

    #[test]
    fn test_compute_center() {
        let points = vec![
            make_point(0.0, 0.0),
            make_point(2.0, 2.0),
        ];
        let center = compute_center(&points);
        assert!((center.latitude - 1.0).abs() < 0.001);
        assert!((center.longitude - 1.0).abs() < 0.001);
    }

    #[test]
    fn test_resample_by_distance() {
        let points = vec![
            make_point(0.0, 0.0),
            make_point(0.001, 0.0),
            make_point(0.002, 0.0),
        ];
        let resampled = resample_by_distance(&points, 5);
        assert_eq!(resampled.len(), 5);
    }
}
