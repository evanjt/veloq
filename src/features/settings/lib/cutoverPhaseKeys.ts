import type { CutoverPhase } from 'veloqrs';

/**
 * What a settled failure says, on the status line and on the change card. A
 * failure after the apply left the new sections in place, so it must not say
 * they are unchanged.
 */
export const CUTOVER_FAILURE_KEYS = {
  failed: { status: 'settings.cutoverFailed', card: 'whatsNew.v040.recutFailed' },
  failed_after_apply: {
    status: 'settings.cutoverFailedAfterApply',
    card: 'whatsNew.v040.recutFailedAfterApply',
  },
} as const satisfies Partial<Record<CutoverPhase, { status: string; card: string }>>;
