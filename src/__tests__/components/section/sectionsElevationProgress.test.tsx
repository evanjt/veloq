import React from 'react';
import { render } from '@testing-library/react-native';

import { initializeI18n, changeLanguage } from '@/i18n';
import { SectionsListHeader } from '@/features/routes/components/SectionsListHeader';
import type { ElevationBackfillState } from '@/features/routes/hooks/useElevationBackfill';

/**
 * Scenario: the elevation download holds the detector flip, and the only place
 * it has ever reported itself is three taps into Settings.
 *
 * Expected behaviour: the sections page carries the progress, beside the
 * paused chip that says the detection is waiting on it. The row is there for
 * the duration of the migration and goes when nothing is owed.
 */

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

const BASE = {
  searchQuery: '',
  onSearchChange: jest.fn(),
  displaySectionCount: 12,
  unacceptedAutoCount: 0,
  acceptAllResult: null,
  isScanning: false,
  detectionHold: null,
  onAcceptAll: jest.fn(),
  onRescan: jest.fn(),
};

function backfill(over: Partial<ElevationBackfillState> = {}): ElevationBackfillState {
  return {
    phase: 'idle',
    completed: 0,
    total: 0,
    failed: 0,
    remaining: null,
    isRunning: false,
    ...over,
  };
}

function renderHeader(elevation: ElevationBackfillState) {
  return render(<SectionsListHeader {...BASE} elevationBackfill={elevation} />);
}

describe('SectionsListHeader elevation progress', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  beforeEach(async () => {
    await changeLanguage('en-AU');
  });

  it('counts the pass while one runs', () => {
    const tree = renderHeader(
      backfill({ phase: 'fetching', isRunning: true, completed: 40, total: 312 })
    );

    expect(tree.getByTestId('elevation-backfill-row')).toBeTruthy();
    expect(tree.getByText('40 of 312 activities')).toBeTruthy();
  });

  it('counts what is still owed at rest', () => {
    const tree = renderHeader(backfill({ remaining: 7 }));

    expect(tree.getByTestId('elevation-backfill-row')).toBeTruthy();
    expect(tree.getByText('7 activity tracks still need elevation.')).toBeTruthy();
  });

  it('reads a single owed track as one', () => {
    const tree = renderHeader(backfill({ remaining: 1 }));

    expect(tree.getByText('1 activity track still needs elevation.')).toBeTruthy();
  });

  it('says nothing once the queue is empty', () => {
    expect(
      renderHeader(backfill({ remaining: 0 })).queryByTestId('elevation-backfill-row')
    ).toBeNull();
    expect(
      renderHeader(backfill({ phase: 'complete', remaining: 0 })).queryByTestId(
        'elevation-backfill-row'
      )
    ).toBeNull();
  });

  it('says nothing when the engine could not answer, rather than reading as finished', () => {
    expect(
      renderHeader(backfill({ remaining: null })).queryByTestId('elevation-backfill-row')
    ).toBeNull();
  });

  it('still counts what is owed after a pass that only got part way', () => {
    const tree = renderHeader(backfill({ phase: 'partial', remaining: 9 }));

    expect(tree.getByText('9 activity tracks still need elevation.')).toBeTruthy();
  });

  it('carries the count beside the paused chip, since one explains the other', () => {
    const tree = render(
      <SectionsListHeader
        {...BASE}
        detectionHold="elevation"
        elevationBackfill={backfill({ phase: 'fetching', isRunning: true, completed: 2, total: 5 })}
      />
    );

    expect(tree.getByTestId('detection-paused')).toBeTruthy();
    expect(tree.getByTestId('elevation-backfill-row')).toBeTruthy();
  });

  it('draws no row when the caller passes no backfill state at all', () => {
    expect(
      render(<SectionsListHeader {...BASE} />).queryByTestId('elevation-backfill-row')
    ).toBeNull();
  });
});
