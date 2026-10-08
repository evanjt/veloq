/**
 * The row is the only thing that starts the stream backfill, so what it shows
 * decides whether the download is ever offered. It runs against the real
 * catalogue rather than a stubbed `t`, which is what proves the count comes
 * from i18n and pluralises.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { StartOutcome } from 'veloqrs';
import { initialiseI18n, changeLanguage } from '@/i18n';
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
    remainingBytes: null,
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
    await initialiseI18n('en-AU');
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
      "No connection. Have another go once you're online."
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
   * Scenario: the pass has never been stopped and Settings is opened at rest.
   * Expected behaviour: the row states the owed queue's size there too, not
   * only after a stop.
   */
  it('states the size at rest, where no stop has happened', () => {
    mockUseStreamBackfill.mockReturnValue(
      state({ remaining: 412, phase: 'idle', remainingBytes: 12_000_000 })
    );

    expect(row().getByTestId('settings-stream-backfill-count').props.children).toBe(
      '412 activities, 12.0 MB'
    );
  });

  it('shows the count alone when the queue has no known moving time', () => {
    mockUseStreamBackfill.mockReturnValue(
      state({ remaining: 412, phase: 'stopped', remainingBytes: 0 })
    );
    expect(row().getByTestId('settings-stream-backfill-count').props.children).toBe(
      '412 activities'
    );
  });

  it('shows progress, not a size, while the pass runs', () => {
    mockUseStreamBackfill.mockReturnValue(
      state({
        remaining: null,
        remainingBytes: 36_400_000,
        isRunning: true,
        phase: 'fetching',
        completed: 3,
        total: 412,
      })
    );

    expect(row().getByTestId('settings-stream-backfill-count').props.children).toBe('3 of 412');
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

  /**
   * Scenario: the athlete stopped the pass and opens Settings later.
   * Expected behaviour: the row says how much the owed queue downloads, from
   * the engine's byte figure, and a queue under a megabyte is not "0 MB".
   */
  it('states the size of what is owed after a stop', () => {
    mockUseStreamBackfill.mockReturnValue(
      state({ remaining: 412, remainingBytes: 8_650_000, phase: 'stopped' })
    );
    expect(row().getByTestId('settings-stream-backfill-count').props.children).toBe(
      '412 activities, 8.7 MB'
    );
  });

  it('states a queue under a megabyte in kilobytes', () => {
    mockUseStreamBackfill.mockReturnValue(
      state({ remaining: 3, remainingBytes: 400_000, phase: 'stopped' })
    );
    expect(row().getByTestId('settings-stream-backfill-count').props.children).toBe(
      '3 activities, 400.0 KB'
    );
  });

  it('states the size beside the count while the engine waits for consent', () => {
    mockUseStreamBackfill.mockReturnValue(
      state({
        remaining: 900,
        remainingBytes: 90_000_000,
        phase: 'awaiting_consent',
        awaitingConsent: true,
      })
    );
    expect(row().getByTestId('settings-stream-backfill-count').props.children).toBe(
      '900 activities, 90.0 MB'
    );
  });

  it('shows the count alone when the engine cannot price the queue', () => {
    mockUseStreamBackfill.mockReturnValue(
      state({ remaining: 412, remainingBytes: null, phase: 'stopped' })
    );
    expect(row().getByTestId('settings-stream-backfill-count').props.children).toBe(
      '412 activities'
    );
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
