/**
 * Scenario: the detector cutover starts on its own at launch and re-cuts the
 * whole catalogue, and wants a subtle line in the detection settings so it is
 * not the only thing the athlete never sees happening.
 *
 * Expected behaviour: the line is there while a run holds the slot and gone
 * when it settles, a failed run reads as failed rather than as finished, and a
 * screen opened after the run is over says nothing at all.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { initialiseI18n, changeLanguage } from '@/i18n';
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
  countsOwed: false,
  settingsReset: null,
  sawRun: true,
});

/** `sawRun` is what separates a run this screen watched from one it missed. */
const settled = (phase: CutoverSummary['phase'], sawRun = false): CutoverSummary => ({
  phase,
  isRunning: false,
  counts: null,
  countsOwed: false,
  settingsReset: null,
  sawRun,
});

describe('the cutover status line', () => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await changeLanguage('en-AU');
  });

  it('says nothing when nothing is running', async () => {
    mockUseCutoverSummary.mockReturnValue(settled('idle'));
    await render(<CutoverStatus />);
    expect(screen.queryByTestId(CUTOVER_STATUS_TEST_ID)).toBeNull();
  });

  it('names the phase while the run holds the slot', async () => {
    mockUseCutoverSummary.mockReturnValue(running('detecting'));
    await render(<CutoverStatus />);
    expect(screen.getByTestId(CUTOVER_STATUS_TEST_ID)).toBeTruthy();
    expect(screen.getByText('Rebuilding sections: Detecting sections')).toBeTruthy();
  });

  it('uses the preparing wording while the run drains', async () => {
    mockUseCutoverSummary.mockReturnValue(running('draining'));
    await render(<CutoverStatus />);
    expect(screen.getByText('Rebuilding sections: Preparing catalogue')).toBeTruthy();
  });

  it('names every phase a run can hold the slot in', async () => {
    for (const phase of ['draining', 'archiving', 'detecting', 'diffing'] as const) {
      mockUseCutoverSummary.mockReturnValue(running(phase));
      const tree = await render(<CutoverStatus />);
      const line = screen.getByTestId(CUTOVER_STATUS_TEST_ID);
      expect(line).toBeTruthy();
      // A missing translation renders the key, which is never a phase name.
      expect(screen.queryByText(/settings\./)).toBeNull();
      await tree.unmount();
    }
  });

  it('goes away when the run settles', async () => {
    mockUseCutoverSummary.mockReturnValue(running('diffing'));
    const tree = await render(<CutoverStatus />);
    expect(screen.getByTestId(CUTOVER_STATUS_TEST_ID)).toBeTruthy();

    mockUseCutoverSummary.mockReturnValue(settled('complete'));
    await tree.rerender(<CutoverStatus />);
    expect(screen.queryByTestId(CUTOVER_STATUS_TEST_ID)).toBeNull();
  });

  it('does not report a failed run as a finished one', async () => {
    mockUseCutoverSummary.mockReturnValue(running('detecting'));
    const tree = await render(<CutoverStatus />);

    mockUseCutoverSummary.mockReturnValue(settled('failed', true));
    await tree.rerender(<CutoverStatus />);

    expect(screen.getByTestId(CUTOVER_STATUS_TEST_ID)).toBeTruthy();
    expect(
      screen.getByText(
        "The section rebuild didn't finish. Your sections are unchanged and it has another go next launch."
      )
    ).toBeTruthy();
  });

  it('says the sections were rebuilt when the run failed after replacing them', async () => {
    mockUseCutoverSummary.mockReturnValue(running('diffing'));
    const tree = await render(<CutoverStatus />);

    mockUseCutoverSummary.mockReturnValue(settled('failed_after_apply', true));
    await tree.rerender(<CutoverStatus />);

    expect(screen.getByTestId(CUTOVER_STATUS_TEST_ID)).toBeTruthy();
    expect(
      screen.getByText(
        'Your sections were rebuilt, but the summary of what changed was not saved. It is written again next launch.'
      )
    ).toBeTruthy();
    expect(screen.queryByText(/Your sections are unchanged/)).toBeNull();
  });

  it('says nothing about a run that was already over when the screen opened', async () => {
    mockUseCutoverSummary.mockReturnValue(settled('failed'));
    await render(<CutoverStatus />);
    expect(screen.queryByTestId(CUTOVER_STATUS_TEST_ID)).toBeNull();
  });
});
