import { formatLocalDate } from '@/lib';
import type { CalendarEvent } from '@/types';

/**
 * Generate demo calendar events relative to the current date.
 * Returns planned workouts for today and tomorrow.
 */
export function getDemoCalendarEvents(): CalendarEvent[] {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const fmt = (d: Date): string => formatLocalDate(d);

  return [
    {
      id: 90001,
      name: '3x8min Sweet Spot',
      start_date_local: `${fmt(today)}T00:00:00`,
      category: 'WORKOUT',
      type: 'Ride',
      description: '3x8min @88-93% FTP with 4min recovery',
      moving_time: 4500,
      icu_training_load: 75,
      target: 'POWER',
      workout_doc: {
        steps: [
          { text: 'Warm up', duration: 600, warmup: true, _power: { value: 150 } },
          {
            reps: 3,
            steps: [
              { text: 'Sweet Spot', duration: 480, _power: { start: 245, end: 260 } },
              { text: 'Recovery', duration: 240, _power: { value: 120 } },
            ],
          },
          { text: 'Cool down', duration: 600, cooldown: true, _power: { value: 130 } },
        ],
        duration: 4500,
        target: 'W',
        ftp: 280,
      },
    },
    {
      id: 90002,
      name: 'Easy Recovery Run',
      start_date_local: `${fmt(tomorrow)}T00:00:00`,
      category: 'WORKOUT',
      type: 'Run',
      description: '45min easy Z2',
      moving_time: 2700,
      icu_training_load: 35,
      target: 'HR',
      workout_doc: {
        steps: [
          { text: 'Warm up', duration: 300, warmup: true },
          { text: 'Easy Z2', duration: 2100, hr: { start: 130, end: 145 } },
          { text: 'Cool down', duration: 300, cooldown: true },
        ],
        duration: 2700,
        target: 'H',
        lthr: 165,
      },
    },
  ];
}
