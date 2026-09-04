import React from 'react';
import { render } from '@testing-library/react-native';

import { SectionsListHeader } from '@/features/routes/components/SectionsListHeader';

/**
 * Scenario: an install upgrading from 0.3.x arrives with a catalogue the
 * detector migration has not run over yet, so the engine refuses to detect
 * (`SB12`). Without a word on the sections page the rider taps rescan and
 * nothing happens.
 *
 * Expected behaviour: the page says detection is paused, and the rescan
 * control is disabled while it is.
 */

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

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

describe('SectionsListHeader detection hold', () => {
  it('says detection is paused while the migration is owed', () => {
    const { getByTestId, getByText } = render(
      <SectionsListHeader {...BASE} detectionHeld={true} />
    );

    expect(getByTestId('detection-paused')).toBeTruthy();
    expect(getByText('sections.detectionPaused')).toBeTruthy();
  });

  it('says nothing once the migration has run', () => {
    const { queryByTestId } = render(<SectionsListHeader {...BASE} detectionHeld={false} />);

    expect(queryByTestId('detection-paused')).toBeNull();
  });
});
