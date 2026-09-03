//! Wait and hold timing on the engine lock, per caller.
//!
//! Compiled only with the `lock-trace` feature, so a shipping build pays
//! nothing. Every `with_engine` and `with_persistent_engine` call records how
//! long it waited for the write lock and how long its closure held it, keyed by
//! the call site. A call that waits or holds longer than half a frame is logged
//! as it happens, with its thread, and a reporter thread prints the per-caller
//! tables every fifteen seconds, by hold, by call count and by longest wait, so
//! the histogram can be read out of logcat.

use std::collections::HashMap;
use std::panic::Location;
use std::sync::{Mutex, Once};
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;

const SLOW: Duration = Duration::from_millis(8);
const REPORT_EVERY: Duration = Duration::from_secs(15);
const TOP: usize = 15;

/// Upper edge of each bucket, in milliseconds. The last bucket is open.
const EDGES_MS: [u128; 6] = [1, 4, 8, 16, 64, 256];

#[derive(Default)]
struct Stat {
    calls: u64,
    wait_total: Duration,
    wait_max: Duration,
    hold_total: Duration,
    hold_max: Duration,
    wait_hist: [u32; 7],
    hold_hist: [u32; 7],
}

struct Table {
    by_caller: HashMap<&'static Location<'static>, Stat>,
    wait_hist: [u32; 7],
    hold_hist: [u32; 7],
    calls: u64,
    dirty: bool,
}

static TABLE: Lazy<Mutex<Table>> = Lazy::new(|| {
    Mutex::new(Table {
        by_caller: HashMap::new(),
        wait_hist: [0; 7],
        hold_hist: [0; 7],
        calls: 0,
        dirty: false,
    })
});
static REPORTER: Once = Once::new();

fn bucket(d: Duration) -> usize {
    let ms = d.as_millis();
    EDGES_MS.iter().position(|edge| ms < *edge).unwrap_or(6)
}

fn ms(d: Duration) -> f64 {
    d.as_secs_f64() * 1000.0
}

/// A guard that times the wait on construction and the hold on drop.
pub struct Timing {
    caller: &'static Location<'static>,
    started: Instant,
    acquired: Option<Instant>,
}

impl Timing {
    pub fn begin(caller: &'static Location<'static>) -> Self {
        REPORTER.call_once(spawn_reporter);
        Self {
            caller,
            started: Instant::now(),
            acquired: None,
        }
    }

    pub fn acquired(&mut self) {
        self.acquired = Some(Instant::now());
    }
}

impl Drop for Timing {
    fn drop(&mut self) {
        let now = Instant::now();
        let acquired = self.acquired.unwrap_or(now);
        let wait = acquired - self.started;
        let hold = now - acquired;
        record(self.caller, wait, hold);
    }
}

fn record(caller: &'static Location<'static>, wait: Duration, hold: Duration) {
    if wait >= SLOW || hold >= SLOW {
        let thread = std::thread::current();
        log::info!(
            "[LockTrace] slow {}:{} thread={} wait={:.1}ms hold={:.1}ms",
            caller.file(),
            caller.line(),
            thread.name().unwrap_or("?"),
            ms(wait),
            ms(hold),
        );
    }
    let mut table = TABLE.lock().unwrap_or_else(|e| e.into_inner());
    let wb = bucket(wait);
    let hb = bucket(hold);
    table.wait_hist[wb] += 1;
    table.hold_hist[hb] += 1;
    table.calls += 1;
    table.dirty = true;
    let stat = table.by_caller.entry(caller).or_default();
    stat.calls += 1;
    stat.wait_total += wait;
    stat.wait_max = stat.wait_max.max(wait);
    stat.hold_total += hold;
    stat.hold_max = stat.hold_max.max(hold);
    stat.wait_hist[wb] += 1;
    stat.hold_hist[hb] += 1;
}

fn hist(h: &[u32; 7]) -> String {
    format!(
        "<1:{} <4:{} <8:{} <16:{} <64:{} <256:{} 256+:{}",
        h[0], h[1], h[2], h[3], h[4], h[5], h[6]
    )
}

fn spawn_reporter() {
    std::thread::Builder::new()
        .name("lock-trace".into())
        .spawn(|| {
            loop {
                std::thread::sleep(REPORT_EVERY);
                report();
            }
        })
        .ok();
}

fn report() {
    let mut table = TABLE.lock().unwrap_or_else(|e| e.into_inner());
    if !table.dirty {
        return;
    }
    table.dirty = false;
    log::info!(
        "[LockTrace] summary calls={} callers={} wait[{}] hold[{}]",
        table.calls,
        table.by_caller.len(),
        hist(&table.wait_hist),
        hist(&table.hold_hist),
    );
    let mut rows: Vec<_> = table.by_caller.iter().collect();
    rows.sort_by(|a, b| b.1.hold_total.cmp(&a.1.hold_total));
    for (caller, s) in rows.iter().take(TOP) {
        log::info!(
            "[LockTrace] hold {}:{} calls={} sum={:.1}ms max={:.1}ms wait_sum={:.1}ms wait_max={:.1}ms hold[{}]",
            caller.file(),
            caller.line(),
            s.calls,
            ms(s.hold_total),
            ms(s.hold_max),
            ms(s.wait_total),
            ms(s.wait_max),
            hist(&s.hold_hist),
        );
    }
    rows.sort_by(|a, b| b.1.calls.cmp(&a.1.calls));
    for (caller, s) in rows.iter().take(TOP) {
        log::info!(
            "[LockTrace] calls {}:{} calls={} sum={:.1}ms max={:.1}ms",
            caller.file(),
            caller.line(),
            s.calls,
            ms(s.hold_total),
            ms(s.hold_max),
        );
    }
    rows.sort_by(|a, b| b.1.wait_max.cmp(&a.1.wait_max));
    for (caller, s) in rows.iter().take(TOP) {
        if s.wait_max < Duration::from_millis(1) {
            break;
        }
        log::info!(
            "[LockTrace] wait {}:{} calls={} wait_sum={:.1}ms wait_max={:.1}ms wait[{}]",
            caller.file(),
            caller.line(),
            s.calls,
            ms(s.wait_total),
            ms(s.wait_max),
            hist(&s.wait_hist),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buckets_split_on_their_edges() {
        assert_eq!(bucket(Duration::from_micros(999)), 0);
        assert_eq!(bucket(Duration::from_millis(1)), 1);
        assert_eq!(bucket(Duration::from_millis(3)), 1);
        assert_eq!(bucket(Duration::from_millis(8)), 3);
        assert_eq!(bucket(Duration::from_millis(255)), 5);
        assert_eq!(bucket(Duration::from_millis(256)), 6);
        assert_eq!(bucket(Duration::from_secs(9)), 6);
    }

    #[test]
    fn a_take_is_keyed_by_the_site_that_asked() {
        let line = line!() + 1;
        crate::persistence::with_persistent_engine(|_| ());
        let table = TABLE.lock().unwrap();
        let hit = table
            .by_caller
            .keys()
            .find(|loc| loc.line() == line && loc.file().ends_with("lock_trace.rs"));
        assert!(
            hit.is_some(),
            "no row for line {line}: {:?}",
            table.by_caller.keys()
        );
    }
}
