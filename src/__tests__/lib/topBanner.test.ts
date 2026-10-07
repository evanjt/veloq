/**
 * Scenario: the top slot holds one banner and three conditions compete for it.
 *
 * Expected behaviour: offline wins whoever is signed in, including nobody. The
 * athlete signed out on a plane is the one the banner is for, and gating it on
 * a session is what withheld it from them.
 */
import { pickTopBanner, padsStatusBar, type TopBannerState } from '@/shared/app/topBanner';

function state(overrides: Partial<TopBannerState> = {}): TopBannerState {
  return {
    startupErrorShown: false,
    offlineBannerShown: false,
    isAuthenticated: true,
    isDemoMode: false,
    hideDemoBanner: false,
    lastError: null,
    trackFetchNoticeShown: false,
    engineInitFailed: false,
    ...overrides,
  };
}

describe('pickTopBanner', () => {
  it('claims the slot for a startup error above an offline banner', () => {
    expect(pickTopBanner(state({ startupErrorShown: true }))).toBe('startupError');
    expect(pickTopBanner(state({ startupErrorShown: true, offlineBannerShown: true }))).toBe(
      'startupError'
    );
  });

  it('shows offline to a signed-out athlete', () => {
    expect(pickTopBanner(state({ offlineBannerShown: true, isAuthenticated: false }))).toBe(
      'offline'
    );
  });

  it('shows offline to a signed-in athlete', () => {
    expect(pickTopBanner(state({ offlineBannerShown: true }))).toBe('offline');
  });

  it('shows offline in demo mode rather than the demo ribbon', () => {
    expect(pickTopBanner(state({ offlineBannerShown: true, isDemoMode: true }))).toBe('offline');
  });

  it('prefers offline over a stale sync error', () => {
    expect(pickTopBanner(state({ offlineBannerShown: true, lastError: 'HTTP 503' }))).toBe(
      'offline'
    );
  });

  it('shows the sync error when connected', () => {
    expect(pickTopBanner(state({ lastError: 'HTTP 503' }))).toBe('syncError');
  });

  it('keeps the sync error to a real session, not a demo one', () => {
    expect(pickTopBanner(state({ isDemoMode: true, lastError: 'HTTP 503' }))).toBe('demo');
  });

  it('says nothing about a sync a signed-out athlete does not have', () => {
    expect(pickTopBanner(state({ isAuthenticated: false, lastError: 'HTTP 503' }))).toBeNull();
  });

  it('shows the demo ribbon until it is dismissed', () => {
    expect(pickTopBanner(state({ isDemoMode: true }))).toBe('demo');
    expect(pickTopBanner(state({ isDemoMode: true, hideDemoBanner: true }))).toBeNull();
  });

  /**
   * While the offline banner's delay runs the device reads offline and the
   * offline banner is not up yet. The sync-error banner stays up through that
   * delay, so the slot stays its own until the offline banner takes it.
   */
  it('keeps the slot for a sync error while the offline banner is still held back', () => {
    expect(pickTopBanner(state({ offlineBannerShown: false, lastError: 'HTTP 503' }))).toBe(
      'syncError'
    );
  });

  it('leaves the demo ribbon its slot while the offline banner is still held back', () => {
    expect(pickTopBanner(state({ offlineBannerShown: false, isDemoMode: true }))).toBe('demo');
  });

  it('claims the slot for nothing when connected with no error', () => {
    expect(pickTopBanner(state())).toBeNull();
  });
});

describe('banners the pick used to leave out', () => {
  it('claims the slot for the track notice alone, so screens drop their top edge', () => {
    expect(pickTopBanner(state({ trackFetchNoticeShown: true }))).toBe('trackFetch');
  });

  it('claims the slot for a failed engine open', () => {
    expect(pickTopBanner(state({ engineInitFailed: true }))).toBe('engineInit');
  });

  it('lets the demo ribbon stand under the track notice', () => {
    expect(pickTopBanner(state({ isDemoMode: true, trackFetchNoticeShown: true }))).toBe(
      'trackFetch'
    );
  });
});

describe('padsStatusBar', () => {
  it('pads only the banner the pick chose, so a stack carries one inset', () => {
    const active = pickTopBanner(state({ offlineBannerShown: true, isDemoMode: true }));
    expect(padsStatusBar(active, 'offline')).toBe(true);
    expect(padsStatusBar(active, 'demo')).toBe(false);
  });

  it('pads a banner shown without the provider, as a standalone render', () => {
    expect(padsStatusBar(undefined, 'demo')).toBe(true);
  });
});
