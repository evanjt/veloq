//! Raster tile generation for activity heatmaps.
//!
//! Generates PNG tiles from GPS traces using web mercator projection.
//! Uses an intensity buffer with additive accumulation and a color gradient
//! LUT to produce heatmap tiles with additive intensity.

use image::{ImageBuffer, Rgba, RgbaImage};
use rayon::prelude::*;
use std::f64::consts::PI;
use std::io::Cursor;
use std::path::Path;
use tracematch::GpsPoint;

/// Tile size in pixels (512 for retina/2x quality on high-DPI mobile screens).
/// MapLibre tileSize stays 256 — it treats 512px images as @2x automatically.
pub const TILE_SIZE: u32 = 512;

/// Heatmap configuration
#[derive(Debug, Clone)]
pub struct HeatmapConfig {
    pub min_zoom: u8,
    pub max_zoom: u8,
}

impl Default for HeatmapConfig {
    fn default() -> Self {
        Self {
            min_zoom: 1,
            max_zoom: 17,
        }
    }
}

// ============================================================================
// Color Gradient LUT
// ============================================================================

/// Default base color for the heatmap gradient when none has been configured.
/// Matches the Veloq brand teal `#14B8A6`.
pub const DEFAULT_HEATMAP_BASE: [u8; 3] = [20, 184, 166];

/// Build a 256-entry gradient LUT from a single base RGB color.
///
/// The gradient ramps from transparent through a darkened version of the base,
/// into the base color itself, and then towards white to preserve contrast on
/// both light and dark map styles. This matches the shape of the previous
/// hard-coded teal LUT so existing alpha/exposure tuning keeps working.
pub fn build_color_lut_for_base(base: [u8; 3]) -> [[u8; 4]; 256] {
    let mut lut = [[0u8; 4]; 256];

    let base_r = base[0] as f32;
    let base_g = base[1] as f32;
    let base_b = base[2] as f32;

    // Darkened shade (mix with black) used at low intensity for subtle traces.
    let dark_mix = 0.65;
    let dark_r = base_r * dark_mix;
    let dark_g = base_g * dark_mix;
    let dark_b = base_b * dark_mix;

    // Brighter shade (mix with white) used as overlap density grows.
    let lerp_to_white = |v: f32, t: f32| v + (255.0 - v) * t;
    let bright_r = lerp_to_white(base_r, 0.3);
    let bright_g = lerp_to_white(base_g, 0.3);
    let bright_b = lerp_to_white(base_b, 0.3);
    let light_r = lerp_to_white(base_r, 0.55);
    let light_g = lerp_to_white(base_g, 0.55);
    let light_b = lerp_to_white(base_b, 0.55);
    let pale_r = lerp_to_white(base_r, 0.75);
    let pale_g = lerp_to_white(base_g, 0.75);
    let pale_b = lerp_to_white(base_b, 0.75);
    let highlight_r = lerp_to_white(base_r, 0.88);
    let highlight_g = lerp_to_white(base_g, 0.88);
    let highlight_b = lerp_to_white(base_b, 0.88);

    // Gradient stops: (intensity, r, g, b, a). Shape mirrors the original teal
    // gradient so the exposure tuning downstream is unaffected by hue.
    let stops: [(f32, f32, f32, f32, f32); 8] = [
        (0.0,  0.0,       0.0,       0.0,       0.0),
        (0.04, dark_r,    dark_g,    dark_b,    28.0),
        (0.14, base_r * 0.85, base_g * 0.85, base_b * 0.85, 80.0),
        (0.32, base_r,    base_g,    base_b,    128.0),
        (0.58, bright_r,  bright_g,  bright_b,  176.0),
        (0.80, light_r,   light_g,   light_b,   216.0),
        (0.94, pale_r,    pale_g,    pale_b,    236.0),
        (1.0,  highlight_r, highlight_g, highlight_b, 246.0),
    ];

    for i in 1..256 {
        let t = i as f32 / 255.0;

        // Find surrounding stops
        let mut lower = 0;
        for s in 0..stops.len() - 1 {
            if stops[s + 1].0 >= t {
                lower = s;
                break;
            }
        }
        let upper = lower + 1;
        let range = stops[upper].0 - stops[lower].0;
        let local_t = if range > 0.0 {
            (t - stops[lower].0) / range
        } else {
            0.0
        };

        let lerp = |a: f32, b: f32| -> u8 { (a + (b - a) * local_t).clamp(0.0, 255.0) as u8 };
        lut[i] = [
            lerp(stops[lower].1, stops[upper].1),
            lerp(stops[lower].2, stops[upper].2),
            lerp(stops[lower].3, stops[upper].3),
            lerp(stops[lower].4, stops[upper].4),
        ];
    }
    lut
}

