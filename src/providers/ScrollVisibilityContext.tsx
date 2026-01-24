/**
 * Context for sharing scroll visibility state across screens.
 * Allows the floating menu to respond to scroll events from any screen.
 */
import React, { createContext, useContext, useMemo, ReactNode } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { SharedValue } from 'react-native-reanimated';
import { useScrollVisibility } from '@/hooks/useScrollVisibility';

interface ScrollVisibilityContextType {
  /** Animated translateY value for hiding/showing */
  translateY: SharedValue<number>;
  /** Scroll handler to attach to ScrollView/FlatList */
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** Manually show the floating UI */
  show: () => void;
  /** Manually hide the floating UI */
  hide: () => void;
}

export const ScrollVisibilityContext = createContext<ScrollVisibilityContextType | null>(null);

export function ScrollVisibilityProvider({ children }: { children: ReactNode }) {
  const { translateY, onScroll, show, hide } = useScrollVisibility();

  // Memoize context value to prevent unnecessary re-renders of consumers
  const contextValue = useMemo(
    () => ({ translateY, onScroll, show, hide }),
    [translateY, onScroll, show, hide]
  );

  return (
    <ScrollVisibilityContext.Provider value={contextValue}>
      {children}
    </ScrollVisibilityContext.Provider>
  );
}

export function useScrollVisibilityContext() {
  const context = useContext(ScrollVisibilityContext);
  if (!context) {
    throw new Error('useScrollVisibilityContext must be used within ScrollVisibilityProvider');
  }
  return context;
}

// Stable no-op object for when context is not available
const NO_OP_SCROLL_VISIBILITY = {
  onScroll: () => {},
  show: () => {},
  hide: () => {},
} as const;

/**
 * Safe hook that returns a no-op if used outside the provider.
 * Useful for screens that may or may not have the provider.
 */
export function useScrollVisibilitySafe() {
  const context = useContext(ScrollVisibilityContext);
  if (!context) {
    // Return stable no-op object to prevent re-renders
    return NO_OP_SCROLL_VISIBILITY;
  }
  return {
    onScroll: context.onScroll,
    show: context.show,
    hide: context.hide,
  };
}
