//! Activity pattern detection via k-means clustering.
//!
//! Groups activities by sport type and clusters them based on feature vectors:
//! `[day_of_week_norm, duration_norm, tss_norm, distance_norm]`
//!
//! Uses k-means++ initialization and silhouette method for optimal k selection.
//! Enriches clusters with commonly-traversed sections from the `section_activities` table.

use std::collections::HashMap;

use rusqlite::Connection;

use crate::ActivityMetrics;

// ============================================================================
// Internal Types
// ============================================================================

/// Activity feature vector for clustering.
struct ActivityFeature {
    activity_id: String,
    sport_type: String,
    day_of_week: u8, // 0=Mon..6=Sun
    date: i64,       // unix timestamp
    duration_secs: u32,
    tss: f64,
    distance_meters: f64,
}

/// K-means cluster result.
struct ActivityCluster {
    #[allow(dead_code)]
    centroid: [f64; 4],
    members: Vec<usize>, // indices into features array
    silhouette: f64,
}

/// Section info collected from database for enrichment.
struct SectionInfo {
    section_id: String,
    section_name: String,
    activity_count: u32,
}

// ============================================================================
// Constants
// ============================================================================

const MIN_CLUSTER_SIZE: usize = 6;
const MIN_DATE_SPAN_DAYS: i64 = 90;
const MIN_SILHOUETTE: f64 = 0.3;
const MIN_FREQUENCY_PER_MONTH: f32 = 0.3;
const MAX_K: usize = 6;
const MIN_K: usize = 2;
const KMEANS_MAX_ITERATIONS: usize = 100;
const KMEANS_CONVERGENCE_THRESHOLD: f64 = 1e-6;
const SECTION_APPEARANCE_THRESHOLD: f64 = 0.5; // 50% of cluster activities

// ============================================================================
// Public API
// ============================================================================

/// Compute activity patterns from in-memory metrics and SQLite section data.
pub fn compute_activity_patterns(
    db: &Connection,
    activity_metrics: &HashMap<String, ActivityMetrics>,
) -> Vec<crate::FfiActivityPattern> {
    if activity_metrics.is_empty() {
        return Vec::new();
    }

    let features = extract_features(db, activity_metrics);
    if features.is_empty() {
        return Vec::new();
    }

    // Group features by sport type
    let mut by_sport: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, f) in features.iter().enumerate() {
        by_sport
            .entry(f.sport_type.clone())
            .or_default()
            .push(i);
    }

    let mut patterns = Vec::new();

    for (sport_type, indices) in &by_sport {
        if indices.len() < MIN_CLUSTER_SIZE {
            continue;
        }

        // Build normalized feature matrix for this sport group
        let sport_features: Vec<&ActivityFeature> = indices.iter().map(|&i| &features[i]).collect();
        let normalized = normalize_features(&sport_features);
        if normalized.is_empty() {
            continue;
        }

        // Find optimal k via silhouette method
        let (clusters, best_k) = find_optimal_clusters(&normalized);
        if clusters.is_empty() {
            continue;
        }

        log::info!(
            "tracematch: [Patterns] Sport '{}': {} activities -> k={} clusters",
            sport_type,
            indices.len(),
            best_k
        );

        // Convert each valid cluster to an FfiActivityPattern
        for (cluster_idx, cluster) in clusters.iter().enumerate() {
            if let Some(pattern) = build_pattern(
                db,
                &sport_features,
                &normalized,
                cluster,
                sport_type,
                cluster_idx as u8,
            ) {
                patterns.push(pattern);
            }
        }
    }

    // Sort by confidence descending
    patterns.sort_by(|a, b| {
        b.confidence
            .partial_cmp(&a.confidence)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    patterns
}

/// Get the best-matching pattern for today's day of week and current season.
/// Returns the highest-confidence pattern within +/-1 day tolerance.
pub fn get_pattern_for_today(
    db: &Connection,
    activity_metrics: &HashMap<String, ActivityMetrics>,
) -> Option<crate::FfiActivityPattern> {
    let all_patterns = compute_activity_patterns(db, activity_metrics);
    if all_patterns.is_empty() {
        return None;
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    let today_dow = day_of_week_from_timestamp(now);
    let current_season = season_from_timestamp(now);

    // Filter patterns matching today (+/-1 day tolerance) and current season
    let mut candidates: Vec<&crate::FfiActivityPattern> = all_patterns
        .iter()
        .filter(|p| {
            let day_diff = (p.primary_day as i8 - today_dow as i8).unsigned_abs();
            let day_match = day_diff <= 1 || day_diff >= 6; // wrap around Sun<->Mon
            let season_match = p.season_label == current_season || p.season_label == "all";
            day_match && season_match
        })
        .collect();

    candidates.sort_by(|a, b| {
        b.confidence
            .partial_cmp(&a.confidence)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    candidates.first().cloned().cloned()
}

// ============================================================================
// Feature Extraction
// ============================================================================

/// Extract features from activity metrics, supplementing with training_load from SQLite.
fn extract_features(
    db: &Connection,
    activity_metrics: &HashMap<String, ActivityMetrics>,
) -> Vec<ActivityFeature> {
    // Load training_load from SQLite (not in in-memory ActivityMetrics struct)
    let training_loads = load_training_loads(db);

    activity_metrics
        .values()
        .filter(|m| m.moving_time > 0 && m.distance > 0.0)
        .map(|m| {
            let tss = training_loads
                .get(&m.activity_id)
                .copied()
                .unwrap_or(0.0);

            ActivityFeature {
                activity_id: m.activity_id.clone(),
                sport_type: m.sport_type.clone(),
                day_of_week: day_of_week_from_timestamp(m.date),
                date: m.date,
                duration_secs: m.moving_time,
                tss,
                distance_meters: m.distance,
            }
        })
        .collect()
}

/// Load training_load values from activity_metrics SQLite table.
fn load_training_loads(db: &Connection) -> HashMap<String, f64> {
    let mut map = HashMap::new();

    let result = db.prepare(
        "SELECT activity_id, training_load FROM activity_metrics WHERE training_load IS NOT NULL",
    );

    if let Ok(mut stmt) = result {
        let iter = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, f64>(1)?,
            ))
        });

        if let Ok(rows) = iter {
            for row in rows.flatten() {
                map.insert(row.0, row.1);
            }
        }
    }

    map
}

