/**
 * Scenario: a feature barrel re-exports every module the outside tree takes
 * from it, so importing the barrel evaluates all of them in source order. Two
 * of those modules reach another feature's barrel, which reaches back here, and
 * a module that is part-way through evaluation hands out an exports object
 * whose later bindings are still undefined.
 *
 * Expected behaviour: whichever barrel the app happens to load first, every
 * name the other one publishes is defined by the time the import returns. The
 * two orders are separate cases because a cycle only bites the entry point that
 * starts it.
 */

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

const ACTIVITY_NAMES = [
  'ActivityCard',
  'ActivityCardContextMenu',
  'ActivityChartsSection',
  'ActivityHeader',
  'ActivityRoutesSection',
  'ActivitySectionsSection',
  'SkylineBar',
  'fixtures',
  'getLatestFTP',
  'useActivities',
  'useActivity',
  'useActivityBoundsCache',
  'useActivityIntervals',
  'useActivitySectionHighlights',
  'useActivityStreams',
  'useDetailCoordinates',
  'useEFTPHistory',
  'useInfiniteActivities',
  'useSectionOverlays',
  'useActivityDetailData',
  'useActivityLabels',
  'FEED_GROUPS',
  'matchesFeedGroup',
  'groupSectionEncounters',
  'setVisibleRange',
];

/** The helpers this feature used to publish, now shared, kept here so the move
 *  cannot quietly come back and close the cycle again. */
const SHARED_HELPERS = [
  'getActivityColor',
  'getActivityIcon',
  'getSportDisplayName',
  'isPaceSport',
  'isSwimmingActivity',
  'measuresPower',
  'sortByDateId',
  'toActivityMetrics',
];

function undefinedNames(mod: Record<string, unknown>, names: string[]): string[] {
  return names.filter((name) => mod[name] === undefined);
}

describe('the activity barrel evaluates whole, whichever end the app enters from', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('defines every name it publishes when it is the first feature loaded', () => {
    const activity = require('@/features/activity');

    expect(undefinedNames(activity, ACTIVITY_NAMES)).toStrictEqual([]);
  });

  it('defines them when a feature that imports it back is loaded first', () => {
    require('@/features/routes');
    const activity = require('@/features/activity');

    expect(undefinedNames(activity, ACTIVITY_NAMES)).toStrictEqual([]);
  });

  it('defines them when the maps barrel is loaded first', () => {
    require('@/features/maps');
    const activity = require('@/features/activity');

    expect(undefinedNames(activity, ACTIVITY_NAMES)).toStrictEqual([]);
  });

  it('leaves the shared activity helpers out, which is what splits the cycle', () => {
    const activity = require('@/features/activity');
    const shared = {
      ...require('@/shared/activity/activityUtils'),
      ...require('@/shared/activity/activityMetrics'),
    };

    expect(SHARED_HELPERS.filter((name) => activity[name] !== undefined)).toStrictEqual([]);
    expect(SHARED_HELPERS.filter((name) => shared[name] === undefined)).toStrictEqual([]);
  });
});
