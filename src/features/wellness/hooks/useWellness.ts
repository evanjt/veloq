/**
 * Wellness reads come from SQLite, not the API.
 *
 * Rust's sync service fetches the year of wellness and stores each day typed,
 * and the engine answers typed, so nothing here parses a body. The query key
 * is woken by the sync-complete invalidation in
 * GlobalDataSync and by the engine's own change channel, so a finished sync
 * refreshes the charts without a second network call.
 */
import { addLocalDays, formatLocalDate } from '@/shared/time/localDay';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { PERIOD_DAYS } from '@/shared/app/period';

import { useAuthStore } from '@/shared/app/AuthStore';
import { localizeFormText } from '@/shared/format/number';
import { queryKeys } from '@/shared/query/queryKeys';
import { useEffect, useMemo, useState } from 'react';

import { getEngine } from '@/shared/native/engine';
import { useEngineChannel } from '@/shared/native/useEngineChannel';
import { BODY_STORED_CHANNEL, payloadKind } from '@/shared/native/engineChannels';
import type { FormZone, WellnessData } from '@/types';
import { RangeCoverage, type WellnessDay, type WellnessDays } from 'veloqrs';
import type { TimeRange } from '@/shared/app/timeRange';
import { TIME } from '@/shared/app/time';

export type { TimeRange };

/**
 * Refetch the wellness queries when wellness lands, and not before.
 *
 * This followed the `activities` channel, because nothing announced wellness at
 * all. That channel fires per synced page, measured five times in the first
 * 4.5 s of a launch, while wellness is written once, so all three consumers
 * re-read and re-parsed their whole window four times over for no change.
 * `sync_wellness` now announces through `store_body`, so the kind is what to
 * follow.
 */
function useWellnessInvalidation(): void {
  useEngineChannel(BODY_STORED_CHANNEL, queryKeys.wellness.all, 'wellness');
}

export function timeRangeToDays(range: TimeRange): number {
  return PERIOD_DAYS[range];
}

function getDateRange(range: TimeRange): { oldest: string; newest: string } {
  const today = new Date();
  const newest = formatLocalDate(today);

  const oldest = addLocalDays(today, -PERIOD_DAYS[range]);

  return {
    oldest: formatLocalDate(oldest),
    newest,
  };
}

/**
 * Read stored wellness days over a date window. The engine answers typed, so
 * this is a rename of its fields onto the shape the screens read.
 */
export function toWellnessData(day: WellnessDay, form?: DayForm): WellnessData {
  return {
    id: day.date,
    ctl: day.ctl,
    atl: day.atl,
    rampRate: day.rampRate,
    hrv: day.hrv,
    restingHR: day.restingHr,
    weight: day.weight,
    sleepSecs: day.sleepSecs,
    sleepScore: day.sleepScore,
    soreness: day.soreness,
    fatigue: day.fatigue,
    stress: day.stress,
    mood: day.mood,
    motivation: day.motivation,
    sportInfo: day.sportLoad.map((s) => ({ sportGroup: s.sportGroup, load: s.load })),
    form: form?.value,
    formZone: form?.zone,
    formText: form?.text,
    tsbText: form?.tsbText,
  };
}

/** One day's form as the engine judged it, lifted from the window's parallel lists. */
interface DayForm {
  value: number | undefined;
  zone: FormZone | undefined;
  text: string | undefined;
  tsbText: string | undefined;
}

function dayForm(window: WellnessDays, index: number): DayForm {
  return {
    value: window.form[index],
    zone: window.formZone[index] as FormZone | undefined,
    text: localizeFormText(window.formText[index]) ?? undefined,
    tsbText: window.tsbText[index],
  };
}

/** A window's stored days and whether the window was pulled at all. */
interface WellnessWindow {
  days: WellnessData[];
  coverage: RangeCoverage;
  /** Whether the athlete reads form as a share of fitness, as the engine read the profile. */
  formAsPercent: boolean;
  /** Where the form zones change, lowest first, in either unit. Empty with no engine. */
  formZoneEdges: readonly number[];
}

const NOTHING_KNOWN: WellnessWindow = {
  days: [],
  coverage: RangeCoverage.NotFetched,
  formAsPercent: false,
  formZoneEdges: [],
};

function readWellness(oldest: string, newest: string): WellnessWindow {
  const engine = getEngine();
  if (!engine?.getWellnessDays) return NOTHING_KNOWN;
  const window = engine.getWellnessDays(oldest, newest);
  return {
    days: window.days.map((day, index) => toWellnessData(day, dayForm(window, index))),
    coverage: window.coverage,
    formAsPercent: window.formAsPercent,
    formZoneEdges: window.formZoneEdges,
  };
}

