/**
 * What an activity card shares with the map it sits over, kept as the card's state in the host's
 * entry (`mapSheetHost`): the tab on show, the point a chart scrub is on, the section a row holds
 * highlighted, and the section a marker tap asked the Sections tab to show. The card holds the
 * first three as its own and writes them for the map, which reads each field on its own, so a
 * scrub renders the map and not the card. A marker tap on the map writes the section to show,
 * which the card reads from its own place in the stack and opens the Sections tab on.
 */
import {
  patchHostCard,
  useHostCardField,
  useHostTopCardField,
  useMapSheetHosts,
} from '@/shared/app/mapSheetHost';

const ACTIVE_TAB = 'activeTab';
const HIGHLIGHT_INDEX = 'highlightIndex';
const HIGHLIGHTED_SECTION = 'highlightedSectionId';
const FOCUS_SECTION = 'focusSectionId';

/** The tabs an activity card can show. */
export type ActivityTab = 'charts' | 'exercises' | 'lengths' | 'routes' | 'sections';

export const ACTIVITY_TABS: readonly ActivityTab[] = [
  'charts',
  'exercises',
  'lengths',
  'routes',
  'sections',
];

/** The tab a card opens on: the one its link names, else Charts. */
export function initialActivityTab(tab: string | undefined): ActivityTab {
  return ACTIVITY_TABS.includes(tab as ActivityTab) ? (tab as ActivityTab) : 'charts';
}

/**
 * The tab the card at `index` in its host's stack mounts on: the one it last wrote, since a stop
 * move presents the sheet again and mounts the card afresh, else the one its link names.
 */
export function mountedActivityTab(
  hostKey: string,
  index: number,
  tab: string | undefined
): ActivityTab {
  const kept = useMapSheetHosts.getState().hosts[hostKey]?.cards[index]?.state[ACTIVE_TAB];
  return initialActivityTab(typeof kept === 'string' ? kept : tab);
}

export interface ActivityCardWriter {
  setActiveTab: (tab: ActivityTab) => void;
  /** The chart's scrub point, bound so it can be handed to a chart as a stable callback. */
  setHighlightIndex: (index: number | null) => void;
  setHighlightedSectionId: (sectionId: string | null) => void;
  /** A marker tap on the map: the Sections tab, opened on that section's row. */
  showSection: (sectionId: string) => void;
  /** The Sections tab has scrolled to the section a marker asked for. */
  sectionShown: () => void;
}

/**
 * The writes to the state of the activity card at `index` in its host's stack, the root at 0. A
 * card kept mounted under another writes to itself rather than to the card on show.
 */
export function activityCardWriter(hostKey: string, index: number): ActivityCardWriter {
  const patch = (fields: Readonly<Record<string, unknown>>) =>
    patchHostCard(hostKey, index, fields);
  return {
    setActiveTab: (tab) => patch({ [ACTIVE_TAB]: tab }),
    setHighlightIndex: (highlightIndex) => patch({ [HIGHLIGHT_INDEX]: highlightIndex }),
    setHighlightedSectionId: (sectionId) => patch({ [HIGHLIGHTED_SECTION]: sectionId }),
    showSection: (sectionId) => patch({ [FOCUS_SECTION]: sectionId }),
    sectionShown: () => patch({ [FOCUS_SECTION]: null }),
  };
}

/** The tab the card on show is on, or `fallback` before the card has written one. */
export function useCardActiveTab(hostKey: string, fallback: ActivityTab): ActivityTab {
  return useHostTopCardField<ActivityTab>(hostKey, ACTIVE_TAB) ?? fallback;
}

/** The point the card's chart scrub is on. */
export function useCardHighlightIndex(hostKey: string): number | null {
  return useHostTopCardField<number | null>(hostKey, HIGHLIGHT_INDEX) ?? null;
}

/** The section a row on the card holds highlighted. */
export function useCardHighlightedSection(hostKey: string): string | null {
  return useHostTopCardField<string | null>(hostKey, HIGHLIGHTED_SECTION) ?? null;
}

/**
 * The section a marker tap asked the Sections tab of the card at `index` to show, until the tab
 * has shown it.
 */
export function useCardFocusSection(hostKey: string, index: number): string | null {
  return useHostCardField<string | null>(hostKey, index, FOCUS_SECTION) ?? null;
}
