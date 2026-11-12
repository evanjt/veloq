// What the insights page draws from the phone's insights read. The cards are
// made by the app's own generators, bundled into the page: the page hands them
// the phone's reply as the app hands them the engine's, so a card says the same
// thing in both places. Pure, so a test drives it without a browser.

import type { InsightsData } from '../../modules/veloqrs/src';

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
import { insightsParamsFor } from '@/features/insights/lib/insightsParamsFor';
import {
  computeInsightsFromData,
  type InsightsComputation,
} from '@/features/insights/lib/insightsPipeline';
import type { Insight } from '@/features/insights/types';

import { bytesOf } from './link';
import type { Methods } from './schema';

export type InsightsReply = Methods['insights.data']['result'];
export type SettingValues = Methods['settings.get']['result'];

/** The settings the cards depend on: the route switch, the experimental switches and the units. */
export const INSIGHT_SETTING_KEYS = [
  'veloq-route-settings',
  'veloq-experimental',
  'veloq-unit-preference',
];

/** What the cards read besides the reply, taken from the phone's settings. */
export type InsightsSettings = {
  routeMatchingOn: boolean;
  efficiencyTrendsOn: boolean;
  isMetric: boolean;
};

/** The reads of the insights page, each kept as it answers. */
export type InsightsParts = {
  settings?: SettingValues;
  data?: InsightsReply;
};

export const INSIGHTS_PARTS_KEY = 'insights-parts';

function parsed(text: string | null | undefined): Record<string, unknown> {
  if (!text) return {};
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Regions that print imperial units when the athlete leaves the choice to the device. */
const IMPERIAL_REGIONS = new Set(['US', 'LR', 'MM']);

/**
 * The cards' settings from the phone's stored values. Route matching is on
 * unless the phone turned it off, an experimental trend is on only when chosen,
 * and a unit choice of `auto` follows the browser's region as the phone's
 * follows its own.
 */
export function insightsSettings(
  values: SettingValues | undefined,
  language: string
): InsightsSettings {
  const held = new Map((values?.values ?? []).map((entry) => [entry.key, entry.value]));
  const routes = parsed(held.get('veloq-route-settings'));
  const features = parsed(held.get('veloq-experimental')).features;
  const trends =
    features && typeof features === 'object'
      ? (features as Record<string, unknown>).efficiencyTrends
      : undefined;
  const units = held.get('veloq-unit-preference');
  const region = language.split('-')[1]?.toUpperCase() ?? '';
  return {
    routeMatchingOn: routes.enabled !== false,
    efficiencyTrendsOn: trends === true,
    isMetric:
      units === 'imperial' ? false : units === 'metric' ? true : !IMPERIAL_REGIONS.has(region),
  };
}

/** The ask for the insights bundle, with the windows the phone asks for. */
export function insightsAsk(settings: InsightsSettings): Methods['insights.data']['params'] {
  return insightsParamsFor(settings.routeMatchingOn) as Methods['insights.data']['params'];
}

/** The bytes of a polyline the link wrote as base64, as the engine's own record holds them. */
function polylineBuffer(text: string): ArrayBuffer {
  const bytes = bytesOf(text);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** Every `null` left out, as a field the engine's record does not have. */
function withoutNulls<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutNulls) as T;
  if (value && typeof value === 'object') {
    const kept: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(value)) {
      if (field !== null) kept[key] = withoutNulls(field);
    }
    return kept as T;
  }
  return value;
}

/**
 * The reply as the app holds the engine's bundle: an enum as its number, a
 * polyline as its bytes, and an absent field absent. The generators read the
 * bundle that way, so the page converts what is different on the wire here and
 * the generators stay the app's.
 */
export function engineForm(reply: InsightsReply): InsightsData {
  const bundle = withoutNulls(reply) as unknown as Record<string, unknown>;
  for (const name of ['weekOverWeek', 'weekAgainstChronic']) {
    for (const comparison of records(bundle[name])) {
      comparison.metric = LOAD_METRIC[comparison.metric as keyof typeof LOAD_METRIC];
    }
  }
  for (const trend of records(bundle.efficiencyTrends)) {
    trend.direction = EFFICIENCY_DIRECTION[trend.direction as keyof typeof EFFICIENCY_DIRECTION];
  }
  for (const list of [bundle.rankedSections, bundle.trendSections]) {
    for (const bySport of records(list)) {
      for (const section of records(bySport.sections)) {
        if (section.improvementBasis === undefined) continue;
        section.improvementBasis =
          IMPROVEMENT_BASIS[section.improvementBasis as keyof typeof IMPROVEMENT_BASIS];
      }
    }
  }
  for (const record of [...records(bundle.recentPrs), ...records(bundle.recentSectionChanges)]) {
    record.encodedPolyline = polylineBuffer(String(record.encodedPolyline));
  }
  return bundle as unknown as InsightsData;
}

/** A field that holds one record or a list of them, as a list. */
function records(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  return value && typeof value === 'object' ? [value as Record<string, unknown>] : [];
}

/** The cards the phone's reply makes, in the language `t` speaks. */
export function insightsOf(
  reply: InsightsReply | undefined,
  settings: InsightsSettings,
  t: (key: string, params?: Record<string, string | number>) => string
): InsightsComputation {
  if (!reply) return { insights: [], failed: false };
  return computeInsightsFromData(engineForm(reply), t, settings.isMetric, {
    routeMatchingOn: settings.routeMatchingOn,
    efficiencyTrendsOn: settings.efficiencyTrendsOn,
    ledgerDate,
    strength: {
      summary: normaliseStrengthSummary,
      progression: normaliseStrengthProgression,
      cards: generateStrengthInsights,
    },
  });
}

export type { Insight };
