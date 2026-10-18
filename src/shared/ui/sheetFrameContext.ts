import { createContext } from 'react';

/** The fill and bottom padding a sheet frame that draws no view leaves to the scroll view under it. */
export interface SheetFrameFill {
  backgroundColor: string | undefined;
  paddingBottom: number;
}

/** Set only under a sheet frame that draws no view of its own; null under any other. */
export const SheetFrameContext = createContext<SheetFrameFill | null>(null);
