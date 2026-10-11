import { useCallback, useEffect, useRef, useState } from 'react';

import { REVIEW_BACKUP_DEBOUNCE_MS } from '../lib/constants';
import { writeReviewedRideBackup } from '../lib/rideBackup';
import { useRecordingStore } from '../stores/RecordingStore';
import type { ReviewDraft } from '../types';

export interface UseReviewDraft {
  /** The edits the ride carried when review opened, its trim only if it still fits the ride. */
  initial: ReviewDraft;
  /** Record an edit. */
  edit: (edit: ReviewDraft) => void;
}

/**
 * The review screen's edits of a stopped ride. Each one goes to the recording
 * store, so a sign-out holding the ride carries it at once, and to the ride's
 * backup a moment after the last edit, so a kill on review keeps it too. Opening
 * review writes nothing: the stop already wrote the ride.
 */
export function useReviewDraft(pointCount: number): UseReviewDraft {
  const [opened] = useState(() => useRecordingStore.getState().review);
  const [initial] = useState(() => fittedDraft(opened, pointCount));
  const draft = useRecordingStore((s) => s.review);
  const pending = useRef(false);

  useEffect(() => {
    if (!draft || draft === opened) return undefined;
    pending.current = true;
    const timer = setTimeout(() => {
      pending.current = false;
      void writeReviewedRideBackup();
    }, REVIEW_BACKUP_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, opened]);

  // A review left inside the wait still writes its last edit.
  useEffect(
    () => () => {
      if (pending.current) void writeReviewedRideBackup();
    },
    []
  );

  const edit = useCallback((change: ReviewDraft) => {
    useRecordingStore.getState().editReview(change);
  }, []);

  return { initial, edit };
}

function fittedDraft(draft: ReviewDraft | null, pointCount: number): ReviewDraft {
  if (!draft) return {};
  const { trimStart, trimEnd, ...rest } = draft;
  if (trimStart === undefined || trimEnd === undefined) return rest;
  if (trimStart < 0 || trimEnd >= pointCount || trimStart >= trimEnd) return rest;
  return { ...rest, trimStart, trimEnd };
}
