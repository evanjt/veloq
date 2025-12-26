//! Heatmap generation with route intelligence.
//!
//! Creates a sparse grid of cells from GPS activities, tracking:
//! - Visit frequency per cell (for density visualization)
//! - Routes passing through each cell (for tap-to-discover)
//! - Activity references for drill-down
//!
//! Optimized for 120Hz rendering by pre-computing all data.

use std::collections::HashMap;
use crate::RouteSignature;

/// Configuration for heatmap generation
#[derive(Debug, Clone)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct HeatmapConfig {
    /// Grid cell size in meters (default: 100m)
    pub cell_size_meters: f64,
    /// Optional bounds to limit computation
    pub bounds: Option<HeatmapBounds>,
}

impl Default for HeatmapConfig {
    fn default() -> Self {
        Self {
            cell_size_meters: 100.0,
            bounds: None,
        }
    }
}

/// Bounding box for heatmap computation
#[derive(Debug, Clone)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct HeatmapBounds {
    pub min_lat: f64,
    pub max_lat: f64,
    pub min_lng: f64,
    pub max_lng: f64,
}

/// Reference to a route group passing through a cell
#[derive(Debug, Clone)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct RouteRef {
    /// Route group ID
    pub route_id: String,
    /// How many activities from this route pass through this cell
    pub activity_count: u32,
    /// User-defined or auto-generated route name
    pub name: Option<String>,
}

/// A single cell in the heatmap grid
#[derive(Debug, Clone)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct HeatmapCell {
    /// Grid row index
    pub row: i32,
    /// Grid column index
    pub col: i32,
    /// Cell center for rendering
    pub center_lat: f64,
    pub center_lng: f64,
    /// Normalized density (0.0-1.0) for color mapping
    pub density: f32,
    /// Total visit count (sum of all point traversals)
    pub visit_count: u32,
    /// Routes passing through this cell
    pub route_refs: Vec<RouteRef>,
    /// Number of unique routes
    pub unique_route_count: u32,
    /// All activity IDs that pass through
    pub activity_ids: Vec<String>,
    /// Earliest visit (Unix timestamp)
    pub first_visit: Option<i64>,
    /// Most recent visit (Unix timestamp)
    pub last_visit: Option<i64>,
    /// True if 2+ routes share this cell (intersection/common path)
    pub is_common_path: bool,
}

/// Complete heatmap result
#[derive(Debug, Clone)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct HeatmapResult {
    /// Non-empty cells only (sparse representation)
    pub cells: Vec<HeatmapCell>,
    /// Computed bounds (from data or config)
    pub bounds: HeatmapBounds,
    /// Cell size used
    pub cell_size_meters: f64,
    /// Grid dimensions
    pub grid_rows: u32,
    pub grid_cols: u32,
    /// Maximum density for normalization
    pub max_density: f32,
    /// Summary stats
    pub total_routes: u32,
    pub total_activities: u32,
}

/// Query result when user taps a location
#[derive(Debug, Clone)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct CellQueryResult {
    /// The cell at the queried location
    pub cell: HeatmapCell,
    /// Suggested label based on patterns
    pub suggested_label: String,
}

// Internal cell data during construction
#[derive(Debug, Default)]
struct CellBuilder {
    visit_count: u32,
    activity_ids: Vec<String>,
    route_counts: HashMap<String, u32>, // route_id -> count
    route_names: HashMap<String, Option<String>>, // route_id -> name
    first_visit: Option<i64>,
    last_visit: Option<i64>,
}

/// Grid coordinate
type CellCoord = (i32, i32);

/// Heatmap grid builder
struct HeatmapGrid {
    cell_size_meters: f64,
    ref_lat: f64,
    cells: HashMap<CellCoord, CellBuilder>,
    min_lat: f64,
    max_lat: f64,
    min_lng: f64,
    max_lng: f64,
}

impl HeatmapGrid {
    fn new(cell_size_meters: f64) -> Self {
        Self {
            cell_size_meters,
            ref_lat: 0.0,
            cells: HashMap::new(),
            min_lat: f64::INFINITY,
            max_lat: f64::NEG_INFINITY,
            min_lng: f64::INFINITY,
            max_lng: f64::NEG_INFINITY,
        }
    }