// ============================================================================
// Normalization
// ============================================================================

/// Normalize features to [0, 1] range. Returns Vec of [day_norm, duration_norm, tss_norm, distance_norm].
fn normalize_features(features: &[&ActivityFeature]) -> Vec<[f64; 4]> {
    if features.is_empty() {
        return Vec::new();
    }

    let durations: Vec<f64> = features.iter().map(|f| f.duration_secs as f64).collect();
    let tss_vals: Vec<f64> = features.iter().map(|f| f.tss).collect();
    let distances: Vec<f64> = features.iter().map(|f| f.distance_meters).collect();

    let (dur_min, dur_max) = min_max(&durations);
    let (tss_min, tss_max) = min_max(&tss_vals);
    let (dist_min, dist_max) = min_max(&distances);

    features
        .iter()
        .map(|f| {
            [
                f.day_of_week as f64 / 6.0,
                min_max_normalize(f.duration_secs as f64, dur_min, dur_max),
                min_max_normalize(f.tss, tss_min, tss_max),
                min_max_normalize(f.distance_meters, dist_min, dist_max),
            ]
        })
        .collect()
}

fn min_max(vals: &[f64]) -> (f64, f64) {
    let min = vals.iter().cloned().fold(f64::INFINITY, f64::min);
    let max = vals.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    (min, max)
}

fn min_max_normalize(val: f64, min: f64, max: f64) -> f64 {
    if (max - min).abs() < 1e-12 {
        0.5
    } else {
        (val - min) / (max - min)
    }
}

// ============================================================================
// K-means Clustering
// ============================================================================

/// Find optimal k using silhouette method. Returns (clusters, best_k).
fn find_optimal_clusters(data: &[[f64; 4]]) -> (Vec<ActivityCluster>, usize) {
    if data.len() < MIN_K * MIN_CLUSTER_SIZE {
        return (Vec::new(), 0);
    }

    let max_k = MAX_K.min(data.len() / MIN_CLUSTER_SIZE);
    if max_k < MIN_K {
        return (Vec::new(), 0);
    }

    let mut best_silhouette = f64::NEG_INFINITY;
    let mut best_clusters: Vec<ActivityCluster> = Vec::new();
    let mut best_k = MIN_K;

    for k in MIN_K..=max_k {
        let (centroids, assignments) = kmeans(data, k);
        let silhouette = compute_silhouette(data, &assignments, k);

        if silhouette > best_silhouette {
            best_silhouette = silhouette;
            best_k = k;

            // Build cluster objects
            best_clusters = build_clusters(&centroids, &assignments, data, k);
        }
    }

    if best_silhouette < MIN_SILHOUETTE {
        return (Vec::new(), 0);
    }

    (best_clusters, best_k)
}

