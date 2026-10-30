import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SectionHistoryPanel } from '@/features/routes/components/section/SectionHistoryPanel';
import { NO_EVENT_DETAILS } from '@/features/routes/lib/sectionLedger';
import type { FfiChangeReason, FfiSectionChangeSummary, FfiSectionEventDetails } from 'veloqrs';
import { router } from 'expo-router';
import { MapSheetCardContext, type MapSheetCardValue } from '@/shared/app/MapSheetHost';
import { openHost, useMapSheetHosts } from '@/shared/app/mapSheetHost';

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key,
  }),
}));

let mockMetric = true;
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useMetricSystem: () => mockMetric,
}));

/** A ledger row's details, with only the fields the case names. */
const details = (fields: Partial<FfiSectionEventDetails>): FfiSectionEventDetails => ({
  ...NO_EVENT_DETAILS,
  ...fields,
});

const history = [
  {
    id: 2,
    at: '2026-08-20 00:00:00',
    kind: 'recut',
    details: details({
      around: ['act_a', 'act_b'],
      forkAround: ['act_f'],
    }),
    geometryVersion: 2,
  },
  {
    id: 3,
    at: '2026-08-21 00:00:00',
    kind: 'pr_rebased',
    details: details({ prFrom: 400, prTo: 520 }),
    geometryVersion: null,
  },
  { id: 1, at: '2026-08-01 00:00:00', kind: 'formed', details: undefined, geometryVersion: 1 },
];

const recordsRow = (id: number, records: FfiSectionChangeSummary['records']) => ({
  id,
  at: '2026-09-29 00:00:00',
  kind: 'recut',
  details: details({ summary: { records } }),
  geometryVersion: 3,
});
const versions = [
  { version: 2, createdAt: '2026-08-20', milestone: false, pinned: false },
  { version: 1, createdAt: '2026-08-01', milestone: true, pinned: false },
];

async function renderPanel(
  overrides: Partial<React.ComponentProps<typeof SectionHistoryPanel>> = {}
) {
  const props = {
    isDark: false,
    history,
    versions,
    pinnedVersion: null,
    shownVersion: null,
    onShowVersion: jest.fn(),
    onRevert: jest.fn(),
    onUnpin: jest.fn(),
    ...overrides,
  };
  return { ...(await render(<SectionHistoryPanel {...props} />)), props };
}

