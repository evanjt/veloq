/**
 * Scenario: the athlete turns on Button Shapes on iOS, which React Native does
 * not expose, so a control with no ground of its own draws no shape.
 * Expected behaviour: the reader takes the setting from the accessibility
 * module, follows its change event while the app runs, and reads off when
 * there is no module to ask or the read fails.
 */

type Listener = (event: { enabled: boolean }) => void;

interface FakeModule {
  buttonShapes: () => boolean;
  addListener?: (name: string, listener: Listener) => { remove: () => void };
}

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

/**
 * The reader as it loads when the native module answers with `module`, and the
 * testing library from the same registry, so the hook and the renderer share
 * one React. The pure entry registers no hooks of its own, so it cleans up here.
 */
function loadWith(module: FakeModule | null) {
  let reader: typeof import('@/shared/ui/buttonShapes') | undefined;
  let library: typeof import('@testing-library/react-native/pure') | undefined;
  jest.isolateModules(() => {
    jest.doMock('expo-modules-core', () => ({
      ...jest.requireActual<object>('expo-modules-core'),
      requireOptionalNativeModule: (name: string) =>
        name === 'VeloqAccessibility' ? module : null,
    }));
    reader = require('@/shared/ui/buttonShapes');
    library = require('@testing-library/react-native/pure');
  });
  jest.dontMock('expo-modules-core');
  const { renderHook, act, cleanup } = library!;
  cleanups.push(cleanup);
  return { readShapes: () => renderHook(() => reader!.useButtonShapes()), act };
}

function fakeModule(initial: boolean) {
  let enabled = initial;
  const listeners = new Set<Listener>();
  const module: FakeModule = {
    buttonShapes: () => enabled,
    addListener: (name, listener) => {
      if (name === 'onButtonShapesChange') listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
  const change = (next: boolean) => {
    enabled = next;
    for (const listener of listeners) listener({ enabled: next });
  };
  return { module, change };
}

describe('useButtonShapes', () => {
  it('reads the setting from the accessibility module', async () => {
    const { readShapes } = loadWith(fakeModule(true).module);
    const { result } = await readShapes();
    expect(result.current).toBe(true);
  });

  it('follows a change made while the app runs, both ways', async () => {
    const { module, change } = fakeModule(false);
    const { readShapes, act } = loadWith(module);
    const { result } = await readShapes();
    expect(result.current).toBe(false);
    await act(async () => change(true));
    expect(result.current).toBe(true);
    await act(async () => change(false));
    expect(result.current).toBe(false);
  });

  it('reads off with no module to ask', async () => {
    const { result } = await loadWith(null).readShapes();
    expect(result.current).toBe(false);
  });

  it('reads off when the read throws', async () => {
    const { result } = await loadWith({
      buttonShapes: () => {
        throw new Error('no reader');
      },
    }).readShapes();
    expect(result.current).toBe(false);
  });

  it('reads the setting from a module with no change event', async () => {
    const { result } = await loadWith({ buttonShapes: () => true }).readShapes();
    expect(result.current).toBe(true);
  });
});
