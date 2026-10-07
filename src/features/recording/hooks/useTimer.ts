import { useSyncExternalStore } from 'react';

import { movingMsAt, useRecordingStore } from '@/features/recording/stores/RecordingStore';

function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;

  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');

  if (hours > 0) {
    const hh = String(hours).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  return `${mm}:${ss}`;
}

const TICK_MS = 1000;

const listeners = new Set<() => void>();
let ticker: ReturnType<typeof setInterval> | null = null;
let tickedAt = Date.now();

function advance(): void {
  tickedAt = Date.now();
  listeners.forEach((notify) => notify());
}

function subscribeToClock(notify: () => void): () => void {
  if (listeners.size === 0) {
    // The cached reading is as old as the last time anyone listened.
    tickedAt = Date.now();
    ticker = setInterval(advance, TICK_MS);
  }
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
    if (listeners.size === 0 && ticker) {
      clearInterval(ticker);
      ticker = null;
    }
  };
}

function subscribeToNothing(): () => void {
  return () => {};
}

function clockReading(): number {
  // With nobody listening, nothing refreshes the cached reading, so a render
  // that mounts the first reader must not start from one that is hours old.
  if (listeners.size === 0 && Date.now() - tickedAt >= TICK_MS) tickedAt = Date.now();
  return tickedAt;
}

function noReading(): number {
  return 0;
}

/**
 * The one-second clock the live recording readers share. A single interval
 * runs while any reader is enabled, so every reader's re-render lands in the
 * same commit. A disabled reader subscribes to nothing and reads 0.
 */
export function useClock(enabled: boolean = true): number {
  return useSyncExternalStore(
    enabled ? subscribeToClock : subscribeToNothing,
    enabled ? clockReading : noReading
  );
}

export function useTimer(): {
  elapsedTime: number;
  movingTime: number;
  formattedElapsed: string;
  formattedMoving: string;
} {
  const status = useRecordingStore((s) => s.status);
  const startTime = useRecordingStore((s) => s.startTime);
  const stopTime = useRecordingStore((s) => s.stopTime);
  const pausedDuration = useRecordingStore((s) => s.pausedDuration);
  const pauseStart = useRecordingStore((s) => s._pauseStart);

  // The clock only schedules the re-render; the reading itself is taken at render.
  useClock(status === 'recording');

  if (status === 'idle' || !startTime) {
    return {
      elapsedTime: 0,
      movingTime: 0,
      formattedElapsed: '00:00',
      formattedMoving: '00:00',
    };
  }

  // A stopped ride shows the times it finished on.
  const now = status === 'stopped' ? (stopTime ?? Date.now()) : Date.now();
  const elapsedMs = now - startTime;
  const elapsedTime = Math.max(0, Math.floor(elapsedMs / 1000));

  const movingTime = Math.floor(
    movingMsAt({ status, startTime, stopTime, pausedDuration, _pauseStart: pauseStart }, now) / 1000
  );

  return {
    elapsedTime,
    movingTime,
    formattedElapsed: formatTime(elapsedTime),
    formattedMoving: formatTime(movingTime),
  };
}
