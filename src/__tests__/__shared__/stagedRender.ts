import type React from 'react';
import { act, render } from '@testing-library/react-native';

/** Lets `frames` animation frames pass, so a staged first visit mounts its later stages. */
export async function passFrames(frames = 1): Promise<void> {
  for (let frame = 0; frame < frames; frame++) {
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
  }
}

/** Renders a screen that stages its first visit, and lets the stages after the first mount. */
export async function renderStaged(
  ui: React.ReactElement,
  frames = 1
): Promise<Awaited<ReturnType<typeof render>>> {
  const view = await render(ui);
  await passFrames(frames);
  return view;
}
