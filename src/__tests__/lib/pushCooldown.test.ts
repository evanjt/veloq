import { isPushAllowed, prunePushHistory } from '@/lib/notifications/insightNotification';
import { INSIGHTS_CONFIG } from '@/hooks/insights/config';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = 1_700_000_000_000;

describe('isPushAllowed — D11 cooldown', () => {
  it('always allows the first push', () => {
    expect(isPushAllowed([], NOW)).toBe(true);
  });

  it('blocks when last push was within minHoursBetween', () => {
    const history = [NOW - 2 * HOUR];
    expect(isPushAllowed(history, NOW)).toBe(false); // default min=18h
  });

  it('allows after the cooldown has elapsed', () => {
    const history = [NOW - 20 * HOUR];
    expect(isPushAllowed(history, NOW)).toBe(true);
  });

  it('blocks when weekly cap reached', () => {
    const history = Array.from(
      { length: INSIGHTS_CONFIG.push.maxPerWeek },
      (_, i) => NOW - (i + 1) * DAY
    );
    expect(isPushAllowed(history, NOW)).toBe(false);
  });

  it('ignores pushes older than 7 days when counting the weekly cap', () => {
    const history = Array.from({ length: 20 }, (_, i) => NOW - (i + 10) * DAY);
    expect(isPushAllowed(history, NOW)).toBe(true);
  });

  it('respects config.enabled=false', () => {
    const cfg = { ...INSIGHTS_CONFIG.push, enabled: false };
    expect(isPushAllowed([], NOW, cfg)).toBe(false);
  });
});

describe('prunePushHistory', () => {
  it('drops timestamps older than 7 days', () => {
    const history = [NOW - 10 * DAY, NOW - 3 * DAY, NOW - 1 * DAY];
    expect(prunePushHistory(history, NOW)).toEqual([NOW - 3 * DAY, NOW - 1 * DAY]);
  });

  it('keeps empty result when everything is stale', () => {
    expect(prunePushHistory([NOW - 30 * DAY], NOW)).toEqual([]);
  });
});
