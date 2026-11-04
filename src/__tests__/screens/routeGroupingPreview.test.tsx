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

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides(
    require('../__shared__/veloqrsStub').namespacesOver(() =>
      require('@/shared/native/engine').getEngine()
    )
  )
);

const boxAround = (lat: number, lng: number) => ({
  minLat: lat - 0.01,
  maxLat: lat + 0.01,
  minLng: lng - 0.01,
  maxLng: lng + 0.01,
});
const route = (groupId: string, representativeId: string, lat: number, lng: number) => ({
  groupId,
  representativeId,
  encodedPolyline: new ArrayBuffer(0),
  bounds: boxAround(lat, lng),
});

// g1 and g2 ride in area A, g3 and g4 in area B.
const groups = [
  route('g1', 'a1', 46.948, 7.447),
  route('g2', 'a2', 46.949, 7.448),
  route('g3', 'a3', -33.9, 151.2),
  route('g4', 'a4', -33.91, 151.21),
];

const mockGetRoutesScreenData = jest.fn((_query?: unknown): { groups: typeof groups } => ({
  groups,
}));
const mockStart = jest.fn(() => true);
let mockPreviewGroups: { key: string; activityIds: string[] }[] | null = null;
let mockPreviewSpreads: { groupId: string; previewGroups: number }[] = [];
let mockPreviewStatus = 'idle';
let mockStrictness: { minMatchPct: number; endpointThreshold: number } | null = null;
const AREA_A = { binKey: '1043:165', lat: 46.948, lng: 7.447, visitTotal: 40, sectionCount: 3 };
const AREA_B = { binKey: '-755:3358', lat: -33.9, lng: 151.2, visitTotal: 12, sectionCount: 1 };
let mockCentres: (typeof AREA_A)[] = [AREA_A, AREA_B];
let mockCentresThrow: unknown = null;
let mockSelectCentre: ((centre: typeof AREA_A) => void) | null = null;
let mockMapProps: { centre?: unknown; routes?: { groupId: string }[] } | null = null;

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
  ((next: { minMatchPercentage: number; endpointThreshold: number }) => void) | null = null;

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
    getPreviewCentres: () => {
      if (mockCentresThrow != null) throw mockCentresThrow;
      return mockCentres;
    },
    setMatchStrictness: (...args: unknown[]) => mockSetMatchStrictness(...args),
  };
  return { getEngine: () => engine };
});

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { canGoBack: () => true, back: () => mockBack() },
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
      spreads: mockPreviewSpreads,
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
  GroupingPreviewMap: (props: { centre?: unknown; routes?: { groupId: string }[] }) => {
    mockMapProps = props;
    return null;
  },
  PreviewSheet: ({
    summary,
    children,
  }: {
    summary: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <>
      {summary}
      {children}
    </>
  ),
  PreviewCentrePicker: ({
    centres,
    selectedBinKey,
    onSelect,
  }: {
    centres: unknown[];
    selectedBinKey: string | null;
    onSelect: typeof mockSelectCentre;
  }) => {
    mockSelectCentre = onSelect;
    const { Text } = require('react-native');
    return (
      <Text testID="grouping-area-picker">{`${centres.length} areas, ${selectedBinKey}`}</Text>
    );
  },
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
  mockPreviewSpreads = [];
  mockPreviewStatus = 'idle';
  mockStrictness = null;
  mockCentres = [AREA_A, AREA_B];
  mockCentresThrow = null;
  mockSelectCentre = null;
  mockMapProps = null;
  mockTransitionPending = false;
  mockTransitionListeners.clear();
});

afterEach(() => idle.restore());

it('asks for a grouping at the value it opens with, without being dragged', async () => {
  await render(<RouteGroupingPreviewScreen />);

  expect(mockStart).toHaveBeenCalledWith({ minMatchPercentage: 55, endpointThreshold: 250 });
});

