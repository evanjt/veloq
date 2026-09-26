/**
 * Scenario: the HRV card described a 7-day rolling average that is computed
 * nowhere. The engine takes the 7 calendar days ending today, keeps the days
 * with a reading, needs five, and compares the mean of the older half with the
 * mean of the newer half under a 2% deadband, with an override for two
 * consecutive readings below the window mean. A window whose halves were
 * steady could still be labelled `trendingDown` by that override, and the card
 * then said the average was declining. The average had not declined.
 *
 * Expected behaviour: the body names what actually moved. Halves say halves,
 * and the override says two consecutive readings below the window mean.
 */

import type { HrvTrend } from 'veloqrs';

import { generateHrvTrendInsight } from '@/features/insights/generators/hrvTrend';
import enAU from '@/i18n/locales/en-AU.json';

const NOW = 1_700_000_000_000;

/**
 * The real en-AU strings, resolved and interpolated the way i18next would.
 * Rendering through the locale file is the point: a body that reads correctly
 * with a stub key and wrongly with the shipped string is the defect itself.
 */
function t(key: string, vars: Record<string, string | number> = {}): string {
  const value = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], enAU);
  if (typeof value !== 'string') throw new Error(`missing key ${key}`);
  return value.replace(/{{(\w+)}}/g, (_, name: string) => String(vars[name] ?? ''));
}

function hrv(overrides: Partial<HrvTrend> = {}): HrvTrend {
  return {
    label: 'stable',
    reason: 'halves',
    avg: 50,
    latest: 49,
    dataPoints: 5,
    sparkline: [50, 50, 50, 51, 49],
    ...overrides,
  } as HrvTrend;
}

function bodyFor(trend: HrvTrend): string {
  const [insight] = generateHrvTrendInsight(trend, NOW, t);
  return insight.body ?? '';
}

describe('the HRV card says what it measured', () => {
  it('names two consecutive readings, not a falling average, when the override fired', () => {
    // The fixture the engine labels `trendingDown` off `lastTwoDays`: halves
    // 50.0 against 50.0, and the window ends 51 then 49 under a mean of 50.
    const body = bodyFor(hrv({ label: 'trendingDown', reason: 'lastTwoDays' }));

    expect(body).toContain('last two readings');
    expect(body).toContain('consecutive days');
    expect(body).not.toContain('rolling average');
    expect(body).not.toMatch(/average.{0,20}is declining/);
  });

  it('names the halves when the window itself moved', () => {
    const body = bodyFor(hrv({ label: 'trendingDown', reason: 'halves', avg: 50, latest: 40 }));

    expect(body).toContain('newer half');
    expect(body).toContain('older half');
    expect(body).not.toContain('rolling average');
  });

  it('carries the window mean, the reading count and the latest reading', () => {
    const body = bodyFor(hrv({ label: 'trendingUp', reason: 'halves', avg: 61, latest: 66 }));

    expect(body).toContain('61 ms');
    expect(body).toContain('5 readings');
    expect(body).toContain('66 ms');
  });

  it('describes the computation the engine actually runs, with no rolling average', () => {
    const [insight] = generateHrvTrendInsight(hrv(), NOW, t);
    const method = insight.methodology?.description ?? '';

    expect(method).toContain('7 calendar days');
    expect(method).toContain('at least five');
    expect(method).toContain('2%');
    expect(method).toContain('consecutive days');
    expect(method).not.toContain('rolling average');
  });
});
