/**
 * Scenario: the support card's first showing waits for the athlete to have used
 * the app on several distinct days and for a minimum time since the first use.
 * Expected behaviour: launches are counted once per local day, and a row stored
 * before the use count existed starts its count from today.
 */

import { useSupportStore } from '@/shared/app/SupportStore';
import { formatLocalDate } from '@/shared/format/format';

const mockRows = new Map<string, string>();

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async (key: string) => mockRows.get(key) ?? null),
  setSetting: jest.fn(async (key: string, value: string) => {
    mockRows.set(key, value);
  }),
}));

const STORAGE_KEY = 'veloq-support-store';
const FIRST_DAY = new Date(2026, 2, 2, 12, 0, 0);

function atDay(day: number, hour = 12): Date {
  const d = new Date(FIRST_DAY);
  d.setDate(d.getDate() + day);
  d.setHours(hour);
  return d;
}

async function launchOn(day: number, hour = 12): Promise<void> {
  jest.setSystemTime(atDay(day, hour));
  useSupportStore.setState({ isLoaded: false });
  await useSupportStore.getState().initialise();
  // persist() writes without awaiting; let it settle before the next launch reads.
  await Promise.resolve();
}

function shows(): boolean {
  return useSupportStore.getState().shouldShow();
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  mockRows.clear();
  useSupportStore.setState({
    lastActionDate: null,
    permanentlyDismissed: false,
    isLegacyPurchaser: false,
    dismissCount: 0,
    isLoaded: false,
  });
});

afterEach(() => {
  jest.useRealTimers();
});

it('does not show on a fresh install launched every day for 13 days', async () => {
  for (let day = 0; day < 13; day++) {
    await launchOn(day);
    expect(shows()).toBe(false);
  }
});

it('shows on the 14th day after five distinct days of use', async () => {
  for (const day of [0, 2, 5, 9]) {
    await launchOn(day);
    expect(shows()).toBe(false);
  }
  await launchOn(13);
  expect(shows()).toBe(false);
  await launchOn(14);
  expect(shows()).toBe(true);
});

it('does not show when the app was opened once and left for 30 days', async () => {
  await launchOn(0);
  await launchOn(30);
  expect(shows()).toBe(false);
});

it('counts ten launches on one day as one use', async () => {
  for (let i = 0; i < 10; i++) {
    await launchOn(0, 8 + i);
  }
  for (const day of [3, 6, 9]) {
    await launchOn(day);
  }
  await launchOn(20);
  expect(shows()).toBe(true);
  useSupportStore.setState({ isLoaded: false });
  mockRows.clear();
  for (let i = 0; i < 10; i++) {
    await launchOn(0, 8 + i);
  }
  for (const day of [3, 6]) {
    await launchOn(day);
  }
  await launchOn(20);
  expect(shows()).toBe(false);
});

it('starts the count from today for a row stored before the count existed', async () => {
  jest.setSystemTime(atDay(20));
  mockRows.set(
    STORAGE_KEY,
    JSON.stringify({
      lastActionDate: formatLocalDate(atDay(0)),
      permanentlyDismissed: false,
      isLegacyPurchaser: false,
      dismissCount: 0,
    })
  );
  await launchOn(20);
  expect(shows()).toBe(false);
  for (const day of [21, 22, 23]) {
    await launchOn(day);
  }
  await launchOn(34);
  expect(shows()).toBe(true);
});

it('keeps the 30-day interval after a remind-later once the card has shown', async () => {
  for (const day of [0, 1, 2, 3, 14]) {
    await launchOn(day);
  }
  expect(shows()).toBe(true);
  useSupportStore.getState().remindLater();
  expect(shows()).toBe(false);
  await launchOn(43);
  expect(shows()).toBe(false);
  await launchOn(44);
  expect(shows()).toBe(true);
});

it('counts nothing new when initialised twice on the same day', async () => {
  for (const day of [0, 1, 2, 3]) {
    await launchOn(day);
  }
  await launchOn(14);
  await launchOn(14);
  const stored = JSON.parse(mockRows.get(STORAGE_KEY) ?? '{}');
  expect(stored.useDays).toBe(5);
  expect(stored.firstUseDate).toBe(formatLocalDate(atDay(0)));
});
