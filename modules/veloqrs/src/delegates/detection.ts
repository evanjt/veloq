/**
 * Section detection delegates.
 *
 * Orchestrates the Rust-side detection pipeline: start, poll, progress, force
 * redetect, and potential-section discovery. The 'sections' refresh after a
 * run comes from the engine's `detectionApplied` notice, not from a poll.
 */

import type { SectionDetectionProgress } from '../conversions';
import {
  FfiStartOutcome,
  type FfiStartResult,
  type FfiMatchStrictness,
  type FfiSectionConfig,
} from '../generated/veloqrs';
import type { DelegateHost } from './host';
import { startResult } from './start';

export function startSectionDetection(host: DelegateHost): FfiStartResult {
  if (!host.ready) return startResult(FfiStartOutcome.NotReady);
  return host.timed('startSectionDetection', () => host.engine.detection().start());
}

/**
 * Ask a running detection to stop. False when there was none.
 *
 * Cooperative: it returns at once and the worker ends at its next stage
 * boundary, so a caller watches the progress rather than this answer.
 */
export function cancelSectionDetection(host: DelegateHost): boolean {
  if (!host.ready) return false;
  return host.timed('cancelSectionDetection', () => host.engine.detection().cancel());
}

export function pollSectionDetection(host: DelegateHost): string {
  if (!host.ready) return 'idle';
  try {
    return host.timed('pollSectionDetection', () => host.engine.detection().poll());
  } catch (e) {
    // Logging the underlying error before collapsing to "error" - without
    // this, a Rust-side panic or DB failure in the detection apply path
    // disappeared into the void and the UI just showed a status string
    // with no context for debugging.
    console.error('[Engine] pollSectionDetection threw:', e);
    return 'error';
  }
}

export function pollSectionDetectionRun(host: DelegateHost, runId: string): string {
  if (!host.ready) return '0:idle';
  try {
    return host.timed('pollSectionDetectionRun', () => host.engine.detection().pollFollowed(runId));
  } catch (e) {
    console.error('[Engine] pollSectionDetectionRun threw:', e);
    return '0:error';
  }
}

/**
 * How the last finished run ended, taking nothing.
 *
 * The worker applies and settles its own run, so a poll after it ends reads
 * idle and the verdict lives here. A status surface reads this and the
 * progress, and neither touches the worker's channel.
 */
export function lastSectionDetectionOutcome(host: DelegateHost): string {
  if (!host.ready) return 'idle';
  try {
    return host.timed('lastSectionDetectionOutcome', () => host.engine.detection().lastOutcome());
  } catch (e) {
    console.error('[Engine] lastSectionDetectionOutcome threw:', e);
    return 'idle';
  }
}

/**
 * How many stored activities have never been through a detect.
 *
 * The progress read answers only for a run holding the slot now, and the phase
 * behind it is process-global and starts at idle, so a relaunch with work
 * outstanding reads as nothing to report. This is the durable half. Null means
 * the engine is not open, and a failed count throws, so neither reads as
 * nothing left to do.
 */
export function sectionDetectionAwaiting(host: DelegateHost): number | null {
  if (!host.ready) return null;
  return host.timed('sectionDetectionAwaiting', () => host.engine.detection().awaitingCount());
}

export function getSectionDetectionProgress(host: DelegateHost): SectionDetectionProgress | null {
  if (!host.ready) return null;
  return (
    host.timed('getSectionDetectionProgress', () => host.engine.detection().getProgress()) ?? null
  );
}

export function setSectionConfig(host: DelegateHost, config: FfiSectionConfig): void {
  host.write('setSectionConfig', () => host.engine.detection().setConfig(config));
}

export function getSectionConfig(host: DelegateHost): FfiSectionConfig | null {
  if (!host.ready) return null;
  return host.timed('getSectionConfig', () => host.engine.detection().getConfig());
}

export function setMatchStrictness(
  host: DelegateHost,
  minMatchPct: number,
  endpointThreshold: number
): void {
  host.write('setMatchStrictness', () =>
    host.engine.detection().setMatchStrictness(minMatchPct, endpointThreshold)
  );
}

/**
 * The match strictness the grouper is running at, or null before the engine is
 * open. The setter has been bound since the preset chips shipped; the read-back
 * had no caller until the grouping preview screen, which used to open on the
 * defaults and claim a value that was not applied.
 */
export function getMatchStrictness(host: DelegateHost): FfiMatchStrictness | null {
  if (!host.ready) return null;
  return host.timed('getMatchStrictness', () => host.engine.detection().getMatchStrictness());
}

export function forceRedetectSections(host: DelegateHost): FfiStartResult {
  if (!host.ready) return startResult(FfiStartOutcome.NotReady);
  try {
    return host.timed('forceRedetectSections', () => host.engine.detection().forceRedetect());
  } catch (e) {
    console.error('[Engine] forceRedetectSections failed:', e);
    return startResult(FfiStartOutcome.Failed);
  }
}
