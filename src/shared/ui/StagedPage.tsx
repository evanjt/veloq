import React, { useEffect, useState } from 'react';

/**
 * Counts the frames since a page first mounted, up to `last`, so a page paints
 * its frame first and its heavier parts one per frame after. The count lives
 * with the page, so a page that stays mounted is staged once, on its first
 * visit, and a later visit draws every stage in the commit that shows it.
 */
export function StagedPage({
  last,
  children,
}: {
  last: number;
  children: (stage: number) => React.ReactNode;
}) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (stage >= last) return undefined;
    const id = requestAnimationFrame(() => setStage(stage + 1));
    return () => cancelAnimationFrame(id);
  }, [stage, last]);
  return <>{children(stage)}</>;
}
