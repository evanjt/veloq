import { useEffect, useMemo } from 'react';

import { createInteractionPacer } from './interactionPacer';

/**
 * Touch handlers for the root view that tell the engine when the athlete is
 * touching the screen, through `push`. Capture handlers, so no screen's own
 * responder is disturbed.
 */
export function useInteractionPacing(push: (interacting: boolean) => void) {
  const pacer = useMemo(() => createInteractionPacer(push), [push]);
  useEffect(() => () => pacer.stop(), [pacer]);

  return useMemo(
    () => ({
      onTouchStartCapture: pacer.touch,
      onTouchMoveCapture: pacer.touch,
    }),
    [pacer]
  );
}
