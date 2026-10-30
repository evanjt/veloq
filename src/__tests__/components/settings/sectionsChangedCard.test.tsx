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
let mockCountsOwed = false;
let mockStaged: { done: number; total: number; daysToFinish?: number } | null = null;

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async (key: string) => mockRows.get(key) ?? null),
  setSetting: jest.fn(async (key: string, value: string) => {
    mockRows.set(key, value);
  }),
}));
jest.mock('@/features/settings/hooks/useBackgroundJobs', () => ({
  useStagedHistory: () => mockStaged,
}));
jest.mock('@/features/routes', () => ({
  useEngineStatus: (select: (state: { quarantineReport: null }) => unknown) =>
    select({ quarantineReport: null }),
  useArchivedRetiredCount: () => mockArchived,
  useCutoverSummary: () => ({
    isRunning: mockRunning,
    phase: mockPhase,
    counts: mockCounts,
    countsOwed: mockCountsOwed,
  }),
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
  mockCountsOwed = false;
  mockStaged = null;
  openLaunchSession();
  useWhatsNewStore.setState({ sectionsChangedDismissed: [] });
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

    useWhatsNewStore.setState({ sectionsChangedDismissed: [] });
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

  describe('after a cut stored before elevation was decided', () => {
    beforeEach(() => {
      mockCountsOwed = true;
    });

    it('says the sections are being upgraded and older activities join, with no counts', async () => {
      const tree = await render(<SectionsChangedCard />);
      expect(tree.getByTestId('sections-changed-card')).toBeTruthy();
      expect(tree.getByTestId('sections-changed-body').props.children).toBe(
        'feed.sectionsChangedBodyOwed'
      );
      expect(tree.queryByTestId('sections-changed-counts')).toBeNull();
    });

    it('offers no See them while the retired list is still settling', async () => {
      mockArchived = 3;
      const tree = await render(<SectionsChangedCard />);
      expect(tree.getByTestId('sections-changed-body').props.children).toBe(
        'feed.sectionsChangedBodyOwed'
      );
      expect(tree.queryByTestId('sections-changed-see')).toBeNull();
    });

    it('waits while the cut runs again', async () => {
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

  describe('the two messages of a staged upgrade', () => {
    const lastLaunch = async () => {
      useWhatsNewStore.setState({ sectionsChangedDismissed: [] });
      await act(async () => useWhatsNewStore.getState().initialise());
    };

    it('while elevation is owed, names the ready count and the days the rest take', async () => {
      mockCountsOwed = true;
      mockStaged = { done: 480, total: 2600, daysToFinish: 3 };
      const tree = await render(<SectionsChangedCard />);
      expect(tree.getByText('feed.sectionsChangedTitleOwed')).toBeTruthy();
      const ready = JSON.stringify(tree.getByTestId('sections-changed-ready').props.children);
      expect(ready).toContain('480');
      expect(ready).toContain('3');
      expect(tree.getByTestId('sections-changed-progress')).toBeTruthy();
    });

    it('names no days when the rest fit in one day', async () => {
      mockCountsOwed = true;
      mockStaged = { done: 480, total: 900 };
      const tree = await render(<SectionsChangedCard />);
      expect(
        JSON.stringify(tree.getByTestId('sections-changed-ready').props.children)
      ).not.toContain('pacedOnCaps');
    });

    it('opens background jobs from the progress button', async () => {
      mockCountsOwed = true;
      mockStaged = { done: 480, total: 2600, daysToFinish: 3 };
      const tree = await render(<SectionsChangedCard />);
      await act(async () => fireEvent.press(tree.getByTestId('sections-changed-progress')));
      expect(navigateTo).toHaveBeenCalledWith('/sync-settings');
    });

    it('returns with the outcome after the download-time card was dismissed', async () => {
      mockCountsOwed = true;
      mockStaged = { done: 480, total: 2600, daysToFinish: 3 };
      const owed = await render(<SectionsChangedCard />);
      await act(async () => fireEvent.press(owed.getByTestId('sections-changed-dismiss')));
      expect(owed.queryByTestId('sections-changed-card')).toBeNull();
      owed.unmount();

      mockCountsOwed = false;
      mockStaged = null;
      mockArchived = 5;
      mockCounts = { current: 12, proposed: 14, new: 3, changed: 2, gone: 5, unchanged: 7 };
      openLaunchSession();
      const final = await render(<SectionsChangedCard />);
      expect(final.getByTestId('sections-changed-card')).toBeTruthy();
      expect(final.getByText('feed.sectionsChangedTitleDone')).toBeTruthy();
      expect(final.getByTestId('sections-changed-body').props.children).toContain('5');
      expect(final.getByTestId('sections-changed-see')).toBeTruthy();
    });

    it('keeps the dismissed outcome gone across a reload of the store', async () => {
      mockArchived = 5;
      mockCounts = { current: 12, proposed: 14, new: 3, changed: 2, gone: 5, unchanged: 7 };
      const final = await render(<SectionsChangedCard />);
      await act(async () => fireEvent.press(final.getByTestId('sections-changed-dismiss')));
      final.unmount();

      await lastLaunch();
      const reloaded = await render(<SectionsChangedCard />);
      expect(reloaded.queryByTestId('sections-changed-card')).toBeNull();
    });

    it('reads a dismissal from the single-flag build as the download-time answer', async () => {
      mockRows.set('veloq-sections-changed-dismissed', 'true');
      await lastLaunch();
      mockCountsOwed = true;
      const owed = await render(<SectionsChangedCard />);
      expect(owed.queryByTestId('sections-changed-card')).toBeNull();
      owed.unmount();

      mockCountsOwed = false;
      mockCounts = { current: 12, proposed: 14, new: 3, changed: 2, gone: 0, unchanged: 9 };
      const final = await render(<SectionsChangedCard />);
      expect(final.getByTestId('sections-changed-card')).toBeTruthy();
    });
  });
});
