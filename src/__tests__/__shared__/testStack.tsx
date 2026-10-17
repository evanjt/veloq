import { useEffect, type ComponentType, type ReactElement } from 'react';
import type { NavigationContainerRef, ParamListBase } from 'expo-router/react-navigation';
import { inMemoryContext } from 'expo-router/build/testing-library/context-stubs';

// Suites stub the router's exports for the screens they render; the stack itself is the real one.
const router = jest.requireActual<typeof import('expo-router')>('expo-router');

type ContainerRef = { current: NavigationContainerRef<ParamListBase> | null };

/**
 * The element to render and the container's ref, with `screens` as the routes of the router's
 * own stack whose first entry is the root. The stack keeps every route in it mounted, the ones
 * beneath the top included, so a screen under it sees `goBack()` and a held removal exactly as
 * it does in the app. Push the screen under test with `ref.current?.navigate(name)`.
 */
export function testStack(screens: Record<string, ComponentType>) {
  const ref: ContainerRef = { current: null };
  const names = Object.keys(screens);

  function Layout() {
    const container = router.useNavigationContainerRef();
    useEffect(() => {
      ref.current = container as NavigationContainerRef<ParamListBase>;
    }, [container]);
    return <router.Stack screenOptions={{ headerShown: false, animation: 'none' }} />;
  }

  // Routes load as the app's do in a test, all at once rather than on first visit.
  process.env.EXPO_ROUTER_IMPORT_MODE = 'sync';
  const context = inMemoryContext({
    _layout: Layout,
    ...(Object.fromEntries(names.map((name) => [name, screens[name]])) as Record<
      string,
      () => ReactElement | null
    >),
  });
  const element = <router.ExpoRoot context={context} location={`/${names[0]}`} />;
  return { element, ref };
}

/** The names of the routes in the stack `ref` holds, bottom first. */
export function stackRouteNames(ref: ContainerRef): string[] {
  // The router seats the app's stack under a root route of its own.
  const stack = ref.current?.getRootState().routes[0]?.state;
  return (stack?.routes ?? []).map((route) => route.name);
}

/** `element` as the one screen of a stack, for a screen that reads its navigation. */
export function inStack(element: ReactElement) {
  return testStack({ screen: () => element }).element;
}
