import { create } from 'zustand';
import { getSetting, setSetting } from '@/shared/storage';
import { formatLocalDate } from '@/shared/format/format';
import type { LaunchAsk, LaunchModal } from '../lib/launchSurfaces';
import type { FoundBackup } from '../lib/restorePrompt';
import {
  afterLeftoverAnswered,
  afterOfferDeclined,
  afterSetupAnswered,
  afterTourClosed,
  NO_TOUR_OFFER,
  offerEnded,
  parseTourOffer,
  type SetupAnswer,
  type SetupSlide,
  type TourOfferRecord,
} from '../lib/tourOffer';
import { countUseDay, persistUsage, readUsage, sameUsage, type Usage } from '../lib/usageDays';

const WHATS_NEW_KEY = 'veloq-whats-new-seen';
/** The tour offer's record. This install's bookkeeping, like the days of use, so no backup carries it. */
const TOUR_OFFER_KEY = 'veloq-tour-offer';
/**
 * The states of the sections-changed card the athlete has answered, as a JSON
 * list. A device choice, so no backup carries it. A build that kept one flag
 * wrote `true`, read as the answer to the download-time card.
 */
const SECTIONS_CHANGED_KEY = 'veloq-sections-changed-dismissed';

/** Which of its two messages the sections-changed card is showing. */
export type SectionsChangedState = 'owed' | 'final';

const SECTIONS_CHANGED_STATES: readonly SectionsChangedState[] = ['owed', 'final'];

function parseSectionsChanged(stored: string | null | undefined): SectionsChangedState[] {
  if (stored === 'true') return ['owed'];
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed)
      ? SECTIONS_CHANGED_STATES.filter((state) => parsed.includes(state))
      : [];
  } catch {
    return [];
  }
}

interface TourState {
  mode: 'whatsNew' | 'tutorial';
  /** The setup slides a tutorial is limited to, or null for the whole tour. */
  only: SetupSlide[] | null;
  /** The setup slides the tour leaves out, as one taken in the quiet period does. */
  held: SetupSlide[];
  /** The slide whose Show Me was used, or null before any was. */
  shownIndex: number | null;
  resumeIndex: number;
  exploring: boolean;
  tip: string | null;
}

interface WhatsNewState extends Usage {
  lastSeenVersion: string | null;
  isLoaded: boolean;
  tourState: TourState | null;
  /**
   * The modal this launch raised, which holds its one slot. Never persisted, so
   * a relaunch starts empty and a tour that lost the slot opens then.
   */
  launchModal: LaunchModal | null;
  /** The backup found for an empty library while the offer is unanswered, else null. */
  restoreOffer: FoundBackup | null;
  /** The ask this session raised, which holds its one slot. Never persisted. */
  sessionAsk: LaunchAsk | null;
  /** The asks whose surfaces currently have something to ask. */
  eligibleAsks: LaunchAsk[];
  /** Today's use has been counted onto the stored days of use. */
  usageLoaded: boolean;
  tourOffer: TourOfferRecord;
  /** The tour offer was answered or a tour closed in this session. Never persisted. */
  tourOfferSettled: boolean;
  /** The states of the sections-changed card the athlete has dismissed. */
  sectionsChangedDismissed: SectionsChangedState[];

  initialise: () => Promise<void>;
  countUse: () => Promise<void>;
  noteSyncSettledClean: () => void;
  _debugUsage: (partial: Partial<Usage>) => void;
  markSeen: (version: string) => Promise<void>;

