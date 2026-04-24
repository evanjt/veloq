//! Audit test: reads a private copy of the user's routes.db and runs
//! section detection + route grouping from scratch, reporting diagnostics.
//!
//! This test only runs when the fixture file exists:
//!   tests/fixtures/private/routes.db
//!
//! Run with: cargo test -p veloqrs --test detection_audit -- --nocapture --ignored

use rusqlite::Connection;
use std::collections::HashMap;
use std::path::Path;
use tracematch::{GpsPoint, MatchConfig, RouteSignature, SectionConfig};

const DB_PATH: &str = "tests/fixtures/private/routes.db";

fn open_db() -> Option<Connection> {
    let path = Path::new(DB_PATH);
    if !path.exists() {
        eprintln!("Skipping: {} not found", DB_PATH);
        return None;
    }
    Some(Connection::open(path).expect("open DB"))
}

fn load_tracks(conn: &Connection) -> Vec<(String, String, Vec<GpsPoint>)> {
    let mut stmt = conn
        .prepare(
            "SELECT g.activity_id, a.sport_type, g.track_data
             FROM gps_tracks g
             JOIN activities a ON a.id = g.activity_id",
        )
        .unwrap();

    stmt.query_map([], |row| {
        let id: String = row.get(0)?;
        let sport: String = row.get(1)?;
        let blob: Vec<u8> = row.get(2)?;
        Ok((id, sport, blob))
    })
    .unwrap()
    .filter_map(|r| {
        let (id, sport, blob) = r.ok()?;
        let points: Vec<GpsPoint> = rmp_serde::from_slice(&blob).ok()?;
        if points.len() >= 4 {
            Some((id, sport, points))
        } else {
            None
        }
    })
    .collect()
}

// ── Helpers ────────────────────────────────────────────────────────

// ── Route match quality audit ──────────────────────────────────────

#[test]
#[ignore]
fn audit_route_match_quality() {
    let conn = match open_db() {
        Some(c) => c,
        None => return,
    };

    let all_tracks = load_tracks(&conn);
    let config = MatchConfig::default();

    // Build signature map
    let sig_map: HashMap<String, RouteSignature> = all_tracks
        .iter()
        .filter_map(|(id, _, pts)| {
            let sig = RouteSignature::from_points(id, pts, &config)?;
            Some((id.clone(), sig))
        })
        .collect();

    let sport_map: HashMap<String, String> = all_tracks
        .iter()
        .map(|(id, sport, _)| (id.clone(), sport.clone()))
        .collect();

    // Load route groups from DB
    let groups = load_existing_groups(&conn);

    println!("\n======================================================================");
    println!("ROUTE MATCH QUALITY — pairwise AMD within groups");
    println!("======================================================================\n");

    // For each large group, compute pairwise match % between representative and all members
    for (group_id, rep_id, count, sport) in groups.iter().take(10) {
        if *count < 5 {
            continue;
        }

        // Get activity IDs from the group
        let activity_ids_json: String = conn
            .query_row(
                "SELECT activity_ids FROM route_groups WHERE id = ?",
                [group_id],
                |row| row.get(0),
            )
            .unwrap_or_default();

        let activity_ids: Vec<String> = serde_json::from_str(&activity_ids_json).unwrap_or_default();

        let rep_sig = match sig_map.get(rep_id) {
            Some(s) => s,
            None => continue,
        };

        println!(
            "Group {} ({}, {} activities, rep: {}):",
            group_id, sport, count, rep_id
        );

        let mut match_pcts: Vec<(String, f64)> = Vec::new();
        for aid in &activity_ids {
            if aid == rep_id {
                continue;
            }
            if let Some(sig) = sig_map.get(aid) {
                if let Some(result) = tracematch::compare_routes(rep_sig, sig, &config) {
                    match_pcts.push((aid.clone(), result.match_percentage));
                } else {
                    match_pcts.push((aid.clone(), 0.0));
                }
            }
        }

        match_pcts.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());

        let min_pct = match_pcts.first().map(|(_, p)| *p).unwrap_or(0.0);
        let max_pct = match_pcts.last().map(|(_, p)| *p).unwrap_or(0.0);
        let avg_pct = if match_pcts.is_empty() {
            0.0
        } else {
            match_pcts.iter().map(|(_, p)| p).sum::<f64>() / match_pcts.len() as f64
        };

        println!(
            "  Match % range: {:.1}% - {:.1}% (avg {:.1}%)",
            min_pct, max_pct, avg_pct
        );

        // Show the worst matches
        let below_70: Vec<_> = match_pcts.iter().filter(|(_, p)| *p < 70.0).collect();
        if !below_70.is_empty() {
            println!("  Activities below 70% match:");
            for (aid, pct) in below_70.iter().take(10) {
                println!("    {} — {:.1}%", aid, pct);
            }
        }

        // Show distribution
        let above_90 = match_pcts.iter().filter(|(_, p)| *p >= 90.0).count();
        let range_70_90 = match_pcts
            .iter()
            .filter(|(_, p)| *p >= 70.0 && *p < 90.0)
            .count();
        let range_50_70 = match_pcts
            .iter()
            .filter(|(_, p)| *p >= 50.0 && *p < 70.0)
            .count();
        let below_50 = match_pcts.iter().filter(|(_, p)| *p < 50.0).count();

        println!(
            "  Distribution: 90%+: {}, 70-90%: {}, 50-70%: {}, <50%: {}",
            above_90, range_70_90, range_50_70, below_50
        );
        println!();
    }
}

