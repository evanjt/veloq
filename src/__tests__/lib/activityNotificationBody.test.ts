const mockEngine = {
  getActivityRouteHighlights: jest.fn(),
  getSectionsForActivity: jest.fn(),
  getPerformancesBatch: jest.fn(),
};

jest.mock('veloqrs', () => ({ routeEngine: mockEngine }), { virtual: true });

import { buildActivityNotificationBody } from '@/features/insights/lib/activityNotificationBody';
import type { NotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';
import type { Insight } from '@/features/insights/types';

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}(${Object.values(params).join(',')})` : key;

const prefs: NotificationPreferences = {
  enabled: true,
  privacyAccepted: true,
  pendingUnregister: false,
  categories: { sectionPr: true, fitnessMilestone: true },
};

const noPrPrefs: NotificationPreferences = {
  ...prefs,
  categories: { sectionPr: false, fitnessMilestone: true },
};

function setEngine({
  highlight = null,
  sections = [],
  bestBySection = {},
  perfBySection = {},
}: {
  highlight?: {
    routeName: string;
    isPr: boolean;
    trend: number;
    timeDeltaSeconds?: number;
    prImprovementSeconds?: number;
  } | null;
  sections?: { id: string; name: string }[];
  bestBySection?: Record<string, string>;
  perfBySection?: Record<string, unknown>;
}) {
  mockEngine.getActivityRouteHighlights.mockReturnValue(
    highlight ? [{ activityId: 'a1', ...highlight }] : []
  );
  mockEngine.getSectionsForActivity.mockReturnValue(sections);
  mockEngine.getPerformancesBatch.mockReturnValue(
    sections.map((s) => ({
      sectionId: s.id,
      result: perfBySection[s.id] ?? {
        bestRecord: { activityId: bestBySection[s.id] ?? 'other' },
      },
    }))
  );
}

const build = (p: NotificationPreferences = prefs, insights: Insight[] = []) =>
  buildActivityNotificationBody('a1', 'Morning Ride', insights, p, null, t);

describe('buildActivityNotificationBody priority ladder', () => {
  beforeEach(() => jest.clearAllMocks());

  it('route PR with a name beats everything', () => {
    setEngine({
      highlight: { routeName: 'Lake Loop', isPr: true, trend: 1 },
      sections: [{ id: 's1', name: 'Climb' }],
      bestBySection: { s1: 'a1' },
    });
    expect(build()).toBe('Morning Ride - notifications.activityBody.routePr(Lake Loop)');
  });

  it('single section PR names the section', () => {
    setEngine({
      highlight: null,
      sections: [{ id: 's1', name: 'Climb' }],
      bestBySection: { s1: 'a1' },
    });
    expect(build()).toBe('Morning Ride - notifications.activityBody.sectionPr(Climb)');
  });

  it('multiple section PRs name the first and count the rest', () => {
    setEngine({
      highlight: null,
      sections: [
        { id: 's1', name: 'Climb' },
        { id: 's2', name: 'Sprint' },
      ],
      bestBySection: { s1: 'a1', s2: 'a1' },
    });
    expect(build()).toBe('Morning Ride - notifications.activityBody.sectionPrMany(Climb,1)');
  });

  it('multiple unnamed section PRs keep the count form', () => {
    setEngine({
      highlight: null,
      sections: [
        { id: 's1', name: '' },
        { id: 's2', name: '' },
      ],
      bestBySection: { s1: 'a1', s2: 'a1' },
    });
    expect(build()).toBe('Morning Ride - notifications.activityBody.sectionPrCount(2)');
  });

  it('unnamed route PR still reads as a PR', () => {
    setEngine({ highlight: { routeName: '', isPr: true, trend: 1 } });
    expect(build()).toBe('Morning Ride - notifications.activityBody.routePrUnnamed');
  });

  it('route PR includes the improvement over the previous best', () => {
    setEngine({
      highlight: { routeName: 'Lake Loop', isPr: true, trend: 1, prImprovementSeconds: 12 },
    });
    expect(build()).toBe('Morning Ride - notifications.activityBody.routePrDelta(Lake Loop,12s)');
  });

  it('unnamed route PR includes the improvement, formatted m:ss over a minute', () => {
    setEngine({ highlight: { routeName: '', isPr: true, trend: 1, prImprovementSeconds: 65 } });
    expect(build()).toBe('Morning Ride - notifications.activityBody.routePrUnnamedDelta(1:05)');
  });

  it('section PR includes the delta vs the previous best in the same direction', () => {
    setEngine({
      highlight: null,
      sections: [{ id: 's1', name: 'Climb' }],
      perfBySection: {
        s1: {
          bestRecord: { activityId: 'a1', bestTime: 100, direction: 'forward' },
          records: [
            { activityId: 'a1', bestTime: 100, direction: 'forward' },
            { activityId: 'a2', bestTime: 112, direction: 'forward' },
            { activityId: 'a3', bestTime: 90, direction: 'backward' },
          ],
        },
      },
    });
    expect(build()).toBe('Morning Ride - notifications.activityBody.sectionPrDelta(Climb,12s)');
  });

  it('section PR with no earlier same-direction attempt keeps the plain form', () => {
    setEngine({
      highlight: null,
      sections: [{ id: 's1', name: 'Climb' }],
      perfBySection: {
        s1: {
          bestRecord: { activityId: 'a1', bestTime: 100, direction: 'forward' },
          records: [{ activityId: 'a1', bestTime: 100, direction: 'forward' }],
        },
      },
    });
    expect(build()).toBe('Morning Ride - notifications.activityBody.sectionPr(Climb)');
  });

  it('faster than usual includes the gap to the PR', () => {
    setEngine({
      highlight: { routeName: 'Lake Loop', isPr: false, trend: 1, timeDeltaSeconds: 8 },
    });
    expect(build()).toBe(
      'Morning Ride - notifications.activityBody.fasterOnRouteDelta(Lake Loop,8s)'
    );
  });

  it('PR category off suppresses PRs but keeps route identity', () => {
    setEngine({
      highlight: { routeName: 'Lake Loop', isPr: true, trend: 1 },
      sections: [{ id: 's1', name: 'Climb' }],
      bestBySection: { s1: 'a1' },
    });
    expect(build(noPrPrefs)).toBe(
      'Morning Ride - notifications.activityBody.fasterOnRoute(Lake Loop)'
    );
  });

  it('upward trend without PR reads faster than usual', () => {
    setEngine({ highlight: { routeName: 'Lake Loop', isPr: false, trend: 1 } });
    expect(build()).toBe('Morning Ride - notifications.activityBody.fasterOnRoute(Lake Loop)');
  });

  it('flat trend on a named route reads as route identity', () => {
    setEngine({ highlight: { routeName: 'Lake Loop', isPr: false, trend: 0 } });
    expect(build()).toBe('Morning Ride - notifications.activityBody.onRoute(Lake Loop)');
  });

  it('downward trend is never surfaced', () => {
    setEngine({ highlight: { routeName: 'Lake Loop', isPr: false, trend: -1 } });
    expect(build()).toBe('Morning Ride - notifications.activityBody.onRoute(Lake Loop)');
  });

  it('sections traversed without any route match', () => {
    setEngine({ highlight: null, sections: [{ id: 's1', name: 'Climb' }] });
    expect(build()).toBe('Morning Ride - notifications.activityBody.sectionTraversedOne');
  });

  it('falls back to milestone insight, then basic stats, then bare name', () => {
    setEngine({ highlight: null, sections: [] });
    const milestone = { id: 'i1', category: 'fitness_milestone', title: 'FTP up 5W' } as Insight;
    expect(build(prefs, [milestone])).toBe('Morning Ride - FTP up 5W');

    expect(
      buildActivityNotificationBody(
        'a1',
        'Morning Ride',
        [],
        prefs,
        { name: 'Morning Ride', type: 'Ride', ingested: true, distance: 12345, movingTime: 2700 },
        t
      )
    ).toBe('Morning Ride - notifications.activityBody.distanceAndTime(12.3,45)');

    expect(build()).toBe('Morning Ride');
  });

  it('engine failure falls through to the name, never throws', () => {
    mockEngine.getActivityRouteHighlights.mockImplementation(() => {
      throw new Error('engine down');
    });
    mockEngine.getSectionsForActivity.mockImplementation(() => {
      throw new Error('engine down');
    });
    expect(build()).toBe('Morning Ride');
  });
});
