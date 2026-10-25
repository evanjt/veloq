/**
 * Scenario: a cutover or a record restore archived sections that the new
 * detector no longer matches, and the athlete opens the feed.
 *
 * Expected behaviour: the feed shows one card stating the engine's archived
 * count. See them opens the retired screen, Not now is remembered across a
 * relaunch, and the card is absent for a count of zero, while a cutover runs,
 * and once answered.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import { SectionsChangedCard } from '@/features/settings/components/SectionsChangedCard';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { navigateTo } from '@/shared/app/navigation';
import { openLaunchSession } from '../../__shared__/launchSession';

const mockRows = new Map<string, string>();
let mockArchived = 0;
let mockRunning = false;
let mockPhase = 'complete';
let mockCounts: Record<string, number> | null = null;

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async (key: string) => mockRows.get(key) ?? null),
  setSetting: jest.fn(async (key: string, value: string) => {
    mockRows.set(key, value);
  }),
}));
jest.mock('@/features/routes', () => ({
  useEngineStatus: (select: (state: { quarantineReport: null }) => unknown) =>
    select({ quarantineReport: null }),
  useArchivedRetiredCount: () => mockArchived,
  useCutoverSummary: () => ({ isRunning: mockRunning, phase: mockPhase, counts: mockCounts }),
  CUTOVER_FAILURE_KEYS: {
    failed: { card: 'cutover.failed' },
    failed_after_apply: { card: 'cutover.failedAfterApply' },
  },
}));

beforeEach(() => {
  mockRows.clear();
  mockArchived = 0;
  mockRunning = false;
  mockPhase = 'complete';
  mockCounts = null;
  openLaunchSession();
  useWhatsNewStore.setState({ sectionsChangedDismissed: false });
  jest.clearAllMocks();
});

describe('SectionsChangedCard', () => {
  it('is absent when the engine counts no archived retirements', async () => {
    const tree = await render(<SectionsChangedCard />);
    expect(tree.queryByTestId('sections-changed-card')).toBeNull();
  });

  it('states the archived count', async () => {
    mockArchived = 3;
    const tree = await render(<SectionsChangedCard />);
    expect(tree.getByTestId('sections-changed-body').props.children).toContain('3');
  });

  it('waits while a cutover runs', async () => {
    mockArchived = 3;
    mockRunning = true;
    const tree = await render(<SectionsChangedCard />);
    expect(tree.queryByTestId('sections-changed-card')).toBeNull();
  });

  it('opens the retired screen from See them', async () => {
    mockArchived = 3;
    const tree = await render(<SectionsChangedCard />);
    await act(async () => fireEvent.press(tree.getByTestId('sections-changed-see')));
    expect(navigateTo).toHaveBeenCalledWith('/detection-preview?layer=retired');
  });

  it('stays hidden after Not now, on a remount and after a relaunch', async () => {
    mockArchived = 3;
    const tree = await render(<SectionsChangedCard />);
    await act(async () => fireEvent.press(tree.getByTestId('sections-changed-dismiss')));
    expect(tree.queryByTestId('sections-changed-card')).toBeNull();
    expect(navigateTo).not.toHaveBeenCalled();

    tree.unmount();
    const again = await render(<SectionsChangedCard />);
    expect(again.queryByTestId('sections-changed-card')).toBeNull();
    again.unmount();

    useWhatsNewStore.setState({ sectionsChangedDismissed: false });
    await act(async () => useWhatsNewStore.getState().initialise());
    const relaunched = await render(<SectionsChangedCard />);
    expect(relaunched.queryByTestId('sections-changed-card')).toBeNull();
  });

  it('asks inside the quiet period', async () => {
    mockArchived = 3;
    openLaunchSession(true);
    const tree = await render(<SectionsChangedCard />);
    expect(tree.getByTestId('sections-changed-card')).toBeTruthy();
  });

  describe('after a settled cutover that retired nothing', () => {
    beforeEach(() => {
      mockCounts = { current: 12, proposed: 14, new: 3, changed: 2, gone: 0, unchanged: 9 };
    });

    it('shows the summary counts and no See them', async () => {
      const tree = await render(<SectionsChangedCard />);
      expect(tree.getByTestId('sections-changed-card')).toBeTruthy();
      expect(tree.getByTestId('sections-changed-counts')).toBeTruthy();
      expect(tree.queryByTestId('sections-changed-see')).toBeNull();
      expect(tree.getByTestId('sections-changed-dismiss')).toBeTruthy();
    });

    it('is absent once dismissed', async () => {
      const tree = await render(<SectionsChangedCard />);
      await act(async () => fireEvent.press(tree.getByTestId('sections-changed-dismiss')));
      expect(tree.queryByTestId('sections-changed-card')).toBeNull();
    });

    it('is absent when the cutover failed', async () => {
      mockPhase = 'failed';
      const tree = await render(<SectionsChangedCard />);
      expect(tree.queryByTestId('sections-changed-card')).toBeNull();
    });

    it('is absent while the cutover runs', async () => {
      mockRunning = true;
      const tree = await render(<SectionsChangedCard />);
      expect(tree.queryByTestId('sections-changed-card')).toBeNull();
    });
  });

  it('is absent when no cutover has produced a summary and nothing is archived', async () => {
    mockPhase = 'idle';
    const tree = await render(<SectionsChangedCard />);
    expect(tree.queryByTestId('sections-changed-card')).toBeNull();
  });

  it('offers See them beside the summary when sections were retired', async () => {
    mockArchived = 3;
    mockCounts = { current: 12, proposed: 14, new: 3, changed: 2, gone: 3, unchanged: 7 };
    const tree = await render(<SectionsChangedCard />);
    expect(tree.getByTestId('sections-changed-counts')).toBeTruthy();
    expect(tree.getByTestId('sections-changed-see')).toBeTruthy();
  });

  it('hides a failed cutover even when archived sections remain', async () => {
    mockArchived = 3;
    mockPhase = 'failed_after_apply';
    const tree = await render(<SectionsChangedCard />);
    expect(tree.queryByTestId('sections-changed-card')).toBeNull();
  });
});
