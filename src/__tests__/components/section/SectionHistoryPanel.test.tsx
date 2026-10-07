import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SectionHistoryPanel } from '@/features/routes/components/section/SectionHistoryPanel';
import { router } from 'expo-router';

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key,
  }),
}));

const history = [
  {
    id: 2,
    at: '2026-08-20 00:00:00',
    kind: 'recut',
    details: JSON.stringify({ pr_time: 400, around: ['act_a', 'act_b'], fork_around: ['act_f'] }),
    geometryVersion: 2,
  },
  {
    id: 3,
    at: '2026-08-21 00:00:00',
    kind: 'pr_rebased',
    details: JSON.stringify({ from_time: 400, to_time: 520 }),
    geometryVersion: null,
  },
  { id: 1, at: '2026-08-01 00:00:00', kind: 'formed', details: undefined, geometryVersion: 1 },
];

const perSportHistory = [
  {
    id: 5,
    at: '2026-09-29 00:00:00',
    kind: 'dissolved',
    details: JSON.stringify({
      prs: {
        Ride: { activity_id: 'b1', time: 65 },
        Run: { activity_id: 'r1', time: 250 },
      },
    }),
    geometryVersion: null,
  },
  {
    id: 6,
    at: '2026-09-30 00:00:00',
    kind: 'pr_rebased',
    details: JSON.stringify({ sport: 'Run', from_time: 250, to_time: 240 }),
    geometryVersion: null,
  },
];
const versions = [
  { version: 2, createdAt: '2026-08-20', milestone: false, pinned: false },
  { version: 1, createdAt: '2026-08-01', milestone: true, pinned: false },
];

function renderPanel(overrides: Partial<React.ComponentProps<typeof SectionHistoryPanel>> = {}) {
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
  return { ...render(<SectionHistoryPanel {...props} />), props };
}

