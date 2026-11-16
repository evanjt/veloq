// A calendar heatmap: one block of week columns per year, Monday on the top row,
// a month label over each month's first week and a shade per day for its
// intensity bracket. A pointer or the arrow keys read a day out and Enter or a
// click picks it.

import { useRef, useState, type KeyboardEvent } from 'react';

import {
  CALENDAR_GAP as GAP,
  CALENDAR_WEEKDAY_ROOM as WEEKDAY_ROOM,
  TEXT_PX,
  calendarCellSize,
  calendarLayout,
  fitText,
} from './scale';
import { useMeasure, useWidth } from './useSize';

export type CalendarDay = { date: string; intensity: number };

export type CalendarProps = {
  days: readonly CalendarDay[];
  /** The readout's text for a day. */
  dayText: (date: string) => string;
  /** Called with a day's date when it is clicked or chosen with Enter. */
  onPick?: (date: string) => void;
  label: string;
  empty: string;
  locale?: string;
  /** Draws at this width rather than measuring one; for a drawing made without a browser. */
  width?: number;
};

const WEEKDAYS = [0, 2, 4];

type Block = { year: string; days: CalendarDay[] };

/** Days grouped by calendar year, newest first, each in date order. */
function blocks(days: readonly CalendarDay[]): Block[] {
  const byYear = new Map<string, CalendarDay[]>();
  for (const day of days) {
    const year = day.date.slice(0, 4);
    byYear.set(year, [...(byYear.get(year) ?? []), day]);
  }
  return [...byYear.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([year, held]) => ({ year, days: [...held].sort((a, b) => (a.date < b.date ? -1 : 1)) }));
}

const addDays = (date: string, n: number) =>
  new Date(Date.parse(date) + n * 86_400_000).toISOString().slice(0, 10);

export function Calendar(props: CalendarProps) {
  const ref = useRef<HTMLElement>(null);
  const width = useWidth(ref, props.width);
  const measure = useMeasure(ref);
  const [at, setAt] = useState<string | null>(null);
  const held = new Set(props.days.map((day) => day.date));
  if (props.days.length === 0) return <p className="empty">{props.empty}</p>;

  const key = (event: KeyboardEvent<SVGSVGElement>) => {
    const step: Record<string, number> = {
      ArrowLeft: -7,
      ArrowRight: 7,
      ArrowUp: -1,
      ArrowDown: 1,
    };
    if (event.key === 'Escape') setAt(null);
    if (event.key === 'Enter' && at) props.onPick?.(at);
    const n = step[event.key];
    if (n === undefined) return;
    event.preventDefault();
    const from = at ?? props.days[props.days.length - 1]?.date ?? '';
    const next = addDays(from, n);
    if (held.has(next)) setAt(next);
  };
  const month = new Intl.DateTimeFormat(props.locale ?? 'en-GB', {
    month: 'short',
    timeZone: 'UTC',
  });
  const weekday = new Intl.DateTimeFormat(props.locale ?? 'en-GB', {
    weekday: 'short',
    timeZone: 'UTC',
  });

  const years = blocks(props.days).map((block) => {
    const cells = calendarLayout(block.days.map((day) => day.date));
    return { block, cells, columns: Math.max(...cells.map((c) => c.column)) + 1 };
  });
  const size = calendarCellSize(
    width,
    years.map((year) => year.columns)
  );

  return (
    <figure className="chart calendar" ref={ref}>
      {years.map(({ block, cells, columns }) => {
        const pitch = size + GAP;
        const top = TEXT_PX * 2 + 4;
        const drawingWidth = WEEKDAY_ROOM + columns * pitch;
        const intensity = new Map(block.days.map((day) => [day.date, day.intensity]));
        let lastMonth = -1;
        return (
          <svg
            key={block.year}
            width={drawingWidth}
            height={top + 7 * pitch}
            viewBox={`0 0 ${drawingWidth} ${top + 7 * pitch}`}
            fontSize={TEXT_PX}
            role="group"
            aria-label={`${props.label} ${block.year}`}
            tabIndex={0}
            onKeyDown={key}
            onPointerLeave={() => setAt(null)}
          >
            <g className="axis">
              <text className="title" x={0} y={TEXT_PX} textAnchor="start">
                {block.year}
              </text>
              {cells.map((cell) => {
                const m = new Date(Date.parse(cell.date)).getUTCMonth();
                if (cell.row !== 0 && lastMonth !== -1) return null;
                if (m === lastMonth) return null;
                lastMonth = m;
                return (
                  <text
                    key={cell.date}
                    x={WEEKDAY_ROOM + cell.column * pitch}
                    y={top - 6}
                    textAnchor="start"
                  >
                    {fitText(month.format(Date.parse(cell.date)), drawingWidth, measure)}
                  </text>
                );
              })}
              {WEEKDAYS.map((row) => (
                <text key={row} x={0} y={top + row * pitch + size - 1} textAnchor="start">
                  {weekday.format(Date.UTC(2024, 0, 1 + row))}
                </text>
              ))}
            </g>
            {cells.map((cell) => (
              <rect
                key={cell.date}
                className={`day level-${Math.min(4, Math.max(0, intensity.get(cell.date) ?? 0))}${cell.date === at ? ' active' : ''}`}
                x={WEEKDAY_ROOM + cell.column * pitch}
                y={top + cell.row * pitch}
                width={size}
                height={size}
                onPointerEnter={() => setAt(cell.date)}
                onClick={() => props.onPick?.(cell.date)}
              />
            ))}
          </svg>
        );
      })}
      <p className="readout" aria-live="polite">
        {at ? props.dayText(at) : ' '}
      </p>
    </figure>
  );
}
