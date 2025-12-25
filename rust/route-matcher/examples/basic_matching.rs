//! Basic example of comparing two GPS routes.
//!
//! Run with: cargo run --example basic_matching

use route_matcher::{compare_routes, GpsPoint, MatchConfig, RouteSignature};

fn main() {
    // Create two sample routes (London area)
    let route1 = vec![
        GpsPoint::new(51.5074, -0.1278), // Start
        GpsPoint::new(51.5080, -0.1290),
        GpsPoint::new(51.5090, -0.1300),
        GpsPoint::new(51.5100, -0.1310),
        GpsPoint::new(51.5110, -0.1320), // End
    ];

    // Same route
    let route2 = route1.clone();

    // Reversed route
    let mut route3 = route1.clone();
    route3.reverse();

    // Different route (New York)
    let route4 = vec![
        GpsPoint::new(40.7128, -74.0060),
        GpsPoint::new(40.7138, -74.0070),
        GpsPoint::new(40.7148, -74.0080),
    ];

    let config = MatchConfig::default();

    // Create signatures
    let sig1 = RouteSignature::from_points("route-1", &route1, &config).unwrap();
    let sig2 = RouteSignature::from_points("route-2", &route2, &config).unwrap();
    let sig3 = RouteSignature::from_points("route-3", &route3, &config).unwrap();
    let sig4 = RouteSignature::from_points("route-4", &route4, &config).unwrap();

    println!("Route Matching Examples\n");
    println!("Config: perfect_threshold={}m, zero_threshold={}m, min_match={}%\n",
        config.perfect_threshold, config.zero_threshold, config.min_match_percentage);

    // Compare identical routes
    println!("1. Identical routes (route-1 vs route-2):");
    match compare_routes(&sig1, &sig2, &config) {
        Some(result) => {
            println!("   Match: {:.1}%", result.match_percentage);
            println!("   Direction: {}", result.direction);
            println!("   AMD: {:.2}m\n", result.amd);
        }
        None => println!("   No match\n"),
    }

    // Compare forward and reverse
    println!("2. Forward vs reverse (route-1 vs route-3):");
    match compare_routes(&sig1, &sig3, &config) {
        Some(result) => {
            println!("   Match: {:.1}%", result.match_percentage);
            println!("   Direction: {}", result.direction);
            println!("   AMD: {:.2}m\n", result.amd);
        }
        None => println!("   No match\n"),
    }

    // Compare different routes
    println!("3. Different locations (route-1 vs route-4):");
    match compare_routes(&sig1, &sig4, &config) {
        Some(result) => {
            println!("   Match: {:.1}%", result.match_percentage);
            println!("   Direction: {}", result.direction);
            println!("   AMD: {:.2}m\n", result.amd);
        }
        None => println!("   No match (routes too different)\n"),
    }

    // Show signature details
    println!("Signature details:");
    println!("  route-1: {} points, {:.0}m total distance",
        sig1.points.len(), sig1.total_distance);
    println!("  route-4: {} points, {:.0}m total distance",
        sig4.points.len(), sig4.total_distance);
}
