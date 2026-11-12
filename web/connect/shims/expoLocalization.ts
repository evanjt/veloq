// The clock setting the app's formatting module reads from expo-localization,
// taken from the browser. The build resolves `expo-localization` to this file
// for that module and no other.

export function getCalendars(): { uses24hourClock: boolean | null }[] {
  const cycle = new Intl.DateTimeFormat().resolvedOptions().hourCycle;
  return [{ uses24hourClock: cycle === undefined ? null : cycle === 'h23' || cycle === 'h24' }];
}
