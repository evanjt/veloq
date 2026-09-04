import React from 'react';
import { render } from '@testing-library/react-native';

import { initializeI18n, changeLanguage } from '@/i18n';
import { SectionsListHeader } from '@/features/routes/components/SectionsListHeader';
import type { DetectionHold } from '@/features/routes/hooks/useDetectionHold';

/**
 * Scenario: an install upgrading from 0.3.x arrives with a catalogue the
 * detector migration has not run over yet, and a library whose tracks have no
 * elevation. The engine refuses to detect for both reasons in turn.
 *
 * Expected behaviour: the page says which one is holding, because the two end
 * differently, and the rescan control is disabled while either does.
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

  it('names the elevation download when the backfill is holding', () => {
    const tree = renderHeader('elevation');

    expect(tree.getByTestId('detection-paused')).toBeTruthy();
    expect(tree.getByText('Detection paused while elevation downloads')).toBeTruthy();
  });

  it('says nothing once neither holds', () => {
    const tree = renderHeader(null);

    expect(tree.queryByTestId('detection-paused')).toBeNull();
  });
});
