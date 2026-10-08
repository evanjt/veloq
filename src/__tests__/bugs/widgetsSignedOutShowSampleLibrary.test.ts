/**
 * Scenario: nobody is signed in, so the engine holds no library to compose a
 * widget snapshot from. A deleted snapshot draws the "open the app" prompt on
 * every widget.
 *
 * Expected behaviour: the bridge writes a snapshot the engine composed from the
 * sample library and marked as one, never a deletion. A signed-in athlete keeps
 * the snapshot composed from their own library, and a sample that cannot be
 * composed leaves the file as it is.
 */

import {
  refreshSampleWidgets,
  resetWidgetSnapshot,
  updateWidgetSnapshot,
} from '@/features/home/lib/widgetBridge';
import { WIDGET_STRING_KEYS } from '@/features/home/lib/widgetSnapshot';
import { useAuthStore } from '@/shared/app/AuthStore';

const mockEngine = {
  composeWidgetSnapshot: jest.fn(),
  setWidgetContext: jest.fn(),
};

let mockEngineReady = true;

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
  isEngineReady: () => mockEngineReady,
}));

jest.mock('expo-modules-core', () => {
  const widget = {
    writeSnapshot: jest.fn(),
    clearSnapshot: jest.fn(),
    reloadWidgets: jest.fn(),
    publishRecordShortcuts: jest.fn(),
  };
  return {
    ...jest.requireActual('expo-modules-core'),
    requireOptionalNativeModule: () => widget,
  };
});

const mockWidget = (
  jest.requireMock('expo-modules-core') as {
    requireOptionalNativeModule: () => Record<
      'writeSnapshot' | 'clearSnapshot' | 'reloadWidgets' | 'publishRecordShortcuts',
      jest.Mock
    >;
  }
).requireOptionalNativeModule();

const sample = JSON.stringify({
  schemaVersion: 12,
  demo: true,
  emptyLibrary: false,
  metrics: { fitness: { value: 71 } },
});
const own = JSON.stringify({ schemaVersion: 12, emptyLibrary: false });

function signedOut(): void {
  useAuthStore.setState({ isLoading: false, authMethod: null, isDemoMode: false });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEngineReady = true;
  // The engine answers the sample when it is handed one, as the real composer does.
  mockEngine.composeWidgetSnapshot.mockImplementation(
    (_context: string, _now: number, _wall: number, library?: unknown) => (library ? sample : own)
  );
  mockEngine.setWidgetContext.mockReturnValue(true);
  signedOut();
});

describe('signed out', () => {
  it('writes the sample snapshot on a refresh, with its metrics and the demo mark', () => {
    updateWidgetSnapshot();

    expect(mockWidget.writeSnapshot).toHaveBeenCalledTimes(1);
    const written = JSON.parse(mockWidget.writeSnapshot.mock.calls[0][0]);
    expect(written.demo).toBe(true);
    expect(written.metrics.fitness.value).toBe(71);
    expect(mockEngine.composeWidgetSnapshot).toHaveBeenCalledTimes(1);
  });

  it('writes the sample snapshot after a wipe instead of deleting the file', () => {
    resetWidgetSnapshot();

    expect(mockWidget.clearSnapshot).not.toHaveBeenCalled();
    expect(mockWidget.writeSnapshot).toHaveBeenCalledWith(sample);
  });

  it('writes nothing while the engine is closed, and the file stands', () => {
    mockEngineReady = false;

    updateWidgetSnapshot();

    expect(mockWidget.writeSnapshot).not.toHaveBeenCalled();
    expect(mockWidget.clearSnapshot).not.toHaveBeenCalled();
  });

  it('offers no one-tap record shortcut, since starting a ride needs an account', () => {
    updateWidgetSnapshot();

    expect(mockWidget.publishRecordShortcuts).toHaveBeenCalledWith([]);
  });

  it('composes the sample in the app words', () => {
    updateWidgetSnapshot();

    const context = JSON.parse(mockEngine.composeWidgetSnapshot.mock.calls[0][0]);
    expect(context.demo).toBe(true);
    expect(WIDGET_STRING_KEYS).toContain('demo.banner');
  });

  it('stores a context marked as a sample, so a native refresh leaves the file standing', () => {
    updateWidgetSnapshot();

    const stored = JSON.parse(mockEngine.setWidgetContext.mock.calls[0][0]);
    expect(stored.sample).toBe(true);
  });

  it('leaves the file as it is when the sample cannot be composed', () => {
    mockEngine.composeWidgetSnapshot.mockImplementation(() => {
      throw new Error('native module missing');
    });

    updateWidgetSnapshot();

    expect(mockWidget.writeSnapshot).not.toHaveBeenCalled();
    expect(mockWidget.clearSnapshot).not.toHaveBeenCalled();
  });

  it('still deletes the file after a wipe when the sample cannot be composed', () => {
    mockEngine.composeWidgetSnapshot.mockImplementation(() => {
      throw new Error('native module missing');
    });

    resetWidgetSnapshot();

    expect(mockWidget.clearSnapshot).toHaveBeenCalledTimes(1);
  });
});

