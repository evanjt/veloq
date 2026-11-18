/**
 * Scenario: the phone cannot answer the activities page. Every read fails, the
 * first page is still on its way, or the phone answers with an empty library.
 *
 * Expected behaviour: a failed read shows an alert with a retry in place of the
 * list, and no sport count or row count reads as zero. A first page still on its
 * way shows a loading state in that place. Only an answered empty library shows
 * its zero counts.
 */

import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { FeedPage } from '../../../web/connect/pages/Feed';
import { parse } from '../../../web/connect/router';
import type { Session, Snapshot } from '../../../web/connect/session';
import { fakePhone } from '../__shared__/connectPhone';

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-GB' } }),
}));

const FAILED = () => {
  throw new Error('the phone could not read this');
};

const NEVER = () => new Promise<never>(() => undefined);

const EMPTY_LIBRARY = { cards: [], previews: [], hasMore: false, familyCounts: [] };

beforeEach(() => {
  (globalThis as { window?: unknown }).window = {
    innerWidth: 1280,
    location: { hash: '#/activities', assign: () => undefined },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  (globalThis as { document?: unknown }).document = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
});
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { document?: unknown }).document;
});

async function settle() {
  for (let at = 0; at < 4; at += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mount(handler: (method: string, params: object) => unknown) {
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
      )
    );
  });
  await settle();
  return { root, stand };
}

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('');

const hostsWhere = (root: ReactTestInstance, test: (node: ReactTestInstance) => boolean) =>
  root.findAll((node) => typeof node.type === 'string' && test(node));

/** The text of every sport chip count and table row count on the page. */
const counts = (root: ReactTestRenderer) =>
  hostsWhere(root.root, (node) =>
    /\b(chip-count|ui-table-count)\b/.test(String(node.props.className ?? ''))
  ).map(textOf);

const alerts = (root: ReactTestRenderer) =>
  hostsWhere(root.root, (node) => node.props.role === 'alert');

const retryOf = (alert: ReactTestInstance) =>
  hostsWhere(alert, (node) => node.type === 'button' && textOf(node) === 'connectPage.read.retry');

describe('the activities page when the phone cannot answer', () => {
  it('shows an alert with a retry and no zero count when every read fails', async () => {
    const { root } = await mount(FAILED);
    expect(counts(root)).toEqual([]);
    expect(alerts(root).length).toBeGreaterThan(0);
    expect(alerts(root).flatMap(retryOf).length).toBeGreaterThan(0);
    root.unmount();
  });

  it('asks the phone for the first page again when the retry is pressed', async () => {
    const { root, stand } = await mount(FAILED);
    const before = stand.callsOf('feed.page').length;
    const [retry] = alerts(root).flatMap(retryOf);
    await act(async () => {
      retry!.props.onClick();
    });
    await settle();
    expect(stand.callsOf('feed.page').length).toBeGreaterThan(before);
    root.unmount();
  });

  it('shows a loading state and no zero count while the first page is on its way', async () => {
    const { root } = await mount((method) => (method === 'feed.page' ? NEVER() : undefined));
    expect(counts(root)).toEqual([]);
    expect(
      hostsWhere(root.root, (node) => node.props['aria-busy'] === 'true').length
    ).toBeGreaterThan(0);
    root.unmount();
  });

  it('keeps the zero counts of an answered empty library', async () => {
    const { root } = await mount((method) => (method === 'feed.page' ? EMPTY_LIBRARY : undefined));
    expect(alerts(root)).toEqual([]);
    expect(counts(root)).toEqual(expect.arrayContaining([' 0']));
    root.unmount();
  });
});
