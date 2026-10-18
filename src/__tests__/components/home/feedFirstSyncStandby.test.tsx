/**
 * Scenario: a fresh install, partway through its first sync, with nothing
 * stored yet.
 *
 * Expected behaviour: the feed says what is happening in the athlete's own
 * language and names the endpoint the engine is on. That line appears only
 * once the engine reports a step, because the counters beside it count steps
 * and a bare fraction of them says less than nothing.
 */

import { resolvedLocale } from '../../i18n/resolvedLocale';
import React from 'react';
import fs from 'fs';
import path from 'path';
import { AccessibilityInfo, Platform, StyleSheet } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { SyncStep } from 'veloqrs';

import { FeedFirstSyncStandby } from '@/features/home/components/FeedFirstSyncStandby';

const en = resolvedLocale('en-AU');

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

/** `t` answers with the key and its variables, so both are assertable. */
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());

let mockStatus: {
  state: number;
  completed: number;
  total: number;
  step?: SyncStep;
  stepItemsDone?: number;
  stepItemsTotal?: number;
} | null = null;
jest.mock('@/shared/native/useSyncStatus', () => ({
  useSyncStatus: () => mockStatus,
}));

const LOCALES = path.join(__dirname, '../../../i18n/locales');
const KEYS = ['feed.firstSyncTitle', 'feed.firstSyncBody'];

function lookup(bundle: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part];
    return undefined;
  }, bundle);
}

