// The text a list's filter field holds while it is typed: shown at once, and written to the
// address once typing pauses. A text the address changes under the field (back, a link, a
// palette's "show all") replaces the draft; the page's own write does not.

import { useEffect, useRef, useState } from 'react';

/** How long typing pauses before the filter is asked of the phone and written to the address. */
export const FILTER_PAUSE_MS = 250;

const blank = (text: string) => text.trim() === '';

/** The draft and its setter; `commit` receives the draft once typing pauses, and so the page writes the address. */
export function useFilterDraft(
  committed: string,
  commit: (text: string) => void
): readonly [string, (text: string) => void] {
  const [draft, setDraft] = useState(committed);
  const [synced, setSynced] = useState(committed);
  const [written, setWritten] = useState(committed);
  const latest = useRef(commit);
  useEffect(() => {
    latest.current = commit;
  });

  if (committed !== synced) {
    setSynced(committed);
    if (committed !== written) setDraft(committed);
  }

  const settled = draft === committed || (blank(draft) && blank(committed));
  useEffect(() => {
    if (settled) return undefined;
    const typing = setTimeout(() => {
      setWritten(blank(draft) ? '' : draft);
      latest.current(draft);
    }, FILTER_PAUSE_MS);
    return () => clearTimeout(typing);
  }, [draft, settled]);

  return [draft, setDraft];
}

/** The last value that was not undefined, so a table stays mounted while a new filter's rows are on their way. */
export function useLastAnswered<T>(value: T | undefined): T | undefined {
  const [held, setHeld] = useState(value);
  if (value !== undefined && value !== held) setHeld(value);
  return value ?? held;
}
