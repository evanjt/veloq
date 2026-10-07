/**
 * Scenario: a call tagged with the place it runs from, read from a release
 * build's ring dump. A mount call at four times its place budget used to pass
 * because the committed baseline for it was 325 ms and the allowance 1.3 times that.
 *
 * Expected behaviour: a p95 over its place budget fails, a p95 inside the budget
 * but over the regression factor of its committed baseline fails, a p95 inside
 * both passes, and a call with no baseline is judged by its place budget alone.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const GATE = path.resolve(__dirname, '../../../scripts/ffi-timing-gate.mjs');

type Summary = Record<string, { calls: number; p95Ms: number }>;

function gate(ring: Summary, baseline: Record<string, number>, wrap = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-ffi-gate-'));
  const ringPath = path.join(dir, 'ring.json');
  const baselinePath = path.join(dir, 'baseline.json');
  fs.writeFileSync(ringPath, JSON.stringify(wrap ? { ffiMetrics: ring } : ring));
  fs.writeFileSync(
    baselinePath,
    JSON.stringify({
      regressionFactor: 1.3,
      budgets: Object.fromEntries(Object.entries(baseline).map(([k, v]) => [k, { p95Ms: v }])),
    })
  );
  const res = spawnSync('node', [GATE, ringPath, '--baseline', baselinePath], {
    encoding: 'utf8',
  });
  fs.rmSync(dir, { recursive: true, force: true });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}

describe('ffi timing gate', () => {
  it('fails a mount call over its place budget even when the baseline allows it', () => {
    const res = gate(
      { 'loadSummaries@mount': { calls: 20, p95Ms: 400 } },
      { 'loadSummaries@mount': 325 }
    );
    expect(res.code).toBe(1);
    expect(res.out).toContain('loadSummaries@mount');
    expect(res.out).toContain('100');
  });

  it('fails a call inside its budget that is 1.5 times its baseline', () => {
    const res = gate({ 'readCard@tap': { calls: 20, p95Ms: 60 } }, { 'readCard@tap': 40 });
    expect(res.code).toBe(1);
    expect(res.out).toContain('readCard@tap');
  });

  it('passes a call inside its budget and its regression allowance', () => {
    const res = gate({ 'readCard@tap': { calls: 20, p95Ms: 50 } }, { 'readCard@tap': 40 });
    expect(res.code).toBe(0);
  });

  it('judges a call with no baseline by its place budget alone', () => {
    expect(gate({ 'newRead@gesture': { calls: 5, p95Ms: 9 } }, {}).code).toBe(1);
    expect(gate({ 'newRead@gesture': { calls: 5, p95Ms: 8 } }, {}).code).toBe(0);
    expect(gate({ 'newRead@launch': { calls: 1, p95Ms: 190 } }, {}).code).toBe(0);
  });

  it('judges an untagged call by the tap and mount budget', () => {
    expect(gate({ untagged: { calls: 5, p95Ms: 101 } }, {}).code).toBe(1);
    expect(gate({ untagged: { calls: 5, p95Ms: 99 } }, {}).code).toBe(0);
  });

  it('reads the ring from a shared debug snapshot', () => {
    const res = gate({ 'a@gesture': { calls: 3, p95Ms: 20 } }, {}, true);
    expect(res.code).toBe(1);
  });

  it('refuses an empty ring rather than passing it', () => {
    expect(gate({}, {}).code).toBe(2);
  });
});
