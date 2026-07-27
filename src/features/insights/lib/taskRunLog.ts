import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Ring buffer of background-notification task runs, surfaced on the debug
 * screen. Diagnostics only, so the key is deliberately NOT in PREFERENCE_KEYS
 * (not a user preference, no backup/restore).
 */

const TASK_RUN_LOG_KEY = 'veloq-insight-task-runs';
const MAX_ENTRIES = 20;

export type TaskRunStage =
  | 'fired'
  | 'parsed'
  | 'bailed'
  | 'ingested'
  | 'indexed'
  | 'notified'
  | 'error';

export interface TaskRunEntry {
  ts: number;
  stage: TaskRunStage;
  eventType?: string;
  activityId?: string;
  sourceShape?: string;
  detail?: string;
}

export async function readTaskRuns(): Promise<TaskRunEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(TASK_RUN_LOG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is TaskRunEntry =>
        !!e && typeof e === 'object' && typeof e.ts === 'number' && typeof e.stage === 'string'
    );
  } catch {
    return [];
  }
}

export async function appendTaskRun(entry: Omit<TaskRunEntry, 'ts'>): Promise<void> {
  try {
    const existing = await readTaskRuns();
    const next = [...existing, { ...entry, ts: Date.now() }].slice(-MAX_ENTRIES);
    await AsyncStorage.setItem(TASK_RUN_LOG_KEY, JSON.stringify(next));
  } catch {
    // Diagnostics must never break the task.
  }
}

export async function clearTaskRuns(): Promise<void> {
  try {
    await AsyncStorage.removeItem(TASK_RUN_LOG_KEY);
  } catch {
    // Best-effort.
  }
}
