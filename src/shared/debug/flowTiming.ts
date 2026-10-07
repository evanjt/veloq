/**
 * Gesture-to-first-frame spans, recorded in the Developer Dashboard's metrics
 * ring.
 *
 * A flow is marked where the gesture or delivery starts and completed at the
 * first frame that shows its result. The ring survives a release build, so the
 * spans are readable on an installed app. A mark that is marked again before
 * it completes is superseded: only the latest start is timed. A completion
 * with no mark records nothing, and a second completion records nothing.
 *
 * The names are the contract: the dashboard groups on the name alone.
 */

import { recordAppMetric } from '@/shared/debug/renderTimer';

/** Time-range change to the first frame showing the section list for the new range. */
export const FLOW_EXPAND = 'flow.expand';
/** One new activity delivered by sync to the first frame showing its applied sections. */
export const FLOW_ADD_ONE = 'flow.addOne';
/** Press on a section row to the first frame with the visit list rendered. */
export const FLOW_SECTION_OPEN = 'flow.sectionOpen';

const marks = new Map<string, number>();

export function markFlow(name: string, now: number = performance.now()): void {
  marks.set(name, now);
}

export function completeFlow(name: string, now: number = performance.now()): void {
  const startedAt = marks.get(name);
  if (startedAt === undefined) return;
  marks.delete(name);
  if (now < startedAt) return;
  recordAppMetric(name, now - startedAt);
}

/** Complete at the frame after the commit that is running now. */
export function completeFlowAfterFrame(name: string): void {
  requestAnimationFrame(() => completeFlow(name));
}
