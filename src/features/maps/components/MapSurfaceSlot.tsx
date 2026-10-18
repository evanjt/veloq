/**
 * One map surface that several subjects take turns on, without remounting it.
 *
 * A detail screen's host shows one subject at a time, whichever card is on top of its sheet: a
 * route, a section, an activity. Each kind's map view draws its subject through `SlottedMapSurface`.
 * Outside a slot that is an ordinary `MapSurface` of the view's own. Inside one it mounts nothing:
 * it publishes its specs to the slot, which holds the one surface under the view's overlays, and
 * its ref reaches that surface. A new page costs a visible gap while it loads, so a change of
 * subject is a change of specs and one camera move rather than a new WebView.
 *
 * The slot moves the camera when a subject other than the one it shows publishes: to the camera
 * that subject was last left at, from `cameraOf`, or to the view's own opening camera. The first
 * subject opens the page there. While no subject publishes, as one view gives way to the next,
 * the surface keeps its base and camera and draws nothing over them.
 */
import React, {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StyleSheet, View } from 'react-native';

import { cameraMove } from '@/theme';
import type { MapCameraSpec, MapLayerSpec } from '@/features/maps/lib/htmlBuilders/mapSurface';
import {
  MapSurface,
  type MapCameraState,
  type MapSurfaceProps,
  type MapSurfaceRef,
} from './MapSurface';

interface Published {
  owner: object;
  subject: string;
  props: MapSurfaceProps;
}

interface SlotState {
  current: Published | null;
  /** The last props published, which keep the surface's base and gestures between subjects. */
  last: MapSurfaceProps | null;
  /** The camera the page opened at, fixed for its life: the first subject's. */
  opening: MapCameraSpec | null;
}

interface SlotValue {
  subject: string;
  /** Whether the surface is up, from the first subject's publish on. */
  live: boolean;
  publish: (owner: object, subject: string, props: MapSurfaceProps) => void;
  withdraw: (owner: object) => void;
  handle: MapSurfaceRef;
}

const MapSurfaceSlotContext = createContext<SlotValue | null>(null);

const NO_SOURCES = {};
const NO_LAYERS: MapLayerSpec[] = [];

function sameProps(a: MapSurfaceProps, b: MapSurfaceProps): boolean {
  const keys = Object.keys(a) as (keyof MapSurfaceProps)[];
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]));
}

/** Whether the caller renders inside a slot, whose surface sits under it. */
export function useInMapSurfaceSlot(): boolean {
  return useContext(MapSurfaceSlotContext) !== null;
}

/**
 * Whether the caller renders inside a slot whose surface is already up, showing an earlier
 * subject. A subject arriving there draws at once, with no placeholder over the map.
 */
export function useMapSurfaceSlotLive(): boolean {
  return useContext(MapSurfaceSlotContext)?.live ?? false;
}

export interface MapSurfaceSlotProps {
  /** What the slot shows: a new value moves the camera to the subject that publishes for it. */
  subject: string;
  /** The camera the current subject was last left at, if it was shown before. */
  cameraOf?: (() => MapCameraSpec | undefined) | undefined;
  /** Every camera the surface settles at, for the subject on show. */
  onCameraSettled?: ((camera: MapCameraState) => void) | undefined;
  children: React.ReactNode;
}

