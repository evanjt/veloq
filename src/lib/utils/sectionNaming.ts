/**
 * Section naming utilities.
 * Generates display names for sections based on custom names or auto-generation.
 */

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
 * Uses section.name if present (already contains custom name from Rust),
 * otherwise generates a name from sport type and distance.
 */
export function generateSectionName(section: SectionNameData): string {
  // Use section.name if present (includes custom names from Rust engine)
  if (section.name) return section.name;

  // Auto-generate from sport type and distance
  const isMetric = resolveIsMetric();
  const distanceStr = formatDistance(section.distanceMeters, isMetric);

  return `${section.sportType} Section (${distanceStr})`;
}
