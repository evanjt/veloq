/**
 * Scenario: a fresh install. The layout opens the engine only once the athlete
 * is authenticated, so at the sign-in screen there is no engine at all. The
 * athlete pastes a valid API key.
 *
 * Expected behaviour: the key is checked against intervals.icu and the sign-in
 * succeeds. Checking it needs no database, so a closed engine must not turn a
 * good key into "Failed to connect", which it did on every fresh install since
 * the engine guard landed.
 */
import { renderHook, act } from '@testing-library/react-native';
import { CallKind, validateCredentials } from 'veloqrs';

import { useApiKeyLogin } from '@/features/auth/hooks/useApiKeyLogin';
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

// The hook asks whether the radio is up before it asks the server, and this
// case is about what happens when it is.
jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: true }),
  useIsOnline: () => true,
}));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

// Declared after the mocks, not before: the factory is hoisted above every
// `const` in this file, so a mock named up there is still undefined when it
// runs and the module gets `undefined` where the function should be.
const mockValidateCredentials = validateCredentials as jest.Mock;

describe('API key sign-in with no engine open', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateCredentials.mockResolvedValue({ kind: CallKind.Ok, id: '350768' });
    useAuthStore.setState({ setCredentials: jest.fn(async () => undefined) } as never);
  });

  async function signIn(key = 'a-valid-key') {
    const setError = jest.fn();
    const { result } = renderHook(() => useApiKeyLogin({ setError }));
    await act(async () => {
      await result.current.handleApiKeyLogin(key);
    });
    return setError;
  }

  it('checks the key without an engine handle', async () => {
    await signIn();

    expect(mockValidateCredentials).toHaveBeenCalledWith('api_key', 'a-valid-key');
  });

  it('does not report a connection failure for a key the server accepted', async () => {
    const setError = await signIn();

    expect(setError).not.toHaveBeenCalledWith('login.connectionFailed');
  });

  it('goes on into the app', async () => {
    await signIn();

    expect(replaceTo).toHaveBeenCalledWith('/');
  });

  it('still names a rejected key as invalid rather than as a connection failure', async () => {
    mockValidateCredentials.mockResolvedValue({ kind: CallKind.Http, status: 401 });

    const setError = await signIn();

    expect(setError).toHaveBeenCalledWith('login.invalidApiKey');
  });
});
