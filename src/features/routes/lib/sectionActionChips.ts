import type { FrequentSection } from '@/types';

export interface SectionActionChips {
  accept: 'offer' | 'accepted' | 'none';
  pinned: boolean;
}

/** A pinned section is already kept, so it shows one state and never Accept beside it. */
export function sectionActionChips(input: {
  sectionType: FrequentSection['sectionType'];
  isUserDefined: boolean;
  pinnedVersion: number | null;
}): SectionActionChips {
  const pinned = input.pinnedVersion != null;
  if (pinned || input.sectionType !== 'auto') return { accept: 'none', pinned };
  return { accept: input.isUserDefined ? 'accepted' : 'offer', pinned };
}
