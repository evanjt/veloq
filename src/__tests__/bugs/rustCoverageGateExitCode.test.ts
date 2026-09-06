/**
 * Scenario: the Rust coverage floor runs nightly over a `cargo llvm-cov` JSON
 * report.
 *
 * Expected behaviour: one crate-wide number would let the FFI object layer sit
 * at 42 per cent while persistence carries the total, so the floor is per
 * layer. A layer under its floor fails and names itself, a layer the report
 * never saw fails rather than passing on nothing, and the figure is weighted
 * by lines across the layer's files, not a mean of file percentages. Exactly
 * on the floor passes.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/check-rust-coverage.mjs');
const BASELINE = join(__dirname, '../../../scripts/rust-coverage-baseline.json');
const WORKFLOW = join(__dirname, '../../../.github/workflows/rust-coverage.yml');

type FileSummary = { path: string; count: number; covered: number };

function runGate(report: string, baseline: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT, '--report', report, '--baseline', baseline], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('Rust coverage floor', () => {
  const dirs: string[] = [];

  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  // The shape `cargo llvm-cov --json` writes: llvm's export format, absolute
  // file paths, a per-file summary with line counts.
  const withReport = (files: FileSummary[], floors: Record<string, number>): [string, string] => {
    const dir = mkdtempSync(join(tmpdir(), 'rust-coverage-'));
    dirs.push(dir);
    const report = {
      type: 'llvm.coverage.json.export',
      version: '2.0.1',
      data: [
        {
          files: files.map((f) => ({
            filename: `/build/modules/veloqrs/rust/${f.path}`,
            summary: {
              lines: { count: f.count, covered: f.covered, percent: (100 * f.covered) / f.count },
            },
          })),
        },
      ],
    };
    const reportPath = join(dir, 'coverage.json');
    const baselinePath = join(dir, 'baseline.json');
    writeFileSync(reportPath, JSON.stringify(report));
    writeFileSync(baselinePath, `${JSON.stringify(floors, null, 2)}\n`);
    return [reportPath, baselinePath];
  };

  it('passes a layer sitting exactly on its floor', () => {
    const [report, baseline] = withReport(
      [{ path: 'veloqrs/src/objects/engine.rs', count: 200, covered: 84 }],
      { 'src/objects': 42 }
    );
    const { status, output } = runGate(report, baseline);
    expect(status).toBe(0);
    expect(output).toContain('src/objects');
  });

  it('fails and names the layer under its floor', () => {
    const [report, baseline] = withReport(
      [
        { path: 'veloqrs/src/objects/engine.rs', count: 200, covered: 82 },
        { path: 'veloqrs/src/net/sync.rs', count: 100, covered: 95 },
      ],
      { 'src/objects': 42, 'src/net': 94 }
    );
    const { status, output } = runGate(report, baseline);
    expect(status).toBe(1);
    const failures = output.split('Rust coverage under its floor:')[1];
    expect(failures).toContain('src/objects  41.0%, floor 42%');
    expect(failures).not.toContain('src/net');
  });

  it('fails a layer the report has no files for', () => {
    const [report, baseline] = withReport(
      [{ path: 'veloqrs/src/objects/engine.rs', count: 200, covered: 100 }],
      { 'src/objects': 42, 'src/persistence': 86 }
    );
    const { status, output } = runGate(report, baseline);
    expect(status).toBe(1);
    expect(output).toContain('src/persistence');
    expect(output).toContain('no files');
  });

  it('weights the layer by lines, not by a mean of file percentages', () => {
    // 10 of 10 and 30 of 90: the mean of percents is 66.7, the layer is 40.
    const [report, baseline] = withReport(
      [
        { path: 'veloqrs/src/objects/maps.rs', count: 10, covered: 10 },
        { path: 'veloqrs/src/objects/sections.rs', count: 90, covered: 30 },
      ],
      { 'src/objects': 50 }
    );
    const { status, output } = runGate(report, baseline);
    expect(status).toBe(1);
    expect(output).toContain('src/objects  40.0%, floor 50%');
  });

  it('keeps a file from another crate out of a same-named layer', () => {
    const [report, baseline] = withReport(
      [
        { path: 'tracematch/src/objects/x.rs', count: 100, covered: 100 },
        { path: 'veloqrs/src/objects/engine.rs', count: 100, covered: 10 },
      ],
      { 'src/objects': 42 }
    );
    const { status, output } = runGate(report, baseline);
    expect(status).toBe(1);
    expect(output).toContain('src/objects  10.0%, floor 42%');
  });

  it('fails on a report it cannot read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rust-coverage-'));
    dirs.push(dir);
    const baseline = join(dir, 'baseline.json');
    writeFileSync(baseline, '{ "src/objects": 42 }\n');
    expect(runGate(join(dir, 'missing.json'), baseline).status).toBe(1);
  });

  it('seeds the committed floors per layer and wires the script into the nightly workflow', () => {
    const floors = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, number>;
    expect(Object.keys(floors).sort()).toEqual(['src/net', 'src/objects', 'src/persistence']);
    for (const floor of Object.values(floors)) expect(Number.isInteger(floor)).toBe(true);

    expect(existsSync(WORKFLOW)).toBe(true);
    const workflow = readFileSync(WORKFLOW, 'utf8');
    expect(workflow).toContain('cargo llvm-cov -p veloqrs --features synthetic');
    expect(workflow).toContain('scripts/check-rust-coverage.mjs');
    expect(workflow).toContain('schedule:');
  });
});
