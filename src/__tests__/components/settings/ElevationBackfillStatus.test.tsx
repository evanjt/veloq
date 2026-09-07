/**
 * The retry line names how many activity tracks failed, so it has to agree with
 * that count. It runs against the real catalogue rather than a stubbed `t`,
 * which is what proves the sentence comes from i18n and not from the component.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { initializeI18n, changeLanguage } from '@/i18n';
import enAU from '@/i18n/locales/en-AU.json';
import { ElevationBackfillStatus } from '@/features/settings/components/ElevationBackfillStatus';
import type { ElevationBackfillState } from '@/features/routes/hooks/useElevationBackfill';

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

const mockPauseElevationBackfill = jest.fn();
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ pauseElevationBackfill: mockPauseElevationBackfill }),
}));

const mockUseElevationBackfill = jest.fn();
jest.mock('@/features/routes/hooks/useElevationBackfill', () => ({
  useElevationBackfill: () => mockUseElevationBackfill(),
}));

function partialRun(failed: number): ElevationBackfillState {
  return {
    phase: 'partial',
    completed: 10,
    total: 10 + failed,
    failed,
    remaining: null,
    isRunning: false,
  };
}

function atRest(remaining: number | null): ElevationBackfillState {
  return { phase: 'idle', completed: 0, total: 0, failed: 0, remaining, isRunning: false };
}

function statusText(): string {
  const tree = render(<ElevationBackfillStatus />);
  return tree.getByTestId('elevation-backfill-status').props.children as string;
}

describe('ElevationBackfillStatus retry line', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  beforeEach(async () => {
    await changeLanguage('en-AU');
  });

  it('reads as a singular when one track failed', () => {
    mockUseElevationBackfill.mockReturnValue(partialRun(1));
    expect(statusText()).toBe('1 activity track could not be updated. It will be retried later.');
  });

  it('reads as a plural when more than one track failed', () => {
    mockUseElevationBackfill.mockReturnValue(partialRun(4));
    expect(statusText()).toBe(
      '4 activity tracks could not be updated. They will be retried later.'
    );
  });

  it('drops the count entirely when nothing failed', () => {
    mockUseElevationBackfill.mockReturnValue(partialRun(0));
    expect(statusText()).toBe(
      'Some activity tracks still need elevation. They will be retried later.'
    );
  });

  it('pluralises in every locale, never leaving a raw placeholder', async () => {
    mockUseElevationBackfill.mockReturnValue(partialRun(1));
    for (const locale of ['fr', 'de-DE', 'ja', 'pl', 'zh-Hans'] as const) {
      await changeLanguage(locale);
      const text = statusText();
      expect(text).not.toContain('{{');
      expect(text).toContain('1');
    }
  });
});

/**
 * Scenario: the backfill starts on its own, and until it finishes the improved
 * detector is held behind it.
 * Expected behaviour: the status line says what is waiting on the download, and
 * a Why control explains what needs the elevation. Both read from i18n.
 */
describe('ElevationBackfillStatus explanation', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  beforeEach(async () => {
    await changeLanguage('en-AU');
  });

  it('says what waits on the download while it runs', () => {
    mockUseElevationBackfill.mockReturnValue({
      phase: 'fetching',
      completed: 3,
      total: 10,
      failed: 0,
      isRunning: true,
    });
    const tree = render(<ElevationBackfillStatus />);

    expect(tree.getByTestId('elevation-backfill-explainer').props.children).toBe(
      'Improved section detection runs once every track has elevation.'
    );
  });

  it('still says it when the run stopped part way, since the wait is not over', () => {
    mockUseElevationBackfill.mockReturnValue(partialRun(2));
    const tree = render(<ElevationBackfillStatus />);

    expect(tree.queryByTestId('elevation-backfill-explainer')).not.toBeNull();
  });

  it('drops the line once every track has elevation', () => {
    mockUseElevationBackfill.mockReturnValue({
      phase: 'complete',
      completed: 10,
      total: 10,
      failed: 0,
      isRunning: false,
    });
    const tree = render(<ElevationBackfillStatus />);

    expect(tree.queryByTestId('elevation-backfill-explainer')).toBeNull();
    expect(tree.queryByTestId('elevation-backfill-why')).not.toBeNull();
  });

  it('shows nothing at all while the phase is idle', () => {
    mockUseElevationBackfill.mockReturnValue({
      phase: 'idle',
      completed: 0,
      total: 0,
      failed: 0,
      isRunning: false,
    });
    const tree = render(<ElevationBackfillStatus />);

    expect(tree.queryByTestId('elevation-backfill-why')).toBeNull();
    expect(tree.queryByTestId('elevation-backfill-explainer')).toBeNull();
  });

  it('opens the Why dialog on the control and closes it again', () => {
    mockUseElevationBackfill.mockReturnValue(partialRun(0));
    const tree = render(<ElevationBackfillStatus />);

    expect(tree.queryByTestId('elevation-backfill-why-body')).toBeNull();

    fireEvent.press(tree.getByTestId('elevation-backfill-why'));
    expect(tree.getByTestId('elevation-backfill-why-body').props.children).toBe(
      'The improved section algorithm and lift detection read elevation that earlier versions never fetched. Veloq downloads it once for your existing activities, then detects sections again with the new algorithm.'
    );

    fireEvent.press(tree.getByTestId('elevation-backfill-why-close'));
    expect(tree.queryByTestId('elevation-backfill-why-body')).toBeNull();
  });

  it('translates the explanation rather than falling back to English', async () => {
    mockUseElevationBackfill.mockReturnValue(partialRun(0));
    for (const locale of ['fr', 'de-DE', 'ja', 'pl', 'zh-Hans'] as const) {
      await changeLanguage(locale);
      const tree = render(<ElevationBackfillStatus />);
      fireEvent.press(tree.getByTestId('elevation-backfill-why'));

      const explainer = tree.getByTestId('elevation-backfill-explainer').props.children as string;
      const body = tree.getByTestId('elevation-backfill-why-body').props.children as string;
      expect(explainer).not.toContain('Improved section detection');
      expect(body).not.toContain('The improved section algorithm');
      expect(explainer.trim().length).toBeGreaterThan(0);
      expect(body.trim().length).toBeGreaterThan(0);
    }
  });
});

