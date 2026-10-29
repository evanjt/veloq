import { useCallback, useEffect, useRef, type RefObject } from 'react';

import { cameraMove } from '@/theme';
import type { MapEdgeInset } from './activityCamera';
import { settleCameraAction } from './cameraPadding';
import type { SettleInsetAction } from './htmlBuilders/shared';

/** Slack after the app's own camera move, so its region events are not read as the athlete's. */
const OWN_MOVE_GRACE_MS = 250;

/**
 * Moves a padded map to the frame a sheet settle left. An untouched map refits its track, a moved
 * one keeps its centre at the middle of what is visible. Call `markMoved` from the surface's
 * region-changing event and `markFramed` after the view fits a new subject itself. While `ready` is
 * false the surface takes no move and its region events are not the athlete's; the insets it
 * misses are sent as one move to the latest when it turns ready.
 */
export function useSettleCamera(
  inset: MapEdgeInset,
  surfaceRef: RefObject<{ settleInset: (action: SettleInsetAction) => void } | null>,
  ready = true
) {
  const applied = useRef(inset);
  const moved = useRef(false);
  const ownMoveUntil = useRef(0);
  const readyRef = useRef(ready);
  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);

  const markMoved = useCallback(() => {
    if (readyRef.current && Date.now() > ownMoveUntil.current) moved.current = true;
  }, []);
  const markFramed = useCallback(() => {
    moved.current = false;
    ownMoveUntil.current = Date.now() + cameraMove.move + OWN_MOVE_GRACE_MS;
  }, []);

  useEffect(() => {
    if (!ready) return;
    const action = settleCameraAction({
      previous: applied.current,
      next: inset,
      athleteMoved: moved.current,
    });
    applied.current = inset;
    if (action.kind === 'none') return;
    ownMoveUntil.current = Date.now() + cameraMove.move + OWN_MOVE_GRACE_MS;
    surfaceRef.current?.settleInset(action);
  }, [inset, ready, surfaceRef]);

  return { markMoved, markFramed };
}
