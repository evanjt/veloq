import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SectionHistoryPanel } from '@/features/routes/components/section/SectionHistoryPanel';
import { router } from 'expo-router';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-i18next', () => ({
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
});