  startTour: (mode: 'whatsNew' | 'tutorial', only?: SetupSlide[], held?: SetupSlide[]) => void;
  showMe: (shownIndex: number, nextIndex: number, tip?: string) => void;
  resumeTour: () => void;
  endTour: () => void;
  /** Close the tour. `setUp` is what Settings already has on, which a tutorial counts as answered. */
  dismissTour: (currentVersion: string, setUp?: readonly SetupSlide[]) => Promise<void>;
  takeLaunchSlot: (modal: LaunchModal) => void;
  setRestoreOffer: (offer: FoundBackup | null) => void;
  takeSessionAsk: (ask: LaunchAsk) => void;
  /** Give the session's ask to `ask`, whoever holds it and whether or not the quiet period does. */
  _debugSessionAsk: (ask: LaunchAsk) => void;
  setAskEligible: (ask: LaunchAsk, eligible: boolean) => void;
  /** Take the tour from the offer card less `held`, or the setup slides it left unanswered. */
  takeTourOffer: (only?: SetupSlide[], held?: SetupSlide[]) => void;
  /** Not now on the offer card. The second ends the offer and marks the tour seen. */
  declineTourOffer: (currentVersion: string) => Promise<void>;
  /** Not now on the sections-changed card in `state`: that state stays hidden after a relaunch too. */
  dismissSectionsChanged: (state: SectionsChangedState) => void;
  answerSetup: (slide: SetupSlide, answer: SetupAnswer) => void;
}

function persistTourOffer(record: TourOfferRecord): void {
  setSetting(TOUR_OFFER_KEY, JSON.stringify(record)).catch((e) => {
    if (__DEV__) console.warn('[tour offer] persist failed:', e);
  });
}

