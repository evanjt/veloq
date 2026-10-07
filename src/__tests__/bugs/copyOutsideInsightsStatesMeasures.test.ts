/**
 * Scenario: copy outside Insights told the athlete what a zone is for, and the
 * HRV card titled a measured change as a judgement on recovery.
 *
 * Expected behaviour: the HRV title states the measured comparison and the rule
 * that fired, the form definition carries no zone sentence, and What's New makes
 * no readiness claim. All 17 locales.
 */

import fs from 'fs';
import path from 'path';
import type { HrvTrend } from 'veloqrs';

import { generateHrvTrendInsight } from '@/features/insights/generators/hrvTrend';
import { resolvedLocale } from '../i18n/resolvedLocale';

interface Json {
  [k: string]: Json | string;
}

const dir = path.join(__dirname, '../../i18n/locales');
const locales = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

function load(file: string): Record<string, Json> {
  return resolvedLocale(file.replace('.json', '')) as unknown as Record<string, Json>;
}

function tFor(bundle: Record<string, Json>) {
  return (key: string, vars: Record<string, string | number> = {}): string => {
    const value = key
      .split('.')
      .reduce<
        Json | string | undefined
      >((n, p) => (typeof n === 'object' ? n[p] : undefined), bundle);
    if (typeof value !== 'string') throw new Error(`missing key ${key}`);
    return value.replace(/{{(\w+)}}/g, (_, n: string) => String(vars[n] ?? ''));
  };
}

const hrv = (o: Partial<HrvTrend>): HrvTrend =>
  ({
    label: 'stable',
    reason: 'halves',
    avg: 50,
    latest: 49,
    dataPoints: 5,
    sparkline: [],
    ...o,
  }) as HrvTrend;

const titleOf = (trend: HrvTrend) =>
  generateHrvTrendInsight(trend, 1_700_000_000_000, tFor(load('en-GB.json')))[0].title;

describe('HRV title states the measurement', () => {
  it('names the halves comparison and no recovery claim', () => {
    for (const label of ['trendingUp', 'trendingDown', 'stable']) {
      expect(titleOf(hrv({ label }))).not.toMatch(/recovery/i);
    }
    expect(titleOf(hrv({ label: 'trendingDown' }))).toMatch(/lower/);
    expect(titleOf(hrv({ label: 'trendingUp' }))).toMatch(/higher/);
  });

  it('names the two-reading rule when that fired, not a lower half', () => {
    const title = titleOf(hrv({ label: 'trendingDown', reason: 'lastTwoDays' }));
    expect(title).toMatch(/last two readings/);
    expect(title).not.toMatch(/half/);
  });
});

describe.each(locales)('%s', (file) => {
  const bundle = load(file);

  it('has no form zone sentence keys', () => {
    for (const key of [
      'optimalZone',
      'toBuildFitness',
      'forRaces',
      'highRiskZone',
      'toPreventOvertraining',
    ]) {
      expect((bundle.fitnessScreen as Json)?.[key]).toBeUndefined();
    }
  });

  it("has one sentence in the What's New fitness slide, with no readiness claim", () => {
    const body = ((bundle.whatsNew as Json).v022 as Json).fitnessBody as string;
    expect(body.split(/[.。]\s*/).filter(Boolean)).toHaveLength(1);
    expect(body).not.toMatch(/ready to perform/i);
  });
});