describe('SectionHistoryPanel', () => {
  it('titles the panel as a heading', async () => {
    const { getByRole } = await renderPanel();
    expect(getByRole('header', { name: 'sectionHistory.title' })).toBeTruthy();
  });

  it('renders every change with its context and the re-based record', async () => {
    const { getByTestId, getByText, queryByTestId } = await renderPanel();
    expect(getByTestId('section-history-event-recut')).toBeTruthy();
    expect(getByTestId('section-history-event-formed')).toBeTruthy();
    expect(getByText('sectionHistory.kind_recut')).toBeTruthy();
    expect(getByText('sectionHistory.prMoved:6:40,8:40')).toBeTruthy();
    expect(getByTestId('section-history-around-2-act_a')).toBeTruthy();
    expect(queryByTestId('section-history-fork-2-act_f')).toBeNull();
  });

  it('draws a record only where it moved, with its sport and direction', async () => {
    const { getByText, queryByText } = await renderPanel({
      history: [
        recordsRow(5, [
          { sport: 'Run', from: 250, to: 240 },
          { sport: 'Ride', direction: 'reverse', from: 200, to: 190 },
        ]),
        recordsRow(6, []),
      ],
    });
    expect(getByText('activityTypes.Run:Run · sectionHistory.prMoved:4:10,4:00')).toBeTruthy();
    expect(
      getByText('activityTypes.Ride:Ride · sections.reverse · sectionHistory.prMoved:3:20,3:10')
    ).toBeTruthy();
    expect(queryByText(/prEra/)).toBeNull();
  });

  it('draws a rebased record on its own row only when no re-cut took it', async () => {
    const rebased = (id: number, foldedInto?: number) => ({
      id,
      at: '2026-10-02 00:00:00',
      kind: 'pr_rebased',
      details: details({
        prFrom: 600,
        prTo: 580,
        ...(foldedInto == null ? {} : { summary: { records: [], foldedInto } }),
      }),
      geometryVersion: null,
    });
    const { getAllByText } = await renderPanel({ history: [rebased(8), rebased(9, 7)] });
    expect(getAllByText('sectionHistory.prMoved:10:00,9:40')).toHaveLength(1);
  });

  it('opens the activity a chip names', async () => {
    const { getByTestId } = await renderPanel();
    await fireEvent.press(getByTestId('section-history-around-2-act_b'));
    expect(router.push).toHaveBeenCalledWith('/activity/act_b');
  });

  it('reverts a stored version and shows it on the map', async () => {
    const { getByTestId, queryByTestId, props } = await renderPanel();
    expect(queryByTestId('section-version-2-revert')).toBeNull();
    await fireEvent.press(getByTestId('section-version-1-revert'));
    expect(props.onRevert).toHaveBeenCalledWith(1);
    await fireEvent.press(getByTestId('section-version-1-show'));
    expect(props.onShowVersion).toHaveBeenCalledWith(1);
  });

  it('offers unpin only when pinned, and never a revert onto the pin', async () => {
    const { queryByTestId } = await renderPanel();
    expect(queryByTestId('section-history-unpin')).toBeNull();
    const pinned = await renderPanel({ pinnedVersion: 1 });
    await fireEvent.press(pinned.getByTestId('section-history-unpin'));
    expect(pinned.props.onUnpin).toHaveBeenCalled();
    expect(pinned.queryByTestId('section-version-1-revert')).toBeNull();
    expect(pinned.getByTestId('section-version-2-revert')).toBeTruthy();
  });

  it('says so when nothing is recorded', async () => {
    const { getByTestId } = await renderPanel({ history: [], versions: [] });
    expect(getByTestId('empty-state-title').props.children).toBe('sectionHistory.empty');
  });

  it('shows a translated line for a reference_anchored event, by whether the line moved', async () => {
    const event = (id: number, moved: boolean) => ({
      id,
      at: '2026-08-23 00:00:00',
      kind: 'reference_anchored',
      details: details({ moved }),
      geometryVersion: 2,
    });
    const { getByText, queryByText } = await renderPanel({
      history: [event(6, true), event(7, false)],
    });

    expect(getByText('sectionHistory.kind_reference_anchored')).toBeTruthy();
    expect(getByText('sectionHistory.kind_reference_anchored_in_place')).toBeTruthy();
    expect(queryByText('reference_anchored')).toBeNull();
  });

  it('links a split child to its named parent', async () => {
    const { getByTestId, getByText } = await renderPanel({
      history: [
        {
          id: 4,
          at: '2026-08-21 00:00:00',
          kind: 'formed',
          details: details({
            splitFrom: { id: 'parent', name: 'Col de la Croix', available: true },
          }),
          geometryVersion: 1,
        },
      ],
    });

    expect(getByText('sectionHistory.splitFrom')).toBeTruthy();
    const link = getByTestId('section-history-split-from-parent');
    expect(link).toHaveTextContent('Col de la Croix');
    await fireEvent.press(link);
    expect(router.push).toHaveBeenCalledWith('/section/parent');
  });

  it('links every split child using the engine display name, including nested names', async () => {
    const { getByTestId, getByText } = await renderPanel({
      history: [
        {
          id: 5,
          at: '2026-08-22 00:00:00',
          kind: 'split',
          details: details({
            siblings: ['child-1', 'child-2'],
            splitInto: [
              { id: 'child-1', name: 'Col de la Croix / 1', available: true },
              { id: 'child-2', name: 'Col de la Croix / 1 / 2', available: true },
            ],
          }),
          geometryVersion: null,
        },
      ],
    });

    expect(getByText('sectionHistory.splitInto')).toBeTruthy();
    expect(getByTestId('section-history-split-into-child-1')).toHaveTextContent(
      'Col de la Croix / 1'
    );
    const nested = getByTestId('section-history-split-into-child-2');
    expect(nested).toHaveTextContent('Col de la Croix / 1 / 2');
    await fireEvent.press(nested);
    expect(router.push).toHaveBeenCalledWith('/section/child-2');
  });

  it('shows an unavailable split target without navigation', async () => {
    const { getByTestId } = await renderPanel({
      history: [
        {
          id: 6,
          at: '2026-08-23 00:00:00',
          kind: 'formed',
          details: details({ splitFrom: { id: 'retired-parent', available: false } }),
          geometryVersion: 1,
        },
      ],
    });

    const target = getByTestId('section-history-split-from-retired-parent');
    expect(target).toHaveTextContent('sectionHistory.unavailable');
    await fireEvent.press(target);
    expect(router.push).not.toHaveBeenCalledWith('/section/retired-parent');
  });
});

