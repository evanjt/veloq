/**
 * Scenario: the activities list is longer than one page, the window is resized and the list
 * scrolls its next page into view, while the phone answers a highlights read with the labels of
 * every activity it knows rather than only the ids it was asked for.
 *
 * Expected behaviour: each activity's route badge shows once, however many pages are read and
 * however many resize events arrive.
 */

import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { FeedPage } from '../../../web/connect/pages/Feed';
import { parse } from '../../../web/connect/router';
import type { Session, Snapshot } from '../../../web/connect/session';
import { card, newestFirst } from '../__shared__/connectDemoBase';
import { demoResults } from '../__shared__/connectDemoLibrary';
import { fakePhone } from '../__shared__/connectPhone';

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-GB' } }),
}));

const results = demoResults() as unknown as Record<string, unknown>;

const FIRST_PAGE = newestFirst.slice(0, 2);
const SECOND_PAGE = newestFirst.slice(2, 4);
const LABELS = Object.fromEntries(
  [...FIRST_PAGE, ...SECOND_PAGE].map((activity) => [activity.id, `${activity.name} PR`])
);

const everyLabel = () => ({
  indicators: [],
  routeHighlights: Object.entries(LABELS).map(([activityId, label]) => ({ activityId, label })),
  newGround: [],
  strengthCards: [],
});

const handler = (method: string, params: object) => {
  if (method === 'feed.page') {
    const { offset } = params as { offset: number };
    const page = offset === 0 ? FIRST_PAGE : SECOND_PAGE;
    return {
      cards: page.map(card),
      previews: [],
      hasMore: offset === 0,
      matchedCount: 4,
      familyCounts: [],
    };
  }
  if (method === 'feed.highlights') return everyLabel();
  if (method in results) return results[method];
  throw new Error(`unexpected read ${method}`);
};

let resizeListeners: (() => void)[] = [];

beforeEach(() => {
  resizeListeners = [];
  (globalThis as { window?: unknown }).window = {
    innerWidth: 1280,
    location: { hash: '#/activities', assign: () => undefined },
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'resize') resizeListeners.push(listener);
    },
    removeEventListener: (type: string, listener: () => void) => {
      if (type === 'resize') resizeListeners = resizeListeners.filter((held) => held !== listener);
    },
  };
  (globalThis as { document?: unknown }).document = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    constructor(private readonly seen: (entries: { isIntersecting: boolean }[]) => void) {}
    observe() {
      void Promise.resolve().then(() => this.seen([{ isIntersecting: true }]));
    }
    disconnect() {}
  };
});
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
});

async function settle() {
  for (let at = 0; at < 8; at += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('');

const badges = (root: ReactTestRenderer) =>
  root.root
    .findAll((node) => node.type === 'span' && node.props.className === 'ui-badge')
    .map(textOf);

describe('the route badges on the activities list', () => {
  it('shows each badge once after the next page is read and the window is resized', async () => {
    const stand = fakePhone(handler);
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(
        stand.wrap(
          <FeedPage
            route={parse('#/activities')}
            session={{} as Session}
            snapshot={{ libraryChanges: 0 } as Snapshot}
          />
        ),
        { createNodeMock: () => ({}) }
      );
    });
    await settle();
    for (let resize = 0; resize < 3; resize += 1) {
      await act(async () => {
        for (const listener of resizeListeners) listener();
      });
    }
    await settle();

    expect(stand.callsOf('feed.page').length).toBe(2);
    const shown = badges(root);
    expect(shown.sort()).toEqual(Object.values(LABELS).sort());
    root.unmount();
  });
});
