/**
 * The sections in this library where each experimental feature has something
 * to show, named by the engine when the experimental page opens.
 */

import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@/shared/query/queryKeys';
import { settings, type FfiExperimentalExamples } from 'veloqrs';

export function useExperimentalExamples() {
  return useQuery({
    queryKey: queryKeys.experimentalExamples,
    queryFn: (): FfiExperimentalExamples | null => settings.getExperimentalExamples() ?? null,
    // A sync can add the section that carries an example, so each visit reads again.
    staleTime: 0,
    gcTime: 0,
  });
}