/// K-means++ initialization followed by Lloyd's algorithm.
fn kmeans(data: &[[f64; 4]], k: usize) -> (Vec<[f64; 4]>, Vec<usize>) {
    let mut centroids = kmeans_plus_plus_init(data, k);
    let mut assignments = vec![0usize; data.len()];

    for _ in 0..KMEANS_MAX_ITERATIONS {
        // Assignment step
        for (i, point) in data.iter().enumerate() {
            let mut best_dist = f64::INFINITY;
            let mut best_c = 0;
            for (c, centroid) in centroids.iter().enumerate() {
                let d = euclidean_sq(point, centroid);
                if d < best_dist {
                    best_dist = d;
                    best_c = c;
                }
            }
            assignments[i] = best_c;
        }

        // Update step
        let mut new_centroids = vec![[0.0f64; 4]; k];
        let mut counts = vec![0usize; k];

        for (i, point) in data.iter().enumerate() {
            let c = assignments[i];
            counts[c] += 1;
            for d in 0..4 {
                new_centroids[c][d] += point[d];
            }
        }

        for c in 0..k {
            if counts[c] > 0 {
                for d in 0..4 {
                    new_centroids[c][d] /= counts[c] as f64;
                }
            }
        }

        // Check convergence
        let shift: f64 = centroids
            .iter()
            .zip(new_centroids.iter())
            .map(|(old, new)| euclidean_sq(old, new))
            .sum();

        centroids = new_centroids;

        if shift < KMEANS_CONVERGENCE_THRESHOLD {
            break;
        }
    }

    (centroids, assignments)
}

/// K-means++ initialization: pick first centroid randomly, then pick subsequent
/// centroids with probability proportional to squared distance from nearest existing centroid.
fn kmeans_plus_plus_init(data: &[[f64; 4]], k: usize) -> Vec<[f64; 4]> {
    let n = data.len();
    let mut centroids = Vec::with_capacity(k);

    // Use a simple deterministic seed based on data characteristics
    let seed = (data.iter().map(|p| (p[0] * 1000.0) as u64).sum::<u64>()) % n as u64;
    centroids.push(data[seed as usize]);

    let mut distances = vec![f64::INFINITY; n];

    for _ in 1..k {
        // Update distances to nearest centroid
        let last_centroid = centroids.last().unwrap();
        for (i, point) in data.iter().enumerate() {
            let d = euclidean_sq(point, last_centroid);
            distances[i] = distances[i].min(d);
        }

        // Pick next centroid proportional to distance^2
        let total: f64 = distances.iter().sum();
        if total < 1e-12 {
            // All points are at centroids, pick any remaining
            centroids.push(data[centroids.len() % n]);
            continue;
        }

        let threshold = deterministic_rand(centroids.len() as u64, n as u64) as f64
            / n as f64
            * total;
        let mut cumulative = 0.0;
        let mut chosen = 0;
        for (i, &d) in distances.iter().enumerate() {
            cumulative += d;
            if cumulative >= threshold {
                chosen = i;
                break;
            }
        }

        centroids.push(data[chosen]);
    }

    centroids
}

/// Simple deterministic pseudo-random for k-means++ seeding.
/// Not cryptographic, just needs to vary across iterations.
fn deterministic_rand(seed: u64, modulus: u64) -> u64 {
    if modulus == 0 {
        return 0;
    }
    // LCG parameters (Numerical Recipes)
    let a: u64 = 6364136223846793005;
    let c: u64 = 1442695040888963407;
    a.wrapping_mul(seed).wrapping_add(c) % modulus
}

fn euclidean_sq(a: &[f64; 4], b: &[f64; 4]) -> f64 {
    a.iter()
        .zip(b.iter())
        .map(|(x, y)| (x - y) * (x - y))
        .sum()
}

// ============================================================================
// Silhouette Score
// ============================================================================

/// Compute average silhouette score across all points.
fn compute_silhouette(data: &[[f64; 4]], assignments: &[usize], k: usize) -> f64 {
    let n = data.len();
    if n <= 1 || k <= 1 {
        return 0.0;
    }

    let mut total_silhouette = 0.0;
    let mut valid_count = 0;

    for i in 0..n {
        let ci = assignments[i];

        // a(i) = average distance to same-cluster points
        let mut same_sum = 0.0;
        let mut same_count = 0;
        for j in 0..n {
            if i != j && assignments[j] == ci {
                same_sum += euclidean_sq(&data[i], &data[j]).sqrt();
                same_count += 1;
            }
        }

        if same_count == 0 {
            // Singleton cluster
            continue;
        }

        let a_i = same_sum / same_count as f64;

        // b(i) = minimum average distance to any other cluster
        let mut b_i = f64::INFINITY;
        for other_k in 0..k {
            if other_k == ci {
                continue;
            }

            let mut other_sum = 0.0;
            let mut other_count = 0;
            for j in 0..n {
                if assignments[j] == other_k {
                    other_sum += euclidean_sq(&data[i], &data[j]).sqrt();
                    other_count += 1;
                }
            }

            if other_count > 0 {
                let avg = other_sum / other_count as f64;
                b_i = b_i.min(avg);
            }
        }

        if b_i.is_infinite() {
            continue;
        }

        let max_ab = a_i.max(b_i);
        if max_ab > 0.0 {
            total_silhouette += (b_i - a_i) / max_ab;
            valid_count += 1;
        }
    }

    if valid_count == 0 {
        0.0
    } else {
        total_silhouette / valid_count as f64
    }
}

