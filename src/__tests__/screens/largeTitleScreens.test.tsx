/**
 * Scenario: the plain list and form screens under the native header take a collapsing large title
 * on iOS, which only holds when each screen's scroll view lets the system inset its content.
 *
 * Expected behaviour: each of these routes sets `largeTitle` in `SCREEN_HEADERS`, and rendered on
 * iOS its first scroll view has `contentInsetAdjustmentBehavior: 'automatic'`.
 */

import React from 'react';
import { Platform, ScrollView } from 'react-native';
import { render } from '@testing-library/react-native';

import { headerLargeTitle } from '@/shared/app/screenHeaders';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').fallbackOrKey());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));

jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));

jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ athlete: null, data: null }) }));

jest.mock('@/shared/storage/gpsStorage', () => ({
  getAppStorageSize: jest.fn().mockResolvedValue(0),
}));

jest.mock('@/features/routes/hooks/useNamedCorridors', () => ({
  useNamedCorridors: () => ({ corridors: [], remove: jest.fn() }),
}));

jest.mock('@/features/routes/lib/sectionDisplayNames', () => ({
  getAllSectionDisplayNames: () => ({}),
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    subscribe: () => () => undefined,
    getRetiredSections: () => [],
  }),
  isEngineReady: () => true,
}));

// The feature barrels are replaced by components that render nothing, so the screen under test is
// the only thing whose scroll view is looked at.
jest.mock('@/features/settings', () => {
  const stub = () => null;
  return new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === '__esModule') return false;
        if (typeof key !== 'string') return undefined;
        if (key.startsWith('use'))
          return () => ({
            preferences: { defaultStyle: 'outdoors', terrain3DMode: 'off' },
            data: null,
          });
        return stub;
      },
    }
  );
});
jest.mock('@/features/settings/components', () => {
  const stub = () => null;
  return new Proxy(
    {},
    { get: (_t, key) => (key === '__esModule' || typeof key !== 'string' ? undefined : stub) }
  );
});

const ROUTES = [
  'about',
  'account',
  'backup-settings',
  'cache-settings',
  'data-sources-settings',
  'display-settings',
  'licenses',
  'map-settings',
  'named-corridors',
  'notification-settings',
  'section-retired',
  'settings',
  'summary-card-settings',
  'sync-settings',
];

describe('large-title list and form screens', () => {
  it.each(ROUTES)('%s takes a large title on iOS', (route) => {
    expect(headerLargeTitle(route, 'ios')).toBe(true);
    expect(headerLargeTitle(route, 'android')).toBe(false);
  });

  it.each(ROUTES)('%s lets the system inset its scroll view on iOS', async (route) => {
    Platform.OS = 'ios';
    const Screen: React.ComponentType = require(`@/app/${route}`).default;
    const { UNSAFE_getAllByType } = await render(<Screen />);

    const scroll = UNSAFE_getAllByType(ScrollView)[0];
    expect(scroll.props.contentInsetAdjustmentBehavior).toBe('automatic');
  });
});