describe('the first-sync standby', () => {
  beforeEach(() => {
    mockStatus = { state: 1, completed: 0, total: 0 };
  });

  it('says what is happening rather than that there is nothing', async () => {
    await render(<FeedFirstSyncStandby />);

    expect(screen.getByTestId('feed-first-sync-title')).toBeTruthy();
    expect(screen.getByTestId('feed-first-sync-body')).toBeTruthy();
  });

  it('titles itself as a heading, so a screen reader can skim to it', async () => {
    await render(<FeedFirstSyncStandby />);

    expect(screen.getByRole('header', { name: 'feed.firstSyncTitle' })).toBeTruthy();
  });

  it('draws no step line before the engine reports a step', async () => {
    await render(<FeedFirstSyncStandby />);

    expect(screen.queryByTestId('feed-first-sync-step')).toBeNull();
  });

  /** The defect: a step count read as a count of activities, so a fresh
   *  install waiting on the athlete profile said "0 of 7 activities". */
  it('names the endpoint the engine is on rather than counting activities', async () => {
    mockStatus = { state: 1, completed: 0, total: 8, step: SyncStep.Athlete };
    await render(<FeedFirstSyncStandby />);

    expect(screen.getByTestId('feed-first-sync-step').props.children).toBe(
      'settings.syncStep.athlete'
    );
    expect(screen.getByTestId('feed-first-sync-counts').props.children).toBe('0/8');
  });

  it('follows the engine to the step that carries the activities', async () => {
    mockStatus = { state: 1, completed: 4, total: 8, step: SyncStep.Activities };
    await render(<FeedFirstSyncStandby />);

    expect(screen.getByTestId('feed-first-sync-step').props.children).toBe(
      'settings.syncStep.activities'
    );
    expect(screen.getByTestId('feed-first-sync-counts').props.children).toBe('4/8');
  });

  it('sets the counts on a quieter line below the step', async () => {
    mockStatus = {
      state: 1,
      completed: 4,
      total: 8,
      step: SyncStep.Activities,
      stepItemsDone: 120,
      stepItemsTotal: 480,
    };
    await render(<FeedFirstSyncStandby />);

    const step = StyleSheet.flatten(screen.getByTestId('feed-first-sync-step').props.style);
    const counts = StyleSheet.flatten(screen.getByTestId('feed-first-sync-counts').props.style);
    expect(screen.getByTestId('feed-first-sync-counts').props.children).toBe('4/8 · 120/480');
    expect(counts.fontSize).toBeLessThan(step.fontSize);
  });

  it('draws no count line for a step with nothing to count', async () => {
    mockStatus = { state: 1, completed: 0, total: 1, step: SyncStep.Activities };
    await render(<FeedFirstSyncStandby />);

    expect(screen.getByTestId('feed-first-sync-step')).toBeTruthy();
    expect(screen.queryByTestId('feed-first-sync-counts')).toBeNull();
  });

  /** The defect: every stored item moved the count, so the view flickered
   *  through the whole first sync. */
  describe('the count line', () => {
    beforeEach(() => {
      jest.useFakeTimers({ now: 1_000_000 });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    const itemsAt = (done: number) => ({
      state: 1,
      completed: 4,
      total: 8,
      step: SyncStep.Activities,
      stepItemsDone: done,
      stepItemsTotal: 480,
    });
    const counts = () => screen.getByTestId('feed-first-sync-counts').props.children;

    it('changes no faster than once a second and settles on the latest count', async () => {
      mockStatus = itemsAt(10);
      const { rerender } = await render(<FeedFirstSyncStandby />);
      expect(counts()).toBe('4/8 · 10/480');

      for (const done of [11, 12, 13]) {
        mockStatus = itemsAt(done);
        await rerender(<FeedFirstSyncStandby />);
        await act(() => {
          jest.advanceTimersByTime(200);
        });
        expect(counts()).toBe('4/8 · 10/480');
      }

      await act(() => {
        jest.advanceTimersByTime(400);
      });
      expect(counts()).toBe('4/8 · 13/480');

      mockStatus = itemsAt(14);
      await rerender(<FeedFirstSyncStandby />);
      await act(() => {
        jest.advanceTimersByTime(999);
      });
      expect(counts()).toBe('4/8 · 13/480');
      await act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(counts()).toBe('4/8 · 14/480');
    });

    it('holds the progress value to the same pace', async () => {
      mockStatus = itemsAt(10);
      const { rerender } = await render(<FeedFirstSyncStandby />);
      mockStatus = itemsAt(11);
      await rerender(<FeedFirstSyncStandby />);

      expect(screen.getByRole('progressbar').props.accessibilityValue.now).toBe(10);
      await act(() => {
        jest.advanceTimersByTime(1000);
      });
      expect(screen.getByRole('progressbar').props.accessibilityValue.now).toBe(11);
    });

    it('names a new step at once, without waiting on the count', async () => {
      mockStatus = itemsAt(10);
      const { rerender } = await render(<FeedFirstSyncStandby />);
      mockStatus = { state: 1, completed: 5, total: 8, step: SyncStep.Curves };
      await rerender(<FeedFirstSyncStandby />);

      expect(screen.getByTestId('feed-first-sync-step').props.children).toBe(
        'settings.syncStep.curves'
      );
    });
  });

  it('values its progress from the counts inside the step', async () => {
    mockStatus = {
      state: 1,
      completed: 4,
      total: 8,
      step: SyncStep.Activities,
      stepItemsDone: 120,
      stepItemsTotal: 480,
    };
    await render(<FeedFirstSyncStandby />);

    const progress = screen.getByRole('progressbar');
    expect(progress.props.accessibilityValue).toEqual({ min: 0, max: 480, now: 120 });
    expect(progress.props.accessibilityState).toEqual({ busy: true });
  });

  it('is busy with no value while the step has no count of its own', async () => {
    mockStatus = { state: 1, completed: 0, total: 8, step: SyncStep.Athlete };
    await render(<FeedFirstSyncStandby />);

    const progress = screen.getByRole('progressbar');
    expect(progress.props.accessibilityValue).toBeUndefined();
    expect(progress.props.accessibilityState).toEqual({ busy: true });
  });

  it('survives a status the engine has not answered yet', async () => {
    mockStatus = null;
    await render(<FeedFirstSyncStandby />);

    expect(screen.getByTestId('feed-first-sync-standby')).toBeTruthy();
    expect(screen.queryByTestId('feed-first-sync-step')).toBeNull();
  });

  /** The step line is the only progress on the Feed during a first sync, so
   *  a screen reader has to hear it change without focus moving to it. */
  describe('reaching a screen reader', () => {
    const os = Platform.OS;
    let announce: jest.SpyInstance;

    beforeEach(() => {
      announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation();
    });

    afterEach(() => {
      Platform.OS = os;
      announce.mockRestore();
    });

    it('marks the step line as a polite live region for Android', async () => {
      mockStatus = { state: 1, completed: 0, total: 8, step: SyncStep.Athlete };
      await render(<FeedFirstSyncStandby />);

      expect(screen.getByTestId('feed-first-sync-step').props.accessibilityLiveRegion).toBe(
        'polite'
      );
    });

    it('announces each new step on iOS, which has no live region', async () => {
      Platform.OS = 'ios';
      mockStatus = { state: 1, completed: 0, total: 8, step: SyncStep.Athlete };
      const { rerender } = await render(<FeedFirstSyncStandby />);
      expect(announce).toHaveBeenLastCalledWith('settings.syncStep.athlete');

      mockStatus = { state: 1, completed: 1, total: 8, step: SyncStep.SportSettings };
      await rerender(<FeedFirstSyncStandby />);

      expect(announce).toHaveBeenLastCalledWith('settings.syncStep.sportSettings');
      expect(announce).toHaveBeenCalledTimes(2);
    });

    it('says nothing new on iOS while only the counts inside one step move', async () => {
      Platform.OS = 'ios';
      mockStatus = {
        state: 1,
        completed: 4,
        total: 8,
        step: SyncStep.Activities,
        stepItemsDone: 10,
        stepItemsTotal: 400,
      };
      const { rerender } = await render(<FeedFirstSyncStandby />);
      mockStatus = { ...mockStatus, stepItemsDone: 11 };
      await rerender(<FeedFirstSyncStandby />);
      mockStatus = { ...mockStatus, stepItemsDone: 12 };
      await rerender(<FeedFirstSyncStandby />);

      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce).toHaveBeenCalledWith('settings.syncStep.activities');
    });

    it('announces nothing before the engine reports a step', async () => {
      Platform.OS = 'ios';
      await render(<FeedFirstSyncStandby />);

      expect(announce).not.toHaveBeenCalled();
    });
  });

  it.each(KEYS)('%s is in en-AU', (key) => {
    expect(typeof lookup(en as Record<string, unknown>, key)).toBe('string');
  });

  // Every other locale is held to the reference one in translations.test.ts,
  // so no one reads English here alone.
  it('carries both lines in the reference locale', () => {
    const bundle = JSON.parse(fs.readFileSync(path.join(LOCALES, 'en-GB.json'), 'utf8'));
    expect(KEYS.filter((key) => typeof lookup(bundle, key) !== 'string')).toEqual([]);
  });
});
