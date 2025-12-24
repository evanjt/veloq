//! Example of batch grouping many routes.
//!
//! Run with: cargo run --example batch_grouping --features parallel

use route_matcher::{group_signatures_parallel, GpsPoint, MatchConfig, RouteSignature};
use std::time::Instant;

fn main() {
    println!("Batch Route Grouping Example\n");

    // Create sample routes with variations
    let base_route_london = vec![
        GpsPoint::new(51.5074, -0.1278),
        GpsPoint::new(51.5080, -0.1290),
        GpsPoint::new(51.5090, -0.1300),
        GpsPoint::new(51.5100, -0.1310),
        GpsPoint::new(51.5110, -0.1320),
    ];

    let base_route_paris = vec![
        GpsPoint::new(48.8566, 2.3522),
        GpsPoint::new(48.8576, 2.3532),
        GpsPoint::new(48.8586, 2.3542),
        GpsPoint::new(48.8596, 2.3552),
        GpsPoint::new(48.8606, 2.3562),
    ];

    let base_route_nyc = vec![
        GpsPoint::new(40.7128, -74.0060),
        GpsPoint::new(40.7138, -74.0070),
        GpsPoint::new(40.7148, -74.0080),
        GpsPoint::new(40.7158, -74.0090),
        GpsPoint::new(40.7168, -74.0100),
    ];

    let config = MatchConfig::default();
    let mut signatures = Vec::new();

    // Create variations of each base route
    // London: 5 similar routes (including reverse)
    for i in 0..3 {
        let route = add_noise(&base_route_london, 0.00001 * i as f64);
        if let Some(sig) = RouteSignature::from_points(&format!("london-{}", i), &route, &config) {
            signatures.push(sig);
        }
    }
    // Add reversed London route
    let mut reversed = base_route_london.clone();
    reversed.reverse();
    if let Some(sig) = RouteSignature::from_points("london-reverse", &reversed, &config) {
        signatures.push(sig);
    }

    // Paris: 3 similar routes
    for i in 0..3 {
        let route = add_noise(&base_route_paris, 0.00001 * i as f64);
        if let Some(sig) = RouteSignature::from_points(&format!("paris-{}", i), &route, &config) {
            signatures.push(sig);
        }
    }

    // NYC: 2 similar routes
    for i in 0..2 {
        let route = add_noise(&base_route_nyc, 0.00001 * i as f64);
        if let Some(sig) = RouteSignature::from_points(&format!("nyc-{}", i), &route, &config) {
            signatures.push(sig);
        }
    }

    println!("Created {} route signatures\n", signatures.len());

    // Time the grouping
    let start = Instant::now();
    let groups = group_signatures_parallel(&signatures, &config);
    let elapsed = start.elapsed();

    println!("Grouping completed in {:?}\n", elapsed);
    println!("Found {} groups:\n", groups.len());

    for group in &groups {
        println!("  Group '{}': {:?}", group.group_id, group.activity_ids);
    }

    // Stats
    let total_routes: usize = groups.iter().map(|g| g.activity_ids.len()).sum();
    let largest_group = groups.iter().map(|g| g.activity_ids.len()).max().unwrap_or(0);
    let singletons = groups.iter().filter(|g| g.activity_ids.len() == 1).count();

    println!("\nStats:");
    println!("  Total routes: {}", total_routes);
    println!("  Number of groups: {}", groups.len());
    println!("  Largest group: {} routes", largest_group);
    println!("  Singleton groups: {}", singletons);
}

/// Add small noise to route points to simulate GPS variation
fn add_noise(route: &[GpsPoint], noise: f64) -> Vec<GpsPoint> {
    route
        .iter()
        .enumerate()
        .map(|(i, p)| {
            GpsPoint::new(
                p.latitude + noise * (i as f64 % 2.0 - 0.5),
                p.longitude + noise * ((i + 1) as f64 % 2.0 - 0.5),
            )
        })
        .collect()
}
