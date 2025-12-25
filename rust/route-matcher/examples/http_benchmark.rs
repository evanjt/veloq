//! HTTP benchmark to measure pure network performance
//! Run with: cargo run --example http_benchmark --features http

use std::time::{Duration, Instant};

// Activity IDs from the real test
const ACTIVITY_IDS: &[&str] = &[
    "i112922385", "i113187035", "i112882351", "i112882349", "i112922381",
    "i113676431", "i112922379", "i112882348", "i112882289", "i112893138",
    "i112922380", "i113537934", "i112922378", "i112922382", "i112922376",
    "i112922374", "i112922375", "i112922369", "i112922371", "i112922370",
    "i112922372", "i112922368", "i112922365", "i112922363", "i112922357",
    "i112922356", "i112922353", "i112922352", "i112922349", "i112922347",
    "i112922345", "i112922344", "i112922339", "i112922336", "i112922335",
    "i112922334", "i112922333", "i112922331", "i112922328", "i112922327",
    "i112922326", "i112922324", "i112922319", "i112922323", "i112922318",
    "i112922314", "i112922313", "i112922310", "i112922304", "i112922302",
];

const API_KEY: &str = "13qn4yv80siw0fzm6anvop36f";
const DISPATCH_INTERVAL_MS: u64 = 80;  // Same as v6-sustained

#[derive(Debug, serde::Deserialize)]
struct MapApiResponse {
    bounds: Option<ApiBounds>,
    latlngs: Option<Vec<Option<[f64; 2]>>>,
}

#[derive(Debug, serde::Deserialize)]
struct ApiBounds {
    ne: [f64; 2],
    sw: [f64; 2],
}

#[derive(Debug)]
struct TimingResult {
    activity_id: String,
    headers_ms: f64,
    body_ms: f64,
    body_kb: f64,
    json_ms: f64,
    transform_ms: f64,
    total_ms: f64,
    points: usize,
    success: bool,
    error: Option<String>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    use base64::Engine;
    use futures::stream::{self, StreamExt};
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::Arc;
    use tokio::sync::Mutex;

    println!("HTTP Benchmark v6-sustained");
    println!("============================");
    println!("Activities: {}", ACTIVITY_IDS.len());
    println!("Dispatch interval: {}ms ({:.1} req/s)", DISPATCH_INTERVAL_MS, 1000.0 / DISPATCH_INTERVAL_MS as f64);
    println!();

    let auth = base64::engine::general_purpose::STANDARD
        .encode(format!("API_KEY:{}", API_KEY));
    let auth_header = format!("Basic {}", auth);

    let client = reqwest::Client::builder()
        .pool_max_idle_per_host(100)
        .pool_idle_timeout(Duration::from_secs(60))
        .tcp_keepalive(Duration::from_secs(30))
        .timeout(Duration::from_secs(30))
        .build()?;

    // Dispatch rate limiter
    let next_dispatch = Arc::new(Mutex::new(Instant::now()));
    let dispatch_count = Arc::new(AtomicU32::new(0));

    let start = Instant::now();

