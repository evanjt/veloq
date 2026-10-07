/**
 * Scenario: the route-grouping preview is the only place the two grouping
 * numbers can be tried, and it must say what they would do to the routes the
 * athlete already has.
 *
 * Expected behaviour: the screen regroups on the value it opens with, repaints
 * the lines it already holds against the answer, says how many routes the
 * setting produces, and applies nothing until Keep is confirmed.
 */

import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { stubIdleScheduler, type IdleScheduler } from '../__shared__/idleScheduler';
import RouteGroupingPreviewScreen from '@/app/route-grouping-preview';
import { GROUPING_DEFAULTS } from '@/features/routes/lib/groupingParams';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const groups = [
  { groupId: 'g1', representativeId: 'a1', encodedPolyline: new ArrayBuffer(0), bounds: undefined },
  { groupId: 'g2', representativeId: 'a2', encodedPolyline: new ArrayBuffer(0), bounds: undefined },
];

const mockGetRoutesScreenData = jest.fn(() => ({ groups }));
const mockStart = jest.fn(() => true);
let mockPreviewGroups: { key: string; activityIds: string[] }[] | null = null;
let mockPreviewStatus = 'idle';
let mockStrictness: { minMatchPct: number; endpointThreshold: number } | null = null;

const mockSetMatchStrictness = jest.fn();
const mockRescan = jest.fn(() => 1);
const mockBack = jest.fn();
let mockTransitionPending = false;
const mockTransitionListeners = new Map<string, (event: { data: { closing: boolean } }) => void>();
const mockNavigation = {
  addListener: (name: string, listener: (event: { data: { closing: boolean } }) => void) => {
    mockTransitionListeners.set(name, listener);
    if (name === 'transitionEnd' && !mockTransitionPending) {
      listener({ data: { closing: false } });
    }
    return () => mockTransitionListeners.delete(name);
  },
};
let mockOnChange:
  | ((next: { minMatchPercentage: number; endpointThreshold: number }) => void)
  | null = null;

jest.mock('@/shared/native/engine', () => {
  // Every method looks its mock up when called: importing the screen reaches
  // modules that read the engine on load, before the mocks above are assigned.
  const engine = {
    getRoutesScreenData: (...args: unknown[]) => mockGetRoutesScreenData(...(args as [])),
    startRouteGroupingPreview: (...args: unknown[]) => mockStart(...(args as [])),
    pollRouteGroupingPreview: () => mockPreviewStatus,
    takeRouteGroupingPreviewResult: () => mockPreviewGroups,
    cancelRouteGroupingPreview: jest.fn(),
    getMatchStrictness: () => mockStrictness,
    setMatchStrictness: (...args: unknown[]) => mockSetMatchStrictness(...args),
  };
  return { getEngine: () => engine };
});

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { back: () => mockBack() },
  useNavigation: () => mockNavigation,
}));

jest.mock('@/features/routes/hooks/useSectionRescan', () => ({
  useSectionRescan: () => ({ rescan: mockRescan, forceRescan: mockRescan }),
}));

jest.mock('@/features/routes/hooks/useRouteGroupingPreview', () => {
  const actual = jest.requireActual('@/features/routes/hooks/useRouteGroupingPreview');
  return {
    ...actual,
    useRouteGroupingPreview: () => ({
      status: mockPreviewStatus,
      groups: mockPreviewGroups,
      refused: false,
      request: mockStart,
      cancel: jest.fn(),
    }),
  };
});

jest.mock('@/features/routes/components', () => ({
  GroupingParamPanel: ({ onChange }: { onChange: typeof mockOnChange }) => {
    mockOnChange = onChange;
    return null;
  },
  GroupingPreviewMap: () => null,
}));

jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));

jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

// The real strings, so the assertions below are about the copy an athlete
// reads rather than about a key.
jest.mock('react-i18next', () => {
  const strings = require('@/i18n/locales/en-GB.json');
  return {
    ...jest.requireActual('react-i18next'),
    useTranslation: () => ({
      t: (key: string, vars?: Record<string, unknown>) => {
        const at = (path: string) =>
          path
            .split('.')
            .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], strings);
        const form = typeof vars?.count === 'number' ? (vars.count === 1 ? 'one' : 'other') : null;
        const raw = form ? (at(`${key}_${form}`) ?? at(key)) : at(key);
        const text = typeof raw === 'string' ? raw : key;
        return vars
          ? text.replace(/{{(\w+)}}/g, (_m, name: string) => String(vars[name] ?? ''))
          : text;
      },
    }),
  };
});

