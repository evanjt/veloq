import React from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityProvenance } from 'veloqrs';
import { navigateTo } from '@/shared/app/navigation';
import { TextLink } from '@/shared/ui/TextLink';
import { spacing } from '@/theme';

interface Props {
  /** Where the ride's data was filled from; null until the detail read answers. */
  provenance: ActivityProvenance | null | undefined;
}

/**
 * The line at the foot of a ride's details that says a Garmin file filled it.
 * Tapping it opens the Garmin connector. A ride that is intervals.icu's own
 * copy shows nothing.
 */
export function ActivityProvenanceLine({ provenance }: Props) {
  const { t } = useTranslation();
  if (provenance !== ActivityProvenance.GarminOnPhone) return null;

  return (
    <TextLink
      testID="activity-provenance"
      label={t('activity.provenance.garminOnPhone')}
      icon="watch"
      size="caption"
      onPress={() => navigateTo('/garmin-connector')}
      style={{ alignSelf: 'center', marginTop: spacing.sm }}
    />
  );
}
