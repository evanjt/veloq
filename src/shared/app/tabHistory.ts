/**
 * Back across the tabs.
 *
 * A tab chosen on the tab bar goes back to the Feed, the tab group's first route. A link inside a
 * screen that opens another tab's own screen (an insight opening Fitness on the window it
 * compared) reaches the tab group as a push rather than a navigate, and back from it returns to
 * the tab the link was followed from. The push keeps the history it found and adds the tab it
 * opened; the next tab chosen on the bar rebuilds the history from the Feed.
 */
import {
  isActionHandled,
  type NavigationAction,
  type ParamListBase,
  type Router,
  type TabNavigationState,
} from 'expo-router/react-navigation';

type TabState = TabNavigationState<ParamListBase>;
type TabHistory = NonNullable<TabState['history']>;

/** The history a link into another tab leaves: what was there, then the tab it opened. */
export function historyAfterLink(
  before: TabHistory | undefined,
  openedKey: string
): TabHistory | undefined {
  if (!before || before.length === 0) return undefined;
  return [...before.filter((item) => item.key !== openedKey), { type: 'route', key: openedKey }];
}

/** The tab group's router, with a link's push into another tab kept in its back history. */
export function linkReturnsToItsTab<Action extends NavigationAction>(
  original: Router<TabState, Action>
): Partial<Router<TabState, Action>> {
  return {
    getStateForAction(state, action, options) {
      const result = original.getStateForAction(state, action, options);
      if (action.type !== 'PUSH' || !isActionHandled(result)) return result;
      const opened = result.state.routes[result.state.index]?.key;
      if (!opened || opened === state.routes[state.index]?.key) return result;
      const history = historyAfterLink(state.history, opened);
      return history ? { ...result, state: { ...result.state, history } } : result;
    },
  };
}
