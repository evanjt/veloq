/**
 * Scenario: the phone is one app version behind the browser and lists only the
 * feed reads. Pages that need other methods are opened.
 *
 * Expected behaviour: each panel says in place that the phone has to be
 * updated, sends nothing for the method it lacks, and never shows the
 * 'did not answer' wording or an empty count a failed read would give.
 */

import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { FitnessPage } from '../../../web/connect/pages/Dashboard';
import { ActivityRoute } from '../../../web/connect/pages/ActivityPage';
import { LivePage } from '../../../web/connect/pages/LivePage';
import { RoutesPage } from '../../../web/connect/pages/RoutesPage';
import { StrengthPage } from '../../../web/connect/pages/Strength';
import { WorkoutsPage } from '../../../web/connect/pages/WorkoutsPage';
import { parse } from '../../../web/connect/router';
import type { Session, Snapshot } from '../../../web/connect/session';
import { fakePhone } from '../__shared__/connectPhone';

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-GB' } }),
}));

const FEED_ONLY = ['link.hello', 'feed.page', 'feed.summary', 'feed.sparklines'];

const phone = () =>
  fakePhone(() => {
    throw new Error('a method the phone lacks was asked');
  }, FEED_ONLY);

const snapshot = {
  libraryChanges: 0,
  state: { name: 'connected', methods: FEED_ONLY },
} as Snapshot;
const props = (address: string) => ({
  session: {} as Session,
  snapshot,
  route: parse(address),
});

async function mount(element: React.ReactElement) {
  let root!: ReactTestRenderer;
  await act(async () => {
    root = create(element);
  });
  for (let at = 0; at < 4; at += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  return root;
}

const unsupported = (root: ReactTestRenderer) =>
  root.root.findAll((node) => node.props['data-read-error'] === 'unsupported');

const wording = (root: ReactTestRenderer) => JSON.stringify(root.toJSON());

const FAILURE_WORDING = [
  'connectPage.routes.listFailed',
  'connectPage.routes.routeFailed',
  'connectPage.routes.sectionFailed',
  'connectPage.routes.performanceFailed',
  'connectPage.workouts.failed',
  'connectPage.live.failed',
  'connectPage.fitness.failed',
  'connectPage.read.failed',
  'connectPage.read.timeout',
  'connectPage.activity.noSeries',
];

describe('a phone that lists only the feed reads', () => {
  // The tabs of a panel read the address from the browser, which this node environment lacks.
  const host = globalThis as { window?: unknown };
  const hostWindow = host.window;
  beforeEach(() => {
    host.window = {
      location: { hash: '', assign: () => undefined },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
  });
  afterEach(() => {
    host.window = hostWindow;
  });

  it.each([
    [
      'the activity page',
      (address: string) => <ActivityRoute {...props(address)} />,
      '#/activity/a1',
    ],
    ['a fitness panel', (address: string) => <FitnessPage {...props(address)} />, '#/fitness'],
    ['the routes list', (address: string) => <RoutesPage route={parse(address)} />, '#/routes'],
    ['a section', (address: string) => <RoutesPage route={parse(address)} />, '#/section/s1'],
    [
      'the strength page',
      (address: string) => <StrengthPage {...props(address)} />,
      '#/insights?type=strength',
    ],
    [
      'the workout builder',
      (address: string) => <WorkoutsPage route={parse(address)} />,
      '#/workouts',
    ],
    ['the live page', () => <LivePage />, '#/live'],
  ])('shows the update notice in %s and no failure wording', async (_name, page, address) => {
    const stand = phone();
    const root = await mount(stand.wrap(page(address)));
    expect(unsupported(root).length).toBeGreaterThan(0);
    for (const word of FAILURE_WORDING) expect(wording(root)).not.toContain(word);
    const sent = stand.calls.map((call) => call.method);
    expect(sent.filter((method) => !FEED_ONLY.includes(method))).toEqual([]);
    root.unmount();
  });
});
