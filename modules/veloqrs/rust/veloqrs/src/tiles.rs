//! Raster tile generation for activity heatmaps.
//!
//! Generates PNG tiles from GPS traces using web mercator projection.
//! Tiles are rendered at multiple zoom levels and cached locally.

use image::{ImageBuffer, Rgba, RgbaImage};
use log::info;
use rayon::prelude::*;
use std::f64::consts::PI;
use std::io::Cursor;
use std::path::Path;
use tracematch::GpsPoint;

/// Tile size in pixels (256 is standard, smaller = less storage)
pub const TILE_SIZE: u32 = 256;

/// Configuration for tile generation
#[derive(Debug, Clone)]
pub struct TileConfig {
    /// Line color (RGBA)
    pub line_color: [u8; 4],
    /// Line width in pixels
    pub line_width: f32,
    /// Background color (RGBA) - typically transparent
    pub background_color: [u8; 4],
    /// Minimum zoom level to generate
    pub min_zoom: u8,
    /// Maximum zoom level to generate
    pub max_zoom: u8,
}

impl Default for TileConfig {
    fn default() -> Self {
        Self {
            // Semi-transparent orange (brand color)
            line_color: [252, 76, 2, 180],
            line_width: 2.0,
            // Fully transparent background
            background_color: [0, 0, 0, 0],
            min_zoom: 8,
            max_zoom: 14,
        }
    }
}

/// Result of tile generation
#[derive(Debug, Clone)]
pub struct TileResult {
    /// PNG data
    pub png_data: Vec<u8>,
    /// Tile coordinates
    pub z: u8,
    pub x: u32,
    pub y: u32,
}

/// Bounds of a tile in WGS84 coordinates
#[derive(Debug, Clone, Copy)]
pub struct TileBounds {
    pub min_lon: f64,
    pub max_lon: f64,
    pub min_lat: f64,
    pub max_lat: f64,
}

// ============================================================================
// Web Mercator Math
// ============================================================================

/// Convert longitude to tile X coordinate at given zoom
#[inline]
pub fn lon_to_tile_x(lon: f64, zoom: u8) -> f64 {
    let n = 2.0_f64.powi(zoom as i32);
    (lon + 180.0) / 360.0 * n
}

/// Convert latitude to tile Y coordinate at given zoom
#[inline]
pub fn lat_to_tile_y(lat: f64, zoom: u8) -> f64 {
    let n = 2.0_f64.powi(zoom as i32);
    let lat_rad = lat.to_radians();
    (1.0 - (lat_rad.tan() + 1.0 / lat_rad.cos()).ln() / PI) / 2.0 * n
}

/// Convert tile X coordinate to longitude
#[inline]
pub fn tile_x_to_lon(x: f64, zoom: u8) -> f64 {
    let n = 2.0_f64.powi(zoom as i32);
    x / n * 360.0 - 180.0
}

/// Convert tile Y coordinate to latitude
#[inline]
pub fn tile_y_to_lat(y: f64, zoom: u8) -> f64 {
    let n = 2.0_f64.powi(zoom as i32);
    let lat_rad = (PI * (1.0 - 2.0 * y / n)).sinh().atan();
    lat_rad.to_degrees()
}

/// Get the WGS84 bounds of a tile
pub fn tile_bounds(z: u8, x: u32, y: u32) -> TileBounds {
    TileBounds {
        min_lon: tile_x_to_lon(x as f64, z),
        max_lon: tile_x_to_lon((x + 1) as f64, z),
        max_lat: tile_y_to_lat(y as f64, z),      // Y is inverted in web mercator
        min_lat: tile_y_to_lat((y + 1) as f64, z),
    }
}

/// Convert GPS point to pixel coordinates within a tile
/// Returns None if the point is outside the tile
#[inline]
pub fn gps_to_pixel(point: &GpsPoint, z: u8, tile_x: u32, tile_y: u32) -> Option<(f32, f32)> {
    let global_x = lon_to_tile_x(point.longitude, z);
    let global_y = lat_to_tile_y(point.latitude, z);

    // Pixel position within the tile
    let px = ((global_x - tile_x as f64) * TILE_SIZE as f64) as f32;
    let py = ((global_y - tile_y as f64) * TILE_SIZE as f64) as f32;

    // Allow some margin outside tile for line continuity
    let margin = 50.0;
    if px >= -margin && px < (TILE_SIZE as f32 + margin)
        && py >= -margin && py < (TILE_SIZE as f32 + margin) {
        Some((px, py))
    } else {
        None
    }
}

