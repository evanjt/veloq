// The activity page's map slot: the stored track and the engine's section
// overlays drawn with the phone's layers, a marker on the line where the chart's
// crosshair is, the line's own hover moving the crosshair back, and the tracks
// of a compared set drawn over it.

import { useEffect, useMemo, useRef, useState } from 'react';

import type { Position } from '../ActivityPage';
import { write } from '../router';
import {
  NO_OVERLAY,
  activityMapSpec,
  boundsOf,
  crosshairData,
  nearestIndex,
  splitOverlay,
  trackPositions,
  type LngLat,
  type Overlay,
} from './activityLayers';
import { MapPane } from './MapPane';
import type { PickedFeature } from './hit';
import type { Ask } from './protocol';
import { baseForScheme, type PageBase } from './style';

const prefersDark = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

/** The text of a `geo.*` answer, or an empty string when the phone sends none. */
async function geoText(read: Ask, method: string, activityId: string): Promise<string> {
  const answer = (await read(method, { id: activityId })) as { text?: unknown } | null;
  return typeof answer?.text === 'string' ? answer.text : '';
}

export function ActivityMap(props: {
  id: string;
  revision: number;
  read: Ask;
  /** Where the chart's crosshair is, or null while it is off. */
  position: Position | null;
  /** Told where the pointer is over the line, as the chart's crosshair would be. */
  onPosition: (position: Position | null) => void;
  /** The section lit by the right column or by the pointer over its line. */
  litSection: string | null;
  onLitSection: (id: string | null) => void;
  compare: readonly { id: string; colour: string }[];
}) {
  const { id, read, revision } = props;
  const [base] = useState<PageBase>(() => baseForScheme(prefersDark()));
  // What was read, with the ride and revision it was read for: another ride's
  // line is never drawn while this one's is on its way.
  const [loaded, setLoaded] = useState<{ key: string; positions?: LngLat[]; overlay?: Overlay }>({
    key: '',
  });
  const key = `${id}|${revision}`;
  const positions = useMemo(
    () => (loaded.key === key ? (loaded.positions ?? []) : []),
    [loaded, key]
  );
  const overlay = loaded.key === key ? (loaded.overlay ?? NO_OVERLAY) : NO_OVERLAY;
  const [others, setOthers] = useState<Record<string, LngLat[]>>({});
  const compared = props.compare.filter((entry) => entry.id !== id);
  const comparedKey = compared.map((entry) => entry.id).join('\n');

  useEffect(() => {
    let current = true;
    const keep = (part: { positions?: LngLat[]; overlay?: Overlay }) =>
      current && setLoaded((held) => ({ ...(held.key === key ? held : { key }), key, ...part }));
    geoText(read, 'geo.track', id).then(
      (text) => keep({ positions: trackPositions(text) }),
      () => undefined
    );
    geoText(read, 'geo.activityOverlay', id).then(
      (text) => keep({ overlay: splitOverlay(text) }),
      () => undefined
    );
    return () => {
      current = false;
    };
  }, [read, id, key]);

  useEffect(() => {
    let current = true;
    for (const other of comparedKey ? comparedKey.split('\n') : []) {
      geoText(read, 'geo.track', other).then(
        (text) => current && setOthers((held) => ({ ...held, [other]: trackPositions(text) })),
        () => undefined
      );
    }
    return () => {
      current = false;
    };
  }, [read, comparedKey]);

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

  const crosshair = useMemo(() => crosshairData(positions, marked), [positions, marked]);
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
      }),
    // `compared` is read through its key: the set is rebuilt on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base, id, revision, overlay, crosshair, props.litSection, comparedKey]
  );
  const bounds = useMemo(() => {
    const box = boundsOf([positions, ...compared.map((entry) => others[entry.id] ?? [])]);
    return box ? { bounds: [box[0][0], box[0][1], box[1][0], box[1][1]] as maplibregl.Bounds } : {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions, others, comparedKey]);

  const onMove = (found: PickedFeature | null, at: [number, number]) => {
    const onLine = found?.layerId === 'route-line';
    if (onLine) {
      const nearest = nearestIndex(positions, at);
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
      read={read}
      onMove={onMove}
      onClick={(feature) => {
        if (feature.layerId === 'overlay-line' || feature.layerId === 'portion-line') {
          const section = String(feature.properties?.id ?? feature.id ?? '');
          if (section) location.hash = write({ screen: 'section', id: section, query: [] });
        }
      }}
    />
  );
}
