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

/// Pre-computed 256-entry color lookup table mapping intensity to RGBA.
/// Gradient: transparent → deep teal → brand teal → pale teal highlight.
/// Uses the Veloq brand teal palette for good contrast on both light and dark maps.
fn build_color_lut() -> [[u8; 4]; 256] {
    let mut lut = [[0u8; 4]; 256];

    // Gradient stops: (intensity, r, g, b, a)
    let stops: &[(f32, f32, f32, f32, f32)] = &[
        (0.0,   0.0,   0.0,   0.0,   0.0),         // transparent
        (0.04,  13.0,  148.0, 136.0, 28.0),         // subtle teal (#0D9488)
        (0.14,  16.0,  163.0, 150.0, 80.0),         // visible teal
        (0.32,  20.0,  184.0, 166.0, 128.0),        // brand teal (#14B8A6)
        (0.58,  45.0,  212.0, 191.0, 176.0),        // bright teal (#2DD4BF)
        (0.80,  94.0,  234.0, 212.0, 216.0),        // light teal (#5EEAD4)
        (0.94,  153.0, 246.0, 228.0, 236.0),        // pale teal
        (1.0,   204.0, 251.0, 241.0, 246.0),        // very pale teal highlight
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

/// Cached color LUT (built once)
static COLOR_LUT: std::sync::LazyLock<[[u8; 4]; 256]> = std::sync::LazyLock::new(build_color_lut);

/// Pre-computed `u16 intensity → u8 lut_idx` table for a given exposure.
/// Replaces the per-pixel exp()/round/clamp in the color mapping loop.
fn build_intensity_idx_lut(exposure: f32) -> Box<[u8; 65536]> {
    let mut v: Vec<u8> = vec![0u8; 65536];
    // Index 0 stays 0 (skip write path in the hot loop).
    for val in 1..65536u32 {
        let normalized = (1.0 - (-(val as f32) / exposure).exp()).clamp(0.0, 1.0);
        let idx = (normalized * 255.0).round().clamp(1.0, 255.0) as u8;
        v[val as usize] = idx;
    }
    let slice: Box<[u8]> = v.into_boxed_slice();
    // Length is fixed at 65536 by construction.
    let ptr = Box::into_raw(slice) as *mut [u8; 65536];
    // SAFETY: `slice` was constructed from a Vec with exactly 65536 bytes.
    unsafe { Box::from_raw(ptr) }
}

static IDX_LUT_Z0_8: std::sync::LazyLock<Box<[u8; 65536]>> =
    std::sync::LazyLock::new(|| build_intensity_idx_lut(54.0));
static IDX_LUT_Z9_11: std::sync::LazyLock<Box<[u8; 65536]>> =
    std::sync::LazyLock::new(|| build_intensity_idx_lut(42.0));
static IDX_LUT_Z12_14: std::sync::LazyLock<Box<[u8; 65536]>> =
    std::sync::LazyLock::new(|| build_intensity_idx_lut(32.0));
static IDX_LUT_Z15_16: std::sync::LazyLock<Box<[u8; 65536]>> =
    std::sync::LazyLock::new(|| build_intensity_idx_lut(24.0));
static IDX_LUT_Z17P: std::sync::LazyLock<Box<[u8; 65536]>> =
    std::sync::LazyLock::new(|| build_intensity_idx_lut(18.0));

/// Resolve the `u16 → u8 lut_idx` table for a given zoom level.
/// Mirrors the exposure bands in `intensity_exposure_for_zoom`.
fn intensity_idx_lut_for_zoom(zoom: u8) -> &'static [u8; 65536] {
    match zoom {
        0..=8 => &IDX_LUT_Z0_8,
        9..=11 => &IDX_LUT_Z9_11,
        12..=14 => &IDX_LUT_Z12_14,
        15..=16 => &IDX_LUT_Z15_16,
        _ => &IDX_LUT_Z17P,
    }
}

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

// Note: the raw exposure curve is baked into `intensity_idx_lut_for_zoom` at
// module init. The legacy float function is no longer on the hot path.

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

/// Sweep the polyline through tile space at a given zoom, returning every
/// tile a line segment crosses plus a one-tile neighbour halo (to match the
/// 100 px margin used by `gps_to_pixel` so antialiased strokes that bleed
/// into adjacent tiles are still scheduled for generation).
///
/// Much tighter than `tiles_for_bounds`: a long point-to-point activity
/// enumerates ~O(segments) tiles instead of the full bbox rectangle.
pub fn tiles_along_track(points: &[GpsPoint], zoom: u8) -> std::collections::HashSet<(u32, u32)> {
    let max_xy: i64 = (1i64 << zoom).max(1);
    let mut tiles: std::collections::HashSet<(u32, u32)> = std::collections::HashSet::new();

    let mut add_with_halo = |tiles: &mut std::collections::HashSet<(u32, u32)>, tx: i64, ty: i64| {
        for dy in -1..=1 {
            for dx in -1..=1 {
                let nx = tx + dx;
                let ny = ty + dy;
                if nx >= 0 && ny >= 0 && nx < max_xy && ny < max_xy {
                    tiles.insert((nx as u32, ny as u32));
                }
            }
        }
    };

    let mut prev_tile: Option<(i64, i64)> = None;
    let mut prev_valid: Option<(f64, f64)> = None;
    for point in points {
        if !point.is_valid() {
            prev_tile = None;
            prev_valid = None;
            continue;
        }
        let gx = lon_to_tile_x(point.longitude, zoom);
        let gy = lat_to_tile_y(point.latitude, zoom);
        let tx = gx.floor() as i64;
        let ty = gy.floor() as i64;
        add_with_halo(&mut tiles, tx, ty);

        if let Some((px, py)) = prev_valid {
            sweep_line_tiles(
                &mut tiles,
                &mut add_with_halo,
                px,
                py,
                gx,
                gy,
            );
        }

        prev_tile = Some((tx, ty));
        prev_valid = Some((gx, gy));
    }
    let _ = prev_tile;
    tiles
}

/// Bresenham-style supercover: walk integer tile coords from (x0,y0) to
/// (x1,y1) in fractional-tile space and call `add_with_halo` at each step.
/// The halo function handles out-of-bounds and neighbour inclusion.
fn sweep_line_tiles<F>(
    tiles: &mut std::collections::HashSet<(u32, u32)>,
    add_with_halo: &mut F,
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
) where
    F: FnMut(&mut std::collections::HashSet<(u32, u32)>, i64, i64),
{
    let ix0 = x0.floor() as i64;
    let iy0 = y0.floor() as i64;
    let ix1 = x1.floor() as i64;
    let iy1 = y1.floor() as i64;

    let dx = (ix1 - ix0).abs();
    let dy = -(iy1 - iy0).abs();
    let sx: i64 = if ix0 < ix1 { 1 } else { -1 };
    let sy: i64 = if iy0 < iy1 { 1 } else { -1 };
    let mut err = dx + dy;
    let mut x = ix0;
    let mut y = iy0;
    // Cap iterations to defend against pathologically long jumps (e.g. a
    // GPS glitch across the globe). 2^17 * 2 is larger than any real ride
    // touches.
    let limit = 400_000i64;
    let mut steps = 0i64;
    loop {
        add_with_halo(tiles, x, y);
        if x == ix1 && y == iy1 {
            break;
        }
        let e2 = 2 * err;
        if e2 >= dy {
            err += dy;
            x += sx;
        }
        if e2 <= dx {
            err += dx;
            y += sy;
        }
        steps += 1;
        if steps > limit {
            break;
        }
    }
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
/// Accepts anything that yields a `&[GpsPoint]` per track so callers can pass
/// `Vec<Vec<GpsPoint>>`, `Vec<&[GpsPoint]>`, or `Vec<Arc<Vec<GpsPoint>>>`
/// without deep-cloning.
pub fn generate_heatmap_tile<T: AsRef<[GpsPoint]>>(
    z: u8,
    x: u32,
    y: u32,
    tracks: &[T],
) -> Option<Vec<u8>> {
    let line_width = line_width_for_zoom(z);
    let intensity = line_intensity_for_zoom(z);

    let mut buf = IntensityBuffer::new(TILE_SIZE, TILE_SIZE);

    // Draw each track onto the intensity buffer
    for track in tracks {
        let track = track.as_ref();
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

    // Map intensity buffer to RGBA via two pre-computed LUTs:
    //   u16 intensity → u8 color idx (depends on zoom's exposure curve)
    //   u8 color idx  → RGBA (shared gradient)
    // Replaces the per-pixel exp()/round/clamp from the original code;
    // pixel output is bit-identical because the f32 math is pre-computed
    // once at the same precision.
    let color_lut = &*COLOR_LUT;
    let idx_lut = intensity_idx_lut_for_zoom(z);
    let mut img: RgbaImage = ImageBuffer::new(TILE_SIZE, TILE_SIZE);
    for y_px in 0..TILE_SIZE {
        for x_px in 0..TILE_SIZE {
            let val = buf.get(x_px, y_px);
            if val > 0 {
                let lut_idx = idx_lut[val as usize] as usize;
                let c = color_lut[lut_idx];
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

/// Generate heatmap tiles for a set of tile coordinates.
/// Returns vec of (z, x, y, png_bytes) for non-empty tiles.
pub fn generate_tiles_parallel<T>(
    tile_coords: &[(u8, u32, u32)],
    tracks: &[T],
) -> Vec<(u8, u32, u32, Vec<u8>)>
where
    T: AsRef<[GpsPoint]> + Sync,
{
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
    fn tiles_along_track_includes_every_point_tile() {
        let track = vec![
            GpsPoint::new(51.5074, -0.1278),
            GpsPoint::new(51.5080, -0.1290),
            GpsPoint::new(51.5090, -0.1300),
        ];
        let zoom = 14;
        let swept = tiles_along_track(&track, zoom);
        for p in &track {
            let tx = lon_to_tile_x(p.longitude, zoom).floor() as u32;
            let ty = lat_to_tile_y(p.latitude, zoom).floor() as u32;
            assert!(
                swept.contains(&(tx, ty)),
                "sweep missed point's own tile ({tx},{ty})"
            );
        }
    }

    #[test]
    fn tiles_along_track_is_tight_vs_bbox() {
        // A long point-to-point track (several km of span each axis) should
        // enumerate far fewer tiles than its bbox at high zoom.
        let mut track = Vec::new();
        for i in 0..500 {
            let lat = 47.37 + (i as f64) * 0.0005;
            let lng = 8.55 + (i as f64) * 0.0007;
            track.push(GpsPoint::new(lat, lng));
        }
        let zoom = 17;
        let swept = tiles_along_track(&track, zoom);
        let bbox = tiles_for_bounds(
            track.iter().map(|p| p.latitude).fold(f64::INFINITY, f64::min),
            track.iter().map(|p| p.latitude).fold(f64::NEG_INFINITY, f64::max),
            track.iter().map(|p| p.longitude).fold(f64::INFINITY, f64::min),
            track.iter().map(|p| p.longitude).fold(f64::NEG_INFINITY, f64::max),
            zoom,
        );
        // Diagonal track: bbox counts every tile in a rectangle; sweep only
        // counts the diagonal strip plus halo.
        assert!(
            swept.len() * 2 < bbox.len(),
            "sweep did not beat bbox: swept={} bbox={}",
            swept.len(),
            bbox.len()
        );
    }

    #[test]
    fn tiles_along_track_handles_invalid_points() {
        let track = vec![
            GpsPoint::new(51.5074, -0.1278),
            GpsPoint::new(f64::NAN, f64::NAN),
            GpsPoint::new(51.5080, -0.1290),
        ];
        // Should not panic, should still include the two valid points' tiles.
        let swept = tiles_along_track(&track, 14);
        assert!(!swept.is_empty());
    }

    #[test]
    fn tiles_along_track_segment_includes_between_tiles() {
        // Two points 5 tiles apart at z14; the diagonal between them should
        // enumerate the intermediate tiles.
        let zoom = 14;
        let p0 = GpsPoint::new(51.5074, -0.1278);
        let p1 = GpsPoint::new(51.5074 + 0.0020, -0.1278 + 0.0020);
        let swept = tiles_along_track(&[p0, p1], zoom);
        // Expect at least 3 distinct tile coords (segment length > 1 tile).
        assert!(
            swept.len() >= 3,
            "segment sweep too small: {}",
            swept.len()
        );
    }

    #[test]
    fn test_color_lut() {
        let lut = &*COLOR_LUT;
        // Index 0 is transparent
        assert_eq!(lut[0], [0, 0, 0, 0]);
        // Index 255 should be bright
        assert!(lut[255][3] > 200);
        // Monotonically increasing alpha
        assert!(lut[128][3] > lut[1][3]);
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
