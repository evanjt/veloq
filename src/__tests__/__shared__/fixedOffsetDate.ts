/**
 * Run code as if the device sat at a fixed UTC offset.
 *
 * A Jest worker reads its zone once, at start: assigning `process.env.TZ`
 * inside a suite changes nothing, so a test that does it runs in whatever zone
 * the machine is in and passes on a UTC runner whatever the code does. This
 * swaps the global `Date` for one whose local fields sit `offsetHours` from
 * UTC, which is what a window built from the device clock reads. A fixed
 * offset has no daylight saving, so pick dates away from a changeover.
 *
 * Jest's fake timers do not compose with it: their `Date` constructor returns
 * a native instance, which drops these overrides. Pass `now` instead. The
 * constructor is a plain function for the same reason, since a transpiled
 * `class extends Date` also hands back a native instance.
 */

const RealDate = Date;

/** An ISO date-time with no zone, which `Date` parses as local time. */
const LOCAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

const SETTERS = ['FullYear', 'Month', 'Date', 'Hours', 'Minutes', 'Seconds', 'Milliseconds'];
const GETTERS = [...SETTERS, 'Day'];

type Fields = Record<string, (...values: number[]) => number>;

function zonedDateClass(offsetMs: number, now: number | undefined): DateConstructor {
  const currentTime = () => now ?? RealDate.now();

  function timeOf(args: unknown[]): number {
    if (args.length === 0) return currentTime();
    if (args.length === 1) {
      const [value] = args;
      if (typeof value === 'string' && LOCAL_ISO.test(value)) {
        return RealDate.parse(`${value}Z`) - offsetMs;
      }
      return new RealDate(value as number | string | Date).getTime();
    }
    const [y, m, d = 1, h = 0, mi = 0, s = 0, ms = 0] = args as number[];
    return RealDate.UTC(y, m, d, h, mi, s, ms) - offsetMs;
  }

  const shifted = (date: Date) => new RealDate(date.getTime() + offsetMs);
  const proto = Object.create(RealDate.prototype) as Fields;
  for (const field of GETTERS) {
    proto[`get${field}`] = function (this: Date) {
      return (shifted(this) as unknown as Fields)[`getUTC${field}`]();
    };
  }
  for (const field of SETTERS) {
    proto[`set${field}`] = function (this: Date, ...values: number[]) {
      const moved = shifted(this);
      (moved as unknown as Fields)[`setUTC${field}`](...values);
      return this.setTime(moved.getTime() - offsetMs);
    };
  }
  proto.getTimezoneOffset = () => -offsetMs / 60_000;

  function ZonedDate(...args: unknown[]): Date | string {
    if (!new.target) return new RealDate(currentTime()).toString();
    const date = new RealDate(timeOf(args));
    Object.setPrototypeOf(date, proto);
    return date;
  }
  ZonedDate.prototype = proto;
  Object.assign(proto, { constructor: ZonedDate });
  ZonedDate.now = currentTime;
  ZonedDate.UTC = RealDate.UTC;
  ZonedDate.parse = (value: string) =>
    LOCAL_ISO.test(value) ? RealDate.parse(`${value}Z`) - offsetMs : RealDate.parse(value);
  return ZonedDate as unknown as DateConstructor;
}

/** Swap the clock for the rest of a test; the returned function restores it. */
export function installUtcOffset(offsetHours: number, now?: number): () => void {
  const original = global.Date;
  global.Date = zonedDateClass(offsetHours * 3_600_000, now);
  return () => {
    global.Date = original;
  };
}

/** Run `fn` with the device clock at `offsetHours` from UTC, stopped at `now` if given. */
export function atUtcOffset<T>(offsetHours: number, fn: () => T, now?: number): T {
  const restore = installUtcOffset(offsetHours, now);
  try {
    return fn();
  } finally {
    restore();
  }
}
