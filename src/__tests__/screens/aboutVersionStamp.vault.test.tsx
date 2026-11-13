/**
 * Scenario: About showed the version alone while the settings footer named
 * the commit, so the two screens described one build differently.
 *
 * Expected behaviour: About carries the same version line as the footer.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import AboutScreen from '@/app/about';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));

const mockExpoConfig: { version: string; extra: Record<string, unknown> } = {
  version: '0.9.3',
  extra: {},
};
jest.mock('expo-constants', () => ({
  ...jest.requireActual('expo-constants'),
  __esModule: true,
  default: {
    get expoConfig() {
      return mockExpoConfig;
    },
  },
}));

describe('the About version line', () => {
  it('names the commit the build was made from', async () => {
    mockExpoConfig.extra = { buildCommit: 'c0ffee123' };
    const { getByText } = await render(<AboutScreen />);
    expect(getByText(/0\.9\.3 \(c0ffee123\)/)).toBeTruthy();
  });

  it('is the version alone when the build carries no stamp', async () => {
    mockExpoConfig.extra = {};
    const { getByText, queryByText } = await render(<AboutScreen />);
    expect(getByText(/0\.9\.3/)).toBeTruthy();
    expect(queryByText(/0\.9\.3 \(/)).toBeNull();
  });
});