fn compute_containment(poly_a: &[GpsPoint], poly_b: &[GpsPoint], threshold: f64) -> f64 {
    if poly_a.is_empty() || poly_b.is_empty() {
        return 0.0;
    }

    let tree_b = tracematch::sections::build_rtree(poly_b);
    let threshold_deg = threshold / 111_000.0;
    let threshold_deg_sq = threshold_deg * threshold_deg;

    let mut contained = 0;
    for point in poly_a {
        let query = [point.latitude, point.longitude];
        if let Some(nearest) = tree_b.nearest_neighbor(&query) {
            let d0 = nearest.lat - query[0];
            let d1 = nearest.lng - query[1];
            if d0 * d0 + d1 * d1 <= threshold_deg_sq {
                contained += 1;
            }
        }
    }

    contained as f64 / poly_a.len() as f64
}

// ── Section audit ──────────────────────────────────────────────────

fn load_existing_sections(conn: &Connection) -> Vec<(String, f64, String, i64)> {
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.distance_meters, s.sport_type,
                    (SELECT COUNT(*) FROM section_activities sa
                     WHERE sa.section_id = s.id AND sa.excluded = 0) as visits
             FROM sections s
             WHERE s.disabled = 0
             ORDER BY visits DESC",
        )
        .unwrap();

    stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, f64>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, i64>(3)?,
        ))
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

