/**
 * What a launch may raise, decided in one place.
 *
 * A launch interrupts the athlete with one modal at most. A first load shows
 * the tour and nothing else. A library the engine had to rebuild is about the
 * athlete's own data, so it goes before a What's New tour, which then waits for
 * the next launch. The restore offer is never a modal: it is a card on the feed
 * that stays until it is answered. The notification card asks nothing while the
 * tour is up, while the restore offer is unanswered, or before the library holds
 * an activity to be notified about.
 */

export type LaunchModal = 'tutorial' | 'whatsNew' | 'libraryRebuilt';

export interface LaunchFacts {
  /** The modal this launch already raised, which keeps the slot. */
  taken: LaunchModal | null;
  /** The seen version has been read, so a first load can be told apart. */
  settingsLoaded: boolean;
  /** A tour may open on its own: someone is signed in and it is not demo. */
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
  libraryCount: number;
}

export interface LaunchSurfaces {
  /** The one modal that may be up on this launch, or none. */
  modal: LaunchModal | null;
  restoreCard: boolean;
  notificationCard: boolean;
}

function launchModal(facts: LaunchFacts): LaunchModal | null {
  if (facts.taken) return facts.taken;
  if (!facts.settingsLoaded) return null;
  if (facts.tourEligible && facts.lastSeenVersion === null) return 'tutorial';
  if (facts.libraryRebuilt) return 'libraryRebuilt';
  if (
    facts.tourEligible &&
    facts.lastSeenVersion !== facts.currentVersion &&
    facts.missedSlideCount > 0
  ) {
    return 'whatsNew';
  }
  return null;
}

export function launchSurfaces(facts: LaunchFacts): LaunchSurfaces {
  return {
    modal: launchModal(facts),
    restoreCard: facts.restoreOffered,
    notificationCard: !facts.tourOpen && !facts.restoreOffered && facts.libraryCount > 0,
  };
}
