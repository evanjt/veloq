/**
 * Widget snapshot: the small, pre-formatted JSON the home-screen widgets render.
 * Widgets run in a separate process and cannot call the engine, so everything they
 * show is baked into that file.
 *
 * The engine composes it, here and in the Android push worker, which writes it with
 * no JavaScript running. What only the app knows, the translated words, the date
 * names, the palette, the summary card settings and the recent sports, it hands
 * over as a context. The engine stores that context so the worker composes in the
 * same words. `composeWidgetContext` is pure; `gatherWidgetSnapshot` is the entry
 * point the write hooks call.
 */
import { getIntlLocale } from '@/shared/format';
import { getEngine, isEngineReady } from '@/shared/native/engine';
import { useAuthStore } from '@/shared/app/AuthStore';
import { getRecentRecordingTypes, getRecordedRecordingTypes } from '@/shared/recording';
import { activityTypeColors } from '@/theme/colors';
import { widgetPalette, type WidgetPalette } from '@/shared/theme/widgetTheme';
import { localWallClockToEpochSeconds } from '@/shared/time/startDate';

import { useDashboardPreferences, type SummaryCardPreferences } from '../store';

/**
 * One recent sport: the id, the name a surface shows, and the deep link that
 * starts it. The URL is composed here and nowhere else, so no native holds a
 * second copy of the rule and no surface can drift from the others.
 */
export interface WidgetRecordShortcut {
  type: string;
  label: string;
  url: string;
}

/** Where a record surface goes when no sport is known: the picker, as before. */
export const RECORD_PICKER_URL = 'veloq://record';

/**
 * Marks a link that came from outside the app. The recording screen reads it to
 * decide whether the Always location dialog has earned itself: an athlete who
 * starts from a home screen has just shown they want to start without the app in
 * front, and an in-app start has shown nothing of the kind.
 */
export const QUICK_START_MARK = 'from=quickstart';

/** What a launcher will show on a long press, and what that list is capped at. */
export const RECORD_SHORTCUT_LIMIT = 3;

/**
 * Every key the engine's composer translates. A key left out prints as itself on
 * the widget, so the list is pinned against the composer by a contract test.
 */
export const WIDGET_STRING_KEYS = [
  'metrics.form',
  'metrics.fitness',
  'metrics.fatigue',
  'metrics.hrv',
  'metrics.rhr',
  'metrics.week',
  'recording.startActivity',
  'metrics.ftp',
  'metrics.pace',
  'metrics.css',
  'fitnessScreen.rampRate',
  'fitnessScreen.perWeek',
  'formZones.highRisk',
  'formZones.optimal',
  'formZones.greyZone',
  'formZones.fresh',
  'formZones.transition',
  'time.today',
  'time.yesterday',
] as const;

/** One piece of a date format, as `Intl.DateTimeFormat.formatToParts` names it. */
export interface WidgetDatePart {
  type: 'month' | 'day' | 'year' | 'literal';
  value: string;
}

/** A date format: its parts in order, and the month names it writes, January first. */
export interface WidgetDatePattern {
  parts: WidgetDatePart[];
  months: string[];
}

/** The locale's day and month names, so the engine writes a relative date with no locale data. */
export interface WidgetDateWords {
  /** Long weekday names, Sunday first. */
  weekdays: string[];
  monthDay: WidgetDatePattern;
  monthDayYear: WidgetDatePattern;
}

/** What the engine composes the snapshot with beside its own rows. */
export interface WidgetContext {
  locale: string;
  isMetric: boolean;
  formAsPercent: boolean;
  strings: Record<string, string>;
  dates: WidgetDateWords;
  /** Null hides the widget summary block. */
  summaryCard: SummaryCardPreferences | null;
  theme: { light: WidgetPalette; dark: WidgetPalette };
  /** Sport tint by sport type, `Other` the fallback, so the widget needs no sport-to-colour map. */
  activityTints: Record<string, string>;
  /**
   * The recent sports, most recent first, pre-localised. One source for every
   * record surface: the widgets and the iOS control take the head, the Android
   * launcher publishes the list as dynamic shortcuts and the Quick Settings tile
   * draws the head's label. Empty until something has been recorded, which is
   * the signal to fall back to the picker.
   */
  recordShortcuts: WidgetRecordShortcut[];
  /**
   * The head of `recordShortcuts`, capped at what a launcher will show on a long
   * press. Carried rather than derived natively so the cap is decided once, and
   * so a Siri phrase can offer every sport while the icon offers three.
   */
  launcherShortcuts: WidgetRecordShortcut[];
}