    /// Convert lat/lng to grid coordinates
    fn to_grid_coords(&self, lat: f64, lng: f64) -> CellCoord {
        // Meters per degree at reference latitude
        let lat_meters_per_deg = 111_320.0;
        let lng_meters_per_deg = 111_320.0 * self.ref_lat.to_radians().cos();

        let row = ((lat - self.ref_lat) * lat_meters_per_deg / self.cell_size_meters).floor() as i32;
        let col = (lng * lng_meters_per_deg / self.cell_size_meters).floor() as i32;

        (row, col)
    }

    /// Get cell center coordinates
    fn cell_center(&self, row: i32, col: i32) -> (f64, f64) {
        let lat_meters_per_deg = 111_320.0;
        let lng_meters_per_deg = 111_320.0 * self.ref_lat.to_radians().cos();

        let center_lat = self.ref_lat + ((row as f64 + 0.5) * self.cell_size_meters / lat_meters_per_deg);
        let center_lng = (col as f64 + 0.5) * self.cell_size_meters / lng_meters_per_deg;

        (center_lat, center_lng)
    }

    /// Add a point to the grid
    fn add_point(
        &mut self,
        lat: f64,
        lng: f64,
        activity_id: &str,
        route_id: Option<&str>,
        route_name: Option<&str>,
        timestamp: Option<i64>,
    ) {
        // Update bounds
        self.min_lat = self.min_lat.min(lat);
        self.max_lat = self.max_lat.max(lat);
        self.min_lng = self.min_lng.min(lng);
        self.max_lng = self.max_lng.max(lng);

        // Set reference latitude if not set
        if self.ref_lat == 0.0 {
            self.ref_lat = lat;
        }

        let (row, col) = self.to_grid_coords(lat, lng);
        let cell = self.cells.entry((row, col)).or_default();

        cell.visit_count += 1;

        // Track activity (dedupe)
        if !cell.activity_ids.contains(&activity_id.to_string()) {
            cell.activity_ids.push(activity_id.to_string());
        }

        // Track route
        if let Some(rid) = route_id {
            *cell.route_counts.entry(rid.to_string()).or_insert(0) += 1;
            if !cell.route_names.contains_key(rid) {
                cell.route_names.insert(rid.to_string(), route_name.map(|s| s.to_string()));
            }
        }

        // Track timestamps
        if let Some(ts) = timestamp {
            cell.first_visit = Some(cell.first_visit.map_or(ts, |v| v.min(ts)));
            cell.last_visit = Some(cell.last_visit.map_or(ts, |v| v.max(ts)));
        }
    }

    /// Build the final heatmap result
    fn build(self) -> HeatmapResult {
        if self.cells.is_empty() {
            return HeatmapResult {
                cells: vec![],
                bounds: HeatmapBounds {
                    min_lat: 0.0,
                    max_lat: 0.0,
                    min_lng: 0.0,
                    max_lng: 0.0,
                },
                cell_size_meters: self.cell_size_meters,
                grid_rows: 0,
                grid_cols: 0,
                max_density: 0.0,
                total_routes: 0,
                total_activities: 0,
            };
        }

        // Find max visit count for normalization
        let max_visits = self.cells.values().map(|c| c.visit_count).max().unwrap_or(1);
        let max_density = max_visits as f32;

        // Track unique routes and activities
        let mut all_routes = std::collections::HashSet::new();
        let mut all_activities = std::collections::HashSet::new();

        // Build cells
        let cells: Vec<HeatmapCell> = self.cells.iter().map(|(&(row, col), builder)| {
            let (center_lat, center_lng) = self.cell_center(row, col);

            // Build route refs
            let route_refs: Vec<RouteRef> = builder.route_counts.iter().map(|(rid, count)| {
                all_routes.insert(rid.clone());
                RouteRef {
                    route_id: rid.clone(),
                    activity_count: *count,
                    name: builder.route_names.get(rid).cloned().flatten(),
                }
            }).collect();

            for aid in &builder.activity_ids {
                all_activities.insert(aid.clone());
            }

            let unique_route_count = route_refs.len() as u32;

            HeatmapCell {
                row,
                col,
                center_lat,
                center_lng,
                density: builder.visit_count as f32 / max_density,
                visit_count: builder.visit_count,
                route_refs,
                unique_route_count,
                activity_ids: builder.activity_ids.clone(),
                first_visit: builder.first_visit,
                last_visit: builder.last_visit,
                is_common_path: unique_route_count >= 2,
            }
        }).collect();

        // Calculate grid dimensions
        let rows: Vec<i32> = self.cells.keys().map(|(r, _)| *r).collect();
        let cols: Vec<i32> = self.cells.keys().map(|(_, c)| *c).collect();
        let min_row = rows.iter().min().copied().unwrap_or(0);
        let max_row = rows.iter().max().copied().unwrap_or(0);
        let min_col = cols.iter().min().copied().unwrap_or(0);
        let max_col = cols.iter().max().copied().unwrap_or(0);

        HeatmapResult {
            cells,
            bounds: HeatmapBounds {
                min_lat: self.min_lat,
                max_lat: self.max_lat,
                min_lng: self.min_lng,
                max_lng: self.max_lng,
            },
            cell_size_meters: self.cell_size_meters,
            grid_rows: (max_row - min_row + 1) as u32,
            grid_cols: (max_col - min_col + 1) as u32,
            max_density,
            total_routes: all_routes.len() as u32,
            total_activities: all_activities.len() as u32,
        }
    }
}

