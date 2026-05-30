#!/usr/bin/env node
// FFI timing regression gate. Parses a captured Metro/logcat log for the FFI
// timing markers emitted by logFFIStart() in src/lib/debug/renderTimer.ts and
// compares per-call p95 against scripts/ffi-baseline.json budgets.
//
// Marker format (one per line, color dot is one of 🔴🟡🟢):
//   🔴 [FFI] getSections: 312.4ms
//
// Usage: node scripts/ffi-timing-gate.mjs [logPath]
//   logPath defaults to /tmp/veloq-logcat.log

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const logPath = process.argv[2] ?? '/tmp/veloq-logcat.log';
const baselinePath = join(here, 'ffi-baseline.json');

// logcat prefixes the JS console line, so match anywhere on the line.
const FFI_LINE = /\[FFI\]\s+(\S+):\s+([\d.]+)ms/;

function readLog(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    console.error(`Cannot read log at ${path}: ${err.message}`);
    console.error('Capture one first (see scripts/ffi-timing-gate.mjs header / package.json).');
    process.exit(2);
  }
}

function parseTimings(text) {
  const byName = new Map();
  for (const line of text.split('\n')) {
    const m = line.match(FFI_LINE);
    if (!m) continue;
    const name = m[1];
    const ms = Number(m[2]);
    if (!Number.isFinite(ms)) continue;
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(ms);
  }
  return byName;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

function aggregate(byName) {
  const out = {};
  for (const [name, durations] of byName) {
    const sorted = [...durations].sort((a, b) => a - b);
    out[name] = {
      count: sorted.length,
      p50: round(percentile(sorted, 0.5)),
      p95: round(percentile(sorted, 0.95)),
      max: round(sorted[sorted.length - 1]),
    };
  }
  return out;
}

const round = (n) => Math.round(n * 10) / 10;

// Static check: flag heavy FFI calls whose result is consumed only for a count.
// These should use a dedicated count FFI instead of deserializing everything.
function staticScan() {
  const srcDir = join(repoRoot, 'src');
  const patterns = [
    /getSectionSummaries\(\)\??\.?\.totalCount/,
    /getSections\(\)\??\.?\.length/,
    /getSectionSummaries\(\)\??\.?\.length/,
    /getGroups\(\)\??\.?\.length/,
  ];
  const warnings = [];
  walk(srcDir, (file) => {
    if (!/\.(ts|tsx)$/.test(file)) return;
    const text = readFileSync(file, 'utf8');
    text.split('\n').forEach((line, i) => {
      if (patterns.some((p) => p.test(line))) {
        warnings.push(`${file}:${i + 1}: ${line.trim()}`);
      }
    });
  });
  return warnings;
}

function walk(dir, fn) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, fn);
    else fn(full);
  }
}

function main() {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const factor = baseline.regressionFactor ?? 1.3;
  const text = readLog(logPath);
  const stats = aggregate(parseTimings(text));

  const names = Object.keys(stats).sort();
  if (names.length === 0) {
    console.error(`No [FFI] markers found in ${logPath}.`);
    console.error('Ensure PERF_DEBUG is on (dev build) and the log was captured during use.');
    process.exit(2);
  }

  console.log('FFI timing summary (parsed from ' + logPath + '):');
  for (const name of names) {
    const s = stats[name];
    console.log(`  ${name}: count=${s.count} p50=${s.p50}ms p95=${s.p95}ms max=${s.max}ms`);
  }

  const regressions = [];
  for (const [name, budget] of Object.entries(baseline.budgets)) {
    const s = stats[name];
    if (!s) {
      console.log(`  (no samples for budgeted call ${name})`);
      continue;
    }
    const limit = budget.p95Ms * factor;
    if (s.p95 > limit) {
      regressions.push(
        `${name}: p95 ${s.p95}ms exceeds budget ${budget.p95Ms}ms x${factor} = ${round(limit)}ms`
      );
    }
  }

  const warnings = staticScan();
  if (warnings.length > 0) {
    console.warn('\nStatic warnings (heavy FFI consumed only for a count):');
    for (const w of warnings) console.warn('  ' + w);
  }

  if (regressions.length > 0) {
    console.error('\nFFI timing regressions:');
    for (const r of regressions) console.error('  ' + r);
    process.exit(1);
  }

  console.log('\nNo FFI timing regressions beyond threshold.');
  process.exit(0);
}

main();
