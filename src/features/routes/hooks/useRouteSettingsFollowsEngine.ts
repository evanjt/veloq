import { useEffect, useRef } from 'react';

import { useEngineSubscription } from '@/shared/native/useEngineSubscription';

import { useRouteSettings } from '../stores/RouteSettingsStore';

/**
 * Keep the route settings store current with writes made elsewhere.
 *
 * The store reads its stored row once at launch. A linked browser writes
 * settings through the engine, which announces the `settings` channel, and
 * this re-reads the row on each announcement so every screen that follows the
 * store shows the new value.
 */
export function useRouteSettingsFollowsEngine(): void {
  const trigger = useEngineSubscription(['settings']);
  const first = useRef(trigger);
  useEffect(() => {
    if (trigger === first.current) return;
    void useRouteSettings.getState().reload();
  }, [trigger]);
}
