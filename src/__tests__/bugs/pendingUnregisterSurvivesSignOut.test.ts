/**
 * Scenario: notifications turned off while offline leave the unregister
 * pending. The athlete then signs out, which deletes the athlete id, and the
 * launch retry read the id from the auth store. Its guard never passed again,
 * so the device stayed registered and kept receiving pushes.
 *
 * Expected behaviour: the id the unregister needs is recorded with the request
 * and outlives the credential.
 */

import {
  useNotificationPreferences,
  getNotificationPreferences,
  resolvePendingUnregisterAthleteId,
} from '@/features/settings/stores/NotificationPreferencesStore';

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn().mockResolvedValue(null),
  setSetting: jest.fn().mockResolvedValue(undefined),
}));

const mockUnregister = jest.fn().mockResolvedValue(false);
jest.mock('@/features/settings/lib/pushTokenRegistration', () => ({
  registerPushToken: jest.fn(),
  unregisterPushToken: (id: string) => mockUnregister(id),
  ensurePushTokenRegistered: jest.fn(),
}));

const mockAuth: { athleteId: string | null } = { athleteId: 'i12345' };
jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: { getState: () => mockAuth },
}));

function signOut() {
  mockAuth.athleteId = null;
}

beforeEach(() => {
  mockAuth.athleteId = 'i12345';
  mockUnregister.mockClear();
  useNotificationPreferences.setState({
    enabled: true,
    privacyAccepted: true,
    pendingUnregister: false,
    pendingUnregisterAthleteId: null,
  });
});

describe('a pending unregister', () => {
  it('records the athlete it was requested for', () => {
    useNotificationPreferences.getState().setEnabled(false);

    const prefs = getNotificationPreferences();
    expect(prefs.pendingUnregister).toBe(true);
    expect(prefs.pendingUnregisterAthleteId).toBe('i12345');
  });

  it('is still retryable after the sign-out has deleted the credential', () => {
    useNotificationPreferences.getState().setEnabled(false);
    signOut();

    expect(resolvePendingUnregisterAthleteId()).toBe('i12345');
  });

  it('has nothing to retry when none is pending', () => {
    expect(resolvePendingUnregisterAthleteId()).toBeNull();
  });

  it('forgets the athlete once the unregister lands', () => {
    useNotificationPreferences.getState().setEnabled(false);
    useNotificationPreferences.getState().clearPendingUnregister();

    expect(getNotificationPreferences().pendingUnregisterAthleteId).toBeNull();
    expect(resolvePendingUnregisterAthleteId()).toBeNull();
  });

  it('forgets the athlete when notifications are turned back on', () => {
    useNotificationPreferences.getState().setEnabled(false);
    useNotificationPreferences.getState().setEnabled(true);

    expect(getNotificationPreferences().pendingUnregisterAthleteId).toBeNull();
  });

  it('falls back to the signed-in athlete for a request recorded before this fix', () => {
    useNotificationPreferences.setState({
      enabled: false,
      pendingUnregister: true,
      pendingUnregisterAthleteId: null,
    });

    expect(resolvePendingUnregisterAthleteId()).toBe('i12345');
  });
});
