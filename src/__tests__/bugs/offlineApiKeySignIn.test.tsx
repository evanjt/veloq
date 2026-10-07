/**
 * Scenario: the athlete signs out on a plane. Both login paths make an
 * unconditional network round trip, so there is no way back into a device full
 * of their own data.
 *
 * Expected behaviour: the typed key is held, the screen says it will sign in
 * when the radio comes back, and nothing is marked authenticated on trust. The
 * real validation and the athlete-identity check run on the reconnect edge.
 */
import { renderHook, act } from '@testing-library/react-native';
import { CallKind, validateCredentials } from 'veloqrs';

import { useApiKeyLogin } from '@/features/auth/hooks/useApiKeyLogin';
import { readPendingApiKey, signInPlan } from '@/features/auth/lib/pendingSignIn';
import { useAuthStore } from '@/shared/app/AuthStore';
import { replaceTo } from '@/shared/app/navigation';

jest.mock('veloqrs', () => ({
  ...require('../__shared__/veloqrsStub').withOverrides(),
  validateCredentials: jest.fn(),
}));

jest.mock('@/shared/app/navigation', () => ({ replaceTo: jest.fn() }));
jest.mock('@/shared/storage', () => ({
  clearAccountData: jest.fn(async () => undefined),
  clearAuthOnly: jest.fn(async () => undefined),
}));
jest.mock('@/features/auth/lib/accountChange', () => ({
  accountChangeAction: jest.fn(() => 'keep'),
  settleBeforeNamingLibrary: jest.fn(async () => undefined),
  confirmAccountChange: jest.fn(async () => true),
  getCachedAthleteId: jest.fn(async () => null),
}));
jest.mock('@/features/auth/lib/storedActivityCount', () => ({
  resolveStoredActivityCount: jest.fn(async () => 0),
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({}),
}));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const mockIsOnline = jest.fn(() => true);
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: mockIsOnline() }),
  useIsOnline: () => mockIsOnline(),
}));

const held: { key: string | null } = { key: null };
jest.mock('@/features/auth/lib/pendingSignIn', () => {
  const actual = jest.requireActual('@/features/auth/lib/pendingSignIn');
  return {
    ...actual,
    savePendingApiKey: jest.fn(async (key: string) => {
      held.key = key;
    }),
    readPendingApiKey: jest.fn(async () => held.key),
    clearPendingApiKey: jest.fn(async () => {
      held.key = null;
    }),
  };
});

const mockValidateCredentials = validateCredentials as jest.Mock;

describe('what a sign-in attempt should do', () => {
  it('validates a key while the radio is up', () => {
    expect(signInPlan(true, 'a-key')).toBe('validate');
  });

  it('queues a key while the radio is down', () => {
    expect(signInPlan(false, 'a-key')).toBe('queue');
  });

  it('refuses an empty key either way', () => {
    expect(signInPlan(true, '   ')).toBe('empty');
    expect(signInPlan(false, '')).toBe('empty');
  });
});

