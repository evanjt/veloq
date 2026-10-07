import React, { ComponentType } from 'react';
import { ScreenErrorBoundary } from './ScreenErrorBoundary';

/**
 * Wraps a screen so its boundary sits above the screen's own hooks. A boundary
 * rendered inside the screen's return only catches its descendants, so a throw
 * in the screen body would skip it and reach the global fallback.
 */
export function withScreenBoundary<P extends object>(
  Screen: ComponentType<P>,
  screenName: string
): ComponentType<P> {
  function ScreenWithBoundary(props: P) {
    return (
      <ScreenErrorBoundary screenName={screenName}>
        <Screen {...props} />
      </ScreenErrorBoundary>
    );
  }
  ScreenWithBoundary.displayName = `withScreenBoundary(${screenName})`;
  return ScreenWithBoundary;
}