/// Build ActivityCluster objects from k-means results.
fn build_clusters(
    centroids: &[[f64; 4]],
    assignments: &[usize],
    data: &[[f64; 4]],
    k: usize,
) -> Vec<ActivityCluster> {
    let mut clusters = Vec::with_capacity(k);

    for c in 0..k {
        let members: Vec<usize> = assignments
            .iter()
            .enumerate()
            .filter(|&(_, &a)| a == c)
            .map(|(i, _)| i)
            .collect();

        if members.is_empty() {
            continue;
        }

        // Compute per-cluster silhouette
        let cluster_silhouette = compute_cluster_silhouette(data, assignments, &members, c, k);

        clusters.push(ActivityCluster {
            centroid: centroids[c],
            members,
            silhouette: cluster_silhouette,
        });
    }

    clusters
}

/// Compute average silhouette for a single cluster's members.
fn compute_cluster_silhouette(
    data: &[[f64; 4]],
    assignments: &[usize],
    members: &[usize],
    cluster_id: usize,
    k: usize,
) -> f64 {
    let n = data.len();
    let mut total = 0.0;
    let mut count = 0;

    for &i in members {
        // a(i)
        let mut same_sum = 0.0;
        let mut same_count = 0;
        for &j in members {
            if i != j {
                same_sum += euclidean_sq(&data[i], &data[j]).sqrt();
                same_count += 1;
            }
        }

        if same_count == 0 {
            continue;
        }

        let a_i = same_sum / same_count as f64;

        // b(i)
        let mut b_i = f64::INFINITY;
        for other_k in 0..k {
            if other_k == cluster_id {
                continue;
            }

            let mut other_sum = 0.0;
            let mut other_count = 0;
            for j in 0..n {
                if assignments[j] == other_k {
                    other_sum += euclidean_sq(&data[i], &data[j]).sqrt();
                    other_count += 1;
                }
            }

            if other_count > 0 {
                b_i = b_i.min(other_sum / other_count as f64);
            }
        }

        if b_i.is_infinite() {
            continue;
        }

        let max_ab = a_i.max(b_i);
        if max_ab > 0.0 {
            total += (b_i - a_i) / max_ab;
            count += 1;
        }
    }

    if count == 0 {
        0.0
    } else {
        total / count as f64
    }
}

// ============================================================================
// Pattern Building
// ============================================================================

/// Build an FfiActivityPattern from a cluster, applying quality gates.
fn build_pattern(
    db: &Connection,
    features: &[&ActivityFeature],
    _normalized: &[[f64; 4]],
    cluster: &ActivityCluster,
    sport_type: &str,
    cluster_id: u8,
) -> Option<crate::FfiActivityPattern> {
    let member_features: Vec<&&ActivityFeature> =
        cluster.members.iter().map(|&i| &features[i]).collect();

    let count = member_features.len();

    // Quality gate: minimum cluster size
    if count < MIN_CLUSTER_SIZE {
        return None;
    }

    // Quality gate: date span
    let dates: Vec<i64> = member_features.iter().map(|f| f.date).collect();
    let min_date = *dates.iter().min()?;
    let max_date = *dates.iter().max()?;
    let span_days = (max_date - min_date) / 86400;
    if span_days < MIN_DATE_SPAN_DAYS {
        return None;
    }

    // Quality gate: silhouette
    if cluster.silhouette < MIN_SILHOUETTE {
        return None;
    }

    // Compute frequency per month
    let span_months = span_days as f32 / 30.44;
    let frequency_per_month = if span_months > 0.0 {
        count as f32 / span_months
    } else {
        0.0
    };

    // Quality gate: frequency
    if frequency_per_month < MIN_FREQUENCY_PER_MONTH {
        return None;
    }

    // Compute averages
    let avg_duration_secs =
        member_features.iter().map(|f| f.duration_secs as u64).sum::<u64>() / count as u64;
    let avg_tss = member_features.iter().map(|f| f.tss).sum::<f64>() / count as f64;
    let avg_distance =
        member_features.iter().map(|f| f.distance_meters).sum::<f64>() / count as f64;

    // Primary day of week (mode)
    let primary_day = mode_day_of_week(&member_features);

    // Season label
    let season_label = compute_season_label(&member_features);

    // Days since last activity in this cluster
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let days_since_last = ((now - max_date) / 86400).max(0) as u32;

    // Confidence score
    let confidence = compute_confidence(
        cluster.silhouette,
        count,
        span_days,
        frequency_per_month,
    );

    // Section enrichment
    let activity_ids: Vec<&str> = member_features.iter().map(|f| f.activity_id.as_str()).collect();
    let common_sections = enrich_with_sections(db, &activity_ids, count);

    Some(crate::FfiActivityPattern {
        sport_type: sport_type.to_string(),
        cluster_id,
        primary_day,
        season_label,
        activity_count: count as u32,
        avg_duration_secs: avg_duration_secs as u32,
        avg_tss: avg_tss as f32,
        avg_distance_meters: avg_distance as f32,
        frequency_per_month,
        confidence,
        silhouette_score: cluster.silhouette as f32,
        days_since_last,
        common_sections,
    })
}

