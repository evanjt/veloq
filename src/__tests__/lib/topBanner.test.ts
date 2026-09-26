/**
 * Scenario: the top slot holds one banner and three conditions compete for it.
 *
 * Expected behaviour: offline wins whoever is signed in, including nobody. The
 * athlete signed out on a plane is the one the banner is for, and gating it on
 * a session is what withheld it from them.
 */
import { pickTopBanner, type TopBannerState } from '@/shared/app/topBanner';

function state(overrides: Partial<TopBannerState> = {}): TopBannerState {
  return {
    isOnline: true,
    isAuthenticated: true,
    isDemoMode: false,
    hideDemoBanner: false,
    lastError: null,
    ...overrides,
  };
}

describe('pickTopBanner', () => {
  it('shows offline to a signed-out athlete', () => {
    expect(pickTopBanner(state({ isOnline: false, isAuthenticated: false }))).toBe('offline');
  });

  it('shows offline to a signed-in athlete', () => {
    expect(pickTopBanner(state({ isOnline: false }))).toBe('offline');
  });

  it('shows offline in demo mode rather than the demo ribbon', () => {
    expect(pickTopBanner(state({ isOnline: false, isDemoMode: true }))).toBe('offline');
  });

  it('prefers offline over a stale sync error', () => {
    expect(pickTopBanner(state({ isOnline: false, lastError: 'HTTP 503' }))).toBe('offline');
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

  it('claims the slot for nothing when connected with no error', () => {
    expect(pickTopBanner(state())).toBeNull();
  });
});