describe('SectionHistoryPanel', () => {
  it('renders every change with its context and the re-based record', () => {
    const { getByTestId, getByText } = renderPanel();
    expect(getByTestId('section-history-event-recut')).toBeTruthy();
    expect(getByTestId('section-history-event-formed')).toBeTruthy();
    expect(getByText('sectionHistory.kind_recut')).toBeTruthy();
    expect(getByText('sectionHistory.prEra:6:40')).toBeTruthy();
    expect(getByText('sectionHistory.prMoved:6:40,8:40')).toBeTruthy();
    expect(getByTestId('section-history-around-2-act_a')).toBeTruthy();
    expect(getByTestId('section-history-fork-2-act_f')).toBeTruthy();
  });

  it('names the sport of each era record and of a record that moved', () => {
    const { getByText } = renderPanel({ history: perSportHistory });
    expect(getByText('activityTypes.Ride:Ride · sectionHistory.prEra:1:05')).toBeTruthy();
    expect(getByText('activityTypes.Run:Run · sectionHistory.prEra:4:10')).toBeTruthy();
    expect(getByText('activityTypes.Run:Run · sectionHistory.prMoved:4:10,4:00')).toBeTruthy();
  });

  it('opens the activity a chip names', () => {
    const { getByTestId } = renderPanel();
    fireEvent.press(getByTestId('section-history-around-2-act_b'));
    expect(router.push).toHaveBeenCalledWith('/activity/act_b');
  });

  it('reverts a stored version and shows it on the map', () => {
    const { getByTestId, queryByTestId, props } = renderPanel();
    expect(queryByTestId('section-version-2-revert')).toBeNull();
    fireEvent.press(getByTestId('section-version-1-revert'));
    expect(props.onRevert).toHaveBeenCalledWith(1);
    fireEvent.press(getByTestId('section-version-1-show'));
    expect(props.onShowVersion).toHaveBeenCalledWith(1);
  });

  it('offers unpin only when pinned, and never a revert onto the pin', () => {
    const { queryByTestId } = renderPanel();
    expect(queryByTestId('section-history-unpin')).toBeNull();
    const pinned = renderPanel({ pinnedVersion: 1 });
    fireEvent.press(pinned.getByTestId('section-history-unpin'));
    expect(pinned.props.onUnpin).toHaveBeenCalled();
    expect(pinned.queryByTestId('section-version-1-revert')).toBeNull();
    expect(pinned.getByTestId('section-version-2-revert')).toBeTruthy();
  });

  it('says so when nothing is recorded', () => {
    const { getByText } = renderPanel({ history: [], versions: [] });
    expect(getByText('sectionHistory.empty')).toBeTruthy();
  });

  it('names a ledger that could not be read rather than calling it empty', () => {
    const { getByTestId, queryByText } = renderPanel({
      history: [],
      versions: [],
      failureKey: 'engine.failure.database',
    });
    expect(getByTestId('section-history-failed').props.children).toBe('engine.failure.database');
    expect(queryByText('sectionHistory.empty')).toBeNull();
  });

  it('shows a translated line for a reference_anchored event, by whether the line moved', () => {
    const event = (id: number, moved: boolean) => ({
      id,
      at: '2026-08-23 00:00:00',
      kind: 'reference_anchored',
      details: JSON.stringify({ moved }),
      geometryVersion: 2,
      splitFrom: null,
      splitInto: [],
    });
    const { getByText, queryByText } = renderPanel({ history: [event(6, true), event(7, false)] });

    expect(getByText('sectionHistory.kind_reference_anchored')).toBeTruthy();
    expect(getByText('sectionHistory.kind_reference_anchored_in_place')).toBeTruthy();
    expect(queryByText('reference_anchored')).toBeNull();
  });

  it('links a split child to its named parent', () => {
    const { getByTestId, getByText } = renderPanel({
      history: [
        {
          id: 4,
          at: '2026-08-21 00:00:00',
          kind: 'formed',
          details: JSON.stringify({ split_from: 'parent' }),
          geometryVersion: 1,
          splitFrom: { id: 'parent', name: 'Col de la Croix', available: true },
          splitInto: [],
        },
      ],
    });

    expect(getByText('sectionHistory.splitFrom')).toBeTruthy();
    const link = getByTestId('section-history-split-from-parent');
    expect(link).toHaveTextContent('Col de la Croix');
    fireEvent.press(link);
    expect(router.push).toHaveBeenCalledWith('/section/parent');
  });

  it('links every split child using the engine display name, including nested names', () => {
    const { getByTestId, getByText } = renderPanel({
      history: [
        {
          id: 5,
          at: '2026-08-22 00:00:00',
          kind: 'split',
          details: JSON.stringify({ siblings: ['child-1', 'child-2'] }),
          geometryVersion: null,
          splitFrom: null,
          splitInto: [
            { id: 'child-1', name: 'Col de la Croix / 1', available: true },
            { id: 'child-2', name: 'Col de la Croix / 1 / 2', available: true },
          ],
        },
      ],
    });

    expect(getByText('sectionHistory.splitInto')).toBeTruthy();
    expect(getByTestId('section-history-split-into-child-1')).toHaveTextContent(
      'Col de la Croix / 1'
    );
    const nested = getByTestId('section-history-split-into-child-2');
    expect(nested).toHaveTextContent('Col de la Croix / 1 / 2');
    fireEvent.press(nested);
    expect(router.push).toHaveBeenCalledWith('/section/child-2');
  });

  it('shows an unavailable split target without navigation', () => {
    const { getByTestId } = renderPanel({
      history: [
        {
          id: 6,
          at: '2026-08-23 00:00:00',
          kind: 'formed',
          details: JSON.stringify({ split_from: 'retired-parent' }),
          geometryVersion: 1,
          splitFrom: { id: 'retired-parent', name: null, available: false },
          splitInto: [],
        },
      ],
    });

    const target = getByTestId('section-history-split-from-retired-parent');
    expect(target).toHaveTextContent('sectionHistory.unavailable');
    fireEvent.press(target);
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
  it('draws the name when the engine knows one', () => {
    const { getByTestId } = renderPanel({
      activityNames: { act_a: 'Sunday hills', act_b: 'Commute home' },
    });

    expect(getByTestId('section-history-around-2-act_a')).toHaveTextContent('Sunday hills');
    expect(getByTestId('section-history-around-2-act_b')).toHaveTextContent('Commute home');
  });

  it('falls back to the id for an activity it has no name for', () => {
    const { getByTestId } = renderPanel({ activityNames: { act_a: 'Sunday hills' } });

    expect(getByTestId('section-history-fork-2-act_f')).toHaveTextContent('act_f');
  });

  it('falls back to the id when no names were passed at all', () => {
    const { getByTestId } = renderPanel();

    expect(getByTestId('section-history-around-2-act_a')).toHaveTextContent('act_a');
  });

  it('treats a blank name as no name', () => {
    const { getByTestId } = renderPanel({ activityNames: { act_a: '   ' } });

    expect(getByTestId('section-history-around-2-act_a')).toHaveTextContent('act_a');
  });

  it('still navigates by id, whatever the chip says', () => {
    const { getByTestId } = renderPanel({ activityNames: { act_a: 'Sunday hills' } });

    fireEvent.press(getByTestId('section-history-around-2-act_a'));

    expect(router.push).toHaveBeenCalledWith('/activity/act_a');
  });
});