export interface WidgetContextInput {
  locale: string;
  isMetric: boolean;
  /** Whether the athlete reads form as a share of fitness (`icu_form_as_percent`). */
  formAsPercent?: boolean | undefined;
  /** i18n lookup; falls back to the raw key when absent. */
  translate?: ((key: string) => string) | undefined;
  /** In-app summary card settings; null hides the widget summary block. */
  summaryPrefs?: SummaryCardPreferences | null | undefined;
  /** Recent sports, most recent first. Blanks and repeats are dropped here. */
  recentRecordingTypes?: string[] | null | undefined;
  /** Every distinct sport recorded, most recent first. Offered by the pickers only. */
  recordedRecordingTypes?: string[] | null | undefined;
  /** The locale's date words; read from `Intl` when absent. */
  dates?: WidgetDateWords | undefined;
}

/** What the bridge writes: the snapshot file, and the launcher's own copy of the shortcuts. */
export interface WidgetSnapshotPayload {
  json: string;
  launcherShortcuts: WidgetRecordShortcut[];
}

/** The context for the engine's composer. Pure, so every choice in it is testable. */
export function composeWidgetContext(input: WidgetContextInput): WidgetContext {
  const t = input.translate ?? ((k: string) => k);
  const strings: Record<string, string> = {};
  for (const key of WIDGET_STRING_KEYS) strings[key] = t(key);
  const launcher = composeRecordShortcuts(input.recentRecordingTypes, t);
  return {
    locale: input.locale,
    isMetric: input.isMetric,
    formAsPercent: input.formAsPercent === true,
    strings,
    dates: input.dates ?? widgetDateWords(),
    summaryCard: input.summaryPrefs ?? null,
    theme: { light: widgetPalette.light, dark: widgetPalette.dark },
    activityTints: { ...activityTypeColors },
    recordShortcuts: composeRecordShortcuts(
      [...(input.recentRecordingTypes ?? []), ...(input.recordedRecordingTypes ?? [])],
      t
    ),
    launcherShortcuts: launcher.slice(0, RECORD_SHORTCUT_LIMIT),
  };
}

/**
 * A blank sport is no sport and a repeat is one entry, so no surface gets an
 * empty path or the same sport twice. Labels come from the translations the app
 * already carries, which is why no native holds a sport-to-name map.
 *
 * Uncapped on purpose: the widget pickers and a Siri phrase offer every sport the
 * athlete has recorded, and `launcherShortcuts` is where the launcher's three come
 * from, built from the recents alone.
 */
function composeRecordShortcuts(
  types: string[] | null | undefined,
  t: (key: string) => string
): WidgetRecordShortcut[] {
  const seen = new Set<string>();
  const out: WidgetRecordShortcut[] = [];
  for (const raw of types ?? []) {
    const type = typeof raw === 'string' ? raw.trim() : '';
    if (type.length === 0 || seen.has(type)) continue;
    seen.add(type);
    const label = t(`activityTypes.${type}`);
    out.push({
      type,
      label: label === `activityTypes.${type}` ? type : label,
      url: `veloq://recording/${encodeURIComponent(type)}?${QUICK_START_MARK}`,
    });
  }
  return out;
}

/** 2023-01-01 was a Sunday, so the seven days from it are the week Sunday first. */
const FIRST_SUNDAY = { year: 2023, month: 0, day: 1 };

/** A day and a year that cannot be mistaken for each other or for a month. */
const SAMPLE_DAY = 22;
const SAMPLE_YEAR = 2001;

/**
 * The app locale's weekday and month names and its short date order, read from
 * `Intl`, so the engine writes "Friday" or "5 janv." as the app would.
 */
export function widgetDateWords(locale: string = getIntlLocale()): WidgetDateWords {
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Date(FIRST_SUNDAY.year, FIRST_SUNDAY.month, FIRST_SUNDAY.day + i).toLocaleDateString(
      locale,
      { weekday: 'long' }
    )
  );
  return {
    weekdays,
    monthDay: datePattern(locale, { month: 'short', day: 'numeric' }),
    monthDayYear: datePattern(locale, { month: 'short', day: 'numeric', year: 'numeric' }),
  };
}

