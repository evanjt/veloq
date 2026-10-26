import type { ParseKeys } from 'i18next';

export type ExperimentalFeatureKey = 'efficiencyTrends' | 'sectionCorrelations' | 'garminUpdate';

export interface ExperimentalFeature {
  key: ExperimentalFeatureKey;
  titleKey: ParseKeys;
  blurbKey: ParseKeys;
  /** Where the link on the experimental page goes. */
  route: string;
}

/** Every experimental feature, in the order the experimental page lists them. */
export const EXPERIMENTAL_FEATURES: readonly ExperimentalFeature[] = [
  {
    key: 'efficiencyTrends',
    titleKey: 'experimental.efficiencyTrends.title',
    blurbKey: 'experimental.efficiencyTrends.blurb',
    route: '/(tabs)/insights',
  },
  {
    key: 'sectionCorrelations',
    titleKey: 'experimental.sectionCorrelations.title',
    blurbKey: 'experimental.sectionCorrelations.blurb',
    route: '/routes',
  },
  {
    key: 'garminUpdate',
    titleKey: 'experimental.garminUpdate.title',
    blurbKey: 'experimental.garminUpdate.blurb',
    route: '/garmin-connector',
  },
];
