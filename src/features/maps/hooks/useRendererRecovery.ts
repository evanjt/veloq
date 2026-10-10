import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createRendererRecovery,
  type RendererRecovery,
  type RendererRecoveryActions,
} from '@/features/maps/lib/rendererRecovery';

/**
 * Renderer-death recovery for a surface that owns one WebView. `viewKey` goes
 * on the WebView, and moves when the page has to come back in a new view.
 * `lost` is true once the surface has spent its restarts, and then no WebView
 * is mounted.
 */
export function useRendererRecovery(surface: string, actions: RendererRecoveryActions) {
  const [viewKey, setViewKey] = useState(0);
  const [lost, setLost] = useState(false);
  // Kept current after each commit. A renderer death is an event from the
  // native side, so it always arrives after the render that passed `actions`.
  const actionsRef = useRef(actions);
  useEffect(() => {
    actionsRef.current = actions;
  });

  const recoveryRef = useRef<RendererRecovery | null>(null);
  if (recoveryRef.current === null) {
    recoveryRef.current = createRendererRecovery(surface, () => ({
      forget: () => actionsRef.current.forget(),
      restart: (how) => {
        actionsRef.current.restart(how);
        if (how === 'remount') setViewKey((key) => key + 1);
      },
      exhausted: () => {
        setLost(true);
        actionsRef.current.exhausted();
      },
    }));
  }

  useEffect(() => {
    const recovery = recoveryRef.current;
    return () => recovery?.cancel();
  }, []);

  const onRendererGone = useCallback(() => recoveryRef.current?.gone(), []);

  return { viewKey, lost, onRendererGone };
}
