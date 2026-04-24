/**
 * Section detection delegates.
 *
 * Orchestrates the Rust-side detection pipeline: start, poll, progress, force
 * redetect, and potential-section discovery. Emits 'sections' notifications
 * when a run completes.
 */

import type { SectionDetectionProgress } from '../conversions';
import type { FfiPotentialSection, FfiSectionConfig } from '../generated/veloqrs';
import type { DelegateHost } from './host';

export function startSectionDetection(host: DelegateHost, sportFilter?: string): boolean {
  if (!host.ready) return false;
  return host.timed('startSectionDetection', () => host.engine.detection().start(sportFilter));
}

export function pollSectionDetection(host: DelegateHost): string {
  if (!host.ready) return 'idle';
  try {
    const status = host.timed('pollSectionDetection', () => host.engine.detection().poll());
    if (status === 'complete') {
      host.notify('sections');
    }
    return status;
  } catch {
    return 'error';
  }
}

export function getSectionDetectionProgress(host: DelegateHost): SectionDetectionProgress | null {
  if (!host.ready) return null;
  return (
    host.timed('getSectionDetectionProgress', () => host.engine.detection().getProgress()) ?? null
  );
}

export function detectPotentials(host: DelegateHost, sportFilter?: string): FfiPotentialSection[] {
  if (!host.ready) return [];
  return host.timed('detectPotentials', () =>
    host.engine.detection().detectPotentials(sportFilter)
  );
}

export function setSectionConfig(host: DelegateHost, config: FfiSectionConfig): void {
  if (!host.ready) return;
  host.timed('setSectionConfig', () => host.engine.detection().setConfig(config));
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
  if (!host.ready) return;
  host.timed('setMatchStrictness', () =>
    host.engine.detection().setMatchStrictness(minMatchPct, endpointThreshold)
  );
}

export function forceRedetectSections(host: DelegateHost, sportFilter?: string): boolean {
  if (!host.ready) return false;
  try {
    const started = host.timed('forceRedetectSections', () =>
      host.engine.detection().forceRedetect(sportFilter)
    );
    return started;
  } catch (e) {
    console.error('[RouteEngine] forceRedetectSections failed:', e);
    return false;
  }
}
