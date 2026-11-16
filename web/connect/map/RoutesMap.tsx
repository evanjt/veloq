// The routes and sections pages' map slot: the list's lines, or one route or
// section drawn from the engine's own reads. The page owns the hovered row; the
// map reports the line under the pointer and lights the line of the hovered row.

import { useEffect, useMemo, useState } from 'react';

import { MapPane } from './MapPane';
import type { QueryClient } from '../query';
import {
  boundsOfGeoText,
  type PickedAttempt,
  listSpec,
  routeDetailSpec,
  rowOfFeature,
  sectionDetailSpec,
} from './routeLayers';
import { isDarkScheme } from '../appearance';
import { baseForScheme, type PageBase } from './style';

export type RoutesMapTarget =
  { kind: 'routes' | 'sections' } | { kind: 'route' | 'section'; id: string };

/** The method and ask whose text the camera fits to. */
function fitRead(target: RoutesMapTarget): [string, object] {
  switch (target.kind) {
    case 'routes':
      return ['geo.routeLines', {}];
    case 'sections':
      return ['geo.sections', {}];
    case 'route':
      return ['geo.route', { groupId: target.id }];
    default:
      return ['geo.sectionPasses', { sectionId: target.id }];
  }
}

export function RoutesMap(props: {
  queries: QueryClient;
  target: RoutesMapTarget;
  /** The row the pointer is on in the page's table. */
  hoveredRow: string | null;
  /** Told the row of the line under the pointer. */
  onHoverRow: (id: string | null) => void;
  /** Attempts whose full tracks have been asked for, and the one shown. */
  askedTracks: readonly string[];
  /** The selected passes, in selection order. */
  selected: readonly string[];
  /** On a route, the attempt drawn in its side's colour; its track is among `askedTracks`. */
  picked?: PickedAttempt | null;
  /** A list line was clicked: open its detail. */
  onOpen: (id: string) => void;
  /** A pass line was clicked: select its row. */
  onPickPass: (id: string) => void;
}) {
  const { queries, target } = props;
  const [base] = useState<PageBase>(() => baseForScheme(isDarkScheme()));
  const key = target.kind + ('id' in target ? `:${target.id}` : '');
  const [fit, setFit] = useState<{ key: string; bounds: maplibregl.Bounds } | null>(null);

  useEffect(() => {
    let current = true;
    const [method, params] = fitRead(target);
    queries.fetch(method, params).then(
      (answer) => {
        const text = (answer as { text?: unknown } | null)?.text;
        const box = typeof text === 'string' ? boundsOfGeoText(text) : null;
        if (current && box) setFit({ key, bounds: box });
      },
      () => undefined
    );
    return () => {
      current = false;
    };
    // `target` is rebuilt each render; the key says what it names.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queries, key]);

  const lists = target.kind === 'routes' || target.kind === 'sections';
  const selectedKey = props.selected.join('\n');
  const pickedKey = props.picked ? `${props.picked.id}:${props.picked.side}` : '';
  const spec = useMemo(() => {
    switch (target.kind) {
      case 'routes':
      case 'sections':
        return listSpec(base, target.kind, 0);
      case 'route':
        return routeDetailSpec(
          base,
          target.id,
          props.askedTracks,
          props.hoveredRow,
          props.picked ?? null
        );
      default:
        return sectionDetailSpec(base, target.id, props.hoveredRow, props.selected);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, key, props.askedTracks, props.hoveredRow, selectedKey, pickedKey]);

  return (
    <MapPane
      base={base}
      spec={spec}
      camera={fit?.key === key ? { bounds: fit.bounds } : {}}
      queries={queries}
      highlightedIds={lists && props.hoveredRow ? [props.hoveredRow] : []}
      onHover={(id) => {
        if (lists || target.kind === 'section') props.onHoverRow(id);
      }}
      onMove={(found) => {
        if (target.kind === 'section') props.onHoverRow(rowOfFeature(found));
      }}
      onClick={(feature) => {
        const id = rowOfFeature(feature);
        if (!id) return;
        if (target.kind === 'routes' || target.kind === 'sections') props.onOpen(id);
        else if (target.kind === 'section' || target.kind === 'route') props.onPickPass(id);
      }}
    />
  );
}