/// Compute weighted confidence score.
fn compute_confidence(
    silhouette: f64,
    count: usize,
    span_days: i64,
    frequency: f32,
) -> f32 {
    // Silhouette weight: 0.3 (normalized, already 0..1 range effectively)
    let sil_score = silhouette.max(0.0).min(1.0);

    // Count richness weight: 0.3 (log scale, saturates at ~50 activities)
    let count_score = ((count as f64).ln() / (50.0_f64).ln()).min(1.0);

    // Temporal coverage weight: 0.2 (how many days covered, saturates at 365)
    let temporal_score = (span_days as f64 / 365.0).min(1.0);

    // Regularity weight: 0.2 (frequency per month, saturates at 4x/month)
    let regularity_score = (frequency as f64 / 4.0).min(1.0);

    let confidence =
        0.3 * sil_score + 0.3 * count_score + 0.2 * temporal_score + 0.2 * regularity_score;

    confidence as f32
}

/// Find the most common day of week among features.
fn mode_day_of_week(features: &[&&ActivityFeature]) -> u8 {
    let mut counts = [0u32; 7];
    for f in features {
        counts[f.day_of_week as usize] += 1;
    }
    counts
        .iter()
        .enumerate()
        .max_by_key(|&(_, &c)| c)
        .map(|(i, _)| i as u8)
        .unwrap_or(0)
}

/// Determine season label for the cluster.
/// If activities span all seasons, returns "all".
/// Otherwise returns the dominant season.
fn compute_season_label(features: &[&&ActivityFeature]) -> String {
    let mut season_counts = HashMap::new();
    for f in features {
        let s = season_from_timestamp(f.date);
        *season_counts.entry(s).or_insert(0u32) += 1;
    }

    let total = features.len() as f64;
    let dominant = season_counts
        .iter()
        .max_by_key(|&(_, &c)| c)
        .map(|(s, &c)| (s.clone(), c));

    match dominant {
        Some((season, count)) => {
            // If dominant season has >60% of activities, label it
            if count as f64 / total > 0.6 {
                season
            } else if season_counts.len() >= 3 {
                "all".to_string()
            } else {
                season
            }
        }
        None => "all".to_string(),
    }
}

// ============================================================================
// Section Enrichment
// ============================================================================

/// Enrich pattern with commonly-traversed sections.
fn enrich_with_sections(
    db: &Connection,
    activity_ids: &[&str],
    cluster_size: usize,
) -> Vec<crate::FfiPatternSection> {
    if activity_ids.is_empty() {
        return Vec::new();
    }

    // Build SQL placeholders
    let placeholders: Vec<String> = (0..activity_ids.len()).map(|i| format!("?{}", i + 1)).collect();
    let placeholder_str = placeholders.join(", ");

    // Query section_activities joined with sections for these activity IDs
    let query = format!(
        "SELECT sa.section_id, COALESCE(s.name, ''), COUNT(DISTINCT sa.activity_id) as act_count
         FROM section_activities sa
         JOIN sections s ON sa.section_id = s.id
         WHERE sa.activity_id IN ({})
         GROUP BY sa.section_id
         ORDER BY act_count DESC",
        placeholder_str
    );

    let mut sections: Vec<SectionInfo> = Vec::new();

    let result = db.prepare(&query);
    if let Ok(mut stmt) = result {
        let params: Vec<&dyn rusqlite::types::ToSql> = activity_ids
            .iter()
            .map(|id| id as &dyn rusqlite::types::ToSql)
            .collect();

        let rows = stmt.query_map(params.as_slice(), |row| {
            Ok(SectionInfo {
                section_id: row.get(0)?,
                section_name: row.get(1)?,
                activity_count: row.get(2)?,
            })
        });

        if let Ok(row_iter) = rows {
            for row in row_iter.flatten() {
                // Only include sections appearing in >= 50% of cluster activities
                if row.activity_count as f64 / cluster_size as f64 >= SECTION_APPEARANCE_THRESHOLD {
                    sections.push(row);
                }
            }
        }
    }

    // For each qualifying section, get performance data
    sections
        .iter()
        .filter_map(|si| build_pattern_section(db, si, activity_ids))
        .collect()
}

