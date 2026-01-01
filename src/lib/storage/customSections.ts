/**
 * Storage for user-created custom sections using FileSystem.
 *
 * Storage location: documentDirectory/custom_sections/
 * - sections.json - array of CustomSection definitions
 * - matches_{sectionId}.json - cached activity matches per section
 */

import * as FileSystem from 'expo-file-system/legacy';
import { debug } from '../utils/debug';
import type {
  CustomSection,
  CustomSectionMatch,
  CustomSectionWithMatches,
} from '@/types';

const log = debug.create('CustomSections');

const CUSTOM_SECTIONS_DIR = `${FileSystem.documentDirectory}custom_sections/`;
const SECTIONS_FILE = `${CUSTOM_SECTIONS_DIR}sections.json`;

/** Get the storage path for a section's matches */
function getMatchesPath(sectionId: string): string {
  const safeId = sectionId.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${CUSTOM_SECTIONS_DIR}matches_${safeId}.json`;
}

/** Ensure the custom sections directory exists */
async function ensureDir(): Promise<void> {
  const dirInfo = await FileSystem.getInfoAsync(CUSTOM_SECTIONS_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(CUSTOM_SECTIONS_DIR, {
      intermediates: true,
    });
    log.log('Created custom sections directory');
  }
}

// =============================================================================
// Section CRUD Operations
// =============================================================================

/**
 * Load all custom sections (without matches)
 */
export async function loadCustomSections(): Promise<CustomSection[]> {
  try {
    const info = await FileSystem.getInfoAsync(SECTIONS_FILE);
    if (!info.exists) return [];

    const data = await FileSystem.readAsStringAsync(SECTIONS_FILE);
    return JSON.parse(data) as CustomSection[];
  } catch (error) {
    log.log('Error loading custom sections:', error);
    return [];
  }
}

/**
 * Save all custom sections
 */
async function saveCustomSections(sections: CustomSection[]): Promise<void> {
  await ensureDir();
  await FileSystem.writeAsStringAsync(SECTIONS_FILE, JSON.stringify(sections));
  log.log(`Saved ${sections.length} custom sections`);
}

/**
 * Add a new custom section
 */
export async function addCustomSection(section: CustomSection): Promise<void> {
  const sections = await loadCustomSections();
  sections.push(section);
  await saveCustomSections(sections);
}

/**
 * Update an existing custom section
 */
export async function updateCustomSection(
  sectionId: string,
  updates: Partial<CustomSection>
): Promise<void> {
  const sections = await loadCustomSections();
  const index = sections.findIndex((s) => s.id === sectionId);
  if (index === -1) {
    throw new Error(`Section ${sectionId} not found`);
  }
  sections[index] = { ...sections[index], ...updates };
  await saveCustomSections(sections);
}

/**
 * Delete a custom section and its matches
 */
export async function deleteCustomSection(sectionId: string): Promise<void> {
  const sections = await loadCustomSections();
  const filtered = sections.filter((s) => s.id !== sectionId);
  await saveCustomSections(filtered);

  // Also delete the matches file
  const matchesPath = getMatchesPath(sectionId);
  try {
    const info = await FileSystem.getInfoAsync(matchesPath);
    if (info.exists) {
      await FileSystem.deleteAsync(matchesPath, { idempotent: true });
    }
  } catch {
    // Best effort cleanup
  }
  log.log(`Deleted custom section ${sectionId}`);
}

/**
 * Get a single custom section by ID
 */
export async function getCustomSection(
  sectionId: string
): Promise<CustomSection | null> {
  const sections = await loadCustomSections();
  return sections.find((s) => s.id === sectionId) || null;
}

// =============================================================================
// Matches Storage
// =============================================================================

/**
 * Load matches for a custom section
 */
export async function loadSectionMatches(
  sectionId: string
): Promise<CustomSectionMatch[]> {
  try {
    const path = getMatchesPath(sectionId);
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return [];

    const data = await FileSystem.readAsStringAsync(path);
    return JSON.parse(data) as CustomSectionMatch[];
  } catch (error) {
    log.log(`Error loading matches for section ${sectionId}:`, error);
    return [];
  }
}

/**
 * Save matches for a custom section
 */
export async function saveSectionMatches(
  sectionId: string,
  matches: CustomSectionMatch[]
): Promise<void> {
  await ensureDir();
  const path = getMatchesPath(sectionId);
  await FileSystem.writeAsStringAsync(path, JSON.stringify(matches));
  log.log(`Saved ${matches.length} matches for section ${sectionId}`);
}

/**
 * Add a match to a custom section (used when new activity synced)
 */
export async function addSectionMatch(
  sectionId: string,
  match: CustomSectionMatch
): Promise<void> {
  const matches = await loadSectionMatches(sectionId);
  // Avoid duplicates
  if (!matches.some((m) => m.activityId === match.activityId)) {
    matches.push(match);
    await saveSectionMatches(sectionId, matches);
  }
}

/**
 * Remove a match from a custom section (used when activity deleted)
 */
export async function removeSectionMatch(
  sectionId: string,
  activityId: string
): Promise<void> {
  const matches = await loadSectionMatches(sectionId);
  const filtered = matches.filter((m) => m.activityId !== activityId);
  if (filtered.length !== matches.length) {
    await saveSectionMatches(sectionId, filtered);
  }
}

// =============================================================================
// Combined Loading
// =============================================================================

/**
 * Load all custom sections with their matches
 */
export async function loadCustomSectionsWithMatches(): Promise<
  CustomSectionWithMatches[]
> {
  const sections = await loadCustomSections();
  const withMatches: CustomSectionWithMatches[] = [];

  for (const section of sections) {
    const matches = await loadSectionMatches(section.id);
    withMatches.push({ ...section, matches });
  }

  return withMatches;
}

/**
 * Load a single custom section with its matches
 */
export async function getCustomSectionWithMatches(
  sectionId: string
): Promise<CustomSectionWithMatches | null> {
  const section = await getCustomSection(sectionId);
  if (!section) return null;

  const matches = await loadSectionMatches(sectionId);
  return { ...section, matches };
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Generate a unique section name
 */
export async function generateSectionName(): Promise<string> {
  const sections = await loadCustomSections();
  let index = sections.length + 1;

  // Find a unique name
  const existingNames = new Set(sections.map((s) => s.name));
  while (existingNames.has(`Custom Section ${index}`)) {
    index++;
  }

  return `Custom Section ${index}`;
}

/**
 * Get count of custom sections
 */
export async function getCustomSectionCount(): Promise<number> {
  const sections = await loadCustomSections();
  return sections.length;
}

/**
 * Clear all custom sections and matches
 */
export async function clearAllCustomSections(): Promise<void> {
  try {
    const dirInfo = await FileSystem.getInfoAsync(CUSTOM_SECTIONS_DIR);
    if (dirInfo.exists) {
      await FileSystem.deleteAsync(CUSTOM_SECTIONS_DIR, { idempotent: true });
      log.log('Cleared all custom sections');
    }
  } catch {
    // Best effort cleanup
  }
}
