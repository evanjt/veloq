import { createContext, useContext } from 'react';
import type { Insight } from '../types';

/**
 * The insight a sheet is open on and how to close it, for content deep in the
 * sheet that leaves it for another screen. Outside a sheet there is none.
 */
export interface InsightSheet {
  insight: Insight;
  onLeave: () => void;
}

export const InsightSheetContext = createContext<InsightSheet | null>(null);

export function useInsightSheet(): InsightSheet | null {
  return useContext(InsightSheetContext);
}
