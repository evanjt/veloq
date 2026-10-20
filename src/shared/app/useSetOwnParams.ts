/**
 * Set the params of the screen this is called from.
 *
 * A link param a screen takes once is cleared so the same link moves the
 * screen again later. `router.setParams` goes to whichever navigator holds
 * focus when it runs, and a tab root mounted by a link from another tab is
 * not yet that navigator, so its params kept the link and the same link a
 * second time changed nothing. The screen's own navigation names its route,
 * so the clear lands there wherever focus sits. Outside a navigator there is
 * no route to name, and the global router is the one left.
 */

import { use, useCallback } from 'react';
import { router } from 'expo-router';
import { NavigationContext } from 'expo-router/react-navigation';

type Params = Record<string, string | undefined>;

export function useSetOwnParams(): (params: Params) => void {
  const navigation = use(NavigationContext);
  return useCallback(
    (params: Params) => {
      if (navigation) navigation.setParams(params as never);
      else router.setParams(params);
    },
    [navigation]
  );
}
