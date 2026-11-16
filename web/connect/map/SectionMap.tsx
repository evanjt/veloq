// The section page's map: the section, every pass faint, the pointer's pass
// lit, and the merge candidates as lines of their own. The page owns what is
// hovered; the map reports the line under the pointer.

import { useEffect, useMemo, useState } from 'react';

import { MapPane, type MapHandle } from './MapPane';
import type { QueryClient } from '../query';
import { boundsOf } from './activityLayers';
import { boundsOfGeoText, rowOfFeature } from './routeLayers';
import {
  boundsEditorSpec,
  sectionMapSpec,
  type BoundsEditorView,
  type CandidateLine,
} from './sectionLayers';
import type { Handle } from '../sectionBounds';
import { baseForScheme, type PageBase } from './style';

const prefersDark = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

/** Ends dragged on the map: where they are, what they are called, and who hears them move. */
export type BoundsEditor = {
  view: BoundsEditorView;
  /** The names a screen reader reads for the two grips. */
  labels: Record<Handle, string>;
  /** An end dragged to a position. The page snaps it to a vertex. */
  onMove: (handle: Handle, at: maplibregl.LngLat) => void;
  /** An arrow key on an end, one vertex a press. */
  onStep: (handle: Handle, delta: number) => void;
};

export function SectionMap(props: {
  queries: QueryClient;
  id: string;
  /** The activity whose pass is lit. */
  hoveredActivity: string | null;
  /** The activities whose passes are drawn in their own colours. */
  selected: readonly string[];
  candidates: readonly CandidateLine[];
  /** The stored geometry versions drawn beneath the section. */
  versions: readonly number[];
  /** The candidate section lit. */
  litCandidate: string | null;
  onHoverActivity: (id: string | null) => void;
  onHoverCandidate: (id: string | null) => void;
  onPickCandidate: (id: string) => void;
  /** Present while the section's ends are being edited. */
  editor?: BoundsEditor | null;
}) {
  const { queries, id } = props;
  const [base] = useState<PageBase>(() => baseForScheme(prefersDark()));
  const [fit, setFit] = useState<{ id: string; bounds: maplibregl.Bounds } | null>(null);

  useEffect(() => {
    let current = true;
    queries.fetch('geo.sectionPasses', { sectionId: id }).then(
      (answer) => {
        const text = (answer as { text?: unknown } | null)?.text;
        const box = typeof text === 'string' ? boundsOfGeoText(text) : null;
        if (current && box) setFit({ id, bounds: box });
      },
      () => undefined
    );
    return () => {
      current = false;
    };
  }, [queries, id]);

  const selectedKey = props.selected.join('\n');
  const versionsKey = props.versions.join(',');
  const editorView = props.editor?.view ?? null;
  const spec = useMemo(
    () => {
      const drawn = sectionMapSpec(
        base,
        id,
        props.hoveredActivity,
        props.selected,
        props.candidates,
        props.litCandidate,
        props.versions
      );
      return editorView ? boundsEditorSpec(drawn, editorView) : drawn;
    },
    // `selected` and `versions` are rebuilt each render; their keys say what they hold.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      base,
      id,
      props.hoveredActivity,
      selectedKey,
      props.candidates,
      props.litCandidate,
      versionsKey,
      editorView,
    ]
  );
  const editor = props.editor ?? null;
  const handles: MapHandle[] = editor
    ? (['start', 'end'] as const).flatMap((handle) => {
        const at = editor.view.path[editor.view.span[handle]];
        return at ? [{ id: handle, at, label: editor.labels[handle] }] : [];
      })
    : [];
  // The camera frames what the ends can reach while they are edited, and the passes otherwise.
  const windowKey = editorView ? `${editorView.window.start}:${editorView.window.end}` : '';
  const framed = useMemo(() => {
    if (!editorView) return null;
    const box = boundsOf([
      editorView.path.slice(editorView.window.start, editorView.window.end + 1),
    ]);
    return box ? ([box[0][0], box[0][1], box[1][0], box[1][1]] as maplibregl.Bounds) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowKey, editorView?.path]);
  const candidateIds = new Set(props.candidates.map((line) => line.id));

  return (
    <MapPane
      base={base}
      spec={spec}
      camera={framed ? { bounds: framed } : fit?.id === id ? { bounds: fit.bounds } : {}}
      queries={queries}
      highlightedIds={[]}
      handles={handles}
      onHandleMove={(handle, at) => editor?.onMove(handle as Handle, at)}
      onHandleStep={(handle, delta) => editor?.onStep(handle as Handle, delta)}
      onHover={(found) => {
        if (found !== null && candidateIds.has(found)) props.onHoverCandidate(found);
        else props.onHoverCandidate(null);
      }}
      onMove={(found) => {
        const row = rowOfFeature(found);
        props.onHoverActivity(row !== null && candidateIds.has(row) ? null : row);
      }}
      onClick={(feature) => {
        const row = rowOfFeature(feature);
        if (row !== null && candidateIds.has(row)) props.onPickCandidate(row);
      }}
    />
  );
}