/// Activity metadata for heatmap generation
#[derive(Debug, Clone)]
#[cfg_attr(feature = "ffi", derive(uniffi::Record))]
pub struct ActivityHeatmapData {
    pub activity_id: String,
    pub route_id: Option<String>,
    pub route_name: Option<String>,
    pub timestamp: Option<i64>,
}

/// Generate a heatmap from route signatures
///
/// Uses the simplified GPS traces from RouteSignature (~100 points each)
/// for efficient heatmap generation without loading full GPS tracks.
pub fn generate_heatmap(
    signatures: &[RouteSignature],
    activity_data: &HashMap<String, ActivityHeatmapData>,
    config: &HeatmapConfig,
) -> HeatmapResult {
    let mut grid = HeatmapGrid::new(config.cell_size_meters);

    for sig in signatures {
        let data = activity_data.get(&sig.activity_id);
        let route_id = data.and_then(|d| d.route_id.as_deref());
        let route_name = data.and_then(|d| d.route_name.as_deref());
        let timestamp = data.and_then(|d| d.timestamp);

        for point in &sig.points {
            // Skip points outside bounds if specified
            if let Some(bounds) = &config.bounds {
                if point.latitude < bounds.min_lat || point.latitude > bounds.max_lat ||
                   point.longitude < bounds.min_lng || point.longitude > bounds.max_lng {
                    continue;
                }
            }

            grid.add_point(
                point.latitude,
                point.longitude,
                &sig.activity_id,
                route_id,
                route_name,
                timestamp,
            );
        }
    }

    grid.build()
}

