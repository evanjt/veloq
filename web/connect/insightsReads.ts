// The insights page's reads: the settings its cards depend on, then the bundle
// over the windows those settings choose. A phone without the settings read
// gets the defaults; one without the bundle read says so in the page.

import {
  INSIGHT_SETTING_KEYS,
  insightsAsk,
  insightsSettings,
  type InsightsParts,
} from './insights';
import type { ReadError } from './query';
import { localDay, plannedWindow, type PlannedEvent } from './insightsPage';
import { useRead } from './useRead';
import { useMemo } from 'react';

export type InsightsRead = {
  parts: InsightsParts | undefined;
  /** Why the bundle has no answer, with nothing held. */
  error: ReadError | null;
  loading: boolean;
  retry: () => void;
};

export function useInsights(): InsightsRead {
  const settings = useRead('settings.get', { keys: INSIGHT_SETTING_KEYS });
  const settled = !settings.loading;
  const data = useRead(
    'insights.data',
    settled ? insightsAsk(insightsSettings(settings.data, '')) : null
  );
  const held = settings.data !== undefined || data.data !== undefined;
  return {
    parts: held ? { settings: settings.data, data: data.data } : undefined,
    error: data.data === undefined ? data.error : null,
    loading: !settled || data.loading,
    retry: data.retry,
  };
}

/** How many days ahead the planned events list reaches. */
export const PLANNED_DAYS = 14;

/** The planned events of the coming fortnight, asked for the day the page is on. */
export function usePlannedEvents(): { events: PlannedEvent[] | undefined; today: string } {
  const today = localDay(new Date());
  const ask = useMemo(() => plannedWindow(new Date(`${today}T12:00:00`), PLANNED_DAYS), [today]);
  const read = useRead('insights.plannedEvents', ask);
  return { events: read.data?.events, today };
}
