/**
 * Scenario: en-AU is written as Australian English for fun, tongue in cheek
 * and never mocking. An athlete who picks it reads Australian voice on the
 * screens they see most, and plain British English where a playful word would
 * get in the way of a fact or a decision.
 *
 * Voiced: prose, notices, empty states, celebrations, notifications, widget
 * copy and the message of a confirmation. As en-GB: labels (one or two words,
 * or Title Case), the title and button of every destructive confirmation, and
 * every placeholder. A confirmation still names everything en-GB names.
 *
 * Expected behaviour: a voiced label, a dropped placeholder, a softened
 * warning, a string too long for its layout or a retired slang term fails here.
 *
 * Spelling is not register and is guarded separately: en-GB is British, and
 * Australian and British orthography coincide across these strings.
 */
import { resolvedLocale } from './resolvedLocale';
import enGB from '@/i18n/locales/en-GB.json';

const enAU = resolvedLocale('en-AU');

/**
 * Titles and buttons for an action that loses data. Listed rather than matched
 * on a pattern: a key whose name stops containing "delete" is still destructive.
 */
const DESTRUCTIVE_LABELS = [
  'activity.resetToDefault',
  'alerts.clearCacheTitle',
  'alerts.clearReload',
  'alerts.disconnect',
  'alerts.disconnectAndClearConfirm',
  'alerts.disconnectAndClearTitle',
  'alerts.disconnectTitle',
  'alerts.accountChangeContinue',
  'backup.clearAndSync',
  'backup.deviceLibraryDifferentAccount',
  'common.delete',
  'common.remove',
  'common.reset',
  'namedCorridors.delete',
  'namedCorridors.deleteTitle',
  'recording.discard',
  'recording.library.delete',
  'recording.library.deleteConfirmTitle',
  'sections.deleteSection',
  'sections.removeSection',
  'sections.resetBounds',
  'sections.resetReference',
  'sensors.forget',
  'settings.clearAllReload',
  'settings.clearCache',
  'settings.disconnectAccount',
  'settings.disconnectAndClearData',
  'settings.previewDiscard',
  'settings.streamHistoryReset',
];

/**
 * What each voiced confirmation must still name, read off its en-GB wording:
 * the kinds of data it deletes and where they come back from.
 */
const CONFIRMATION_NAMES: Record<string, RegExp[]> = {
  'alerts.clearCacheMessage': [/activity data/, /tracks/, /route matching/, /reload/],
  'alerts.disconnectMessage': [/API credentials/, /again/],
  'alerts.disconnectAndClearMessage': [
    /signs you out/,
    /library/,
    /this phone/,
    /cannot be undone/,
  ],
  'namedCorridors.deleteConfirm': [/generated name/],
  'recording.library.deleteConfirmMessage': [/recording/, /this device/],
  'recording.resumePreviousMessage': [/moving time/],
};

/** Short strings that are an empty state or a celebration, not a label. */
const SHORT_VOICE = [
  'activity.noDataAvailable',
  'activityDetail.noMatchedSections',
  'fitness.restDay',
  'routes.noRoutesYet',
  'settings.noData',
  'support.noCrashLog',
];

/**
 * Not register. en-GB's word names a different thing in Australian English, so
 * keeping it would be a mistranslation: football is a different sport here.
 */
const AUSTRALIAN_VOCABULARY = ['activityTypes.Soccer'];

/**
 * One string from each surface an athlete sees most. Each must read as en-AU,
 * so a bundle that falls back to en-GB on these screens fails here.
 */
const MOST_SEEN = [
  'feed.firstSyncTitle',
  'feed.firstSyncBody',
  'feed.emptyLibrary.emptyTitle',
  'feed.failedToLoad',
  'activity.noHeartRateData',
  'activityDetail.noRouteMatchDescription',
  'activitySummary.downloading',
  'cache.syncedActivities_other',
  'cache.offlineUsingCached',
  'refresh.offline',
  'refresh.busy',
  'emptyState.offline.description',
  'emptyState.syncError.title',
  'emptyState.syncError.reason.network',
  'emptyState.error.title',
  'errorState.defaultTitle',
  'routes.noRoutesYet',
  'stats.noPowerData',
  'alerts.clearCacheMessage',
  'alerts.disconnectAndClearMessage',
  'recording.resumePreviousMessage',
  'notifications.prompt.title',
  'notifications.prompt.description',
  'notifications.activityBody.fasterOnRoute',
  'systemSurfaces.toSeeTraining',
  'systemSurfaces.insightsEmpty',
  'systemSurfaces.recordDescription',
  'settings.syncStep.activities',
  'support.thankYou',
];