const selectDays = (window: WellnessWindow): WellnessData[] => window.days;
const selectCoverage = (window: WellnessWindow): RangeCoverage => window.coverage;

/** The one query over a range's window, whichever part of it the caller reads. */
function wellnessWindowQuery(range: TimeRange, isAuthenticated: boolean) {
  const { oldest, newest } = getDateRange(range);
  return {
    queryKey: queryKeys.wellness.byRange(range, oldest, newest),
    queryFn: () => readWellness(oldest, newest),
    enabled: isAuthenticated,
    // SQLite is the source, so staleness is decided by the sync, not a clock.
    staleTime: Infinity,
    gcTime: TIME.DAY,
    placeholderData: keepPreviousData,
  };
}

/**
 * A counter that bumps when a wellness sync lands, without reading a row.
 *
 * The summary card used to keep a month of parsed bodies mounted for no other
 * reason than to know when to look again. The engine answers the card's
 * numbers itself now, so what is left to subscribe to is the fact of the
 * sync.
 */
export function useWellnessGeneration(): number {
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const engine = getEngine();
    if (!engine) return undefined;
    // `setGeneration` is stable, so the subscription is set up once and needs
    // no ref to reach the current closure.
    return engine.subscribe(BODY_STORED_CHANNEL, (payload) => {
      if (payloadKind(payload) !== 'wellness') return;
      setGeneration((g) => g + 1);
    });
  }, []);

  return generation;
}

export function useWellness(range: TimeRange = '3m') {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useWellnessInvalidation();

  return useQuery({ ...wellnessWindowQuery(range, isAuthenticated), select: selectDays });
}

/**
 * Where the form zones change, lowest first, as the engine sends them with every
 * wellness read. The edges are the engine's own and do not move while the app
 * runs, so a one-day read taken when a wellness sync lands is enough to draw
 * the bands. Empty until the engine has answered, which draws no bands.
 */
export function useFormZoneEdges(): readonly number[] {
  const generation = useWellnessGeneration();
  return useMemo(() => readFormZoneEdges(generation), [generation]);
}

/** One day's read, which carries the edges whatever the day holds. The generation only keys the re-read. */
function readFormZoneEdges(_generation: number): readonly number[] {
  const today = formatLocalDate(new Date());
  return readWellness(today, today).formZoneEdges;
}

const selectDaysByDate = (window: WellnessWindow): ReadonlyMap<string, WellnessData> =>
  new Map(window.days.map((d) => [d.id, d]));

/**
 * The stored days of an explicit window keyed by date, read once whatever days
 * a caller looks up in it. Null until the first answer, or signed out, so a day not yet read is not
 * taken for a day with nothing stored.
 */
export function useWellnessDays(
  oldest: string,
  newest: string
): ReadonlyMap<string, WellnessData> | null {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useWellnessInvalidation();

  const { data } = useQuery({
    queryKey: queryKeys.wellness.byRange('window', oldest, newest),
    queryFn: () => readWellness(oldest, newest),
    enabled: isAuthenticated,
    staleTime: Infinity,
    gcTime: TIME.DAY,
    select: selectDaysByDate,
  });
  // empty-on-error: null reads as not yet read, never as a window with nothing stored
  return data ?? null;
}

/**
 * Whether the window `useWellness` reads for `range` holds stored wellness,
 * holds none, or was never pulled, as the engine answers it beside the days.
 *
 * A wellness chart with nothing to draw cannot say which on its own, and told
 * the athlete to log wellness on a device that had simply not downloaded it.
 * It is the same query as the days, so it costs no second read. Before the
 * first answer, signed out, or with the read failed, nothing is known about
 * the window, so it answers `NotFetched`: `Empty` would be a claim.
 */
export function useWellnessCoverage(range: TimeRange = '3m'): RangeCoverage {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useWellnessInvalidation();

  const { data } = useQuery({
    ...wellnessWindowQuery(range, isAuthenticated),
    select: selectCoverage,
  });
  return data ?? RangeCoverage.NotFetched;
}

// Used for showing Form (CTL/ATL/TSB) on activity detail pages.
export function useWellnessForDate(date: string | undefined) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useWellnessInvalidation();

  return useQuery<WellnessData | null>({
    queryKey: queryKeys.wellness.byDate(date),
    queryFn: () => {
      if (!date) return null;
      return readWellness(date, date).days[0] ?? null;
    },
    enabled: isAuthenticated && !!date,
    staleTime: Infinity,
    gcTime: TIME.DAY,
  });
}