/**
 * Scenario: the chips under a change name the traversals that were around it.
 *
 * Expected behaviour: each chip draws the activity's name. The id is what the
 * engine keys on, not something an athlete can read, so it is the fallback and
 * not the label.
 */
describe('the activity chips', () => {
  it('draws the name when the engine knows one', async () => {
    const { getByTestId } = await renderPanel({
      activityNames: { act_a: 'Sunday hills', act_b: 'Commute home' },
    });

    expect(getByTestId('section-history-around-2-act_a')).toHaveTextContent('Sunday hills');
    expect(getByTestId('section-history-around-2-act_b')).toHaveTextContent('Commute home');
  });

  it('falls back to the id for an activity it has no name for', async () => {
    const { getByTestId } = await renderPanel({ activityNames: { act_a: 'Sunday hills' } });

    expect(getByTestId('section-history-around-2-act_b')).toHaveTextContent('act_b');
  });

  it('falls back to the id when no names were passed at all', async () => {
    const { getByTestId } = await renderPanel();

    expect(getByTestId('section-history-around-2-act_a')).toHaveTextContent('act_a');
  });

  it('treats a blank name as no name', async () => {
    const { getByTestId } = await renderPanel({ activityNames: { act_a: '   ' } });

    expect(getByTestId('section-history-around-2-act_a')).toHaveTextContent('act_a');
  });

  it('still navigates by id, whatever the chip says', async () => {
    const { getByTestId } = await renderPanel({ activityNames: { act_a: 'Sunday hills' } });

    await fireEvent.press(getByTestId('section-history-around-2-act_a'));

    expect(router.push).toHaveBeenCalledWith('/activity/act_a');
  });
});

/**
 * Scenario: the panel's small actions each drew a pill of their own, with a glyph picked by hand.
 *
 * Expected behaviour: each is the shared small Button, which draws its own label and glyph, and
 * a screen reader reaches it as a button by its name.
 */
describe('SectionHistoryPanel actions', () => {
  it('draws unpin, show and revert as Buttons named by their labels', async () => {
    const { getByTestId, getByRole } = await renderPanel({ pinnedVersion: 2 });
    expect(getByTestId('section-history-unpin-label')).toHaveTextContent('sectionHistory.unpin');
    expect(getByRole('button', { name: 'sectionHistory.unpin' })).toBe(
      getByTestId('section-history-unpin')
    );
    expect(getByTestId('section-version-1-show-label')).toHaveTextContent(
      'sectionHistory.showOnMap'
    );
    expect(getByTestId('section-version-1-revert-label')).toHaveTextContent(
      'sectionHistory.revert'
    );
    expect(getByRole('button', { name: 'sectionHistory.revertVersion:1' })).toBe(
      getByTestId('section-version-1-revert')
    );
  });

  it('draws each activity chip as a Button named by the activity', async () => {
    const { getByTestId, getByRole } = await renderPanel({
      activityNames: { act_a: 'Sunday hills' },
    });
    expect(getByTestId('section-history-around-2-act_a-label')).toHaveTextContent('Sunday hills');
    expect(getByRole('button', { name: 'Sunday hills' })).toBe(
      getByTestId('section-history-around-2-act_a')
    );
  });
});