export function MapSurfaceSlot({
  subject,
  cameraOf,
  onCameraSettled,
  children,
}: MapSurfaceSlotProps) {
  const [state, setState] = useState<SlotState>({ current: null, last: null, opening: null });
  const surfaceRef = useRef<MapSurfaceRef>(null);
  const stateRef = useRef(state);
  const outside = useRef({ cameraOf, onCameraSettled });
  useEffect(() => {
    stateRef.current = state;
    outside.current = { cameraOf, onCameraSettled };
  });

  const publish = useCallback((owner: object, published: string, props: MapSurfaceProps) => {
    setState((prior) => {
      const current = prior.current;
      if (
        current &&
        current.owner === owner &&
        current.subject === published &&
        sameProps(current.props, props)
      ) {
        return prior;
      }
      return {
        current: { owner, subject: published, props },
        last: props,
        opening: prior.opening ?? outside.current.cameraOf?.() ?? props.initialCamera,
      };
    });
  }, []);

  const withdraw = useCallback((owner: object) => {
    setState((prior) => (prior.current?.owner === owner ? { ...prior, current: null } : prior));
  }, []);

  const handle = useMemo<MapSurfaceRef>(
    () => ({
      fitBounds: (...args) => surfaceRef.current?.fitBounds(...args),
      setCamera: (...args) => surfaceRef.current?.setCamera(...args),
      resetOrientation: () => surfaceRef.current?.resetOrientation(),
      queryFeatures: (...args) => surfaceRef.current?.queryFeatures(...args) ?? Promise.resolve([]),
      queryViewportFeatures: (...args) =>
        surfaceRef.current?.queryViewportFeatures(...args) ?? Promise.resolve([]),
      getClusterLeaves: (...args) =>
        surfaceRef.current?.getClusterLeaves(...args) ?? Promise.resolve([]),
      getClusterExpansionZoom: (...args) =>
        surfaceRef.current?.getClusterExpansionZoom(...args) ?? Promise.resolve(null),
      projectPoints: (...args) => surfaceRef.current?.projectPoints(...args) ?? Promise.resolve([]),
    }),
    []
  );

  const live = state.opening !== null;
  const value = useMemo<SlotValue>(
    () => ({ subject, live, publish, withdraw, handle }),
    [subject, live, publish, withdraw, handle]
  );

  // The surface is ready once its page has loaded, and stays so for every subject after; a view
  // that publishes onto a ready surface is told at once, since no load is coming for it.
  const surfaceReady = useRef(false);
  const toldReady = useRef<object | null>(null);
  const handleMapReady = useCallback(() => {
    surfaceReady.current = true;
    const current = stateRef.current.current;
    toldReady.current = current?.owner ?? null;
    current?.props.onMapReady?.();
  }, []);

  const shownSubject = useRef<string | null>(null);
  useEffect(() => {
    const current = state.current;
    if (!current || current.subject !== subject) return;
    if (surfaceReady.current && toldReady.current !== current.owner) {
      toldReady.current = current.owner;
      current.props.onMapReady?.();
    }
    if (shownSubject.current === subject) return;
    const first = shownSubject.current === null;
    shownSubject.current = subject;
    if (first) return;
    const camera = outside.current.cameraOf?.() ?? current.props.initialCamera;
    surfaceRef.current?.setCamera(camera, cameraMove.move);
  }, [state, subject]);

  const handleRegionDidChange = useCallback(
    (camera: MapCameraState, isUserInteraction: boolean) => {
      stateRef.current.current?.props.onRegionDidChange?.(camera, isUserInteraction);
      outside.current.onCameraSettled?.(camera);
    },
    []
  );

  const props = state.current?.props ?? state.last;
  const { opening } = state;

  return (
    <MapSurfaceSlotContext.Provider value={value}>
      <View style={styles.fill}>
        {props && opening ? (
          <View style={StyleSheet.absoluteFill}>
            <MapSurface
              ref={surfaceRef}
              {...props}
              initialCamera={opening}
              sources={state.current ? props.sources : NO_SOURCES}
              layers={state.current ? props.layers : NO_LAYERS}
              interactiveLayers={state.current ? props.interactiveLayers : undefined}
              onMapReady={handleMapReady}
              onRegionDidChange={handleRegionDidChange}
            />
          </View>
        ) : null}
        {children}
      </View>
    </MapSurfaceSlotContext.Provider>
  );
}

/**
 * The surface a detail map view draws its subject on: its own `MapSurface` outside a slot, the
 * slot's shared one inside it.
 */
export const SlottedMapSurface = forwardRef<MapSurfaceRef, MapSurfaceProps>(
  function SlottedMapSurface(props, ref) {
    const slot = useContext(MapSurfaceSlotContext);
    if (!slot) return <MapSurface ref={ref} {...props} />;
    return <PublishedMapSurface slot={slot} props={props} forwardedRef={ref} />;
  }
);

function PublishedMapSurface({
  slot,
  props,
  forwardedRef,
}: {
  slot: SlotValue;
  props: MapSurfaceProps;
  forwardedRef: React.ForwardedRef<MapSurfaceRef>;
}) {
  const [owner] = useState(() => ({}));
  const { publish, withdraw, handle, subject } = slot;
  useImperativeHandle(forwardedRef, () => handle, [handle]);
  useLayoutEffect(() => {
    publish(owner, subject, props);
  });
  useLayoutEffect(() => () => withdraw(owner), [withdraw, owner]);
  return null;
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
