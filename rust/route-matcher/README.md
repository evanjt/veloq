# route-matcher

High-performance GPS route matching using Fréchet distance and spatial indexing.

## Features

- **Fréchet Distance Matching** - Accurate polyline similarity using the Fréchet distance algorithm
- **Bidirectional Detection** - Automatically detects forward and reverse route matches
- **R-tree Spatial Indexing** - O(log n) pre-filtering for batch operations
- **Parallel Processing** - Optional rayon-based parallel grouping for large datasets
- **Mobile FFI** - Optional UniFFI bindings for iOS and Android

## Installation

Add to your `Cargo.toml`:

```toml
[dependencies]
route-matcher = "0.1"
```

For parallel processing (recommended for batch operations):

```toml
[dependencies]
route-matcher = { version = "0.1", features = ["parallel"] }
```

## Quick Start

```rust
use route_matcher::{GpsPoint, RouteSignature, MatchConfig, compare_routes};

// Create GPS points for two routes
let route1 = vec![
    GpsPoint::new(51.5074, -0.1278),
    GpsPoint::new(51.5080, -0.1290),
    GpsPoint::new(51.5090, -0.1300),
];

let route2 = route1.clone();

// Create signatures (simplified for efficient comparison)
let config = MatchConfig::default();
let sig1 = RouteSignature::from_points("route-1", &route1, &config).unwrap();
let sig2 = RouteSignature::from_points("route-2", &route2, &config).unwrap();

// Compare routes
if let Some(result) = compare_routes(&sig1, &sig2, &config) {
    println!("Match: {}%", result.match_percentage);
    println!("Direction: {}", result.direction); // "forward" or "reverse"
}
```

## Batch Grouping

For grouping many routes efficiently:

```rust
use route_matcher::{GpsPoint, RouteSignature, MatchConfig, group_signatures};

// Create signatures for all your routes
let signatures: Vec<RouteSignature> = routes
    .iter()
    .filter_map(|(id, points)| RouteSignature::from_points(id, points, &config))
    .collect();

// Group similar routes
let groups = group_signatures(&signatures, &config);

for group in groups {
    println!("Group {}: {:?}", group.group_id, group.activity_ids);
}
```

With the `parallel` feature, use `group_signatures_parallel` for better performance on large datasets:

```rust
use route_matcher::group_signatures_parallel;

let groups = group_signatures_parallel(&signatures, &config);
```

## Configuration

```rust
use route_matcher::MatchConfig;

// Default configuration
let config = MatchConfig::default();
// max_frechet_distance: 100m
// min_match_percentage: 80%
// simplification_tolerance: 0.0001 (~11m)
// max_simplified_points: 50

// Fast preset (for quick matching, less accurate)
let fast = MatchConfig::fast();

// Precise preset (for accurate matching, slower)
let precise = MatchConfig::precise();

// Custom configuration
let custom = MatchConfig::new(
    150.0,  // max_frechet_distance (meters)
    75.0,   // min_match_percentage
    0.0002, // simplification_tolerance (degrees)
    40,     // max_simplified_points
);
```

## How It Works

1. **Signature Creation**: GPS tracks are simplified using Douglas-Peucker algorithm and limited to a maximum number of points.

2. **Spatial Pre-filtering**: An R-tree index enables O(log n) filtering of candidate pairs based on bounding box overlap.

3. **Distance Pre-filtering**: Routes with significantly different total distances (>50% difference) are skipped.

4. **Fréchet Distance**: The actual comparison uses Fréchet distance, which measures the maximum deviation between two curves. This is more accurate than point-by-point comparison for GPS tracks.

5. **Bidirectional Matching**: Both forward and reverse directions are checked, with the better match used.

6. **Union-Find Grouping**: Matched routes are grouped using an efficient Union-Find data structure.

## Feature Flags

| Feature | Description |
|---------|-------------|
| `parallel` | Enable parallel processing with rayon |
| `ffi` | Enable FFI bindings for mobile (iOS/Android) via UniFFI |
| `full` | Enable all features |

## Examples

Run the examples:

```bash
# Basic route comparison
cargo run --example basic_matching

# Batch grouping with parallel processing
cargo run --example batch_grouping --features parallel
```

## Mobile Usage

For iOS and Android, enable the `ffi` feature and build with the appropriate targets:

```bash
# iOS
cargo build --release --target aarch64-apple-ios --features ffi,parallel

# Android
cargo build --release --target aarch64-linux-android --features ffi,parallel
```

See the mobile integration guide for setting up UniFFI bindings in React Native/Expo.

## License

MIT OR Apache-2.0