    let results: Vec<TimingResult> = stream::iter(ACTIVITY_IDS.iter())
        .map(|&id| {
            let client = client.clone();
            let auth = auth_header.clone();
            let next_dispatch = Arc::clone(&next_dispatch);
            let dispatch_count = Arc::clone(&dispatch_count);

            async move {
                // Wait for dispatch slot
                let wait_duration = {
                    let mut next = next_dispatch.lock().await;
                    let now = Instant::now();
                    let dispatch_at = if *next > now { *next } else { now };
                    *next = dispatch_at + Duration::from_millis(DISPATCH_INTERVAL_MS);
                    if dispatch_at > now { dispatch_at - now } else { Duration::ZERO }
                };
                if wait_duration > Duration::from_millis(5) {
                    tokio::time::sleep(wait_duration).await;
                }
                let dispatch_num = dispatch_count.fetch_add(1, Ordering::Relaxed) + 1;

                let req_start = Instant::now();
                let url = format!("https://intervals.icu/api/v1/activity/{}/map", id);

                // Phase 1: Headers
                let resp = match client.get(&url).header("Authorization", &auth).send().await {
                    Ok(r) => r,
                    Err(e) => return TimingResult {
                        activity_id: id.to_string(),
                        headers_ms: req_start.elapsed().as_secs_f64() * 1000.0,
                        body_ms: 0.0, body_kb: 0.0, json_ms: 0.0, transform_ms: 0.0,
                        total_ms: req_start.elapsed().as_secs_f64() * 1000.0,
                        points: 0, success: false, error: Some(e.to_string()),
                    },
                };
                let headers_elapsed = req_start.elapsed();

                if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
                    return TimingResult {
                        activity_id: id.to_string(),
                        headers_ms: headers_elapsed.as_secs_f64() * 1000.0,
                        body_ms: 0.0, body_kb: 0.0, json_ms: 0.0, transform_ms: 0.0,
                        total_ms: req_start.elapsed().as_secs_f64() * 1000.0,
                        points: 0, success: false, error: Some("429 Too Many Requests".to_string()),
                    };
                }

                // Phase 2: Body download
                let body_start = Instant::now();
                let bytes = match resp.bytes().await {
                    Ok(b) => b,
                    Err(e) => return TimingResult {
                        activity_id: id.to_string(),
                        headers_ms: headers_elapsed.as_secs_f64() * 1000.0,
                        body_ms: body_start.elapsed().as_secs_f64() * 1000.0,
                        body_kb: 0.0, json_ms: 0.0, transform_ms: 0.0,
                        total_ms: req_start.elapsed().as_secs_f64() * 1000.0,
                        points: 0, success: false, error: Some(e.to_string()),
                    },
                };
                let body_elapsed = body_start.elapsed();
                let body_size = bytes.len();

                // Phase 3: JSON parse
                let json_start = Instant::now();
                let data: MapApiResponse = match serde_json::from_slice(&bytes) {
                    Ok(d) => d,
                    Err(e) => return TimingResult {
                        activity_id: id.to_string(),
                        headers_ms: headers_elapsed.as_secs_f64() * 1000.0,
                        body_ms: body_elapsed.as_secs_f64() * 1000.0,
                        body_kb: body_size as f64 / 1024.0,
                        json_ms: json_start.elapsed().as_secs_f64() * 1000.0,
                        transform_ms: 0.0,
                        total_ms: req_start.elapsed().as_secs_f64() * 1000.0,
                        points: 0, success: false, error: Some(e.to_string()),
                    },
                };
                let json_elapsed = json_start.elapsed();
                let point_count = data.latlngs.as_ref().map_or(0, |v| v.len());

                // Phase 4: Transform (flatten)
                let transform_start = Instant::now();
                let _latlngs: Option<Vec<[f64; 2]>> = data.latlngs.map(|coords| {
                    coords.into_iter().flatten().collect()
                });
                let transform_elapsed = transform_start.elapsed();

                let total_elapsed = req_start.elapsed();

                println!("[{:2}] {} | headers={:6.1}ms body={:6.1}ms({:5.1}KB) json={:6.2}ms transform={:6.3}ms | total={:7.1}ms pts={}",
                    dispatch_num, id,
                    headers_elapsed.as_secs_f64() * 1000.0,
                    body_elapsed.as_secs_f64() * 1000.0,
                    body_size as f64 / 1024.0,
                    json_elapsed.as_secs_f64() * 1000.0,
                    transform_elapsed.as_secs_f64() * 1000.0,
                    total_elapsed.as_secs_f64() * 1000.0,
                    point_count
                );

                TimingResult {
                    activity_id: id.to_string(),
                    headers_ms: headers_elapsed.as_secs_f64() * 1000.0,
                    body_ms: body_elapsed.as_secs_f64() * 1000.0,
                    body_kb: body_size as f64 / 1024.0,
                    json_ms: json_elapsed.as_secs_f64() * 1000.0,
                    transform_ms: transform_elapsed.as_secs_f64() * 1000.0,
                    total_ms: total_elapsed.as_secs_f64() * 1000.0,
                    points: point_count,
                    success: true,
                    error: None,
                }
            }
        })
        .buffer_unordered(50)
        .collect()
        .await;

    let elapsed = start.elapsed();
    let success_count = results.iter().filter(|r| r.success).count();
    let error_count = results.iter().filter(|r| !r.success).count();

    println!();
    println!("============================");
    println!("RESULTS");
    println!("============================");
    println!("Total: {:.2}s ({:.1} req/s)", elapsed.as_secs_f64(), ACTIVITY_IDS.len() as f64 / elapsed.as_secs_f64());
    println!("Success: {}/{} ({} errors)", success_count, ACTIVITY_IDS.len(), error_count);
    println!();

    // Calculate averages for successful requests
    let successful: Vec<_> = results.iter().filter(|r| r.success).collect();
    if !successful.is_empty() {
        let avg_headers = successful.iter().map(|r| r.headers_ms).sum::<f64>() / successful.len() as f64;
        let avg_body = successful.iter().map(|r| r.body_ms).sum::<f64>() / successful.len() as f64;
        let avg_json = successful.iter().map(|r| r.json_ms).sum::<f64>() / successful.len() as f64;
        let avg_transform = successful.iter().map(|r| r.transform_ms).sum::<f64>() / successful.len() as f64;
        let avg_total = successful.iter().map(|r| r.total_ms).sum::<f64>() / successful.len() as f64;
        let total_kb = successful.iter().map(|r| r.body_kb).sum::<f64>();
        let total_points = successful.iter().map(|r| r.points).sum::<usize>();

        println!("TIMING BREAKDOWN (averages):");
        println!("  Headers (connect+TLS+server): {:6.1}ms", avg_headers);
        println!("  Body download:                {:6.1}ms", avg_body);
        println!("  JSON parse:                   {:6.2}ms", avg_json);
        println!("  Transform (flatten):          {:6.3}ms", avg_transform);
        println!("  Total per request:            {:6.1}ms", avg_total);
        println!();
        println!("DATA:");
        println!("  Total downloaded: {:.1} KB", total_kb);
        println!("  Total points: {}", total_points);
    }

    // Show errors if any
    let errors: Vec<_> = results.iter().filter(|r| !r.success).collect();
    if !errors.is_empty() {
        println!();
        println!("ERRORS:");
        for e in errors {
            println!("  {} - {:?}", e.activity_id, e.error);
        }
    }

    Ok(())
}