/// Determine which tiles a GPS track intersects at a given zoom level
pub fn tiles_for_track(points: &[GpsPoint], zoom: u8) -> Vec<(u32, u32)> {
    let mut tiles = std::collections::HashSet::new();

    for point in points {
        if !point.is_valid() {
            continue;
        }
        let tx_f = lon_to_tile_x(point.longitude, zoom);
        let ty_f = lat_to_tile_y(point.latitude, zoom);
        let tx = tx_f.floor() as u32;
        let ty = ty_f.floor() as u32;
        tiles.insert((tx, ty));
    }

    tiles.into_iter().collect()
}

/// Determine which tiles need to be generated for a set of tracks
pub fn tiles_for_tracks(
    tracks: &[Vec<GpsPoint>],
    min_zoom: u8,
    max_zoom: u8,
) -> Vec<(u8, u32, u32)> {
    let mut all_tiles = std::collections::HashSet::new();

    // Debug: count points and valid points
    let total_points: usize = tracks.iter().map(|t| t.len()).sum();
    let mut valid_points = 0usize;
    let mut invalid_points = 0usize;
    let mut sample_coords: Vec<(f64, f64)> = Vec::new();

    for track in tracks {
        for point in track {
            if point.is_valid() {
                valid_points += 1;
                if sample_coords.len() < 5 {
                    sample_coords.push((point.latitude, point.longitude));
                }
            } else {
                invalid_points += 1;
                // Log first few invalid points for debugging
                if invalid_points <= 3 {
                    info!(
                        "[tiles_for_tracks] Invalid point: lat={}, lng={}, finite=({}, {})",
                        point.latitude,
                        point.longitude,
                        point.latitude.is_finite(),
                        point.longitude.is_finite()
                    );
                }
            }
        }
    }

    info!(
        "[tiles_for_tracks] {} tracks, {} total points, {} valid, {} invalid",
        tracks.len(),
        total_points,
        valid_points,
        invalid_points
    );

    if !sample_coords.is_empty() {
        info!(
            "[tiles_for_tracks] Sample coords: {:?}",
            sample_coords
        );
    }

    for zoom in min_zoom..=max_zoom {
        let mut tiles_at_zoom = 0;
        for track in tracks {
            let track_tiles = tiles_for_track(track, zoom);
            tiles_at_zoom += track_tiles.len();
            for (x, y) in track_tiles {
                all_tiles.insert((zoom, x, y));
            }
        }
        info!(
            "[tiles_for_tracks] Zoom {}: {} tiles found",
            zoom,
            tiles_at_zoom
        );
    }

    info!(
        "[tiles_for_tracks] Total unique tiles: {}",
        all_tiles.len()
    );

    all_tiles.into_iter().collect()
}

// ============================================================================
// Line Rasterization
// ============================================================================

/// Draw a line with antialiasing using Wu's algorithm
fn draw_line_aa(
    img: &mut RgbaImage,
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
    color: [u8; 4],
    width: f32,
) {
    // For thick lines, draw multiple parallel lines
    if width > 1.5 {
        let dx = x1 - x0;
        let dy = y1 - y0;
        let len = (dx * dx + dy * dy).sqrt();
        if len < 0.001 {
            return;
        }

        // Perpendicular unit vector
        let px = -dy / len;
        let py = dx / len;

        // Draw multiple parallel lines
        let half_width = width / 2.0;
        let steps = (width.ceil() as i32).max(3);
        for i in 0..steps {
            let offset = -half_width + (i as f32 / (steps - 1) as f32) * width;
            let ox = px * offset;
            let oy = py * offset;
            draw_line_wu(img, x0 + ox, y0 + oy, x1 + ox, y1 + oy, color);
        }
    } else {
        draw_line_wu(img, x0, y0, x1, y1, color);
    }
}

