/**
 * Keeps the track notice in step with the engine's given-up list.
 *
 * The list changes when the engine gives up on a track, which it does as a
 * download ends, and when a track lands or the library is wiped. The engine
 * announces the second kind on `activities`; the first is seen as the track
 * stage leaving the download step.
 */

import { useEffect, useRef } from 'react';

import { FfiTrackStep } from 'veloqrs';

import { useEngineSubscription } from '@/shared/native/useEngineSubscription';
import { useTrackStage } from '@/shared/native/useSyncStatus';
import { refreshTrackFetchNotice } from '../lib/trackFetchNotice';

export function useTrackFetchNoticeRefresh(): void {
  const announced = useEngineSubscription(['activities']);
  const stage = useTrackStage();
  const downloading = stage?.step === FfiTrackStep.Downloading;
  const wasDownloading = useRef(downloading);

  useEffect(() => {
    const ended = wasDownloading.current && !downloading;
    wasDownloading.current = downloading;
    if (ended) refreshTrackFetchNotice();
  }, [downloading]);

  useEffect(() => {
    refreshTrackFetchNotice();
  }, [announced]);
}
