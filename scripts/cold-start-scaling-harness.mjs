#!/usr/bin/env node
// cold-start-scaling-harness: repeatable big-corpus memory/scaling stress run.
//
// Drives an already-installed dev build on an Android emulator via adb. It does
// NOT build the app. For each N in {50,200,500,1000} it clears app data, launches,
// triggers sync/detection, then polls meminfo for peak RSS and scans logcat for
// OOM-class events and detection phase durations. Emits one CSV row per N to
// scripts/.cold-start-baseline.csv as the regression guard for the FULL-mode
// track-load cap and detection progress-bar work (audit item #31).
//
// Run on-demand only (slow, emulator-bound). Never wire into pre-commit or CI gates.
//
// Prereqs:
//   - A dev build of com.veloq.app.dev installed on a single running emulator.
//   - adb on PATH.
//   - For N beyond the built-in demo corpus, a real seed (see SEEDING below).
//
// Usage:
//   node scripts/cold-start-scaling-harness.mjs
//   node scripts/cold-start-scaling-harness.mjs --n 50,200
//   APP_ID=com.veloq.app.dev SETTLE_MS=120000 node scripts/cold-start-scaling-harness.mjs

import { execSync, spawn } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(SCRIPT_DIR, '.cold-start-baseline.csv');

const APP_ID = process.env.APP_ID || 'com.veloq.app.dev';
// The detection progress banner stays indeterminate after ~120s on a large first
// sync (see "Detection progress" in docs/AUDIT_PLAN.md §7). We settle for that long
// so the banner-state capture reflects the post-120s case the audit cares about.
const SETTLE_MS = Number(process.env.SETTLE_MS || 120000);
const MEMINFO_POLL_MS = Number(process.env.MEMINFO_POLL_MS || 3000);

const DEFAULT_NS = [50, 200, 500, 1000];