/// Wu's antialiased line algorithm
fn draw_line_wu(img: &mut RgbaImage, mut x0: f32, mut y0: f32, mut x1: f32, mut y1: f32, color: [u8; 4]) {
    let steep = (y1 - y0).abs() > (x1 - x0).abs();

    if steep {
        std::mem::swap(&mut x0, &mut y0);
        std::mem::swap(&mut x1, &mut y1);
    }

    if x0 > x1 {
        std::mem::swap(&mut x0, &mut x1);
        std::mem::swap(&mut y0, &mut y1);
    }

    let dx = x1 - x0;
    let dy = y1 - y0;
    let gradient = if dx.abs() < 0.001 { 1.0 } else { dy / dx };

    // First endpoint
    let xend = x0.round();
    let yend = y0 + gradient * (xend - x0);
    let xgap = 1.0 - (x0 + 0.5).fract();
    let xpxl1 = xend as i32;
    let ypxl1 = yend.floor() as i32;

    if steep {
        plot_aa(img, ypxl1, xpxl1, (1.0 - yend.fract()) * xgap, color);
        plot_aa(img, ypxl1 + 1, xpxl1, yend.fract() * xgap, color);
    } else {
        plot_aa(img, xpxl1, ypxl1, (1.0 - yend.fract()) * xgap, color);
        plot_aa(img, xpxl1, ypxl1 + 1, yend.fract() * xgap, color);
    }

    let mut intery = yend + gradient;

    // Second endpoint
    let xend = x1.round();
    let yend = y1 + gradient * (xend - x1);
    let xgap = (x1 + 0.5).fract();
    let xpxl2 = xend as i32;
    let ypxl2 = yend.floor() as i32;

    if steep {
        plot_aa(img, ypxl2, xpxl2, (1.0 - yend.fract()) * xgap, color);
        plot_aa(img, ypxl2 + 1, xpxl2, yend.fract() * xgap, color);
    } else {
        plot_aa(img, xpxl2, ypxl2, (1.0 - yend.fract()) * xgap, color);
        plot_aa(img, xpxl2, ypxl2 + 1, yend.fract() * xgap, color);
    }

    // Main loop
    if steep {
        for x in (xpxl1 + 1)..xpxl2 {
            let y = intery.floor() as i32;
            plot_aa(img, y, x, 1.0 - intery.fract(), color);
            plot_aa(img, y + 1, x, intery.fract(), color);
            intery += gradient;
        }
    } else {
        for x in (xpxl1 + 1)..xpxl2 {
            let y = intery.floor() as i32;
            plot_aa(img, x, y, 1.0 - intery.fract(), color);
            plot_aa(img, x, y + 1, intery.fract(), color);
            intery += gradient;
        }
    }
}

/// Plot a pixel with alpha blending
#[inline]
fn plot_aa(img: &mut RgbaImage, x: i32, y: i32, brightness: f32, color: [u8; 4]) {
    if x < 0 || y < 0 || x >= TILE_SIZE as i32 || y >= TILE_SIZE as i32 {
        return;
    }

    let alpha = (color[3] as f32 * brightness.clamp(0.0, 1.0)) as u8;
    if alpha == 0 {
        return;
    }

    let pixel = img.get_pixel_mut(x as u32, y as u32);

    // Alpha compositing (Porter-Duff over operator)
    let src_a = alpha as f32 / 255.0;
    let dst_a = pixel[3] as f32 / 255.0;
    let out_a = src_a + dst_a * (1.0 - src_a);

    if out_a > 0.0 {
        for i in 0..3 {
            let src = color[i] as f32;
            let dst = pixel[i] as f32;
            pixel[i] = ((src * src_a + dst * dst_a * (1.0 - src_a)) / out_a) as u8;
        }
        pixel[3] = (out_a * 255.0) as u8;
    }
}

// ============================================================================
// Tile Generation
// ============================================================================

/// Generate a single tile from GPS tracks
pub fn generate_tile(
    z: u8,
    x: u32,
    y: u32,
    tracks: &[Vec<GpsPoint>],
    config: &TileConfig,
) -> TileResult {
    let mut img: RgbaImage = ImageBuffer::from_pixel(
        TILE_SIZE,
        TILE_SIZE,
        Rgba(config.background_color),
    );

    // Draw each track
    for track in tracks {
        let mut prev_pixel: Option<(f32, f32)> = None;

        for point in track {
            if !point.is_valid() {
                prev_pixel = None;
                continue;
            }

            if let Some((px, py)) = gps_to_pixel(point, z, x, y) {
                if let Some((prev_x, prev_y)) = prev_pixel {
                    draw_line_aa(&mut img, prev_x, prev_y, px, py, config.line_color, config.line_width);
                }
                prev_pixel = Some((px, py));
            } else {
                prev_pixel = None;
            }
        }
    }

    // Encode to PNG
    let mut png_data = Vec::new();
    let mut cursor = Cursor::new(&mut png_data);
    img.write_to(&mut cursor, image::ImageFormat::Png)
        .expect("PNG encoding failed");

    TileResult { png_data, z, x, y }
}

