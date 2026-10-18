/**
 * Scenario: a launch can find a backup to restore, a library the engine had to
 * rebuild, a tour never seen and a version with new slides, all at once, and
 * the feed's cards can each have something to ask.
 *
 * Expected behaviour: a launch raises one modal at most, and a first load raises
 * none: the tour is an ask on the feed after the quiet period. A rebuilt library
 * raises its notice. What's New after an update
 * is never a modal: it is a feed card, kept out of the quiet period, away from a
 * restore offer and from under a modal, and it takes no ask's slot. The restore
 * offer is never a modal. The quiet period lasts until a sync has settled clean
 * and the athlete has used the app on a second local day, and inside it only the
 * restore offer asks. After it a session asks at most one thing, the first
 * eligible in order, and an ask answered does not hand its slot to the next.
 */

import {
  launchSurfaces,
  type LaunchAsk,
  type LaunchFacts,
} from '@/features/settings/lib/launchSurfaces';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';

const mockRows = new Map<string, string>();

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async (key: string) => mockRows.get(key) ?? null),
  setSetting: jest.fn(async (key: string, value: string) => {
    mockRows.set(key, value);
  }),
}));

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
  firstSyncSettled: true,
  useDays: 2,
  sessionAsk: null,
  eligibleAsks: [],
};

/** A first day of use whose sync has not settled yet. */
const quietPeriod: Pick<LaunchFacts, 'firstSyncSettled' | 'useDays'> = {
  firstSyncSettled: false,
  useDays: 1,
};

function eligible(...asks: LaunchAsk[]): Pick<LaunchFacts, 'eligibleAsks'> {
  return { eligibleAsks: asks };
}

describe('the one modal a launch may raise', () => {
  it('opens a first sign-in straight onto the feed, with no tour', () => {
    const surfaces = launchSurfaces({ ...quiet, ...quietPeriod, lastSeenVersion: null });
    expect(surfaces.modal).toBeNull();
    expect(surfaces.ask).toBeNull();
  });

  it('offers the tour as the session’s ask once the quiet period is over', () => {
    const surfaces = launchSurfaces({ ...quiet, lastSeenVersion: null, ...eligible('tourOffer') });
    expect(surfaces.modal).toBeNull();
    expect(surfaces.ask).toBe('tourOffer');
  });

  it('raises the rebuilt library’s notice on a first load that also found a backup', () => {
    const surfaces = launchSurfaces({
      ...quiet,
      ...quietPeriod,
      lastSeenVersion: null,
      libraryRebuilt: true,
      restoreOffered: true,
    });
    expect(surfaces.modal).toBe('libraryRebuilt');
    expect(surfaces.ask).toBeNull();
  });

  it('raises the rebuilt library’s notice after an update with slides missed', () => {
    const surfaces = launchSurfaces({
      ...quiet,
      lastSeenVersion: '1.1.0',
      missedSlideCount: 3,
      libraryRebuilt: true,
    });
    expect(surfaces.modal).toBe('libraryRebuilt');
    expect(surfaces.whatsNewCard).toBeNull();
  });

  it('raises no modal after an update with a slide missed', () => {
    expect(
      launchSurfaces({
        ...quiet,
        lastSeenVersion: '0.4.0',
        currentVersion: '0.4.1',
        missedSlideCount: 1,
      }).modal
    ).toBeNull();
  });

  it('raises nothing when the version moved with no slide to show', () => {
    const surfaces = launchSurfaces({ ...quiet, lastSeenVersion: '1.1.0' });
    expect(surfaces.modal).toBeNull();
    expect(surfaces.whatsNewCard).toBeNull();
  });

  it('keeps the slot with the modal that took it, whatever arrives after', () => {
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
    const surfaces = launchSurfaces({ ...quiet, ...quietPeriod, restoreOffered: true });
    expect(surfaces.modal).toBeNull();
    expect(surfaces.ask).toBe('restore');
  });
});

