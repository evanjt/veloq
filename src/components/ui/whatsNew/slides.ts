import type { ComponentType } from 'react';

export interface WhatsNewSlideDefinition {
  /** i18n key for slide title */
  titleKey: string;
  /** i18n key for slide body text */
  bodyKey: string;
  /** MaterialCommunityIcons icon name */
  icon: string;
  /** Custom component rendered below the text */
  Component: ComponentType;
  /** Route to navigate to when "Show Me" is tapped. Omit for info-only slides. */
  showMeRoute?: string;
  /** Optional pre-navigation action tag. The modal handles execution. */
  showMeAction?: string;
  /** i18n key for a tip shown on the TourReturnPill after navigating. */
  showMeTip?: string;
}

/**
 * Version → slides registry. Modal only shows if the current version has entries.
 * Future releases just add a new key here.
 */
export const WHATS_NEW_SLIDES: Record<string, WhatsNewSlideDefinition[]> = {
  '0.3.0': [
    {
      titleKey: 'whatsNew.v030.notificationsTitle',
      bodyKey: 'whatsNew.v030.notificationsBody',
      icon: 'bell-ring-outline',
      get Component() {
        return require('./NotificationSlide').NotificationSlide;
      },
    },
  ],
  '0.2.2': [
    {
      titleKey: 'whatsNew.v022.mapStylesTitle',
      bodyKey: 'whatsNew.v022.mapStylesBody',
      icon: 'map-legend',
      showMeRoute: '/',
      showMeAction: 'enableSatellite3D',
      // Lazy-loaded to avoid circular deps with MapLibre
      get Component() {
        return require('./MapPreferencesSlide').MapPreferencesSlide;
      },
    },
    {
      titleKey: 'whatsNew.v022.heatmapTitle',
      bodyKey: 'whatsNew.v022.heatmapBody',
      icon: 'grid',
      showMeRoute: '/training',
      showMeTip: 'whatsNew.v022.heatmapTip',
      get Component() {
        return require('./HeatmapSlide').HeatmapSlide;
      },
    },
    {
      titleKey: 'whatsNew.v022.fitnessTitle',
      bodyKey: 'whatsNew.v022.fitnessBody',
      icon: 'heart-pulse',
      showMeRoute: '/fitness',
      get Component() {
        return require('./FitnessHeroSlide').FitnessHeroSlide;
      },
    },
  ],
};

/** Compare two semver strings (e.g. '0.2.1' < '0.2.2'). */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

/** Collect all slides across versions in semver order (for tutorial mode). */
export function getAllSlides(): WhatsNewSlideDefinition[] {
  return Object.keys(WHATS_NEW_SLIDES)
    .sort(compareVersions)
    .flatMap((v) => WHATS_NEW_SLIDES[v]);
}
