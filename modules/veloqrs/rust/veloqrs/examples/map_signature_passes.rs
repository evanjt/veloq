//! What the three passes over every map signature cost, split.
//!
//! `get_all_map_signatures` reads each `signatures` row, decodes the blob with
//! `TrackRead::from_blob`, takes the centre off `Bounds::from_points` and
//! re-encodes the points with `coords::encode`; `useRouteSignatures.ts` then
//! decodes that again in TypeScript on the JS thread. Which end moves cannot
//! be chosen without knowing which pass owns the time, so this times the
//! Rust ones apart rather than the call as a whole.
//!
//! The JS pass is not measurable from here. `--dump <dir>` writes every encoded
//! blob out so the TypeScript decoder can be timed over the same bytes.
//!
//! It runs against a copy of a real library, so the point counts are the
//! athlete's rather than a generator's. Pull one off a debuggable build:
//!
//!     adb shell run-as com.veloq.app.dev cat files/routes.db > /tmp/routes.db
//!     adb push /tmp/routes.db /data/local/tmp/routes.db
//!
//! Usage:
//!   VELOQ_DB=/data/local/tmp/routes.db ./map_signature_passes
//!
//! Optional:
//!   VELOQ_RUNS=5           runs, default 3
//!   VELOQ_DUMP=/tmp/sigs   write the encoded blobs there, one file per row
//!
//! Build for the handset with `cargo ndk -t arm64-v8a build --release -p
//! veloqrs --example map_signature_passes`, push the binary, and delete it and
//! the database copy afterwards.

use std::time::{Duration, Instant};

use rusqlite::Connection;
use veloqrs::Bounds;
use veloqrs::persistence::codec::TrackRead;

fn median(mut xs: Vec<f64>) -> f64 {
    xs.sort_by(|a, b| a.partial_cmp(b).expect("no NaN"));
    xs[xs.len() / 2]
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

fn main() {
    let db = std::env::var("VELOQ_DB").expect("VELOQ_DB names the database to read");
    let runs: usize = std::env::var("VELOQ_RUNS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3);
    let dump = std::env::var("VELOQ_DUMP").ok();

    let conn = Connection::open(&db).expect("database opens");

    let mut sql = Vec::new();
    let mut decode = Vec::new();
    let mut centre = Vec::new();
    let mut encode = Vec::new();
    let mut rows_seen = 0usize;
    let mut points_seen = 0usize;
    let mut stored_bytes = 0usize;
    let mut encoded_bytes = 0usize;

    for run in 0..runs {
        // Every pass is timed over the same rows in the same order, so the
        // split is of one walk rather than of three different reads.
        let t0 = Instant::now();
        let blobs: Vec<(String, Vec<u8>)> = {
            let mut stmt = conn
                .prepare("SELECT activity_id, points FROM signatures")
                .expect("signatures query");
            let rows = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, Vec<u8>>(1)?))
                })
                .expect("signatures rows");
            rows.flatten().collect()
        };
        sql.push(ms(t0.elapsed()));

        let mut decoded = Vec::with_capacity(blobs.len());
        let t1 = Instant::now();
        for (id, blob) in &blobs {
            if let Some(points) = TrackRead::from_blob(blob).into_option("map_signatures", id)
                && !points.is_empty()
            {
                decoded.push((id.clone(), points));
            }
        }
        decode.push(ms(t1.elapsed()));

        let t2 = Instant::now();
        let mut centres = Vec::with_capacity(decoded.len());
        for (_, points) in &decoded {
            centres.push(Bounds::from_points(points).map(|b| b.center()));
        }
        centre.push(ms(t2.elapsed()));

        let t3 = Instant::now();
        let mut encoded = Vec::with_capacity(decoded.len());
        for (_, points) in &decoded {
            encoded.push(veloqrs::coords::encode(points));
        }
        encode.push(ms(t3.elapsed()));

        if run == 0 {
            rows_seen = decoded.len();
            points_seen = decoded.iter().map(|(_, p)| p.len()).sum();
            stored_bytes = blobs.iter().map(|(_, b)| b.len()).sum();
            encoded_bytes = encoded.iter().map(|b| b.len()).sum();
            if let Some(dir) = &dump {
                std::fs::create_dir_all(dir).expect("dump directory");
                for ((id, _), bytes) in decoded.iter().zip(&encoded) {
                    std::fs::write(format!("{dir}/{id}.bin"), bytes).expect("dump write");
                }
                println!("wrote {} blobs to {dir}", encoded.len());
            }
        }
        // The centres and the encodings are what the call returns, so nothing
        // above is dead: hold them until the run's timings are taken.
        std::hint::black_box((centres, encoded));
    }

    let s = median(sql);
    let d = median(decode);
    let c = median(centre);
    let e = median(encode);
    println!(
        "{db}: {rows_seen} signatures, {points_seen} points, {stored_bytes} stored bytes, {encoded_bytes} encoded bytes, {runs} runs"
    );
    println!("  sql read     {s:>8.2} ms");
    println!("  rust decode  {d:>8.2} ms");
    println!("  centre       {c:>8.2} ms");
    println!("  rust encode  {e:>8.2} ms");
    println!("  rust total   {:>8.2} ms", s + d + c + e);
}