it('says it is working until the first answer lands', async () => {
  mockPreviewStatus = 'running';
  await render(<RouteGroupingPreviewScreen />);

  expect(screen.getByTestId('grouping-status').props.children).toBe('Grouping your rides…');
});

it('counts the routes the setting produces once the answer lands', async () => {
  mockPreviewStatus = 'complete';
  mockPreviewGroups = [
    { key: 'p1', activityIds: ['a1', 'a2'] },
    { key: 'p2', activityIds: ['a9'] },
  ];
  await render(<RouteGroupingPreviewScreen />);

  expect(screen.getByTestId('grouping-status').props.children).toBe('2 routes at this setting');
});

it('says the grouping did not finish rather than that it is still running', async () => {
  mockPreviewStatus = 'error';
  await render(<RouteGroupingPreviewScreen />);

  expect(screen.getByTestId('grouping-status').props.children).toBe(
    'The grouping did not finish. Move a knob to try again.'
  );
});

it('says nothing was cancelled when a knob change supersedes a run', async () => {
  mockPreviewStatus = 'cancelled';
  await render(<RouteGroupingPreviewScreen />);

  // A cancel is a knob that moved, and the next run is already being asked
  // for, so the row reads as working rather than as a failure.
  expect(screen.getByTestId('grouping-status').props.children).toBe('Grouping your rides…');
});

it('names the routes a setting would leave on their own', async () => {
  mockPreviewStatus = 'complete';
  mockPreviewGroups = [{ key: 'p1', activityIds: ['a1'] }];
  await render(<RouteGroupingPreviewScreen />);
  // The route read waits for the push transition, so the paint is a frame behind.
  await act(async () => {});

  expect(screen.getByTestId('grouping-dropped')).toBeTruthy();
});

it('draws no dropped line when every route keeps a group', async () => {
  mockPreviewStatus = 'complete';
  mockPreviewGroups = [
    { key: 'p1', activityIds: ['a1'] },
    { key: 'p2', activityIds: ['a2'] },
  ];
  await render(<RouteGroupingPreviewScreen />);

  expect(screen.queryByTestId('grouping-dropped')).toBeNull();
});

it('reads the routes once, and applies nothing on mount', async () => {
  mockPreviewStatus = 'complete';
  mockPreviewGroups = [{ key: 'p1', activityIds: ['a1', 'a2'] }];

  await render(<RouteGroupingPreviewScreen />);
  await act(async () => {});

  expect(mockGetRoutesScreenData).toHaveBeenCalledTimes(1);
  expect(mockSetMatchStrictness).not.toHaveBeenCalled();
});

it('waits for the opening transition before reading routes', async () => {
  mockTransitionPending = true;
  await render(<RouteGroupingPreviewScreen />);

  expect(mockGetRoutesScreenData).not.toHaveBeenCalled();
  await act(() => mockTransitionListeners.get('transitionEnd')?.({ data: { closing: false } }));
  expect(mockGetRoutesScreenData).toHaveBeenCalledTimes(1);
});

/**
 * Scenario: the athlete's routes lie in several regions, and the preview drew
 * a capped set of the routes nearest the area, so a regrouping elsewhere moved
 * the library count and painted nothing.
 *
 * Expected behaviour: every route is read once; the screen offers the same
 * riding areas the section preview does, opens on the first, draws and counts
 * only that area's routes, and a change that lands only in another area is
 * named with a chip that opens that area.
 */
