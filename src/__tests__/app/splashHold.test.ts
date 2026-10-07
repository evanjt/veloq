const mockPrevent = jest.fn();
const mockHide = jest.fn();

jest.mock('expo-splash-screen', () => ({
  ...jest.requireActual('expo-splash-screen'),
  preventAutoHideAsync: (...args: unknown[]) => mockPrevent(...args),
  hideAsync: (...args: unknown[]) => mockHide(...args),
}));

function load() {
  let mod: typeof import('@/shared/app/splash');
  jest.isolateModules(() => {
    mod = require('@/shared/app/splash');
  });
  return mod!;
}

describe('splash hold', () => {
  beforeEach(() => {
    mockPrevent.mockReset().mockResolvedValue(undefined);
    mockHide.mockReset().mockResolvedValue(undefined);
  });

  it('asks for the hold once on import and does not hide yet', () => {
    load();
    expect(mockPrevent).toHaveBeenCalledTimes(1);
    expect(mockHide).not.toHaveBeenCalled();
  });

  it('hides exactly once however often it is released', () => {
    const { releaseSplash } = load();
    releaseSplash();
    releaseSplash();
    expect(mockHide).toHaveBeenCalledTimes(1);
  });

  it('survives a rejected hold and a rejected hide', async () => {
    mockPrevent.mockRejectedValue(new Error('no splash'));
    mockHide.mockRejectedValue(new Error('already hidden'));
    const { releaseSplash } = load();
    expect(() => releaseSplash()).not.toThrow();
    await Promise.resolve();
  });
});
