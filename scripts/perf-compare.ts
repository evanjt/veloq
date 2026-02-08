/**
 * CI Performance Comparison Script
 *
 * Reads perf-results.json (output of `npm run test:perf:ci`),
 * compares computation test durations against a stored baseline,
 * and flags regressions > 20%.
 *
 * Usage:
 *   npm run test:perf:ci                   # Generate perf-results.json
 *   npx tsx scripts/perf-compare.ts        # Compare against baseline
 *   npx tsx scripts/perf-compare.ts --save # Save current results as new baseline
 */

import * as fs from 'fs';
import * as path from 'path';

const RESULTS_PATH = path.resolve(__dirname, '../perf-results.json');
const BASELINE_PATH = path.resolve(__dirname, '../perf-baseline.json');
const REGRESSION_THRESHOLD = 0.2; // 20%

interface JestTestResult {
  ancestorTitles: string[];
  title: string;
  duration: number | null;
  status: 'passed' | 'failed' | 'pending';
}

interface JestSuiteResult {
  testFilePath: string;
  testResults: JestTestResult[];
}

interface JestOutput {
  testResults: JestSuiteResult[];
  success: boolean;
}

interface BaselineEntry {
  name: string;
  durationMs: number;
}

function loadResults(): JestOutput {
  if (!fs.existsSync(RESULTS_PATH)) {
    console.error(`No results file found at ${RESULTS_PATH}`);
    console.error('Run: npm run test:perf:ci');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf-8'));
}

function extractTimings(results: JestOutput): BaselineEntry[] {
  const entries: BaselineEntry[] = [];

  for (const suite of results.testResults) {
    // Only include computation budget tests (actual timing tests)
    if (!suite.testFilePath.includes('computationBudget')) continue;

    for (const test of suite.testResults) {
      if (test.status === 'passed' && test.duration !== null) {
        const name = [...test.ancestorTitles, test.title].join(' > ');
        entries.push({ name, durationMs: test.duration });
      }
    }
  }

  return entries;
}

function saveBaseline(entries: BaselineEntry[]): void {
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(entries, null, 2));
  console.log(`Baseline saved to ${BASELINE_PATH} (${entries.length} entries)`);
}

function compare(current: BaselineEntry[], baseline: BaselineEntry[]): boolean {
  const baselineMap = new Map(baseline.map((e) => [e.name, e.durationMs]));
  let hasRegression = false;

  console.log('\nPerformance Comparison');
  console.log('='.repeat(80));

  for (const entry of current) {
    const baseMs = baselineMap.get(entry.name);
    if (baseMs === undefined) {
      console.log(`  NEW  ${entry.name}: ${entry.durationMs}ms`);
      continue;
    }

    const change = (entry.durationMs - baseMs) / baseMs;
    const changePercent = (change * 100).toFixed(1);
    const arrow = change > 0 ? '\u2191' : change < 0 ? '\u2193' : '=';

    if (change > REGRESSION_THRESHOLD) {
      console.log(`  FAIL ${entry.name}: ${baseMs}ms -> ${entry.durationMs}ms (${arrow}${changePercent}%)`);
      hasRegression = true;
    } else if (change < -REGRESSION_THRESHOLD) {
      console.log(`  GOOD ${entry.name}: ${baseMs}ms -> ${entry.durationMs}ms (${arrow}${changePercent}%)`);
    } else {
      console.log(`  OK   ${entry.name}: ${baseMs}ms -> ${entry.durationMs}ms (${arrow}${changePercent}%)`);
    }
  }

  // Check for removed tests
  for (const entry of baseline) {
    const found = current.find((c) => c.name === entry.name);
    if (!found) {
      console.log(`  GONE ${entry.name}: was ${entry.durationMs}ms`);
    }
  }

  console.log('='.repeat(80));
  return hasRegression;
}

// Main
const args = process.argv.slice(2);
const results = loadResults();

if (!results.success) {
  console.error('Test suite failed — fix failing tests before comparing performance.');
  process.exit(1);
}

const current = extractTimings(results);

if (args.includes('--save')) {
  saveBaseline(current);
  process.exit(0);
}

if (!fs.existsSync(BASELINE_PATH)) {
  console.log('No baseline found. Saving current results as baseline.');
  saveBaseline(current);
  process.exit(0);
}

const baseline: BaselineEntry[] = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf-8'));
const hasRegression = compare(current, baseline);

if (hasRegression) {
  console.log('\nRegression detected (>20% slower). Run with --save to update baseline.');
  process.exit(1);
} else {
  console.log('\nNo regressions detected.');
  process.exit(0);
}
