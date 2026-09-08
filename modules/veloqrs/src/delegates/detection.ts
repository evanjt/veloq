/**
 * Section detection delegates.
 *
 * Orchestrates the Rust-side detection pipeline: start, poll, progress, force
 * redetect, and potential-section discovery. Emits 'sections' notifications
 * when a run completes.
 */

import type { SectionDetectionProgress } from '../conversions';
import { FfiStartOutcome, type FfiSectionConfig } from '../generated/veloqrs';
import type { DelegateHost } from './host';

export function startSectionDetection(host: DelegateHost): FfiStartOutcome {
  if (!host.ready) return FfiStartOutcome.NotReady;
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
    const status = host.timed('pollSectionDetection', () => host.engine.detection().poll());
    if (status === 'complete') {
      host.notify('sections');
    }
    return status;
  } catch (e) {
    // Logging the underlying error before collapsing to "error" - without
    // this, a Rust-side panic or DB failure in the detection apply path
    // disappeared into the void and the UI just showed a status string
    // with no context for debugging.
    console.error('[Engine] pollSectionDetection threw:', e);
    return 'error';
  }
}

/**
 * How the last finished run ended, taking nothing.
 *
 * `pollSectionDetection` receives the completion from the worker's channel, so
 * whichever caller polls first applies the run and every other caller then sees
 * idle. Only the follower may do that. A status surface reads this and the
 * progress instead: neither touches the channel.
 */
export function lastSectionDetectionOutcome(host: DelegateHost): string {
  if (!host.ready) return 'idle';
  try {
    return host.timed('lastSectionDetectionOutcome', () =>
      host.engine.detection().lastOutcome()
    );
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
 * the engine could not answer, which must not read as nothing left to do.
 */
export function sectionDetectionAwaiting(host: DelegateHost): number | null {
  if (!host.ready) return null;
  try {
    return host.timed('sectionDetectionAwaiting', () => host.engine.detection().awaitingCount());
  } catch (e) {
    console.error('[Engine] sectionDetectionAwaiting threw:', e);
    return null;
  }
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

export function forceRedetectSections(host: DelegateHost): FfiStartOutcome {
  if (!host.ready) return FfiStartOutcome.NotReady;
  try {
    return host.timed('forceRedetectSections', () => host.engine.detection().forceRedetect());
  } catch (e) {
    console.error('[Engine] forceRedetectSections failed:', e);
    return FfiStartOutcome.Failed;
  }
}
