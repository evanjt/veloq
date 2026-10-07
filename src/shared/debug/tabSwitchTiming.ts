/**
 * Press-to-first-frame time of a tab switch, in the Developer Dashboard's
 * metrics ring.
 *
 * The bar stamps the press; the target tab stamps its first frame after the
 * switch lands. The ring survives a release build, which no log channel does,
 * so the figure is readable on a handset without a trace. The metric names are
 * read back out of `getFFIMetricsSummary`, which groups on the name alone.
 */

import { useEffect } from 'react';
import { usePathname } from 'expo-router';
import { recordAppMetric } from './renderTimer';

const TAB_NAMES: Record<string, string> = {
  '/': 'feed',
  '/fitness': 'fitness',
  '/map': 'map',
  '/insights': 'insights',
  '/training': 'training',
};

export function tabSwitchMetric(route: string): string {
  return `tab.${TAB_NAMES[route] ?? route.replace(/^\//, '')}`;
}

const pending = new Map<string, number>();

/** Stamp a press on `route`. A second press before a frame replaces the first. */
export function markTabPress(route: string, now: number = performance.now()): void {
  pending.set(route, now);
}

/** Record the pending press on `route`, once; a frame with no press records nothing. */
export function recordTabFirstFrame(route: string, now: number = performance.now()): void {
  const startedAt = pending.get(route);
  if (startedAt === undefined) return;
  pending.delete(route);
  if (now < startedAt) return;
  recordAppMetric(tabSwitchMetric(route), now - startedAt);
}

/**
 * Called by a tab screen: records the press once the screen's route is the
 * current one and the screen has painted. A tab stays mounted after its first
 * visit, so the route, not the mount, is what a later press changes.
 */
export function useTabFirstFrame(route: string): void {
  const pathname = usePathname();
  const current =
    route === '/' ? pathname === '/' || pathname === '/index' : pathname.startsWith(route);
  useEffect(() => {
    if (!current) return undefined;
    const handle = requestAnimationFrame(() => recordTabFirstFrame(route));
    return () => cancelAnimationFrame(handle);
  }, [current, route]);
}
