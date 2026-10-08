import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Swipeable from 'react-native-gesture-handler/Swipeable';

import { initialiseI18n } from '@/i18n';
import { SectionsList } from '@/features/routes/components/SectionsList';
import type { SectionWithPolyline } from 'veloqrs';

/**
 * Scenario: the sections tab mounts over the page the screen read returned,
 * with the real section commands wired in.
 *
 * Expected behaviour: the list takes no engine read of its own beside that
 * page. Deleting a custom section is a command, and the command needs no list
 * of custom sections read before it can run.
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

/** Every engine method the list reaches, recorded by name. */
const mockCalls: string[] = [];
const mockEngine = new Proxy(
  {},
  {
    get: (_target, name: string) => {
      if (name === 'subscribe') return () => () => {};
      if (name === 'then') return undefined;
      return (...args: unknown[]) => {
        mockCalls.push(name);
        if (name === 'deleteSection') return true;
        if (name === 'getSectionsByType') return [];
        return args.length ? undefined : null;
      };
    },
  }
);

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
}));

const record = (id: string, name: string): SectionWithPolyline =>
  ({
    id,
    name,
    sectionType: 'custom',
    sportTypes: ['Ride'],
    encodedPolyline: '',
    distanceMeters: 1000,
    visitCount: 3,
    isUserDefined: true,
    disabled: false,
  }) as unknown as SectionWithPolyline;

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SectionsList
        batchSections={[record('custom_ridge', 'Ridge loop'), record('custom_weir', 'Weir path')]}
        totalSectionCount={2}
        sortOption="name"
        onSortChange={jest.fn()}
        searchQuery=""
        onSearchChange={jest.fn()}
        hiddenFilters={{ custom: false, auto: false, disabled: true, unaccepted: false }}
        onHiddenFiltersChange={jest.fn()}
        unacceptedAutoCount={0}
        acceptedAutoCount={0}
        customSectionCount={2}
        retiredSectionCount={0}
      />
    </QueryClientProvider>
  );
}

describe('the sections tab over its screen read', () => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  beforeEach(() => {
    mockCalls.length = 0;
  });

  it('reads nothing from the engine beside the page it was given', async () => {
    renderList();
    await act(async () => {
      await Promise.resolve();
    });

    expect(mockCalls).toEqual([]);
  });

  it('still deletes a custom section through the engine', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = renderList();
    const rows = tree.UNSAFE_getAllByType(Swipeable);
    const swipe = render(rows[1].props.renderRightActions(null, { interpolate: () => 1 }));

    fireEvent.press(swipe.getByText('Delete'));
    const confirm = alert.mock.calls[0][2]?.find((button) => button.style === 'destructive');
    await act(async () => {
      await confirm?.onPress?.();
    });

    expect(mockCalls).toContain('deleteSection');
    expect(mockCalls).not.toContain('getSectionsByType');
    alert.mockRestore();
  });
});
