const mockPrevent = jest.fn();
const mockHide = jest.fn();
const mockSetOptions = jest.fn();

jest.mock('expo-splash-screen', () => ({
  ...jest.requireActual('expo-splash-screen'),
  preventAutoHideAsync: (...args: unknown[]) => mockPrevent(...args),
  hideAsync: (...args: unknown[]) => mockHide(...args),
  setOptions: (...args: unknown[]) => mockSetOptions(...args),
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
    mockSetOptions.mockReset();
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

  it('sets one cross-fade for both platforms before the hide', () => {
    const { releaseSplash } = load();
    releaseSplash();
    expect(mockSetOptions).toHaveBeenCalledTimes(1);
    expect(mockSetOptions).toHaveBeenCalledWith({ fade: true, duration: 300 });
    expect(mockSetOptions.mock.invocationCallOrder[0]).toBeLessThan(
      mockHide.mock.invocationCallOrder[0]
    );
  });

  it('still hides when setting the fade throws', () => {
    mockSetOptions.mockImplementation(() => {
      throw new Error('no native module');
    });
    const { releaseSplash } = load();
    releaseSplash();
    expect(mockSetOptions).toHaveBeenCalledTimes(1);
    expect(mockHide).toHaveBeenCalledTimes(1);
  });
});
