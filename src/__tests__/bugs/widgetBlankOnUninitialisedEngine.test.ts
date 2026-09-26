/**
 * Scenario: something asks for a widget refresh before `initWithPath` has run.
 * A headless background task starts in exactly that state, and so does early
 * launch.
 *
 * Expected behaviour: the last good snapshot stands. The engine not being open
 * means the answer is unknown, not that the athlete has no fitness, no form and
 * no rides, and writing that over the home screen blanks the widget rather than
 * leaving it stale.
 *
 * The engine mock models production: `getEngine` hands back a singleton that
 * exists from the first require and is never null once the native module loads,
 * and readiness is a separate flag.
 */

import { gatherWidgetSnapshot } from '@/features/home/lib/widgetSnapshot';
import { updateWidgetSnapshot } from '@/features/home/lib/widgetBridge';

const mockEngine = {
  getWidgetSnapshot: jest.fn(),
};
let mockEngineReady = true;

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
  isEngineReady: () => mockEngineReady,
}));

// The bridge reads the native module once at import, and Jest hoists that
// import above every `const` here, so the widget mock has to live inside the
// factory rather than beside the engine one.
jest.mock('expo-modules-core', () => {
  const widget = {
    writeSnapshot: jest.fn(),
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
    requireOptionalNativeModule: () => {
      writeSnapshot: jest.Mock;
      reloadWidgets: jest.Mock;
      publishRecordShortcuts: jest.Mock;
    };
  }
).requireOptionalNativeModule();

const answer = {
  sparklines: { fitness: [70], fatigue: [60], form: [10], hrv: [], rhr: [] },
  summary: {
    currentWeek: { count: 1, totalDuration: 3600, totalDistance: 30_000, totalTss: 60 },
    prevWeek: { count: 0, totalDuration: 0, totalDistance: 0, totalTss: 0 },
  },
  latest: null,
  latestIsPr: false,
  latestGps: null,
};

const opts = { locale: 'en-AU', isMetric: true, translate: (key: string) => key };

beforeEach(() => {
  mockEngineReady = true;
  mockEngine.getWidgetSnapshot.mockReset().mockReturnValue(answer);
  mockWidget.writeSnapshot.mockReset();
  mockWidget.reloadWidgets.mockReset();
  mockWidget.publishRecordShortcuts.mockReset();
});

describe('gatherWidgetSnapshot', () => {
  it('builds a snapshot when the engine is open and answers', () => {
    expect(gatherWidgetSnapshot(opts)).not.toBeNull();
  });

  it('returns null when the engine is not open', () => {
    mockEngineReady = false;
    expect(gatherWidgetSnapshot(opts)).toBeNull();
  });

  it('returns null when the read throws, rather than composing from nothing', () => {
    // `get_widget_snapshot` goes through `with_engine`, which answers
    // `NotInitialized` before the database is opened. Swallowing that and
    // composing from undefined turns "unknown" into "zero".
    mockEngine.getWidgetSnapshot.mockImplementation(() => {
      throw new Error('NotInitialized');
    });
    expect(gatherWidgetSnapshot(opts)).toBeNull();
  });
});

describe('updateWidgetSnapshot', () => {
  it('writes when the engine is open', () => {
    updateWidgetSnapshot();
    expect(mockWidget.writeSnapshot).toHaveBeenCalled();
  });

  it('writes nothing when the engine is not open', () => {
    mockEngineReady = false;
    updateWidgetSnapshot();
    expect(mockWidget.writeSnapshot).not.toHaveBeenCalled();
    expect(mockWidget.reloadWidgets).not.toHaveBeenCalled();
  });

  it('does not clear the launcher shortcuts when the engine is not open', () => {
    // The shortcut list is emptied for a signed-out athlete. A closed engine
    // reads as signed out, so an unguarded refresh takes the one-tap surfaces
    // off the icon of someone who is signed in.
    mockEngineReady = false;
    updateWidgetSnapshot();
    expect(mockWidget.publishRecordShortcuts).not.toHaveBeenCalled();
  });
});
