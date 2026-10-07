/**
 * Scenario: the same thirteen thresholds decide a trend arrow on the summary
 * card, on the widget and, once the wellness verdicts move, in Rust. They were
 * written out twice once before and drifted the moment one copy was corrected.
 *
 * Expected behaviour: Rust owns the table and TypeScript is generated from it,
 * the way the detector defaults already are, with a `--check` that fails on a
 * table edited on the TypeScript side.
 */

import fs from 'fs';
import path from 'path';

import { TREND_DEADBAND, TREND_POLARITY } from '@/shared/format/trend';

import { readRustTrendMetrics } from '@/../scripts/lib/trendTable';

const REPO = path.resolve(__dirname, '../../..');
const RUST = path.join(REPO, 'modules/veloqrs/rust/veloqrs/src/trend_table.rs');

describe('the trend table is read out of Rust', () => {
  it('parses every metric, its deadband and which way is better', () => {
    const metrics = readRustTrendMetrics(
      `
pub const TREND_METRICS: &[TrendMetric] = &[
    // A comment the generator carries across.
    TrendMetric { name: "fitness", deadband: 1.0, polarity: Polarity::Higher },
    TrendMetric { name: "weight", deadband: 0.3, polarity: Polarity::None },
    TrendMetric { name: "rhr", deadband: 1.0, polarity: Polarity::Lower },
];
`
    );

    expect(metrics).toEqual([
      {
        name: 'fitness',
        deadband: 1,
        polarity: 'higher',
        docs: 'A comment the generator carries across.',
      },
      { name: 'weight', deadband: 0.3, polarity: 'none', docs: null },
      { name: 'rhr', deadband: 1, polarity: 'lower', docs: null },
    ]);
  });

  it('refuses a source it cannot find the table in, rather than writing an empty one', () => {
    // An empty table reads as "no metric has a threshold", which makes every
    // move a move. Failing loudly is the only safe answer.
    expect(() => readRustTrendMetrics('fn unrelated() {}')).toThrow();
  });

  it('is the table the app already draws with, so no glyph moves', () => {
    const metrics = readRustTrendMetrics(fs.readFileSync(RUST, 'utf-8'));

    expect(Object.fromEntries(metrics.map((m) => [m.name, m.deadband]))).toEqual(TREND_DEADBAND);
    expect(Object.fromEntries(metrics.map((m) => [m.name, m.polarity]))).toEqual(TREND_POLARITY);
  });
});
