import { useCallback, useEffect, useState } from 'react';

import { useAthlete } from '@/shared/app/useAthlete';
import { useHeldBackInLastDownload } from '@/shared/native/useSyncStatus';

import { afterGarminOfferDeclined, garminOffer, type GarminOffer } from '../lib/garminOffer';
import {
  isGarminConnected,
  readGarminOfferDeclinedAt,
  saveGarminOfferDeclinedAt,
} from '../lib/garminConnector';
import { useSessionAsk } from './useLaunchSurfaces';

/** Whether the athlete's intervals.icu uses Garmin, from the athlete record. */
export function useUsesGarmin(): boolean {
  const { data: athlete } = useAthlete();
  return athlete?.garminSyncsActivities === true;
}

/** The feed offer to connect Garmin, and whether it holds the session's one ask. */
export function useGarminOffer(): {
  offer: GarminOffer | null;
  holdsAsk: boolean;
  decline: () => void;
} {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [declinedAt, setDeclinedAt] = useState<number | null | undefined>(undefined);
  const heldBack = useHeldBackInLastDownload();

  useEffect(() => {
    let live = true;
    void (async () => {
      const [kept, declined] = await Promise.all([
        isGarminConnected(),
        readGarminOfferDeclinedAt(),
      ]);
      if (!live) return;
      setConnected(kept);
      setDeclinedAt(declined);
    })();
    return () => {
      live = false;
    };
  }, []);

  const offer = declinedAt === undefined ? null : garminOffer({ connected, heldBack, declinedAt });
  const holdsAsk = useSessionAsk('garmin', offer !== null);

  const decline = useCallback(() => {
    const next = afterGarminOfferDeclined(heldBack, declinedAt ?? null);
    setDeclinedAt(next);
    void saveGarminOfferDeclinedAt(next);
  }, [heldBack, declinedAt]);

  return { offer, holdsAsk, decline };
}