fn per_activity_section_counts(conn: &Connection) -> Vec<(String, i64)> {
    let mut stmt = conn
        .prepare(
            "SELECT sa.activity_id, COUNT(*) as cnt
             FROM section_activities sa
             WHERE sa.excluded = 0
             GROUP BY sa.activity_id
             ORDER BY cnt DESC",
        )
        .unwrap();

    stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

#[test]
#[ignore]
fn audit_existing_sections() {
    let conn = match open_db() {
        Some(c) => c,
        None => return,
    };

    let sections = load_existing_sections(&conn);
    let per_activity = per_activity_section_counts(&conn);

    println!("\n======================================================================");
    println!("SECTION AUDIT — existing database state");
    println!("======================================================================\n");

    println!("Total sections: {}", sections.len());

    // By sport
    let mut by_sport: HashMap<&str, usize> = HashMap::new();
    for (_, _, sport, _) in &sections {
        *by_sport.entry(sport.as_str()).or_default() += 1;
    }
    println!("\nSections by sport:");
    let mut sport_vec: Vec<_> = by_sport.iter().collect();
    sport_vec.sort_by(|a, b| b.1.cmp(a.1));
    for (sport, count) in &sport_vec {
        println!("  {:<20} {}", sport, count);
    }

    // Distance distribution
    let buckets = [
        (0.0, 100.0, "< 100m"),
        (100.0, 200.0, "100-200m"),
        (200.0, 500.0, "200-500m"),
        (500.0, 1000.0, "500-1000m"),
        (1000.0, 2000.0, "1-2km"),
        (2000.0, f64::MAX, "> 2km"),
    ];
    println!("\nDistance distribution:");
    for (lo, hi, label) in &buckets {
        let count = sections
            .iter()
            .filter(|(_, d, _, _)| *d >= *lo && *d < *hi)
            .count();
        println!("  {:<12} {}", label, count);
    }

    // Visit distribution
    println!("\nVisit distribution:");
    let vbuckets = [(1, 2), (3, 5), (6, 10), (11, 30), (31, i64::MAX)];
    let vlabels = ["1-2", "3-5", "6-10", "11-30", "30+"];
    for ((lo, hi), label) in vbuckets.iter().zip(vlabels.iter()) {
        let count = sections
            .iter()
            .filter(|(_, _, _, v)| *v >= *lo as i64 && *v <= *hi as i64)
            .count();
        println!("  {:<12} visits: {}", label, count);
    }

    // Per-activity section counts
    let max_sections = per_activity.first().map(|(_, c)| *c).unwrap_or(0);
    let avg_sections = if per_activity.is_empty() {
        0.0
    } else {
        per_activity.iter().map(|(_, c)| *c as f64).sum::<f64>() / per_activity.len() as f64
    };
    let median_sections = if per_activity.is_empty() {
        0
    } else {
        per_activity[per_activity.len() / 2].1
    };

    println!("\nPer-activity section counts:");
    println!("  Max:    {} sections", max_sections);
    println!("  Avg:    {:.1} sections", avg_sections);
    println!("  Median: {} sections", median_sections);

    let pa_buckets = [(1, 3), (4, 7), (8, 15), (16, i64::MAX)];
    let pa_labels = ["1-3", "4-7", "8-15", "16+"];
    for ((lo, hi), label) in pa_buckets.iter().zip(pa_labels.iter()) {
        let count = per_activity
            .iter()
            .filter(|(_, c)| *c >= *lo as i64 && *c <= *hi as i64)
            .count();
        println!("  {:<12} sections: {} activities", label, count);
    }

    // Top 10 most over-sectioned activities
    println!("\nTop 10 most over-sectioned activities:");
    for (id, count) in per_activity.iter().take(10) {
        println!("  {} — {} sections", id, count);
    }

    println!();
}

// ── Route grouping audit ───────────────────────────────────────────

fn load_existing_groups(conn: &Connection) -> Vec<(String, String, i64, String)> {
    let mut stmt = conn
        .prepare(
            "SELECT id, representative_id, activity_count, sport_type
             FROM route_groups
             ORDER BY activity_count DESC",
        )
        .unwrap();

    stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, String>(3)?,
        ))
    })
    .unwrap()
    .filter_map(|r| r.ok())
    .collect()
}

#[test]
#[ignore]
fn audit_existing_route_groups() {
    let conn = match open_db() {
        Some(c) => c,
        None => return,
    };

    let groups = load_existing_groups(&conn);

    println!("\n======================================================================");
    println!("ROUTE GROUP AUDIT — existing database state");
    println!("======================================================================\n");

    println!("Total route groups: {}", groups.len());

    // By sport
    let mut by_sport: HashMap<&str, (usize, i64)> = HashMap::new();
    for (_, _, count, sport) in &groups {
        let entry = by_sport.entry(sport.as_str()).or_default();
        entry.0 += 1;
        entry.1 += count;
    }
    println!("\nGroups by sport:");
    let mut sport_vec: Vec<_> = by_sport.iter().collect();
    sport_vec.sort_by(|a, b| (b.1).1.cmp(&(a.1).1));
    for (sport, (groups_count, total_activities)) in &sport_vec {
        println!(
            "  {:<20} {} groups, {} total activities",
            sport, groups_count, total_activities
        );
    }

    // Size distribution
    let size_buckets = [(1, 1), (2, 5), (6, 15), (16, 30), (31, i64::MAX)];
    let size_labels = ["1", "2-5", "6-15", "16-30", "30+"];
    println!("\nGroup size distribution:");
    for ((lo, hi), label) in size_buckets.iter().zip(size_labels.iter()) {
        let count = groups
            .iter()
            .filter(|(_, _, c, _)| *c >= *lo as i64 && *c <= *hi as i64)
            .count();
        println!("  {:<12} activities: {} groups", label, count);
    }

    // Top 15 largest groups
    println!("\nTop 15 largest groups:");
    for (id, rep, count, sport) in groups.iter().take(15) {
        println!("  {} — {} activities (rep: {}, {})", id, count, rep, sport);
    }

    println!();
}