function datePattern(locale: string, options: Intl.DateTimeFormatOptions): WidgetDatePattern {
  try {
    const format = new Intl.DateTimeFormat(locale, options);
    if (typeof format.formatToParts !== 'function') return { parts: [], months: [] };
    const sample = (month: number) =>
      format.formatToParts(new Date(SAMPLE_YEAR, month, SAMPLE_DAY));
    const parts: WidgetDatePart[] = [];
    for (const part of sample(0)) {
      if (part.type === 'month' || part.type === 'day' || part.type === 'year') {
        parts.push({ type: part.type, value: '' });
      } else if (part.type === 'literal') {
        parts.push({ type: 'literal', value: part.value });
      } else {
        // A part the engine cannot write, such as an era: no pattern, and the
        // engine falls back to an unambiguous date.
        return { parts: [], months: [] };
      }
    }
    const months = Array.from(
      { length: 12 },
      (_, m) => sample(m).find((p) => p.type === 'month')?.value ?? ''
    );
    return { parts, months };
  } catch {
    return { parts: [], months: [] };
  }
}

/** Seconds since the epoch the snapshot is stamped with, and the same moment on the wall clock. */
function clock(now: Date): { nowSeconds: number; nowWallSeconds: number } {
  return {
    nowSeconds: Math.floor(now.getTime() / 1000),
    // An activity's date comes from `start_date_local` as zoneless wall-clock
    // seconds, so its age and its week are judged on the same clock.
    nowWallSeconds: localWallClockToEpochSeconds(now),
  };
}

/**
 * Read the engine and compose the snapshot. Returns null when the engine isn't
 * ready (e.g. very early startup) so callers can no-op.
 *
 * The handle exists from the first require and readiness is a separate flag, so
 * a null check on the handle answers "did the native module load" and never
 * "is the database open". Composing from a closed engine writes zero fitness,
 * zero form and no rides, which blanks the widget rather than leaving it stale.
 */
export function gatherWidgetSnapshot(opts: {
  locale: string;
  isMetric: boolean;
  formAsPercent?: boolean | undefined;
  now?: Date | undefined;
  translate?: ((key: string) => string) | undefined;
}): WidgetSnapshotPayload | null {
  const engine = getEngine();
  if (!engine || !isEngineReady()) return null;

  let summaryPrefs: SummaryCardPreferences | null = null;
  try {
    summaryPrefs = useDashboardPreferences.getState().summaryCard;
  } catch {
    summaryPrefs = null;
  }

  const context = composeWidgetContext({
    locale: opts.locale,
    isMetric: opts.isMetric,
    formAsPercent: opts.formAsPercent,
    translate: opts.translate,
    summaryPrefs,
    // No account, no shortcuts. Every one-tap surface starts a ride directly, so
    // leaving a stale one on a launcher would walk straight past the sign-in
    // gate, and clearing them is also what takes them off the icon on sign-out.
    recentRecordingTypes: signedIn() ? getRecentRecordingTypes() : [],
    recordedRecordingTypes: signedIn() ? getRecordedRecordingTypes() : [],
  });
  const contextJson = JSON.stringify(context);
  const { nowSeconds, nowWallSeconds } = clock(opts.now ?? new Date());

  let json: string | undefined;
  try {
    json = engine.composeWidgetSnapshot(contextJson, nowSeconds, nowWallSeconds);
  } catch {
    // empty-on-error: the widget keeps its last snapshot when this one is unknown.
    // The read answers NotInitialized when the database is not open, and that is
    // "unknown", not "the athlete has no data". Anything else that throws is
    // unknown too.
    return null;
  }
  if (!json) return null;
  // Stored after a composition that worked, so the push worker composes in the
  // same words and the same settings as the file the app just wrote.
  engine.setWidgetContext(contextJson);
  return { json, launcherShortcuts: context.launcherShortcuts };
}

/** Whether anyone is signed in; a failed read counts as nobody. */
function signedIn(): boolean {
  try {
    return useAuthStore.getState().authMethod != null;
  } catch {
    return false;
  }
}
