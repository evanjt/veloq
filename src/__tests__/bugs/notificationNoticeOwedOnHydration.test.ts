/**
 * Scenario: an install updated from a release that wrote `enabled` true beside
 * `privacyAccepted` false. The athlete turned notifications on and granted the
 * OS permission, and its push token is registered.
 *
 * Expected behaviour: that pair hydrates as consented, stays enabled and
 * registered, writes the consent back so the next launch reads it, and is never
 * owed a notice; a fresh install and an install with notifications off are not
 * owed one either.
 */
import {
  useNotificationPreferences,
  isPrivacyNoticeOwed,
} from '@/features/settings/stores/NotificationPreferencesStore';

const stored: { value: string | null } = { value: null };
const mockSetSetting = jest.fn().mockResolvedValue(undefined);
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(() => Promise.resolve(stored.value)),
  setSetting: (key: string, value: string) => mockSetSetting(key, value),
}));

const mockUnregister = jest.fn().mockResolvedValue(true);
jest.mock('@/features/settings/lib/pushTokenRegistration', () => ({
  registerPushToken: jest.fn(),
  unregisterPushToken: (id: string) => mockUnregister(id),
  ensurePushTokenRegistered: jest.fn(),
}));

jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: { getState: () => ({ athleteId: 'i12345' }) },
}));

beforeEach(() => {
  stored.value = null;
  mockSetSetting.mockClear();
  mockUnregister.mockClear();
  useNotificationPreferences.setState({
    enabled: false,
    privacyAccepted: false,
    pendingUnregister: false,
    pendingUnregisterAthleteId: null,
    categories: { sectionPr: true, fitnessMilestone: true },
    isLoaded: false,
  });
});

function hydrate(pair: object) {
  stored.value = JSON.stringify(pair);
  return useNotificationPreferences.getState().initialize();
}

describe('an install already receiving notifications', () => {
  it('hydrates as consented, never owed, and stays enabled and registered', async () => {
    await hydrate({ enabled: true, privacyAccepted: false });

    const state = useNotificationPreferences.getState();
    expect(isPrivacyNoticeOwed(state)).toBe(false);
    expect(state.privacyAccepted).toBe(true);
    expect(state.enabled).toBe(true);
    expect(mockUnregister).not.toHaveBeenCalled();
  });

  it('writes the consent back so the next launch reads it', async () => {
    await hydrate({ enabled: true, privacyAccepted: false });

    const written = JSON.parse(mockSetSetting.mock.calls.at(-1)![1]);
    expect(written).toMatchObject({ enabled: true, privacyAccepted: true });
  });

  it('can still be turned off, which unregisters the token', async () => {
    await hydrate({ enabled: true, privacyAccepted: false });
    useNotificationPreferences.getState().setEnabled(false);

    expect(useNotificationPreferences.getState().enabled).toBe(false);
    expect(mockUnregister).toHaveBeenCalledWith('i12345');
  });

  it('is never owed on a fresh install or to an install that accepted', async () => {
    await useNotificationPreferences.getState().initialize();
    expect(isPrivacyNoticeOwed(useNotificationPreferences.getState())).toBe(false);
    expect(mockSetSetting).not.toHaveBeenCalled();

    await hydrate({ enabled: true, privacyAccepted: true });
    expect(isPrivacyNoticeOwed(useNotificationPreferences.getState())).toBe(false);

    await hydrate({ enabled: false, privacyAccepted: false });
    expect(isPrivacyNoticeOwed(useNotificationPreferences.getState())).toBe(false);
    expect(useNotificationPreferences.getState().privacyAccepted).toBe(false);
  });
});
