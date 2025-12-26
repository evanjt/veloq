//! # Frequent Sections Detection
//!
//! Automatically detects frequently-traveled road sections, even when full routes differ.
//! Uses a grid-based approach with flood-fill clustering.
//!
//! ## Algorithm
//! 1. Grid all GPS points into ~100m cells, per activity type
//! 2. Count visits per cell - track which activities pass through each cell
//! 3. Find contiguous clusters via flood-fill with ≥min_visits
//! 4. Filter by length - keep clusters with ≥min_cells (~500m minimum)
//! 5. Extract polyline - generate simplified path through cluster
//! 6. Link to routes - associate sections with RouteGroups that use them

use std::collections::{HashMap, HashSet, VecDeque};
use crate::{GpsPoint, RouteSignature, RouteGroup};

/// Meters per degree of latitude (approximately constant)
const METERS_PER_LAT_DEGREE: f64 = 111_319.0;

/// Configuration for section detection
#[derive(Debug, Clone)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct SectionConfig {
    /// Grid cell size in meters (default: 100m)
    pub cell_size_meters: f64,
    /// Minimum visits to a cell to be considered frequent (default: 3)
    pub min_visits: u32,
    /// Minimum cells in a cluster to form a section (default: 5, ~500m)
    pub min_cells: u32,
    /// Whether to use 8-directional (true) or 4-directional (false) flood-fill
    pub diagonal_connect: bool,
}

impl Default for SectionConfig {
    fn default() -> Self {
        Self {
            cell_size_meters: 100.0,
            min_visits: 3,
            min_cells: 5,
            diagonal_connect: true,
        }
    }
}

/// A frequently-traveled section (~100m grid cells)
#[derive(Debug, Clone)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct FrequentSection {
    /// Unique section ID (generated from first cell coordinates)
    pub id: String,
    /// Sport type this section is for ("Run", "Ride", etc.)
    pub sport_type: String,
    /// Grid cell coordinates that make up this section
    pub cells: Vec<CellCoord>,
    /// Simplified polyline for rendering (ordered path through cells)
    pub polyline: Vec<GpsPoint>,
    /// Activity IDs that traverse this section
    pub activity_ids: Vec<String>,
    /// Route group IDs that include this section
    pub route_ids: Vec<String>,
    /// Total number of traversals (may be > activity count if same activity crosses multiple times)
    pub visit_count: u32,
    /// Estimated section length in meters
    pub distance_meters: f64,
    /// Timestamp of first visit (Unix seconds, 0 if unknown)
    pub first_visit: i64,
    /// Timestamp of last visit (Unix seconds, 0 if unknown)
    pub last_visit: i64,
}

/// Grid cell coordinate
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct CellCoord {
    pub row: i32,
    pub col: i32,
}

impl CellCoord {
    pub fn new(row: i32, col: i32) -> Self {
        Self { row, col }
    }
}

/// Internal cell data during processing
#[derive(Debug, Clone)]
struct CellData {
    /// Activities that pass through this cell
    activity_ids: HashSet<String>,
    /// Route groups that include this cell
    route_ids: HashSet<String>,
    /// Total visit count (points that landed in this cell)
    visit_count: u32,
    /// Center point of the cell (for polyline generation)
    center: GpsPoint,
}

/// Grid for a specific sport type
struct SportGrid {
    /// Cell size in degrees (latitude)
    cell_size_lat: f64,
    /// Cell size in degrees (longitude) - varies by latitude
    cell_size_lng: f64,
    /// Reference latitude for longitude scaling
    ref_lat: f64,
    /// Grid cells indexed by (row, col)
    cells: HashMap<(i32, i32), CellData>,
}

impl SportGrid {
    fn new(cell_size_meters: f64, ref_lat: f64) -> Self {
        // Convert meters to degrees
        let cell_size_lat = cell_size_meters / METERS_PER_LAT_DEGREE;
        // Longitude degrees are smaller at higher latitudes
        let lng_scale = (ref_lat.to_radians()).cos().abs().max(0.1);
        let cell_size_lng = cell_size_lat / lng_scale;

        Self {
            cell_size_lat,
            cell_size_lng,
            ref_lat,
            cells: HashMap::new(),
        }
    }

    /// Convert a GPS point to cell coordinates
    fn point_to_cell(&self, point: &GpsPoint) -> (i32, i32) {
        let row = (point.latitude / self.cell_size_lat).floor() as i32;
        let col = (point.longitude / self.cell_size_lng).floor() as i32;
        (row, col)
    }

    /// Get the center point of a cell
    fn cell_center(&self, row: i32, col: i32) -> GpsPoint {
        let lat = (row as f64 + 0.5) * self.cell_size_lat;
        let lng = (col as f64 + 0.5) * self.cell_size_lng;
        GpsPoint::new(lat, lng)
    }