function adb(args) {
  // Robust to adb hiccups: never throw, callers handle empty output.
  try {
    return execSync(`adb ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function adbShell(cmd) {
  return adb(`shell ${cmd} || true`);
}

function log(msg) {
  console.log(`[cold-start] ${msg}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function checkEmulator() {
  const devices = adb('devices');
  const online = devices
    .split('\n')
    .slice(1)
    .filter((line) => line.trim().endsWith('\tdevice'));
  if (online.length === 0) {
    log('ERROR: no online adb device. Start one emulator and install the dev build first.');
    process.exit(1);
  }
  if (online.length > 1) {
    log('WARNING: multiple devices online. adb may target the wrong one. Disconnect extras.');
  }
}

// The app ships a built-in demo mode (src/data/demo/) with a fixed, small fixture
// corpus. There is NO programmatic API to seed N=500/1000 GPS activities. Seeding a
// large corpus is a manual step until a debug FFI or fixture multiplier exists. We
// do not fabricate one here. For N at or below the demo size, "seeding" means
// enabling demo mode through the login screen; beyond that, the operator must
// pre-load a real account or larger fixture set before running this harness.
function describeSeeding(n) {
  log(`SEEDING N=${n}:`);
  log('  No programmatic large-corpus seed exists in the app.');
  log('  - Small N: enable demo mode from the login screen (fixed fixture size).');
  log('  - Large N (500/1000): MANUAL/TODO. Pre-load a real intervals.icu account');
  log('    with the target activity count, or add a debug FFI / fixture multiplier');
  log('    and seed before launch. This harness assumes the corpus is already');
  log('    present on the device; it measures, it does not generate data.');
  log('  If the corpus does not actually contain N activities, the row below is a');
  log('  lower-bound measurement, not a true N-scaling point.');
}

function clearAppData() {
  // pm clear wipes the app data dir including the Rust SQLite DB. The Rust
  // PERSISTENT_ENGINE singleton can hold a stale handle to the deleted DB across a
  // warm relaunch (see CLAUDE.md "clearState + Rust singleton"), so force-stop too.
  adbShell(`am force-stop ${APP_ID}`);
  adbShell(`pm clear ${APP_ID}`);
}

function launchApp() {
  adbShell(`monkey -p ${APP_ID} -c android.intent.category.LAUNCHER 1`);
}

function clearLogcat() {
  adb('logcat -c');
}

function parsePeakRssMb(meminfoOutput) {
  // dumpsys meminfo reports "TOTAL PSS" / "TOTAL RSS" in KB. Prefer RSS, fall back
  // to PSS. Format varies across Android versions, so match leniently.
  const rss = meminfoOutput.match(/TOTAL\s+RSS[:\s]+(\d+)/i) || meminfoOutput.match(/TOTAL\s+(\d+)\s+\d+\s+\d+/);
  if (rss) return Math.round(Number(rss[1]) / 1024);
  return 0;
}

async function pollPeakRss(durationMs) {
  let peakMb = 0;
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline) {
    const out = adbShell(`dumpsys meminfo ${APP_ID}`);
    const mb = parsePeakRssMb(out);
    if (mb > peakMb) {
      peakMb = mb;
      log(`  RSS peak so far: ${peakMb} MB`);
    }
    await sleep(MEMINFO_POLL_MS);
  }
  return peakMb;
}

// Collect logcat for the settle window into a buffer we can scan after the run.
function startLogcatCapture() {
  const buffer = [];
  const proc = spawn('adb', ['logcat', '-v', 'time'], { stdio: ['ignore', 'pipe', 'ignore'] });
  proc.stdout.on('data', (chunk) => buffer.push(chunk.toString()));
  proc.on('error', () => {}); // adb hiccup: just yield an empty buffer
  return {
    stop() {
      try {
        proc.kill();
      } catch {
        // ignore
      }
      return buffer.join('');
    },
  };
}

function countOomEvents(logText) {
  // OOM-killer / GC-pressure signals the audit watches for on FULL-mode cold start.
  const re = /lowmemory|OutOfMemory|Background concurrent (?:copying )?GC|am_kill|Out of memory/gi;
  const matches = logText.match(re);
  return matches ? matches.length : 0;
}

function parseDetectionMs(logText) {
  // Detection phase markers come from PERF_DEBUG in src/shared/debug/renderTimer.ts:
  // FFI timing lines like "🟡 [FFI] detectSections: 1234.5ms" and the colored
  // [SCREEN]/[HOOK] markers. We sum the explicit FFI durations for detection-named
  // calls; fall back to 0 when PERF_DEBUG is off or markers are absent.
  let totalMs = 0;
  const ffiRe = /\[FFI\]\s+(\w+):\s+([\d.]+)ms/g;
  let m;
  while ((m = ffiRe.exec(logText)) !== null) {
    const name = m[1].toLowerCase();
    if (name.includes('detect') || name.includes('section') || name.includes('sync')) {
      totalMs += Number(m[2]);
    }
  }
  return Math.round(totalMs);
}

function captureBannerState(logText) {
  // The post-120s banner should read as indeterminate "analyzing routes" rather
  // than being pinned at a low percent. We surface the last analyzing-related line
  // so the operator can eyeball whether the bar advanced or stalled.
  const lines = logText.split('\n').filter((l) => /analyz|Analyz|detect|cluster|Rtree|R-tree/.test(l));
  if (lines.length === 0) return 'no-banner-markers';
  return lines[lines.length - 1].trim().slice(0, 120);
}

async function measureN(n) {
  log(`=== N=${n} ===`);
  describeSeeding(n);

  log('Clearing app data + force-stop...');
  clearAppData();

  log('Clearing logcat buffer...');
  clearLogcat();
  const logcat = startLogcatCapture();

  log('Launching app...');
  launchApp();
  await sleep(4000); // let the process come up before polling meminfo

  log(`Settling for ${SETTLE_MS}ms while polling RSS (sync/detection runs in this window)...`);
  const peakRssMb = await pollPeakRss(SETTLE_MS);

  const logText = logcat.stop();
  const oomEvents = countOomEvents(logText);
  const detectionMs = parseDetectionMs(logText);
  const bannerState = captureBannerState(logText);

  log(`  peakRssMb=${peakRssMb} detectionMs=${detectionMs} oomEvents=${oomEvents}`);
  log(`  post-${Math.round(SETTLE_MS / 1000)}s banner: ${bannerState}`);

  return { n, peakRssMb, detectionMs, oomEvents, bannerState };
}

function parseNs() {
  const arg = process.argv.find((a) => a.startsWith('--n'));
  if (!arg) return DEFAULT_NS;
  const value = arg.includes('=') ? arg.split('=')[1] : process.argv[process.argv.indexOf(arg) + 1];
  if (!value) return DEFAULT_NS;
  return value
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function writeCsv(rows) {
  const header = 'N,peakRssMb,detectionMs,oomEvents,bannerState,timestamp';
  const lines = rows.map(
    (r) =>
      `${r.n},${r.peakRssMb},${r.detectionMs},${r.oomEvents},"${r.bannerState.replace(/"/g, "'")}",${new Date().toISOString()}`
  );
  const existed = existsSync(CSV_PATH);
  writeFileSync(CSV_PATH, [header, ...lines].join('\n') + '\n');
  log(`${existed ? 'Overwrote' : 'Wrote'} baseline: ${CSV_PATH}`);
}

async function main() {
  checkEmulator();
  const ns = parseNs();
  log(`Targets: N=${ns.join(', ')} | app=${APP_ID} | settle=${SETTLE_MS}ms`);

  const rows = [];
  for (const n of ns) {
    rows.push(await measureN(n));
  }

  writeCsv(rows);
  log('Done. Review the CSV and the banner-state column for stalls vs progress.');
}

main().catch((err) => {
  log(`FATAL: ${err?.message || err}`);
  process.exit(1);
});
