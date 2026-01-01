//! Post-processing for sections: folding detection, merging, deduplication, and density-based splitting.
//!
//! Based on concepts from:
//! - TRACLUS: "Trajectory Clustering: A Partition-and-Group Framework" (Lee, Han, Whang 2007)
//!   https://hanj.cs.illinois.edu/pdf/sigmod07_jglee.pdf
//! - GPS Segment Averaging (MDPI 2019)
//!   https://mdpi.com/2076-3417/9/22/4899/htm

use std::collections::HashMap;
use rstar::{RTree, PointDistance};
use log::info;
use crate::GpsPoint;
use crate::geo_utils::polyline_length;
use super::rtree::{IndexedPoint, build_rtree};
use super::{SectionConfig, FrequentSection};

// =============================================================================
// Self-Folding Section Detection
// =============================================================================

/// Detect if a polyline folds back on itself (out-and-back pattern).
/// Returns the index of the fold point if found, or None if no fold.
fn detect_fold_point(polyline: &[GpsPoint], threshold: f64) -> Option<usize> {
    if polyline.len() < 10 {
        return None;
    }

    let threshold_deg = threshold / 111_000.0;
    let threshold_deg_sq = threshold_deg * threshold_deg;

    // Build R-tree of the first half of the polyline
    let half = polyline.len() / 2;
    let first_half_tree = build_rtree(&polyline[..half]);

    // Check each point in the second half against the first half
    // Looking for where the track returns close to earlier points
    let mut fold_candidates: Vec<(usize, f64)> = Vec::new();

    for (i, point) in polyline[half..].iter().enumerate() {
        let idx = half + i;
        let query = [point.latitude, point.longitude];

        if let Some(nearest) = first_half_tree.nearest_neighbor(&query) {
            let dist_sq = nearest.distance_2(&query);
            if dist_sq <= threshold_deg_sq {
                // This point is close to an earlier point - potential fold
                // Track the earliest point where this happens
                fold_candidates.push((idx, dist_sq));
            }
        }
    }

    // Find the first substantial fold (where a sequence of points return)
    // We want the point where the track genuinely turns back, not random noise
    if fold_candidates.len() >= 3 {
        // The fold point is approximately where the return starts
        // Use the first candidate that has at least 2 more following candidates
        Some(fold_candidates[0].0)
    } else {
        None
    }
}

/// Check if a section is "folding" - meaning it goes out and comes back
/// on essentially the same path. Returns fold ratio (0.0 = no fold, 1.0 = perfect fold)
fn compute_fold_ratio(polyline: &[GpsPoint], threshold: f64) -> f64 {
    if polyline.len() < 6 {
        return 0.0;
    }

    let threshold_deg = threshold / 111_000.0;
    let threshold_deg_sq = threshold_deg * threshold_deg;

    // Compare first third to last third (reversed)
    let third = polyline.len() / 3;
    let first_third = &polyline[..third];
    let last_third: Vec<GpsPoint> = polyline[(polyline.len() - third)..].iter().cloned().collect();

    // Build tree from first third
    let first_tree = build_rtree(first_third);

    // Count how many points in last third are close to points in first third
    let mut close_count = 0;
    for point in last_third.iter().rev() {  // Reversed order for out-and-back
        let query = [point.latitude, point.longitude];
        if let Some(nearest) = first_tree.nearest_neighbor(&query) {
            if nearest.distance_2(&query) <= threshold_deg_sq {
                close_count += 1;
            }
        }
    }

    close_count as f64 / third as f64
}

/// Split sections that fold back on themselves into separate one-way sections.
/// For out-and-back routes, this creates two sections: outbound and return.
pub fn split_folding_sections(
    sections: Vec<FrequentSection>,
    config: &SectionConfig,
) -> Vec<FrequentSection> {
    let mut result = Vec::new();

    for section in sections {
        let fold_ratio = compute_fold_ratio(&section.polyline, config.proximity_threshold);

        if fold_ratio > 0.5 {
            // This section folds back on itself - split it
            if let Some(fold_idx) = detect_fold_point(&section.polyline, config.proximity_threshold) {
                // Create outbound section (start to fold point)
                let outbound_polyline = section.polyline[..fold_idx].to_vec();
                let outbound_length = polyline_length(&outbound_polyline);

                if outbound_length >= config.min_section_length {
                    let mut outbound = section.clone();
                    outbound.id = format!("{}_out", section.id);
                    outbound.polyline = outbound_polyline;
                    outbound.distance_meters = outbound_length;
                    // Update activity traces to only include outbound portion
                    outbound.activity_traces = HashMap::new();  // Will be recomputed
                    result.push(outbound);
                }

                // Create return section (fold point to end)
                let return_polyline = section.polyline[fold_idx..].to_vec();
                let return_length = polyline_length(&return_polyline);

                if return_length >= config.min_section_length {
                    let mut return_section = section.clone();
                    return_section.id = format!("{}_ret", section.id);
                    return_section.polyline = return_polyline;
                    return_section.distance_meters = return_length;
                    return_section.activity_traces = HashMap::new();
                    result.push(return_section);
                }

                info!(
                    "[Sections] Split folding section {} at index {} (fold_ratio={:.2})",
                    section.id, fold_idx, fold_ratio
                );
            } else {
                // Couldn't find fold point, keep original
                result.push(section);
            }
        } else {
            // Not folding, keep as-is
            result.push(section);
        }
    }

    result
}

