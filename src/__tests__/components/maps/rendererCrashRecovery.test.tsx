/**
 * Scenario: the renderer behind a map WebView dies. On Android the platform
 * says the view it belonged to can never be used again and must leave the
 * hierarchy, and one renderer can carry every map page at once, so every
 * surface hears of the same death together. A page that kills its renderer as
 * it loads dies again on every attempt.
 *
 * Expected behaviour: on Android each surface comes back as a new view and
 * never reloads the dead one, the surfaces that die together come back one
 * after another, and a surface that keeps dying stops trying: the 2D surface
 * shows its unavailable state, the 3D surface reports a failure, and a
 * snapshot worker stays down. iOS keeps reloading the view in place, which is
 * its own contract. Every death goes into the crash log.
 */

import React from 'react';
import { Platform, View } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { MapSurface, MAP_SURFACE_UNAVAILABLE_TEST_ID } from '@/features/maps/components/MapSurface';
import { Map3DWebView } from '@/features/maps/components/Map3DWebView';
import {
  TerrainSnapshotWebView,
  type TerrainSnapshotWebViewRef,
} from '@/features/maps/components/TerrainSnapshotWebView';
import {
  RENDERER_CRASH_LIMIT,
  RENDERER_CRASH_WINDOW_MS,
  RENDERER_RESTART_STAGGER_MS,
} from '@/features/maps/lib/rendererRecovery';
import { recordCrash } from '@/shared/debug/crashLog';

interface MockProps {
  onMessage: (event: { nativeEvent: { data: string } }) => void;
  onRenderProcessGone?: () => void;
  onContentProcessDidTerminate?: () => void;
  source: { html: string };
}

/** Every view mounted and not yet unmounted, oldest first. */
const live: { props: MockProps }[] = [];
let mountedEver = 0;
const reload = jest.fn();

jest.mock('react-native-webview', () => ({
  get WebView() {
    return mockWebView;
  },
}));

const mockWebView = React.forwardRef(function MockWebView(
  props: MockProps,
  ref: React.Ref<{
    injectJavaScript: (script: string) => void;
    reload: () => void;
    stopLoading: () => void;
  }>
) {
  const entry = React.useRef({ props });
  entry.current.props = props;
  React.useEffect(() => {
    const mine = entry.current;
    live.push(mine);
    mountedEver++;
    return () => {
      live.splice(live.indexOf(mine), 1);
    };
  }, []);
  React.useImperativeHandle(ref, () => ({
    injectJavaScript: () => {},
    reload,
    stopLoading: () => {},
  }));
  return <View />;
});

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: true, colors: { background: '#000' } }),
}));
jest.mock('@/shared/debug/crashLog', () => ({
  ...jest.requireActual('@/shared/debug/crashLog'),
  recordCrash: jest.fn(),
}));
jest.mock('@/features/maps/lib/storage/terrainPreviewCache', () => ({
  hasTerrainPreview: () => false,
  isTerrainPreviewDowngraded: () => false,
  saveTerrainPreview: jest.fn(async () => 'file:///snap.jpg'),
}));

const originalOs = Platform.OS;
/** The test clock, which only moves forward from one test to the next. */
let clock = Date.now();

/** The renderer death as the platform under test reports it, to one view. */
async function die(view: { props: MockProps }) {
  await act(() => {
    if (Platform.OS === 'android') view.props.onRenderProcessGone?.();
    else view.props.onContentProcessDidTerminate?.();
  });
}

/** Long enough for any restart already scheduled to have run. */
async function settle() {
  await act(() => jest.advanceTimersByTime(RENDERER_RESTART_STAGGER_MS * 8));
}

/** One renderer death past the budget, inside one window, settling between. */
async function dieUntilSpent(current: () => { props: MockProps }) {
  for (let i = 0; i < RENDERER_CRASH_LIMIT; i++) {
    await die(current());
    await settle();
  }
  await die(current());
  await settle();
}

const surface2D = () => (
  <MapSurface
    mapStyle="light"
    initialCamera={{ center: [7.448, 46.949], zoom: 12 }}
    sources={{}}
    layers={[]}
  />
);

const surface3D = (onMapFailed?: (reason: string) => void) => (
  <Map3DWebView coordinates={[[7.448, 46.949]]} mapStyle="light" onMapFailed={onMapFailed} />
);

beforeEach(() => {
  jest.useFakeTimers();
  live.length = 0;
  mountedEver = 0;
  reload.mockClear();
  (recordCrash as jest.Mock).mockClear();
  // The stagger is shared by every surface in the process, so a test starts
  // well clear of the last one's restarts.
  clock += RENDERER_CRASH_WINDOW_MS * 10;
  jest.setSystemTime(clock);
});

afterEach(() => {
  Platform.OS = originalOs;
  jest.useRealTimers();
});

