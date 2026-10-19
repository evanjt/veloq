/**
 * The Insights tab moved from `/routes` to `/insights`. Notifications
 * scheduled before the rename still carry the old path, and they outlive the
 * upgrade, so the old path keeps landing on the tab for one release.
 *
 * The link pushes this screen over whatever is open, so it returns to the tab navigator already
 * in the stack, as a link to `/insights` does, rather than replacing itself with a second one: a
 * replace would leave the screens it arrived over beneath, a map detail screen's native sheet
 * still presented over the tab bar among them.
 */

import { useEffect, useRef } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { returnTo } from '@/shared/app/navigation';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

function RoutesRedirectScreenContent() {
  const params = useLocalSearchParams() as Record<string, string | undefined>;
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    returnTo({ pathname: '/insights', params });
  }, [params]);

  return null;
}

export default withScreenBoundary(RoutesRedirectScreenContent, 'Routes');