describe('the one ask a session may raise', () => {
  it('asks nothing in the quiet period with no backup to offer', () => {
    const surfaces = launchSurfaces({
      ...quiet,
      ...quietPeriod,
      ...eligible('seriesConsent', 'support', 'support'),
    });
    expect(surfaces.ask).toBeNull();
  });

  it('asks only the restore offer in the quiet period when a backup was found', () => {
    const surfaces = launchSurfaces({
      ...quiet,
      ...quietPeriod,
      restoreOffered: true,
      ...eligible('seriesConsent', 'support', 'support'),
    });
    expect(surfaces.ask).toBe('restore');
  });

  it('asks nothing before the days of use are counted', () => {
    const surfaces = launchSurfaces({
      ...quiet,
      useDays: null,
      restoreOffered: true,
      ...eligible('support'),
    });
    expect(surfaces.ask).toBeNull();
  });

  it('asks the series download alone on a second day of use with the tour unseen', () => {
    const surfaces = launchSurfaces({
      ...quiet,
      firstSyncSettled: true,
      useDays: 2,
      ...eligible('support', 'tourOffer', 'seriesConsent'),
    });
    expect(surfaces.ask).toBe('seriesConsent');
  });

  it('asks nothing on a second day of use when no sync has settled', () => {
    const surfaces = launchSurfaces({
      ...quiet,
      firstSyncSettled: false,
      useDays: 2,
      ...eligible('seriesConsent', 'tourOffer', 'support'),
    });
    expect(surfaces.ask).toBeNull();
    expect(
      launchSurfaces({ ...quiet, firstSyncSettled: false, useDays: 9, ...eligible('support') }).ask
    ).toBeNull();
  });

  it('asks the first eligible in order: restore, series, tour, support', () => {
    const order: LaunchAsk[] = ['seriesConsent', 'tourOffer', 'support'];
    order.forEach((ask, i) => {
      const later = order.slice(i);
      expect(launchSurfaces({ ...quiet, eligibleAsks: [...later].reverse() }).ask).toBe(ask);
    });
    expect(launchSurfaces({ ...quiet, restoreOffered: true, eligibleAsks: order }).ask).toBe(
      'restore'
    );
  });

  it('asks nothing in a later session with nothing eligible', () => {
    expect(launchSurfaces(quiet).ask).toBeNull();
  });

  it('keeps the slot with the ask that took it while it is still unanswered', () => {
    const surfaces = launchSurfaces({
      ...quiet,
      sessionAsk: 'support',
      ...eligible('seriesConsent', 'support'),
    });
    expect(surfaces.ask).toBe('support');
  });

  it('hands nothing on once the ask that took the slot is answered', () => {
    const surfaces = launchSurfaces({
      ...quiet,
      sessionAsk: 'seriesConsent',
      ...eligible('tourOffer', 'support'),
    });
    expect(surfaces.ask).toBeNull();
  });

  it('hands nothing on once the restore offer is answered in the quiet period', () => {
    const surfaces = launchSurfaces({
      ...quiet,
      ...quietPeriod,
      sessionAsk: 'restore',
      ...eligible('support'),
    });
    expect(surfaces.ask).toBeNull();
  });

  it('asks nothing while a tour is open', () => {
    expect(launchSurfaces({ ...quiet, tourOpen: true, ...eligible('support') }).ask).toBeNull();
  });

  it('hides the ask that holds the slot while the tour is open, and keeps its slot', () => {
    const held = { ...quiet, sessionAsk: 'support' as const, ...eligible('support') };
    expect(launchSurfaces({ ...held, tourOpen: true }).ask).toBeNull();
    expect(launchSurfaces(held).ask).toBe('support');
  });

  it('asks nothing while a launch modal is up', () => {
    const surfaces = launchSurfaces({
      ...quiet,
      libraryRebuilt: true,
      ...eligible('support'),
    });
    expect(surfaces.modal).toBe('libraryRebuilt');
    expect(surfaces.ask).toBeNull();
  });
});

