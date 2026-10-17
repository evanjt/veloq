/**
 * Scenario: a flow pushes several screens (an entry screen, a live screen, a review) and then
 * ends. Replacing only the top screen leaves the rest beneath the destination, so back from the
 * feed re-enters them.
 *
 * Expected behaviour: `replaceTo` takes the place of the screen it is called from, and
 * `returnTo` pops the stack back to its destination when the destination is in history and
 * replaces the current screen with it when it is not.
 */

import React from 'react';
import { Text } from 'react-native';
import { act } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { router, Stack } from 'expo-router';

import { replaceTo, returnTo } from '@/shared/app/navigation';

jest.unmock('expo-router');

let app: Awaited<ReturnType<typeof renderRouter>>;

function stackNames(): string[] {
  const root = app.getRouterState()?.routes[0]?.state;
  return (root?.routes ?? []).map((route: { name: string }) => route.name);
}

async function renderFlow(initialUrl = '/') {
  app = await renderRouter(
    {
      _layout: () => <Stack />,
      index: () => <Text>feed</Text>,
      'launch/index': () => <Text>launch</Text>,
      'launch/[kind]': () => <Text>live</Text>,
      'launch/summary': () => <Text>summary</Text>,
    },
    { initialUrl }
  );
}

it('starts the live screen in place of the entry screen', async () => {
  await renderFlow();
  await act(() => router.push('/launch'));

  await act(() => replaceTo('/launch/kite'));

  expect(app.getPathname()).toBe('/launch/kite');
  expect(stackNames()).toEqual(['index', 'launch/[kind]']);
});

it('returns to the root with nothing the flow pushed left beneath it', async () => {
  await renderFlow();
  await act(() => router.push('/launch'));
  await act(() => router.push('/launch/kite'));
  await act(() => router.push('/launch/summary'));

  await act(() => returnTo('/'));

  expect(app.getPathname()).toBe('/');
  expect(stackNames()).toEqual(['index']);
});

it('replaces the screen with the root when the root is not in history', async () => {
  await renderFlow('/launch/summary');

  await act(() => returnTo('/'));

  expect(app.getPathname()).toBe('/');
  expect(stackNames()).not.toContain('launch/summary');
});
