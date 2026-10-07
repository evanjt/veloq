#!/usr/bin/env node
// FFI timing gate. Reads the FFI ring a release build keeps (the Developer
// Dashboard's per-call summary, or a shared debug snapshot that carries it as
// `ffiMetrics`) and holds each call to the budget of the place it runs from,
// then to a regression factor over the committed baseline for that call.
//
// A call is named `name@place`, the place being gesture, tap, mount or launch.
// An untagged call is held to the tap and mount budget.
//
// Usage: node scripts/ffi-timing-gate.mjs <ringJsonPath> [--baseline path]

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

export const PLACE_BUDGET_MS = { gesture: 8.3, tap: 100, mount: 100, launch: 200 };
const DEFAULT_PLACE = 'tap';

const round = (n) => Math.round(n * 10) / 10;

export function placeOf(name) {
  const at = name.lastIndexOf('@');
  const place = at === -1 ? '' : name.slice(at + 1);
  return Object.hasOwn(PLACE_BUDGET_MS, place) ? place : DEFAULT_PLACE;
}

export function judge(summary, baseline) {
  const factor = baseline.regressionFactor ?? 1.3;
  const failures = [];
  for (const [name, stat] of Object.entries(summary)) {
    const place = placeOf(name);
    const budget = PLACE_BUDGET_MS[place];
    if (stat.p95Ms > budget) {
      failures.push(`${name}: p95 ${stat.p95Ms}ms exceeds the ${place} budget ${budget}ms`);
      continue;
    }
    const held = baseline.budgets?.[name];
    if (held && stat.p95Ms > held.p95Ms * factor) {
      failures.push(
        `${name}: p95 ${stat.p95Ms}ms exceeds baseline ${held.p95Ms}ms x${factor} = ${round(held.p95Ms * factor)}ms`
      );
    }
  }
  return failures;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.error(`Cannot read ${path}: ${err.message}`);
    process.exit(2);
  }
}

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
  const args = process.argv.slice(2);
  const flag = args.indexOf('--baseline');
  const baselinePath = flag === -1 ? join(here, 'ffi-baseline.json') : args[flag + 1];
  const ringPath = args.find((a, i) => !a.startsWith('--') && i !== flag + 1);
  if (!ringPath) {
    console.error('Usage: node scripts/ffi-timing-gate.mjs <ringJsonPath> [--baseline path]');
    process.exit(2);
  }
  const dump = readJson(ringPath);
  const summary = dump.ffiMetrics ?? dump;
  const names = Object.keys(summary).sort();
  if (names.length === 0) {
    console.error(`No FFI calls in ${ringPath}. Turn debug on in a release build and use the app.`);
    process.exit(2);
  }

  console.log(`FFI ring summary (read from ${ringPath}):`);
  for (const name of names) {
    const s = summary[name];
    console.log(`  ${name}: calls=${s.calls} p95=${s.p95Ms}ms max=${s.maxMs ?? '?'}ms`);
  }

  const failures = judge(summary, readJson(baselinePath));

  const warnings = staticScan();
  if (warnings.length > 0) {
    console.warn('\nStatic warnings (heavy FFI consumed only for a count):');
    for (const w of warnings) console.warn('  ' + w);
  }

  if (failures.length > 0) {
    console.error('\nFFI timing failures:');
    for (const f of failures) console.error('  ' + f);
    process.exit(1);
  }

  console.log('\nEvery call is inside its place budget and its baseline.');
  process.exit(0);
}

main();
