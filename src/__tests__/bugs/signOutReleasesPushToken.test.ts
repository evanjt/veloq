/**
 * Scenario: an athlete with notifications on, or with an unregister left
 * pending, signs out. The sign-out deletes the credential the unregister
 * proves the athlete with.
 *
 * Expected behaviour: the DELETE reaches the server carrying the credential
 * that was live when sign-out began. When it does not land, the pending
 * request is cleared rather than recorded, since nothing could retry it once
 * the credential is gone.
 */

import { Alert } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useNotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';

jest.mock('expo-notifications', () => ({
  ...jest.requireActual('expo-notifications'),
  getExpoPushTokenAsync: jest.fn(),
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => null,
}));

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn().mockResolvedValue(null),
  setSetting: jest.fn().mockResolvedValue(undefined),
  removeSetting: jest.fn().mockResolvedValue(undefined),
}));

const mockFetch = jest.fn();
const realFetch = global.fetch;

beforeEach(() => {
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  (Notifications.getExpoPushTokenAsync as jest.Mock).mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve({ data: 'ExponentPushToken[abc]' }), 5))
  );
  useAuthStore.setState({
    athleteId: 'i12345',
    accessToken: 'live-token',
    apiKey: null,
    authMethod: 'oauth',
    isAuthenticated: true,
  });
  useNotificationPreferences.setState({
    enabled: true,
    privacyAccepted: true,
    pendingUnregister: false,
    pendingUnregisterAthleteId: null,
  });
});

afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

function deleteCalls() {
  return mockFetch.mock.calls.filter(([, init]) => init?.method === 'DELETE');
}

describe('sign-out with notifications on', () => {
  it('sends the unregister with the credential that was live when it began', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    await useAuthStore.getState().clearCredentials();

    expect(deleteCalls()).toHaveLength(1);
    const [url, init] = deleteCalls()[0];
    expect(url).toContain('/devices/unregister');
    expect(init.headers.Authorization).toContain('live-token');
    expect(JSON.parse(init.body)).toEqual({ athleteId: 'i12345', token: 'ExponentPushToken[abc]' });
    expect(useAuthStore.getState().accessToken).toBeNull();
  });

  it('clears the pending request and tells the athlete once when the unregister fails', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));

    await useAuthStore.getState().clearCredentials();

    const prefs = useNotificationPreferences.getState();
    expect(prefs.pendingUnregister).toBe(false);
    expect(prefs.pendingUnregisterAthleteId).toBeNull();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('says nothing when the unregister lands', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
    await useAuthStore.getState().clearCredentials();
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});

describe('sign-out with an unregister already pending', () => {
  beforeEach(() => {
    useNotificationPreferences.setState({
      enabled: false,
      pendingUnregister: true,
      pendingUnregisterAthleteId: 'i12345',
    });
  });

  it('sends the pending unregister before the credential is deleted', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    await useAuthStore.getState().clearCredentials();

    expect(deleteCalls()).toHaveLength(1);
    expect(deleteCalls()[0][1].headers.Authorization).toContain('live-token');
    expect(useNotificationPreferences.getState().pendingUnregister).toBe(false);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('clears it and tells the athlete when it cannot land', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 });

    await useAuthStore.getState().clearCredentials();

    expect(useNotificationPreferences.getState().pendingUnregister).toBe(false);
    expect(useNotificationPreferences.getState().pendingUnregisterAthleteId).toBeNull();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });
});

describe('sign-out with nothing registered', () => {
  it('makes no request and says nothing', async () => {
    useNotificationPreferences.setState({ enabled: false, pendingUnregister: false });

    await useAuthStore.getState().clearCredentials();

    expect(mockFetch).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});

describe('sign-out while the push token lookup never settles', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('finishes within the interactive deadline, clears the pending request and tells the athlete once', async () => {
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockImplementation(
      () => new Promise(() => {})
    );

    let settled = false;
    const signingOut = useAuthStore
      .getState()
      .clearCredentials()
      .then(() => {
        settled = true;
      });
    await jest.advanceTimersByTimeAsync(11_000);
    await signingOut;

    expect(settled).toBe(true);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
    expect(deleteCalls()).toHaveLength(0);
    expect(useNotificationPreferences.getState().pendingUnregister).toBe(false);
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });

  it('sends no late unregister when the token arrives after the deadline', async () => {
    let deliverToken: (value: { data: string }) => void = () => {};
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockImplementation(
      () =>
        new Promise((resolve) => {
          deliverToken = resolve;
        })
    );
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    const signingOut = useAuthStore.getState().clearCredentials();
    await jest.advanceTimersByTimeAsync(11_000);
    await signingOut;
    deliverToken({ data: 'ExponentPushToken[late]' });
    await jest.advanceTimersByTimeAsync(1_000);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });
});