// ── Re-detection comparison ────────────────────────────────────────

#[test]
#[ignore]
fn redetect_and_compare() {
    let conn = match open_db() {
        Some(c) => c,
        None => return,
    };

    let all_tracks = load_tracks(&conn);
    let total_activities = all_tracks.len();

    println!("\n======================================================================");
    println!("RE-DETECTION — running section detection from scratch");
    println!("======================================================================\n");
    println!("Loaded {} activities with GPS tracks", total_activities);

    // Build sport map
    let sport_map: HashMap<String, String> = all_tracks
        .iter()
        .map(|(id, sport, _)| (id.clone(), sport.clone()))
        .collect();

    // Build tracks for detection (id, points)
    let tracks: Vec<(String, Vec<GpsPoint>)> = all_tracks
        .iter()
        .map(|(id, _, pts)| (id.clone(), pts.clone()))
        .collect();

    // First: run route grouping
    println!("\n--- Route Grouping ---");
    let config = MatchConfig::default();
    println!(
        "Config: min_match={}%, endpoint={}m, max_dist_diff={}%",
        config.min_match_percentage,
        config.endpoint_threshold,
        config.max_distance_diff_ratio * 100.0
    );

    let signatures: Vec<RouteSignature> = tracks
        .iter()
        .filter_map(|(id, pts)| {
            let sig = RouteSignature::from_points(id, pts, &config)?;
            if sig.total_distance >= config.min_route_distance {
                Some(sig)
            } else {
                None
            }
        })
        .collect();

    println!(
        "Valid signatures: {} (of {} total)",
        signatures.len(),
        total_activities
    );

    // Group by sport for sport-specific grouping
    let mut sig_by_sport: HashMap<String, Vec<RouteSignature>> = HashMap::new();
    for sig in &signatures {
        let sport = sport_map
            .get(&sig.activity_id)
            .cloned()
            .unwrap_or_default();
        sig_by_sport.entry(sport).or_default().push(sig.clone());
    }

    let mut all_groups = Vec::new();
    for (sport, sport_sigs) in &sig_by_sport {
        let groups = tracematch::group_signatures_parallel(sport_sigs, &config);
        println!(
            "  {} — {} signatures → {} groups",
            sport,
            sport_sigs.len(),
            groups.len()
        );

        let mut large: Vec<_> = groups.iter().filter(|g| g.activity_ids.len() >= 10).collect();
        large.sort_by(|a, b| b.activity_ids.len().cmp(&a.activity_ids.len()));
        for g in large.iter().take(5) {
            println!(
                "    Group {} — {} activities",
                g.group_id,
                g.activity_ids.len()
            );
        }
        all_groups.extend(groups);
    }
    println!("Total groups: {}", all_groups.len());

    // Second: run section detection
    println!("\n--- Section Detection (current defaults) ---");
    let section_config = SectionConfig::default();
    println!(
        "Mode: {:?}, preserve_hierarchy: {}, scales: {}",
        section_config.detection_mode,
        section_config.preserve_hierarchy,
        section_config.scale_presets.len()
    );

    let start = std::time::Instant::now();
    let result = tracematch::sections::detect_sections_multiscale(
        &tracks,
        &sport_map,
        &all_groups,
        &section_config,
    );
    let elapsed = start.elapsed();

    println!("Detection time: {:.1}s", elapsed.as_secs_f64());
    println!("Sections detected: {}", result.sections.len());
    println!("Potentials: {}", result.potentials.len());

    // Section stats
    let mut by_sport_sections: HashMap<&str, usize> = HashMap::new();
    for s in &result.sections {
        *by_sport_sections
            .entry(s.sport_type.as_str())
            .or_default() += 1;
    }
    println!("\nSections by sport:");
    let mut sv: Vec<_> = by_sport_sections.iter().collect();
    sv.sort_by(|a, b| b.1.cmp(a.1));
    for (sport, count) in &sv {
        println!("  {:<20} {}", sport, count);
    }

    // Length distribution
    let buckets = [
        (0.0, 100.0, "< 100m"),
        (100.0, 200.0, "100-200m"),
        (200.0, 500.0, "200-500m"),
        (500.0, 1000.0, "500-1000m"),
        (1000.0, 2000.0, "1-2km"),
        (2000.0, f64::MAX, "> 2km"),
    ];
    println!("\nLength distribution:");
    for (lo, hi, label) in &buckets {
        let count = result
            .sections
            .iter()
            .filter(|s| s.distance_meters >= *lo && s.distance_meters < *hi)
            .count();
        println!("  {:<12} {}", label, count);
    }

    // Visit count distribution
    let vbuckets: [(u32, u32); 5] = [(1, 2), (3, 5), (6, 10), (11, 30), (31, u32::MAX)];
    let vlabels = ["1-2", "3-5", "6-10", "11-30", "30+"];
    println!("\nVisit distribution:");
    for ((lo, hi), label) in vbuckets.iter().zip(vlabels.iter()) {
        let count = result
            .sections
            .iter()
            .filter(|s| s.visit_count >= *lo && s.visit_count <= *hi)
            .count();
        println!("  {:<12} visits: {}", label, count);
    }

    // Per-activity section counts
    let mut per_activity: HashMap<&str, usize> = HashMap::new();
    for s in &result.sections {
        for aid in &s.activity_ids {
            *per_activity.entry(aid.as_str()).or_default() += 1;
        }
    }
    let mut pa_counts: Vec<_> = per_activity.iter().collect();
    pa_counts.sort_by(|a, b| b.1.cmp(a.1));

    let max_sa = pa_counts.first().map(|(_, c)| **c).unwrap_or(0);
    let avg_sa = if pa_counts.is_empty() {
        0.0
    } else {
        pa_counts.iter().map(|(_, c)| **c as f64).sum::<f64>() / pa_counts.len() as f64
    };

    println!("\nPer-activity section count:");
    println!("  Max: {} sections on one activity", max_sa);
    println!("  Avg: {:.1}", avg_sa);

    println!("\n  Top 10 most over-sectioned:");
    for (id, count) in pa_counts.iter().take(10) {
        let sport = sport_map.get(&id.to_string()).map(|s| s.as_str()).unwrap_or("?");
        println!("    {} ({}) — {} sections", id, sport, count);
    }

    // Overlap audit
    println!("\n--- Overlap Audit ---");
    let mut overlap_pairs = 0;
    let mut high_overlap_pairs = Vec::new();

    let mut sections_by_sport: HashMap<&str, Vec<usize>> = HashMap::new();
    for (i, s) in result.sections.iter().enumerate() {
        sections_by_sport
            .entry(s.sport_type.as_str())
            .or_default()
            .push(i);
    }

    for (_sport, indices) in &sections_by_sport {
        for (a_idx, &i) in indices.iter().enumerate() {
            let si = &result.sections[i];

            for &j in indices.iter().skip(a_idx + 1) {
                let sj = &result.sections[j];

                let j_in_i =
                    compute_containment(&sj.polyline, &si.polyline, section_config.proximity_threshold);

                if j_in_i > 0.3 {
                    let i_in_j = compute_containment(
                        &si.polyline,
                        &sj.polyline,
                        section_config.proximity_threshold,
                    );

                    if j_in_i > 0.3 || i_in_j > 0.3 {
                        overlap_pairs += 1;
                        if high_overlap_pairs.len() < 20 {
                            high_overlap_pairs.push((
                                si.id.clone(),
                                sj.id.clone(),
                                si.distance_meters,
                                sj.distance_meters,
                                si.visit_count,
                                sj.visit_count,
                                j_in_i,
                                i_in_j,
                            ));
                        }
                    }
                }
            }
        }
    }

    println!("Pairs with >30% overlap: {}", overlap_pairs);
    if !high_overlap_pairs.is_empty() {
        println!("\nSample overlapping pairs:");
        for (id_i, id_j, dist_i, dist_j, vis_i, vis_j, j_in_i, i_in_j) in &high_overlap_pairs {
            println!(
                "  {} ({:.0}m, {}v) vs {} ({:.0}m, {}v) — {:.0}%/{:.0}%",
                id_i,
                dist_i,
                vis_i,
                id_j,
                dist_j,
                vis_j,
                j_in_i * 100.0,
                i_in_j * 100.0
            );
        }
    }

    println!("\n======================================================================");
    println!("AUDIT COMPLETE");
    println!("======================================================================\n");
}
