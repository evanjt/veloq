/**
 * Scenario: a screen holds the system back control while it is in a state back must not leave,
 * under a real stack navigator. Android's back key and edge gesture reach the stack as a go-back
 * action, which `router.back()` dispatches the same way.
 *
 * Expected behaviour: while held, back keeps the screen mounted and calls the handler, and a
 * navigation the app makes itself (returning to the root, replacing the screen) still goes
 * through. Released, back pops the screen as usual.
 */

import React from 'react';
import { Text } from 'react-native';
import { act } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { router, Stack } from 'expo-router';

import { useBackIntercept } from '@/shared/app/useBackIntercept';

jest.unmock('expo-router');
jest.unmock('expo-router/react-navigation');

let mockHeld = true;
const onBack = jest.fn();

let app: ReturnType<typeof renderRouter>;

function HeldScreen() {
  useBackIntercept(mockHeld, onBack);
  return <Text>held</Text>;
}

function stackPaths(): string[] {
  const root = app.getRouterState()?.routes[0]?.state;
  return (root?.routes ?? []).map((route: { name: string }) => route.name);
}

async function renderHeldOverHome() {
  app = renderRouter(
    {
      _layout: () => <Stack />,
      index: () => <Text>home</Text>,
      held: HeldScreen,
      other: () => <Text>other</Text>,
    },
    { initialUrl: '/' }
  );
  await act(() => router.push('/held'));
  expect(app.getPathname()).toBe('/held');
}

beforeEach(() => {
  mockHeld = true;
  onBack.mockClear();
});

it('keeps a held screen mounted on back and calls the handler', async () => {
  await renderHeldOverHome();

  await act(() => router.back());

  expect(app.getPathname()).toBe('/held');
  expect(onBack).toHaveBeenCalledTimes(1);
});

it('holds a second back as well as the first', async () => {
  await renderHeldOverHome();

  await act(() => router.back());
  await act(() => router.back());

  expect(app.getPathname()).toBe('/held');
  expect(onBack).toHaveBeenCalledTimes(2);
});

it('lets a return to the root through while held', async () => {
  await renderHeldOverHome();

  await act(() => router.dismissTo('/'));

  expect(app.getPathname()).toBe('/');
  expect(stackPaths()).toEqual(['index']);
  expect(onBack).not.toHaveBeenCalled();
});

it('lets a replace through while held', async () => {
  await renderHeldOverHome();

  await act(() => router.replace('/other'));

  expect(app.getPathname()).toBe('/other');
  expect(onBack).not.toHaveBeenCalled();
});

it('pops on back once released', async () => {
  mockHeld = false;
  await renderHeldOverHome();

  await act(() => router.back());

  expect(app.getPathname()).toBe('/');
  expect(onBack).not.toHaveBeenCalled();
});
