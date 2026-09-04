/**
 * Scenario: the detector cutover starts on its own at launch and re-cuts the
 * whole catalogue. `Q29` asked for a subtle line in the detection settings so
 * it is not the only thing the athlete never sees happening.
 *
 * Expected behaviour: the line is there while a run holds the slot and gone
 * when it settles, a failed run reads as failed rather than as finished, and a
 * screen opened after the run is over says nothing at all.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { initializeI18n, changeLanguage } from '@/i18n';
import {
  CutoverStatus,
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

const running = (phase: CutoverSummary['phase']): CutoverSummary => ({
  phase,
  isRunning: true,
  counts: null,
  sawRun: true,
});

/** `sawRun` is what separates a run this screen watched from one it missed. */
const settled = (phase: CutoverSummary['phase'], sawRun = false): CutoverSummary => ({
  phase,
  isRunning: false,
  counts: null,
  sawRun,
});

describe('the cutover status line', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await changeLanguage('en-AU');
  });

  it('says nothing when nothing is running', () => {
    mockUseCutoverSummary.mockReturnValue(settled('idle'));
    render(<CutoverStatus />);
    expect(screen.queryByTestId(CUTOVER_STATUS_TEST_ID)).toBeNull();
  });

  it('names the phase while the run holds the slot', () => {
    mockUseCutoverSummary.mockReturnValue(running('detecting'));
    render(<CutoverStatus />);
    expect(screen.getByTestId(CUTOVER_STATUS_TEST_ID)).toBeTruthy();
    expect(screen.getByText('Rebuilding sections: detecting')).toBeTruthy();
  });

  it('names every phase a run can hold the slot in', () => {
    for (const phase of ['draining', 'archiving', 'detecting', 'diffing'] as const) {
      mockUseCutoverSummary.mockReturnValue(running(phase));
      const tree = render(<CutoverStatus />);
      const line = screen.getByTestId(CUTOVER_STATUS_TEST_ID);
      expect(line).toBeTruthy();
      // A missing translation renders the key, which is never a phase name.
      expect(screen.queryByText(/settings\./)).toBeNull();
      tree.unmount();
    }
  });

  it('goes away when the run settles', () => {
    mockUseCutoverSummary.mockReturnValue(running('diffing'));
    const tree = render(<CutoverStatus />);
    expect(screen.getByTestId(CUTOVER_STATUS_TEST_ID)).toBeTruthy();

    mockUseCutoverSummary.mockReturnValue(settled('complete'));
    tree.rerender(<CutoverStatus />);
    expect(screen.queryByTestId(CUTOVER_STATUS_TEST_ID)).toBeNull();
  });

  it('does not report a failed run as a finished one', () => {
    mockUseCutoverSummary.mockReturnValue(running('detecting'));
    const tree = render(<CutoverStatus />);

    mockUseCutoverSummary.mockReturnValue(settled('failed', true));
    tree.rerender(<CutoverStatus />);

    expect(screen.getByTestId(CUTOVER_STATUS_TEST_ID)).toBeTruthy();
    expect(screen.getByText('The section rebuild did not finish.')).toBeTruthy();
  });

  it('says nothing about a run that was already over when the screen opened', () => {
    mockUseCutoverSummary.mockReturnValue(settled('failed'));
    render(<CutoverStatus />);
    expect(screen.queryByTestId(CUTOVER_STATUS_TEST_ID)).toBeNull();
  });
});