/// Generate all tiles for a set of tracks
pub fn generate_all_tiles(
    tracks: &[Vec<GpsPoint>],
    config: &TileConfig,
) -> Vec<TileResult> {
    info!(
        "[generate_all_tiles] Input: {} tracks, zoom {}-{}",
        tracks.len(),
        config.min_zoom,
        config.max_zoom
    );

    let tile_coords = tiles_for_tracks(tracks, config.min_zoom, config.max_zoom);

    info!(
        "[generate_all_tiles] tiles_for_tracks returned {} tile coordinates",
        tile_coords.len()
    );

    if !tile_coords.is_empty() {
        // Show sample tile coordinates
        let sample: Vec<_> = tile_coords.iter().take(5).collect();
        info!("[generate_all_tiles] Sample tiles: {:?}", sample);
    }

    // Generate tiles in parallel using rayon
    let result: Vec<TileResult> = tile_coords
        .into_par_iter()
        .map(|(z, x, y)| generate_tile(z, x, y, tracks, config))
        .collect();

    info!(
        "[generate_all_tiles] Generated {} tiles (parallel)",
        result.len()
    );

    result
}

/// Save a tile to disk
pub fn save_tile(tile: &TileResult, base_path: &Path) -> std::io::Result<()> {
    let tile_path = base_path
        .join(tile.z.to_string())
        .join(tile.x.to_string());

    std::fs::create_dir_all(&tile_path)?;

    let file_path = tile_path.join(format!("{}.png", tile.y));
    std::fs::write(file_path, &tile.png_data)?;

    Ok(())
}

/// Save all tiles to disk
pub fn save_all_tiles(tiles: &[TileResult], base_path: &Path) -> std::io::Result<usize> {
    let mut saved = 0;
    for tile in tiles {
        save_tile(tile, base_path)?;
        saved += 1;
    }
    Ok(saved)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tile_bounds() {
        // Test tile 0/0/0 covers the world
        let bounds = tile_bounds(0, 0, 0);
        assert!((bounds.min_lon - (-180.0)).abs() < 0.001);
        assert!((bounds.max_lon - 180.0).abs() < 0.001);

        // Test higher zoom
        let bounds = tile_bounds(10, 512, 512);
        assert!(bounds.min_lon < bounds.max_lon);
        assert!(bounds.min_lat < bounds.max_lat);
    }

    #[test]
    fn test_lon_lat_to_tile() {
        // London at zoom 10
        let lon = -0.1278;
        let lat = 51.5074;
        let zoom = 10;

        let tx = lon_to_tile_x(lon, zoom);
        let ty = lat_to_tile_y(lat, zoom);

        assert!(tx > 0.0 && tx < 1024.0);
        assert!(ty > 0.0 && ty < 1024.0);
    }

    #[test]
    fn test_gps_to_pixel() {
        let point = GpsPoint::new(51.5074, -0.1278);
        let zoom = 10;
        let tx = lon_to_tile_x(-0.1278, zoom).floor() as u32;
        let ty = lat_to_tile_y(51.5074, zoom).floor() as u32;

        let pixel = gps_to_pixel(&point, zoom, tx, ty);
        assert!(pixel.is_some());

        let (px, py) = pixel.unwrap();
        assert!(px >= 0.0 && px < TILE_SIZE as f32);
        assert!(py >= 0.0 && py < TILE_SIZE as f32);
    }

    #[test]
    fn test_generate_tile() {
        let track = vec![
            GpsPoint::new(51.5074, -0.1278),
            GpsPoint::new(51.5080, -0.1290),
            GpsPoint::new(51.5090, -0.1300),
        ];

        let config = TileConfig::default();
        let zoom = 12;
        let tx = lon_to_tile_x(-0.1278, zoom).floor() as u32;
        let ty = lat_to_tile_y(51.5074, zoom).floor() as u32;

        let tile = generate_tile(zoom, tx, ty, &[track], &config);

        assert_eq!(tile.z, zoom);
        assert!(!tile.png_data.is_empty());
        // PNG magic bytes
        assert_eq!(&tile.png_data[0..4], &[0x89, 0x50, 0x4E, 0x47]);
    }
}
