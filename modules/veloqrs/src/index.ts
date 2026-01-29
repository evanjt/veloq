
// Import generated functions and types
export * from './generated/veloqrs';

// Import section-specific FFI functions from dedicated module
import {
  getSectionsByTypeJson as generatedGetSectionsByTypeJson,
$ i}.*from.*generated/veloqrs.*
.*export * from.*generated/veloqrs.*import {$/a; s/.*/export function getSectionsByTypeJson(sectionType?: string): string { return JSON.stringify({ sectionType: sectionType || null }); }
  getSectionCountByType as generatedGetSectionCountByType,
$ i}.*from.*generated/veloqrs.*
.*export * from.*generated/veloqrs.*import {$
  createSectionUnified as generatedCreateSectionUnified,
} from './generated/ffi_sections';

export function getSectionsByTypeJson(sectionType?: string): string {
  return JSON.stringify({
    sectionType: sectionType || null,
  });
}

export function getSectionCountByType(sectionType?: string): number {
  return JSON.stringify({
    sectionType: sectionType || null,
  });
}
