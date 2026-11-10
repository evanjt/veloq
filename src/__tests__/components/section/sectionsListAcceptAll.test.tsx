import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { initialiseI18n } from '@/i18n';
import { SectionsList } from '@/features/routes/components/SectionsList';
import { DEFAULT_SECTION_HIDE_FLAGS } from '@/features/routes/lib/routesScreenQuery';
import type { SectionWithPolyline } from 'veloqrs';

/**
 * Scenario: the athlete confirms Accept all, and the engine answers with
 * either a count or a refusal because it is not open.
 * Expected behaviour: a count is shown as the accepted total, and a refusal is
 * said as a failed accept, with no "accepted" line in the header.
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
const mockAcceptAllSections = jest.fn();
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ acceptAllSections: mockAcceptAllSections }),
}));

const AUTO = {
  id: 'auto_quay',
  name: 'Quay climb',
  sectionType: 'auto',
  sportTypes: ['Ride'],
  encodedPolyline: '',
  distanceMeters: 1000,
  visitCount: 3,
  isUserDefined: false,
  disabled: false,
} as unknown as SectionWithPolyline;

async function confirmAcceptAll() {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SectionsList
        batchSections={[AUTO]}
        totalSectionCount={1}
        shownSectionCount={1}
        sortOption="name"
        onSortChange={jest.fn()}
        searchQuery=""
        onSearchChange={jest.fn()}
        hiddenFilters={DEFAULT_SECTION_HIDE_FLAGS}
        onHiddenFiltersChange={jest.fn()}
        onClearFilters={jest.fn()}
        unacceptedAutoCount={1}
        acceptedAutoCount={0}
        customSectionCount={0}
        removedSectionCount={0}
      />
    </QueryClientProvider>
  );
  fireEvent.press(screen.getByText('Accept all'));
  const confirm = alert.mock.calls[0][2]?.find((button) => button.text === 'Accept all');
  await act(async () => {
    await confirm?.onPress?.();
  });
  return alert;
}

describe('accepting every auto section from the list', () => {
  beforeAll(async () => {
    await initialiseI18n('en-GB');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    mockAcceptAllSections.mockReset();
  });

  it('says the accept failed and shows no count when the engine is not open', async () => {
    mockAcceptAllSections.mockReturnValue(null);
    const alert = await confirmAcceptAll();

    expect(mockAcceptAllSections).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledTimes(2);
    expect(alert.mock.calls[1][0]).toBe('Sections not accepted');
    expect(screen.queryByText(/Accepted \d+ section/)).toBeNull();
  });

  it('shows the accepted count in the header when the engine accepts', async () => {
    mockAcceptAllSections.mockReturnValue(3);
    const alert = await confirmAcceptAll();

    expect(alert).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Accepted 3 sections')).toBeTruthy();
  });
});