describe('the area the preview opens on', () => {
  const drawn = () => mockMapProps?.routes?.map((r) => r.groupId);

  it('offers the ranked areas and selects the first', async () => {
    await render(<RouteGroupingPreviewScreen />);
    await act(async () => {});

    expect(screen.getByTestId('grouping-area-picker').props.children).toBe('2 areas, 1043:165');
    expect(mockMapProps?.centre).toEqual(AREA_A);
  });

  it('reads every route, not the ones nearest the area', async () => {
    await render(<RouteGroupingPreviewScreen />);
    await act(async () => {});

    expect(mockGetRoutesScreenData).toHaveBeenCalledTimes(1);
    expect(mockGetRoutesScreenData.mock.calls[0][0]).toMatchObject({ groupLimit: 5000 });
  });

  it('draws only the selected area, and another area without re-reading', async () => {
    await render(<RouteGroupingPreviewScreen />);
    await act(async () => {});
    expect(drawn()).toEqual(['g1', 'g2']);

    await act(() => mockSelectCentre?.(AREA_B));

    expect(mockGetRoutesScreenData).toHaveBeenCalledTimes(1);
    expect(drawn()).toEqual(['g3', 'g4']);
    expect(mockMapProps?.centre).toEqual(AREA_B);
  });

  it('says how many routes in the area the setting would split', async () => {
    mockPreviewStatus = 'complete';
    mockPreviewGroups = [
      { key: 'p1', activityIds: ['a1'] },
      { key: 'p1b', activityIds: ['a1b'] },
      { key: 'p2', activityIds: ['a2'] },
    ];
    mockPreviewSpreads = [
      { groupId: 'g1', previewGroups: 2 },
      { groupId: 'g2', previewGroups: 1 },
    ];
    await render(<RouteGroupingPreviewScreen />);
    await act(async () => {});

    expect(screen.getByTestId('grouping-area-split').props.children).toBe('1 would split');
    expect(screen.queryByTestId('grouping-area-unchanged')).toBeNull();
  });

  it('says a merge in another area changes nothing here, and offers that area', async () => {
    mockPreviewStatus = 'complete';
    mockPreviewGroups = [
      { key: 'p1', activityIds: ['a1'] },
      { key: 'p2', activityIds: ['a2'] },
      { key: 'p3', activityIds: ['a3', 'a4'] },
    ];
    await render(<RouteGroupingPreviewScreen />);
    await act(async () => {});

    expect(screen.getByTestId('grouping-area-unchanged')).toBeTruthy();
    expect(screen.queryByTestId('grouping-area-merged')).toBeNull();

    await fireEvent.press(screen.getByTestId('grouping-elsewhere--755:3358'));

    expect(mockMapProps?.centre).toEqual(AREA_B);
    expect(screen.getByTestId('grouping-area-merged').props.children).toBe(
      '2 of your routes would merge'
    );
  });

  it('counts a merge inside the area and offers no other area', async () => {
    mockPreviewStatus = 'complete';
    mockPreviewGroups = [
      { key: 'p1', activityIds: ['a1', 'a2'] },
      { key: 'p3', activityIds: ['a3'] },
      { key: 'p4', activityIds: ['a4'] },
    ];
    await render(<RouteGroupingPreviewScreen />);
    await act(async () => {});

    expect(screen.getByTestId('grouping-area-merged')).toBeTruthy();
    expect(screen.queryByTestId('grouping-elsewhere')).toBeNull();
  });

  it('draws every route when the library has no area yet', async () => {
    mockCentres = [];
    await render(<RouteGroupingPreviewScreen />);
    await act(async () => {});

    expect(drawn()).toEqual(['g1', 'g2', 'g3', 'g4']);
    expect(mockMapProps?.centre).toBeNull();
  });
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
    buttons.find((b) => b.text === 'Keep')?.onPress?.();
  };

  beforeEach(() => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockPreviewStatus = 'complete';
    mockPreviewGroups = [{ key: 'p1', activityIds: ['a1', 'a2'] }];
  });

  it('offers neither Keep nor Discard until a knob moves', async () => {
    await render(<RouteGroupingPreviewScreen />);

    expect(screen.queryByTestId('grouping-keep-button')).toBeNull();
    expect(screen.queryByTestId('grouping-discard-button')).toBeNull();
  });

  it('writes nothing while a knob moves', async () => {
    await render(<RouteGroupingPreviewScreen />);
    await act(async () => {});
    await act(() => mockOnChange?.(moved));

    expect(mockSetMatchStrictness).not.toHaveBeenCalled();
    expect(screen.getByTestId('grouping-keep-button')).toBeTruthy();
  });

  it('hides Keep again when the knobs return to the applied value', async () => {
    mockStrictness = { minMatchPct: 62, endpointThreshold: 190 };
    await render(<RouteGroupingPreviewScreen />);
    await act(async () => {});
    await act(() => mockOnChange?.(moved));
    await act(() => mockOnChange?.({ minMatchPercentage: 62, endpointThreshold: 190 }));

    expect(screen.queryByTestId('grouping-keep-button')).toBeNull();
  });

  it('writes the panel values once on a confirmed Keep, regroups and leaves', async () => {
    await render(<RouteGroupingPreviewScreen />);
    await act(async () => {});
    await act(() => mockOnChange?.(moved));
    await fireEvent.press(screen.getByTestId('grouping-keep-button'));

    expect(mockSetMatchStrictness).not.toHaveBeenCalled();
    await act(confirmKeep);

    expect(mockSetMatchStrictness).toHaveBeenCalledTimes(1);
    expect(mockSetMatchStrictness).toHaveBeenCalledWith(65, 180);
    expect(mockRescan).toHaveBeenCalledTimes(1);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('writes nothing when the confirmation is cancelled', async () => {
    await render(<RouteGroupingPreviewScreen />);
    await act(async () => {});
    await act(() => mockOnChange?.(moved));
    await fireEvent.press(screen.getByTestId('grouping-keep-button'));

    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect(mockSetMatchStrictness).not.toHaveBeenCalled();
    expect(mockRescan).not.toHaveBeenCalled();
  });

  it('writes nothing on Discard and leaves', async () => {
    await render(<RouteGroupingPreviewScreen />);
    await act(async () => {});
    await act(() => mockOnChange?.(moved));
    await fireEvent.press(screen.getByTestId('grouping-discard-button'));

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

    await render(<RouteGroupingPreviewScreen />);
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

    await render(<RouteGroupingPreviewScreen />);
    await act(async () => {});

    expect(mockStart).toHaveBeenCalledWith(GROUPING_DEFAULTS);
  });
});