    /// Add a point from an activity to the grid
    fn add_point(&mut self, point: &GpsPoint, activity_id: &str, route_id: Option<&str>) {
        let (row, col) = self.point_to_cell(point);

        // Compute center before borrowing cells mutably
        let center = self.cell_center(row, col);

        let cell = self.cells.entry((row, col)).or_insert_with(|| CellData {
            activity_ids: HashSet::new(),
            route_ids: HashSet::new(),
            visit_count: 0,
            center,
        });

        cell.activity_ids.insert(activity_id.to_string());
        if let Some(rid) = route_id {
            cell.route_ids.insert(rid.to_string());
        }
        cell.visit_count += 1;
    }

    /// Get neighbors of a cell (4 or 8 directional)
    fn neighbors(&self, row: i32, col: i32, diagonal: bool) -> Vec<(i32, i32)> {
        let mut result = vec![
            (row - 1, col),     // up
            (row + 1, col),     // down
            (row, col - 1),     // left
            (row, col + 1),     // right
        ];

        if diagonal {
            result.extend([
                (row - 1, col - 1), // up-left
                (row - 1, col + 1), // up-right
                (row + 1, col - 1), // down-left
                (row + 1, col + 1), // down-right
            ]);
        }

        result
    }
}

/// Detect frequent sections from route signatures and groups.
///
/// This function analyzes GPS tracks to find road sections that are frequently
/// traveled, even when the full routes differ. For example, if 5 different running
/// routes all pass through the same 1km stretch of road, that stretch becomes
/// a "frequent section".
///
/// # Arguments
/// * `signatures` - Route signatures with GPS points
/// * `groups` - Route groups (for linking sections to routes)
/// * `sport_types` - Map of activity_id -> sport_type (e.g., "Run", "Ride")
/// * `config` - Section detection configuration
///
/// # Returns
/// Vector of detected frequent sections, sorted by visit count (descending)
pub fn detect_frequent_sections(
    signatures: &[RouteSignature],
    groups: &[RouteGroup],
    sport_types: &HashMap<String, String>,
    config: &SectionConfig,
) -> Vec<FrequentSection> {
    use log::info;
    info!("[Sections] Detecting frequent sections from {} signatures", signatures.len());

    if signatures.is_empty() {
        return vec![];
    }

    // Build activity_id -> route_id mapping
    let activity_to_route: HashMap<&str, &str> = groups
        .iter()
        .flat_map(|g| g.activity_ids.iter().map(|aid| (aid.as_str(), g.group_id.as_str())))
        .collect();

    // Group signatures by sport type and build grids
    let mut sport_grids: HashMap<String, SportGrid> = HashMap::new();

    // Calculate reference latitude from all signatures (for consistent grid)
    let ref_lat = signatures
        .iter()
        .flat_map(|s| s.points.iter())
        .map(|p| p.latitude)
        .sum::<f64>() / signatures.iter().map(|s| s.points.len()).sum::<usize>() as f64;

    // Populate grids
    for sig in signatures {
        let sport = sport_types
            .get(&sig.activity_id)
            .cloned()
            .unwrap_or_else(|| "Unknown".to_string());

        let grid = sport_grids
            .entry(sport.clone())
            .or_insert_with(|| SportGrid::new(config.cell_size_meters, ref_lat));

        let route_id = activity_to_route.get(sig.activity_id.as_str()).copied();

        for point in &sig.points {
            grid.add_point(point, &sig.activity_id, route_id);
        }
    }

    // Find clusters in each sport grid
    let mut all_sections: Vec<FrequentSection> = Vec::new();

    for (sport_type, grid) in sport_grids {
        let sections = find_clusters(&grid, &sport_type, config);
        all_sections.extend(sections);
    }

    // Sort by visit count (most visited first)
    all_sections.sort_by(|a, b| b.visit_count.cmp(&a.visit_count));

    info!("[Sections] Found {} frequent sections", all_sections.len());
    all_sections
}

