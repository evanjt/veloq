/**
 * Scenario: a launch can find a backup to restore, a library the engine had to
 * rebuild, a tour never seen and a version with new slides, all at once.
 *
 * Expected behaviour: a launch raises one modal at most. A first load raises the
 * tour alone. A rebuilt library takes the slot from a What's New tour, which
 * waits for the next launch. The restore offer is never a modal, only an inline
 * card, and the notification card waits for a closed tour and an activity in the
 * library.
 */

import { launchSurfaces, type LaunchFacts } from '@/features/settings/lib/launchSurfaces';

const quiet: LaunchFacts = {
  taken: null,
  settingsLoaded: true,
  tourEligible: true,
  lastSeenVersion: '1.2.0',
  currentVersion: '1.2.0',
  missedSlideCount: 0,
  libraryRebuilt: false,
  restoreOffered: false,
  tourOpen: false,
  libraryCount: 4,
};

describe('the one modal a launch may raise', () => {
  it('raises the tour alone on a first load that also found a backup and a rebuilt library', () => {
    const surfaces = launchSurfaces({
      ...quiet,
      lastSeenVersion: null,
      libraryRebuilt: true,
      restoreOffered: true,
      libraryCount: 0,
    });
    expect(surfaces.modal).toBe('tutorial');
    expect(surfaces.restoreCard).toBe(true);
    expect(surfaces.notificationCard).toBe(false);
  });

  it('gives a rebuilt library the slot over a What’s New tour', () => {
    const surfaces = launchSurfaces({
      ...quiet,
      lastSeenVersion: '1.1.0',
      missedSlideCount: 3,
      libraryRebuilt: true,
    });
    expect(surfaces.modal).toBe('libraryRebuilt');
  });

  it('raises What’s New once the version moved and slides were missed', () => {
    expect(launchSurfaces({ ...quiet, lastSeenVersion: '1.1.0', missedSlideCount: 3 }).modal).toBe(
      'whatsNew'
    );
  });

  it('raises nothing when the version moved with no slide to show', () => {
    expect(launchSurfaces({ ...quiet, lastSeenVersion: '1.1.0' }).modal).toBeNull();
  });

  it('keeps the slot with the modal that took it, whatever arrives after', () => {
    const tour = launchSurfaces({ ...quiet, taken: 'tutorial', libraryRebuilt: true });
    expect(tour.modal).toBe('tutorial');

    const notice = launchSurfaces({
      ...quiet,
      taken: 'libraryRebuilt',
      lastSeenVersion: null,
    });
    expect(notice.modal).toBe('libraryRebuilt');
  });

  it('decides nothing before the settings are read', () => {
    expect(
      launchSurfaces({ ...quiet, settingsLoaded: false, libraryRebuilt: true }).modal
    ).toBeNull();
  });

  it('raises the notice and no tour where no tour may open', () => {
    const surfaces = launchSurfaces({
      ...quiet,
      tourEligible: false,
      lastSeenVersion: null,
      libraryRebuilt: true,
    });
    expect(surfaces.modal).toBe('libraryRebuilt');
    expect(launchSurfaces({ ...quiet, tourEligible: false, lastSeenVersion: null }).modal).toBe(
      null
    );
  });

  it('never makes the restore offer a modal', () => {
    const surfaces = launchSurfaces({ ...quiet, restoreOffered: true, libraryCount: 0 });
    expect(surfaces.modal).toBeNull();
    expect(surfaces.restoreCard).toBe(true);
  });
});

describe('the notification card', () => {
  it('shows on a library holding activities with the tour closed', () => {
    expect(launchSurfaces(quiet).notificationCard).toBe(true);
  });

  it('waits while the tour is open', () => {
    expect(launchSurfaces({ ...quiet, tourOpen: true }).notificationCard).toBe(false);
  });

  it('waits until the library holds an activity', () => {
    expect(launchSurfaces({ ...quiet, libraryCount: 0 }).notificationCard).toBe(false);
  });

  it('waits while the restore offer is unanswered', () => {
    expect(launchSurfaces({ ...quiet, restoreOffered: true }).notificationCard).toBe(false);
  });
});
