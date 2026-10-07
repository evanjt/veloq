import React from 'react';
import { View } from 'react-native';
import { render } from '@testing-library/react-native';

import CacheSettingsScreen from '@/app/cache-settings';

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
function mockActivityBar() {
  return React.createElement(View, { testID: 'background-jobs-activity' });
}
function mockCacheSection() {
  return React.createElement(View, { testID: 'data-cache-section' });
}
jest.mock('@/features/settings/components', () => ({
  BackgroundJobsActivityBar: mockActivityBar,
  DataCacheSection: mockCacheSection,
}));

it('shows the activity bar above the controls that start stream backfill', () => {
  const tree = render(<CacheSettingsScreen />);
  const ids = tree.root
    .findAll((node) => typeof node.props.testID === 'string')
    .map((node) => node.props.testID as string);

  expect(ids.indexOf('background-jobs-activity')).toBeGreaterThanOrEqual(0);
  expect(ids.indexOf('background-jobs-activity')).toBeLessThan(ids.indexOf('data-cache-section'));
});