export const useWhatsNewStore = create<WhatsNewState>((set, get) => ({
  lastSeenVersion: null,
  isLoaded: false,
  tourState: null,
  launchModal: null,
  restoreOffer: null,
  sessionAsk: null,
  eligibleAsks: [],
  firstUseDate: null,
  lastUseDate: null,
  useDays: 0,
  launches: 0,
  firstSyncSettled: false,
  usageLoaded: false,
  tourOffer: NO_TOUR_OFFER,
  tourOfferSettled: false,
  sectionsChangedDismissed: [],

  initialise: async () => {
    try {
      const [stored, offer, sectionsChanged] = await Promise.all([
        getSetting(WHATS_NEW_KEY),
        getSetting(TOUR_OFFER_KEY),
        getSetting(SECTIONS_CHANGED_KEY),
      ]);
      set({
        ...(stored ? { lastSeenVersion: stored } : {}),
        tourOffer: parseTourOffer(offer),
        sectionsChangedDismissed: parseSectionsChanged(sectionsChanged),
        isLoaded: true,
      });
    } catch {
      set({ isLoaded: true });
    }
    await get().countUse();
  },

  // Counted once per launch; a second count on the same local day adds nothing.
  countUse: async () => {
    const counted = get().usageLoaded;
    const { stored, prior } = await readUsage();
    const next: Usage = {
      ...countUseDay(prior, formatLocalDate(new Date())),
      // Read again after a restore in the same process, the launch is not a new one.
      launches: prior.launches + (counted ? 0 : 1),
      // A clean settle noted before the record was read is kept, not overwritten.
      firstSyncSettled: prior.firstSyncSettled || get().firstSyncSettled,
    };
    set({ ...next, usageLoaded: true });
    if (!sameUsage(stored, next)) persistUsage(next);
  },

  noteSyncSettledClean: () => {
    const state = get();
    if (state.firstSyncSettled) return;
    set({ firstSyncSettled: true });
    // Before the record is read the count is unknown, and `countUse` keeps the note.
    if (state.usageLoaded) persistUsage({ ...state, firstSyncSettled: true });
  },

  _debugUsage: (partial) => {
    set(partial);
    persistUsage(get());
  },

  markSeen: async (version: string) => {
    await setSetting(WHATS_NEW_KEY, version);
    set({ lastSeenVersion: version });
  },

  startTour: (mode, only, held = []) => {
    set({
      tourState: {
        mode,
        only: only ?? null,
        held,
        shownIndex: null,
        resumeIndex: 0,
        exploring: false,
        tip: null,
      },
    });
  },

  showMe: (shownIndex, nextIndex, tip) => {
    set((state) => {
      if (!state.tourState) return state;
      return {
        tourState: {
          ...state.tourState,
          shownIndex,
          resumeIndex: nextIndex,
          exploring: true,
          tip: tip ?? null,
        },
      };
    });
  },

  resumeTour: () => {
    set((state) => {
      if (!state.tourState) return state;
      return { tourState: { ...state.tourState, exploring: false } };
    });
  },

  endTour: () => {
    set({ tourState: null });
  },

  // A tour left early still counts as seen, or the card offers it again. A
  // tutorial closed owes the card once for any setup slide it left unanswered.
  dismissTour: async (currentVersion, setUp = []) => {
    const { lastSeenVersion, markSeen, tourState, tourOffer } = get();
    if (tourState?.mode === 'tutorial') {
      const next = afterTourClosed(tourOffer, setUp);
      set({ tourState: null, tourOfferSettled: true, tourOffer: next });
      persistTourOffer(next);
    } else {
      set({ tourState: null });
    }
    if (lastSeenVersion !== currentVersion) {
      await markSeen(currentVersion);
    }
  },

  takeLaunchSlot: (modal) => {
    if (get().launchModal === null) set({ launchModal: modal });
  },

  setRestoreOffer: (offer) => set({ restoreOffer: offer }),

  takeSessionAsk: (ask) => {
    if (get().sessionAsk === null) set({ sessionAsk: ask });
  },

  _debugSessionAsk: (ask) => set({ sessionAsk: ask }),

  setAskEligible: (ask, eligible) => {
    const listed = get().eligibleAsks.includes(ask);
    if (eligible === listed) return;
    set((state) => ({
      eligibleAsks: eligible
        ? [...state.eligibleAsks, ask]
        : state.eligibleAsks.filter((a) => a !== ask),
    }));
  },

  takeTourOffer: (only, held) => {
    if (only) {
      const next = afterLeftoverAnswered(get().tourOffer);
      set({ tourOffer: next });
      persistTourOffer(next);
    }
    get().startTour('tutorial', only, held);
  },

  declineTourOffer: async (currentVersion) => {
    const { tourOffer, lastSeenVersion, markSeen } = get();
    const leftover = lastSeenVersion !== null;
    const next = leftover ? afterLeftoverAnswered(tourOffer) : afterOfferDeclined(tourOffer);
    set({ tourOffer: next, tourOfferSettled: true });
    persistTourOffer(next);
    if (!leftover && offerEnded(next)) await markSeen(currentVersion);
  },

  dismissSectionsChanged: (state) => {
    const dismissed = get().sectionsChangedDismissed;
    if (dismissed.includes(state)) return;
    const next = [...dismissed, state];
    set({ sectionsChangedDismissed: next });
    setSetting(SECTIONS_CHANGED_KEY, JSON.stringify(next)).catch((e) => {
      if (__DEV__) console.warn('[sections changed] persist failed:', e);
    });
  },

  answerSetup: (slide, answer) => {
    const next = afterSetupAnswered(get().tourOffer, slide, answer);
    set({ tourOffer: next });
    persistTourOffer(next);
  },
}));

export async function initialiseWhatsNewStore(): Promise<void> {
  await useWhatsNewStore.getState().initialise();
}

/** Note that a sync finished clean, from the engine's own stamp of the last clean finish. */
export function noteLastSyncSuccess(lastSuccessAt: string | null | undefined): void {
  if (lastSuccessAt) useWhatsNewStore.getState().noteSyncSettledClean();
}

/** Set the days of use by hand, for the developer screen. */
export function overrideDaysOfUse(partial: Partial<Usage>): void {
  useWhatsNewStore.getState()._debugUsage(partial);
}

/**
 * Hand the session's one ask to a card by hand, for the developer screen. A
 * card made due there shows at once, rather than waiting for a session after the
 * quiet period in which no other card asked first.
 */
export function overrideSessionAsk(ask: LaunchAsk): void {
  useWhatsNewStore.getState()._debugSessionAsk(ask);
}