/// Cached default color LUT (built once, used when no custom color is set).
static DEFAULT_COLOR_LUT: std::sync::LazyLock<[[u8; 4]; 256]> =
    std::sync::LazyLock::new(|| build_color_lut_for_base(DEFAULT_HEATMAP_BASE));

/// Cached fully transparent PNG used for empty raster tiles.
static EMPTY_TILE_PNG: std::sync::LazyLock<Vec<u8>> = std::sync::LazyLock::new(|| {
    let img: RgbaImage = ImageBuffer::from_pixel(TILE_SIZE, TILE_SIZE, Rgba([0, 0, 0, 0]));
    let mut png_data = Vec::new();
    let mut cursor = Cursor::new(&mut png_data);
    img.write_to(&mut cursor, image::ImageFormat::Png)
        .expect("Empty tile PNG encoding failed");
    png_data
});

// ============================================================================
// Zoom-Dependent Line Width
// ============================================================================

/// Get line width for a zoom level (doubled for 512px tile size)
fn line_width_for_zoom(zoom: u8) -> f32 {
    match zoom {
        0..=6 => 6.0,
        7..=8 => 5.0,
        9..=10 => 4.0,
        11..=12 => 3.2,
        13..=14 => 2.6,
        15 => 2.1,
        16 => 1.7,
        _ => 1.4,
    }
}

/// Base intensity per line draw (higher at low zoom for visibility)
fn line_intensity_for_zoom(zoom: u8) -> f32 {
    match zoom {
        0..=8 => 18.0,
        9..=11 => 16.0,
        12..=14 => 14.0,
        15..=16 => 12.0,
        _ => 10.0,
    }
}

/// Exposure for mapping accumulated line intensity into the color LUT.
/// Lower values make sparse traces brighter; higher values preserve detail in dense overlap.
fn intensity_exposure_for_zoom(zoom: u8) -> f32 {
    match zoom {
        0..=8 => 54.0,
        9..=11 => 42.0,
        12..=14 => 32.0,
        15..=16 => 24.0,
        _ => 18.0,
    }
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
        max_lat: tile_y_to_lat(y as f64, z),
        min_lat: tile_y_to_lat((y + 1) as f64, z),
    }
}

/// Bounds of a tile in WGS84 coordinates
#[derive(Debug, Clone, Copy)]
pub struct TileBounds {
    pub min_lon: f64,
    pub max_lon: f64,
    pub min_lat: f64,
    pub max_lat: f64,
}

/// Convert GPS point to pixel coordinates within a tile.
/// Returns None if the point is too far outside the tile.
#[inline]
pub fn gps_to_pixel(point: &GpsPoint, z: u8, tile_x: u32, tile_y: u32) -> Option<(f32, f32)> {
    let global_x = lon_to_tile_x(point.longitude, z);
    let global_y = lat_to_tile_y(point.latitude, z);

    let px = ((global_x - tile_x as f64) * TILE_SIZE as f64) as f32;
    let py = ((global_y - tile_y as f64) * TILE_SIZE as f64) as f32;

    // Allow margin outside tile for line continuity (scaled for 512px tiles)
    let margin = 100.0;
    if px >= -margin
        && px < (TILE_SIZE as f32 + margin)
        && py >= -margin
        && py < (TILE_SIZE as f32 + margin)
    {
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
        let tx = lon_to_tile_x(point.longitude, zoom).floor() as u32;
        let ty = lat_to_tile_y(point.latitude, zoom).floor() as u32;
        tiles.insert((tx, ty));
    }
    tiles.into_iter().collect()
}

