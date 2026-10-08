import type { ComponentType } from 'react';

interface SlideContent {
  /** i18n key for slide title */
  titleKey: string;
  /** i18n key for slide body text */
  bodyKey: string;
  /** MaterialCommunityIcons icon name */
  icon: string;
  /** Custom component rendered below the text */
  Component: ComponentType;
}

/**
 * A slide that offers Show Me names where it goes and the tip the return pill
 * shows there, so the athlete never lands on a screen with nothing to try.
 */
interface ShowMe {
  /** Route to navigate to when "Show Me" is tapped. */
  showMeRoute: string;
  /** i18n key for the tip shown on the TourReturnPill after navigating. */
  showMeTip: string;
  /**
   * Swap the route for the athlete's busiest section or route (`resolveShowMeRoute`), keeping
   * `showMeRoute` as the list to land on when there is none.
   */
  showMeAction?: 'openBusiestSection' | 'openBusiestRoute';
  /** Offer Show Me only once this holds. Omit to offer it always. */
  showMeWhen?: 'cutoverChanged';
}

interface InfoOnly {
  showMeRoute?: never;
  showMeTip?: never;
  showMeWhen?: never;
  showMeAction?: never;
}

export type WhatsNewSlideDefinition = SlideContent & (ShowMe | InfoOnly);

/**
 * Version → slides registry. Modal only shows if the current version has entries.
 * Future releases just add a new key here.
 */
export const WHATS_NEW_SLIDES: Record<string, WhatsNewSlideDefinition[]> = {
  '0.2.2': [
    {
      titleKey: 'whatsNew.v022.mapStylesTitle',
      bodyKey: 'whatsNew.v022.mapStylesBody',
      icon: 'map-legend',
      showMeRoute: '/',
      showMeTip: 'whatsNew.v022.mapStylesTip',
      // Load the map preview only when this slide is shown.
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
      showMeTip: 'whatsNew.v022.fitnessTip',
      get Component() {
        return require('./FitnessHeroSlide').FitnessHeroSlide;
      },
    },
  ],
  '0.3.0': [
    {
      titleKey: 'whatsNew.v030.insightsTitle',
      bodyKey: 'whatsNew.v030.insightsBody',
      icon: 'lightbulb-outline',
      showMeRoute: '/insights',
      showMeTip: 'whatsNew.v030.insightsTip',
      get Component() {
        return require('./InsightsSlide').InsightsSlide;
      },
    },
    {
      titleKey: 'whatsNew.v030.strengthTitle',
      bodyKey: 'whatsNew.v030.strengthBody',
      icon: 'arm-flex-outline',
      // The strength sub-tab, where the body diagram this slide describes is
      // drawn. Fitness carries no strength surface at all.
      showMeRoute: '/insights?tab=strength',
      showMeTip: 'whatsNew.v030.strengthTip',
      get Component() {
        return require('./StrengthSlide').StrengthSlide;
      },
    },
    {
      titleKey: 'whatsNew.v030.backupTitle',
      bodyKey: 'whatsNew.v030.backupBody',
      icon: 'cloud-upload-outline',
      showMeRoute: '/backup-settings',
      showMeTip: 'whatsNew.v030.backupTip',
      get Component() {
        return require('./BackupSlide').BackupSlide;
      },
    },
  ],
  '0.4.0': [
    {
      titleKey: 'whatsNew.v040.sectionPageTitle',
      bodyKey: 'whatsNew.v040.sectionPageBody',
      icon: 'chart-timeline-variant',
      showMeRoute: '/insights?tab=sections',
      showMeTip: 'whatsNew.v040.sectionPageTip',
      showMeAction: 'openBusiestSection',
      get Component() {
        return require('./SectionPerformanceSlide').SectionPerformanceSlide;
      },
    },
    {
      titleKey: 'whatsNew.v040.routesTitle',
      bodyKey: 'whatsNew.v040.routesBody',
      icon: 'map-marker-path',
      showMeRoute: '/insights?tab=routes',
      showMeTip: 'whatsNew.v040.routesTip',
      showMeAction: 'openBusiestRoute',
      get Component() {
        return require('./RoutesSlide').RoutesSlide;
      },
    },
    {
      titleKey: 'whatsNew.v040.sectionsTitle',
      bodyKey: 'whatsNew.v040.sectionsBody',
      icon: 'history',
      // The section preview, where the map shows the sections a setting change would cut.
      showMeRoute: '/detection-preview',
      showMeTip: 'whatsNew.v040.sectionsTip',
      get Component() {
        return require('./SectionChangeCardSlide').SectionChangeCardSlide;
      },
    },
  ],
};

/** Compare two semver strings (e.g. '0.2.1' < '0.2.2'). */
export function compareVersions(a: string, b: string): number {
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

/** Collect slides from all versions newer than the given version. */
export function getSlidesSince(version: string): WhatsNewSlideDefinition[] {
  return Object.keys(WHATS_NEW_SLIDES)
    .filter((v) => compareVersions(v, version) > 0)
    .sort(compareVersions)
    .flatMap((v) => WHATS_NEW_SLIDES[v]);
}
