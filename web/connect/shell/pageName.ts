// The name a detail page gives the top bar. The shell titles a screen from its
// page table; a page that shows one named thing, an activity or a recording,
// tells the shell that thing's name once it has it, and the title and the last
// crumb read it.

import { createContext, useContext, useEffect } from 'react';

export const PageNameContext = createContext<(name: string | null) => void>(() => undefined);

/** Names the page on view; the name is dropped when the page goes. */
export function usePageName(name: string | null | undefined): void {
  const set = useContext(PageNameContext);
  useEffect(() => {
    set(name ?? null);
    return () => set(null);
  }, [set, name]);
}
