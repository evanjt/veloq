import type { ComponentType } from 'react';
import { fitnessTarget } from '@/shared/app/fitnessEntry';
import { SETUP_SLIDES, type SetupSlide } from '../../lib/tourOffer';

interface SlideContent {
  /** i18n key for slide title */
  titleKey: string;
  /** i18n key for slide body text */
  bodyKey: string;
  /** MaterialCommunityIcons icon name */
  icon: string;
  /** The picture drawn below the text. Every slide has one, so none shows an empty field. */
  Component: ComponentType;
  /** What the slide asks the athlete to set up, which a tour closed without an answer returns to. */
  setup?: SetupSlide;
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
   * Swap the route for the athlete's busiest section or route (`resolveShowMeRoute`). With none,
   * the slide offers no Show Me. `showMeRoute` names the list the page belongs to.
   */
  showMeAction?: 'openBusiestSection' | 'openBusiestRoute';
  /**
   * Offer Show Me only once this holds, so it never lands on a screen with nothing in it. Omit to
   * offer it always.
   */
  showMeWhen?: 'cutoverChanged' | 'hasActivities';
}

interface InfoOnly {
  showMeRoute?: never;
  showMeTip?: never;
  showMeWhen?: never;
  showMeAction?: never;
}

export type WhatsNewSlideDefinition = SlideContent & (ShowMe | InfoOnly);

const MAP_STYLES: WhatsNewSlideDefinition = {
  titleKey: 'whatsNew.v022.mapStylesTitle',
  bodyKey: 'whatsNew.v022.mapStylesBody',
  icon: 'map-legend',
  showMeRoute: '/',
  showMeTip: 'whatsNew.v022.mapStylesTip',
  showMeWhen: 'hasActivities',
  // Load the map preview only when this slide is shown.
  get Component() {
    return require('./MapPreferencesSlide').MapPreferencesSlide;
  },
};

const FITNESS: WhatsNewSlideDefinition = {
  titleKey: 'whatsNew.v022.fitnessTitle',
  bodyKey: 'whatsNew.v022.fitnessBody',
  icon: 'heart-pulse',
  showMeRoute: '/fitness',
  showMeTip: 'whatsNew.v022.fitnessTip',
  showMeWhen: 'hasActivities',
  get Component() {
    return require('./FitnessHeroSlide').FitnessHeroSlide;
  },
};

const BACKUP: WhatsNewSlideDefinition = {
  titleKey: 'whatsNew.v030.backupTitle',
  bodyKey: 'whatsNew.v030.backupBody',
  icon: 'cloud-upload-outline',
  showMeRoute: '/backup-settings',
  showMeTip: 'whatsNew.v030.backupTip',
  setup: 'backup',
  get Component() {
    return require('./BackupSlide').BackupSlide;
  },
};

const SECTION_PAGE: WhatsNewSlideDefinition = {
  titleKey: 'whatsNew.v040.sectionPageTitle',
  bodyKey: 'whatsNew.v040.sectionPageBody',
  icon: 'chart-timeline-variant',
  showMeRoute: '/insights?tab=sections',
  showMeTip: 'whatsNew.v040.sectionPageTip',
  showMeAction: 'openBusiestSection',
  get Component() {
    return require('./SectionPerformanceSlide').SectionPerformanceSlide;
  },
};

const ROUTES: WhatsNewSlideDefinition = {
  titleKey: 'whatsNew.v040.routesTitle',
  bodyKey: 'whatsNew.v040.routesBody',
  icon: 'map-marker-path',
  showMeRoute: '/insights?tab=routes',
  showMeTip: 'whatsNew.v040.routesTip',
  showMeAction: 'openBusiestRoute',
  get Component() {
    return require('./RoutesSlide').RoutesSlide;
  },
};

const NOTIFICATIONS: WhatsNewSlideDefinition = {
  titleKey: 'whatsNew.tutorial.notificationsTitle',
  bodyKey: 'whatsNew.tutorial.notificationsBody',
  icon: 'bell-ring-outline',
  setup: 'notifications',
  get Component() {
    return require('./NotificationsSlide').NotificationsSlide;
  },
};

const GARMIN: WhatsNewSlideDefinition = {
  titleKey: 'whatsNew.tutorial.garminTitle',
  bodyKey: 'whatsNew.tutorial.garminBody',
  icon: 'watch-variant',
  setup: 'garmin',
  get Component() {
    return require('./GarminSlide').GarminSlide;
  },
};

