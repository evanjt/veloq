/**
 * Scenario: the home card's "Enable" registers a push token. Its copy is "Stay
 * in the loop. Get notified about new activities, sync progress, and when your
 * data is ready to explore." The privacy notice, which says the athlete id and
 * the token are stored on a server and routed through Expo, is shown only by
 * the settings toggle.
 *
 * Expected behaviour: nothing registers a token until the notice has been
 * accepted. A dev build was found holding `{"enabled":true,"privacyAccepted":false}`,
 * a pair no screen can write.
 */
import {
  useNotificationPreferences,
  getNotificationPreferences,
} from '@/features/settings/stores/NotificationPreferencesStore';

const stored: { value: string | null } = { value: null };
const mockSetSetting = jest.fn().mockResolvedValue(undefined);
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(() => Promise.resolve(stored.value)),
  setSetting: (key: string, value: string) => mockSetSetting(key, value),
}));

const mockRegister = jest.fn();
jest.mock('@/features/settings/lib/pushTokenRegistration', () => ({
  registerPushToken: (id: string) => mockRegister(id),
  unregisterPushToken: jest.fn().mockResolvedValue(true),
  ensurePushTokenRegistered: jest.fn(),
}));

jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: { getState: () => ({ athleteId: 'i12345' }) },
}));

/** What the last persist wrote, parsed. */
function lastPersisted(): Record<string, unknown> | null {
  const calls = mockSetSetting.mock.calls;
  if (calls.length === 0) return null;
  return JSON.parse(calls[calls.length - 1][1]);
}

beforeEach(() => {
  stored.value = null;
  mockSetSetting.mockClear();
  mockRegister.mockClear();
  useNotificationPreferences.setState({
    enabled: false,
    privacyAccepted: false,
    pendingUnregister: false,
    pendingUnregisterAthleteId: null,
    categories: { sectionPr: true, fitnessMilestone: true },
    isLoaded: true,
  });
});

describe('enabling without the privacy notice', () => {
  it('registers no token and enables nothing', () => {
    useNotificationPreferences.getState().setEnabled(true);

    expect(mockRegister).not.toHaveBeenCalled();
    expect(getNotificationPreferences().enabled).toBe(false);
  });

  it('never persists the pair the device was found holding', () => {
    useNotificationPreferences.getState().setEnabled(true);

    const written = lastPersisted();
    expect(written === null || written.enabled === false || written.privacyAccepted === true).toBe(
      true
    );
  });

  it('still enables once the notice is accepted', () => {
    useNotificationPreferences.getState().acceptPrivacy();
    useNotificationPreferences.getState().setEnabled(true);

    expect(mockRegister).toHaveBeenCalledWith('i12345');
    expect(getNotificationPreferences().enabled).toBe(true);
    expect(lastPersisted()).toMatchObject({ enabled: true, privacyAccepted: true });
  });

  it('turns off without asking for consent, since off needs none', () => {
    useNotificationPreferences.setState({ enabled: true, privacyAccepted: true });
    useNotificationPreferences.getState().setEnabled(false);

    expect(getNotificationPreferences().enabled).toBe(false);
  });
});