/// Build an FfiPatternSection from section info with performance data.
fn build_pattern_section(
    db: &Connection,
    section_info: &SectionInfo,
    activity_ids: &[&str],
) -> Option<crate::FfiPatternSection> {
    // Query lap_time from section_activities for this section and these activities
    let placeholders: Vec<String> = (0..activity_ids.len())
        .map(|i| format!("?{}", i + 2)) // +2 because ?1 is section_id
        .collect();
    let placeholder_str = placeholders.join(", ");

    let query = format!(
        "SELECT sa.lap_time, am.date
         FROM section_activities sa
         JOIN activity_metrics am ON sa.activity_id = am.activity_id
         WHERE sa.section_id = ?1
           AND sa.activity_id IN ({})
           AND sa.lap_time IS NOT NULL
         ORDER BY am.date DESC",
        placeholder_str
    );

    let mut best_time: Option<f64> = None;
    let mut recent_times: Vec<f64> = Vec::new();
    let mut all_times: Vec<(i64, f64)> = Vec::new(); // (date, time) for trend
    let mut traversal_count: u32 = 0;

    let result = db.prepare(&query);
    if let Ok(mut stmt) = result {
        let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        params.push(Box::new(section_info.section_id.clone()));
        for id in activity_ids {
            params.push(Box::new(id.to_string()));
        }

        let param_refs: Vec<&dyn rusqlite::types::ToSql> =
            params.iter().map(|p| p.as_ref()).collect();

        let rows = stmt.query_map(param_refs.as_slice(), |row| {
            Ok((
                row.get::<_, f64>(0)?,
                row.get::<_, i64>(1)?,
            ))
        });

        if let Ok(row_iter) = rows {
            for row in row_iter.flatten() {
                let (time, date) = row;
                traversal_count += 1;

                match best_time {
                    None => best_time = Some(time),
                    Some(bt) if time < bt => best_time = Some(time),
                    _ => {}
                }

                // Collect recent 5 for median
                if recent_times.len() < 5 {
                    recent_times.push(time);
                }

                all_times.push((date, time));
            }
        }
    }

    if traversal_count == 0 {
        // No performance data, still return section with basic info
        return Some(crate::FfiPatternSection {
            section_id: section_info.section_id.clone(),
            section_name: section_info.section_name.clone(),
            appearance_rate: section_info.activity_count as f32
                / activity_ids.len().max(1) as f32,
            best_time_secs: 0.0,
            median_recent_secs: 0.0,
            trend: None,
            traversal_count: section_info.activity_count,
        });
    }

    // Compute median of recent times
    recent_times.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let median_recent = if recent_times.is_empty() {
        0.0
    } else {
        let mid = recent_times.len() / 2;
        if recent_times.len() % 2 == 0 && recent_times.len() >= 2 {
            (recent_times[mid - 1] + recent_times[mid]) / 2.0
        } else {
            recent_times[mid]
        }
    };

    // Compute trend: compare first half average vs second half average
    let trend = compute_time_trend(&all_times);

    Some(crate::FfiPatternSection {
        section_id: section_info.section_id.clone(),
        section_name: section_info.section_name.clone(),
        appearance_rate: section_info.activity_count as f32 / activity_ids.len().max(1) as f32,
        best_time_secs: best_time.unwrap_or(0.0) as f32,
        median_recent_secs: median_recent as f32,
        trend,
        traversal_count,
    })
}

/// Compute trend from time series: -1=declining (slower), 0=stable, 1=improving (faster).
/// Times are sorted newest first. Lower time = better (improving).
fn compute_time_trend(times: &[(i64, f64)]) -> Option<i8> {
    if times.len() < 4 {
        return None; // Insufficient data for trend
    }

    let mid = times.len() / 2;

    // times are sorted newest first, so first half = recent, second half = older
    let recent_avg: f64 = times[..mid].iter().map(|(_, t)| t).sum::<f64>() / mid as f64;
    let older_avg: f64 = times[mid..].iter().map(|(_, t)| t).sum::<f64>()
        / (times.len() - mid) as f64;

    // Compare: if recent is faster (lower), that's improving
    let change_pct = (recent_avg - older_avg) / older_avg;

    if change_pct < -0.03 {
        Some(1) // Improving (recent times are lower/faster)
    } else if change_pct > 0.03 {
        Some(-1) // Declining (recent times are higher/slower)
    } else {
        Some(0) // Stable
    }
}

