// The activity page's map slot: the stored track and the engine's section
// overlays drawn with the phone's layers, a marker on the line where the chart's
// crosshair is, the line's own hover moving the crosshair back, and the tracks
// of a compared set drawn over it.

import { useEffect, useMemo, useRef, useState } from 'react';

import type { Position } from '../pages/ActivityPage';
import { go } from '../router';
import {
  NO_OVERLAY,
  activityMapSpec,
  boundsOf,
  crosshairData,
  endpointsData,
  geoText,
  nearestIndex,
  rangeLine,
  splitOverlay,
  trackLine,
  trackPositions,
  trackSamples,
  type Sample,
  type LngLat,
  type Overlay,
  type TrackColour,
} from './activityLayers';
import { MapPane, type MapHandle } from './MapPane';
import { moved, snapIndex, type Handle } from '../sectionBounds';
import type { PickedFeature } from './hit';
import type { QueryClient } from '../query';
import { isDarkScheme } from '../appearance';
import { baseForScheme, type PageBase } from './style';

export function ActivityMap(props: {
  id: string;
  revision: number;
  queries: QueryClient;
  /** Where the chart's crosshair is, or null while it is off. */
  position: Position | null;
  /** Told where the pointer is over the line, as the chart's crosshair would be. */
  onPosition: (position: Position | null) => void;
  /** The section lit by the right column or by the pointer over its line. */
  litSection: string | null;
  onLitSection: (id: string | null) => void;
  compare: readonly { id: string; colour: string }[];
  /** The first and last sample a chart brush covers, or null when the zoom is reset. */
  range?: { from: number; to: number } | null;
  /** The streams the line is coloured by, or null for the solid line. */
  colour?: TrackColour | null;
  /** Two grips on the line that cut a range from it; the range is `range`, which they change. */
  create?: {
    labels: Record<Handle, string>;
    onRange: (range: { from: number; to: number }) => void;
  } | null;
}) {
  const { id, queries, revision } = props;
  const [base] = useState<PageBase>(() => baseForScheme(isDarkScheme()));
  // What was read, with the ride and revision it was read for: another ride's
  // line is never drawn while this one's is on its way.
  const [loaded, setLoaded] = useState<{ key: string; samples?: Sample[]; overlay?: Overlay }>({
    key: '',
  });
  const key = `${id}|${revision}`;
  // Stream order, a lost fix a null: the chart's index is this array's index.
  const samples = useMemo<Sample[]>(
    () => (loaded.key === key ? (loaded.samples ?? []) : []),
    [loaded, key]
  );
  const positions = useMemo(
    () => samples.filter((sample): sample is LngLat => sample !== null),
    [samples]
  );
  const overlay = loaded.key === key ? (loaded.overlay ?? NO_OVERLAY) : NO_OVERLAY;
  const [others, setOthers] = useState<Record<string, LngLat[]>>({});
  const compared = props.compare.filter((entry) => entry.id !== id);
  const comparedKey = compared.map((entry) => entry.id).join('\n');

  useEffect(() => {
    let current = true;
    const keep = (part: { samples?: Sample[]; overlay?: Overlay }) =>
      current && setLoaded((held) => ({ ...(held.key === key ? held : { key }), key, ...part }));
    geoText(queries, 'geo.track', id).then(
      (text) => keep({ samples: trackSamples(text) }),
      () => undefined
    );
    geoText(queries, 'geo.activityOverlay', id).then(
      (text) => keep({ overlay: splitOverlay(text) }),
      () => undefined
    );
    return () => {
      current = false;
    };
  }, [queries, id, key]);

  useEffect(() => {
    let current = true;
    for (const other of comparedKey ? comparedKey.split('\n') : []) {
      geoText(queries, 'geo.track', other).then(
        (text) => current && setOthers((held) => ({ ...held, [other]: trackPositions(text) })),
        () => undefined
      );
    }
    return () => {
      current = false;
    };
  }, [queries, comparedKey]);

  // The marker follows the crosshair at most once per animation frame.
  const [marked, setMarked] = useState<number | null>(null);
  const wanted = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const index = props.position?.index ?? null;
  useEffect(() => {
    wanted.current = index;
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setMarked(wanted.current);
    });
  }, [index]);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    []
  );

  const crosshair = useMemo(() => crosshairData(samples, marked), [samples, marked]);
  const range = props.range ?? null;
  const endpoints = useMemo(() => endpointsData(positions), [positions]);
  const colour = props.colour ?? null;
  const gradient = useMemo(() => (colour ? trackLine(colour, base) : null), [colour, base]);
  const rangeData = useMemo(
    () => rangeLine(samples, range),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [samples, range?.from, range?.to]
  );
  const spec = useMemo(
    () =>
      activityMapSpec({
        base,
        activityId: id,
        revision,
        overlay,
        crosshair,
        highlightedSectionId: props.litSection,
        compare: compared,
        range: rangeData,
        endpoints,
        gradient,
      }),
    // `compared` is read through its key: the set is rebuilt on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      base,
      id,
      revision,
      overlay,
      crosshair,
      rangeData,
      endpoints,
      gradient,
      props.litSection,
      comparedKey,
    ]
  );
  const creating = props.create ?? null;
  const cutting = creating !== null;
  const bounds = useMemo(() => {
    // The camera stays on the whole ride while grips are dragged, or it would follow them.
    const zoomed = creating
      ? undefined
      : (rangeData.features[0]?.geometry as GeoJSON.LineString | undefined);
    const box = boundsOf([
      zoomed ? (zoomed.coordinates as LngLat[]) : positions,
      ...compared.map((entry) => others[entry.id] ?? []),
    ]);
    return box ? { bounds: [box[0][0], box[0][1], box[1][0], box[1][1]] as maplibregl.Bounds } : {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, others, comparedKey, rangeData, cutting]);

  const whole = { start: 0, end: Math.max(0, samples.length - 1) };
  const span = props.range
    ? { start: props.range.from, end: Math.min(props.range.to, whole.end) }
    : whole;
  const handles: MapHandle[] = creating
    ? (['start', 'end'] as const).flatMap((handle) => {
        const at = samples[span[handle]];
        return at ? [{ id: handle, at, label: creating.labels[handle] }] : [];
      })
    : [];
  const place = (handle: Handle, index: number | null) => {
    if (!creating || index === null) return;
    const next = moved(span, handle, index, whole);
    creating.onRange({ from: next.start, to: next.end });
  };

  const onMove = (found: PickedFeature | null, at: [number, number]) => {
    const onLine = found?.layerId === 'route-line';
    if (onLine) {
      const nearest = nearestIndex(samples, at);
      if (nearest !== null) props.onPosition({ index: nearest, time: 0, distance: 0 });
    }
    const section =
      found && (found.layerId === 'overlay-line' || found.layerId === 'portion-line')
        ? String(found.properties?.id ?? found.id ?? '')
        : null;
    if (section !== props.litSection) props.onLitSection(section || null);
  };

  return (
    <MapPane
      base={base}
      spec={spec}
      camera={bounds}
      queries={queries}
      handles={handles}
      onHandleMove={(handle, at) => place(handle as Handle, snapIndex(samples, at, whole))}
      onHandleStep={(handle, delta) => place(handle as Handle, span[handle as Handle] + delta)}
      onMove={onMove}
      onClick={(feature) => {
        if (feature.layerId === 'overlay-line' || feature.layerId === 'portion-line') {
          const section = String(feature.properties?.id ?? feature.id ?? '');
          if (section) go({ screen: 'section', id: section, query: [] });
        }
      }}
    />
  );
}