const RECORDING: WhatsNewSlideDefinition = {
  titleKey: 'whatsNew.v040.recordingTitle',
  bodyKey: 'whatsNew.v040.recordingBody',
  icon: 'record-circle-outline',
  showMeRoute: '/record',
  showMeTip: 'whatsNew.v040.recordingTip',
  get Component() {
    return require('./RecordingSlide').RecordingSlide;
  },
};

const LOOK: WhatsNewSlideDefinition = {
  titleKey: 'whatsNew.v040.lookTitle',
  bodyKey: 'whatsNew.v040.lookBody',
  icon: 'palette-outline',
  get Component() {
    return require('./LookSlide').LookSlide;
  },
};

const MAPS_WIDGETS: WhatsNewSlideDefinition = {
  titleKey: 'whatsNew.v040.mapsWidgetsTitle',
  bodyKey: 'whatsNew.v040.mapsWidgetsBody',
  icon: 'terrain',
  showMeRoute: '/map-settings',
  showMeTip: 'whatsNew.v040.mapsWidgetsTip',
  get Component() {
    return require('./MapsWidgetsSlide').MapsWidgetsSlide;
  },
};

const SECTIONS_REBUILT: WhatsNewSlideDefinition = {
  titleKey: 'whatsNew.v040.rebuiltTitle',
  bodyKey: 'whatsNew.v040.rebuiltBody',
  icon: 'history',
  get Component() {
    return require('./SectionsRebuiltSlide').SectionsRebuiltSlide;
  },
};

/**
 * Version → slides registry. Modal only shows if the current version has entries.
 * Future releases just add a new key here.
 */
export const WHATS_NEW_SLIDES: Record<string, WhatsNewSlideDefinition[]> = {
  '0.2.2': [
    MAP_STYLES,
    {
      titleKey: 'whatsNew.v022.heatmapTitle',
      bodyKey: 'whatsNew.v022.heatmapBody',
      icon: 'grid',
      showMeRoute: fitnessTarget({ chart: 'calendar' }),
      showMeTip: 'whatsNew.v022.heatmapTip',
      showMeWhen: 'hasActivities',
      get Component() {
        return require('./HeatmapSlide').HeatmapSlide;
      },
    },
    FITNESS,
  ],
  '0.3.0': [
    {
      titleKey: 'whatsNew.v030.insightsTitle',
      bodyKey: 'whatsNew.v030.insightsBody',
      icon: 'lightbulb-outline',
      showMeRoute: '/insights',
      showMeTip: 'whatsNew.v030.insightsTip',
      showMeWhen: 'hasActivities',
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
      showMeWhen: 'hasActivities',
      get Component() {
        return require('./StrengthSlide').StrengthSlide;
      },
    },
    BACKUP,
  ],
  '0.4.0': [NOTIFICATIONS, RECORDING, LOOK, MAPS_WIDGETS, SECTIONS_REBUILT],
};

/**
 * The first-run tour: the two pages the athlete acts on first, the map style and the
 * notifications, then sections and routes, and backup last. The first load is not a page: the
 * tour's chrome carries it as a line while the sync runs. A release slide that only explains a
 * change, such as the new look, stays in What's New.
 */
const TUTORIAL_SLIDES: WhatsNewSlideDefinition[] = [
  MAP_STYLES,
  NOTIFICATIONS,
  GARMIN,
  RECORDING,
  MAPS_WIDGETS,
  SECTIONS_REBUILT,
  SECTION_PAGE,
  ROUTES,
  BACKUP,
];

/** The slides the first-run tour and the settings App Tour show. */
export function getTutorialSlides(): WhatsNewSlideDefinition[] {
  return TUTORIAL_SLIDES;
}

/** The setup slides the first-run tour carries, in the order it shows them. */
export function getTutorialSetupSlides(): SetupSlide[] {
  return SETUP_SLIDES.filter((setup) => TUTORIAL_SLIDES.some((slide) => slide.setup === setup));
}

/** The first-run tour limited to the given setup slides, or the whole of it, less the held ones. */
export function getTutorialSlidesFor(
  only: readonly SetupSlide[] | null,
  held: readonly SetupSlide[] = []
): WhatsNewSlideDefinition[] {
  return TUTORIAL_SLIDES.filter((slide) => {
    if (slide.setup !== undefined && held.includes(slide.setup)) return false;
    return only === null || (slide.setup !== undefined && only.includes(slide.setup));
  });
}

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
