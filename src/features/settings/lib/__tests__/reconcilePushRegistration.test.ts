// Scenario: the root layout reconciles push registration on launch through the
// settings barrel. Expected behaviour: the barrel exports every name the launch
// path needs, and each branch runs without throwing.

const mockEnsure = jest.fn().mockResolvedValue(undefined);
const mockUnregister = jest.fn().mockResolvedValue(true);

jest.mock('../pushTokenRegistration', () => ({
  ensurePushTokenRegistered: (...a: unknown[]) => mockEnsure(...a),
  unregisterPushToken: (...a: unknown[]) => mockUnregister(...a),
  refreshPushTokenRegistration: jest.fn(),
  registerPushToken: jest.fn(),
}));

const mockPrefs = jest.fn();
const mockPendingFor = jest.fn();
const mockRetry = jest.fn();
jest.mock('../../stores/NotificationPreferencesStore', () => ({
  getNotificationPreferences: () => mockPrefs(),
  resolvePendingUnregisterAthleteId: () => mockPendingFor(),
  retryPendingUnregister: (id: string) => mockRetry(id),
  initializeNotificationPreferences: jest.fn(),
  isPrivacyNoticeOwed: jest.fn(),
}));

const mockAuth = jest.fn();
jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: { getState: () => mockAuth() },
}));

describe('reconcilePushRegistrationOnLaunch', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is exported by the settings barrel', () => {
    const barrel = require('@/features/settings');
    expect(typeof barrel.reconcilePushRegistrationOnLaunch).toBe('function');
  });

  it('registers when notifications are on for a real session', () => {
    mockPrefs.mockReturnValue({ enabled: true });
    mockAuth.mockReturnValue({ athleteId: 'i1', isDemoMode: false });
    const { reconcilePushRegistrationOnLaunch } = require('@/features/settings');
    expect(() => reconcilePushRegistrationOnLaunch()).not.toThrow();
    expect(mockEnsure).toHaveBeenCalledWith('i1');
    expect(mockRetry).not.toHaveBeenCalled();
  });

  it('retries a pending unregister for the recorded athlete when notifications are off', () => {
    mockPrefs.mockReturnValue({ enabled: false });
    mockAuth.mockReturnValue({ athleteId: null, isDemoMode: false });
    mockPendingFor.mockReturnValue('i9');
    const { reconcilePushRegistrationOnLaunch } = require('@/features/settings');
    expect(() => reconcilePushRegistrationOnLaunch()).not.toThrow();
    expect(mockRetry).toHaveBeenCalledWith('i9');
    expect(mockEnsure).not.toHaveBeenCalled();
  });

  it('does nothing when notifications are off and nothing is pending', () => {
    mockPrefs.mockReturnValue({ enabled: false });
    mockAuth.mockReturnValue({ athleteId: 'i1', isDemoMode: false });
    mockPendingFor.mockReturnValue(null);
    const { reconcilePushRegistrationOnLaunch } = require('@/features/settings');
    reconcilePushRegistrationOnLaunch();
    expect(mockRetry).not.toHaveBeenCalled();
    expect(mockEnsure).not.toHaveBeenCalled();
  });

  it('treats demo mode as signed out', () => {
    mockPrefs.mockReturnValue({ enabled: true });
    mockAuth.mockReturnValue({ athleteId: 'i1', isDemoMode: true });
    mockPendingFor.mockReturnValue(null);
    const { reconcilePushRegistrationOnLaunch } = require('@/features/settings');
    reconcilePushRegistrationOnLaunch();
    expect(mockEnsure).not.toHaveBeenCalled();
  });
});