let idle: IdleScheduler;

beforeEach(() => {
  idle = stubIdleScheduler('immediate');
  jest.clearAllMocks();
  mockPreviewGroups = null;
  mockPreviewStatus = 'idle';
  mockStrictness = null;
  mockTransitionPending = false;
  mockTransitionListeners.clear();
});

afterEach(() => idle.restore());

it('asks for a grouping at the value it opens with, without being dragged', () => {
  render(<RouteGroupingPreviewScreen />);

  expect(mockStart).toHaveBeenCalledWith({ minMatchPercentage: 55, endpointThreshold: 250 });
});

it('says it is working until the first answer lands', () => {
  mockPreviewStatus = 'running';
  render(<RouteGroupingPreviewScreen />);

  expect(screen.getByTestId('grouping-status').props.children).toBe('Grouping your rides…');
});

it('counts the routes the setting produces once the answer lands', () => {
  mockPreviewStatus = 'complete';
  mockPreviewGroups = [
    { key: 'p1', activityIds: ['a1', 'a2'] },
    { key: 'p2', activityIds: ['a9'] },
  ];
  render(<RouteGroupingPreviewScreen />);

  expect(screen.getByTestId('grouping-status').props.children).toBe('2 routes at this setting');
});

it('says the grouping did not finish rather than that it is still running', () => {
  mockPreviewStatus = 'error';
  render(<RouteGroupingPreviewScreen />);

  expect(screen.getByTestId('grouping-status').props.children).toBe(
    'The grouping did not finish. Move a knob to try again.'
  );
});

it('says nothing was cancelled when a knob change supersedes a run', () => {
  mockPreviewStatus = 'cancelled';
  render(<RouteGroupingPreviewScreen />);

  // A cancel is a knob that moved, and the next run is already being asked
  // for, so the row reads as working rather than as a failure.
  expect(screen.getByTestId('grouping-status').props.children).toBe('Grouping your rides…');
});

it('names the routes a setting would leave on their own', async () => {
  mockPreviewStatus = 'complete';
  mockPreviewGroups = [{ key: 'p1', activityIds: ['a1'] }];
  render(<RouteGroupingPreviewScreen />);
  // The route read waits for the push transition, so the paint is a frame behind.
  await act(async () => {});

  expect(screen.getByTestId('grouping-dropped')).toBeTruthy();
});

it('draws no dropped line when every route keeps a group', () => {
  mockPreviewStatus = 'complete';
  mockPreviewGroups = [
    { key: 'p1', activityIds: ['a1'] },
    { key: 'p2', activityIds: ['a2'] },
  ];
  render(<RouteGroupingPreviewScreen />);

  expect(screen.queryByTestId('grouping-dropped')).toBeNull();
});

it('reads the routes once, and applies nothing on mount', async () => {
  mockPreviewStatus = 'complete';
  mockPreviewGroups = [{ key: 'p1', activityIds: ['a1', 'a2'] }];

  render(<RouteGroupingPreviewScreen />);
  await act(async () => {});

  expect(mockGetRoutesScreenData).toHaveBeenCalledTimes(1);
  expect(mockSetMatchStrictness).not.toHaveBeenCalled();
});

it('waits for the opening transition before reading routes', () => {
  mockTransitionPending = true;
  render(<RouteGroupingPreviewScreen />);

  expect(mockGetRoutesScreenData).not.toHaveBeenCalled();
  act(() => mockTransitionListeners.get('transitionEnd')?.({ data: { closing: false } }));
  expect(mockGetRoutesScreenData).toHaveBeenCalledTimes(1);
});

/**
 * Scenario: the athlete moves a knob until the preview shows the grouping they
 * want, then decides.
 *
 * Expected behaviour: nothing is written while they tune or when they discard,
 * Keep is offered only once a knob differs from the applied value, and a
 * confirmed Keep writes both values once, starts the regroup and leaves.
 */