describe('before the credentials are read', () => {
  it('does not compose the sample, since the athlete may be signed in', () => {
    useAuthStore.setState({ isLoading: true, authMethod: null });

    updateWidgetSnapshot();

    expect(mockEngine.composeWidgetSnapshot.mock.calls[0][3]).toBeUndefined();
    expect(mockWidget.writeSnapshot).toHaveBeenCalledWith(own);
  });

  it('deletes the file on a wipe rather than guess the sample', () => {
    useAuthStore.setState({ isLoading: true, authMethod: null });

    resetWidgetSnapshot();

    expect(mockEngine.composeWidgetSnapshot).not.toHaveBeenCalled();
    expect(mockWidget.clearSnapshot).toHaveBeenCalledTimes(1);
  });
});

describe('signed in', () => {
  it('writes nothing while the engine is closed', () => {
    useAuthStore.setState({ isLoading: false, authMethod: 'apiKey' });
    mockEngineReady = false;

    updateWidgetSnapshot();

    expect(mockWidget.writeSnapshot).not.toHaveBeenCalled();
  });

  it('writes the snapshot composed from their own library', () => {
    useAuthStore.setState({ isLoading: false, authMethod: 'apiKey' });

    updateWidgetSnapshot();

    expect(mockEngine.composeWidgetSnapshot.mock.calls[0][3]).toBeUndefined();
    expect(mockWidget.writeSnapshot).toHaveBeenCalledWith(own);
    expect(JSON.parse(mockEngine.composeWidgetSnapshot.mock.calls[0][0]).demo).toBe(false);
    expect(JSON.parse(mockEngine.setWidgetContext.mock.calls[0][0]).sample).toBe(false);
  });

  it('deletes the file on a wipe, as before', () => {
    useAuthStore.setState({ isLoading: false, authMethod: 'apiKey' });

    resetWidgetSnapshot();

    expect(mockWidget.clearSnapshot).toHaveBeenCalledTimes(1);
    expect(mockEngine.composeWidgetSnapshot).not.toHaveBeenCalled();
  });
});

describe('demo mode', () => {
  it('marks the snapshot composed from the seeded library', () => {
    useAuthStore.setState({ isLoading: false, authMethod: 'demo', isDemoMode: true });

    updateWidgetSnapshot();

    expect(JSON.parse(mockEngine.composeWidgetSnapshot.mock.calls[0][0]).demo).toBe(true);
  });
});

describe('refreshing for an account change', () => {
  it('writes the sample when nobody is signed in', () => {
    refreshSampleWidgets();

    expect(mockWidget.writeSnapshot).toHaveBeenCalledWith(sample);
  });

  it('writes the marked demo snapshot on entering demo mode', () => {
    useAuthStore.setState({ isLoading: false, authMethod: 'demo', isDemoMode: true });

    refreshSampleWidgets();

    expect(mockWidget.writeSnapshot).toHaveBeenCalledTimes(1);
  });

  it('leaves a signed-in athlete to their own sync', () => {
    useAuthStore.setState({ isLoading: false, authMethod: 'oauth' });

    refreshSampleWidgets();

    expect(mockWidget.writeSnapshot).not.toHaveBeenCalled();
  });

  it('writes nothing before the credentials are read', () => {
    useAuthStore.setState({ isLoading: true, authMethod: null });

    refreshSampleWidgets();

    expect(mockWidget.writeSnapshot).not.toHaveBeenCalled();
  });
});
