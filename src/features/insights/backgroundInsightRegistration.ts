import * as TaskManager from 'expo-task-manager';

export const BACKGROUND_INSIGHT_TASK = 'veloq-background-insight';

TaskManager.defineTask(BACKGROUND_INSIGHT_TASK, async (body) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Jest and Metro load the handler only when the task fires.
  const task = require('./backgroundInsightTask') as typeof import('./backgroundInsightTask');
  await task.handleBackgroundInsightTask(body);
});
