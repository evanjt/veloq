import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SectionHistoryPanel } from '@/features/routes/components/section/SectionHistoryPanel';
import { NO_EVENT_DETAILS } from '@/features/routes/lib/sectionLedger';
import type { FfiSectionEventDetails } from 'veloqrs';
import { router } from 'expo-router';

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key,
  }),
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
    const { getByText } = await renderPanel({ history: [], versions: [] });
    expect(getByText('sectionHistory.empty')).toBeTruthy();
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
