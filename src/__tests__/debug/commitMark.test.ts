/**
 * Scenario: an installable build is bundled with `__DEV__` false and the production console strip
 * removes every `console.log`, so the window-commit mark never reached logcat on a debug APK.
 *
 * Expected behaviour: the mark is gated on the build variant, and reaches the console through
 * `console.error`, which the strip keeps. A production build writes nothing.
 */

type Variant = 'dev' | 'production' | undefined;

function loadWith(variant: Variant, dev: boolean) {
  jest.resetModules();
  (global as unknown as { __DEV__: boolean }).__DEV__ = dev;
  jest.doMock('expo-constants', () => ({
    ...jest.requireActual('expo-constants'),
    __esModule: true,
    default: { expoConfig: { extra: { variant } } },
  }));
  return require('@/shared/debug/renderTimer') as typeof import('@/shared/debug/renderTimer');
}

describe('logCommitMark', () => {
  beforeEach(() => {
    if (typeof performance.mark !== 'function') {
      (performance as { mark: (name: string) => void }).mark = () => {};
    }
  });
  afterEach(() => {
    (global as unknown as { __DEV__: boolean }).__DEV__ = true;
    jest.restoreAllMocks();
  });

  it('marks and logs on a dev-variant build whose __DEV__ is false', () => {
    const { logCommitMark } = loadWith('dev', false);
    const mark = jest.spyOn(performance, 'mark');
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    error.mockClear();

    logCommitMark('wellness:window-commit', 'window=14');

    expect(mark).toHaveBeenCalledWith('wellness:window-commit');
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain('[COMMIT] wellness:window-commit window=14');
  });

  it('writes nothing on a production-variant build', () => {
    const { logCommitMark } = loadWith('production', false);
    const mark = jest.spyOn(performance, 'mark');
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    error.mockClear();

    logCommitMark('wellness:window-commit', 'window=14');

    expect(mark).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('writes nothing when the build carries no variant', () => {
    const { logCommitMark } = loadWith(undefined, false);
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    error.mockClear();

    logCommitMark('wellness:window-commit', 'window=14');

    expect(error).not.toHaveBeenCalled();
  });
});
