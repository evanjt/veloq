import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PlaceNameOutcome, type PlaceNameKind } from 'veloqrs';
import { nameFromPlaces } from '../lib/nameCommands';

/**
 * Ask the engine to name one route or section from its places.
 *
 * One lookup at a time per item: a second press while one waits its turn does
 * nothing. A name kept arrives through the detail read, which the engine's
 * announcement refreshes, so the screen shows it from the read. A lookup that
 * gives no name says so, and the item keeps what it showed.
 */
export function usePlaceNameLookup(kind: PlaceNameKind, itemId: string) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const request = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    let outcome: PlaceNameOutcome;
    try {
      outcome = await nameFromPlaces(kind, itemId);
    } catch {
      outcome = PlaceNameOutcome.Failed;
    } finally {
      inFlight.current = false;
      if (mounted.current) setPending(false);
    }
    if (outcome === PlaceNameOutcome.Named || !mounted.current) return;
    Alert.alert(
      t('routes.placeNameFailedTitle'),
      t(
        outcome === PlaceNameOutcome.NoPlace
          ? 'routes.placeNameNoPlaceMessage'
          : 'routes.placeNameFailedMessage'
      )
    );
  }, [kind, itemId, t]);

  return { pending, request };
}