/// Find clusters of frequently-visited cells using flood-fill
fn find_clusters(
    grid: &SportGrid,
    sport_type: &str,
    config: &SectionConfig,
) -> Vec<FrequentSection> {
    let mut sections = Vec::new();
    let mut visited: HashSet<(i32, i32)> = HashSet::new();

    // Get cells that meet minimum visit threshold
    let frequent_cells: HashSet<(i32, i32)> = grid
        .cells
        .iter()
        .filter(|(_, data)| data.activity_ids.len() >= config.min_visits as usize)
        .map(|(coord, _)| *coord)
        .collect();

    // Flood-fill from each unvisited frequent cell
    for &start_cell in &frequent_cells {
        if visited.contains(&start_cell) {
            continue;
        }

        // BFS flood-fill
        let mut cluster_cells: Vec<(i32, i32)> = Vec::new();
        let mut queue: VecDeque<(i32, i32)> = VecDeque::new();
        queue.push_back(start_cell);
        visited.insert(start_cell);

        while let Some(cell) = queue.pop_front() {
            cluster_cells.push(cell);

            // Check neighbors
            for neighbor in grid.neighbors(cell.0, cell.1, config.diagonal_connect) {
                if !visited.contains(&neighbor) && frequent_cells.contains(&neighbor) {
                    visited.insert(neighbor);
                    queue.push_back(neighbor);
                }
            }
        }

        // Check if cluster is big enough
        if cluster_cells.len() < config.min_cells as usize {
            continue;
        }

        // Build the section from this cluster
        if let Some(section) = build_section(grid, &cluster_cells, sport_type, config) {
            sections.push(section);
        }
    }

    sections
}

/// Build a FrequentSection from a cluster of cells
fn build_section(
    grid: &SportGrid,
    cluster_cells: &[(i32, i32)],
    sport_type: &str,
    _config: &SectionConfig,
) -> Option<FrequentSection> {
    if cluster_cells.is_empty() {
        return None;
    }

    // Collect all activity IDs and route IDs from the cluster
    let mut all_activity_ids: HashSet<String> = HashSet::new();
    let mut all_route_ids: HashSet<String> = HashSet::new();
    let mut total_visits: u32 = 0;

    for &(row, col) in cluster_cells {
        if let Some(data) = grid.cells.get(&(row, col)) {
            all_activity_ids.extend(data.activity_ids.iter().cloned());
            all_route_ids.extend(data.route_ids.iter().cloned());
            total_visits += data.visit_count;
        }
    }

    // Generate ID from first cell
    let first_cell = cluster_cells[0];
    let id = format!("sec_{}_{}_{}", sport_type, first_cell.0, first_cell.1);

    // Order cells to form a path (simple: sort by row then col, then use traveling salesman-ish)
    let ordered_cells = order_cells_for_polyline(cluster_cells, grid);

    // Generate polyline from ordered cell centers
    let polyline: Vec<GpsPoint> = ordered_cells
        .iter()
        .map(|&(row, col)| grid.cell_center(row, col))
        .collect();

    // Estimate distance (sum of distances between consecutive points)
    let distance_meters = polyline
        .windows(2)
        .map(|w| haversine_distance(&w[0], &w[1]))
        .sum();

    // Convert cells to CellCoord
    let cells: Vec<CellCoord> = cluster_cells
        .iter()
        .map(|&(row, col)| CellCoord::new(row, col))
        .collect();

    Some(FrequentSection {
        id,
        sport_type: sport_type.to_string(),
        cells,
        polyline,
        activity_ids: all_activity_ids.into_iter().collect(),
        route_ids: all_route_ids.into_iter().collect(),
        visit_count: total_visits,
        distance_meters,
        first_visit: 0, // Could be populated if we had timestamp data
        last_visit: 0,
    })
}

/// Order cells to form a reasonable polyline path
/// Uses a greedy nearest-neighbor approach starting from the cell with minimum row,col
fn order_cells_for_polyline(cells: &[(i32, i32)], _grid: &SportGrid) -> Vec<(i32, i32)> {
    if cells.is_empty() {
        return vec![];
    }
    if cells.len() == 1 {
        return cells.to_vec();
    }

    // Find the "start" cell (minimum row, then minimum col)
    let mut remaining: HashSet<(i32, i32)> = cells.iter().copied().collect();
    let start = *cells.iter().min_by_key(|&&(r, c)| (r, c)).unwrap();

    let mut ordered = vec![start];
    remaining.remove(&start);

    // Greedy nearest neighbor
    while !remaining.is_empty() {
        let current = *ordered.last().unwrap();

        // Find nearest remaining cell (Manhattan distance for grid)
        let nearest = remaining
            .iter()
            .min_by_key(|&&(r, c)| {
                (current.0 - r).abs() + (current.1 - c).abs()
            })
            .copied();

        if let Some(next) = nearest {
            ordered.push(next);
            remaining.remove(&next);
        } else {
            break;
        }
    }

    ordered
}

/// Calculate haversine distance between two GPS points in meters
fn haversine_distance(p1: &GpsPoint, p2: &GpsPoint) -> f64 {
    use geo::{Point, Haversine, Distance};
    let point1 = Point::new(p1.longitude, p1.latitude);
    let point2 = Point::new(p2.longitude, p2.latitude);
    Haversine::distance(point1, point2)
}

// ============================================================================
// Parallel Processing
// ============================================================================

