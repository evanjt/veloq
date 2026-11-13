/**
 * Scenario: the insights tab runs the app's own generators over the phone's
 * reply, which crosses the link as JSON: an enum is a word, a polyline is
 * base64 and an absent field is `null`.
 *
 * Expected behaviour: the reply is put into the form the engine hands the app
 * before the generators read it, so the cards from the reply are the cards from
 * the engine's own record; the settings the cards depend on come from the
 * phone's stored values, and the ask for the bundle follows the route switch.
 */

import type { InsightsData } from 'veloqrs';

import { computeInsightsFromData } from '@/features/insights/lib/insightsPipeline';
import {
  EFFICIENCY_DIRECTION,
  IMPROVEMENT_BASIS,
  LOAD_METRIC,
} from '@/features/insights/lib/engineEnums';
import { ledgerDate } from '@/features/routes/lib/sectionLedger';
import { generateStrengthInsights } from '@/features/strength/hooks/strengthInsights';
import {
  normaliseStrengthProgression,
  normaliseStrengthSummary,
} from '@/features/strength/lib/analysis';

import {
  engineForm,
  insightsAsk,
  insightsOf,
  insightsSettings,
  type InsightsReply,
  type InsightsSettings,
} from '../../../web/connect/insights';

const t = (key: string) => key;

const on: InsightsSettings = { routeMatchingOn: true, efficiencyTrendsOn: true, isMetric: true };

const stats = (count: number, hours: number, tss: number) => ({
  count,
  totalDuration: hours * 3600,
  totalDistance: hours * 25_000,
  totalTss: tss,
});

const trend = (history: boolean) => ({
  changes: [],
  deltaWatts: null,
  glyph: null,
  history: history ? [] : [],
  latestDate: null,
  latestFtp: null,
  lookbackDays: 30,
  previousDate: null,
  previousFtp: null,
  sampleCount: 0,
});

const pace = {
  deltaSeconds: null,
  gainPercent: null,
  glyph: null,
  history: [],
  latestDate: null,
  latestPace: null,
  previousDate: null,
  previousPace: null,
  sampleCount: 0,
};

/** One polyline of two points, as the engine encodes them: count, mode, then deltas. */
const POLYLINE_BASE64 = Buffer.from([
  2, 0, 0x80, 0xe8, 0xa6, 0x0f, 0x80, 0xc2, 0x8f, 0x04, 0, 0,
]).toString('base64');

/** A reply as the link writes it. */
function reply(): InsightsReply {
  return {
    currentWeek: stats(2, 4, 120),
    previousWeek: stats(5, 9, 360),
    chronicPeriod: stats(18, 36, 1400),
    chronicWeekAverage: stats(4, 9, 350),
    weeklyTotals: [],
    ftpTrend: trend(false),
    runPaceTrend: pace,
    swimPaceTrend: pace,
    recentPrs: [],
    sectionCount: 2,
    sportTypes: ['Ride'],
    rankedSections: [
      {
        sportType: 'Ride',
        sections: [
          {
            sectionId: 's1',
            sectionName: 'Lantern climb',
            relevanceScore: 0.8,
            recencyScore: 0.7,
            improvementScore: 0.6,
            improvementChange: 0.14,
            improvementBasis: 'firstToLast',
            anomalyScore: 0.1,
            engagementScore: 0.5,
            traversalCount: 6,
            bestTimeSecs: 300,
            medianRecentSecs: 310,
            daysSinceLast: 3,
            trend: 1,
            recentEfforts: [],
            bestActivityId: null,
          },
        ],
      },
    ],
    trendSections: [],
    trendFasterCount: 0,
    trendSlowerCount: 0,
    routeInsights: [],
    routeRecordCount: 0,
    routeFasterCount: 0,
    routeSlowerCount: 0,
    efficiencyTrends: [
      {
        sectionId: 's1',
        sportType: 'Ride',
        sectionName: 'Lantern climb',
        points: [
          { date: 1_700_000_000, paceSecsPerKm: 300, avgHr: 150, hrPaceRatio: 0.5 },
          { date: 1_700_900_000, paceSecsPerKm: 298, avgHr: 156, hrPaceRatio: 0.52 },
        ],
        trendSlope: 0.01,
        direction: 'worsening',
        hrChangeBpm: 6,
        effortCount: 5,
        signalDelta: null,
      },
    ],
    hasStrengthData: false,
    strengthSeries: null,
    form: { ctl: 40, atl: 55, date: '2026-01-10' },
    weekOverWeek: {
      metric: 'tss',
      current: 120,
      previous: 360,
      ratio: 0.33,
      comparedStart: 1_700_000_000,
    },
    weekAgainstChronic: null,
    hrvTrend: null,
    hrvWithheldSince: null,
    recentSectionChanges: [
      {
        sectionId: 's1',
        sectionName: 'Lantern climb',
        kind: 'recut',
        at: '2026-01-09 07:30:00',
        encodedPolyline: POLYLINE_BASE64,
      },
    ],
    stalePrOpportunities: [],
  } as unknown as InsightsReply;
}

