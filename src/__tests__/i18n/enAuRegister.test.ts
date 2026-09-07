/**
 * Scenario: en-AU used to be a casual-voice rewrite of the whole bundle, so a
 * destructive button read "Chuck it all & Reload" and a heart-rate label read
 * "Ticker". That is ruled out: destructive and factual strings read as en-GB
 * does, and personality survives only in empty states and celebrations.
 *
 * Expected behaviour: the next jokey string fails this suite rather than
 * shipping. `src/i18n/CLAUDE.md` carries the rule in prose.
 *
 * Spelling is not register and is guarded separately in `britishSpelling`.
 * en-GB is British, so Australian and British orthography coincide across
 * these strings and the assertion here is plain equality.
 */
import enAU from '@/i18n/locales/en-AU.json';
import enGB from '@/i18n/locales/en-GB.json';

/**
 * Confirmations and labels for an action that loses data. Listed rather than
 * matched on a pattern: a key whose name stops containing "delete" is still
 * destructive.
 */
const DESTRUCTIVE_KEYS = [
  'activity.resetToDefault',
  'alerts.clearCacheMessage',
  'alerts.clearCacheTitle',
  'alerts.clearReload',
  'alerts.disconnect',
  'alerts.disconnectAndClearConfirm',
  'alerts.disconnectAndClearMessage',
  'alerts.disconnectAndClearTitle',
  'alerts.disconnectMessage',
  'alerts.disconnectTitle',
  'backup.clearAndSync',
  'backup.replaceLiveConfirm',
  'backup.replaceLiveMessage',
  'backup.replaceLiveTitle',
  'common.delete',
  'common.remove',
  'common.reset',
  'namedCorridors.delete',
  'namedCorridors.deleteConfirm',
  'namedCorridors.deleteTitle',
  'recording.discard',
  'recording.library.delete',
  'recording.library.deleteConfirmMessage',
  'recording.library.deleteConfirmTitle',
  'sections.deleteSection',
  'sections.deleteSectionConfirm',
  'sections.removeSection',
  'sections.removeSectionConfirm',
  'sections.resetBounds',
  'sections.resetBoundsConfirm',
  'sections.resetReference',
  'sections.resetReferenceConfirm',
  'sensors.forget',
  'settings.clearAllReload',
  'settings.clearCache',
  'settings.disconnectAccount',
  'settings.disconnectAndClearData',
  'settings.previewDiscard',
  'settings.streamHistoryReset',
];

/** Empty states, where nothing has gone wrong and nothing is being decided. */
const VOICE_IN_EMPTY_STATES = [
  'activity.noDataAvailable',
  'activityDetail.noMatchedSections',
  'activityDetail.noMatchedSectionsDescription',
  'emptyState.offline.description',
  'emptyState.offline.title',
  'feed.noActivities',
  'feed.noMatchingActivities',
  'fitness.noData',
  'routes.noFrequentSections',
  'routes.noMatchingRoutes',
  'routes.noRoutesYet',
  'routes.noSectionsMatchFilter',
  'routes.routesWithTwoPlus',
  'sections.noActivitiesFound',
  'settings.noData',
  'stats.completeActivitiesHeatmap',
  'stats.completeActivitiesHr',
  'stats.completeActivitiesPower',
  'stats.completeActivitiesYearComparison',
  'stats.completeDecouplingHint',
  'stats.completePowerActivities',
  'stats.noActivitiesInPeriod',
  'stats.noActivityData',
  'stats.noDecouplingData',
  'stats.noFtpData',
  'stats.noPaceData',
  'stats.noPowerData',
  'stats.noSwimPaceData',
  'stats.noZoneData',
  'wellness.noTrendData',
];

/** Copy that thanks or congratulates, where the voice is the point. */
const VOICE_IN_CELEBRATIONS = [
  'backup.restoreComplete',
  'cache.allActivitiesSynced',
  'fitness.restDay',
  'support.thankYou',
];

/**
 * Not register. en-GB's word names a different thing in Australian English, so
 * flattening it would be a mistranslation: football is a different sport here.
 */
const AUSTRALIAN_VOCABULARY = ['activityTypes.Soccer'];

const MAY_DIFFER = new Set([
  ...VOICE_IN_EMPTY_STATES,
  ...VOICE_IN_CELEBRATIONS,
  ...AUSTRALIAN_VOCABULARY,
]);

function flatten(node: unknown, path: string[] = []): [string, string][] {
  if (typeof node === 'string') return [[path.join('.'), node]];
  if (node === null || typeof node !== 'object') return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    flatten(v, [...path, k])
  );
}

const au = new Map(flatten(enAU));
const gb = new Map(flatten(enGB));

describe('en-AU register', () => {
  it.each(DESTRUCTIVE_KEYS)('%s reads the same as en-GB', (key) => {
    expect(gb.get(key)).toBeDefined();
    expect(au.get(key)).toBe(gb.get(key));
  });

  it('lets nothing else differ, so a new jokey string fails here', () => {
    const differing = [...au.entries()]
      .filter(([key, value]) => gb.has(key) && gb.get(key) !== value)
      .map(([key]) => key)
      .filter((key) => !MAY_DIFFER.has(key));
    expect(differing).toEqual([]);
  });

  it('keeps the voice where the rule allows it', () => {
    const kept = [...MAY_DIFFER].filter((key) => au.get(key) !== gb.get(key));
    expect(kept.sort()).toEqual([...MAY_DIFFER].sort());
  });

  it('drops every term the flattened bundle no longer uses', () => {
    // An empty state may be casual, but not in a word the rest of the UI has
    // stopped using: "No ticker data yet" beside a "Heart Rate" label is worse
    // than either voice on its own.
    const retired = /\bticker|\bsquiz|\bkip\b|\bcooked\b|\bchuck/i;
    const offenders = [...au.entries()]
      .filter(([, value]) => retired.test(value))
      .map(([key, value]) => `${key}: ${value}`);
    expect(offenders).toEqual([]);
  });
});
