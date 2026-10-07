import type { TFunction } from 'i18next';
import type { LibraryCoverage } from 'veloqrs';

/**
 * What the sync row says about the library as a whole, as zero, one or two
 * lines.
 *
 * Every progress figure beside this one is the running pass's own queue, so a
 * library of 1,598 rides with 400 tracks stored read "12/12" and then nothing:
 * the rides no pass had queued were invisible. These lines are the window the athlete asked for.
 *
 * Two pairs, not one fraction. The activity pages arrive with the window syncs
 * and the tracks with the GPS pass, so one can be current while the other is
 * hundreds short, and a single figure would hide whichever is further behind.
 *
 * A pair that agrees says nothing, and so does an athlete whose census has
 * never been pulled: every count is zero then, and a zero fraction is a claim
 * about an account nobody has read.
 */
export function formatLibraryCoverage(coverage: LibraryCoverage | null, t: TFunction): string[] {
  if (!coverage) return [];
  const lines: string[] = [];
  if (coverage.upstream > 0 && coverage.fetched < coverage.upstream) {
    lines.push(
      t('sync.ridesDownloaded', {
        completed: coverage.fetched,
        total: coverage.upstream,
      }) as string
    );
  }
  if (coverage.tracksUpstream > 0 && coverage.tracksStored < coverage.tracksUpstream) {
    lines.push(
      t('sync.tracksDownloaded', {
        completed: coverage.tracksStored,
        total: coverage.tracksUpstream,
      }) as string
    );
  }
  return lines;
}
