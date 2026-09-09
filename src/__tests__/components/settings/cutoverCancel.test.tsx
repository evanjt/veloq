/**
 * Scenario: the cut fires unattended at launch and rebuilds the whole
 * catalogue, and the only lever the athlete had was a force-quit, which the
 * in-flight token undid on the next launch.
 *
 * Expected behaviour: the status line that reports the run also offers to stop
 * it, and only while a run is actually running. Stopping is honest about what
 * it buys, so the line says the rebuild picks up next time rather than
 * implying the migration is off.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { initializeI18n, changeLanguage } from '@/i18n';
import {
  CutoverStatus,
  CUTOVER_CANCEL_TEST_ID,
  CUTOVER_STATUS_TEST_ID,
} from '@/features/settings/components/CutoverStatus';
import type { CutoverSummary } from '@/features/routes/hooks/useCutoverSummary';

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

const mockUseCutoverSummary = jest.fn();
jest.mock('@/features/routes/hooks/useCutoverSummary', () => ({
  useCutoverSummary: () => mockUseCutoverSummary(),
}));

const mockCancel = jest.fn();
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ cancelDetectorCutover: mockCancel }),
}));

const running = (phase: CutoverSummary['phase']): CutoverSummary => ({
  phase,
  isRunning: true,
  counts: null,
  settingsReset: null,
  sawRun: true,
});

const settled = (phase: CutoverSummary['phase'], sawRun = false): CutoverSummary => ({
  phase,
  isRunning: false,
  counts: null,
  settingsReset: null,
  sawRun,
});

describe('stopping the cutover from its status line', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await changeLanguage('en-AU');
  });

  it('offers to stop a run that is going', () => {
    mockUseCutoverSummary.mockReturnValue(running('detecting'));
    render(<CutoverStatus />);

    expect(screen.getByTestId(CUTOVER_CANCEL_TEST_ID)).toBeTruthy();
  });

  it('asks the engine to stop when it is tapped', () => {
    mockUseCutoverSummary.mockReturnValue(running('archiving'));
    render(<CutoverStatus />);

    fireEvent.press(screen.getByTestId(CUTOVER_CANCEL_TEST_ID));

    expect(mockCancel).toHaveBeenCalledTimes(1);
  });

  it('says what stopping buys, which is this run and not the migration', () => {
    mockUseCutoverSummary.mockReturnValue(running('detecting'));
    render(<CutoverStatus />);

    fireEvent.press(screen.getByTestId(CUTOVER_CANCEL_TEST_ID));

    expect(screen.getByText('Stopping. It picks up again next time you open Veloq.')).toBeTruthy();
    expect(screen.queryByTestId(CUTOVER_CANCEL_TEST_ID)).toBeNull();
  });

  it('does not ask twice', () => {
    mockUseCutoverSummary.mockReturnValue(running('detecting'));
    render(<CutoverStatus />);

    const stop = screen.getByTestId(CUTOVER_CANCEL_TEST_ID);
    fireEvent.press(stop);
    fireEvent.press(stop);

    expect(mockCancel).toHaveBeenCalledTimes(1);
  });

  it('offers nothing to stop when nothing is running', () => {
    mockUseCutoverSummary.mockReturnValue(settled('complete'));
    render(<CutoverStatus />);

    expect(screen.queryByTestId(CUTOVER_CANCEL_TEST_ID)).toBeNull();
  });

  it('offers nothing to stop on a failed run', () => {
    mockUseCutoverSummary.mockReturnValue(settled('failed', true));
    render(<CutoverStatus />);

    expect(screen.getByTestId(CUTOVER_STATUS_TEST_ID)).toBeTruthy();
    expect(screen.queryByTestId(CUTOVER_CANCEL_TEST_ID)).toBeNull();
  });

  /** The next run is a new run: it gets its own offer to stop. */
  it('offers again once a later run starts', () => {
    mockUseCutoverSummary.mockReturnValue(running('detecting'));
    const tree = render(<CutoverStatus />);
    fireEvent.press(screen.getByTestId(CUTOVER_CANCEL_TEST_ID));

    mockUseCutoverSummary.mockReturnValue(settled('complete'));
    tree.rerender(<CutoverStatus />);
    mockUseCutoverSummary.mockReturnValue(running('archiving'));
    tree.rerender(<CutoverStatus />);

    expect(screen.getByTestId(CUTOVER_CANCEL_TEST_ID)).toBeTruthy();
  });
});