// =============================================================================
// Nearby Section Merging
// =============================================================================

/// Merge sections that are geometrically close to each other.
/// This handles: reversed sections, parallel tracks (opposite sides of road), GPS drift.
pub fn merge_nearby_sections(
    mut sections: Vec<FrequentSection>,
    config: &SectionConfig,
) -> Vec<FrequentSection> {
    if sections.len() < 2 {
        return sections;
    }

    // Sort by visit count descending - keep the most visited version
    sections.sort_by(|a, b| b.visit_count.cmp(&a.visit_count));

    let mut keep: Vec<bool> = vec![true; sections.len()];

    // Use a very generous threshold for merging nearby sections
    // Wide roads can be 30m+, GPS error can add 20m, so use 2x the base threshold
    let merge_threshold = config.proximity_threshold * 2.0;

    for i in 0..sections.len() {
        if !keep[i] {
            continue;
        }

        let section_i = &sections[i];
        let tree_i = build_rtree(&section_i.polyline);

        for j in (i + 1)..sections.len() {
            if !keep[j] {
                continue;
            }

            let section_j = &sections[j];

            // Skip if sections are very different lengths (>3x difference)
            let length_ratio = section_i.distance_meters / section_j.distance_meters.max(1.0);
            if length_ratio > 3.0 || length_ratio < 0.33 {
                continue;
            }

            // Check forward containment with generous threshold
            let forward_containment = compute_containment(&section_j.polyline, &tree_i, merge_threshold);

            // Check reverse containment
            let reversed_j: Vec<GpsPoint> = section_j.polyline.iter().rev().cloned().collect();
            let reverse_containment = compute_containment(&reversed_j, &tree_i, merge_threshold);

            let max_containment = forward_containment.max(reverse_containment);

            // Merge if either direction shows overlap (lower threshold since we're using generous distance)
            if max_containment > 0.4 {
                keep[j] = false;

                let direction = if reverse_containment > forward_containment { "reverse" } else { "same" };

                info!(
                    "[Sections] Merged nearby {} section {} into {} ({:.0}% overlap @ {}m threshold)",
                    direction, section_j.id, section_i.id, max_containment * 100.0, merge_threshold as i32
                );
            }
        }
    }

    sections
        .into_iter()
        .zip(keep)
        .filter_map(|(s, k)| if k { Some(s) } else { None })
        .collect()
}

// =============================================================================
// Section Deduplication
// =============================================================================