/// Enumerate tile coordinates for a bounding box at a given zoom level
pub fn tiles_for_bounds(
    min_lat: f64,
    max_lat: f64,
    min_lng: f64,
    max_lng: f64,
    zoom: u8,
) -> Vec<(u32, u32)> {
    let x_min = lon_to_tile_x(min_lng, zoom).floor() as u32;
    let x_max = lon_to_tile_x(max_lng, zoom).floor() as u32;
    let y_min = lat_to_tile_y(max_lat, zoom).floor() as u32; // Y is inverted
    let y_max = lat_to_tile_y(min_lat, zoom).floor() as u32;

    let mut tiles = Vec::new();
    for x in x_min..=x_max {
        for y in y_min..=y_max {
            tiles.push((x, y));
        }
    }
    tiles
}

// ============================================================================
// Intensity Buffer Line Rasterization
// ============================================================================

/// Intensity buffer for accumulating line draws before color mapping
pub struct IntensityBuffer {
    data: Vec<u16>,
    width: u32,
    height: u32,
}

impl IntensityBuffer {
    fn new(width: u32, height: u32) -> Self {
        Self {
            data: vec![0u16; (width * height) as usize],
            width,
            height,
        }
    }

    /// Additively accumulate intensity at a pixel
    #[inline]
    fn add(&mut self, x: i32, y: i32, value: u16) {
        if x < 0 || y < 0 || x >= self.width as i32 || y >= self.height as i32 {
            return;
        }
        let idx = (y as u32 * self.width + x as u32) as usize;
        self.data[idx] = self.data[idx].saturating_add(value);
    }

    /// Additively accumulate a fractional intensity at a pixel
    #[inline]
    fn add_f(&mut self, x: i32, y: i32, brightness: f32, base_intensity: f32) {
        let value = (base_intensity * brightness.clamp(0.0, 1.0)).round() as u16;
        if value > 0 {
            self.add(x, y, value);
        }
    }

    #[inline]
    fn get(&self, x: u32, y: u32) -> u16 {
        self.data[(y * self.width + x) as usize]
    }

    /// Check if the buffer has any non-zero values
    fn is_empty(&self) -> bool {
        self.data.iter().all(|&v| v == 0)
    }
}

#[inline]
fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    if edge0 >= edge1 {
        return if x >= edge1 { 1.0 } else { 0.0 };
    }
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[inline]
fn distance_to_segment(px: f32, py: f32, x0: f32, y0: f32, x1: f32, y1: f32) -> f32 {
    let dx = x1 - x0;
    let dy = y1 - y0;
    let len_sq = dx * dx + dy * dy;

    if len_sq <= 0.0001 {
        let ddx = px - x0;
        let ddy = py - y0;
        return (ddx * ddx + ddy * ddy).sqrt();
    }

    let t = (((px - x0) * dx + (py - y0) * dy) / len_sq).clamp(0.0, 1.0);
    let proj_x = x0 + dx * t;
    let proj_y = y0 + dy * t;
    let ddx = px - proj_x;
    let ddy = py - proj_y;
    (ddx * ddx + ddy * ddy).sqrt()
}

fn draw_disc_intensity(buf: &mut IntensityBuffer, cx: f32, cy: f32, radius: f32, intensity: f32) {
    let aa = 1.0;
    let outer = radius + aa;
    let min_x = (cx - outer).floor().max(0.0) as i32;
    let max_x = (cx + outer).ceil().min(buf.width as f32 - 1.0) as i32;
    let min_y = (cy - outer).floor().max(0.0) as i32;
    let max_y = (cy + outer).ceil().min(buf.height as f32 - 1.0) as i32;

    for y in min_y..=max_y {
        for x in min_x..=max_x {
            let px = x as f32 + 0.5;
            let py = y as f32 + 0.5;
            let dx = px - cx;
            let dy = py - cy;
            let dist = (dx * dx + dy * dy).sqrt();
            let coverage = 1.0 - smoothstep(radius, outer, dist);
            buf.add_f(x, y, coverage, intensity);
        }
    }
}

