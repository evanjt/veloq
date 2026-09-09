/**
 * The Insights tab moved from `/routes` to `/insights`. Notifications
 * scheduled before the rename still carry the old path, and they outlive the
 * upgrade, so the old path keeps landing on the tab for one release.
 */

import { useEffect, useRef } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { replaceTo } from '@/shared/app/navigation';

export default function RoutesRedirectScreen() {
  const params = useLocalSearchParams() as Record<string, string | undefined>;
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    replaceTo({ pathname: '/insights', params });
  }, [params]);

  return null;
}
