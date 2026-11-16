// Two panes with a draggable divider. Dragging resizes the first pane, a
// double-click resets it, the arrow keys nudge it, and the width is kept per
// browser under `storageKey`.

import { useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';

import {
  browserStorage,
  clampWidth,
  dividerKey,
  draggedWidth,
  loadWidth,
  saveWidth,
  type PaneStorage,
} from './behaviour';

const KEY_STEP = 16;

export function SplitPane(props: {
  label: string;
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  first: ReactNode;
  second: ReactNode;
  storage?: PaneStorage | null;
}) {
  const { storageKey, defaultWidth, minWidth, maxWidth } = props;
  const storage = props.storage === undefined ? browserStorage() : props.storage;
  const [width, setWidth] = useState(() =>
    loadWidth(storage, storageKey, defaultWidth, minWidth, maxWidth)
  );
  const [drag, setDrag] = useState<{ x: number; width: number } | null>(null);
  const keep = (next: number) => {
    setWidth(next);
    saveWidth(storage, storageKey, next);
  };
  function onKeyDown(event: KeyboardEvent) {
    const next = dividerKey(event.key, width, KEY_STEP, minWidth, maxWidth);
    if (next === null) return;
    event.preventDefault();
    keep(next);
  }
  return (
    <div className="ui-split" style={{ gridTemplateColumns: `${width}px auto 1fr` }}>
      <div className="ui-split-pane">{props.first}</div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={props.label}
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        aria-valuenow={clampWidth(width, minWidth, maxWidth)}
        tabIndex={0}
        className="ui-split-divider"
        data-dragging={drag !== null || undefined}
        onPointerDown={(event: PointerEvent) => {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          setDrag({ x: event.clientX, width });
        }}
        onPointerMove={(event: PointerEvent) => {
          if (drag) setWidth(draggedWidth(drag.width, drag.x, event.clientX, minWidth, maxWidth));
        }}
        onPointerUp={(event: PointerEvent) => {
          if (!drag) return;
          keep(draggedWidth(drag.width, drag.x, event.clientX, minWidth, maxWidth));
          setDrag(null);
        }}
        onDoubleClick={() => {
          setWidth(defaultWidth);
          saveWidth(storage, storageKey, null);
        }}
        onKeyDown={onKeyDown}
      />
      <div className="ui-split-pane">{props.second}</div>
    </div>
  );
}
