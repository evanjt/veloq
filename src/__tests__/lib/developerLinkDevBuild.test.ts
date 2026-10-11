/**
 * Scenario: the test flows drive the development build from a fresh install
 * and open a developer screen by link, with the settings switch never
 * unlocked.
 * Expected behaviour: the development build opens a developer screen from a
 * link with the switch locked, and still refuses a sheet.
 */

import { redirectSystemPath } from '@/app/+native-intent';
import { useDebugStore } from '@/features/settings';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return {
    ...actual,
    __esModule: true,
    default: {
      ...actual.default,
      expoConfig: {
        scheme: 'veloq',
        android: { package: 'com.veloq.app.dev' },
        ios: { bundleIdentifier: 'com.veloq.app.dev' },
      },
    },
  };
});

describe('redirectSystemPath in the development build', () => {
  beforeEach(() => useDebugStore.setState({ unlocked: false }));

  it.each(['veloq://debug', 'veloq://detection-preview'])(
    'opens %s with the switch locked',
    async (link) => {
      await expect(redirectSystemPath({ path: link, initial: false })).resolves.toBe(link);
    }
  );

  it('opens nothing from a link to a sheet', async () => {
    await expect(
      redirectSystemPath({ path: 'veloq://sheets/param-editor', initial: false })
    ).resolves.toBeNull();
  });
});
