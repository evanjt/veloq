/**
 * useMapFullscreen — fullscreen modal state management for map components.
 *
 * Tracks whether the map is in fullscreen mode and exposes guarded open/close
 * callbacks. `openFullscreen` is a no-op when `enableFullscreen` is false.
 *
 * Extracted from ActivityMapView.tsx — pure refactor, no behaviour change.
 */

import { useCallback, useState } from 'react';

interface UseMapFullscreenParams {
  /** When false, `openFullscreen` is a no-op. */
  enableFullscreen: boolean;
}

interface UseMapFullscreenResult {
  /** Whether the map is currently in fullscreen mode. */
  isFullscreen: boolean;
  /** Enter fullscreen mode (no-op if `enableFullscreen` is false). */
  openFullscreen: () => void;
  /** Exit fullscreen mode. */
  closeFullscreen: () => void;
}

export function useMapFullscreen({
  enableFullscreen,
}: UseMapFullscreenParams): UseMapFullscreenResult {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const openFullscreen = useCallback(() => {
    if (enableFullscreen) {
      setIsFullscreen(true);
    }
  }, [enableFullscreen]);

  const closeFullscreen = useCallback(() => {
    setIsFullscreen(false);
  }, []);

  return { isFullscreen, openFullscreen, closeFullscreen };
}
