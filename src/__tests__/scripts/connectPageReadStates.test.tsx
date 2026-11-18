/**
 * Scenario: a panel's read fails, is still on its way, is unsupported by the
 * phone, or answers with nothing to draw.
 *
 * Expected behaviour: each state is drawn by the shared state components. A
 * failed read is an alert with a retry, a read on its way is a skeleton, an
 * unsupported method and an empty answer are status states, and none is drawn
 * as a bare notice or empty line.
 */

import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { Calendar } from '../../../web/connect/charts/Calendar';
import { Chart } from '../../../web/connect/charts/Chart';
import { Curve } from '../../../web/connect/charts/Curve';
import { Histogram } from '../../../web/connect/charts/Histogram';
import { FitnessPage } from '../../../web/connect/pages/Dashboard';
import { parse } from '../../../web/connect/router';
import { ReadError } from '../../../web/connect/query';
import type { Session, Snapshot } from '../../../web/connect/session';
import { Reading, ReadNotice } from '../../../web/connect/shell/StatePanes';
import { fakePhone } from '../__shared__/connectPhone';
import { demoScript } from '../__shared__/connectDemoLibrary';
import { answerAsk } from '../__shared__/connectPhoneShim';

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en-GB' } }),
}));

async function mount(element: React.ReactElement) {
  let root!: ReactTestRenderer;
  await act(async () => {
    root = create(element);
  });
  for (let at = 0; at < 6; at += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  return root;
}

const classes = (node: ReactTestInstance) => String(node.props.className ?? '').split(' ');
const withClass = (root: ReactTestRenderer, name: string) =>
  root.root.findAll((node) => typeof node.type === 'string' && classes(node).includes(name));
const withRole = (root: ReactTestRenderer, role: string) =>
  root.root.findAll((node) => typeof node.type === 'string' && node.props.role === role);
const bareLines = (root: ReactTestRenderer) =>
  root.root.findAll(
    (node) =>
      node.type === 'p' && (classes(node).includes('notice') || classes(node).includes('empty'))
  );
const retries = (root: ReactTestRenderer) => root.root.findAllByType('button');

describe('a read that failed', () => {
  it.each([
    ['timeout', 'connectPage.read.timeout'],
    ['failed', 'connectPage.read.failed'],
  ] as const)('is an alert with a retry when it %s', async (kind, wording) => {
    const retry = jest.fn();
    const root = await mount(<ReadNotice error={new ReadError(kind, 'x')} onRetry={retry} />);
    expect(withRole(root, 'alert')).toHaveLength(1);
    expect(JSON.stringify(root.toJSON())).toContain(wording);
    expect(retries(root)).toHaveLength(1);
    act(() => retries(root)[0]!.props.onClick());
    expect(retry).toHaveBeenCalledTimes(1);
    expect(bareLines(root)).toHaveLength(0);
  });

  it('is an alert without a retry when nothing can ask again', async () => {
    const root = await mount(<ReadNotice error={new ReadError('failed', 'x')} />);
    expect(withRole(root, 'alert')).toHaveLength(1);
    expect(retries(root)).toHaveLength(0);
  });

  it('is an update notice, not an alert, when the phone lacks the method', async () => {
    const root = await mount(<ReadNotice error={new ReadError('unsupported', 'x')} />);
    expect(withRole(root, 'alert')).toHaveLength(0);
    expect(withClass(root, 'ui-state')).toHaveLength(1);
    expect(
      root.root.findAll((node) => node.props['data-read-error'] === 'unsupported')
    ).not.toHaveLength(0);
    expect(bareLines(root)).toHaveLength(0);
  });
});

describe('a read through Reading', () => {
  const answer = () => <span id="answer">here</span>;

  it('is a skeleton while it is on its way', async () => {
    const root = await mount(
      <Reading read={{ data: undefined, error: null, loading: true, refreshing: false }}>
        {answer}
      </Reading>
    );
    expect(withClass(root, 'ui-skeleton')).toHaveLength(1);
    expect(bareLines(root)).toHaveLength(0);
  });

  it('is an alert with a retry when it failed with nothing held', async () => {
    const root = await mount(
      <Reading
        read={{
          data: undefined,
          error: new ReadError('failed', 'x'),
          loading: false,
          refreshing: false,
          retry: () => undefined,
        }}
      >
        {answer}
      </Reading>
    );
    expect(withRole(root, 'alert')).toHaveLength(1);
    expect(retries(root)).toHaveLength(1);
  });

  it('keeps the held answer beside the alert when a refresh failed', async () => {
    const root = await mount(
      <Reading
        read={{
          data: 1,
          error: new ReadError('failed', 'x'),
          loading: false,
          refreshing: false,
          retry: () => undefined,
        }}
      >
        {answer}
      </Reading>
    );
    expect(withRole(root, 'alert')).toHaveLength(1);
    expect(root.root.findAll((node) => node.props.id === 'answer')).toHaveLength(1);
  });
});

describe('a chart with nothing to draw', () => {
  it.each([
    [
      'a line chart',
      <Curve
        key="c"
        xs={[]}
        ys={[]}
        xTicks={[]}
        xFormat={String}
        yFormat={String}
        xTitle="x"
        yTitle="y"
        colour="red"
        empty="nothing"
        label="c"
        readout={String}
      />,
    ],
    [
      'a histogram',
      <Histogram
        key="h"
        values={[]}
        format={String}
        count={String}
        binText={String}
        xTitle="x"
        yTitle="y"
        colour="red"
        empty="nothing"
        label="h"
      />,
    ],
    [
      'a calendar',
      <Calendar key="k" days={[]} dayText={String} label="k" empty="nothing" width={400} />,
    ],
  ])('says so through the empty state in %s', async (_name, chart) => {
    const root = await mount(chart);
    expect(withClass(root, 'ui-state')).toHaveLength(1);
    expect(JSON.stringify(root.toJSON())).toContain('nothing');
    expect(bareLines(root)).toHaveLength(0);
  });

  it('says so through the empty state in a bar chart', async () => {
    const root = await mount(
      <Chart
        kind="bar"
        categories={[]}
        series={[]}
        format={String}
        label="b"
        empty="nothing"
        none="-"
      />
    );
    expect(withClass(root, 'ui-state')).toHaveLength(1);
    expect(bareLines(root)).toHaveLength(0);
  });
});

describe('the fitness page against a phone whose reads all fail', () => {
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {
      location: { hash: '#/fitness', assign: () => undefined },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('draws an alert with a retry for each panel and no bare line', async () => {
    const phone = fakePhone(() => {
      throw new Error('the phone did not answer');
    });
    const snapshot = {
      libraryChanges: 0,
      state: { name: 'connected', methods: [] },
    } as unknown as Snapshot;
    const root = await mount(
      phone.wrap(
        <FitnessPage session={{} as Session} snapshot={snapshot} route={parse('#/fitness')} />
      )
    );
    expect(withRole(root, 'alert').length).toBeGreaterThan(0);
    expect(retries(root).length).toBeGreaterThan(0);
    expect(bareLines(root)).toHaveLength(0);
  });
});

describe('the fitness page against a phone whose wellness answer is missing a field', () => {
  const demo = demoScript({ browserFingerprint: 'b', phoneProof: 'p', phoneFingerprint: 'f' });
  const snapshot = {
    libraryChanges: 0,
    state: { name: 'connected', methods: [] },
  } as unknown as Snapshot;

  beforeEach(() => {
    (globalThis as { window?: unknown }).window = {
      location: { hash: '#/fitness', assign: () => undefined },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    jest.restoreAllMocks();
  });

  const idsOf = (root: ReactTestRenderer) =>
    root.root.findAll((node) => typeof node.type === 'string').map((node) => node.props.id);

  it('draws the failed state in the wellness panels and every other panel as usual', async () => {
    const phone = fakePhone((method, params) => {
      const answer = answerAsk(demo, method, params as Record<string, unknown>).result as Record<
        string,
        unknown
      >;
      if (method !== 'fitness.wellness') return answer;
      const { form: _form, ...without } = answer;
      return without;
    });
    const root = await mount(
      phone.wrap(
        <FitnessPage session={{} as Session} snapshot={snapshot} route={parse('#/fitness')} />
      )
    );
    const ids = idsOf(root);
    expect(ids).toContain('panel-wellness-chart');
    expect(ids).toContain('panel-screen-dots');
    expect(withRole(root, 'alert').length).toBeGreaterThan(0);
    expect(
      root.root.findAll((node) => node.props['data-read-error'] === 'failed')
    ).not.toHaveLength(0);
  });

  it('draws the tiles when the demo library answers the whole shape', async () => {
    const phone = fakePhone(
      (method, params) => answerAsk(demo, method, params as Record<string, unknown>).result
    );
    const root = await mount(
      phone.wrap(
        <FitnessPage session={{} as Session} snapshot={snapshot} route={parse('#/fitness')} />
      )
    );
    expect(idsOf(root)).toContain('fitness-tiles');
  });
});
