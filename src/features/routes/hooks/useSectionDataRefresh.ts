import { useMemo, useCallback, useState } from 'react';
import { convertNativeSectionToApp } from '@/shared/ffi/sectionConversions';
import type { Section as NativeSection } from 'veloqrs';

/**
 * The section screen's section, converted from the one the detail bundle
 * carries. A trim re-reads the bundle on its own key, so the section here
 * follows the bundle and is never read again.
 */
export function useSectionDataRefresh(bundledSection: NativeSection | undefined) {
  const [sectionRefreshKey, setSectionRefreshKey] = useState(0);

  const section = useMemo(
    () => (bundledSection ? convertNativeSectionToApp(bundledSection) : null),
    [bundledSection]
  );

  const handleTrimRefresh = useCallback(() => {
    setSectionRefreshKey((k) => k + 1);
  }, []);

  return {
    section,
    sectionRefreshKey,
    setSectionRefreshKey,
    handleTrimRefresh,
  };
}
