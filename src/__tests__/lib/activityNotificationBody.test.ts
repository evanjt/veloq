import {
  buildActivityNotificationBody,
  NOTIFICATION_BODY_MAX,
} from '@/features/insights/lib/activityNotificationBody';
import type { NotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';
import type { Insight } from '@/features/insights/types';

const mockEngine = {
  getActivityRouteHighlights: jest.fn(),
  getSectionsForActivity: jest.fn(),
  getPerformancesBatch: jest.fn(),
};

jest.mock('veloqrs', () => ({ engine: mockEngine }), { virtual: true });

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

/**
 * The ladder decides which clause wins, and the clause leads the body. How
 * much of the activity name follows it is the cap's business, tested below.
 */
const expectLeads = (body: string, detail: string) => expect(body.startsWith(detail)).toBe(true);

describe('buildActivityNotificationBody priority ladder', () => {
  beforeEach(() => jest.clearAllMocks());

  it('route PR with a name beats everything', () => {
    setEngine({
      highlight: { routeName: 'Lake Loop', isPr: true, trend: 1 },
      sections: [{ id: 's1', name: 'Climb' }],
      bestBySection: { s1: 'a1' },
    });
    expectLeads(build(), 'notifications.activityBody.routePr(Lake Loop)');
  });

  it('single section PR names the section', () => {
    setEngine({
      highlight: null,
      sections: [{ id: 's1', name: 'Climb' }],
      bestBySection: { s1: 'a1' },
    });
    expectLeads(build(), 'notifications.activityBody.sectionPr(Climb)');
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
    expectLeads(build(), 'notifications.activityBody.sectionPrMany(Climb,1)');
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
    expectLeads(build(), 'notifications.activityBody.sectionPrCount(2)');
  });

  it('unnamed route PR still reads as a PR', () => {
    setEngine({ highlight: { routeName: '', isPr: true, trend: 1 } });
    expectLeads(build(), 'notifications.activityBody.routePrUnnamed');
  });

  it('route PR includes the improvement over the previous best', () => {
    setEngine({
      highlight: { routeName: 'Lake Loop', isPr: true, trend: 1, prImprovementSeconds: 12 },
    });
    expectLeads(build(), 'notifications.activityBody.routePrDelta(Lake Loop,12s)');
  });

  it('unnamed route PR includes the improvement, formatted m:ss over a minute', () => {
    setEngine({ highlight: { routeName: '', isPr: true, trend: 1, prImprovementSeconds: 65 } });
    expectLeads(build(), 'notifications.activityBody.routePrUnnamedDelta(1:05)');
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
    expectLeads(build(), 'notifications.activityBody.sectionPrDelta(Climb,12s)');
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
    expectLeads(build(), 'notifications.activityBody.sectionPr(Climb)');
  });

  it('faster than usual includes the gap to the PR', () => {
    setEngine({
      highlight: { routeName: 'Lake Loop', isPr: false, trend: 1, timeDeltaSeconds: 8 },
    });
    expectLeads(build(), 'notifications.activityBody.fasterOnRouteDelta(Lake Loop,8s)');
  });

  it('PR category off suppresses PRs but keeps route identity', () => {
    setEngine({
      highlight: { routeName: 'Lake Loop', isPr: true, trend: 1 },
      sections: [{ id: 's1', name: 'Climb' }],
      bestBySection: { s1: 'a1' },
    });
    expectLeads(build(noPrPrefs), 'notifications.activityBody.fasterOnRoute(Lake Loop)');
  });

  it('upward trend without PR reads faster than usual', () => {
    setEngine({ highlight: { routeName: 'Lake Loop', isPr: false, trend: 1 } });
    expectLeads(build(), 'notifications.activityBody.fasterOnRoute(Lake Loop)');
  });

  it('flat trend on a named route reads as route identity', () => {
    setEngine({ highlight: { routeName: 'Lake Loop', isPr: false, trend: 0 } });
    expectLeads(build(), 'notifications.activityBody.onRoute(Lake Loop)');
  });

  it('downward trend is never surfaced', () => {
    setEngine({ highlight: { routeName: 'Lake Loop', isPr: false, trend: -1 } });
    expectLeads(build(), 'notifications.activityBody.onRoute(Lake Loop)');
  });

  it('sections traversed without any route match', () => {
    setEngine({ highlight: null, sections: [{ id: 's1', name: 'Climb' }] });
    expectLeads(build(), 'notifications.activityBody.sectionTraversedOne');
  });

  it('falls back to milestone insight, then basic stats, then bare name', () => {
    setEngine({ highlight: null, sections: [] });
    const milestone = { id: 'i1', category: 'fitness_milestone', title: 'FTP up 5W' } as Insight;
    expectLeads(build(prefs, [milestone]), 'FTP up 5W');

    expect(
      buildActivityNotificationBody(
        'a1',
        'Morning Ride',
        [],
        prefs,
        { name: 'Morning Ride', type: 'Ride', ingested: true, distance: 12345, movingTime: 2700 },
        t
      )
    ).toContain('notifications.activityBody.distanceAndTime(12.3,45)');

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

/**
 * Scenario: an Android lock screen shows roughly 50 to 60 characters of a
 * notification body before collapsing the line, and neither the activity name
 * nor a user-renamed route has a length limit anywhere in the chain.
 *
 * Expected behaviour: the finding survives the cut and the names give way.
 * The PR and its delta are the only reason the enrichment pipeline exists, so
 * they can never be what falls off the end (`B148`).
 */
describe('the body fits the collapsed lock screen', () => {
  beforeEach(() => jest.clearAllMocks());

  // The real English strings, so a length assertion means something.
  const english = (key: string, params?: Record<string, string | number>) => {
    const table: Record<string, string> = {
      'notifications.activityBody.routePrDelta': 'Route PR on {{name}} ({{delta}} faster)',
      'notifications.activityBody.onRoute': 'On {{name}}',
    };
    let out = table[key] ?? key;
    for (const [k, v] of Object.entries(params ?? {})) out = out.replace(`{{${k}}}`, String(v));
    return out;
  };

  const LONG_ACTIVITY = 'Wednesday evening chaingang with the Thursday club, long version';
  const LONG_ROUTE = 'The long way round past the reservoir and back over the ridge';

  const buildEnglish = (activityName: string) =>
    buildActivityNotificationBody('a1', activityName, [], prefs, null, english);

  it('keeps the whole route PR clause and its delta inside the cap', () => {
    setEngine({
      highlight: { routeName: LONG_ROUTE, isPr: true, trend: 1, prImprovementSeconds: 12 },
    });

    const body = buildEnglish(LONG_ACTIVITY);

    expect(body.length).toBeLessThanOrEqual(NOTIFICATION_BODY_MAX);
    expect(body).toMatch(/^Route PR on /);
    expect(body).toContain('(12s faster)');
  });

  it('truncates the route name, never the delta', () => {
    setEngine({
      highlight: { routeName: LONG_ROUTE, isPr: true, trend: 1, prImprovementSeconds: 12 },
    });

    const body = buildEnglish('Ride');

    expect(body).toContain('…');
    expect(body).not.toContain('back over the ridge');
    expect(body).toContain('(12s faster)');
  });

  it('drops the activity name rather than cutting into the finding', () => {
    setEngine({
      highlight: { routeName: LONG_ROUTE, isPr: true, trend: 1, prImprovementSeconds: 12 },
    });

    const body = buildEnglish(LONG_ACTIVITY);

    expect(body).not.toContain('Wednesday');
  });

  it('keeps a short name when there is room for it', () => {
    setEngine({ highlight: { routeName: 'Lake Loop', isPr: false, trend: 0 } });

    expect(buildEnglish('Ride')).toBe('On Lake Loop - Ride');
  });

  it('leaves a body with no detail clause as the name alone, capped', () => {
    setEngine({ highlight: null, sections: [] });

    const body = buildEnglish(LONG_ACTIVITY);

    expect(body.length).toBeLessThanOrEqual(NOTIFICATION_BODY_MAX);
    expect(body).toMatch(/^Wednesday evening/);
  });

  it('keeps a name that lands exactly on the cap whole', () => {
    setEngine({ highlight: { routeName: 'Lake Loop', isPr: false, trend: 0 } });
    const detail = 'On Lake Loop - ';
    const name = 'x'.repeat(NOTIFICATION_BODY_MAX - detail.length);

    const body = buildEnglish(name);

    expect(body).toBe(`${detail}${name}`);
    expect(body.length).toBe(NOTIFICATION_BODY_MAX);
    expect(body).not.toContain('…');
  });
});

/**
 * Scenario: `fetchAndIngestActivity` returned null, which it does on three
 * paths: no credentials, the metadata poll exhausting its 15 s, and any thrown
 * exception. There is no name to put in the body.
 *
 * Expected behaviour: the body carries whatever the engine still knows and
 * nothing else. It used to fall back to the notification's own title, so the
 * athlete got "Activity Recorded" over "Activity Recorded", which is a strictly
 * worse notification than the generic one it replaced (`B149`).
 */
describe('an activity with no name', () => {
  beforeEach(() => jest.clearAllMocks());

  const nameless = () => buildActivityNotificationBody('a1', '', [], prefs, null, t);

  it('is empty when the engine knows nothing either', () => {
    setEngine({ highlight: null, sections: [] });
    expect(nameless()).toBe('');
  });

  it('is empty when the engine itself failed', () => {
    mockEngine.getActivityRouteHighlights.mockImplementation(() => {
      throw new Error('engine down');
    });
    mockEngine.getSectionsForActivity.mockImplementation(() => {
      throw new Error('engine down');
    });
    expect(nameless()).toBe('');
  });

  it('is the finding alone when the engine has one, with no dangling separator', () => {
    setEngine({ highlight: { routeName: 'Lake Loop', isPr: false, trend: 0 } });
    expect(nameless()).toBe('notifications.activityBody.onRoute(Lake Loop)');
  });
});