/** A warning of permanent loss keeps a word as strong as en-GB's. */
const PERMANENT_GB = /permanently|cannot be undone/i;
const PERMANENT_AU = /permanently|for good|cannot be undone|can't be undone/i;

/** Words a playful string may not use, because the rest of the UI does not. */
const RETIRED = /\bticker|\bsquiz|\bkip\b|\bcooked\b|\bchuck/i;

function flatten(node: unknown, path: string[] = []): [string, string][] {
  if (typeof node === 'string') return [[path.join('.'), node]];
  if (node === null || typeof node !== 'object') return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    flatten(v, [...path, k])
  );
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((match) => match[1]).sort();
}

/** One or two words, or every word capitalised: a label rather than prose. */
function isLabel(value: string): boolean {
  if (placeholders(value).length > 0) return false;
  const words = value.trim().split(/\s+/);
  if (words.length <= 2) return true;
  return words.every((word) => !/^\p{Ll}/u.test(word));
}

const au = new Map(flatten(enAU));
const gb = new Map(flatten(enGB));
const voiced = [...au.entries()].filter(([key, value]) => gb.has(key) && gb.get(key) !== value);

describe('en-AU register', () => {
  it.each(DESTRUCTIVE_LABELS)('%s reads the same as en-GB', (key) => {
    expect(gb.get(key)).toBeDefined();
    expect(au.get(key)).toBe(gb.get(key));
  });

  it.each(Object.entries(CONFIRMATION_NAMES))('%s still names what it deletes', (key, names) => {
    for (const name of names) expect(gb.get(key)).toMatch(name);
    const message = au.get(key) ?? '';
    expect(names.filter((name) => !name.test(message))).toEqual([]);
  });

  it('keeps every label as en-GB, bar the listed short voice and vocabulary', () => {
    const allowed = new Set([...SHORT_VOICE, ...AUSTRALIAN_VOCABULARY]);
    const offenders = voiced
      .filter(([key]) => !allowed.has(key) && isLabel(gb.get(key) ?? ''))
      .map(([key, value]) => `${key}: ${gb.get(key)} -> ${value}`);
    expect(offenders).toEqual([]);
  });

  it('reads Australian on the surfaces an athlete sees most', () => {
    const plain = MOST_SEEN.filter((key) => au.get(key) === gb.get(key));
    expect(plain).toEqual([]);
  });

  it('keeps the short voice and the vocabulary', () => {
    const plain = [...SHORT_VOICE, ...AUSTRALIAN_VOCABULARY].filter(
      (key) => au.get(key) === gb.get(key)
    );
    expect(plain).toEqual([]);
  });

  it('carries exactly the placeholders en-GB carries', () => {
    const offenders = voiced
      .filter(([key, value]) => {
        const expected = placeholders(gb.get(key) ?? '');
        return placeholders(value).join(',') !== expected.join(',');
      })
      .map(([key, value]) => `${key}: ${value}`);
    expect(offenders).toEqual([]);
  });

  it('keeps a warning of permanent loss as strong as en-GB', () => {
    const offenders = voiced
      .filter(([key, value]) => PERMANENT_GB.test(gb.get(key) ?? '') && !PERMANENT_AU.test(value))
      .map(([key, value]) => `${key}: ${value}`);
    expect(offenders).toEqual([]);
  });

  it('fits the layout en-GB fits', () => {
    const offenders = voiced
      .filter(([key, value]) => value.length > (gb.get(key) ?? '').length * 1.25 + 8)
      .map(([key, value]) => `${key}: ${gb.get(key)} -> ${value}`);
    expect(offenders).toEqual([]);
  });

  it('keeps the line breaks en-GB has', () => {
    const offenders = voiced
      .filter(([key, value]) => value.split('\n').length !== (gb.get(key) ?? '').split('\n').length)
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  it('drops every retired slang term', () => {
    const offenders = [...au.entries()]
      .filter(([, value]) => RETIRED.test(value))
      .map(([key, value]) => `${key}: ${value}`);
    expect(offenders).toEqual([]);
  });
});
