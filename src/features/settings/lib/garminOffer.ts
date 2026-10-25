/**
 * The feed offer to connect Garmin, raised after a download brought rides that
 * intervals.icu holds back from apps.
 *
 * It is eligible only while the connector is off and at least one such ride came
 * in. Not now records how many there were, and the offer returns only when a
 * later download brings more than that.
 */

export interface GarminOfferFacts {
  /** The Garmin key is kept on this device, or null until that is read. */
  connected: boolean | null;
  /** Rides the last download brought that intervals.icu holds back. */
  heldBack: number;
  /** The held-back count at the last Not now, or null when never declined. */
  declinedAt: number | null;
}

export interface GarminOffer {
  /** The held-back rides the card names. */
  count: number;
}

export function garminOffer(facts: GarminOfferFacts): GarminOffer | null {
  if (facts.connected !== false || facts.heldBack <= 0) return null;
  if (facts.declinedAt !== null && facts.heldBack <= facts.declinedAt) return null;
  return { count: facts.heldBack };
}

/** The count Not now records: the highest declined at, so a lower count never reopens it. */
export function afterGarminOfferDeclined(count: number, previous: number | null = null): number {
  return Math.max(count, previous ?? 0);
}

/** The stored count, read leniently: a row that is not a count is no record. */
export function parseGarminOfferRecord(stored: string | null): number | null {
  if (stored === null) return null;
  const count = Number(stored);
  return Number.isInteger(count) && count >= 0 ? count : null;
}