describe('signing in with no network', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    held.key = null;
    mockIsOnline.mockReturnValue(true);
    mockValidateCredentials.mockResolvedValue({ kind: CallKind.Ok, id: '350768' });
    useAuthStore.setState({ setCredentials: jest.fn(async () => undefined) } as never);
  });

  function login() {
    const setError = jest.fn();
    const { result } = renderHook(() => useApiKeyLogin({ setError }));
    return { setError, result };
  }

  it('asks the network for nothing and signs nobody in', async () => {
    mockIsOnline.mockReturnValue(false);
    const { result } = login();

    await act(async () => {
      await result.current.handleApiKeyLogin('a-valid-key');
    });

    expect(mockValidateCredentials).not.toHaveBeenCalled();
    expect(replaceTo).not.toHaveBeenCalled();
    expect(useAuthStore.getState().setCredentials).not.toHaveBeenCalled();
  });

  it('holds the key and says it will sign in when the radio is back', async () => {
    mockIsOnline.mockReturnValue(false);
    const { result } = login();

    await act(async () => {
      await result.current.handleApiKeyLogin('a-valid-key');
    });

    expect(held.key).toBe('a-valid-key');
    expect(result.current.queuedMessage).toBe('login.queuedOffline');
  });

  it('runs the real check and signs in when the radio comes back', async () => {
    mockIsOnline.mockReturnValue(false);
    const { result, rerender } = renderHookWithNetwork();

    await act(async () => {
      await result.current.handleApiKeyLogin('a-valid-key');
    });

    mockIsOnline.mockReturnValue(true);
    await act(async () => {
      rerender({});
    });

    expect(mockValidateCredentials).toHaveBeenCalledWith('api_key', 'a-valid-key');
    expect(useAuthStore.getState().setCredentials).toHaveBeenCalledWith('a-valid-key', '350768');
    expect(held.key).toBeNull();
  });

  it('drops a held key the server rejects, rather than retrying it for ever', async () => {
    mockIsOnline.mockReturnValue(false);
    const { setError, result, rerender } = renderHookWithNetwork();

    await act(async () => {
      await result.current.handleApiKeyLogin('a-stale-key');
    });

    mockValidateCredentials.mockResolvedValue({ kind: CallKind.Http, status: 401 });
    mockIsOnline.mockReturnValue(true);
    await act(async () => {
      rerender({});
    });

    expect(setError).toHaveBeenCalledWith('login.invalidApiKey');
    expect(held.key).toBeNull();
    expect(useAuthStore.getState().setCredentials).not.toHaveBeenCalled();
  });

  it('holds the key when the radio comes back and the server cannot be reached', async () => {
    mockIsOnline.mockReturnValue(false);
    const { result, rerender } = renderHookWithNetwork();

    await act(async () => {
      await result.current.handleApiKeyLogin('a-valid-key');
    });

    mockValidateCredentials.mockResolvedValue({ kind: CallKind.Http, status: 503 });
    mockIsOnline.mockReturnValue(true);
    await act(async () => {
      rerender({});
    });

    expect(held.key).toBe('a-valid-key');
  });

  it('still validates straight away while the radio is up', async () => {
    const { result } = login();

    await act(async () => {
      await result.current.handleApiKeyLogin('a-valid-key');
    });

    expect(mockValidateCredentials).toHaveBeenCalledWith('api_key', 'a-valid-key');
    expect(replaceTo).toHaveBeenCalledWith('/');
    expect(held.key).toBeNull();
  });

  it('validates a held key once on an online relaunch', async () => {
    held.key = 'held-key';
    login();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockValidateCredentials).toHaveBeenCalledTimes(1);
    expect(mockValidateCredentials).toHaveBeenCalledWith('api_key', 'held-key');
    expect(held.key).toBeNull();
  });

  it('shows a held key on an offline relaunch and lets the athlete discard it', async () => {
    held.key = 'held-key';
    mockIsOnline.mockReturnValue(false);
    const { result } = login();
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.queuedMessage).toBe('login.queuedOffline');
    await act(async () => {
      await result.current.discardQueuedKey();
    });
    expect(held.key).toBeNull();
    expect(result.current.queuedMessage).toBeNull();
  });

  it('validates a held key when reconnection overlaps the first storage read', async () => {
    held.key = 'held-key';
    mockIsOnline.mockReturnValue(false);
    let finishRead: (value: string | null) => void = () => {};
    jest.mocked(readPendingApiKey).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        })
    );
    const { rerender } = renderHookWithNetwork();
    mockIsOnline.mockReturnValue(true);
    await act(async () => {
      rerender({});
    });
    await act(async () => {
      finishRead('held-key');
      await Promise.resolve();
    });
    expect(mockValidateCredentials).toHaveBeenCalledWith('api_key', 'held-key');
    expect(held.key).toBeNull();
  });

  it('does not validate a queued key discarded during its storage read', async () => {
    mockIsOnline.mockReturnValue(false);
    const { result, rerender } = renderHookWithNetwork();
    await act(async () => {
      await result.current.handleApiKeyLogin('held-key');
    });
    let finishRead: (value: string | null) => void = () => {};
    jest.mocked(readPendingApiKey).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        })
    );
    mockIsOnline.mockReturnValue(true);
    await act(async () => {
      rerender({});
    });
    await act(async () => {
      await result.current.discardQueuedKey();
      finishRead('held-key');
    });
    expect(mockValidateCredentials).not.toHaveBeenCalled();
    expect(held.key).toBeNull();
  });

  function renderHookWithNetwork() {
    const setError = jest.fn();
    const { result, rerender } = renderHook(() => useApiKeyLogin({ setError }), {
      initialProps: {},
    });
    return { setError, result, rerender };
  }
});
