import { Fragment, createRef, type ComponentType, type ReactElement, type ReactNode } from 'react';
import {
  BaseNavigationContainer,
  StackRouter,
  createNavigatorFactory,
  useNavigationBuilder,
  type NavigationAction,
  type NavigationContainerRef,
  type ParamListBase,
  type RouterFactory,
  type StackNavigationState,
  type StackRouterOptions,
} from 'expo-router/react-navigation';

// The router's own action union does not meet the builder's generic action
// under exact optional property types; the router accepts every action.
const stackRouter = StackRouter as unknown as RouterFactory<
  StackNavigationState<ParamListBase>,
  NavigationAction,
  StackRouterOptions
>;

/**
 * A stack navigator with the real router and its prevent-remove handling, and
 * no native views. Like the app's native stack it keeps every route in the
 * stack mounted, the ones beneath the top included, so a screen under it sees
 * `goBack()` and `beforeRemove` exactly as it does under the app's stack.
 */
function TestNavigator({
  children,
  initialRouteName,
}: {
  children: ReactNode;
  initialRouteName?: string;
}) {
  const { state, descriptors, NavigationContent } = useNavigationBuilder(stackRouter, {
    children,
    ...(initialRouteName ? { initialRouteName } : {}),
  });
  return (
    <NavigationContent>
      {state.routes.map((route) => (
        <Fragment key={route.key}>{descriptors[route.key]?.render()}</Fragment>
      ))}
    </NavigationContent>
  );
}

const Stack = createNavigatorFactory(TestNavigator)();

/**
 * The element to render and the container's ref, with `screens` in a stack
 * whose first entry is the root. Push the screen under test with
 * `ref.current?.navigate(name)`.
 */
export function testStack(screens: Record<string, ComponentType>) {
  const ref = createRef<NavigationContainerRef<ParamListBase>>();
  const names = Object.keys(screens);
  const element = (
    <BaseNavigationContainer ref={ref}>
      <Stack.Navigator initialRouteName={names[0]}>
        {names.map((name) => (
          <Stack.Screen key={name} name={name} component={screens[name] as ComponentType} />
        ))}
      </Stack.Navigator>
    </BaseNavigationContainer>
  );
  return { element, ref };
}

/** `element` as the one screen of a stack, for a screen that reads its navigation. */
export function inStack(element: ReactElement) {
  return testStack({ screen: () => element }).element;
}