/// Detect frequent sections using parallel processing
#[cfg(feature = "parallel")]
pub fn detect_frequent_sections_parallel(
    signatures: &[RouteSignature],
    groups: &[RouteGroup],
    sport_types: &HashMap<String, String>,
    config: &SectionConfig,
) -> Vec<FrequentSection> {
    // The grid building is mostly sequential due to HashMap mutation
    // But we can parallelize the cluster building per sport
    detect_frequent_sections(signatures, groups, sport_types, config)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn make_signature(id: &str, points: Vec<(f64, f64)>) -> RouteSignature {
        let gps_points: Vec<GpsPoint> = points
            .iter()
            .map(|(lat, lng)| GpsPoint::new(*lat, *lng))
            .collect();

        let bounds = crate::Bounds::from_points(&gps_points).unwrap();
        let center = bounds.center();

        RouteSignature {
            activity_id: id.to_string(),
            points: gps_points.clone(),
            total_distance: 1000.0,
            start_point: gps_points[0],
            end_point: gps_points[gps_points.len() - 1],
            bounds,
            center,
        }
    }

    #[test]
    fn test_empty_input() {
        let sections = detect_frequent_sections(
            &[],
            &[],
            &HashMap::new(),
            &SectionConfig::default(),
        );
        assert!(sections.is_empty());
    }

    #[test]
    fn test_single_activity_no_sections() {
        // A single activity shouldn't create sections (needs multiple visits)
        let sig = make_signature("a1", vec![
            (51.5, -0.1),
            (51.501, -0.1),
            (51.502, -0.1),
        ]);

        let mut sport_types = HashMap::new();
        sport_types.insert("a1".to_string(), "Run".to_string());

        let sections = detect_frequent_sections(
            &[sig],
            &[],
            &sport_types,
            &SectionConfig::default(),
        );

        assert!(sections.is_empty());
    }

    #[test]
    fn test_multiple_activities_same_path() {
        // Three activities on the same path should create a section
        let path = vec![
            (51.5, -0.1),
            (51.501, -0.1),
            (51.502, -0.1),
            (51.503, -0.1),
            (51.504, -0.1),
            (51.505, -0.1),
        ];

        let sigs = vec![
            make_signature("a1", path.clone()),
            make_signature("a2", path.clone()),
            make_signature("a3", path.clone()),
        ];

        let mut sport_types = HashMap::new();
        sport_types.insert("a1".to_string(), "Run".to_string());
        sport_types.insert("a2".to_string(), "Run".to_string());
        sport_types.insert("a3".to_string(), "Run".to_string());

        let config = SectionConfig {
            cell_size_meters: 100.0,
            min_visits: 3,
            min_cells: 3, // Lower for test
            diagonal_connect: true,
        };

        let sections = detect_frequent_sections(&sigs, &[], &sport_types, &config);

        // Should find at least one section
        assert!(!sections.is_empty());

        // Section should contain all 3 activities
        let section = &sections[0];
        assert!(section.activity_ids.contains(&"a1".to_string()));
        assert!(section.activity_ids.contains(&"a2".to_string()));
        assert!(section.activity_ids.contains(&"a3".to_string()));
    }

    #[test]
    fn test_different_sports_separate_sections() {
        // Same path but different sports should create separate sections
        let path = vec![
            (51.5, -0.1),
            (51.501, -0.1),
            (51.502, -0.1),
            (51.503, -0.1),
            (51.504, -0.1),
            (51.505, -0.1),
        ];

        let sigs = vec![
            make_signature("r1", path.clone()),
            make_signature("r2", path.clone()),
            make_signature("r3", path.clone()),
            make_signature("c1", path.clone()),
            make_signature("c2", path.clone()),
            make_signature("c3", path.clone()),
        ];

        let mut sport_types = HashMap::new();
        sport_types.insert("r1".to_string(), "Run".to_string());
        sport_types.insert("r2".to_string(), "Run".to_string());
        sport_types.insert("r3".to_string(), "Run".to_string());
        sport_types.insert("c1".to_string(), "Ride".to_string());
        sport_types.insert("c2".to_string(), "Ride".to_string());
        sport_types.insert("c3".to_string(), "Ride".to_string());

        let config = SectionConfig {
            cell_size_meters: 100.0,
            min_visits: 3,
            min_cells: 3,
            diagonal_connect: true,
        };

        let sections = detect_frequent_sections(&sigs, &[], &sport_types, &config);

        // Should find sections for both sports
        let run_sections: Vec<_> = sections.iter().filter(|s| s.sport_type == "Run").collect();
        let ride_sections: Vec<_> = sections.iter().filter(|s| s.sport_type == "Ride").collect();

        assert!(!run_sections.is_empty());
        assert!(!ride_sections.is_empty());
    }
}