describe('the insights reply in the engine form', () => {
  vaultIt('puts each enum as the number the bindings give it', () => {
    const bundle = engineForm(reply());
    expect(bundle.weekOverWeek?.metric).toBe(LOAD_METRIC.tss);
    expect(bundle.efficiencyTrends[0]?.direction).toBe(EFFICIENCY_DIRECTION.worsening);
    expect(bundle.rankedSections[0]?.sections[0]?.improvementBasis).toBe(
      IMPROVEMENT_BASIS.firstToLast
    );
  });

  vaultIt('puts a polyline as the bytes the decoder reads, and an absent field as absent', () => {
    const bundle = engineForm(reply());
    const line = bundle.recentSectionChanges[0]?.encodedPolyline;
    expect(line).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(line as ArrayBuffer))).toEqual([
      2, 0, 0x80, 0xe8, 0xa6, 0x0f, 0x80, 0xc2, 0x8f, 0x04, 0, 0,
    ]);
    expect(bundle.weekAgainstChronic).toBeUndefined();
    expect('weekAgainstChronic' in bundle).toBe(false);
    expect(bundle.efficiencyTrends[0] && 'signalDelta' in bundle.efficiencyTrends[0]).toBe(false);
  });

  vaultIt('leaves the reply it was given as it was', () => {
    const held = reply();
    engineForm(held);
    expect(held.weekOverWeek?.metric).toBe('tss');
    expect(typeof held.recentSectionChanges[0]?.encodedPolyline).toBe('string');
  });
});

describe('the cards from the reply', () => {
  /** The engine's own record for the same reply: numbers, buffers and absent fields. */
  function engineRecord(): InsightsData {
    const bytes = Uint8Array.from(Buffer.from(POLYLINE_BASE64, 'base64'));
    const record = {
      ...reply(),
      weekOverWeek: { ...reply().weekOverWeek, metric: LOAD_METRIC.tss },
      weekAgainstChronic: undefined,
      hrvTrend: undefined,
      hrvWithheldSince: undefined,
      strengthSeries: undefined,
      efficiencyTrends: reply().efficiencyTrends.map((each) => ({
        ...each,
        signalDelta: undefined,
        direction: EFFICIENCY_DIRECTION.worsening,
      })),
      rankedSections: reply().rankedSections.map((bySport) => ({
        ...bySport,
        sections: bySport.sections.map((section) => ({
          ...section,
          bestActivityId: undefined,
          improvementBasis: IMPROVEMENT_BASIS.firstToLast,
        })),
      })),
      recentSectionChanges: [
        {
          ...reply().recentSectionChanges[0],
          encodedPolyline: bytes.buffer.slice(0, bytes.byteLength),
        },
      ],
    };
    return record as unknown as InsightsData;
  }

  const env = (settings: InsightsSettings) => ({
    routeMatchingOn: settings.routeMatchingOn,
    efficiencyTrendsOn: settings.efficiencyTrendsOn,
    ledgerDate,
    strength: {
      summary: normaliseStrengthSummary,
      progression: normaliseStrengthProgression,
      cards: generateStrengthInsights,
    },
  });

  it('are the cards the engine record makes', () => {
    const fromReply = insightsOf(reply(), on, t);
    const fromRecord = computeInsightsFromData(engineRecord(), t, true, env(on));
    expect(fromReply.failed).toBe(false);
    expect(fromReply.insights.length).toBeGreaterThan(0);
    const strip = (cards: typeof fromReply.insights) =>
      cards.map(({ timestamp: _timestamp, ...card }) => card);
    expect(strip(fromReply.insights)).toEqual(strip(fromRecord.insights));
  });

  it('carry a card for the week against the one before and for the efficiency trend', () => {
    const categories = insightsOf(reply(), on, t).insights.map((card) => card.category);
    expect(categories).toContain('period_comparison');
    expect(categories).toContain('efficiency_trend');
  });

  vaultIt(
    'leave the experimental trend out while it is off, and every section card out with routes off',
    () => {
      const noTrend = insightsOf(reply(), { ...on, efficiencyTrendsOn: false }, t).insights;
      expect(noTrend.map((card) => card.category)).not.toContain('efficiency_trend');
      const noRoutes = insightsOf(reply(), { ...on, routeMatchingOn: false }, t).insights;
      expect(noRoutes.map((card) => card.category)).not.toContain('efficiency_trend');
    }
  );

  vaultIt('are none, and not a failure, before the phone has answered', () => {
    expect(insightsOf(undefined, on, t)).toEqual({ insights: [], failed: false });
  });

  it('are a failure, not an empty list, when a reply cannot be read', () => {
    const broken = { ...reply(), currentWeek: undefined } as unknown as InsightsReply;
    expect(insightsOf(broken, on, t).failed).toBe(true);
  });
});

