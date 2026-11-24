import type { FfiMergeCandidate } from 'veloqrs';

/** The candidates sheet is answered with the chosen candidate. */
export interface MergeCandidatesSheetInput {
  candidates: FfiMergeCandidate[];
}

export interface MergeSectionInfo {
  id: string;
  name: string;
  /** Every sport that has taken the section. */
  sportTypes: readonly string[];
  visitCount: number;
  distanceMeters: number;
}

export interface MergeConfirmSheetInput {
  primary: MergeSectionInfo;
  secondary: MergeSectionInfo;
}

/** The confirmation sheet is answered with the section to keep and the one merged into it. */
export interface MergeConfirmSheetResult {
  primaryId: string;
  secondaryId: string;
}