describe('the What’s New card after an update', () => {
  const updated: LaunchFacts = {
    ...quiet,
    lastSeenVersion: '0.4.0',
    currentVersion: '0.4.1',
    missedSlideCount: 1,
  };

  it('names the running version and the slides missed', () => {
    expect(launchSurfaces(updated).whatsNewCard).toEqual({ version: '0.4.1', slideCount: 1 });
  });

  it('shows nothing once the running version is seen', () => {
    expect(launchSurfaces({ ...updated, lastSeenVersion: '0.4.1' }).whatsNewCard).toBeNull();
  });

  it('shows nothing on a first load, which has no seen version', () => {
    expect(launchSurfaces({ ...updated, lastSeenVersion: null }).whatsNewCard).toBeNull();
  });

  it('shows nothing in the quiet period, or before the days of use are counted', () => {
    expect(launchSurfaces({ ...updated, ...quietPeriod }).whatsNewCard).toBeNull();
    expect(launchSurfaces({ ...updated, useDays: null }).whatsNewCard).toBeNull();
  });

  it('shows nothing beside a restore offer', () => {
    expect(launchSurfaces({ ...updated, restoreOffered: true }).whatsNewCard).toBeNull();
  });

  it('shows nothing where no tour may open, before the settings are read, or while a tour is open', () => {
    expect(launchSurfaces({ ...updated, tourEligible: false }).whatsNewCard).toBeNull();
    expect(launchSurfaces({ ...updated, settingsLoaded: false }).whatsNewCard).toBeNull();
    expect(launchSurfaces({ ...updated, tourOpen: true }).whatsNewCard).toBeNull();
  });

  it('shows nothing under a modal the launch already raised', () => {
    expect(launchSurfaces({ ...updated, taken: 'libraryRebuilt' }).whatsNewCard).toBeNull();
  });

  it('takes no ask’s slot, so an eligible ask shows beside it', () => {
    const surfaces = launchSurfaces({ ...updated, ...eligible('support') });
    expect(surfaces.whatsNewCard).not.toBeNull();
    expect(surfaces.ask).toBe('support');
  });
});

describe('the quiet period across launches', () => {
  const FIRST_DAY = new Date(2026, 4, 11, 9, 0, 0);

  async function launchAt(dayOffset: number, hour: number): Promise<void> {
    const at = new Date(FIRST_DAY);
    at.setDate(at.getDate() + dayOffset);
    at.setHours(hour);
    jest.setSystemTime(at);
    useWhatsNewStore.setState({ usageLoaded: false });
    await useWhatsNewStore.getState().countUse();
    // The row is written without awaiting; let it land before the next launch reads.
    await Promise.resolve();
  }

  function verdict(facts: Partial<LaunchFacts> = {}) {
    const usage = useWhatsNewStore.getState();
    return launchSurfaces({
      ...quiet,
      firstSyncSettled: usage.firstSyncSettled,
      useDays: usage.usageLoaded ? usage.useDays : null,
      ...eligible('seriesConsent', 'tourOffer', 'support'),
      ...facts,
    });
  }

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    mockRows.clear();
    useWhatsNewStore.setState({
      firstUseDate: null,
      lastUseDate: null,
      useDays: 0,
      firstSyncSettled: false,
      usageLoaded: false,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('asks only a restore offer on three launches in one local day, the sync settled after the first', async () => {
    await launchAt(0, 9);
    expect(verdict().ask).toBeNull();
    useWhatsNewStore.getState().noteSyncSettledClean();

    for (const hour of [13, 21]) {
      await launchAt(0, hour);
      expect(verdict().ask).toBeNull();
      expect(verdict({ restoreOffered: true }).ask).toBe('restore');
    }
  });

  it('ends on the next local day once the sync has settled, and asks the series card alone', async () => {
    await launchAt(0, 9);
    useWhatsNewStore.getState().noteSyncSettledClean();
    await launchAt(1, 8);
    expect(verdict().ask).toBe('seriesConsent');
  });

  it('holds on a second day of use when the first sync never settled', async () => {
    await launchAt(0, 9);
    await launchAt(1, 8);
    expect(useWhatsNewStore.getState().useDays).toBe(2);
    expect(verdict().ask).toBeNull();
  });

  it('keeps a settle noted before the row was read', async () => {
    await launchAt(0, 9);
    useWhatsNewStore.setState({ usageLoaded: false, firstSyncSettled: false });
    useWhatsNewStore.getState().noteSyncSettledClean();
    await launchAt(1, 8);
    expect(useWhatsNewStore.getState().firstSyncSettled).toBe(true);
    expect(JSON.parse(mockRows.get('veloq-usage') ?? '{}').firstSyncSettled).toBe(true);
  });
});
