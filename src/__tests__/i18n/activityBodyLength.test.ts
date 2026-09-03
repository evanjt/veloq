/**
 * Scenario: `B148` capped the notification body at `NOTIFICATION_BODY_MAX` by
 * trimming the activity name, and sized the 24-character place-name cap
 * against the English templates. A translated template is longer, so the
 * composed detail can clear the cap on its own with no name left to give.
 *
 * Expected behaviour: every rung of the ladder, in every locale, fits. The
 * delta clause is what an Android lock screen must not drop, so where one is
 * present it survives whatever else does not.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  buildActivityNotification,
  NOTIFICATION_BODY_MAX,
} from '@/features/insights/lib/activityNotificationBody';
import type { Insight } from '@/features/insights/types';
import type { NotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';

const mockEngine = {
  getActivityRouteHighlights: jest.fn(),
  getSectionsForActivity: jest.fn(),
  getPerformancesBatch: jest.fn(),
};

jest.mock('veloqrs', () => ({ engine: mockEngine }), { virtual: true });

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

/** A `t` backed by a real locale file, interpolating `{{name}}` the way i18next does. */
function translatorFor(locale: string) {
  const table = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), 'utf-8'));
  return (key: string, params?: Record<string, string | number>): string => {
    const value = key.split('.').reduce<unknown>((acc, part) => {
      if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part];
      return undefined;
    }, table);
    if (typeof value !== 'string') return key;
    return Object.entries(params ?? {}).reduce(
      (out, [k, v]) => out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v)),
      value
    );
  };
}

const prefs: NotificationPreferences = {
  enabled: true,
  privacyAccepted: true,
  pendingUnregister: false,
  categories: { sectionPr: true, fitnessMilestone: true },
};

/** Long enough that the place-name cap is what decides, in every language. */
const LONG_PLACE = 'Reservoir ridge and the long way back again';
const LONG_ACTIVITY = 'Wednesday evening chaingang with the Thursday club';

interface Rung {
  name: string;
  hasDelta: boolean;
  setup: () => void;
  info?: Parameters<typeof buildActivityNotification>[4];
}

const named = (id: string, name: string) => ({ id, name });

function engineReturns({
  highlight = null,
  sections = [],
  perf = {},
}: {
  highlight?: Record<string, unknown> | null;
  sections?: { id: string; name: string }[];
  perf?: Record<string, unknown>;
}) {
  mockEngine.getActivityRouteHighlights.mockReturnValue(
    highlight ? [{ activityId: 'a1', ...highlight }] : []
  );
  mockEngine.getSectionsForActivity.mockReturnValue(sections);
  mockEngine.getPerformancesBatch.mockReturnValue(
    sections.map((s) => ({
      sectionId: s.id,
      result: perf[s.id] ?? { bestRecord: { activityId: 'a1' } },
    }))
  );
}

