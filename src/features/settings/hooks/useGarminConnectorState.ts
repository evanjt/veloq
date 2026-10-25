import { useEffect, useState } from 'react';

import {
  onGarminConnectorChange,
  readGarminConnectorState,
  type GarminConnectorState,
} from '../lib/garminConnector';

/**
 * The Garmin connector's state, read on mount and again whenever the key is
 * connected or disconnected in this process. The connector screen is pushed
 * over the rows that show the state, so the change is announced rather than
 * waited for on focus. Null until the first read lands.
 */
export function useGarminConnectorState(): GarminConnectorState | null {
  const [state, setState] = useState<GarminConnectorState | null>(null);

  useEffect(() => {
    let live = true;
    const read = () => {
      readGarminConnectorState()
        .then((next) => {
          if (live) setState(next);
        })
        .catch(() => {});
    };
    read();
    const stop = onGarminConnectorChange(read);
    return () => {
      live = false;
      stop();
    };
  }, []);

  return state;
}
