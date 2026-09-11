/**
 * Scenario: a string is rewritten in en-GB, the reference locale, and nobody
 * carries the rewrite to en-US.
 *
 * Expected behaviour: the two locales say the same thing except where they
 * deliberately differ, and a one-sided rewrite fails here. The five FTP keys
 * were rewritten in en-GB in May 2026 and en-US went on describing an
 * estimation the generator had stopped doing, for four months, because nothing
 * compared the two files.
 *
 * A divergence is legitimate and is recorded below. Adding a key to that list
 * is the deliberate act the guard exists to force.
 */
import enGB from '@/i18n/locales/en-GB.json';
import enUS from '@/i18n/locales/en-US.json';

/** Spelling that simply differs between the orthographies. */
const SPELLING = [
  'about.openSource',
  'about.thirdPartyLicenses',
  'cache.analyzingRoutes',
  'cache.finalizingHeatmap',
  'insights.noInsightsHint',
  'insights.strengthSnapshot.methodologyDescription',
  'licenses.footer',
  'licenses.intro',
  'licenses.sectionSpecialLicenses',
  'licenses.title',
  'maps.colorByGradient',
  'routes.analysingRoutes',
  'routes.routesWillAppear',
  'settings.customiseByActivity',
  'settings.previewKeepWarning',
  'settings.previewPoolCost',
  'settings.previewRunning',
  'settings.previewStaleCatalogue',
  'settings.reanalyzeSections',
  'settings.unitsMetricHint',
  'whatsNew.v022.fitnessBody',
  'whatsNew.v040.phaseDiffing',
  'whatsNew.v040.phasePreparing',
  'whatsNew.v040.recutRunning',
  'whatsNew.v040.recutRunningPhase',
];

/** Different words for the same thing, or a different register. */
const WORDING = [
  'activityTypes.Soccer',
  'emptyState.syncError.reason.internal',
  'emptyState.syncError.reason.network',
  'emptyState.syncError.reason.server',
  'emptyState.syncError.reason.storage',
  'emptyState.syncError.reason.unauthorized',
  'login.sessionDataKept',
  'maps.tapSelectEnd',
  'maps.tapSelectStart',
  'notifications.privacy.brief',
  'routes.createSection',
  'sectionHistory.kind_reference_reanchored',
  'wellness.smoothingDescription',
  'wellness.smoothingHint',
  'wellness.smoothingTitle',
];

const DIVERGENT = new Set([...SPELLING, ...WORDING]);

function flatten(node: unknown, path: string[] = []): [string, string][] {
  if (typeof node === 'string') return [[path.join('.'), node]];
  if (node === null || typeof node !== 'object') return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) =>
    flatten(v, [...path, k])
  );
}

const gb = new Map(flatten(enGB));
const us = new Map(flatten(enUS));

describe('en-US follows en-GB', () => {
  it('differs only where the list says it may', () => {
    const unexpected = [...gb.entries()]
      .filter(([key, value]) => us.has(key) && us.get(key) !== value && !DIVERGENT.has(key))
      .map(([key]) => key);
    expect(unexpected).toEqual([]);
  });

  it('lists no key that has since been brought back into line', () => {
    const stale = [...DIVERGENT].filter((key) => !gb.has(key) || gb.get(key) === us.get(key));
    expect(stale).toEqual([]);
  });

  it('the FTP copy says what the generator reports, in both', () => {
    for (const bundle of [gb, us]) {
      expect(bundle.get('insights.methodology.ftpEstimationName')).toBe('FTP setting changes');
      expect(bundle.get('insights.methodology.ftpEstimation')).toContain('intervals.icu account');
      expect(bundle.get('insights.methodology.ftpEstimation')).not.toContain('estimated FTP');
    }
  });
});