/// Remove sections that overlap significantly.
/// Strategy: Prefer SHORTER sections over longer ones that contain them.
/// A short section (like an intersection or bridge) is more specific and useful
/// than a long section that happens to include it.
pub fn remove_overlapping_sections(
    mut sections: Vec<FrequentSection>,
    config: &SectionConfig,
) -> Vec<FrequentSection> {
    if sections.len() < 2 {
        return sections;
    }

    // Sort by LENGTH ascending (shorter sections first), then by visit count descending
    // This ensures shorter, more specific sections are preferred
    sections.sort_by(|a, b| {
        match a.distance_meters.partial_cmp(&b.distance_meters) {
            Some(std::cmp::Ordering::Equal) => b.visit_count.cmp(&a.visit_count),
            Some(ord) => ord,
            None => std::cmp::Ordering::Equal,
        }
    });

    let mut keep: Vec<bool> = vec![true; sections.len()];

    // For each section, check if it's mostly contained in a shorter section
    // If so, the longer section should be removed (or trimmed)
    for i in 0..sections.len() {
        if !keep[i] {
            continue;
        }

        let section_i = &sections[i];
        let tree_i = build_rtree(&section_i.polyline);

        for j in (i + 1)..sections.len() {
            if !keep[j] {
                continue;
            }

            let section_j = &sections[j];
            let tree_j = build_rtree(&section_j.polyline);

            // Check mutual containment
            let j_in_i = compute_containment(&section_j.polyline, &tree_i, config.proximity_threshold);
            let i_in_j = compute_containment(&section_i.polyline, &tree_j, config.proximity_threshold);

            // If j is largely contained in i (j is the longer one since we sorted by length)
            // j should be removed because i is the more specific section
            if j_in_i > 0.6 {
                info!(
                    "[Sections] Removing {} ({}m) - {}% contained in {} ({}m)",
                    section_j.id, section_j.distance_meters as u32,
                    (j_in_i * 100.0) as u32,
                    section_i.id, section_i.distance_meters as u32
                );
                keep[j] = false;
            } else if i_in_j > 0.8 {
                // If i is almost entirely contained in j, remove i (the smaller one)
                // This handles edge cases where the "smaller" section by length
                // is actually just a subset of another section
                info!(
                    "[Sections] Removing {} ({}m) - {}% contained in {} ({}m)",
                    section_i.id, section_i.distance_meters as u32,
                    (i_in_j * 100.0) as u32,
                    section_j.id, section_j.distance_meters as u32
                );
                keep[i] = false;
                break; // Stop checking j's against removed i
            } else if j_in_i > 0.4 && i_in_j > 0.4 {
                // Significant mutual overlap - they're essentially the same
                // Keep the shorter one (i, since sorted by length)
                info!(
                    "[Sections] Removing {} due to mutual overlap with {} ({}% vs {}%)",
                    section_j.id, section_i.id,
                    (j_in_i * 100.0) as u32, (i_in_j * 100.0) as u32
                );
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

/// Compute what fraction of polyline A is contained within polyline B
fn compute_containment(
    poly_a: &[GpsPoint],
    tree_b: &RTree<IndexedPoint>,
    threshold: f64,
) -> f64 {
    if poly_a.is_empty() {
        return 0.0;
    }

    let threshold_deg = threshold / 111_000.0;
    let threshold_deg_sq = threshold_deg * threshold_deg;

    let mut contained_points = 0;

    for point in poly_a {
        let query = [point.latitude, point.longitude];
        if let Some(nearest) = tree_b.nearest_neighbor(&query) {
            if nearest.distance_2(&query) <= threshold_deg_sq {
                contained_points += 1;
            }
        }
    }

    contained_points as f64 / poly_a.len() as f64
}

// =============================================================================
// Density-Based Section Splitting
// =============================================================================

/// Minimum density ratio to trigger a split (high-traffic portion / endpoint density)
const SPLIT_DENSITY_RATIO: f64 = 2.0;

/// Minimum length (meters) for a split portion to become its own section
const MIN_SPLIT_LENGTH: f64 = 100.0;

/// Minimum number of points in a high-density region to consider splitting
const MIN_SPLIT_POINTS: usize = 10;

/// Result of analyzing a section for potential splits
#[derive(Debug)]
struct SplitCandidate {
    /// Start index of the high-density portion
    start_idx: usize,
    /// End index of the high-density portion
    end_idx: usize,
    /// Average density in this portion
    avg_density: f64,
    /// Density ratio compared to endpoints
    density_ratio: f64,
}

/// Analyze a section's point density to find high-traffic portions.
/// Returns split candidates if the section should be divided.
fn find_split_candidates(section: &FrequentSection) -> Vec<SplitCandidate> {
    let density = &section.point_density;

    if density.len() < MIN_SPLIT_POINTS * 2 {
        return vec![]; // Too short to split meaningfully
    }

    // Compute endpoint density (average of first/last 10% of points)
    let endpoint_window = (density.len() / 10).max(3);
    let start_density: f64 = density[..endpoint_window].iter().map(|&d| d as f64).sum::<f64>()
        / endpoint_window as f64;
    let end_density: f64 = density[density.len() - endpoint_window..].iter().map(|&d| d as f64).sum::<f64>()
        / endpoint_window as f64;
    let endpoint_density = (start_density + end_density) / 2.0;

    if endpoint_density < 1.0 {
        return vec![]; // No meaningful endpoint density to compare against
    }

    // Sliding window to find high-density regions
    let window_size = (density.len() / 5).max(MIN_SPLIT_POINTS);
    let mut candidates = Vec::new();

    let mut i = window_size;
    while i < density.len() - window_size {
        // Compute density in current window
        let window_density: f64 = density[i - window_size / 2..i + window_size / 2]
            .iter()
            .map(|&d| d as f64)
            .sum::<f64>() / window_size as f64;

        let ratio = window_density / endpoint_density;

        if ratio >= SPLIT_DENSITY_RATIO {
            // Found a high-density region - expand to find boundaries
            let mut start_idx = i - window_size / 2;
            let mut end_idx = i + window_size / 2;

            // Expand start backward while density remains high
            while start_idx > 0 {
                let local_density = density[start_idx - 1] as f64;
                if local_density < endpoint_density * 1.5 {
                    break;
                }
                start_idx -= 1;
            }

            // Expand end forward while density remains high
            while end_idx < density.len() - 1 {
                let local_density = density[end_idx + 1] as f64;
                if local_density < endpoint_density * 1.5 {
                    break;
                }
                end_idx += 1;
            }

            // Compute distance of this portion
            let portion_distance = if end_idx > start_idx {
                polyline_length(&section.polyline[start_idx..=end_idx])
            } else {
                0.0
            };

            // Only consider if long enough
            if portion_distance >= MIN_SPLIT_LENGTH && end_idx - start_idx >= MIN_SPLIT_POINTS {
                let portion_density: f64 = density[start_idx..=end_idx]
                    .iter()
                    .map(|&d| d as f64)
                    .sum::<f64>() / (end_idx - start_idx + 1) as f64;

                candidates.push(SplitCandidate {
                    start_idx,
                    end_idx,
                    avg_density: portion_density,
                    density_ratio: portion_density / endpoint_density,
                });

                // Skip past this region
                i = end_idx + window_size;
            } else {
                i += 1;
            }
        } else {
            i += 1;
        }
    }

    candidates
}

/// Split a section into multiple sections based on density analysis.
/// Returns the original section plus any new sections created from high-density portions.
fn split_section_by_density(
    section: FrequentSection,
    track_map: &HashMap<String, Vec<GpsPoint>>,
    config: &SectionConfig,
) -> Vec<FrequentSection> {
    let candidates = find_split_candidates(&section);

    if candidates.is_empty() {
        return vec![section];
    }

    info!(
        "[Sections] Found {} split candidates for section {} (len={}m)",
        candidates.len(),
        section.id,
        section.distance_meters as i32
    );

    let mut result = Vec::new();

    // Create new sections from high-density portions
    for (split_idx, candidate) in candidates.iter().enumerate() {
        // Extract the high-density portion
        let split_polyline = section.polyline[candidate.start_idx..=candidate.end_idx].to_vec();
        let split_density = section.point_density[candidate.start_idx..=candidate.end_idx].to_vec();
        let split_distance = polyline_length(&split_polyline);

        // Re-compute which activities overlap with this portion
        let mut split_activity_ids = Vec::new();
        let mut split_activity_traces = HashMap::new();

        let split_tree = build_rtree(&split_polyline);
        let threshold_deg = config.proximity_threshold / 111_000.0;
        let threshold_deg_sq = threshold_deg * threshold_deg;

        for activity_id in &section.activity_ids {
            if let Some(track) = track_map.get(activity_id) {
                // Check if this activity overlaps with the split portion
                let mut overlap_points = Vec::new();

                for point in track {
                    let query = [point.latitude, point.longitude];
                    if let Some(nearest) = split_tree.nearest_neighbor(&query) {
                        if nearest.distance_2(&query) <= threshold_deg_sq {
                            overlap_points.push(point.clone());
                        }
                    }
                }

                // Need substantial overlap to count
                let overlap_distance = polyline_length(&overlap_points);
                if overlap_distance >= split_distance * 0.5 {
                    split_activity_ids.push(activity_id.clone());
                    if !overlap_points.is_empty() {
                        split_activity_traces.insert(activity_id.clone(), overlap_points);
                    }
                }
            }
        }

        // Only create the split section if it has enough activities
        if split_activity_ids.len() >= config.min_activities as usize {
            let split_section = FrequentSection {
                id: format!("{}_split{}", section.id, split_idx),
                name: None,
                sport_type: section.sport_type.clone(),
                polyline: split_polyline,
                representative_activity_id: section.representative_activity_id.clone(),
                activity_ids: split_activity_ids,
                activity_portions: Vec::new(), // Will be recomputed later if needed
                route_ids: section.route_ids.clone(),
                visit_count: candidate.avg_density as u32,
                distance_meters: split_distance,
                activity_traces: split_activity_traces,
                confidence: section.confidence,
                observation_count: candidate.avg_density as u32,
                average_spread: section.average_spread,
                point_density: split_density,
                scale: section.scale.clone(),
            };

            info!(
                "[Sections] Created split section {} with {} activities (density ratio {:.1}x)",
                split_section.id,
                split_section.activity_ids.len(),
                candidate.density_ratio
            );

            result.push(split_section);
        }
    }

    // Keep the original section too (it still represents the full route)
    result.push(section);

    result
}

/// Post-processing step: Split sections with high density variance.
/// Called after initial section detection to break up sections that have
/// high-traffic portions used by many other activities.
pub fn split_high_variance_sections(
    sections: Vec<FrequentSection>,
    track_map: &HashMap<String, Vec<GpsPoint>>,
    config: &SectionConfig,
) -> Vec<FrequentSection> {
    let mut result = Vec::new();

    for section in sections {
        let split = split_section_by_density(section, track_map, config);
        result.extend(split);
    }

    result
}
