import React from 'react';
import { render } from '@testing-library/react-native';

import { initializeI18n, changeLanguage } from '@/i18n';
import { SectionsListHeader } from '@/features/routes/components/SectionsListHeader';
import type { DetectionHold } from '@/features/routes/hooks/useDetectionHold';
import { StartOutcome } from 'veloqrs';

/**
 * Scenario: an install upgrading from 0.3.x arrives with a catalogue the
 * detector migration has not run over yet, and a library whose tracks have no
 * elevation. The engine refuses to detect for both reasons in turn.
 *
 * Expected behaviour: the page says which one is holding, because the two end
 * differently, and the rescan control is disabled while either does.
 */

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

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
  onAcceptAll: jest.fn(),
  onRescan: jest.fn(),
};

function renderHeader(detectionHold: DetectionHold) {
  return render(<SectionsListHeader {...BASE} detectionHold={detectionHold} />);
}

describe('SectionsListHeader detection hold', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  beforeEach(async () => {
    await changeLanguage('en-AU');
  });

  it('names the migration when the cutover is holding', () => {
    const tree = renderHeader('cutover');

    expect(tree.getByTestId('detection-paused')).toBeTruthy();
    expect(tree.getByText('Detection paused while your sections migrate')).toBeTruthy();
  });

  it('names the elevation download while a pass is running', () => {
    const tree = renderHeader('elevation-running');

    expect(tree.getByTestId('detection-paused')).toBeTruthy();
    expect(tree.getByText('Detection paused while elevation downloads')).toBeTruthy();
  });

  it('says the same for a queue nothing is working on, which is still owed', () => {
    const tree = renderHeader('elevation-waiting');

    expect(tree.getByText('Detection paused while elevation downloads')).toBeTruthy();
  });

  /**
   * A pause was indistinguishable from a download in flight, and it is the one
   * hold the athlete can lift, so it is the one that has to say where.
   */
  it('points a paused download at the control that resumes it', () => {
    const tree = renderHeader('elevation-paused');

    expect(tree.getByTestId('detection-paused')).toBeTruthy();
    expect(
      tree.getByText('Detection is held until you resume the elevation download in Settings')
    ).toBeTruthy();
  });

  /**
   * Scenario: the athlete taps rescan with route matching switched off. The
   * engine refuses, and before this the tap did nothing visible at all.
   *
   * Expected behaviour: the refusal is named, and a switch the athlete holds
   * reads differently from a hold that lifts by itself.
   */
  it('names a refused rescan, and says which refusal it was', () => {
    const off = render(
      <SectionsListHeader
        {...BASE}
        detectionHold={null}
        rescanRefusal={StartOutcome.NotConfigured}
      />
    );
    expect(off.getByTestId('rescan-refused')).toBeTruthy();
    expect(off.getByText('Route matching is off. Turn it on in Settings to scan.')).toBeTruthy();

    const busy = render(
      <SectionsListHeader {...BASE} detectionHold={null} rescanRefusal={StartOutcome.Busy} />
    );
    expect(busy.getByText('A scan is already running.')).toBeTruthy();
  });

  it('says nothing about a refusal until there is one', () => {
    const tree = render(
      <SectionsListHeader {...BASE} detectionHold={null} rescanRefusal={StartOutcome.Started} />
    );

    expect(tree.queryByTestId('rescan-refused')).toBeNull();
  });

  it('says nothing once neither holds', () => {
    const tree = renderHeader(null);

    expect(tree.queryByTestId('detection-paused')).toBeNull();
  });
});
