/**
 * Runs a confirmed section selection through the create and settles the
 * creation state: success feedback and leaving creation mode only once the
 * create resolved, the error state when it rejects.
 */

import type {
  CreationState,
  SectionCreationError,
} from '@/features/maps/components/SectionCreationOverlay';
import type { SectionCreationResult } from '@/features/maps/components/ActivityMapView';
import {
  sectionCreationMessageKey,
  type SectionCreationMessageKey,
} from '@/features/maps/lib/sectionCreationMessage';
import * as haptics from '@/shared/ui/haptics';

interface SubmitSectionCreationParams {
  result: SectionCreationResult;
  activity: { id: string; type: string } | null | undefined;
  createSection: (params: {
    startIndex: number;
    endIndex: number;
    sourceActivityId: string;
    sportType: string;
  }) => Promise<unknown>;
  translate: (key: SectionCreationMessageKey) => string;
  setMode: (creating: boolean) => void;
  setState: (state: CreationState | undefined) => void;
  setError: (error: SectionCreationError | null) => void;
}

export async function submitSectionCreation({
  result,
  activity,
  createSection,
  translate,
  setMode,
  setState,
  setError,
}: SubmitSectionCreationParams): Promise<void> {
  if (!activity) return;

  setState('creating');
  setError(null);

  try {
    await createSection({
      startIndex: result.startIndex,
      endIndex: result.endIndex,
      sourceActivityId: activity.id,
      sportType: activity.type,
    });
  } catch (error) {
    setState('error');
    setError({
      message: translate(sectionCreationMessageKey(error)),
      technicalDetails: error instanceof Error ? error.message : undefined,
      activityId: activity.id,
      indices: { start: result.startIndex, end: result.endIndex },
    });
    return;
  }

  haptics.success();
  setMode(false);
  setState(undefined);
}
