import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import { SectionsList } from '@/features/routes/components/SectionsList';
import { DEFAULT_SECTION_HIDE_FLAGS } from '@/features/routes/lib/routesScreenQuery';
import type { SectionWithPolyline } from 'veloqrs';

/**
 * Scenario: the athlete deletes one of their own sections from the list, and
 * the engine refuses the delete.
 * Expected behaviour: the list says the section was not deleted, as the
 * activity screen does for the same command, rather than leaving the row with
 * no word on why it is still there.
 */

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/app', () => ({
  useTheme: () => ({
    isDark: false,
    colors: { text: '#000000', textSecondary: '#666666', textOnDark: '#ffffff' },
  }),
  useMetricSystem: () => true,
  useAppSettings: () => ({ settings: {} }),
}));
jest.mock('@/shared/app/useCacheDays', () => ({ useCacheDays: () => 30 }));
jest.mock('@/features/routes/hooks/useSectionRescan', () => ({
  useSectionRescan: () => ({ rescan: jest.fn(), isScanning: false, refusal: null }),
}));
jest.mock('@/features/routes/hooks/useDetectionHold', () => ({
  useDetectionHold: () => null,
}));
jest.mock('@/features/routes/hooks/useElevationBackfill', () => ({
  useElevationBackfill: () => undefined,
}));
const mockRemoveSection = jest.fn();
jest.mock('@/features/routes/hooks/useCustomSections', () => ({
  useSectionCommands: () => ({ removeSection: mockRemoveSection }),
}));
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ enableSection: jest.fn() }),
}));

const MINE = {
  id: 'custom_harbour',
  name: 'Harbour loop',
  sectionType: 'custom',
  sportTypes: ['Ride'],
  encodedPolyline: '',
  distanceMeters: 1000,
  visitCount: 3,
  isUserDefined: true,
  disabled: false,
} as unknown as SectionWithPolyline;

async function deleteHarbourLoop() {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await render(
    <SectionsList
      batchSections={[MINE]}
      totalSectionCount={1}
      shownSectionCount={1}
      sortOption="name"
      onSortChange={jest.fn()}
      searchQuery=""
      onSearchChange={jest.fn()}
      hiddenFilters={DEFAULT_SECTION_HIDE_FLAGS}
      onHiddenFiltersChange={jest.fn()}
      onClearFilters={jest.fn()}
      unacceptedAutoCount={0}
      acceptedAutoCount={0}
      customSectionCount={1}
      retiredSectionCount={0}
    />
  );
  const row = screen.getByRole('button', { name: /Harbour loop/ });
  await fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'delete' } });
  const confirm = alert.mock.calls[0][2]?.find((button) => button.style === 'destructive');
  await act(async () => {
    await confirm?.onPress?.();
  });
  return alert;
}

describe('deleting a section from the list', () => {
  beforeAll(async () => {
    await initialiseI18n('en-GB');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    mockRemoveSection.mockReset();
  });

  it('says the section was not deleted when the engine refuses', async () => {
    mockRemoveSection.mockRejectedValue(new Error('database is locked'));
    const alert = await deleteHarbourLoop();

    expect(mockRemoveSection).toHaveBeenCalledWith('custom_harbour');
    expect(alert).toHaveBeenCalledTimes(2);
    expect(alert.mock.calls[1][0]).toBe('Section not deleted');
    expect(alert.mock.calls[1][1]).toBe('The section could not be deleted.');
  });

  it('says nothing more once the delete lands', async () => {
    mockRemoveSection.mockResolvedValue(undefined);
    const alert = await deleteHarbourLoop();

    expect(mockRemoveSection).toHaveBeenCalledWith('custom_harbour');
    expect(alert).toHaveBeenCalledTimes(1);
  });
});
