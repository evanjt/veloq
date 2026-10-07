/**
 * The row is the only thing that starts the stream backfill, so what it shows
 * decides whether the download is ever offered. It runs against the real
 * catalogue rather than a stubbed `t`, which is what proves the count comes
 * from i18n and pluralises.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { StartOutcome } from 'veloqrs';
import { initializeI18n, changeLanguage } from '@/i18n';
import { StreamBackfillRow } from '@/features/settings/components/StreamBackfillRow';
import type { StreamBackfillState } from '@/features/settings/hooks/useStreamBackfill';

const mockStart = jest.fn();
const mockStop = jest.fn();
const mockUseStreamBackfill = jest.fn();
jest.mock('@/features/settings/hooks/useStreamBackfill', () => ({
  useStreamBackfill: () => mockUseStreamBackfill(),
}));

function state(over: Partial<StreamBackfillState> & { refusal?: StartOutcome | null }): unknown {
  return {
    phase: 'idle',
    completed: 0,
    total: 0,
    stored: 0,
    remaining: null,
    isRunning: false,
    refusal: null,
    ...over,
    start: mockStart,
    stop: mockStop,
  };
}

function row() {
  return render(<StreamBackfillRow isDark={false} />);
}

describe('StreamBackfillRow', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  beforeEach(async () => {
    await changeLanguage('en-AU');
    mockStart.mockClear();
    mockStop.mockClear();
  });

  it('says why an offline tap started nothing', () => {
    mockUseStreamBackfill.mockReturnValue(
      state({ remaining: 412, phase: 'stopped', refusal: StartOutcome.Offline })
    );
    const tree = row();

    expect(tree.getByTestId('settings-stream-backfill-refusal').props.children).toBe(
      'No connection. Try again when you are online.'
    );
  });

  it('shows no refusal line when nothing was refused', () => {
    mockUseStreamBackfill.mockReturnValue(state({ remaining: 412, phase: 'stopped' }));
    expect(row().queryByTestId('settings-stream-backfill-refusal')).toBeNull();
  });

  it('offers the download after a stop, with what is owed, pluralised', () => {
    mockUseStreamBackfill.mockReturnValue(state({ remaining: 412, phase: 'stopped' }));
    const tree = row();

    expect(tree.getByTestId('settings-stream-backfill-count').props.children).toBe(
      '412 activities'
    );
    fireEvent.press(tree.getByTestId('settings-stream-backfill-action'));
    expect(mockStart).toHaveBeenCalled();
  });

  /**
   * Scenario: retention is widened with series owed and the engine has not been
   * stopped. Expected behaviour: the engine starts the pass itself, so the row
   * offers no Download and shows the running pass.
   */
  it('offers no download before any stop', () => {
    mockUseStreamBackfill.mockReturnValue(state({ remaining: 412, phase: 'idle' }));
    expect(row().queryByTestId('settings-stream-backfill-action')).toBeNull();
  });

  it('shows the running pass with Stop and no Download after a widening', () => {
    mockUseStreamBackfill.mockReturnValue(
      state({ remaining: 412, isRunning: true, phase: 'fetching', completed: 3, total: 412 })
    );
    const tree = row();

    expect(tree.getByTestId('settings-stream-backfill-count').props.children).toBe('3 of 412');
    expect(tree.queryByText('Download')).toBeNull();
  });

  it('offers the download while the engine waits for consent', () => {
    mockUseStreamBackfill.mockReturnValue(
      state({
        remaining: 900,
        phase: 'awaiting_consent',
        awaitingConsent: true,
        estimateMegabytes: 90,
      })
    );
    expect(row().getByTestId('settings-stream-backfill-action')).toBeTruthy();
  });

  it('reads as a singular when one activity is owed', () => {
    mockUseStreamBackfill.mockReturnValue(state({ remaining: 1 }));

    expect(row().getByTestId('settings-stream-backfill-count').props.children).toBe('1 activity');
  });

  /**
   * 34 MB on a phone connection is not a silent operation, so a running pass
   * shows what it is doing and the same control stops it.
   */
  it('shows progress while running and the control stops it', () => {
    mockUseStreamBackfill.mockReturnValue(
      state({ isRunning: true, phase: 'fetching', completed: 120, total: 412 })
    );
    const tree = row();

    expect(tree.getByTestId('settings-stream-backfill-count').props.children).toBe('120 of 412');
    fireEvent.press(tree.getByTestId('settings-stream-backfill-action'));
    expect(mockStop).toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('stays away once the library is stocked', () => {
    mockUseStreamBackfill.mockReturnValue(state({ remaining: 0 }));

    expect(row().queryByTestId('settings-stream-backfill')).toBeNull();
  });

  /**
   * A null count is an engine that could not answer. Reading it as a stocked
   * library would hide the download from exactly the athlete who needs it, so
   * the row waits rather than claiming the work is done.
   */
  it('stays away while the engine cannot answer, rather than claiming it is done', () => {
    mockUseStreamBackfill.mockReturnValue(state({ remaining: null }));

    expect(row().queryByTestId('settings-stream-backfill')).toBeNull();
  });
});
