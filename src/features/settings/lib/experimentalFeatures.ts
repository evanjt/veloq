import type { ParseKeys } from 'i18next';
import type { FfiExperimentalExamples } from 'veloqrs';

export type ExperimentalFeatureKey = 'efficiencyTrends' | 'sectionCorrelations' | 'garminUpdate';

export interface ExperimentalFeature {
  key: ExperimentalFeatureKey;
  titleKey: ParseKeys;
  blurbKey: ParseKeys;
  /** Where the link on the experimental page goes, when it is the same for every library. */
  route?: string;
  /** The engine's example for features that show on a section in the athlete's own library. */
  example?: keyof FfiExperimentalExamples;
}

/** Where the link goes: the feature's fixed page, or its example section. Null when there is none. */
export function featureRoute(
  feature: ExperimentalFeature,
  examples: FfiExperimentalExamples | undefined
): string | null {
  if (feature.route) return feature.route;
  const sectionId = feature.example ? examples?.[feature.example] : undefined;
  return sectionId ? `/section/${sectionId}` : null;
}

/** Every experimental feature, in the order the experimental page lists them. */
export const EXPERIMENTAL_FEATURES: readonly ExperimentalFeature[] = [
  {
    key: 'efficiencyTrends',
    titleKey: 'experimental.efficiencyTrends.title',
    blurbKey: 'experimental.efficiencyTrends.blurb',
    example: 'efficiencyTrendSectionId',
  },
  {
    key: 'sectionCorrelations',
    titleKey: 'experimental.sectionCorrelations.title',
    blurbKey: 'experimental.sectionCorrelations.blurb',
    example: 'sectionCorrelationSectionId',
  },
  {
    key: 'garminUpdate',
    titleKey: 'experimental.garminUpdate.title',
    blurbKey: 'experimental.garminUpdate.blurb',
    route: '/garmin-connector',
  },
];
