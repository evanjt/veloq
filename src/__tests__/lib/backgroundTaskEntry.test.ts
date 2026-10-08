import * as TaskManager from 'expo-task-manager';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

jest.mock('expo-router/entry', () => {
  const defineTask = require('expo-task-manager').defineTask as jest.Mock;
  expect(defineTask).toHaveBeenCalledWith('veloq-background-location', expect.any(Function));
  expect(defineTask).toHaveBeenCalledWith('veloq-background-insight', expect.any(Function));
  return {};
});
jest.mock('expo-task-manager', () => ({
  ...jest.requireActual('expo-task-manager'),
  defineTask: jest.fn(),
}));
jest.mock('@/features/recording/lib/backgroundLocation', () => {
  throw new Error('Recording handler loaded during task definition');
});
jest.mock('@/features/insights/backgroundInsightTask', () => {
  throw new Error('Insight handler loaded during task definition');
});

describe('headless app entry', () => {
  it('defines both background tasks before a route renders', () => {
    const { main } = require('../../../package.json') as { main: string };
    const localEntry = resolve(__dirname, '../../..', main);
    require(existsSync(localEntry) ? localEntry : main);

    const defineTask = TaskManager.defineTask as jest.MockedFunction<typeof TaskManager.defineTask>;
    expect(defineTask).toHaveBeenCalledWith('veloq-background-location', expect.any(Function));
    expect(defineTask).toHaveBeenCalledWith('veloq-background-insight', expect.any(Function));
  });
});