describe('a map renderer dying on Android', () => {
  beforeEach(() => {
    Platform.OS = 'android';
  });

  it('brings the 2D surface back as a new view and never reloads the dead one', async () => {
    const view = await render(surface2D());
    const dead = live[0];
    expect(mountedEver).toBe(1);

    await die(dead);
    await settle();

    expect(reload).not.toHaveBeenCalled();
    expect(mountedEver).toBe(2);
    expect(live).toHaveLength(1);
    expect(live[0]).not.toBe(dead);
    expect(recordCrash).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'webview-renderer', fatal: false })
    );
    await view.unmount();
  });

  it('shows the 2D surface unavailable and mounts nothing once it keeps dying', async () => {
    const view = await render(surface2D());

    await dieUntilSpent(() => live[0]);

    expect(mountedEver).toBe(RENDERER_CRASH_LIMIT + 1);
    expect(live).toHaveLength(0);
    expect(view.getByTestId(MAP_SURFACE_UNAVAILABLE_TEST_ID)).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
    expect(recordCrash).toHaveBeenCalledTimes(RENDERER_CRASH_LIMIT + 1);
    await view.unmount();
  });

  it('keeps recovering a surface whose deaths are a window apart', async () => {
    const view = await render(surface2D());

    for (let i = 0; i < RENDERER_CRASH_LIMIT + 2; i++) {
      await die(live[0]);
      await settle();
      await act(() => jest.advanceTimersByTime(RENDERER_CRASH_WINDOW_MS));
    }

    expect(live).toHaveLength(1);
    expect(view.queryByTestId(MAP_SURFACE_UNAVAILABLE_TEST_ID)).toBeNull();
    await view.unmount();
  });

  it('brings the 3D surface back as a new view and never reloads the dead one', async () => {
    const view = await render(surface3D());
    const dead = live[0];

    await die(dead);
    await settle();

    expect(reload).not.toHaveBeenCalled();
    expect(mountedEver).toBe(2);
    expect(live).toHaveLength(1);
    expect(live[0]).not.toBe(dead);
    await view.unmount();
  });

  it('reports the 3D surface failed and mounts nothing once it keeps dying', async () => {
    const onMapFailed = jest.fn();
    const view = await render(surface3D(onMapFailed));

    await dieUntilSpent(() => live[0]);

    expect(onMapFailed).toHaveBeenCalledTimes(1);
    expect(mountedEver).toBe(RENDERER_CRASH_LIMIT + 1);
    expect(live).toHaveLength(0);
    await view.unmount();
  });

  it('brings a snapshot worker back as a new view, and leaves it down once it keeps dying', async () => {
    const ref = React.createRef<TerrainSnapshotWebViewRef>();
    const view = await render(<TerrainSnapshotWebView ref={ref} />);
    expect(live).toHaveLength(2);
    const [first, second] = live;

    await die(first);
    await settle();

    expect(reload).not.toHaveBeenCalled();
    expect(mountedEver).toBe(3);
    expect(live).toHaveLength(2);
    expect(live).toContain(second);
    expect(live).not.toContain(first);

    const replaced = () => live.find((entry) => entry !== second)!;
    for (let i = 1; i < RENDERER_CRASH_LIMIT; i++) {
      await die(replaced());
      await settle();
    }
    await die(replaced());
    await settle();

    expect(live).toEqual([second]);
    expect(mountedEver).toBe(RENDERER_CRASH_LIMIT + 2);
    await view.unmount();
  });

  it('brings surfaces that die together back one after another', async () => {
    const flat = await render(surface2D());
    const terrain = await render(surface3D());
    const [a, b] = live;

    await die(a);
    await die(b);

    expect(mountedEver).toBe(3);
    await act(() => jest.advanceTimersByTime(RENDERER_RESTART_STAGGER_MS - 1));
    expect(mountedEver).toBe(3);
    await act(() => jest.advanceTimersByTime(1));
    expect(mountedEver).toBe(4);
    expect(live).not.toContain(a);
    expect(live).not.toContain(b);

    await flat.unmount();
    await terrain.unmount();
  });

  it('mounts nothing for a surface that unmounts while its restart waits', async () => {
    const first = await render(surface2D());
    const second = await render(surface2D());
    const [a, b] = live;
    await die(a);
    await die(b);
    const before = mountedEver;

    await second.unmount();
    await settle();

    expect(mountedEver).toBe(before);
    await first.unmount();
  });
});

describe('a map renderer dying on iOS', () => {
  beforeEach(() => {
    Platform.OS = 'ios';
  });

  it('reloads the 2D surface in place', async () => {
    const view = await render(surface2D());

    await die(live[0]);
    await settle();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(mountedEver).toBe(1);
    await view.unmount();
  });

  it('stops reloading the 2D surface once it keeps dying', async () => {
    const view = await render(surface2D());

    await dieUntilSpent(() => live[0]);

    expect(reload).toHaveBeenCalledTimes(RENDERER_CRASH_LIMIT);
    expect(view.getByTestId(MAP_SURFACE_UNAVAILABLE_TEST_ID)).toBeTruthy();
    await view.unmount();
  });

  it('reloads the 3D surface in place', async () => {
    const view = await render(surface3D());

    await die(live[0]);
    await settle();

    expect(reload).toHaveBeenCalledTimes(1);
    expect(mountedEver).toBe(1);
    await view.unmount();
  });
});
