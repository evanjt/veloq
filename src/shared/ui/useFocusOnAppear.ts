import { useEffect, type RefObject } from 'react';
import { AccessibilityInfo, findNodeHandle } from 'react-native';

/**
 * Moves screen reader focus to `ref` when new content appears that the user is
 * expected to act on. `content` identifies what is shown: focus moves once
 * each time it changes to a non-null value, and a re-render of the same content
 * leaves focus where the user put it. Focusing the view speaks it, so nothing
 * is announced besides.
 *
 * The move waits a tick so the view has laid out, plus `afterMs` for an appear
 * animation: iOS keeps a view that is still transparent out of the
 * accessibility tree and drops a focus request aimed at it.
 */
export function useFocusOnAppear(
  ref: RefObject<unknown>,
  content: string | null | undefined,
  afterMs = 0
): void {
  useEffect(() => {
    const timer = content
      ? setTimeout(() => {
          const handle = findNodeHandle(ref.current as Parameters<typeof findNodeHandle>[0]);
          if (handle != null) AccessibilityInfo.setAccessibilityFocus(handle);
        }, afterMs)
      : null;
    return () => {
      if (timer !== null) clearTimeout(timer);
    };
  }, [ref, content, afterMs]);
}
