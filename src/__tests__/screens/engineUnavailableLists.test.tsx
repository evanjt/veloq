/**
 * Scenario: the Names and Retired screens open while the engine is still
 * opening, or after it gave up opening. A handle that is not open answers every
 * read with its empty default, so both lists read as having nothing in them.
 *
 * Expected behaviour: an engine still opening draws a placeholder, one that
 * failed draws why with a Retry that re-runs the open, and the empty copy is
 * kept for an open engine that has no rows. Once the engine opens, the rows
 * appear without leaving the screen.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { InitOutcome } from 'veloqrs';

import NamedCorridorsScreen from '@/app/named-corridors';
import SectionRetiredScreen from '@/app/section-retired';
import { useEngineStatus } from '@/features/routes/stores/EngineStatusStore';

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    sections: {
      getRetiredMapData: () =>
        mockEngine.open
          ? { retired: mockEngine.retired.map((section) => ({ section })), current: [], pairs: [] }
          : undefined,
    },
  })
);
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));
jest.mock('@/features/routes/hooks/useSectionDisplayNames', () => ({
  useSectionDisplayNames: () => ({}),
}));
jest.mock('@/features/routes/lib/sectionDisplayNames', () => ({
  getAllSectionDisplayNames: () => ({}),
}));

const mockEngine = {
  open: false,
  corridors: [] as unknown[],
  retired: [] as unknown[],
};

// The client's own shape: a handle exists from the first require, and until
// it opens every read answers its empty default.
jest.mock('@/shared/native/engine', () => {
  const handle = {
    get ready() {
      return mockEngine.open;
    },
    subscribe: () => () => {},
    getNamedCorridors: () => (mockEngine.open ? mockEngine.corridors : []),
    removeNamedCorridor: () => false,
  };
  return {
    getEngine: () => handle,
    isEngineReady: () => mockEngine.open,
  };
});

const CORRIDOR = {
  intentId: 'intent-1',
  name: 'Quarry lane',
  encodedFootprint: new Uint8Array(),
  sportType: 'Ride',
  createdAt: '2026-08-01 09:00:00',
  sectionId: null,
  coverage: 0,
  primary: true,
};

const RETIRED = { sectionId: 'sec-9', kind: 'merged', at: '2026-08-01 10:00:00', versions: [] };

function failEngine(reason: InitOutcome) {
  useEngineStatus.setState({ initFailed: true, initFailureReason: reason });
}

function openEngine() {
  act(() => {
    mockEngine.open = true;
    useEngineStatus.getState().setInitFailed(false);
    useEngineStatus.getState().setInitFailureReason(null);
    useEngineStatus.getState().markEngineReady();
  });
}

beforeEach(() => {
  mockEngine.open = false;
  mockEngine.corridors = [CORRIDOR];
  mockEngine.retired = [RETIRED];
  useEngineStatus.setState({ initFailed: false, initFailureReason: null, retryNonce: 0 });
});

const SCREENS = [
  {
    name: 'Names',
    Screen: NamedCorridorsScreen,
    emptyKey: 'namedCorridors.empty',
    rowTestId: 'named-corridor-intent-1',
    clearRows: () => {
      mockEngine.corridors = [];
    },
  },
  {
    name: 'Retired',
    Screen: SectionRetiredScreen,
    emptyKey: 'sectionHistory.retiredEmpty',
    rowTestId: 'section-retired-sec-9',
    clearRows: () => {
      mockEngine.retired = [];
    },
  },
];

describe.each(SCREENS)('$name with an engine that is not open', (s) => {
  it('draws a placeholder while the engine is opening, never the empty copy', () => {
    const screen = render(<s.Screen />);
    expect(screen.queryByText(s.emptyKey)).toBeNull();
    expect(screen.getByTestId('engine-read-placeholder')).toBeTruthy();
  });

  it('says why the engine failed and offers a Retry that re-runs the open', () => {
    failEngine(InitOutcome.Busy);
    const screen = render(<s.Screen />);
    expect(screen.queryByText(s.emptyKey)).toBeNull();
    expect(screen.queryByTestId('engine-read-placeholder')).toBeNull();
    expect(screen.getByText('engine.initReason.busy')).toBeTruthy();

    fireEvent.press(screen.getByText('common.retry'));
    expect(useEngineStatus.getState().retryNonce).toBe(1);
  });

  it('offers the update rather than a retry for a database a newer build wrote', () => {
    failEngine(InitOutcome.ForwardSchema);
    const screen = render(<s.Screen />);
    expect(screen.queryByText(s.emptyKey)).toBeNull();
    expect(screen.getByText('engine.initReason.forwardSchema')).toBeTruthy();
    expect(screen.getByText('engine.initAction.update')).toBeTruthy();
    expect(screen.queryByText('common.retry')).toBeNull();
  });

  it('falls back to the general line for a failure with no recorded reason', () => {
    failEngine(InitOutcome.NotAttempted);
    const screen = render(<s.Screen />);
    expect(screen.getByText('engine.initFailed')).toBeTruthy();
  });

  it('shows the rows once a retry opens the engine', () => {
    failEngine(InitOutcome.Busy);
    const screen = render(<s.Screen />);
    expect(screen.queryByTestId(s.rowTestId)).toBeNull();

    openEngine();

    expect(screen.queryByText('engine.initReason.busy')).toBeNull();
    expect(screen.getByTestId(s.rowTestId)).toBeTruthy();
  });

  it('keeps the empty copy for an open engine that has no rows', () => {
    mockEngine.open = true;
    s.clearRows();
    const screen = render(<s.Screen />);
    expect(screen.getByText(s.emptyKey)).toBeTruthy();
    expect(screen.queryByTestId('engine-read-placeholder')).toBeNull();
  });
});
