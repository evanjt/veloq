import { useCallback, useState } from 'react';

type SectionKey = string;

export interface UseCollapsibleSections<K extends SectionKey> {
  expanded: (key: K) => boolean;
  toggle: (key: K) => void;
  setExpanded: (key: K, value: boolean) => void;
}

/**
 * Bundles multiple boolean expand flags into a single state object with a
 * Map-style API. Replaces N `useState<boolean>` calls on screens that manage
 * several collapsible sections (e.g. Fitness screen).
 *
 * Usage:
 *   const sections = useCollapsibleSections({ bests: false, zones: false });
 *   sections.expanded('bests');
 *   sections.toggle('bests');
 *   sections.setExpanded('zones', true);
 */
export function useCollapsibleSections<K extends SectionKey>(
  initial: Record<K, boolean>
): UseCollapsibleSections<K> {
  const [state, setState] = useState<Record<K, boolean>>(initial);

  const expanded = useCallback((key: K) => Boolean(state[key]), [state]);

  const toggle = useCallback((key: K) => {
    setState((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const setExpanded = useCallback((key: K, value: boolean) => {
    setState((prev) => ({ ...prev, [key]: value }));
  }, []);

  return { expanded, toggle, setExpanded };
}