/// Draw a line as a filled, antialiased stroke with round caps.
fn draw_line_intensity(
    buf: &mut IntensityBuffer,
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
    width: f32,
    intensity: f32,
) {
    let radius = (width * 0.5).max(0.75);
    let aa = 1.0;
    let outer = radius + aa;
    let dx = x1 - x0;
    let dy = y1 - y0;

    if dx.abs() < 0.001 && dy.abs() < 0.001 {
        draw_disc_intensity(buf, x0, y0, radius, intensity);
        return;
    }

    let min_x = (x0.min(x1) - outer).floor().max(0.0) as i32;
    let max_x = (x0.max(x1) + outer).ceil().min(buf.width as f32 - 1.0) as i32;
    let min_y = (y0.min(y1) - outer).floor().max(0.0) as i32;
    let max_y = (y0.max(y1) + outer).ceil().min(buf.height as f32 - 1.0) as i32;

    for y in min_y..=max_y {
        for x in min_x..=max_x {
            let px = x as f32 + 0.5;
            let py = y as f32 + 0.5;
            let dist = distance_to_segment(px, py, x0, y0, x1, y1);
            let coverage = 1.0 - smoothstep(radius, outer, dist);
            buf.add_f(x, y, coverage, intensity);
        }
    }
}

// ============================================================================
// Gaussian Blur
// ============================================================================

/// Apply a 3x3 Gaussian blur to the intensity buffer.
/// Used at lower zoom levels to soften the heatmap.
fn gaussian_blur_3x3(buf: &IntensityBuffer) -> IntensityBuffer {
    // 3x3 Gaussian kernel (sum = 16, use bit shift for speed)
    let kernel: [[u16; 3]; 3] = [[1, 2, 1], [2, 4, 2], [1, 2, 1]];

    let mut out = IntensityBuffer::new(buf.width, buf.height);
    let w = buf.width as i32;
    let h = buf.height as i32;

    for y in 0..h {
        for x in 0..w {
            let mut sum: u32 = 0;
            for ky in 0..3i32 {
                for kx in 0..3i32 {
                    let sx = (x + kx - 1).clamp(0, w - 1) as u32;
                    let sy = (y + ky - 1).clamp(0, h - 1) as u32;
                    sum += buf.get(sx, sy) as u32 * kernel[ky as usize][kx as usize] as u32;
                }
            }
            out.data[(y as u32 * buf.width + x as u32) as usize] =
                ((sum >> 4).min(u16::MAX as u32)) as u16;
        }
    }
    out
}

// ============================================================================
// Tile Generation
// ============================================================================

/// Generate a single heatmap tile from GPS tracks.
/// Returns PNG bytes, or None if the tile contains no data.
///
/// `color_lut` is a pre-computed gradient LUT. Use `DEFAULT_COLOR_LUT` for the
/// brand teal gradient, or build one with [`build_color_lut_for_base`].
pub fn generate_heatmap_tile_with_lut(
    z: u8,
    x: u32,
    y: u32,
    tracks: &[Vec<GpsPoint>],
    color_lut: &[[u8; 4]; 256],
) -> Option<Vec<u8>> {
    let line_width = line_width_for_zoom(z);
    let intensity = line_intensity_for_zoom(z);

    let mut buf = IntensityBuffer::new(TILE_SIZE, TILE_SIZE);

    // Draw each track onto the intensity buffer
    for track in tracks {
        let mut prev_pixel: Option<(f32, f32)> = None;

        for point in track {
            if !point.is_valid() {
                prev_pixel = None;
                continue;
            }

            if let Some((px, py)) = gps_to_pixel(point, z, x, y) {
                if let Some((prev_x, prev_y)) = prev_pixel {
                    draw_line_intensity(&mut buf, prev_x, prev_y, px, py, line_width, intensity);
                }
                prev_pixel = Some((px, py));
            } else {
                prev_pixel = None;
            }
        }
    }

    // Skip empty tiles entirely
    if buf.is_empty() {
        return None;
    }

    // Apply Gaussian blur only at lower zoom levels where density matters more than street detail.
    let buf = if z <= 9 { gaussian_blur_3x3(&buf) } else { buf };

    // Map intensity buffer to RGBA using a fixed exposure curve.
    // This preserves overlap without letting moderate-density tiles blow out to white.
    let lut = color_lut;
    let exposure = intensity_exposure_for_zoom(z);
    let mut img: RgbaImage = ImageBuffer::new(TILE_SIZE, TILE_SIZE);
    for y_px in 0..TILE_SIZE {
        for x_px in 0..TILE_SIZE {
            let val = buf.get(x_px, y_px);
            if val > 0 {
                let normalized = (1.0 - (-(val as f32) / exposure).exp()).clamp(0.0, 1.0);
                let lut_idx = (normalized * 255.0).round().clamp(1.0, 255.0) as usize;
                let c = lut[lut_idx];
                img.put_pixel(x_px, y_px, Rgba(c));
            }
        }
    }

    // Encode to PNG
    let mut png_data = Vec::new();
    let mut cursor = Cursor::new(&mut png_data);
    img.write_to(&mut cursor, image::ImageFormat::Png)
        .expect("PNG encoding failed");

    Some(png_data)
}

