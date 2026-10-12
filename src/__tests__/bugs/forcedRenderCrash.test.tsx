/**
 * Scenario: a debug build is asked, natively, to throw once under the root
 * error boundary, so the global crash screen can be reached on a device.
 * Expected behaviour: each mount reads the request once, the fallback renders,
 * the request is spent, and the next mount renders the app. With no request, or no
 * native module at all as in a release build's absence of a trigger, nothing
 * throws.
 */
import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

import { ForcedRenderCrash } from '@/shared/debug/forcedRenderCrash';
import { GlobalErrorBoundary } from '@/shared/ui/GlobalErrorBoundary';

jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  requireOptionalNativeModule: jest.fn(),
}));
const mockRequireNativeModule = jest.mocked(requireOptionalNativeModule);
jest.mock('@/features/recording/lib/endRecordingSession', () => ({
  endRecordingSession: jest.fn(),
}));

async function mountApp() {
  return render(
    <GlobalErrorBoundary>
      <ForcedRenderCrash />
      <Text>orchard ledger</Text>
    </GlobalErrorBoundary>
  );
}

let consoleError: jest.SpyInstance;

beforeEach(() => {
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleError.mockRestore();
  mockRequireNativeModule.mockReset();
});

describe('the forced render crash', () => {
  it('reaches the global fallback once, then the next mount renders the app', async () => {
    const takeRequest = jest.fn().mockReturnValueOnce(true).mockReturnValue(false);
    mockRequireNativeModule.mockReturnValue({ takeRequest });
    const first = await mountApp();
    expect(first.getByText('Something went wrong')).toBeTruthy();
    expect(first.queryByText('orchard ledger')).toBeNull();
    first.unmount();

    const second = await mountApp();
    expect(second.getByText('orchard ledger')).toBeTruthy();
    expect(second.queryByText('Something went wrong')).toBeNull();
    expect(takeRequest).toHaveBeenCalledTimes(2);
    expect(takeRequest.mock.results.map((result) => result.value)).toEqual([true, false]);
    expect(mockRequireNativeModule).toHaveBeenCalledWith('VeloqDebugCrash');
  });

  it('holds the request through a render retry rather than spending it on the first attempt', async () => {
    const takeRequest = jest.fn().mockReturnValueOnce(true).mockReturnValue(false);
    mockRequireNativeModule.mockReturnValue({ takeRequest });
    const mounted = await mountApp();

    expect(mounted.getByText('Something went wrong')).toBeTruthy();
    expect(takeRequest).toHaveBeenCalledTimes(1);
  });

  it('renders the app when no crash was requested', async () => {
    mockRequireNativeModule.mockReturnValue({ takeRequest: jest.fn(() => false) });

    const mounted = await mountApp();

    expect(mounted.getByText('orchard ledger')).toBeTruthy();
  });

  it('renders the app when the native module is absent', async () => {
    mockRequireNativeModule.mockReturnValue(null);

    const mounted = await mountApp();

    expect(mounted.getByText('orchard ledger')).toBeTruthy();
  });

  it('renders the app when reading the request throws', async () => {
    mockRequireNativeModule.mockReturnValue({
      takeRequest: jest.fn(() => {
        throw new Error('bridge gone');
      }),
    });

    const mounted = await mountApp();

    expect(mounted.getByText('orchard ledger')).toBeTruthy();
  });
});
