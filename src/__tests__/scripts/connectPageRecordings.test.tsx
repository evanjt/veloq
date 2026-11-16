/**
 * Scenario: the athlete opens the recordings the phone holds, sees them in a
 * table, and opens one to read its facts and where its upload stands.
 *
 * Expected behaviour: the list draws one row per recording from the engine's
 * answer, names its sport and upload status through the app's names rather
 * than the raw keys, and orders by the hash's sort key; the detail draws the
 * provenance and the sport beneath no second page title, the stats from the
 * engine's record, and a status panel that says what the phone does next.
 */

import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { localDateTime } from '../../../web/connect/format';
import { RecordingPage } from '../../../web/connect/pages/Recording';
import { RecordingsPage } from '../../../web/connect/pages/Recordings';
import { demoResults } from '../__shared__/connectDemoLibrary';
import { fakePhone } from '../__shared__/connectPhone';

const DAY_MS = 86_400_000;

type Recording = (typeof DEMO)[number];

const DEMO = demoResults()['recordings.list'].recordings;

/** A recording the demo phone does not hold: an upload that failed, older than the rest. */
const FAILED: Recording = {
  ...DEMO[0],
  id: 'failed-ride',
  name: 'Harbour ride',
  uploadStatus: 'failed',
  lastError: 'intervals.icu timed out',
  startTime: DEMO[2].startTime - DAY_MS,
};

const EVERYTHING = [...DEMO, FAILED];

function fakeSession(list: Recording[] = EVERYTHING) {
  return fakePhone((method, params) => {
    switch (method) {
      case 'recordings.list':
        return { recordings: list };
      case 'recordings.get': {
        const id = (params as { id: string }).id;
        return { recording: list.find((row) => row.id === id) ?? null };
      }
      default:
        throw new Error(`unexpected read ${method}`);
    }
  });
}

async function settle() {
  for (let at = 0; at < 6; at += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mount(element: React.ReactElement) {
  let root!: ReactTestRenderer;
  await act(async () => {
    root = create(element);
  });
  await settle();
  return root;
}

const textOf = (node: ReturnType<ReactTestRenderer['root']['findAll']>[number]): string =>
  node.children
    .map((child) => (typeof child === 'string' ? child : textOf(child as never)))
    .join('');

const rowKeys = (root: ReactTestRenderer) =>
  root.root
    .findAll((node) => node.type === 'tr' && node.props['data-row'] !== undefined)
    .map((node) => node.props['data-row']);

const cellTexts = (root: ReactTestRenderer) =>
  root.root
    .findAll((node) => node.type === 'td' && node.props['data-row'] === undefined)
    .map((node) => textOf(node));

function route(
  screen: 'recordings' | 'recording',
  id: string | null = null,
  query: [string, string][] = []
) {
  return { screen, id, query } as never;
}

describe('the recordings list', () => {
  it('draws one row per recording, each named by a link to its page', async () => {
    const root = await mount(fakeSession().wrap(<RecordingsPage route={route('recordings')} />));
    expect(rowKeys(root)).toEqual(EVERYTHING.map((row) => row.id));
    const links = root.root
      .findAll((node) => node.type === 'a')
      .map((node) => [textOf(node), node.props.href]);
    expect(links).toContainEqual(['Morning ride', '#/recording/recording-1']);
    expect(links).toContainEqual(['Harbour ride', '#/recording/failed-ride']);
  });

  it('names the sport and the upload status through the app names, not the raw keys', async () => {
    const root = await mount(fakeSession().wrap(<RecordingsPage route={route('recordings')} />));
    const cells = cellTexts(root);
    expect(cells.some((cell) => /^\W*(pending|failed|uploaded)$/.test(cell))).toBe(false);
    expect(cells.some((cell) => cell.endsWith('recording.library.status.pending'))).toBe(true);
    expect(cells.some((cell) => cell.endsWith('recording.library.status.failed'))).toBe(true);
    expect(cells).toContain('Ride');
  });

  it('says the library is empty in place when the phone holds no recordings', async () => {
    const root = await mount(fakeSession([]).wrap(<RecordingsPage route={route('recordings')} />));
    expect(rowKeys(root)).toEqual([]);
    const text = textOf(root.root.findByProps({ id: 'recordings' }));
    expect(text).toContain('recording.library.empty');
  });

  it('orders by the sort key the hash holds', async () => {
    const sorted = route('recordings', null, [['sort-recordings', 'name:asc']]);
    const root = await mount(fakeSession().wrap(<RecordingsPage route={sorted} />));
    expect(rowKeys(root)).toEqual(['recording-2', 'recording-3', 'failed-ride', 'recording-1']);
  });
});

describe('the recording page', () => {
  it('draws the provenance, the started time and the sport, under no second page title', async () => {
    const root = await mount(
      fakeSession().wrap(<RecordingPage route={route('recording', 'recording-1')} />)
    );
    const titles = root.root.findAll((node) => node.type === 'h1' || node.type === 'h2');
    expect(titles).toHaveLength(0);
    const head = textOf(root.root.findByProps({ className: 'detail-head' }));
    expect(head).toContain('connectPage.recordings.provenance');
    expect(head).toContain(localDateTime(DEMO[0].startTime) ?? '');
    expect(head).toContain('Ride');
  });

  it('draws the distance and heart rate from the record in the stats', async () => {
    const root = await mount(
      fakeSession().wrap(<RecordingPage route={route('recording', 'recording-1')} />)
    );
    const stats = root.root.findAll((node) => node.type === 'dd').map((node) => textOf(node));
    expect(stats).toContain('38.0 km');
    expect(stats).toContain('138 bpm');
  });

  it('shows a failed upload with its error and what the phone does next', async () => {
    const root = await mount(
      fakeSession().wrap(<RecordingPage route={route('recording', 'failed-ride')} />)
    );
    const panel = textOf(root.root.findByProps({ id: 'recording-status' }));
    expect(panel).toContain('recording.library.status.failed');
    expect(panel).toContain('intervals.icu timed out');
    expect(panel).toContain('connectPage.recordings.next.failed');
    expect(panel).toContain('connectPage.recordings.phoneActions');
  });

  it('shows a waiting upload with the next step for a pending recording', async () => {
    const root = await mount(
      fakeSession().wrap(<RecordingPage route={route('recording', 'recording-3')} />)
    );
    const panel = textOf(root.root.findByProps({ id: 'recording-status' }));
    expect(panel).toContain('recording.library.status.pending');
    expect(panel).toContain('connectPage.recordings.next.pending');
  });
});
