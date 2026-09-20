/**
 * How old the curve on screen is.
 *
 * A power or pace curve is a stored body: offline, the chart draws whatever was
 * last fetched, and nothing on the header said when that was. A stale reading is
 * not dropped, it stays on screen with one quiet line underneath dating it.
 */

export type CurveFreshness = { kind: 'dated'; fetchedAt: number } | { kind: 'never' } | null;

interface CurveFreshnessInput {
  /** Epoch milliseconds the stored body was fetched, null when never stored. */
  fetchedAt: number | null | undefined;
  isLoading: boolean;
}

/**
 * The line to draw, or null for no line at all.
 *
 * A stamp is dated whenever there is one, a refresh in flight included: what is
 * on screen is still the old body until the new one lands. With no stamp the
 * first fetch is given its chance before the screen claims nothing is stored.
 */
export function curveFreshness({ fetchedAt, isLoading }: CurveFreshnessInput): CurveFreshness {
  if (typeof fetchedAt === 'number' && Number.isFinite(fetchedAt) && fetchedAt > 0) {
    return { kind: 'dated', fetchedAt };
  }
  return isLoading ? null : { kind: 'never' };
}
