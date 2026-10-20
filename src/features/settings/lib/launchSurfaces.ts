/**
 * What a launch and a session may raise, decided in one place.
 *
 * A launch interrupts the athlete with one modal at most. A first load opens
 * straight onto the feed: the tour is an ask there from the first session
 * (`tourOffer`). A library the engine had to rebuild is about the athlete's own
 * data, so it is a modal the athlete reads.
 *
 * What's New after an update is never a modal: it is a feed card the athlete
 * opens or dismisses, so an update does not interrupt the first thing they do
 * with it. Nothing is decided there, so it takes no ask's slot, but it keeps out
 * of the quiet period, away from a restore offer and from under a modal or tour.
 *
 * Every other ask is a card on the feed. Nothing asks during the quiet period,
 * which holds until a sync has finished clean on this install and the athlete
 * has used the app on a second local day, so a relaunch or a kill during the
 * first download does not end it. While it holds only the restore offer asks,
 * because that answer decides what the library is, and then the tour offer,
 * whose tour leaves the notification ask for after it. After it, a session (one
 * process lifetime) raises one ask at most, the first eligible in `ASK_ORDER`:
 * the athlete's data first, then what the app does on its own, then what is
 * only helpful. Each surface decides its own eligibility; this only chooses
 * among the eligible. The ask that took the slot keeps it, and once it is
 * answered nothing else asks until the next session. No ask shows while a modal
 * or the tour is up.
 */

export type LaunchModal = 'libraryRebuilt';

export type LaunchAsk = 'restore' | 'seriesConsent' | 'tourOffer' | 'support';

/** The order a session after the quiet period picks its one ask in. */
export const ASK_ORDER: readonly LaunchAsk[] = ['restore', 'seriesConsent', 'tourOffer', 'support'];

/** The asks the quiet period lets through, in `ASK_ORDER`. */
export const QUIET_PERIOD_ASKS: readonly LaunchAsk[] = ['restore', 'tourOffer'];

/** Distinct local days of use the quiet period lasts into. */
export const QUIET_PERIOD_USE_DAYS = 2;

export interface LaunchFacts {
  /** The modal this launch already raised, which keeps the slot. */
  taken: LaunchModal | null;
  /** The seen version has been read, so a first load can be told apart. */
  settingsLoaded: boolean;
  /** A tour may be offered: someone is signed in and it is not demo. */
  tourEligible: boolean;
  lastSeenVersion: string | null;
  currentVersion: string;
  /** Slides added since the seen version. */
  missedSlideCount: number;
  /** The engine set the library aside and rebuilt it on this launch. */
  libraryRebuilt: boolean;
  /** A backup was found for an empty library and the offer is unanswered. */
  restoreOffered: boolean;
  tourOpen: boolean;
  /** A sync has finished clean on this install. */
  firstSyncSettled: boolean;
  /** Distinct local days of use, today included. Null until counted, and nothing asks then. */
  useDays: number | null;
  /** The ask this session already raised, which keeps the slot. */
  sessionAsk: LaunchAsk | null;
  /** The asks whose surfaces report something to ask, the restore offer aside. */
  eligibleAsks: readonly LaunchAsk[];
}

export interface LaunchSurfaces {
  /** The one modal that may be up on this launch, or none. */
  modal: LaunchModal | null;
  /** The one ask that may be on screen in this session, or none. */
  ask: LaunchAsk | null;
  /** The update the What's New card names, or null when the card does not show. */
  whatsNewCard: WhatsNewCard | null;
}

export interface WhatsNewCard {
  /** The running version, which dismissing the card marks seen. */
  version: string;
  /** Slides added since the seen version. */
  slideCount: number;
}

/**
 * Whether the quiet period still holds, or null before the day count is read.
 * It ends once a sync has settled clean and the athlete has come back on a
 * second local day, whichever comes last.
 */
export function quietPeriod(
  facts: Pick<LaunchFacts, 'firstSyncSettled' | 'useDays'>
): boolean | null {
  if (facts.useDays === null) return null;
  return !facts.firstSyncSettled || facts.useDays < QUIET_PERIOD_USE_DAYS;
}

function launchModal(facts: LaunchFacts): LaunchModal | null {
  if (facts.taken) return facts.taken;
  if (!facts.settingsLoaded) return null;
  if (facts.libraryRebuilt) return 'libraryRebuilt';
  return null;
}

function whatsNewCard(facts: LaunchFacts, modal: LaunchModal | null): WhatsNewCard | null {
  if (modal !== null || facts.tourOpen || !facts.settingsLoaded || !facts.tourEligible) return null;
  if (quietPeriod(facts) !== false || facts.restoreOffered) return null;
  if (facts.lastSeenVersion === null || facts.lastSeenVersion === facts.currentVersion) return null;
  if (facts.missedSlideCount === 0) return null;
  return { version: facts.currentVersion, slideCount: facts.missedSlideCount };
}

function isEligible(facts: LaunchFacts, ask: LaunchAsk): boolean {
  return ask === 'restore' ? facts.restoreOffered : facts.eligibleAsks.includes(ask);
}

function sessionAsk(facts: LaunchFacts, modal: LaunchModal | null): LaunchAsk | null {
  if (modal !== null || facts.tourOpen) return null;
  if (facts.sessionAsk) return isEligible(facts, facts.sessionAsk) ? facts.sessionAsk : null;
  const quiet = quietPeriod(facts);
  if (quiet === null) return null;
  const allowed = quiet ? ASK_ORDER.filter((ask) => QUIET_PERIOD_ASKS.includes(ask)) : ASK_ORDER;
  return allowed.find((ask) => isEligible(facts, ask)) ?? null;
}

export function launchSurfaces(facts: LaunchFacts): LaunchSurfaces {
  const modal = launchModal(facts);
  return { modal, ask: sessionAsk(facts, modal), whatsNewCard: whatsNewCard(facts, modal) };
}