/**
 * The phase is `idle` on every launch that has not run a pass, so a line
 * reading the phase alone is blank whatever the library still owes.
 */
describe('ElevationBackfillStatus at rest', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  beforeEach(async () => {
    await changeLanguage('en-AU');
  });

  it('names what is still outstanding', () => {
    mockUseElevationBackfill.mockReturnValue(atRest(12));
    expect(statusText()).toBe('12 activity tracks still need elevation.');
  });

  it('reads as a singular for one track', () => {
    mockUseElevationBackfill.mockReturnValue(atRest(1));
    expect(statusText()).toBe('1 activity track still needs elevation.');
  });

  it('says nothing when nothing is outstanding', () => {
    mockUseElevationBackfill.mockReturnValue(atRest(0));
    const tree = render(<ElevationBackfillStatus />);
    expect(tree.queryByTestId('elevation-backfill-status')).toBeNull();
  });

  it('says nothing rather than zero when the engine could not answer', () => {
    mockUseElevationBackfill.mockReturnValue(atRest(null));
    const tree = render(<ElevationBackfillStatus />);
    expect(tree.queryByTestId('elevation-backfill-status')).toBeNull();
  });

  it('leaves a live pass reporting its own progress', () => {
    mockUseElevationBackfill.mockReturnValue({
      phase: 'fetching',
      completed: 3,
      total: 20,
      failed: 0,
      remaining: null,
      isRunning: true,
    });
    const tree = render(<ElevationBackfillStatus />);
    expect(tree.getByText('3 of 20 activities')).toBeTruthy();
  });
});

/**
 * Scenario: the athlete wants the download to stop. The pause ends the run in
 * flight and the line says plainly that it resumes when the app is reopened,
 * and where the switch is for turning detection off altogether.
 */
describe('ElevationBackfillStatus pause', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  beforeEach(async () => {
    await changeLanguage('en-AU');
    mockPauseElevationBackfill.mockReset();
  });

  function running(): ElevationBackfillState {
    return {
      phase: 'fetching',
      completed: 3,
      total: 10,
      failed: 0,
      remaining: null,
      isRunning: true,
    };
  }

  function paused(): ElevationBackfillState {
    return { phase: 'paused', completed: 3, total: 10, failed: 0, remaining: 7, isRunning: false };
  }

  it('offers a pause while the download runs, and it reaches the engine', () => {
    mockUseElevationBackfill.mockReturnValue(running());
    const tree = render(<ElevationBackfillStatus />);

    fireEvent.press(tree.getByTestId('elevation-backfill-pause'));

    expect(mockPauseElevationBackfill).toHaveBeenCalledTimes(1);
  });

  it('offers a pause at rest with work outstanding, since the next pass is armed', () => {
    mockUseElevationBackfill.mockReturnValue(atRest(12));
    const tree = render(<ElevationBackfillStatus />);

    expect(tree.queryByTestId('elevation-backfill-pause')).not.toBeNull();
  });

  it('says the download is paused, when it resumes, and where the switch is', () => {
    mockUseElevationBackfill.mockReturnValue(paused());
    const tree = render(<ElevationBackfillStatus />);

    const text = tree.getByTestId('elevation-backfill-status').props.children as string;
    expect(text).toContain('paused');
    expect(text).toContain('next time you open');
    // Read the label rather than repeating it: the sentence points at that row,
    // so a rename of either has to move both or this fails.
    expect(text).toContain(enAU.settings.routeMatching);
    expect(tree.queryByTestId('elevation-backfill-pause')).toBeNull();
  });

  it('offers no pause once every track has elevation', () => {
    mockUseElevationBackfill.mockReturnValue({
      phase: 'complete',
      completed: 10,
      total: 10,
      failed: 0,
      remaining: 0,
      isRunning: false,
    });
    const tree = render(<ElevationBackfillStatus />);

    expect(tree.queryByTestId('elevation-backfill-pause')).toBeNull();
  });

  it('reads the paused line in every locale without a raw placeholder', async () => {
    mockUseElevationBackfill.mockReturnValue(paused());
    for (const locale of ['fr', 'de-DE', 'ja', 'pl', 'zh-Hans'] as const) {
      await changeLanguage(locale);
      const text = statusText();
      expect(text).not.toContain('{{');
      expect(text.length).toBeGreaterThan(0);
    }
  });
});