/// Query the heatmap at a specific location
pub fn query_heatmap_cell(
    heatmap: &HeatmapResult,
    lat: f64,
    lng: f64,
    cell_size_meters: f64,
) -> Option<CellQueryResult> {
    // Find the cell at this location
    // We need to calculate the grid coords the same way as during generation
    if heatmap.cells.is_empty() {
        return None;
    }

    // Use the heatmap's bounds to calculate ref_lat
    let ref_lat = (heatmap.bounds.min_lat + heatmap.bounds.max_lat) / 2.0;
    let lat_meters_per_deg = 111_320.0;
    let lng_meters_per_deg = 111_320.0 * ref_lat.to_radians().cos();

    let target_row = ((lat - ref_lat) * lat_meters_per_deg / cell_size_meters).floor() as i32;
    let target_col = (lng * lng_meters_per_deg / cell_size_meters).floor() as i32;

    // Find the cell
    let cell = heatmap.cells.iter().find(|c| c.row == target_row && c.col == target_col)?;

    // Generate suggested label
    let suggested_label = if cell.unique_route_count == 0 {
        if cell.activity_ids.len() == 1 {
            "Explored once".to_string()
        } else {
            format!("{} activities (no route)", cell.activity_ids.len())
        }
    } else if cell.unique_route_count == 1 {
        let route = &cell.route_refs[0];
        if let Some(name) = &route.name {
            format!("{} ({}x)", name, route.activity_count)
        } else {
            format!("Route ({} activities)", route.activity_count)
        }
    } else if cell.is_common_path {
        format!("Common path ({} routes)", cell.unique_route_count)
    } else {
        format!("{} routes", cell.unique_route_count)
    };

    Some(CellQueryResult {
        cell: cell.clone(),
        suggested_label,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{GpsPoint, Bounds};

    fn make_signature(id: &str, points: Vec<(f64, f64)>) -> RouteSignature {
        let gps_points: Vec<GpsPoint> = points.iter()
            .map(|(lat, lng)| GpsPoint::new(*lat, *lng))
            .collect();

        let min_lat = points.iter().map(|(lat, _)| *lat).fold(f64::INFINITY, f64::min);
        let max_lat = points.iter().map(|(lat, _)| *lat).fold(f64::NEG_INFINITY, f64::max);
        let min_lng = points.iter().map(|(_, lng)| *lng).fold(f64::INFINITY, f64::min);
        let max_lng = points.iter().map(|(_, lng)| *lng).fold(f64::NEG_INFINITY, f64::max);

        let center_lat = points.iter().map(|(lat, _)| *lat).sum::<f64>() / points.len() as f64;
        let center_lng = points.iter().map(|(_, lng)| *lng).sum::<f64>() / points.len() as f64;

        RouteSignature {
            activity_id: id.to_string(),
            points: gps_points.clone(),
            total_distance: 1000.0,
            start_point: gps_points.first().cloned().unwrap_or(GpsPoint::new(0.0, 0.0)),
            end_point: gps_points.last().cloned().unwrap_or(GpsPoint::new(0.0, 0.0)),
            bounds: Bounds { min_lat, max_lat, min_lng, max_lng },
            center: GpsPoint::new(center_lat, center_lng),
        }
    }

    #[test]
    fn test_empty_heatmap() {
        let result = generate_heatmap(&[], &HashMap::new(), &HeatmapConfig::default());
        assert!(result.cells.is_empty());
        assert_eq!(result.total_activities, 0);
    }

    #[test]
    fn test_single_activity() {
        let sig = make_signature("act1", vec![
            (37.7749, -122.4194),
            (37.7750, -122.4195),
            (37.7751, -122.4196),
        ]);

        let mut data = HashMap::new();
        data.insert("act1".to_string(), ActivityHeatmapData {
            activity_id: "act1".to_string(),
            route_id: None,
            route_name: None,
            timestamp: Some(1000000),
        });

        let result = generate_heatmap(&[sig], &data, &HeatmapConfig::default());

        assert!(!result.cells.is_empty());
        assert_eq!(result.total_activities, 1);
        assert_eq!(result.total_routes, 0);
    }

    #[test]
    fn test_multiple_activities_same_path() {
        let sig1 = make_signature("act1", vec![
            (37.7749, -122.4194),
            (37.7750, -122.4195),
        ]);
        let sig2 = make_signature("act2", vec![
            (37.7749, -122.4194),
            (37.7750, -122.4195),
        ]);

        let mut data = HashMap::new();
        data.insert("act1".to_string(), ActivityHeatmapData {
            activity_id: "act1".to_string(),
            route_id: Some("route1".to_string()),
            route_name: Some("Morning Run".to_string()),
            timestamp: None,
        });
        data.insert("act2".to_string(), ActivityHeatmapData {
            activity_id: "act2".to_string(),
            route_id: Some("route1".to_string()),
            route_name: Some("Morning Run".to_string()),
            timestamp: None,
        });

        let result = generate_heatmap(&[sig1, sig2], &data, &HeatmapConfig::default());

        assert!(!result.cells.is_empty());
        assert_eq!(result.total_activities, 2);
        assert_eq!(result.total_routes, 1);

        // Cells should have higher density due to overlapping paths
        let max_cell = result.cells.iter().max_by(|a, b|
            a.visit_count.cmp(&b.visit_count)
        ).unwrap();
        assert!(max_cell.visit_count >= 2);
    }

    #[test]
    fn test_common_path_detection() {
        let sig1 = make_signature("act1", vec![
            (37.7749, -122.4194),
        ]);
        let sig2 = make_signature("act2", vec![
            (37.7749, -122.4194),
        ]);

        let mut data = HashMap::new();
        data.insert("act1".to_string(), ActivityHeatmapData {
            activity_id: "act1".to_string(),
            route_id: Some("route1".to_string()),
            route_name: None,
            timestamp: None,
        });
        data.insert("act2".to_string(), ActivityHeatmapData {
            activity_id: "act2".to_string(),
            route_id: Some("route2".to_string()),
            route_name: None,
            timestamp: None,
        });

        let result = generate_heatmap(&[sig1, sig2], &data, &HeatmapConfig::default());

        // Should detect cells where routes overlap
        let common_cells: Vec<_> = result.cells.iter().filter(|c| c.is_common_path).collect();
        assert!(!common_cells.is_empty());
    }
}
