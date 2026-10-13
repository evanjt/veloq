/**
 * Scenario: an athlete tries the demo. The demo keeps nothing and ends when
 * the app closes, and it holds no API credentials.
 *
 * Expected behaviour: the login screen says so beneath Try Demo before it
 * starts, and in demo the sign-out row reads "Leave demo" with a confirm that
 * names no credentials. A real account keeps the Disconnect row and its copy.
 */

import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import LoginScreen from '@/app/login';
import { ProfileAccountSection } from '@/features/settings/components/ProfileAccountSection';
import { useAuthStore } from '@/shared/app/AuthStore';
import { i18n, initialiseI18n } from '@/i18n';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: true }),
  useIsOnline: () => true,
}));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ cancelQueries: jest.fn(async () => {}), clear: jest.fn() }),
}));
jest.mock('@/features/settings/hooks/exportIndex', () => ({
  useImportDatabaseBackup: () => ({ importDatabaseBackup: jest.fn(), importing: false }),
}));
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => null,
  isEngineReady: () => false,
}));

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

it('says beneath Try Demo that the demo keeps nothing and ends when the app closes', async () => {
  await render(<LoginScreen />);
  expect(
    screen.getByText('Sample rides. Nothing is kept, and the demo ends when the app closes.')
  ).toBeTruthy();
});

describe('the sign-out row', () => {
  let alert: jest.SpyInstance;
  beforeEach(() => {
    alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => alert.mockRestore());

  it('reads Leave demo in demo, and its confirm names no credentials', async () => {
    useAuthStore.setState({ authMethod: 'demo', clearCredentials: jest.fn(async () => {}) });
    await render(<ProfileAccountSection />);
    const row = screen.getByTestId('settings-logout-button');
    expect(screen.getByText('Leave demo')).toBeTruthy();
    expect(screen.queryByText(i18n.t('settings.disconnectAccount'))).toBeNull();

    await fireEvent.press(row);
    const [title, message, buttons] = alert.mock.calls[0];
    expect(`${title} ${message}`).not.toMatch(/credential|API/i);
    expect(message).toBe(i18n.t('alerts.leaveDemoMessage'));
    expect(title).toBe('Leave demo?');
    expect(buttons?.find((b: { style?: string }) => b.style === 'destructive')?.text).toBe('Leave');
  });

  it('keeps Disconnect and its credentials copy for a real account', async () => {
    useAuthStore.setState({ authMethod: 'oauth', clearCredentials: jest.fn(async () => {}) });
    await render(<ProfileAccountSection />);
    expect(screen.getByText(i18n.t('settings.disconnectAccount'))).toBeTruthy();
    await fireEvent.press(screen.getByTestId('settings-logout-button'));
    expect(alert.mock.calls[0][1]).toBe(i18n.t('alerts.disconnectMessage'));
  });
});
