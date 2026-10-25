/**
 * Scenario: a download brings rides that intervals.icu holds back from Garmin
 * while the connector is off. The feed offers the connector once, with the count.
 *
 * Expected behaviour: the offer is eligible only with the connector off and at
 * least one held-back ride. Not now holds it until a later download brings more
 * such rides than the count it was declined at.
 */

import { afterGarminOfferDeclined, garminOffer, parseGarminOfferRecord } from '../garminOffer';

const base = { connected: false, heldBack: 14, declinedAt: null as number | null };

describe('the Garmin offer', () => {
  it('names the held-back rides while the connector is off', () => {
    expect(garminOffer(base)).toEqual({ count: 14 });
  });

  it('is ineligible with the connector on', () => {
    expect(garminOffer({ ...base, connected: true })).toBeNull();
  });

  it('is ineligible when no ride was held back', () => {
    expect(garminOffer({ ...base, heldBack: 0 })).toBeNull();
  });

  it('is ineligible while the connection is unread', () => {
    expect(garminOffer({ ...base, connected: null })).toBeNull();
  });

  it('holds after Not now until a later download brings more', () => {
    const declinedAt = afterGarminOfferDeclined(14);
    expect(garminOffer({ ...base, declinedAt })).toBeNull();
    expect(garminOffer({ ...base, heldBack: 13, declinedAt })).toBeNull();
    expect(garminOffer({ ...base, heldBack: 15, declinedAt })).toEqual({ count: 15 });
  });

  it('keeps the highest count declined at', () => {
    expect(afterGarminOfferDeclined(3, 14)).toBe(14);
    expect(afterGarminOfferDeclined(20, 14)).toBe(20);
  });

  it('reads a stored record leniently', () => {
    expect(parseGarminOfferRecord('14')).toBe(14);
    expect(parseGarminOfferRecord(null)).toBeNull();
    expect(parseGarminOfferRecord('x')).toBeNull();
    expect(parseGarminOfferRecord('-2')).toBeNull();
  });
});