describe('the settings the cards depend on', () => {
  const values = (entries: [string, string][]) => ({
    values: entries.map(([key, value]) => ({ key, value })),
    refused: [],
  });

  vaultIt('read route matching as on unless the phone turned it off', () => {
    expect(insightsSettings(undefined, 'en-GB').routeMatchingOn).toBe(true);
    expect(
      insightsSettings(values([['veloq-route-settings', '{"enabled":false}']]), 'en-GB')
        .routeMatchingOn
    ).toBe(false);
    expect(
      insightsSettings(values([['veloq-route-settings', 'not json']]), 'en-GB').routeMatchingOn
    ).toBe(true);
  });

  vaultIt('read the experimental trend as on only when chosen', () => {
    expect(insightsSettings(undefined, 'en-GB').efficiencyTrendsOn).toBe(false);
    const chosen = values([['veloq-experimental', '{"features":{"efficiencyTrends":true}}']]);
    expect(insightsSettings(chosen, 'en-GB').efficiencyTrendsOn).toBe(true);
    const other = values([['veloq-experimental', '{"features":{"remoteLink":true}}']]);
    expect(insightsSettings(other, 'en-GB').efficiencyTrendsOn).toBe(false);
  });

  vaultIt(
    'follow the unit choice, and the browser region while the choice is left to the device',
    () => {
      const units = (choice: string) => values([['veloq-unit-preference', choice]]);
      expect(insightsSettings(units('imperial'), 'en-GB').isMetric).toBe(false);
      expect(insightsSettings(units('metric'), 'en-US').isMetric).toBe(true);
      expect(insightsSettings(units('auto'), 'en-US').isMetric).toBe(false);
      expect(insightsSettings(units('auto'), 'de-CH').isMetric).toBe(true);
      expect(insightsSettings(undefined, 'en').isMetric).toBe(true);
    }
  );
});

describe('the ask for the bundle', () => {
  it('carries the windows the phone asks for, with sections only while routes are on', () => {
    expect(insightsAsk(on).includeSections).toBe(true);
    expect(insightsAsk({ ...on, routeMatchingOn: false }).includeSections).toBe(false);
    const ask = insightsAsk(on);
    expect(ask.rankedLimit).toBeGreaterThan(0);
    expect(ask.currentEnd).toBeGreaterThan(1_700_000_000);
    expect(ask.wellnessNewest).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  vaultIt('asks over the trailing windows ending at the wall clock now', () => {
    jest.useFakeTimers({ now: new Date(2026, 2, 11, 9, 30, 0) });
    try {
      const ask = insightsAsk(on);
      expect(ask.currentEnd).toBe(Date.UTC(2026, 2, 11, 9, 30, 0) / 1000);
      expect(ask.todayStart).toBe(Date.UTC(2026, 2, 11) / 1000);
      expect(ask.wellnessNewest).toBe('2026-03-11');
      expect(ask.wellnessOldest).toBe('2026-02-09');
      expect(ask.strengthWeeks).toHaveLength(4);
      expect(ask.strengthMonth.endTs).toBe(Date.UTC(2026, 2, 11, 23, 59, 59) / 1000);
    } finally {
      jest.useRealTimers();
    }
  });
});
