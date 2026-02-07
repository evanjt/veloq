/**
 * Module Export Contract Tests
 *
 * Source-code analysis tests that validate key barrel exports haven't been
 * accidentally removed during refactors. Reads source files with `fs` and
 * checks for expected export statements via regex.
 *
 * Run: npm test -- --testPathPattern=moduleExports
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../../..');

/**
 * Read a source file relative to the project root.
 */
function readSource(relPath: string): string {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Source file not found: ${abs}`);
  }
  return fs.readFileSync(abs, 'utf-8');
}

/**
 * Extract all named exports from a source file.
 * Handles:
 *   export { A, B, C } from './module'
 *   export function foo(
 *   export async function foo(
 *   export const foo =
 *   export type Foo =
 *   export interface Foo {
 *   export enum Foo {
 *   export * from './module'  (noted separately)
 */
function extractNamedExports(content: string): Set<string> {
  const names = new Set<string>();

  // Named export blocks: export { A, B, type C } from '...'
  const blockRegex = /export\s*\{([^}]+)\}/g;
  let match;
  while ((match = blockRegex.exec(content)) !== null) {
    // Strip single-line comments before parsing
    let block = match[1].replace(/\/\/[^\n]*/g, '');
    // Strip multi-line comments
    block = block.replace(/\/\*[\s\S]*?\*\//g, '');

    const items = block.split(',').map((s) => s.trim());
    for (const item of items) {
      if (!item) continue;
      // Strip 'type ' prefix for type re-exports
      const cleaned = item.replace(/^type\s+/, '');
      // Handle aliases: 'Foo as Bar' — we track the public name (Bar)
      const parts = cleaned.split(/\s+as\s+/);
      const publicName = (parts.length > 1 ? parts[1] : parts[0]).trim();
      if (publicName && /^[a-zA-Z_]/.test(publicName)) {
        names.add(publicName);
      }
    }
  }

  // Direct exports: export function/const/type/interface/enum/async function
  const directRegex =
    /export\s+(?:async\s+)?(?:function|const|let|var|type|interface|enum)\s+(\w+)/g;
  while ((match = directRegex.exec(content)) !== null) {
    names.add(match[1]);
  }

  return names;
}

/**
 * Check whether a file contains wildcard re-exports (`export * from '...'`).
 * Returns the list of module specifiers that are re-exported.
 */
function extractWildcardReexports(content: string): string[] {
  const specifiers: string[] = [];
  const regex = /export\s+\*\s+from\s+['"]([^'"]+)['"]/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    specifiers.push(match[1]);
  }
  return specifiers;
}

/**
 * Assert that every name in `expected` appears in the set of exports.
 * Returns a list of missing names for detailed error reporting.
 */
function findMissing(exports: Set<string>, expected: string[]): string[] {
  return expected.filter((name) => !exports.has(name));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Module Export Contracts', () => {
  // -----------------------------------------------------------------------
  // 1. Providers barrel
  // -----------------------------------------------------------------------
  describe('src/providers/index.ts', () => {
    let exports: Set<string>;

    beforeAll(() => {
      const content = readSource('src/providers/index.ts');
      exports = extractNamedExports(content);
    });

    it('should exist and contain exports', () => {
      expect(exports.size).toBeGreaterThan(0);
    });

    it('should export all store hooks', () => {
      const expected = [
        'useAuthStore',
        'useDisabledSections',
        'useHRZones',
        'usePotentialSections',
        'useSectionDismissals',
        'useSupersededSections',
        'useSportPreference',
        'useUnitPreference',
        'useRouteSettings',
        'useSyncDateRange',
        'useDashboardPreferences',
        'useLanguageStore',
        'useMapPreferences',
      ];

      const missing = findMissing(exports, expected);
      if (missing.length > 0) {
        console.error('Missing store hooks from providers barrel:', missing);
      }
      expect(missing).toEqual([]);
    });

    it('should export theme functions', () => {
      const expected = ['initializeTheme', 'setThemePreference', 'getThemePreference'];

      const missing = findMissing(exports, expected);
      expect(missing).toEqual([]);
    });

    it('should export all initialize* functions', () => {
      const expected = [
        'initializeTheme',
        'initializeLanguage',
        'initializeSportPreference',
        'initializeHRZones',
        'initializeUnitPreference',
        'initializeRouteSettings',
        'initializeDisabledSections',
        'initializeSectionDismissals',
        'initializeSupersededSections',
        'initializePotentialSections',
        'initializeDashboardPreferences',
      ];

      const missing = findMissing(exports, expected);
      if (missing.length > 0) {
        console.error('Missing initialize functions from providers barrel:', missing);
      }
      expect(missing).toEqual([]);
    });

    it('should export synchronous access helpers', () => {
      const expected = [
        'getStoredCredentials',
        'getPrimarySport',
        'getHRZones',
        'getIsMetric',
        'getSyncGeneration',
        'getEffectiveLanguage',
        'isRouteMatchingEnabled',
        'getMetricDefinition',
        'getMetricsForSport',
      ];

      const missing = findMissing(exports, expected);
      if (missing.length > 0) {
        console.error('Missing sync helpers from providers barrel:', missing);
      }
      expect(missing).toEqual([]);
    });

    it('should export context providers', () => {
      const expected = [
        'QueryProvider',
        'MapPreferencesProvider',
        'NetworkProvider',
        'TopSafeAreaProvider',
      ];

      const missing = findMissing(exports, expected);
      expect(missing).toEqual([]);
    });

    it('should export context hooks', () => {
      const expected = ['useNetwork', 'useTopSafeArea', 'useScreenSafeAreaEdges'];

      const missing = findMissing(exports, expected);
      expect(missing).toEqual([]);
    });

    it('should export key constants', () => {
      const expected = [
        'DEMO_ATHLETE_ID',
        'SPORT_API_TYPES',
        'SPORT_COLORS',
        'DEFAULT_HR_ZONES',
        'AVAILABLE_METRICS',
      ];

      const missing = findMissing(exports, expected);
      expect(missing).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // 2. Hooks barrel
  // -----------------------------------------------------------------------
  describe('src/hooks/index.ts', () => {
    let exports: Set<string>;

    beforeAll(() => {
      const content = readSource('src/hooks/index.ts');
      exports = extractNamedExports(content);
    });

    it('should exist and contain exports', () => {
      expect(exports.size).toBeGreaterThan(0);
    });

    it('should export activity hooks', () => {
      const expected = [
        'useActivities',
        'useInfiniteActivities',
        'useActivity',
        'useActivityStreams',
        'useActivityBoundsCache',
        'useEFTPHistory',
        'getLatestFTP',
        'getLatestEFTP',
      ];

      const missing = findMissing(exports, expected);
      if (missing.length > 0) {
        console.error('Missing activity hooks:', missing);
      }
      expect(missing).toEqual([]);
    });

    it('should export fitness and wellness hooks', () => {
      const expected = [
        'useWellness',
        'useWellnessForDate',
        'useZoneDistribution',
        'useAthleteSummary',
      ];

      const missing = findMissing(exports, expected);
      expect(missing).toEqual([]);
    });

    it('should export chart hooks', () => {
      const expected = [
        'usePowerCurve',
        'usePaceCurve',
        'useChartColors',
        'useChartColor',
        'useZoneColors',
        'useFitnessColors',
      ];

      const missing = findMissing(exports, expected);
      expect(missing).toEqual([]);
    });

    it('should export UI hooks', () => {
      const expected = ['useTheme', 'useMetricSystem'];

      const missing = findMissing(exports, expected);
      expect(missing).toEqual([]);
    });

    it('should export root-level hooks', () => {
      const expected = [
        'useAthlete',
        'useSportSettings',
        'getSettingsForSport',
        'getZoneColor',
        'useOldestActivityDate',
        'useCacheDays',
      ];

      const missing = findMissing(exports, expected);
      expect(missing).toEqual([]);
    });

    it('should export route engine hooks', () => {
      const expected = [
        'useRouteEngine',
        'useEngineGroups',
        'useEngineSections',
        'useViewportActivities',
        'useEngineStats',
        'useConsensusRoute',
        'useSectionSummaries',
        'useGroupSummaries',
        'useGroupDetail',
        'useSectionPolyline',
        'useSectionDetail',
      ];

      const missing = findMissing(exports, expected);
      if (missing.length > 0) {
        console.error('Missing route engine hooks:', missing);
      }
      expect(missing).toEqual([]);
    });

    it('should export section hooks', () => {
      const expected = [
        'useFrequentSections',
        'useSectionMatches',
        'useSectionPerformances',
        'useCustomSections',
        'useCustomSection',
        'useUnifiedSections',
      ];

      const missing = findMissing(exports, expected);
      expect(missing).toEqual([]);
    });

    it('should export route management hooks', () => {
      const expected = [
        'useRouteGroups',
        'useRouteMatch',
        'useRoutePerformances',
        'useRouteProcessing',
        'useRouteDataSync',
        'useRouteReoptimization',
        'useRetentionCleanup',
      ];

      const missing = findMissing(exports, expected);
      expect(missing).toEqual([]);
    });

    it('should export map hooks', () => {
      const expected = ['useEngineMapActivities'];

      const missing = findMissing(exports, expected);
      expect(missing).toEqual([]);
    });

    it('should export home hooks', () => {
      const expected = ['useSummaryCardData'];

      const missing = findMissing(exports, expected);
      expect(missing).toEqual([]);
    });

    it('should export fitness helper functions', () => {
      const expected = ['getISOWeekNumber', 'formatWeekRange'];

      const missing = findMissing(exports, expected);
      expect(missing).toEqual([]);
    });

    it('should re-export fitness algorithm functions from @/lib', () => {
      const expected = [
        'calculateTSB',
        'getFormZone',
        'FORM_ZONE_COLORS',
        'FORM_ZONE_LABELS',
        'FORM_ZONE_BOUNDARIES',
      ];

      const missing = findMissing(exports, expected);
      expect(missing).toEqual([]);
    });

    it('should export chart utility functions', () => {
      const expected = [
        'POWER_CURVE_DURATIONS',
        'getPowerAtDuration',
        'formatPowerCurveForChart',
        'PACE_CURVE_DISTANCES',
        'SWIM_PACE_CURVE_DISTANCES',
        'getPaceAtDistance',
        'paceToMinPerKm',
        'paceToMinPer100m',
      ];

      const missing = findMissing(exports, expected);
      expect(missing).toEqual([]);
    });

    it('should export sport settings constants', () => {
      const expected = [
        'POWER_ZONE_COLORS',
        'HR_ZONE_COLORS',
        'DEFAULT_POWER_ZONES',
        'DEFAULT_HR_ZONES',
      ];

      const missing = findMissing(exports, expected);
      expect(missing).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Lib barrel (uses wildcard re-exports, check sub-barrels)
  // -----------------------------------------------------------------------
  describe('src/lib/index.ts', () => {
    let content: string;
    let wildcardReexports: string[];

    beforeAll(() => {
      content = readSource('src/lib/index.ts');
      wildcardReexports = extractWildcardReexports(content);
    });

    it('should exist', () => {
      expect(content.length).toBeGreaterThan(0);
    });

    it('should have wildcard re-exports for core sub-modules', () => {
      expect(wildcardReexports).toContain('./algorithms');
      expect(wildcardReexports).toContain('./geo');
      expect(wildcardReexports).toContain('./storage');
      expect(wildcardReexports).toContain('./utils');
    });

    it('should export spatial index utilities', () => {
      const exports = extractNamedExports(content);
      const expected = ['activitySpatialIndex', 'mapBoundsToViewport'];

      const missing = findMissing(exports, expected);
      expect(missing).toEqual([]);
    });
  });

  describe('src/lib/algorithms (via wildcard)', () => {
    let exports: Set<string>;

    beforeAll(() => {
      const content = readSource('src/lib/algorithms/fitness.ts');
      exports = extractNamedExports(content);
    });

    it('should export TSB calculation functions', () => {
      const expected = ['calculateTSB', 'getFormZone'];

      const missing = findMissing(exports, expected);
      expect(missing).toEqual([]);
    });

    it('should export form zone constants', () => {
      const expected = ['FORM_ZONE_COLORS', 'FORM_ZONE_LABELS', 'FORM_ZONE_BOUNDARIES'];

      const missing = findMissing(exports, expected);
      expect(missing).toEqual([]);
    });
  });

  describe('src/lib/utils (via wildcard)', () => {
    it('should re-export all expected sub-modules', () => {
      const content = readSource('src/lib/utils/index.ts');
      const wildcards = extractWildcardReexports(content);

      const expected = [
        './format',
        './activityUtils',
        './chartConfig',
        './streams',
        './debug',
        './constants',
        './validation',
        './smoothing',
        './geometry',
      ];

      for (const mod of expected) {
        expect(wildcards).toContain(mod);
      }
    });

    it('should export formatting functions from format.ts', () => {
      const content = readSource('src/lib/utils/format.ts');
      const exports = extractNamedExports(content);

      const expected = [
        'formatDistance',
        'formatDuration',
        'formatPace',
        'formatPaceCompact',
        'formatSwimPace',
        'formatSpeed',
        'formatElevation',
        'formatTemperature',
        'formatHeartRate',
        'formatPower',
        'formatRelativeDate',
        'formatDateTime',
        'formatShortDate',
        'formatShortDateWithWeekday',
        'formatMonth',
        'formatDateRange',
        'formatFullDate',
        'formatFullDateWithWeekday',
        'formatTSS',
        'formatCalories',
        'formatLocalDate',
        'clamp',
      ];

      const missing = findMissing(exports, expected);
      if (missing.length > 0) {
        console.error('Missing format functions:', missing);
      }
      expect(missing).toEqual([]);
    });

    it('should export validation utilities from validation.ts', () => {
      const content = readSource('src/lib/utils/validation.ts');
      const exports = extractNamedExports(content);

      const expected = ['safeJsonParse', 'safeJsonParseWithSchema', 'isValidRecord'];

      const missing = findMissing(exports, expected);
      expect(missing).toEqual([]);
    });

    it('should export geometry functions from geometry.ts', () => {
      const content = readSource('src/lib/utils/geometry.ts');
      const exports = extractNamedExports(content);

      const expected = ['haversineDistance', 'computePolylineOverlap', 'simplifyPolyline'];

      const missing = findMissing(exports, expected);
      expect(missing).toEqual([]);
    });

    it('should export activity utility functions from activityUtils.ts', () => {
      const content = readSource('src/lib/utils/activityUtils.ts');
      const exports = extractNamedExports(content);

      const expected = [
        'getActivityIcon',
        'getActivityColor',
        'isRunningActivity',
        'isCyclingActivity',
        'sortByDateId',
      ];

      const missing = findMissing(exports, expected);
      expect(missing).toEqual([]);
    });

    it('should export constants from constants.ts', () => {
      const content = readSource('src/lib/utils/constants.ts');
      const exports = extractNamedExports(content);

      const expected = [
        'TIME',
        'CACHE',
        'RATE_LIMIT',
        'CHART',
        'SYNC',
        'UI',
        'API_DEFAULTS',
        'OAUTH',
        'INTERVALS_URLS',
        'SECTION_PATTERNS',
        'SECTION_COLORS',
        'getSectionStyle',
      ];

      const missing = findMissing(exports, expected);
      expect(missing).toEqual([]);
    });

    it('should export smoothing functions from smoothing.ts', () => {
      const content = readSource('src/lib/utils/smoothing.ts');
      const exports = extractNamedExports(content);

      const expected = [
        'DEFAULT_SMOOTHING_WINDOWS',
        'SMOOTHING_PRESETS',
        'getEffectiveWindow',
        'smoothDataPoints',
        'getSmoothingDescription',
      ];

      const missing = findMissing(exports, expected);
      expect(missing).toEqual([]);
    });

    it('should export chart config from chartConfig.ts', () => {
      const content = readSource('src/lib/utils/chartConfig.ts');
      const exports = extractNamedExports(content);

      const expected = ['CHART_CONFIGS', 'getAvailableCharts'];

      const missing = findMissing(exports, expected);
      expect(missing).toEqual([]);
    });

    it('should export stream parser from streams.ts', () => {
      const content = readSource('src/lib/utils/streams.ts');
      const exports = extractNamedExports(content);

      expect(exports.has('parseStreams')).toBe(true);
    });
  });

  describe('src/lib/geo (via wildcard)', () => {
    it('should export polyline functions from polyline.ts', () => {
      const content = readSource('src/lib/geo/polyline.ts');
      const exports = extractNamedExports(content);

      const expected = [
        'decodePolyline',
        'getBounds',
        'detectCoordinateFormat',
        'convertLatLngTuples',
        'normalizeBounds',
        'getBoundsCenter',
        'getBoundsFromPoints',
        'getMapLibreBounds',
        'getRegion',
        'getBoundsFromPolyline',
      ];

      const missing = findMissing(exports, expected);
      if (missing.length > 0) {
        console.error('Missing polyline functions:', missing);
      }
      expect(missing).toEqual([]);
    });

    it('should export geocoding functions from geocoding.ts', () => {
      const content = readSource('src/lib/geo/geocoding.ts');
      const exports = extractNamedExports(content);

      const expected = ['reverseGeocode', 'generateRouteName', 'clearGeocodeCache'];

      const missing = findMissing(exports, expected);
      expect(missing).toEqual([]);
    });
  });

  describe('src/lib/storage (via wildcard)', () => {
    it('should export GPS storage functions from gpsStorage.ts', () => {
      const content = readSource('src/lib/storage/gpsStorage.ts');
      const exports = extractNamedExports(content);

      const expected = [
        'storeGpsTrack',
        'storeGpsTracks',
        'getGpsTrack',
        'getGpsTracks',
        'hasGpsTrack',
        'clearAllGpsTracks',
        'getCachedActivityIds',
        'getGpsTrackCount',
        'estimateGpsStorageSize',
        'storeBoundsCache',
        'loadBoundsCache',
        'storeOldestDate',
        'loadOldestDate',
        'storeCheckpoint',
        'loadCheckpoint',
        'clearCheckpoint',
        'clearBoundsCache',
        'estimateBoundsCacheSize',
        'loadCustomRouteNames',
        'saveCustomRouteName',
        'getRouteDisplayName',
        'estimateRoutesDatabaseSize',
        'clearAllAppCaches',
      ];

      const missing = findMissing(exports, expected);
      if (missing.length > 0) {
        console.error('Missing GPS storage functions:', missing);
      }
      expect(missing).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // 4. API barrel
  // -----------------------------------------------------------------------
  describe('src/api/index.ts', () => {
    let exports: Set<string>;

    beforeAll(() => {
      const content = readSource('src/api/index.ts');
      exports = extractNamedExports(content);
    });

    it('should exist and contain exports', () => {
      expect(exports.size).toBeGreaterThan(0);
    });

    it('should export the API client and helper', () => {
      const expected = ['apiClient', 'getAthleteId'];

      const missing = findMissing(exports, expected);
      expect(missing).toEqual([]);
    });

    it('should export the intervals API object', () => {
      expect(exports.has('intervalsApi')).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Cross-cutting: total export counts (guard against mass deletions)
  // -----------------------------------------------------------------------
  describe('Export count guards', () => {
    it('providers barrel should have at least 30 named exports', () => {
      const content = readSource('src/providers/index.ts');
      const exports = extractNamedExports(content);
      expect(exports.size).toBeGreaterThanOrEqual(30);
    });

    it('hooks barrel should have at least 50 named exports', () => {
      const content = readSource('src/hooks/index.ts');
      const exports = extractNamedExports(content);
      expect(exports.size).toBeGreaterThanOrEqual(50);
    });

    it('format.ts should have at least 15 exported functions', () => {
      const content = readSource('src/lib/utils/format.ts');
      const exports = extractNamedExports(content);
      const functions = [...exports].filter((name) => /^(format|clamp)/.test(name));
      expect(functions.length).toBeGreaterThanOrEqual(15);
    });

    it('gpsStorage.ts should have at least 15 exported functions', () => {
      const content = readSource('src/lib/storage/gpsStorage.ts');
      const exports = extractNamedExports(content);
      expect(exports.size).toBeGreaterThanOrEqual(15);
    });
  });
});