/// Convenience wrapper that uses the default (brand teal) gradient.
pub fn generate_heatmap_tile(z: u8, x: u32, y: u32, tracks: &[Vec<GpsPoint>]) -> Option<Vec<u8>> {
    generate_heatmap_tile_with_lut(z, x, y, tracks, &DEFAULT_COLOR_LUT)
}

/// Generate heatmap tiles for a set of tile coordinates.
/// Returns vec of (z, x, y, png_bytes) for non-empty tiles.
pub fn generate_tiles_parallel(
    tile_coords: &[(u8, u32, u32)],
    tracks: &[Vec<GpsPoint>],
) -> Vec<(u8, u32, u32, Vec<u8>)> {
    tile_coords
        .par_iter()
        .filter_map(|&(z, x, y)| generate_heatmap_tile(z, x, y, tracks).map(|png| (z, x, y, png)))
        .collect()
}

/// Save a tile PNG to disk at the standard z/x/y.png path
pub fn save_tile(base_path: &Path, z: u8, x: u32, y: u32, png_data: &[u8]) -> std::io::Result<()> {
    let tile_dir = base_path.join(z.to_string()).join(x.to_string());
    std::fs::create_dir_all(&tile_dir)?;
    std::fs::write(tile_dir.join(format!("{}.png", y)), png_data)
}

/// Write a valid transparent PNG to mark an empty tile (prevents re-generation).
/// MapLibre still decodes requested raster tiles, so a 0-byte sentinel will log
/// bitmap decode errors on Android.
pub fn save_empty_sentinel(base_path: &Path, z: u8, x: u32, y: u32) -> std::io::Result<()> {
    let tile_dir = base_path.join(z.to_string()).join(x.to_string());
    std::fs::create_dir_all(&tile_dir)?;
    std::fs::write(tile_dir.join(format!("{}.png", y)), &*EMPTY_TILE_PNG)
}

/// Check if a tile file already exists on disk (including transparent empty tiles)
pub fn tile_exists(base_path: &Path, z: u8, x: u32, y: u32) -> bool {
    base_path
        .join(z.to_string())
        .join(x.to_string())
        .join(format!("{}.png", y))
        .exists()
}

/// Delete tile files within a bounding box across all zoom levels
pub fn invalidate_tiles_in_bounds(
    base_path: &Path,
    min_lat: f64,
    max_lat: f64,
    min_lng: f64,
    max_lng: f64,
    min_zoom: u8,
    max_zoom: u8,
) -> u32 {
    let mut deleted = 0u32;
    for z in min_zoom..=max_zoom {
        let tiles = tiles_for_bounds(min_lat, max_lat, min_lng, max_lng, z);
        for (x, y) in tiles {
            let path = base_path
                .join(z.to_string())
                .join(x.to_string())
                .join(format!("{}.png", y));
            if path.exists() {
                if std::fs::remove_file(&path).is_ok() {
                    deleted += 1;
                }
            }
        }
    }
    deleted
}