const RUNGS: Rung[] = [
  {
    name: 'routePrDelta',
    hasDelta: true,
    setup: () =>
      engineReturns({
        highlight: { routeName: LONG_PLACE, isPr: true, trend: 1, prImprovementSeconds: 154 },
      }),
  },
  {
    name: 'routePr',
    hasDelta: false,
    setup: () => engineReturns({ highlight: { routeName: LONG_PLACE, isPr: true, trend: 1 } }),
  },
  {
    name: 'routePrUnnamedDelta',
    hasDelta: true,
    setup: () =>
      engineReturns({
        highlight: { routeName: '', isPr: true, trend: 1, prImprovementSeconds: 154 },
      }),
  },
  {
    name: 'routePrUnnamed',
    hasDelta: false,
    setup: () => engineReturns({ highlight: { routeName: '', isPr: true, trend: 1 } }),
  },
  {
    name: 'sectionPrDelta',
    hasDelta: true,
    setup: () =>
      engineReturns({
        sections: [named('s1', LONG_PLACE)],
        perf: {
          s1: {
            bestRecord: { activityId: 'a1', bestTime: 100, direction: 'forward' },
            records: [
              { activityId: 'a1', bestTime: 100, direction: 'forward' },
              { activityId: 'a2', bestTime: 254, direction: 'forward' },
            ],
          },
        },
      }),
  },
  {
    name: 'sectionPr',
    hasDelta: false,
    setup: () => engineReturns({ sections: [named('s1', LONG_PLACE)] }),
  },
  {
    name: 'sectionPrMany',
    hasDelta: false,
    setup: () => engineReturns({ sections: [named('s1', LONG_PLACE), named('s2', 'Sprint')] }),
  },
  {
    name: 'sectionPrCount',
    hasDelta: false,
    setup: () => engineReturns({ sections: [named('s1', ''), named('s2', '')] }),
  },
  {
    name: 'fasterOnRouteDelta',
    hasDelta: true,
    setup: () =>
      engineReturns({
        highlight: { routeName: LONG_PLACE, isPr: false, trend: 1, timeDeltaSeconds: 154 },
      }),
  },
  {
    name: 'fasterOnRoute',
    hasDelta: false,
    setup: () => engineReturns({ highlight: { routeName: LONG_PLACE, isPr: false, trend: 1 } }),
  },
  {
    name: 'onRoute',
    hasDelta: false,
    setup: () => engineReturns({ highlight: { routeName: LONG_PLACE, isPr: false, trend: 0 } }),
  },
  {
    name: 'sectionTraversedOne',
    hasDelta: false,
    setup: () =>
      engineReturns({
        sections: [named('s1', LONG_PLACE)],
        perf: { s1: { bestRecord: { activityId: 'other' } } },
      }),
  },
  {
    name: 'sectionTraversedMany',
    hasDelta: false,
    setup: () =>
      engineReturns({
        sections: [named('s1', LONG_PLACE), named('s2', 'Sprint')],
        perf: {
          s1: { bestRecord: { activityId: 'other' } },
          s2: { bestRecord: { activityId: 'other' } },
        },
      }),
  },
  {
    name: 'distanceAndTime',
    hasDelta: false,
    setup: () => engineReturns({}),
    info: {
      name: LONG_ACTIVITY,
      type: 'Ride',
      ingested: true,
      distance: 123456,
      movingTime: 12345,
    },
  },
];

describe('every ladder rung fits the cap in every locale', () => {
  beforeEach(() => jest.clearAllMocks());

  describe.each(locales)('%s', (locale) => {
    const t = translatorFor(locale);

    it.each(RUNGS.map((r) => [r.name, r] as const))('%s fits with a long name', (_label, rung) => {
      rung.setup();
      const { body } = buildActivityNotification(
        'a1',
        LONG_ACTIVITY,
        [],
        prefs,
        rung.info ?? null,
        t
      );
      expect(body.length).toBeLessThanOrEqual(NOTIFICATION_BODY_MAX);
    });

    it.each(RUNGS.map((r) => [r.name, r] as const))('%s fits with no name', (_label, rung) => {
      rung.setup();
      const { body } = buildActivityNotification('a1', '', [], prefs, rung.info ?? null, t);
      expect(body.length).toBeLessThanOrEqual(NOTIFICATION_BODY_MAX);
    });

    it.each(RUNGS.filter((r) => r.hasDelta).map((r) => [r.name, r] as const))(
      '%s keeps its delta',
      (_label, rung) => {
        rung.setup();
        const { body } = buildActivityNotification('a1', LONG_ACTIVITY, [], prefs, null, t);
        expect(body).toContain('2:34');
      }
    );
  });

  it('a milestone insight title is capped too', () => {
    engineReturns({});
    const milestone = {
      id: 'i1',
      category: 'fitness_milestone',
      title: 'Functional threshold power is up by five watts on the twelve week trend',
    } as Insight;
    const { body } = buildActivityNotification(
      'a1',
      LONG_ACTIVITY,
      [milestone],
      prefs,
      null,
      translatorFor('en-GB')
    );
    expect(body.length).toBeLessThanOrEqual(NOTIFICATION_BODY_MAX);
  });
});
