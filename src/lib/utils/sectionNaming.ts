/**
 * Section naming utilities.
 * Generates display names for sections based on custom names or auto-generation.
 */

import { getRouteEngine } from '@/lib/native/routeEngine';
import { resolveIsMetric } from '@/providers';
import { formatDistance } from '@/lib/utils/format';

/**
 * Minimal section data needed for name generation.
 * Works with both FrequentSection from @/types and from veloqrs.
 */
interface SectionNameData {
  id: string;
  name?: string;
  sportType: string;
  distanceMeters: number;
}

/**
 * Generate a display name for a section.
 * Checks Rust engine first (authoritative source), then falls back to section.name,
 * finally generates a name from sport type and distance.
 */
export function generateSectionName(section: SectionNameData): string {
  // Check Rust engine for custom name first (authoritative source)
  const engine = getRouteEngine();
  if (engine) {
    const rustName = engine.getSectionName(section.id);
    if (rustName) return rustName;
  }

  // Fall back to section.name if present
  if (section.name) return section.name;

  // Auto-generate from sport type and distance
  const isMetric = resolveIsMetric();
  const distanceStr = formatDistance(section.distanceMeters, isMetric);

  return `${section.sportType} Section (${distanceStr})`;
}
