/**
 * The words for one ledger change: a headline and at most one reason, shared
 * by the section's history and the activity screen. The engine decides what
 * moved and why. This only picks the sentence and fills it in.
 */

import type { TFunction } from 'i18next';
import type { FfiChangeReason, FfiSectionChangeSummary } from 'veloqrs';
import { formatDistance } from '@/shared/format/format';
import { FIXED_LABEL_LEDGER_KINDS } from './sectionLedger';

type Translate = TFunction;

/** The reasons the copy can word. A tag outside it draws no reason. */
const REASON_KINDS = new Set([
  'usage_change',
  'fork',
  'traffic_cliff',
  'terminus',
  'low_support',
  'trim',
  'seam_clip',
  'pass_end',
]);

/** What a row carries beyond its summary that a headline can use. */
export interface ChangeSource {
  kind: string;
  summary?: FfiSectionChangeSummary | undefined;
  /** Sections a split left, when the row names them. */
  siblingCount?: number | undefined;
  /** The version a revert put back. */
  version?: number | string | undefined;
  /** Whether a reference anchoring moved the line. */
  anchoredInPlace?: boolean | undefined;
  /** Rides on the line when it formed. */
  rideCount?: number | undefined;
}

export interface ChangeCopy {
  headline: string | null;
  reason: string | null;
}

const NAME_FALLBACK = 'sectionHistory.pairUnnamed';

function partOf(moved: string | undefined): 'start' | 'end' | 'both' {
  return moved === 'start' || moved === 'end' ? moved : 'both';
}

function reasonLine(
  t: Translate,
  reason: FfiChangeReason,
  summary: FfiSectionChangeSummary,
  isMetric: boolean
): string | null {
  if (!REASON_KINDS.has(reason.kind)) return null;
  const part = partOf(summary.moved);
  const name = reason.neighbour?.name?.trim() || t(NAME_FALLBACK as never);
  const key = `sectionHistory.reason_${reason.kind}_${part}` as never;
  switch (reason.kind) {
    case 'seam_clip':
      if (reason.metres == null) return null;
      return t(key, { distance: formatDistance(reason.metres, isMetric), name });
    case 'trim':
      return t(key, {
        distance: formatDistance(reason.metres ?? 0, isMetric),
        name,
      });
    case 'low_support': {
      if (summary.lengthBefore == null || summary.lengthAfter == null) return null;
      const dropped = Math.abs(summary.lengthBefore - summary.lengthAfter);
      return t(key, { distance: formatDistance(dropped, isMetric), of: reason.of ?? 0 });
    }
    case 'pass_end':
      return t(key);
    default:
      if (reason.count == null || reason.of == null) return null;
      return t(key, { rides: reason.count, of: reason.of, name });
  }
}

/** The headline and the one reason for a change, in the approved wording. */
export function changeCopy(t: Translate, source: ChangeSource, isMetric: boolean): ChangeCopy {
  const { kind, summary } = source;
  const reason = summary?.reason;

  if (
    kind === 'recut' &&
    summary?.moved &&
    summary.lengthBefore != null &&
    summary.lengthAfter != null
  ) {
    const direction = summary.lengthAfter >= summary.lengthBefore ? 'longer' : 'shorter';
    return {
      headline: t(`sectionHistory.headline_${direction}_${partOf(summary.moved)}` as never, {
        from: formatDistance(summary.lengthBefore, isMetric),
        to: formatDistance(summary.lengthAfter, isMetric),
      }),
      reason: reason ? reasonLine(t, reason, summary, isMetric) : null,
    };
  }

  if (kind === 'split' && summary?.moved === 'split' && summary.atMetres != null) {
    const distance = formatDistance(summary.atMetres, isMetric);
    if (reason?.kind === 'fork' && reason.count != null && reason.of != null) {
      return {
        headline: t('sectionHistory.headline_split_fork' as never, {
          distance,
          rides: reason.count,
          of: reason.of,
          name: reason.neighbour?.name?.trim() || t(NAME_FALLBACK as never),
        }),
        reason: null,
      };
    }
    return { headline: t('sectionHistory.headline_split_at' as never, { distance }), reason: null };
  }

  return { headline: kindHeadline(t, source), reason: null };
}

function kindHeadline(t: Translate, source: ChangeSource): string | null {
  const { kind } = source;
  switch (kind) {
    case 'split':
      return source.siblingCount != null
        ? t('sectionHistory.kind_split' as never, { count: source.siblingCount })
        : null;
    case 'reverted':
      return source.version != null
        ? t('sectionHistory.kind_reverted' as never, { version: source.version })
        : null;
    case 'reference_anchored':
      return t(
        (source.anchoredInPlace
          ? 'sectionHistory.kind_reference_anchored_in_place'
          : 'sectionHistory.kind_reference_anchored') as never
      );
    case 'formed':
      return source.rideCount
        ? t('sectionHistory.headline_formed' as never, { count: source.rideCount })
        : t('sectionHistory.kind_formed' as never);
    default:
      return FIXED_LABEL_LEDGER_KINDS.has(kind) ? t(`sectionHistory.kind_${kind}` as never) : null;
  }
}