/// Clear all heatmap tiles from disk
pub fn clear_all_tiles(base_path: &Path) -> u32 {
    let mut deleted = 0u32;
    if base_path.exists() {
        if let Ok(entries) = std::fs::read_dir(base_path) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    if std::fs::remove_dir_all(entry.path()).is_ok() {
                        deleted += 1;
                    }
                }
            }
        }
    }
    deleted
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tile_bounds() {
        let bounds = tile_bounds(0, 0, 0);
        assert!((bounds.min_lon - (-180.0)).abs() < 0.001);
        assert!((bounds.max_lon - 180.0).abs() < 0.001);

        let bounds = tile_bounds(10, 512, 512);
        assert!(bounds.min_lon < bounds.max_lon);
        assert!(bounds.min_lat < bounds.max_lat);
    }

    #[test]
    fn test_lon_lat_to_tile() {
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
    fn test_generate_heatmap_tile() {
        let track = vec![
            GpsPoint::new(51.5074, -0.1278),
            GpsPoint::new(51.5080, -0.1290),
            GpsPoint::new(51.5090, -0.1300),
        ];
        let zoom = 12;
        let tx = lon_to_tile_x(-0.1278, zoom).floor() as u32;
        let ty = lat_to_tile_y(51.5074, zoom).floor() as u32;
        let result = generate_heatmap_tile(zoom, tx, ty, &[track]);
        assert!(result.is_some());
        let png_data = result.unwrap();
        assert!(!png_data.is_empty());
        // PNG magic bytes
        assert_eq!(&png_data[0..4], &[0x89, 0x50, 0x4E, 0x47]);
    }

    #[test]
    fn test_empty_tile_returns_none() {
        // Tile far from the track
        let track = vec![
            GpsPoint::new(51.5074, -0.1278),
            GpsPoint::new(51.5080, -0.1290),
        ];
        let result = generate_heatmap_tile(12, 0, 0, &[track]);
        assert!(result.is_none());
    }

    #[test]
    fn test_tiles_for_bounds() {
        let tiles = tiles_for_bounds(51.0, 52.0, -1.0, 0.0, 10);
        assert!(!tiles.is_empty());
    }

    #[test]
    fn test_color_lut() {
        let lut = &*DEFAULT_COLOR_LUT;
        // Index 0 is transparent
        assert_eq!(lut[0], [0, 0, 0, 0]);
        // Index 255 should be bright
        assert!(lut[255][3] > 200);
        // Monotonically increasing alpha
        assert!(lut[128][3] > lut[1][3]);
    }

    #[test]
    fn test_build_color_lut_from_base() {
        // Orange brand color
        let lut = build_color_lut_for_base([252, 76, 2]);
        assert_eq!(lut[0], [0, 0, 0, 0]);
        // Mid-range should be close to the base hue (orange-dominant channel)
        assert!(lut[128][0] > lut[128][1]);
        assert!(lut[128][0] > lut[128][2]);
        assert!(lut[255][3] > 200);
    }

    #[test]
    fn test_additive_accumulation() {
        let mut buf = IntensityBuffer::new(10, 10);
        buf.add(5, 5, 100);
        buf.add(5, 5, 100);
        assert_eq!(buf.get(5, 5), 200);
        buf.add(5, 5, u16::MAX);
        assert_eq!(buf.get(5, 5), u16::MAX);
    }

    #[test]
    fn test_thick_line_rasterization_produces_solid_center() {
        let mut buf = IntensityBuffer::new(32, 32);
        draw_line_intensity(&mut buf, 4.0, 16.0, 28.0, 16.0, 6.0, 24.0);

        for x in 6..27 {
            assert!(buf.get(x, 16) > 0, "expected solid stroke center at x={x}");
        }
        assert!(buf.get(16, 14) > 0);
        assert!(buf.get(16, 18) > 0);
    }
}
