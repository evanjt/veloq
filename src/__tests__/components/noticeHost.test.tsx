/**
 * Scenario: a change is saved and the app offers Undo in a snackbar, which is the only way back.
 * Expected behaviour: the notice is spoken on both platforms. While a screen reader runs, a notice
 * with an action stays until it is acted on, since the reader cannot reach the button inside a
 * few seconds; otherwise it goes after its duration. A second notice replaces the first.
 */

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { hideNotice, NoticeHost, showNotice } from '@/shared/ui/Notice';

let screenReaderOn = false;
let announce: jest.SpyInstance;

async function advance(ms: number) {
  await act(() => jest.advanceTimersByTime(ms));
}

// The snackbar fades out over a further animation once its time is up.
async function finishHiding() {
  await advance(300);
}

async function mountHost() {
  await render(<NoticeHost />);
  // Lets the screen reader query resolve before a notice is shown.
  await act(async () => {});
}

async function show(args: Parameters<typeof showNotice>[0]) {
  let id = 0;
  await act(() => {
    id = showNotice(args);
  });
  return id;
}

describe('the app notice', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    screenReaderOn = false;
    jest
      .spyOn(AccessibilityInfo, 'isScreenReaderEnabled')
      .mockImplementation(() => Promise.resolve(screenReaderOn));
    announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation();
  });

  afterEach(async () => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('holds a notice with an action open while a screen reader runs', async () => {
    screenReaderOn = true;
    const undo = jest.fn();
    await mountHost();

    await show({
      message: 'Angle saved',
      action: { label: 'Undo', onPress: undo },
      duration: 4000,
    });
    await advance(5000);
    await finishHiding();

    expect(screen.getByText('Angle saved')).toBeTruthy();
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Angle saved');

    await fireEvent.press(screen.getByText('Undo'));
    expect(undo).toHaveBeenCalledTimes(1);
    await finishHiding();
    expect(screen.queryByText('Angle saved')).toBeNull();
  });

  it('lets a notice with an action go after its duration without a screen reader', async () => {
    await mountHost();

    await show({
      message: 'Angle saved',
      action: { label: 'Undo', onPress: jest.fn() },
      duration: 4000,
    });
    await advance(3900);
    expect(screen.getByText('Angle saved')).toBeTruthy();

    await advance(100);
    await finishHiding();
    expect(screen.queryByText('Angle saved')).toBeNull();
    expect(announce).toHaveBeenCalledWith('Angle saved');
  });

  it('lets a notice with no action go after its duration under a screen reader', async () => {
    screenReaderOn = true;
    await mountHost();

    await show({ message: 'Cache cleared', duration: 3000 });
    await advance(3000);
    await finishHiding();

    expect(screen.queryByText('Cache cleared')).toBeNull();
  });

  it('replaces the notice on screen and restarts the time', async () => {
    await mountHost();

    await show({ message: 'First', duration: 3000 });
    await advance(2000);
    await show({ message: 'Second', duration: 3000 });
    await advance(2000);

    expect(screen.queryByText('First')).toBeNull();
    expect(screen.getAllByTestId('notice-snackbar')).toHaveLength(1);
    expect(screen.getByText('Second')).toBeTruthy();

    await advance(1000);
    await finishHiding();
    expect(screen.queryByText('Second')).toBeNull();
  });

  it('keeps a later notice when an earlier one is hidden by id', async () => {
    await mountHost();

    const first = await show({ message: 'First', duration: 3000 });
    await show({ message: 'Second', duration: 3000 });
    await act(() => hideNotice(first));

    expect(screen.getByText('Second')).toBeTruthy();
  });
});