/**
 * Scenario: the engine throws while the preview reads the athlete's routes or
 * their riding areas.
 *
 * Expected behaviour: the screen names the failure, offers a Retry that reads
 * the routes again, and offers no Keep while there is nothing to judge the
 * setting against.
 */
describe('a read that threw', () => {
  const THROWN = { tag: 'Database', inner: { msg: 'disk' } };
  const moved = { minMatchPercentage: 65, endpointThreshold: 180 };

  beforeEach(() => {
    mockPreviewStatus = 'complete';
    mockPreviewGroups = [{ key: 'p1', activityIds: ['a1', 'a2'] }];
  });

  it('names the routes read failure and hides Keep', async () => {
    mockGetRoutesScreenData.mockImplementationOnce(() => {
      throw THROWN;
    });
    render(<RouteGroupingPreviewScreen />);
    await act(async () => {});
    act(() => mockOnChange?.(moved));

    expect(screen.getByTestId('grouping-routes-failed')).toBeTruthy();
    expect(screen.queryByTestId('grouping-keep-button')).toBeNull();
  });

  it('reads the routes again on Retry and offers Keep once they arrive', async () => {
    mockGetRoutesScreenData.mockImplementationOnce(() => {
      throw THROWN;
    });
    render(<RouteGroupingPreviewScreen />);
    await act(async () => {});
    act(() => mockOnChange?.(moved));
    fireEvent.press(screen.getByText('Retry'));

    expect(mockGetRoutesScreenData).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('grouping-routes-failed')).toBeNull();
    expect(screen.getByTestId('grouping-keep-button')).toBeTruthy();
  });

  it('names the riding areas read failure', async () => {
    mockCentresThrow = THROWN;
    render(<RouteGroupingPreviewScreen />);
    await act(async () => {});

    expect(screen.getByTestId('grouping-centres-failed')).toBeTruthy();
  });
});
