import { useState, useEffect, useRef, useCallback } from 'react';
import { useRecordingStore } from '@/providers/RecordingStore';

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

export function useTimer(): {
  elapsedTime: number;
  movingTime: number;
  lapTime: number;
  formattedElapsed: string;
  formattedMoving: string;
  formattedLap: string;
} {
  const status = useRecordingStore((s) => s.status);
  const startTime = useRecordingStore((s) => s.startTime);
  const pausedDuration = useRecordingStore((s) => s.pausedDuration);
  const laps = useRecordingStore((s) => s.laps);

  const [tick, setTick] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Start/stop interval based on status
  useEffect(() => {
    if (status === 'recording') {
      intervalRef.current = setInterval(() => {
        setTick((t) => t + 1);
      }, 1000);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [status]);

  if (status === 'idle' || status === 'stopped' || !startTime) {
    return {
      elapsedTime: 0,
      movingTime: 0,
      lapTime: 0,
      formattedElapsed: '00:00',
      formattedMoving: '00:00',
      formattedLap: '00:00',
    };
  }

  const now = Date.now();
  const elapsedMs = now - startTime;
  const elapsedTime = Math.max(0, Math.floor(elapsedMs / 1000));

  // Moving time excludes paused duration and any current pause
  const movingTime = Math.max(0, elapsedTime - Math.floor(pausedDuration / 1000));

  // Lap time: seconds since last lap ended
  const lastLap = laps.length > 0 ? laps[laps.length - 1] : null;
  const lapStartSeconds = lastLap ? lastLap.endTime : 0;
  const lapTime = Math.max(0, movingTime - lapStartSeconds);

  return {
    elapsedTime,
    movingTime,
    lapTime,
    formattedElapsed: formatTime(elapsedTime),
    formattedMoving: formatTime(movingTime),
    formattedLap: formatTime(lapTime),
  };
}
