import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SectionHistoryPanel } from '@/features/routes/components/section/SectionHistoryPanel';
import { NO_EVENT_DETAILS } from '@/features/routes/lib/sectionLedger';
import type { FfiBoundaryReason, FfiSectionEventDetails } from 'veloqrs';
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
      prs: [{ time: 400 }],
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

const perSportHistory = [
  {
    id: 5,
    at: '2026-09-29 00:00:00',
    kind: 'dissolved',
    details: details({
      prs: [
        { sport: 'Ride', time: 65 },
        { sport: 'Run', time: 250 },
      ],
    }),
    geometryVersion: null,
  },
  {
    id: 6,
    at: '2026-09-30 00:00:00',
    kind: 'pr_rebased',
    details: details({ prSport: 'Run', prFrom: 250, prTo: 240 }),
    geometryVersion: null,
  },
];
const perDirectionHistory = [
  {
    id: 7,
    at: '2026-10-01 00:00:00',
    kind: 'recut',
    details: details({
      prs: [
        { sport: 'Ride', direction: 'reverse', time: 200 },
        { sport: 'Ride', direction: 'same', time: 580 },
      ],
    }),
    geometryVersion: 3,
  },
  {
    id: 8,
    at: '2026-10-02 00:00:00',
    kind: 'pr_rebased',
    details: details({ prSport: 'Ride', prDirection: 'same', prFrom: 600, prTo: 580 }),
    geometryVersion: null,
  },
];
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
    const { getByTestId, getByText } = await renderPanel();
    expect(getByTestId('section-history-event-recut')).toBeTruthy();
    expect(getByTestId('section-history-event-formed')).toBeTruthy();
    expect(getByText('sectionHistory.kind_recut')).toBeTruthy();
    expect(getByText('sectionHistory.prEra:6:40')).toBeTruthy();
    expect(getByText('sectionHistory.prMoved:6:40,8:40')).toBeTruthy();
    expect(getByTestId('section-history-around-2-act_a')).toBeTruthy();
    expect(getByTestId('section-history-fork-2-act_f')).toBeTruthy();
  });

  it('names the sport of each era record and of a record that moved', async () => {
    const { getByText } = await renderPanel({ history: perSportHistory });
    expect(getByText('activityTypes.Ride:Ride · sectionHistory.prEra:1:05')).toBeTruthy();
    expect(getByText('activityTypes.Run:Run · sectionHistory.prEra:4:10')).toBeTruthy();
    expect(getByText('activityTypes.Run:Run · sectionHistory.prMoved:4:10,4:00')).toBeTruthy();
  });

  it('names the direction of each era record and of a record that moved', async () => {
    const { getByText, queryByText } = await renderPanel({ history: perDirectionHistory });
    expect(
      getByText('activityTypes.Ride:Ride · sections.reverse · sectionHistory.prEra:3:20')
    ).toBeTruthy();
    expect(
      getByText('activityTypes.Ride:Ride · sections.forward · sectionHistory.prEra:9:40')
    ).toBeTruthy();
    expect(
      getByText('activityTypes.Ride:Ride · sections.forward · sectionHistory.prMoved:10:00,9:40')
    ).toBeTruthy();
    expect(queryByText('activityTypes.Ride:Ride · sectionHistory.prEra:3:20')).toBeNull();
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

    expect(getByTestId('section-history-fork-2-act_f')).toHaveTextContent('act_f');
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

describe('why the line was cut', () => {
  const cutEvent = (id: number, kind: string, boundaries: FfiBoundaryReason[]) => ({
    id,
    at: '2026-10-10 00:00:00',
    kind,
    details: details({ boundaries }),
    geometryVersion: 2,
  });

  it('gives one sentence per reason the detector recorded on the change', async () => {
    const { getByTestId, getByText } = await renderPanel({
      history: [
        cutEvent(9, 'recut', [
          { kind: 'fork' },
          { kind: 'seam_clip', clippedMetres: 120 },
          { kind: 'traffic_cliff' },
        ]),
      ],
    });
    const reasons = getByTestId('section-history-boundaries-9');
    expect(reasons).toBeTruthy();
    expect(getByText('sectionHistory.boundaries')).toBeTruthy();
    expect(getByText('sectionHistory.cut_fork')).toBeTruthy();
    expect(getByText('sectionHistory.cut_seam_clip:120 m')).toBeTruthy();
    expect(getByText('sectionHistory.cut_traffic_cliff')).toBeTruthy();
  });

  it('words every cut reason the engine writes on a formed, split or recut change', async () => {
    const kinds = [
      'usage_change',
      'fork',
      'traffic_cliff',
      'trim',
      'low_support',
      'terminus',
      'pass_end',
    ];
    const { getByText } = await renderPanel({
      history: [
        cutEvent(
          10,
          'formed',
          kinds.map((kind) => ({ kind }))
        ),
        cutEvent(11, 'split', [{ kind: 'seam_clip', clippedMetres: 40 }]),
      ],
    });
    for (const kind of kinds) expect(getByText(`sectionHistory.cut_${kind}`)).toBeTruthy();
    expect(getByText('sectionHistory.cut_seam_clip:40 m')).toBeTruthy();
  });

  it('gives a seam clip in the units the athlete reads', async () => {
    mockMetric = false;
    try {
      const { getByText } = await renderPanel({
        history: [cutEvent(17, 'recut', [{ kind: 'seam_clip', clippedMetres: 120 }])],
      });
      expect(getByText('sectionHistory.cut_seam_clip:394 ft')).toBeTruthy();
    } finally {
      mockMetric = true;
    }
  });

  it('draws a change that recorded no reason as a change with no reason', async () => {
    const { getByTestId, queryByTestId, queryByText } = await renderPanel({
      history: [
        cutEvent(12, 'baseline', []),
        { ...cutEvent(13, 'formed', []), details: undefined },
      ],
    });
    expect(getByTestId('section-history-event-baseline')).toBeTruthy();
    expect(queryByTestId('section-history-boundaries-12')).toBeNull();
    expect(queryByTestId('section-history-boundaries-13')).toBeNull();
    expect(queryByText('sectionHistory.boundaries')).toBeNull();
  });

  it('draws nothing for a reason this build cannot word, never its tag', async () => {
    const { queryByTestId, queryByText, getByText } = await renderPanel({
      history: [
        cutEvent(14, 'recut', [{ kind: 'a_future_reason' }]),
        cutEvent(15, 'recut', [
          { kind: 'a_future_reason' },
          { kind: 'seam_clip' },
          { kind: 'trim' },
        ]),
      ],
    });
    expect(queryByTestId('section-history-boundaries-14')).toBeNull();
    expect(queryByText('a_future_reason')).toBeNull();
    expect(queryByText(/cut_seam_clip/)).toBeNull();
    expect(getByText('sectionHistory.cut_trim')).toBeTruthy();
  });

  it('says a reason recorded at both ends of the line once', async () => {
    const { getAllByText } = await renderPanel({
      history: [cutEvent(16, 'recut', [{ kind: 'fork' }, { kind: 'fork' }])],
    });
    expect(getAllByText('sectionHistory.cut_fork')).toHaveLength(1);
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
