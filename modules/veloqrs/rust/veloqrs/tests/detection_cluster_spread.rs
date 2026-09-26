//! How many geographically disjoint areas a real library holds, and how much of
//! it the largest one is.
//!
//! Detection clusters activities by padded bounding-box overlap, and an
//! incremental fold recomputes only the clusters a new activity touches. So the
//! most a narrowed track load could avoid is everything outside the cluster the
//! new activity lands in, and the answer is a property of the athlete's own
//! geography rather than of the code. An athlete who rides from one house has
//! one cluster and there is nothing to avoid.
//!
//! The pad is the detector's own `cluster_gap_m`, 50 km, which is wide: two
//! towns an hour apart are one area.
//!
//! The corpus is a real database named by `VELOQ_DEVICE_DB`, read-only, and the
//! bounds it reads are the stored per-activity ones. Nothing is asserted about
//! the size of the numbers; it prints.
//!
//! Run: `VELOQ_DEVICE_DB=/path/to/routes.db cargo test --test detection_cluster_spread -p veloqrs -- --ignored --nocapture`

use std::collections::HashMap;

use rusqlite::Connection;

/// The detector's cluster gap, `Tunables::DEFAULT.cluster_gap_m`.
const CLUSTER_GAP_M: f64 = 50_000.0;

type Bbox = (f64, f64, f64, f64);

fn pad(b: Bbox) -> Bbox {
    let (lat0, lat1, lng0, lng1) = b;
    let d_lat = CLUSTER_GAP_M / 111_000.0;
    let ref_lat = ((lat0 + lat1) / 2.0).to_radians();
    let d_lng = CLUSTER_GAP_M / (111_000.0 * ref_lat.cos().max(1e-6));
    (lat0 - d_lat, lat1 + d_lat, lng0 - d_lng, lng1 + d_lng)
}

fn overlaps(a: Bbox, b: Bbox) -> bool {
    !(a.1 < b.0 || b.1 < a.0 || a.3 < b.2 || b.3 < a.2)
}

struct Unions(Vec<usize>);

impl Unions {
    fn new(n: usize) -> Self {
        Self((0..n).collect())
    }
    fn find(&mut self, mut x: usize) -> usize {
        while self.0[x] != x {
            self.0[x] = self.0[self.0[x]];
            x = self.0[x];
        }
        x
    }
    fn join(&mut self, a: usize, b: usize) {
        let (ra, rb) = (self.find(a), self.find(b));
        if ra != rb {
            self.0[ra] = rb;
        }
    }
}

#[test]
#[ignore = "needs a real database in VELOQ_DEVICE_DB"]
fn how_many_areas_a_real_library_holds() {
    let Ok(path) = std::env::var("VELOQ_DEVICE_DB") else {
        eprintln!("set VELOQ_DEVICE_DB to a real routes.db, skipping");
        return;
    };

    let db = Connection::open(&path).expect("open the corpus");
    let boxes: Vec<Bbox> = db
        .prepare("SELECT min_lat, max_lat, min_lng, max_lng FROM activities")
        .expect("prepare")
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .expect("query")
        .map(|r| r.expect("row"))
        .collect();

    let padded: Vec<Bbox> = boxes.iter().copied().map(pad).collect();
    let mut unions = Unions::new(padded.len());
    for i in 0..padded.len() {
        for j in (i + 1)..padded.len() {
            if overlaps(padded[i], padded[j]) {
                unions.join(i, j);
            }
        }
    }

    let mut sizes: HashMap<usize, usize> = HashMap::new();
    for i in 0..padded.len() {
        let root = unions.find(i);
        *sizes.entry(root).or_default() += 1;
    }
    let mut counts: Vec<usize> = sizes.into_values().collect();
    counts.sort_unstable_by(|a, b| b.cmp(a));

    let total = boxes.len();
    println!(
        "{total} activities, {} disjoint areas at a {:.0} km pad",
        counts.len(),
        CLUSTER_GAP_M / 1000.0
    );
    println!(
        "areas by size, largest first: {:?}",
        &counts[..counts.len().min(12)]
    );
    if let Some(&largest) = counts.first() {
        println!(
            "the largest holds {largest} of {total}, {:.1}%, so a new activity landing in it \
             would have a narrowed load avoid only {:.1}%",
            100.0 * largest as f64 / total as f64,
            100.0 * (total - largest) as f64 / total as f64
        );
    }

    assert!(total > 0, "the corpus held no activities");
}
