/**
 * Banner for a launch where an initialiser rejected.
 *
 * It names the part of the app that did not load, from a translated line per
 * area, and never the initialiser's own message, which is English and in the
 * engine's vocabulary. The work has finished, so nothing spins. The English
 * defaults cover the launch where the language initialiser is the one that
 * failed and the translator has no bundle to read.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';

import { NoticeBanner } from './NoticeBanner';

export type StartupArea =
  | 'language'
  | 'preferences'
  | 'heartRateZones'
  | 'routes'
  | 'maps'
  | 'notifications'
  | 'recording'
  | 'insights'
  | 'other';

const AREA_DEFAULT: Record<StartupArea, string> = {
  language: 'language',
  preferences: 'preferences',
  heartRateZones: 'heart rate zones',
  routes: 'route settings',
  maps: 'map settings',
  notifications: 'notifications',
  recording: 'recording settings',
  insights: 'insights',
  other: 'other settings',
};

const AREA_KEY = {
  language: 'emptyState.startupError.area.language',
  preferences: 'emptyState.startupError.area.preferences',
  heartRateZones: 'emptyState.startupError.area.heartRateZones',
  routes: 'emptyState.startupError.area.routes',
  maps: 'emptyState.startupError.area.maps',
  notifications: 'emptyState.startupError.area.notifications',
  recording: 'emptyState.startupError.area.recording',
  insights: 'emptyState.startupError.area.insights',
  other: 'emptyState.startupError.area.other',
} as const satisfies Record<StartupArea, string>;

interface StartupErrorBannerProps {
  areas: readonly StartupArea[];
  onDismiss: () => void;
}

export function StartupErrorBanner({ areas, onDismiss }: StartupErrorBannerProps) {
  const { t } = useTranslation();
  const named = areas
    .map((area) => t(AREA_KEY[area], { defaultValue: AREA_DEFAULT[area] }))
    .join(', ');

  return (
    <NoticeBanner
      slot="startupError"
      tone="error"
      icon="alert-circle-outline"
      title={t('emptyState.startupError.title', {
        defaultValue: 'Some parts of the app did not load',
      })}
      detail={[
        t('emptyState.startupError.detail', {
          areas: named,
          defaultValue: 'Could not load: {{areas}}. Restart the app to try again.',
        }),
      ]}
      onDismiss={onDismiss}
      testID="startup-error-banner"
    />
  );
}