// ============================================================================
// Date / Season Helpers
// ============================================================================

/// Get day of week (0=Mon..6=Sun) from Unix timestamp.
fn day_of_week_from_timestamp(ts: i64) -> u8 {
    // Unix epoch (1970-01-01) was a Thursday (3 in our Mon=0 scheme)
    // Days since epoch mod 7, adjusted for Thursday start
    let days = ts.div_euclid(86400);
    ((days + 3) % 7) as u8 // +3 because epoch is Thursday (Mon=0..Sun=6 -> Thu=3)
}

/// Get season name from Unix timestamp.
fn season_from_timestamp(ts: i64) -> String {
    let month = month_from_timestamp(ts);
    match month {
        12 | 1 | 2 => "winter".to_string(),
        3 | 4 | 5 => "spring".to_string(),
        6 | 7 | 8 => "summer".to_string(),
        9 | 10 | 11 => "autumn".to_string(),
        _ => "all".to_string(),
    }
}

/// Get month (1-12) from Unix timestamp.
fn month_from_timestamp(ts: i64) -> u8 {
    // Simple algorithm to extract month from Unix timestamp
    // Using a days-based approach
    let days_since_epoch = ts.div_euclid(86400);

    // Convert days since epoch to year/month using a standard algorithm
    // Based on Howard Hinnant's chrono-compatible algorithm
    let z = days_since_epoch + 719468; // shift to March 1, year 0
    let era = z.div_euclid(146097);
    let doe = z - era * 146097; // day of era [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100); // day of year [0, 365]
    let mp = (5 * doy + 2) / 153; // month index from March [0, 11]

    // Convert from March-based to January-based
    let month = if mp < 10 { mp + 3 } else { mp - 9 };

    month as u8
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_day_of_week_from_timestamp() {
        // 2024-01-01 is a Monday
        // Unix timestamp for 2024-01-01 00:00:00 UTC = 1704067200
        let dow = day_of_week_from_timestamp(1704067200);
        assert_eq!(dow, 0, "2024-01-01 should be Monday (0)");

        // 2024-01-07 is a Sunday
        let dow = day_of_week_from_timestamp(1704067200 + 6 * 86400);
        assert_eq!(dow, 6, "2024-01-07 should be Sunday (6)");
    }

    #[test]
    fn test_season_from_timestamp() {
        // January 2024
        assert_eq!(season_from_timestamp(1704067200), "winter");
        // June 2024 (roughly)
        assert_eq!(season_from_timestamp(1717200000), "summer");
        // September 2024 (roughly)
        assert_eq!(season_from_timestamp(1725148800), "autumn");
        // April 2024 (roughly)
        assert_eq!(season_from_timestamp(1711929600), "spring");
    }

    #[test]
    fn test_month_from_timestamp() {
        // 2024-01-01 00:00:00 UTC = 1704067200
        assert_eq!(month_from_timestamp(1704067200), 1);
        // 2024-06-01 00:00:00 UTC = 1717200000
        assert_eq!(month_from_timestamp(1717200000), 6);
    }

    #[test]
    fn test_min_max_normalize() {
        assert_eq!(min_max_normalize(5.0, 0.0, 10.0), 0.5);
        assert_eq!(min_max_normalize(0.0, 0.0, 10.0), 0.0);
        assert_eq!(min_max_normalize(10.0, 0.0, 10.0), 1.0);
        // Equal min/max returns 0.5
        assert_eq!(min_max_normalize(5.0, 5.0, 5.0), 0.5);
    }

    #[test]
    fn test_euclidean_sq() {
        let a = [0.0, 0.0, 0.0, 0.0];
        let b = [1.0, 0.0, 0.0, 0.0];
        assert!((euclidean_sq(&a, &b) - 1.0).abs() < 1e-10);

        let c = [1.0, 1.0, 1.0, 1.0];
        assert!((euclidean_sq(&a, &c) - 4.0).abs() < 1e-10);
    }

    #[test]
    fn test_kmeans_basic() {
        // Two clear clusters: low values and high values
        let data = vec![
            [0.0, 0.1, 0.0, 0.1],
            [0.1, 0.0, 0.1, 0.0],
            [0.0, 0.0, 0.1, 0.1],
            [0.9, 0.8, 0.9, 0.8],
            [0.8, 0.9, 0.8, 0.9],
            [0.9, 0.9, 0.8, 0.8],
        ];

        let (centroids, assignments) = kmeans(&data, 2);
        assert_eq!(centroids.len(), 2);
        assert_eq!(assignments.len(), 6);

        // First 3 should be in same cluster, last 3 in another
        assert_eq!(assignments[0], assignments[1]);
        assert_eq!(assignments[1], assignments[2]);
        assert_eq!(assignments[3], assignments[4]);
        assert_eq!(assignments[4], assignments[5]);
        assert_ne!(assignments[0], assignments[3]);
    }

    #[test]
    fn test_silhouette_perfect_separation() {
        let data = vec![
            [0.0, 0.0, 0.0, 0.0],
            [0.0, 0.0, 0.0, 0.1],
            [1.0, 1.0, 1.0, 1.0],
            [1.0, 1.0, 1.0, 0.9],
        ];
        let assignments = vec![0, 0, 1, 1];
        let sil = compute_silhouette(&data, &assignments, 2);
        assert!(sil > 0.8, "Well-separated clusters should have high silhouette, got {}", sil);
    }

    #[test]
    fn test_compute_time_trend() {
        // Improving: recent times are faster (lower)
        let times = vec![
            (100, 60.0), // newest: faster
            (90, 65.0),
            (80, 70.0),
            (70, 75.0), // oldest: slower
        ];
        assert_eq!(compute_time_trend(&times), Some(1)); // improving

        // Declining: recent times are slower (higher)
        let times = vec![
            (100, 75.0), // newest: slower
            (90, 70.0),
            (80, 65.0),
            (70, 60.0), // oldest: faster
        ];
        assert_eq!(compute_time_trend(&times), Some(-1)); // declining

        // Insufficient data
        let times = vec![(100, 60.0), (90, 65.0)];
        assert_eq!(compute_time_trend(&times), None);
    }

    #[test]
    fn test_confidence_score_range() {
        let c = compute_confidence(0.8, 30, 180, 2.0);
        assert!(c >= 0.0 && c <= 1.0, "Confidence should be 0..1, got {}", c);

        // Higher values should yield higher confidence
        let c_high = compute_confidence(0.9, 50, 365, 4.0);
        let c_low = compute_confidence(0.3, 6, 90, 0.5);
        assert!(
            c_high > c_low,
            "Higher quality should yield higher confidence: {} vs {}",
            c_high,
            c_low
        );
    }

    #[test]
    fn test_mode_day_of_week() {
        let features = vec![
            ActivityFeature {
                activity_id: "a".to_string(),
                sport_type: "Ride".to_string(),
                day_of_week: 0,
                date: 0,
                duration_secs: 3600,
                tss: 50.0,
                distance_meters: 30000.0,
            },
            ActivityFeature {
                activity_id: "b".to_string(),
                sport_type: "Ride".to_string(),
                day_of_week: 0,
                date: 0,
                duration_secs: 3600,
                tss: 50.0,
                distance_meters: 30000.0,
            },
            ActivityFeature {
                activity_id: "c".to_string(),
                sport_type: "Ride".to_string(),
                day_of_week: 5,
                date: 0,
                duration_secs: 3600,
                tss: 50.0,
                distance_meters: 30000.0,
            },
        ];

        // mode_day_of_week takes &[&&ActivityFeature] to match the build_pattern call site
        let feature_refs: Vec<&ActivityFeature> = features.iter().collect();
        let double_refs: Vec<&&ActivityFeature> = feature_refs.iter().collect();
        assert_eq!(mode_day_of_week(&double_refs), 0);
    }

    #[test]
    fn test_empty_metrics_returns_empty() {
        // Cannot test compute_activity_patterns without a real DB connection,
        // but we can verify the early return path is sane
        let features: Vec<&ActivityFeature> = vec![];
        let normalized = normalize_features(&features);
        assert!(normalized.is_empty());
    }

    #[test]
    fn test_normalize_features_single() {
        let f = ActivityFeature {
            activity_id: "a".to_string(),
            sport_type: "Ride".to_string(),
            day_of_week: 3,
            date: 0,
            duration_secs: 3600,
            tss: 50.0,
            distance_meters: 30000.0,
        };
        let features = vec![&f];
        let normalized = normalize_features(&features);
        assert_eq!(normalized.len(), 1);
        // With single item, duration/tss/distance normalize to 0.5 (equal min/max)
        assert!((normalized[0][1] - 0.5).abs() < 1e-10);
        assert!((normalized[0][2] - 0.5).abs() < 1e-10);
        assert!((normalized[0][3] - 0.5).abs() < 1e-10);
        // Day 3 / 6.0 = 0.5
        assert!((normalized[0][0] - 0.5).abs() < 1e-10);
    }
}
