/**
 * Scenario: peer-comparison chips average the same activity type from history.
 *
 * Expected behaviour: activities missing the field are excluded, not counted as
 * zero. Twenty rides where eight lack a heart-rate strap must average the twelve
 * that have one, or an ordinary ride reads as far above typical.
 */
type Sample = { average_heartrate?: number | null; icu_average_hr?: number | null };

function meanOf(rows: Sample[], pick: (a: Sample) => number | null | undefined): number | null {
  const values = rows.map(pick).filter((v): v is number => Number.isFinite(v));
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

describe('peer averages', () => {
  const history: Sample[] = [
    ...Array.from({ length: 12 }, () => ({ average_heartrate: 140 })),
    ...Array.from({ length: 8 }, () => ({ average_heartrate: null })),
  ];

  it('averages only the activities carrying the field', () => {
    expect(meanOf(history, (a) => a.average_heartrate ?? a.icu_average_hr)).toBe(140);
  });

  it('is not dragged down by missing observations', () => {
    const coercing =
      history.reduce((sum, a) => sum + (a.average_heartrate || a.icu_average_hr || 0), 0) /
      history.length;

    expect(Math.round(coercing)).toBe(84);
    expect(meanOf(history, (a) => a.average_heartrate ?? a.icu_average_hr)).toBe(140);
  });

  it('returns null when nothing carries the field, so the chip disappears', () => {
    const none: Sample[] = [{ average_heartrate: null }, {}];
    expect(meanOf(none, (a) => a.average_heartrate ?? a.icu_average_hr)).toBeNull();
  });
});