describe('applying the setting', () => {
  const moved = { minMatchPercentage: 65, endpointThreshold: 180 };
  const confirmKeep = () => {
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as {
      text: string;
      onPress?: () => void;
    }[];
    buttons.find((b) => b.text === 'Confirm')?.onPress?.();
  };

  beforeEach(() => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockPreviewStatus = 'complete';
    mockPreviewGroups = [{ key: 'p1', activityIds: ['a1', 'a2'] }];
  });

  it('offers neither Keep nor Discard until a knob moves', () => {
    render(<RouteGroupingPreviewScreen />);

    expect(screen.queryByTestId('grouping-keep-button')).toBeNull();
    expect(screen.queryByTestId('grouping-discard-button')).toBeNull();
  });

  it('writes nothing while a knob moves', async () => {
    render(<RouteGroupingPreviewScreen />);
    await act(async () => {});
    act(() => mockOnChange?.(moved));

    expect(mockSetMatchStrictness).not.toHaveBeenCalled();
    expect(screen.getByTestId('grouping-keep-button')).toBeTruthy();
  });

  it('hides Keep again when the knobs return to the applied value', async () => {
    mockStrictness = { minMatchPct: 62, endpointThreshold: 190 };
    render(<RouteGroupingPreviewScreen />);
    await act(async () => {});
    act(() => mockOnChange?.(moved));
    act(() => mockOnChange?.({ minMatchPercentage: 62, endpointThreshold: 190 }));

    expect(screen.queryByTestId('grouping-keep-button')).toBeNull();
  });

  it('writes the panel values once on a confirmed Keep, regroups and leaves', async () => {
    render(<RouteGroupingPreviewScreen />);
    await act(async () => {});
    act(() => mockOnChange?.(moved));
    fireEvent.press(screen.getByTestId('grouping-keep-button'));

    expect(mockSetMatchStrictness).not.toHaveBeenCalled();
    act(confirmKeep);

    expect(mockSetMatchStrictness).toHaveBeenCalledTimes(1);
    expect(mockSetMatchStrictness).toHaveBeenCalledWith(65, 180);
    expect(mockRescan).toHaveBeenCalledTimes(1);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when the confirmation is cancelled', async () => {
    render(<RouteGroupingPreviewScreen />);
    await act(async () => {});
    act(() => mockOnChange?.(moved));
    fireEvent.press(screen.getByTestId('grouping-keep-button'));

    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(mockSetMatchStrictness).not.toHaveBeenCalled();
    expect(mockRescan).not.toHaveBeenCalled();
  });

  it('writes nothing on Discard and leaves', async () => {
    render(<RouteGroupingPreviewScreen />);
    await act(async () => {});
    act(() => mockOnChange?.(moved));
    fireEvent.press(screen.getByTestId('grouping-discard-button'));

    expect(mockSetMatchStrictness).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

/**
 * Scenario: the engine holds the strictness in force, and the screen opened on
 * the grouper's defaults because nothing bound the getter. An athlete who had
 * changed the setting saw the panel claim a value that was not applied.
 *
 * Expected behaviour: the knobs open on what the engine answers, and on the
 * defaults only when it answers nothing.
 */
describe('the strictness the screen opens on', () => {
  it('is the one the engine holds', async () => {
    mockPreviewStatus = 'complete';
    mockPreviewGroups = [{ key: 'p1', activityIds: ['a1', 'a2'] }];
    mockStrictness = { minMatchPct: 62, endpointThreshold: 190 };

    render(<RouteGroupingPreviewScreen />);
    await act(async () => {});

    expect(mockStart).toHaveBeenCalledWith({
      minMatchPercentage: 62,
      endpointThreshold: 190,
    });
  });

  it('is the grouper default when the engine answers nothing', async () => {
    mockPreviewStatus = 'complete';
    mockPreviewGroups = [{ key: 'p1', activityIds: ['a1', 'a2'] }];
    mockStrictness = null;

    render(<RouteGroupingPreviewScreen />);
    await act(async () => {});

    expect(mockStart).toHaveBeenCalledWith(GROUPING_DEFAULTS);
  });
});