describe('one headline and one reason per change', () => {
  const summaryEvent = (
    id: number,
    kind: string,
    summary: Partial<FfiSectionChangeSummary>,
    fields: Partial<FfiSectionEventDetails> = {}
  ) => ({
    id,
    at: '2026-10-10 00:00:00',
    kind,
    details: details({ summary: { records: [], ...summary }, ...fields }),
    geometryVersion: 2,
  });
  const reason = (fields: Partial<FfiChangeReason>): FfiChangeReason => ({
    kind: 'traffic_cliff',
    ...fields,
  });

  it('words a lengthened end with the engine counts and no long sentence', async () => {
    const { getByText, queryByText } = await renderPanel({
      history: [
        summaryEvent(9, 'recut', {
          moved: 'end',
          lengthBefore: 1240,
          lengthAfter: 1480,
          reason: reason({ count: 11, of: 15 }),
        }),
      ],
    });
    expect(getByText('sectionHistory.headline_longer_end:1.2 km,1.5 km')).toBeTruthy();
    expect(
      getByText('sectionHistory.reason_traffic_cliff_end:11,15,sectionHistory.pairUnnamed')
    ).toBeTruthy();
    expect(queryByText(/boundaries|forkAround|prEra|cut_/)).toBeNull();
  });

  it('words a shortened start and a change at both ends', async () => {
    const { getByText } = await renderPanel({
      history: [
        summaryEvent(10, 'recut', {
          moved: 'start',
          lengthBefore: 2000,
          lengthAfter: 1500,
          reason: reason({ kind: 'usage_change', count: 9, of: 12 }),
        }),
        summaryEvent(11, 'recut', { moved: 'both', lengthBefore: 1000, lengthAfter: 1300 }),
      ],
    });
    expect(getByText('sectionHistory.headline_shorter_start:2.0 km,1.5 km')).toBeTruthy();
    expect(
      getByText('sectionHistory.reason_usage_change_start:9,12,sectionHistory.pairUnnamed')
    ).toBeTruthy();
    expect(getByText('sectionHistory.headline_longer_both:1.0 km,1.3 km')).toBeTruthy();
  });

  it('names the neighbour a fork leads onto and the metres a seam clip took', async () => {
    const link = { id: 's2', name: 'Col X', available: true };
    const { getByText } = await renderPanel({
      history: [
        summaryEvent(12, 'recut', {
          moved: 'end',
          lengthBefore: 1000,
          lengthAfter: 1400,
          reason: reason({ kind: 'fork', count: 8, of: 14, neighbour: link }),
        }),
        summaryEvent(13, 'recut', {
          moved: 'end',
          lengthBefore: 1000,
          lengthAfter: 960,
          reason: reason({ kind: 'seam_clip', metres: 40, neighbour: link }),
        }),
      ],
    });
    expect(getByText('sectionHistory.reason_fork_end:8,14,Col X')).toBeTruthy();
    expect(getByText('sectionHistory.reason_seam_clip_end:40 m,Col X')).toBeTruthy();
  });

  it('words a split by where it was cut and, for a fork, where the rides turn', async () => {
    const { getByText } = await renderPanel({
      history: [
        summaryEvent(14, 'split', {
          moved: 'split',
          atMetres: 1200,
          reason: reason({
            kind: 'fork',
            count: 8,
            of: 14,
            neighbour: { id: 'y', name: 'Col Y', available: true },
          }),
        }),
        summaryEvent(15, 'split', { moved: 'split', atMetres: 900 }),
      ],
    });
    expect(getByText('sectionHistory.headline_split_fork:1.2 km,8,14,Col Y')).toBeTruthy();
    expect(getByText('sectionHistory.headline_split_at:900 m')).toBeTruthy();
  });

  it('draws a rename with no reason, and a baseline as one muted line', async () => {
    const { getByTestId, queryByTestId, getByText } = await renderPanel({
      history: [
        summaryEvent(16, 'renamed', {}),
        summaryEvent(17, 'baseline', {}),
        summaryEvent(18, 'algorithm_changed', {}),
      ],
    });
    expect(getByText('sectionHistory.kind_renamed')).toBeTruthy();
    expect(queryByTestId('section-history-reason-16')).toBeNull();
    expect(getByTestId('section-history-event-baseline')).toBeTruthy();
    expect(getByText('sectionHistory.kind_baseline')).toBeTruthy();
    expect(getByText('sectionHistory.kind_algorithm_changed')).toBeTruthy();
    expect(queryByTestId('section-history-reason-17')).toBeNull();
    expect(queryByTestId('section-history-reason-18')).toBeNull();
  });

  it('draws no reason for a kind this build cannot word, never its tag', async () => {
    const { queryByTestId, queryByText } = await renderPanel({
      history: [
        summaryEvent(19, 'recut', {
          moved: 'end',
          lengthBefore: 1000,
          lengthAfter: 1100,
          reason: reason({ kind: 'a_future_reason', count: 1, of: 2 }),
        }),
        summaryEvent(20, 'recut', {
          moved: 'end',
          lengthBefore: 1000,
          lengthAfter: 1100,
          reason: reason({ kind: 'seam_clip' }),
        }),
      ],
    });
    expect(queryByTestId('section-history-reason-19')).toBeNull();
    expect(queryByTestId('section-history-reason-20')).toBeNull();
    expect(queryByText(/a_future_reason/)).toBeNull();
  });

  it('draws the units the athlete reads', async () => {
    mockMetric = false;
    try {
      const { getByText } = await renderPanel({
        history: [
          summaryEvent(21, 'recut', {
            moved: 'end',
            lengthBefore: 1000,
            lengthAfter: 1100,
            reason: reason({ kind: 'seam_clip', metres: 120 }),
          }),
        ],
      });
      expect(getByText(/reason_seam_clip_end:394 ft/)).toBeTruthy();
    } finally {
      mockMetric = true;
    }
  });

  it('says how many rides followed the change and draws three chips and a count', async () => {
    const { getByText, getByTestId, queryByTestId } = await renderPanel({
      history: [summaryEvent(22, 'recut', {}, { around: ['r1', 'r2', 'r3', 'r4'] })],
    });
    expect(getByText('sectionHistory.ridesAfter:4')).toBeTruthy();
    expect(getByTestId('section-history-around-22-r3')).toBeTruthy();
    expect(queryByTestId('section-history-around-22-r4')).toBeNull();
    expect(getByText('+1')).toBeTruthy();
  });

  it('counts the rides of a new section', async () => {
    const { getByText } = await renderPanel({
      history: [summaryEvent(23, 'formed', {}, { around: ['r1', 'r2'] })],
    });
    expect(getByText('sectionHistory.headline_formed:2')).toBeTruthy();
  });
});

describe('SectionHistoryPanel inside a map sheet card', () => {
  const splitFromParent = [
    {
      id: 4,
      at: '2026-08-21 00:00:00',
      kind: 'formed',
      details: details({
        splitFrom: { id: 'parent', name: 'Col de la Croix', available: true },
        around: ['act_b'],
      }),
      geometryVersion: 1,
    },
  ];

  async function renderInCard() {
    useMapSheetHosts.setState({ hosts: {} });
    const hostKey = openHost('section', 'child');
    const card: MapSheetCardValue = {
      hostKey,
      index: 0,
      onTop: true,
      opens: (kind) => kind === 'section',
    };
    const view = await render(
      <MapSheetCardContext.Provider value={card}>
        <SectionHistoryPanel
          isDark={false}
          history={splitFromParent}
          versions={versions}
          pinnedVersion={null}
          shownVersion={null}
          onShowVersion={jest.fn()}
          onRevert={jest.fn()}
          onUnpin={jest.fn()}
        />
      </MapSheetCardContext.Provider>
    );
    return { ...view, hostKey };
  }

  beforeEach(() => jest.mocked(router.push).mockClear());

  it('opens a linked section as a card in the same sheet and pushes no screen', async () => {
    const { getByTestId, hostKey } = await renderInCard();

    await fireEvent.press(getByTestId('section-history-split-from-parent'));

    expect(router.push).not.toHaveBeenCalled();
    expect(
      useMapSheetHosts.getState().hosts[hostKey]?.cards.map((card) => `${card.kind}:${card.id}`)
    ).toEqual(['section:child', 'section:parent']);
  });

  it('opens an activity, which has no card here, as its own screen', async () => {
    const { getByTestId, hostKey } = await renderInCard();

    await fireEvent.press(getByTestId('section-history-around-4-act_b'));

    expect(router.push).toHaveBeenCalledWith('/activity/act_b');
    expect(useMapSheetHosts.getState().hosts[hostKey]?.cards).toHaveLength(1);
  });
});
